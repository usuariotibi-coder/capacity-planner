import { useEffect, useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useMemo } from 'react';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useEmployeeStore } from '../stores/employeeStore';
import type { Project, Department, DepartmentStageConfig, ProjectChangeOrder, ProjectVisibilityScope, Stage, TimingParseResult, TimingParseDateRange } from '../types';
import { generateId } from '../utils/id';
import { getDepartmentIcon, getDepartmentLabel } from '../utils/departmentIcons';
import { getAllWeeksWithNextYear, formatToISO, parseISODate } from '../utils/dateUtils';
import { CheckCircle2, ClipboardList, GitBranch, Plus, Trash2, Upload, X, XCircle } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { useAuth } from '../context/AuthContext';
import { WeekNumberDatePicker } from '../components/WeekNumberDatePicker';
import { changeOrdersApi, projectsApi } from '../services/api';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'PURCHASING'];
const FACILITIES = ['AL', 'MI', 'MX'] as const;
const GENERAL_VISIBILITY_SCOPE = 'GENERAL' as const;
const DEPARTMENT_SET = new Set<Department>(DEPARTMENTS);

// A department's weeks are normally configured as a single Start Date + Duration.
// BUILD and PRG are split into named sub-phases instead -- each gets its own Start
// Date + Duration, purely so the project's weeks can be dated per sub-phase. This
// has no effect on department-level budget hours, which stay a single value per
// department (Qtd/Usado/Fcst flow is untouched).
const DEFAULT_PHASE = '__default__';
interface SubphaseDef {
  key: string; // Stage value sent to the backend, or DEFAULT_PHASE for an unsplit department
  label: string; // Shown above the fields when a department has more than one sub-phase
}
const DEPARTMENT_SUBPHASES: Partial<Record<Department, SubphaseDef[]>> = {
  BUILD: [
    { key: 'ASSEMBLY', label: 'Assembly' },
    { key: 'COMMISSIONING', label: 'Commissioning' },
  ],
  PRG: [
    { key: 'OFFLINE', label: 'Offline' },
    { key: 'ONLINE', label: 'Online' },
    { key: 'DEBUG', label: 'Debug' },
  ],
};
const getSubphasesForDept = (dept: Department): SubphaseDef[] =>
  DEPARTMENT_SUBPHASES[dept] || [{ key: DEFAULT_PHASE, label: '' }];
const emptyDeptPhaseDates = (): Record<Department, Record<string, string>> => ({
  PM: {}, MED: {}, HD: {}, MFG: {}, BUILD: {}, PRG: {}, PURCHASING: {},
});
const emptyDeptPhaseDurations = (): Record<Department, Record<string, number>> => ({
  PM: {}, MED: {}, HD: {}, MFG: {}, BUILD: {}, PRG: {}, PURCHASING: {},
});

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
  PURCHASING: number;
}

type FormNoticeType = 'success' | 'warning' | 'error';

