import { useEffect, useState } from 'react';
import { addWeeksToISO, getWeekNumber } from '../utils/dateUtils';
import type { Language } from '../utils/translations';

export interface ResourceColumn {
  id: string;
  label: string;
}

interface WeekSplitEditorProps {
  // ISO date of the first week (the cell/stage entry being edited).
  weekStartDate: string;
  // Total hours being distributed. Only used to compute the even split; the caller owns the
  // actual total (this component never changes it).
  totalHours: number;
  weekCount: number;
  onWeekCountChange: (count: number) => void;
  isEven: boolean;
  onIsEvenChange: (even: boolean) => void;
  // Raw text per week (length should match weekCount once the user has typed into manual mode;
  // missing entries fall back to the even split). Ignored once `columns` has 2+ entries --
  // `cellInputs`/`onCellInputChange` take over instead (see below).
  weeklyInputs: string[];
  onWeeklyInputChange: (index: number, value: string) => void;
  language: Language;
  disabled?: boolean;
  // When 2+ columns are given (e.g. one per selected person), the editor switches from a single
  // value per week to a full week x column grid -- see computeMatrixHours. 0 or 1 columns keeps
  // the plain single-value-per-week view (weeklyInputs above), since there's nothing to break
  // down across in that case.
  columns?: ResourceColumn[];
  // Raw text per (column, week) cell, keyed by `${columnId}::${weekIndex}` -- only used once
  // `columns` has 2+ entries.
  cellInputs?: Record<string, string>;
  onCellInputChange?: (columnId: string, weekIndex: number, value: string) => void;
  // Hides this instance's own "Split across weeks" count input -- for a cell with multiple
  // independent pools (BUILD/PRG's SCIO and External hours) that should still share ONE week
  // range, the parent renders the count input once itself and passes the shared `weekCount`/
  // `onWeekCountChange` down to every pool's instance with this set.
  hideWeekCountInput?: boolean;
}

const MAX_WEEKS = 52;
// The single synthetic column computeWeeklyHours/the plain single-value view both key their one
// "pool total" cell under, so computeWeeklyHours can be expressed as a 1-column computeMatrixHours.
// Exported so a caller juggling both a single-list `weeklyInputs` prop and a `cellInputs` map for
// the same pool (e.g. a BUILD/PRG resource pool that may or may not have 2+ people selected) can
// key both into the one underlying map instead of keeping two separate pieces of state in sync.
export const SOLO_COLUMN = '__total__';

/**
 * Resolves actual hour values for a week x column grid from its current state (even split, or
 * manual with typed values) -- used both to prime manual mode with a starting point, and by the
 * save flow to get the real numbers regardless of even/manual mode. Exact division (no special
 * rounding): the sum of every returned value always equals `totalHours`, up to floating point
 * error (even mode divides directly; manual mode's blank cells absorb whatever remainder the
 * typed values didn't account for, split evenly among just those blanks, so a half-filled manual
 * table still saves the full total instead of silently dropping hours).
 *
 * `columnIds` may be empty (a single implicit column, e.g. no per-person breakdown) -- the
 * returned keys then use `SOLO_COLUMN`.
 */
