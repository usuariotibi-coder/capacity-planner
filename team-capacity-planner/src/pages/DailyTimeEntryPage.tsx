import { useEffect, useMemo, useState } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useProjectStore } from '../stores/projectStore';
import { useDailyTimeEntryStore } from '../stores/dailyTimeEntryStore';
import type { Department, DailyTimeEntry, TimeEntryType } from '../types';
import { getWeekStart, formatToISO, parseISODate, getWeekNumber } from '../utils/dateUtils';
import { WeekNumberDatePicker } from '../components/WeekNumberDatePicker';
import { ChevronLeft, ChevronRight, X, Plus, Trash2, CalendarRange } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'PURCHASING'];
const SHARED_EDIT_DEPARTMENTS: Department[] = ['BUILD', 'MFG'];
const HEAD_ENGINEERING_MANAGED_DEPARTMENTS: Department[] = ['MED', 'HD'];
const WEEKS_TO_SHOW = 2;

const MONTH_NAMES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ENTRY_TYPE_STYLES: Record<TimeEntryType, string> = {
  PROJECT: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  OIL: 'bg-orange-100 text-orange-800 border-orange-300',
  IND: 'bg-gray-100 text-gray-600 border-gray-300',
  VAC: 'bg-teal-100 text-teal-800 border-teal-300',
};

function addDays(dateStr: string, days: number): string {
  const d = parseISODate(dateStr);
  d.setDate(d.getDate() + days);
  return formatToISO(d);
}

function mondayOf(dateStr: string): string {
  return formatToISO(getWeekStart(parseISODate(dateStr)));
}

function isPlaceholderEmployee(name: string, role: string) {
  return role === 'Placeholder' || name.endsWith('Placeholder');
}

