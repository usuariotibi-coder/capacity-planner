import { useMemo, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import type { Assignment, Department, Employee, Stage } from '../types';
import { addWeeksToISO, getWeekNumber, normalizeWeekStartDate, parseISODate } from '../utils/dateUtils';

interface MoveAssignmentWeeksModalProps {
  department: Department;
  projectId: string;
  originWeekStart: string;
  assignments: Assignment[];
  getAssignmentDepartment: (assignment: Assignment) => Department | null | undefined;
  employeeById: Map<string, Employee>;
  stageOptions: Exclude<Stage, null>[];
  getStageLabel: (stage: Stage, t: Record<string, string>) => string;
  t: Record<string, string>;
  language: 'es' | 'en';
  onClose: () => void;
  onMoved: () => void;
  addAssignment: (assignment: Omit<Assignment, 'id'>) => Promise<void>;
  updateAssignment: (id: string, updates: Partial<Assignment>, options?: { skipRefetch?: boolean }) => Promise<void>;
  deleteAssignment: (id: string) => Promise<void>;
  fetchAssignments: (force?: boolean) => Promise<void>;
}

// How many consecutive weeks (starting at the cell's own week) are offered as move
// candidates. Forward-only, same convention as the week-split feature -- this tool moves
// forecasted work, not Finance-locked actuals, so there's nothing useful further back.
const SOURCE_WINDOW_WEEKS = 20;
const DESTINATION_WINDOW_WEEKS = 80;
const ALL_STAGES = '__all__';
const ALL_EMPLOYEES = '__all__';

type RowState = {
  selected: boolean;
  destWeekStart: string;
  touched: boolean;
};

const roundHours = (value: number) => Math.round((value || 0) * 100) / 100;

const weeksBetween = (laterIso: string, earlierIso: string): number => {
  const ms = parseISODate(laterIso).getTime() - parseISODate(earlierIso).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
};

export function MoveAssignmentWeeksModal({
  department,
  projectId,
  originWeekStart,
  assignments,
  getAssignmentDepartment,
  employeeById,
  stageOptions,
  getStageLabel,
  t,
  language,
  onClose,
  onMoved,
  addAssignment,
  updateAssignment,
  deleteAssignment,
  fetchAssignments,
}: MoveAssignmentWeeksModalProps) {
  const [scopeStage, setScopeStage] = useState<string>(ALL_STAGES);
  const [scopeEmployeeId, setScopeEmployeeId] = useState<string>(ALL_EMPLOYEES);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [conflictChoice, setConflictChoice] = useState<'merge' | 'overwrite'>('merge');
  const [isSaving, setIsSaving] = useState(false);

  const sourceWeeks = useMemo(
    () => Array.from({ length: SOURCE_WINDOW_WEEKS }, (_, i) => addWeeksToISO(originWeekStart, i)),
    [originWeekStart]
  );
  const destinationOptions = useMemo(
    () => Array.from({ length: DESTINATION_WINDOW_WEEKS }, (_, i) => addWeeksToISO(originWeekStart, i)),
    [originWeekStart]
  );

  // Indexed across the full DESTINATION range (a superset of the source window) -- a chosen
  // destination can land well past the 20 source weeks shown, and conflict detection needs to
  // see real existing data there too, not silently treat it as empty.
  const cellAssignmentsByWeek = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    destinationOptions.forEach((w) => map.set(w, []));
    assignments.forEach((a) => {
      if (a.projectId !== projectId) return;
      if (getAssignmentDepartment(a) !== department) return;
      const week = normalizeWeekStartDate(a.weekStartDate);
      if (!map.has(week)) return;
      map.get(week)!.push(a);
    });
    return map;
  }, [assignments, projectId, department, getAssignmentDepartment, destinationOptions]);

  // Only offer scope filters for data that actually exists somewhere in the visible window --
  // avoids a dropdown full of stages/people with nothing to move.
  const presentStages = useMemo(() => {
    const set = new Set<string>();
    cellAssignmentsByWeek.forEach((list) => list.forEach((a) => set.add(a.stage || '')));
    return Array.from(set);
  }, [cellAssignmentsByWeek]);

  const presentEmployees = useMemo(() => {
    const seen = new Map<string, Employee>();
    cellAssignmentsByWeek.forEach((list) => list.forEach((a) => {
      const emp = employeeById.get(a.employeeId);
      if (emp && !seen.has(emp.id)) seen.set(emp.id, emp);
    }));
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [cellAssignmentsByWeek, employeeById]);

  const matchesScope = (a: Assignment) =>
    (scopeStage === ALL_STAGES || (a.stage || '') === scopeStage) &&
    (scopeEmployeeId === ALL_EMPLOYEES || a.employeeId === scopeEmployeeId);

  const scopedHoursForWeek = (weekStart: string): number =>
    roundHours(
      (cellAssignmentsByWeek.get(weekStart) || [])
        .filter(matchesScope)
        .reduce((sum, a) => sum + (typeof a.totalHours === 'number' ? a.totalHours : (a.hours || 0)), 0)
    );

  const formatWeekLabel = (weekStart: string): string =>
    `${t.weekAbbr || 'CW'} ${getWeekNumber(weekStart)} (${weekStart})`;

  const setRow = (weekStart: string, patch: Partial<RowState>) => {
    setRows((prev) => {
      const existing = prev[weekStart] || { selected: false, destWeekStart: '', touched: false };
      return { ...prev, [weekStart]: { ...existing, ...patch } };
    });
  };

  const toggleRowSelected = (weekStart: string, selected: boolean) => {
    setRow(weekStart, { selected });
  };

  const handleDestChange = (weekStart: string, destWeekStart: string) => {
    setRow(weekStart, { destWeekStart, touched: true });
    if (!destWeekStart) return;
    const offset = weeksBetween(destWeekStart, weekStart);
    // Auto-fill every OTHER selected-but-not-yet-manually-set row with the same offset, so
    // checking 35/36/37 and setting 35's destination to 40 defaults 36->41, 37->42. Any row
    // the user has already touched directly keeps whatever they set, even after this.
    setRows((prev) => {
      const next = { ...prev };
      sourceWeeks.forEach((w) => {
        if (w === weekStart) return;
        const row = next[w];
        if (!row?.selected || row.touched) return;
        next[w] = { ...row, destWeekStart: addWeeksToISO(w, offset) };
      });
      return next;
    });
  };

  const selectedRows = sourceWeeks
    .filter((w) => rows[w]?.selected)
    .map((w) => ({ sourceWeek: w, destWeekStart: rows[w].destWeekStart }));

  // A destination that lands on another week ALSO being moved out in this same operation is
  // ambiguous (that row would both receive merged data and get deleted as someone else's
  // source) -- blocked rather than guessed at, since none of the documented scenarios need it
  // (multiple sources converging on one destination that ISN'T itself being moved is fine and
  // unaffected by this check).
  const selectedSourceWeeks = new Set(selectedRows.map((r) => r.sourceWeek));
  const hasChainedDestination = selectedRows.some((r) => r.destWeekStart && selectedSourceWeeks.has(r.destWeekStart));
  const allSelectedHaveDestination = selectedRows.length > 0 && selectedRows.every((r) => !!r.destWeekStart) && !hasChainedDestination;

  // Groups every assignment that would move, by (destination week, employee, stage), summing
  // hours together -- this is what makes "move 35 and 36 into 40" combine their hours instead
  // of one silently overwriting the other once they land on the same week.
  type MoveBucket = {
    destWeekStart: string;
    employeeId: string;
    stageKey: string;
    stage: Stage;
    scioHours: number;
    externalHours: number;
    hours: number;
    comment?: string;
    departmentOverride?: Department | null;
    sourceAssignmentIds: string[];
  };

  const buildMoveBuckets = (): MoveBucket[] => {
    const buckets = new Map<string, MoveBucket>();
    selectedRows.forEach(({ sourceWeek, destWeekStart }) => {
      const scopedAssignments = (cellAssignmentsByWeek.get(sourceWeek) || []).filter(matchesScope);
      scopedAssignments.forEach((a) => {
        const stageKey = a.stage || '';
        const key = `${destWeekStart}::${a.employeeId}::${stageKey}`;
        const existing = buckets.get(key);
        const hours = typeof a.totalHours === 'number' ? a.totalHours : (a.hours || 0);
        if (existing) {
          existing.scioHours = roundHours(existing.scioHours + (a.scioHours || 0));
          existing.externalHours = roundHours(existing.externalHours + (a.externalHours || 0));
          existing.hours = roundHours(existing.hours + hours);
          existing.sourceAssignmentIds.push(a.id);
          if (!existing.comment && a.comment) existing.comment = a.comment;
        } else {
          buckets.set(key, {
            destWeekStart,
            employeeId: a.employeeId,
            stageKey,
            stage: a.stage,
            scioHours: roundHours(a.scioHours || 0),
            externalHours: roundHours(a.externalHours || 0),
            hours: roundHours(hours),
            comment: a.comment,
            departmentOverride: a.departmentOverride ?? null,
            sourceAssignmentIds: [a.id],
          });
        }
      });
    });
    return Array.from(buckets.values());
  };

  const moveBuckets = step === 'confirm' ? buildMoveBuckets() : [];

  // A conflict is a bucket landing on a destination that already has data for that exact
  // employee+stage, from BEFORE this move (not from another moved source week -- those are
  // already summed together inside the bucket itself).
  const conflicts = moveBuckets
    .map((bucket) => {
      const destAssignments = cellAssignmentsByWeek.get(bucket.destWeekStart) || [];
      const existing = destAssignments.find((a) => a.employeeId === bucket.employeeId && (a.stage || '') === bucket.stageKey);
      return existing ? { bucket, existing } : null;
    })
    .filter((c): c is { bucket: MoveBucket; existing: Assignment } => !!c);

  const employeeName = (employeeId: string) => employeeById.get(employeeId)?.name || employeeId;
  const stageLabel = (stage: Stage) => (stage ? getStageLabel(stage, t) : (t.noStage || (language === 'es' ? 'Sin fase' : 'No stage')));

  const handleConfirmMove = async () => {
    setIsSaving(true);
    try {
      const buckets = buildMoveBuckets();
      for (const bucket of buckets) {
        const destAssignments = cellAssignmentsByWeek.get(bucket.destWeekStart) || [];
        const existing = destAssignments.find((a) => a.employeeId === bucket.employeeId && (a.stage || '') === bucket.stageKey);

        if (existing) {
          const mergedScio = conflictChoice === 'merge' ? roundHours((existing.scioHours || 0) + bucket.scioHours) : bucket.scioHours;
          const mergedExternal = conflictChoice === 'merge' ? roundHours((existing.externalHours || 0) + bucket.externalHours) : bucket.externalHours;
          const mergedHours = conflictChoice === 'merge' ? roundHours((existing.hours || 0) + bucket.hours) : bucket.hours;
          await updateAssignment(existing.id, {
            hours: mergedHours,
            scioHours: mergedScio,
            externalHours: mergedExternal,
            comment: bucket.comment || existing.comment,
          }, { skipRefetch: true });
        } else if (projectId) {
          await addAssignment({
            employeeId: bucket.employeeId,
            projectId,
            weekStartDate: bucket.destWeekStart,
            hours: bucket.hours,
            scioHours: bucket.scioHours,
            externalHours: bucket.externalHours,
            stage: bucket.stage,
            comment: bucket.comment,
            departmentOverride: bucket.departmentOverride || undefined,
          });
        }

        for (const sourceId of bucket.sourceAssignmentIds) {
          await deleteAssignment(sourceId);
        }
      }

      await fetchAssignments(true);
      onMoved();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[100]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 z-[110] w-[95vw] max-w-[720px] transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl border border-gray-200 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center gap-3 p-3.5 md:p-4 border-b border-gray-200 bg-white flex-shrink-0">
          <div>
            <h3 className="text-base md:text-lg font-bold text-gray-800">
              {language === 'es' ? 'Mover semanas' : 'Move weeks'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">{department}</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full border border-gray-300 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 md:p-4 space-y-3.5">
          {step === 'select' ? (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-700">
                  {language === 'es' ? 'Alcance: qué se va a mover' : 'Scope: what will be moved'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {stageOptions.length > 0 && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">{t.stage}</label>
                      <select
                        value={scopeStage}
                        onChange={(e) => setScopeStage(e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
                      >
                        <option value={ALL_STAGES}>{language === 'es' ? 'Todas las fases' : 'All stages'}</option>
                        {presentStages.map((stageKey) => (
                          <option key={stageKey || 'none'} value={stageKey}>
                            {stageKey ? getStageLabel(stageKey as Exclude<Stage, null>, t) : (t.noStage || 'No stage')}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{language === 'es' ? 'Persona' : 'Person'}</label>
                    <select
                      value={scopeEmployeeId}
                      onChange={(e) => setScopeEmployeeId(e.target.value)}
                      className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
                    >
                      <option value={ALL_EMPLOYEES}>{language === 'es' ? 'Todas las personas' : 'Everyone'}</option>
                      {presentEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  {language === 'es'
                    ? 'Déjalo en "Todas" para mover la celda completa, o filtra a una fase/persona específica.'
                    : 'Leave it on "All" to move the whole cell, or filter down to one stage/person.'}
                </p>
              </div>

              {hasChainedDestination && (
                <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2">
                  {language === 'es'
                    ? 'No puedes mover una semana hacia otra semana que también estás moviendo en esta misma operación. Ajusta los destinos o hazlo en dos pasos.'
                    : "You can't move a week into another week that's also being moved in this same operation. Adjust the destinations or do it in two steps."}
                </div>
              )}

              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="w-8 px-2 py-2"></th>
                      <th className="text-left px-2 py-2">{language === 'es' ? 'Semana origen' : 'Source week'}</th>
                      <th className="text-right px-2 py-2">{language === 'es' ? 'Horas' : 'Hours'}</th>
                      <th className="px-2 py-2 w-6"></th>
                      <th className="text-left px-2 py-2">{language === 'es' ? 'Semana destino' : 'Destination week'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceWeeks.map((weekStart) => {
                      const hours = scopedHoursForWeek(weekStart);
                      const row = rows[weekStart];
                      const hasData = hours > 0;
                      return (
                        <tr key={weekStart} className={`border-t border-gray-100 ${!hasData ? 'opacity-40' : ''}`}>
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              disabled={!hasData}
                              checked={!!row?.selected}
                              onChange={(e) => toggleRowSelected(weekStart, e.target.checked)}
                              className="w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-gray-700">{formatWeekLabel(weekStart)}</td>
                          <td className="px-2 py-1.5 text-right text-gray-700">{hours ? `${hours}h` : '-'}</td>
                          <td className="px-2 py-1.5 text-gray-400">
                            {row?.selected && <ArrowRight size={14} />}
                          </td>
                          <td className="px-2 py-1.5">
                            {row?.selected && (
                              <select
                                value={row.destWeekStart}
                                onChange={(e) => handleDestChange(weekStart, e.target.value)}
                                className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs bg-white"
                              >
                                <option value="">{language === 'es' ? '-- elige destino --' : '-- pick destination --'}</option>
                                {destinationOptions.map((opt) => (
                                  <option key={opt} value={opt}>{formatWeekLabel(opt)}</option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-gray-700">
                  {language === 'es' ? 'Resumen del movimiento' : 'Move summary'}
                </p>
                {selectedRows.map(({ sourceWeek, destWeekStart }) => (
                  <div key={sourceWeek} className="flex items-center gap-2 text-sm text-gray-700">
                    <span>{formatWeekLabel(sourceWeek)}</span>
                    <ArrowRight size={14} className="text-gray-400" />
                    <span className="font-medium">{formatWeekLabel(destWeekStart)}</span>
                  </div>
                ))}
              </div>

              {conflicts.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-amber-900">
                    {language === 'es'
                      ? `${conflicts.length} semana(s) destino ya tienen datos que coinciden`
                      : `${conflicts.length} destination week(s) already have matching data`}
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {conflicts.map(({ bucket, existing }) => (
                      <div key={`${bucket.destWeekStart}::${bucket.employeeId}::${bucket.stageKey}`} className="text-xs text-amber-800">
                        {formatWeekLabel(bucket.destWeekStart)} · {employeeName(bucket.employeeId)} · {stageLabel(bucket.stage)}:{' '}
                        {language === 'es' ? 'ya tiene' : 'already has'} {roundHours(existing.totalHours ?? existing.hours ?? 0)}h
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        checked={conflictChoice === 'merge'}
                        onChange={() => setConflictChoice('merge')}
                      />
                      {language === 'es' ? 'Combinar (sumar horas)' : 'Merge (add hours)'}
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        checked={conflictChoice === 'overwrite'}
                        onChange={() => setConflictChoice('overwrite')}
                      />
                      {language === 'es' ? 'Sobreescribir' : 'Overwrite'}
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-between gap-2.5 p-3 md:px-4 border-t border-gray-200 flex-shrink-0 bg-white">
          {step === 'select' ? (
            <>
              <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition">
                {t.cancel}
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!allSelectedHaveDestination}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {language === 'es' ? 'Continuar' : 'Continue'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('select')} disabled={isSaving} className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 transition">
                {language === 'es' ? 'Atrás' : 'Back'}
              </button>
              <button
                onClick={handleConfirmMove}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition flex items-center gap-2"
              >
                {isSaving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                {language === 'es' ? 'Confirmar movimiento' : 'Confirm move'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
