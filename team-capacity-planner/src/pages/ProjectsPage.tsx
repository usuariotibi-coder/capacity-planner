import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useEmployeeStore } from '../stores/employeeStore';
import type { Project, Department, DepartmentStageConfig } from '../types';
import { generateId } from '../utils/id';
import { getDepartmentIcon, getDepartmentLabel } from '../utils/departmentIcons';
import { getAllWeeksWithNextYear, formatToISO, parseISODate } from '../utils/dateUtils';
import { CheckCircle2, Plus, Trash2, X, XCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { useAuth } from '../context/AuthContext';
import { WeekNumberDatePicker } from '../components/WeekNumberDatePicker';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];
const FACILITIES = ['AL', 'MI', 'MX'] as const;

interface HoursPerDepartment {
  PM: number;
  MED: number;
  HD: number;
  MFG: number;
  BUILD: number;
  PRG: number;
}

type FormNoticeType = 'success' | 'warning' | 'error';

export function ProjectsPage() {
  const { projects, addProject, deleteProject, updateProject } = useProjectStore();
  const { addAssignment, assignments } = useAssignmentStore();
  const { employees } = useEmployeeStore();
  const { language } = useLanguage();
  const t = useTranslation(language);
  const { hasFullAccess } = useAuth();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Project>>({
    name: '',
    client: '',
    startDate: '',
    facility: 'AL',
  });
  const [numberOfWeeks, setNumberOfWeeks] = useState<number>(4);
  const [hoursPerDept, setHoursPerDept] = useState<HoursPerDepartment>({
    PM: 0,
    MED: 0,
    HD: 0,
    MFG: 0,
    BUILD: 0,
    PRG: 0,
  });
  const [deptStartDates, setDeptStartDates] = useState<Record<Department, string>>({
    PM: '',
    MED: '',
    HD: '',
    MFG: '',
    BUILD: '',
    PRG: '',
  });
  const [deptDurations, setDeptDurations] = useState<Record<Department, number>>({
    PM: 0,
    MED: 0,
    HD: 0,
    MFG: 0,
    BUILD: 0,
    PRG: 0,
  });
  const [deptHoursAllocated, setDeptHoursAllocated] = useState<Record<Department, number>>({
    PM: 0,
    MED: 0,
    HD: 0,
    MFG: 0,
    BUILD: 0,
    PRG: 0,
  });
  const [selectedYear] = useState<number>(2025);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProjectManagerId, setSelectedProjectManagerId] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<{ type: FormNoticeType; message: string } | null>(null);

  useEffect(() => {
    if (!formNotice) return;
    const timeout = setTimeout(() => setFormNotice(null), 4200);
    return () => clearTimeout(timeout);
  }, [formNotice]);

  const calculateEndDate = (startDate: string, weeks: number): string => {
    const start = parseISODate(startDate);
    start.setDate(start.getDate() + weeks * 7);
    return formatToISO(start);
  };

  const getWeekStartsForProject = (startDate: string, weeks: number): string[] => {
    const weekStarts: string[] = [];
    let current = parseISODate(startDate);

    for (let i = 0; i < weeks; i++) {
      weekStarts.push(formatToISO(current));
      current.setDate(current.getDate() + 7);
    }

    return weekStarts;
  };

  /**
   * Calculate the relative week number within a project
   * For example, if project starts on week 10 and department starts on week 15,
   * the relative week is 6 (15 - 10 + 1)
   */
  const calculateRelativeWeek = (deptStartDate: string, projectStartDate: string, year: number): number => {
    const allWeeks = getAllWeeksWithNextYear(year);
    const projectWeekIndex = allWeeks.findIndex((w) => w.date === projectStartDate);
    const deptWeekIndex = allWeeks.findIndex((w) => w.date === deptStartDate);

    if (projectWeekIndex < 0 || deptWeekIndex < 0) return 1;

    // Calculate relative week (1-based)
    return deptWeekIndex - projectWeekIndex + 1;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasFullAccess) return;

    if (!formData.name || !formData.client || !formData.startDate || !formData.facility) {
      setFormNotice({
        type: 'warning',
        message: t.completeAllFields || (language === 'es' ? 'Completa todos los campos obligatorios.' : 'Please complete all required fields.'),
      });
      return;
    }

    const endDate = calculateEndDate(formData.startDate, numberOfWeeks);

    // Build departmentStages from user input
    const calculatedDepartmentStages: Record<Department, DepartmentStageConfig[]> = {
      PM: [],
      MED: [],
      HD: [],
      MFG: [],
      BUILD: [],
      PRG: [],
    };

    DEPARTMENTS.forEach((dept) => {
      if (deptDurations[dept] > 0) {
        const departmentStartDate = deptStartDates[dept] || formData.startDate!;
        // Calculate the relative week within the project (not global year week)
        const weekStart = calculateRelativeWeek(departmentStartDate, formData.startDate!, selectedYear);
        const weekEnd = weekStart + deptDurations[dept] - 1;

        calculatedDepartmentStages[dept] = [{
          stage: null,
          weekStart,
          weekEnd,
          departmentStartDate, // Store the actual start date for this department
          durationWeeks: deptDurations[dept], // Store the duration for this department
        }];
      }
    });

    try {
      if (editingId) {
        console.log('[ProjectsPage] Updating project with budget hours:', deptHoursAllocated);
        await updateProject(editingId, {
          ...formData,
          endDate,
          numberOfWeeks,
          projectManagerId: selectedProjectManagerId || undefined,
          departmentStages: calculatedDepartmentStages,
          departmentHoursAllocated: deptHoursAllocated,
        });
        console.log('[ProjectsPage] ✓ Project updated successfully');
        setEditingId(null);
        setIsFormOpen(false);
        setFormNotice({
          type: 'success',
          message: language === 'es' ? 'Proyecto actualizado exitosamente.' : 'Project updated successfully.',
        });
      } else {
        const newProject: Project = {
          id: generateId(),
          name: formData.name,
        client: formData.client,
        startDate: formData.startDate,
        endDate,
        facility: formData.facility,
        numberOfWeeks,
        projectManagerId: selectedProjectManagerId || undefined,
        departmentStages: calculatedDepartmentStages,
        departmentHoursAllocated: deptHoursAllocated,
      };

      // Wait for project to be created in backend
      const createdProject = await addProject(newProject);
      console.log('[ProjectsPage] ✓ Project created successfully');

      // Crear asignaciones automáticas para cada departamento
      const weekStarts = getWeekStartsForProject(formData.startDate, numberOfWeeks);

      DEPARTMENTS.forEach((dept) => {
        const deptHours = hoursPerDept[dept];
        if (deptHours > 0) {
          const deptEmployees = employees.filter((e) => e.department === dept && e.isActive);
          if (deptEmployees.length > 0) {
            // Distribuir horas entre empleados del departamento
            const hoursPerEmployee = deptHours / deptEmployees.length;

            weekStarts.forEach((week) => {
              deptEmployees.forEach((emp) => {
                // Distribuir horas entre semanas
                const hoursThisWeek = Math.round((hoursPerEmployee / numberOfWeeks) * 100) / 100;
                if (hoursThisWeek > 0) {
                  addAssignment({
                    employeeId: emp.id,
                    projectId: createdProject.id, // Use the ID from backend
                    weekStartDate: week,
                    hours: hoursThisWeek,
                    stage: null,
                  });
                }
              });
            });
          }
        }
      });
      setFormNotice({
        type: 'success',
        message: language === 'es' ? 'Proyecto creado exitosamente.' : 'Project created successfully.',
      });
      }

      // Reset form
      setFormData({ name: '', client: '', startDate: '', facility: 'AL' });
      setNumberOfWeeks(4);
      setHoursPerDept({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 });
      setDeptStartDates({ PM: '', MED: '', HD: '', MFG: '', BUILD: '', PRG: '' });
      setDeptDurations({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 });
      setIsFormOpen(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[ProjectsPage] Error saving project:', errorMsg);
      setFormNotice({
        type: 'error',
        message: `${language === 'es' ? 'Error al guardar proyecto' : 'Error saving project'}: ${errorMsg}`,
      });
    }
  };

  const handleEditProject = (proj: Project) => {
    if (!hasFullAccess) return;
    setFormData(proj);
    setEditingId(proj.id);
    setNumberOfWeeks(proj.numberOfWeeks);

    // Calculate hours per department from assignments
    const projAssignments = assignments.filter((a: any) => a.projectId === proj.id);
    const deptHoursMap: HoursPerDepartment = { PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 };

    projAssignments.forEach((assign: any) => {
      const emp = employees.find((e) => e.id === assign.employeeId);
      if (emp) {
        deptHoursMap[emp.department] += assign.hours;
      }
    });

    setHoursPerDept(deptHoursMap);

    // Populate department dates and durations from departmentStages
    // Initialize with empty strings (no default date)
    const newDeptStartDates: Record<Department, string> = {
      PM: '',
      MED: '',
      HD: '',
      MFG: '',
      BUILD: '',
      PRG: '',
    };
    const newDeptDurations: Record<Department, number> = { PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 };

    if (proj.departmentStages) {
      DEPARTMENTS.forEach((dept) => {
        const stages = proj.departmentStages?.[dept];
        if (stages && stages.length > 0) {
          const firstStage = stages[0];
          // Use the saved departmentStartDate if available, otherwise leave empty
          if (firstStage.departmentStartDate) {
            newDeptStartDates[dept] = firstStage.departmentStartDate;
          }
          // Use the saved durationWeeks if available, otherwise calculate from weekEnd - weekStart
          if (firstStage.durationWeeks) {
            newDeptDurations[dept] = firstStage.durationWeeks;
          } else {
            newDeptDurations[dept] = firstStage.weekEnd - firstStage.weekStart + 1;
          }
        }
      });
    }

    setDeptStartDates(newDeptStartDates);
    setDeptDurations(newDeptDurations);

    // Restore department hours allocated from project data
    if (proj.departmentHoursAllocated) {
      setDeptHoursAllocated(proj.departmentHoursAllocated);
    } else {
      setDeptHoursAllocated({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 });
    }

    // Load Project Manager if exists
    setSelectedProjectManagerId(proj.projectManagerId || null);

    setIsFormOpen(true);
  };

  const handleCancel = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({ name: '', client: '', startDate: '', facility: 'AL' });
    setNumberOfWeeks(4);
    setHoursPerDept({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 });
    setDeptStartDates({ PM: '', MED: '', HD: '', MFG: '', BUILD: '', PRG: '' });
    setDeptDurations({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 });
    setDeptHoursAllocated({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0 });
    setSelectedProjectManagerId(null);
    setFormNotice(null);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateDayFirst = (dateStr: string) => {
    // Parse YYYY-MM-DD format (from date input)
    const [year, month, day] = dateStr.split('-');
    const months = language === 'es'
      ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{t.projects}</h1>
        <button
          onClick={() => {
            if (!hasFullAccess) return;
            setFormNotice(null);
            setIsFormOpen(true);
          }}
          disabled={!hasFullAccess}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
            hasFullAccess ? 'bg-blue-500 hover:bg-blue-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          <Plus size={20} />
          {t.addNewJob}
        </button>
      </div>

      {formNotice && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[90] w-[92vw] max-w-lg">
          <div
            className={`rounded-xl border shadow-xl px-4 py-3 backdrop-blur-sm ${
              formNotice.type === 'success'
                ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50'
                : formNotice.type === 'warning'
                  ? 'border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50'
                  : 'border-rose-300 bg-gradient-to-r from-rose-50 to-red-50'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${
                  formNotice.type === 'success'
                    ? 'bg-emerald-100 text-emerald-700'
                    : formNotice.type === 'warning'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-rose-100 text-rose-700'
                }`}
              >
                {formNotice.type === 'success' && <CheckCircle2 size={16} />}
                {formNotice.type === 'error' && <XCircle size={16} />}
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm font-bold ${
                    formNotice.type === 'success'
                      ? 'text-emerald-900'
                      : formNotice.type === 'warning'
                        ? 'text-amber-900'
                        : 'text-rose-900'
                  }`}
                >
                  {formNotice.type === 'success'
                    ? (language === 'es' ? 'Operación exitosa' : 'Operation successful')
                    : formNotice.type === 'warning'
                      ? (language === 'es' ? 'Faltan datos' : 'Missing data')
                      : (language === 'es' ? 'Ocurrió un error' : 'An error occurred')}
                </p>
                <p
                  className={`text-xs ${
                    formNotice.type === 'success'
                      ? 'text-emerald-800'
                      : formNotice.type === 'warning'
                        ? 'text-amber-800'
                        : 'text-rose-800'
                  }`}
                >
                  {formNotice.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormNotice(null)}
                className={`rounded p-1 ${
                  formNotice.type === 'success'
                    ? 'text-emerald-700 hover:bg-emerald-100'
                    : formNotice.type === 'warning'
                      ? 'text-amber-700 hover:bg-amber-100'
                      : 'text-rose-700 hover:bg-rose-100'
                }`}
                aria-label="Close notice"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formulario */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40 overflow-y-auto">
          <div className="min-h-screen flex items-center justify-center p-4">
            <div className="bg-gradient-to-br from-white via-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl p-4 sm:p-6 shadow-lg w-full max-w-[95vw] sm:max-w-lg md:max-w-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2 h-8 bg-gradient-to-b from-blue-600 to-indigo-600 rounded"></div>
                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  {editingId ? t.editProject : t.createNewProject}
                </h2>
              </div>

              <div className="max-h-[calc(90vh-200px)] overflow-y-auto">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Row 1: Job and Customer */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">📋 {t.job}</label>
                      <input
                        type="text"
                        value={formData.name || ''}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                        placeholder={t.egRefreshDashboard}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">👥 {t.customer}</label>
                      <input
                        type="text"
                        value={formData.client || ''}
                        onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                        placeholder={t.egAcmeCorpDesign}
                      />
                    </div>
                  </div>

                  {/* Row 2: Dates and Weeks */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">📅 {t.startDate}</label>
                      <WeekNumberDatePicker
                        value={formData.startDate || ''}
                        onChange={(date) => setFormData({ ...formData, startDate: date })}
                        language={language}
                        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">⏱️ {t.numberOfWeeks}</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={numberOfWeeks === 0 ? '' : numberOfWeeks}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '' || raw.length > 3) {
                            setNumberOfWeeks(0);
                          } else {
                            const num = parseInt(raw, 10);
                            if (!isNaN(num) && num >= 1 && num <= 999) {
                              setNumberOfWeeks(num);
                            }
                          }
                        }}
                        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">🏭 {t.facility}</label>
                      <select
                        value={formData.facility || 'AL'}
                        onChange={(e) => setFormData({ ...formData, facility: e.target.value as any })}
                        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                      >
                        {FACILITIES.map((fac) => (
                          <option key={fac} value={fac}>
                            {fac}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Project Manager */}
                  <div>
                    <label className="block text-sm font-bold mb-1.5 text-gray-700">👨‍💼 {t.projectManager}</label>
                    <select
                      value={selectedProjectManagerId || ''}
                      onChange={(e) => setSelectedProjectManagerId(e.target.value || null)}
                      className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                    >
                      <option value="">{t.selectProjectManager}</option>
                      {employees
                        .filter((emp) => emp.department === 'PM' && emp.isActive)
                        .map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Budget Hours per Department */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 rounded-lg border-l-4 border-green-600">
                    <h3 className="font-semibold mb-2 text-sm text-green-900">💼 {t.budgetHours}</h3>
                    <p className="text-xs text-green-700 mb-2">{t.defineHours}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                      {DEPARTMENTS.map((dept) => (
                        <div key={dept}>
                          <label className="block text-xs font-medium mb-0.5 text-gray-700">{dept}</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={deptHoursAllocated[dept] === 0 ? '' : (deptHoursAllocated[dept] ?? '')}
                            onChange={(e) => {
                              const val = e.target.value;
                              // Allow empty string while typing, convert to 0 on blur
                              if (val === '') {
                                setDeptHoursAllocated({
                                  ...deptHoursAllocated,
                                  [dept]: val,
                                });
                              } else {
                                const numVal = parseInt(val);
                                if (!isNaN(numVal)) {
                                  setDeptHoursAllocated({
                                    ...deptHoursAllocated,
                                    [dept]: Math.max(0, numVal),
                                  });
                                }
                              }
                            }}
                            onBlur={(e) => {
                              const val = e.target.value;
                              // Convert empty string to 0 when leaving the field
                              if (val === '' || val === undefined) {
                                setDeptHoursAllocated({
                                  ...deptHoursAllocated,
                                  [dept]: 0,
                                });
                              }
                            }}
                            className="w-full border border-green-200 rounded px-2 py-1.5 focus:border-green-400 focus:outline-none text-xs font-semibold"
                            placeholder="0"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Configuration by Department - Compact */}
                  <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-3 rounded-lg border-l-4 border-indigo-600">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm text-indigo-900">📅 {t.configByDepartment}</h3>
                      {formData.startDate && (
                        <span className="text-xs text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-full font-medium">
                          {t.startDate}: {formatDateDayFirst(formData.startDate)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {DEPARTMENTS.filter(dept => dept !== 'PM').map((dept) => {
                        const deptInfo = getDepartmentIcon(dept);
                        return (
                          <div key={dept} className="bg-white p-2.5 rounded-lg border border-indigo-200 flex flex-col gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className={deptInfo.color}>{deptInfo.icon}</span>
                              <span className="font-semibold text-xs text-gray-800">{getDepartmentLabel(dept, t)}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs font-medium mb-0.5 text-gray-600">{t.startDate}</label>
                                <WeekNumberDatePicker
                                  value={deptStartDates[dept]}
                                  onChange={(date) => setDeptStartDates({ ...deptStartDates, [dept]: date })}
                                  language={language}
                                  compact
                                  className="w-full border border-indigo-200 rounded px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium mb-0.5 text-gray-600">{t.duration}</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="52"
                                  value={deptDurations[dept] || ''}
                                  onChange={(e) => setDeptDurations({ ...deptDurations, [dept]: parseInt(e.target.value) || 0 })}
                                  className="w-full border border-indigo-200 rounded px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="bg-blue-50 p-2.5 rounded-lg border border-blue-200 col-span-2 flex items-center gap-2">
                        <span className={`${getDepartmentIcon('PM').color} text-lg`}>{getDepartmentIcon('PM').icon}</span>
                        <div className="flex-1">
                          <span className="font-semibold text-xs text-blue-900">{getDepartmentLabel('PM', t)}</span>
                          <div className="text-xs text-gray-500">{t.usesProjectDates}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Summary - Compact */}
                  {formData.startDate && (
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                      <p className="text-xs text-blue-900">
                        <strong>{t.summary}:</strong> {formatDate(formData.startDate)} • {numberOfWeeks} {t.weeks} • {formatDate(calculateEndDate(formData.startDate, numberOfWeeks))}
                      </p>
                    </div>
                  )}
                </form>
              </div>

              <div className="flex gap-3 mt-4 pt-4 border-t-2 border-blue-200 sticky bottom-0 bg-gradient-to-br from-white via-blue-50 to-indigo-50">
                <button
                  onClick={handleSubmit}
                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold px-6 py-2.5 rounded-lg transition shadow-md hover:shadow-lg transform hover:scale-105 text-sm"
                >
                  ✓ {editingId ? t.updateProject : t.createProject}
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 bg-gradient-to-r from-gray-400 to-gray-500 hover:from-gray-500 hover:to-gray-600 text-white font-bold px-6 py-2.5 rounded-lg transition shadow-md hover:shadow-lg text-sm"
                >
                  ✕ {t.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Projects table */}
      <div className="overflow-x-auto border-2 border-gray-300 rounded-lg shadow-lg bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <th className="border border-blue-500 px-4 py-3 text-left font-bold uppercase text-sm">📋 {t.job}</th>
              <th className="border border-blue-500 px-4 py-3 text-left font-bold uppercase text-sm">👥 {t.customer}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">🏭 {t.facility}</th>
              <th className="border border-blue-500 px-4 py-3 text-left font-bold uppercase text-sm">👨‍💼 {t.projectManager}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">📅 {t.start}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">⏱️ {t.weeksLabel}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">⚙️ {t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((proj, idx) => (
              <tr key={proj.id} className={`transition hover:shadow-md ${idx % 2 === 0 ? 'bg-white' : 'bg-blue-50'}`}>
                <td className="border border-gray-200 px-4 py-3 font-semibold text-gray-900">{proj.name}</td>
                <td className="border border-gray-200 px-4 py-3 text-gray-700">{proj.client}</td>
                <td className="border border-gray-200 px-4 py-3 text-center">
                  <span className="inline-block bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-800 px-3 py-1 rounded-full text-sm font-bold shadow-sm">
                    {proj.facility}
                  </span>
                </td>
                <td className="border border-gray-200 px-4 py-3 text-left">
                  {proj.projectManagerId ? (
                    <span className="inline-block bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 px-3 py-1 rounded-full text-sm font-semibold shadow-sm">
                      {employees.find((e) => e.id === proj.projectManagerId)?.name || t.noProjectManager}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm italic">{t.noProjectManager}</span>
                  )}
                </td>
                <td className="border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700">
                  {formatDate(proj.startDate)}
                </td>
                <td className="border border-gray-200 px-4 py-3 text-center">
                  <span className="inline-block bg-gradient-to-r from-green-100 to-emerald-100 text-green-800 px-3 py-1 rounded-full text-sm font-bold shadow-sm">
                    {proj.numberOfWeeks} {t.weeks}
                  </span>
                </td>
                <td className="border border-gray-200 px-4 py-3 text-center">
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => hasFullAccess && handleEditProject(proj)}
                        disabled={!hasFullAccess}
                        className={`p-2 rounded-lg transition transform shadow-sm ${
                          hasFullAccess
                            ? 'text-blue-600 bg-blue-100 hover:bg-blue-200 hover:scale-110'
                            : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                        }`}
                        title={t.edit}
                      >
                        ✎
                      </button>
                      <button
                        onClick={async () => {
                          if (!hasFullAccess) return;
                          if (window.confirm(language === 'es' ? `¿Eliminar proyecto "${proj.name}"?` : `Delete project "${proj.name}"?`)) {
                            try {
                              await deleteProject(proj.id);
                            } catch (error) {
                              console.error('Error deleting project:', error);
                            }
                          }
                        }}
                        disabled={!hasFullAccess}
                        className={`p-2 rounded-lg transition transform shadow-sm ${
                          hasFullAccess
                            ? 'text-red-600 bg-red-100 hover:bg-red-200 hover:scale-110'
                            : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                        }`}
                        title={t.delete}
                      >
                        <Trash2 size={18} />
                      </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {projects.length === 0 && !isFormOpen && (
        <div className="text-center py-12 text-gray-500">
          <p>{t.noProjects}</p>
        </div>
      )}
    </div>
  );
}