export function DailyTimeEntryPage() {
  const employees = useEmployeeStore((state) => state.employees);
  const projects = useProjectStore((state) => state.projects);
  const { entries, isLoading, fetchEntries, addEntry, deleteEntry } = useDailyTimeEntryStore();
  const { language } = useLanguage();
  const isEs = language === 'es';
  const { hasFullAccess, isReadOnly, currentUserDepartment, currentUserOtherDepartment } = useAuth();
  const hasHeadEngineeringScope =
    currentUserDepartment === 'OTHER' && currentUserOtherDepartment === 'HEAD_ENGINEERING';

  const canEditDepartment = (department: Department) => {
    if (hasFullAccess) return true;
    if (isReadOnly) return false;
    if (hasHeadEngineeringScope) return HEAD_ENGINEERING_MANAGED_DEPARTMENTS.includes(department);
    if (
      currentUserDepartment &&
      SHARED_EDIT_DEPARTMENTS.includes(currentUserDepartment as Department) &&
      SHARED_EDIT_DEPARTMENTS.includes(department)
    ) {
      return true;
    }
    return currentUserDepartment === department;
  };

  const [startWeek, setStartWeek] = useState<string>(() => formatToISO(getWeekStart(new Date())));
  const [departmentFilter, setDepartmentFilter] = useState<'ALL' | Department>('ALL');
  const [search, setSearch] = useState('');
  const [editingCell, setEditingCell] = useState<{ employeeId: string; date: string } | null>(null);
  const [newEntryType, setNewEntryType] = useState<TimeEntryType>('PROJECT');
  const [newProjectId, setNewProjectId] = useState('');
  const [newHours, setNewHours] = useState('');
  const [newComment, setNewComment] = useState('');

  const endDate = addDays(startWeek, WEEKS_TO_SHOW * 7 - 1);

  useEffect(() => {
    fetchEntries({ startDate: startWeek, endDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWeek]);

  const days = useMemo(() => {
    const monthNames = isEs ? MONTH_NAMES_ES : MONTH_NAMES_EN;
    const list: Array<{ date: string; dayOfMonth: number; monthLabel: string; weekNum: number; isWeekend: boolean }> = [];
    for (let i = 0; i < WEEKS_TO_SHOW * 7; i++) {
      const date = addDays(startWeek, i);
      const parsed = parseISODate(date);
      const dayOfWeek = parsed.getDay();
      list.push({
        date,
        dayOfMonth: parsed.getDate(),
        monthLabel: monthNames[parsed.getMonth()],
        weekNum: getWeekNumber(date),
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      });
    }
    return list;
  }, [startWeek, isEs]);

  // Group consecutive days sharing a month/week for the header rows (colSpan)
  const monthGroups = useMemo(() => {
    const groups: Array<{ label: string; span: number }> = [];
    days.forEach((day) => {
      const last = groups[groups.length - 1];
      if (last && last.label === day.monthLabel) last.span += 1;
      else groups.push({ label: day.monthLabel, span: 1 });
    });
    return groups;
  }, [days]);

  const weekGroups = useMemo(() => {
    const groups: Array<{ label: string; span: number }> = [];
    days.forEach((day) => {
      const label = `CW${day.weekNum}`;
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.span += 1;
      else groups.push({ label, span: 1 });
    });
    return groups;
  }, [days]);

  const visibleEmployees = useMemo(() => {
    return employees
      .filter((emp) =>
        emp.isActive &&
        !isPlaceholderEmployee(emp.name, emp.role) &&
        !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0)
      )
      .filter((emp) => departmentFilter === 'ALL' || emp.department === departmentFilter)
      .filter((emp) => !search.trim() || emp.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        const deptDiff = DEPARTMENTS.indexOf(a.department) - DEPARTMENTS.indexOf(b.department);
        if (deptDiff !== 0) return deptDiff;
        return a.name.localeCompare(b.name);
      });
  }, [employees, departmentFilter, search]);

  const entriesByEmployeeDay = useMemo(() => {
    const map = new Map<string, DailyTimeEntry[]>();
    entries.forEach((entry) => {
      const key = `${entry.employeeId}|${entry.date}`;
      const bucket = map.get(key) || [];
      bucket.push(entry);
      map.set(key, bucket);
    });
    return map;
  }, [entries]);

  const projectNameById = useMemo(
    () => new Map(projects.map((proj) => [proj.id, proj.name])),
    [projects]
  );

  const openCell = (employeeId: string, date: string) => {
    setEditingCell({ employeeId, date });
    setNewEntryType('PROJECT');
    setNewProjectId('');
    setNewHours('');
    setNewComment('');
  };

  const closeCell = () => setEditingCell(null);

  const cellEntries = editingCell
    ? entriesByEmployeeDay.get(`${editingCell.employeeId}|${editingCell.date}`) || []
    : [];

  const handleAddEntry = async () => {
    if (!editingCell) return;
    const hours = parseFloat(newHours);
    if (!hours || hours <= 0) return;
    const requiresProject = newEntryType === 'PROJECT' || newEntryType === 'OIL';
    if (requiresProject && !newProjectId) return;

    await addEntry({
      employeeId: editingCell.employeeId,
      date: editingCell.date,
      entryType: newEntryType,
      projectId: requiresProject ? newProjectId : null,
      hours,
      comment: newComment || undefined,
    } as any);
    setNewProjectId('');
    setNewHours('');
    setNewComment('');
  };

  const editingEmployee = editingCell ? employees.find((e) => e.id === editingCell.employeeId) : null;
  const canEditEditingCell = editingEmployee ? canEditDepartment(editingEmployee.department) : false;

  return (
    <div className="h-full overflow-y-auto bg-[#f8f6fb] p-3 md:p-5">
      <div className="max-w-7xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[#2e1a47] flex items-center gap-2">
            <CalendarRange size={22} />
            {isEs ? 'Registro Diario' : 'Daily Time Entry'}
          </h1>
          <p className="text-xs md:text-sm text-[#6c6480] mt-1">
            {isEs
              ? 'Bitácora diaria por empleado: proyecto, OIL (resolución de issues), tiempo indirecto o vacaciones.'
              : 'Daily log per employee: project, OIL (issue resolution), indirect time, or vacation.'}
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white border border-[#e5e0eb] rounded-lg p-3 flex flex-col md:flex-row gap-2 md:items-center">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setStartWeek(addDays(startWeek, -7 * WEEKS_TO_SHOW))}
              className="p-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
              title={isEs ? 'Semanas anteriores' : 'Previous weeks'}
            >
              <ChevronLeft size={16} />
            </button>
            <WeekNumberDatePicker value={startWeek} onChange={(v) => setStartWeek(mondayOf(v))} language={language} compact />
            <button
              onClick={() => setStartWeek(addDays(startWeek, 7 * WEEKS_TO_SHOW))}
              className="p-1.5 border border-gray-300 rounded-md hover:bg-gray-50"
              title={isEs ? 'Semanas siguientes' : 'Next weeks'}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value as 'ALL' | Department)}
            className="text-sm border border-gray-300 rounded-md px-2.5 py-1.5 bg-white"
          >
            <option value="ALL">{isEs ? 'Todos los departamentos' : 'All departments'}</option>
            {DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isEs ? 'Buscar por nombre...' : 'Search by name...'}
            className="flex-1 min-w-[160px] text-sm border border-gray-300 rounded-md px-2.5 py-1.5"
          />

          {/* Legend */}
          <div className="flex items-center gap-2 text-[10px] flex-wrap">
            {(['PROJECT', 'OIL', 'IND', 'VAC'] as TimeEntryType[]).map((type) => (
              <span key={type} className={`px-1.5 py-0.5 rounded border font-semibold ${ENTRY_TYPE_STYLES[type]}`}>
                {type}
              </span>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="bg-white border border-[#e5e0eb] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th rowSpan={3} className="sticky left-0 bg-[#f3eef8] border border-gray-200 px-2 py-1 text-left min-w-[160px] z-10">
                    {isEs ? 'Empleado' : 'Employee'}
                  </th>
                  {monthGroups.map((group, idx) => (
                    <th key={idx} colSpan={group.span} className="bg-[#2e1a47] text-white border border-gray-200 px-1 py-1">
                      {group.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {weekGroups.map((group, idx) => (
                    <th key={idx} colSpan={group.span} className="bg-[#827691] text-white border border-gray-200 px-1 py-0.5">
                      {group.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {days.map((day) => (
                    <th
                      key={day.date}
                      className={`border border-gray-200 px-1 py-0.5 font-medium min-w-[54px] ${day.isWeekend ? 'bg-gray-200 text-gray-500' : 'bg-[#ece6f5] text-[#2e1a47]'}`}
                    >
                      {day.dayOfMonth}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="sticky left-0 bg-white border border-gray-200 px-2 py-1 font-medium text-[#2e1a47] whitespace-nowrap z-10">
                      {emp.name}
                      <span className="ml-1 text-[9px] text-gray-400">({emp.department})</span>
                    </td>
                    {days.map((day) => {
                      const cellKey = `${emp.id}|${day.date}`;
                      const cellEntries = entriesByEmployeeDay.get(cellKey) || [];
                      const canEdit = canEditDepartment(emp.department);
                      return (
                        <td
                          key={day.date}
                          onClick={() => canEdit && openCell(emp.id, day.date)}
                          className={`border border-gray-200 px-0.5 py-0.5 align-top text-center ${
                            day.isWeekend ? 'bg-gray-100' : canEdit ? 'cursor-pointer hover:bg-blue-50' : ''
                          }`}
                        >
                          <div className="flex flex-col gap-0.5 items-center">
                            {cellEntries.map((entry) => (
                              <span
                                key={entry.id}
                                className={`text-[9px] px-1 rounded border leading-tight ${ENTRY_TYPE_STYLES[entry.entryType]}`}
                                title={entry.projectId ? projectNameById.get(entry.projectId) : entry.entryType}
                              >
                                {entry.entryType === 'PROJECT'
                                  ? projectNameById.get(entry.projectId || '') || entry.entryType
                                  : entry.entryType}
                                {' '}({entry.hours}h)
                              </span>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {visibleEmployees.length === 0 && (
                  <tr>
                    <td colSpan={1 + days.length} className="px-3 py-6 text-center text-sm text-gray-400">
                      {isEs ? 'No hay empleados para este filtro.' : 'No employees for this filter.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {isLoading && (
            <div className="px-3 py-2 text-xs text-gray-400">{isEs ? 'Cargando...' : 'Loading...'}</div>
          )}
        </div>
      </div>

      {/* Cell edit modal */}
      {editingCell && editingEmployee && (
        <div className="fixed inset-0 bg-black/40 z-[95] flex items-center justify-center p-4" onClick={closeCell}>
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#2e1a47]">{editingEmployee.name}</h3>
                <p className="text-xs text-gray-500">{editingCell.date}</p>
              </div>
              <button onClick={closeCell} className="p-1 hover:bg-gray-100 rounded-md">
                <X size={16} />
              </button>
            </div>

            {/* Existing entries */}
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {cellEntries.length === 0 && (
                <p className="text-xs text-gray-400">{isEs ? 'Sin entradas todavía.' : 'No entries yet.'}</p>
              )}
              {cellEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded border ${ENTRY_TYPE_STYLES[entry.entryType]}`}
                >
                  <span className="font-semibold">
                    {entry.entryType}
                    {entry.projectId ? ` · ${projectNameById.get(entry.projectId) || entry.projectId}` : ''}
                  </span>
                  <span>{entry.hours}h</span>
                  {canEditEditingCell && (
                    <button onClick={() => deleteEntry(entry.id)} className="text-red-500 hover:text-red-700">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {canEditEditingCell ? (
              <div className="border-t pt-3 space-y-2">
                <div className="flex gap-1.5">
                  {(['PROJECT', 'OIL', 'IND', 'VAC'] as TimeEntryType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => { setNewEntryType(type); setNewProjectId(''); }}
                      className={`flex-1 text-[10px] font-semibold px-1.5 py-1 rounded border ${
                        newEntryType === type ? ENTRY_TYPE_STYLES[type] : 'bg-white text-gray-500 border-gray-200'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {(newEntryType === 'PROJECT' || newEntryType === 'OIL') && (
                  <select
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full text-xs border border-gray-300 rounded-md px-2 py-1.5"
                  >
                    <option value="">{isEs ? 'Selecciona proyecto...' : 'Select project...'}</option>
                    {projects.filter((p) => !p.isHidden).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                )}

                <div className="flex gap-1.5">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={newHours}
                    onChange={(e) => setNewHours(e.target.value)}
                    placeholder={isEs ? 'Horas' : 'Hours'}
                    className="w-20 text-xs border border-gray-300 rounded-md px-2 py-1.5"
                  />
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={isEs ? 'Comentario (opcional)' : 'Comment (optional)'}
                    className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1.5"
                  />
                  <button
                    onClick={handleAddEntry}
                    className="px-2 py-1.5 bg-[#2e1a47] text-white rounded-md hover:bg-[#3b2658]"
                    title={isEs ? 'Agregar' : 'Add'}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 border-t pt-3">
                {isEs ? 'Solo lectura para este departamento.' : 'Read-only for this department.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