export function ProjectsPage() {
  const { projects, addProject, deleteProject, updateProject, fetchProjects } = useProjectStore();
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
    isHighProbability: false,
  });
  const [numberOfWeeks, setNumberOfWeeks] = useState<number>(4);
  const [hoursPerDept, setHoursPerDept] = useState<HoursPerDepartment>({
    PM: 0,
    MED: 0,
    HD: 0,
    MFG: 0,
    BUILD: 0,
    PRG: 0,
    PURCHASING: 0,
  });
  // Keyed by department, then by sub-phase key (DEFAULT_PHASE for unsplit departments).
  const [deptStartDates, setDeptStartDates] = useState<Record<Department, Record<string, string>>>(emptyDeptPhaseDates());
  const [deptDurations, setDeptDurations] = useState<Record<Department, Record<string, number>>>(emptyDeptPhaseDurations());
  const [deptHoursAllocated, setDeptHoursAllocated] = useState<Record<Department, number>>({
    PM: 0,
    MED: 0,
    HD: 0,
    MFG: 0,
    BUILD: 0,
    PRG: 0,
    PURCHASING: 0,
  });
  // Quoted amount ($) per department, kept as the raw text typed so decimals like "1234." survive re-render.
  const [deptCostAllocated, setDeptCostAllocated] = useState<Partial<Record<Department, string>>>({});
  const [selectedYear] = useState<number>(() => new Date().getFullYear());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedProjectManagerId, setSelectedProjectManagerId] = useState<string | null>(null);
  const [showInGeneral, setShowInGeneral] = useState<boolean>(true);
  const [formNotice, setFormNotice] = useState<{ type: FormNoticeType; message: string } | null>(null);
  const [isParsingTiming, setIsParsingTiming] = useState(false);
  const [timingUploadWarnings, setTimingUploadWarnings] = useState<string[]>([]);
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  // Set while the create/edit form is open specifically to register a Change Order as its own
  // full project ("Método 2") -- included in the create payload as parentProjectId so it links
  // back. null for every other use of the same form (plain create/edit).
  const [parentProjectIdForNewProject, setParentProjectIdForNewProject] = useState<string | null>(null);

  // Change Orders: registered two ways from the "CO" row action -- (1) widen an existing
  // project's budget (ProjectChangeOrder rows, handled here) or (2) register as a brand-new
  // project linked via parentProjectId (reuses the create-project form above).
  const [changeOrders, setChangeOrders] = useState<ProjectChangeOrder[]>([]);
  const [coChooserProjectId, setCoChooserProjectId] = useState<string | null>(null);
  const [coExpandProjectId, setCoExpandProjectId] = useState<string | null>(null);
  const [coName, setCoName] = useState('');
  const [coHoursByDept, setCoHoursByDept] = useState<Partial<Record<Department, string>>>({});
  const [coCostByDept, setCoCostByDept] = useState<Partial<Record<Department, string>>>({});
  const [coEditingName, setCoEditingName] = useState<string | null>(null);
  const [isSavingCo, setIsSavingCo] = useState(false);
  // Set while the create-project form is pre-filled to "promote" a merged CO (Método 1)
  // into its own project (Método 2) -- see openPromoteChangeOrder/handleSubmit.
  const [promotingChangeOrder, setPromotingChangeOrder] = useState<{ sourceProjectId: string; name: string } | null>(null);
  const [isMergingProjectId, setIsMergingProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!formNotice) return;
    const timeout = setTimeout(() => setFormNotice(null), 4200);
    return () => clearTimeout(timeout);
  }, [formNotice]);

  const normalizeChangeOrders = (data: any[]): ProjectChangeOrder[] =>
    (Array.isArray(data) ? data : [])
      .map((row: any): ProjectChangeOrder | null => {
        const projectId = row?.projectId || row?.project?.id;
        if (!row?.id || !projectId || !row?.department) return null;
        return {
          id: row.id,
          projectId,
          department: row.department,
          name: row.name || '',
          hoursQuoted: Number(row.hoursQuoted ?? 0),
          costQuoted: row.costQuoted !== null && row.costQuoted !== undefined ? Number(row.costQuoted) : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
      .filter((row): row is ProjectChangeOrder => Boolean(row));

  const reloadChangeOrders = async () => {
    const data = await changeOrdersApi.getAll();
    setChangeOrders(normalizeChangeOrders(data));
  };

  useEffect(() => {
    let cancelled = false;
    changeOrdersApi.getAll()
      .then((data: any[]) => {
        if (cancelled) return;
        setChangeOrders(normalizeChangeOrders(data));
      })
      .catch((error) => console.error('[ProjectsPage] Error loading Change Orders:', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const changeOrdersForProject = (projectId: string) => changeOrders.filter((co) => co.projectId === projectId);

  // One row per distinct CO name for a project, with its hours/$ summed across whichever
  // departments it touches -- what the "existing COs" list in the expand modal shows.
  const changeOrderNamesForProject = (projectId: string) => {
    const byName = new Map<string, { totalHours: number; totalCost: number }>();
    changeOrdersForProject(projectId).forEach((co) => {
      const entry = byName.get(co.name) || { totalHours: 0, totalCost: 0 };
      entry.totalHours += co.hoursQuoted || 0;
      entry.totalCost += co.costQuoted || 0;
      byName.set(co.name, entry);
    });
    return Array.from(byName.entries()).map(([name, totals]) => ({ name, ...totals }));
  };

  // A Change Order name can only be registered once across a project's whole family --
  // merged into a budget (Método 1) or as its own project (Método 2), never both, never
  // twice. These mirror the backend's authoritative check (see views.py
  // _resolve_co_family_root/_used_co_names_in_family) for upfront client-side validation.
  const coSuffixFromNumber = (candidate: string | undefined, parent: Project): string | null => {
    const base = (parent.projectNumber || parent.name || '').trim();
    const value = (candidate || '').trim();
    if (!base || !value) return null;
    const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(CO\\d+)$`, 'i');
    const match = pattern.exec(value);
    return match ? match[1].toUpperCase() : null;
  };

  const resolveCoFamilyRoot = (project: Project): Project => {
    let current = project;
    const seenIds = new Set<string>();
    while (current.parentProjectId && !seenIds.has(current.id)) {
      seenIds.add(current.id);
      const parent = projects.find((p) => p.id === current.parentProjectId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };

  type CoNameClaim = { kind: 'merged' | 'project'; projectId: string };

  const usedCoNamesForProject = (project: Project): Map<string, CoNameClaim> => {
    const root = resolveCoFamilyRoot(project);
    const members = [root];
    const seenIds = new Set([root.id]);
    let frontier = [root];
    for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
      const nextFrontier: Project[] = [];
      frontier.forEach((member) => {
        projects.forEach((p) => {
          if (p.parentProjectId === member.id && !seenIds.has(p.id)) {
            seenIds.add(p.id);
            members.push(p);
            nextFrontier.push(p);
          }
        });
      });
      frontier = nextFrontier;
    }

    const used = new Map<string, CoNameClaim>();
    changeOrders
      .filter((co) => seenIds.has(co.projectId))
      .forEach((co) => {
        const key = co.name.trim().toUpperCase();
        if (key && !used.has(key)) used.set(key, { kind: 'merged', projectId: co.projectId });
      });
    members.forEach((member) => {
      if (member.id === root.id || !member.parentProjectId) return;
      const parent = projects.find((p) => p.id === member.parentProjectId);
      if (!parent) return;
      const suffix = coSuffixFromNumber(member.projectNumber || member.name, parent);
      if (suffix && !used.has(suffix)) used.set(suffix, { kind: 'project', projectId: member.id });
    });
    return used;
  };

  const describeCoNameClaim = (claim: CoNameClaim): string =>
    claim.kind === 'merged'
      ? (language === 'es' ? 'fusionado en el presupuesto de otro proyecto' : 'merged into another project\'s budget')
      : (language === 'es' ? 'registrado como proyecto independiente' : 'registered as its own project');

  const filteredProjects = useMemo(() => {
    const normalizedSearch = projectSearchTerm.trim().toLowerCase();
    if (!normalizedSearch) return projects;

    return projects.filter((proj) => {
      const projectManagerName = proj.projectManagerId
        ? (employees.find((e) => e.id === proj.projectManagerId)?.name || '')
        : '';

      return [
        proj.name,
        proj.client,
        proj.facility,
        projectManagerName,
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [employees, projectSearchTerm, projects]);

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

  // Parses an uploaded Timing .xlsx schedule file and pre-fills the department
  // start date/duration fields below (plus the project's own start date/weeks
  // when the file carries them) -- nothing is saved yet, the form itself is
  // the editable preview. Works the same way whether creating a new project
  // or re-uploading a revised Timing file for an existing one: only the
  // "current" dates get overwritten here, since original_start_date/
  // original_duration_weeks are frozen server-side the first time they're set.
  const handleTimingFileUpload = async (file: File) => {
    setIsParsingTiming(true);
    try {
      const result: TimingParseResult = await projectsApi.parseTimingFile(file);

      if (result.projectStartDate) {
        setFormData((prev) => ({ ...prev, startDate: result.projectStartDate! }));
      }
      if (result.numberOfWeeks) {
        setNumberOfWeeks(result.numberOfWeeks);
      }

      const nextStartDates: Record<Department, Record<string, string>> = { ...deptStartDates };
      const nextDurations: Record<Department, Record<string, number>> = { ...deptDurations };

      const applyRange = (dept: Department, key: string, range?: TimingParseDateRange) => {
        if (!range || !range.start || !range.end) return;
        const start = parseISODate(range.start);
        const end = parseISODate(range.end);
        const weeks = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1);
        nextStartDates[dept] = { ...nextStartDates[dept], [key]: range.start };
        nextDurations[dept] = { ...nextDurations[dept], [key]: weeks };
      };

      const dep = result.departments || {};
      applyRange('MED', DEFAULT_PHASE, dep.MED);
      applyRange('HD', DEFAULT_PHASE, dep.HD);
      applyRange('MFG', DEFAULT_PHASE, dep.MFG);
      applyRange('PURCHASING', DEFAULT_PHASE, dep.PURCHASING);
      if (dep.BUILD) {
        applyRange('BUILD', 'ASSEMBLY', dep.BUILD.ASSEMBLY);
        applyRange('BUILD', 'COMMISSIONING', dep.BUILD.COMMISSIONING);
      }
      if (dep.PRG) {
        applyRange('PRG', 'OFFLINE', dep.PRG.OFFLINE);
        applyRange('PRG', 'ONLINE', dep.PRG.ONLINE);
        applyRange('PRG', 'DEBUG', dep.PRG.DEBUG);
      }

      setDeptStartDates(nextStartDates);
      setDeptDurations(nextDurations);
      setTimingUploadWarnings(result.warnings || []);
      setFormNotice({
        type: 'success',
        message: language === 'es'
          ? 'Fechas detectadas del archivo Timing. Revisa y ajusta antes de guardar.'
          : 'Dates detected from the Timing file. Review and adjust before saving.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFormNotice({
        type: 'error',
        message: language === 'es'
          ? `No se pudo leer el archivo Timing: ${message}`
          : `Could not read the Timing file: ${message}`,
      });
    } finally {
      setIsParsingTiming(false);
    }
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

    // Registering this project as a new Change Order (not promoting an existing merged
    // one) -- block it if its number already claims a CO slot taken elsewhere in the family.
    if (parentProjectIdForNewProject && !promotingChangeOrder) {
      const parent = projects.find((p) => p.id === parentProjectIdForNewProject);
      const suffix = parent ? coSuffixFromNumber(formData.name, parent) : null;
      const claim = parent && suffix ? usedCoNamesForProject(parent).get(suffix) : undefined;
      if (claim) {
        setFormNotice({
          type: 'warning',
          message: language === 'es'
            ? `El Change Order '${suffix}' ya está registrado (${describeCoNameClaim(claim)}). Solo se puede editar, no volver a registrar.`
            : `Change Order '${suffix}' is already registered (${describeCoNameClaim(claim)}). It can only be edited, not registered again.`,
        });
        return;
      }
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
      PURCHASING: [],
    };

    const editingProject = editingId ? projects.find((p) => p.id === editingId) : undefined;

    DEPARTMENTS.forEach((dept) => {
      const entries: DepartmentStageConfig[] = [];

      getSubphasesForDept(dept).forEach(({ key }) => {
        const duration = deptDurations[dept]?.[key] || 0;
        if (duration <= 0) return;

        const departmentStartDate = deptStartDates[dept]?.[key] || formData.startDate!;
        const stageValue = (key === DEFAULT_PHASE ? null : key) as Stage;

        // Preserve the originally saved relative start week when editing.
        // This keeps a stable baseline so CapacityMatrix can show "date shift"
        // as original vs current start date.
        const existingDeptStage = editingProject?.departmentStages?.[dept]?.find(
          (entry) => (entry.stage || null) === stageValue
        );
        const existingWeekStart = Number(existingDeptStage?.weekStart);
        const hasExistingWeekStart = Number.isFinite(existingWeekStart) && existingWeekStart > 0;

        const weekStart = hasExistingWeekStart
          ? existingWeekStart
          : calculateRelativeWeek(departmentStartDate, formData.startDate!, selectedYear);
        const weekEnd = weekStart + duration - 1;

        entries.push({
          stage: stageValue,
          weekStart,
          weekEnd,
          departmentStartDate, // Store the actual start date for this sub-phase
          durationWeeks: duration, // Store the duration for this sub-phase
        });
      });

      calculatedDepartmentStages[dept] = entries;
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

    // Empty text clears the registered amount; otherwise send the number.
    const departmentCostPayload: Partial<Record<Department, number | null>> = {};
    DEPARTMENTS.forEach((dept) => {
      const raw = (deptCostAllocated[dept] ?? '').trim();
      const parsed = raw === '' ? null : Number(raw);
      departmentCostPayload[dept] = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    });

    try {
      if (editingId) {
        console.log('[ProjectsPage] Updating project with budget hours:', deptHoursAllocated);
        await updateProject(editingId, {
          ...formData,
          // The "Project" field doubles as the Finance job number (see its "Ej: 3018"
          // placeholder) -- mirrored into projectNumber so the Finance import can match
          // this project by that code instead of silently creating an orphan duplicate.
          projectNumber: formData.name,
          endDate,
          numberOfWeeks,
          projectManagerId: selectedProjectManagerId || undefined,
          departmentStages: calculatedDepartmentStages,
          departmentHoursAllocated: deptHoursAllocated,
          departmentCostAllocated: departmentCostPayload,
          visibleInDepartments: visibilityScopesForSubmit,
        });
        console.log('[ProjectsPage] Project updated successfully');
        setEditingId(null);
        setIsFormOpen(false);
        setFormNotice({
          type: 'success',
          message: language === 'es' ? 'Proyecto actualizado exitosamente.' : 'Project updated successfully.',
        });
      } else if (promotingChangeOrder) {
        await projectsApi.promoteChangeOrder(promotingChangeOrder.sourceProjectId, promotingChangeOrder.name, {
          name: formData.name,
          projectNumber: formData.name,
          client: formData.client,
          startDate: formData.startDate,
          endDate,
          facility: formData.facility,
          numberOfWeeks,
          projectManagerId: selectedProjectManagerId || undefined,
          parentProjectId: parentProjectIdForNewProject || undefined,
          isHighProbability: !!formData.isHighProbability,
          departmentStages: calculatedDepartmentStages,
          departmentHoursAllocated: deptHoursAllocated,
          departmentCostAllocated: departmentCostPayload,
          visibleInDepartments: visibilityScopesForSubmit,
        });
        await fetchProjects(true);
        await reloadChangeOrders();
        setPromotingChangeOrder(null);
        setFormNotice({
          type: 'success',
          message: language === 'es' ? 'Change Order convertido en proyecto independiente.' : 'Change Order converted into its own project.',
        });
      } else {
        const newProject: Project = {
          id: generateId(),
          name: formData.name,
          // See the update branch above for why this mirrors the "Project" field.
          projectNumber: formData.name,
        client: formData.client,
        startDate: formData.startDate,
        endDate,
        facility: formData.facility,
        numberOfWeeks,
        projectManagerId: selectedProjectManagerId || undefined,
        parentProjectId: parentProjectIdForNewProject || undefined,
        isHighProbability: !!formData.isHighProbability,
        departmentStages: calculatedDepartmentStages,
        departmentHoursAllocated: deptHoursAllocated,
        departmentCostAllocated: departmentCostPayload,
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
      setHoursPerDept({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 });
      setDeptStartDates(emptyDeptPhaseDates());
      setDeptDurations(emptyDeptPhaseDurations());
      setTimingUploadWarnings([]);
      setDeptCostAllocated({});
      setShowInGeneral(true);
      setIsFormOpen(false);
      setParentProjectIdForNewProject(null);
      setPromotingChangeOrder(null);
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
    setParentProjectIdForNewProject(null);
    setPromotingChangeOrder(null);
    setFormData(proj);
    setEditingId(proj.id);
    setNumberOfWeeks(proj.numberOfWeeks);
    setTimingUploadWarnings([]);

    // Calculate hours per department from assignments
    const projAssignments = assignments.filter((a: any) => a.projectId === proj.id);
    const deptHoursMap: HoursPerDepartment = { PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 };

    projAssignments.forEach((assign: any) => {
      const emp = employees.find((e) => e.id === assign.employeeId);
      if (emp) {
        deptHoursMap[emp.department] += assign.hours;
      }
    });

    setHoursPerDept(deptHoursMap);

    // Populate department dates and durations from departmentStages, one slot per
    // sub-phase (DEFAULT_PHASE for a department that isn't split into sub-phases).
    const newDeptStartDates = emptyDeptPhaseDates();
    const newDeptDurations = emptyDeptPhaseDurations();

    if (proj.departmentStages) {
      DEPARTMENTS.forEach((dept) => {
        const stages = proj.departmentStages?.[dept];
        if (!stages || stages.length === 0) return;

        getSubphasesForDept(dept).forEach(({ key }, index) => {
          const stageValue = key === DEFAULT_PHASE ? null : key;
          let match = stages.find((entry) => (entry.stage || null) === stageValue);
          if (!match && index === 0 && stageValue !== null) {
            // Backward-compat: a project saved before this department had named
            // sub-phases has a single stage=null row -- surface it in the first slot.
            match = stages.find((entry) => !entry.stage);
          }
          if (!match) return;

          // Use the saved departmentStartDate if available, otherwise leave empty
          if (match.departmentStartDate) {
            newDeptStartDates[dept][key] = match.departmentStartDate;
          }
          // Use the saved durationWeeks if available, otherwise calculate from weekEnd - weekStart
          newDeptDurations[dept][key] = match.durationWeeks || (match.weekEnd - match.weekStart + 1);
        });
      });
    }

    setDeptStartDates(newDeptStartDates);
    setDeptDurations(newDeptDurations);

    // Restore department hours allocated from project data
    if (proj.departmentHoursAllocated) {
      setDeptHoursAllocated(proj.departmentHoursAllocated);
    } else {
      setDeptHoursAllocated({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 });
    }

    const nextCosts: Partial<Record<Department, string>> = {};
    DEPARTMENTS.forEach((dept) => {
      const cost = proj.departmentCostAllocated?.[dept];
      if (cost !== undefined && cost !== null) nextCosts[dept] = String(cost);
    });
    setDeptCostAllocated(nextCosts);

    // Load Project Manager if exists
    setSelectedProjectManagerId(proj.projectManagerId || null);
    setShowInGeneral(shouldProjectShowInGeneral(proj.visibleInDepartments));

    setIsFormOpen(true);
  };

  const handleCancel = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({ name: '', client: '', startDate: '', facility: 'AL', isHighProbability: false });
    setNumberOfWeeks(4);
    setHoursPerDept({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 });
    setDeptStartDates(emptyDeptPhaseDates());
    setDeptDurations(emptyDeptPhaseDurations());
    setTimingUploadWarnings([]);
    setDeptHoursAllocated({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 });
    setDeptCostAllocated({});
    setSelectedProjectManagerId(null);
    setShowInGeneral(true);
    setFormNotice(null);
    setParentProjectIdForNewProject(null);
    setPromotingChangeOrder(null);
  };

  // Change Order "Método 2": reuses the create-project form above, pre-filled with the parent's
  // client/facility (convenience, not a shortcut -- every other field still needs filling in)
  // and a parentProjectId that links the two once created.
  // Suggests the next "{parent}-CO##" job number for a CO registered as its own project,
  // following the convention the backend already expects project_number to use for Finance
  // import matching (see ProjectChangeOrder/parent_project docs). Editable afterward -- this
  // is just a starting point, not enforced.
  const nextCoProjectNumber = (parentProject: Project): string => {
    const base = (parentProject.projectNumber || parentProject.name || '').trim();
    const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-CO(\\d+)$`, 'i');
    const usedNumbers = projects
      .map((p) => pattern.exec(p.name || ''))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => parseInt(m[1], 10));
    const next = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
    return `${base}-CO${String(next).padStart(2, '0')}`;
  };

  const openCoAsNewProject = (project: Project) => {
    setCoChooserProjectId(null);
    setPromotingChangeOrder(null);
    setParentProjectIdForNewProject(project.id);
    setEditingId(null);
    setFormData({ name: nextCoProjectNumber(project), client: project.client, startDate: '', facility: project.facility, isHighProbability: false });
    setNumberOfWeeks(4);
    setHoursPerDept({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 });
    setDeptStartDates(emptyDeptPhaseDates());
    setDeptDurations(emptyDeptPhaseDurations());
    setTimingUploadWarnings([]);
    setDeptHoursAllocated({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 });
    setDeptCostAllocated({});
    setSelectedProjectManagerId(null);
    setShowInGeneral(true);
    setFormNotice(null);
    setIsFormOpen(true);
  };

  // Promotes a Change Order currently merged into `project`'s budget (Método 1) into its
  // own linked project (Método 2): opens the same create-project form, pre-filled with the
  // CO's current hours/$ per department. On submit (handleSubmit), this calls
  // projectsApi.promoteChangeOrder instead of a plain create, which atomically removes the
  // merged rows so the CO ends up registered exactly once.
  const openPromoteChangeOrder = (project: Project, name: string) => {
    const rows = changeOrdersForProject(project.id).filter((co) => co.name === name);
    const hours: Record<Department, number> = { PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 };
    const cost: Partial<Record<Department, string>> = {};
    rows.forEach((row) => {
      hours[row.department] = row.hoursQuoted || 0;
      if (row.costQuoted !== null && row.costQuoted !== undefined) cost[row.department] = String(row.costQuoted);
    });

    setCoExpandProjectId(null);
    setCoChooserProjectId(null);
    setPromotingChangeOrder({ sourceProjectId: project.id, name });
    setParentProjectIdForNewProject(project.id);
    setEditingId(null);
    const base = (project.projectNumber || project.name || '').trim();
    setFormData({ name: `${base}-${name}`, client: project.client, startDate: '', facility: project.facility, isHighProbability: false });
    setNumberOfWeeks(4);
    setHoursPerDept({ PM: 0, MED: 0, HD: 0, MFG: 0, BUILD: 0, PRG: 0, PURCHASING: 0 });
    setDeptStartDates(emptyDeptPhaseDates());
    setDeptDurations(emptyDeptPhaseDurations());
    setTimingUploadWarnings([]);
    setDeptHoursAllocated(hours);
    setDeptCostAllocated(cost);
    setSelectedProjectManagerId(null);
    setShowInGeneral(true);
    setFormNotice(null);
    setIsFormOpen(true);
  };

  // Converts a Change Order registered as its own project back into a merged entry on its
  // parent -- the inverse of promote. Destructive (migrates assignments/actuals and hides
  // this project), so it's confirmed before calling the backend.
  const handleMergeIntoParent = async (project: Project) => {
    if (!project.parentProjectId) return;
    const parentName = project.parentProjectName || project.parentProjectId;
    const confirmMsg = language === 'es'
      ? `Esto fusionará "${project.name}" de vuelta en el presupuesto de "${parentName}" (horas/$, asignaciones y horas reales se migran) y ocultará este proyecto. ¿Continuar?`
      : `This will merge "${project.name}" back into "${parentName}"'s budget (hours/$, assignments and actuals are migrated) and hide this project. Continue?`;
    if (!window.confirm(confirmMsg)) return;

    setIsMergingProjectId(project.id);
    try {
      await projectsApi.mergeIntoParent(project.id);
      await fetchProjects(true);
      // The merge created new ProjectChangeOrder rows on the parent -- reload from the server.
      await reloadChangeOrders();
      setFormNotice({
        type: 'success',
        message: language === 'es' ? 'Change Order fusionado con el proyecto principal.' : 'Change Order merged back into the main project.',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      setFormNotice({
        type: 'error',
        message: `${language === 'es' ? 'Error al fusionar' : 'Error merging'}: ${errorMsg}`,
      });
    } finally {
      setIsMergingProjectId(null);
    }
  };

  // Change Order "Método 1": widens an existing project's budget. One CO name can touch
  // several departments at once -- each becomes its own ProjectChangeOrder row sharing that
  // name (see changeOrderNamesForProject).
  const resetCoExpandForm = () => {
    setCoExpandProjectId(null);
    setCoName('');
    setCoHoursByDept({});
    setCoCostByDept({});
    setCoEditingName(null);
    setIsSavingCo(false);
  };

  const openCoExpand = (projectId: string) => {
    setCoChooserProjectId(null);
    setCoExpandProjectId(projectId);
    setCoName('');
    setCoHoursByDept({});
    setCoCostByDept({});
    setCoEditingName(null);
  };

  const startEditingCoName = (projectId: string, name: string) => {
    const rows = changeOrdersForProject(projectId).filter((co) => co.name === name);
    const hours: Partial<Record<Department, string>> = {};
    const cost: Partial<Record<Department, string>> = {};
    rows.forEach((row) => {
      hours[row.department] = row.hoursQuoted ? String(row.hoursQuoted) : '';
      cost[row.department] = row.costQuoted !== null && row.costQuoted !== undefined ? String(row.costQuoted) : '';
    });
    setCoName(name);
    setCoHoursByDept(hours);
    setCoCostByDept(cost);
    setCoEditingName(name);
  };

  const handleSaveCoExpand = async () => {
    if (!coExpandProjectId) return;
    const name = coName.trim();
    if (!name) {
      setFormNotice({
        type: 'warning',
        message: language === 'es' ? 'Indica un nombre para el Change Order.' : 'Enter a name for the Change Order.',
      });
      return;
    }

    // A brand-new CO name (not the one already loaded for editing) must not collide with
    // one already claimed anywhere in this project's family -- renaming the CO currently
    // being edited to its own name is fine, that's not a new registration.
    const isNewRegistration = name.toUpperCase() !== (coEditingName || '').toUpperCase();
    if (isNewRegistration) {
      const project = projects.find((p) => p.id === coExpandProjectId);
      const claim = project ? usedCoNamesForProject(project).get(name.toUpperCase()) : undefined;
      if (claim) {
        setFormNotice({
          type: 'warning',
          message: language === 'es'
            ? `El Change Order '${name}' ya está registrado (${describeCoNameClaim(claim)}). Solo se puede editar, no volver a registrar.`
            : `Change Order '${name}' is already registered (${describeCoNameClaim(claim)}). It can only be edited, not registered again.`,
        });
        return;
      }
    }

    // Departments with an hours and/or $ value entered -- the ones this CO actually touches.
    const deptsToSave = DEPARTMENTS.filter((dept) => {
      const h = parseFloat(coHoursByDept[dept] || '');
      const c = parseFloat(coCostByDept[dept] || '');
      return (Number.isFinite(h) && h > 0) || (Number.isFinite(c) && c > 0);
    });

    if (deptsToSave.length === 0) {
      setFormNotice({
        type: 'warning',
        message: language === 'es' ? 'Ingresa horas o $ para al menos un departamento.' : 'Enter hours or $ for at least one department.',
      });
      return;
    }

    // When editing an existing CO, match its current rows by the name it was loaded under
    // (coEditingName) -- renaming is just a field change, not a new identity.
    const matchRows = coEditingName
      ? changeOrdersForProject(coExpandProjectId).filter((co) => co.name === coEditingName)
      : [];

    setIsSavingCo(true);
    try {
      const savedRows: ProjectChangeOrder[] = [];
      for (const dept of deptsToSave) {
        const hoursVal = Math.max(0, parseFloat(coHoursByDept[dept] || '') || 0);
        const costRaw = (coCostByDept[dept] || '').trim();
        const costVal = costRaw === '' ? null : Math.max(0, parseFloat(costRaw) || 0);
        const existingRow = matchRows.find((co) => co.department === dept);
        if (existingRow) {
          const updated: any = await changeOrdersApi.update(existingRow.id, { name, hoursQuoted: hoursVal, costQuoted: costVal });
          savedRows.push({
            ...existingRow,
            name: updated?.name || name,
            hoursQuoted: Number(updated?.hoursQuoted ?? hoursVal),
            costQuoted: updated?.costQuoted !== null && updated?.costQuoted !== undefined ? Number(updated.costQuoted) : costVal,
            updatedAt: updated?.updatedAt || existingRow.updatedAt,
          });
        } else {
          const created: any = await changeOrdersApi.create({
            projectId: coExpandProjectId,
            department: dept,
            name,
            hoursQuoted: hoursVal,
            costQuoted: costVal,
          });
          savedRows.push({
            id: created?.id,
            projectId: created?.projectId || created?.project?.id || coExpandProjectId,
            department: created?.department || dept,
            name: created?.name || name,
            hoursQuoted: Number(created?.hoursQuoted ?? hoursVal),
            costQuoted: created?.costQuoted !== null && created?.costQuoted !== undefined ? Number(created.costQuoted) : costVal,
            createdAt: created?.createdAt,
            updatedAt: created?.updatedAt,
          });
        }
      }

      // Departments that were part of the CO being edited but got cleared out -> remove them.
      const rowsToDelete = matchRows.filter((co) => !deptsToSave.includes(co.department));
      for (const row of rowsToDelete) {
        await changeOrdersApi.delete(row.id);
      }

      setChangeOrders((prev) => {
        const staleIds = new Set([...matchRows.map((r) => r.id)]);
        const withoutStale = prev.filter((co) => !staleIds.has(co.id));
        return [...withoutStale, ...savedRows];
      });

      setFormNotice({
        type: 'success',
        message: language === 'es' ? 'Change Order guardado exitosamente.' : 'Change Order saved successfully.',
      });
      resetCoExpandForm();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      setFormNotice({
        type: 'error',
        message: `${language === 'es' ? 'Error al guardar Change Order' : 'Error saving Change Order'}: ${errorMsg}`,
      });
    } finally {
      setIsSavingCo(false);
    }
  };

  // Moves one department's quoted hours/$ from the CO currently being edited to a
  // different CO name on the same project (point 3 of the CO conditions: moving between
  // COs, never between projects).
  const handleMoveDepartmentToOtherCo = async (dept: Department, targetName: string) => {
    if (!coExpandProjectId || !coEditingName) return;
    const row = changeOrders.find(
      (co) => co.projectId === coExpandProjectId && co.name === coEditingName && co.department === dept
    );
    if (!row) return;

    const confirmMsg = language === 'es'
      ? `¿Mover ${dept} de "${coEditingName}" hacia "${targetName}"?`
      : `Move ${dept} from "${coEditingName}" to "${targetName}"?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await changeOrdersApi.moveDepartment(row.id, targetName);
      await reloadChangeOrders();
      setCoHoursByDept((prev) => {
        const next = { ...prev };
        delete next[dept];
        return next;
      });
      setCoCostByDept((prev) => {
        const next = { ...prev };
        delete next[dept];
        return next;
      });
      setFormNotice({
        type: 'success',
        message: language === 'es' ? 'Departamento movido a la otra CO.' : 'Department moved to the other CO.',
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      setFormNotice({
        type: 'error',
        message: `${language === 'es' ? 'Error al mover' : 'Error moving'}: ${errorMsg}`,
      });
    }
  };

  const formatHours = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 100) / 100;
    return rounded.toFixed(2).replace(/\.?0+$/, '');
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
            setParentProjectIdForNewProject(null);
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
                  {editingId
                    ? t.editProject
                    : parentProjectIdForNewProject
                      ? (language === 'es' ? 'Nuevo proyecto (Change Order)' : 'New project (Change Order)')
                      : t.createNewProject}
                </h2>
              </div>

              {parentProjectIdForNewProject && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  <GitBranch size={14} />
                  {language === 'es' ? 'Se registrará como Change Order de: ' : 'Will be registered as a Change Order of: '}
                  {projects.find((p) => p.id === parentProjectIdForNewProject)?.name || parentProjectIdForNewProject}
                </div>
              )}

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

                  {/* Row 3: Project Manager + visibility + high probability */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
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
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-amber-900">
                          {language === 'es' ? 'Proyecto High Probability' : 'High Probability Project'}
                        </p>
                        <p className="text-xs text-amber-700">
                          {language === 'es'
                            ? 'Si está activo, se resaltará con color especial en la barra del proyecto.'
                            : 'When enabled, the project bar will be highlighted with a dedicated color.'}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={!!formData.isHighProbability}
                        onChange={(e) => setFormData({ ...formData, isHighProbability: e.target.checked })}
                        className="h-5 w-5 accent-amber-600 cursor-pointer"
                        aria-label={language === 'es' ? 'Proyecto High Probability' : 'High Probability Project'}
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

                  {/* Quoted Amount ($) per Department -> Qtd $ in the Capacity Matrix Summary */}
                  <div className="bg-gradient-to-r from-teal-50 to-cyan-50 p-3 rounded-lg border-l-4 border-teal-600">
                    <h3 className="font-semibold mb-2 text-sm text-teal-900">
                      {language === 'es' ? 'Monto cotizado ($) por departamento' : 'Quoted Amount ($) per Department'}
                    </h3>
                    <p className="text-xs text-teal-700 mb-2">
                      {language === 'es'
                        ? 'Opcional. Se muestra debajo de las horas en la columna Qtd del Summary.'
                        : 'Optional. Shown under the hours in the Qtd column of the Summary.'}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                      {DEPARTMENTS.map((dept) => (
                        <div key={`cost-${dept}`}>
                          <label className="block text-xs font-medium mb-0.5 text-gray-700">{dept}</label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-teal-700">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={deptCostAllocated[dept] ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (/^\d*\.?\d{0,2}$/.test(val)) {
                                  setDeptCostAllocated({ ...deptCostAllocated, [dept]: val });
                                }
                              }}
                              className="w-full border border-teal-200 rounded pl-5 pr-2 py-1.5 focus:border-teal-400 focus:outline-none text-xs font-semibold"
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Configuration by Department - Compact */}
                  <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-3 rounded-lg border-l-4 border-indigo-600">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <h3 className="font-semibold text-sm text-indigo-900">{t.configByDepartment}</h3>
                      <div className="flex items-center gap-2">
                        {formData.startDate && (
                          <span className="text-xs text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-full font-medium">
                            {t.startDate}: {formatDateDayFirst(formData.startDate)}
                          </span>
                        )}
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 bg-white border border-indigo-300 rounded-full px-3 py-1.5 cursor-pointer hover:bg-indigo-50">
                          <Upload size={13} />
                          {isParsingTiming
                            ? (language === 'es' ? 'Leyendo…' : 'Reading…')
                            : editingId
                              ? (language === 'es' ? 'Volver a subir Timing' : 'Re-upload Timing')
                              : (language === 'es' ? 'Subir Timing (.xlsx)' : 'Upload Timing (.xlsx)')}
                          <input
                            type="file"
                            accept=".xlsx"
                            className="hidden"
                            disabled={isParsingTiming}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) handleTimingFileUpload(file);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    {timingUploadWarnings.length > 0 && (
                      <div className="mb-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-900">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold">
                            {language === 'es' ? 'Revisa estos puntos del archivo Timing:' : 'Review these points from the Timing file:'}
                          </p>
                          <button
                            type="button"
                            onClick={() => setTimingUploadWarnings([])}
                            className="text-amber-700 hover:bg-amber-100 rounded p-0.5 shrink-0"
                            aria-label="Close"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <ul className="list-disc list-inside mt-1 space-y-0.5">
                          {timingUploadWarnings.map((warning, idx) => (
                            <li key={idx}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {DEPARTMENTS.filter(dept => dept !== 'PM').map((dept) => {
                        const deptInfo = getDepartmentIcon(dept);
                        const subphases = getSubphasesForDept(dept);
                        return (
                          <div key={dept} className="bg-white p-2.5 rounded-lg border border-indigo-200 flex flex-col gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className={deptInfo.color}>{deptInfo.icon}</span>
                              <span className="font-semibold text-xs text-gray-800">{getDepartmentLabel(dept, t)}</span>
                            </div>
                            <div className="flex flex-col gap-2">
                              {subphases.map(({ key, label }) => (
                                <div key={key}>
                                  {label && (
                                    <div className="text-[11px] font-semibold text-indigo-600 mb-1">{label}</div>
                                  )}
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs font-medium mb-0.5 text-gray-600">{t.startDate}</label>
                                      <WeekNumberDatePicker
                                        value={deptStartDates[dept]?.[key] || ''}
                                        onChange={(date) =>
                                          setDeptStartDates({
                                            ...deptStartDates,
                                            [dept]: { ...deptStartDates[dept], [key]: date },
                                          })
                                        }
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
                                        value={deptDurations[dept]?.[key] || ''}
                                        onChange={(e) =>
                                          setDeptDurations({
                                            ...deptDurations,
                                            [dept]: { ...deptDurations[dept], [key]: parseInt(e.target.value) || 0 },
                                          })
                                        }
                                        className="w-full border border-indigo-200 rounded px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none"
                                        placeholder="0"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
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

      {/* CO chooser: pick one of the two ways to register a Change Order */}
      {coChooserProjectId && (() => {
        const project = projects.find((p) => p.id === coChooserProjectId);
        if (!project) return null;
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center p-4" onClick={() => setCoChooserProjectId(null)}>
            <div
              className="bg-white rounded-xl shadow-2xl border-2 border-emerald-200 w-full max-w-md p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-emerald-800">{language === 'es' ? 'Registrar Change Order' : 'Register Change Order'}</h3>
                <button onClick={() => setCoChooserProjectId(null)} className="text-gray-500 hover:text-gray-700 p-1 rounded">
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4">{project.name}</p>

              <div className="space-y-2.5">
                <button
                  onClick={() => openCoExpand(project.id)}
                  className="w-full text-left p-3 rounded-lg border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition"
                >
                  <div className="font-bold text-sm text-emerald-900">
                    {language === 'es' ? 'Ampliar presupuesto de este proyecto' : 'Expand this project\'s budget'}
                  </div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    {language === 'es'
                      ? 'Agrega horas y $ por departamento, que se suman al presupuesto original.'
                      : 'Add hours and $ per department, added on top of the original budget.'}
                  </div>
                </button>
                <button
                  onClick={() => openCoAsNewProject(project)}
                  className="w-full text-left p-3 rounded-lg border-2 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition"
                >
                  <div className="font-bold text-sm text-indigo-900">
                    {language === 'es' ? 'Registrar como proyecto nuevo' : 'Register as a new project'}
                  </div>
                  <div className="text-xs text-indigo-700 mt-0.5">
                    {language === 'es'
                      ? 'Crea un proyecto completo (fechas, horas, $) vinculado a este como su origen.'
                      : 'Creates a full project (dates, hours, $) linked back to this one.'}
                  </div>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* CO "Método 1": widen an existing project's budget */}
      {coExpandProjectId && (() => {
        const project = projects.find((p) => p.id === coExpandProjectId);
        if (!project) return null;
        const existingNames = changeOrderNamesForProject(coExpandProjectId);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-40 overflow-y-auto">
            <div className="min-h-screen flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-2xl border-2 border-emerald-200 w-full max-w-3xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-emerald-800">
                    {language === 'es' ? 'Ampliar presupuesto' : 'Expand budget'}
                  </h3>
                  <button onClick={resetCoExpandForm} className="text-gray-500 hover:text-gray-700 p-1 rounded">
                    <X size={16} />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-4">{project.name}</p>

                {existingNames.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      {language === 'es' ? 'Change Orders existentes (clic para editar)' : 'Existing Change Orders (click to edit)'}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {existingNames.map((co) => (
                        <div key={co.name} className="inline-flex items-stretch rounded-full border overflow-hidden">
                          <button
                            type="button"
                            onClick={() => startEditingCoName(coExpandProjectId, co.name)}
                            className={`px-2.5 py-1 text-xs font-semibold transition border-0 ${
                              coEditingName === co.name
                                ? 'bg-emerald-600 text-white'
                                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {co.name} · {formatHours(co.totalHours)}h
                          </button>
                          <button
                            type="button"
                            title={language === 'es' ? 'Volver independiente (crear como proyecto nuevo)' : 'Make independent (create as a new project)'}
                            onClick={() => openPromoteChangeOrder(project, co.name)}
                            className={`px-1.5 text-xs border-l transition ${
                              coEditingName === co.name
                                ? 'bg-emerald-700 text-white border-emerald-800 hover:bg-emerald-800'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            }`}
                          >
                            <GitBranch size={11} />
                          </button>
                        </div>
                      ))}
                      {coEditingName && (
                        <button
                          type="button"
                          onClick={() => { setCoName(''); setCoHoursByDept({}); setCoCostByDept({}); setCoEditingName(null); }}
                          className="px-2.5 py-1 rounded-full text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-100 transition"
                        >
                          + {language === 'es' ? 'Nuevo' : 'New'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    {language === 'es' ? 'Nombre del Change Order' : 'Change Order name'}
                  </label>
                  <input
                    type="text"
                    value={coName}
                    onChange={(e) => setCoName(e.target.value)}
                    placeholder="CO01"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    {language === 'es' ? 'Horas y $ a agregar por departamento' : 'Hours and $ to add per department'}
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {DEPARTMENTS.map((dept) => (
                      <div key={dept} className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                        <div className="text-xs font-bold text-gray-700 mb-1">{dept}</div>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={coHoursByDept[dept] ?? ''}
                          onChange={(e) => {
                            if (/^\d*\.?\d*$/.test(e.target.value)) setCoHoursByDept({ ...coHoursByDept, [dept]: e.target.value });
                          }}
                          placeholder={language === 'es' ? 'Horas' : 'Hours'}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-1 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={coCostByDept[dept] ?? ''}
                            onChange={(e) => {
                              if (/^\d*\.?\d{0,2}$/.test(e.target.value)) setCoCostByDept({ ...coCostByDept, [dept]: e.target.value });
                            }}
                            placeholder="0.00"
                            className="w-full border border-gray-300 rounded pl-5 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                          />
                        </div>
                        {coEditingName && changeOrders.some(
                          (co) => co.projectId === coExpandProjectId && co.name === coEditingName && co.department === dept
                        ) && (
                          <select
                            value=""
                            onChange={(e) => {
                              const value = e.target.value;
                              e.target.value = '';
                              if (!value) return;
                              if (value === '__new__') {
                                const typed = window.prompt(language === 'es' ? 'Nombre de la nueva CO' : 'New CO name');
                                if (typed && typed.trim()) handleMoveDepartmentToOtherCo(dept, typed.trim());
                              } else {
                                handleMoveDepartmentToOtherCo(dept, value);
                              }
                            }}
                            className="w-full mt-1 border border-gray-200 rounded px-1 py-0.5 text-[10px] text-gray-500 bg-white"
                          >
                            <option value="">{language === 'es' ? 'Mover a otra CO...' : 'Move to another CO...'}</option>
                            {changeOrderNamesForProject(coExpandProjectId!)
                              .filter((co) => co.name !== coEditingName)
                              .map((co) => (
                                <option key={co.name} value={co.name}>{co.name}</option>
                              ))}
                            <option value="__new__">+ {language === 'es' ? 'Nueva CO' : 'New CO'}</option>
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={resetCoExpandForm}
                    className="px-4 py-2 text-sm font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={handleSaveCoExpand}
                    disabled={isSavingCo}
                    className="px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-60"
                  >
                    {isSavingCo
                      ? (language === 'es' ? 'Guardando...' : 'Saving...')
                      : (coEditingName ? (t.update || 'Update') : (language === 'es' ? 'Agregar' : 'Add'))}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex-1 min-h-0 overflow-auto px-6 pb-6">
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-[#d5d1da] bg-white px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-[#4f3a70]">
          <span>{t.filterProjects || t.searchProject}</span>
          <input
            type="text"
            value={projectSearchTerm}
            onChange={(e) => setProjectSearchTerm(e.target.value)}
            placeholder={t.searchProjectPlaceholder || (language === 'es' ? 'Escribe numero, nombre o cliente' : 'Type project number, name or client')}
            className="w-full rounded-md border border-[#d5d1da] bg-white px-3 py-2 text-sm font-medium text-[#2e1a47] outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>
        <button
          type="button"
          onClick={() => setProjectSearchTerm('')}
          disabled={projectSearchTerm.trim().length === 0}
          className="h-[38px] rounded-md border border-[#d5d1da] bg-white px-4 py-2 text-xs font-semibold text-[#4f3a70] transition hover:bg-[#f4f1f8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.clearFilters || (language === 'es' ? 'Limpiar filtros' : 'Clear filters')}
        </button>
      </div>

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
            {filteredProjects.map((proj, idx) => (
              <tr key={proj.id} className={`projects-row transition hover:shadow-md ${idx % 2 === 0 ? 'bg-white projects-row-even' : 'bg-[#f4f1f8] projects-row-odd'}`}>
                <td className="projects-cell-main border px-4 py-3 font-semibold text-[#2e1a47]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{proj.name}</span>
                    {proj.isClosed && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                        <XCircle size={12} />
                        {language === 'es' ? 'Cerrado' : 'Closed'}
                      </span>
                    )}
                    {proj.parentProjectId && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                        title={language === 'es' ? `Change Order de ${proj.parentProjectName || ''}` : `Change Order of ${proj.parentProjectName || ''}`}
                      >
                        <GitBranch size={10} />
                        {language === 'es' ? 'CO de' : 'CO of'} {proj.parentProjectName || '—'}
                      </span>
                    )}
                  </div>
                </td>
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
                        onClick={() => hasFullAccess && setCoChooserProjectId(proj.id)}
                        disabled={!hasFullAccess}
                        className={`project-action-btn p-2 rounded-lg transition transform shadow-sm ${
                          hasFullAccess
                            ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 hover:scale-110'
                            : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                        }`}
                        title={language === 'es' ? 'Registrar Change Order' : 'Register Change Order'}
                      >
                        <ClipboardList size={18} />
                      </button>
                      {proj.parentProjectId && (
                        <button
                          onClick={() => hasFullAccess && handleMergeIntoParent(proj)}
                          disabled={!hasFullAccess || isMergingProjectId === proj.id}
                          className={`project-action-btn p-2 rounded-lg transition transform shadow-sm ${
                            hasFullAccess
                              ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 hover:scale-110 disabled:opacity-60'
                              : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                          }`}
                          title={language === 'es' ? 'Fusionar con el proyecto principal' : 'Merge back into the main project'}
                        >
                          <GitBranch size={18} className="rotate-180" />
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (!hasFullAccess) return;
                          const isClosed = !!proj.isClosed;
                          if (window.confirm(language === 'es' ? `¿${isClosed ? 'Reabrir' : 'Cerrar'} proyecto "${proj.name}"?` : `${isClosed ? 'Reopen' : 'Close'} project "${proj.name}"?`)) {
                            try {
                              await updateProject(proj.id, { isClosed: !isClosed });
                            } catch (error) {
                              console.error('Error toggling project close status:', error);
                            }
                          }
                        }}
                        disabled={!hasFullAccess}
                        className={`project-action-btn p-2 rounded-lg transition transform shadow-sm ${
                          hasFullAccess
                            ? (proj.isClosed
                                ? 'text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 hover:scale-110'
                                : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:scale-110')
                            : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                        }`}
                        title={proj.isClosed ? (language === 'es' ? 'Reabrir proyecto' : 'Reopen project') : (language === 'es' ? 'Cerrar proyecto' : 'Close project')}
                      >
                        {proj.isClosed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
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

      {projects.length > 0 && filteredProjects.length === 0 && !isFormOpen && (
        <div className="projects-empty-state text-center py-12 text-[#6c6480]">
          <p>{t.noProjectsMatchFilter || (language === 'es' ? 'No se encontraron proyectos con ese filtro.' : 'No projects matched the current filter.')}</p>
        </div>
      )}
    </div>
    </div>
  );
}