export function computeMatrixHours(
  totalHours: number,
  weekCount: number,
  columnIds: string[],
  isEven: boolean,
  cellInputs: Record<string, string>
): Record<string, number> {
  const safeWeekCount = Math.max(1, Math.min(MAX_WEEKS, Math.round(weekCount) || 1));
  const cols = columnIds.length > 0 ? columnIds : [SOLO_COLUMN];
  const cellKeys: string[] = [];
  for (let w = 0; w < safeWeekCount; w++) {
    for (const col of cols) cellKeys.push(`${col}::${w}`);
  }

  // A single cell (1 week, 0-1 columns) has no actual breakdown UI to diverge from the total
  // through -- always the whole amount, ignoring any stale manual input, same as the plain
  // total field it mirrors.
  if (cellKeys.length === 1) {
    return { [cellKeys[0]]: totalHours };
  }

  if (isEven || cellKeys.length === 0) {
    const share = cellKeys.length > 0 ? totalHours / cellKeys.length : 0;
    const result: Record<string, number> = {};
    cellKeys.forEach((key) => { result[key] = share; });
    return result;
  }

  const manualValues = cellKeys.map((key) => {
    const raw = cellInputs[key];
    const parsed = raw === undefined || raw === '' ? NaN : parseFloat(raw);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : NaN;
  });
  const accountedFor = manualValues.reduce((sum: number, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  const blankCount = manualValues.filter((v) => !Number.isFinite(v)).length;
  const remainder = Math.max(0, totalHours - accountedFor);
  const remainderShare = blankCount > 0 ? remainder / blankCount : 0;

  const result: Record<string, number> = {};
  cellKeys.forEach((key, i) => {
    result[key] = Number.isFinite(manualValues[i]) ? manualValues[i] : remainderShare;
  });
  return result;
}

/** Single-column convenience wrapper over computeMatrixHours -- see its docstring. */
export function computeWeeklyHours(totalHours: number, weekCount: number, isEven: boolean, weeklyInputs: string[]): number[] {
  const cellInputs: Record<string, string> = {};
  weeklyInputs.forEach((value, i) => { cellInputs[`${SOLO_COLUMN}::${i}`] = value; });
  const matrix = computeMatrixHours(totalHours, weekCount, [], isEven, cellInputs);
  const safeWeekCount = Math.max(1, Math.min(MAX_WEEKS, Math.round(weekCount) || 1));
  return Array.from({ length: safeWeekCount }, (_, i) => matrix[`${SOLO_COLUMN}::${i}`] ?? 0);
}

/**
 * "Divide this activity across N weeks" control, used for the single hours total a BUILD/PRG
 * cell's SCIO/External pool has (or any department with no Stage planner's plain Hours field),
 * and once per Stage entry in departments that do have one (MED/HD/MFG) -- each Stage entry can
 * span its own number of weeks, independent of the other Stage entries in the same cell.
 *
 * Passing 2+ `columns` (e.g. BUILD/PRG's selected people, SCIO and External kept as separate
 * pools/separate instances of this component) turns the single value-per-week list into a full
 * week x column grid instead, so each person's (or external provider's) hours can be set
 * independently per week -- still governed by the same weekCount/isEven toggle.
 *
 * weekCount === 1 with 0-1 columns renders nothing extra: the caller's own hours field is the
 * only input, so existing single-week/single-person behavior is untouched.
 */
export function WeekSplitEditor({
  weekStartDate,
  totalHours,
  weekCount,
  onWeekCountChange,
  isEven,
  onIsEvenChange,
  weeklyInputs,
  onWeeklyInputChange,
  language,
  disabled,
  columns,
  cellInputs,
  onCellInputChange,
  hideWeekCountInput,
}: WeekSplitEditorProps) {
  const isEs = language === 'es';
  const safeWeekCount = Math.max(1, Math.min(MAX_WEEKS, Math.round(weekCount) || 1));
  const activeColumns = columns && columns.length >= 2 ? columns : [];
  const isGrid = activeColumns.length > 0;
  const showBreakdown = safeWeekCount > 1 || isGrid;

  const columnIds = activeColumns.map((c) => c.id);
  const matrix = isGrid
    ? computeMatrixHours(totalHours, safeWeekCount, columnIds, isEven, cellInputs || {})
    : null;
  const evenShare = safeWeekCount > 0 ? totalHours / safeWeekCount : 0;

  // A plain `value={safeWeekCount}` (clamped straight from the prop) snaps back to "1" on every
  // keystroke the instant the field is empty or mid-edit (e.g. typing "12" bounces through an
  // invalid "" and "1" state) -- clamping only at the edges of editing, here, instead of on
  // every change, is what lets the field actually be cleared and retyped.
  const [weekCountText, setWeekCountText] = useState(String(safeWeekCount));
  useEffect(() => {
    setWeekCountText(String(safeWeekCount));
    // Only resync when the prop changes from the OUTSIDE (e.g. the modal reopened on a
    // different cell/entry) -- our own onChange below already keeps safeWeekCount and this text
    // in agreement for every valid in-range value the user types, so this effect intentionally
    // does not depend on weekCountText itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeWeekCount]);

  const commitWeekCount = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const safe = Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_WEEKS, parsed)) : 1;
    setWeekCountText(String(safe));
    if (safe !== safeWeekCount) onWeekCountChange(safe);
  };

  const cellClassName = "w-20 border border-gray-300 rounded-md px-2 py-1 text-xs text-right text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 read-only:bg-gray-50 read-only:text-gray-700";

  return (
    <div className="space-y-2">
      {!hideWeekCountInput && (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-700 whitespace-nowrap">
            {isEs ? 'Dividir en semanas' : 'Split across weeks'}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={weekCountText}
            disabled={disabled}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '' || /^\d{0,3}$/.test(raw)) {
                setWeekCountText(raw);
                if (raw !== '') {
                  const parsed = parseInt(raw, 10);
                  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_WEEKS) {
                    onWeekCountChange(parsed);
                  }
                }
              }
            }}
            onBlur={(e) => commitWeekCount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitWeekCount(e.currentTarget.value);
                e.currentTarget.blur();
              }
            }}
            className="w-16 border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>
      )}

      {showBreakdown && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isEven}
              disabled={disabled}
              onChange={(e) => onIsEvenChange(e.target.checked)}
              className="w-3.5 h-3.5 text-blue-500 rounded cursor-pointer"
            />
            {isEs ? 'Repartir equitativamente' : 'Distribute evenly'}
          </label>

          {isGrid ? (
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 bg-gray-50 px-2.5 py-1.5 text-left font-medium text-gray-600 border-b border-gray-200">
                      {isEs ? 'Semana' : 'Week'}
                    </th>
                    {activeColumns.map((col) => (
                      <th key={col.id} className="px-2 py-1.5 text-right font-medium text-gray-600 border-b border-l border-gray-100 whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: safeWeekCount }).map((_, weekIndex) => {
                    const weekDate = addWeeksToISO(weekStartDate, weekIndex);
                    const weekNum = getWeekNumber(weekDate);
                    return (
                      <tr key={weekDate} className="border-b border-gray-100 last:border-b-0">
                        <td className="sticky left-0 bg-white px-2.5 py-1 text-gray-600 whitespace-nowrap">CW{weekNum}</td>
                        {activeColumns.map((col) => {
                          const key = `${col.id}::${weekIndex}`;
                          const displayValue = isEven
                            ? (Math.round((matrix?.[key] || 0) * 100) / 100 || '')
                            : (cellInputs?.[key] ?? '');
                          return (
                            <td key={col.id} className="px-1 py-0.5 border-l border-gray-100">
                              <input
                                type="text"
                                inputMode="decimal"
                                readOnly={isEven || disabled}
                                disabled={disabled}
                                value={displayValue}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => {
                                  if (isEven || !onCellInputChange) return;
                                  const raw = e.target.value;
                                  const normalized = raw.replace(',', '.');
                                  if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                    onCellInputChange(col.id, weekIndex, raw);
                                  }
                                }}
                                className={cellClassName}
                                placeholder="0"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
              {Array.from({ length: safeWeekCount }).map((_, index) => {
                const weekDate = addWeeksToISO(weekStartDate, index);
                const weekNum = getWeekNumber(weekDate);
                const displayValue = isEven
                  ? (Math.round(evenShare * 100) / 100 || '')
                  : (weeklyInputs[index] ?? '');
                return (
                  <div key={weekDate} className="flex items-center justify-between gap-2 px-2.5 py-1">
                    <span className="text-xs text-gray-600 whitespace-nowrap">CW{weekNum}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      readOnly={isEven || disabled}
                      disabled={disabled}
                      value={displayValue}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        if (isEven) return;
                        const raw = e.target.value;
                        const normalized = raw.replace(',', '.');
                        if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                          onWeeklyInputChange(index, raw);
                        }
                      }}
                      className={cellClassName}
                      placeholder="0"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
