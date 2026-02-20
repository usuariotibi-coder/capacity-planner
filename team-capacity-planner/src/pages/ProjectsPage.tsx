import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useEmployeeStore } from '../stores/employeeStore';
import type { Project, Department, DepartmentStageConfig, ProjectVisibilityScope } from '../types';
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
const GENERAL_VISIBILITY_SCOPE = 'GENERAL' as const;
const DEPARTMENT_SET = new Set<Department>(DEPARTMENTS);

const getDepartmentScopesFromVisibility = (scopes?: ProjectVisibilityScope[]): Department[] => {
  const rawScopes = scopes || [];
  return rawScopes
    .map((scope) => (typeof scope === 'string' ? scope.trim().toUpperCase() : ''))
    .filter((scope): scope is Department => DEPARTMENT_SET.has(scope as Department));
};

const shouldProjectShowInGeneral = (scopes?: ProjectVisibilityScope[]): boolean => {
  const rawScopes = scopes || [];
  if (rawScopes.length === 0) return true;
  return rawScopes.some(
    (scope) =>
      typeof scope === 'string' &&
      scope.trim().toUpperCase() === GENERAL_VISIBILITY_SCOPE
  );
};

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
  const [showInGeneral, setShowInGeneral] = useState<boolean>(true);
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

  const buildVisibilityScopesForSubmit = (
    existingScopes?: ProjectVisibilityScope[],
    configuredDepartments: Department[] = []
  ): ProjectVisibilityScope[] => {
    const existingDepartmentScopes = getDepartmentScopesFromVisibility(existingScopes);
    const mergedDepartmentScopeSet = new Set<Department>([
      ...existingDepartmentScopes,
      ...configuredDepartments,
    ]);
    const mergedDepartmentScopes = DEPARTMENTS.filter((dept) => mergedDepartmentScopeSet.has(dept));
    const hasDepartmentScopes = mergedDepartmentScopes.length > 0;

    // Keep existing scoped departments. If none exist and General is disabled,
    // fallback to all departments so the project is still visible in department views.
    const nextDepartmentScopes: Department[] = hasDepartmentScopes
      ? mergedDepartmentScopes
      : (showInGeneral ? [] : [...DEPARTMENTS]);

    if (!showInGeneral) {
      return nextDepartmentScopes;
    }

    if (nextDepartmentScopes.length === 0) {
      // Legacy/global behavior: empty list means visible in all departments and General view.
      return [];
    }

    return [...nextDepartmentScopes, GENERAL_VISIBILITY_SCOPE];
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

    const configuredDepartments = DEPARTMENTS.filter((dept) => {
      const hasStageConfig = (calculatedDepartmentStages[dept] || []).length > 0;
      const hasBudgetConfig = Number(deptHoursAllocated[dept] || 0) > 0;
      return hasStageConfig || hasBudgetConfig;
    });
    const visibilityScopesForSubmit = buildVisibilityScopesForSubmit(
      formData.visibleInDepartments,
      configuredDepartments
    );

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
          visibleInDepartments: visibilityScopesForSubmit,
        });
        console.log('[ProjectsPage] Project updated successfully');
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
        visibleInDepartments: visibilityScopesForSubmit,
      };

      // Wait for project to be created in backend
      const createdProject = await addProject(newProject);
      console.log('[ProjectsPage] Project created successfully');

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
      setShowInGeneral(true);
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
    setShowInGeneral(shouldProjectShowInGeneral(proj.visibleInDepartments));

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
    setShowInGeneral(true);
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
    <div className="brand-page-shell projects-page h-full min-h-0 flex flex-col overflow-hidden">
      <div className="brand-page-header rounded-xl px-4 py-3 flex justify-between items-center mx-6 mt-6 mb-4">
        <h1 className="brand-title text-3xl font-bold">{t.projects}</h1>
        <button
          onClick={() => {
            if (!hasFullAccess) return;
            setFormNotice(null);
            setShowInGeneral(true);
            setIsFormOpen(true);
          }}
          disabled={!hasFullAccess}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
            hasFullAccess ? 'brand-btn-primary text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
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
            <div className="bg-gradient-to-br from-white via-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl p-3 sm:p-4 lg:p-5 shadow-lg w-full max-w-[96vw] lg:max-w-5xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2 h-8 bg-gradient-to-b from-blue-600 to-indigo-600 rounded"></div>
                <h2 className="brand-title text-2xl font-bold">
                  {editingId ? t.editProject : t.createNewProject}
                </h2>
              </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* Row 1: Job and Customer */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.job}</label>
                      <input
                        type="text"
                        value={formData.name || ''}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                        placeholder={t.egRefreshDashboard}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.customer}</label>
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
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.startDate}</label>
                      <WeekNumberDatePicker
                        value={formData.startDate || ''}
                        onChange={(date) => setFormData({ ...formData, startDate: date })}
                        language={language}
                        className="w-full border-2 border-blue-200 rounded-lg px-3 py-2.5 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.numberOfWeeks}</label>
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
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.facility}</label>
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

                  {/* Row 3: Project Manager + General visibility */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.projectManager}</label>
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
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-indigo-900">
                          {language === 'es' ? 'Mostrar en pantalla general' : 'Show in General view'}
                        </p>
                        <p className="text-xs text-indigo-700">
                          {language === 'es'
                            ? 'Si está activo, este proyecto también aparece en la vista General.'
                            : 'When enabled, this project also appears in the General screen.'}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={showInGeneral}
                        onChange={(e) => setShowInGeneral(e.target.checked)}
                        className="h-5 w-5 accent-indigo-600 cursor-pointer"
                        aria-label={language === 'es' ? 'Mostrar en pantalla general' : 'Show in General view'}
                      />
                    </div>
                  </div>

                  {/* Budget Hours per Department */}
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 rounded-lg border-l-4 border-green-600">
                    <h3 className="font-semibold mb-2 text-sm text-green-900">{t.budgetHours}</h3>
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
                      <h3 className="font-semibold text-sm text-indigo-900">{t.configByDepartment}</h3>
                      {formData.startDate && (
                        <span className="text-xs text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-full font-medium">
                          {t.startDate}: {formatDateDayFirst(formData.startDate)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
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
                      <div className="bg-blue-50 p-2.5 rounded-lg border border-blue-200 md:col-span-2 lg:col-span-3 flex items-center gap-2">
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

              <div className="flex gap-3 mt-4 pt-4 border-t-2 border-blue-200 sticky bottom-0 bg-gradient-to-br from-white via-blue-50 to-indigo-50">
                <button
                  onClick={handleSubmit}
                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold px-6 py-2.5 rounded-lg transition shadow-md hover:shadow-lg transform hover:scale-105 text-sm"
                >
                  {editingId ? t.updateProject : t.createProject}
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 bg-gradient-to-r from-gray-400 to-gray-500 hover:from-gray-500 hover:to-gray-600 text-white font-bold px-6 py-2.5 rounded-lg transition shadow-md hover:shadow-lg text-sm"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
      {/* Projects table */}
      <div className="brand-panel projects-table-shell overflow-x-auto border-2 border-[#d5d1da] rounded-lg bg-white">
        <table className="brand-table w-full border-collapse">
          <thead>
            <tr>
              <th className="border border-blue-500 px-4 py-3 text-left font-bold uppercase text-sm">{t.job}</th>
              <th className="border border-blue-500 px-4 py-3 text-left font-bold uppercase text-sm">{t.customer}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">{t.facility}</th>
              <th className="border border-blue-500 px-4 py-3 text-left font-bold uppercase text-sm">{t.projectManager}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">{t.start}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">{t.weeksLabel}</th>
              <th className="border border-blue-500 px-4 py-3 text-center font-bold uppercase text-sm">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((proj, idx) => (
              <tr key={proj.id} className={`projects-row transition hover:shadow-md ${idx % 2 === 0 ? 'bg-white projects-row-even' : 'bg-[#f4f1f8] projects-row-odd'}`}>
                <td className="projects-cell-main border px-4 py-3 font-semibold text-[#2e1a47]">{proj.name}</td>
                <td className="projects-cell-muted border px-4 py-3 text-[#4f3a70]">{proj.client}</td>
                <td className="border px-4 py-3 text-center">
                  <span className="projects-chip inline-block bg-[#ece6f5] text-[#2e1a47] border border-[#d5d1da] px-3 py-1 rounded-full text-sm font-bold shadow-sm">
                    {proj.facility}
                  </span>
                </td>
                <td className="border px-4 py-3 text-left">
                  {proj.projectManagerId ? (
                    <span className="projects-chip projects-chip-muted inline-block bg-[#f1edf6] text-[#4f3a70] border border-[#d5d1da] px-3 py-1 rounded-full text-sm font-semibold shadow-sm">
                      {employees.find((e) => e.id === proj.projectManagerId)?.name || t.noProjectManager}
                    </span>
                  ) : (
                    <span className="projects-empty-pm text-[#8a8298] text-sm italic">{t.noProjectManager}</span>
                  )}
                </td>
                <td className="projects-cell-muted border px-4 py-3 text-center text-sm font-medium text-[#4f3a70]">
                  {formatDate(proj.startDate)}
                </td>
                <td className="border px-4 py-3 text-center">
                  <span className="projects-chip inline-block bg-[#ece6f5] text-[#2e1a47] border border-[#d5d1da] px-3 py-1 rounded-full text-sm font-bold shadow-sm">
                    {proj.numberOfWeeks} {t.weeks}
                  </span>
                </td>
                <td className="border px-4 py-3 text-center">
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => hasFullAccess && handleEditProject(proj)}
                        disabled={!hasFullAccess}
                        className={`project-action-btn project-action-edit p-2 rounded-lg transition transform shadow-sm ${
                          hasFullAccess
                            ? 'text-[#2e1a47] bg-[#ece6f5] hover:bg-[#ddd5ea] border border-[#d5d1da] hover:scale-110'
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
                        className={`project-action-btn project-action-delete p-2 rounded-lg transition transform shadow-sm ${
                          hasFullAccess
                            ? 'text-[#ce0037] bg-[#fce7ee] hover:bg-[#f7d6e2] border border-[#f1c3d2] hover:scale-110'
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
        <div className="projects-empty-state text-center py-12 text-[#6c6480]">
          <p>{t.noProjects}</p>
        </div>
      )}
    </div>
    </div>
  );
}

