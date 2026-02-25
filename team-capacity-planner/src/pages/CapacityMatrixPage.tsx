import { useState, useEffect, useRef, useMemo, type DragEvent } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { scioTeamCapacityApi, subcontractedTeamCapacityApi, prgExternalTeamCapacityApi, changeOrdersApi, assignmentsApi, activityLogApi } from '../services/api';
import { getAllWeeksWithNextYear, formatToISO, parseISODate, getWeekStart, normalizeWeekStartDate, getWeeksInRange, getWeekNumber } from '../utils/dateUtils';
import { calculateTalent, getStageColor, getStageLabel, getUtilizationColor } from '../utils/stageColors';
import { getDepartmentIcon, getDepartmentLabel } from '../utils/departmentIcons';
import { generateId } from '../utils/id';
import { ZoomIn, ZoomOut, ChevronDown, ChevronUp, Pencil, Plus, Minus, X, FolderPlus, ClipboardList, GripVertical, MessageCircle, AlertTriangle, History } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/translations';
import type { Department, Stage, Project, Assignment, Employee, ProjectChangeOrder } from '../types';
import { WeekNumberDatePicker } from '../components/WeekNumberDatePicker';

type DepartmentFilter = 'General' | Department;
type LegendStage = Exclude<Stage, null>;

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];
const GENERAL_VISIBILITY_SCOPE = 'GENERAL' as const;
const DEPARTMENT_SET = new Set<Department>(DEPARTMENTS);
const SHARED_EDIT_DEPARTMENTS: Department[] = ['BUILD', 'MFG'];
const HEAD_ENGINEERING_MANAGED_DEPARTMENTS: Department[] = ['MED', 'HD'];

const STAGE_OPTIONS: Record<Department, Exclude<Stage, null>[]> = {
  'HD': ['SWITCH_LAYOUT_REVISION', 'CONTROLS_DESIGN', 'RELEASE', 'RED_LINES', 'SUPPORT'],
  'MED': ['CONCEPT', 'DETAIL_DESIGN', 'RELEASE', 'RED_LINES', 'SUPPORT'],
  'BUILD': ['CABINETS_FRAMES', 'OVERALL_ASSEMBLY', 'FINE_TUNING', 'COMMISSIONING', 'SUPPORT'],
  'PRG': ['OFFLINE', 'ONLINE', 'DEBUG', 'COMMISSIONING', 'SUPPORT_MANUALS_FLOW_CHARTS', 'ROBOT_SIMULATION', 'STANDARDS_REV_PROGRAMING_CONCEPT'],
  'PM': [],
  'MFG': [],
};

const getStagePriority = (department: Department, stage: Stage): number => {
  if (!stage) return -1;
  const orderedStages = STAGE_OPTIONS[department] || [];
  const index = orderedStages.indexOf(stage as Exclude<Stage, null>);
  return index >= 0 ? index : -1;
};

// The last option in each department dropdown has the highest hierarchy.
// If a cell has multiple stages, we always show the dominant one by priority.
const isHigherPriorityStage = (
  department: Department,
  candidate: Stage,
  current: Stage
): boolean => {
  if (!candidate) return false;
  if (!current) return true;
  return getStagePriority(department, candidate) > getStagePriority(department, current);
};

const DEPARTMENT_LEGEND_STYLES: Record<Department, { badge: string; dot: string }> = {
  PM: { badge: 'border-purple-200 bg-purple-50 text-purple-700', dot: 'bg-purple-500' },
  MED: { badge: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  HD: { badge: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  MFG: { badge: 'border-orange-200 bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  BUILD: { badge: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
  PRG: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
};

const getLegendStageSwatchBg = (stage: LegendStage, department: Department): string => {
  return getStageColor(stage, department).bg;
};

interface CellEditState {
  department: Department;
  weekStart: string;
  projectId?: string;
}

interface ProjectCellSelectionState {
  department: Department;
  weekStart: string;
  projectId: string;
}

interface ProjectCellClipboardEntry {
  employeeId: string;
  hours: number;
  stage: Stage;
  comment?: string;
  scioHours?: number;
  externalHours?: number;
  changeOrderId?: string | null;
}

interface ProjectCellClipboardState {
  source: ProjectCellSelectionState;
  entries: ProjectCellClipboardEntry[];
}

interface CapacityMatrixPageProps {
  departmentFilter: DepartmentFilter;
}

interface StageHoursEntry {
  id: string;
  stage: Exclude<Stage, null> | '';
  hours: number;
  hoursInput: string;
}

interface StageResourceHoursEntry {
  hours: number;
  hoursInput: string;
}

interface ScioCapacityFields {
  capacity: number;
  pto: number;
  training: number;
}

interface ActivityLogUserSummary {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface ActivityLogEntry {
  id: string;
  action: string;
  modelName: string;
  objectId: string;
  changes: any;
  createdAt: string;
  user?: ActivityLogUserSummary | null;
}

interface TimingProjectGroup {
  projectId: string;
  projectName: string;
  entries: ActivityLogEntry[];
}

type FormValidationScope = 'quick' | 'import';
type PdfExportScope = 'single' | 'all' | 'selected';
const PROJECT_ORDER_STORAGE_KEY = 'capacity_project_order_by_scope_v1';
const CURRENT_WEEK_HEADER_CLASS = 'bg-stone-200 text-stone-950 border-[3px] border-black relative z-[6]';
const CURRENT_WEEK_RING_CLASS = 'border-[3px] border-black relative z-[5]';
const CURRENT_WEEK_EDITABLE_CLASS = 'border-[3px] border-black relative z-[5]';
const CURRENT_WEEK_STRONG_HEADER_CLASS = 'bg-gradient-to-b from-stone-500 via-stone-600 to-zinc-700 text-white border-[3px] border-black';
const CURRENT_WEEK_SOFT_CELL_CLASS = 'border-[3px] border-black relative z-[5]';
const MONTH_HEADER_PRIMARY_CLASS = 'bg-gradient-to-b from-[#4f3a70] to-[#2e1a47] text-white border-[#2e1a47] shadow-md';
const MONTH_HEADER_SECONDARY_CLASS = 'bg-yellow-300 text-yellow-900 border-yellow-400 shadow-md';
const WEEK_COLUMN_WIDTH_CLASS = 'w-20 min-w-20';
const GENERAL_LEFT_COLUMN_WIDTH_CLASS = 'w-14 min-w-14 max-w-14';
const DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS = 'w-14 min-w-14 max-w-14';
const PROJECT_TIMING_KEYS = new Set(['startDate', 'endDate', 'numberOfWeeks', 'departmentStages']);
const PROJECT_TIMING_NESTED_KEYS = new Set(['departmentStartDate', 'durationWeeks', 'weekStart', 'weekEnd']);

const asObject = (value: unknown): Record<string, any> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, any>;
};

const extractProjectUpdatePayload = (changes: unknown): Record<string, any> | null => {
  const changesObj = asObject(changes);
  if (!changesObj) return null;
  const updates = asObject(changesObj.updates);
  return updates || changesObj;
};

const hasTimingDataDeep = (value: unknown, depth = 0): boolean => {
  if (depth > 6 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((entry) => hasTimingDataDeep(entry, depth + 1));

  const obj = asObject(value);
  if (!obj) return false;

  for (const [key, nested] of Object.entries(obj)) {
    if (PROJECT_TIMING_KEYS.has(key) || PROJECT_TIMING_NESTED_KEYS.has(key)) return true;
    if (hasTimingDataDeep(nested, depth + 1)) return true;
  }

  return false;
};
const createEmptyDepartmentWeekValues = (): Record<Department, Record<string, number>> => ({
  'PM': {},
  'MED': {},
  'HD': {},
  'MFG': {},
  'BUILD': {},
  'PRG': {},
});

const getDepartmentVisibilityScopes = (project: Project): Department[] => {
  const rawScopes = project.visibleInDepartments || [];
  return rawScopes
    .map((scope) => (typeof scope === 'string' ? scope.trim().toUpperCase() : ''))
    .filter((scope): scope is Department => DEPARTMENT_SET.has(scope as Department));
};

const hasDepartmentStageConfiguration = (project: Project, department: Department): boolean => {
  const stageEntries = project.departmentStages?.[department];
  if (!Array.isArray(stageEntries) || stageEntries.length === 0) {
    return false;
  }

  return stageEntries.some((entry) => {
    const weekStartNum = Number(entry.weekStart);
    const weekEndNum = Number(entry.weekEnd);
    const durationNum = Number(entry.durationWeeks);
    const hasValidWeekRange =
      Number.isFinite(weekStartNum) &&
      Number.isFinite(weekEndNum) &&
      weekEndNum >= weekStartNum;
    const hasValidDuration = Number.isFinite(durationNum) && durationNum > 0;
    const hasStartDate = typeof entry.departmentStartDate === 'string' && entry.departmentStartDate.length > 0;
    return hasValidWeekRange || hasValidDuration || hasStartDate;
  });
};

const hasDepartmentHoursConfiguration = (project: Project, department: Department): boolean => {
  const allocated = Number(project.departmentHoursAllocated?.[department] || 0);
  const utilized = Number(project.departmentHoursUtilized?.[department] || 0);
  const forecast = Number(project.departmentHoursForecast?.[department] || 0);
  return allocated > 0 || utilized > 0 || forecast > 0;
};

const hasDepartmentConfiguration = (project: Project, department: Department): boolean => {
  return hasDepartmentStageConfiguration(project, department) || hasDepartmentHoursConfiguration(project, department);
};

const isProjectVisibleInDepartment = (project: Project, department: Department): boolean => {
  const departmentScopes = getDepartmentVisibilityScopes(project);
  if (departmentScopes.length === 0) {
    return true;
  }
  if (departmentScopes.includes(department)) {
    return true;
  }
  // If a department has explicit configuration, always expose the project in that department.
  return hasDepartmentConfiguration(project, department);
};

const isProjectVisibleInGeneral = (project: Project): boolean => {
  const rawScopes = project.visibleInDepartments || [];
  if (rawScopes.length === 0) {
    return true;
  }
  return rawScopes.some(
    (scope) =>
      typeof scope === 'string' &&
      scope.trim().toUpperCase() === GENERAL_VISIBILITY_SCOPE
  );
};

const projectHasDepartmentRangeOverlap = (project: Project, rangeStart: string, rangeEnd: string): boolean => {
  if (!project.startDate) {
    return false;
  }

  for (const department of DEPARTMENTS) {
    const stageEntries = project.departmentStages?.[department];
    if (!Array.isArray(stageEntries) || stageEntries.length === 0) continue;

    for (const entry of stageEntries) {
      const weekStartNum = Number(entry.weekStart);
      const weekEndNum = Number(entry.weekEnd);
      const durationNum = Number(entry.durationWeeks);

      let stageStart = typeof entry.departmentStartDate === 'string' && entry.departmentStartDate
        ? entry.departmentStartDate.slice(0, 10)
        : '';
      if (!stageStart && Number.isFinite(weekStartNum)) {
        const startFromProject = parseISODate(project.startDate);
        startFromProject.setDate(startFromProject.getDate() + ((weekStartNum - 1) * 7));
        stageStart = formatToISO(startFromProject);
      }

      let stageDuration = Number.isFinite(durationNum) && durationNum > 0 ? durationNum : 0;
      if (
        stageDuration <= 0 &&
        Number.isFinite(weekStartNum) &&
        Number.isFinite(weekEndNum) &&
        weekEndNum >= weekStartNum
      ) {
        stageDuration = weekEndNum - weekStartNum + 1;
      }

      if (!stageStart || stageDuration <= 0) continue;

      const stageEndDate = parseISODate(stageStart);
      stageEndDate.setDate(stageEndDate.getDate() + (stageDuration * 7) - 1);
      const stageEnd = formatToISO(stageEndDate);

      if (stageStart <= rangeEnd && stageEnd >= rangeStart) {
        return true;
      }
    }
  }

  return false;
};

export function CapacityMatrixPage({ departmentFilter }: CapacityMatrixPageProps) {
  const employees = useEmployeeStore((state) => state.employees);
  const addEmployee = useEmployeeStore((state) => state.addEmployee);
  const assignments = useAssignmentStore((state) => state.assignments);
  const fetchAssignments = useAssignmentStore((state) => state.fetchAssignments);
  const assignmentMutationVersion = useAssignmentStore((state) => state.mutationVersion);
  const projects = useProjectStore((state) => state.projects);
  const updateAssignment = useAssignmentStore((state) => state.updateAssignment);
  const addAssignment = useAssignmentStore((state) => state.addAssignment);
  const deleteAssignment = useAssignmentStore((state) => state.deleteAssignment);
  const addProject = useProjectStore((state) => state.addProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);

  // Debug: Log when projects change
  useEffect(() => {
    console.log('[CapacityMatrixPage] Projects updated:', {
      count: projects?.length,
      firstProjectName: projects?.[0]?.name,
      firstProjectHasQuoted: projects?.[0]?.departmentHoursAllocated ? 'YES' : 'NO'
    });
  }, [projects]);
  const { language } = useLanguage();
  const { hasFullAccess, isReadOnly, currentUserDepartment, currentUserOtherDepartment } = useAuth();
  const t = useTranslation(language);
  const locale = language === 'es' ? 'es-ES' : 'en-US';
  const isTimingAuditGeneralView =
    departmentFilter === 'General' &&
    (
      currentUserDepartment === 'PM' ||
      (
        currentUserDepartment === 'OTHER' &&
        currentUserOtherDepartment === 'BUSINESS_INTELLIGENCE'
      )
    );

  const [editingCell, setEditingCell] = useState<CellEditState | null>(null);
  const [editingHours, setEditingHours] = useState<number>(0);
  const [editingScioHours, setEditingScioHours] = useState<number>(0);
  const [initialScioHours, setInitialScioHours] = useState<number>(0);
  const [editingExternalHours, setEditingExternalHours] = useState<number>(0);
  const [editingHoursInput, setEditingHoursInput] = useState<string>('');
  const [editingScioHoursInput, setEditingScioHoursInput] = useState<string>('');
  const [editingExternalHoursInput, setEditingExternalHoursInput] = useState<string>('');
  const [editingStage, setEditingStage] = useState<Stage>(null);
  const [editingStageEntries, setEditingStageEntries] = useState<StageHoursEntry[]>([]);
  const [editingStageResourceHours, setEditingStageResourceHours] = useState<Record<string, StageResourceHoursEntry>>({});
  const [assignToChangeOrder, setAssignToChangeOrder] = useState<boolean>(false);
  const [selectedChangeOrderId, setSelectedChangeOrderId] = useState<string>('');
  const [editingComment, setEditingComment] = useState<string>('');
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [zoom, setZoom] = useState<number>(110);
  const [projectCellViewMode, setProjectCellViewMode] = useState<'detailed' | 'compact'>('detailed');
  const [showLegend, setShowLegend] = useState<boolean>(false);
  const [showGlobalPanel, setShowGlobalPanel] = useState<boolean>(true);
  const [showDepartmentPanel, setShowDepartmentPanel] = useState<boolean>(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [highProbabilityConfirmProject, setHighProbabilityConfirmProject] = useState<Project | null>(null);
  const [isClearingHighProbability, setIsClearingHighProbability] = useState<boolean>(false);
  const [isDeletingHighProbabilityProject, setIsDeletingHighProbabilityProject] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [selectedProjectCell, setSelectedProjectCell] = useState<ProjectCellSelectionState | null>(null);
  const [projectCellClipboard, setProjectCellClipboard] = useState<ProjectCellClipboardState | null>(null);

  const createStageHoursEntry = (stage: Exclude<Stage, null> | '' = '', hours = 0): StageHoursEntry => ({
    id: generateId(),
    stage,
    hours,
    hoursInput: hours > 0 ? `${hours}` : '',
  });

  const createStageResourceKey = (stageEntryId: string, employeeId: string) => `${stageEntryId}::${employeeId}`;

  const roundHours = (value: number) => Math.round((value || 0) * 100) / 100;
  const minYearOption = 2024;
  const maxYearOption = new Date().getFullYear() + 10;
  const yearOptions = Array.from(
    { length: maxYearOption - minYearOption + 1 },
    (_, idx) => minYearOption + idx
  );

  const closeEditModal = () => {
    setEditingCell(null);
    setEditingStage(null);
    setEditingStageEntries([]);
    setEditingStageResourceHours({});
    setAssignToChangeOrder(false);
    setSelectedChangeOrderId('');
    setEditingHours(0);
    setEditingComment('');
    setEditingHoursInput('');
    setEditingScioHours(0);
    setEditingScioHoursInput('');
    setEditingExternalHours(0);
    setEditingExternalHoursInput('');
    setInitialScioHours(0);
    setSelectedEmployees(new Set());
    setShowDeleteConfirm(false);
  };

  const stageEntriesTotalHours = useMemo(
    () => roundHours(editingStageEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0)),
    [editingStageEntries]
  );

  const stageResourceTotalHours = useMemo(() => {
    if (!editingCell) return 0;
    const isBuildOrPRGDept = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    const hasStagePlanner = !isBuildOrPRGDept && STAGE_OPTIONS[editingCell.department].length > 0;
    if (!hasStagePlanner) return 0;

    const selectedIds = Array.from(selectedEmployees).filter((employeeId) => {
      const emp = employees.find((candidate) => candidate.id === employeeId);
      return !!emp &&
        emp.isActive &&
        !isPlaceholderEmployee(emp) &&
        !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0);
    });

    if (selectedIds.length === 0) return stageEntriesTotalHours;

    return roundHours(
      editingStageEntries.reduce((sum, entry) => {
        const entryHours = selectedIds.reduce((entrySum, employeeId) => {
          const key = createStageResourceKey(entry.id, employeeId);
          return entrySum + (editingStageResourceHours[key]?.hours || 0);
        }, 0);
        return sum + entryHours;
      }, 0)
    );
  }, [editingCell, selectedEmployees, employees, editingStageEntries, editingStageResourceHours, stageEntriesTotalHours]);

  useEffect(() => {
    const weeks = getAllWeeksWithNextYear(selectedYear);
    const rangeStart = weeks[0]?.date || `${selectedYear}-01-01`;
    const rangeEnd = weeks[weeks.length - 1]?.date || `${selectedYear + 1}-12-31`;
    // Do not force here: useDataLoader already fetches the current-year range on login.
    // We only want to refetch when the range actually changes (e.g. user selects another year).
    fetchAssignments({ startDate: rangeStart, endDate: rangeEnd });
  }, [selectedYear, fetchAssignments]);

  useEffect(() => {
    if (!editingCell) return;
    const isBuildOrPRGDept = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    const hasStagePlanner = !isBuildOrPRGDept && STAGE_OPTIONS[editingCell.department].length > 0;
    if (!hasStagePlanner) return;

    setEditingHours(stageResourceTotalHours);
    setEditingHoursInput(stageResourceTotalHours > 0 ? `${stageResourceTotalHours}` : '');
  }, [editingCell, stageResourceTotalHours]);

  useEffect(() => {
    if (!editingCell) return;
    const isBuildOrPRGDept = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    const hasStagePlanner = !isBuildOrPRGDept && STAGE_OPTIONS[editingCell.department].length > 0;
    if (!hasStagePlanner) return;

    const activeEmployeeIds = Array.from(selectedEmployees).filter((employeeId) => {
      const emp = employees.find((candidate) => candidate.id === employeeId);
      return !!emp &&
        emp.isActive &&
        !isPlaceholderEmployee(emp) &&
        !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0);
    });

    setEditingStageResourceHours((prev) => {
      const next: Record<string, StageResourceHoursEntry> = { ...prev };
      let changed = false;
      const validKeys = new Set<string>();

      editingStageEntries.forEach((entry) => {
        activeEmployeeIds.forEach((employeeId) => {
          const key = createStageResourceKey(entry.id, employeeId);
          validKeys.add(key);
          if (!next[key]) {
            const defaultHours = activeEmployeeIds.length === 1 ? roundHours(entry.hours || 0) : 0;
            next[key] = {
              hours: defaultHours,
              hoursInput: defaultHours > 0 ? `${defaultHours}` : '',
            };
            changed = true;
          }
        });
      });

      Object.keys(next).forEach((key) => {
        if (!validKeys.has(key)) {
          delete next[key];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [editingCell, editingStageEntries, selectedEmployees, employees]);

  // SCIO Team Members state - store capacity per department and per week
  // Structure: { dept: { weekDate: hours } }
  // Now loads from API instead of localStorage
  const [scioTeamMembers, setScioTeamMembers] = useState<Record<Department, Record<string, number>>>(createEmptyDepartmentWeekValues);
  const [scioPto, setScioPto] = useState<Record<Department, Record<string, number>>>(createEmptyDepartmentWeekValues);
  const [scioTraining, setScioTraining] = useState<Record<Department, Record<string, number>>>(createEmptyDepartmentWeekValues);

  // Track API record IDs for SCIO Team Capacity (for updates)
  // Structure: { `${dept}-${weekDate}`: recordId }
  const [scioTeamRecordIds, setScioTeamRecordIds] = useState<Record<string, string>>({});

  // Track API record IDs for Subcontracted Team Capacity (for deletion)
  // Structure: { `${company}-${weekDate}`: recordId }
  const [subcontractedRecordIds, setSubcontractedRecordIds] = useState<Record<string, string>>({});

  // Track API record IDs for PRG External Team Capacity (for deletion)
  // Structure: { `${teamName}-${weekDate}`: recordId }
  const [prgExternalRecordIds, setPrgExternalRecordIds] = useState<Record<string, string>>({});

  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    type: 'subcontracted' | 'prg' | null;
    teamName: string;
    teamData?: any;
  }>({ isOpen: false, type: null, teamName: '' });

  // Subcontracted Personnel state - store subcontracted company members per week (BUILD dept only)
  // Structure: { company: { weekDate: count } } where company is 'AMI' | 'VICER' | 'ITAX' | 'MCI' | 'MG Electrical'
  // Use lazy initialization to load from localStorage on first render
  const [subcontractedPersonnel, setSubcontractedPersonnel] = useState<Record<string, Record<string, number | undefined>>>(() => {
    const saved = localStorage.getItem('subcontractedPersonnel');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<string, Record<string, number | undefined>>;
        const normalized: Record<string, Record<string, number | undefined>> = {};
        Object.entries(parsed || {}).forEach(([company, weeks]) => {
          if (!weeks || typeof weeks !== 'object') return;
          Object.entries(weeks).forEach(([weekDate, capacity]) => {
            const normalizedWeek = normalizeWeekStartDate(weekDate);
            if (!normalized[company]) {
              normalized[company] = {};
            }
            normalized[company][normalizedWeek] = capacity;
          });
        });
        return normalized;
      } catch (e) {
        console.error('Error loading subcontractedPersonnel from localStorage', e);
      }
    }
    return {
      'AMI': {},
      'VICER': {},
      'ITAX': {},
      'MCI': {},
      'MG Electrical': {},
    };
  });

  const [subcontractedInputs, setSubcontractedInputs] = useState<Record<string, string>>({});

  // Active subcontracted teams for BUILD department - Use global store and subscribe to changes
  const { activeTeams, setActiveTeams } = useBuildTeamsStore();

  // Active external teams for PRG department - Use global store and subscribe to changes
  const { activeTeams: prgActiveTeams, setActiveTeams: setPRGActiveTeams } = usePRGTeamsStore();

  // External Personnel state for PRG department
  // Structure: { teamName: { weekDate: count } }
  // Use lazy initialization to load from localStorage on first render
  const [prgExternalPersonnel, setPRGExternalPersonnel] = useState<Record<string, Record<string, number | undefined>>>(() => {
    const saved = localStorage.getItem('prgExternalPersonnel');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<string, Record<string, number | undefined>>;
        const normalized: Record<string, Record<string, number | undefined>> = {};
        Object.entries(parsed || {}).forEach(([team, weeks]) => {
          if (!weeks || typeof weeks !== 'object') return;
          Object.entries(weeks).forEach(([weekDate, capacity]) => {
            const normalizedWeek = normalizeWeekStartDate(weekDate);
            if (!normalized[team]) {
              normalized[team] = {};
            }
            normalized[team][normalizedWeek] = capacity;
          });
        });
        return normalized;
      } catch (e) {
        console.error('Error loading prgExternalPersonnel from localStorage', e);
      }
    }
    return {};
  });

  const [prgExternalInputs, setPrgExternalInputs] = useState<Record<string, string>>({});

  // Modal state for adding PRG external teams
  const [isPRGModalOpen, setIsPRGModalOpen] = useState(false);
  const [prgTeamName, setPRGTeamName] = useState('');

  // Modal state for adding BUILD subcontracted teams
  const [isBuildModalOpen, setIsBuildModalOpen] = useState(false);
  const [buildTeamName, setBuildTeamName] = useState('');

  // Per-project zoom levels
  const [projectZooms, setProjectZooms] = useState<Record<string, number>>({});

  // Change Orders state (quoted hours per project/department)
  const [changeOrders, setChangeOrders] = useState<ProjectChangeOrder[]>([]);
  const [isChangeOrderModalOpen, setIsChangeOrderModalOpen] = useState(false);
  const [changeOrderContext, setChangeOrderContext] = useState<{ projectId: string; department: Department } | null>(null);
  const [changeOrderForm, setChangeOrderForm] = useState({ name: '', hoursQuoted: '' });
  const [isSavingChangeOrder, setIsSavingChangeOrder] = useState(false);

  // Utilized/Forecast hours are calculated automatically from assignments

  // Comment view state for General view (read-only comment display)
  const [viewingComment, setViewingComment] = useState<{ comment: string; projectName: string; department: string } | null>(null);

  // Quick project creation modal state
  const [showQuickProjectModal, setShowQuickProjectModal] = useState(false);
  const [quickProjectForm, setQuickProjectForm] = useState({
    name: '',
    client: '',
    startDate: '',
    numberOfWeeks: '' as any,
    facility: 'AL' as 'AL' | 'MI' | 'MX',
    budgetHours: '' as any,
    isHighProbability: false,
  });

  // Import existing project modal state
  const [showImportProjectModal, setShowImportProjectModal] = useState(false);
  const [importProjectForm, setImportProjectForm] = useState({
    projectId: '',
    startDate: '',
    numberOfWeeks: '' as any,
    budgetHours: '' as any,
  });
  const [showExportPdfModal, setShowExportPdfModal] = useState(false);
  const [pdfExportScope, setPdfExportScope] = useState<PdfExportScope>('single');
  const [selectedExportProjectId, setSelectedExportProjectId] = useState('');
  const [selectedExportProjectIds, setSelectedExportProjectIds] = useState<string[]>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [showTimingChangesModal, setShowTimingChangesModal] = useState(false);
  const [timingChangesFromDate, setTimingChangesFromDate] = useState<string>(() => `${new Date().getFullYear()}-01-01`);
  const [timingChangesToDate, setTimingChangesToDate] = useState<string>(() => formatToISO(new Date()));
  const [timingChangesLogs, setTimingChangesLogs] = useState<ActivityLogEntry[]>([]);
  const [isTimingChangesLoading, setIsTimingChangesLoading] = useState(false);
  const [isTimingRangeExcelExporting, setIsTimingRangeExcelExporting] = useState(false);
  const [timingChangesError, setTimingChangesError] = useState<string | null>(null);
  const [formValidationPopup, setFormValidationPopup] = useState<{
    scope: FormValidationScope;
    title: string;
    message: string;
  } | null>(null);

  // Initialize with all projects collapsed by default
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(
    projects.reduce((acc, proj) => ({ ...acc, [proj.id]: false }), {})
  );
  const [projectOrderByScope, setProjectOrderByScope] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(PROJECT_ORDER_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, string[]>;
      }
    } catch (error) {
      console.error('[CapacityMatrix] Failed to load project order from localStorage:', error);
    }
    return {};
  });
  const [dragState, setDragState] = useState<{ projectId: string; scopeKey: string } | null>(null);
  const [dragOverState, setDragOverState] = useState<{
    projectId: string;
    scopeKey: string;
    position: 'before' | 'after';
  } | null>(null);

  useEffect(() => {
    if (!formValidationPopup) return;
    const timeout = setTimeout(() => setFormValidationPopup(null), 4500);
    return () => clearTimeout(timeout);
  }, [formValidationPopup]);

  useEffect(() => {
    if (isTimingAuditGeneralView) return;
    setShowTimingChangesModal(false);
    setTimingChangesLogs([]);
    setTimingChangesError(null);
  }, [isTimingAuditGeneralView]);

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(projectOrderByScope));
    } catch (error) {
      console.error('[CapacityMatrix] Failed to persist project order:', error);
    }
  }, [projectOrderByScope]);

  // No need to handle resize - always showing desktop view with scrollable containers

  // NOTE: Teams are now loaded from API in the loadTeamsData useEffect below
  // The old method of loading from employees list has been replaced with API loading
  // This ensures teams persist across page refreshes

  // Load SCIO Team Capacity from API on mount
  useEffect(() => {
    const loadScioTeamCapacity = async () => {
      try {
        console.log('[CapacityMatrix] Loading SCIO Team Capacity from API...');
        const data = await scioTeamCapacityApi.getAll();
        console.log('[CapacityMatrix] SCIO Team Capacity loaded:', data);
        console.log('[CapacityMatrix] Total SCIO records loaded:', data?.length || 0);

        // Transform API data to our state structure
        const newScioTeamMembers: Record<Department, Record<string, number>> = createEmptyDepartmentWeekValues();
        const newScioPto: Record<Department, Record<string, number>> = createEmptyDepartmentWeekValues();
        const newScioTraining: Record<Department, Record<string, number>> = createEmptyDepartmentWeekValues();
        const newRecordIds: Record<string, string> = {};

        for (const record of data) {
          const dept = record.department as Department;
          const weekDate = normalizeWeekStartDate(record.weekStartDate);
          const capacity = Number(record.capacity || 0);
          const pto = Number(record.pto || 0);
          const training = Number(record.training || 0);

          if (dept && weekDate && newScioTeamMembers[dept]) {
            newScioTeamMembers[dept][weekDate] = capacity;
            newScioPto[dept][weekDate] = pto;
            newScioTraining[dept][weekDate] = training;
            newRecordIds[`${dept}-${weekDate}`] = record.id;
          }
        }

        setScioTeamMembers(newScioTeamMembers);
        setScioPto(newScioPto);
        setScioTraining(newScioTraining);
        setScioTeamRecordIds(newRecordIds);
        console.log('[CapacityMatrix] SCIO Team Capacity state updated');
      } catch (error) {
        console.error('[CapacityMatrix] Error loading SCIO Team Capacity:', error);
      }
    };

    loadScioTeamCapacity();
  }, []);

  // Load Project Change Orders from API on mount
  useEffect(() => {
    const loadChangeOrders = async () => {
      try {
        console.log('[CapacityMatrix] Loading Project Change Orders from API...');
        const data = await changeOrdersApi.getAll();
        const normalized = (Array.isArray(data) ? data : [])
          .map((row: any): ProjectChangeOrder | null => {
            const projectId = row?.projectId || row?.project?.id;
            if (!row?.id || !projectId || !row?.department) return null;
            return {
              id: row.id,
              projectId,
              department: row.department,
              name: row.name || '',
              hoursQuoted: Number(row.hoursQuoted ?? 0),
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            };
          })
          .filter((row): row is ProjectChangeOrder => Boolean(row));

        setChangeOrders(normalized);
        console.log('[CapacityMatrix] Change Orders loaded:', normalized.length);
      } catch (error) {
        console.error('[CapacityMatrix] Error loading Change Orders:', error);
      }
    };

    loadChangeOrders();
  }, []);

  // Load BUILD and PRG teams from API, and load subcontracted/external personnel capacity data
  useEffect(() => {
    const loadTeamsData = async () => {
      try {
        // Load active BUILD teams
        const buildStore = useBuildTeamsStore.getState();
        await buildStore.loadActiveTeams();
        console.log('[CapacityMatrix] BUILD teams loaded, activeTeams =', buildStore.activeTeams);

        // Load active PRG teams
        const prgStore = usePRGTeamsStore.getState();
        await prgStore.loadActiveTeams();
        console.log('[CapacityMatrix] PRG teams loaded, activeTeams =', prgStore.activeTeams);

        // Load subcontracted team capacity data
        console.log('[CapacityMatrix] Loading Subcontracted Team Capacity from API...');
        const subcontractedData = await subcontractedTeamCapacityApi.getAll();
        const newSubcontractedPersonnel: Record<string, Record<string, number | undefined>> = {
          'AMI': {},
          'VICER': {},
          'ITAX': {},
          'MCI': {},
          'MG Electrical': {},
        };
        const newSubcontractedRecordIds: Record<string, string> = {};
        const subcontractedLatestByKey: Record<string, number> = {};

        for (const record of subcontractedData) {
          const company = record.company;
          const weekDate = normalizeWeekStartDate(record.weekStartDate);
          const capacity = record.capacity;

          if (company && weekDate) {
            const recordKey = `${company}-${weekDate}`;
            const timestampSource = record.updatedAt || record.createdAt;
            const recordTimestamp = timestampSource ? new Date(timestampSource).getTime() : 0;
            const safeTimestamp = Number.isNaN(recordTimestamp) ? 0 : recordTimestamp;
            const existingTimestamp = subcontractedLatestByKey[recordKey];
            if (existingTimestamp !== undefined && safeTimestamp < existingTimestamp) {
              continue;
            }
            if (!newSubcontractedPersonnel[company]) {
              newSubcontractedPersonnel[company] = {};
            }
            newSubcontractedPersonnel[company][weekDate] = capacity;
            newSubcontractedRecordIds[recordKey] = record.id;
            subcontractedLatestByKey[recordKey] = safeTimestamp;
          }
        }
        setSubcontractedPersonnel(prev => {
          const merged: Record<string, Record<string, number | undefined>> = { ...newSubcontractedPersonnel };
          Object.keys(prev).forEach((company) => {
            if (!merged[company]) {
              merged[company] = { ...(prev[company] || {}) };
              return;
            }

            Object.keys(prev[company] || {}).forEach((weekDate) => {
              if (merged[company]?.[weekDate] === undefined) {
                merged[company] = {
                  ...(merged[company] || {}),
                  [weekDate]: prev[company][weekDate],
                };
              }
            });
          });
          return merged;
        });
        setSubcontractedRecordIds(prev => ({ ...prev, ...newSubcontractedRecordIds }));
        console.log('[CapacityMatrix] Subcontracted Team Capacity loaded');

        // Load PRG external team capacity data
        console.log('[CapacityMatrix] Loading PRG External Team Capacity from API...');
        const prgExternalData = await prgExternalTeamCapacityApi.getAll();
        const newPrgExternalPersonnel: Record<string, Record<string, number | undefined>> = {};
        const newPrgExternalRecordIds: Record<string, string> = {};
        const prgExternalLatestByKey: Record<string, number> = {};

        for (const record of prgExternalData) {
          const teamName = record.teamName;
          const weekDate = normalizeWeekStartDate(record.weekStartDate);
          const capacity = record.capacity;

          if (teamName && weekDate) {
            const recordKey = `${teamName}-${weekDate}`;
            const timestampSource = record.updatedAt || record.createdAt;
            const recordTimestamp = timestampSource ? new Date(timestampSource).getTime() : 0;
            const safeTimestamp = Number.isNaN(recordTimestamp) ? 0 : recordTimestamp;
            const existingTimestamp = prgExternalLatestByKey[recordKey];
            if (existingTimestamp !== undefined && safeTimestamp < existingTimestamp) {
              continue;
            }
            if (!newPrgExternalPersonnel[teamName]) {
              newPrgExternalPersonnel[teamName] = {};
            }
            newPrgExternalPersonnel[teamName][weekDate] = capacity;
            newPrgExternalRecordIds[recordKey] = record.id;
            prgExternalLatestByKey[recordKey] = safeTimestamp;
          }
        }
        setPRGExternalPersonnel(prev => {
          const merged: Record<string, Record<string, number | undefined>> = { ...newPrgExternalPersonnel };
          Object.keys(prev).forEach((team) => {
            if (!merged[team]) {
              merged[team] = { ...(prev[team] || {}) };
              return;
            }

            Object.keys(prev[team] || {}).forEach((weekDate) => {
              if (merged[team]?.[weekDate] === undefined) {
                merged[team] = {
                  ...(merged[team] || {}),
                  [weekDate]: prev[team][weekDate],
                };
              }
            });
          });
          return merged;
        });
        setPrgExternalRecordIds(prev => ({ ...prev, ...newPrgExternalRecordIds }));
        console.log('[CapacityMatrix] PRG External Team Capacity loaded');
      } catch (error) {
        console.error('[CapacityMatrix] Error loading teams data:', error);
      }
    };

    loadTeamsData();
  }, []);

  // Normalize weekly capacity maps to ensure all departments exist in the structure.
  // This prevents "Cannot read properties of undefined" errors when accessing dept[date].
  useEffect(() => {
    const normalizeByDepartment = (source: Record<Department, Record<string, number>>) => ({
      'PM': source['PM'] || {},
      'MED': source['MED'] || {},
      'HD': source['HD'] || {},
      'MFG': source['MFG'] || {},
      'BUILD': source['BUILD'] || {},
      'PRG': source['PRG'] || {},
    });

    setScioTeamMembers(prev => normalizeByDepartment(prev));
    setScioPto(prev => normalizeByDepartment(prev));
    setScioTraining(prev => normalizeByDepartment(prev));
  }, []);

  // Function to save SCIO Team Capacity to API
  const saveScioTeamCapacity = async (dept: Department, weekDate: string, values: ScioCapacityFields) => {
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    const recordKey = `${dept}-${normalizedWeek}`;
    const existingId = scioTeamRecordIds[recordKey];
    const safeValues: ScioCapacityFields = {
      capacity: Math.max(0, Number(values.capacity || 0)),
      pto: Math.max(0, Number(values.pto || 0)),
      training: Math.max(0, Number(values.training || 0)),
    };
    const shouldDelete = safeValues.capacity === 0 && safeValues.pto === 0 && safeValues.training === 0;

    console.log('[CapacityMatrix] saveScioTeamCapacity called:', { dept, weekDate: normalizedWeek, values: safeValues, existingId, recordKey });

    try {
      if (shouldDelete && existingId) {
        // Delete the record if all fields are zero.
        console.log('[CapacityMatrix] Deleting SCIO capacity row:', recordKey);
        await scioTeamCapacityApi.delete(existingId);
        console.log('[CapacityMatrix] SCIO capacity row deleted successfully');

        await activityLogApi.logActivity(
          'deleted',
          'ScioTeamCapacity',
          existingId,
          { department: dept, weekStartDate: normalizedWeek }
        );

        setScioTeamRecordIds(prev => {
          const newIds = { ...prev };
          delete newIds[recordKey];
          return newIds;
        });
        return;
      }

      if (shouldDelete && !existingId) {
        // Nothing to persist when no record exists and all values are zero.
        return;
      }

      if (existingId) {
        // Update existing record
        console.log('[CapacityMatrix] Updating SCIO capacity row:', recordKey, safeValues);
        const updateResult = await scioTeamCapacityApi.update(existingId, safeValues);
        console.log('[CapacityMatrix] SCIO capacity updated successfully:', updateResult);

        await activityLogApi.logActivity(
          'updated',
          'ScioTeamCapacity',
          existingId,
          { department: dept, weekStartDate: normalizedWeek, ...safeValues }
        );
        return;
      }

      // Create new record when at least one field is non-zero.
      console.log('[CapacityMatrix] Creating SCIO capacity row:', recordKey, safeValues);
      let createdSuccessfully = false;
      let createdRecordId: string | null = null;

      try {
        console.log('[CapacityMatrix] Sending CREATE request to API...');
        const result = await scioTeamCapacityApi.create({
          department: dept,
          weekStartDate: normalizedWeek,
          ...safeValues,
        });
        console.log('[CapacityMatrix] CREATE succeeded, result:', result);
        createdSuccessfully = true;
        createdRecordId = result.id;

        setScioTeamRecordIds(prev => ({
          ...prev,
          [recordKey]: result.id,
        }));
      } catch (createError) {
        const createErrorMsg = createError instanceof Error ? createError.message : 'Error desconocido';
        console.log('[CapacityMatrix] CREATE failed:', createErrorMsg);

        // If create fails due to unique constraint, resolve and update the existing row.
        if (createErrorMsg.includes('conjunto único') || createErrorMsg.includes('unique')) {
          console.log('[CapacityMatrix] Detected unique constraint violation, fetching records...');
          const allScioRecords = await scioTeamCapacityApi.getAll();
          const existingRecord = allScioRecords.find(
            (r: any) => r.department === dept && normalizeWeekStartDate(r.weekStartDate) === normalizedWeek
          );

          if (!existingRecord) {
            throw createError;
          }

          console.log('[CapacityMatrix] Found existing record, updating it with ID:', existingRecord.id);
          await scioTeamCapacityApi.update(existingRecord.id, safeValues);
          createdSuccessfully = true;
          createdRecordId = existingRecord.id;

          setScioTeamRecordIds(prev => ({
            ...prev,
            [recordKey]: existingRecord.id,
          }));
        } else {
          throw createError;
        }
      }

      if (!createdSuccessfully || !createdRecordId) {
        throw new Error('Failed to create or update SCIO capacity record');
      }

      await activityLogApi.logActivity(
        'created',
        'ScioTeamCapacity',
        createdRecordId,
        { department: dept, weekStartDate: normalizedWeek, ...safeValues }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] Final error saving SCIO capacity:', errorMsg);
      alert(`Error al guardar capacidad SCIO (${dept} - ${normalizedWeek}): ${errorMsg}`);
    }
  };

  // Debounced save to avoid too many API calls while typing
  const scioSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const scheduleScioSave = (dept: Department, weekDate: string, values: ScioCapacityFields) => {
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    const timeoutKey = `${dept}-${normalizedWeek}`;
    if (scioSaveTimeouts.current[timeoutKey]) {
      clearTimeout(scioSaveTimeouts.current[timeoutKey]);
    }
    scioSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      saveScioTeamCapacity(dept, normalizedWeek, values);
    }, 500);
  };

  const handleScioTeamChange = (dept: Department, weekDate: string, newCapacity: number) => {
    if (!hasFullAccess) {
      return;
    }
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    const sanitizedCapacity = Math.max(0, newCapacity);
    console.log('[CapacityMatrix] handleScioTeamChange called:', { dept, weekDate: normalizedWeek, newCapacity: sanitizedCapacity });

    // Update local state immediately
    setScioTeamMembers(prev => ({
      ...prev,
      [dept]: {
        ...(prev[dept] || {}),
        [normalizedWeek]: sanitizedCapacity,
      },
    }));

    scheduleScioSave(dept, normalizedWeek, {
      capacity: sanitizedCapacity,
      pto: scioPto[dept]?.[normalizedWeek] || 0,
      training: scioTraining[dept]?.[normalizedWeek] || 0,
    });
  };

  const handleScioPtoChange = (dept: Department, weekDate: string, newPto: number) => {
    if (!hasFullAccess) {
      return;
    }
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    const sanitizedPto = Math.max(0, newPto);

    setScioPto(prev => ({
      ...prev,
      [dept]: {
        ...(prev[dept] || {}),
        [normalizedWeek]: sanitizedPto,
      },
    }));

    scheduleScioSave(dept, normalizedWeek, {
      capacity: scioTeamMembers[dept]?.[normalizedWeek] || 0,
      pto: sanitizedPto,
      training: scioTraining[dept]?.[normalizedWeek] || 0,
    });
  };

  const handleScioTrainingChange = (dept: Department, weekDate: string, newTraining: number) => {
    if (!hasFullAccess) {
      return;
    }
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    const sanitizedTraining = Math.max(0, newTraining);

    setScioTraining(prev => ({
      ...prev,
      [dept]: {
        ...(prev[dept] || {}),
        [normalizedWeek]: sanitizedTraining,
      },
    }));

    scheduleScioSave(dept, normalizedWeek, {
      capacity: scioTeamMembers[dept]?.[normalizedWeek] || 0,
      pto: scioPto[dept]?.[normalizedWeek] || 0,
      training: sanitizedTraining,
    });
  };

  // Save Subcontracted Team Capacity to API
  const saveSubcontractedCapacity = async (company: string, weekDate: string, capacity: number | undefined) => {
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    console.log('[CapacityMatrix] saveSubcontractedCapacity called:', { company, weekDate: normalizedWeek, capacity });

    try {
      if (capacity === undefined) {
        console.log('[CapacityMatrix] Skipping Subcontracted save - capacity is undefined');
        return;
      }

      console.log('[CapacityMatrix] Saving Subcontracted capacity:', company, normalizedWeek, capacity);
      console.log('[CapacityMatrix] Sending CREATE request to API...');
      const result = await subcontractedTeamCapacityApi.create({
        company,
        weekStartDate: normalizedWeek,
        capacity,
      });
      console.log('[CapacityMatrix] UPSERT succeeded:', result);

      const resultWeek = normalizeWeekStartDate(result.weekStartDate || normalizedWeek);

      setSubcontractedPersonnel(prev => ({
        ...prev,
        [company]: {
          ...(prev[company] || {}),
          [resultWeek]: capacity,
        },
      }));

      setSubcontractedRecordIds(prev => ({
        ...prev,
        [`${company}-${resultWeek}`]: result.id,
      }));

      // Log activity
      await activityLogApi.logActivity(
        'updated',
        'SubcontractedTeamCapacity',
        result.id,
        { company, weekStartDate: resultWeek, capacity }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] ERROR saving Subcontracted capacity:', errorMsg);
      alert(`Error al guardar capacidad de ${company} (${normalizedWeek}): ${errorMsg}`);
    }
  };

  // Debounced saves for subcontracted and PRG external personnel
  const subcontractedSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const prgExternalSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleSubcontractedChange = (company: string, weekDate: string, newCount: number | undefined) => {
    if (!hasFullAccess) {
      return;
    }
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    console.log('[CapacityMatrix] handleSubcontractedChange called:', { company, weekDate: normalizedWeek, newCount });

    // Update local state immediately
    setSubcontractedPersonnel(prev => ({
      ...prev,
      [company]: {
        ...(prev[company] || {}),
        [normalizedWeek]: newCount,
      },
    }));

    // Debounce the API call
    const timeoutKey = `${company}-${normalizedWeek}`;
    if (subcontractedSaveTimeouts.current[timeoutKey]) {
      console.log('[CapacityMatrix] Clearing previous Subcontracted timeout for key:', timeoutKey);
      clearTimeout(subcontractedSaveTimeouts.current[timeoutKey]);
    }
    console.log('[CapacityMatrix] Setting Subcontracted debounce timeout for key:', timeoutKey);
    subcontractedSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      console.log('[CapacityMatrix] Subcontracted debounce timeout fired for key:', timeoutKey);
      if (newCount !== undefined) {
        saveSubcontractedCapacity(company, normalizedWeek, newCount);
      }
    }, 500);
  };

  // Save PRG External Team Capacity to API
  const savePrgExternalCapacity = async (teamName: string, weekDate: string, capacity: number | undefined) => {
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    console.log('[CapacityMatrix] savePrgExternalCapacity called:', { teamName, weekDate: normalizedWeek, capacity });

    try {
      if (capacity === undefined) {
        console.log('[CapacityMatrix] Skipping PRG External save - capacity is undefined');
        return;
      }

      console.log('[CapacityMatrix] Saving PRG External capacity:', teamName, normalizedWeek, capacity);
      console.log('[CapacityMatrix] Sending CREATE request to API...');
      const result = await prgExternalTeamCapacityApi.create({
        teamName,
        weekStartDate: normalizedWeek,
        capacity,
      });
      console.log('[CapacityMatrix] UPSERT succeeded:', result);

      const resultWeek = normalizeWeekStartDate(result.weekStartDate || normalizedWeek);

      setPRGExternalPersonnel(prev => ({
        ...prev,
        [teamName]: {
          ...(prev[teamName] || {}),
          [resultWeek]: capacity,
        },
      }));

      setPrgExternalRecordIds(prev => ({
        ...prev,
        [`${teamName}-${resultWeek}`]: result.id,
      }));

      // Log activity
      await activityLogApi.logActivity(
        'updated',
        'PrgExternalTeamCapacity',
        result.id,
        { teamName, weekStartDate: resultWeek, capacity }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] ERROR saving PRG External capacity:', errorMsg);
      alert(`Error al guardar capacidad PRG (${teamName} - ${normalizedWeek}): ${errorMsg}`);
    }
  };

  const handlePrgExternalChange = (teamName: string, weekDate: string, newCount: number | undefined) => {
    if (!hasFullAccess) {
      return;
    }
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    console.log('[CapacityMatrix] handlePrgExternalChange called:', { teamName, weekDate: normalizedWeek, newCount });

    // Update local state immediately
    setPRGExternalPersonnel(prev => ({
      ...prev,
      [teamName]: {
        ...(prev[teamName] || {}),
        [normalizedWeek]: newCount,
      },
    }));

    // Debounce the API call
    const timeoutKey = `${teamName}-${normalizedWeek}`;
    if (prgExternalSaveTimeouts.current[timeoutKey]) {
      console.log('[CapacityMatrix] Clearing previous PRG External timeout for key:', timeoutKey);
      clearTimeout(prgExternalSaveTimeouts.current[timeoutKey]);
    }
    console.log('[CapacityMatrix] Setting PRG External debounce timeout for key:', timeoutKey);
    prgExternalSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      console.log('[CapacityMatrix] PRG External debounce timeout fired for key:', timeoutKey);
      if (newCount !== undefined) {
        savePrgExternalCapacity(teamName, normalizedWeek, newCount);
      }
    }, 500);
  };

  // Delete team handler
  const handleDeleteTeam = async () => {
    if (!hasFullAccess) {
      return;
    }
    if (!deleteConfirmation.isOpen || !deleteConfirmation.teamName || !deleteConfirmation.type) {
      return;
    }

    setIsDeleting(true);
    try {
      const teamName = deleteConfirmation.teamName;
      const type = deleteConfirmation.type;

      let deletedRecordId: string | undefined;

      if (type === 'subcontracted') {
        // Delete all records for this company from database
        const recordsToDelete = Object.keys(subcontractedRecordIds).filter(
          key => key.startsWith(`${teamName}-`)
        );
        deletedRecordId = recordsToDelete.length > 0 ? subcontractedRecordIds[recordsToDelete[0]] : undefined;

        for (const recordKey of recordsToDelete) {
          const recordId = subcontractedRecordIds[recordKey];
          await subcontractedTeamCapacityApi.delete(recordId);
        }

        // Update local state
        setSubcontractedPersonnel(prev => {
          const newState = { ...prev };
          delete newState[teamName];
          return newState;
        });

        // Update record IDs
        setSubcontractedRecordIds(prev => {
          const newIds = { ...prev };
          Object.keys(newIds).forEach(key => {
            if (key.startsWith(`${teamName}-`)) {
              delete newIds[key];
            }
          });
          return newIds;
        });

        // Remove from active teams
        setActiveTeams(activeTeams.filter(team => team !== teamName));
      } else if (type === 'prg') {
        // Delete all records for this team from database
        const recordsToDelete = Object.keys(prgExternalRecordIds).filter(
          key => key.startsWith(`${teamName}-`)
        );
        deletedRecordId = recordsToDelete.length > 0 ? prgExternalRecordIds[recordsToDelete[0]] : undefined;

        for (const recordKey of recordsToDelete) {
          const recordId = prgExternalRecordIds[recordKey];
          await prgExternalTeamCapacityApi.delete(recordId);
        }

        // Update local state
        setPRGExternalPersonnel(prev => {
          const newState = { ...prev };
          delete newState[teamName];
          return newState;
        });

        // Update record IDs
        setPrgExternalRecordIds(prev => {
          const newIds = { ...prev };
          Object.keys(newIds).forEach(key => {
            if (key.startsWith(`${teamName}-`)) {
              delete newIds[key];
            }
          });
          return newIds;
        });

        // Remove from active teams
        setPRGActiveTeams(prgActiveTeams.filter(team => team !== teamName));
      }

      console.log(`[CapacityMatrix] Deleted ${type} team: ${teamName}`);

      // Log activity (use a valid UUID from deleted records if available)
      if (deletedRecordId) {
        await activityLogApi.logActivity(
          'deleted',
          type === 'subcontracted' ? 'SubcontractedTeamCapacity' : 'PrgExternalTeamCapacity',
          deletedRecordId,
          { type, teamName }
        );
      }

      setDeleteConfirmation({ isOpen: false, type: null, teamName: '' });
    } catch (error) {
      console.error('[CapacityMatrix] Error deleting team:', error);
      alert(`${t.errorDeletingTeam || 'Error deleting team'}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Refs for synchronized horizontal scrolling between Capacity and Projects
  const departmentCapacityScrollRef = useRef<HTMLDivElement>(null);
  const generalCapacityScrollRef = useRef<HTMLDivElement>(null);
  const projectTableRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const projectCellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const isPastingProjectCellRef = useRef(false);
  const isSyncingHorizontalScrollRef = useRef(false);
  const syncedBaseScrollProgressRef = useRef(0);
  const activeSyncedProjectIdRef = useRef<string | null>(null);
  const [activeSyncedProjectId, setActiveSyncedProjectId] = useState<string | null>(null);

  const allWeeksData = useMemo(() => getAllWeeksWithNextYear(selectedYear), [selectedYear]);
  const today = new Date();
  const employeeDeptMap = useMemo(
    () => new Map(employees.map((emp) => [emp.id, emp.department])),
    [employees]
  );
  const employeeById = useMemo(
    () => new Map(employees.map((emp) => [emp.id, emp])),
    [employees]
  );
  const getAssignmentDepartment = (assignment: Assignment) =>
    assignment.department || employeeDeptMap.get(assignment.employeeId) || assignment.employee?.department;
  const employeeNameById = useMemo(
    () => new Map(employees.map((emp) => [emp.id, emp.name])),
    [employees]
  );
  const projectById = useMemo(
    () => new Map(projects.map((proj) => [proj.id, proj])),
    [projects]
  );
  const formatTimingUserName = (user: ActivityLogEntry['user']) => {
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (user?.username) return user.username;
    if (user?.email) return user.email;
    return language === 'es' ? 'Usuario no identificado' : 'Unknown user';
  };
  const formatTimingDateTime = (value: string) => {
    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value));
    } catch {
      return value;
    }
  };
  const getTimingSummaryLines = (log: ActivityLogEntry): string[] => {
    const updates = extractProjectUpdatePayload(log.changes);
    if (!updates) {
      return [language === 'es' ? 'Cambio de timing detectado' : 'Timing change detected'];
    }

    const lines: string[] = [];

    const startDateValue = typeof updates.startDate === 'string' ? updates.startDate : '';
    const endDateValue = typeof updates.endDate === 'string' ? updates.endDate : '';
    const weeksValue = Number(updates.numberOfWeeks);
    const hasWeeksValue = Number.isFinite(weeksValue) && weeksValue > 0;

    if (startDateValue || endDateValue || hasWeeksValue) {
      const projectRangePieces: string[] = [];
      if (startDateValue || endDateValue) {
        projectRangePieces.push(`${startDateValue || '—'} → ${endDateValue || '—'}`);
      }
      if (hasWeeksValue) {
        projectRangePieces.push(`${weeksValue} ${language === 'es' ? 'semanas' : 'weeks'}`);
      }
      lines.push(
        `${language === 'es' ? 'Calendario del proyecto' : 'Project schedule'}: ${projectRangePieces.join(' | ')}`
      );
    }

    const departmentStages = asObject(updates.departmentStages);
    if (departmentStages) {
      DEPARTMENTS.forEach((dept) => {
        const deptStagesRaw = departmentStages[dept];
        if (!Array.isArray(deptStagesRaw) || deptStagesRaw.length === 0) return;

        const firstStage = asObject(deptStagesRaw[0]);
        const stageStartDate = typeof firstStage?.departmentStartDate === 'string'
          ? firstStage.departmentStartDate
          : '';
        const stageWeekStart = Number(firstStage?.weekStart);
        const stageWeekEnd = Number(firstStage?.weekEnd);
        const stageDuration = Number(firstStage?.durationWeeks);
        const hasWeekRange = Number.isFinite(stageWeekStart) && Number.isFinite(stageWeekEnd) && stageWeekEnd >= stageWeekStart;
        const hasDuration = Number.isFinite(stageDuration) && stageDuration > 0;

        const parts: string[] = [];
        if (stageStartDate) parts.push(stageStartDate);
        if (hasDuration) parts.push(`${stageDuration} ${language === 'es' ? 'sem' : 'wk'}`);
        if (hasWeekRange) parts.push(`W${stageWeekStart}–W${stageWeekEnd}`);

        lines.push(
          `${dept}: ${parts.length > 0 ? parts.join(' | ') : (language === 'es' ? 'timing actualizado' : 'timing updated')}`
        );
      });
    }

    if (lines.length === 0) {
      const timingKeys = Object.keys(updates).filter((key) =>
        PROJECT_TIMING_KEYS.has(key) || PROJECT_TIMING_NESTED_KEYS.has(key)
      );
      if (timingKeys.length > 0) {
        lines.push(
          `${language === 'es' ? 'Campos de timing' : 'Timing fields'}: ${timingKeys.join(', ')}`
        );
      } else {
        lines.push(language === 'es' ? 'Cambio de timing detectado' : 'Timing change detected');
      }
    }

    return lines;
  };
  const timingChangesByProject = useMemo<TimingProjectGroup[]>(() => {
    const grouped = new Map<string, TimingProjectGroup>();

    timingChangesLogs.forEach((log) => {
      const updates = extractProjectUpdatePayload(log.changes);
      if (!updates || !hasTimingDataDeep(updates)) return;

      const projectId = log.objectId;
      const fallbackName = typeof updates.name === 'string' ? updates.name : '';
      const projectName = projectById.get(projectId)?.name
        || fallbackName
        || `${language === 'es' ? 'Proyecto' : 'Project'} ${projectId.slice(0, 8)}`;

      const existing = grouped.get(projectId);
      if (existing) {
        existing.entries.push(log);
      } else {
        grouped.set(projectId, { projectId, projectName, entries: [log] });
      }
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
      }))
      .sort((a, b) => {
        const dateA = a.entries[0]?.createdAt ? new Date(a.entries[0].createdAt).getTime() : 0;
        const dateB = b.entries[0]?.createdAt ? new Date(b.entries[0].createdAt).getTime() : 0;
        return dateB - dateA;
      });
  }, [timingChangesLogs, projectById, language]);
  const changeOrderSummaryByProjectDept = useMemo(() => {
    const map = new Map<string, { totalHours: number; count: number; orders: ProjectChangeOrder[] }>();

    changeOrders.forEach((order) => {
      const key = `${order.projectId}|${order.department}`;
      const entry = map.get(key) || { totalHours: 0, count: 0, orders: [] };
      entry.totalHours += order.hoursQuoted || 0;
      entry.count += 1;
      entry.orders.push(order);
      map.set(key, entry);
    });

    return map;
  }, [changeOrders]);
  const weekDataByDate = useMemo(
    () => new Map(allWeeksData.map((week) => [week.date, week])),
    [allWeeksData]
  );
  const projectDurationWeeksById = useMemo(() => {
    const map = new Map<string, number>();
    projects.forEach((proj) => {
      const start = new Date(proj.startDate);
      const end = new Date(proj.endDate);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffWeeks = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
      map.set(proj.id, diffWeeks);
    });
    return map;
  }, [projects]);
  const projectStartDisplayById = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((proj) => {
      const display = proj.startDate
        ? new Date(proj.startDate).toLocaleDateString(locale)
        : 'N/A';
      map.set(proj.id, display);
    });
    return map;
  }, [projects, locale]);
  const projectManagerNameById = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((proj) => {
      if (proj.projectManagerId) {
        map.set(proj.id, employeeNameById.get(proj.projectManagerId) || 'PM');
      }
    });
    return map;
  }, [projects, employeeNameById]);
  const projectDeptMetaByKey = useMemo(() => {
    const map = new Map<string, {
      deptStartDate?: string;
      deptEndDate?: string;
      deptDisplayDate: string;
      effectiveStartDate: string;
      effectiveEndDate: string;
      expectedStartDate: string;
      expectedEndDate: string;
    }>();

    projects.forEach((proj) => {
      DEPARTMENTS.forEach((dept) => {
        let deptStartDate: string | undefined;
        let deptDuration = 0;
        let minConfiguredWeekStart: number | null = null;
        let maxConfiguredWeekEnd: number | null = null;

        if (dept === 'PM') {
          deptStartDate = proj.startDate;
          deptDuration = proj.numberOfWeeks || 0;
        } else {
          const deptStages = proj.departmentStages?.[dept];
          if (deptStages && deptStages.length > 0) {
            let minWeekStart = Number.POSITIVE_INFINITY;
            let maxWeekEnd = Number.NEGATIVE_INFINITY;
            let minWeekStartDate: string | undefined;

            deptStages.forEach((stageCfg) => {
              const weekStartNum = Number(stageCfg.weekStart);
              const weekEndNum = Number(stageCfg.weekEnd);
              if (!Number.isFinite(weekStartNum) || !Number.isFinite(weekEndNum) || weekEndNum < weekStartNum) {
                return;
              }

              if (weekStartNum < minWeekStart) {
                minWeekStart = weekStartNum;
                minWeekStartDate = stageCfg.departmentStartDate;
              }
              if (weekEndNum > maxWeekEnd) {
                maxWeekEnd = weekEndNum;
              }
            });

            deptStartDate = minWeekStartDate;
            if (Number.isFinite(minWeekStart) && Number.isFinite(maxWeekEnd)) {
              minConfiguredWeekStart = minWeekStart;
              maxConfiguredWeekEnd = maxWeekEnd;
              deptDuration = Math.max(0, maxWeekEnd - minWeekStart + 1);
            }

            if (!deptStartDate && Number.isFinite(minWeekStart) && proj.startDate) {
              const fallbackStart = parseISODate(proj.startDate);
              fallbackStart.setDate(fallbackStart.getDate() + ((minWeekStart - 1) * 7));
              deptStartDate = formatToISO(fallbackStart);
            }
          }
        }

        let deptEndDate = '';
        if (deptStartDate && deptDuration > 0) {
          const endDate = new Date(deptStartDate);
          endDate.setDate(endDate.getDate() + (deptDuration * 7) - 1);
          deptEndDate = formatToISO(endDate);
        }

        const effectiveStartDate = deptStartDate || proj.startDate;
        const effectiveEndDate = deptEndDate || proj.endDate || proj.startDate;
        let expectedStartDate = proj.startDate;
        let expectedEndDate = proj.endDate || proj.startDate;
        if (proj.startDate && minConfiguredWeekStart !== null && maxConfiguredWeekEnd !== null) {
          const expectedStart = parseISODate(proj.startDate);
          expectedStart.setDate(expectedStart.getDate() + ((minConfiguredWeekStart - 1) * 7));
          expectedStartDate = formatToISO(expectedStart);

          const expectedEnd = parseISODate(proj.startDate);
          expectedEnd.setDate(expectedEnd.getDate() + (maxConfiguredWeekEnd * 7) - 1);
          expectedEndDate = formatToISO(expectedEnd);
        }
        const deptDisplayDate = deptStartDate
          ? new Date(deptStartDate).toLocaleDateString(locale)
          : t.notConfigured;

        map.set(`${proj.id}|${dept}`, {
          deptStartDate,
          deptEndDate,
          deptDisplayDate,
          effectiveStartDate,
          effectiveEndDate,
          expectedStartDate,
          expectedEndDate,
        });
      });
    });

    return map;
  }, [projects, locale, t.notConfigured]);

  const getCellShiftIndicators = (
    project: Project | undefined,
    department: Department,
    weekStart: string,
    totalHours: number
  ) => {
    if (!project) {
      return {
        showHardOutOfRangeIndicator: false,
        showShiftGapBackground: false,
        showShiftDashedIndicator: false,
      };
    }

    const deptMeta = projectDeptMetaByKey.get(`${project.id}|${department}`);
    const effectiveDeptStartDate = deptMeta?.effectiveStartDate || project.startDate || '';
    const effectiveDeptEndDate = deptMeta?.effectiveEndDate || project.endDate || project.startDate || '';
    const expectedDeptStartDate = deptMeta?.expectedStartDate || project.startDate || '';
    const isDeptWeekInRange =
      !!effectiveDeptStartDate &&
      !!effectiveDeptEndDate &&
      weekStart >= effectiveDeptStartDate &&
      weekStart <= effectiveDeptEndDate;
    const normalizedEffectiveStart = effectiveDeptStartDate.slice(0, 10);
    const normalizedExpectedStart = expectedDeptStartDate.slice(0, 10);
    const hasDepartmentTimingShift =
      !!normalizedEffectiveStart &&
      !!normalizedExpectedStart &&
      normalizedEffectiveStart !== normalizedExpectedStart;
    let isDateShiftDifferenceWeek = false;
    if (hasDepartmentTimingShift) {
      const shiftGapStart =
        normalizedEffectiveStart < normalizedExpectedStart
          ? normalizedEffectiveStart
          : normalizedExpectedStart;
      const shiftGapEndExclusive =
        normalizedEffectiveStart < normalizedExpectedStart
          ? normalizedExpectedStart
          : normalizedEffectiveStart;

      // Mark only the exact gap between original saved start date and updated start date.
      isDateShiftDifferenceWeek =
        !!weekStart &&
        weekStart >= shiftGapStart &&
        weekStart < shiftGapEndExclusive;
    }
    const outOfEstimatedRange = !isDeptWeekInRange;
    const isDisplacedByTimingShift = hasDepartmentTimingShift && isDateShiftDifferenceWeek;
    // For timing-shift gaps:
    // - show light-blue background only when there are no assigned hours
    // - show dashed indicator only when hours are assigned
    const showShiftGapBackground = isDisplacedByTimingShift && totalHours <= 0;
    const showShiftDashedIndicator = isDisplacedByTimingShift && totalHours > 0;
    const showHardOutOfRangeIndicator = outOfEstimatedRange && totalHours > 0 && !isDisplacedByTimingShift;

    return {
      showHardOutOfRangeIndicator,
      showShiftGapBackground,
      showShiftDashedIndicator,
    };
  };

  const monthSpans = useMemo(() => {
    const months: Array<{ month: string; startIdx: number; endIdx: number }> = [];
    let currentMonth = '';
    let startIdx = 0;

    allWeeksData.forEach((weekData, idx) => {
      const date = parseISODate(weekData.date);
      const labelDate = new Date(date);
      labelDate.setDate(labelDate.getDate() + 3);
      let monthName = labelDate.toLocaleString(locale, { month: 'short', year: 'numeric' });
      monthName = monthName.charAt(0).toUpperCase() + monthName.slice(1);

      if (monthName !== currentMonth) {
        if (currentMonth) {
          months.push({ month: currentMonth, startIdx, endIdx: idx - 1 });
        }
        currentMonth = monthName;
        startIdx = idx;
      }

      if (idx === allWeeksData.length - 1) {
        months.push({ month: currentMonth, startIdx, endIdx: idx });
      }
    });

    return months;
  }, [allWeeksData, locale]);

  // Find the current week - it's the week that contains today's date
  const currentDateWeekIndex = allWeeksData.findIndex((w) => {
    const weekStart = parseISODate(w.date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return today >= weekStart && today <= weekEnd;
  });
  const currentWeekStart = currentDateWeekIndex >= 0
    ? allWeeksData[currentDateWeekIndex]?.date
    : formatToISO(getWeekStart(today));
  const hoursByProjectDeptFallback = useMemo(() => {
    const map: Record<string, { utilized: number; forecast: number }> = {};
    if (!currentWeekStart) return map;

    assignments.forEach((assignment) => {
      const dept = getAssignmentDepartment(assignment);
      if (!dept) return;
      const normalizedWeekStart = normalizeWeekStartDate(assignment.weekStartDate);

      const key = `${assignment.projectId}-${dept}`;
      if (!map[key]) {
        map[key] = { utilized: 0, forecast: 0 };
      }

      if (normalizedWeekStart < currentWeekStart) {
        map[key].utilized += assignment.hours;
      } else {
        map[key].forecast += assignment.hours;
      }
    });

    return map;
  }, [assignments, employeeDeptMap, currentWeekStart]);

  const [hoursByProjectDeptAll, setHoursByProjectDeptAll] = useState<Record<string, { utilized: number; forecast: number }>>({});

  useEffect(() => {
    const projectIds = projects.map((p) => p.id).filter(Boolean);
    if (!currentWeekStart || projectIds.length === 0) {
      return;
    }

    const department = departmentFilter === 'General' ? undefined : (departmentFilter as Department);

    assignmentsApi.getSummaryByProjectDept({ projectIds, department, currentWeekStart })
      .then((rows: any[]) => {
        const map: Record<string, { utilized: number; forecast: number }> = {};
        (rows || []).forEach((row) => {
          if (!row?.projectId || !row?.department) return;
          map[`${row.projectId}-${row.department}`] = {
            utilized: row.utilized || 0,
            forecast: row.forecast || 0,
          };
        });
        setHoursByProjectDeptAll(map);
        console.log('[CapacityMatrix] Assignment summary loaded:', {
          rows: Array.isArray(rows) ? rows.length : 'non-array',
          entries: Object.keys(map).length,
        });
      })
      .catch((error) => {
        console.error('[CapacityMatrix] Error loading assignment summary (keeping last good values):', error);
        // Do not clear hoursByProjectDeptAll here; fallback will still work and we preserve last good values.
      });
  }, [projects, departmentFilter, currentWeekStart, assignmentMutationVersion]);

  const assignmentIndex = useMemo(() => {
    const byCell = new Map<string, { totalHours: number; assignments: Assignment[]; stage: Stage | null; comment?: string }>();
    const deptWeekTotals = new Map<string, number>();
    const deptWeekExternalTotals = new Map<string, number>();
    const projectDeptTotals = new Map<string, number>();

    assignments.forEach((assignment) => {
      const dept = getAssignmentDepartment(assignment);
      if (!dept) return;
      const normalizedWeekStart = normalizeWeekStartDate(assignment.weekStartDate);

      const cellKey = `${assignment.projectId}|${dept}|${normalizedWeekStart}`;
      const cellEntry = byCell.get(cellKey) ?? { totalHours: 0, assignments: [], stage: null, comment: undefined };
      const assignmentHours = typeof assignment.totalHours === 'number'
        ? assignment.totalHours
        : (assignment.hours ?? 0);
      cellEntry.totalHours += assignmentHours;
      cellEntry.assignments.push(assignment);
      if (isHigherPriorityStage(dept, assignment.stage, cellEntry.stage)) {
        cellEntry.stage = assignment.stage;
      }
      if (cellEntry.comment === undefined && assignment.comment) {
        cellEntry.comment = assignment.comment;
      }
      byCell.set(cellKey, cellEntry);

      const projectDeptKey = `${assignment.projectId}|${dept}`;
      projectDeptTotals.set(projectDeptKey, (projectDeptTotals.get(projectDeptKey) || 0) + assignmentHours);

      const deptWeekKey = `${dept}|${normalizedWeekStart}`;
      deptWeekTotals.set(deptWeekKey, (deptWeekTotals.get(deptWeekKey) || 0) + assignment.hours);

      if (assignment.externalHours) {
        deptWeekExternalTotals.set(
          deptWeekKey,
          (deptWeekExternalTotals.get(deptWeekKey) || 0) + assignment.externalHours
        );
      }
    });

    return { byCell, deptWeekTotals, deptWeekExternalTotals, projectDeptTotals };
  }, [assignments, employeeDeptMap]);

  const weekRange = useMemo(() => {
    const rangeStart = allWeeksData[0]?.date || `${selectedYear}-01-01`;
    const rangeEnd = allWeeksData[allWeeksData.length - 1]?.date || `${selectedYear + 1}-12-31`;
    return { rangeStart, rangeEnd };
  }, [allWeeksData, selectedYear]);

  const assignmentProjectIdsInRange = useMemo(() => {
    const ids = new Set<string>();
    const { rangeStart, rangeEnd } = weekRange;
    assignments.forEach((assignment) => {
      const weekStart = normalizeWeekStartDate(assignment.weekStartDate);
      if (weekStart >= rangeStart && weekStart <= rangeEnd) {
        ids.add(assignment.projectId);
      }
    });
    return ids;
  }, [assignments, weekRange]);

  const departmentProjects = useMemo(() => {
    const dept = departmentFilter as Department;
    return projects.filter((proj) => isProjectVisibleInDepartment(proj, dept));
  }, [projects, departmentFilter]);

  const generalProjects = useMemo(() => {
    if (departmentFilter !== 'General') {
      return [];
    }

    const { rangeStart, rangeEnd } = weekRange;
    return projects.filter((proj) => {
      if (!isProjectVisibleInGeneral(proj)) {
        return false;
      }

      const projectStart = proj.startDate || '';
      const projectEnd = proj.endDate || proj.startDate || '';
      const projectOverlapsRange = projectStart && projectEnd
        ? projectStart <= rangeEnd && projectEnd >= rangeStart
        : false;

      const hasAssignmentsInRange = assignmentProjectIdsInRange.has(proj.id);
      const hasDepartmentOverlapInRange = projectHasDepartmentRangeOverlap(proj, rangeStart, rangeEnd);

      return projectOverlapsRange || hasAssignmentsInRange || hasDepartmentOverlapInRange;
    });
  }, [projects, departmentFilter, weekRange, assignmentProjectIdsInRange]);

  const getProjectOrderScopeKey = (filter: DepartmentFilter): string => {
    return filter === 'General' ? 'GENERAL' : `DEPT:${filter}`;
  };

  const buildOrderedProjectIds = (projectList: Project[], scopeKey: string): string[] => {
    const baseIds = projectList.map((proj) => proj.id);
    const baseIdSet = new Set(baseIds);
    const stored = (projectOrderByScope[scopeKey] || []).filter((id) => baseIdSet.has(id));
    const storedSet = new Set(stored);
    const missing = baseIds.filter((id) => !storedSet.has(id));
    return [...stored, ...missing];
  };

  const sortProjectsByStoredOrder = (projectList: Project[], scopeKey: string): Project[] => {
    const byId = new Map(projectList.map((proj) => [proj.id, proj]));
    return buildOrderedProjectIds(projectList, scopeKey)
      .map((id) => byId.get(id))
      .filter((proj): proj is Project => Boolean(proj));
  };

  const saveProjectOrderForScope = (scopeKey: string, orderedIds: string[]) => {
    setProjectOrderByScope((prev) => ({
      ...prev,
      [scopeKey]: orderedIds,
    }));
  };

  const reorderProjectsInScope = (
    sourceProjectId: string,
    targetProjectId: string,
    scopeKey: string,
    currentProjectsInScope: Project[],
    insertAfter: boolean
  ) => {
    if (sourceProjectId === targetProjectId) return;

    const currentOrder = buildOrderedProjectIds(currentProjectsInScope, scopeKey);
    const sourceIdx = currentOrder.indexOf(sourceProjectId);
    const targetIdx = currentOrder.indexOf(targetProjectId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(sourceIdx, 1);
    let insertIndex = targetIdx;
    if (sourceIdx < targetIdx) {
      insertIndex -= 1;
    }
    if (insertAfter) {
      insertIndex += 1;
    }
    insertIndex = Math.max(0, Math.min(nextOrder.length, insertIndex));
    nextOrder.splice(insertIndex, 0, moved);

    saveProjectOrderForScope(scopeKey, nextOrder);
  };

  const handleProjectDragStart = (
    e: DragEvent<HTMLButtonElement>,
    projectId: string,
    scopeKey: string
  ) => {
    setDragState({ projectId, scopeKey });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', projectId);
  };

  const handleProjectDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const updateDragOverPosition = (
    e: DragEvent<HTMLDivElement>,
    targetProjectId: string,
    scopeKey: string
  ) => {
    if (!dragState || dragState.scopeKey !== scopeKey || dragState.projectId === targetProjectId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const position: 'before' | 'after' = offsetY < rect.height / 2 ? 'before' : 'after';
    setDragOverState({ projectId: targetProjectId, scopeKey, position });
  };

  const handleProjectDrop = (
    e: DragEvent<HTMLDivElement>,
    targetProjectId: string,
    scopeKey: string,
    currentProjectsInScope: Project[]
  ) => {
    e.preventDefault();
    if (!dragState || dragState.scopeKey !== scopeKey) return;
    const insertAfter = dragOverState?.projectId === targetProjectId &&
      dragOverState?.scopeKey === scopeKey &&
      dragOverState.position === 'after';
    reorderProjectsInScope(dragState.projectId, targetProjectId, scopeKey, currentProjectsInScope, insertAfter);
    setDragState(null);
    setDragOverState(null);
  };

  const orderedDepartmentProjects = useMemo(() => {
    const scopeKey = getProjectOrderScopeKey(departmentFilter);
    return sortProjectsByStoredOrder(departmentProjects, scopeKey);
  }, [departmentProjects, departmentFilter, projectOrderByScope]);

  const orderedGeneralProjects = useMemo(() => {
    const scopeKey = getProjectOrderScopeKey('General');
    return sortProjectsByStoredOrder(generalProjects, scopeKey);
  }, [generalProjects, projectOrderByScope]);

  const projectsVisibleInCurrentView = useMemo(() => {
    return departmentFilter === 'General' ? orderedGeneralProjects : orderedDepartmentProjects;
  }, [departmentFilter, orderedDepartmentProjects, orderedGeneralProjects]);

  const departmentProjectRowById = useMemo(() => {
    const map = new Map<string, number>();
    orderedDepartmentProjects.forEach((proj, idx) => map.set(proj.id, idx));
    return map;
  }, [orderedDepartmentProjects]);

  const weekIndexByDate = useMemo(() => {
    const map = new Map<string, number>();
    allWeeksData.forEach((week, idx) => map.set(week.date, idx));
    return map;
  }, [allWeeksData]);

  useEffect(() => {
    if (!showExportPdfModal) return;
    if (!projectsVisibleInCurrentView.length) return;

    if (pdfExportScope === 'single') {
      const selectedStillExists = projectsVisibleInCurrentView.some((proj) => proj.id === selectedExportProjectId);
      if (!selectedStillExists) {
        setSelectedExportProjectId(projectsVisibleInCurrentView[0].id);
      }
      return;
    }

    if (pdfExportScope === 'selected') {
      const visibleProjectIds = new Set(projectsVisibleInCurrentView.map((proj) => proj.id));
      const filteredSelectedIds = selectedExportProjectIds.filter((projectId) => visibleProjectIds.has(projectId));

      if (filteredSelectedIds.length !== selectedExportProjectIds.length) {
        setSelectedExportProjectIds(filteredSelectedIds);
      }
    }
  }, [
    showExportPdfModal,
    pdfExportScope,
    projectsVisibleInCurrentView,
    selectedExportProjectId,
    selectedExportProjectIds,
  ]);

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  function isPlaceholderEmployee(emp?: Employee | null) {
    return !!emp && (emp.role === 'Placeholder' || emp.name.endsWith('Placeholder'));
  }

  const getOrCreatePlaceholderEmployee = async (department: Department) => {
    const placeholderName = `${department} Placeholder`;
    let placeholder = employees.find(
      (emp) => emp.department === department && emp.name === placeholderName
    );

    if (!placeholder) {
      try {
        placeholder = await addEmployee({
          name: placeholderName,
          role: 'Placeholder',
          department,
          capacity: 0,
          isActive: false,
          isSubcontractedMaterial: false,
        });
      } catch (error) {
        console.error('[CapacityMatrix] Failed to create placeholder employee:', error);
        return null;
      }
    }

    return placeholder;
  };

  const handleCreateQuickProject = () => {
    if (departmentFilter === 'General' || departmentFilter === 'PM') {
      return;
    }

    const dept = departmentFilter as Department;
    if (!canEditDepartment(dept)) {
      alert(language === 'es'
        ? 'No tienes permiso para crear proyectos en este departamento.'
        : 'You do not have permission to create projects in this department.');
      return;
    }

    if (!quickProjectForm.name || !quickProjectForm.client || !quickProjectForm.startDate || !quickProjectForm.numberOfWeeks) {
      const missing: string[] = [];
      if (!quickProjectForm.name) missing.push(t.job || 'Project');
      if (!quickProjectForm.client) missing.push(t.customer || 'Client');
      if (!quickProjectForm.startDate) missing.push(t.startDate || 'Start Date');
      if (!quickProjectForm.numberOfWeeks) missing.push(t.numberOfWeeks || 'Number of Weeks');
      const title = language === 'es' ? 'Faltan datos obligatorios' : 'Required fields missing';
      const prefix = language === 'es' ? 'Completa:' : 'Please complete:';
      setFormValidationPopup({
        scope: 'quick',
        title,
        message: `${prefix} ${missing.join(', ')}`,
      });
      return;
    }

    const startDateISO = quickProjectForm.startDate;
    const numberOfWeeks = quickProjectForm.numberOfWeeks as number;
    const budgetHours = Number(quickProjectForm.budgetHours || 0);

    // Calculate end date based on start date and number of weeks
    const endDate = new Date(startDateISO);
    endDate.setDate(endDate.getDate() + (numberOfWeeks * 7) - 1);
    const endDateISO = formatToISO(endDate);

    // Build departmentStages with the selected department having a configured start date and duration
    const calculatedDepartmentStages: Record<string, any> = {
      PM: [],
      MED: [],
      HD: [],
      MFG: [],
      BUILD: [],
      PRG: [],
    };

    // Add the department that was selected in the quick project form
    calculatedDepartmentStages[dept] = [{
      stage: null,
      weekStart: 1, // Always start at week 1 of the project
      weekEnd: numberOfWeeks,
      departmentStartDate: startDateISO,
      durationWeeks: numberOfWeeks,
    }];

    const newProject = {
      id: generateId(),
      name: quickProjectForm.name,
      client: quickProjectForm.client,
      startDate: startDateISO,
      endDate: endDateISO,
      numberOfWeeks: numberOfWeeks,
      facility: quickProjectForm.facility,
      isHighProbability: !!quickProjectForm.isHighProbability,
      departmentStages: calculatedDepartmentStages,
      departmentHoursAllocated: {
        PM: 0,
        MED: 0,
        HD: 0,
        MFG: 0,
        BUILD: 0,
        PRG: 0,
        [dept]: Number.isFinite(budgetHours) ? budgetHours : 0,
      },
      departmentHoursUtilized: {
        PM: 0,
        MED: 0,
        HD: 0,
        MFG: 0,
        BUILD: 0,
        PRG: 0,
      },
      visibleInDepartments: [dept],
    };

    addProject(newProject);
    setFormValidationPopup(null);
    setShowQuickProjectModal(false);
    setQuickProjectForm({
      name: '',
      client: '',
      startDate: '',
      numberOfWeeks: '',
      facility: 'AL',
      budgetHours: '',
      isHighProbability: false,
    });
  };

  // Handle importing an existing project to the current department
  const handleImportProject = async () => {
    if (departmentFilter === 'General' || departmentFilter === 'PM') {
      return;
    }

    const dept = departmentFilter as Department;
    if (!canEditDepartment(dept)) {
      alert(language === 'es'
        ? 'No tienes permiso para importar proyectos en este departamento.'
        : 'You do not have permission to import projects in this department.');
      return;
    }

    if (!importProjectForm.projectId || !importProjectForm.startDate || !importProjectForm.numberOfWeeks) {
      const missing: string[] = [];
      if (!importProjectForm.projectId) missing.push(t.selectProject || 'Project');
      if (!importProjectForm.startDate) missing.push(t.startDate || 'Start Date');
      if (!importProjectForm.numberOfWeeks) missing.push(t.numberOfWeeks || 'Number of Weeks');
      const title = language === 'es' ? 'Faltan datos obligatorios' : 'Required fields missing';
      const prefix = language === 'es' ? 'Completa:' : 'Please complete:';
      setFormValidationPopup({
        scope: 'import',
        title,
        message: `${prefix} ${missing.join(', ')}`,
      });
      return;
    }

    const selectedProject = projects.find(p => p.id === importProjectForm.projectId);
    if (!selectedProject) {
      alert('Project not found');
      return;
    }

    const startDateISO = importProjectForm.startDate;
    const numberOfWeeks = importProjectForm.numberOfWeeks as number;
    const budgetHours = Number(importProjectForm.budgetHours || 0);

    // Build new departmentStages - add this department's configuration
    const existingStages = selectedProject.departmentStages;
    const newDepartmentStages: Record<string, any> = {
      PM: existingStages?.PM || [],
      MED: existingStages?.MED || [],
      HD: existingStages?.HD || [],
      MFG: existingStages?.MFG || [],
      BUILD: existingStages?.BUILD || [],
      PRG: existingStages?.PRG || [],
    };
    newDepartmentStages[dept] = [{
      stage: null,
      weekStart: 1,
      weekEnd: numberOfWeeks,
      departmentStartDate: startDateISO,
      durationWeeks: numberOfWeeks,
    }];

    // Build new departmentHoursAllocated - add this department's budget
    const existingHours = selectedProject.departmentHoursAllocated;
    const newDepartmentHoursAllocated: Record<string, number> = {
      PM: existingHours?.PM || 0,
      MED: existingHours?.MED || 0,
      HD: existingHours?.HD || 0,
      MFG: existingHours?.MFG || 0,
      BUILD: existingHours?.BUILD || 0,
      PRG: existingHours?.PRG || 0,
    };
    newDepartmentHoursAllocated[dept] = Number.isFinite(budgetHours) ? budgetHours : 0;

    // Build new visibleInDepartments - add this department
    const currentVisible = selectedProject.visibleInDepartments || [];
    const newVisibleInDepartments = currentVisible.includes(dept)
      ? currentVisible
      : [...currentVisible, dept];

    // Update the project
    await updateProject(selectedProject.id, {
      departmentStages: newDepartmentStages,
      departmentHoursAllocated: newDepartmentHoursAllocated,
      visibleInDepartments: newVisibleInDepartments,
    } as Partial<Project>);

    setFormValidationPopup(null);
    setShowImportProjectModal(false);
    setImportProjectForm({
      projectId: '',
      startDate: '',
      numberOfWeeks: '',
      budgetHours: '',
    });
  };

  const handleClearHighProbabilityFromDepartment = (project: Project) => {
    if (departmentFilter === 'General' || departmentFilter === 'PM') {
      return;
    }

    const dept = departmentFilter as Department;
    if (!canEditDepartment(dept)) {
      alert(
        language === 'es'
          ? 'No tienes permiso para modificar este proyecto en este departamento.'
          : 'You do not have permission to update this project in this department.'
      );
      return;
    }

    setHighProbabilityConfirmProject(project);
  };

  const confirmClearHighProbabilityFromDepartment = async () => {
    if (!highProbabilityConfirmProject) return;

    setIsClearingHighProbability(true);
    try {
      await updateProject(highProbabilityConfirmProject.id, {
      isHighProbability: false,
      });
      setHighProbabilityConfirmProject(null);
    } finally {
      setIsClearingHighProbability(false);
    }
  };

  const confirmDeleteHighProbabilityProject = async () => {
    if (!highProbabilityConfirmProject) return;

    setIsDeletingHighProbabilityProject(true);
    try {
      await deleteProject(highProbabilityConfirmProject.id);
      setHighProbabilityConfirmProject(null);
    } finally {
      setIsDeletingHighProbabilityProject(false);
    }
  };

  // Get projects that are not visible in the current department (available for import)
  const getAvailableProjectsForImport = (): Project[] => {
    const dept = departmentFilter as Department;
    return projects.filter(proj => {
      // Exclude hidden/soft-deleted projects from import options.
      if (proj.isHidden) {
        return false;
      }
      // Exclude projects that already have this department in visibleInDepartments
      if (isProjectVisibleInDepartment(proj, dept)) {
        return false;
      }
      // Exclude projects that already have departmentStages configured for this department
      if (proj.departmentStages && proj.departmentStages[dept] && proj.departmentStages[dept].length > 0) {
        return false;
      }
      return true;
    });
  };

  const getProjectZoom = (projectId: string): number => {
    return projectZooms[projectId] || 100;
  };

  const setProjectZoom = (projectId: string, zoomLevel: number) => {
    setProjectZooms((prev) => ({
      ...prev,
      [projectId]: zoomLevel,
    }));
  };

  const isGeneralView = departmentFilter === 'General';

  // In department views, project zoom follows the global zoom control.
  const getEffectiveProjectZoom = (projectId: string): number => {
    if (isGeneralView) {
      return getProjectZoom(projectId);
    }
    return zoom;
  };

  const updateProjectZoom = (projectId: string, zoomLevel: number) => {
    const boundedZoom = Math.max(50, Math.min(200, zoomLevel));
    if (isGeneralView) {
      markProjectAsActiveSyncTarget(projectId);
      setProjectZoom(projectId, boundedZoom);
      return;
    }
    setZoom(boundedZoom);
  };

  const markProjectAsActiveSyncTarget = (projectId: string | null) => {
    if (activeSyncedProjectIdRef.current === projectId) return;
    activeSyncedProjectIdRef.current = projectId;
    setActiveSyncedProjectId(projectId);
  };

  const getScrollProgress = (container: HTMLDivElement | null): number => {
    if (!container) return 0;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    if (maxScrollLeft <= 0) return 0;
    return Math.max(0, Math.min(1, container.scrollLeft / maxScrollLeft));
  };

  const setScrollProgressIfNeeded = (container: HTMLDivElement | null, progress: number) => {
    if (!container) return;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const targetScrollLeft = maxScrollLeft > 0 ? maxScrollLeft * progress : 0;
    if (Math.abs(container.scrollLeft - targetScrollLeft) > 0.5) {
      container.scrollLeft = targetScrollLeft;
    }
  };

  const resolveSyncProjectId = (preferredProjectId?: string | null): string | null => {
    if (preferredProjectId && projectTableRefs.current.has(preferredProjectId)) {
      return preferredProjectId;
    }

    const activeProjectId = activeSyncedProjectIdRef.current;
    if (activeProjectId && projectTableRefs.current.has(activeProjectId)) {
      return activeProjectId;
    }

    const visibleProjectId = projectsVisibleInCurrentView.find((proj) => projectTableRefs.current.has(proj.id))?.id;
    if (visibleProjectId) {
      return visibleProjectId;
    }

    const firstEntry = projectTableRefs.current.keys().next();
    return firstEntry.done ? null : firstEntry.value;
  };

  const syncHorizontalScrollToCanonical = (
    canonicalScrollProgress: number,
    targetProjectId?: string | null
  ) => {
    const safeCanonicalProgress = Math.max(0, Math.min(1, canonicalScrollProgress));
    syncedBaseScrollProgressRef.current = safeCanonicalProgress;

    if (isGeneralView) {
      setScrollProgressIfNeeded(generalCapacityScrollRef.current, safeCanonicalProgress);
    } else {
      setScrollProgressIfNeeded(departmentCapacityScrollRef.current, safeCanonicalProgress);
    }

    const syncProjectId = resolveSyncProjectId(targetProjectId);
    if (!syncProjectId) return;
    const container = projectTableRefs.current.get(syncProjectId);
    if (container) {
      setScrollProgressIfNeeded(container, safeCanonicalProgress);
    }
  };

  const runSyncedHorizontalScroll = (
    canonicalScrollProgress: number,
    targetProjectId?: string | null
  ) => {
    if (isSyncingHorizontalScrollRef.current) return;

    isSyncingHorizontalScrollRef.current = true;
    syncHorizontalScrollToCanonical(canonicalScrollProgress, targetProjectId);

    requestAnimationFrame(() => {
      isSyncingHorizontalScrollRef.current = false;
    });
  };

  const handleCapacityHorizontalScroll = (container: HTMLDivElement) => {
    if (isSyncingHorizontalScrollRef.current) return;
    const scrollProgress = getScrollProgress(container);
    runSyncedHorizontalScroll(scrollProgress, resolveSyncProjectId());
  };

  const handleProjectHorizontalScroll = (projectId: string, container: HTMLDivElement) => {
    if (isSyncingHorizontalScrollRef.current) return;
    if (activeSyncedProjectIdRef.current !== projectId) {
      markProjectAsActiveSyncTarget(projectId);
    }
    const scrollProgress = getScrollProgress(container);
    runSyncedHorizontalScroll(scrollProgress, projectId);
  };

  // Effect to reset scroll to first week when departmentFilter changes
  useEffect(() => {
    syncedBaseScrollProgressRef.current = 0;
    markProjectAsActiveSyncTarget(null);
    syncHorizontalScrollToCanonical(0, resolveSyncProjectId());
  }, [departmentFilter]);

  // Keep alignment after zoom changes/re-renders.
  useEffect(() => {
    syncHorizontalScrollToCanonical(syncedBaseScrollProgressRef.current, resolveSyncProjectId());
  }, [projectZooms, isGeneralView]);

  // Keep alignment when language/locale changes (text reflow can shift layout widths).
  useEffect(() => {
    const syncProjectId = resolveSyncProjectId();
    const scrollProgress = syncedBaseScrollProgressRef.current;
    const rafA = requestAnimationFrame(() => {
      syncHorizontalScrollToCanonical(scrollProgress, syncProjectId);
    });
    const rafB = requestAnimationFrame(() => {
      syncHorizontalScrollToCanonical(scrollProgress, syncProjectId);
    });

    return () => {
      cancelAnimationFrame(rafA);
      cancelAnimationFrame(rafB);
    };
  }, [language, locale, isGeneralView]);

  const activeProjectIdForCapacityZoom = useMemo(() => {
    if (!isGeneralView) return null;
    if (activeSyncedProjectId && projectsVisibleInCurrentView.some((proj) => proj.id === activeSyncedProjectId)) {
      return activeSyncedProjectId;
    }
    return projectsVisibleInCurrentView[0]?.id || null;
  }, [activeSyncedProjectId, isGeneralView, projectsVisibleInCurrentView]);

  const generalCapacityZoom = useMemo(() => {
    if (!isGeneralView) return 100;
    if (!activeProjectIdForCapacityZoom) return 100;
    return getEffectiveProjectZoom(activeProjectIdForCapacityZoom);
  }, [activeProjectIdForCapacityZoom, isGeneralView, projectZooms]);

  // Get total hours and stage for a department in a week (optionally filtered by project)
  const getDepartmentWeekData = (department: Department, weekStart: string, projectId?: string) => {
    if (!projectId) {
      const deptWeekKey = `${department}|${weekStart}`;
      const totalHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;
      return { totalHours, talent: calculateTalent(totalHours), assignments: [], stage: null, comment: undefined as string | undefined };
    }

    const cellKey = `${projectId}|${department}|${weekStart}`;
    const cellEntry = assignmentIndex.byCell.get(cellKey);
    const assignmentsForCell = cellEntry?.assignments ?? [];
    const totalHours = cellEntry?.totalHours ?? 0;
    const talent = calculateTalent(totalHours);
    const stage = cellEntry?.stage ?? (assignmentsForCell[0]?.stage ?? null);
    const comment = cellEntry?.comment ?? assignmentsForCell.find(
      (assignment) => typeof assignment.comment === 'string' && assignment.comment.trim().length > 0
    )?.comment;

    return { totalHours, talent, assignments: assignmentsForCell, stage, comment };
  };

  // Calculate utilization percentage for a department in a project
  // Formula: (Used Hours + Forecasted Hours) / (Quoted Hours + Quoted Change Orders) * 100
  // Used Hours = sum of assignments before current week (excludes current week)
  // Forecasted Hours = sum of assignments from current week onward (includes current week)
  // Quoted Hours = departmentHoursAllocated (budget)
  const getUtilizationPercent = (department: Department, projectId: string): number => {
    const project = projectById.get(projectId);
    if (!project) return 0;

    // Get utilized hours (calculated)
    const utilizedHoursValue = getUtilizedHours(department, projectId);

    // Get forecasted hours (calculated)
    const forecastedHoursValue = getForecastedHours(department, projectId);

    // Get quoted hours (budget) and quoted change orders
    const quotedHours = project.departmentHoursAllocated?.[department] || 0;
    const quotedChangeOrders = getQuotedChangeOrders(department, projectId);
    const totalPlanned = utilizedHoursValue + forecastedHoursValue;
    const totalQuoted = quotedHours + quotedChangeOrders;
    if (totalQuoted === 0) {
      return totalPlanned > 0 ? 100 : 0;
    }

    return Math.round((totalPlanned / totalQuoted) * 100);
  };

  // Get utilized hours (calculated) for a department in a project
  const getUtilizedHours = (department: Department, projectId: string): number => {
    const key = `${projectId}-${department}`;
    return (hoursByProjectDeptAll[key]?.utilized ?? hoursByProjectDeptFallback[key]?.utilized ?? 0);
  };

  // Get forecasted hours (calculated) for a department in a project
  const getForecastedHours = (department: Department, projectId: string): number => {
    const key = `${projectId}-${department}`;
    return (hoursByProjectDeptAll[key]?.forecast ?? hoursByProjectDeptFallback[key]?.forecast ?? 0);
  };

  // Get quoted hours (budget) for a department in a project
  const getQuotedHours = (department: Department, projectId: string): number => {
    const project = projectById.get(projectId);
    const quotedHours = project?.departmentHoursAllocated?.[department] || 0;
    if (project && quotedHours === 0) {
      console.log(`[getQuotedHours] Project ${project.name}, Dept ${department}: ${quotedHours}`, {
        projectId,
        departmentHoursAllocated: project.departmentHoursAllocated
      });
    }
    return quotedHours;
  };

  const getQuotedChangeOrders = (department: Department, projectId: string): number => {
    const summary = changeOrderSummaryByProjectDept.get(`${projectId}|${department}`);
    return summary?.totalHours || 0;
  };

  const getChangeOrderSummary = (department: Department, projectId: string) => {
    return changeOrderSummaryByProjectDept.get(`${projectId}|${department}`) || { totalHours: 0, count: 0, orders: [] as ProjectChangeOrder[] };
  };

  const getChangeOrdersForProjectDept = (department: Department, projectId?: string) => {
    if (!projectId) return [] as ProjectChangeOrder[];
    return getChangeOrderSummary(department, projectId).orders || [];
  };

  const formatHours = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 1000) / 1000;
    return rounded.toFixed(3).replace(/\.?0+$/, '');
  };

  const renderProjectDepartmentSummaryCard = (projectId: string, dept: Department, isMobile = false) => {
    const quotedHoursValue = getQuotedHours(dept, projectId);
    const quotedChangeOrdersValue = getQuotedChangeOrders(dept, projectId);
    const totalQuotedHoursValue = quotedHoursValue + quotedChangeOrdersValue;
    const utilizedHoursValue = getUtilizedHours(dept, projectId);
    const forecastedHoursValue = getForecastedHours(dept, projectId);
    const utilizationPercent = getUtilizationPercent(dept, projectId);
    const utilizationColorInfo = getUtilizationColor(utilizationPercent);
    const deptInfo = getDepartmentIcon(dept);
    const deptLabel = getDepartmentLabel(dept, t);
    const showDepartmentLongLabel = departmentFilter !== 'General';
    const departmentTitleLabel = showDepartmentLongLabel ? deptLabel : dept;
    const cardWidthClass = isMobile ? 'w-[268px]' : 'w-full';
    const quotedCompactLabel = language === 'es' ? 'Cot' : 'Qtd';
    const usedCompactLabel = language === 'es' ? 'Usa' : 'Used';
    const forecastCompactLabel = language === 'es' ? 'Pron' : 'Fcst';

    return (
      <div
        key={dept}
        className={`${cardWidthClass} bg-gradient-to-br from-blue-50 to-indigo-50 rounded-md px-1.5 py-1 border border-gray-200`}
        title={`${departmentTitleLabel}
${t.quotedLabel}: ${formatHours(totalQuotedHoursValue)}h (CO ${formatHours(quotedChangeOrdersValue)}h)
${t.usedLabel}: ${formatHours(utilizedHoursValue)}h
${t.pronosticado}: ${formatHours(forecastedHoursValue)}h
${t.utilizationLabel}: ${utilizationPercent}%`}
      >
        <div className="flex items-center gap-0.5 min-w-0">
          <div className="flex items-center justify-center gap-0.5 rounded bg-white/80 border border-slate-300 px-1 py-0.5 shrink-0 min-w-[52px]">
            <span className={`inline-flex items-center justify-center scale-[0.72] leading-none ${deptInfo.color}`}>{deptInfo.icon}</span>
            <span className="text-[9px] font-bold text-gray-800 leading-none">{dept}</span>
          </div>

          <div className="flex items-center gap-0.5 min-w-0 flex-1">
            <div className="rounded bg-slate-100 border border-slate-300 px-1 py-0.5 text-slate-700 min-w-[54px] text-center leading-none">
              <div className="text-[7px] font-semibold">{quotedCompactLabel}</div>
              <div className="text-[9px] font-bold mt-0.5">{formatHours(totalQuotedHoursValue)}h</div>
            </div>
            <div className="rounded bg-slate-100 border border-slate-300 px-1 py-0.5 text-slate-700 min-w-[54px] text-center leading-none">
              <div className="text-[7px] font-semibold">{usedCompactLabel}</div>
              <div className="text-[9px] font-bold mt-0.5">{formatHours(utilizedHoursValue)}h</div>
            </div>
            <div className="rounded bg-slate-100 border border-slate-300 px-1 py-0.5 text-slate-700 min-w-[54px] text-center leading-none">
              <div className="text-[7px] font-semibold">{forecastCompactLabel}</div>
              <div className="text-[9px] font-bold mt-0.5">{formatHours(forecastedHoursValue)}h</div>
            </div>
          </div>

          <div className={`rounded px-1 py-1 text-[9px] font-black leading-none text-center flex items-center justify-center shrink-0 min-w-[42px] ${utilizationColorInfo.bg} ${utilizationColorInfo.text}`}>
            {utilizationPercent}%
          </div>
        </div>
      </div>
    );
  };

  const canEditDepartment = (department: Department): boolean => {
    if (hasFullAccess) return true;
    if (isReadOnly) return false;
    if (
      currentUserDepartment === 'OTHER' &&
      currentUserOtherDepartment === 'HEAD_ENGINEERING'
    ) {
      return HEAD_ENGINEERING_MANAGED_DEPARTMENTS.includes(department);
    }
    if (
      currentUserDepartment &&
      SHARED_EDIT_DEPARTMENTS.includes(currentUserDepartment as Department) &&
      SHARED_EDIT_DEPARTMENTS.includes(department)
    ) {
      return true;
    }
    return currentUserDepartment === department;
  };

  const canManageProjectsInCurrentDepartment =
    departmentFilter !== 'General' &&
    departmentFilter !== 'PM' &&
    canEditDepartment(departmentFilter as Department);

  const loadProjectTimingChanges = async (
    startDate = timingChangesFromDate,
    endDate = timingChangesToDate
  ) => {
    if (!startDate || !endDate) {
      setTimingChangesLogs([]);
      setTimingChangesError(language === 'es'
        ? 'Selecciona ambas fechas para consultar los cambios.'
        : 'Select both dates to query timing changes.');
      return;
    }
    if (startDate > endDate) {
      setTimingChangesLogs([]);
      setTimingChangesError(language === 'es'
        ? 'La fecha inicial no puede ser mayor a la fecha final.'
        : 'The start date cannot be greater than the end date.');
      return;
    }

    setIsTimingChangesLoading(true);
    setTimingChangesError(null);
    try {
      const response = await activityLogApi.getFiltered({
        modelName: 'Project',
        action: 'updated',
        startDate,
        endDate,
        ordering: '-created_at',
        pageSize: 500,
      });

      const rows = Array.isArray(response) ? response as ActivityLogEntry[] : [];
      const filteredRows = rows.filter((row) => {
        if (!row || row.modelName !== 'Project') return false;
        const action = (row.action || '').toLowerCase();
        if (action !== 'updated' && action !== 'update') return false;

        const updates = extractProjectUpdatePayload(row.changes);
        if (!updates) return false;
        return hasTimingDataDeep(updates);
      });

      setTimingChangesLogs(filteredRows);
    } catch (error) {
      console.error('[CapacityMatrix] Error loading project timing changes:', error);
      setTimingChangesLogs([]);
      setTimingChangesError(error instanceof Error
        ? error.message
        : (language === 'es'
            ? 'No se pudieron cargar los cambios de timing.'
            : 'Unable to load timing changes.'));
    } finally {
      setIsTimingChangesLoading(false);
    }
  };

  const openTimingChangesModal = () => {
    const defaultFromDate = `${selectedYear}-01-01`;
    const defaultToDate = `${selectedYear + 1}-12-31`;
    setTimingChangesFromDate(defaultFromDate);
    setTimingChangesToDate(defaultToDate);
    setShowTimingChangesModal(true);
    void loadProjectTimingChanges(defaultFromDate, defaultToDate);
  };

  const handleExportTimingRangeExcel = async () => {
    if (isTimingRangeExcelExporting) return;

    const startDate = timingChangesFromDate;
    const endDate = timingChangesToDate;

    if (!startDate || !endDate) {
      alert(language === 'es'
        ? 'Selecciona fecha inicial y fecha final para exportar.'
        : 'Select start and end date to export.');
      return;
    }
    if (startDate > endDate) {
      alert(language === 'es'
        ? 'La fecha inicial no puede ser mayor a la fecha final.'
        : 'Start date cannot be greater than end date.');
      return;
    }

    try {
      setIsTimingRangeExcelExporting(true);

      const response = await activityLogApi.getFiltered({
        modelName: 'Project',
        action: 'updated',
        endDate,
        ordering: 'created_at',
        pageSize: 1000,
      });

      const hasOwn = (obj: Record<string, any>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
      const toIsoDate = (value: unknown): string => {
        if (typeof value !== 'string') return '';
        return value.slice(0, 10);
      };
      const toPositiveInt = (value: unknown): number | null => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return null;
        return Math.round(num);
      };
      const addDays = (isoDate: string, days: number): string => {
        if (!isoDate) return '';
        const date = parseISODate(isoDate);
        if (Number.isNaN(date.getTime())) return '';
        date.setDate(date.getDate() + days);
        return formatToISO(date);
      };
      const diffWeeksBetween = (startIso: string, endIso: string): number | null => {
        if (!startIso || !endIso) return null;
        const start = parseISODate(startIso);
        const end = parseISODate(endIso);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
        const diffDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        return Math.floor(diffDays / 7) + 1;
      };

      interface TimingRange {
        startDate: string;
        endDate: string;
        startWeek: number | null;
        endWeek: number | null;
        durationWeeks: number | null;
      }

      interface TimingState {
        projectRange: TimingRange | null;
        departmentRanges: Partial<Record<Department, TimingRange | null>>;
      }

      interface ChangeExportRow {
        changedAt: string;
        changedBy: string;
        project: string;
        scope: string;
        beforeRange: string;
        afterRange: string;
        weeklyImpact: string;
      }

      interface WeeklyExportRow {
        changedAt: string;
        changedBy: string;
        project: string;
        scope: string;
        weekStart: string;
        cw: string;
        relativeWeek: string;
        beforeStatus: string;
        afterStatus: string;
        movement: string;
      }

      const rows = Array.isArray(response) ? response as ActivityLogEntry[] : [];
      const timingRows = rows
        .filter((row) => {
          if (!row || row.modelName !== 'Project') return false;
          const action = (row.action || '').toLowerCase();
          if (action !== 'updated' && action !== 'update') return false;
          const updates = extractProjectUpdatePayload(row.changes);
          return !!updates && hasTimingDataDeep(updates);
        })
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      if (timingRows.length === 0) {
        alert(language === 'es'
          ? 'No hay cambios de timing para exportar.'
          : 'There are no timing changes to export.');
        return;
      }

      const rangeInSelectedWindow = (createdAt: string) => {
        const day = (createdAt || '').slice(0, 10);
        return day >= startDate && day <= endDate;
      };

      const formatRangeLabel = (range: TimingRange | null): string => {
        if (!range) return language === 'es' ? 'Sin timing' : 'No timing';
        const parts: string[] = [];
        if (range.startDate || range.endDate) {
          parts.push(`${range.startDate || '-'} -> ${range.endDate || '-'}`);
        }
        if (range.startWeek !== null || range.endWeek !== null) {
          parts.push(`W${range.startWeek ?? '?'}-W${range.endWeek ?? '?'}`);
        }
        if (range.durationWeeks && range.durationWeeks > 0) {
          parts.push(`${range.durationWeeks} ${language === 'es' ? 'sem' : 'wk'}`);
        }
        return parts.length > 0 ? parts.join(' | ') : (language === 'es' ? 'Sin timing' : 'No timing');
      };

      const isSameRange = (left: TimingRange | null, right: TimingRange | null): boolean => {
        if (!left && !right) return true;
        if (!left || !right) return false;
        return (
          (left.startDate || '') === (right.startDate || '')
          && (left.endDate || '') === (right.endDate || '')
          && (left.startWeek ?? null) === (right.startWeek ?? null)
          && (left.endWeek ?? null) === (right.endWeek ?? null)
        );
      };

      const rangeContainsWeekStart = (range: TimingRange | null, weekStart: string): boolean => {
        if (!range || !range.startDate || !range.endDate || !weekStart) return false;
        const normalizedRangeStart = normalizeWeekStartDate(range.startDate);
        const normalizedRangeEnd = normalizeWeekStartDate(range.endDate);
        if (!normalizedRangeStart || !normalizedRangeEnd) return false;
        return weekStart >= normalizedRangeStart && weekStart <= normalizedRangeEnd;
      };

      const rangeContainsRelativeWeek = (range: TimingRange | null, relativeWeek: number): boolean => {
        if (!range) return false;
        if (!Number.isFinite(relativeWeek)) return false;
        if (range.startWeek === null || range.endWeek === null) return false;
        return relativeWeek >= range.startWeek && relativeWeek <= range.endWeek;
      };

      const collectWeekStartsFromRange = (range: TimingRange | null): string[] => {
        if (!range || !range.startDate || !range.endDate) return [];
        const normalizedStart = normalizeWeekStartDate(range.startDate);
        const normalizedEnd = normalizeWeekStartDate(range.endDate);
        if (!normalizedStart || !normalizedEnd || normalizedStart > normalizedEnd) return [];
        return getWeeksInRange(normalizedStart, normalizedEnd)
          .map((week) => normalizeWeekStartDate(week))
          .filter((week, idx, list) => week && list.indexOf(week) === idx);
      };

      const extractDepartmentRange = (
        stageEntriesRaw: unknown,
        projectStartDate: string
      ): TimingRange | null => {
        if (!Array.isArray(stageEntriesRaw) || stageEntriesRaw.length === 0) return null;

        let minStartDate = '';
        let maxEndDate = '';
        let minWeekStart: number | null = null;
        let maxWeekEnd: number | null = null;

        stageEntriesRaw.forEach((entryRaw) => {
          const entry = asObject(entryRaw);
          if (!entry) return;

          const weekStartNum = toPositiveInt(entry.weekStart);
          const explicitWeekEnd = toPositiveInt(entry.weekEnd);
          let durationWeeks = toPositiveInt(entry.durationWeeks);
          if (!durationWeeks && weekStartNum && explicitWeekEnd && explicitWeekEnd >= weekStartNum) {
            durationWeeks = explicitWeekEnd - weekStartNum + 1;
          }

          const inferredWeekEnd = explicitWeekEnd
            ?? ((weekStartNum && durationWeeks) ? (weekStartNum + durationWeeks - 1) : null);

          if (weekStartNum !== null && (minWeekStart === null || weekStartNum < minWeekStart)) {
            minWeekStart = weekStartNum;
          }
          if (inferredWeekEnd !== null && (maxWeekEnd === null || inferredWeekEnd > maxWeekEnd)) {
            maxWeekEnd = inferredWeekEnd;
          }

          let start = toIsoDate(entry.departmentStartDate);
          if (!start && projectStartDate && weekStartNum !== null) {
            start = addDays(projectStartDate, (weekStartNum - 1) * 7);
          }

          const effectiveDuration = durationWeeks
            ?? ((weekStartNum !== null && inferredWeekEnd !== null && inferredWeekEnd >= weekStartNum)
              ? (inferredWeekEnd - weekStartNum + 1)
              : null);

          if (!start || !effectiveDuration || effectiveDuration <= 0) return;

          const end = addDays(start, (effectiveDuration * 7) - 1);
          if (!end) return;

          if (!minStartDate || start < minStartDate) minStartDate = start;
          if (!maxEndDate || end > maxEndDate) maxEndDate = end;
        });

        if ((!minStartDate || !maxEndDate) && projectStartDate && minWeekStart !== null && maxWeekEnd !== null) {
          minStartDate = addDays(projectStartDate, (minWeekStart - 1) * 7);
          maxEndDate = addDays(projectStartDate, (maxWeekEnd * 7) - 1);
        }

        const durationFromDates = diffWeeksBetween(minStartDate, maxEndDate);
        const durationFromWeeks = (minWeekStart !== null && maxWeekEnd !== null)
          ? (maxWeekEnd - minWeekStart + 1)
          : null;

        return {
          startDate: minStartDate || '',
          endDate: maxEndDate || '',
          startWeek: minWeekStart,
          endWeek: maxWeekEnd,
          durationWeeks: durationFromDates ?? durationFromWeeks,
        };
      };

      const projectStates = new Map<string, TimingState>();
      const changeRows: ChangeExportRow[] = [];
      const weeklyRows: WeeklyExportRow[] = [];
      const projectScopeLabel = language === 'es' ? 'PROYECTO' : 'PROJECT';

      const buildWeeklyComparison = (
        changedAt: string,
        changedBy: string,
        projectName: string,
        scope: string,
        beforeRange: TimingRange | null,
        afterRange: TimingRange | null
      ): { added: number; removed: number } => {
        let added = 0;
        let removed = 0;

        const unionWeekStarts = new Set<string>();
        collectWeekStartsFromRange(beforeRange).forEach((week) => unionWeekStarts.add(week));
        collectWeekStartsFromRange(afterRange).forEach((week) => unionWeekStarts.add(week));

        if (unionWeekStarts.size > 0) {
          Array.from(unionWeekStarts)
            .sort((a, b) => a.localeCompare(b))
            .forEach((weekStart) => {
              const beforeActive = rangeContainsWeekStart(beforeRange, weekStart);
              const afterActive = rangeContainsWeekStart(afterRange, weekStart);
              if (beforeActive === afterActive) return;

              const movement = !beforeActive && afterActive
                ? (language === 'es' ? 'Semana agregada' : 'Week added')
                : (language === 'es' ? 'Semana removida' : 'Week removed');

              if (!beforeActive && afterActive) added += 1;
              if (beforeActive && !afterActive) removed += 1;

              weeklyRows.push({
                changedAt,
                changedBy,
                project: projectName,
                scope,
                weekStart,
                cw: `CW${getWeekNumber(weekStart)}`,
                relativeWeek: '',
                beforeStatus: beforeActive
                  ? (language === 'es' ? 'En timing' : 'In timing')
                  : (language === 'es' ? 'Fuera de timing' : 'Out of timing'),
                afterStatus: afterActive
                  ? (language === 'es' ? 'En timing' : 'In timing')
                  : (language === 'es' ? 'Fuera de timing' : 'Out of timing'),
                movement,
              });
            });
        } else {
          const weekCandidates = [
            beforeRange?.startWeek,
            beforeRange?.endWeek,
            afterRange?.startWeek,
            afterRange?.endWeek,
          ]
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);

          if (weekCandidates.length > 0) {
            const minWeek = Math.min(...weekCandidates);
            const maxWeek = Math.max(...weekCandidates);

            for (let relativeWeek = minWeek; relativeWeek <= maxWeek; relativeWeek += 1) {
              const beforeActive = rangeContainsRelativeWeek(beforeRange, relativeWeek);
              const afterActive = rangeContainsRelativeWeek(afterRange, relativeWeek);
              if (beforeActive === afterActive) continue;

              const movement = !beforeActive && afterActive
                ? (language === 'es' ? 'Semana agregada' : 'Week added')
                : (language === 'es' ? 'Semana removida' : 'Week removed');

              if (!beforeActive && afterActive) added += 1;
              if (beforeActive && !afterActive) removed += 1;

              weeklyRows.push({
                changedAt,
                changedBy,
                project: projectName,
                scope,
                weekStart: '',
                cw: '',
                relativeWeek: `W${relativeWeek}`,
                beforeStatus: beforeActive
                  ? (language === 'es' ? 'En timing' : 'In timing')
                  : (language === 'es' ? 'Fuera de timing' : 'Out of timing'),
                afterStatus: afterActive
                  ? (language === 'es' ? 'En timing' : 'In timing')
                  : (language === 'es' ? 'Fuera de timing' : 'Out of timing'),
                movement,
              });
            }
          }
        }

        return { added, removed };
      };

      timingRows.forEach((row) => {
        const updates = extractProjectUpdatePayload(row.changes);
        if (!updates) return;

        const projectId = row.objectId;
        const projectFromStore = projectById.get(projectId);
        const fallbackName = typeof updates.name === 'string' ? updates.name : '';
        const projectName = projectFromStore?.name
          || fallbackName
          || `${language === 'es' ? 'Proyecto' : 'Project'} ${projectId.slice(0, 8)}`;

        const previousState = projectStates.get(projectId) || {
          projectRange: null,
          departmentRanges: {},
        };

        const nextState: TimingState = {
          projectRange: previousState.projectRange ? { ...previousState.projectRange } : null,
          departmentRanges: { ...previousState.departmentRanges },
        };

        const projectFieldPresent =
          hasOwn(updates, 'startDate') || hasOwn(updates, 'endDate') || hasOwn(updates, 'numberOfWeeks');

        if (projectFieldPresent) {
          const fallbackStart = previousState.projectRange?.startDate || projectFromStore?.startDate || '';
          const fallbackEnd = previousState.projectRange?.endDate || projectFromStore?.endDate || '';
          const fallbackWeeks = previousState.projectRange?.durationWeeks
            ?? toPositiveInt(projectFromStore?.numberOfWeeks)
            ?? null;

          const nextStart = hasOwn(updates, 'startDate') ? toIsoDate(updates.startDate) : fallbackStart;
          let nextEnd = hasOwn(updates, 'endDate') ? toIsoDate(updates.endDate) : fallbackEnd;
          let nextWeeks = hasOwn(updates, 'numberOfWeeks') ? toPositiveInt(updates.numberOfWeeks) : fallbackWeeks;

          if (!nextEnd && nextStart && nextWeeks && nextWeeks > 0) {
            nextEnd = addDays(nextStart, (nextWeeks * 7) - 1);
          }
          if (!nextWeeks) {
            nextWeeks = diffWeeksBetween(nextStart, nextEnd);
          }

          nextState.projectRange = {
            startDate: nextStart || '',
            endDate: nextEnd || '',
            startWeek: nextWeeks ? 1 : null,
            endWeek: nextWeeks,
            durationWeeks: nextWeeks,
          };
        }

        const departmentUpdates: Partial<Record<Department, TimingRange | null>> = {};
        if (hasOwn(updates, 'departmentStages')) {
          const departmentStagesObj = asObject(updates.departmentStages);
          const projectStartForDepartment =
            nextState.projectRange?.startDate
            || previousState.projectRange?.startDate
            || projectFromStore?.startDate
            || '';

          if (!departmentStagesObj) {
            DEPARTMENTS.forEach((dept) => {
              departmentUpdates[dept] = null;
            });
          } else {
            DEPARTMENTS.forEach((dept) => {
              if (!hasOwn(departmentStagesObj, dept)) return;
              const deptEntries = departmentStagesObj[dept];
              if (!Array.isArray(deptEntries) || deptEntries.length === 0) {
                departmentUpdates[dept] = null;
                return;
              }
              departmentUpdates[dept] = extractDepartmentRange(deptEntries, projectStartForDepartment);
            });
          }
        }

        (Object.entries(departmentUpdates) as Array<[Department, TimingRange | null]>).forEach(([dept, range]) => {
          nextState.departmentRanges[dept] = range;
        });

        if (rangeInSelectedWindow(row.createdAt)) {
          const changedAt = formatTimingDateTime(row.createdAt);
          const changedBy = formatTimingUserName(row.user);

          if (projectFieldPresent && !isSameRange(previousState.projectRange, nextState.projectRange)) {
            const impact = buildWeeklyComparison(
              changedAt,
              changedBy,
              projectName,
              projectScopeLabel,
              previousState.projectRange,
              nextState.projectRange
            );
            const weeklyImpactText = impact.added === 0 && impact.removed === 0
              ? (language === 'es' ? 'Sin cambio semanal' : 'No weekly shift')
              : `${impact.added > 0 ? `+${impact.added} ${language === 'es' ? 'sem' : 'wk'}` : ''}${impact.added > 0 && impact.removed > 0 ? ' | ' : ''}${impact.removed > 0 ? `-${impact.removed} ${language === 'es' ? 'sem' : 'wk'}` : ''}`;

            changeRows.push({
              changedAt,
              changedBy,
              project: projectName,
              scope: projectScopeLabel,
              beforeRange: formatRangeLabel(previousState.projectRange),
              afterRange: formatRangeLabel(nextState.projectRange),
              weeklyImpact: weeklyImpactText,
            });
          }

          (Object.entries(departmentUpdates) as Array<[Department, TimingRange | null]>).forEach(([dept, nextRange]) => {
            const previousRange = previousState.departmentRanges[dept] ?? null;
            if (isSameRange(previousRange, nextRange)) return;

            const impact = buildWeeklyComparison(
              changedAt,
              changedBy,
              projectName,
              dept,
              previousRange,
              nextRange
            );
            const weeklyImpactText = impact.added === 0 && impact.removed === 0
              ? (language === 'es' ? 'Sin cambio semanal' : 'No weekly shift')
              : `${impact.added > 0 ? `+${impact.added} ${language === 'es' ? 'sem' : 'wk'}` : ''}${impact.added > 0 && impact.removed > 0 ? ' | ' : ''}${impact.removed > 0 ? `-${impact.removed} ${language === 'es' ? 'sem' : 'wk'}` : ''}`;

            changeRows.push({
              changedAt,
              changedBy,
              project: projectName,
              scope: dept,
              beforeRange: formatRangeLabel(previousRange),
              afterRange: formatRangeLabel(nextRange),
              weeklyImpact: weeklyImpactText,
            });
          });
        }

        projectStates.set(projectId, nextState);
      });

      if (changeRows.length === 0) {
        alert(language === 'es'
          ? 'No se detectaron cambios de timing dentro del rango seleccionado.'
          : 'No timing changes were detected in the selected range.');
        return;
      }

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const BORDER = 'D5D1DA';
      const HEADER_BG = '2E1A47';
      const HEADER_TEXT = 'FFFFFF';
      const NOTE_BG = 'F6F3FB';
      const WHITE = 'FFFFFF';

      const styleHeaderRow = (sheet: any) => {
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: HEADER_TEXT } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        headerRow.eachCell((cell: any) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
          cell.border = {
            top: { style: 'thin', color: { argb: BORDER } },
            left: { style: 'thin', color: { argb: BORDER } },
            bottom: { style: 'thin', color: { argb: BORDER } },
            right: { style: 'thin', color: { argb: BORDER } },
          };
        });
        headerRow.height = 24;
      };

      const styleDataRows = (sheet: any) => {
        sheet.eachRow((excelRow: any, rowNumber: number) => {
          if (rowNumber === 1) return;
          excelRow.eachCell((cell: any) => {
            cell.fill = cell.fill || { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
            cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            cell.border = {
              top: { style: 'thin', color: { argb: BORDER } },
              left: { style: 'thin', color: { argb: BORDER } },
              bottom: { style: 'thin', color: { argb: BORDER } },
              right: { style: 'thin', color: { argb: BORDER } },
            };
          });
        });
      };

      const changesSheet = workbook.addWorksheet(language === 'es' ? 'Cambios' : 'Changes');
      changesSheet.columns = [
        { header: language === 'es' ? 'Fecha' : 'Date', key: 'changedAt', width: 22 },
        { header: language === 'es' ? 'Usuario' : 'User', key: 'changedBy', width: 24 },
        { header: language === 'es' ? 'Proyecto' : 'Project', key: 'project', width: 30 },
        { header: language === 'es' ? 'Ambito' : 'Scope', key: 'scope', width: 12 },
        { header: language === 'es' ? 'Rango Anterior' : 'Previous Range', key: 'beforeRange', width: 34 },
        { header: language === 'es' ? 'Rango Nuevo' : 'New Range', key: 'afterRange', width: 34 },
        { header: language === 'es' ? 'Impacto Semanal' : 'Weekly Impact', key: 'weeklyImpact', width: 20 },
      ];
      changeRows.forEach((row) => changesSheet.addRow(row));
      styleHeaderRow(changesSheet);
      styleDataRows(changesSheet);
      changesSheet.views = [{ state: 'frozen', ySplit: 1 }];
      changesSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: changesSheet.columnCount },
      };

      const weeklySheet = workbook.addWorksheet(language === 'es' ? 'Comparativa Semanal' : 'Weekly Comparison');
      weeklySheet.columns = [
        { header: language === 'es' ? 'Fecha Cambio' : 'Change Date', key: 'changedAt', width: 22 },
        { header: language === 'es' ? 'Usuario' : 'User', key: 'changedBy', width: 24 },
        { header: language === 'es' ? 'Proyecto' : 'Project', key: 'project', width: 30 },
        { header: language === 'es' ? 'Ambito' : 'Scope', key: 'scope', width: 12 },
        { header: language === 'es' ? 'Semana' : 'Week Start', key: 'weekStart', width: 15 },
        { header: 'CW', key: 'cw', width: 10 },
        { header: language === 'es' ? 'Semana Relativa' : 'Relative Week', key: 'relativeWeek', width: 15 },
        { header: language === 'es' ? 'Antes' : 'Before', key: 'beforeStatus', width: 16 },
        { header: language === 'es' ? 'Despues' : 'After', key: 'afterStatus', width: 16 },
        { header: language === 'es' ? 'Movimiento' : 'Movement', key: 'movement', width: 18 },
      ];

      if (weeklyRows.length > 0) {
        weeklyRows.forEach((row) => weeklySheet.addRow(row));
      } else {
        const noteRow = weeklySheet.addRow({
          changedAt: language === 'es'
            ? 'No hubo cambios semanales detectables en este rango.'
            : 'No detectable weekly changes were found in this range.',
        });
        noteRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NOTE_BG } };
      }

      styleHeaderRow(weeklySheet);
      styleDataRows(weeklySheet);
      weeklySheet.views = [{ state: 'frozen', ySplit: 1 }];
      weeklySheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: weeklySheet.columnCount },
      };

      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = `timing-changes-weekly-${startDate}-to-${endDate}-${dateStamp}.xlsx`;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob(
        [buffer],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[CapacityMatrix] Error exporting timing range Excel:', error);
      alert(language === 'es'
        ? 'Ocurrio un error al exportar el resumen de cambios de timing.'
        : 'An error occurred while exporting timing changes.');
    } finally {
      setIsTimingRangeExcelExporting(false);
    }
  };

  const getDepartmentTotalCapacityForWeek = (department: Department, weekDate: string): number => {
    const baseCapacity = scioTeamMembers[department]?.[weekDate] || 0;
    const ptoAdjustment = scioPto[department]?.[weekDate] || 0;
    const trainingAdjustment = scioTraining[department]?.[weekDate] || 0;
    const effectiveScioCapacity = Math.max(0, baseCapacity - ptoAdjustment - trainingAdjustment);

    if (department === 'BUILD') {
      const predefinedTeams = ['AMI', 'VICER', 'ITAX', 'MCI', 'MG Electrical'];
      const activeTeamSet = new Set(activeTeams);
      const activeTeamCapacity = activeTeams.reduce((sum, company) => {
        return sum + (subcontractedPersonnel[company]?.[weekDate] || 0);
      }, 0);
      const predefinedInactiveCapacity = predefinedTeams.reduce((sum, company) => {
        if (activeTeamSet.has(company)) return sum;
        return sum + (subcontractedPersonnel[company]?.[weekDate] || 0);
      }, 0);

      return effectiveScioCapacity + activeTeamCapacity + predefinedInactiveCapacity;
    }

    if (department === 'PRG') {
      const externalTeamCapacity = prgActiveTeams.reduce((sum, team) => {
        return sum + (prgExternalPersonnel[team]?.[weekDate] || 0);
      }, 0);
      return effectiveScioCapacity + externalTeamCapacity;
    }

    return effectiveScioCapacity;
  };

  const handleExportTimelineExcel = async () => {
    if (isExportingExcel) return;

    const hasProjects = projectsVisibleInCurrentView.length > 0;
    if (!hasProjects) {
      alert(language === 'es'
        ? 'No hay proyectos visibles para exportar en Excel.'
        : 'There are no visible projects to export to Excel.');
      return;
    }

    try {
      setIsExportingExcel(true);
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();

      const BRAND_PURPLE = '2E1A47';
      const BRAND_PURPLE_SOFT = '827691';
      const BG_LIGHT = 'F6F3FB';
      const WHITE = 'FFFFFF';
      const BORDER_LIGHT = 'D5D1DA';

      const roundValue = (value: number): number => {
        if (!Number.isFinite(value)) return 0;
        return Math.round(value * 1000) / 1000;
      };

      const getColName = (colNumber: number): string => {
        let dividend = colNumber;
        let colName = '';
        while (dividend > 0) {
          const modulo = (dividend - 1) % 26;
          colName = String.fromCharCode(65 + modulo) + colName;
          dividend = Math.floor((dividend - modulo) / 26);
        }
        return colName;
      };

      const weekColStart = 3;
      const weekColEnd = weekColStart + allWeeksData.length - 1;
      const fullEndCol = getColName(weekColEnd);

      const centerCell = (cell: any) => {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      };

      const setHeaderCell = (cell: any, fill: string, fontColor = WHITE) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.font = { bold: true, color: { argb: fontColor }, size: 10 };
        centerCell(cell);
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER_LIGHT } },
          left: { style: 'thin', color: { argb: BORDER_LIGHT } },
          bottom: { style: 'thin', color: { argb: BORDER_LIGHT } },
          right: { style: 'thin', color: { argb: BORDER_LIGHT } },
        };
      };

      const setBodyCell = (cell: any, fill = WHITE, fontColor = '2E1A47') => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.font = { color: { argb: fontColor }, size: 9 };
        centerCell(cell);
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER_LIGHT } },
          left: { style: 'thin', color: { argb: BORDER_LIGHT } },
          bottom: { style: 'thin', color: { argb: BORDER_LIGHT } },
          right: { style: 'thin', color: { argb: BORDER_LIGHT } },
        };
      };

      const getUtilizationFill = (percent: number, hasCapacity: boolean): { bg: string; fg: string } => {
        if (!hasCapacity) return { bg: 'E5E7EB', fg: '374151' };
        if (percent >= 100) return { bg: 'B91C1C', fg: WHITE };
        if (percent >= 90) return { bg: 'EF4444', fg: WHITE };
        if (percent >= 70) return { bg: 'FACC15', fg: '1F2937' };
        return { bg: '86EFAC', fg: '14532D' };
      };

      const stagePalette: Record<string, { bg: string; fg: string }> = {
        SWITCH_LAYOUT_REVISION: { bg: 'DDD6FE', fg: '4C1D95' },
        CONTROLS_DESIGN: { bg: 'BFDBFE', fg: '1E3A8A' },
        CONCEPT: { bg: 'E0F2FE', fg: '0C4A6E' },
        DETAIL_DESIGN: { bg: 'CFFAFE', fg: '155E75' },
        CABINETS_FRAMES: { bg: 'DBEAFE', fg: '1D4ED8' },
        OVERALL_ASSEMBLY: { bg: 'E9D5FF', fg: '6B21A8' },
        FINE_TUNING: { bg: 'FBCFE8', fg: '9D174D' },
        OFFLINE: { bg: 'ECFCCB', fg: '3F6212' },
        ONLINE: { bg: 'DCFCE7', fg: '166534' },
        DEBUG: { bg: 'FEF3C7', fg: '92400E' },
        COMMISSIONING: { bg: 'FFEDD5', fg: '9A3412' },
        RELEASE: { bg: 'D1FAE5', fg: '065F46' },
        RED_LINES: { bg: 'FECACA', fg: '991B1B' },
        SUPPORT: { bg: 'F1F5F9', fg: '334155' },
        SUPPORT_MANUALS_FLOW_CHARTS: { bg: 'E7E5E4', fg: '57534E' },
        ROBOT_SIMULATION: { bg: 'E4E4E7', fg: '3F3F46' },
        STANDARDS_REV_PROGRAMING_CONCEPT: { bg: 'FFE4E6', fg: '9F1239' },
      };

      const hdStagePalette: Record<string, { bg: string; fg: string }> = {
        SWITCH_LAYOUT_REVISION: { bg: 'D9E1F2', fg: '111827' },
        CONTROLS_DESIGN: { bg: 'ACB9CA', fg: '111827' },
        RELEASE: { bg: '44546A', fg: WHITE },
        RED_LINES: { bg: 'FF0000', fg: WHITE },
        SUPPORT: { bg: 'F4CCCC', fg: '111827' },
      };

      const getExcelStagePalette = (stage: string, department: Department): { bg: string; fg: string } | null => {
        if (!stage) return null;
        if (department === 'HD' && hdStagePalette[stage]) {
          return hdStagePalette[stage];
        }
        return stagePalette[stage] || null;
      };

      const generatedAt = new Date().toLocaleString(language === 'es' ? 'es-ES' : 'en-US');
      const viewLabel = departmentFilter === 'General'
        ? (language === 'es' ? 'General' : 'General')
        : `${language === 'es' ? 'Departamento' : 'Department'} ${departmentFilter}`;

      const capacitySheet = workbook.addWorksheet('Capacity Tool All Sites', {
        views: [{ state: 'frozen', ySplit: 5, xSplit: 2 }],
      });

      capacitySheet.columns = [
        { width: 16 },
        { width: 18 },
        ...allWeeksData.map(() => ({ width: 10 })),
      ];

      capacitySheet.mergeCells(`A1:${fullEndCol}1`);
      const capTitleCell = capacitySheet.getCell('A1');
      capTitleCell.value = language === 'es'
        ? 'TEAM CAPACITY - CAPACITY MATRIX'
        : 'TEAM CAPACITY - CAPACITY MATRIX';
      setHeaderCell(capTitleCell, BRAND_PURPLE);
      capTitleCell.font = { ...capTitleCell.font, size: 14, bold: true };

      capacitySheet.mergeCells('A2:B2');
      const capMetaLabelCell = capacitySheet.getCell('A2');
      capMetaLabelCell.value = language === 'es' ? 'Vista / Generado' : 'View / Generated';
      setHeaderCell(capMetaLabelCell, BRAND_PURPLE_SOFT);
      capMetaLabelCell.font = { ...capMetaLabelCell.font, size: 9 };

      capacitySheet.mergeCells(`C2:${fullEndCol}2`);
      const capMetaValueCell = capacitySheet.getCell('C2');
      capMetaValueCell.value = `${viewLabel} | ${generatedAt}`;
      setBodyCell(capMetaValueCell, BG_LIGHT);
      capMetaValueCell.alignment = { vertical: 'middle', horizontal: 'left' };

      capacitySheet.getRow(3).height = 8;
      for (let col = 1; col <= weekColEnd; col += 1) {
        const spacerCell = capacitySheet.getCell(3, col);
        setBodyCell(spacerCell, WHITE);
        spacerCell.value = '';
      }

      monthSpans.forEach((monthInfo, idx) => {
        const startCol = weekColStart + monthInfo.startIdx;
        const endCol = weekColStart + monthInfo.endIdx;
        const startRef = `${getColName(startCol)}4`;
        const endRef = `${getColName(endCol)}4`;
        capacitySheet.mergeCells(`${startRef}:${endRef}`);
        const monthCell = capacitySheet.getCell(startRef);
        monthCell.value = monthInfo.month;
        setHeaderCell(monthCell, idx % 2 === 0 ? BRAND_PURPLE : 'FACC15', idx % 2 === 0 ? WHITE : '1F2937');
      });

      const capDeptHeader = capacitySheet.getCell('A5');
      capDeptHeader.value = language === 'es' ? 'Site' : 'Site';
      setHeaderCell(capDeptHeader, BRAND_PURPLE);
      const capMetricHeader = capacitySheet.getCell('B5');
      capMetricHeader.value = language === 'es' ? 'Capacity' : 'Capacity';
      setHeaderCell(capMetricHeader, BRAND_PURPLE);
      allWeeksData.forEach((weekData, index) => {
        const cell = capacitySheet.getCell(5, weekColStart + index);
        cell.value = weekData.weekNum;
        const isCurrent = index === currentDateWeekIndex;
        setHeaderCell(cell, isCurrent ? '57534E' : BRAND_PURPLE_SOFT);
      });

      let capRow = 6;
      DEPARTMENTS.forEach((dept) => {
        const deptCell = capacitySheet.getCell(capRow, 1);
        deptCell.value = dept;
        setHeaderCell(deptCell, BRAND_PURPLE_SOFT, WHITE);

        const metricCell = capacitySheet.getCell(capRow, 2);
        metricCell.value = language === 'es' ? 'Disponible' : 'Available';
        setBodyCell(metricCell, BG_LIGHT, BRAND_PURPLE);
        metricCell.font = { ...metricCell.font, bold: true };

        allWeeksData.forEach((weekData, index) => {
          const deptWeekKey = `${dept}|${weekData.date}`;
          const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;
          const isMfg = dept === 'MFG';
          const occupiedValue = isMfg ? totalWeekHours : totalWeekHours / 45;
          const totalCapacity = getDepartmentTotalCapacityForWeek(dept, weekData.date);
          const availableValue = totalCapacity > 0 ? (totalCapacity - occupiedValue) : 0;
          const utilizationPercent = totalCapacity > 0
            ? (occupiedValue / totalCapacity) * 100
            : (occupiedValue > 0 ? 100 : 0);
          const palette = getUtilizationFill(utilizationPercent, totalCapacity > 0);

          const availableCell = capacitySheet.getCell(capRow, weekColStart + index);
          availableCell.value = roundValue(availableValue);
          setBodyCell(availableCell, palette.bg, palette.fg);
        });

        capRow += 1;
      });

      const projectsSheet = workbook.addWorksheet(`${selectedYear}-MX`, {
        // Freeze between C|D (xSplit=3) and 9|10 (ySplit=9)
        views: [{ state: 'frozen', ySplit: 9, xSplit: 3 }],
      });

      projectsSheet.columns = [
        { width: 14 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
        ...allWeeksData.map(() => ({ width: 9 })),
      ];

      const projEndCol = getColName(5 + allWeeksData.length);
      projectsSheet.mergeCells(`A1:${projEndCol}1`);
      const projTitleCell = projectsSheet.getCell('A1');
      projTitleCell.value = language === 'es'
        ? 'TEAM CAPACITY - PROJECTS MATRIX'
        : 'TEAM CAPACITY - PROJECTS MATRIX';
      setHeaderCell(projTitleCell, BRAND_PURPLE);
      projTitleCell.font = { ...projTitleCell.font, size: 14, bold: true };

      projectsSheet.mergeCells(`A2:${projEndCol}2`);
      const projMetaCell = projectsSheet.getCell('A2');
      projMetaCell.value = `${viewLabel} | ${generatedAt}`;
      setBodyCell(projMetaCell, BG_LIGHT);
      projMetaCell.alignment = { vertical: 'middle', horizontal: 'left' };

      const summaryStartRow = 2;
      DEPARTMENTS.forEach((dept, deptIdx) => {
        const row = summaryStartRow + deptIdx;
        const capLabelCell = projectsSheet.getCell(row, 2);
        capLabelCell.value = deptIdx === 0 ? (language === 'es' ? 'CAPACITY' : 'CAPACITY') : '';
        setBodyCell(capLabelCell, BG_LIGHT, BRAND_PURPLE);
        capLabelCell.font = { ...capLabelCell.font, bold: true };

        const deptCell = projectsSheet.getCell(row, 3);
        deptCell.value = dept;
        setBodyCell(deptCell, BG_LIGHT, BRAND_PURPLE);
        deptCell.font = { ...deptCell.font, bold: true };

        const spacerCell = projectsSheet.getCell(row, 4);
        spacerCell.value = '';
        setBodyCell(spacerCell, BG_LIGHT, BRAND_PURPLE);

        const spacerCell2 = projectsSheet.getCell(row, 5);
        spacerCell2.value = '';
        setBodyCell(spacerCell2, BG_LIGHT, BRAND_PURPLE);

        allWeeksData.forEach((weekData, idx) => {
          const deptWeekKey = `${dept}|${weekData.date}`;
          const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;
          const occupiedValue = dept === 'MFG' ? totalWeekHours : totalWeekHours / 45;
          const totalCapacity = getDepartmentTotalCapacityForWeek(dept, weekData.date);
          const availableValue = totalCapacity > 0 ? (totalCapacity - occupiedValue) : 0;
          const utilizationPercent = totalCapacity > 0
            ? (occupiedValue / totalCapacity) * 100
            : (occupiedValue > 0 ? 100 : 0);
          const palette = getUtilizationFill(utilizationPercent, totalCapacity > 0);

          const weekCell = projectsSheet.getCell(row, 6 + idx);
          weekCell.value = roundValue(availableValue);
          setBodyCell(weekCell, palette.bg, palette.fg);
        });
      });

      const monthHeaderRow = 8;
      monthSpans.forEach((monthInfo, idx) => {
        const startCol = 6 + monthInfo.startIdx;
        const endCol = 6 + monthInfo.endIdx;
        const startRef = `${getColName(startCol)}${monthHeaderRow}`;
        const endRef = `${getColName(endCol)}${monthHeaderRow}`;
        projectsSheet.mergeCells(`${startRef}:${endRef}`);
        const monthCell = projectsSheet.getCell(startRef);
        monthCell.value = monthInfo.month;
        setHeaderCell(monthCell, idx % 2 === 0 ? BRAND_PURPLE : 'FACC15', idx % 2 === 0 ? WHITE : '1F2937');
      });

      const yearWeekRow = 9;
      const yearWeekLabelCell = projectsSheet.getCell(yearWeekRow, 2);
      yearWeekLabelCell.value = language === 'es' ? 'YEAR WEEK' : 'YEAR WEEK';
      setHeaderCell(yearWeekLabelCell, BRAND_PURPLE);
      for (let c = 1; c <= 5; c += 1) {
        if (c === 2) continue;
        const ccell = projectsSheet.getCell(yearWeekRow, c);
        ccell.value = '';
        setHeaderCell(ccell, BRAND_PURPLE);
      }
      allWeeksData.forEach((weekData, idx) => {
        const cell = projectsSheet.getCell(yearWeekRow, 6 + idx);
        cell.value = weekData.weekNum;
        setHeaderCell(cell, idx === currentDateWeekIndex ? '57534E' : BRAND_PURPLE_SOFT);
      });

      const projectWeekRow = 10;
      const projectWeekLabelCell = projectsSheet.getCell(projectWeekRow, 2);
      projectWeekLabelCell.value = language === 'es' ? 'PROJECT WEEK' : 'PROJECT WEEK';
      setHeaderCell(projectWeekLabelCell, BRAND_PURPLE);
      for (let c = 1; c <= 5; c += 1) {
        if (c === 2) continue;
        const ccell = projectsSheet.getCell(projectWeekRow, c);
        ccell.value = '';
        setHeaderCell(ccell, BRAND_PURPLE);
      }
      const quotedHeaderCell = projectsSheet.getCell(projectWeekRow, 3);
      quotedHeaderCell.value = language === 'es' ? 'Cotizado' : 'Quoted';
      setHeaderCell(quotedHeaderCell, BRAND_PURPLE_SOFT);
      const usedHeaderCell = projectsSheet.getCell(projectWeekRow, 4);
      usedHeaderCell.value = language === 'es' ? 'Usado' : 'Used';
      setHeaderCell(usedHeaderCell, BRAND_PURPLE_SOFT);
      const forecastHeaderCell = projectsSheet.getCell(projectWeekRow, 5);
      forecastHeaderCell.value = language === 'es' ? 'Pronostico' : 'Forecast';
      setHeaderCell(forecastHeaderCell, BRAND_PURPLE_SOFT);
      const firstProjectForScale = projectsVisibleInCurrentView[0];
      allWeeksData.forEach((weekData, idx) => {
        const cwCell = projectsSheet.getCell(projectWeekRow, 6 + idx);
        const weekNum = firstProjectForScale ? getProjectWeekNumber(firstProjectForScale, weekData.date) : null;
        cwCell.value = weekNum ?? '';
        setBodyCell(cwCell, BG_LIGHT, BRAND_PURPLE);
      });

      let projRow = 11;
      projectsVisibleInCurrentView.forEach((proj) => {
        projectsSheet.mergeCells(`A${projRow}:${projEndCol}${projRow}`);
        const projHeaderCell = projectsSheet.getCell(`A${projRow}`);
        const pmName = projectManagerNameById.get(proj.id) || '-';
        const weeks = projectDurationWeeksById.get(proj.id) ?? proj.numberOfWeeks ?? 0;
        projHeaderCell.value = `${proj.name} | ${weeks} ${language === 'es' ? 'semanas' : 'weeks'} | PM: ${pmName}`;
        setHeaderCell(projHeaderCell, BRAND_PURPLE_SOFT);
        projHeaderCell.alignment = { vertical: 'middle', horizontal: 'left' };
        projRow += 1;

        // Per-project week scale row (requested for every project block)
        const projectWeekRowLabelCell = projectsSheet.getCell(projRow, 2);
        projectWeekRowLabelCell.value = language === 'es' ? 'PROJECT WEEK' : 'PROJECT WEEK';
        setHeaderCell(projectWeekRowLabelCell, BRAND_PURPLE);
        for (let c = 1; c <= 5; c += 1) {
          if (c === 2) continue;
          const ccell = projectsSheet.getCell(projRow, c);
          ccell.value = '';
          setHeaderCell(ccell, BRAND_PURPLE);
        }
        allWeeksData.forEach((weekData, idx) => {
          const cwCell = projectsSheet.getCell(projRow, 6 + idx);
          const weekNum = getProjectWeekNumber(proj, weekData.date);
          cwCell.value = weekNum ?? '';
          setBodyCell(cwCell, BG_LIGHT, BRAND_PURPLE);
        });
        projRow += 1;

        DEPARTMENTS.forEach((dept) => {
          const quoted = getQuotedHours(dept, proj.id) + getQuotedChangeOrders(dept, proj.id);
          const used = getUtilizedHours(dept, proj.id);
          const forecasted = getForecastedHours(dept, proj.id);

          const deptCell = projectsSheet.getCell(projRow, 2);
          deptCell.value = dept;
          setBodyCell(deptCell, BG_LIGHT, BRAND_PURPLE);
          deptCell.font = { ...deptCell.font, bold: true };

          const quotedCell = projectsSheet.getCell(projRow, 3);
          quotedCell.value = roundValue(quoted);
          setBodyCell(quotedCell, 'EEF2FF', '1E3A8A');

          const usedCell = projectsSheet.getCell(projRow, 4);
          usedCell.value = roundValue(used);
          setBodyCell(usedCell, 'ECFDF5', '065F46');

          const forecastCell = projectsSheet.getCell(projRow, 5);
          forecastCell.value = roundValue(forecasted);
          setBodyCell(forecastCell, 'ECFDF5', '065F46');

          const deptMeta = projectDeptMetaByKey.get(`${proj.id}|${dept}`);
          const effectiveStartDate = deptMeta?.effectiveStartDate || proj.startDate;
          const effectiveEndDate = deptMeta?.effectiveEndDate || proj.endDate || proj.startDate;

          allWeeksData.forEach((weekData, idx) => {
            const week = weekData.date;
            const cellEntry = assignmentIndex.byCell.get(`${proj.id}|${dept}|${week}`);
            const totalHours = cellEntry?.totalHours ?? 0;
            const stage = cellEntry?.stage || '';
            const inDeptRange = week >= effectiveStartDate && week <= effectiveEndDate;
            const targetCell = projectsSheet.getCell(projRow, 6 + idx);

            targetCell.value = totalHours > 0 ? roundValue(totalHours) : '';
            targetCell.numFmt = '0.###';

            if (!inDeptRange) {
              setBodyCell(targetCell, 'F3F4F6', '6B7280');
            } else if (stage) {
              const palette = getExcelStagePalette(stage, dept);
              if (palette) {
                setBodyCell(targetCell, palette.bg, palette.fg);
              } else if (totalHours > 0) {
                setBodyCell(targetCell, 'DBEAFE', '1E3A8A');
              } else {
                setBodyCell(targetCell, 'ECFDF5', '065F46');
              }
            } else if (totalHours > 0) {
              setBodyCell(targetCell, 'DBEAFE', '1E3A8A');
            } else {
              setBodyCell(targetCell, 'ECFDF5', '065F46');
            }
          });

          projRow += 1;
        });

        projRow += 1;
      });

      const buildDepartmentYearSheet = (dept: Department) => {
        const sheetName = `${dept}-${selectedYear}`.slice(0, 31);
        const deptSheet = workbook.addWorksheet(sheetName, {
          views: [{ state: 'frozen', ySplit: 9, xSplit: 4 }],
        });

        const deptWeekStart = 5;
        const deptWeekEnd = deptWeekStart + allWeeksData.length - 1;
        const deptEndCol = getColName(deptWeekEnd);

        deptSheet.columns = [
          { width: 20 },
          { width: 14 },
          { width: 12 },
          { width: 10 },
          { width: 10 },
          ...allWeeksData.map(() => ({ width: 9 })),
        ];

        deptSheet.mergeCells(`A1:${deptEndCol}1`);
        const titleCell = deptSheet.getCell('A1');
        titleCell.value = `${dept} - ${selectedYear} ${language === 'es' ? 'Capacidad' : 'Capacity'}`;
        setHeaderCell(titleCell, BRAND_PURPLE);
        titleCell.font = { ...titleCell.font, size: 13, bold: true };

        deptSheet.mergeCells('A2:D2');
        const metaLabel = deptSheet.getCell('A2');
        metaLabel.value = language === 'es' ? 'Vista / Generado' : 'View / Generated';
        setHeaderCell(metaLabel, BRAND_PURPLE_SOFT);
        metaLabel.font = { ...metaLabel.font, size: 9 };

        deptSheet.mergeCells(`E2:${deptEndCol}2`);
        const metaValue = deptSheet.getCell('E2');
        metaValue.value = `${viewLabel} | ${generatedAt}`;
        setBodyCell(metaValue, BG_LIGHT);
        metaValue.alignment = { vertical: 'middle', horizontal: 'left' };

        deptSheet.getRow(3).height = 8;
        for (let col = 1; col <= deptWeekEnd; col += 1) {
          const spacerCell = deptSheet.getCell(3, col);
          setBodyCell(spacerCell, WHITE);
          spacerCell.value = '';
        }

        const setMergedLabel = (row: number, label: string) => {
          deptSheet.mergeCells(`B${row}:C${row}`);
          const labelCell = deptSheet.getCell(`B${row}`);
          labelCell.value = label;
          setBodyCell(labelCell, BG_LIGHT, BRAND_PURPLE);
          labelCell.font = { ...labelCell.font, bold: true };
        };

        setMergedLabel(3, 'TOTAL');
        setMergedLabel(4, language === 'es' ? 'IA Team Members' : 'IA Team Members');
        setMergedLabel(6, 'CAPACITY');
        setMergedLabel(8, language === 'es' ? 'MONTH' : 'MONTH');
        setMergedLabel(9, language === 'es' ? 'YEAR WEEK' : 'YEAR WEEK');
        setMergedLabel(10, language === 'es' ? 'PTO / HOLIDAY' : 'PTO / HOLIDAY');
        setMergedLabel(12, language === 'es' ? 'TRAINING / INDIRECTS' : 'TRAINING / INDIRECTS');
        setMergedLabel(14, language === 'es' ? 'PROJECT WEEK' : 'PROJECT WEEK');

        deptSheet.getCell('D3').value = language === 'es' ? 'Hours' : 'Hours';
        deptSheet.getCell('D4').value = dept === 'MFG' ? 'Hours' : 'People';
        deptSheet.getCell('D6').value = dept === 'MFG' ? 'Hours' : 'People';
        deptSheet.getCell('D11').value = language === 'es' ? 'Talent' : 'Talent';
        deptSheet.getCell('D13').value = language === 'es' ? 'Talent' : 'Talent';
        ['D3', 'D4', 'D6', 'D11', 'D13'].forEach((ref) => {
          const c = deptSheet.getCell(ref);
          setBodyCell(c, BG_LIGHT, BRAND_PURPLE);
          c.font = { ...c.font, bold: true };
        });

        monthSpans.forEach((monthInfo, idx) => {
          const startCol = deptWeekStart + monthInfo.startIdx;
          const endCol = deptWeekStart + monthInfo.endIdx;
          const startRef = `${getColName(startCol)}4`;
          const endRef = `${getColName(endCol)}4`;
          deptSheet.mergeCells(`${startRef}:${endRef}`);
          const monthCell = deptSheet.getCell(startRef);
          monthCell.value = monthInfo.month;
          setHeaderCell(monthCell, idx % 2 === 0 ? BRAND_PURPLE : 'FACC15', idx % 2 === 0 ? WHITE : '1F2937');
        });

        allWeeksData.forEach((weekData, idx) => {
          const cwCell = deptSheet.getCell(9, deptWeekStart + idx);
          cwCell.value = weekData.weekNum;
          const isCurrent = idx === currentDateWeekIndex;
          setHeaderCell(cwCell, isCurrent ? '57534E' : BRAND_PURPLE_SOFT);
        });

        allWeeksData.forEach((weekData, idx) => {
          const deptWeekKey = `${dept}|${weekData.date}`;
          const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;
          const occupiedValue = dept === 'MFG' ? totalWeekHours : totalWeekHours / 45;
          const totalCapacity = getDepartmentTotalCapacityForWeek(dept, weekData.date);
          const availableValue = totalCapacity > 0 ? (totalCapacity - occupiedValue) : 0;
          const utilizationPercent = totalCapacity > 0
            ? (occupiedValue / totalCapacity) * 100
            : (occupiedValue > 0 ? 100 : 0);
          const palette = getUtilizationFill(utilizationPercent, totalCapacity > 0);

          const usedCell = deptSheet.getCell(3, deptWeekStart + idx);
          usedCell.value = roundValue(occupiedValue);
          setBodyCell(usedCell, 'F9FAFB', '1F2937');

          const capacityCell = deptSheet.getCell(4, deptWeekStart + idx);
          capacityCell.value = roundValue(totalCapacity);
          setBodyCell(capacityCell, 'ECFDF5', '065F46');

          const availableCell = deptSheet.getCell(6, deptWeekStart + idx);
          availableCell.value = roundValue(availableValue);
          setBodyCell(availableCell, palette.bg, palette.fg);
          availableCell.font = { ...availableCell.font, bold: true };
        });

        const firstVisibleProject = projectsVisibleInCurrentView[0];
        allWeeksData.forEach((weekData, idx) => {
          const pwCell = deptSheet.getCell(14, deptWeekStart + idx);
          const pw = firstVisibleProject ? getProjectWeekNumber(firstVisibleProject, weekData.date) : null;
          pwCell.value = pw ?? '';
          setBodyCell(pwCell, BG_LIGHT, BRAND_PURPLE);
        });

        let projectRow = 15;
        projectsVisibleInCurrentView.forEach((proj) => {
          const hasDeptActivity = allWeeksData.some((weekData) => {
            const entry = assignmentIndex.byCell.get(`${proj.id}|${dept}|${weekData.date}`);
            return (entry?.totalHours ?? 0) > 0;
          });
          if (!hasDeptActivity) return;

          deptSheet.mergeCells(`B${projectRow}:C${projectRow}`);
          const projLabelCell = deptSheet.getCell(`B${projectRow}`);
          projLabelCell.value = `${proj.name}`;
          setBodyCell(projLabelCell, BG_LIGHT, BRAND_PURPLE);
          projLabelCell.font = { ...projLabelCell.font, bold: true };

          const unitCell = deptSheet.getCell(projectRow, 4);
          unitCell.value = language === 'es' ? 'Hours' : 'Hours';
          setBodyCell(unitCell, BG_LIGHT, BRAND_PURPLE);

          allWeeksData.forEach((weekData, idx) => {
            const entry = assignmentIndex.byCell.get(`${proj.id}|${dept}|${weekData.date}`);
            const totalHours = entry?.totalHours ?? 0;
            const stage = entry?.stage || '';
            const targetCell = deptSheet.getCell(projectRow, deptWeekStart + idx);
            targetCell.value = totalHours > 0 ? roundValue(totalHours) : '';
            targetCell.numFmt = '0.###';

            if (stage) {
              const palette = getExcelStagePalette(stage, dept);
              if (palette) {
                setBodyCell(targetCell, palette.bg, palette.fg);
              } else if (totalHours > 0) {
                setBodyCell(targetCell, 'DBEAFE', '1E3A8A');
              } else {
                setBodyCell(targetCell, WHITE, '1F2937');
              }
            } else if (totalHours > 0) {
              setBodyCell(targetCell, 'DBEAFE', '1E3A8A');
            } else {
              setBodyCell(targetCell, WHITE, '1F2937');
            }
          });

          const perProjectWeekRow = projectRow + 1;
          deptSheet.mergeCells(`B${perProjectWeekRow}:C${perProjectWeekRow}`);
          const perProjectWeekLabelCell = deptSheet.getCell(`B${perProjectWeekRow}`);
          perProjectWeekLabelCell.value = language === 'es' ? 'PROJECT WEEK' : 'PROJECT WEEK';
          setBodyCell(perProjectWeekLabelCell, BG_LIGHT, BRAND_PURPLE);
          perProjectWeekLabelCell.font = { ...perProjectWeekLabelCell.font, bold: true };

          const perProjectWeekUnitCell = deptSheet.getCell(perProjectWeekRow, 4);
          perProjectWeekUnitCell.value = '';
          setBodyCell(perProjectWeekUnitCell, BG_LIGHT, BRAND_PURPLE);

          allWeeksData.forEach((weekData, idx) => {
            const targetCell = deptSheet.getCell(perProjectWeekRow, deptWeekStart + idx);
            targetCell.value = getProjectWeekNumber(proj, weekData.date) ?? '';
            setBodyCell(targetCell, BG_LIGHT, BRAND_PURPLE);
          });

          projectRow += 2;
        });
      };

      DEPARTMENTS.forEach((dept) => {
        buildDepartmentYearSheet(dept);
      });

      const detailSheet = workbook.addWorksheet('DATA');
      detailSheet.columns = [
        { header: language === 'es' ? 'Proyecto ID' : 'Project ID', key: 'projectId', width: 12 },
        { header: language === 'es' ? 'Proyecto' : 'Project', key: 'projectName', width: 32 },
        { header: language === 'es' ? 'Departamento' : 'Department', key: 'department', width: 14 },
        { header: language === 'es' ? 'Semana' : 'Week', key: 'week', width: 12 },
        { header: 'CW', key: 'cw', width: 8 },
        { header: language === 'es' ? 'Semana proyecto' : 'Project week', key: 'projectWeek', width: 12 },
        { header: language === 'es' ? 'Horas' : 'Hours', key: 'hours', width: 10 },
        { header: language === 'es' ? 'Talento' : 'Talent', key: 'talent', width: 10 },
        { header: language === 'es' ? 'Etapa' : 'Stage', key: 'stage', width: 28 },
        { header: language === 'es' ? 'Comentario' : 'Comment', key: 'comment', width: 40 },
      ];

      detailSheet.getRow(1).eachCell((cell: any) => {
        setHeaderCell(cell, BRAND_PURPLE);
      });

      projectsVisibleInCurrentView.forEach((proj) => {
        DEPARTMENTS.forEach((dept) => {
          allWeeksData.forEach((weekData) => {
            const week = weekData.date;
            const cellEntry = assignmentIndex.byCell.get(`${proj.id}|${dept}|${week}`);
            const totalHours = cellEntry?.totalHours ?? 0;
            const stage = cellEntry?.stage ?? '';
            const stageLabel = stage ? getStageLabel(stage as Stage, t as Record<string, string>) : '';
            const comment = cellEntry?.comment ?? '';

            detailSheet.addRow({
              projectId: proj.id,
              projectName: proj.name,
              department: dept,
              week,
              cw: weekData.weekNum,
              projectWeek: getProjectWeekNumber(proj, week) ?? '',
              hours: roundValue(totalHours),
              talent: roundValue(calculateTalent(totalHours)),
              stage: stageLabel || stage,
              comment,
            });
          });
        });
      });

      for (let r = 2; r <= detailSheet.rowCount; r += 1) {
        const row = detailSheet.getRow(r);
        row.eachCell((cell: any) => setBodyCell(cell, WHITE, '1F2937'));
      }

      const departmentLabel = (departmentFilter === 'General' ? 'general' : departmentFilter)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = `capacity-tool-export-${departmentLabel}-${dateStamp}.xlsx`;

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob(
        [buffer],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[CapacityMatrix] Error exporting Excel:', error);
      alert(language === 'es'
        ? 'Ocurrio un error al exportar el archivo de Excel.'
        : 'An error occurred while exporting the Excel file.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const openExportPdfModal = () => {
    const firstProjectId = projectsVisibleInCurrentView[0]?.id || '';
    setPdfExportScope('single');
    setSelectedExportProjectId(firstProjectId);
    setSelectedExportProjectIds([]);
    setShowExportPdfModal(true);
  };

  const closeExportPdfModal = () => {
    if (isExportingPdf) return;
    setShowExportPdfModal(false);
  };

  const toggleExportProjectSelection = (projectId: string) => {
    setSelectedExportProjectIds((prev) => (
      prev.includes(projectId)
        ? prev.filter((id) => id !== projectId)
        : [...prev, projectId]
    ));
  };

  const selectAllExportProjects = () => {
    setSelectedExportProjectIds(projectsVisibleInCurrentView.map((proj) => proj.id));
  };

  const clearExportProjectSelection = () => {
    setSelectedExportProjectIds([]);
  };

  const handleExportTimelinePdf = async () => {
    if (isExportingPdf) return;

    const selectedProjectIdsSet = new Set(selectedExportProjectIds);
    const targetProjects = pdfExportScope === 'all'
      ? projectsVisibleInCurrentView
      : pdfExportScope === 'selected'
        ? projectsVisibleInCurrentView.filter((proj) => selectedProjectIdsSet.has(proj.id))
        : projectsVisibleInCurrentView.filter((proj) => proj.id === selectedExportProjectId);

    if (targetProjects.length === 0) {
      alert(language === 'es'
        ? 'No hay proyectos seleccionados para exportar.'
        : 'No projects selected to export.');
      return;
    }

    const previousExpandedState = new Map<string, boolean>();
    targetProjects.forEach((proj) => {
      previousExpandedState.set(proj.id, !!expandedProjects[proj.id]);
    });

    const projectsToExpand = targetProjects
      .filter((proj) => !expandedProjects[proj.id])
      .map((proj) => proj.id);

    try {
      setIsExportingPdf(true);

      if (projectsToExpand.length > 0) {
        setExpandedProjects((prev) => {
          const next = { ...prev };
          projectsToExpand.forEach((projectId) => {
            next[projectId] = true;
          });
          return next;
        });
        await new Promise((resolve) => setTimeout(resolve, 420));
      }

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a3',
      });

      let capturedCount = 0;

      const truncateText = (value: string, maxLength: number) =>
        value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 4;
      const headerHeight = 18;
      const sectionGap = 2;
      const contentY = margin + headerHeight + sectionGap;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - contentY - margin;
      const imagePadding = 1;
      const maxImageWidth = contentWidth - imagePadding * 2;
      const maxImageHeight = contentHeight - imagePadding * 2;
      const TARGET_MAX_PAGES_PER_PROJECT = 3;
      const MAX_TIMELINE_SCALE_MM_PER_PX = 0.15;
      const MIN_TIMELINE_SCALE_MM_PER_PX = 0.055;
      const generatedLabel = language === 'es'
        ? `Generado: ${new Date().toLocaleString('es-ES')}`
        : `Generated: ${new Date().toLocaleString('en-US')}`;

      const renderProjectPageHeader = (project: Project, sectionLabel?: string) => {
        const weeks = projectDurationWeeksById.get(project.id) ?? project.numberOfWeeks;
        const pmName = project.projectManagerId
          ? (projectManagerNameById.get(project.id) || 'PM')
          : (language === 'es' ? 'Sin PM' : 'No PM');
        const viewLabel = departmentFilter === 'General'
          ? (language === 'es' ? 'Vista General' : 'General View')
          : `${language === 'es' ? 'Departamento' : 'Department'}: ${departmentFilter}`;

        pdf.setFillColor(245, 247, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');

        pdf.setFillColor(37, 99, 235);
        pdf.roundedRect(margin, margin, contentWidth, headerHeight, 3, 3, 'F');

        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(15);
        pdf.text(truncateText(project.name || 'Project', 80), margin + 4, margin + 7.5);

        const subtitle = `${project.client || '-'}  |  ${weeks} ${language === 'es' ? 'semanas' : 'weeks'}  |  PM: ${pmName}  |  ${viewLabel}`;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.text(truncateText(subtitle, 150), margin + 4, margin + 14.5);

        pdf.setFontSize(8.5);
        const generatedLabelWidth = pdf.getTextWidth(generatedLabel) + 6;
        const generatedLabelX = pageWidth - margin - generatedLabelWidth;
        pdf.setFillColor(219, 234, 254);
        pdf.roundedRect(generatedLabelX, margin + 2.2, generatedLabelWidth, 5.8, 2, 2, 'F');
        pdf.setTextColor(29, 78, 216);
        pdf.text(generatedLabel, generatedLabelX + 3, margin + 6.2);

        if (sectionLabel) {
          const sectionWidth = pdf.getTextWidth(sectionLabel) + 6;
          const sectionX = pageWidth - margin - sectionWidth;
          pdf.setFillColor(191, 219, 254);
          pdf.roundedRect(sectionX, margin + 9.2, sectionWidth, 5.8, 2, 2, 'F');
          pdf.setTextColor(30, 64, 175);
          pdf.text(sectionLabel, sectionX + 3, margin + 13.2);
        }

        pdf.setDrawColor(191, 219, 254);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(margin, contentY, contentWidth, contentHeight, 2, 2, 'S');
      };

      for (const project of targetProjects) {
        const timelineContainer = projectTableRefs.current.get(project.id);
        if (!timelineContainer) continue;

        const timelineTable = timelineContainer.querySelector('table') as HTMLTableElement | null;
        if (!timelineTable) continue;
        const captureWidth = Math.max(1, Math.ceil(timelineTable.scrollWidth));
        const captureHeight = Math.max(1, Math.ceil(timelineTable.scrollHeight));

        const canvas = await html2canvas(timelineTable, {
          backgroundColor: '#ffffff',
          useCORS: true,
          scale: 2,
          logging: false,
          width: captureWidth,
          height: captureHeight,
          windowWidth: captureWidth,
          windowHeight: captureHeight,
          scrollX: 0,
          scrollY: -window.scrollY,
        });

        const fitHeightScale = maxImageHeight / canvas.height;
        const upperScale = Math.min(fitHeightScale, MAX_TIMELINE_SCALE_MM_PER_PX);
        const lowerScale = Math.min(MIN_TIMELINE_SCALE_MM_PER_PX, upperScale);
        const scaleForTargetPages = (TARGET_MAX_PAGES_PER_PROJECT * maxImageWidth) / canvas.width;
        let timelineScale = Math.min(upperScale, scaleForTargetPages);
        timelineScale = Math.max(timelineScale, lowerScale);

        const chunkWidthPx = Math.max(1, Math.floor(maxImageWidth / timelineScale));
        const totalChunks = Math.max(1, Math.ceil(canvas.width / chunkWidthPx));

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const sourceX = chunkIndex * chunkWidthPx;
          const sourceWidth = Math.min(chunkWidthPx, canvas.width - sourceX);
          const sourceHeight = canvas.height;

          const chunkCanvas = document.createElement('canvas');
          chunkCanvas.width = sourceWidth;
          chunkCanvas.height = sourceHeight;

          const chunkCtx = chunkCanvas.getContext('2d');
          if (!chunkCtx) {
            continue;
          }

          chunkCtx.drawImage(
            canvas,
            sourceX,
            0,
            sourceWidth,
            sourceHeight,
            0,
            0,
            sourceWidth,
            sourceHeight
          );

          if (capturedCount > 0) {
            pdf.addPage();
          }

          const sectionLabel = totalChunks > 1
            ? (language === 'es'
              ? `Seccion ${chunkIndex + 1}/${totalChunks}`
              : `Section ${chunkIndex + 1}/${totalChunks}`)
            : undefined;

          renderProjectPageHeader(project, sectionLabel);

          const renderWidth = sourceWidth * timelineScale;
          const renderHeight = sourceHeight * timelineScale;
          const offsetX = margin + (contentWidth - renderWidth) / 2;
          const offsetY = contentY + (contentHeight - renderHeight) / 2;

          pdf.addImage(
            chunkCanvas.toDataURL('image/png'),
            'PNG',
            offsetX,
            offsetY,
            renderWidth,
            renderHeight,
            undefined,
            'FAST'
          );

          capturedCount += 1;
        }
      }

      if (capturedCount === 0) {
        alert(language === 'es'
          ? 'No se detecto el timeline para exportar.'
          : 'Timeline could not be detected for export.');
        return;
      }

      const sanitizeFilePart = (value: string) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

      const scopeLabel = pdfExportScope === 'all'
        ? 'all-projects'
        : pdfExportScope === 'selected'
          ? `selected-${targetProjects.length}-projects`
          : sanitizeFilePart(targetProjects[0]?.name || 'project');
      const departmentLabel = sanitizeFilePart(
        departmentFilter === 'General' ? 'general' : departmentFilter
      );
      const dateStamp = new Date().toISOString().slice(0, 10);

      pdf.save(`capacity-timeline-${departmentLabel}-${scopeLabel}-${dateStamp}.pdf`);
      setShowExportPdfModal(false);
    } catch (error) {
      console.error('[CapacityMatrix] Error exporting timeline PDF:', error);
      alert(language === 'es'
        ? 'Ocurrió un error al exportar el PDF.'
        : 'An error occurred while exporting the PDF.');
    } finally {
      if (previousExpandedState.size > 0) {
        setExpandedProjects((prev) => {
          const next = { ...prev };
          previousExpandedState.forEach((isExpanded, projectId) => {
            next[projectId] = isExpanded;
          });
          return next;
        });
      }
      setIsExportingPdf(false);
    }
  };

  useEffect(() => {
    if (!editingCell) return;
    if (canEditDepartment(editingCell.department)) return;
    setEditingCell(null);
    setShowDeleteConfirm(false);
  }, [editingCell, hasFullAccess, isReadOnly, currentUserDepartment]);

  const openChangeOrderModal = (projectId: string, department: Department) => {
    setChangeOrderContext({ projectId, department });
    setChangeOrderForm({ name: '', hoursQuoted: '' });
    setIsChangeOrderModalOpen(true);
  };

  const closeChangeOrderModal = () => {
    setIsChangeOrderModalOpen(false);
    setChangeOrderContext(null);
    setChangeOrderForm({ name: '', hoursQuoted: '' });
    setIsSavingChangeOrder(false);
  };

  const handleSaveChangeOrder = async () => {
    if (!changeOrderContext) return;
    const name = changeOrderForm.name.trim();
    if (!name) {
      alert(t.changeOrderName || 'Change Order Name is required');
      return;
    }
    const hoursValue = Number(changeOrderForm.hoursQuoted);
    if (Number.isNaN(hoursValue) || hoursValue < 0) {
      alert(t.changeOrderQuotedHours || 'Quoted Hours must be a valid number');
      return;
    }

    try {
      setIsSavingChangeOrder(true);
      const created = await changeOrdersApi.create({
        projectId: changeOrderContext.projectId,
        department: changeOrderContext.department,
        name,
        hoursQuoted: hoursValue,
      });
      const projectId = (created as any)?.projectId || (created as any)?.project?.id || changeOrderContext.projectId;
      setChangeOrders((prev) => [
        ...prev,
        {
          id: (created as any)?.id,
          projectId,
          department: (created as any)?.department || changeOrderContext.department,
          name: (created as any)?.name || name,
          hoursQuoted: Number((created as any)?.hoursQuoted ?? hoursValue),
          createdAt: (created as any)?.createdAt,
          updatedAt: (created as any)?.updatedAt,
        },
      ]);
      setChangeOrderForm({ name: '', hoursQuoted: '' });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] Error saving Change Order:', errorMsg);
      alert(`Error al guardar Change Order: ${errorMsg}`);
    } finally {
      setIsSavingChangeOrder(false);
    }
  };

  // Check if a week is within a project's date range
  const isWeekInProjectRange = (weekStart: string, project: typeof projects[0]) => {
    return weekStart >= project.startDate && weekStart <= project.endDate;
  };

  // Get project-relative week number (1..N) for a given week column.
  // Returns null when the week is outside the project range.
  const getProjectWeekNumber = (project: Project, weekStart: string): number | null => {
    if (!isWeekInProjectRange(weekStart, project)) return null;

    const projectStart = parseISODate(project.startDate);
    const currentWeek = parseISODate(weekStart);
    if (Number.isNaN(projectStart.getTime()) || Number.isNaN(currentWeek.getTime())) return null;

    const weeksDiff = Math.floor((currentWeek.getTime() - projectStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return weeksDiff + 1;
  };

  const handleEditCell = (department: Department, weekStart: string, projectId?: string) => {
    if (departmentFilter === 'General') return; // No edit in General view
    if (!canEditDepartment(department)) return;

    const { totalHours, assignments: deptAssignments, stage: cellStage, comment: cellComment } = getDepartmentWeekData(department, weekStart, projectId);
    const initialStage = cellStage ?? deptAssignments.find((assignment) => assignment.stage)?.stage ?? null;
    const initialComment = (cellComment ?? deptAssignments.find(
      (assignment) => typeof assignment.comment === 'string' && assignment.comment.trim().length > 0
    )?.comment) || '';
    const availableChangeOrders = getChangeOrdersForProjectDept(department, projectId);
    const initialChangeOrderId = deptAssignments.find((assignment) => assignment.changeOrderId)?.changeOrderId || '';
    const shouldAssignToChangeOrder = !!initialChangeOrderId;

    const isSelectableModalEmployee = (emp?: Employee | null): emp is Employee =>
      !!emp &&
      emp.department === department &&
      emp.isActive &&
      !isPlaceholderEmployee(emp) &&
      !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0);

    // Initialize selected employees from existing assignments (only selectable employees visible in modal)
    const assignedEmployeeIds = new Set<string>();
    deptAssignments.forEach((assignment) => {
      const emp = employeeById.get(assignment.employeeId);
      if (assignment.hours > 0 && isSelectableModalEmployee(emp)) {
        assignedEmployeeIds.add(emp.id);
      }
    });

    // For BUILD and PRG departments, initialize SCIO and external hours separately.
    // Use the whole cell totals (sum of assignments), not only first assignment.
    let totalScioHours = 0;
    let totalExternalHours = 0;
    const canUseStagePlanner = !(department === 'BUILD' || department === 'PRG') && STAGE_OPTIONS[department].length > 0;
    let initialStageEntries: StageHoursEntry[] = [];
    let initialStageResourceHours: Record<string, StageResourceHoursEntry> = {};

    if ((department === 'BUILD' || department === 'PRG') && deptAssignments.length > 0) {
      const summedScioHours = deptAssignments.reduce((sum, assignment) => sum + (assignment.scioHours || 0), 0);
      const summedExternalHours = deptAssignments.reduce((sum, assignment) => sum + (assignment.externalHours || 0), 0);
      const summedSplitHours = summedScioHours + summedExternalHours;

      if (summedSplitHours > 0) {
        totalScioHours = Math.round(summedScioHours * 100) / 100;
        totalExternalHours = Math.round(summedExternalHours * 100) / 100;
      } else {
        // Legacy data (before split fields existed): treat all stored hours as SCIO.
        totalScioHours = totalHours;
        totalExternalHours = 0;
      }
    } else if (canUseStagePlanner) {
      const stageTotals = new Map<Exclude<Stage, null> | '', number>();
      deptAssignments.forEach((assignment) => {
        const stageKey = (assignment.stage as Exclude<Stage, null> | null) || '';
        const assignmentHours = typeof assignment.totalHours === 'number' ? assignment.totalHours : (assignment.hours || 0);
        stageTotals.set(stageKey, roundHours((stageTotals.get(stageKey) || 0) + assignmentHours));
      });

      if (stageTotals.size > 0) {
        initialStageEntries = Array.from(stageTotals.entries()).map(([stageKey, hoursValue]) =>
          createStageHoursEntry(stageKey, hoursValue)
        );
      } else if (totalHours > 0) {
        initialStageEntries = [createStageHoursEntry(initialStage as Exclude<Stage, null> | '', roundHours(totalHours))];
      }

      if (initialStageEntries.length > 0 && assignedEmployeeIds.size > 0) {
        initialStageEntries.forEach((entry) => {
          const stageKey = (entry.stage || '') as Exclude<Stage, null> | '';
          assignedEmployeeIds.forEach((employeeId) => {
            const employeeStageHours = roundHours(
              deptAssignments.reduce((sum, assignment) => {
                const assignmentStageKey = ((assignment.stage || '') as Exclude<Stage, null> | '');
                if (assignment.employeeId !== employeeId || assignmentStageKey !== stageKey) return sum;
                const assignmentHours = typeof assignment.totalHours === 'number' ? assignment.totalHours : (assignment.hours || 0);
                return sum + assignmentHours;
              }, 0)
            );
            initialStageResourceHours[createStageResourceKey(entry.id, employeeId)] = {
              hours: employeeStageHours,
              hoursInput: employeeStageHours > 0 ? `${employeeStageHours}` : '',
            };
          });
        });
      }
    }

    setEditingCell({ department, weekStart, projectId });
    setEditingHours(totalHours);
    setEditingScioHours(totalScioHours);
    setInitialScioHours(totalScioHours);
    setEditingExternalHours(totalExternalHours);
    setEditingHoursInput(totalHours ? totalHours.toString() : '');
    setEditingScioHoursInput(totalScioHours ? totalScioHours.toString() : '');
    setEditingExternalHoursInput(totalExternalHours ? totalExternalHours.toString() : '');
    setEditingStage(initialStage);
    setEditingStageEntries(initialStageEntries);
    setEditingStageResourceHours(initialStageResourceHours);
    setAssignToChangeOrder(shouldAssignToChangeOrder);
    setSelectedChangeOrderId(
      shouldAssignToChangeOrder
        ? initialChangeOrderId
        : (availableChangeOrders.length === 1 ? availableChangeOrders[0].id : '')
    );
    setEditingComment(initialComment);
    setSelectedEmployees(assignedEmployeeIds);
    setShowDeleteConfirm(false);
  };

  const handleSaveCell = async () => {
    if (!editingCell) return;
    if (!canEditDepartment(editingCell.department)) {
      alert(t.readOnlyView || 'Read-only view');
      return;
    }

    const isBuildOrPRG = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    const hasStagePlanner = !isBuildOrPRG && STAGE_OPTIONS[editingCell.department].length > 0;
    const availableChangeOrders = getChangeOrdersForProjectDept(editingCell.department, editingCell.projectId);
    const changeOrderIdToPersist = assignToChangeOrder ? (selectedChangeOrderId || null) : null;

    if (assignToChangeOrder && availableChangeOrders.length > 0 && !selectedChangeOrderId) {
      alert(language === 'es'
        ? 'Selecciona un Change Order para continuar.'
        : 'Please select a Change Order to continue.');
      return;
    }

    const targetEmployeeIds = Array.from(selectedEmployees).filter((employeeId) => {
      const emp = employeeById.get(employeeId);
      return !!emp &&
        emp.isActive &&
        !isPlaceholderEmployee(emp) &&
        !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0);
    });

    const normalizedStageEntries = hasStagePlanner
      ? Array.from(
          editingStageEntries.reduce((acc, entry) => {
            const normalizedHours = roundHours(Math.max(0, entry.hours || 0));
            if (normalizedHours <= 0) return acc;
            const stageKey = entry.stage || '';
            acc.set(stageKey, roundHours((acc.get(stageKey) || 0) + normalizedHours));
            return acc;
          }, new Map<Exclude<Stage, null> | '', number>()).entries()
        ).map(([stageKey, stageHours]) => ({
          stage: (stageKey || null) as Stage,
          hours: stageHours,
        }))
      : [];

    const stagePlanByEmployee = new Map<string, { stage: Stage; hours: number }[]>();
    if (hasStagePlanner && targetEmployeeIds.length > 0) {
      const employeeStageMap = new Map<string, Map<Exclude<Stage, null> | '', number>>();
      targetEmployeeIds.forEach((employeeId) => employeeStageMap.set(employeeId, new Map()));

      editingStageEntries.forEach((entry) => {
        const stageKey = (entry.stage || '') as Exclude<Stage, null> | '';
        targetEmployeeIds.forEach((employeeId) => {
          const hoursKey = createStageResourceKey(entry.id, employeeId);
          const specificHours = roundHours(Math.max(0, editingStageResourceHours[hoursKey]?.hours || 0));
          if (specificHours <= 0) return;
          const employeeMap = employeeStageMap.get(employeeId);
          if (!employeeMap) return;
          employeeMap.set(stageKey, roundHours((employeeMap.get(stageKey) || 0) + specificHours));
        });
      });

      employeeStageMap.forEach((stageMap, employeeId) => {
        stagePlanByEmployee.set(
          employeeId,
          Array.from(stageMap.entries()).map(([stageKey, hours]) => ({
            stage: (stageKey || null) as Stage,
            hours,
          }))
        );
      });
    }

    const totalHours = hasStagePlanner
      ? (
          targetEmployeeIds.length > 0
            ? roundHours(
                Array.from(stagePlanByEmployee.values()).reduce(
                  (sum, plan) => sum + plan.reduce((entrySum, entry) => entrySum + entry.hours, 0),
                  0
                )
              )
            : roundHours(normalizedStageEntries.reduce((sum, entry) => sum + entry.hours, 0))
        )
      : (isBuildOrPRG ? (editingScioHours + editingExternalHours) : editingHours);

    if (totalHours === 0) {
      closeEditModal();
      return;
    }

    const { assignments: deptAssignments } = getDepartmentWeekData(
      editingCell.department,
      editingCell.weekStart,
      editingCell.projectId
    );

    const resetAssignmentsToZero = async (assignmentsToReset: Assignment[]) => {
      if (assignmentsToReset.length === 0) return;
      const resetPayload: any = {
        hours: 0,
        stage: null,
        comment: '',
        changeOrderId: null,
      };
      if (isBuildOrPRG) {
        resetPayload.scioHours = 0;
        resetPayload.externalHours = 0;
      }
      await Promise.all(
        assignmentsToReset.map((assign) =>
          updateAssignment(assign.id, resetPayload, { skipRefetch: true })
        )
      );
    };

    const upsertStageAssignmentsForEmployee = async (
      employeeId: string,
      stagePlan: { stage: Stage; hours: number }[],
      sourceAssignments: Assignment[],
      assignmentsToResetCollector: Assignment[]
    ) => {
      const stageKeyFor = (stage: Stage) => (stage || '');
      const existingByStage = new Map<string, Assignment[]>();

      sourceAssignments
        .filter((assignment) => assignment.employeeId === employeeId)
        .forEach((assignment) => {
          const key = stageKeyFor((assignment.stage || null) as Stage);
          const bucket = existingByStage.get(key) || [];
          bucket.push(assignment);
          existingByStage.set(key, bucket);
        });

      for (const entry of stagePlan) {
        const stageKey = stageKeyFor(entry.stage);
        const desiredHours = roundHours(entry.hours);
        const existingBucket = existingByStage.get(stageKey) || [];
        const existingAssign = existingBucket.shift();
        existingByStage.set(stageKey, existingBucket);

        const payload: any = {
          hours: desiredHours,
          stage: entry.stage,
          comment: editingComment || undefined,
          changeOrderId: changeOrderIdToPersist,
        };

        if (existingAssign) {
          await updateAssignment(existingAssign.id, payload, { skipRefetch: true });
        } else if (editingCell.projectId) {
          await addAssignment({
            employeeId,
            projectId: editingCell.projectId,
            weekStartDate: editingCell.weekStart,
            ...payload,
          } as any);
        }
      }

      existingByStage.forEach((remaining) => {
        remaining.forEach((assignment) => assignmentsToResetCollector.push(assignment));
      });
    };

    if (targetEmployeeIds.length > 0) {
      if (hasStagePlanner) {
        const assignmentsToReset: Assignment[] = [];
        for (const employeeId of targetEmployeeIds) {
          const employeeStagePlan = stagePlanByEmployee.get(employeeId) || [];
          await upsertStageAssignmentsForEmployee(
            employeeId,
            employeeStagePlan,
            deptAssignments,
            assignmentsToReset
          );
        }

        const selectedSet = new Set(targetEmployeeIds);
        deptAssignments
          .filter((assignment) => !selectedSet.has(assignment.employeeId))
          .forEach((assignment) => assignmentsToReset.push(assignment));

        await resetAssignmentsToZero(assignmentsToReset);
      } else {
        const upsertPromises = targetEmployeeIds.map(async (employeeId) => {
          const existingAssign = deptAssignments.find((assignment) => assignment.employeeId === employeeId);
          const hoursPerEmployee = roundHours(totalHours / targetEmployeeIds.length);

          let scioHours = editingScioHours;
          let externalHours = editingExternalHours;
          if (targetEmployeeIds.length > 1) {
            scioHours = roundHours(editingScioHours / targetEmployeeIds.length);
            externalHours = roundHours(editingExternalHours / targetEmployeeIds.length);
          }

          const updateData: any = {
            hours: hoursPerEmployee,
            stage: editingStage,
            comment: editingComment || undefined,
            changeOrderId: changeOrderIdToPersist,
          };

          if (isBuildOrPRG) {
            updateData.scioHours = scioHours;
            updateData.externalHours = externalHours;
          }

          if (existingAssign) {
            await updateAssignment(existingAssign.id, updateData, { skipRefetch: true });
          } else if (editingCell.projectId) {
            await addAssignment({
              employeeId,
              projectId: editingCell.projectId,
              weekStartDate: editingCell.weekStart,
              ...updateData,
            } as any);
          }
        });
        await Promise.all(upsertPromises);

        const assignmentsToDelete = deptAssignments.filter((assignment) => !targetEmployeeIds.includes(assignment.employeeId));
        await resetAssignmentsToZero(assignmentsToDelete);
      }
    } else {
      const availableEmployee = await getOrCreatePlaceholderEmployee(editingCell.department);
      if (!availableEmployee) {
        console.error('[CapacityMatrix] No placeholder employee available for department:', editingCell.department);
        alert('No se pudo crear un recurso automatico para guardar estas horas. Intenta de nuevo.');
        return;
      }

      if (!editingCell.projectId) {
        console.error('[CapacityMatrix] No project ID available');
        alert('Error: No se encontro el ID del proyecto.');
        return;
      }

      const existingPlaceholderAssignments = deptAssignments.filter((assignment) => {
        const emp = employeeById.get(assignment.employeeId) || assignment.employee;
        return !!emp && isPlaceholderEmployee(emp);
      });
      const assignmentsToReset = deptAssignments.filter((assignment) => !existingPlaceholderAssignments.includes(assignment));

      if (hasStagePlanner) {
        await upsertStageAssignmentsForEmployee(
          availableEmployee.id,
          normalizedStageEntries,
          existingPlaceholderAssignments,
          assignmentsToReset
        );
      } else {
        const existingPlaceholderAssignment = existingPlaceholderAssignments[0];
        const placeholderUpdateData: any = {
          hours: totalHours,
          stage: editingStage,
          comment: editingComment || undefined,
          changeOrderId: changeOrderIdToPersist,
        };

        if (isBuildOrPRG) {
          placeholderUpdateData.scioHours = editingScioHours;
          placeholderUpdateData.externalHours = editingExternalHours;
        }

        if (existingPlaceholderAssignment) {
          await updateAssignment(existingPlaceholderAssignment.id, placeholderUpdateData, { skipRefetch: true });
          existingPlaceholderAssignments.slice(1).forEach((assignment) => assignmentsToReset.push(assignment));
        } else {
          await addAssignment({
            employeeId: availableEmployee.id,
            projectId: editingCell.projectId,
            weekStartDate: editingCell.weekStart,
            ...placeholderUpdateData,
          } as any);
        }
      }

      await resetAssignmentsToZero(assignmentsToReset);
    }

    closeEditModal();
    void fetchAssignments(true);
  };

  const getProjectCellKey = (projectId: string, department: Department, weekStart: string) =>
    `${projectId}|${department}|${weekStart}`;

  const selectProjectCell = (department: Department, weekStart: string, projectId?: string) => {
    if (departmentFilter === 'General' || !projectId) return;
    setSelectedProjectCell({ department, weekStart, projectId });
  };

  const copySelectedProjectCell = () => {
    if (!selectedProjectCell) return;
    const { assignments: sourceAssignments } = getDepartmentWeekData(
      selectedProjectCell.department,
      selectedProjectCell.weekStart,
      selectedProjectCell.projectId
    );

    const entries: ProjectCellClipboardEntry[] = sourceAssignments
      .map((assignment) => {
        const effectiveHours = roundHours(
          typeof assignment.totalHours === 'number' ? assignment.totalHours : (assignment.hours || 0)
        );
        return {
          employeeId: assignment.employeeId,
          hours: effectiveHours,
          stage: assignment.stage || null,
          comment: assignment.comment || '',
          scioHours: typeof assignment.scioHours === 'number' ? roundHours(assignment.scioHours) : undefined,
          externalHours: typeof assignment.externalHours === 'number' ? roundHours(assignment.externalHours) : undefined,
          changeOrderId: assignment.changeOrderId ?? null,
        };
      })
      .filter((entry) => entry.hours > 0 || (entry.scioHours || 0) > 0 || (entry.externalHours || 0) > 0);

    setProjectCellClipboard({
      source: selectedProjectCell,
      entries,
    });
  };

  const pasteIntoSelectedProjectCell = async () => {
    if (!selectedProjectCell || !projectCellClipboard) return;
    if (!canEditDepartment(selectedProjectCell.department)) return;
    if (isPastingProjectCellRef.current) return;

    const targetProjectId = selectedProjectCell.projectId;
    if (!targetProjectId) return;

    isPastingProjectCellRef.current = true;
    try {
      const isBuildOrPRG = selectedProjectCell.department === 'BUILD' || selectedProjectCell.department === 'PRG';
      const sourceIsSameProject = projectCellClipboard.source.projectId === targetProjectId;
      const availableTargetChangeOrderIds = new Set(
        getChangeOrdersForProjectDept(selectedProjectCell.department, targetProjectId).map((order) => order.id)
      );

      const resolveTargetChangeOrderId = (incomingId?: string | null): string | null => {
        if (!incomingId) return null;
        if (!sourceIsSameProject) return null;
        return availableTargetChangeOrderIds.has(incomingId) ? incomingId : null;
      };

      const normalizedEntries = new Map<string, ProjectCellClipboardEntry>();
      projectCellClipboard.entries.forEach((entry) => {
        const hours = roundHours(Math.max(0, entry.hours || 0));
        let scioHours = roundHours(Math.max(0, entry.scioHours || 0));
        let externalHours = roundHours(Math.max(0, entry.externalHours || 0));

        if (isBuildOrPRG && scioHours === 0 && externalHours === 0 && hours > 0) {
          scioHours = hours;
        }

        if (hours <= 0 && scioHours <= 0 && externalHours <= 0) return;

        const resolvedChangeOrderId = resolveTargetChangeOrderId(entry.changeOrderId);
        const stageKey = entry.stage || '';
        const mapKey = `${entry.employeeId}|${stageKey}|${resolvedChangeOrderId || ''}`;
        const existing = normalizedEntries.get(mapKey);

        if (existing) {
          existing.hours = roundHours(existing.hours + hours);
          existing.scioHours = roundHours((existing.scioHours || 0) + scioHours);
          existing.externalHours = roundHours((existing.externalHours || 0) + externalHours);
          if (!existing.comment && entry.comment) existing.comment = entry.comment;
          return;
        }

        normalizedEntries.set(mapKey, {
          employeeId: entry.employeeId,
          hours,
          stage: entry.stage || null,
          comment: entry.comment || '',
          scioHours: isBuildOrPRG ? scioHours : undefined,
          externalHours: isBuildOrPRG ? externalHours : undefined,
          changeOrderId: resolvedChangeOrderId,
        });
      });

      const { assignments: targetAssignments } = getDepartmentWeekData(
        selectedProjectCell.department,
        selectedProjectCell.weekStart,
        targetProjectId
      );

      const existingByKey = new Map<string, Assignment[]>();
      targetAssignments.forEach((assignment) => {
        const key = `${assignment.employeeId}|${assignment.stage || ''}|${assignment.changeOrderId || ''}`;
        const bucket = existingByKey.get(key) || [];
        bucket.push(assignment);
        existingByKey.set(key, bucket);
      });

      for (const [key, entry] of normalizedEntries.entries()) {
        const bucket = existingByKey.get(key) || [];
        const existingAssignment = bucket.shift();
        existingByKey.set(key, bucket);

        const payload: any = {
          hours: entry.hours,
          stage: entry.stage,
          comment: entry.comment || undefined,
          changeOrderId: entry.changeOrderId ?? null,
        };

        if (isBuildOrPRG) {
          payload.scioHours = roundHours(entry.scioHours || 0);
          payload.externalHours = roundHours(entry.externalHours || 0);
        }

        if (existingAssignment) {
          await updateAssignment(existingAssignment.id, payload, { skipRefetch: true });
        } else {
          await addAssignment({
            employeeId: entry.employeeId,
            projectId: targetProjectId,
            weekStartDate: selectedProjectCell.weekStart,
            ...payload,
          } as any);
        }
      }

      const assignmentsToReset = Array.from(existingByKey.values()).flat();
      if (assignmentsToReset.length > 0) {
        const resetPayload: any = {
          hours: 0,
          stage: null,
          comment: '',
          changeOrderId: null,
        };
        if (isBuildOrPRG) {
          resetPayload.scioHours = 0;
          resetPayload.externalHours = 0;
        }

        await Promise.all(
          assignmentsToReset.map((assignment) =>
            updateAssignment(assignment.id, resetPayload, { skipRefetch: true })
          )
        );
      }

      await fetchAssignments(true);
    } catch (error) {
      console.error('[CapacityMatrix] Error pasting project cell:', error);
    } finally {
      isPastingProjectCellRef.current = false;
    }
  };

  const clearSelectedProjectCell = async () => {
    if (!selectedProjectCell) return;
    if (!canEditDepartment(selectedProjectCell.department)) return;
    if (isPastingProjectCellRef.current) return;

    isPastingProjectCellRef.current = true;
    try {
      const { assignments: targetAssignments } = getDepartmentWeekData(
        selectedProjectCell.department,
        selectedProjectCell.weekStart,
        selectedProjectCell.projectId
      );

      if (targetAssignments.length === 0) return;

      await Promise.all(
        targetAssignments.map((assignment) =>
          deleteAssignment(assignment.id)
        )
      );

      await fetchAssignments(true);
    } catch (error) {
      console.error('[CapacityMatrix] Error clearing project cell:', error);
    } finally {
      isPastingProjectCellRef.current = false;
    }
  };

  useEffect(() => {
    if (!selectedProjectCell) return;
    if (departmentFilter === 'General') {
      setSelectedProjectCell(null);
      return;
    }
    if (!departmentProjectRowById.has(selectedProjectCell.projectId) || !weekIndexByDate.has(selectedProjectCell.weekStart)) {
      setSelectedProjectCell(null);
    }
  }, [selectedProjectCell, departmentFilter, departmentProjectRowById, weekIndexByDate]);

  useEffect(() => {
    if (departmentFilter === 'General') return;

    const handleGridKeyboard = (event: KeyboardEvent) => {
      if (editingCell) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') {
          return;
        }
      }

      if (!selectedProjectCell) return;

      const shortcutKey = event.ctrlKey || event.metaKey;
      const lowerKey = event.key.toLowerCase();

      if (shortcutKey && lowerKey === 'c') {
        event.preventDefault();
        copySelectedProjectCell();
        return;
      }

      if (shortcutKey && lowerKey === 'v') {
        event.preventDefault();
        void pasteIntoSelectedProjectCell();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !shortcutKey && !event.altKey) {
        if (canEditDepartment(selectedProjectCell.department)) {
          event.preventDefault();
          void clearSelectedProjectCell();
        }
        return;
      }

      if (event.key === 'Enter') {
        if (canEditDepartment(selectedProjectCell.department)) {
          event.preventDefault();
          handleEditCell(selectedProjectCell.department, selectedProjectCell.weekStart, selectedProjectCell.projectId);
        }
        return;
      }

      const currentRow = departmentProjectRowById.get(selectedProjectCell.projectId);
      const currentWeek = weekIndexByDate.get(selectedProjectCell.weekStart);
      if (currentRow === undefined || currentWeek === undefined) return;

      let nextRow = currentRow;
      let nextWeek = currentWeek;
      switch (event.key) {
        case 'ArrowLeft':
          nextWeek = Math.max(0, currentWeek - 1);
          break;
        case 'ArrowRight':
          nextWeek = Math.min(allWeeksData.length - 1, currentWeek + 1);
          break;
        case 'ArrowUp':
          nextRow = Math.max(0, currentRow - 1);
          break;
        case 'ArrowDown':
          nextRow = Math.min(orderedDepartmentProjects.length - 1, currentRow + 1);
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextProject = orderedDepartmentProjects[nextRow];
      const nextWeekData = allWeeksData[nextWeek];
      if (!nextProject || !nextWeekData) return;

      const nextSelection: ProjectCellSelectionState = {
        department: selectedProjectCell.department,
        projectId: nextProject.id,
        weekStart: nextWeekData.date,
      };
      setSelectedProjectCell(nextSelection);

      const nextKey = getProjectCellKey(nextProject.id, selectedProjectCell.department, nextWeekData.date);
      const nextCellEl = projectCellRefs.current.get(nextKey);
      nextCellEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    window.addEventListener('keydown', handleGridKeyboard);
    return () => window.removeEventListener('keydown', handleGridKeyboard);
  }, [
    departmentFilter,
    editingCell,
    selectedProjectCell,
    projectCellClipboard,
    orderedDepartmentProjects,
    allWeeksData,
    departmentProjectRowById,
    weekIndexByDate,
  ]);

  const renderCellContent = (department: Department, weekStart: string, project?: Project) => {
    const projectId = project?.id;
    const { totalHours, talent, stage, comment: cellComment } = getDepartmentWeekData(department, weekStart, projectId);
    const weekNum = weekDataByDate.get(weekStart)?.weekNum || 1;

    // Get project and department stage info for visual indicators
    const projectMetaKey = projectId ? `${projectId}|${department}` : '';
    const deptMeta = projectId ? projectDeptMetaByKey.get(projectMetaKey) : undefined;

    // Special case for PM: use project start date and total duration
    // PM department spans the entire project lifecycle
    const effectiveDeptStartDate = deptMeta?.effectiveStartDate || project?.startDate || '';
    const effectiveDeptEndDate = deptMeta?.effectiveEndDate || project?.endDate || project?.startDate || '';

    // Check if current week is within department range using date comparison
    const isDeptWeekInRange = !!effectiveDeptStartDate && !!effectiveDeptEndDate && weekStart >= effectiveDeptStartDate && weekStart <= effectiveDeptEndDate;
    const isDeptFirstWeek = !!effectiveDeptStartDate && weekStart === effectiveDeptStartDate;

    // Get stage color for styling
    const stageColor = stage ? getStageColor(stage, department) : null;
    const isGeneralView = departmentFilter === 'General';
    const canEdit = departmentFilter !== 'General' && canEditDepartment(departmentFilter as Department);
    const compactTalentDisplay = Math.abs(talent) < 0.0001 ? '' : talent;
    const hasCellComment = !!(cellComment && cellComment.trim().length > 0);
    const shouldRenderAsEmpty = totalHours <= 0 && !hasCellComment;

    // Get project info for tooltip
    const projectStartDate = projectId ? (projectStartDisplayById.get(projectId) || 'N/A') : 'N/A';
    const deptDisplayDate = deptMeta?.deptDisplayDate || t.notConfigured;

    // Build tooltip text, including comment if present
    let tooltipText = `${t.projectTooltip}: ${projectStartDate}\n${department}: ${deptDisplayDate}`;
    if (cellComment) {
      tooltipText += `\n\n${t.comment}: ${cellComment}`;
    }

    if (projectId && projectCellViewMode === 'compact') {
      return (
        <div
          className={`absolute inset-0 p-0.5 text-center text-xs font-semibold flex flex-col items-center justify-center group ${
            stageColor
              ? `${stageColor.bg} ${stageColor.text}`
              : isDeptWeekInRange
                ? 'bg-[#bfdbfe] text-[#1e40af]'
                : 'bg-gray-100 text-gray-500'
          } overflow-hidden ${canEdit ? 'cursor-pointer' : ''}`}
          title={tooltipText}
        >
          {cellComment && (
            <div className="absolute top-0.5 left-0.5 text-amber-600" title={cellComment}>
              <MessageCircle size={10} />
            </div>
          )}
          <div className="text-[10px] font-bold leading-tight">{compactTalentDisplay}</div>
          {canEdit && (
            <Pencil size={11} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-600" />
          )}
        </div>
      );
    }

    // Calculate consecutive week number within the department using dates
    let deptConsecutiveWeek = 0;
    if (isDeptWeekInRange && effectiveDeptStartDate) {
      const startMs = new Date(effectiveDeptStartDate).getTime();
      const currentMs = new Date(weekStart).getTime();
      const weeksDiff = Math.floor((currentMs - startMs) / (7 * 24 * 60 * 60 * 1000));
      deptConsecutiveWeek = weeksDiff + 1;
    }

    // Read-only display
    if (shouldRenderAsEmpty) {
      // Apply visual indicators for department start/duration (like General view does)
      let cellBgClass = 'bg-gray-50';
      let cellTextClass = 'text-gray-400';
      let indicatorContent = null;

      if (isDeptWeekInRange) {
        if (isDeptFirstWeek) {
          cellBgClass = 'bg-orange-100';
          cellTextClass = 'text-orange-600';
          indicatorContent = (
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-bold">{t.starts}</span>
              <span className="text-xs opacity-75">{effectiveDeptStartDate}</span>
            </div>
          );
        } else {
          cellBgClass = 'bg-[#bfdbfe]';
          cellTextClass = 'text-[#1e40af]';
          indicatorContent = (
            <div className="flex flex-col items-center gap-0.5">
              <span className="font-bold text-base">{deptConsecutiveWeek}</span>
              <span className="text-xs opacity-75">{t.sem}</span>
            </div>
          );
        }
      }

      return (
        <div
          className={`p-2 text-center text-sm h-full w-full flex flex-col items-center justify-center overflow-hidden ${canEdit ? 'cursor-pointer hover:opacity-80' : ''} ${cellBgClass} ${cellTextClass}`}
          title={canEdit ? t.clickToAdd : ''}
        >
          {indicatorContent ? (
            indicatorContent
          ) : (
            <>
              <div className="font-bold text-xs opacity-60">Week {weekNum}</div>
              <div>{canEdit ? '+ Add' : '—'}</div>
            </>
          )}
        </div>
      );
    }

    // Calculate utilization for this department in this project (only for project-specific view)
    let utilizationPercent = 0;
    let utilizationColor = null;
    if (projectId) {
      utilizationPercent = getUtilizationPercent(department, projectId);
      utilizationColor = getUtilizationColor(utilizationPercent);
    }

    return (
      <div
        className={`p-0.5 text-center text-xs font-semibold h-full w-full flex flex-col items-center justify-center group ${
          stageColor ? stageColor.bg : 'bg-blue-100'
        } ${stageColor ? stageColor.text : 'text-blue-900'} overflow-hidden`}
        title={tooltipText}
      >
        {isGeneralView ? (
          <div className="text-[10px] font-bold leading-tight">{talent}</div>
        ) : (
          <>
            <div className="text-[10px] font-bold leading-tight">{formatHours(totalHours)}h</div>
            <div className="text-[10px] opacity-75 leading-tight">{talent}</div>
          </>
        )}
        {/* Show utilization % in project-specific views */}
        {projectId && utilizationColor && (
          <div className={`text-[10px] font-bold px-1 py-0 rounded mt-0.5 leading-tight ${utilizationColor.bg} ${utilizationColor.text}`}>
            {utilizationPercent}%
          </div>
        )}
        {stage && <div className="text-[10px] opacity-60 font-normal leading-tight">{getStageLabel(stage, t as Record<string, string>)}</div>}
        {/* Comment indicator - shows when cell has a comment */}
        {cellComment && (
          <div className="absolute top-0.5 left-0.5 text-amber-600" title={cellComment}>
            <MessageCircle size={10} />
          </div>
        )}
        {/* Pencil icon for editing */}
        <Pencil size={12} className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-600" />
      </div>
    );
  };

  // Modal for editing cell
  const renderEditModal = () => {
    if (!editingCell) return null;

    const stageOptions = STAGE_OPTIONS[editingCell.department] || [];
    // Filter employees: exclude company entries (where name === subcontractCompany and capacity === 0)
    // These are company placeholders used in "Ocupacion semanal total", not actual resources
    const deptEmployees = employees.filter(emp =>
      emp.department === editingCell.department &&
      emp.isActive &&
      !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0)
    );
    const isBuildOrPRGDepartment = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    const hasStagePlanner = !isBuildOrPRGDepartment && stageOptions.length > 0;
    const selectedEmployeeList = Array.from(selectedEmployees)
      .map((empId) => employees.find((e) => e.id === empId))
      .filter((emp): emp is Employee =>
        Boolean(
          emp &&
          emp.department === editingCell.department &&
          emp.isActive &&
          !isPlaceholderEmployee(emp) &&
          !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0)
        )
      );
    const hasExternalSelected = isBuildOrPRGDepartment && selectedEmployeeList.some(
      (emp) => !!(emp?.isSubcontractedMaterial && emp?.subcontractCompany)
    );
    const hasInternalSelected = selectedEmployeeList.some(
      (emp) => !(emp?.isSubcontractedMaterial && emp?.subcontractCompany)
    );
    const selectedResourcesCount = selectedEmployeeList.length;
    const scioInputLocked = selectedEmployeeList.length > 0 && hasExternalSelected && !hasInternalSelected && initialScioHours === 0;
    const weekData = weekDataByDate.get(editingCell.weekStart);
    const weekNum = weekData?.weekNum || 1;
    const year = weekData?.isNextYear ? selectedYear + 1 : selectedYear;
    const availableChangeOrders = getChangeOrdersForProjectDept(editingCell.department, editingCell.projectId);
    const canAssignToChangeOrder = !!editingCell.projectId && availableChangeOrders.length > 0;
    const selectedChangeOrder = availableChangeOrders.find((order) => order.id === selectedChangeOrderId) || null;
    const modalTotalHours = roundHours(
      isBuildOrPRGDepartment
        ? (editingScioHours + editingExternalHours)
        : editingHours
    );
    const currentCellAssignments = getDepartmentWeekData(
      editingCell.department,
      editingCell.weekStart,
      editingCell.projectId
    ).assignments;
    const currentCellSelectedCOHours = roundHours(
      currentCellAssignments.reduce((sum, assignment) => {
        if (!selectedChangeOrderId || assignment.changeOrderId !== selectedChangeOrderId) return sum;
        return sum + (typeof assignment.totalHours === 'number' ? assignment.totalHours : (assignment.hours || 0));
      }, 0)
    );
    const selectedCOUsedHours = roundHours(
      assignments.reduce((sum, assignment) => {
        if (!selectedChangeOrderId) return sum;
        if (assignment.projectId !== editingCell.projectId) return sum;
        if (getAssignmentDepartment(assignment) !== editingCell.department) return sum;
        if (assignment.changeOrderId !== selectedChangeOrderId) return sum;
        return sum + (typeof assignment.totalHours === 'number' ? assignment.totalHours : (assignment.hours || 0));
      }, 0)
    );
    const projectedCOUsedHours = roundHours(
      assignToChangeOrder && selectedChangeOrderId
        ? (selectedCOUsedHours - currentCellSelectedCOHours + modalTotalHours)
        : selectedCOUsedHours
    );
    const projectedCORemainingHours = roundHours((selectedChangeOrder?.hoursQuoted || 0) - projectedCOUsedHours);

    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-[80]"
          onClick={closeEditModal}
        />
        {/* Modal */}
        <div className="fixed top-1/2 left-1/2 z-[90] w-[95vw] max-w-[980px] transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl border border-gray-200 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center gap-3 p-3.5 md:p-4 border-b border-gray-200 bg-white flex-shrink-0">
            <div>
              <h3 className="text-base md:text-lg font-bold text-gray-800">
                {t.editAssignment}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {t.weekAbbr} {weekNum}/{year} · {editingCell.department}
              </p>
            </div>
            <button
              onClick={closeEditModal}
              className="h-8 w-8 rounded-full border border-gray-300 text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition flex items-center justify-center"
              title={t.close || 'Close'}
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 md:p-4 bg-white">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 md:gap-4 items-start">
          {/* Hours and Stage block */}
          {isBuildOrPRGDepartment ? (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              {/* SCIO Hours input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.scioHours}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editingScioHoursInput}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const normalized = raw.replace(',', '.');
                    if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                      setEditingScioHoursInput(raw);
                      const num = normalized === '' ? 0 : Math.max(0, parseFloat(normalized) || 0);
                      setEditingScioHours(num);
                      setEditingHours(num + editingExternalHours);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveCell();
                    }
                  }}
                  disabled={scioInputLocked}
                  autoFocus
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-500"
                  placeholder="0"
                />
              </div>

              {/* External Hours input - conditionally shown based on selected external resource */}
              {selectedEmployeeList.length > 0 && hasExternalSelected && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.enterExternalHours}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editingExternalHoursInput}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const normalized = raw.replace(',', '.');
                      if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                        setEditingExternalHoursInput(raw);
                        const num = normalized === '' ? 0 : Math.max(0, parseFloat(normalized) || 0);
                        setEditingExternalHours(num);
                        setEditingHours(editingScioHours + num);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveCell();
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0"
                  />
                </div>
              )}

              {stageOptions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.stage}</label>
                  <select
                    value={(editingStage || '') as string}
                    onChange={(e) => {
                      const value = e.target.value;
                      setEditingStage(value === '' ? null : (value as Stage));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">{t.noStage}</option>
                    {stageOptions.map((stage) => (
                      <option key={stage} value={stage}>
                        {getStageLabel(stage, t as Record<string, string>)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : hasStagePlanner ? (
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.hours}</label>
                <input
                  type="text"
                  value={editingHoursInput}
                  readOnly
                  disabled
                  className="w-full border border-gray-200 bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-700 font-semibold"
                  placeholder="0"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">{t.stage}</label>
                  <button
                    type="button"
                    onClick={() => setEditingStageEntries((prev) => [...prev, createStageHoursEntry()])}
                    className="text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1 transition"
                  >
                    + {t.add || 'Add'}
                  </button>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 rounded-lg border border-gray-200 bg-white p-2">
                  {editingStageEntries.length === 0 && (
                    <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2 bg-gray-50">
                      {t.noStage}
                    </div>
                  )}
                  {editingStageEntries.map((entry) => {
                    const stageRowTotal = selectedResourcesCount > 0
                      ? roundHours(
                          selectedEmployeeList.reduce((sum, resource) => {
                            const key = createStageResourceKey(entry.id, resource.id);
                            return sum + (editingStageResourceHours[key]?.hours || 0);
                          }, 0)
                        )
                      : roundHours(entry.hours || 0);

                    return (
                      <div key={entry.id} className="space-y-2">
                        <div className="grid grid-cols-[1fr_110px_36px] gap-2">
                          <select
                            value={entry.stage}
                            onChange={(e) => {
                              const value = e.target.value as Exclude<Stage, null> | '';
                              setEditingStageEntries((prev) => prev.map((row) => (
                                row.id === entry.id ? { ...row, stage: value } : row
                              )));
                            }}
                            className="border border-gray-300 bg-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">{t.noStage}</option>
                            {stageOptions.map((stage) => (
                              <option key={stage} value={stage}>
                                {getStageLabel(stage, t as Record<string, string>)}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={selectedResourcesCount > 0 ? `${stageRowTotal || ''}` : entry.hoursInput}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => {
                              if (selectedResourcesCount > 0) return;
                              const raw = e.target.value;
                              const normalized = raw.replace(',', '.');
                              if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                const num = normalized === '' ? 0 : Math.max(0, parseFloat(normalized) || 0);
                                setEditingStageEntries((prev) => prev.map((row) => (
                                  row.id === entry.id
                                    ? { ...row, hours: num, hoursInput: raw }
                                    : row
                                )));
                              }
                            }}
                            readOnly={selectedResourcesCount > 0}
                            disabled={selectedResourcesCount > 0}
                            className="border border-gray-300 bg-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-700 disabled:font-semibold"
                            placeholder="0"
                          />
                          <button
                            type="button"
                            onClick={() => setEditingStageEntries((prev) => prev.filter((row) => row.id !== entry.id))}
                            className="text-red-600 hover:text-red-700 bg-red-50 border border-red-200 rounded-lg transition"
                            title={t.delete}
                          >
                            <X size={14} className="mx-auto" />
                          </button>
                        </div>

                        {selectedResourcesCount > 0 && (
                          <div className="ml-1 pl-2 border-l-2 border-gray-200 space-y-1.5">
                            {selectedEmployeeList.map((resource) => {
                              const resourceKey = createStageResourceKey(entry.id, resource.id);
                              const resourceData = editingStageResourceHours[resourceKey] || { hours: 0, hoursInput: '' };
                              return (
                                <div key={resourceKey} className="grid grid-cols-[1fr_92px] gap-2 items-center">
                                  <span className="text-xs text-gray-600 truncate">{resource.name}</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={resourceData.hoursInput}
                                    onFocus={(e) => e.currentTarget.select()}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      const normalized = raw.replace(',', '.');
                                      if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                        const num = normalized === '' ? 0 : Math.max(0, parseFloat(normalized) || 0);
                                        setEditingStageResourceHours((prev) => ({
                                          ...prev,
                                          [resourceKey]: {
                                            hours: num,
                                            hoursInput: raw,
                                          },
                                        }));
                                      }
                                    }}
                                    className="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="0"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.hours}</label>
              <input
                type="text"
                inputMode="decimal"
                value={editingHoursInput}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const raw = e.target.value;
                  const normalized = raw.replace(',', '.');
                  if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                    setEditingHoursInput(raw);
                    const num = normalized === '' ? 0 : Math.max(0, parseFloat(normalized) || 0);
                    setEditingHours(num);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveCell();
                  }
                }}
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>
          )}

          {canAssignToChangeOrder && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2.5">
              <label className="flex items-center gap-2 text-sm font-semibold text-amber-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignToChangeOrder}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAssignToChangeOrder(checked);
                    if (checked) {
                      if (!selectedChangeOrderId || !availableChangeOrders.some((order) => order.id === selectedChangeOrderId)) {
                        setSelectedChangeOrderId(availableChangeOrders[0]?.id || '');
                      }
                    } else {
                      setSelectedChangeOrderId('');
                    }
                  }}
                  className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                />
                <span>
                  {language === 'es' ? 'Asignar horas a Change Order' : 'Assign hours to Change Order'}
                </span>
              </label>

              {assignToChangeOrder && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-amber-900 mb-1">
                      {language === 'es' ? 'Selecciona Change Order' : 'Select Change Order'}
                    </label>
                    <select
                      value={selectedChangeOrderId}
                      onChange={(e) => setSelectedChangeOrderId(e.target.value)}
                      className="w-full border border-amber-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    >
                      <option value="">
                        {language === 'es' ? '-- Selecciona Change Order --' : '-- Select Change Order --'}
                      </option>
                      {availableChangeOrders.map((order) => (
                        <option key={order.id} value={order.id}>
                          {order.name} ({formatHours(order.hoursQuoted)}h)
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedChangeOrder && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-gray-200 bg-white px-2 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">
                          {language === 'es' ? 'Cotizado CO' : 'CO Quoted'}
                        </div>
                        <div className="text-sm font-bold text-gray-800">{formatHours(selectedChangeOrder.hoursQuoted)}h</div>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-2 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">
                          {language === 'es' ? 'Usado CO' : 'CO Used'}
                        </div>
                        <div className="text-sm font-bold text-gray-800">{formatHours(selectedCOUsedHours)}h</div>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-2 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">
                          {language === 'es' ? 'Usado (guardando)' : 'Used (after save)'}
                        </div>
                        <div className="text-sm font-bold text-gray-800">{formatHours(projectedCOUsedHours)}h</div>
                      </div>
                      <div className={`rounded-lg border px-2 py-2 ${projectedCORemainingHours < 0 ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'}`}>
                        <div className={`text-[10px] uppercase tracking-wide ${projectedCORemainingHours < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {language === 'es' ? 'Restante CO' : 'CO Remaining'}
                        </div>
                        <div className={`text-sm font-bold ${projectedCORemainingHours < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {formatHours(projectedCORemainingHours)}h
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Employee selection - Hide for MFG department */}
          {deptEmployees.length > 0 && editingCell.department !== 'MFG' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.availableResources} ({deptEmployees.length})</label>
              <div className="space-y-1.5 min-h-[120px] max-h-[34vh] overflow-y-auto bg-white p-1.5 rounded-lg border border-gray-200">
                {deptEmployees.map((emp) => {
                  const isExternal = emp.isSubcontractedMaterial && emp.subcontractCompany;
                  const isBuildOrPRG = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
                  const isSelected = selectedEmployees.has(emp.id);
                  return (
                    <label key={emp.id} className={`block cursor-pointer p-1.5 rounded-md transition border ${isExternal && isBuildOrPRG ? 'hover:bg-violet-50 bg-violet-50/50 border-violet-100' : 'hover:bg-blue-50 border-transparent hover:border-blue-100'}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const newSelected = new Set(selectedEmployees);
                            if (e.target.checked) {
                              newSelected.add(emp.id);
                            } else {
                              newSelected.delete(emp.id);
                            }
                            setSelectedEmployees(newSelected);

                            // BUILD/PRG: external hours field should only exist when an external is selected.
                            if (isBuildOrPRGDepartment) {
                              const updatedSelectedList = Array.from(newSelected)
                                .map((empId) => employees.find((e) => e.id === empId))
                                .filter(Boolean);
                              const stillHasExternal = updatedSelectedList.some(
                                (selectedEmp) => !!(selectedEmp?.isSubcontractedMaterial && selectedEmp?.subcontractCompany)
                              );
                              if (!stillHasExternal) {
                                setEditingExternalHours(0);
                                setEditingExternalHoursInput('');
                                setEditingHours(editingScioHours);
                              }
                            }
                          }}
                          className="w-4 h-4 text-blue-500 rounded cursor-pointer"
                        />
                        <span className="text-sm text-gray-700 truncate font-medium">{emp.name}</span>
                        {/* Badge showing Internal or Company name */}
                        {isBuildOrPRG && (
                          isExternal ? (
                            <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                              Ext {emp.subcontractCompany}
                            </span>
                          ) : (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              Interno
                            </span>
                          )
                        )}
                        <span className="text-xs text-gray-500 ml-auto">45{t.hoursPerSemWeek}</span>
                      </div>

                      {hasStagePlanner && isSelected && (
                        <div className="pl-6 pt-1 flex flex-wrap gap-1.5">
                          {editingStageEntries
                            .map((entry) => {
                              const key = createStageResourceKey(entry.id, emp.id);
                              const resourceHours = roundHours(editingStageResourceHours[key]?.hours || 0);
                              return { entry, resourceHours };
                            })
                            .filter(({ resourceHours }) => resourceHours > 0)
                            .map(({ entry, resourceHours }) => (
                              <span
                                key={`${emp.id}-${entry.id}`}
                                className="text-[10px] text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5"
                              >
                                {entry.stage ? getStageLabel(entry.stage as Exclude<Stage, null>, t as Record<string, string>) : t.noStage}: {formatHours(resourceHours)}h
                              </span>
                            ))}
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
              {selectedEmployeeList.length > 0 && (
                <div className="mt-2 text-xs bg-blue-50 text-blue-700 p-2 rounded border border-blue-200">
                  {(language === 'es' ? 'Seleccionados' : 'Selected')}: {selectedEmployeeList.length} {selectedEmployeeList.length !== 1 ? t.resourcesSelected : t.resourceSelected}
                </div>
              )}
            </div>
          )}

          {/* Comment input */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.comment}</label>
            <textarea
              value={editingComment}
              onChange={(e) => setEditingComment(e.target.value)}
              className="w-full min-h-[92px] border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
              placeholder={t.commentPlaceholder}
              rows={3}
            />
          </div>
            </div>

          {/* Delete Confirmation Dialog */}
          {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black/50 z-[95] flex items-center justify-center rounded-lg">
              <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4 border-2 border-red-200">
                <h3 className="text-lg font-bold text-red-700 mb-2">{t.deleteConfirm || 'Confirmar Eliminacion'}</h3>
                <p className="text-sm text-gray-700 mb-4">
                  {t.deleteAllDataConfirm || 'Estas seguro de que deseas eliminar estos datos?'}
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 transition"
                  >
                    {t.cancel}
                  </button>
                  <button
                    onClick={async () => {
                      if (!editingCell || !canEditDepartment(editingCell.department)) {
                        return;
                      }
                      setIsDeleting(true);
                      try {
                        if (editingCell) {
                          // Find and delete the assignment for this cell
                          const cellKey = `${editingCell.projectId}|${editingCell.department}|${editingCell.weekStart}`;
                          const cellAssignments = assignmentIndex.byCell.get(cellKey)?.assignments || [];

                          // Delete all assignments for this cell
                          for (const assignment of cellAssignments) {
                            try {
                              await deleteAssignment(assignment.id);
                            } catch (error) {
                              console.error('Error deleting assignment:', error);
                            }
                          }

                          // Close modals
                          closeEditModal();
                        }
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                    disabled={isDeleting}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition flex items-center gap-2"
                  >
                    {isDeleting && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                    {isDeleting ? (t.deletingData || 'Eliminando...') : (t.delete || 'Eliminar')}
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2.5 justify-between p-3 md:px-4 border-t border-gray-200 flex-shrink-0 bg-white">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition border border-red-200"
            >
              {t.delete}
            </button>
            <div className="flex gap-3">
              <button
                onClick={closeEditModal}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleSaveCell}
                className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition"
              >
                {t.save}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="brand-page-shell capacity-matrix-page h-full flex flex-col">
      {/* Edit Cell Modal */}
      {renderEditModal()}
      {/* Change Order Modal */}
      {isChangeOrderModalOpen && changeOrderContext && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[80] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border-2 border-emerald-200 w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-emerald-100">
              <div>
                <h3 className="text-lg font-bold text-emerald-800">{t.addChangeOrderBudget}</h3>
                <p className="text-xs text-gray-500">
                  {projectById.get(changeOrderContext.projectId)?.name || 'Project'} | {changeOrderContext.department}
                </p>
              </div>
              <button
                onClick={closeChangeOrderModal}
                className="text-gray-500 hover:text-gray-700 p-1 rounded"
                title={t.close || 'Close'}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{t.changeOrderName}</label>
                <input
                  type="text"
                  value={changeOrderForm.name}
                  onChange={(e) => setChangeOrderForm({ ...changeOrderForm, name: e.target.value })}
                  placeholder={t.changeOrderNamePlaceholder}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{t.changeOrderQuotedHours}</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={changeOrderForm.hoursQuoted}
                  onChange={(e) => setChangeOrderForm({ ...changeOrderForm, hoursQuoted: e.target.value })}
                  placeholder={t.changeOrderHoursPlaceholder}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={closeChangeOrderModal}
                  className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleSaveChangeOrder}
                  disabled={isSavingChangeOrder}
                  className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition disabled:opacity-60"
                >
                  {isSavingChangeOrder ? (language === 'es' ? 'Guardando...' : 'Saving...') : (t.addButton || 'Agregar')}
                </button>
              </div>

              <div className="border-t border-gray-100 pt-3">
                {(() => {
                  const summary = getChangeOrderSummary(changeOrderContext.department, changeOrderContext.projectId);
                  const sortedOrders = [...summary.orders].sort((a, b) => a.name.localeCompare(b.name));
                  return (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-700">{t.changeOrdersSummary}</span>
                        <span className="text-xs text-gray-500">CO: {summary.count}</span>
                      </div>
                      {summary.count === 0 ? (
                        <div className="text-xs text-gray-400 italic">{t.noChangeOrders}</div>
                      ) : (
                        <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-md">
                          {sortedOrders.map((order) => (
                            <div key={order.id} className="flex items-center justify-between px-2 py-1 text-xs border-b border-gray-100 last:border-b-0">
                              <span className="font-semibold text-gray-700">{order.name}</span>
                              <span className="text-emerald-700 font-bold">{formatHours(order.hoursQuoted)}h</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2 text-xs font-semibold text-emerald-700">
                        <span>{t.changeOrderTotalHours}</span>
                        <span>{formatHours(summary.totalHours)}h</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Sticky Header - Responsive */}
      <div className="sticky top-0 z-50 brand-page-header">
        <div className="px-1 py-1 flex flex-wrap items-center gap-1">
          {/* Year selector - ultra compact */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="cm-toolbar-select border border-[#d5d1da] rounded px-1 py-0.5 text-[9px] font-semibold text-[#2e1a47] bg-[#f4f1f8] hover:bg-[#ebe6f2] transition flex-shrink-0"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>

          {/* Current Week Info - ultra compact */}
          {currentDateWeekIndex >= 0 && (
            <div className="bg-gradient-to-r from-stone-600 to-zinc-700 text-white px-1.5 py-0.5 rounded-md shadow-md text-[9px] flex-shrink-0">
              <span className="font-bold">W{currentDateWeekIndex >= 0 ? allWeeksData[currentDateWeekIndex]?.weekNum : '-'}</span>
            </div>
          )}

          {/* Legend Toggle Button - ultra compact */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold rounded transition flex-shrink-0 border ${
              showLegend
                ? 'bg-[#4f3a70] text-white border-[#2e1a47]'
                : 'bg-[#2e1a47] hover:bg-[#3a2556] text-white border-[#2e1a47]'
            }`}
            title={t.toggleLegend}
          >
            <span className="font-bold">{showLegend ? '-' : '+'}</span>
            <span className="hidden sm:inline">{t.legend}</span>
          </button>

          {projectsVisibleInCurrentView.length > 0 && (
            <button
              onClick={() => setProjectCellViewMode((prev) => (prev === 'detailed' ? 'compact' : 'detailed'))}
              className={`cm-project-view-toggle inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded transition flex-shrink-0 border ${
                projectCellViewMode === 'compact'
                  ? 'bg-[#4f3a70] hover:bg-[#3f2d5d] text-white border-[#2e1a47]'
                  : 'bg-[#f4f1f8] hover:bg-[#ebe6f2] text-[#2e1a47] border-[#d5d1da]'
              }`}
              title={language === 'es' ? 'Cambiar vista de celdas de proyectos' : 'Toggle project cells view'}
            >
              <span>{language === 'es' ? 'Vista' : 'View'}:</span>
              <span className="font-bold">
                {projectCellViewMode === 'compact'
                  ? (language === 'es' ? 'Compacta' : 'Compact')
                  : (language === 'es' ? 'Detalle' : 'Detailed')}
              </span>
            </button>
          )}

          {isTimingAuditGeneralView && (
            <button
              onClick={openTimingChangesModal}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-semibold rounded transition flex-shrink-0 border border-amber-600"
              title={language === 'es' ? 'Ver cambios de timing por proyecto' : 'View project timing changes'}
            >
              <History size={10} />
              <span className="hidden sm:inline">
                {language === 'es' ? 'Cambios Timing' : 'Timing Changes'}
              </span>
            </button>
          )}

          {/* Create Project Button - Only in department view (except PM) */}
          {canManageProjectsInCurrentDepartment && (
            <button
              onClick={() => setShowQuickProjectModal(true)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#4f3a70] hover:bg-[#3f2d5d] text-white text-[9px] font-semibold rounded transition flex-shrink-0"
              title={t.createProject || 'Create Project'}
            >
              <Plus size={10} />
              <span className="hidden sm:inline">{t.createProject || 'Create'}</span>
            </button>
          )}

          {/* Import Existing Project Button - Only in department view (except PM) */}
          {canManageProjectsInCurrentDepartment && getAvailableProjectsForImport().length > 0 && (
            <button
              onClick={() => setShowImportProjectModal(true)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#827691] hover:bg-[#716381] text-white text-[9px] font-semibold rounded transition flex-shrink-0"
              title={t.importProject || 'Import Existing Project'}
            >
              <FolderPlus size={10} />
              <span className="hidden sm:inline">{t.importProject || 'Import'}</span>
            </button>
          )}

          {projectsVisibleInCurrentView.length > 0 && (
            <button
              onClick={handleExportTimelineExcel}
              disabled={isExportingExcel}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[9px] font-semibold rounded transition flex-shrink-0"
              title={language === 'es' ? 'Exportar timeline en Excel' : 'Export timeline to Excel'}
            >
              <span>XLSX</span>
              <span className="hidden sm:inline">
                {isExportingExcel
                  ? (language === 'es' ? 'Exportando...' : 'Exporting...')
                  : (language === 'es' ? 'Exportar' : 'Export')}
              </span>
            </button>
          )}

          {projectsVisibleInCurrentView.length > 0 && (
            <button
              onClick={openExportPdfModal}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#ce0037] hover:bg-[#ba0032] text-white text-[9px] font-semibold rounded transition flex-shrink-0"
              title={language === 'es' ? 'Exportar timeline en PDF' : 'Export timeline as PDF'}
            >
              <span>PDF</span>
              <span className="hidden sm:inline">{language === 'es' ? 'Exportar' : 'Export'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-2">

        {/* Tabla de Departamentos - Only show for department-specific views */}
        {departmentFilter !== 'General' && (
          <div style={{ zoom: `${zoom / 100}` }}>
            {/* Department Weekly Occupancy Summary Panel */}
            {(() => {
              const dept = departmentFilter as Department;
              const deptIcon = getDepartmentIcon(dept);

              return (
                <div className="sticky top-0 z-40 mb-2 bg-gradient-to-r from-[#f2eef8] to-[#ece7f3] border border-[#d5d1da] rounded-none p-2 shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-xs font-bold text-[#2e1a47] flex items-center gap-1">
                      <span className={deptIcon.color}>{deptIcon.icon}</span>
                      <span>{dept} - {t.weeklyOccupancyTotal}</span>
                    </h2>
                    <button
                      onClick={() => setShowDepartmentPanel(!showDepartmentPanel)}
                      className="text-[#4f3a70] hover:text-[#2e1a47] font-bold text-xs cursor-pointer transition"
                      title={showDepartmentPanel ? 'Hide panel' : 'Show panel'}
                    >
                      {showDepartmentPanel ? '▼' : '▶'}
                    </button>
                  </div>

                  {/* Weekly occupancy calendar */}
                  {showDepartmentPanel && (
                    <div
                      className="overflow-x-auto"
                      ref={departmentCapacityScrollRef}
                      onScroll={(e) => handleCapacityHorizontalScroll(e.currentTarget)}
                    >
                    <div className="inline-block min-w-full">
                      {/* Month headers row */}
                      <div className="flex gap-0 mb-0.5">
                        {/* Empty cell for label column */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0`}></div>

                        {monthSpans.map((monthInfo, idx) => {
                          const span = monthInfo.endIdx - monthInfo.startIdx + 1;
                          return (
                            <div
                              key={`dept-month-${monthInfo.month}-${monthInfo.startIdx}`}
                              className={`flex-shrink-0 text-center text-[9px] font-bold px-1 py-0.5 rounded-none border !border-black ${
                                idx % 2 === 0
                                  ? MONTH_HEADER_PRIMARY_CLASS
                                  : MONTH_HEADER_SECONDARY_CLASS
                              }`}
                              style={{
                                width: `${span * 5}rem`,
                                minWidth: `${span * 5}rem`,
                              }}
                            >
                              {monthInfo.month}
                            </div>
                          );
                        })}
                      </div>

                      {/* Week headers row */}
                      <div className="flex gap-0 mb-0.5">
                        {/* Empty cell for label column */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 text-[9px] font-bold text-indigo-700 flex items-center justify-center`}>
                          {t.people}
                        </div>

                        {/* Week number headers */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;
                          return (
                            <div
                              key={`dept-header-${weekData.date}`}
                              className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 text-center text-[9px] font-bold px-1 py-0.5 rounded-none border-1.5 border-black ${
                                isCurrentWeek
                                  ? CURRENT_WEEK_HEADER_CLASS
                                  : 'bg-blue-100 text-blue-900'
                              }`}
                            >
                              CW{weekData.weekNum}
                            </div>
                          );
                        })}
                      </div>

                      {/* Total row - sum of occupied people in that week (or hours for MFG) */}
                      <div className="flex gap-0 mb-0.5">
                        {/* Label */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-orange-100 to-orange-50 text-orange-800`}>
                          {t.totalLabel}
                        </div>

                        {/* Week cells */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;

                          // Calculate total occupied people for this department in this week
                          const deptWeekKey = `${dept}|${weekData.date}`;
                          const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;

                          // For MFG, show hours directly. For other departments, convert to people
                          const isMFG = dept === 'MFG';
                          const displayValue = isMFG ? totalWeekHours : totalWeekHours / 45;
                          const unit = isMFG ? 'h' : 'people';

                          // Determine color based on occupied people/hours
                          let bgColor = 'bg-green-300';
                          let textColor = 'text-green-900';

                          if (isMFG) {
                            // For MFG: color based on hours (different thresholds)
                            if (totalWeekHours >= 360) {
                              bgColor = 'bg-red-500';
                              textColor = 'text-white';
                            } else if (totalWeekHours >= 225) {
                              bgColor = 'bg-orange-400';
                              textColor = 'text-white';
                            } else if (totalWeekHours >= 112.5) {
                              bgColor = 'bg-yellow-300';
                              textColor = 'text-yellow-900';
                            }
                          } else {
                            // For other departments: color based on people
                            if (displayValue >= 8) {
                              bgColor = 'bg-red-500';
                              textColor = 'text-white';
                            } else if (displayValue >= 5) {
                              bgColor = 'bg-orange-400';
                              textColor = 'text-white';
                            } else if (displayValue >= 2.5) {
                              bgColor = 'bg-yellow-300';
                              textColor = 'text-yellow-900';
                            }
                          }

                          return (
                            <div
                              key={`total-${dept}-${weekData.date}`}
                              className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-none border-1.5 border-black text-[9px] font-bold ${bgColor} ${
                                isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''
                              }`}
                              title={`${t.totalLabel} - CW${weekData.weekNum}: ${displayValue.toFixed(2)} ${unit}`}
                            >
                              <div className={`${textColor} font-bold text-[10px]`}>
                                {displayValue.toFixed(2)}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* SCIO Team Members / Hours per Week row - edit capacity per week */}
                      <div className="flex gap-0 mb-0.5">
                        {/* Label */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-purple-100 to-purple-50 text-purple-800`}>
                          {dept === 'MFG' ? t.hoursPerWeek : t.scioTeamMembers}
                        </div>

                        {/* Week inputs for SCIO capacity */}
                        <div className="flex gap-0">
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;
                            return (
                              <input
                                key={`scio-${dept}-${weekData.date}`}
                                type="number"
                                step="0.1"
                                value={scioTeamMembers[dept]?.[weekData.date] || ''}
                                disabled={!hasFullAccess}
                                onChange={(e) => {
                                  const newCapacity = parseFloat(e.target.value) || 0;
                                  handleScioTeamChange(dept, weekData.date, newCapacity);
                                }}
                                className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 border-1.5 border-black rounded-none px-1 py-0.5 text-[9px] font-bold text-center focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                                  isCurrentWeek ? CURRENT_WEEK_EDITABLE_CLASS : 'bg-gradient-to-b from-purple-50 to-purple-25'
                                }`}
                                placeholder="0"
                                title={`Capacidad para la semana ${weekData.weekNum}`}
                                min="0"
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* PTO row - subtracts from SCIO Team Members */}
                      <div className="flex gap-0 mb-0.5">
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-amber-100 to-amber-50 text-amber-800`}>
                          {t.ptoLabel}
                        </div>

                        <div className="flex gap-0">
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;
                            return (
                              <input
                                key={`pto-${dept}-${weekData.date}`}
                                type="number"
                                step="0.1"
                                value={scioPto[dept]?.[weekData.date] || ''}
                                disabled={!hasFullAccess}
                                onChange={(e) => {
                                  const newValue = parseFloat(e.target.value) || 0;
                                  handleScioPtoChange(dept, weekData.date, newValue);
                                }}
                                className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 border-1.5 border-black rounded-none px-1 py-0.5 text-[9px] font-bold text-center focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                                  isCurrentWeek ? CURRENT_WEEK_EDITABLE_CLASS : 'bg-gradient-to-b from-amber-50 to-amber-25'
                                }`}
                                placeholder="0"
                                title={`${t.ptoLabel} - ${t.week} ${weekData.weekNum}`}
                                min="0"
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Training row - subtracts from SCIO Team Members */}
                      <div className="flex gap-0 mb-0.5">
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-sky-100 to-sky-50 text-sky-800`}>
                          {t.trainingLabel}
                        </div>

                        <div className="flex gap-0">
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;
                            return (
                              <input
                                key={`training-${dept}-${weekData.date}`}
                                type="number"
                                step="0.1"
                                value={scioTraining[dept]?.[weekData.date] || ''}
                                disabled={!hasFullAccess}
                                onChange={(e) => {
                                  const newValue = parseFloat(e.target.value) || 0;
                                  handleScioTrainingChange(dept, weekData.date, newValue);
                                }}
                                className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 border-1.5 border-black rounded-none px-1 py-0.5 text-[9px] font-bold text-center focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                                  isCurrentWeek ? CURRENT_WEEK_EDITABLE_CLASS : 'bg-gradient-to-b from-sky-50 to-sky-25'
                                }`}
                                placeholder="0"
                                title={`${t.trainingLabel} - ${t.week} ${weekData.weekNum}`}
                                min="0"
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Subcontracted Personnel rows - Only for BUILD department */}
                      {dept === 'BUILD' && (
                        <>
                          {/* Company rows - Only show active teams */}
                          {Array.from(activeTeams).map((company) => (
                            <div key={`subcontract-${company}`} className="flex gap-0 mb-0.5 group">
                              {/* Company Label with delete button */}
                              <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-violet-100 to-violet-50 text-violet-900 shadow-sm hover:shadow-md transition-all`}>
                                <span className="truncate max-w-[40px]" title={company}>{company}</span>
                                {hasFullAccess && (
                                  <button
                                    onClick={() => {
                                      setDeleteConfirmation({
                                        isOpen: true,
                                        type: 'subcontracted',
                                        teamName: company,
                                      });
                                    }}
                                    className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 hover:bg-red-600 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                                    title={`${t.removeTeamTitle} ${company}`}
                                  >
                                    <Minus size={8} className="text-white font-bold" />
                                  </button>
                                )}
                              </div>

                              {/* Week inputs for subcontracted personnel - Smaller size */}
                              <div className="flex gap-0">
                                {allWeeksData.map((weekData, idx) => {
                                  const isCurrentWeek = idx === currentDateWeekIndex;
                                  return (
                                    <div
                                      key={`subcontract-${company}-${weekData.date}`}
                                      className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 border-1.5 border-black rounded-none py-0.5 flex items-center justify-center transition-all ${
                                        isCurrentWeek
                                          ? CURRENT_WEEK_EDITABLE_CLASS
                                          : 'bg-gradient-to-b from-violet-50 to-violet-25'
                                      }`}
                                    >
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={subcontractedInputs[`${company}-${weekData.date}`] ?? (subcontractedPersonnel[company]?.[weekData.date] !== undefined && subcontractedPersonnel[company]?.[weekData.date] !== 0 ? subcontractedPersonnel[company][weekData.date] : '')}
                                        disabled={!hasFullAccess}
                                        onChange={(e) => {
                                          const raw = e.target.value;
                                          const normalized = raw.replace(',', '.');
                                          if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                            setSubcontractedInputs(prev => ({
                                              ...prev,
                                              [`${company}-${weekData.date}`]: raw,
                                            }));
                                            let newCount: number | undefined;
                                            if (normalized === '' || normalized === '.') {
                                              newCount = undefined;
                                            } else {
                                              newCount = parseFloat(normalized);
                                            }
                                            handleSubcontractedChange(company, weekData.date, newCount);
                                          }
                                        }}
                                        className="w-8 text-[9px] font-bold bg-transparent focus:outline-none text-center border-none text-violet-900 disabled:cursor-not-allowed disabled:text-gray-400"
                                        style={{textAlign: 'center'}}
                                        placeholder="0"
                                        title={`${company} - ${t.week} ${weekData.weekNum}`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}

                          {/* Add Team button - clicking label opens popup */}
                          {hasFullAccess && (
                            <div className="flex gap-0 mb-0.5">
                              {/* Label column - clickable to open popup */}
                              <button
                                onClick={() => setIsBuildModalOpen(true)}
                                className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-indigo-100 to-indigo-50 text-indigo-800 hover:from-indigo-200 hover:to-indigo-100 cursor-pointer transition-all`}
                                title={t.clickToAddSubcontractedTeam}
                              >
                                {t.addButton}
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* Add External Team button row - Only for PRG department */}
                      {dept === 'PRG' && (
                        <>
                          {/* Team rows - Only show active teams */}
                          {prgActiveTeams.map((team) => (
                            <div key={`prg-external-${team}`} className="flex gap-0 mb-0.5 group">
                              {/* Team Label with delete button */}
                              <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-cyan-100 to-cyan-50 text-cyan-900 shadow-sm hover:shadow-md transition-all`}>
                                <span className="truncate max-w-[40px]" title={team}>{team}</span>
                                {hasFullAccess && (
                                  <button
                                    onClick={() => {
                                      setDeleteConfirmation({
                                        isOpen: true,
                                        type: 'prg',
                                        teamName: team,
                                      });
                                    }}
                                    className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 hover:bg-red-600 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                                    title={`${t.removeTeamTitle} ${team}`}
                                  >
                                    <Minus size={8} className="text-white font-bold" />
                                  </button>
                                )}
                              </div>

                              {/* Week inputs for external personnel */}
                              <div className="flex gap-0">
                                {allWeeksData.map((weekData, idx) => {
                                  const isCurrentWeek = idx === currentDateWeekIndex;
                                  return (
                                    <div
                                      key={`prg-external-${team}-${weekData.date}`}
                                      className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 border-1.5 border-black rounded-none py-0.5 flex items-center justify-center transition-all ${
                                        isCurrentWeek
                                          ? CURRENT_WEEK_EDITABLE_CLASS
                                          : 'bg-gradient-to-b from-cyan-50 to-cyan-25'
                                      }`}
                                    >
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={prgExternalInputs[`${team}-${weekData.date}`] ?? (prgExternalPersonnel[team] && prgExternalPersonnel[team][weekData.date] !== undefined && prgExternalPersonnel[team][weekData.date] !== 0 ? prgExternalPersonnel[team][weekData.date] : '')}
                                        disabled={!hasFullAccess}
                                        onChange={(e) => {
                                          const raw = e.target.value;
                                          const normalized = raw.replace(',', '.');
                                          if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                            setPrgExternalInputs(prev => ({
                                              ...prev,
                                              [`${team}-${weekData.date}`]: raw,
                                            }));
                                            let newCount: number | undefined;
                                            if (normalized === '' || normalized === '.') {
                                              newCount = undefined;
                                            } else {
                                              newCount = parseFloat(normalized);
                                            }
                                            handlePrgExternalChange(team, weekData.date, newCount);
                                          }
                                        }}
                                        className="w-8 text-[9px] font-bold bg-transparent focus:outline-none text-center border-none text-cyan-900 disabled:cursor-not-allowed disabled:text-gray-400"
                                        style={{textAlign: 'center'}}
                                        placeholder="0"
                                        title={`${team} - ${t.week} ${weekData.weekNum}`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}

                          {/* Add External Team button - clicking label opens popup */}
                          {hasFullAccess && (
                            <div className="flex gap-0 mb-0.5">
                              {/* Label column - clickable to open popup */}
                              <button
                                onClick={() => setIsPRGModalOpen(true)}
                                className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-teal-100 to-teal-50 text-teal-800 hover:from-teal-200 hover:to-teal-100 cursor-pointer transition-all`}
                                title={t.clickToAddExternalTeam}
                              >
                                {t.addButton}
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* External Hours row - For BUILD and PRG departments only */}
                      {(dept === 'BUILD' || dept === 'PRG') && (
                        <div className="flex gap-0 mb-0.5">
                          {/* Label */}
                          <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-purple-100 to-purple-50 text-purple-800`}>
                            {dept === 'BUILD' ? 'Ext' : 'Ext'}
                          </div>

                          {/* Week cells */}
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;

                            // Calculate total external hours for this week across ALL projects
                            const deptWeekKey = `${dept}|${weekData.date}`;
                            const totalExternalHours = assignmentIndex.deptWeekExternalTotals.get(deptWeekKey) || 0;

                            return (
                              <div
                                key={`external-${dept}-${weekData.date}`}
                                className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-none border-1.5 border-black text-[9px] font-bold text-purple-700 transition-all ${
                                  totalExternalHours > 0
                                    ? 'bg-purple-200 shadow-sm'
                                    : 'bg-purple-50'
                                } ${isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''}`}
                                title={`Horas externas - ${totalExternalHours}h`}
                              >
                                <div className="font-black text-[10px]">
                                  {totalExternalHours > 0 ? totalExternalHours : '-'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Capacity row - department capacity minus occupied (hours for MFG, people for others) */}
                      <div className="flex gap-0 mb-0.5">
                        {/* Label */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-green-100 to-green-50 text-green-800`}>
                          {t.capacityLabel}
                        </div>

                        {/* Week cells */}
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;

                            // Calculate total hours occupied for this department this week
                            const deptWeekKey = `${dept}|${weekData.date}`;
                            const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;

                          // For MFG: use hours directly. For other departments: convert to people
                          const isMFG = dept === 'MFG';
                          const occupiedValue = isMFG ? totalWeekHours : totalWeekHours / 45;

                          const totalCapacity = getDepartmentTotalCapacityForWeek(dept, weekData.date);

                          const availableCapacity = totalCapacity - occupiedValue;
                          const unit = isMFG ? 'h' : 'people';

                          // Determine color based on utilization percentage
                          let bgColor = 'bg-gray-200';
                          let textColor = 'text-gray-700';
                          const utilizationPercentForCapacity = totalCapacity > 0
                            ? (occupiedValue / totalCapacity) * 100
                            : 0;

                          // If no capacity set, show gray
                          if (totalCapacity === 0) {
                            bgColor = 'bg-gray-200';
                            textColor = 'text-gray-700';
                          } else if (utilizationPercentForCapacity >= 100) {
                            // Critical: 100%+ utilization
                            bgColor = 'bg-red-700 animate-pulse';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 90) {
                            // High: 90-99%
                            bgColor = 'bg-red-500';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 70) {
                            // Moderate: 70-89%
                            bgColor = 'bg-yellow-300';
                            textColor = 'text-yellow-900';
                          } else {
                            // Healthy: <70%
                            bgColor = 'bg-green-300';
                            textColor = 'text-green-900';
                          }

                          const displayTextColor = isCurrentWeek ? 'text-black' : textColor;
                          const displayTextWeight = isCurrentWeek ? 'font-black' : 'font-bold';

                          return (
                            <div
                              key={`capacity-${dept}-${weekData.date}`}
                              className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-none border-1.5 border-black text-[9px] font-bold ${bgColor} ${
                                isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''
                              }`}
                              title={`${t.capacityLabel} - CW${weekData.weekNum}: ${totalCapacity.toFixed(2)} ${unit} (Available: ${availableCapacity.toFixed(2)})`}
                            >
                              <div className={`${displayTextColor} ${displayTextWeight} text-[10px]`}>
                                {availableCapacity.toFixed(2)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="capacity-projects-section-banner mt-2 mb-1 rounded-md border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-2 py-1">
              <h2 className="text-[11px] font-bold text-indigo-900 flex items-center gap-1">
                <ClipboardList size={12} className="text-indigo-700" />
                <span>{t.projectsSection}</span>
              </h2>
            </div>

            {/* Projects in department view - each with individual zoom controls */}
            {/* Filter: If project has visibleInDepartments, only show in those departments. Otherwise, show in all. */}
            {orderedDepartmentProjects.map((proj) => {
              const dept = departmentFilter as Department;
              const scopeKey = getProjectOrderScopeKey(departmentFilter);
              const changeOrderSummary = getChangeOrderSummary(dept, proj.id);
              const isHighProbabilityProject = !!proj.isHighProbability;
              const projectHeaderClass = isHighProbabilityProject
                ? 'bg-gradient-to-r from-amber-100 to-orange-100 hover:from-amber-200 hover:to-orange-200 border-b border-amber-300'
                : 'bg-gray-100 hover:bg-gray-200 border-b border-gray-300';

              return (
                <div
                  key={proj.id}
                  className={`capacity-project-card relative mb-2 border rounded-lg shadow-sm bg-white overflow-hidden transition ${
                    dragOverState?.projectId === proj.id && dragOverState?.scopeKey === scopeKey
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : (isHighProbabilityProject ? 'border-amber-400' : 'border-gray-300')
                  } ${
                    dragState?.projectId === proj.id && dragState?.scopeKey === scopeKey
                      ? 'opacity-75 shadow-lg'
                      : ''
                  }`}
                  onDragOver={(e) => {
                    handleProjectDragOver(e);
                    updateDragOverPosition(e, proj.id, scopeKey);
                  }}
                  onDrop={(e) => handleProjectDrop(e, proj.id, scopeKey, orderedDepartmentProjects)}
                >
                  {dragOverState?.projectId === proj.id &&
                    dragOverState?.scopeKey === scopeKey &&
                    dragState?.projectId !== proj.id && (
                      <div
                        className={`absolute left-2 right-2 h-1 rounded-full bg-blue-500 shadow-md z-20 ${
                          dragOverState.position === 'before' ? 'top-0' : 'bottom-0'
                        }`}
                      />
                    )}
                  {/* Project header - Includes metrics for department view */}
                  <div className={`capacity-project-header cursor-pointer ${projectHeaderClass}`} onClick={() => toggleProjectExpanded(proj.id)}>
                    {/* Row 1: Project info */}
                    <div className="p-1 flex items-center gap-1">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => handleProjectDragStart(e, proj.id, scopeKey)}
                        onDragEnd={() => {
                          setDragState(null);
                          setDragOverState(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`p-0.5 text-gray-500 hover:text-blue-600 cursor-grab active:cursor-grabbing transition ${
                          dragState?.projectId === proj.id && dragState?.scopeKey === scopeKey ? 'text-blue-600' : ''
                        }`}
                        title={language === 'es' ? 'Arrastrar para reordenar' : 'Drag to reorder'}
                      >
                        <GripVertical size={12} />
                      </button>
                      {expandedProjects[proj.id] ? (
                        <ChevronUp size={14} className="text-gray-600 flex-shrink-0" />
                      ) : (
                        <ChevronDown size={14} className="text-gray-600 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs leading-tight flex items-center flex-wrap gap-1">
                          <span className="font-bold">{proj.name}</span>
                          <span className="text-gray-400">|</span>
                          <span className="text-gray-600">{proj.client}</span>
                          <span className="text-gray-400">|</span>
                          <span className="bg-blue-100 text-blue-700 px-1 py-0 rounded text-xs font-semibold">
                            {(projectDurationWeeksById.get(proj.id) ?? proj.numberOfWeeks)} weeks
                          </span>
                          {isHighProbabilityProject && (
                            <>
                              <span className="text-gray-400">|</span>
                              <span className="bg-amber-200 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                {language === 'es' ? 'High Probability' : 'High Probability'}
                              </span>
                              {canEditDepartment(dept) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleClearHighProbabilityFromDepartment(proj);
                                  }}
                                  className="bg-rose-100 text-rose-700 border border-rose-300 px-1.5 py-0.5 rounded text-[10px] font-semibold hover:bg-rose-200 transition"
                                  title={language === 'es' ? 'Quitar etiqueta High Probability' : 'Remove High Probability label'}
                                >
                                  {language === 'es' ? 'Quitar HP' : 'Clear HP'}
                                </button>
                              )}
                            </>
                          )}
                          {proj.projectManagerId && (
                            <>
                              <span className="text-gray-400">|</span>
                              <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                PM: {projectManagerNameById.get(proj.id) || 'PM'}
                              </span>
                            </>
                          )}
                          <span className="text-gray-400">•</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canEditDepartment(dept)) {
                                openChangeOrderModal(proj.id, dept);
                              }
                            }}
                            disabled={!canEditDepartment(dept)}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition ${
                              canEditDepartment(dept)
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                            }`}
                            title={`${t.addChangeOrderBudget} | CO: ${changeOrderSummary.count} | ${formatHours(changeOrderSummary.totalHours)}h`}
                          >
                            <ClipboardList size={10} />
                            <span>CO {changeOrderSummary.count}</span>
                            <span>{formatHours(changeOrderSummary.totalHours)}h</span>
                          </button>
                        </div>
                      </div>
                      {/* Desktop: Metrics inline */}
                      <div className="hidden md:flex items-stretch gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const dept = departmentFilter as Department;
                          const quotedHoursValue = getQuotedHours(dept, proj.id);
                          const quotedChangeOrdersValue = getQuotedChangeOrders(dept, proj.id);
                          const utilizedHoursValue = getUtilizedHours(dept, proj.id);
                          const forecastedHoursValue = getForecastedHours(dept, proj.id);
                          const utilizationPercent = getUtilizationPercent(dept, proj.id);
                          const utilizationColorInfo = getUtilizationColor(utilizationPercent);

                          return (
                            <>
                              <div className="bg-slate-100 rounded px-1.5 py-1 border border-slate-300 text-center w-[72px] flex flex-col justify-center">
                                <div className="text-[10px] text-slate-700 font-bold">{t.quotedLabel}</div>
                                <div className="text-[11px] font-black text-slate-700">{formatHours(quotedHoursValue)}h</div>
                              </div>
                              <div className="bg-emerald-100 rounded px-1 py-0.5 border border-emerald-300 text-center w-[72px] flex flex-col justify-center" title={t.quotedChangeOrders}>
                                <div className="text-[8px] text-emerald-700 font-bold leading-tight">{t.quotedChangeOrdersShort}</div>
                                <div className="text-[10px] font-black text-emerald-700">{formatHours(quotedChangeOrdersValue)}h</div>
                              </div>
                              <div className="bg-slate-100 rounded px-1.5 py-1 border border-slate-300 text-center w-[72px] flex flex-col justify-center">
                                <div className="text-[10px] text-slate-700 font-bold">{t.usedLabel}</div>
                                <div className="text-[11px] font-black text-slate-700">{formatHours(utilizedHoursValue)}h</div>
                              </div>
                              <div className="bg-slate-100 rounded px-1.5 py-1 border border-slate-300 text-center w-[72px] flex flex-col justify-center">
                                <div className="text-[10px] text-slate-700 font-bold">{t.pronosticado}</div>
                                <div className="text-[11px] font-black text-slate-700">{formatHours(forecastedHoursValue)}h</div>
                              </div>
                              <div className={`rounded px-1.5 py-1 border text-center w-[72px] flex flex-col justify-center ${utilizationColorInfo.bg}`}>
                                <div className={`text-[9px] font-bold ${utilizationColorInfo.text}`}>{t.utilizationLabel}</div>
                                <div className={`text-[11px] font-black ${utilizationColorInfo.text}`}>{utilizationPercent}%</div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      {/* Desktop: Zoom controls inline */}
                      <div className="hidden md:flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[9px] font-semibold text-indigo-900">Z:</span>
                        <button
                          onClick={() => updateProjectZoom(proj.id, Math.max(50, getEffectiveProjectZoom(proj.id) - 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom Out"
                        >
                          <ZoomOut size={10} />
                        </button>
                        <input
                          type="range"
                          min="50"
                          max="200"
                          step="10"
                          value={getEffectiveProjectZoom(proj.id)}
                          onChange={(e) => updateProjectZoom(proj.id, parseInt(e.target.value))}
                          className="w-12 cursor-pointer h-1"
                        />
                        <button
                          onClick={() => updateProjectZoom(proj.id, Math.min(200, getEffectiveProjectZoom(proj.id) + 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom In"
                        >
                          <ZoomIn size={10} />
                        </button>
                        <span className="text-[9px] font-semibold text-indigo-900">{getEffectiveProjectZoom(proj.id)}%</span>
                      </div>
                    </div>
                    {/* Row 2: Mobile only - Metrics and Zoom in separate row */}
                    <div className="md:hidden px-1 pb-1 flex items-center justify-between gap-1 border-t border-gray-200 pt-1" onClick={(e) => e.stopPropagation()}>
                      {/* Metrics - Compact horizontal layout */}
                      <div className="flex items-center gap-1">
                        {(() => {
                          const dept = departmentFilter as Department;
                          const quotedHoursValue = getQuotedHours(dept, proj.id);
                          const quotedChangeOrdersValue = getQuotedChangeOrders(dept, proj.id);
                          const utilizedHoursValue = getUtilizedHours(dept, proj.id);
                          const forecastedHoursValue = getForecastedHours(dept, proj.id);
                          const utilizationPercent = getUtilizationPercent(dept, proj.id);
                          const utilizationColorInfo = getUtilizationColor(utilizationPercent);

                          return (
                            <>
                              <div className="bg-slate-100 rounded px-1 py-0.5 border border-slate-300 text-center w-[56px] min-h-[30px] flex flex-col items-center justify-center">
                                <span className="text-[7px] text-slate-600 font-semibold leading-none">{t.quotedLabel}</span>
                                <span className="text-[9px] text-slate-700 font-bold leading-none">{formatHours(quotedHoursValue)}h</span>
                              </div>
                              <div className="bg-emerald-100 rounded px-1 py-0.5 border border-emerald-300 text-center w-[56px] min-h-[30px] flex flex-col items-center justify-center" title={t.quotedChangeOrders}>
                                <span className="text-[6px] text-emerald-600 font-semibold leading-none">{t.quotedChangeOrdersShort}</span>
                                <span className="text-[8px] text-emerald-700 font-bold leading-none">{formatHours(quotedChangeOrdersValue)}h</span>
                              </div>
                              <div className="bg-slate-100 rounded px-1 py-0.5 border border-slate-300 text-center w-[56px] min-h-[30px] flex flex-col items-center justify-center">
                                <span className="text-[7px] text-slate-600 font-semibold leading-none">{t.usedLabel}</span>
                                <span className="text-[9px] text-slate-700 font-bold leading-none">{formatHours(utilizedHoursValue)}h</span>
                              </div>
                              <div className="bg-slate-100 rounded px-1 py-0.5 border border-slate-300 text-center w-[56px] min-h-[30px] flex flex-col items-center justify-center">
                                <span className="text-[7px] text-slate-600 font-semibold leading-none">{t.pronosticado}</span>
                                <span className="text-[9px] text-slate-700 font-bold leading-none">{formatHours(forecastedHoursValue)}h</span>
                              </div>
                              <div className={`rounded px-1 py-0.5 border text-center w-[56px] min-h-[30px] flex flex-col items-center justify-center ${utilizationColorInfo.bg}`}>
                                <span className={`text-[6px] font-semibold leading-none ${utilizationColorInfo.text}`}>{t.utilizationLabel}</span>
                                <span className={`text-[9px] font-bold leading-none ${utilizationColorInfo.text}`}>{utilizationPercent}%</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      {/* Zoom controls */}
                      <div className="flex items-center gap-0.5">
                        <span className="text-[8px] font-semibold text-indigo-900">Z:</span>
                        <button
                          onClick={() => updateProjectZoom(proj.id, Math.max(50, getEffectiveProjectZoom(proj.id) - 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom Out"
                        >
                          <ZoomOut size={10} />
                        </button>
                        <input
                          type="range"
                          min="50"
                          max="200"
                          step="10"
                          value={getEffectiveProjectZoom(proj.id)}
                          onChange={(e) => updateProjectZoom(proj.id, parseInt(e.target.value))}
                          className="w-10 cursor-pointer h-1"
                        />
                        <button
                          onClick={() => updateProjectZoom(proj.id, Math.min(200, getEffectiveProjectZoom(proj.id) + 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom In"
                        >
                          <ZoomIn size={10} />
                        </button>
                        <span className="text-[8px] font-semibold text-indigo-900">{getEffectiveProjectZoom(proj.id)}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Per-project zoom controls and summary */}
                  <div className="flex items-center justify-between gap-3 p-1.5 bg-indigo-50 border-b border-indigo-200 flex-wrap hidden">
                    {/* Per-project summary panel - FIRST (left side) */}
                    {(() => {
                      const dept = departmentFilter as Department;
                      const quotedHoursValue = getQuotedHours(dept, proj.id);
                      const utilizedHoursValue = getUtilizedHours(dept, proj.id);
                      const forecastedHoursValue = getForecastedHours(dept, proj.id);
                      const utilizationPercent = getUtilizationPercent(dept, proj.id);
                      const utilizationColorInfo = getUtilizationColor(utilizationPercent);

                      return (
                        <div className="flex items-center gap-1 px-2 border-r border-indigo-300">
                          {/* Quoted Hours (budget) */}
                          <div className="bg-slate-100 rounded px-1.5 py-0.5 border border-slate-300 text-center min-w-fit">
                            <div className="text-xs text-slate-700 font-bold">{t.quotedLabel}</div>
                            <div className="text-xs font-black text-slate-700">{formatHours(quotedHoursValue)}h</div>
                          </div>

                          {/* Used Hours (calculated) */}
                          <div className="bg-slate-100 rounded px-2 py-0.5 border border-slate-300 min-w-fit">
                            <div className="text-center">
                              <div className="text-xs text-slate-700 font-bold">{t.usedLabel}</div>
                              <div className="text-xs font-black text-slate-700">{formatHours(utilizedHoursValue)}h</div>
                            </div>
                          </div>

                          {/* Forecasted Hours (calculated) */}
                          <div className="bg-slate-100 rounded px-2 py-0.5 border border-slate-300 min-w-fit">
                            <div className="text-center">
                              <div className="text-xs text-slate-700 font-bold">{t.pronosticado}</div>
                              <div className="text-xs font-black text-slate-700">{formatHours(forecastedHoursValue)}h</div>
                            </div>
                          </div>

                          {/* Utilization % = (Used + Forecasted) / (Quoted + Change Orders) * 100 */}
                          <div className={`rounded px-1.5 py-0.5 border text-center min-w-fit ${utilizationColorInfo.bg}`}>
                            <div className={`text-xs font-bold ${utilizationColorInfo.text}`}>{t.utilizationLabel}</div>
                            <div className={`text-xs font-black ${utilizationColorInfo.text}`}>{utilizationPercent}%</div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Zoom controls */}
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-indigo-900">Z:</span>
                      <button
                        onClick={() => updateProjectZoom(proj.id, Math.max(50, getEffectiveProjectZoom(proj.id) - 10))}
                        className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                        title="Zoom Out"
                      >
                        <ZoomOut size={12} />
                      </button>
                      <input
                        type="range"
                        min="50"
                        max="200"
                        step="10"
                        value={getEffectiveProjectZoom(proj.id)}
                        onChange={(e) => updateProjectZoom(proj.id, parseInt(e.target.value))}
                        className="w-12 cursor-pointer h-1.5"
                      />
                      <button
                        onClick={() => updateProjectZoom(proj.id, Math.min(200, getEffectiveProjectZoom(proj.id) + 10))}
                        className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                        title="Zoom In"
                      >
                        <ZoomIn size={12} />
                      </button>
                      <span className="text-xs font-semibold text-indigo-900">{getEffectiveProjectZoom(proj.id)}%</span>
                    </div>

                    {/* Collapse/Expand toggle */}
                    <button
                      onClick={() => toggleProjectExpanded(proj.id)}
                      className="p-1 text-indigo-600 hover:text-indigo-800 font-bold text-lg cursor-pointer transition"
                      title={expandedProjects[proj.id] ? 'Hide project' : 'Show project'}
                    >
                      {expandedProjects[proj.id] ? '▼' : '▶'}
                    </button>
                  </div>

                  {expandedProjects[proj.id] && (
                    <div style={{ zoom: `${(isGeneralView ? getEffectiveProjectZoom(proj.id) : 100) / 100}` }}>
                      <div
                        className="capacity-project-table-shell overflow-x-auto border border-gray-300 bg-white"
                        style={{ scrollBehavior: 'smooth' }}
                        onScroll={(e) => handleProjectHorizontalScroll(proj.id, e.currentTarget)}
                        ref={(el) => {
                          if (el) {
                            projectTableRefs.current.set(proj.id, el);
                            if (!activeSyncedProjectIdRef.current) {
                              markProjectAsActiveSyncTarget(proj.id);
                            }
                            const targetScrollProgress = syncedBaseScrollProgressRef.current;
                            setScrollProgressIfNeeded(el, targetScrollProgress);
                          } else {
                            projectTableRefs.current.delete(proj.id);
                            if (activeSyncedProjectIdRef.current === proj.id) {
                              markProjectAsActiveSyncTarget(null);
                            }
                          }
                        }}
                      >
                      <table className="border-collapse text-xs table-fixed w-max min-w-full">
                        <thead>
                        {/* Month row */}
                        <tr className="bg-gray-200 text-gray-700">
                          <th className={`border border-gray-300 px-1 py-0 text-left font-bold sticky left-0 bg-gray-200 z-10 text-xs ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}></th>
                          {monthSpans.map((monthInfo, idx) => {
                            const isEven = idx % 2 === 0;
                            return (
                              <th
                                key={`${monthInfo.month}-${monthInfo.startIdx}`}
                                colSpan={monthInfo.endIdx - monthInfo.startIdx + 1}
                                className={`border-2 px-2 py-0.5 text-center font-bold text-xs transition-all ${
                                  isEven
                                    ? MONTH_HEADER_PRIMARY_CLASS
                                    : MONTH_HEADER_SECONDARY_CLASS
                                }`}
                              >
                                {monthInfo.month}
                              </th>
                            );
                          })}
                        </tr>
                        {/* Week row */}
                        <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                          <th className={`border border-blue-500 px-1 py-0.5 text-left font-bold sticky left-0 bg-blue-600 z-10 uppercase text-xs whitespace-nowrap overflow-hidden text-ellipsis ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
                            {proj.name}
                          </th>
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;
                            return (
                              <th
                                key={weekData.date}
                                data-week-index={idx}
                                className={`border px-0.5 py-0.5 text-center font-bold ${WEEK_COLUMN_WIDTH_CLASS} relative transition-all text-xs ${
                                  isCurrentWeek
                                    ? CURRENT_WEEK_STRONG_HEADER_CLASS
                                    : weekData.isNextYear
                                      ? 'bg-gradient-to-b from-slate-300 to-slate-400 border-slate-500 text-slate-900'
                                      : 'bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white'
                                }`}
                              >
                                <div className={`font-bold text-xs leading-none`}>CW{weekData.weekNum}</div>
                              </th>
                            );
                          })}
                        </tr>
                    </thead>
                    <tbody>
                      {/* Project-relative week row (thin): 1..N from project start to end */}
                      <tr>
                        <td className={`border border-gray-300 px-1 py-0 text-[9px] font-semibold text-slate-700 bg-slate-100 sticky left-0 z-10 uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
                          {t.projectWeek || 'Project Week'}
                        </td>
                        {allWeeksData.map((weekData, weekIdx) => {
                          const isCurrentWeekColumn = weekIdx === currentDateWeekIndex;
                          // Project Week must always reflect the project global timeline,
                          // not the current department timing shift.
                          const projectWeekNumber = getProjectWeekNumber(proj, weekData.date);
                          return (
                            <td
                              key={`project-week-${proj.id}-${weekData.date}`}
                              data-week-index={weekIdx}
                              className={`border px-0.5 py-0 text-center text-[9px] font-semibold ${WEEK_COLUMN_WIDTH_CLASS} ${
                                isCurrentWeekColumn
                                  ? 'bg-stone-100 border-stone-400 text-stone-900'
                                  : 'bg-slate-50 text-slate-600 border-gray-300'
                              }`}
                            >
                              {projectWeekNumber ?? '—'}
                            </td>
                          );
                        })}
                      </tr>

                      {/* Department row for this project */}
                      <tr className="hover:bg-gray-50">
                        <td className={`border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 sticky left-0 z-10 pl-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
                          <div className="flex items-center justify-between gap-0.5">
                            <div className="flex items-center gap-0.5">
                              <span className={`text-xs ${getDepartmentIcon(dept).color}`}>
                                {getDepartmentIcon(dept).icon}
                              </span>
                              <span className="font-medium text-xs leading-none">{dept}</span>
                            </div>

                          </div>
                        </td>
                        {allWeeksData.map((weekData, weekIdx) => {
                          const week = weekData.date;
                          const isCurrentWeekColumn = weekIdx === currentDateWeekIndex;
                          const canEditThisDepartment = canEditDepartment(dept);
                          const isSelectedCell =
                            selectedProjectCell?.projectId === proj.id &&
                            selectedProjectCell?.department === dept &&
                            selectedProjectCell?.weekStart === week;
                          const indicatorCellEntry = assignmentIndex.byCell.get(`${proj.id}|${dept}|${week}`);
                          const indicatorTotalHours = indicatorCellEntry?.totalHours ?? 0;
                          const {
                            showHardOutOfRangeIndicator,
                            showShiftGapBackground,
                            showShiftDashedIndicator,
                          } = getCellShiftIndicators(
                            proj,
                            dept,
                            week,
                            indicatorTotalHours
                          );
                          const cellKey = getProjectCellKey(proj.id, dept, week);
                          return (
                            <td
                              key={`${proj.id}-${dept}-${week}`}
                              ref={(el) => {
                                if (el) {
                                  projectCellRefs.current.set(cellKey, el);
                                } else {
                                  projectCellRefs.current.delete(cellKey);
                                }
                              }}
                              data-week-index={weekIdx}
                              onClick={() => selectProjectCell(dept, week, proj.id)}
                              onDoubleClick={() => canEditThisDepartment && handleEditCell(dept, week, proj.id)}
                              className={`border p-0 relative text-xs transition-all ${
                                canEditThisDepartment ? 'cursor-pointer hover:shadow-md' : 'cursor-cell'
                              } ${
                                isCurrentWeekColumn
                                  ? CURRENT_WEEK_SOFT_CELL_CLASS
                                  : 'border-gray-300'
                              } ${
                                isSelectedCell
                                  ? 'after:absolute after:inset-0 after:border-2 after:border-blue-600 after:rounded-none after:pointer-events-none after:z-20'
                                  : ''
                              }`}
                            >
                              {showShiftGapBackground && (
                                <div className="pointer-events-none absolute inset-0 bg-[#bfdbfe]/70 z-[9]" />
                              )}
                              {showShiftDashedIndicator && (
                                <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-[#1e3a8a] z-10" />
                              )}
                              {showHardOutOfRangeIndicator && (
                                <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px),repeating-linear-gradient(-45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px)] z-10" />
                              )}
                              {renderCellContent(dept, week, proj)}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                    </table>
                      </div>
                    </div>
                  )}

                </div>
              );
            })}
            </div>
        )}

        {/* Projects Table - Only in General View */}
        {departmentFilter === 'General' && (
          <div style={{ zoom: `${zoom / 100}` }}>
            {/* Global Capacity Summary Panel by Week - Separated by Departments - STICKY */}
            {showGlobalPanel && (
              <div className="sticky top-0 z-40 mb-0.5 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-none p-0.5 shadow-sm">
                <h2 className="text-[10px] font-bold mb-0.5 text-green-800 flex items-center gap-0.5 justify-between">
                  <div className="flex items-center gap-0.5">
                    <span>Capacity</span>
                  </div>
                  <button
                    onClick={() => setShowGlobalPanel(false)}
                    className="text-green-600 hover:text-green-800 font-bold text-[10px] cursor-pointer"
                    title="Hide Capacity panel"
                  >
                    ✕
                  </button>
                </h2>

              {/* Vertical calendar layout - weeks as columns, departments as rows */}
              <div
                className="overflow-x-auto"
                ref={generalCapacityScrollRef}
                onScroll={(e) => handleCapacityHorizontalScroll(e.currentTarget)}
              >
                <div className="inline-block min-w-full" style={{ zoom: `${generalCapacityZoom / 100}` }}>
                  {/* Month headers row */}
                  <div className="flex gap-0 mb-0">
                    {/* Empty cell for department names column */}
                    <div className={`${GENERAL_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0`}></div>

                    {monthSpans.map((monthInfo, idx) => {
                      const span = monthInfo.endIdx - monthInfo.startIdx + 1;
                      return (
                        <div
                          key={`general-month-${monthInfo.month}-${monthInfo.startIdx}`}
                          className={`flex-shrink-0 text-center text-[9px] font-bold p-0.5 rounded-none border !border-black ${
                            idx % 2 === 0
                              ? MONTH_HEADER_PRIMARY_CLASS
                              : MONTH_HEADER_SECONDARY_CLASS
                          }`}
                          style={{
                            width: `${span * 5}rem`,
                            minWidth: `${span * 5}rem`,
                          }}
                        >
                          {monthInfo.month}
                        </div>
                      );
                    })}
                  </div>

                  {/* Week headers row */}
                  <div className="flex gap-0 mb-0">
                    {/* Empty cell for department names column */}
                    <div className={`${GENERAL_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0`}></div>

                    {/* Week number headers */}
                    {allWeeksData.map((weekData, idx) => {
                      const isCurrentWeek = idx === currentDateWeekIndex;
                      return (
                        <div
                          key={`header-${weekData.date}`}
                          className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 text-center text-[9px] font-bold p-0.5 rounded-none border border-black ${
                            isCurrentWeek
                              ? CURRENT_WEEK_HEADER_CLASS
                              : 'bg-blue-100 text-blue-900'
                          }`}
                        >
                          CW{weekData.weekNum}
                        </div>
                      );
                    })}
                  </div>

                  {/* Department rows */}
                  {DEPARTMENTS.map((dept) => {
                    const deptIcon = getDepartmentIcon(dept);
                    return (
                      <div key={`dept-${dept}`} className="flex gap-0 mb-0">
                        {/* Department name column */}
                        <div className={`${GENERAL_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[9px] font-bold p-0.5 rounded-none border border-black ${deptIcon.color} bg-white`}>
                          <span title={dept}>{dept}</span>
                        </div>

                        {/* Week cells for this department */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;

                          // Calculate total hours occupied for this department this week
                          const deptWeekKey = `${dept}|${weekData.date}`;
                          const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;

                          // For MFG: use hours directly. For other departments: convert to people
                          const isMFG = dept === 'MFG';
                          const occupiedValue = isMFG ? totalWeekHours : totalWeekHours / 45;

                          const totalCapacity = getDepartmentTotalCapacityForWeek(dept, weekData.date);

                          const availableCapacity = totalCapacity - occupiedValue;
                          const unit = isMFG ? 'h' : 'people';

                          // Determine color based on utilization percentage
                          let bgColor = 'bg-gray-200';
                          let textColor = 'text-gray-700';
                          const utilizationPercentForCapacity = totalCapacity > 0
                            ? (occupiedValue / totalCapacity) * 100
                            : 0;

                          // If no capacity set, show gray
                          if (totalCapacity === 0) {
                            bgColor = 'bg-gray-200';
                            textColor = 'text-gray-700';
                          } else if (utilizationPercentForCapacity >= 100) {
                            // Critical: 100%+ utilization
                            bgColor = 'bg-red-700 animate-pulse';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 90) {
                            // High: 90-99%
                            bgColor = 'bg-red-500';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 70) {
                            // Moderate: 70-89%
                            bgColor = 'bg-yellow-300';
                            textColor = 'text-yellow-900';
                          } else {
                            // Healthy: <70%
                            bgColor = 'bg-green-300';
                            textColor = 'text-green-900';
                          }

                          const displayTextColor = isCurrentWeek ? 'text-black' : textColor;
                          const displayTextWeight = isCurrentWeek ? 'font-black' : 'font-bold';

                          return (
                            <div
                              key={`${dept}-${weekData.date}`}
                              className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 flex flex-col items-center justify-center p-0.5 rounded-none border border-black text-[8px] font-semibold ${bgColor} ${
                                isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''
                              }`}
                              title={`${dept} - CW${weekData.weekNum}${weekData.isNextYear ? ` (${selectedYear + 1})` : ''}: ${totalCapacity.toFixed(2)} ${unit} (Available: ${availableCapacity.toFixed(2)})`}
                            >
                              {totalCapacity > 0 ? (
                                <div className={`${displayTextColor} ${displayTextWeight} text-[8px]`}>
                                  {availableCapacity.toFixed(2)}
                                </div>
                              ) : (
                                <div className={`${displayTextColor} ${displayTextWeight} text-[7px]`}>—</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
            )}

            {/* Toggle button to show Global panel when hidden */}
            {!showGlobalPanel && (
              <button
                onClick={() => setShowGlobalPanel(true)}
                className="mb-2 px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-[10px] font-bold rounded-lg transition"
                title="Show Capacity panel"
              >
                Show Capacity
              </button>
            )}

            <div className="capacity-projects-section-banner mt-2 mb-1 rounded-md border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-2 py-1">
              <h2 className="text-[11px] font-bold text-indigo-900 flex items-center gap-1">
                <ClipboardList size={12} className="text-indigo-700" />
                <span>{t.projectsSection}</span>
              </h2>
            </div>

              {orderedGeneralProjects.map((proj) => {
                const scopeKey = getProjectOrderScopeKey('General');
                const isHighProbabilityProject = !!proj.isHighProbability;
                const projectHeaderClass = isHighProbabilityProject
                  ? 'bg-gradient-to-r from-amber-100 to-orange-100 hover:from-amber-200 hover:to-orange-200 border-b border-amber-300'
                  : 'bg-gray-100 hover:bg-gray-200 border-b border-gray-300';
                return (
                <div
                  key={proj.id}
                  className={`capacity-project-card relative mb-1 border rounded-lg shadow-sm bg-white overflow-hidden transition ${
                    dragOverState?.projectId === proj.id && dragOverState?.scopeKey === scopeKey
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : (isHighProbabilityProject ? 'border-amber-400' : 'border-gray-300')
                  } ${
                    dragState?.projectId === proj.id && dragState?.scopeKey === scopeKey
                      ? 'opacity-75 shadow-lg'
                      : ''
                  }`}
                  onDragOver={(e) => {
                    handleProjectDragOver(e);
                    updateDragOverPosition(e, proj.id, scopeKey);
                  }}
                  onDrop={(e) => handleProjectDrop(e, proj.id, scopeKey, orderedGeneralProjects)}
                >
                  {dragOverState?.projectId === proj.id &&
                    dragOverState?.scopeKey === scopeKey &&
                    dragState?.projectId !== proj.id && (
                      <div
                        className={`absolute left-2 right-2 h-1 rounded-full bg-blue-500 shadow-md z-20 ${
                          dragOverState.position === 'before' ? 'top-0' : 'bottom-0'
                        }`}
                      />
                    )}
                  {/* Project header */}
                  <div className={`capacity-project-header cursor-pointer p-1 ${projectHeaderClass}`} onClick={() => toggleProjectExpanded(proj.id)}>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => handleProjectDragStart(e, proj.id, scopeKey)}
                        onDragEnd={() => {
                          setDragState(null);
                          setDragOverState(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`p-0.5 text-gray-500 hover:text-blue-600 cursor-grab active:cursor-grabbing transition ${
                          dragState?.projectId === proj.id && dragState?.scopeKey === scopeKey ? 'text-blue-600' : ''
                        }`}
                        title={language === 'es' ? 'Arrastrar para reordenar' : 'Drag to reorder'}
                      >
                        <GripVertical size={12} />
                      </button>
                      {expandedProjects[proj.id] ? (
                        <ChevronUp size={14} className="text-gray-600" />
                      ) : (
                        <ChevronDown size={14} className="text-gray-600" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs leading-tight flex items-center flex-wrap gap-1">
                          <span className="font-bold">{proj.name}</span>
                          <span className="text-gray-400">|</span>
                          <span className="text-gray-600">{proj.client}</span>
                          <span className="text-gray-400">|</span>
                          <span className="bg-blue-100 text-blue-700 px-1 py-0 rounded text-xs font-semibold">
                            {(projectDurationWeeksById.get(proj.id) ?? proj.numberOfWeeks)} weeks
                          </span>
                          {isHighProbabilityProject && (
                            <>
                              <span className="text-gray-400">|</span>
                              <span className="bg-amber-200 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded text-[10px] font-bold">
                                {language === 'es' ? 'High Probability' : 'High Probability'}
                              </span>
                            </>
                          )}
                          {proj.projectManagerId && (
                            <>
                              <span className="text-gray-400">|</span>
                              <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                PM: {projectManagerNameById.get(proj.id) || 'PM'}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Zoom controls */}
                      <div className="flex items-center gap-0.5 ml-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs font-semibold text-indigo-900">Z:</span>
                        <button
                          onClick={() => updateProjectZoom(proj.id, Math.max(50, getEffectiveProjectZoom(proj.id) - 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom Out"
                        >
                          <ZoomOut size={12} />
                        </button>
                        <input
                          type="range"
                          min="50"
                          max="200"
                          step="10"
                          value={getEffectiveProjectZoom(proj.id)}
                          onChange={(e) => updateProjectZoom(proj.id, parseInt(e.target.value))}
                          className="w-12 cursor-pointer h-1.5"
                        />
                        <button
                          onClick={() => updateProjectZoom(proj.id, Math.min(200, getEffectiveProjectZoom(proj.id) + 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom In"
                        >
                          <ZoomIn size={12} />
                        </button>
                        <span className="text-xs font-semibold text-indigo-900 ml-0.5">{getEffectiveProjectZoom(proj.id)}%</span>
                      </div>
                    </div>

                  </div>

                  {/* Expandable content - includes hours panel AND table */}
                  {expandedProjects[proj.id] && (
                    <>
                      {/* Quoted/Used/Forecast/Utilization by Department - extra compact */}
                      <div className="capacity-project-summary-shell bg-white rounded p-1 border border-gray-200 m-0.5 overflow-x-auto" style={{ scrollBehavior: 'smooth' }}>
                        <div style={{ zoom: `${getEffectiveProjectZoom(proj.id) / 100}`, display: 'inline-block', minWidth: '100%' }}>
                          <div className="flex md:hidden gap-1 min-w-max">
                            {DEPARTMENTS.map((dept) => renderProjectDepartmentSummaryCard(proj.id, dept, true))}
                          </div>
                          <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-1">
                            {DEPARTMENTS.map((dept) => renderProjectDepartmentSummaryCard(proj.id, dept))}
                          </div>
                        </div>
                      </div>

                      <div
                        className="overflow-x-auto"
                        style={{ scrollBehavior: 'smooth', zoom: `${getEffectiveProjectZoom(proj.id) / 100}` }}
                        onScroll={(e) => handleProjectHorizontalScroll(proj.id, e.currentTarget)}
                        ref={(el) => {
                          if (el) {
                            projectTableRefs.current.set(proj.id, el);
                            if (!activeSyncedProjectIdRef.current) {
                              markProjectAsActiveSyncTarget(proj.id);
                            }
                            const targetScrollProgress = syncedBaseScrollProgressRef.current;
                            setScrollProgressIfNeeded(el, targetScrollProgress);
                          } else {
                            projectTableRefs.current.delete(proj.id);
                            if (activeSyncedProjectIdRef.current === proj.id) {
                              markProjectAsActiveSyncTarget(null);
                            }
                          }
                        }}
                      >
                      <table className="border-collapse text-xs table-fixed w-max min-w-full">
                        <thead>
                          {/* Month row */}
                          <tr className="bg-gray-200 text-gray-700 sticky top-0 z-20">
                            <th className={`border border-gray-300 px-1 py-0 text-left font-bold sticky left-0 bg-gray-200 z-30 text-xs ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}></th>
                            {monthSpans.map((monthInfo, idx) => {
                              const isEven = idx % 2 === 0;
                              return (
                                <th
                                  key={`${monthInfo.month}-${monthInfo.startIdx}`}
                                  colSpan={monthInfo.endIdx - monthInfo.startIdx + 1}
                                  className={`border-2 px-2 py-0.5 text-center font-bold text-xs transition-all ${
                                    isEven
                                      ? MONTH_HEADER_PRIMARY_CLASS
                                      : MONTH_HEADER_SECONDARY_CLASS
                                  }`}
                                >
                                  {monthInfo.month}
                                </th>
                              );
                            })}
                          </tr>
                          {/* Week row */}
                          <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-5 z-20">
                            <th className={`border border-blue-500 px-1 py-0.5 text-left font-bold sticky left-0 bg-blue-600 z-30 uppercase text-xs whitespace-nowrap overflow-hidden text-ellipsis ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
                              Dpto
                            </th>
                            {allWeeksData.map((weekData, idx) => {
                              const isCurrentWeek = idx === currentDateWeekIndex;
                              return (
                                <th
                                  key={weekData.date}
                                  data-week-index={idx}
                                  className={`border px-0.5 py-0.5 text-center font-bold ${WEEK_COLUMN_WIDTH_CLASS} relative transition-all text-xs ${
                                    isCurrentWeek
                                      ? CURRENT_WEEK_STRONG_HEADER_CLASS
                                      : weekData.isNextYear
                                        ? 'bg-gradient-to-b from-slate-300 to-slate-400 border-slate-500 text-slate-900'
                                        : 'bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white'
                                  }`}
                                >
                                  <div className={`font-bold text-xs leading-none`}>CW{weekData.weekNum}</div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {/* Project-relative week row (thin): 1..N from project start to end */}
                          <tr>
                            <td className={`border border-gray-300 px-1 py-0 text-[9px] font-semibold text-slate-700 bg-slate-100 sticky left-0 z-10 uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
                              {t.projectWeek || 'Project Week'}
                            </td>
                            {allWeeksData.map((weekData, weekIdx) => {
                              const isCurrentWeekColumn = weekIdx === currentDateWeekIndex;
                              const projectWeekNumber = getProjectWeekNumber(proj, weekData.date);
                              return (
                                <td
                                  key={`project-week-general-${proj.id}-${weekData.date}`}
                                  data-week-index={weekIdx}
                                  className={`border px-0.5 py-0 text-center text-[9px] font-semibold ${WEEK_COLUMN_WIDTH_CLASS} ${
                                    isCurrentWeekColumn
                                      ? 'bg-stone-100 border-stone-400 text-stone-900'
                                      : 'bg-slate-50 text-slate-600 border-gray-300'
                                  }`}
                                >
                                  {projectWeekNumber ?? '—'}
                                </td>
                              );
                            })}
                          </tr>

                          {/* Show ALL 6 departments in the calendar */}
                          {DEPARTMENTS.map((dept) => {
                            return (
                              <tr key={`${proj.id}-${dept}`} className="hover:bg-gray-50">
                                <td className={`border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 sticky left-0 z-10 pl-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
                                  <div className="flex items-center gap-0.5">
                                    <span className={`text-xs ${getDepartmentIcon(dept).color}`}>
                                      {getDepartmentIcon(dept).icon}
                                    </span>
                                    <span className="font-medium text-xs leading-none">{dept}</span>
                                  </div>
                                </td>
                                {allWeeksData.map((weekData, weekIdx) => {
                                  const week = weekData.date;
                                  const isCurrentWeekColumn = weekIdx === currentDateWeekIndex;

                                  // Get hours for this specific project-department-week combination
                                  const cellKey = `${proj.id}|${dept}|${week}`;
                                  const cellEntry = assignmentIndex.byCell.get(cellKey);
                                  const totalHours = cellEntry?.totalHours ?? 0;
                                  const talent = calculateTalent(totalHours);
                                  const isInRange = isWeekInProjectRange(week, proj);

                                  // Get the stage from actual assignments (what was selected when adding hours)
                                  const assignmentStage = cellEntry?.stage ?? null;
                                  const stageColor = assignmentStage ? getStageColor(assignmentStage, dept) : null;

                                  // Get comment from first assignment (comments are shared across assignments in same cell)
                                  const cellComment = cellEntry?.comment;

                                  // Get department-specific start/end info (precomputed)
                                  const deptMeta = projectDeptMetaByKey.get(`${proj.id}|${dept}`);

                                  // Check if current week is within department range using date comparison
                                  // For departments WITHOUT specific departmentStages, use project dates instead
                                  const effectiveDeptStartDate = deptMeta?.effectiveStartDate || proj.startDate;
                                  const effectiveDeptEndDate = deptMeta?.effectiveEndDate || proj.endDate;
                                  const isDeptWeekInRange = week >= effectiveDeptStartDate && week <= effectiveDeptEndDate;
                                  const isDeptFirstWeek = week === effectiveDeptStartDate;

                                  // Calculate consecutive week number within the department (1, 2, 3, etc.)
                                  let deptConsecutiveWeek = 0;
                                  if (isDeptWeekInRange) {
                                    const startMs = new Date(effectiveDeptStartDate).getTime();
                                    const currentMs = new Date(week).getTime();
                                    const weeksDiff = Math.floor((currentMs - startMs) / (7 * 24 * 60 * 60 * 1000));
                                    deptConsecutiveWeek = weeksDiff + 1;
                                  }

                                  const {
                                    showHardOutOfRangeIndicator,
                                    showShiftGapBackground,
                                    showShiftDashedIndicator,
                                  } = getCellShiftIndicators(
                                    proj,
                                    dept,
                                    week,
                                    totalHours
                                  );
                                  const displacedCellBgClass = stageColor
                                    ? stageColor.bg
                                    : isDeptWeekInRange
                                      ? (isDeptFirstWeek ? 'bg-orange-100' : 'bg-[#bfdbfe]')
                                      : isInRange
                                        ? 'bg-green-50'
                                        : 'bg-gray-50';
                                  const compactTalentDisplay = Math.abs(talent) < 0.0001 ? '' : talent;

                                  if (projectCellViewMode === 'compact') {
                                    return (
                                      <td
                                        key={`${proj.id}-${dept}-${week}`}
                                        data-week-index={weekIdx}
                                        className={`border p-0 relative text-xs ${
                                          isCurrentWeekColumn
                                            ? CURRENT_WEEK_SOFT_CELL_CLASS
                                            : 'border-gray-300'
                                        } ${displacedCellBgClass}`}
                                      >
                                        {showShiftGapBackground && (
                                          <div className="pointer-events-none absolute inset-0 bg-[#bfdbfe]/70 z-[9]" />
                                        )}
                                        {showShiftDashedIndicator && (
                                          <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-[#1e3a8a] z-10" />
                                        )}
                                        {showHardOutOfRangeIndicator && (
                                          <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px),repeating-linear-gradient(-45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px)] z-10" />
                                        )}
                                        <div className={`absolute inset-0 p-0.5 text-center text-[10px] font-semibold leading-tight flex items-center justify-center overflow-hidden ${
                                          stageColor
                                            ? `${stageColor.bg} ${stageColor.text}`
                                            : isDeptWeekInRange
                                              ? 'bg-[#bfdbfe] text-[#1e40af]'
                                              : isInRange
                                                ? 'bg-green-50 text-green-700'
                                                : 'bg-gray-100 text-gray-500'
                                        }`}>
                                          {cellComment && (
                                            <button
                                              onClick={() => setViewingComment({ comment: cellComment, projectName: proj.name, department: dept })}
                                              className="absolute top-0.5 left-0.5 text-amber-600 hover:text-amber-800 cursor-pointer"
                                              title={cellComment}
                                            >
                                              <MessageCircle size={9} />
                                            </button>
                                          )}
                                          <div className="text-[10px] font-bold leading-tight">{compactTalentDisplay}</div>
                                        </div>
                                      </td>
                                    );
                                  }

                                  return (
                                    <td
                                      key={`${proj.id}-${dept}-${week}`}
                                      data-week-index={weekIdx}
                                        className={`border p-0 relative text-xs ${
                                          isCurrentWeekColumn
                                            ? CURRENT_WEEK_SOFT_CELL_CLASS
                                            : 'border-gray-300'
                                      } ${displacedCellBgClass}`}
                                    >
                                      {showShiftGapBackground && (
                                        <div className="pointer-events-none absolute inset-0 bg-[#bfdbfe]/70 z-[9]" />
                                      )}
                                      {showShiftDashedIndicator && (
                                        <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-[#1e3a8a] z-10" />
                                      )}
                                      {showHardOutOfRangeIndicator && (
                                        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px),repeating-linear-gradient(-45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px)] z-10" />
                                      )}
                                      {totalHours === 0 ? (
                                        <div className={`p-0.5 text-center text-[10px] font-medium leading-tight h-full w-full overflow-hidden flex items-center justify-center ${
                                          stageColor
                                            ? `${stageColor.text}`
                                            : isDeptWeekInRange
                                              ? isDeptFirstWeek
                                                ? 'text-orange-600'
                                              : 'text-[#1e40af]'
                                              : isInRange
                                                ? 'text-green-600'
                                                : 'text-gray-400'
                                        }`}>
                                          {cellComment && (
                                            <button
                                              onClick={() => setViewingComment({ comment: cellComment, projectName: proj.name, department: dept })}
                                              className="absolute top-0.5 right-0.5 text-amber-600 hover:text-amber-800 cursor-pointer"
                                              title={cellComment}
                                            >
                                              <MessageCircle size={9} />
                                            </button>
                                          )}
                                          {stageColor && assignmentStage ? (
                                            <span className="font-semibold text-[7px]">{getStageLabel(assignmentStage, t as Record<string, string>)}</span>
                                          ) : isDeptWeekInRange ? (
                                            <>
                                              {isDeptFirstWeek ? (
                                                <span className="text-[10px] font-bold">1</span>
                                              ) : (
                                                <span className="font-bold text-[10px]">{deptConsecutiveWeek}</span>
                                              )}
                                            </>
                                          ) : isInRange ? (
                                            <span className="text-[10px]">&nbsp;</span>
                                          ) : (
                                            '-'
                                          )}
                                        </div>
                                      ) : (
                                        <div className={`p-0.5 text-center text-[10px] font-semibold leading-tight h-full w-full overflow-hidden flex flex-col items-center justify-center ${
                                          stageColor ? `${stageColor.bg} ${stageColor.text}` : 'bg-blue-100 text-blue-900'
                                        }`}>
                                          {cellComment && (
                                            <button
                                              onClick={() => setViewingComment({ comment: cellComment, projectName: proj.name, department: dept })}
                                              className="absolute top-0.5 left-0.5 text-amber-600 hover:text-amber-800 cursor-pointer"
                                              title={cellComment}
                                            >
                                              <MessageCircle size={10} />
                                            </button>
                                          )}
                                          <div className="text-[10px] font-bold leading-tight">{formatHours(totalHours)}h</div>
                                          <div className="text-[10px] opacity-75 leading-tight">{talent}</div>
                                          {stageColor && assignmentStage && (
                                            <div className="text-[7px] font-semibold leading-tight">{getStageLabel(assignmentStage, t as Record<string, string>)}</div>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </>
                  )}
                </div>
              )})}
            </div>
        )}
      </div>

      {/* Visual Guide - Expandable in place */}
      {showLegend && (
        <div className="capacity-visual-guide mx-1 my-0.5 overflow-hidden rounded-md border border-[#d9d4e2] bg-gradient-to-b from-white to-[#f6f3fb] shadow-sm">
          <div className="flex items-center justify-between border-b border-[#e8e4ef] px-2 py-1.5">
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-[#2e1a47]">{t.legend}</h3>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-medium text-[#6d6082]">
                {departmentFilter === 'General' ? t.globalPanelTitle : t.projectsMatrix}
              </span>
              <button
                type="button"
                onClick={() => setShowLegend(false)}
                className="inline-flex items-center gap-1 rounded-md border border-[#d6d0e2] bg-white px-2 py-0.5 text-[9px] font-semibold text-[#4f3a70] hover:bg-[#f4f1f8] transition"
                title={language === 'es' ? 'Cerrar guía' : 'Close guide'}
              >
                <X size={11} />
                <span className="hidden sm:inline">{language === 'es' ? 'Cerrar guía' : 'Close guide'}</span>
              </button>
            </div>
          </div>

          <div className="space-y-2 p-2">
            {departmentFilter === 'General' && (
              <div>
                <p className="mb-1 text-[10px] font-semibold text-[#2e1a47]">
                  {language === 'es' ? 'Uso de capacidad' : 'Capacity usage'}
                </p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                    <div className="h-3.5 w-3.5 rounded border border-green-300 bg-green-100" />
                    <span className="text-[10px] font-medium text-[#3f3354]">{t.percentLow}</span>
                  </div>
                  <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                    <div className="h-3.5 w-3.5 rounded border border-yellow-300 bg-yellow-100" />
                    <span className="text-[10px] font-medium text-[#3f3354]">{t.percentModerate}</span>
                  </div>
                  <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                    <div className="h-3.5 w-3.5 rounded border border-red-600 bg-red-500" />
                    <span className="text-[10px] font-medium text-[#3f3354]">{t.percentHigh}</span>
                  </div>
                  <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                    <div className="h-3.5 w-3.5 rounded border border-red-800 bg-red-700 shadow-inner" />
                    <span className="text-[10px] font-medium text-[#3f3354]">{t.percentCritical}</span>
                  </div>
                  <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                    <div className="h-3.5 w-3.5 rounded border border-gray-300 bg-gray-100" />
                    <span className="text-[10px] font-medium text-[#3f3354]">{t.noDataLegend}</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="mb-1 text-[10px] font-semibold text-[#2e1a47]">
                {language === 'es' ? 'Como leer las celdas' : 'How to read cells'}
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-6">
                <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                  <div className="flex h-4 w-4 items-center justify-center rounded border border-blue-300 bg-blue-100 text-[9px] font-bold text-blue-700">h</div>
                  <span className="text-[10px] font-medium text-[#3f3354]">{t.hoursLegend}</span>
                </div>
                <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                  <div className="flex h-4 w-4 items-center justify-center rounded border border-gray-300 bg-white text-[9px] font-bold text-gray-400">-</div>
                  <span className="text-[10px] font-medium text-[#3f3354]">{t.noAssignmentsLegend}</span>
                </div>
                <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                  <div className="h-4 w-4 rounded border border-emerald-300 bg-emerald-50" />
                  <span className="text-[10px] font-medium text-[#3f3354]">{t.withinRangeLegend}</span>
                </div>
                <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                  <div className="flex h-4 w-4 items-center justify-center rounded border border-stone-500 bg-stone-300 text-[9px] font-bold text-stone-900">S</div>
                  <span className="text-[10px] font-medium text-[#3f3354]">{t.currentWeekLegend}</span>
                </div>
                <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                  <div className="h-4 w-4 rounded border-2 border-dashed border-[#1e3a8a] bg-[#dbeafe]" />
                  <span className="text-[10px] font-medium text-[#3f3354]">
                    {language === 'es' ? 'Desfase por fecha' : 'Date shift'}
                  </span>
                </div>
                <div className="capacity-visual-guide-card flex items-center gap-1.5 rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                  <div className="h-4 w-4 rounded border border-slate-300 bg-white bg-[repeating-linear-gradient(45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px),repeating-linear-gradient(-45deg,rgba(15,23,42,0.16)_0px,rgba(15,23,42,0.16)_1px,transparent_1px,transparent_6px)]" />
                  <span className="text-[10px] font-medium text-[#3f3354]">{t.outOfRangeLegend}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold text-[#2e1a47]">
                  {language === 'es' ? 'Color por departamento y actividad' : 'Color by department and activity'}
                </p>
                <span className="text-[9px] text-[#6d6082]">
                  {language === 'es' ? 'Cada celda sigue esta combinacion' : 'Each cell follows this combination'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                {DEPARTMENTS.map((dept) => {
                  const deptInfo = getDepartmentIcon(dept);
                  const deptLabel = getDepartmentLabel(dept, t as Record<string, string>);
                  const deptStyle = DEPARTMENT_LEGEND_STYLES[dept];
                  const deptStages = STAGE_OPTIONS[dept];

                  return (
                    <div key={`legend-dept-${dept}`} className="capacity-visual-guide-card rounded-md border border-[#e4dfec] bg-white px-1.5 py-1">
                      <div className="mb-1 flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${deptStyle.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${deptStyle.dot}`} />
                          </span>
                          <span className="text-[10px] font-semibold text-[#2e1a47]">{deptLabel}</span>
                          <span className="text-[9px] font-semibold text-[#6d6082]">({dept})</span>
                        </div>
                        <span className={`text-[10px] ${deptInfo.color}`}>{deptInfo.icon}</span>
                      </div>

                      {deptStages.length > 0 ? (
                        <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
                          {deptStages.map((stage) => {
                            const swatchBg = getLegendStageSwatchBg(stage, dept);
                            return (
                              <div
                                key={`legend-stage-${dept}-${stage}`}
                                className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[9px] font-medium text-[#4b3d61]"
                              >
                                <span
                                  className={`h-3.5 w-3.5 shrink-0 rounded-[4px] border border-[#8d80a7] ${swatchBg}`}
                                  style={{
                                    filter: 'saturate(1.8) contrast(1.25)',
                                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25), 0 1px 3px rgba(34,17,57,0.28)',
                                  }}
                                />
                                <span className="truncate">{getStageLabel(stage, t as Record<string, string>)}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[9px] text-[#6d6082]">
                          {language === 'es'
                            ? 'Sin actividades por etapa para este departamento.'
                            : 'No stage activities for this department.'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="capacity-visual-guide-footnote rounded-md border border-[#ddd5ea] bg-white/80 px-2 py-1 text-[10px] text-[#4b3d61]">
              {departmentFilter === 'General' ? t.readOnlyView : t.backgroundColors}
            </div>
          </div>
        </div>
      )}

      {showTimingChangesModal && isTimingAuditGeneralView && (
        <div className="fixed inset-0 z-[92] bg-black/55 flex items-center justify-center p-3">
          <div className="w-full max-w-6xl max-h-[92vh] bg-white rounded-xl shadow-2xl border border-[#d8d0e4] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 text-white flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">
                  {language === 'es' ? 'Cambios de Timing por Proyecto' : 'Project Timing Changes'}
                </h3>
                <p className="text-[11px] opacity-90">
                  {language === 'es'
                    ? 'Vista General - solo Project Manager'
                    : 'General View - Project Manager only'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTimingChangesModal(false)}
                className="h-8 w-8 rounded-full border border-white/30 hover:bg-white/20 transition flex items-center justify-center"
                aria-label={language === 'es' ? 'Cerrar' : 'Close'}
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-4 py-3 border-b border-[#e4ddeef0] bg-[#fdfaf5]">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-[#4f3a70]">
                  <span>{language === 'es' ? 'Fecha desde' : 'From date'}</span>
                  <input
                    type="date"
                    value={timingChangesFromDate}
                    onChange={(e) => setTimingChangesFromDate(e.target.value)}
                    className="border border-[#cfbfd7] rounded-md px-2 py-1.5 text-xs bg-white text-[#2e1a47] focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-[#4f3a70]">
                  <span>{language === 'es' ? 'Fecha hasta' : 'To date'}</span>
                  <input
                    type="date"
                    value={timingChangesToDate}
                    onChange={(e) => setTimingChangesToDate(e.target.value)}
                    className="border border-[#cfbfd7] rounded-md px-2 py-1.5 text-xs bg-white text-[#2e1a47] focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void loadProjectTimingChanges()}
                  disabled={isTimingChangesLoading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-md transition"
                >
                  <History size={12} />
                  <span>
                    {isTimingChangesLoading
                      ? (language === 'es' ? 'Consultando...' : 'Loading...')
                      : (language === 'es' ? 'Buscar cambios' : 'Search changes')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportTimingRangeExcel()}
                  disabled={isTimingRangeExcelExporting}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-md transition"
                >
                  <span>XLSX</span>
                  <span>
                    {isTimingRangeExcelExporting
                      ? (language === 'es' ? 'Exportando...' : 'Exporting...')
                      : (language === 'es' ? 'Exportar timing' : 'Export timing')}
                  </span>
                </button>
                <div className="text-[11px] text-[#6f5b80]">
                  {language === 'es'
                    ? `Proyectos con cambios: ${timingChangesByProject.length}`
                    : `Projects with changes: ${timingChangesByProject.length}`}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-[#f7f4fb] p-4">
              {isTimingChangesLoading ? (
                <div className="text-sm font-semibold text-[#4f3a70]">
                  {language === 'es' ? 'Cargando cambios de timing...' : 'Loading timing changes...'}
                </div>
              ) : timingChangesError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {timingChangesError}
                </div>
              ) : timingChangesByProject.length === 0 ? (
                <div className="rounded-lg border border-[#dfd5ef] bg-white px-3 py-3 text-sm text-[#5d4a72]">
                  {language === 'es'
                    ? 'No se encontraron cambios de timing para el rango seleccionado.'
                    : 'No timing changes were found for the selected range.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {timingChangesByProject.map((group) => (
                    <div key={`timing-group-${group.projectId}`} className="rounded-lg border border-[#d8d0e4] bg-white shadow-sm overflow-hidden">
                      <div className="px-3 py-2 bg-gradient-to-r from-[#f3ecff] to-[#eee5fb] border-b border-[#d8d0e4] flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-[#2e1a47] truncate">{group.projectName}</span>
                          <span className="text-[10px] font-semibold text-[#7a6b8f]">#{group.projectId.slice(0, 8)}</span>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          {group.entries.length} {language === 'es' ? 'cambios' : 'changes'}
                        </span>
                      </div>

                      <div className="divide-y divide-[#efe8f8]">
                        {group.entries.map((entry) => (
                          <div key={entry.id} className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#5a4670]">
                              <span>{formatTimingDateTime(entry.createdAt)}</span>
                              <span className="text-[#9b8bb1]">|</span>
                              <span>{formatTimingUserName(entry.user)}</span>
                            </div>
                            <div className="mt-1.5 space-y-1">
                              {getTimingSummaryLines(entry).map((line, idx) => (
                                <p key={`${entry.id}-line-${idx}`} className="text-xs text-[#2f2243] leading-relaxed">
                                  {line}
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        {/* Quick Project Creation Modal */}
        {showQuickProjectModal && canManageProjectsInCurrentDepartment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-blue-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">{t.createProject}</h2>
                <button
                  onClick={() => {
                    setShowQuickProjectModal(false);
                    setFormValidationPopup(null);
                  }}
                  className="hover:bg-blue-700 p-1 rounded transition"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleCreateQuickProject(); }} className="p-6 space-y-4">
                {formValidationPopup?.scope === 'quick' && (
                  <div className="rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 px-3 py-2 shadow-sm">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-bold text-amber-900">{formValidationPopup.title}</p>
                        <p className="text-xs text-amber-800">{formValidationPopup.message}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormValidationPopup(null)}
                        className="text-amber-700 hover:text-amber-900"
                        aria-label="Close validation message"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {/* Job */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.job}</label>
                  <input
                    type="text"
                    value={quickProjectForm.name}
                    onChange={(e) => setQuickProjectForm({ ...quickProjectForm, name: e.target.value })}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                    placeholder={t.egRefreshDashboard}
                  />
                </div>

                {/* Customer */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.customer}</label>
                  <input
                    type="text"
                    value={quickProjectForm.client}
                    onChange={(e) => setQuickProjectForm({ ...quickProjectForm, client: e.target.value })}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                    placeholder={t.egAcmeCorpDesign}
                  />
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">
                    {language === 'es' ? 'Fecha de inicio del departamento' : 'Department start date'}
                  </label>
                  <WeekNumberDatePicker
                    value={quickProjectForm.startDate}
                    onChange={(date) => setQuickProjectForm({ ...quickProjectForm, startDate: date })}
                    language={language}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                  />
                </div>

                {/* Number of Weeks */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.numberOfWeeks}</label>
                  <input
                    type="text"
                    value={quickProjectForm.numberOfWeeks}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || /^\d+$/.test(value)) {
                        const num = value === '' ? '' : parseInt(value);
                        if (num === '' || (num >= 1 && num <= 52)) {
                          setQuickProjectForm({ ...quickProjectForm, numberOfWeeks: num });
                        } else if (num < 1) {
                          setQuickProjectForm({ ...quickProjectForm, numberOfWeeks: 1 });
                        } else if (num > 52) {
                          setQuickProjectForm({ ...quickProjectForm, numberOfWeeks: 52 });
                        }
                      }
                    }}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                    placeholder="4"
                  />
                </div>

                {/* Facility - Only MI and AL */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.facility}</label>
                  <select
                    value={quickProjectForm.facility}
                    onChange={(e) => setQuickProjectForm({ ...quickProjectForm, facility: e.target.value as 'AL' | 'MI' | 'MX' })}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                  >
                    <option value="AL">AL</option>
                    <option value="MI">MI</option>
                    <option value="MX">MX</option>
                  </select>
                </div>

                {/* Budget Hours */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.budgetHours || 'Horas Presupuestadas'}</label>
                  <input
                    type="text"
                    value={quickProjectForm.budgetHours}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || /^\d+$/.test(value)) {
                        const num = value === '' ? '' : parseInt(value);
                        setQuickProjectForm({ ...quickProjectForm, budgetHours: num });
                      }
                    }}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                    placeholder="0"
                  />
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      {language === 'es' ? 'Proyecto High Probability' : 'High Probability Project'}
                    </p>
                    <p className="text-xs text-amber-700">
                      {language === 'es'
                        ? 'Resalta este proyecto con color especial en la barra.'
                        : 'Highlight this project with a dedicated bar color.'}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={quickProjectForm.isHighProbability}
                    onChange={(e) => setQuickProjectForm({ ...quickProjectForm, isHighProbability: e.target.checked })}
                    className="h-5 w-5 accent-amber-600 cursor-pointer"
                    aria-label={language === 'es' ? 'Proyecto High Probability' : 'High Probability Project'}
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setShowQuickProjectModal(false);
                      setFormValidationPopup(null);
                    }}
                    className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition"
                  >
                    {t.create}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* High Probability Clear Confirmation Modal */}
        {highProbabilityConfirmProject && (
          <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-[1px] flex items-center justify-center z-[88] p-4">
            <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-gradient-to-b from-white to-amber-50 shadow-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-amber-200 bg-gradient-to-r from-amber-100 to-orange-100">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-amber-300 bg-amber-200/70 text-amber-800">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-amber-900">
                      {language === 'es' ? 'Quitar High Probability' : 'Remove High Probability'}
                    </h3>
                    <p className="text-xs text-amber-800">
                      {language === 'es'
                        ? 'Este cambio actualiza la etiqueta visual del proyecto.'
                        : 'This will update the project visual label.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4">
                <p className="text-sm text-slate-700 leading-relaxed">
                  {language === 'es'
                    ? 'Deseas quitar la etiqueta High Probability de:'
                    : 'Do you want to remove the High Probability label from:'}
                </p>
                <p className="mt-2 inline-flex items-center rounded-lg border border-amber-200 bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-900">
                  {highProbabilityConfirmProject.name}
                </p>
              </div>

              <div className="px-5 pb-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setHighProbabilityConfirmProject(null)}
                  disabled={isClearingHighProbability || isDeletingHighProbabilityProject}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 disabled:opacity-50 transition"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={confirmClearHighProbabilityFromDepartment}
                  disabled={isClearingHighProbability || isDeletingHighProbabilityProject}
                  className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50 transition inline-flex items-center gap-2"
                >
                  {isClearingHighProbability && <div className="h-4 w-4 rounded-full border-b-2 border-white animate-spin" />}
                  {language === 'es' ? 'Quitar etiqueta' : 'Remove label'}
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteHighProbabilityProject}
                  disabled={isDeletingHighProbabilityProject || isClearingHighProbability}
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50 transition inline-flex items-center gap-2"
                >
                  {isDeletingHighProbabilityProject && <div className="h-4 w-4 rounded-full border-b-2 border-white animate-spin" />}
                  {language === 'es' ? 'Eliminar proyecto' : 'Delete project'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import Existing Project Modal */}
        {showImportProjectModal && canManageProjectsInCurrentDepartment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-amber-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">{t.importProject || 'Import Existing Project'}</h2>
                <button
                  onClick={() => {
                    setShowImportProjectModal(false);
                    setFormValidationPopup(null);
                  }}
                  className="hover:bg-amber-700 p-1 rounded transition"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleImportProject(); }} className="p-6 space-y-4">
                {formValidationPopup?.scope === 'import' && (
                  <div className="rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 px-3 py-2 shadow-sm">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-bold text-amber-900">{formValidationPopup.title}</p>
                        <p className="text-xs text-amber-800">{formValidationPopup.message}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormValidationPopup(null)}
                        className="text-amber-700 hover:text-amber-900"
                        aria-label="Close validation message"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {/* Select Project */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.selectProject || 'Select Project'}</label>
                  <select
                    value={importProjectForm.projectId}
                    onChange={(e) => setImportProjectForm({ ...importProjectForm, projectId: e.target.value })}
                    className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition bg-white text-sm"
                  >
                    <option value="">{t.selectAProject || '-- Select a project --'}</option>
                    {getAvailableProjectsForImport().map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name} - {proj.client}{proj.isHighProbability ? ` (${language === 'es' ? 'High Probability' : 'High Probability'})` : ''}
                      </option>
                    ))}
                  </select>
                  {importProjectForm.projectId && (() => {
                    const selectedProject = projects.find(p => p.id === importProjectForm.projectId);
                    return selectedProject && (
                      <div className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-600 space-y-1">
                        <div><strong>{t.facility || 'Facility'}:</strong> {selectedProject.facility}</div>
                        <div><strong>{t.projectDates || 'Project Dates'}:</strong> {selectedProject.startDate}{' -> '}{selectedProject.endDate}</div>
                        {selectedProject.isHighProbability && (
                          <div className="rounded border border-amber-300 bg-amber-100 text-amber-900 px-2 py-1 text-[11px] font-semibold">
                            {language === 'es'
                              ? 'Este proyecto esta marcado como High Probability.'
                              : 'This project is marked as High Probability.'}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Start Date for this department */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.startDateDept || 'Start Date for'} {departmentFilter}</label>
                  <WeekNumberDatePicker
                    value={importProjectForm.startDate}
                    onChange={(date) => setImportProjectForm({ ...importProjectForm, startDate: date })}
                    language={language}
                    className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition bg-white text-sm"
                  />
                </div>

                {/* Number of Weeks for this department */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.numberOfWeeks}</label>
                  <input
                    type="text"
                    value={importProjectForm.numberOfWeeks}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || /^\d+$/.test(value)) {
                        const num = value === '' ? '' : parseInt(value);
                        if (num === '' || (num >= 1 && num <= 52)) {
                          setImportProjectForm({ ...importProjectForm, numberOfWeeks: num });
                        } else if (num < 1) {
                          setImportProjectForm({ ...importProjectForm, numberOfWeeks: 1 });
                        } else if (num > 52) {
                          setImportProjectForm({ ...importProjectForm, numberOfWeeks: 52 });
                        }
                      }
                    }}
                    className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition bg-white text-sm"
                    placeholder="4"
                  />
                </div>

                {/* Budget Hours for this department */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.budgetHours || 'Budget Hours'}</label>
                  <input
                    type="text"
                    value={importProjectForm.budgetHours}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || /^\d+$/.test(value)) {
                        const num = value === '' ? '' : parseInt(value);
                        setImportProjectForm({ ...importProjectForm, budgetHours: num });
                      }
                    }}
                    className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition bg-white text-sm"
                    placeholder="0"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => {
                      setShowImportProjectModal(false);
                      setFormValidationPopup(null);
                    }}
                    className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition"
                  >
                    {t.import || 'Import'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Export Timeline PDF Modal */}
        {showExportPdfModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-rose-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">
                  {language === 'es' ? 'Exportar Timeline PDF' : 'Export Timeline PDF'}
                </h2>
                <button
                  onClick={closeExportPdfModal}
                  disabled={isExportingPdf}
                  className="hover:bg-rose-700 p-1 rounded transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="radio"
                      name="pdfExportScope"
                      value="single"
                      checked={pdfExportScope === 'single'}
                      onChange={() => {
                        const firstProjectId = projectsVisibleInCurrentView[0]?.id || '';
                        setPdfExportScope('single');
                        if (!selectedExportProjectId && firstProjectId) {
                          setSelectedExportProjectId(firstProjectId);
                        }
                      }}
                      disabled={isExportingPdf}
                    />
                    {language === 'es' ? 'Solo 1 proyecto' : 'Single project'}
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="radio"
                      name="pdfExportScope"
                      value="selected"
                      checked={pdfExportScope === 'selected'}
                      onChange={() => setPdfExportScope('selected')}
                      disabled={isExportingPdf}
                    />
                    {language === 'es' ? 'Seleccionar varios proyectos' : 'Select multiple projects'}
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="radio"
                      name="pdfExportScope"
                      value="all"
                      checked={pdfExportScope === 'all'}
                      onChange={() => setPdfExportScope('all')}
                      disabled={isExportingPdf}
                    />
                    {language === 'es' ? 'Todos los proyectos visibles' : 'All visible projects'}
                  </label>
                </div>

                {pdfExportScope === 'single' && (
                  <div>
                    <label className="block text-sm font-bold mb-1.5 text-gray-700">
                      {language === 'es' ? 'Proyecto' : 'Project'}
                    </label>
                    <select
                      value={selectedExportProjectId}
                      onChange={(e) => setSelectedExportProjectId(e.target.value)}
                      className="w-full border-2 border-rose-200 rounded-lg px-3 py-2 focus:border-rose-500 focus:outline-none transition bg-white text-sm"
                      disabled={isExportingPdf}
                    >
                      {projectsVisibleInCurrentView.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.name} - {proj.client}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {pdfExportScope === 'selected' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-sm font-bold text-gray-700">
                        {language === 'es' ? 'Proyectos a exportar' : 'Projects to export'}
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={selectAllExportProjects}
                          disabled={isExportingPdf || projectsVisibleInCurrentView.length === 0}
                          className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          {language === 'es' ? 'Seleccionar todos' : 'Select all'}
                        </button>
                        <button
                          type="button"
                          onClick={clearExportProjectSelection}
                          disabled={isExportingPdf || selectedExportProjectIds.length === 0}
                          className="text-[11px] font-semibold text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          {language === 'es' ? 'Limpiar' : 'Clear'}
                        </button>
                      </div>
                    </div>

                    <div className="max-h-44 overflow-y-auto border border-rose-200 rounded-lg p-2 bg-rose-50/30 space-y-1.5">
                      {projectsVisibleInCurrentView.map((proj) => (
                        <label
                          key={proj.id}
                          className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedExportProjectIds.includes(proj.id)}
                            onChange={() => toggleExportProjectSelection(proj.id)}
                            disabled={isExportingPdf}
                            className="mt-0.5"
                          />
                          <span className="text-xs text-gray-700 leading-tight">
                            <span className="font-semibold">{proj.name}</span>
                            <span className="text-gray-500"> - {proj.client}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  {pdfExportScope === 'all'
                    ? (language === 'es'
                      ? `Se exportaran ${projectsVisibleInCurrentView.length} timeline(s), una pagina por proyecto.`
                      : `${projectsVisibleInCurrentView.length} timeline(s) will be exported, one page per project.`)
                    : pdfExportScope === 'selected'
                      ? (language === 'es'
                        ? `Se exportaran ${selectedExportProjectIds.length} proyecto(s) seleccionados.`
                        : `${selectedExportProjectIds.length} selected project(s) will be exported.`)
                    : (language === 'es'
                      ? 'Se exportara solo el timeline del proyecto seleccionado.'
                      : 'Only the selected project timeline will be exported.')}
                </div>

                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={closeExportPdfModal}
                    disabled={isExportingPdf}
                    className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 disabled:cursor-not-allowed text-gray-800 font-semibold rounded-lg transition"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportTimelinePdf}
                    disabled={
                      isExportingPdf ||
                      (pdfExportScope === 'single' && !selectedExportProjectId) ||
                      (pdfExportScope === 'selected' && selectedExportProjectIds.length === 0)
                    }
                    className="flex-1 px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-rose-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
                  >
                    {isExportingPdf
                      ? (language === 'es' ? 'Exportando...' : 'Exporting...')
                      : (language === 'es' ? 'Exportar PDF' : 'Export PDF')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PRG External Team Modal */}
        {isPRGModalOpen && hasFullAccess && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-[80]"
              onClick={() => {
                setIsPRGModalOpen(false);
                setPRGTeamName('');
              }}
            />
            {/* Modal */}
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[90]">
              <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-96">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-teal-50 to-teal-100 rounded-t-lg">
                  <h2 className="text-lg font-semibold text-gray-800">{t.addPrgTeam}</h2>
                  <button
                    onClick={() => {
                      setIsPRGModalOpen(false);
                      setPRGTeamName('');
                    }}
                    className="p-1 text-gray-600 hover:bg-gray-200 rounded transition"
                    title={t.close}
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Form Content */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (prgTeamName.trim()) {
                      try {
                        // Create employee as subcontracted material for PRG department
                        await addEmployee({
                          name: prgTeamName.trim(),
                          role: 'External Team',
                          department: 'PRG',
                          capacity: 0, // External teams don't have internal capacity
                          isActive: true,
                          isSubcontractedMaterial: true,
                          subcontractCompany: prgTeamName.trim(),
                        });

                        // Create initial PrgExternalTeamCapacity record to persist the team
                        // This ensures the team appears after page refresh
                        const currentWeekStart = formatToISO(getWeekStart(new Date()));
                        await prgExternalTeamCapacityApi.create({
                          teamName: prgTeamName.trim(),
                          weekStartDate: currentWeekStart,
                          capacity: 0,
                        });
                        console.log('[CapacityMatrix] Created initial PrgExternalTeamCapacity for:', prgTeamName.trim());

                        // Add to active teams array
                        const newTeams = [...prgActiveTeams, prgTeamName.trim()];
                        setPRGActiveTeams([...new Set(newTeams)]);
                        setPRGTeamName('');
                        setIsPRGModalOpen(false);
                      } catch (error) {
                        console.error('Error adding PRG team:', error);
                        alert('Error al agregar equipo');
                      }
                    }
                  }}
                  className="p-4 space-y-4"
                >
                  {/* Team Name Field */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t.providerName}</label>
                    <input
                      type="text"
                      value={prgTeamName}
                      onChange={(e) => setPRGTeamName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                      placeholder={t.egProviderAbc}
                      autoFocus
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPRGModalOpen(false);
                        setPRGTeamName('');
                      }}
                      className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={!prgTeamName.trim()}
                      className="flex-1 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
                    >
                      {t.addButton}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}

        {/* BUILD Subcontracted Team Modal */}
        {isBuildModalOpen && hasFullAccess && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-[80]"
              onClick={() => {
                setIsBuildModalOpen(false);
                setBuildTeamName('');
              }}
            />
            {/* Modal */}
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[90]">
              <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-96">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-indigo-100 rounded-t-lg">
                  <h2 className="text-lg font-semibold text-gray-800">{t.addBuildTeam}</h2>
                  <button
                    onClick={() => {
                      setIsBuildModalOpen(false);
                      setBuildTeamName('');
                    }}
                    className="p-1 text-gray-600 hover:bg-gray-200 rounded transition"
                    title={t.close}
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Form Content */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (buildTeamName.trim()) {
                      try {
                        // Create employee as subcontracted material for BUILD department
                        await addEmployee({
                          name: buildTeamName.trim(),
                          role: 'Subcontracted Team',
                          department: 'BUILD',
                          capacity: 0, // Subcontracted teams don't have internal capacity
                          isActive: true,
                          isSubcontractedMaterial: true,
                          subcontractCompany: buildTeamName.trim(),
                        });

                        // Create initial SubcontractedTeamCapacity record to persist the team
                        // This ensures the team appears after page refresh
                        const currentWeekStart = formatToISO(getWeekStart(new Date()));
                        await subcontractedTeamCapacityApi.create({
                          company: buildTeamName.trim(),
                          weekStartDate: currentWeekStart,
                          capacity: 0,
                        });
                        console.log('[CapacityMatrix] Created initial SubcontractedTeamCapacity for:', buildTeamName.trim());

                        // Add to active teams array
                        const newTeams = [...activeTeams, buildTeamName.trim()];
                        setActiveTeams([...new Set(newTeams)]);
                        setBuildTeamName('');
                        setIsBuildModalOpen(false);
                      } catch (error) {
                        console.error('Error adding BUILD team:', error);
                        alert('Error al agregar equipo');
                      }
                    }
                  }}
                  className="p-4 space-y-4"
                >
                  {/* Team Name Field */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t.subcontractorName}</label>
                    <input
                      type="text"
                      value={buildTeamName}
                      onChange={(e) => setBuildTeamName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder={t.egCompanyXyz}
                      autoFocus
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsBuildModalOpen(false);
                        setBuildTeamName('');
                      }}
                      className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={!buildTeamName.trim()}
                      className="flex-1 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
                    >
                      {t.addButton}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}

        {/* Comment View Modal for General View */}
        {viewingComment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-amber-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">{t.comment}</h2>
                <button
                  onClick={() => setViewingComment(null)}
                  className="hover:bg-amber-700 p-1 rounded transition"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6">
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t.projectTooltip}</p>
                  <p className="text-sm font-bold text-gray-800">{viewingComment.projectName}</p>
                </div>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t.selectDepartment}</p>
                  <p className="text-sm font-bold text-gray-800">{viewingComment.department}</p>
                </div>

                <div className="mb-6">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t.comment}</p>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{viewingComment.comment}</p>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setViewingComment(null)}
                    className="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                  >
                    {t.close}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {deleteConfirmation.isOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[80] p-4">
            <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6 animate-fade-in">
              <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 0a9 9 0 11-18 0 9 9 0 0118 0" />
                </svg>
              </div>

              <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
                {deleteConfirmation.type === 'subcontracted'
                  ? `${t.deleteTeam || 'Delete Team'}: ${deleteConfirmation.teamName}`
                  : `${t.deleteExternalTeam || 'Delete External Team'}: ${deleteConfirmation.teamName}`}
              </h3>

              <p className="text-gray-600 text-center text-sm mb-6">
                {deleteConfirmation.type === 'subcontracted'
                  ? t.deleteSubcontractedConfirm || `Are you sure you want to delete the subcontracted team "${deleteConfirmation.teamName}" and all its capacity data? This action cannot be undone.`
                  : t.deleteExternalConfirm || `Are you sure you want to delete the external team "${deleteConfirmation.teamName}" and all its capacity data? This action cannot be undone.`}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmation({ isOpen: false, type: null, teamName: '' })}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-300 disabled:cursor-not-allowed text-gray-800 font-semibold rounded-lg transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleDeleteTeam}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {t.deleting || 'Deleting...'}
                    </>
                  ) : (
                    t.delete || 'Delete'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`
          @keyframes fade-in {
            from {
              opacity: 0;
              transform: scale(0.95);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
          .animate-fade-in {
            animation: fade-in 0.2s ease-out;
          }
        `}</style>
    </div>
  );
}
