import { useState, useEffect, useRef, useMemo, type CSSProperties, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { useExternalTeamsStore } from '../stores/externalTeamsStore';
import { scioTeamCapacityApi, subcontractedTeamCapacityApi, prgExternalTeamCapacityApi, changeOrdersApi, assignmentsApi, activityLogApi, projectDepartmentWeeklyActualsApi, externalProviderRatesApi } from '../services/api';
import { getAllWeeksWithNextYear, formatToISO, parseISODate, getWeekStart, normalizeWeekStartDate, getWeekNumber, getWeeksInRange, addWeeksToISO } from '../utils/dateUtils';
import { calculateTalent, getStageColor, getStageLabel, getUtilizationColor } from '../utils/stageColors';
import { getDepartmentIcon, getDepartmentLabel } from '../utils/departmentIcons';
import { generateId } from '../utils/id';
import { ZoomIn, ZoomOut, ChevronDown, ChevronUp, Pencil, Plus, Minus, X, XCircle, FolderPlus, ClipboardList, GripVertical, MessageCircle, AlertTriangle, History, Calendar } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/translations';
import type { Department, Stage, Project, Assignment, Employee, ProjectChangeOrder, ProjectDepartmentWeeklyActual } from '../types';
import { WeekNumberDatePicker } from '../components/WeekNumberDatePicker';
import { ScioHeadcountModal } from '../components/ScioHeadcountModal';
import { ExternalStaffHeadcountModal } from '../components/ExternalStaffHeadcountModal';
import { ExternalProviderRateModal } from '../components/ExternalProviderRateModal';
import { WeekSplitEditor, computeWeeklyHours, computeMatrixHours, SOLO_COLUMN } from '../components/WeekSplitEditor';
import { MoveAssignmentWeeksModal } from '../components/MoveAssignmentWeeksModal';

type DepartmentFilter = 'General' | Department;
type LegendStage = Exclude<Stage, null>;

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'PURCHASING'];
const GENERAL_VISIBILITY_SCOPE = 'GENERAL' as const;
const DEPARTMENT_SET = new Set<Department>(DEPARTMENTS);
const SHARED_EDIT_DEPARTMENTS: Department[] = ['BUILD', 'MFG'];
const HEAD_ENGINEERING_MANAGED_DEPARTMENTS: Department[] = ['MED', 'HD'];

// Departments with the "add an external team" roster feature. BUILD has its own, separate
// system (SubcontractedTeamCapacity/useBuildTeamsStore, company-named) -- these 4 share the
// generalized external-team-capacity system instead (still served by the `PrgExternalTeamCapacity`
// model/endpoint, kept its name, see that model's docstring).
const EXTERNAL_TEAM_DEPARTMENTS: Department[] = ['MED', 'HD', 'MFG', 'PRG'];
// Personnel/input/record-id maps below are keyed by team, but a team name isn't unique across
// departments -- this composes a per-department key so e.g. MED's "Team A" and PRG's "Team A"
// don't collide.
const externalTeamKey = (department: Department, teamName: string) => `${department}::${teamName}`;

const STAGE_OPTIONS: Record<Department, Exclude<Stage, null>[]> = {
  'HD': ['SWITCH_LAYOUT_REVISION', 'CONTROLS_DESIGN', 'RELEASE', 'RED_LINES', 'SUPPORT'],
  'MED': ['CONCEPT', 'DETAIL_DESIGN', 'RELEASE', 'RED_LINES', 'SUPPORT'],
  'BUILD': ['CABINETS_FRAMES', 'OVERALL_ASSEMBLY', 'FINE_TUNING', 'COMMISSIONING', 'SUPPORT'],
  'PRG': ['OFFLINE', 'ONLINE', 'DEBUG', 'COMMISSIONING', 'SUPPORT_MANUALS_FLOW_CHARTS', 'ROBOT_SIMULATION', 'STANDARDS_REV_PROGRAMING_CONCEPT'],
  'PM': [],
  'MFG': [],
  'PURCHASING': [],
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
  PURCHASING: { badge: 'border-teal-200 bg-teal-50 text-teal-700', dot: 'bg-teal-500' },
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
}

interface ProjectCellClipboardState {
  source: ProjectCellSelectionState;
  entries: ProjectCellClipboardEntry[];
}

interface CapacityMatrixPageProps {
  departmentFilter: DepartmentFilter;
  // Sidebar DOM node (rendered by App.tsx, after the department selector) that the year
  // selector, current-week badge, and export buttons portal into instead of sitting in the
  // page's own top toolbar -- frees up the top bar's horizontal space. Null while the sidebar
  // is collapsed (that node only exists when open), in which case those controls render
  // nothing rather than reappearing elsewhere.
  sidebarToolbarContainer?: HTMLDivElement | null;
  // Same idea for the collapsed (icon rail) sidebar: a node to portal a compact, icon-only
  // year selector into so it stays usable while collapsed, rendered right after the
  // department icon-select App.tsx renders there itself.
  sidebarToolbarCollapsedContainer?: HTMLDivElement | null;
}

interface StageHoursEntry {
  id: string;
  stage: Exclude<Stage, null> | '';
  hours: number;
  hoursInput: string;
  // Original assignment row(s) this entry was built from, captured at modal-open
  // time. Used only for the locked-week (Finance-actuals) save path, which
  // relabels these rows' `stage` in place instead of the normal create/reset
  // flow (which would otherwise touch hours).
  assignmentIds?: string[];
  // How many consecutive weeks (starting at the cell's own week) this stage entry's hours
  // are spread across -- each Stage entry in the same cell can span a different number of
  // weeks. 1 (the default) is the original single-week behavior, untouched.
  weekCount: number;
  // Raw text buffer for the week-count input, mirrored for BUILD/PRG entries only (see
  // scioCellInputs below) -- HD/MED's WeekSplitEditor manages its own internal buffer since it
  // owns a single pool, but BUILD/PRG shares one week count across two pools (SCIO/External)
  // via hideWeekCountInput, so the buffer has to live out here instead.
  weekCountInput: string;
  weeklyEven: boolean;
  weeklyHoursInputs: string[];
  // BUILD/PRG-only: each stage entry has its own independent SCIO/External hour pools, each
  // with its own per-person week x column breakdown (see WeekSplitEditor's `columns`). Left at
  // their defaults and unused for every other department's stage entries (HD/MED just use
  // `hours`/`hoursInput`/`weeklyEven`/`weeklyHoursInputs` above, unchanged).
  scioHours: number;
  scioHoursInput: string;
  externalHours: number;
  externalHoursInput: string;
  scioWeeklyEven: boolean;
  scioCellInputs: Record<string, string>;
  externalWeeklyEven: boolean;
  externalCellInputs: Record<string, string>;
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

interface TimingWeekEntry {
  projectId: string;
  projectName: string;
  entry: ActivityLogEntry;
}

interface TimingWeekGroup {
  weekStart: string;
  yearWeek: string;
  entries: TimingWeekEntry[];
  projectCount: number;
}

interface TimingCompactPreviewCell {
  value: string;
  active: boolean;
  hasCapacityLoad: boolean;
  inTimingRange: boolean;
  stage: Stage;
  changed: boolean;
  highlightCurrent: boolean;
}

interface TimingCompactPreviewMetrics {
  quotedHours: number;
  usedHours: number;
  forecastedHours: number;
  utilizationPercent: number;
}

interface TimingCompactPreviewDepartmentRow {
  department: Department;
  changeDetected: boolean;
  metrics: TimingCompactPreviewMetrics;
  metricDiffs: {
    quotedHours: boolean;
    usedHours: boolean;
    forecastedHours: boolean;
    utilizationPercent: boolean;
  };
  cells: TimingCompactPreviewCell[];
}

interface TimingCompactPreviewProjectGroup {
  projectId: string;
  projectName: string;
  currentViewLabel: string;
  previousViewLabel: string;
  currentRows: TimingCompactPreviewDepartmentRow[];
  previousRows: TimingCompactPreviewDepartmentRow[];
}

interface TimingCompactPreviewData {
  weeklyRange: string[];
  currentWeekIndex: number;
  projectGroups: TimingCompactPreviewProjectGroup[];
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
// Wide enough to fit most project names in full (not just short job numbers) without
// truncating -- widened from w-14 (56px) per explicit request after names like "3346-CO01..."
// were getting cut off in the sticky project-identifier cell.
const GENERAL_LEFT_COLUMN_WIDTH_CLASS = 'w-40 min-w-40 max-w-40';
const DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS = 'w-40 min-w-40 max-w-40';
// Fixed row height for every sticky header row (month row, week row, and each Capacity-bar
// department row) in the unified General-view grid, so their `top` offsets can be stacked by
// simple multiplication instead of measuring the DOM -- matches this file's existing
// top-0/top-5 (20px) stacking convention for the month+week row pair.
const UNIFIED_HEADER_ROW_HEIGHT_PX = 20;
const TIMING_COMPACT_STICKY_WIDTHS = [72, 80, 56, 72, 56, 56, 56, 56] as const;
// The per-project Summary section (Qtd/Used/Fcst/Util) is pinned to the right edge of the
// table so it stays visible while scrolling through weeks. Each column is a fixed 60px so the
// `right` offsets stack correctly (rightmost column at right:0). Qtd/Used/Fcst show hours with
// the $ amount underneath; Util shows current % over the % including forecast.
const SUMMARY_COLUMN_WIDTH_PX = 60;
const SUMMARY_COLUMN_KEYS = ['qtd', 'used', 'fcst', 'util'] as const;
type SummaryColumnKey = (typeof SUMMARY_COLUMN_KEYS)[number];
const SUMMARY_COLUMNS: Array<{ key: SummaryColumnKey; rightOffset: number }> = SUMMARY_COLUMN_KEYS.map(
  (key, idx) => ({ key, rightOffset: (SUMMARY_COLUMN_KEYS.length - 1 - idx) * SUMMARY_COLUMN_WIDTH_PX })
);
const SUMMARY_TOTAL_WIDTH_PX = SUMMARY_COLUMN_WIDTH_PX * SUMMARY_COLUMN_KEYS.length;
const SUMMARY_COLUMN_LABELS: Record<SummaryColumnKey, { es: string; en: string }> = {
  qtd: { es: 'Cot', en: 'Qtd' },
  used: { es: 'Usa', en: 'Used' },
  fcst: { es: 'Pron', en: 'Fcst' },
  util: { es: 'Util', en: 'Util' },
};
const PROJECT_TIMING_KEYS = new Set(['startDate', 'endDate', 'numberOfWeeks', 'departmentStages']);
const PROJECT_TIMING_NESTED_KEYS = new Set(['departmentStartDate', 'durationWeeks', 'weekStart', 'weekEnd']);
const getEndOfYearDate = (year: number): string => `${year}-12-31`;

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
  'PURCHASING': {},
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

export function CapacityMatrixPage({ departmentFilter, sidebarToolbarContainer, sidebarToolbarCollapsedContainer }: CapacityMatrixPageProps) {
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
  const [editingHoursInput, setEditingHoursInput] = useState<string>('');
  const [editingStage, setEditingStage] = useState<Stage>(null);
  const [editingStageEntries, setEditingStageEntries] = useState<StageHoursEntry[]>([]);
  const [editingStageResourceHours, setEditingStageResourceHours] = useState<Record<string, StageResourceHoursEntry>>({});
  // "Divide this activity across N weeks" -- generic Hours field only (PM/PURCHASING/MFG: no
  // Stage planner, no SCIO/External split). Departments WITH a Stage planner (HD/MED/BUILD/PRG)
  // use the matching weekCount/weeklyEven/weeklyHoursInputs (and, for BUILD/PRG, the
  // scio*/external* pool fields) on each StageHoursEntry instead, since each stage entry can
  // span its own number of weeks.
  const [editingWeekCount, setEditingWeekCount] = useState<number>(1);
  const [editingWeeklyEven, setEditingWeeklyEven] = useState<boolean>(true);
  const [editingWeeklyHoursInputs, setEditingWeeklyHoursInputs] = useState<string[]>([]);
  const [editingComment, setEditingComment] = useState<string>('');
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [supportEmployeeToAdd, setSupportEmployeeToAdd] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [zoom, setZoom] = useState<number>(100);
  const [projectCellViewMode, setProjectCellViewMode] = useState<'detailed' | 'compact'>('detailed');
  const [showLegend, setShowLegend] = useState<boolean>(false);
  const [showGlobalPanel, setShowGlobalPanel] = useState<boolean>(true);
  const [showDepartmentPanel, setShowDepartmentPanel] = useState<boolean>(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showMoveWeeksModal, setShowMoveWeeksModal] = useState<boolean>(false);
  const [highProbabilityConfirmProject, setHighProbabilityConfirmProject] = useState<Project | null>(null);
  const [isClearingHighProbability, setIsClearingHighProbability] = useState<boolean>(false);
  const [isDeletingHighProbabilityProject, setIsDeletingHighProbabilityProject] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [selectedProjectCell, setSelectedProjectCell] = useState<ProjectCellSelectionState | null>(null);
  const [projectCellClipboard, setProjectCellClipboard] = useState<ProjectCellClipboardState | null>(null);

  const createStageHoursEntry = (
    stage: Exclude<Stage, null> | '' = '',
    hours = 0,
    assignmentIds?: string[],
    scioHours = 0,
    externalHours = 0
  ): StageHoursEntry => ({
    id: generateId(),
    stage,
    hours,
    hoursInput: hours > 0 ? `${hours}` : '',
    assignmentIds,
    weekCount: 1,
    weekCountInput: '1',
    weeklyEven: true,
    weeklyHoursInputs: [],
    scioHours,
    scioHoursInput: scioHours > 0 ? `${scioHours}` : '',
    externalHours,
    externalHoursInput: externalHours > 0 ? `${externalHours}` : '',
    scioWeeklyEven: true,
    scioCellInputs: {},
    externalWeeklyEven: true,
    externalCellInputs: {},
  });

  const createStageResourceKey = (stageEntryId: string, employeeId: string) => `${stageEntryId}::${employeeId}`;

  const roundHours = (value: number) => Math.round((value || 0) * 100) / 100;
  // A BUILD/PRG resource pool (SCIO or External) stores its single-column ("fewer than 2 people
  // selected") weekly values in the same cellInputs map as its grid mode, under SOLO_COLUMN --
  // WeekSplitEditor's single-list rendering wants them back out as a plain array, one per week.
  const deriveSoloWeeklyInputs = (cellInputs: Record<string, string>, weekCount: number): string[] =>
    Array.from({ length: Math.max(1, weekCount) }, (_, i) => cellInputs[`${SOLO_COLUMN}::${i}`] ?? '');
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
    setEditingHours(0);
    setEditingComment('');
    setEditingHoursInput('');
    setSelectedEmployees(new Set());
    setSupportEmployeeToAdd('');
    setShowDeleteConfirm(false);
    setShowMoveWeeksModal(false);
    setEditingWeekCount(1);
    setEditingWeeklyEven(true);
    setEditingWeeklyHoursInputs([]);
  };

  const stageEntriesTotalHours = useMemo(
    () => roundHours(editingStageEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0)),
    [editingStageEntries]
  );

  const stageResourceTotalHours = useMemo(() => {
    if (!editingCell) return 0;
    const hasStagePlanner = STAGE_OPTIONS[editingCell.department].length > 0;
    if (!hasStagePlanner) return 0;

    const isBuildOrPRGDept = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    if (isBuildOrPRGDept) {
      // BUILD/PRG keeps each entry's own scioHours+externalHours as the source of truth --
      // per-employee allocation lives in the entry's own week x person grids (WeekSplitEditor's
      // `columns`), not in editingStageResourceHours (that mechanism is HD/MED-only).
      return stageEntriesTotalHours;
    }

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
    const hasStagePlanner = STAGE_OPTIONS[editingCell.department].length > 0;
    if (!hasStagePlanner) return;

    setEditingHours(stageResourceTotalHours);
    setEditingHoursInput(stageResourceTotalHours > 0 ? `${stageResourceTotalHours}` : '');
  }, [editingCell, stageResourceTotalHours]);

  useEffect(() => {
    if (!editingCell) return;
    const hasStagePlanner = STAGE_OPTIONS[editingCell.department].length > 0;
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

  // Track API record IDs for External Team Capacity (for deletion)
  // Structure: { `${externalTeamKey(department, teamName)}-${weekDate}`: recordId }
  const [prgExternalRecordIds, setPrgExternalRecordIds] = useState<Record<string, string>>({});

  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    type: 'subcontracted' | 'external' | null;
    department?: Department;
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

  // Active external teams for MED/HD/MFG/PRG - Use global store and subscribe to changes
  const { teamsByDepartment: externalTeamsByDepartment, setTeamsForDepartment: setExternalTeamsForDepartment } = useExternalTeamsStore();
  const getExternalTeamsFor = (department: Department): string[] => externalTeamsByDepartment[department] || [];

  // External Personnel state for MED/HD/MFG/PRG, keyed by externalTeamKey(department, teamName)
  // Structure: { [externalTeamKey(department, teamName)]: { weekDate: count } }
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

  // Modal state for adding an external team (MED/HD/MFG/PRG) -- which department's "Add"
  // button was clicked, or null when the modal is closed.
  const [externalTeamModalDept, setExternalTeamModalDept] = useState<Department | null>(null);
  const [externalTeamName, setExternalTeamName] = useState('');
  const [externalTeamHeadcount, setExternalTeamHeadcount] = useState('');
  // Per-stage hourly rate entered at creation time, keyed by stage (or '' when the department
  // has no Stage concept, e.g. MFG -- a single flat rate). Required for every stage shown,
  // same as adding the provider itself.
  const [externalTeamRateInputs, setExternalTeamRateInputs] = useState<Record<string, string>>({});

  // Modal state for adding BUILD subcontracted teams
  const [isBuildModalOpen, setIsBuildModalOpen] = useState(false);
  const [buildTeamName, setBuildTeamName] = useState('');
  const [buildTeamHeadcount, setBuildTeamHeadcount] = useState('');
  const [buildTeamRateInputs, setBuildTeamRateInputs] = useState<Record<string, string>>({});

  // Modal state for logging SCIO headcount hires/departures
  const [isHeadcountModalOpen, setIsHeadcountModalOpen] = useState(false);

  // Modal state for logging external staff hires/departures (MED/HD/MFG/BUILD/PRG)
  const [isExternalStaffModalOpen, setIsExternalStaffModalOpen] = useState(false);

  // Modal state for managing external provider rates (MED/HD/MFG/BUILD/PRG). Bumping
  // providerRateVersion re-runs the project cost summary fetch below (its own mutation
  // tracking is assignment-only, so a rate change elsewhere needs this nudge to show up
  // in the Qtd/Used/Fcst $ figures without a full page reload).
  const [isProviderRateModalOpen, setIsProviderRateModalOpen] = useState(false);
  const [providerRateVersion, setProviderRateVersion] = useState(0);

  // Change Orders (quoted hours/$ per project/department) are now registered from the
  // Projects page, not here -- this page only reads them (read-only) to fold their quoted
  // hours/$ into the Qtd totals shown in the Summary columns. See getQuotedChangeOrders.
  const [changeOrders, setChangeOrders] = useState<ProjectChangeOrder[]>([]);

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
  const [importProjectSearchTerm, setImportProjectSearchTerm] = useState('');
  const [isImportProjectSearchOpen, setIsImportProjectSearchOpen] = useState(false);
  const [showExportPdfModal, setShowExportPdfModal] = useState(false);
  const [pdfExportScope, setPdfExportScope] = useState<PdfExportScope>('single');
  const [selectedExportProjectId, setSelectedExportProjectId] = useState('');
  const [selectedExportProjectIds, setSelectedExportProjectIds] = useState<string[]>([]);
  const [selectedVisibleProjectId, setSelectedVisibleProjectId] = useState('');
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  const [isProjectSearchOpen, setIsProjectSearchOpen] = useState(false);
  // All open projects show by default now (no "show all" toggle needed).
  const [showClosedProjects, setShowClosedProjects] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [showTimingChangesModal, setShowTimingChangesModal] = useState(false);
  const [timingChangesFromDate, setTimingChangesFromDate] = useState<string>(() => `${new Date().getFullYear()}-01-01`);
  const [timingChangesToDate, setTimingChangesToDate] = useState<string>(() => getEndOfYearDate(new Date().getFullYear()));
  const [timingChangesLogs, setTimingChangesLogs] = useState<ActivityLogEntry[]>([]);
  const [timingAssignmentLogs, setTimingAssignmentLogs] = useState<ActivityLogEntry[]>([]);
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
    setTimingAssignmentLogs([]);
    setTimingChangesError(null);
  }, [isTimingAuditGeneralView]);

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_ORDER_STORAGE_KEY, JSON.stringify(projectOrderByScope));
    } catch (error) {
      console.error('[CapacityMatrix] Failed to persist project order:', error);
    }
  }, [projectOrderByScope]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (projectSearchContainerRef.current?.contains(target)) {
        return;
      }

      if (importProjectSearchContainerRef.current?.contains(target)) {
        return;
      }

      setIsProjectSearchOpen(false);
      setIsImportProjectSearchOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  // No need to handle resize - always showing desktop view with scrollable containers

  // NOTE: Teams are now loaded from API in the loadTeamsData useEffect below
  // The old method of loading from employees list has been replaced with API loading
  // This ensures teams persist across page refreshes

  // Load SCIO Team Capacity from API. Hoisted out of the mount effect so the
  // SCIO headcount modal can trigger a refresh after logging a hire/departure
  // (the backend recomputes capacity for every affected week server-side).
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

  // Load SCIO Team Capacity from API on mount
  useEffect(() => {
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
              costQuoted: row.costQuoted !== null && row.costQuoted !== undefined ? Number(row.costQuoted) : null,
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

  // Load BUILD and PRG teams from API, and load subcontracted/external personnel capacity data.
  // Hoisted out of the mount effect (like loadScioTeamCapacity above) so the external staff
  // headcount modal can trigger a refresh after logging a hire/departure.
  const loadTeamsData = async () => {
      try {
        // Load active BUILD teams
        const buildStore = useBuildTeamsStore.getState();
        await buildStore.loadActiveTeams();
        console.log('[CapacityMatrix] BUILD teams loaded, activeTeams =', buildStore.activeTeams);

        // Load active external teams (MED/HD/MFG/PRG)
        const externalTeamsStore = useExternalTeamsStore.getState();
        await externalTeamsStore.loadActiveTeams();
        console.log('[CapacityMatrix] External teams loaded, teamsByDepartment =', externalTeamsStore.teamsByDepartment);

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

        // Load external team capacity data (MED/HD/MFG/PRG)
        console.log('[CapacityMatrix] Loading External Team Capacity from API...');
        const prgExternalData = await prgExternalTeamCapacityApi.getAll();
        const newPrgExternalPersonnel: Record<string, Record<string, number | undefined>> = {};
        const newPrgExternalRecordIds: Record<string, string> = {};
        const prgExternalLatestByKey: Record<string, number> = {};

        for (const record of prgExternalData) {
          const department = record.department as Department;
          const teamName = record.teamName;
          const weekDate = normalizeWeekStartDate(record.weekStartDate);
          const capacity = record.capacity;

          if (department && teamName && weekDate) {
            const team = externalTeamKey(department, teamName);
            const recordKey = `${team}-${weekDate}`;
            const timestampSource = record.updatedAt || record.createdAt;
            const recordTimestamp = timestampSource ? new Date(timestampSource).getTime() : 0;
            const safeTimestamp = Number.isNaN(recordTimestamp) ? 0 : recordTimestamp;
            const existingTimestamp = prgExternalLatestByKey[recordKey];
            if (existingTimestamp !== undefined && safeTimestamp < existingTimestamp) {
              continue;
            }
            if (!newPrgExternalPersonnel[team]) {
              newPrgExternalPersonnel[team] = {};
            }
            newPrgExternalPersonnel[team][weekDate] = capacity;
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

  useEffect(() => {
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
      'PURCHASING': source['PURCHASING'] || {},
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
    if (!canEditDepartment(dept)) {
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
    if (!canEditDepartment(dept)) {
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
    if (!canEditDepartment(dept)) {
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
    if (!canEditDepartment('BUILD')) {
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

  // Save External Team Capacity to API (MED/HD/MFG/PRG)
  const savePrgExternalCapacity = async (department: Department, teamName: string, weekDate: string, capacity: number | undefined) => {
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    const team = externalTeamKey(department, teamName);
    console.log('[CapacityMatrix] savePrgExternalCapacity called:', { department, teamName, weekDate: normalizedWeek, capacity });

    try {
      if (capacity === undefined) {
        console.log('[CapacityMatrix] Skipping External Team save - capacity is undefined');
        return;
      }

      console.log('[CapacityMatrix] Saving External Team capacity:', department, teamName, normalizedWeek, capacity);
      console.log('[CapacityMatrix] Sending CREATE request to API...');
      const result = await prgExternalTeamCapacityApi.create({
        department,
        teamName,
        weekStartDate: normalizedWeek,
        capacity,
      });
      console.log('[CapacityMatrix] UPSERT succeeded:', result);

      const resultWeek = normalizeWeekStartDate(result.weekStartDate || normalizedWeek);

      setPRGExternalPersonnel(prev => ({
        ...prev,
        [team]: {
          ...(prev[team] || {}),
          [resultWeek]: capacity,
        },
      }));

      setPrgExternalRecordIds(prev => ({
        ...prev,
        [`${team}-${resultWeek}`]: result.id,
      }));

      // Log activity
      await activityLogApi.logActivity(
        'updated',
        'PrgExternalTeamCapacity',
        result.id,
        { department, teamName, weekStartDate: resultWeek, capacity }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] ERROR saving External Team capacity:', errorMsg);
      alert(`Error al guardar capacidad externa (${department} - ${teamName} - ${normalizedWeek}): ${errorMsg}`);
    }
  };

  const handlePrgExternalChange = (department: Department, teamName: string, weekDate: string, newCount: number | undefined) => {
    if (!canEditDepartment(department)) {
      return;
    }
    const normalizedWeek = normalizeWeekStartDate(weekDate);
    const team = externalTeamKey(department, teamName);
    console.log('[CapacityMatrix] handlePrgExternalChange called:', { department, teamName, weekDate: normalizedWeek, newCount });

    // Update local state immediately
    setPRGExternalPersonnel(prev => ({
      ...prev,
      [team]: {
        ...(prev[team] || {}),
        [normalizedWeek]: newCount,
      },
    }));

    // Debounce the API call
    const timeoutKey = `${team}-${normalizedWeek}`;
    if (prgExternalSaveTimeouts.current[timeoutKey]) {
      console.log('[CapacityMatrix] Clearing previous External Team timeout for key:', timeoutKey);
      clearTimeout(prgExternalSaveTimeouts.current[timeoutKey]);
    }
    console.log('[CapacityMatrix] Setting External Team debounce timeout for key:', timeoutKey);
    prgExternalSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      console.log('[CapacityMatrix] External Team debounce timeout fired for key:', timeoutKey);
      if (newCount !== undefined) {
        savePrgExternalCapacity(department, teamName, normalizedWeek, newCount);
      }
    }, 500);
  };

  // Delete team handler
  const handleDeleteTeam = async () => {
    if (!deleteConfirmation.isOpen || !deleteConfirmation.teamName || !deleteConfirmation.type) {
      return;
    }
    const deleteDepartment = deleteConfirmation.type === 'external' ? deleteConfirmation.department : 'BUILD';
    if (!deleteDepartment || !canEditDepartment(deleteDepartment)) {
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
      } else if (type === 'external' && deleteConfirmation.department) {
        const department = deleteConfirmation.department;
        const team = externalTeamKey(department, teamName);

        // Delete all records for this team from database
        const recordsToDelete = Object.keys(prgExternalRecordIds).filter(
          key => key.startsWith(`${team}-`)
        );
        deletedRecordId = recordsToDelete.length > 0 ? prgExternalRecordIds[recordsToDelete[0]] : undefined;

        for (const recordKey of recordsToDelete) {
          const recordId = prgExternalRecordIds[recordKey];
          await prgExternalTeamCapacityApi.delete(recordId);
        }

        // Update local state
        setPRGExternalPersonnel(prev => {
          const newState = { ...prev };
          delete newState[team];
          return newState;
        });

        // Update record IDs
        setPrgExternalRecordIds(prev => {
          const newIds = { ...prev };
          Object.keys(newIds).forEach(key => {
            if (key.startsWith(`${team}-`)) {
              delete newIds[key];
            }
          });
          return newIds;
        });

        // Remove from active teams
        setExternalTeamsForDepartment(department, getExternalTeamsFor(department).filter(t => t !== teamName));
      }

      console.log(`[CapacityMatrix] Deleted ${type} team: ${teamName}`);

      // Log activity (use a valid UUID from deleted records if available)
      if (deletedRecordId) {
        await activityLogApi.logActivity(
          'deleted',
          type === 'subcontracted' ? 'SubcontractedTeamCapacity' : 'PrgExternalTeamCapacity',
          deletedRecordId,
          { type, department: deleteConfirmation.department, teamName }
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
  const importProjectSearchContainerRef = useRef<HTMLDivElement>(null);
  const projectSearchContainerRef = useRef<HTMLDivElement>(null);
  // Keyed by project id -> that project's <tbody> in the unified capacity grid (see "Unified
  // capacity grid" below); used only by the PDF export, which needs to capture each project's
  // rows as a standalone image (see handleExportTimelinePdf).
  const projectTableRefs = useRef<Map<string, HTMLTableSectionElement>>(new Map());
  const projectCellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const isPastingProjectCellRef = useRef(false);

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
  const timingChangesByWeek = useMemo<TimingWeekGroup[]>(() => {
    const grouped = new Map<string, {
      weekStart: string;
      yearWeek: string;
      entries: TimingWeekEntry[];
      projectIds: Set<string>;
    }>();

    timingChangesByProject.forEach((projectGroup) => {
      projectGroup.entries.forEach((entry) => {
        const changedAt = new Date(entry.createdAt);
        if (Number.isNaN(changedAt.getTime())) return;

        const weekStart = normalizeWeekStartDate(formatToISO(getWeekStart(changedAt)));
        const weekDate = parseISODate(weekStart);
        const year = Number.isNaN(weekDate.getTime()) ? changedAt.getFullYear() : weekDate.getFullYear();
        const weekNum = getWeekNumber(weekStart);
        const yearWeek = `${year}-CW${String(weekNum).padStart(2, '0')}`;
        const current = grouped.get(weekStart) || {
          weekStart,
          yearWeek,
          entries: [],
          projectIds: new Set<string>(),
        };

        current.entries.push({
          projectId: projectGroup.projectId,
          projectName: projectGroup.projectName,
          entry,
        });
        current.projectIds.add(projectGroup.projectId);
        grouped.set(weekStart, current);
      });
    });

    return Array.from(grouped.values())
      .map((group) => ({
        weekStart: group.weekStart,
        yearWeek: group.yearWeek,
        entries: [...group.entries].sort(
          (a, b) => new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime()
        ),
        projectCount: group.projectIds.size,
      }))
      .sort((a, b) => new Date(b.weekStart).getTime() - new Date(a.weekStart).getTime());
  }, [timingChangesByProject]);
  const changeOrderSummaryByProjectDept = useMemo(() => {
    const map = new Map<string, { totalHours: number; totalCost: number; count: number; orders: ProjectChangeOrder[] }>();

    changeOrders.forEach((order) => {
      const key = `${order.projectId}|${order.department}`;
      const entry = map.get(key) || { totalHours: 0, totalCost: 0, count: 0, orders: [] };
      entry.totalHours += order.hoursQuoted || 0;
      entry.totalCost += order.costQuoted || 0;
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
        // "Original" (fixed-calendar) range, as frozen server-side the first time
        // each department/stage's dates were ever set -- independent of the
        // relative-week bookkeeping above, and never moves on a later edit or a
        // Timing file re-upload (see Project.original_start_date/original_end_date
        // and DepartmentStageConfig.original_start_date/original_duration_weeks).
        let minOriginalStartDate: string | undefined;
        let maxOriginalEndDate: string | undefined;

        if (dept === 'PM') {
          deptStartDate = proj.startDate;
          deptDuration = proj.numberOfWeeks || 0;
          minOriginalStartDate = proj.originalStartDate || undefined;
          maxOriginalEndDate = proj.originalEndDate || undefined;
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

              if (stageCfg.originalStartDate) {
                if (!minOriginalStartDate || stageCfg.originalStartDate < minOriginalStartDate) {
                  minOriginalStartDate = stageCfg.originalStartDate;
                }
                const originalDuration = stageCfg.originalDurationWeeks || (weekEndNum - weekStartNum + 1);
                if (Number.isFinite(originalDuration) && originalDuration > 0) {
                  const originalEnd = parseISODate(stageCfg.originalStartDate);
                  originalEnd.setDate(originalEnd.getDate() + (originalDuration * 7) - 1);
                  const originalEndIso = formatToISO(originalEnd);
                  if (!maxOriginalEndDate || originalEndIso > maxOriginalEndDate) {
                    maxOriginalEndDate = originalEndIso;
                  }
                }
              }
            });

            deptStartDate = minWeekStartDate;
            if (Number.isFinite(minWeekStart) && Number.isFinite(maxWeekEnd)) {
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
        const expectedStartDate = minOriginalStartDate || effectiveStartDate;
        const expectedEndDate = maxOriginalEndDate || effectiveEndDate;
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
        showShiftedRangeBorder: false,
        showOverlappedShiftBorder: false,
      };
    }

    const deptMeta = projectDeptMetaByKey.get(`${project.id}|${department}`);
    const effectiveDeptStartDate = deptMeta?.effectiveStartDate || project.startDate || '';
    const effectiveDeptEndDate = deptMeta?.effectiveEndDate || project.endDate || project.startDate || '';
    const expectedDeptStartDate = deptMeta?.expectedStartDate || project.startDate || '';
    const expectedDeptEndDate = deptMeta?.expectedEndDate || project.endDate || project.startDate || '';
    const isDeptWeekInRange =
      !!effectiveDeptStartDate &&
      !!effectiveDeptEndDate &&
      weekStart >= effectiveDeptStartDate &&
      weekStart <= effectiveDeptEndDate;
    const isWeekInExpectedRange =
      !!expectedDeptStartDate &&
      !!expectedDeptEndDate &&
      weekStart >= expectedDeptStartDate &&
      weekStart <= expectedDeptEndDate;
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
    const showShiftedRangeBorder = hasDepartmentTimingShift && isDeptWeekInRange;
    const showOverlappedShiftBorder = hasDepartmentTimingShift && isDeptWeekInRange && isWeekInExpectedRange;

    return {
      showHardOutOfRangeIndicator,
      showShiftGapBackground,
      showShiftDashedIndicator,
      showShiftedRangeBorder,
      showOverlappedShiftBorder,
    };
  };

  const computeMonthSpans = (weeks: typeof allWeeksData) => {
    const months: Array<{ month: string; startIdx: number; endIdx: number }> = [];
    let currentMonth = '';
    let startIdx = 0;

    weeks.forEach((weekData, idx) => {
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

      if (idx === weeks.length - 1) {
        months.push({ month: currentMonth, startIdx, endIdx: idx });
      }
    });

    return months;
  };

  const monthSpans = useMemo(
    () => computeMonthSpans(allWeeksData),
    [allWeeksData, locale]
  );

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

  // Past weeks are locked: their hours come from the Finance actuals import, not
  // manual entry (see ProjectDepartmentWeeklyActual on the backend, which enforces
  // this same rule server-side). Full-access users are exempt for corrections.
  const isWeekLocked = (weekStart: string): boolean => {
    if (hasFullAccess) return false;
    return normalizeWeekStartDate(weekStart) < currentWeekStart;
  };
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

  const [hoursByProjectDeptAll, setHoursByProjectDeptAll] = useState<Record<string, { utilized: number; forecast: number; utilizedCost: number | null; forecastCost: number | null }>>({});

  useEffect(() => {
    const projectIds = projects.map((p) => p.id).filter(Boolean);
    if (!currentWeekStart || projectIds.length === 0) {
      return;
    }

    const department = departmentFilter === 'General' ? undefined : (departmentFilter as Department);

    assignmentsApi.getSummaryByProjectDept({ projectIds, department, currentWeekStart })
      .then((rows: any[]) => {
        const map: Record<string, { utilized: number; forecast: number; utilizedCost: number | null; forecastCost: number | null }> = {};
        (rows || []).forEach((row) => {
          if (!row?.projectId || !row?.department) return;
          map[`${row.projectId}-${row.department}`] = {
            utilized: row.utilized || 0,
            forecast: row.forecast || 0,
            utilizedCost: row.utilizedCost ?? null,
            forecastCost: row.forecastCost ?? null,
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
  }, [projects, departmentFilter, currentWeekStart, assignmentMutationVersion, providerRateVersion]);

  // Real historical hours for past weeks (no per-employee breakdown), sourced from
  // the Finance actuals import. Merged into assignmentIndex below so every cell/
  // summary that already reads from assignmentIndex picks these up automatically.
  const [financeActuals, setFinanceActuals] = useState<ProjectDepartmentWeeklyActual[]>([]);

  useEffect(() => {
    const projectIds = projects.map((p) => p.id).filter(Boolean);
    if (projectIds.length === 0) {
      setFinanceActuals([]);
      return;
    }

    const department = departmentFilter === 'General' ? undefined : (departmentFilter as Department);

    projectDepartmentWeeklyActualsApi.getAll({ projectIds, department })
      .then((rows: ProjectDepartmentWeeklyActual[]) => {
        setFinanceActuals(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        console.error('[CapacityMatrix] Error loading Finance actuals (keeping last good values):', error);
      });
  }, [projects, departmentFilter, assignmentMutationVersion]);

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

    // Fold in Finance actuals (real historical hours, no per-employee breakdown) for
    // any past week. No `assignments` are pushed onto the cell (there's no employee
    // to attribute them to) — only totals, which is all the read-only locked-week
    // cells need to display.
    financeActuals.forEach((actual) => {
      const normalizedWeekStart = normalizeWeekStartDate(actual.weekStartDate);
      const cellKey = `${actual.projectId}|${actual.department}|${normalizedWeekStart}`;
      const cellEntry = byCell.get(cellKey) ?? { totalHours: 0, assignments: [], stage: null, comment: undefined };
      cellEntry.totalHours += actual.hours;
      byCell.set(cellKey, cellEntry);

      const projectDeptKey = `${actual.projectId}|${actual.department}`;
      projectDeptTotals.set(projectDeptKey, (projectDeptTotals.get(projectDeptKey) || 0) + actual.hours);

      const deptWeekKey = `${actual.department}|${normalizedWeekStart}`;
      deptWeekTotals.set(deptWeekKey, (deptWeekTotals.get(deptWeekKey) || 0) + actual.hours);
    });

    return { byCell, deptWeekTotals, deptWeekExternalTotals, projectDeptTotals };
  }, [assignments, employeeDeptMap, financeActuals]);

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
    return projects.filter((proj) => {
      if (!showClosedProjects && proj.isClosed) return false;
      return isProjectVisibleInDepartment(proj, dept);
    });
  }, [projects, departmentFilter, showClosedProjects]);

  const generalProjects = useMemo(() => {
    if (departmentFilter !== 'General') {
      return [];
    }

    const { rangeStart, rangeEnd } = weekRange;
    return projects.filter((proj) => {
      if (!showClosedProjects && proj.isClosed) return false;
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
  }, [projects, departmentFilter, weekRange, assignmentProjectIdsInRange, showClosedProjects]);

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

  // All open (not showClosedProjects-excluded) projects show by default -- a specific
  // selection via the search box narrows the list down to just that one project.
  const filteredDepartmentProjects = useMemo(() => {
    if (!selectedVisibleProjectId) {
      return orderedDepartmentProjects;
    }

    return orderedDepartmentProjects.filter((proj) => proj.id === selectedVisibleProjectId);
  }, [orderedDepartmentProjects, selectedVisibleProjectId]);

  const filteredGeneralProjects = useMemo(() => {
    if (!selectedVisibleProjectId) {
      return orderedGeneralProjects;
    }

    return orderedGeneralProjects.filter((proj) => proj.id === selectedVisibleProjectId);
  }, [orderedGeneralProjects, selectedVisibleProjectId]);

  const orderedProjectsInCurrentView = useMemo(() => {
    return departmentFilter === 'General' ? orderedGeneralProjects : orderedDepartmentProjects;
  }, [departmentFilter, orderedDepartmentProjects, orderedGeneralProjects]);

  const formatProjectSearchLabel = (proj: Project): string => `${proj.name} | ${proj.client}`;

  const filteredProjectSearchOptions = useMemo(() => {
    const normalizedSearch = projectSearchTerm.trim().toLowerCase();
    if (!normalizedSearch) {
      return orderedProjectsInCurrentView;
    }

    return orderedProjectsInCurrentView.filter((proj) =>
      formatProjectSearchLabel(proj).toLowerCase().includes(normalizedSearch)
    );
  }, [orderedProjectsInCurrentView, projectSearchTerm]);

  const projectsVisibleInCurrentView = useMemo(() => {
    return departmentFilter === 'General' ? filteredGeneralProjects : filteredDepartmentProjects;
  }, [departmentFilter, filteredDepartmentProjects, filteredGeneralProjects]);

  const hasActiveProjectListFilters =
    selectedVisibleProjectId.length > 0 ||
    projectSearchTerm.trim().length > 0;

  const departmentProjectRowById = useMemo(() => {
    const map = new Map<string, number>();
    filteredDepartmentProjects.forEach((proj, idx) => map.set(proj.id, idx));
    return map;
  }, [filteredDepartmentProjects]);

  useEffect(() => {
    if (!selectedVisibleProjectId) return;

    const selectedStillExists = orderedProjectsInCurrentView.some((proj) => proj.id === selectedVisibleProjectId);
    if (!selectedStillExists) {
      setSelectedVisibleProjectId('');
      setProjectSearchTerm('');
    }
  }, [selectedVisibleProjectId, orderedProjectsInCurrentView]);

  useEffect(() => {
    if (departmentFilter === 'General' || !selectedProjectCell) return;

    const selectedStillVisible = filteredDepartmentProjects.some((proj) => proj.id === selectedProjectCell.projectId);
    if (!selectedStillVisible) {
      setSelectedProjectCell(null);
    }
  }, [departmentFilter, filteredDepartmentProjects, selectedProjectCell]);

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

  // Accordion behavior: only one project is open at a time, because having
  // several expanded project tables scroll-synced together makes horizontal
  // scrolling lag. (PDF export sets expandedProjects directly, so it can still
  // expand several at once.)
  // Independent per-project toggle -- several projects can be expanded at once. This used to
  // collapse every other project first (an accordion), which was a workaround for the
  // horizontal-scroll lag that multiple open projects caused under the old per-project-table +
  // JS scroll-sync design. The unified capacity grid (see "Unified capacity grid" in the
  // General/department view render blocks) removes that lag at the root, so this restriction
  // is no longer needed.
  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  // Still matches legacy "DEPT Placeholder" employees that existing historical assignments may
  // reference (filtered out of Available Resources, etc.) -- saving no longer creates new ones
  // (see the no-resources-selected lock in handleSaveCell), but old data can still have them.
  function isPlaceholderEmployee(emp?: Employee | null) {
    return !!emp && (emp.role === 'Placeholder' || emp.name.endsWith('Placeholder'));
  }

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
        PURCHASING: 0,
        [dept]: Number.isFinite(budgetHours) ? budgetHours : 0,
      },
      departmentHoursUtilized: {
        PM: 0,
        MED: 0,
        HD: 0,
        MFG: 0,
        BUILD: 0,
        PRG: 0,
        PURCHASING: 0,
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
    if (departmentFilter === 'General') {
      return;
    }

    const dept = departmentFilter as Department;
    if (!canEditDepartment(dept)) {
      alert(language === 'es'
        ? 'No tienes permiso para importar proyectos en este departamento.'
        : 'You do not have permission to import projects in this department.');
      return;
    }

    const isPmImport = dept === 'PM';

    if (
      !importProjectForm.projectId ||
      (!isPmImport && (!importProjectForm.startDate || !importProjectForm.numberOfWeeks))
    ) {
      const missing: string[] = [];
      if (!importProjectForm.projectId) missing.push(t.selectProject || 'Project');
      if (!isPmImport && !importProjectForm.startDate) missing.push(t.startDate || 'Start Date');
      if (!isPmImport && !importProjectForm.numberOfWeeks) missing.push(t.numberOfWeeks || 'Number of Weeks');
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

    const budgetHours = Number(importProjectForm.budgetHours || 0);
    const existingHours = selectedProject.departmentHoursAllocated;
    const currentVisible = selectedProject.visibleInDepartments || [];
    const newVisibleInDepartments = currentVisible.includes(dept)
      ? currentVisible
      : [...currentVisible, dept];
    const newDepartmentHoursAllocated: Record<string, number> = {
      PM: existingHours?.PM || 0,
      MED: existingHours?.MED || 0,
      HD: existingHours?.HD || 0,
      MFG: existingHours?.MFG || 0,
      BUILD: existingHours?.BUILD || 0,
      PRG: existingHours?.PRG || 0,
    };

    if (Number.isFinite(budgetHours) && importProjectForm.budgetHours !== '') {
      newDepartmentHoursAllocated[dept] = budgetHours;
    }

    if (dept === 'PM') {
      await updateProject(selectedProject.id, {
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
      setImportProjectSearchTerm('');
      setIsImportProjectSearchOpen(false);
      return;
    }

    const startDateISO = importProjectForm.startDate;
    const numberOfWeeks = importProjectForm.numberOfWeeks as number;

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
    newDepartmentHoursAllocated[dept] = Number.isFinite(budgetHours) ? budgetHours : 0;

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
    setImportProjectSearchTerm('');
    setIsImportProjectSearchOpen(false);
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

  const filteredProjectsForImport = useMemo(() => {
    const normalizedSearch = importProjectSearchTerm.trim().toLowerCase();
    const availableProjects = getAvailableProjectsForImport();

    if (!normalizedSearch) {
      return availableProjects;
    }

    return availableProjects.filter((proj) =>
      [proj.name, proj.client].some((value) => value.toLowerCase().includes(normalizedSearch))
    );
  }, [departmentFilter, importProjectSearchTerm, projects]);

  const isGeneralView = departmentFilter === 'General';

  // On entering the Capacity Matrix (and whenever the department filter changes), scroll the
  // active view's single unified table to start 3 weeks before the current week rather than
  // the very first week. Requires a real DOM measurement (via data-week-index) rather than a
  // known offset. Projects/assignments still finish loading asynchronously after mount, and
  // the resulting layout/width change makes the browser clamp scrollLeft back toward 0 -- so
  // this re-applies itself (recomputing fresh each time) across a few animation frames AND
  // once real project/assignment data lands, instead of firing only once on mount.
  //
  // There's only one scroll container per view now (General/department each have their own
  // `overflow-auto` unified table -- see generalCapacityScrollRef/departmentCapacityScrollRef
  // below), so this no longer needs to sync scroll position across multiple tables with JS;
  // that cross-table sync was the root cause of the horizontal-scroll lag with more than one
  // project open, which the unified table removes entirely.
  useEffect(() => {
    const targetWeekIndex = currentDateWeekIndex >= 0 ? Math.max(0, currentDateWeekIndex - 3) : 0;

    const applyInitialScroll = () => {
      const container = isGeneralView ? generalCapacityScrollRef.current : departmentCapacityScrollRef.current;
      if (!container) return;
      const targetEl = container.querySelector<HTMLElement>(`[data-week-index="${targetWeekIndex}"]`);
      if (!targetEl) return;
      // Measure via getBoundingClientRect (always viewport-relative) rather than offsetLeft,
      // which is relative to offsetParent — not necessarily this scroll container — and gave
      // inconsistent results here. The left-hand department/"People" label column is sticky and
      // visually overlays the start of the scrolled content regardless of scrollLeft, so its
      // width is subtracted to land the target week just past it, not partly hidden behind it.
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const labelEl = container.querySelector<HTMLElement>('.sticky');
      const labelWidth = labelEl?.getBoundingClientRect().width ?? 0;
      const scrollLeftDelta = (targetRect.left - containerRect.left) - labelWidth;
      container.scrollLeft += scrollLeftDelta;
    };

    const rafA = requestAnimationFrame(applyInitialScroll);
    const rafB = requestAnimationFrame(applyInitialScroll);
    const retryTimeouts = [200, 600, 1200].map((delay) => setTimeout(applyInitialScroll, delay));
    return () => {
      cancelAnimationFrame(rafA);
      cancelAnimationFrame(rafB);
      retryTimeouts.forEach(clearTimeout);
    };
  }, [departmentFilter, projects.length, assignments.length]);

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

  // Utilization counting only hours already used (no forecast), same rules as getUtilizationPercent.
  const getCurrentUtilizationPercent = (department: Department, projectId: string): number => {
    const project = projectById.get(projectId);
    if (!project) return 0;
    const utilizedHoursValue = getUtilizedHours(department, projectId);
    const totalQuoted = (project.departmentHoursAllocated?.[department] || 0) + getQuotedChangeOrders(department, projectId);
    if (totalQuoted === 0) return utilizedHoursValue > 0 ? 100 : 0;
    return Math.round((utilizedHoursValue / totalQuoted) * 100);
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

  // $ cost for utilized/forecast hours, blending the flat department rate (internal hours)
  // with each external provider's own per-stage rate (see the backend's
  // summary-by-project-dept computation) -- null when nothing has a rate registered yet,
  // distinct from a genuine $0. No client-side fallback: this is only available from the
  // server-computed summary (hoursByProjectDeptFallback has no per-employee/rate detail).
  const getUtilizedCost = (department: Department, projectId: string): number | null => {
    const key = `${projectId}-${department}`;
    return hoursByProjectDeptAll[key]?.utilizedCost ?? null;
  };

  const getForecastedCost = (department: Department, projectId: string): number | null => {
    const key = `${projectId}-${department}`;
    return hoursByProjectDeptAll[key]?.forecastCost ?? null;
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

  // $ counterpart of getQuotedChangeOrders, folded into the Qtd $ Summary figure alongside
  // departmentCostAllocated -- null when nothing (budget or CO) has a $ amount registered,
  // same "not registered" convention as quotedCostValue elsewhere.
  const getQuotedChangeOrdersCost = (department: Department, projectId: string): number => {
    const summary = changeOrderSummaryByProjectDept.get(`${projectId}|${department}`);
    return summary?.totalCost || 0;
  };

  const formatHours = (value: number): string => {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 1000) / 1000;
    return rounded.toFixed(3).replace(/\.?0+$/, '');
  };

  const formatSummaryHours = (value: number): string => {
    if (!Number.isFinite(value)) return '0h';
    const absValue = Math.abs(value);
    if (absValue >= 1000) return `${Math.round(value)}h`;
    if (absValue >= 100) {
      const roundedOneDecimal = Math.round(value * 10) / 10;
      return `${roundedOneDecimal.toFixed(1).replace(/\.0$/, '')}h`;
    }
    return `${formatHours(value)}h`;
  };

  const formatCurrencyFull = (value: number): string => {
    if (!Number.isFinite(value)) return '$0.00';
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Compact currency for the 60px-wide Summary cells: $850, $12,345, $123.5k, $1.2M.
  const formatSummaryCurrency = (value: number): string => {
    if (!Number.isFinite(value)) return '$0';
    const absValue = Math.abs(value);
    if (absValue >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (absValue >= 100_000) return `$${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return `$${Math.round(value).toLocaleString('en-US')}`;
  };

  // Renders the 4 summary cells (Qtd/Used/Fcst/Util) for one department row, placed as the last
  // cells of that row. Qtd/Used/Fcst: hours on top, $ underneath. Util: current % on top and the
  // % including forecast underneath, each half colored by its own level. The row's own department
  // label and the column headers already identify what each cell is, so no per-cell labels here.
  const renderProjectDepartmentSummaryCells = (projectId: string, dept: Department) => {
    const quotedHoursValue = getQuotedHours(dept, projectId);
    const quotedChangeOrdersValue = getQuotedChangeOrders(dept, projectId);
    const totalQuotedHoursValue = quotedHoursValue + quotedChangeOrdersValue;
    const utilizedHoursValue = getUtilizedHours(dept, projectId);
    const forecastedHoursValue = getForecastedHours(dept, projectId);
    const utilizationPercent = getUtilizationPercent(dept, projectId);
    const currentUtilizationPercent = getCurrentUtilizationPercent(dept, projectId);
    const deptLabel = getDepartmentLabel(dept, t);
    const showDepartmentLongLabel = departmentFilter !== 'General';
    const departmentTitleLabel = showDepartmentLongLabel ? deptLabel : dept;

    // $ amounts. Qtd $ is the project's registered budget plus any Change Orders' quoted $
    // (null only when NEITHER has an amount registered); Used $/Fcst $ come from the backend's
    // summary-by-project-dept, which blends the flat department hourly cost (internal hours)
    // with each external provider's own per-stage rate (see _lookup_provider_rate server-side)
    // -- null when nothing has a rate registered.
    const baseCostValue = projectById.get(projectId)?.departmentCostAllocated?.[dept] ?? null;
    const quotedChangeOrdersCostValue = getQuotedChangeOrdersCost(dept, projectId);
    const quotedCostValue = baseCostValue === null && quotedChangeOrdersCostValue === 0
      ? null
      : (baseCostValue || 0) + quotedChangeOrdersCostValue;
    const usedCostValue = getUtilizedCost(dept, projectId);
    const forecastCostValue = getForecastedCost(dept, projectId);

    const noValue = language === 'es' ? 'no registrado' : 'not registered';
    const noRate = language === 'es' ? 'sin costo por hora' : 'no hourly cost';
    const utilHint = language === 'es' ? 'actual → con forecast' : 'current → with forecast';
    const tooltip = `${departmentTitleLabel}
${t.quotedLabel}: ${formatHours(totalQuotedHoursValue)}h (CO ${formatHours(quotedChangeOrdersValue)}h) · ${quotedCostValue === null ? noValue : formatCurrencyFull(quotedCostValue)}
${t.usedLabel}: ${formatHours(utilizedHoursValue)}h · ${usedCostValue === null ? noRate : formatCurrencyFull(usedCostValue)}
${t.pronosticado}: ${formatHours(forecastedHoursValue)}h · ${forecastCostValue === null ? noRate : formatCurrencyFull(forecastCostValue)}
${t.utilizationLabel}: ${currentUtilizationPercent}% → ${utilizationPercent}% (${utilHint})`;

    const cellClass = 'border border-gray-300 px-0.5 py-0.5 text-center align-middle w-[60px] min-w-[60px] max-w-[60px] sticky z-[15] bg-white';
    const twoLines = (key: SummaryColumnKey, rightOffset: number, hoursLabel: string, cost: number | null) => (
      <td key={key} style={{ right: rightOffset }} className={cellClass} title={tooltip}>
        <div className="text-[11px] font-bold leading-tight text-slate-700 whitespace-nowrap">{hoursLabel}</div>
        <div className={`text-[10px] font-semibold leading-tight whitespace-nowrap ${cost === null ? 'text-gray-400' : 'text-teal-700'}`}>
          {cost === null ? '—' : formatSummaryCurrency(cost)}
        </div>
      </td>
    );

    return (
      <>
        {SUMMARY_COLUMNS.map(({ key, rightOffset }) => {
          if (key === 'qtd') return twoLines(key, rightOffset, formatSummaryHours(totalQuotedHoursValue), quotedCostValue);
          if (key === 'used') return twoLines(key, rightOffset, formatSummaryHours(utilizedHoursValue), usedCostValue);
          if (key === 'fcst') return twoLines(key, rightOffset, formatSummaryHours(forecastedHoursValue), forecastCostValue);
          const currentColor = getUtilizationColor(currentUtilizationPercent);
          const projectedColor = getUtilizationColor(utilizationPercent);
          return (
            <td
              key={key}
              style={{ right: rightOffset }}
              className="border border-gray-300 p-0 text-center align-middle w-[60px] min-w-[60px] max-w-[60px] sticky z-[15] bg-white"
              title={tooltip}
            >
              {/* Each half fills the cell with its own color. The >=100% pulse animates opacity, so
                  color + pulse live on inner layers and the td's white background stays opaque. */}
              <div className="relative py-0.5">
                <div aria-hidden className={`absolute inset-0 ${currentColor.bg}`} />
                <span className={`relative text-[11px] leading-tight whitespace-nowrap ${currentColor.text}`}>
                  {currentUtilizationPercent}%
                </span>
              </div>
              <div className="relative py-0.5 border-t border-white/60">
                <div aria-hidden className={`absolute inset-0 ${projectedColor.bg}`} />
                <span className={`relative text-[10.5px] leading-tight whitespace-nowrap ${projectedColor.text}`}>
                  → {utilizationPercent}%
                </span>
              </div>
            </td>
          );
        })}
      </>
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
  const canImportProjectsInCurrentView =
    departmentFilter !== 'General' &&
    canEditDepartment(departmentFilter as Department);

  const loadProjectTimingChanges = async (
    startDate = timingChangesFromDate,
    endDate = timingChangesToDate
  ) => {
    if (!startDate || !endDate) {
      setTimingChangesLogs([]);
      setTimingAssignmentLogs([]);
      setTimingChangesError(language === 'es'
        ? 'Selecciona ambas fechas para consultar los cambios.'
        : 'Select both dates to query timing changes.');
      return;
    }
    if (startDate > endDate) {
      setTimingChangesLogs([]);
      setTimingAssignmentLogs([]);
      setTimingChangesError(language === 'es'
        ? 'La fecha inicial no puede ser mayor a la fecha final.'
        : 'The start date cannot be greater than the end date.');
      return;
    }

    setIsTimingChangesLoading(true);
    setTimingChangesError(null);
    try {
      const [projectResponse, assignmentResponse] = await Promise.all([
        activityLogApi.getFiltered({
          modelName: 'Project',
          action: 'updated',
          startDate,
          endDate,
          ordering: '-created_at',
          pageSize: 2000,
        }),
        activityLogApi.getFiltered({
          modelName: 'Assignment',
          endDate,
          ordering: 'created_at',
          pageSize: 5000,
        }),
      ]);

      const rows = Array.isArray(projectResponse) ? projectResponse as ActivityLogEntry[] : [];
      const filteredRows = rows.filter((row) => {
        if (!row || row.modelName !== 'Project') return false;
        const action = (row.action || '').toLowerCase();
        if (action !== 'updated' && action !== 'update') return false;

        const updates = extractProjectUpdatePayload(row.changes);
        if (!updates) return false;
        return hasTimingDataDeep(updates);
      });

      const assignmentRows = Array.isArray(assignmentResponse) ? assignmentResponse as ActivityLogEntry[] : [];
      const filteredAssignmentRows = assignmentRows.filter((row) => {
        if (!row || row.modelName !== 'Assignment') return false;
        const action = (row.action || '').toLowerCase();
        return action === 'created' || action === 'create' || action === 'updated' || action === 'update' || action === 'deleted' || action === 'delete';
      });

      setTimingChangesLogs(filteredRows);
      setTimingAssignmentLogs(filteredAssignmentRows);
    } catch (error) {
      console.error('[CapacityMatrix] Error loading project timing changes:', error);
      setTimingChangesLogs([]);
      setTimingAssignmentLogs([]);
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
    const defaultToDate = getEndOfYearDate(selectedYear);
    setTimingChangesFromDate(defaultFromDate);
    setTimingChangesToDate(defaultToDate);
    setShowTimingChangesModal(true);
    void loadProjectTimingChanges(defaultFromDate, defaultToDate);
  };

  const timingCompactPreview = useMemo<TimingCompactPreviewData | null>(() => {
    if (!timingChangesLogs.length) return null;

    const weeklyRange = getWeeksInRange(timingChangesFromDate, timingChangesToDate)
      .map((week) => normalizeWeekStartDate(week))
      .filter((week, idx, arr) => week && arr.indexOf(week) === idx);

    if (weeklyRange.length === 0) {
      return null;
    }

    const timingLogs = [...timingChangesLogs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const assignmentLogs = [...timingAssignmentLogs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    interface CompactDeptTimingSnapshot {
      stage: Stage;
      weekStart: number | null;
      weekEnd: number | null;
      durationWeeks: number | null;
      departmentStartDate: string;
    }

    interface CompactProjectSnapshot {
      projectId: string;
      projectName: string;
      startDate: string;
      numberOfWeeks: number | null;
      departments: Record<Department, CompactDeptTimingSnapshot>;
    }

    interface CompactAssignmentSnapshot {
      projectId: string;
      department: Department | '';
      weekStartDate: string;
      hours: number;
      employeeId: string;
      stage: Stage;
    }

    interface CompactCellState {
      value: string;
      active: boolean;
      isFirstWeek: boolean;
    }

    interface CompactCapacityCellState extends CompactCellState {
      capacityValue: number | null;
      displayValue: string;
      inTimingRange: boolean;
      hasCapacityLoad: boolean;
      stage: Stage;
    }

    interface CompactDepartmentMetrics {
      quotedHours: number;
      usedHours: number;
      forecastedHours: number;
      utilizationPercent: number;
    }

    const normalizeCompactAction = (rawAction: string): 'created' | 'updated' | 'deleted' | 'other' => {
      const action = (rawAction || '').toLowerCase();
      if (action === 'created' || action === 'create') return 'created';
      if (action === 'updated' || action === 'update') return 'updated';
      if (action === 'deleted' || action === 'delete') return 'deleted';
      return 'other';
    };

    const toFiniteNumber = (value: unknown): number | null => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    const roundCompactHours = (value: number) => Math.round((value || 0) * 100) / 100;
    const hasOwn = (obj: Record<string, any>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
    const asCompactNumber = (value: unknown): number | null => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    const asCompactString = (value: unknown): string => (typeof value === 'string' ? value : '');
    const normalizeCompactDepartment = (value: unknown): Department | '' => {
      const raw = asCompactString(value).trim().toUpperCase();
      if (!raw) return '';
      return DEPARTMENT_SET.has(raw as Department) ? (raw as Department) : '';
    };
    const normalizeCompactStage = (value: unknown): Stage => {
      if (value === null) return null;
      const raw = asCompactString(value).trim();
      return raw ? (raw as Stage) : null;
    };

    const resolveCompactHoursFromPayload = (payload: Record<string, any>, fallbackHours: number): number => {
      const hasSplitFields =
        hasOwn(payload, 'scioHours') ||
        hasOwn(payload, 'externalHours') ||
        hasOwn(payload, 'scio_hours') ||
        hasOwn(payload, 'external_hours');

      if (hasSplitFields) {
        const scio = asCompactNumber(payload.scioHours ?? payload.scio_hours) ?? 0;
        const external = asCompactNumber(payload.externalHours ?? payload.external_hours) ?? 0;
        return roundCompactHours(Math.max(0, scio + external));
      }

      const totalCandidate = asCompactNumber(payload.totalHours ?? payload.total_hours);
      if (totalCandidate !== null) return roundCompactHours(Math.max(0, totalCandidate));

      const hoursCandidate = asCompactNumber(payload.hours);
      if (hoursCandidate !== null) return roundCompactHours(Math.max(0, hoursCandidate));

      return roundCompactHours(Math.max(0, fallbackHours));
    };

    const resolveCompactAssignmentProjectId = (payload: Record<string, any>, fallbackProjectId: string): string => {
      const projectObj = asObject(payload.project);
      const candidate =
        payload.projectId ??
        payload.project_id ??
        projectObj?.id ??
        (typeof payload.project === 'string' ? payload.project : '') ??
        fallbackProjectId;
      return asCompactString(candidate);
    };

    const resolveCompactAssignmentWeek = (payload: Record<string, any>, fallbackWeek: string): string => {
      const raw = asCompactString(payload.weekStartDate ?? payload.week_start_date ?? fallbackWeek);
      return raw ? normalizeWeekStartDate(raw) : '';
    };

    const buildCompactAssignmentSnapshot = (
      payload: Record<string, any> | null,
      previous: CompactAssignmentSnapshot | null
    ): CompactAssignmentSnapshot | null => {
      if (!payload && !previous) return null;

      const current = payload || {};
      const employeeId = asCompactString(current.employeeId ?? current.employee_id ?? previous?.employeeId ?? '');
      const employeeDepartment = employeeId ? employeeById.get(employeeId)?.department : '';

      const department =
        normalizeCompactDepartment(current.department) ||
        normalizeCompactDepartment(current.dept) ||
        normalizeCompactDepartment(asObject(current.employee)?.department) ||
        normalizeCompactDepartment(employeeDepartment) ||
        previous?.department ||
        '';
      const projectId = resolveCompactAssignmentProjectId(current, previous?.projectId || '');
      const weekStartDate = resolveCompactAssignmentWeek(current, previous?.weekStartDate || '');
      const hours = resolveCompactHoursFromPayload(current, previous?.hours ?? 0);
      const hasStageField = hasOwn(current, 'stage') || hasOwn(current, 'stage_name');
      const stage = hasStageField
        ? normalizeCompactStage(current.stage ?? current.stage_name)
        : (previous?.stage ?? null);

      return {
        projectId,
        department,
        weekStartDate,
        hours,
        employeeId: employeeId || previous?.employeeId || '',
        stage,
      };
    };

    const extractCompactDeptSnapshot = (stageRows: unknown): Partial<CompactDeptTimingSnapshot> | null => {
      if (!Array.isArray(stageRows) || stageRows.length === 0) return null;

      let minWeekStart: number | null = null;
      let maxWeekEnd: number | null = null;
      let firstDuration: number | null = null;
      let departmentStartDate = '';
      let stage: Stage = null;

      stageRows.forEach((rawStage, index) => {
        const stageObj = asObject(rawStage);
        if (!stageObj) return;

        if (stage === null && (typeof stageObj.stage === 'string' || stageObj.stage === null)) {
          stage = stageObj.stage as Stage;
        }

        const weekStartValue = toFiniteNumber(stageObj.weekStart);
        const weekEndValue = toFiniteNumber(stageObj.weekEnd);
        const durationValue = toFiniteNumber(stageObj.durationWeeks);
        const deptStartValue = typeof stageObj.departmentStartDate === 'string'
          ? stageObj.departmentStartDate.slice(0, 10)
          : '';

        if (durationValue !== null && durationValue > 0 && firstDuration === null) {
          firstDuration = durationValue;
        }

        if (weekStartValue !== null && weekEndValue !== null && weekEndValue >= weekStartValue) {
          if (minWeekStart === null || weekStartValue < minWeekStart) {
            minWeekStart = weekStartValue;
            if (deptStartValue) departmentStartDate = deptStartValue;
          }
          if (maxWeekEnd === null || weekEndValue > maxWeekEnd) {
            maxWeekEnd = weekEndValue;
          }
        } else if (!departmentStartDate && index === 0 && deptStartValue) {
          departmentStartDate = deptStartValue;
        }
      });

      const durationFromRange =
        minWeekStart !== null &&
        maxWeekEnd !== null &&
        maxWeekEnd >= minWeekStart
          ? (maxWeekEnd - minWeekStart + 1)
          : null;

      return {
        stage,
        weekStart: minWeekStart,
        weekEnd: maxWeekEnd,
        durationWeeks: durationFromRange ?? firstDuration,
        departmentStartDate,
      };
    };

    const createEmptyCompactDeptSnapshot = (): CompactDeptTimingSnapshot => ({
      stage: null,
      weekStart: null,
      weekEnd: null,
      durationWeeks: null,
      departmentStartDate: '',
    });

    const createProjectCompactSnapshot = (projectId: string): CompactProjectSnapshot => {
      const project = projectById.get(projectId);
      const departments = DEPARTMENTS.reduce((acc, dept) => {
        acc[dept] = createEmptyCompactDeptSnapshot();
        return acc;
      }, {} as Record<Department, CompactDeptTimingSnapshot>);

      if (project?.departmentStages) {
        DEPARTMENTS.forEach((dept) => {
          const parsed = extractCompactDeptSnapshot(project.departmentStages?.[dept]);
          if (!parsed) return;
          departments[dept] = {
            stage: parsed.stage ?? departments[dept].stage,
            weekStart: parsed.weekStart ?? departments[dept].weekStart,
            weekEnd: parsed.weekEnd ?? departments[dept].weekEnd,
            durationWeeks: parsed.durationWeeks ?? departments[dept].durationWeeks,
            departmentStartDate: parsed.departmentStartDate ?? departments[dept].departmentStartDate,
          };
        });
      }

      const fallbackName = timingLogs.find((entry) => entry.objectId === projectId)?.changes?.updates?.name;

      return {
        projectId,
        projectName: project?.name || fallbackName || `${language === 'es' ? 'Proyecto' : 'Project'} ${projectId.slice(0, 8)}`,
        startDate: project?.startDate || '',
        numberOfWeeks: Number.isFinite(Number(project?.numberOfWeeks)) ? Number(project?.numberOfWeeks) : null,
        departments,
      };
    };

    const applyTimingUpdateToCompactSnapshot = (snapshot: CompactProjectSnapshot, updates: Record<string, any>) => {
      if (typeof updates.name === 'string' && updates.name.trim()) {
        snapshot.projectName = updates.name.trim();
      }
      if (typeof updates.startDate === 'string' && updates.startDate) {
        snapshot.startDate = updates.startDate.slice(0, 10);
      }
      const updatedDuration = toFiniteNumber(updates.numberOfWeeks);
      if (updatedDuration !== null && updatedDuration > 0) {
        snapshot.numberOfWeeks = updatedDuration;
      }

      const departmentStages = asObject(updates.departmentStages);
      if (!departmentStages) return;

      DEPARTMENTS.forEach((dept) => {
        const parsed = extractCompactDeptSnapshot(departmentStages[dept]);
        if (!parsed) return;
        const current = snapshot.departments[dept];
        snapshot.departments[dept] = {
          stage: parsed.stage ?? current.stage,
          weekStart: parsed.weekStart ?? current.weekStart,
          weekEnd: parsed.weekEnd ?? current.weekEnd,
          durationWeeks: parsed.durationWeeks ?? current.durationWeeks,
          departmentStartDate: parsed.departmentStartDate ?? current.departmentStartDate,
        };
      });
    };

    const resolveCompactCellState = (
      snapshot: CompactProjectSnapshot,
      department: Department,
      weekStartDate: string
    ): CompactCellState => {
      let effectiveStartDate = '';
      let durationWeeks = 0;

      if (department === 'PM') {
        effectiveStartDate = snapshot.startDate;
        durationWeeks = snapshot.numberOfWeeks || 0;
      } else {
        const deptSnapshot = snapshot.departments[department];
        effectiveStartDate = deptSnapshot.departmentStartDate || '';
        if (!effectiveStartDate && snapshot.startDate && deptSnapshot.weekStart !== null) {
          const fallbackStart = parseISODate(snapshot.startDate);
          fallbackStart.setDate(fallbackStart.getDate() + ((deptSnapshot.weekStart - 1) * 7));
          effectiveStartDate = formatToISO(fallbackStart);
        }
        durationWeeks =
          (deptSnapshot.durationWeeks && deptSnapshot.durationWeeks > 0)
            ? deptSnapshot.durationWeeks
            : (
                deptSnapshot.weekStart !== null &&
                deptSnapshot.weekEnd !== null &&
                deptSnapshot.weekEnd >= deptSnapshot.weekStart
                  ? (deptSnapshot.weekEnd - deptSnapshot.weekStart + 1)
                  : 0
              );
      }

      if (!effectiveStartDate || durationWeeks <= 0) {
        return { value: '-', active: false, isFirstWeek: false };
      }

      const start = parseISODate(effectiveStartDate);
      const week = parseISODate(weekStartDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(week.getTime())) {
        return { value: '-', active: false, isFirstWeek: false };
      }

      const end = new Date(start);
      end.setDate(end.getDate() + (durationWeeks * 7) - 1);
      if (week < start || week > end) {
        return { value: '-', active: false, isFirstWeek: false };
      }

      const weekNumber = Math.floor((week.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1;
      return {
        value: `${weekNumber}`,
        active: true,
        isFirstWeek: weekNumber === 1,
      };
    };

    const formatCompactCapacityValue = (value: number): string => {
      const rounded = Math.round(value * 100) / 100;
      if (Number.isInteger(rounded)) return `${rounded}`;
      return rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    };

    const resolveCompactCapacityCellState = (
      snapshot: CompactProjectSnapshot,
      department: Department,
      weekStartDate: string,
      assignmentHoursByCell: Map<string, number>,
      assignmentStageByCell: Map<string, Stage>,
      fallbackAssignmentHoursByCell?: Map<string, number>,
      fallbackAssignmentStageByCell?: Map<string, Stage>,
      fallbackBlockedKeys?: Set<string>
    ): CompactCapacityCellState => {
      const timingCell = resolveCompactCellState(snapshot, department, weekStartDate);
      const assignmentKey = `${snapshot.projectId}|${department}|${weekStartDate}`;
      const allowFallback = !fallbackBlockedKeys?.has(assignmentKey);
      const totalHours = assignmentHoursByCell.has(assignmentKey)
        ? (assignmentHoursByCell.get(assignmentKey) || 0)
        : (allowFallback ? (fallbackAssignmentHoursByCell?.get(assignmentKey) || 0) : 0);
      const stage = assignmentStageByCell.has(assignmentKey)
        ? (assignmentStageByCell.get(assignmentKey) || null)
        : (allowFallback ? (fallbackAssignmentStageByCell?.get(assignmentKey) || null) : null);
      const normalizedCapacity = department === 'MFG' ? totalHours : calculateTalent(totalHours);
      const hasCapacityLoad = normalizedCapacity > 0;

      return {
        ...timingCell,
        capacityValue: hasCapacityLoad ? normalizedCapacity : null,
        displayValue: hasCapacityLoad ? formatCompactCapacityValue(normalizedCapacity) : '',
        inTimingRange: timingCell.active,
        hasCapacityLoad,
        stage,
      };
    };

    const compactProjectIds = Array.from(new Set(timingLogs.map((entry) => entry.objectId).filter(Boolean)));
    const compactProjects = compactProjectIds
      .map((projectId) => createProjectCompactSnapshot(projectId))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));

    const compactLogsByProject = new Map<string, ActivityLogEntry[]>();
    timingLogs.forEach((entry) => {
      const bucket = compactLogsByProject.get(entry.objectId) || [];
      bucket.push(entry);
      compactLogsByProject.set(entry.objectId, bucket);
    });

    const buildCompactSnapshotByWeekStart = (projectId: string, weekStartDate: string): CompactProjectSnapshot => {
      const snapshot = createProjectCompactSnapshot(projectId);
      if (!weekStartDate) return snapshot;
      const projectLogs = compactLogsByProject.get(projectId) || [];
      for (const log of projectLogs) {
        const logDay = (log.createdAt || '').slice(0, 10);
        if (!logDay || logDay > weekStartDate) break;
        const updates = extractProjectUpdatePayload(log.changes);
        if (updates) {
          applyTimingUpdateToCompactSnapshot(snapshot, updates);
        }
      }
      return snapshot;
    };

    const getCompactAssignmentCellKey = (snapshot: CompactAssignmentSnapshot | null): string => {
      if (!snapshot || !snapshot.projectId || !snapshot.department || !snapshot.weekStartDate) return '';
      return `${snapshot.projectId}|${snapshot.department}|${snapshot.weekStartDate}`;
    };

    const buildCompactAssignmentHoursContextByWeekStart = (weekStartDate: string): {
      hoursByCell: Map<string, number>;
      stageByCell: Map<string, Stage>;
      changedKeysAfterSnapshot: Set<string>;
    } => {
      const assignmentStateById = new Map<string, CompactAssignmentSnapshot>();
      const changedKeysAfterSnapshot = new Set<string>();
      if (!weekStartDate) {
        return { hoursByCell: new Map<string, number>(), stageByCell: new Map<string, Stage>(), changedKeysAfterSnapshot };
      }

      let logIndex = 0;
      while (logIndex < assignmentLogs.length) {
        const log = assignmentLogs[logIndex];
        const logDay = (log.createdAt || '').slice(0, 10);
        if (!logDay || logDay > weekStartDate) break;

        const action = normalizeCompactAction(log.action);
        if (action !== 'other') {
          const changesObj = asObject(log.changes);
          const payload = changesObj
            ? (asObject(changesObj.assignment) || asObject(changesObj.updates) || changesObj)
            : null;

          const existingPrev = assignmentStateById.get(log.objectId) || null;
          const fallbackPrev = action === 'deleted' && !existingPrev
            ? buildCompactAssignmentSnapshot(payload, null)
            : existingPrev;

          let nextSnapshot: CompactAssignmentSnapshot | null = null;
          if (action !== 'deleted') {
            nextSnapshot = buildCompactAssignmentSnapshot(payload, fallbackPrev);
          }

          if (action === 'deleted') {
            assignmentStateById.delete(log.objectId);
          } else if (nextSnapshot) {
            assignmentStateById.set(log.objectId, nextSnapshot);
          }
        }

        logIndex += 1;
      }

      const snapshotStateById = new Map<string, CompactAssignmentSnapshot>();
      assignmentStateById.forEach((value, key) => {
        snapshotStateById.set(key, { ...value });
      });

      while (logIndex < assignmentLogs.length) {
        const log = assignmentLogs[logIndex];
        const action = normalizeCompactAction(log.action);
        if (action !== 'other') {
          const changesObj = asObject(log.changes);
          const payload = changesObj
            ? (asObject(changesObj.assignment) || asObject(changesObj.updates) || changesObj)
            : null;

          const existingPrev = assignmentStateById.get(log.objectId) || null;
          const fallbackPrev = action === 'deleted' && !existingPrev
            ? buildCompactAssignmentSnapshot(payload, null)
            : existingPrev;

          let nextSnapshot: CompactAssignmentSnapshot | null = null;
          if (action !== 'deleted') {
            nextSnapshot = buildCompactAssignmentSnapshot(payload, fallbackPrev);
          }

          const previousKey = getCompactAssignmentCellKey(fallbackPrev);
          const nextKey = getCompactAssignmentCellKey(nextSnapshot);
          if (previousKey) changedKeysAfterSnapshot.add(previousKey);
          if (nextKey) changedKeysAfterSnapshot.add(nextKey);

          if (action === 'deleted') {
            assignmentStateById.delete(log.objectId);
          } else if (nextSnapshot) {
            assignmentStateById.set(log.objectId, nextSnapshot);
          }
        }

        logIndex += 1;
      }

      const hoursByCell = new Map<string, number>();
      const stageByCell = new Map<string, Stage>();
      snapshotStateById.forEach((snapshot) => {
        const key = getCompactAssignmentCellKey(snapshot);
        if (!key || snapshot.hours <= 0) return;
        hoursByCell.set(key, roundCompactHours((hoursByCell.get(key) || 0) + snapshot.hours));

        if (snapshot.stage) {
          const department = snapshot.department as Department;
          const currentStage = stageByCell.get(key) || null;
          if (isHigherPriorityStage(department, snapshot.stage, currentStage)) {
            stageByCell.set(key, snapshot.stage);
          }
        }
      });

      return { hoursByCell, stageByCell, changedKeysAfterSnapshot };
    };

    const buildCurrentAssignmentContext = (): { hoursByCell: Map<string, number>; stageByCell: Map<string, Stage> } => {
      const hoursByCell = new Map<string, number>();
      const stageByCell = new Map<string, Stage>();
      assignmentIndex.byCell.forEach((entry, key) => {
        const totalHours = roundCompactHours(entry?.totalHours ?? 0);
        if (totalHours > 0) {
          hoursByCell.set(key, totalHours);
          stageByCell.set(key, entry?.stage ?? null);
        }
      });
      return { hoursByCell, stageByCell };
    };

    const getCompactQuotedHours = (projectId: string, department: Department): number => {
      const project = projectById.get(projectId);
      const quotedHours = project?.departmentHoursAllocated?.[department] || 0;
      const quotedChangeOrders = getQuotedChangeOrders(department, projectId);
      return roundCompactHours(quotedHours + quotedChangeOrders);
    };

    const buildCompactDepartmentMetricsMap = (
      snapshotWeekStart: string,
      hoursByCell: Map<string, number>
    ) => {
      const metricsByProjectDept = new Map<string, CompactDepartmentMetrics>();

      hoursByCell.forEach((hours, key) => {
        const [projectId, departmentRaw, weekStartDate] = key.split('|');
        if (!projectId || !departmentRaw || !weekStartDate) return;
        if (!DEPARTMENT_SET.has(departmentRaw as Department)) return;

        const department = departmentRaw as Department;
        const metricsKey = `${projectId}|${department}`;
        const existing = metricsByProjectDept.get(metricsKey) || {
          quotedHours: getCompactQuotedHours(projectId, department),
          usedHours: 0,
          forecastedHours: 0,
          utilizationPercent: 0,
        };

        if (snapshotWeekStart && weekStartDate < snapshotWeekStart) {
          existing.usedHours = roundCompactHours(existing.usedHours + hours);
        } else {
          existing.forecastedHours = roundCompactHours(existing.forecastedHours + hours);
        }

        metricsByProjectDept.set(metricsKey, existing);
      });

      metricsByProjectDept.forEach((entry) => {
        const totalPlanned = entry.usedHours + entry.forecastedHours;
        entry.utilizationPercent = entry.quotedHours > 0
          ? Math.round((totalPlanned / entry.quotedHours) * 100)
          : (totalPlanned > 0 ? 100 : 0);
      });

      return metricsByProjectDept;
    };

    const getCompactDepartmentMetrics = (
      metricsByProjectDept: Map<string, CompactDepartmentMetrics>,
      projectId: string,
      department: Department
    ): CompactDepartmentMetrics => {
      return metricsByProjectDept.get(`${projectId}|${department}`) || {
        quotedHours: getCompactQuotedHours(projectId, department),
        usedHours: 0,
        forecastedHours: 0,
        utilizationPercent: 0,
      };
    };

    const buildLiveCompactDepartmentMetricsMap = () => {
      const metricsByProjectDept = new Map<string, CompactDepartmentMetrics>();

      compactProjects.forEach((projectSnapshot) => {
        DEPARTMENTS.forEach((department) => {
          const quotedHours = getCompactQuotedHours(projectSnapshot.projectId, department);
          const usedHours = roundCompactHours(getUtilizedHours(department, projectSnapshot.projectId));
          const forecastedHours = roundCompactHours(getForecastedHours(department, projectSnapshot.projectId));
          const totalPlanned = usedHours + forecastedHours;
          const utilizationPercent = quotedHours > 0
            ? Math.round((totalPlanned / quotedHours) * 100)
            : (totalPlanned > 0 ? 100 : 0);

          metricsByProjectDept.set(`${projectSnapshot.projectId}|${department}`, {
            quotedHours,
            usedHours,
            forecastedHours,
            utilizationPercent,
          });
        });
      });

      return metricsByProjectDept;
    };

    const hasCompactDepartmentAssignmentChanges = (
      projectId: string,
      department: Department,
      changedKeysAfterSnapshot: Set<string>
    ): boolean => {
      const prefix = `${projectId}|${department}|`;
      for (const key of changedKeysAfterSnapshot) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    };

    const buildPreviousEffectiveDepartmentMetricsMap = (
      currentMetricsByProjectDept: Map<string, CompactDepartmentMetrics>,
      previousMetricsByProjectDept: Map<string, CompactDepartmentMetrics>,
      changedKeysAfterSnapshot: Set<string>
    ) => {
      const metricsByProjectDept = new Map<string, CompactDepartmentMetrics>();

      compactProjects.forEach((projectSnapshot) => {
        DEPARTMENTS.forEach((department) => {
          const hasAssignmentChanges = hasCompactDepartmentAssignmentChanges(
            projectSnapshot.projectId,
            department,
            changedKeysAfterSnapshot
          );

          metricsByProjectDept.set(
            `${projectSnapshot.projectId}|${department}`,
            hasAssignmentChanges
              ? getCompactDepartmentMetrics(previousMetricsByProjectDept, projectSnapshot.projectId, department)
              : getCompactDepartmentMetrics(currentMetricsByProjectDept, projectSnapshot.projectId, department)
          );
        });
      });

      return metricsByProjectDept;
    };

    const todayWeekStart = normalizeWeekStartDate(formatToISO(getWeekStart(new Date())));
    const resolvedCurrentWeekIndex = (() => {
      const byToday = weeklyRange.indexOf(todayWeekStart);
      if (byToday > 0) return byToday;
      if (byToday === 0 && weeklyRange.length > 1) return 1;
      return weeklyRange.length - 1;
    })();
    const resolvedPreviousWeekIndex = Math.max(0, resolvedCurrentWeekIndex - 1);
    const hasWeekOverWeekRange =
      weeklyRange.length >= 2 &&
      resolvedCurrentWeekIndex >= 0 &&
      resolvedCurrentWeekIndex < weeklyRange.length &&
      resolvedPreviousWeekIndex >= 0 &&
      resolvedPreviousWeekIndex < weeklyRange.length &&
      resolvedCurrentWeekIndex !== resolvedPreviousWeekIndex;
    const currentWeekStart = hasWeekOverWeekRange ? weeklyRange[resolvedCurrentWeekIndex] : weeklyRange[weeklyRange.length - 1];
    const previousWeekStart = hasWeekOverWeekRange ? weeklyRange[resolvedPreviousWeekIndex] : currentWeekStart;
    const previousSnapshotCutoffDate = (() => {
      if (!currentWeekStart) return previousWeekStart;
      const cutoff = parseISODate(currentWeekStart);
      cutoff.setDate(cutoff.getDate() - 1);
      return formatToISO(cutoff);
    })();
    const currentWeekLabel = currentWeekStart ? `CW${String(getWeekNumber(currentWeekStart)).padStart(2, '0')}` : '-';
    const previousWeekLabel = previousWeekStart ? `CW${String(getWeekNumber(previousWeekStart)).padStart(2, '0')}` : '-';

    const compactCurrentAssignmentContext = buildCurrentAssignmentContext();
    const compactPreviousAssignmentContext = buildCompactAssignmentHoursContextByWeekStart(previousSnapshotCutoffDate);
    const compactPreviousEffectiveHoursByCell = new Map(compactPreviousAssignmentContext.hoursByCell);
    const compactPreviousEffectiveStageByCell = new Map(compactPreviousAssignmentContext.stageByCell);
    compactCurrentAssignmentContext.hoursByCell.forEach((hours, key) => {
      if (compactPreviousAssignmentContext.changedKeysAfterSnapshot.has(key)) return;
      if (!compactPreviousEffectiveHoursByCell.has(key)) {
        compactPreviousEffectiveHoursByCell.set(key, hours);
      }
      if (!compactPreviousEffectiveStageByCell.has(key) && compactCurrentAssignmentContext.stageByCell.has(key)) {
        compactPreviousEffectiveStageByCell.set(key, compactCurrentAssignmentContext.stageByCell.get(key) || null);
      }
    });
    const compactCurrentMetricsByProjectDept = buildLiveCompactDepartmentMetricsMap();
    const compactPreviousMetricsByProjectDept = buildPreviousEffectiveDepartmentMetricsMap(
      compactCurrentMetricsByProjectDept,
      buildCompactDepartmentMetricsMap(currentWeekStart, compactPreviousEffectiveHoursByCell),
      compactPreviousAssignmentContext.changedKeysAfterSnapshot
    );

    const projectGroups = compactProjects.map((projectSnapshot) => {
      const currentSnapshot = buildCompactSnapshotByWeekStart(projectSnapshot.projectId, currentWeekStart);
      const previousSnapshot = buildCompactSnapshotByWeekStart(projectSnapshot.projectId, previousSnapshotCutoffDate);

      const buildRows = (
        snapshot: CompactProjectSnapshot,
        assignmentHoursByCell: Map<string, number>,
        assignmentStageByCell: Map<string, Stage>,
        fallbackAssignmentHoursByCell: Map<string, number> | undefined,
        fallbackAssignmentStageByCell: Map<string, Stage> | undefined,
        fallbackBlockedKeys: Set<string> | undefined,
        metricsByProjectDept: Map<string, CompactDepartmentMetrics>,
        compareSnapshot: CompactProjectSnapshot,
        compareHoursByCell: Map<string, number>,
        compareStageByCell: Map<string, Stage>,
        compareFallbackHoursByCell: Map<string, number> | undefined,
        compareFallbackStageByCell: Map<string, Stage> | undefined,
        compareBlockedKeys: Set<string> | undefined,
        compareMetricsByProjectDept: Map<string, CompactDepartmentMetrics>,
        highlightCurrent: boolean
      ): TimingCompactPreviewDepartmentRow[] => {
        return DEPARTMENTS.map((dept) => {
          const metrics = getCompactDepartmentMetrics(metricsByProjectDept, snapshot.projectId, dept);
          const compareMetrics = getCompactDepartmentMetrics(compareMetricsByProjectDept, compareSnapshot.projectId, dept);
          const metricDiffs = {
            quotedHours: metrics.quotedHours !== compareMetrics.quotedHours,
            usedHours: metrics.usedHours !== compareMetrics.usedHours,
            forecastedHours: metrics.forecastedHours !== compareMetrics.forecastedHours,
            utilizationPercent: metrics.utilizationPercent !== compareMetrics.utilizationPercent,
          };

          const cells = weeklyRange.map((weekStartDate) => {
            const currentCellState = resolveCompactCapacityCellState(
              snapshot,
              dept,
              weekStartDate,
              assignmentHoursByCell,
              assignmentStageByCell,
              fallbackAssignmentHoursByCell,
              fallbackAssignmentStageByCell,
              fallbackBlockedKeys
            );
            const compareCellState = resolveCompactCapacityCellState(
              compareSnapshot,
              dept,
              weekStartDate,
              compareHoursByCell,
              compareStageByCell,
              compareFallbackHoursByCell,
              compareFallbackStageByCell,
              compareBlockedKeys
            );
            const changed =
              currentCellState.displayValue !== compareCellState.displayValue ||
              currentCellState.active !== compareCellState.active;

            return {
              value: currentCellState.displayValue,
              active: currentCellState.active,
              hasCapacityLoad: currentCellState.hasCapacityLoad,
              inTimingRange: currentCellState.inTimingRange,
              stage: currentCellState.stage,
              changed,
              highlightCurrent: highlightCurrent && changed,
            };
          });

          return {
            department: dept,
            changeDetected: Object.values(metricDiffs).some(Boolean) || cells.some((cell) => cell.changed),
            metrics,
            metricDiffs,
            cells,
          };
        });
      };

      const currentRows = buildRows(
        currentSnapshot,
        compactCurrentAssignmentContext.hoursByCell,
        compactCurrentAssignmentContext.stageByCell,
        undefined,
        undefined,
        undefined,
        compactCurrentMetricsByProjectDept,
        previousSnapshot,
        compactPreviousEffectiveHoursByCell,
        compactPreviousEffectiveStageByCell,
        compactCurrentAssignmentContext.hoursByCell,
        compactCurrentAssignmentContext.stageByCell,
        compactPreviousAssignmentContext.changedKeysAfterSnapshot,
        compactPreviousMetricsByProjectDept,
        true
      );

      const previousRows = buildRows(
        previousSnapshot,
        compactPreviousEffectiveHoursByCell,
        compactPreviousEffectiveStageByCell,
        compactCurrentAssignmentContext.hoursByCell,
        compactCurrentAssignmentContext.stageByCell,
        compactPreviousAssignmentContext.changedKeysAfterSnapshot,
        compactPreviousMetricsByProjectDept,
        currentSnapshot,
        compactCurrentAssignmentContext.hoursByCell,
        compactCurrentAssignmentContext.stageByCell,
        undefined,
        undefined,
        undefined,
        compactCurrentMetricsByProjectDept,
        false
      );

      return {
        projectId: projectSnapshot.projectId,
        projectName: currentSnapshot.projectName || projectSnapshot.projectName,
        currentViewLabel: hasWeekOverWeekRange
          ? `${language === 'es' ? 'Semana Actual' : 'Current Week'} (${currentWeekLabel})`
          : `${language === 'es' ? 'Actual' : 'Current'} (${currentWeekLabel})`,
        previousViewLabel: hasWeekOverWeekRange
          ? `${language === 'es' ? 'Semana Pasada' : 'Previous Week'} (${previousWeekLabel})`
          : `${language === 'es' ? 'Referencia' : 'Reference'} (${previousWeekLabel})`,
        currentRows,
        previousRows,
      };
    });

    return {
      weeklyRange,
      currentWeekIndex: resolvedCurrentWeekIndex,
      projectGroups,
    };
  }, [
    timingChangesLogs,
    timingAssignmentLogs,
    timingChangesFromDate,
    timingChangesToDate,
    projectById,
    employeeById,
    assignmentIndex.byCell,
    language,
    getQuotedChangeOrders,
  ]);

  const handleExportTimingRangeExcel = async () => {
    return handleExportTimingChangesExcel();

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

    const weeklyRange = getWeeksInRange(startDate, endDate)
      .map((week) => normalizeWeekStartDate(week))
      .filter((week, idx, arr) => week && arr.indexOf(week) === idx);

    if (weeklyRange.length === 0) {
      alert(language === 'es'
        ? 'No hay semanas validas en el rango seleccionado.'
        : 'There are no valid weeks in the selected range.');
      return;
    }

    try {
      setIsTimingRangeExcelExporting(true);

      const response = await activityLogApi.getFiltered({
        modelName: 'Assignment',
        endDate,
        ordering: 'created_at',
        pageSize: 4000,
      });

      interface AssignmentSnapshot {
        projectId: string;
        projectNameHint: string;
        department: Department | '';
        weekStartDate: string;
        hours: number;
        employeeId: string;
      }

      interface DetailRow {
        changedAtRaw: string;
        changedAt: string;
        changedBy: string;
        weekStart: string;
        yearWeek: string;
        projectWeek: string;
        project: string;
        department: string;
        movementCode: 'added' | 'modified' | 'removed';
        movementType: string;
        beforeHours: number;
        afterHours: number;
        deltaHours: number;
      }

      interface YearWeekSummary {
        weekStart: string;
        yearWeek: string;
        addedHours: number;
        modifiedHours: number;
        removedHours: number;
        netHours: number;
        projects: Set<string>;
        users: Set<string>;
        movements: number;
      }

      interface WeekProjectComparison {
        weekStart: string;
        yearWeek: string;
        project: string;
        department: string;
        projectWeek: string;
        openingHoursByAssignment: Map<string, number>;
        closingHoursByAssignment: Map<string, number>;
        addedHours: number;
        modifiedHours: number;
        removedHours: number;
        netHours: number;
        users: Set<string>;
        movements: number;
        lastChangedAt: string;
      }

      interface WeekProjectComparisonRow {
        weekStart: string;
        yearWeek: string;
        project: string;
        department: string;
        projectWeek: string;
        openingHours: number;
        closingHours: number;
        addedHours: number;
        modifiedHours: number;
        removedHours: number;
        netHours: number;
        users: string;
        movements: number;
        lastChangedAt: string;
      }

      interface WeeklyWrittenSummaryRow {
        weekStart: string;
        yearWeek: string;
        summary: string;
        addedHours: number;
        modifiedHours: number;
        removedHours: number;
        netHours: number;
        movements: number;
        users: string;
      }

      const hasOwn = (obj: Record<string, any>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
      const roundValue = (value: number) => Math.round((value || 0) * 100) / 100;
      const asNumber = (value: unknown): number | null => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        return numeric;
      };
      const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
      const normalizeDepartment = (value: unknown): Department | '' => {
        const raw = asString(value).trim().toUpperCase();
        if (!raw) return '';
        return DEPARTMENT_SET.has(raw as Department) ? (raw as Department) : '';
      };
      const resolveHoursFromPayload = (payload: Record<string, any>, fallbackHours: number): number => {
        const hasSplitFields =
          hasOwn(payload, 'scioHours')
          || hasOwn(payload, 'externalHours')
          || hasOwn(payload, 'scio_hours')
          || hasOwn(payload, 'external_hours');

        if (hasSplitFields) {
          const scio = asNumber(payload.scioHours ?? payload.scio_hours) ?? 0;
          const external = asNumber(payload.externalHours ?? payload.external_hours) ?? 0;
          return roundValue(Math.max(0, scio + external));
        }

        const totalCandidate = asNumber(payload.totalHours ?? payload.total_hours);
        if (totalCandidate !== null) return roundValue(Math.max(0, totalCandidate));

        const hoursCandidate = asNumber(payload.hours);
        if (hoursCandidate !== null) return roundValue(Math.max(0, hoursCandidate));

        return roundValue(Math.max(0, fallbackHours));
      };
      const resolveProjectId = (payload: Record<string, any>, fallbackProjectId: string): string => {
        const projectObj = asObject(payload.project);
        const candidate =
          payload.projectId
          ?? payload.project_id
          ?? projectObj?.id
          ?? (typeof payload.project === 'string' ? payload.project : '')
          ?? fallbackProjectId;
        return asString(candidate);
      };
      const resolveProjectNameHint = (payload: Record<string, any>, fallbackName: string): string => {
        const projectObj = asObject(payload.project);
        const candidate =
          payload.projectName
          ?? payload.project_name
          ?? projectObj?.name
          ?? fallbackName;
        return asString(candidate);
      };
      const resolveWeekStart = (payload: Record<string, any>, fallbackWeek: string): string => {
        const raw = asString(payload.weekStartDate ?? payload.week_start_date ?? fallbackWeek);
        return raw ? normalizeWeekStartDate(raw) : '';
      };
      const buildSnapshot = (
        payload: Record<string, any> | null,
        previous: AssignmentSnapshot | null
      ): AssignmentSnapshot | null => {
        if (!payload && !previous) return null;

        const current = payload || {};
        const employeeId = asString(current.employeeId ?? current.employee_id ?? previous?.employeeId ?? '');
        const employeeDepartment = employeeId ? employeeById.get(employeeId)?.department : '';

        const department =
          normalizeDepartment(current.department)
          || normalizeDepartment(current.dept)
          || normalizeDepartment(asObject(current.employee)?.department)
          || normalizeDepartment(employeeDepartment)
          || previous?.department
          || '';

        const projectId = resolveProjectId(current, previous?.projectId || '');
        const projectNameHint = resolveProjectNameHint(current, previous?.projectNameHint || '');
        const weekStartDate = resolveWeekStart(current, previous?.weekStartDate || '');
        const hours = resolveHoursFromPayload(current, previous?.hours ?? 0);

        return {
          projectId,
          projectNameHint,
          department,
          weekStartDate,
          hours,
          employeeId: employeeId || previous?.employeeId || '',
        };
      };

      const normalizeAction = (rawAction: string): 'created' | 'updated' | 'deleted' | 'other' => {
        const action = (rawAction || '').toLowerCase();
        if (action === 'created' || action === 'create') return 'created';
        if (action === 'updated' || action === 'update') return 'updated';
        if (action === 'deleted' || action === 'delete') return 'deleted';
        return 'other';
      };

      const getProjectDisplayName = (projectId: string, fallback: string) => {
        if (projectId) {
          const fromStore = projectById.get(projectId)?.name;
          if (fromStore) return fromStore;
        }
        return fallback || (language === 'es' ? 'Proyecto sin nombre' : 'Unnamed project');
      };

      const getYearWeekLabel = (weekStartDate: string) => {
        if (!weekStartDate) return '-';
        const weekNum = getWeekNumber(weekStartDate);
        const year = parseISODate(weekStartDate).getFullYear();
        return `${year}-CW${String(weekNum).padStart(2, '0')}`;
      };

      const getProjectWeekLabel = (projectId: string, weekStartDate: string) => {
        if (!projectId || !weekStartDate) return '-';
        const projectStart = projectById.get(projectId)?.startDate;
        if (!projectStart) return '-';
        const start = parseISODate(projectStart);
        const week = parseISODate(weekStartDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(week.getTime())) return '-';
        const diffDays = Math.floor((week.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) return '-';
        return `W${Math.floor(diffDays / 7) + 1}`;
      };

      const filteredRows = (Array.isArray(response) ? response as ActivityLogEntry[] : [])
        .filter((row) => row && row.modelName === 'Assignment' && normalizeAction(row.action) !== 'other')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      if (filteredRows.length === 0) {
        alert(language === 'es'
          ? 'No hay cambios de horas para exportar en el rango seleccionado.'
          : 'There are no hour changes to export in the selected range.');
        return;
      }

      const rangeContains = (createdAt: string) => {
        const day = (createdAt || '').slice(0, 10);
        return day >= startDate && day <= endDate;
      };

      const weekSet = new Set(weeklyRange);
      const detailRows: DetailRow[] = [];
      const yearWeekMap = new Map<string, YearWeekSummary>();
      const weekProjectComparisonMap = new Map<string, WeekProjectComparison>();
      const assignmentStateById = new Map<string, AssignmentSnapshot>();

      const ensureYearWeekSummary = (weekStartDate: string): YearWeekSummary => {
        const yearWeek = getYearWeekLabel(weekStartDate);
        const key = `${weekStartDate}|${yearWeek}`;
        const existing = yearWeekMap.get(key);
        if (existing) return existing;

        const created: YearWeekSummary = {
          weekStart: weekStartDate,
          yearWeek,
          addedHours: 0,
          modifiedHours: 0,
          removedHours: 0,
          netHours: 0,
          projects: new Set<string>(),
          users: new Set<string>(),
          movements: 0,
        };
        yearWeekMap.set(key, created);
        return created;
      };

      const ensureWeekProjectComparison = (
        weekStartDate: string,
        project: string,
        department: string,
        projectWeek: string
      ): WeekProjectComparison => {
        const yearWeek = getYearWeekLabel(weekStartDate);
        const key = `${weekStartDate}|${project || '__no_project__'}|${department}|${projectWeek}`;
        const existing = weekProjectComparisonMap.get(key);
        if (existing) return existing;

        const created: WeekProjectComparison = {
          weekStart: weekStartDate,
          yearWeek,
          project,
          department,
          projectWeek,
          openingHoursByAssignment: new Map<string, number>(),
          closingHoursByAssignment: new Map<string, number>(),
          addedHours: 0,
          modifiedHours: 0,
          removedHours: 0,
          netHours: 0,
          users: new Set<string>(),
          movements: 0,
          lastChangedAt: '',
        };
        weekProjectComparisonMap.set(key, created);
        return created;
      };

      filteredRows.forEach((log) => {
        const action = normalizeAction(log.action);
        if (action === 'other') return;

        const changesObj = asObject(log.changes);
        const payload = changesObj
          ? (asObject(changesObj.assignment) || asObject(changesObj.updates) || changesObj)
          : null;

        const existingPrev = assignmentStateById.get(log.objectId) || null;
        const fallbackPrev = action === 'deleted' && !existingPrev
          ? buildSnapshot(payload, null)
          : existingPrev;

        let nextSnapshot: AssignmentSnapshot | null = null;
        if (action !== 'deleted') {
          nextSnapshot = buildSnapshot(payload, fallbackPrev);
        }

        if (rangeContains(log.createdAt)) {
          const beforeHours = roundValue(fallbackPrev?.hours ?? 0);
          const afterHours = roundValue(nextSnapshot?.hours ?? 0);
          const delta = roundValue(afterHours - beforeHours);

          let movement: 'added' | 'modified' | 'removed' | null = null;
          let added = 0;
          let modified = 0;
          let removed = 0;

          if (action === 'created' && afterHours > 0) {
            movement = 'added';
            added = afterHours;
          } else if (action === 'deleted' && beforeHours > 0) {
            movement = 'removed';
            removed = beforeHours;
          } else if (action === 'updated' && beforeHours !== afterHours) {
            if (beforeHours <= 0 && afterHours > 0) {
              movement = 'added';
              added = afterHours;
            } else if (beforeHours > 0 && afterHours <= 0) {
              movement = 'removed';
              removed = beforeHours;
            } else {
              movement = 'modified';
              modified = Math.abs(delta);
            }
          }

          if (movement) {
            const effectiveSnapshot = nextSnapshot || fallbackPrev;
            const projectId = effectiveSnapshot?.projectId || '';
            const projectName = getProjectDisplayName(projectId, effectiveSnapshot?.projectNameHint || '');
            const department = effectiveSnapshot?.department || (language === 'es' ? 'SIN_DEPTO' : 'NO_DEPT');
            const weekStartDate = normalizeWeekStartDate(effectiveSnapshot?.weekStartDate || '');
            const validWeek = weekStartDate && weekSet.has(weekStartDate) ? weekStartDate : '';
            if (!validWeek) {
              // Skip if movement is outside selected weekly range.
              return;
            }

            const yearWeek = getYearWeekLabel(validWeek);
            const projectWeek = getProjectWeekLabel(projectId, validWeek);
            const changedBy = formatTimingUserName(log.user);

            const movementLabel = movement === 'added'
              ? (language === 'es' ? 'Horas agregadas' : 'Hours added')
              : movement === 'removed'
                ? (language === 'es' ? 'Horas eliminadas' : 'Hours removed')
                : (language === 'es' ? 'Horas modificadas' : 'Hours modified');

            detailRows.push({
              changedAtRaw: log.createdAt,
              changedAt: formatTimingDateTime(log.createdAt),
              changedBy,
              weekStart: validWeek,
              yearWeek,
              projectWeek,
              project: projectName,
              department,
              movementCode: movement,
              movementType: movementLabel,
              beforeHours,
              afterHours,
              deltaHours: delta,
            });

            const weekSummary = ensureYearWeekSummary(validWeek);
            weekSummary.addedHours = roundValue(weekSummary.addedHours + added);
            weekSummary.modifiedHours = roundValue(weekSummary.modifiedHours + modified);
            weekSummary.removedHours = roundValue(weekSummary.removedHours + removed);
            weekSummary.netHours = roundValue(weekSummary.netHours + delta);
            weekSummary.projects.add(projectName);
            weekSummary.users.add(changedBy);
            weekSummary.movements += 1;

            const wpComparison = ensureWeekProjectComparison(validWeek, projectName, department, projectWeek);
            wpComparison.addedHours = roundValue(wpComparison.addedHours + added);
            wpComparison.modifiedHours = roundValue(wpComparison.modifiedHours + modified);
            wpComparison.removedHours = roundValue(wpComparison.removedHours + removed);
            wpComparison.netHours = roundValue(wpComparison.netHours + delta);
            wpComparison.users.add(changedBy);
            wpComparison.movements += 1;
            wpComparison.lastChangedAt = log.createdAt;

            if (!wpComparison.openingHoursByAssignment.has(log.objectId)) {
              wpComparison.openingHoursByAssignment.set(log.objectId, beforeHours);
            }
            wpComparison.closingHoursByAssignment.set(log.objectId, afterHours);
          }
        }

        if (action === 'deleted') {
          assignmentStateById.delete(log.objectId);
        } else if (nextSnapshot) {
          assignmentStateById.set(log.objectId, nextSnapshot);
        }
      });

      if (detailRows.length === 0) {
        alert(language === 'es'
          ? 'No se detectaron movimientos de horas en semanas del rango seleccionado.'
          : 'No hour movements were detected in weeks within the selected range.');
        return;
      }

      const yearWeekRows = Array.from(yearWeekMap.values())
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      const sumMapValues = (map: Map<string, number>) => {
        let total = 0;
        map.forEach((value) => {
          total += value;
        });
        return roundValue(total);
      };
      const formatSignedHours = (value: number) => `${value >= 0 ? '+' : ''}${roundValue(value).toFixed(2)}`;

      const weekProjectComparisonRows: WeekProjectComparisonRow[] = Array.from(weekProjectComparisonMap.values())
        .map((row) => ({
          weekStart: row.weekStart,
          yearWeek: row.yearWeek,
          project: row.project,
          department: row.department,
          projectWeek: row.projectWeek,
          openingHours: sumMapValues(row.openingHoursByAssignment),
          closingHours: sumMapValues(row.closingHoursByAssignment),
          addedHours: row.addedHours,
          modifiedHours: row.modifiedHours,
          removedHours: row.removedHours,
          netHours: row.netHours,
          users: Array.from(row.users).sort().join(', '),
          movements: row.movements,
          lastChangedAt: row.lastChangedAt,
        }))
        .sort((a, b) => {
          const byWeek = a.weekStart.localeCompare(b.weekStart);
          if (byWeek !== 0) return byWeek;
          const byProject = a.project.localeCompare(b.project);
          if (byProject !== 0) return byProject;
          const byDepartment = a.department.localeCompare(b.department);
          if (byDepartment !== 0) return byDepartment;
          return a.projectWeek.localeCompare(b.projectWeek);
        });

      const weeklyWrittenSummaryRows: WeeklyWrittenSummaryRow[] = yearWeekRows.map((row) => {
        const matchedRows = weekProjectComparisonRows
          .filter((entry) => entry.weekStart === row.weekStart)
          .sort((a, b) => {
            const byImpact = Math.abs(b.netHours) - Math.abs(a.netHours);
            if (byImpact !== 0) return byImpact;
            return b.movements - a.movements;
          });

        const topChangesText = matchedRows
          .slice(0, 3)
          .map((entry) => (
            `${entry.project} [${entry.department} ${entry.projectWeek}]: `
            + `${entry.openingHours.toFixed(2)}h -> ${entry.closingHours.toFixed(2)}h `
            + `(D ${formatSignedHours(entry.netHours)}h)`
          ))
          .join(' | ');

        const users = Array.from(row.users).sort().join(', ');
        const summary = language === 'es'
          ? `${row.yearWeek}: ${row.movements} movimientos por ${row.users.size} usuario(s). `
            + `Agregadas ${row.addedHours.toFixed(2)}h, modificadas ${row.modifiedHours.toFixed(2)}h, `
            + `eliminadas ${row.removedHours.toFixed(2)}h, neto ${formatSignedHours(row.netHours)}h. `
            + `Cambios clave: ${topChangesText || 'Sin cambios clave para mostrar.'}`
          : `${row.yearWeek}: ${row.movements} movements by ${row.users.size} user(s). `
            + `${row.addedHours.toFixed(2)}h added, ${row.modifiedHours.toFixed(2)}h modified, `
            + `${row.removedHours.toFixed(2)}h removed, net ${formatSignedHours(row.netHours)}h. `
            + `Key changes: ${topChangesText || 'No key changes to display.'}`;

        return {
          weekStart: row.weekStart,
          yearWeek: row.yearWeek,
          summary,
          addedHours: row.addedHours,
          modifiedHours: row.modifiedHours,
          removedHours: row.removedHours,
          netHours: row.netHours,
          movements: row.movements,
          users,
        };
      });

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const BORDER = 'D5D1DA';
      const HEADER_BG = '2E1A47';
      const HEADER_TEXT = 'FFFFFF';
      const WHITE = 'FFFFFF';
      const POS_BG = 'DCFCE7';
      const NEG_BG = 'FEE2E2';
      const MOD_BG = 'FEF9C3';

      const applyBorder = (cell: any) => {
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER } },
          left: { style: 'thin', color: { argb: BORDER } },
          bottom: { style: 'thin', color: { argb: BORDER } },
          right: { style: 'thin', color: { argb: BORDER } },
        };
      };

      const styleHeader = (sheet: any, rowNumber = 1) => {
        const row = sheet.getRow(rowNumber);
        row.font = { bold: true, color: { argb: HEADER_TEXT } };
        row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        row.eachCell((cell: any) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
          applyBorder(cell);
        });
        row.height = 24;
      };

      const styleRows = (sheet: any, startRow = 2) => {
        sheet.eachRow((excelRow: any, rowNumber: number) => {
          if (rowNumber < startRow) return;
          excelRow.eachCell((cell: any) => {
            if (!cell.fill) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
            }
            if (!cell.alignment) {
              cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            }
            applyBorder(cell);
          });
        });
      };

      const executiveSheet = workbook.addWorksheet(language === 'es' ? 'Resumen Semanal Ejecutivo' : 'Weekly Executive Summary');
      executiveSheet.columns = [
        { header: language === 'es' ? 'Semana Inicio' : 'Week Start', key: 'weekStart', width: 13 },
        { header: language === 'es' ? 'Semana del Ano' : 'Year Week', key: 'yearWeek', width: 15 },
        { header: language === 'es' ? 'Resumen Ejecutivo' : 'Executive Summary', key: 'summary', width: 110 },
        { header: language === 'es' ? 'Horas Agregadas' : 'Added Hours', key: 'addedHours', width: 14 },
        { header: language === 'es' ? 'Horas Modificadas' : 'Modified Hours', key: 'modifiedHours', width: 15 },
        { header: language === 'es' ? 'Horas Eliminadas' : 'Removed Hours', key: 'removedHours', width: 14 },
        { header: language === 'es' ? 'Delta Neto' : 'Net Delta', key: 'netHours', width: 12 },
        { header: language === 'es' ? 'Movimientos' : 'Movements', key: 'movements', width: 11 },
        { header: language === 'es' ? 'Usuarios' : 'Users', key: 'users', width: 24 },
      ];

      weeklyWrittenSummaryRows.forEach((row) => {
        const excelRow = executiveSheet.addRow(row);

        [4, 5, 6, 7].forEach((idx) => {
          excelRow.getCell(idx).numFmt = '0.00';
        });

        excelRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: POS_BG } };
        excelRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MOD_BG } };
        excelRow.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEG_BG } };
      });

      styleHeader(executiveSheet);
      styleRows(executiveSheet);
      executiveSheet.views = [{ state: 'frozen', ySplit: 1 }];
      executiveSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: executiveSheet.columnCount },
      };

      const weekProjectSheet = workbook.addWorksheet(language === 'es' ? 'Comparativo Semanal' : 'Weekly Comparison');
      weekProjectSheet.columns = [
        { header: language === 'es' ? 'Semana Inicio' : 'Week Start', key: 'weekStart', width: 13 },
        { header: language === 'es' ? 'Semana del Ano' : 'Year Week', key: 'yearWeek', width: 15 },
        { header: language === 'es' ? 'Proyecto' : 'Project', key: 'project', width: 30 },
        { header: language === 'es' ? 'Departamento' : 'Department', key: 'department', width: 13 },
        { header: language === 'es' ? 'Semana Proyecto' : 'Project Week', key: 'projectWeek', width: 15 },
        { header: language === 'es' ? 'Horas Antes' : 'Before Hours', key: 'openingHours', width: 12 },
        { header: language === 'es' ? 'Horas Ahora' : 'Now Hours', key: 'closingHours', width: 12 },
        { header: language === 'es' ? 'Horas Agregadas' : 'Added Hours', key: 'addedHours', width: 14 },
        { header: language === 'es' ? 'Horas Modificadas' : 'Modified Hours', key: 'modifiedHours', width: 15 },
        { header: language === 'es' ? 'Horas Eliminadas' : 'Removed Hours', key: 'removedHours', width: 14 },
        { header: language === 'es' ? 'Delta Neto' : 'Net Delta', key: 'netHours', width: 12 },
        { header: language === 'es' ? 'Usuarios' : 'Users', key: 'users', width: 24 },
        { header: language === 'es' ? 'Movimientos' : 'Movements', key: 'movements', width: 11 },
        { header: language === 'es' ? 'Ultimo Cambio' : 'Last Change', key: 'lastChangedAt', width: 22 },
      ];

      weekProjectComparisonRows.forEach((row) => {
        const excelRow = weekProjectSheet.addRow({
          ...row,
          lastChangedAt: formatTimingDateTime(row.lastChangedAt),
        });

        [6, 7, 8, 9, 10, 11].forEach((idx) => {
          excelRow.getCell(idx).numFmt = '0.00';
        });

        excelRow.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: POS_BG } };
        excelRow.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MOD_BG } };
        excelRow.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEG_BG } };
        if (row.netHours > 0) {
          excelRow.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: POS_BG } };
        } else if (row.netHours < 0) {
          excelRow.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEG_BG } };
        }
      });

      styleHeader(weekProjectSheet);
      styleRows(weekProjectSheet);
      weekProjectSheet.views = [{ state: 'frozen', ySplit: 1 }];
      weekProjectSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: weekProjectSheet.columnCount },
      };

      const detailSheet = workbook.addWorksheet(language === 'es' ? 'Movimientos Detalle' : 'Detailed Movements');
      detailSheet.columns = [
        { header: language === 'es' ? 'Fecha Cambio' : 'Change Date', key: 'changedAt', width: 22 },
        { header: language === 'es' ? 'Usuario' : 'User', key: 'changedBy', width: 24 },
        { header: language === 'es' ? 'Semana Inicio' : 'Week Start', key: 'weekStart', width: 13 },
        { header: language === 'es' ? 'Semana del Ano' : 'Year Week', key: 'yearWeek', width: 15 },
        { header: language === 'es' ? 'Semana del Proyecto' : 'Project Week', key: 'projectWeek', width: 15 },
        { header: language === 'es' ? 'Proyecto' : 'Project', key: 'project', width: 30 },
        { header: language === 'es' ? 'Departamento' : 'Department', key: 'department', width: 13 },
        { header: language === 'es' ? 'Movimiento' : 'Movement', key: 'movementType', width: 18 },
        { header: language === 'es' ? 'Horas Antes' : 'Before Hours', key: 'beforeHours', width: 12 },
        { header: language === 'es' ? 'Horas Ahora' : 'Now Hours', key: 'afterHours', width: 12 },
        { header: language === 'es' ? 'Delta Horas' : 'Hours Delta', key: 'deltaHours', width: 12 },
      ];

      detailRows
        .sort((a, b) => {
          const byWeek = a.weekStart.localeCompare(b.weekStart);
          if (byWeek !== 0) return byWeek;
          return a.changedAtRaw.localeCompare(b.changedAtRaw);
        })
        .forEach((row) => {
          const excelRow = detailSheet.addRow({
            changedAt: row.changedAt,
            changedBy: row.changedBy,
            weekStart: row.weekStart,
            yearWeek: row.yearWeek,
            projectWeek: row.projectWeek,
            project: row.project,
            department: row.department,
            movementType: row.movementType,
            beforeHours: row.beforeHours,
            afterHours: row.afterHours,
            deltaHours: row.deltaHours,
          });
          [9, 10, 11].forEach((idx) => {
            excelRow.getCell(idx).numFmt = '0.00';
          });

          if (row.movementCode === 'added') {
            excelRow.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: POS_BG } };
          } else if (row.movementCode === 'removed') {
            excelRow.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEG_BG } };
          } else {
            excelRow.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MOD_BG } };
          }
        });

      styleHeader(detailSheet);
      styleRows(detailSheet);
      detailSheet.views = [{ state: 'frozen', ySplit: 1 }];
      detailSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: detailSheet.columnCount },
      };

      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = `cambios-semanales-explicitos-${startDate}-a-${endDate}-${dateStamp}.xlsx`;
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
        ? 'Ocurrio un error al exportar el comparativo semanal.'
        : 'An error occurred while exporting the weekly comparison.');
    } finally {
      setIsTimingRangeExcelExporting(false);
    }
  };

  const handleExportTimingChangesExcel = async () => {
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

    const weeklyRange = getWeeksInRange(startDate, endDate)
      .map((week) => normalizeWeekStartDate(week))
      .filter((week, idx, arr) => week && arr.indexOf(week) === idx);

    if (weeklyRange.length === 0) {
      alert(language === 'es'
        ? 'No hay semanas validas en el rango seleccionado.'
        : 'There are no valid weeks in the selected range.');
      return;
    }

    try {
      setIsTimingRangeExcelExporting(true);

      const response = await activityLogApi.getFiltered({
        modelName: 'Project',
        action: 'updated',
        startDate,
        endDate,
        ordering: '-created_at',
        pageSize: 2000,
      });

      const timingLogs = (Array.isArray(response) ? response as ActivityLogEntry[] : [])
        .filter((row) => {
          if (!row || row.modelName !== 'Project') return false;
          const action = (row.action || '').toLowerCase();
          if (action !== 'updated' && action !== 'update') return false;
          const updates = extractProjectUpdatePayload(row.changes);
          return Boolean(updates && hasTimingDataDeep(updates));
        })
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      if (timingLogs.length === 0) {
        alert(language === 'es'
          ? 'No hay cambios de timing para exportar en el rango seleccionado.'
          : 'There are no timing changes to export in the selected range.');
        return;
      }

      const normalizeCompactAction = (
        rawAction: string
      ): 'created' | 'updated' | 'deleted' | 'other' => {
        const action = (rawAction || '').toLowerCase();
        if (action === 'created' || action === 'create') return 'created';
        if (action === 'updated' || action === 'update') return 'updated';
        if (action === 'deleted' || action === 'delete') return 'deleted';
        return 'other';
      };

      const assignmentResponse = await activityLogApi.getFiltered({
        modelName: 'Assignment',
        endDate,
        ordering: 'created_at',
        pageSize: 5000,
      });
      const assignmentLogs = (Array.isArray(assignmentResponse) ? assignmentResponse as ActivityLogEntry[] : [])
        .filter((row) => row && row.modelName === 'Assignment' && normalizeCompactAction(row.action) !== 'other')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      interface TimingDetailRow {
        weekStart: string;
        yearWeek: string;
        changedAt: string;
        changedAtRaw: string;
        changedBy: string;
        project: string;
        projectId: string;
        summary: string;
      }

      interface TimingWeeklyRow {
        weekStart: string;
        yearWeek: string;
        changes: number;
        projects: number;
        users: number;
        lastChangedAt: string;
        projectList: string;
      }

      interface TimingProjectRow {
        project: string;
        projectId: string;
        changes: number;
        activeWeeks: number;
        users: number;
        lastChangedAt: string;
      }

      const getYearWeekLabel = (weekStartDate: string) => {
        if (!weekStartDate) return '-';
        const weekNum = getWeekNumber(weekStartDate);
        const year = parseISODate(weekStartDate).getFullYear();
        return `${year}-CW${String(weekNum).padStart(2, '0')}`;
      };

      const weekSet = new Set(weeklyRange);
      const detailRows: TimingDetailRow[] = [];
      const weeklyMap = new Map<string, {
        weekStart: string;
        yearWeek: string;
        changes: number;
        projectIds: Set<string>;
        projectNames: Set<string>;
        users: Set<string>;
        lastChangedAt: string;
      }>();
      const projectMap = new Map<string, {
        project: string;
        projectId: string;
        changes: number;
        weekStarts: Set<string>;
        users: Set<string>;
        lastChangedAt: string;
      }>();

      timingLogs.forEach((log) => {
        const updates = extractProjectUpdatePayload(log.changes);
        if (!updates) return;

        const projectId = log.objectId;
        const fallbackName = typeof updates.name === 'string' ? updates.name : '';
        const projectName = projectById.get(projectId)?.name
          || fallbackName
          || `${language === 'es' ? 'Proyecto' : 'Project'} ${projectId.slice(0, 8)}`;

        const changedAtDate = new Date(log.createdAt);
        if (Number.isNaN(changedAtDate.getTime())) return;

        const weekStart = normalizeWeekStartDate(formatToISO(getWeekStart(changedAtDate)));
        if (!weekStart || !weekSet.has(weekStart)) return;

        const changedBy = formatTimingUserName(log.user);
        const summary = getTimingSummaryLines(log).join(' | ');
        const yearWeek = getYearWeekLabel(weekStart);

        detailRows.push({
          weekStart,
          yearWeek,
          changedAt: formatTimingDateTime(log.createdAt),
          changedAtRaw: log.createdAt,
          changedBy,
          project: projectName,
          projectId,
          summary,
        });

        const weekly = weeklyMap.get(weekStart) || {
          weekStart,
          yearWeek,
          changes: 0,
          projectIds: new Set<string>(),
          projectNames: new Set<string>(),
          users: new Set<string>(),
          lastChangedAt: '',
        };
        weekly.changes += 1;
        weekly.projectIds.add(projectId);
        weekly.projectNames.add(projectName);
        weekly.users.add(changedBy);
        if (!weekly.lastChangedAt || log.createdAt > weekly.lastChangedAt) {
          weekly.lastChangedAt = log.createdAt;
        }
        weeklyMap.set(weekStart, weekly);

        const projectKey = `${projectId}|${projectName}`;
        const projectRow = projectMap.get(projectKey) || {
          project: projectName,
          projectId,
          changes: 0,
          weekStarts: new Set<string>(),
          users: new Set<string>(),
          lastChangedAt: '',
        };
        projectRow.changes += 1;
        projectRow.weekStarts.add(weekStart);
        projectRow.users.add(changedBy);
        if (!projectRow.lastChangedAt || log.createdAt > projectRow.lastChangedAt) {
          projectRow.lastChangedAt = log.createdAt;
        }
        projectMap.set(projectKey, projectRow);
      });

      if (detailRows.length === 0) {
        alert(language === 'es'
          ? 'No se detectaron cambios de timing en semanas del rango seleccionado.'
          : 'No timing changes were detected in weeks within the selected range.');
        return;
      }

      const weeklyRows: TimingWeeklyRow[] = Array.from(weeklyMap.values())
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .map((row) => ({
          weekStart: row.weekStart,
          yearWeek: row.yearWeek,
          changes: row.changes,
          projects: row.projectIds.size,
          users: row.users.size,
          lastChangedAt: formatTimingDateTime(row.lastChangedAt),
          projectList: Array.from(row.projectNames).sort().join(' | '),
        }));

      const projectRows: TimingProjectRow[] = Array.from(projectMap.values())
        .sort((a, b) => a.project.localeCompare(b.project))
        .map((row) => ({
          project: row.project,
          projectId: row.projectId,
          changes: row.changes,
          activeWeeks: row.weekStarts.size,
          users: row.users.size,
          lastChangedAt: formatTimingDateTime(row.lastChangedAt),
        }));

      const sortedDetailRows = [...detailRows].sort((a, b) => {
        const byWeek = a.weekStart.localeCompare(b.weekStart);
        if (byWeek !== 0) return byWeek;
        return a.changedAtRaw.localeCompare(b.changedAtRaw);
      });
      void weeklyRows;
      void sortedDetailRows;
      void projectRows;

      interface CompactDeptTimingSnapshot {
        stage: Stage;
        weekStart: number | null;
        weekEnd: number | null;
        durationWeeks: number | null;
        departmentStartDate: string;
      }

      interface CompactProjectSnapshot {
        projectId: string;
        projectName: string;
        startDate: string;
        numberOfWeeks: number | null;
        departments: Record<Department, CompactDeptTimingSnapshot>;
      }

      interface CompactAssignmentSnapshot {
        projectId: string;
        department: Department | '';
        weekStartDate: string;
        hours: number;
        employeeId: string;
        stage: Stage;
      }

      interface CompactCellState {
        value: string;
        active: boolean;
        isFirstWeek: boolean;
      }

      interface CompactCapacityCellState extends CompactCellState {
        capacityValue: number | null;
        displayValue: string;
        inTimingRange: boolean;
        hasCapacityLoad: boolean;
        stage: Stage;
      }

      const toFiniteNumber = (value: unknown): number | null => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };

      const roundCompactHours = (value: number) => Math.round((value || 0) * 100) / 100;
      const hasOwn = (obj: Record<string, any>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
      const asCompactNumber = (value: unknown): number | null => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
      };
      const asCompactString = (value: unknown): string => (typeof value === 'string' ? value : '');
      const normalizeCompactDepartment = (value: unknown): Department | '' => {
        const raw = asCompactString(value).trim().toUpperCase();
        if (!raw) return '';
        return DEPARTMENT_SET.has(raw as Department) ? (raw as Department) : '';
      };
      const normalizeCompactStage = (value: unknown): Stage => {
        if (value === null) return null;
        const raw = asCompactString(value).trim();
        return raw ? (raw as Stage) : null;
      };
      const resolveCompactHoursFromPayload = (payload: Record<string, any>, fallbackHours: number): number => {
        const hasSplitFields =
          hasOwn(payload, 'scioHours')
          || hasOwn(payload, 'externalHours')
          || hasOwn(payload, 'scio_hours')
          || hasOwn(payload, 'external_hours');

        if (hasSplitFields) {
          const scio = asCompactNumber(payload.scioHours ?? payload.scio_hours) ?? 0;
          const external = asCompactNumber(payload.externalHours ?? payload.external_hours) ?? 0;
          return roundCompactHours(Math.max(0, scio + external));
        }

        const totalCandidate = asCompactNumber(payload.totalHours ?? payload.total_hours);
        if (totalCandidate !== null) return roundCompactHours(Math.max(0, totalCandidate));

        const hoursCandidate = asCompactNumber(payload.hours);
        if (hoursCandidate !== null) return roundCompactHours(Math.max(0, hoursCandidate));

        return roundCompactHours(Math.max(0, fallbackHours));
      };
      const resolveCompactAssignmentProjectId = (payload: Record<string, any>, fallbackProjectId: string): string => {
        const projectObj = asObject(payload.project);
        const candidate =
          payload.projectId
          ?? payload.project_id
          ?? projectObj?.id
          ?? (typeof payload.project === 'string' ? payload.project : '')
          ?? fallbackProjectId;
        return asCompactString(candidate);
      };
      const resolveCompactAssignmentWeek = (payload: Record<string, any>, fallbackWeek: string): string => {
        const raw = asCompactString(payload.weekStartDate ?? payload.week_start_date ?? fallbackWeek);
        return raw ? normalizeWeekStartDate(raw) : '';
      };
      const buildCompactAssignmentSnapshot = (
        payload: Record<string, any> | null,
        previous: CompactAssignmentSnapshot | null
      ): CompactAssignmentSnapshot | null => {
        if (!payload && !previous) return null;

        const current = payload || {};
        const employeeId = asCompactString(current.employeeId ?? current.employee_id ?? previous?.employeeId ?? '');
        const employeeDepartment = employeeId ? employeeById.get(employeeId)?.department : '';

        const department =
          normalizeCompactDepartment(current.department)
          || normalizeCompactDepartment(current.dept)
          || normalizeCompactDepartment(asObject(current.employee)?.department)
          || normalizeCompactDepartment(employeeDepartment)
          || previous?.department
          || '';
        const projectId = resolveCompactAssignmentProjectId(current, previous?.projectId || '');
        const weekStartDate = resolveCompactAssignmentWeek(current, previous?.weekStartDate || '');
        const hours = resolveCompactHoursFromPayload(current, previous?.hours ?? 0);
        const hasStageField = hasOwn(current, 'stage') || hasOwn(current, 'stage_name');
        const stage = hasStageField
          ? normalizeCompactStage(current.stage ?? current.stage_name)
          : (previous?.stage ?? null);

        return {
          projectId,
          department,
          weekStartDate,
          hours,
          employeeId: employeeId || previous?.employeeId || '',
          stage,
        };
      };

      const extractCompactDeptSnapshot = (stageRows: unknown): Partial<CompactDeptTimingSnapshot> | null => {
        if (!Array.isArray(stageRows) || stageRows.length === 0) return null;

        let minWeekStart: number | null = null;
        let maxWeekEnd: number | null = null;
        let firstDuration: number | null = null;
        let departmentStartDate = '';
        let stage: Stage = null;

        stageRows.forEach((rawStage, index) => {
          const stageObj = asObject(rawStage);
          if (!stageObj) return;

          if (stage === null && (typeof stageObj.stage === 'string' || stageObj.stage === null)) {
            stage = stageObj.stage as Stage;
          }

          const weekStartValue = toFiniteNumber(stageObj.weekStart);
          const weekEndValue = toFiniteNumber(stageObj.weekEnd);
          const durationValue = toFiniteNumber(stageObj.durationWeeks);
          const deptStartValue = typeof stageObj.departmentStartDate === 'string'
            ? stageObj.departmentStartDate.slice(0, 10)
            : '';

          if (durationValue !== null && durationValue > 0 && firstDuration === null) {
            firstDuration = durationValue;
          }

          if (weekStartValue !== null && weekEndValue !== null && weekEndValue >= weekStartValue) {
            if (minWeekStart === null || weekStartValue < minWeekStart) {
              minWeekStart = weekStartValue;
              if (deptStartValue) departmentStartDate = deptStartValue;
            }
            if (maxWeekEnd === null || weekEndValue > maxWeekEnd) {
              maxWeekEnd = weekEndValue;
            }
          } else if (!departmentStartDate && index === 0 && deptStartValue) {
            departmentStartDate = deptStartValue;
          }
        });

        const durationFromRange =
          minWeekStart !== null &&
          maxWeekEnd !== null &&
          maxWeekEnd >= minWeekStart
            ? (maxWeekEnd - minWeekStart + 1)
            : null;

        return {
          stage,
          weekStart: minWeekStart,
          weekEnd: maxWeekEnd,
          durationWeeks: durationFromRange ?? firstDuration,
          departmentStartDate,
        };
      };

      const createEmptyCompactDeptSnapshot = (): CompactDeptTimingSnapshot => ({
        stage: null,
        weekStart: null,
        weekEnd: null,
        durationWeeks: null,
        departmentStartDate: '',
      });

      const createProjectCompactSnapshot = (projectId: string): CompactProjectSnapshot => {
        const project = projectById.get(projectId);
        const departments = DEPARTMENTS.reduce((acc, dept) => {
          acc[dept] = createEmptyCompactDeptSnapshot();
          return acc;
        }, {} as Record<Department, CompactDeptTimingSnapshot>);

        if (project?.departmentStages) {
          DEPARTMENTS.forEach((dept) => {
            const parsed = extractCompactDeptSnapshot(project.departmentStages?.[dept]);
            if (!parsed) return;
            departments[dept] = {
              stage: parsed.stage ?? departments[dept].stage,
              weekStart: parsed.weekStart ?? departments[dept].weekStart,
              weekEnd: parsed.weekEnd ?? departments[dept].weekEnd,
              durationWeeks: parsed.durationWeeks ?? departments[dept].durationWeeks,
              departmentStartDate: parsed.departmentStartDate ?? departments[dept].departmentStartDate,
            };
          });
        }

        const fallbackName = timingLogs.find((entry) => entry.objectId === projectId)
          ?.changes?.updates?.name;

        return {
          projectId,
          projectName: project?.name || fallbackName || `${language === 'es' ? 'Proyecto' : 'Project'} ${projectId.slice(0, 8)}`,
          startDate: project?.startDate || '',
          numberOfWeeks: Number.isFinite(Number(project?.numberOfWeeks)) ? Number(project?.numberOfWeeks) : null,
          departments,
        };
      };

      const applyTimingUpdateToCompactSnapshot = (snapshot: CompactProjectSnapshot, updates: Record<string, any>) => {
        if (typeof updates.name === 'string' && updates.name.trim()) {
          snapshot.projectName = updates.name.trim();
        }
        if (typeof updates.startDate === 'string' && updates.startDate) {
          snapshot.startDate = updates.startDate.slice(0, 10);
        }
        const updatedDuration = toFiniteNumber(updates.numberOfWeeks);
        if (updatedDuration !== null && updatedDuration > 0) {
          snapshot.numberOfWeeks = updatedDuration;
        }

        const departmentStages = asObject(updates.departmentStages);
        if (!departmentStages) return;

        DEPARTMENTS.forEach((dept) => {
          const parsed = extractCompactDeptSnapshot(departmentStages[dept]);
          if (!parsed) return;
          const current = snapshot.departments[dept];
          snapshot.departments[dept] = {
            stage: parsed.stage ?? current.stage,
            weekStart: parsed.weekStart ?? current.weekStart,
            weekEnd: parsed.weekEnd ?? current.weekEnd,
            durationWeeks: parsed.durationWeeks ?? current.durationWeeks,
            departmentStartDate: parsed.departmentStartDate ?? current.departmentStartDate,
          };
        });
      };

      const resolveCompactCellState = (
        snapshot: CompactProjectSnapshot,
        department: Department,
        weekStartDate: string
      ): CompactCellState => {
        let effectiveStartDate = '';
        let durationWeeks = 0;

        if (department === 'PM') {
          effectiveStartDate = snapshot.startDate;
          durationWeeks = snapshot.numberOfWeeks || 0;
        } else {
          const deptSnapshot = snapshot.departments[department];
          effectiveStartDate = deptSnapshot.departmentStartDate || '';
          if (!effectiveStartDate && snapshot.startDate && deptSnapshot.weekStart !== null) {
            const fallbackStart = parseISODate(snapshot.startDate);
            fallbackStart.setDate(fallbackStart.getDate() + ((deptSnapshot.weekStart - 1) * 7));
            effectiveStartDate = formatToISO(fallbackStart);
          }
          durationWeeks =
            (deptSnapshot.durationWeeks && deptSnapshot.durationWeeks > 0)
              ? deptSnapshot.durationWeeks
              : (
                  deptSnapshot.weekStart !== null &&
                  deptSnapshot.weekEnd !== null &&
                  deptSnapshot.weekEnd >= deptSnapshot.weekStart
                    ? (deptSnapshot.weekEnd - deptSnapshot.weekStart + 1)
                    : 0
                );
        }

        if (!effectiveStartDate || durationWeeks <= 0) {
          return { value: '-', active: false, isFirstWeek: false };
        }

        const start = parseISODate(effectiveStartDate);
        const week = parseISODate(weekStartDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(week.getTime())) {
          return { value: '-', active: false, isFirstWeek: false };
        }

        const end = new Date(start);
        end.setDate(end.getDate() + (durationWeeks * 7) - 1);
        if (week < start || week > end) {
          return { value: '-', active: false, isFirstWeek: false };
        }

        const weekNumber = Math.floor((week.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1;
        return {
          value: `${weekNumber}`,
          active: true,
          isFirstWeek: weekNumber === 1,
        };
      };

      const formatCompactCapacityValue = (value: number): string => {
        const rounded = Math.round(value * 100) / 100;
        if (Number.isInteger(rounded)) return `${rounded}`;
        return rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
      };

      const parseTailwindBgHex = (bgClass: string): string | null => {
        const match = bgClass.match(/#([0-9A-Fa-f]{6})/);
        return match ? match[1].toUpperCase() : null;
      };

      const compactFallbackBgByClass: Record<string, string> = {
        'bg-gray-100': 'F3F4F6',
        'bg-red-500': 'EF4444',
        'bg-red-700': 'B91C1C',
        'bg-yellow-100': 'FEF9C3',
        'bg-green-100': 'DCFCE7',
      };

      const getCompactStagePalette = (
        stage: Stage,
        department: Department
      ): { bg: string; fg: string } | null => {
        if (!stage) return null;
        const stageColor = getStageColor(stage, department);
        const parsedBg = parseTailwindBgHex(stageColor.bg);
        const bg = parsedBg || compactFallbackBgByClass[stageColor.bg];
        if (!bg) return null;
        const fg = stageColor.text.includes('text-white') ? WHITE : '111827';
        return { bg, fg };
      };

      const resolveCompactCapacityCellState = (
        snapshot: CompactProjectSnapshot,
        department: Department,
        weekStartDate: string,
        assignmentHoursByCell: Map<string, number>,
        assignmentStageByCell: Map<string, Stage>,
        fallbackAssignmentHoursByCell?: Map<string, number>,
        fallbackAssignmentStageByCell?: Map<string, Stage>,
        fallbackBlockedKeys?: Set<string>
      ): CompactCapacityCellState => {
        const timingCell = resolveCompactCellState(snapshot, department, weekStartDate);

        const assignmentKey = `${snapshot.projectId}|${department}|${weekStartDate}`;
        const allowFallback = !fallbackBlockedKeys?.has(assignmentKey);
        const totalHours = assignmentHoursByCell.has(assignmentKey)
          ? (assignmentHoursByCell.get(assignmentKey) || 0)
          : (allowFallback ? (fallbackAssignmentHoursByCell?.get(assignmentKey) || 0) : 0);
        const stage = assignmentStageByCell.has(assignmentKey)
          ? (assignmentStageByCell.get(assignmentKey) || null)
          : (allowFallback ? (fallbackAssignmentStageByCell?.get(assignmentKey) || null) : null);
        const normalizedCapacity = department === 'MFG' ? totalHours : calculateTalent(totalHours);
        const hasCapacityLoad = normalizedCapacity > 0;

        return {
          ...timingCell,
          capacityValue: hasCapacityLoad ? normalizedCapacity : null,
          displayValue: hasCapacityLoad ? formatCompactCapacityValue(normalizedCapacity) : '',
          inTimingRange: timingCell.active,
          hasCapacityLoad,
          stage,
        };
      };

      const compactProjectIds = Array.from(new Set(timingLogs.map((entry) => entry.objectId).filter(Boolean)));
      const compactProjects = compactProjectIds
        .map((projectId) => createProjectCompactSnapshot(projectId))
        .sort((a, b) => a.projectName.localeCompare(b.projectName));

      const compactLogsByProject = new Map<string, ActivityLogEntry[]>();
      timingLogs.forEach((entry) => {
        const bucket = compactLogsByProject.get(entry.objectId) || [];
        bucket.push(entry);
        compactLogsByProject.set(entry.objectId, bucket);
      });

      const buildCompactSnapshotByWeekStart = (
        projectId: string,
        weekStartDate: string
      ): CompactProjectSnapshot => {
        const snapshot = createProjectCompactSnapshot(projectId);
        if (!weekStartDate) return snapshot;
        const projectLogs = compactLogsByProject.get(projectId) || [];
        for (const log of projectLogs) {
          const logDay = (log.createdAt || '').slice(0, 10);
          if (!logDay || logDay > weekStartDate) break;
          const updates = extractProjectUpdatePayload(log.changes);
          if (updates) {
            applyTimingUpdateToCompactSnapshot(snapshot, updates);
          }
        }
        return snapshot;
      };

      const getCompactAssignmentCellKey = (snapshot: CompactAssignmentSnapshot | null): string => {
        if (!snapshot || !snapshot.projectId || !snapshot.department || !snapshot.weekStartDate) return '';
        return `${snapshot.projectId}|${snapshot.department}|${snapshot.weekStartDate}`;
      };

      const buildCompactAssignmentHoursContextByWeekStart = (weekStartDate: string): {
        hoursByCell: Map<string, number>;
        stageByCell: Map<string, Stage>;
        changedKeysAfterSnapshot: Set<string>;
      } => {
        const assignmentStateById = new Map<string, CompactAssignmentSnapshot>();
        const changedKeysAfterSnapshot = new Set<string>();
        if (!weekStartDate) {
          return {
            hoursByCell: new Map<string, number>(),
            stageByCell: new Map<string, Stage>(),
            changedKeysAfterSnapshot,
          };
        }

        let logIndex = 0;
        while (logIndex < assignmentLogs.length) {
          const log = assignmentLogs[logIndex];
          const logDay = (log.createdAt || '').slice(0, 10);
          if (!logDay || logDay > weekStartDate) break;

          const action = normalizeCompactAction(log.action);
          if (action !== 'other') {
            const changesObj = asObject(log.changes);
            const payload = changesObj
              ? (asObject(changesObj.assignment) || asObject(changesObj.updates) || changesObj)
              : null;

            const existingPrev = assignmentStateById.get(log.objectId) || null;
            const fallbackPrev = action === 'deleted' && !existingPrev
              ? buildCompactAssignmentSnapshot(payload, null)
              : existingPrev;

            let nextSnapshot: CompactAssignmentSnapshot | null = null;
            if (action !== 'deleted') {
              nextSnapshot = buildCompactAssignmentSnapshot(payload, fallbackPrev);
            }

            if (action === 'deleted') {
              assignmentStateById.delete(log.objectId);
            } else if (nextSnapshot) {
              assignmentStateById.set(log.objectId, nextSnapshot);
            }
          }

          logIndex += 1;
        }

        const snapshotStateById = new Map<string, CompactAssignmentSnapshot>();
        assignmentStateById.forEach((value, key) => {
          snapshotStateById.set(key, { ...value });
        });

        while (logIndex < assignmentLogs.length) {
          const log = assignmentLogs[logIndex];
          const action = normalizeCompactAction(log.action);
          if (action !== 'other') {
            const changesObj = asObject(log.changes);
            const payload = changesObj
              ? (asObject(changesObj.assignment) || asObject(changesObj.updates) || changesObj)
              : null;

            const existingPrev = assignmentStateById.get(log.objectId) || null;
            const fallbackPrev = action === 'deleted' && !existingPrev
              ? buildCompactAssignmentSnapshot(payload, null)
              : existingPrev;

            let nextSnapshot: CompactAssignmentSnapshot | null = null;
            if (action !== 'deleted') {
              nextSnapshot = buildCompactAssignmentSnapshot(payload, fallbackPrev);
            }

            const previousKey = getCompactAssignmentCellKey(fallbackPrev);
            const nextKey = getCompactAssignmentCellKey(nextSnapshot);
            if (previousKey) changedKeysAfterSnapshot.add(previousKey);
            if (nextKey) changedKeysAfterSnapshot.add(nextKey);

            if (action === 'deleted') {
              assignmentStateById.delete(log.objectId);
            } else if (nextSnapshot) {
              assignmentStateById.set(log.objectId, nextSnapshot);
            }
          }

          logIndex += 1;
        }

        const hoursByCell = new Map<string, number>();
        const stageByCell = new Map<string, Stage>();
        snapshotStateById.forEach((snapshot) => {
          const key = getCompactAssignmentCellKey(snapshot);
          if (!key || snapshot.hours <= 0) return;
          hoursByCell.set(key, roundCompactHours((hoursByCell.get(key) || 0) + snapshot.hours));

          if (snapshot.stage) {
            const department = snapshot.department as Department;
            const currentStage = stageByCell.get(key) || null;
            if (isHigherPriorityStage(department, snapshot.stage, currentStage)) {
              stageByCell.set(key, snapshot.stage);
            }
          }
        });

        return { hoursByCell, stageByCell, changedKeysAfterSnapshot };
      };

      const buildCurrentAssignmentContext = (): {
        hoursByCell: Map<string, number>;
        stageByCell: Map<string, Stage>;
      } => {
        const hoursByCell = new Map<string, number>();
        const stageByCell = new Map<string, Stage>();
        assignmentIndex.byCell.forEach((entry, key) => {
          const totalHours = roundCompactHours(entry?.totalHours ?? 0);
          if (totalHours > 0) {
            hoursByCell.set(key, totalHours);
            stageByCell.set(key, entry?.stage ?? null);
          }
        });
        return { hoursByCell, stageByCell };
      };

      interface CompactDepartmentMetrics {
        quotedHours: number;
        usedHours: number;
        forecastedHours: number;
        utilizationPercent: number;
      }

      const getCompactQuotedHours = (projectId: string, department: Department): number => {
        const project = projectById.get(projectId);
        const quotedHours = project?.departmentHoursAllocated?.[department] || 0;
        const quotedChangeOrders = getQuotedChangeOrders(department, projectId);
        return roundCompactHours(quotedHours + quotedChangeOrders);
      };

      const buildCompactDepartmentMetricsMap = (
        snapshotWeekStart: string,
        hoursByCell: Map<string, number>
      ) => {
        const metricsByProjectDept = new Map<string, CompactDepartmentMetrics>();

        hoursByCell.forEach((hours, key) => {
          const [projectId, departmentRaw, weekStartDate] = key.split('|');
          if (!projectId || !departmentRaw || !weekStartDate) return;
          if (!DEPARTMENT_SET.has(departmentRaw as Department)) return;

          const department = departmentRaw as Department;
          const metricsKey = `${projectId}|${department}`;
          const existing = metricsByProjectDept.get(metricsKey) || {
            quotedHours: getCompactQuotedHours(projectId, department),
            usedHours: 0,
            forecastedHours: 0,
            utilizationPercent: 0,
          };

          if (snapshotWeekStart && weekStartDate < snapshotWeekStart) {
            existing.usedHours = roundCompactHours(existing.usedHours + hours);
          } else {
            existing.forecastedHours = roundCompactHours(existing.forecastedHours + hours);
          }

          metricsByProjectDept.set(metricsKey, existing);
        });

        metricsByProjectDept.forEach((entry) => {
          const totalPlanned = entry.usedHours + entry.forecastedHours;
          entry.utilizationPercent = entry.quotedHours > 0
            ? Math.round((totalPlanned / entry.quotedHours) * 100)
            : (totalPlanned > 0 ? 100 : 0);
        });

        return metricsByProjectDept;
      };

      const getCompactDepartmentMetrics = (
        metricsByProjectDept: Map<string, CompactDepartmentMetrics>,
        projectId: string,
        department: Department
      ): CompactDepartmentMetrics => {
        const existing = metricsByProjectDept.get(`${projectId}|${department}`);
        if (existing) return existing;

        return {
          quotedHours: getCompactQuotedHours(projectId, department),
          usedHours: 0,
          forecastedHours: 0,
          utilizationPercent: 0,
        };
      };

      const buildLiveCompactDepartmentMetricsMap = () => {
        const metricsByProjectDept = new Map<string, CompactDepartmentMetrics>();

        compactProjects.forEach((projectSnapshot) => {
          DEPARTMENTS.forEach((department) => {
            const quotedHours = getCompactQuotedHours(projectSnapshot.projectId, department);
            const usedHours = roundCompactHours(getUtilizedHours(department, projectSnapshot.projectId));
            const forecastedHours = roundCompactHours(getForecastedHours(department, projectSnapshot.projectId));
            const totalPlanned = usedHours + forecastedHours;
            const utilizationPercent = quotedHours > 0
              ? Math.round((totalPlanned / quotedHours) * 100)
              : (totalPlanned > 0 ? 100 : 0);

            metricsByProjectDept.set(`${projectSnapshot.projectId}|${department}`, {
              quotedHours,
              usedHours,
              forecastedHours,
              utilizationPercent,
            });
          });
        });

        return metricsByProjectDept;
      };

      const hasCompactDepartmentAssignmentChanges = (
        projectId: string,
        department: Department,
        changedKeysAfterSnapshot: Set<string>
      ): boolean => {
        const prefix = `${projectId}|${department}|`;
        for (const key of changedKeysAfterSnapshot) {
          if (key.startsWith(prefix)) return true;
        }
        return false;
      };

      const buildPreviousEffectiveDepartmentMetricsMap = (
        currentMetricsByProjectDept: Map<string, CompactDepartmentMetrics>,
        previousMetricsByProjectDept: Map<string, CompactDepartmentMetrics>,
        changedKeysAfterSnapshot: Set<string>
      ) => {
        const metricsByProjectDept = new Map<string, CompactDepartmentMetrics>();

        compactProjects.forEach((projectSnapshot) => {
          DEPARTMENTS.forEach((department) => {
            const hasAssignmentChanges = hasCompactDepartmentAssignmentChanges(
              projectSnapshot.projectId,
              department,
              changedKeysAfterSnapshot
            );

            metricsByProjectDept.set(
              `${projectSnapshot.projectId}|${department}`,
              hasAssignmentChanges
                ? getCompactDepartmentMetrics(previousMetricsByProjectDept, projectSnapshot.projectId, department)
                : getCompactDepartmentMetrics(currentMetricsByProjectDept, projectSnapshot.projectId, department)
            );
          });
        });

        return metricsByProjectDept;
      };

      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const BORDER = 'D5D1DA';
      const HEADER_BG = '2E1A47';
      const HEADER_TEXT = 'FFFFFF';
      const WHITE = 'FFFFFF';

      const applyBorder = (cell: any) => {
        cell.border = {
          top: { style: 'thin', color: { argb: BORDER } },
          left: { style: 'thin', color: { argb: BORDER } },
          bottom: { style: 'thin', color: { argb: BORDER } },
          right: { style: 'thin', color: { argb: BORDER } },
        };
      };

      const styleHeader = (sheet: any, rowNumber = 1) => {
        const row = sheet.getRow(rowNumber);
        row.font = { bold: true, color: { argb: HEADER_TEXT } };
        row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        row.eachCell((cell: any) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
          applyBorder(cell);
        });
        row.height = 24;
      };

      const styleRows = (sheet: any, startRow = 2) => {
        sheet.eachRow((excelRow: any, rowNumber: number) => {
          if (rowNumber < startRow) return;
          excelRow.eachCell((cell: any) => {
            if (!cell.fill) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
            }
            if (!cell.alignment) {
              cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            }
            applyBorder(cell);
          });
        });
      };

      const applyVerticalWeekMarker = (
        sheet: any,
        columnNumber: number,
        startRow: number,
        endRow: number
      ) => {
        if (!columnNumber || columnNumber < 1 || endRow < startRow) return;

        for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
          const cell = sheet.getRow(rowNumber).getCell(columnNumber);
          const border = cell.border || {};
          const thin = { style: 'thin', color: { argb: BORDER } };
          cell.border = {
            top: border.top || thin,
            bottom: border.bottom || thin,
            left: { style: 'medium', color: { argb: 'F87171' } },
            right: { style: 'medium', color: { argb: 'F87171' } },
          };
        }
      };

      const compactSheet = workbook.addWorksheet(language === 'es' ? 'Timing Compacto Semanal' : 'Weekly Compact Timing');
      compactSheet.columns = [
        { width: 32 },
        { width: 16 },
        { width: 10 },
        { width: 18 },
        { width: 12 },
        { width: 12 },
        { width: 12 },
        { width: 10 },
        ...weeklyRange.map(() => ({ width: 8 })),
      ];

      const compactChangesColumn = 4;
      const compactQuotedColumn = 5;
      const compactUsedColumn = 6;
      const compactForecastColumn = 7;
      const compactUtilColumn = 8;
      const compactMatrixStartColumn = 9;
      const compactHeaderEndColumn = compactMatrixStartColumn + weeklyRange.length - 1;
      compactSheet.mergeCells(1, 1, 1, compactHeaderEndColumn);
      const compactTitle = compactSheet.getCell(1, 1);
      compactTitle.value = language === 'es'
        ? 'Capacity Compacto Semanal (comparativa: capacidad actual vs semana pasada)'
        : 'Weekly Compact Capacity (comparison: current capacity vs previous week)';
      compactTitle.font = { bold: true, size: 12, color: { argb: HEADER_TEXT } };
      compactTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      compactTitle.alignment = { vertical: 'middle', horizontal: 'left' };
      compactTitle.border = {
        top: { style: 'thin', color: { argb: BORDER } },
        left: { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
      };
      compactSheet.getRow(1).height = 24;

      compactSheet.getCell(2, 1).value = language === 'es' ? 'Proyecto' : 'Project';
      compactSheet.getCell(2, 2).value = language === 'es' ? 'Vista' : 'View';
      compactSheet.getCell(2, 3).value = 'DPTO';
      compactSheet.getCell(2, compactChangesColumn).value = language === 'es' ? 'Cambios' : 'Changes';
      compactSheet.getCell(2, compactQuotedColumn).value = language === 'es' ? 'Cotizado' : 'Quoted';
      compactSheet.getCell(2, compactUsedColumn).value = language === 'es' ? 'Usado' : 'Used';
      compactSheet.getCell(2, compactForecastColumn).value = language === 'es' ? 'Pronostico' : 'Fcst';
      compactSheet.getCell(2, compactUtilColumn).value = language === 'es' ? 'Util %' : 'Util %';

      weeklyRange.forEach((weekStartDate, index) => {
        const column = compactMatrixStartColumn + index;
        const weekNum = getWeekNumber(weekStartDate);
        compactSheet.getCell(2, column).value = `CW${String(weekNum).padStart(2, '0')}`;
      });

      const todayWeekStart = normalizeWeekStartDate(formatToISO(getWeekStart(new Date())));
      const resolvedCurrentWeekIndex = (() => {
        const byToday = weeklyRange.indexOf(todayWeekStart);
        if (byToday > 0) return byToday;
        if (byToday === 0 && weeklyRange.length > 1) return 1;
        return weeklyRange.length - 1;
      })();
      const resolvedPreviousWeekIndex = Math.max(0, resolvedCurrentWeekIndex - 1);
      const hasWeekOverWeekRange =
        weeklyRange.length >= 2 &&
        resolvedCurrentWeekIndex >= 0 &&
        resolvedCurrentWeekIndex < weeklyRange.length &&
        resolvedPreviousWeekIndex >= 0 &&
        resolvedPreviousWeekIndex < weeklyRange.length &&
        resolvedCurrentWeekIndex !== resolvedPreviousWeekIndex;
      const currentWeekStart = hasWeekOverWeekRange ? weeklyRange[resolvedCurrentWeekIndex] : '';
      const previousWeekStart = hasWeekOverWeekRange ? weeklyRange[resolvedPreviousWeekIndex] : '';
      const currentWeekLabel = hasWeekOverWeekRange
        ? `CW${String(getWeekNumber(currentWeekStart)).padStart(2, '0')}`
        : '-';
      const previousWeekLabel = hasWeekOverWeekRange
        ? `CW${String(getWeekNumber(previousWeekStart)).padStart(2, '0')}`
        : '-';

      styleHeader(compactSheet, 2);
      compactSheet.views = [{ state: 'frozen', ySplit: 2, xSplit: 8 }];
      compactSheet.autoFilter = {
        from: { row: 2, column: 1 },
        to: { row: 2, column: compactHeaderEndColumn },
      };

      const compactDataStartRow = 3;

      const compactDeptFillByDept: Record<Department, string> = {
        PM: 'EDE9FE',
        MED: 'DCFCE7',
        HD: 'DBEAFE',
        MFG: 'FEF3C7',
        BUILD: 'FEE2E2',
        PRG: 'D1FAE5',
        PURCHASING: 'CCFBF1',
      };

      const compactCurrentSnapshotWeekStart = hasWeekOverWeekRange
        ? currentWeekStart
        : weeklyRange[weeklyRange.length - 1];
      const compactPreviousSnapshotWeekStart = hasWeekOverWeekRange
        ? previousWeekStart
        : compactCurrentSnapshotWeekStart;
      const compactPreviousSnapshotCutoffDate = (() => {
        if (!compactCurrentSnapshotWeekStart) return compactPreviousSnapshotWeekStart;
        const cutoff = parseISODate(compactCurrentSnapshotWeekStart);
        cutoff.setDate(cutoff.getDate() - 1);
        return formatToISO(cutoff);
      })();
      const compactCurrentAssignmentContext = buildCurrentAssignmentContext();
      const compactCurrentAssignmentHoursByCell = compactCurrentAssignmentContext.hoursByCell;
      const compactCurrentAssignmentStageByCell = compactCurrentAssignmentContext.stageByCell;
      const compactPreviousAssignmentContext = buildCompactAssignmentHoursContextByWeekStart(compactPreviousSnapshotCutoffDate);
      const compactPreviousAssignmentHoursByCell = compactPreviousAssignmentContext.hoursByCell;
      const compactPreviousAssignmentStageByCell = compactPreviousAssignmentContext.stageByCell;
      const compactChangedKeysAfterPrevious = compactPreviousAssignmentContext.changedKeysAfterSnapshot;
      const compactPreviousEffectiveHoursByCell = new Map(compactPreviousAssignmentHoursByCell);
      const compactPreviousEffectiveStageByCell = new Map(compactPreviousAssignmentStageByCell);
      compactCurrentAssignmentHoursByCell.forEach((hours, key) => {
        if (compactChangedKeysAfterPrevious.has(key)) return;
        if (!compactPreviousEffectiveHoursByCell.has(key)) {
          compactPreviousEffectiveHoursByCell.set(key, hours);
        }
        if (!compactPreviousEffectiveStageByCell.has(key) && compactCurrentAssignmentStageByCell.has(key)) {
          compactPreviousEffectiveStageByCell.set(key, compactCurrentAssignmentStageByCell.get(key) || null);
        }
      });
      const compactCurrentMetricsByProjectDept = buildLiveCompactDepartmentMetricsMap();
      const compactPreviousMetricsByProjectDept = buildPreviousEffectiveDepartmentMetricsMap(
        compactCurrentMetricsByProjectDept,
        buildCompactDepartmentMetricsMap(
          compactCurrentSnapshotWeekStart,
          compactPreviousEffectiveHoursByCell
        ),
        compactChangedKeysAfterPrevious
      );
      const compactCurrentSnapshotByProject = new Map<string, CompactProjectSnapshot>();
      const compactPreviousSnapshotByProject = new Map<string, CompactProjectSnapshot>();
      compactProjects.forEach((projectSnapshot) => {
        compactCurrentSnapshotByProject.set(
          projectSnapshot.projectId,
          buildCompactSnapshotByWeekStart(projectSnapshot.projectId, compactCurrentSnapshotWeekStart)
        );
        compactPreviousSnapshotByProject.set(
          projectSnapshot.projectId,
          buildCompactSnapshotByWeekStart(projectSnapshot.projectId, compactPreviousSnapshotCutoffDate)
        );
      });

      const compactBlockRanges: Array<{ startRow: number; endRow: number; outlineColor: string }> = [];
      const compactDiffCells: Array<{ row: number; column: number }> = [];
      const compactCurrentDiffCells: Array<{ row: number; column: number }> = [];
      const compactRowsWithChanges = new Set<number>();

      const renderCompactSnapshotRows = (
        snapshot: CompactProjectSnapshot,
        assignmentHoursByCell: Map<string, number>,
        assignmentStageByCell: Map<string, Stage>,
        fallbackAssignmentHoursByCell: Map<string, number> | undefined,
        fallbackAssignmentStageByCell: Map<string, Stage> | undefined,
        fallbackBlockedKeys: Set<string> | undefined,
        metricsByProjectDept: Map<string, CompactDepartmentMetrics>,
        viewLabel: string,
        viewFill: string,
        rowFill: string,
        viewFontColor: string
      ) => {
        const blockStartRow = compactRow;
        const rowByDepartment = {} as Record<Department, number>;

        DEPARTMENTS.forEach((dept, deptIndex) => {
          const row = compactSheet.getRow(compactRow);
          row.getCell(1).value = '';
          row.getCell(2).value = '';
          row.getCell(3).value = dept;
          row.getCell(compactChangesColumn).value = '';
          row.height = 20;
          row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
          row.getCell(3).alignment = { vertical: 'middle', horizontal: 'center' };
          row.getCell(compactChangesColumn).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          row.getCell(1).font = deptIndex === 0 ? { bold: true } : { bold: false };
          row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } };
          row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } };
          row.getCell(3).font = { bold: true, color: { argb: '2E1A47' } };
          row.getCell(compactChangesColumn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } };
          row.getCell(compactChangesColumn).font = { size: 8, color: { argb: '6B7280' } };

          const metrics = getCompactDepartmentMetrics(metricsByProjectDept, snapshot.projectId, dept);
          const quotedCell = row.getCell(compactQuotedColumn);
          quotedCell.value = metrics.quotedHours;
          quotedCell.numFmt = '0.##';
          quotedCell.alignment = { vertical: 'middle', horizontal: 'center' };
          quotedCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
          quotedCell.font = { size: 9, bold: true, color: { argb: '1E3A8A' } };

          const usedCell = row.getCell(compactUsedColumn);
          usedCell.value = metrics.usedHours;
          usedCell.numFmt = '0.##';
          usedCell.alignment = { vertical: 'middle', horizontal: 'center' };
          usedCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'ECFDF5' } };
          usedCell.font = { size: 9, bold: true, color: { argb: '065F46' } };

          const forecastCell = row.getCell(compactForecastColumn);
          forecastCell.value = metrics.forecastedHours;
          forecastCell.numFmt = '0.##';
          forecastCell.alignment = { vertical: 'middle', horizontal: 'center' };
          forecastCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
          forecastCell.font = { size: 9, bold: true, color: { argb: '92400E' } };

          const utilPalette = getUtilizationColor(metrics.utilizationPercent);
          const utilCell = row.getCell(compactUtilColumn);
          utilCell.value = metrics.utilizationPercent;
          utilCell.numFmt = '0"%"';
          utilCell.alignment = { vertical: 'middle', horizontal: 'center' };
          utilCell.font = {
            size: 9,
            bold: true,
            color: { argb: utilPalette.text.includes('text-white') ? 'FFFFFF' : '111827' },
          };
          utilCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: parseTailwindBgHex(utilPalette.bg) || compactFallbackBgByClass[utilPalette.bg] || 'F3F4F6',
            },
          };

          weeklyRange.forEach((weekStartDate, weekIndex) => {
            const column = compactMatrixStartColumn + weekIndex;
            const compactCell = resolveCompactCapacityCellState(
              snapshot,
              dept,
              weekStartDate,
              assignmentHoursByCell,
              assignmentStageByCell,
              fallbackAssignmentHoursByCell,
              fallbackAssignmentStageByCell,
              fallbackBlockedKeys
            );
            const cell = row.getCell(column);
            cell.value = compactCell.capacityValue !== null ? compactCell.capacityValue : '';
            if (compactCell.capacityValue !== null) {
              cell.numFmt = '0.##';
            }
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.font = {
              size: 9,
              bold: compactCell.hasCapacityLoad,
              color: { argb: compactCell.hasCapacityLoad ? '1F2937' : '6B7280' },
            };

            if (compactCell.hasCapacityLoad) {
              const stagePalette = getCompactStagePalette(compactCell.stage, dept);
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: {
                  argb: stagePalette?.bg || compactDeptFillByDept[dept],
                },
              };
              if (stagePalette) {
                cell.font = {
                  ...(cell.font || {}),
                  bold: true,
                  color: { argb: stagePalette.fg },
                };
              }
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
            }
          });

          rowByDepartment[dept] = compactRow;
          compactRow += 1;
        });

        const blockEndRow = compactRow - 1;
        compactSheet.mergeCells(blockStartRow, 2, blockEndRow, 2);
        const viewCell = compactSheet.getCell(blockStartRow, 2);
        viewCell.value = viewLabel;
        viewCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        viewCell.font = { size: 9, bold: true, color: { argb: viewFontColor } };
        viewCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: viewFill } };
        applyBorder(viewCell);

        return {
          startRow: blockStartRow,
          endRow: blockEndRow,
          rowByDepartment,
        };
      };

      let compactRow = compactDataStartRow;
      compactProjects.forEach((projectSnapshot) => {
        const currentSnapshot = compactCurrentSnapshotByProject.get(projectSnapshot.projectId)
          || createProjectCompactSnapshot(projectSnapshot.projectId);
        const previousSnapshot = compactPreviousSnapshotByProject.get(projectSnapshot.projectId)
          || createProjectCompactSnapshot(projectSnapshot.projectId);
        const currentViewLabel = hasWeekOverWeekRange
          ? `${language === 'es' ? 'Semana Actual' : 'Current Week'} (${currentWeekLabel})`
          : `${language === 'es' ? 'Actual' : 'Current'} (${currentWeekLabel})`;
        const previousViewLabel = hasWeekOverWeekRange
          ? `${language === 'es' ? 'Semana Pasada' : 'Previous Week'} (${previousWeekLabel})`
          : `${language === 'es' ? 'Referencia' : 'Reference'} (${previousWeekLabel})`;
        const projectName = currentSnapshot.projectName || projectSnapshot.projectName;

        const projectStartRow = compactRow;
        const currentBlock = renderCompactSnapshotRows(
          currentSnapshot,
          compactCurrentAssignmentHoursByCell,
          compactCurrentAssignmentStageByCell,
          undefined,
          undefined,
          undefined,
          compactCurrentMetricsByProjectDept,
          currentViewLabel,
          'DBEAFE',
          'F0F9FF',
          '1D4ED8'
        );
        const previousBlock = renderCompactSnapshotRows(
          previousSnapshot,
          compactPreviousEffectiveHoursByCell,
          compactPreviousEffectiveStageByCell,
          compactCurrentAssignmentHoursByCell,
          compactCurrentAssignmentStageByCell,
          compactChangedKeysAfterPrevious,
          compactPreviousMetricsByProjectDept,
          previousViewLabel,
          'E5E7EB',
          'F9FAFB',
          '374151'
        );

        compactSheet.mergeCells(projectStartRow, 1, compactRow - 1, 1);
        const projectCell = compactSheet.getCell(projectStartRow, 1);
        projectCell.value = projectName;
        projectCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        projectCell.font = { bold: true, color: { argb: '111827' } };
        projectCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
        applyBorder(projectCell);

        DEPARTMENTS.forEach((dept) => {
          const currentRow = currentBlock.rowByDepartment[dept];
          const previousRow = previousBlock.rowByDepartment[dept];
          let departmentHasChanges = false;
          const currentMetrics = getCompactDepartmentMetrics(
            compactCurrentMetricsByProjectDept,
            currentSnapshot.projectId,
            dept
          );
          const previousMetrics = getCompactDepartmentMetrics(
            compactPreviousMetricsByProjectDept,
            previousSnapshot.projectId,
            dept
          );

          const metricDiffs: Array<{ column: number; changed: boolean }> = [
            { column: compactQuotedColumn, changed: currentMetrics.quotedHours !== previousMetrics.quotedHours },
            { column: compactUsedColumn, changed: currentMetrics.usedHours !== previousMetrics.usedHours },
            { column: compactForecastColumn, changed: currentMetrics.forecastedHours !== previousMetrics.forecastedHours },
            { column: compactUtilColumn, changed: currentMetrics.utilizationPercent !== previousMetrics.utilizationPercent },
          ];

          metricDiffs.forEach(({ column, changed }) => {
            if (!changed) return;
            departmentHasChanges = true;
            compactDiffCells.push({ row: currentRow, column });
            compactCurrentDiffCells.push({ row: currentRow, column });
            compactDiffCells.push({ row: previousRow, column });
          });

          weeklyRange.forEach((weekStartDate, weekIndex) => {
            const currentCellState = resolveCompactCapacityCellState(
              currentSnapshot,
              dept,
              weekStartDate,
              compactCurrentAssignmentHoursByCell,
              compactCurrentAssignmentStageByCell
            );
            const previousCellState = resolveCompactCapacityCellState(
              previousSnapshot,
              dept,
              weekStartDate,
              compactPreviousEffectiveHoursByCell,
              compactPreviousEffectiveStageByCell,
              compactCurrentAssignmentHoursByCell,
              compactCurrentAssignmentStageByCell,
              compactChangedKeysAfterPrevious
            );
            const sameCapacity = currentCellState.displayValue === previousCellState.displayValue;
            const sameTimingActivity = currentCellState.active === previousCellState.active;
            if (sameCapacity && sameTimingActivity) return;
            departmentHasChanges = true;
            const column = compactMatrixStartColumn + weekIndex;
            compactDiffCells.push({ row: currentRow, column });
            compactCurrentDiffCells.push({ row: currentRow, column });
            compactDiffCells.push({ row: previousRow, column });
          });

          if (departmentHasChanges) {
            compactRowsWithChanges.add(currentRow);
            compactRowsWithChanges.add(previousRow);
          }
        });

        compactBlockRanges.push({
          startRow: currentBlock.startRow,
          endRow: currentBlock.endRow,
          outlineColor: '2563EB',
        });
        compactBlockRanges.push({
          startRow: previousBlock.startRow,
          endRow: previousBlock.endRow,
          outlineColor: '6B7280',
        });
        compactBlockRanges.push({
          startRow: projectStartRow,
          endRow: compactRow - 1,
          outlineColor: '4338CA',
        });

        const separator = compactSheet.getRow(compactRow);
        separator.height = 6;
        for (let column = 1; column <= compactHeaderEndColumn; column += 1) {
          separator.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
          applyBorder(separator.getCell(column));
        }
        compactRow += 1;
      });

      styleRows(compactSheet, 3);

      const setBorderEdge = (
        cell: any,
        edge: 'top' | 'right' | 'bottom' | 'left',
        color: string
      ) => {
        const thin = { style: 'thin', color: { argb: BORDER } };
        const border = cell.border || {};
        const nextBorder: any = {
          top: border.top || thin,
          right: border.right || thin,
          bottom: border.bottom || thin,
          left: border.left || thin,
        };
        nextBorder[edge] = { style: 'medium', color: { argb: color } };
        cell.border = nextBorder;
      };

      const outlineRange = (
        startRow: number,
        endRow: number,
        startColumn: number,
        endColumn: number,
        color: string
      ) => {
        for (let column = startColumn; column <= endColumn; column += 1) {
          setBorderEdge(compactSheet.getRow(startRow).getCell(column), 'top', color);
          setBorderEdge(compactSheet.getRow(endRow).getCell(column), 'bottom', color);
        }
        for (let row = startRow; row <= endRow; row += 1) {
          setBorderEdge(compactSheet.getRow(row).getCell(startColumn), 'left', color);
          setBorderEdge(compactSheet.getRow(row).getCell(endColumn), 'right', color);
        }
      };

      compactBlockRanges.forEach((range) => {
        outlineRange(range.startRow, range.endRow, 1, compactHeaderEndColumn, range.outlineColor);
      });

      compactDiffCells.forEach(({ row, column }) => {
        const cell = compactSheet.getRow(row).getCell(column);
        const fillArgb = (cell.fill as any)?.fgColor?.argb;
        if (!fillArgb || fillArgb === WHITE) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7ED' } };
          cell.font = { ...(cell.font || {}), bold: true, color: { argb: '9A3412' } };
        } else {
          // Keep stage color text so exported palette matches on-screen cells.
          cell.font = { ...(cell.font || {}), bold: true };
        }
      });

      compactCurrentDiffCells.forEach(({ row, column }) => {
        const cell = compactSheet.getRow(row).getCell(column);
        cell.font = { ...(cell.font || {}), bold: true, color: { argb: '000000' } };
        setBorderEdge(cell, 'top', '000000');
        setBorderEdge(cell, 'right', '000000');
        setBorderEdge(cell, 'bottom', '000000');
        setBorderEdge(cell, 'left', '000000');
      });

      compactRowsWithChanges.forEach((rowNumber) => {
        const changeCell = compactSheet.getRow(rowNumber).getCell(compactChangesColumn);
        changeCell.value = language === 'es' ? 'Hubo un cambio' : 'Change detected';
        changeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
        changeCell.font = { bold: true, size: 8, color: { argb: '92400E' } };
        changeCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });

      if (resolvedCurrentWeekIndex >= 0 && resolvedCurrentWeekIndex < weeklyRange.length) {
        applyVerticalWeekMarker(
          compactSheet,
          compactMatrixStartColumn + resolvedCurrentWeekIndex,
          1,
          Math.max(compactRow - 1, 2)
        );
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName = language === 'es'
        ? `timing-semanal-${startDate}-a-${endDate}-${dateStamp}.xlsx`
        : `weekly-timing-${startDate}-to-${endDate}-${dateStamp}.xlsx`;
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
      console.error('[CapacityMatrix] Error exporting timing changes Excel:', error);
      alert(language === 'es'
        ? 'Ocurrio un error al exportar los cambios de timing.'
        : 'An error occurred while exporting timing changes.');
    } finally {
      setIsTimingRangeExcelExporting(false);
    }
  };

  const getDepartmentTotalCapacityForWeek = (department: Department, weekDate: string): number => {
    const baseCapacity = scioTeamMembers[department]?.[weekDate] || 0;
    const ptoAdjustment = scioPto[department]?.[weekDate] || 0;
    const trainingAdjustment = scioTraining[department]?.[weekDate] || 0;
    // Intentionally not clamped to 0: PTO/Training recorded beyond the SCIO Team
    // Members headcount for the week is a real over-commitment and must surface
    // as negative capacity rather than being silently absorbed.
    const effectiveScioCapacity = baseCapacity - ptoAdjustment - trainingAdjustment;

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

    if (EXTERNAL_TEAM_DEPARTMENTS.includes(department)) {
      const externalTeamCapacity = getExternalTeamsFor(department).reduce((sum, team) => {
        const teamKey = externalTeamKey(department, team);
        return sum + (prgExternalPersonnel[teamKey]?.[weekDate] || 0);
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

      const applyVerticalWeekMarker = (
        sheet: any,
        columnNumber: number,
        startRow: number,
        endRow: number
      ) => {
        if (!columnNumber || columnNumber < 1 || endRow < startRow) return;

        for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
          const cell = sheet.getRow(rowNumber).getCell(columnNumber);
          const border = cell.border || {};
          const thin = { style: 'thin', color: { argb: BORDER_LIGHT } };
          cell.border = {
            top: border.top || thin,
            bottom: border.bottom || thin,
            left: { style: 'medium', color: { argb: 'F87171' } },
            right: { style: 'medium', color: { argb: 'F87171' } },
          };
        }
      };

      const getUtilizationFill = (percent: number, totalCapacity: number): { bg: string; fg: string } => {
        if (totalCapacity < 0) return { bg: 'B91C1C', fg: WHITE }; // negative base capacity: critical
        if (totalCapacity === 0) return { bg: 'E5E7EB', fg: '374151' };
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
          const availableValue = totalCapacity - occupiedValue;
          const utilizationPercent = totalCapacity > 0
            ? (occupiedValue / totalCapacity) * 100
            : (occupiedValue > 0 ? 100 : 0);
          const palette = getUtilizationFill(utilizationPercent, totalCapacity);

          const availableCell = capacitySheet.getCell(capRow, weekColStart + index);
          availableCell.value = roundValue(availableValue);
          setBodyCell(availableCell, palette.bg, palette.fg);
        });

        capRow += 1;
      });

      if (currentDateWeekIndex >= 0) {
        applyVerticalWeekMarker(capacitySheet, weekColStart + currentDateWeekIndex, 1, capRow - 1);
      }

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
          const availableValue = totalCapacity - occupiedValue;
          const utilizationPercent = totalCapacity > 0
            ? (occupiedValue / totalCapacity) * 100
            : (occupiedValue > 0 ? 100 : 0);
          const palette = getUtilizationFill(utilizationPercent, totalCapacity);

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

      if (currentDateWeekIndex >= 0) {
        applyVerticalWeekMarker(projectsSheet, 6 + currentDateWeekIndex, 1, projRow - 1);
      }

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
          const availableValue = totalCapacity - occupiedValue;
          const utilizationPercent = totalCapacity > 0
            ? (occupiedValue / totalCapacity) * 100
            : (occupiedValue > 0 ? 100 : 0);
          const palette = getUtilizationFill(utilizationPercent, totalCapacity);

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

        if (currentDateWeekIndex >= 0) {
          applyVerticalWeekMarker(deptSheet, deptWeekStart + currentDateWeekIndex, 1, Math.max(projectRow - 1, 14));
        }
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
        // Each project is one <tbody> in the shared unified table now (see "Unified capacity
        // grid"), not its own standalone <table> -- so capturing it faithfully (with its
        // column headers) means assembling a throwaway table from the live, shared <thead>
        // plus this one project's <tbody>, off-screen, then discarding it after capture.
        const projectTbody = projectTableRefs.current.get(project.id);
        if (!projectTbody) continue;
        const sourceTable = projectTbody.closest('table');
        const sourceThead = sourceTable?.querySelector('thead');
        if (!sourceTable || !sourceThead) continue;

        const captureTable = document.createElement('table');
        captureTable.className = sourceTable.className;
        captureTable.style.position = 'fixed';
        captureTable.style.top = '-100000px';
        captureTable.style.left = '-100000px';
        captureTable.appendChild(sourceThead.cloneNode(true));
        captureTable.appendChild(projectTbody.cloneNode(true));
        document.body.appendChild(captureTable);

        const captureWidth = Math.max(1, Math.ceil(captureTable.scrollWidth));
        const captureHeight = Math.max(1, Math.ceil(captureTable.scrollHeight));

        const canvas = await html2canvas(captureTable, {
          backgroundColor: '#ffffff',
          useCORS: true,
          scale: 2,
          logging: false,
          width: captureWidth,
          height: captureHeight,
          windowWidth: captureWidth,
          windowHeight: captureHeight,
          scrollX: 0,
          scrollY: 0,
        });

        document.body.removeChild(captureTable);

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
    // Locked (past) weeks still open the modal -- hours are read-only there
    // (from Finance actuals), but the stage label can still be relabeled.

    const { totalHours, assignments: deptAssignments, stage: cellStage, comment: cellComment } = getDepartmentWeekData(department, weekStart, projectId);
    const initialStage = cellStage ?? deptAssignments.find((assignment) => assignment.stage)?.stage ?? null;
    const initialComment = (cellComment ?? deptAssignments.find(
      (assignment) => typeof assignment.comment === 'string' && assignment.comment.trim().length > 0
    )?.comment) || '';
    // Note: no `emp.department === department` check here — deptAssignments is already
    // scoped to this row's EFFECTIVE department (see getAssignmentDepartment), so an
    // employee supporting this department from elsewhere is legitimately selectable too.
    const isSelectableModalEmployee = (emp?: Employee | null): emp is Employee =>
      !!emp &&
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

    // Stage entries: HD/MED/BUILD/PRG all have Stage options (PM/PURCHASING/MFG don't -- see
    // STAGE_OPTIONS -- so there's no "stage" concept to group by for them). BUILD/PRG entries
    // additionally carry their own SCIO/External split per stage, grouped from the assignments'
    // scioHours/externalHours fields; HD/MED entries just use plain hours.
    const canUseStagePlanner = STAGE_OPTIONS[department].length > 0;
    const isBuildOrPRGDept = department === 'BUILD' || department === 'PRG';
    let initialStageEntries: StageHoursEntry[] = [];
    const initialStageResourceHours: Record<string, StageResourceHoursEntry> = {};

    if (canUseStagePlanner) {
      const stageTotals = new Map<Exclude<Stage, null> | '', number>();
      const stageScioTotals = new Map<Exclude<Stage, null> | '', number>();
      const stageExternalTotals = new Map<Exclude<Stage, null> | '', number>();
      const stageAssignmentIds = new Map<Exclude<Stage, null> | '', string[]>();
      deptAssignments.forEach((assignment) => {
        const stageKey = (assignment.stage as Exclude<Stage, null> | null) || '';
        const assignmentHours = typeof assignment.totalHours === 'number' ? assignment.totalHours : (assignment.hours || 0);
        stageTotals.set(stageKey, roundHours((stageTotals.get(stageKey) || 0) + assignmentHours));
        if (isBuildOrPRGDept) {
          stageScioTotals.set(stageKey, roundHours((stageScioTotals.get(stageKey) || 0) + (assignment.scioHours || 0)));
          stageExternalTotals.set(stageKey, roundHours((stageExternalTotals.get(stageKey) || 0) + (assignment.externalHours || 0)));
        }
        stageAssignmentIds.set(stageKey, [...(stageAssignmentIds.get(stageKey) || []), assignment.id]);
      });

      if (stageTotals.size > 0) {
        initialStageEntries = Array.from(stageTotals.entries()).map(([stageKey, hoursValue]) => {
          let scioVal = 0;
          let extVal = 0;
          if (isBuildOrPRGDept) {
            const summedScio = stageScioTotals.get(stageKey) || 0;
            const summedExternal = stageExternalTotals.get(stageKey) || 0;
            if (summedScio + summedExternal > 0) {
              scioVal = summedScio;
              extVal = summedExternal;
            } else {
              // Legacy data (before split fields existed): treat all stored hours as SCIO.
              scioVal = hoursValue;
            }
          }
          return createStageHoursEntry(stageKey, hoursValue, stageAssignmentIds.get(stageKey), scioVal, extVal);
        });
      } else if (totalHours > 0) {
        initialStageEntries = [
          createStageHoursEntry(
            (initialStage as Exclude<Stage, null> | '') || '',
            roundHours(totalHours),
            undefined,
            isBuildOrPRGDept ? roundHours(totalHours) : 0,
            0
          ),
        ];
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
    setEditingHoursInput(totalHours ? totalHours.toString() : '');
    setEditingStage(initialStage);
    setEditingStageEntries(initialStageEntries);
    setEditingStageResourceHours(initialStageResourceHours);
    setEditingComment(initialComment);
    setSelectedEmployees(assignedEmployeeIds);
    setSupportEmployeeToAdd('');
    setShowDeleteConfirm(false);
    // Week-split always starts fresh at 1 week when a cell is (re)opened: it's a "going
    // forward from here" action, not a saved attribute of existing assignments. Each stage
    // entry built above already got weekCount: 1 from createStageHoursEntry.
    setEditingWeekCount(1);
    setEditingWeeklyEven(true);
    setEditingWeeklyHoursInputs([]);
  };

  const handleSaveCell = async () => {
    if (!editingCell) return;
    if (!canEditDepartment(editingCell.department)) {
      alert(t.readOnlyView || 'Read-only view');
      return;
    }

    // Locked (past) week: hours come from Finance and are frozen (UI disables
    // those inputs above), so skip the normal create/reset-to-zero flow
    // entirely -- it would touch hours by design. Just relabel the `stage` in
    // place on the existing assignment row(s) captured when the modal opened.
    // (The week-split feature is forward-only and its controls are disabled
    // whenever the cell's own week is locked, so this never needs to loop.)
    if (isWeekLocked(editingCell.weekStart)) {
      // Stage entries now cover HD/MED/BUILD/PRG alike (PM/PURCHASING/MFG have no stage
      // concept, so editingStageEntries stays empty for them and this is a no-op, same as
      // before), so the old BUILD/PRG-specific single-stage relabel branch is gone.
      await Promise.all(
        editingStageEntries.flatMap((entry) =>
          (entry.assignmentIds || []).map((assignmentId) =>
            updateAssignment(assignmentId, { stage: entry.stage || null, comment: editingComment || undefined }, { skipRefetch: true })
          )
        )
      );
      closeEditModal();
      void fetchAssignments(true);
      return;
    }

    const isBuildOrPRG = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    const hasStagePlanner = STAGE_OPTIONS[editingCell.department].length > 0;
    // When a selected employee's home department differs from this cell's row, mark the
    // assignment as a cross-department support: hours still count toward THIS row/department.
    const departmentOverrideFor = (employeeId: string): Department | undefined => {
      const emp = employeeById.get(employeeId);
      return emp && emp.department !== editingCell.department ? editingCell.department : undefined;
    };
    // Company-placeholder employees (name === subcontractCompany, capacity 0) are no longer
    // excluded here: they're a legitimate, explicitly-selectable Available Resources entry
    // now (the external provider itself), and excluding them here would silently drop the
    // selection on save even though the checkbox showed it as selected.
    const targetEmployeeIds = Array.from(selectedEmployees).filter((employeeId) => {
      const emp = employeeById.get(employeeId);
      return !!emp &&
        emp.isActive &&
        !isPlaceholderEmployee(emp);
    });

    // Lock: hours always have to belong to an explicitly selected resource (internal or
    // external) now -- no more silently falling back to an auto-created "DEPT Placeholder"
    // employee when nobody's picked. The Save button mirrors this (disabled while nothing's
    // selected); this is the actual enforcement in case Save is still reached some other way
    // (e.g. pressing Enter in an hours field).
    if (targetEmployeeIds.length === 0) {
      alert(language === 'es'
        ? 'Selecciona al menos un recurso (interno o externo) antes de guardar.'
        : 'Select at least one resource (internal or external) before saving.');
      return;
    }

    // Mirrors the identically-named computation in renderEditModal (used there to decide what
    // columns to draw in the SCIO/External grids) -- recomputed here since handleSaveCell and
    // renderEditModal are separate closures, but must agree on who's "internal" vs "external"
    // for buildWeekPlans's per-employee split to land on the same people the grid showed.
    const internalSelectedColumns = targetEmployeeIds
      .map((id) => employeeById.get(id))
      .filter((emp): emp is Employee => !!emp && !(emp.isSubcontractedMaterial && emp.subcontractCompany))
      .map((emp) => ({ id: emp.id, label: emp.name }));
    const externalSelectedColumns = targetEmployeeIds
      .map((id) => employeeById.get(id))
      .filter((emp): emp is Employee => !!emp && !!(emp.isSubcontractedMaterial && emp.subcontractCompany))
      .map((emp) => ({ id: emp.id, label: emp.name }));
    // Classifies a stage entry's per-employee hours as SCIO vs External on save -- determined
    // by whether the employee is an internal staffer or an external/subcontracted provider,
    // same as the non-stage-planner BUILD/PRG path always did.
    const externalEmployeeIdSet = new Set(externalSelectedColumns.map((c) => c.id));

    // Saves ONE week's worth of hours using exactly the original (pre-week-split) single-week
    // logic, just parameterized by which week and which hour totals apply to it. The week-split
    // feature ("divide this activity across N weeks") works by calling this once per week with
    // that week's share of the hours instead of rewriting this logic to be week-aware itself --
    // see buildWeekPlans below for how each week's shares are computed.
    const saveCellForWeek = async (
      weekStartDate: string,
      hoursForWeek: number,
      stageEntriesForWeek: StageHoursEntry[],
      stageResourceHoursForWeek: Record<string, StageResourceHoursEntry>
    ) => {
      if (!editingCell) return;

      const stagePlanByEmployee = new Map<string, { stage: Stage; hours: number }[]>();
      if (hasStagePlanner) {
        const employeeStageMap = new Map<string, Map<Exclude<Stage, null> | '', number>>();
        targetEmployeeIds.forEach((employeeId) => employeeStageMap.set(employeeId, new Map()));

        stageEntriesForWeek.forEach((entry) => {
          const stageKey = (entry.stage || '') as Exclude<Stage, null> | '';
          targetEmployeeIds.forEach((employeeId) => {
            const hoursKey = createStageResourceKey(entry.id, employeeId);
            const specificHours = roundHours(Math.max(0, stageResourceHoursForWeek[hoursKey]?.hours || 0));
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
        ? roundHours(
            Array.from(stagePlanByEmployee.values()).reduce(
              (sum, plan) => sum + plan.reduce((entrySum, entry) => entrySum + entry.hours, 0),
              0
            )
          )
        : roundHours(hoursForWeek);

      // Nothing entered for this week: leave whatever was already saved there untouched
      // (matches the original single-week behavior -- saving a blank cell doesn't reset it).
      if (totalHours === 0) return;

      const { assignments: deptAssignments } = getDepartmentWeekData(
        editingCell.department,
        weekStartDate,
        editingCell.projectId
      );

      const resetAssignmentsToZero = async (assignmentsToReset: Assignment[]) => {
        if (assignmentsToReset.length === 0) return;
        const resetPayload: any = {
          hours: 0,
          stage: null,
          comment: '',
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
          };

          if (isBuildOrPRG) {
            // Classified by whether this employee is an internal staffer or an external/
            // subcontracted provider -- not a user choice, the SCIO/External split just
            // follows from who the hours belong to.
            const isExternalEmployee = externalEmployeeIdSet.has(employeeId);
            payload.scioHours = isExternalEmployee ? 0 : desiredHours;
            payload.externalHours = isExternalEmployee ? desiredHours : 0;
          }

          if (existingAssign) {
            await updateAssignment(existingAssign.id, payload, { skipRefetch: true });
          } else if (editingCell.projectId) {
            await addAssignment({
              employeeId,
              projectId: editingCell.projectId,
              weekStartDate,
              departmentOverride: departmentOverrideFor(employeeId),
              ...payload,
            } as any);
          }
        }

        existingByStage.forEach((remaining) => {
          remaining.forEach((assignment) => assignmentsToResetCollector.push(assignment));
        });
      };

      // targetEmployeeIds is never empty here -- handleSaveCell blocks the save entirely before
      // reaching buildWeekPlans/saveCellForWeek when nothing's selected (see the lock above), so
      // the auto-created "DEPT Placeholder" fallback that used to live here for that case is
      // gone; every save now always belongs to an explicitly selected resource.
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
        // Only reached by departments with no Stage planner at all (PM/PURCHASING/MFG --
        // isBuildOrPRG is always caught by the hasStagePlanner branch above now), which still
        // divide their single Hours total evenly across whoever's selected, unchanged.
        const upsertPromises = targetEmployeeIds.map(async (employeeId) => {
          const existingAssign = deptAssignments.find((assignment) => assignment.employeeId === employeeId);
          const hoursPerEmployee = roundHours(totalHours / targetEmployeeIds.length);

          const updateData: any = {
            hours: hoursPerEmployee,
            stage: editingStage,
            comment: editingComment || undefined,
          };

          if (existingAssign) {
            await updateAssignment(existingAssign.id, updateData, { skipRefetch: true });
          } else if (editingCell.projectId) {
            await addAssignment({
              employeeId,
              projectId: editingCell.projectId,
              weekStartDate,
              departmentOverride: departmentOverrideFor(employeeId),
              ...updateData,
            } as any);
          }
        });
        await Promise.all(upsertPromises);

        const assignmentsToDelete = deptAssignments.filter((assignment) => !targetEmployeeIds.includes(assignment.employeeId));
        await resetAssignmentsToZero(assignmentsToDelete);
      }
    };

    // Resolves the "divide across N weeks" settings (per-Stage-entry for departments with a
    // Stage planner -- HD/MED/BUILD/PRG -- cell-level for the generic Hours case) into one plan
    // per week: which date, and which stage entries/resource hours apply there. weekCount 1
    // everywhere (the default) always yields exactly the original single-week plan.
    const buildWeekPlans = (): Array<{
      weekStartDate: string;
      hours: number;
      stageEntries: StageHoursEntry[];
      stageResourceHours: Record<string, StageResourceHoursEntry>;
    }> => {
      if (!editingCell) return [];

      if (hasStagePlanner) {
        const internalIds = internalSelectedColumns.map((c) => c.id);
        const externalIds = externalSelectedColumns.map((c) => c.id);
        // Match WeekSplitEditor's own threshold exactly (see its `activeColumns`): below 2
        // people, the UI rendered its plain single-list view and stored everything under
        // SOLO_COLUMN there, so the lookup here has to agree with where the data actually is.
        const scioColumnIds = internalIds.length >= 2 ? internalIds : [];
        const externalColumnIds = externalIds.length >= 2 ? externalIds : [];

        const poolWeekTotal = (matrix: Record<string, number>, columnIds: string[], w: number): number =>
          columnIds.length >= 2
            ? roundHours(columnIds.reduce((sum, id) => sum + (matrix[`${id}::${w}`] || 0), 0))
            : roundHours(matrix[`${SOLO_COLUMN}::${w}`] || 0);

        const poolPerEmployee = (matrix: Record<string, number>, ids: string[], w: number): Record<string, number> => {
          const result: Record<string, number> = {};
          if (ids.length >= 2) {
            ids.forEach((id) => { result[id] = roundHours(matrix[`${id}::${w}`] || 0); });
          } else if (ids.length === 1) {
            result[ids[0]] = roundHours(matrix[`${SOLO_COLUMN}::${w}`] || 0);
          }
          return result;
        };

        // HD/MED: one combined weekly total per entry, split across employees by a fixed
        // ratio (resourceTotal / entryTotal, both typed once up front) -- unchanged.
        const entryEffectiveTotal = (entry: StageHoursEntry) =>
          targetEmployeeIds.length > 0
            ? roundHours(
                targetEmployeeIds.reduce(
                  (sum, employeeId) => sum + (editingStageResourceHours[createStageResourceKey(entry.id, employeeId)]?.hours || 0),
                  0
                )
              )
            : roundHours(entry.hours || 0);
        const perEntryWeekly = new Map<string, number[]>();
        // BUILD/PRG: two independent week x person matrices per entry (SCIO, External),
        // mirroring the old cell-level pools but scoped to this one stage entry.
        const perEntryScioMatrix = new Map<string, Record<string, number>>();
        const perEntryExternalMatrix = new Map<string, Record<string, number>>();

        editingStageEntries.forEach((entry) => {
          if (isBuildOrPRG) {
            perEntryScioMatrix.set(
              entry.id,
              computeMatrixHours(roundHours(entry.scioHours || 0), entry.weekCount, scioColumnIds, entry.scioWeeklyEven, entry.scioCellInputs || {})
            );
            perEntryExternalMatrix.set(
              entry.id,
              computeMatrixHours(roundHours(entry.externalHours || 0), entry.weekCount, externalColumnIds, entry.externalWeeklyEven, entry.externalCellInputs || {})
            );
          } else {
            perEntryWeekly.set(
              entry.id,
              computeWeeklyHours(entryEffectiveTotal(entry), entry.weekCount, entry.weeklyEven, entry.weeklyHoursInputs)
            );
          }
        });

        const weekSpan = Math.max(1, ...editingStageEntries.map((entry) => entry.weekCount));

        return Array.from({ length: weekSpan }).map((_, w) => {
          const stageEntriesForWeek: StageHoursEntry[] = [];
          const stageResourceHoursForWeek: Record<string, StageResourceHoursEntry> = {};

          editingStageEntries.forEach((entry) => {
            if (w >= entry.weekCount) return;

            if (isBuildOrPRG) {
              const scioMatrix = perEntryScioMatrix.get(entry.id) || {};
              const externalMatrix = perEntryExternalMatrix.get(entry.id) || {};
              const scioWeekTotal = poolWeekTotal(scioMatrix, scioColumnIds, w);
              const externalWeekTotal = poolWeekTotal(externalMatrix, externalColumnIds, w);
              stageEntriesForWeek.push({ ...entry, hours: roundHours(scioWeekTotal + externalWeekTotal) });

              const scioPerEmployee = poolPerEmployee(scioMatrix, internalIds, w);
              const externalPerEmployee = poolPerEmployee(externalMatrix, externalIds, w);
              [...internalIds, ...externalIds].forEach((employeeId) => {
                const hoursForEmployee = roundHours((scioPerEmployee[employeeId] || 0) + (externalPerEmployee[employeeId] || 0));
                if (hoursForEmployee > 0) {
                  stageResourceHoursForWeek[createStageResourceKey(entry.id, employeeId)] = {
                    hours: hoursForEmployee,
                    hoursInput: `${hoursForEmployee}`,
                  };
                }
              });
            } else {
              const weekHours = roundHours((perEntryWeekly.get(entry.id) || [])[w] || 0);
              stageEntriesForWeek.push({ ...entry, hours: weekHours });

              const entryTotal = entryEffectiveTotal(entry);
              targetEmployeeIds.forEach((employeeId) => {
                const key = createStageResourceKey(entry.id, employeeId);
                const resourceTotal = editingStageResourceHours[key]?.hours || 0;
                const ratio = entryTotal > 0 ? resourceTotal / entryTotal : 0;
                const scaled = roundHours(ratio * weekHours);
                if (scaled > 0) {
                  stageResourceHoursForWeek[key] = { hours: scaled, hoursInput: `${scaled}` };
                }
              });
            }
          });

          return {
            weekStartDate: addWeeksToISO(editingCell.weekStart, w),
            hours: roundHours(stageEntriesForWeek.reduce((sum, e) => sum + (e.hours || 0), 0)),
            stageEntries: stageEntriesForWeek,
            stageResourceHours: stageResourceHoursForWeek,
          };
        });
      }

      const weeklyHours = computeWeeklyHours(roundHours(editingHours), editingWeekCount, editingWeeklyEven, editingWeeklyHoursInputs);
      return weeklyHours.map((weekHours, w) => ({
        weekStartDate: addWeeksToISO(editingCell.weekStart, w),
        hours: roundHours(weekHours),
        stageEntries: [],
        stageResourceHours: {},
      }));
    };

    const weekPlans = buildWeekPlans();
    for (const plan of weekPlans) {
      await saveCellForWeek(plan.weekStartDate, plan.hours, plan.stageEntries, plan.stageResourceHours);
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

    // If a pasted employee's home department differs from the target row, mark it as
    // cross-department support so the hours still land on this row/department.
    const pasteDepartmentOverrideFor = (employeeId: string): Department | undefined => {
      const emp = employeeById.get(employeeId);
      return emp && emp.department !== selectedProjectCell.department
        ? selectedProjectCell.department
        : undefined;
    };

    isPastingProjectCellRef.current = true;
    try {
      const isBuildOrPRG = selectedProjectCell.department === 'BUILD' || selectedProjectCell.department === 'PRG';

      const normalizedEntries = new Map<string, ProjectCellClipboardEntry>();
      projectCellClipboard.entries.forEach((entry) => {
        const hours = roundHours(Math.max(0, entry.hours || 0));
        let scioHours = roundHours(Math.max(0, entry.scioHours || 0));
        let externalHours = roundHours(Math.max(0, entry.externalHours || 0));

        if (isBuildOrPRG && scioHours === 0 && externalHours === 0 && hours > 0) {
          scioHours = hours;
        }

        if (hours <= 0 && scioHours <= 0 && externalHours <= 0) return;

        const stageKey = entry.stage || '';
        const mapKey = `${entry.employeeId}|${stageKey}`;
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
        });
      });

      const { assignments: targetAssignments } = getDepartmentWeekData(
        selectedProjectCell.department,
        selectedProjectCell.weekStart,
        targetProjectId
      );

      const existingByKey = new Map<string, Assignment[]>();
      targetAssignments.forEach((assignment) => {
        const key = `${assignment.employeeId}|${assignment.stage || ''}`;
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
            departmentOverride: pasteDepartmentOverrideFor(entry.employeeId),
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
          nextRow = Math.min(filteredDepartmentProjects.length - 1, currentRow + 1);
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextProject = filteredDepartmentProjects[nextRow];
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
    filteredDepartmentProjects,
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
    const isNotCompanyPlaceholder = (emp: Employee) =>
      !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0);
    // Available Resources for the cell's own department intentionally DOES include the
    // company-placeholder employee (name === subcontractCompany, capacity 0): that's the
    // external provider itself, selectable as a single assignable resource representing
    // their whole (anonymous) headcount -- see handleSaveCell's targetEmployeeIds, which no
    // longer excludes it either. The cross-department "support" picker below still excludes
    // it: borrowing an external provider from another department isn't offered there.
    const nativeDeptEmployees = employees.filter(emp =>
      emp.department === editingCell.department &&
      emp.isActive
    );
    // Employees from OTHER departments already added to this cell as cross-department support.
    const supportEmployeesSelected = employees.filter(emp =>
      emp.department !== editingCell.department &&
      emp.isActive &&
      !isPlaceholderEmployee(emp) &&
      isNotCompanyPlaceholder(emp) &&
      selectedEmployees.has(emp.id)
    );
    // Candidates offered by the "add support" picker: active staff from other departments
    // not already selected here.
    const supportCandidates = employees.filter(emp =>
      emp.department !== editingCell.department &&
      emp.isActive &&
      !isPlaceholderEmployee(emp) &&
      isNotCompanyPlaceholder(emp) &&
      !selectedEmployees.has(emp.id)
    ).sort((a, b) => a.name.localeCompare(b.name));
    const deptEmployees = [...nativeDeptEmployees, ...supportEmployeesSelected];
    const isBuildOrPRGDepartment = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
    const hasStagePlanner = stageOptions.length > 0;
    const selectedEmployeeList = Array.from(selectedEmployees)
      .map((empId) => employees.find((e) => e.id === empId))
      .filter((emp): emp is Employee =>
        Boolean(
          emp &&
          emp.isActive &&
          !isPlaceholderEmployee(emp)
        )
      );
    const selectedResourcesCount = selectedEmployeeList.length;
    // BUILD/PRG's two independent per-person breakdown columns: SCIO hours split across
    // selected internal staff, External hours split across selected external providers.
    // WeekSplitEditor only switches into its week x column grid once a pool has 2+ of these.
    const internalSelectedColumns = selectedEmployeeList
      .filter((emp) => !(emp.isSubcontractedMaterial && emp.subcontractCompany))
      .map((emp) => ({ id: emp.id, label: emp.name }));
    const externalSelectedColumns = selectedEmployeeList
      .filter((emp) => !!(emp.isSubcontractedMaterial && emp.subcontractCompany))
      .map((emp) => ({ id: emp.id, label: emp.name }));
    const weekData = weekDataByDate.get(editingCell.weekStart);
    const weekNum = weekData?.weekNum || 1;
    const year = weekData?.isNextYear ? selectedYear + 1 : selectedYear;
    // Locked (past) week: hours are read-only (Finance actuals), but the stage
    // label can still be relabeled. Full-access users are exempt (see isWeekLocked).
    const isLockedWeek = isWeekLocked(editingCell.weekStart);

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
            {isLockedWeek && (
              <div className="mb-3.5 md:mb-4 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-2">
                {language === 'es'
                  ? 'Semana bloqueada: las horas vienen del reporte de Finanzas y no se pueden modificar aquí. Puedes actualizar la etapa.'
                  : 'Locked week: hours come from the Finance report and can\'t be changed here. You can still update the stage.'}
              </div>
            )}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5 md:gap-4 items-start">
          {/* Hours and Stage block */}
          {hasStagePlanner ? (
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
                    disabled={isLockedWeek}
                    className="text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 border border-blue-200 rounded-md px-2.5 py-1 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    + {t.add || 'Add'}
                  </button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 rounded-lg border border-gray-200 bg-white p-2">
                  {editingStageEntries.length === 0 && (
                    <div className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2 bg-gray-50">
                      {t.noStage}
                    </div>
                  )}
                  {editingStageEntries.map((entry) => {
                    // BUILD/PRG: each stage entry gets its own independent SCIO/External pools
                    // (own totals, own week-split, own per-person columns) instead of the plain
                    // single hours field HD/MED use below.
                    if (isBuildOrPRGDepartment) {
                      return (
                        <div key={entry.id} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-2">
                          <div className="grid grid-cols-[1fr_36px] gap-2 items-center">
                            <select
                              value={entry.stage}
                              onChange={(e) => {
                                const value = e.target.value as Exclude<Stage, null> | '';
                                setEditingStageEntries((prev) => prev.map((row) => (
                                  row.id === entry.id ? { ...row, stage: value } : row
                                )));
                              }}
                              className="border border-gray-300 bg-white rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="">{t.noStage}</option>
                              {stageOptions.map((stage) => (
                                <option key={stage} value={stage}>
                                  {getStageLabel(stage, t as Record<string, string>)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setEditingStageEntries((prev) => prev.filter((row) => row.id !== entry.id))}
                              disabled={isLockedWeek}
                              className="text-red-600 hover:text-red-700 bg-red-50 border border-red-200 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                              title={t.delete}
                            >
                              <X size={14} className="mx-auto" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">{t.scioHours}</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={entry.scioHoursInput}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const normalized = raw.replace(',', '.');
                                  if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                    const num = normalized === '' ? 0 : Math.max(0, parseFloat(normalized) || 0);
                                    setEditingStageEntries((prev) => prev.map((row) => (
                                      row.id === entry.id
                                        ? { ...row, scioHours: num, scioHoursInput: raw, hours: roundHours(num + (row.externalHours || 0)) }
                                        : row
                                    )));
                                  }
                                }}
                                disabled={isLockedWeek}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">{t.enterExternalHours}</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={entry.externalHoursInput}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const normalized = raw.replace(',', '.');
                                  if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                    const num = normalized === '' ? 0 : Math.max(0, parseFloat(normalized) || 0);
                                    setEditingStageEntries((prev) => prev.map((row) => (
                                      row.id === entry.id
                                        ? { ...row, externalHours: num, externalHoursInput: raw, hours: roundHours((row.scioHours || 0) + num) }
                                        : row
                                    )));
                                  }
                                }}
                                disabled={isLockedWeek}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                                placeholder="0"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <label className="text-xs font-medium text-gray-700 whitespace-nowrap">
                              {language === 'es' ? 'Dividir en semanas' : 'Split across weeks'}
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={entry.weekCountInput}
                              disabled={isLockedWeek}
                              onFocus={(e) => e.currentTarget.select()}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === '' || /^\d{0,3}$/.test(raw)) {
                                  setEditingStageEntries((prev) => prev.map((row) => {
                                    if (row.id !== entry.id) return row;
                                    let weekCount = row.weekCount;
                                    if (raw !== '') {
                                      const parsed = parseInt(raw, 10);
                                      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 52) {
                                        weekCount = parsed;
                                      }
                                    }
                                    return { ...row, weekCountInput: raw, weekCount };
                                  }));
                                }
                              }}
                              onBlur={(e) => {
                                const parsed = parseInt(e.target.value, 10);
                                const safe = Number.isFinite(parsed) ? Math.max(1, Math.min(52, parsed)) : 1;
                                setEditingStageEntries((prev) => prev.map((row) => (
                                  row.id === entry.id ? { ...row, weekCountInput: String(safe), weekCount: safe } : row
                                )));
                              }}
                              className="w-16 border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                            />
                          </div>

                          {/* SCIO pool: one column per selected internal person once there are 2+. */}
                          <WeekSplitEditor
                            weekStartDate={editingCell.weekStart}
                            totalHours={roundHours(entry.scioHours || 0)}
                            weekCount={entry.weekCount}
                            onWeekCountChange={(count) => setEditingStageEntries((prev) => prev.map((row) => (
                              row.id === entry.id ? { ...row, weekCount: count, weekCountInput: String(count) } : row
                            )))}
                            hideWeekCountInput
                            isEven={entry.scioWeeklyEven}
                            onIsEvenChange={(even) => setEditingStageEntries((prev) => prev.map((row) => {
                              if (row.id !== entry.id) return row;
                              if (!even) {
                                const colIds = internalSelectedColumns.map((c) => c.id);
                                const evenMatrix = computeMatrixHours(roundHours(row.scioHours || 0), row.weekCount, colIds, true, {});
                                const primed: Record<string, string> = {};
                                Object.entries(evenMatrix).forEach(([key, value]) => { primed[key] = `${Math.round(value * 100) / 100}`; });
                                return { ...row, scioWeeklyEven: even, scioCellInputs: primed };
                              }
                              return { ...row, scioWeeklyEven: even };
                            }))}
                            weeklyInputs={deriveSoloWeeklyInputs(entry.scioCellInputs, entry.weekCount)}
                            onWeeklyInputChange={(index, value) => setEditingStageEntries((prev) => prev.map((row) => (
                              row.id === entry.id ? { ...row, scioCellInputs: { ...row.scioCellInputs, [`${SOLO_COLUMN}::${index}`]: value } } : row
                            )))}
                            columns={internalSelectedColumns}
                            cellInputs={entry.scioCellInputs}
                            onCellInputChange={(columnId, weekIndex, value) => setEditingStageEntries((prev) => prev.map((row) => (
                              row.id === entry.id ? { ...row, scioCellInputs: { ...row.scioCellInputs, [`${columnId}::${weekIndex}`]: value } } : row
                            )))}
                            language={language}
                            disabled={isLockedWeek}
                          />

                          {/* External pool: one column per selected external provider once there are 2+. */}
                          <WeekSplitEditor
                            weekStartDate={editingCell.weekStart}
                            totalHours={roundHours(entry.externalHours || 0)}
                            weekCount={entry.weekCount}
                            onWeekCountChange={(count) => setEditingStageEntries((prev) => prev.map((row) => (
                              row.id === entry.id ? { ...row, weekCount: count, weekCountInput: String(count) } : row
                            )))}
                            hideWeekCountInput
                            isEven={entry.externalWeeklyEven}
                            onIsEvenChange={(even) => setEditingStageEntries((prev) => prev.map((row) => {
                              if (row.id !== entry.id) return row;
                              if (!even) {
                                const colIds = externalSelectedColumns.map((c) => c.id);
                                const evenMatrix = computeMatrixHours(roundHours(row.externalHours || 0), row.weekCount, colIds, true, {});
                                const primed: Record<string, string> = {};
                                Object.entries(evenMatrix).forEach(([key, value]) => { primed[key] = `${Math.round(value * 100) / 100}`; });
                                return { ...row, externalWeeklyEven: even, externalCellInputs: primed };
                              }
                              return { ...row, externalWeeklyEven: even };
                            }))}
                            weeklyInputs={deriveSoloWeeklyInputs(entry.externalCellInputs, entry.weekCount)}
                            onWeeklyInputChange={(index, value) => setEditingStageEntries((prev) => prev.map((row) => (
                              row.id === entry.id ? { ...row, externalCellInputs: { ...row.externalCellInputs, [`${SOLO_COLUMN}::${index}`]: value } } : row
                            )))}
                            columns={externalSelectedColumns}
                            cellInputs={entry.externalCellInputs}
                            onCellInputChange={(columnId, weekIndex, value) => setEditingStageEntries((prev) => prev.map((row) => (
                              row.id === entry.id ? { ...row, externalCellInputs: { ...row.externalCellInputs, [`${columnId}::${weekIndex}`]: value } } : row
                            )))}
                            language={language}
                            disabled={isLockedWeek}
                          />
                        </div>
                      );
                    }

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
                            className="border border-gray-300 bg-white rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                              if (selectedResourcesCount > 0 || isLockedWeek) return;
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
                            readOnly={selectedResourcesCount > 0 || isLockedWeek}
                            disabled={selectedResourcesCount > 0 || isLockedWeek}
                            className="border border-gray-300 bg-white rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-700 disabled:font-semibold"
                            placeholder="0"
                          />
                          <button
                            type="button"
                            onClick={() => setEditingStageEntries((prev) => prev.filter((row) => row.id !== entry.id))}
                            disabled={isLockedWeek}
                            className="text-red-600 hover:text-red-700 bg-red-50 border border-red-200 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                            title={t.delete}
                          >
                            <X size={14} className="mx-auto" />
                          </button>
                        </div>

                        <div className="ml-1 pl-2 border-l-2 border-gray-200">
                          <WeekSplitEditor
                            weekStartDate={editingCell.weekStart}
                            totalHours={stageRowTotal}
                            weekCount={entry.weekCount}
                            onWeekCountChange={(count) => setEditingStageEntries((prev) => prev.map((row) => (
                              row.id === entry.id ? { ...row, weekCount: count } : row
                            )))}
                            isEven={entry.weeklyEven}
                            onIsEvenChange={(even) => setEditingStageEntries((prev) => prev.map((row) => {
                              if (row.id !== entry.id) return row;
                              if (!even) {
                                const primed = computeWeeklyHours(stageRowTotal, row.weekCount, true, []);
                                return {
                                  ...row,
                                  weeklyEven: even,
                                  weeklyHoursInputs: primed.map((v) => `${Math.round(v * 100) / 100}`),
                                };
                              }
                              return { ...row, weeklyEven: even };
                            }))}
                            weeklyInputs={entry.weeklyHoursInputs}
                            onWeeklyInputChange={(index, value) => setEditingStageEntries((prev) => prev.map((row) => {
                              if (row.id !== entry.id) return row;
                              const next = [...row.weeklyHoursInputs];
                              next[index] = value;
                              return { ...row, weeklyHoursInputs: next };
                            }))}
                            language={language}
                            disabled={isLockedWeek}
                          />
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
                                      if (isLockedWeek) return;
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
                                    readOnly={isLockedWeek}
                                    disabled={isLockedWeek}
                                    className="border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-700"
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
                disabled={isLockedWeek}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-500"
                placeholder="0"
              />

              <div className="mt-3">
                <WeekSplitEditor
                  weekStartDate={editingCell.weekStart}
                  totalHours={roundHours(editingHours)}
                  weekCount={editingWeekCount}
                  onWeekCountChange={setEditingWeekCount}
                  isEven={editingWeeklyEven}
                  onIsEvenChange={(even) => {
                    if (!even) {
                      const primed = computeWeeklyHours(roundHours(editingHours), editingWeekCount, true, []);
                      setEditingWeeklyHoursInputs(primed.map((v) => `${Math.round(v * 100) / 100}`));
                    }
                    setEditingWeeklyEven(even);
                  }}
                  weeklyInputs={editingWeeklyHoursInputs}
                  onWeeklyInputChange={(index, value) => {
                    setEditingWeeklyHoursInputs((prev) => {
                      const next = [...prev];
                      next[index] = value;
                      return next;
                    });
                  }}
                  language={language}
                  disabled={isLockedWeek}
                />
              </div>
            </div>
          )}

          {/* Employee selection - Hide for MFG department */}
          {deptEmployees.length > 0 && editingCell.department !== 'MFG' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t.availableResources} ({deptEmployees.length})</label>
              <div className="space-y-1.5 min-h-[120px] max-h-[34vh] overflow-y-auto bg-white p-1.5 rounded-lg border border-gray-200">
                {deptEmployees.map((emp) => {
                  const isExternal = !!(emp.isSubcontractedMaterial && emp.subcontractCompany);
                  const isSelected = selectedEmployees.has(emp.id);
                  return (
                    <label key={emp.id} className={`block cursor-pointer p-1.5 rounded-md transition border ${isExternal ? 'hover:bg-violet-50 bg-violet-50/50 border-violet-100' : 'hover:bg-blue-50 border-transparent hover:border-blue-100'}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isLockedWeek}
                          onChange={(e) => {
                            if (isLockedWeek) return;
                            const newSelected = new Set(selectedEmployees);
                            if (e.target.checked) {
                              newSelected.add(emp.id);
                            } else {
                              newSelected.delete(emp.id);
                            }
                            setSelectedEmployees(newSelected);
                          }}
                          className="w-4 h-4 text-blue-500 rounded cursor-pointer"
                        />
                        <span className="text-sm text-gray-700 truncate font-medium">{emp.name}</span>
                        {/* Badge showing this person is supporting from another department */}
                        {emp.department !== editingCell.department && (
                          <span
                            className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded whitespace-nowrap"
                            title={language === 'es' ? `Apoyo desde ${emp.department}` : `Supporting from ${emp.department}`}
                          >
                            🤝 {emp.department}
                          </span>
                        )}
                        {/* Badge showing Internal staff vs. an external provider -- Available Resources
                            only ever shows one or the other per row (never both broken down). */}
                        {isExternal ? (
                          <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                            {language === 'es' ? 'Externo' : 'External'}
                          </span>
                        ) : (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                            Interno
                          </span>
                        )}
                        {/* Internal staff show their fixed weekly capacity; an external provider's
                            headcount isn't on Employee.capacity (see +/- External Staff instead),
                            so there's no real per-resource number to show here. */}
                        {!isExternal && (
                          <span className="text-xs text-gray-500 ml-auto">45{t.hoursPerSemWeek}</span>
                        )}
                      </div>

                      {hasStagePlanner && !isBuildOrPRGDepartment && isSelected && (
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

              {/* Borrow someone from another department to support this row */}
              {supportCandidates.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <select
                    value={supportEmployeeToAdd}
                    onChange={(e) => setSupportEmployeeToAdd(e.target.value)}
                    className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">
                      {language === 'es' ? '🤝 Agregar apoyo de otro departamento...' : '🤝 Add support from another department...'}
                    </option>
                    {supportCandidates.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.department})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!supportEmployeeToAdd || isLockedWeek}
                    onClick={() => {
                      if (!supportEmployeeToAdd || isLockedWeek) return;
                      setSelectedEmployees(new Set(selectedEmployees).add(supportEmployeeToAdd));
                      setSupportEmployeeToAdd('');
                    }}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {language === 'es' ? 'Agregar' : 'Add'}
                  </button>
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
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isLockedWeek}
                title={isLockedWeek ? (language === 'es' ? 'Semana bloqueada: no se puede eliminar' : 'Locked week: cannot be deleted') : undefined}
                className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition border border-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.delete}
              </button>
              {editingCell.projectId && (
                <button
                  onClick={() => setShowMoveWeeksModal(true)}
                  disabled={isLockedWeek}
                  title={isLockedWeek
                    ? (language === 'es' ? 'Semana bloqueada: no se puede mover' : 'Locked week: cannot be moved')
                    : (language === 'es' ? 'Mover estas horas a otra(s) semana(s)' : 'Move these hours to another week')}
                  className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition border border-blue-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {language === 'es' ? 'Mover semanas' : 'Move weeks'}
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={closeEditModal}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleSaveCell}
                disabled={!isLockedWeek && selectedEmployees.size === 0}
                title={!isLockedWeek && selectedEmployees.size === 0
                  ? (language === 'es'
                    ? 'Selecciona al menos un recurso (interno o externo) antes de guardar.'
                    : 'Select at least one resource (internal or external) before saving.')
                  : undefined}
                className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {t.save}
              </button>
            </div>
          </div>
        </div>
        {showMoveWeeksModal && editingCell.projectId && (
          <MoveAssignmentWeeksModal
            department={editingCell.department}
            projectId={editingCell.projectId}
            originWeekStart={editingCell.weekStart}
            assignments={assignments}
            getAssignmentDepartment={getAssignmentDepartment}
            employeeById={employeeById}
            stageOptions={stageOptions}
            getStageLabel={getStageLabel}
            t={t as Record<string, string>}
            language={language}
            onClose={() => setShowMoveWeeksModal(false)}
            onMoved={() => {
              setShowMoveWeeksModal(false);
              closeEditModal();
            }}
            addAssignment={addAssignment}
            updateAssignment={updateAssignment}
            deleteAssignment={deleteAssignment}
            fetchAssignments={fetchAssignments}
          />
        )}
      </>
    );
  };

  const clearProjectListFilters = () => {
    setSelectedVisibleProjectId('');
    setProjectSearchTerm('');
    setIsProjectSearchOpen(false);
  };

  const projectListSummaryText = projectSearchTerm.trim().length > 0
    ? (language === 'es'
      ? `Coincidencias: ${filteredProjectSearchOptions.length}`
      : `Matches: ${filteredProjectSearchOptions.length}`)
    : (language === 'es'
      ? `Mostrando todos: ${orderedProjectsInCurrentView.length}`
      : `Showing all: ${orderedProjectsInCurrentView.length}`);

  const handleProjectSearchSelect = (project: Project) => {
    setSelectedVisibleProjectId(project.id);
    setProjectSearchTerm(formatProjectSearchLabel(project));
    setIsProjectSearchOpen(false);
  };

  const renderProjectListFilters = () => (
    <div className="relative z-10 mb-2 grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_168px_108px_120px] sm:items-end">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] font-semibold text-slate-700">
        <span>{t.filterProjects || t.selectProject}</span>
        <div ref={projectSearchContainerRef} className="relative">
          <input
            type="text"
            value={projectSearchTerm}
            placeholder={t.searchProjectPlaceholder || t.selectAProject}
            onFocus={(e) => {
              setIsProjectSearchOpen(true);
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setProjectSearchTerm(e.target.value);
              setSelectedVisibleProjectId('');
              setIsProjectSearchOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredProjectSearchOptions.length > 0) {
                  handleProjectSearchSelect(filteredProjectSearchOptions[0]);
                }
              }

              if (e.key === 'Escape') {
                setIsProjectSearchOpen(false);
              }
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />

          {isProjectSearchOpen && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-slate-300 bg-white shadow-lg">
              {filteredProjectSearchOptions.length > 0 ? (
                filteredProjectSearchOptions.map((proj) => (
                  <button
                    key={proj.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleProjectSearchSelect(proj)}
                    className={`block w-full border-b border-slate-100 px-2 py-1.5 text-left text-xs font-medium last:border-b-0 hover:bg-indigo-50 ${
                      selectedVisibleProjectId === proj.id ? 'bg-indigo-100 text-indigo-900' : 'text-slate-700'
                    }`}
                  >
                    {formatProjectSearchLabel(proj)}
                  </button>
                ))
              ) : (
                <div className="px-2 py-2 text-xs font-medium text-slate-500">
                  {t.noProjectsMatchFilter || (language === 'es' ? 'No se encontraron proyectos con ese filtro.' : 'No projects matched the current filter.')}
                </div>
              )}
            </div>
          )}
        </div>
      </label>

      <label className="inline-flex h-[28px] w-[168px] items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 whitespace-nowrap">
        <input
          type="checkbox"
          checked={showClosedProjects}
          onChange={(e) => setShowClosedProjects(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
        />
        <span>{language === 'es' ? 'Mostrar cerrados' : 'Show closed'}</span>
      </label>

      <button
        type="button"
        onClick={clearProjectListFilters}
        disabled={!hasActiveProjectListFilters}
        className="h-[28px] w-[108px] rounded-md border border-slate-300 bg-white px-3 py-1 text-[10px] font-semibold text-slate-700 whitespace-nowrap transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t.clearFilters || (language === 'es' ? 'Limpiar filtros' : 'Clear filters')}
      </button>

      <div className="h-[28px] w-[120px] pt-[6px] text-[10px] font-semibold text-slate-500 text-right whitespace-nowrap">
        {projectListSummaryText}
      </div>
    </div>
  );

  const formatTimingCompactMetric = (value: number, isPercent = false): string => {
    if (isPercent) return `${Math.round(value || 0)}%`;
    const rounded = Math.round((value || 0) * 100) / 100;
    if (Number.isInteger(rounded)) return `${rounded}`;
    return rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  };

  const getTimingCompactChangeHighlight = (
    changed: boolean,
    highlightCurrent: boolean
  ): string => {
    if (!changed) return '';
    if (highlightCurrent) return 'shadow-[inset_0_0_0_2px_#dc2626] bg-red-50';
    return 'shadow-[inset_0_0_0_2px_#f59e0b] bg-amber-50';
  };

  const getTimingCompactCurrentWeekMarkerClass = (isCurrentWeekColumn: boolean): string => {
    if (!isCurrentWeekColumn) return '';
    return 'shadow-[inset_2px_0_0_#f87171,inset_-2px_0_0_#f87171] relative z-[1]';
  };

  const getTimingCompactStickyColumnStyle = (columnIndex: number): CSSProperties => {
    const left = TIMING_COMPACT_STICKY_WIDTHS
      .slice(0, columnIndex)
      .reduce((sum, width) => sum + width, 0);

    return {
      left: `${left}px`,
      minWidth: `${TIMING_COMPACT_STICKY_WIDTHS[columnIndex]}px`,
      width: `${TIMING_COMPACT_STICKY_WIDTHS[columnIndex]}px`,
      maxWidth: `${TIMING_COMPACT_STICKY_WIDTHS[columnIndex]}px`,
    };
  };

  const getTimingCompactCellClasses = (
    cell: TimingCompactPreviewCell,
    department: Department
  ): string => {
    if (cell.hasCapacityLoad) {
      const stagePalette = getStageColor(cell.stage, department);
      return `${stagePalette.bg} ${stagePalette.text}`;
    }

    return 'bg-white text-transparent';
  };

  return (
    <div className="brand-page-shell capacity-matrix-page h-full flex flex-col">
      {/* Edit Cell Modal */}
      {renderEditModal()}
      {/* The Capacity bar used to live here as its own flex-shrink-0 section with its own
          horizontal scroll, JS-synced to every open project's table. It's now rendered as the
          sticky top rows of the single unified table below (see "Unified capacity grid"),
          which is what makes it stay visible while scrolling down through many open projects
          without any JS scroll syncing. The show/hide toggle moved to the sticky toolbar. */}

      {/* Year selector, current-week badge, and export buttons live in the sidebar now (after
          the department selector) to free up the top toolbar's horizontal space -- portaled
          into the container App.tsx renders there. That container only exists while the
          sidebar is open (same rule as the department selector right above it), so these
          render nothing while the sidebar is collapsed rather than falling back into the main
          content area with mismatched (dark sidebar) styling. */}
      {sidebarToolbarContainer && (() => {
        const sidebarToolbarContent = (
          <div className="space-y-1.5">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="w-full bg-white/10 text-white text-[9px] md:text-[11px] rounded-md px-2 py-1 border border-white/20 hover:border-[#d5d1da] transition leading-tight"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year} className="text-[#2e1a47] bg-white">{year}</option>
              ))}
            </select>

            <button
              onClick={() => setShowLegend(!showLegend)}
              className={`w-full flex items-center justify-center gap-1 px-2 py-1 text-[9px] md:text-[10px] font-semibold rounded-md transition border ${
                showLegend
                  ? 'bg-[#4f3a70] text-white border-[#6d5a94]'
                  : 'bg-white/10 hover:bg-white/15 text-white border-white/20'
              }`}
              title={t.toggleLegend}
            >
              <span className="font-bold">{showLegend ? '-' : '+'}</span>
              <span>{t.legend}</span>
            </button>

            {canManageProjectsInCurrentDepartment && (
              <button
                onClick={() => setShowQuickProjectModal(true)}
                className="w-full flex items-center justify-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/15 text-white text-[9px] md:text-[10px] font-semibold rounded-md transition border border-white/20"
                title={t.createProject || 'Create Project'}
              >
                <Plus size={10} />
                <span>{t.createProject || 'Create'}</span>
              </button>
            )}

            {currentDateWeekIndex >= 0 && (
              <div className="w-full text-center bg-gradient-to-r from-stone-600 to-zinc-700 text-white px-2 py-1 rounded-md shadow-md text-[10px] font-bold">
                W{allWeeksData[currentDateWeekIndex]?.weekNum}
              </div>
            )}

            <button
              onClick={handleExportTimelineExcel}
              disabled={isExportingExcel || projectsVisibleInCurrentView.length === 0}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[9px] md:text-[10px] font-semibold rounded-md transition"
              title={
                projectsVisibleInCurrentView.length === 0
                  ? (language === 'es' ? 'Selecciona un proyecto para exportar en Excel' : 'Select a project to export to Excel')
                  : (language === 'es' ? 'Exportar timeline en Excel' : 'Export timeline to Excel')
              }
            >
              <span>XLSX</span>
              <span>
                {isExportingExcel
                  ? (language === 'es' ? 'Exportando...' : 'Exporting...')
                  : (language === 'es' ? 'Exportar' : 'Export')}
              </span>
            </button>

            <button
              onClick={openExportPdfModal}
              disabled={projectsVisibleInCurrentView.length === 0}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 bg-[#ce0037] hover:bg-[#ba0032] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[9px] md:text-[10px] font-semibold rounded-md transition"
              title={
                projectsVisibleInCurrentView.length === 0
                  ? (language === 'es' ? 'Selecciona un proyecto para exportar en PDF' : 'Select a project to export to PDF')
                  : (language === 'es' ? 'Exportar timeline en PDF' : 'Export timeline as PDF')
              }
            >
              <span>PDF</span>
              <span>{language === 'es' ? 'Exportar' : 'Export'}</span>
            </button>
          </div>
        );
        return createPortal(sidebarToolbarContent, sidebarToolbarContainer);
      })()}

      {/* Compact icon-select year picker for the collapsed sidebar rail -- same selectedYear
          state as above, just a different (icon-only) presentation. The <select> itself is
          invisible (opacity-0) and overlaid on the calendar icon so the native dropdown still
          opens and works without showing text in this narrow rail. */}
      {sidebarToolbarCollapsedContainer && createPortal(
        <div className="relative w-9 h-9">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            title={String(selectedYear)}
            aria-label={language === 'es' ? 'Año' : 'Year'}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year} className="text-[#2e1a47] bg-white">{year}</option>
            ))}
          </select>
          <div className="absolute inset-0 pointer-events-none rounded-md border border-white/20 bg-white/10 flex items-center justify-center peer-focus:ring-2 peer-focus:ring-white/40 peer-hover:bg-white/15 transition">
            <Calendar size={14} className="text-white" />
          </div>
        </div>,
        sidebarToolbarCollapsedContainer
      )}

      {/* Sticky Header - Responsive */}
      <div className="sticky top-0 z-50 brand-page-header">
        <div className="px-1 py-1 flex flex-wrap items-center gap-1">
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

          {/* Import Existing Project Button - Available in department views, including PM */}
          {canImportProjectsInCurrentView && getAvailableProjectsForImport().length > 0 && (
            <button
              onClick={() => setShowImportProjectModal(true)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#827691] hover:bg-[#716381] text-white text-[9px] font-semibold rounded transition flex-shrink-0"
              title={t.importProject || 'Import Existing Project'}
            >
              <FolderPlus size={10} />
              <span className="hidden sm:inline">{t.importProject || 'Import'}</span>
            </button>
          )}

          {/* Single zoom control for the whole matrix (capacity bar + every project row share
              one column grid now, so they need one shared zoom level -- see `zoom`/`setZoom`). */}
          {projectsVisibleInCurrentView.length > 0 && (
            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d5d1da] bg-[#f4f1f8] flex-shrink-0">
              <span className="text-[9px] font-semibold text-[#2e1a47]">Z:</span>
              <button
                onClick={() => setZoom(Math.max(50, zoom - 10))}
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
                value={zoom}
                onChange={(e) => setZoom(parseInt(e.target.value))}
                className="w-12 cursor-pointer h-1"
              />
              <button
                onClick={() => setZoom(Math.min(200, zoom + 10))}
                className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                title="Zoom In"
              >
                <ZoomIn size={10} />
              </button>
              <span className="text-[9px] font-semibold text-[#2e1a47]">{zoom}%</span>
            </div>
          )}

          {isGeneralView && (
            <button
              onClick={() => setShowGlobalPanel((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold rounded transition flex-shrink-0 border ${
                showGlobalPanel
                  ? 'bg-green-500 hover:bg-green-600 text-white border-green-600'
                  : 'bg-[#f4f1f8] hover:bg-[#ebe6f2] text-[#2e1a47] border-[#d5d1da]'
              }`}
              title={language === 'es' ? 'Mostrar/ocultar la barra de Capacity' : 'Show/hide the Capacity bar'}
            >
              {showGlobalPanel
                ? (language === 'es' ? 'Ocultar Capacity' : 'Hide Capacity')
                : (language === 'es' ? 'Mostrar Capacity' : 'Show Capacity')}
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-x-auto overflow-y-scroll p-2">

        {/* Tabla de Departamentos - Only show for department-specific views */}
        {departmentFilter !== 'General' && (
          <div style={{ zoom: `${zoom / 100}` }}>
            {/* Department Weekly Occupancy Summary Panel: Total / SCIO Team Members / PTO /
                Training / Capacity, with editable inputs. This is the only place in the app
                that lets full-access users edit SCIO Team Members, PTO, and Training capacity
                per department/week — it was wrapped in a "hidden" div (pre-existing, not from
                this session's changes) with no equivalent replacement, making that data
                uneditable anywhere. Restored per explicit request. */}
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
                    <div className="flex items-center gap-2">
                      {dept === 'BUILD' && canEditDepartment(dept) && (
                        <button
                          onClick={() => setIsBuildModalOpen(true)}
                          className="text-[9px] md:text-[10px] font-semibold text-[#4f3a70] hover:text-[#2e1a47] border border-[#d5d1da] hover:border-[#4f3a70] rounded px-1.5 py-0.5 transition"
                          title={t.clickToAddSubcontractedTeam}
                        >
                          {language === 'es' ? '+ Externo' : '+ External'}
                        </button>
                      )}
                      {EXTERNAL_TEAM_DEPARTMENTS.includes(dept) && canEditDepartment(dept) && (
                        <button
                          onClick={() => setExternalTeamModalDept(dept)}
                          className="text-[9px] md:text-[10px] font-semibold text-[#4f3a70] hover:text-[#2e1a47] border border-[#d5d1da] hover:border-[#4f3a70] rounded px-1.5 py-0.5 transition"
                          title={t.clickToAddExternalTeam}
                        >
                          {language === 'es' ? '+ Externo' : '+ External'}
                        </button>
                      )}
                      {(dept === 'BUILD' || EXTERNAL_TEAM_DEPARTMENTS.includes(dept)) && canEditDepartment(dept) && (
                        <button
                          onClick={() => setIsExternalStaffModalOpen(true)}
                          className="text-[9px] md:text-[10px] font-semibold text-[#4f3a70] hover:text-[#2e1a47] border border-[#d5d1da] hover:border-[#4f3a70] rounded px-1.5 py-0.5 transition"
                          title={t.logExternalStaffTitle}
                        >
                          {t.externalStaffButton}
                        </button>
                      )}
                      {(dept === 'BUILD' || EXTERNAL_TEAM_DEPARTMENTS.includes(dept)) && canEditDepartment(dept) && (
                        <button
                          onClick={() => setIsProviderRateModalOpen(true)}
                          className="text-[9px] md:text-[10px] font-semibold text-[#4f3a70] hover:text-[#2e1a47] border border-[#d5d1da] hover:border-[#4f3a70] rounded px-1.5 py-0.5 transition"
                          title={language === 'es' ? 'Gestionar rates de proveedores externos' : 'Manage external provider rates'}
                        >
                          {language === 'es' ? '$ Rates' : '$ Rates'}
                        </button>
                      )}
                      {canEditDepartment(dept) && (
                        <button
                          onClick={() => setIsHeadcountModalOpen(true)}
                          className="text-[9px] md:text-[10px] font-semibold text-[#4f3a70] hover:text-[#2e1a47] border border-[#d5d1da] hover:border-[#4f3a70] rounded px-1.5 py-0.5 transition"
                          title={language === 'es' ? 'Registrar altas/bajas de personal' : 'Log staff hires/departures'}
                        >
                          {language === 'es' ? '+ / − Personal' : '+ / − Staff'}
                        </button>
                      )}
                      <button
                        onClick={() => setShowDepartmentPanel(!showDepartmentPanel)}
                        className="text-[#4f3a70] hover:text-[#2e1a47] font-bold text-xs cursor-pointer transition"
                        title={showDepartmentPanel ? 'Hide panel' : 'Show panel'}
                      >
                        {showDepartmentPanel ? '▼' : '▶'}
                      </button>
                    </div>
                  </div>

                  {/* Weekly occupancy calendar */}
                  {showDepartmentPanel && (
                    <div
                      className="overflow-x-auto"
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
                              data-week-index={idx}
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
                        {/* Invisible spacer matching the Projects table's trailing Summary
                            columns (60px each -- see
                            SUMMARY_TOTAL_WIDTH_PX). This panel doesn't have those columns,
                            but the percentage-based horizontal scroll sync
                            (syncHorizontalScrollToCanonical) only lines weeks up correctly
                            when both scrollable containers have the exact same total width;
                            this keeps them equal without touching that sync logic itself. */}
                        <div className="flex-shrink-0" style={{ width: SUMMARY_TOTAL_WIDTH_PX }} />
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
                                disabled={!canEditDepartment(dept)}
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
                                disabled={!canEditDepartment(dept)}
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
                                disabled={!canEditDepartment(dept)}
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

                      {/* Subcontracted Personnel rows - Only for BUILD department. The "Add" button that
                          used to live here moved to the panel header, next to "+/- Staff". */}
                      {dept === 'BUILD' && (
                        <>
                          {/* Company rows - Only show active teams */}
                          {Array.from(activeTeams).map((company) => (
                            <div key={`subcontract-${company}`} className="flex gap-0 mb-0.5 group">
                              {/* Company Label with delete button */}
                              <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-violet-100 to-violet-50 text-violet-900 shadow-sm hover:shadow-md transition-all`}>
                                <span className="truncate max-w-[40px]" title={company}>{company}</span>
                                {canEditDepartment(dept) && (
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
                                        disabled={!canEditDepartment(dept)}
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
                        </>
                      )}

                      {/* External team rows - MED/HD/MFG/PRG. The "Add" button that used to live
                          here moved to the panel header, next to "+/- Staff". */}
                      {EXTERNAL_TEAM_DEPARTMENTS.includes(dept) && (
                        <>
                          {/* Team rows - Only show active teams */}
                          {getExternalTeamsFor(dept).map((team) => (
                            <div key={`external-team-${dept}-${team}`} className="flex gap-0 mb-0.5 group">
                              {/* Team Label with delete button */}
                              <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[9px] font-bold px-1 py-0.5 rounded-none border-2 border-black bg-gradient-to-br from-cyan-100 to-cyan-50 text-cyan-900 shadow-sm hover:shadow-md transition-all`}>
                                <span className="truncate max-w-[40px]" title={team}>{team}</span>
                                {canEditDepartment(dept) && (
                                  <button
                                    onClick={() => {
                                      setDeleteConfirmation({
                                        isOpen: true,
                                        type: 'external',
                                        department: dept,
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
                                  const teamKey = externalTeamKey(dept, team);
                                  return (
                                    <div
                                      key={`external-team-${dept}-${team}-${weekData.date}`}
                                      className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 border-1.5 border-black rounded-none py-0.5 flex items-center justify-center transition-all ${
                                        isCurrentWeek
                                          ? CURRENT_WEEK_EDITABLE_CLASS
                                          : 'bg-gradient-to-b from-cyan-50 to-cyan-25'
                                      }`}
                                    >
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={prgExternalInputs[`${teamKey}-${weekData.date}`] ?? (prgExternalPersonnel[teamKey] && prgExternalPersonnel[teamKey][weekData.date] !== undefined && prgExternalPersonnel[teamKey][weekData.date] !== 0 ? prgExternalPersonnel[teamKey][weekData.date] : '')}
                                        disabled={!canEditDepartment(dept)}
                                        onChange={(e) => {
                                          const raw = e.target.value;
                                          const normalized = raw.replace(',', '.');
                                          if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
                                            setPrgExternalInputs(prev => ({
                                              ...prev,
                                              [`${teamKey}-${weekData.date}`]: raw,
                                            }));
                                            let newCount: number | undefined;
                                            if (normalized === '' || normalized === '.') {
                                              newCount = undefined;
                                            } else {
                                              newCount = parseFloat(normalized);
                                            }
                                            handlePrgExternalChange(dept, team, weekData.date, newCount);
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
                        </>
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
                          } else if (totalCapacity < 0) {
                            // Negative base capacity (e.g. PTO/Training exceeding SCIO Team Members): critical
                            bgColor = 'bg-red-700 animate-pulse';
                            textColor = 'text-white';
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

            {renderProjectListFilters()}

            <div className="capacity-projects-section-banner mt-2 mb-1 rounded-md border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-2 py-1">
              <h2 className="text-[11px] font-bold text-indigo-900 flex items-center gap-1">
                <ClipboardList size={12} className="text-indigo-700" />
                <span>{t.projectsSection}</span>
              </h2>
            </div>

            {projectsVisibleInCurrentView.length === 0 && (
              <div className="mb-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs font-medium text-slate-500">
                {hasActiveProjectListFilters
                  ? (t.noProjectsMatchFilter || (language === 'es' ? 'No se encontraron proyectos con ese filtro.' : 'No projects matched the current filter.'))
                  : (t.selectProjectToView || (language === 'es' ? 'Selecciona un proyecto en el filtro para verlo.' : 'Select a project in the filter to view it.'))}
              </div>
            )}

            {/* Unified grid: every open project shares ONE scroll container and ONE column
                grid with the month/week header, same approach as the General view above --
                see its comment for why (removes the JS scroll-sync that caused the lag with
                more than one project open). The Weekly Occupancy panel above stays separate
                (different concept: editable SCIO/PTO/Training capacity, not project hours). */}
            {projectsVisibleInCurrentView.length > 0 && (
              <div ref={departmentCapacityScrollRef} className="overflow-auto border border-gray-300 rounded-lg bg-white" style={{ maxHeight: 'calc(100vh - 150px)' }}>
                <table className="border-collapse text-xs table-fixed w-max min-w-full">
                  <thead>
                    {/* Month row */}
                    <tr className="bg-gray-200 text-gray-700">
                      <th
                        className={`sticky z-40 border border-gray-300 px-1 py-0 text-left font-bold bg-gray-200 text-xs ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}
                        style={{ top: 0, left: 0 }}
                      ></th>
                      {monthSpans.map((monthInfo, idx) => {
                        const isEven = idx % 2 === 0;
                        const span = monthInfo.endIdx - monthInfo.startIdx + 1;
                        return (
                          <th
                            key={`unified-dept-month-${monthInfo.month}-${monthInfo.startIdx}`}
                            colSpan={span}
                            className={`sticky z-30 border-2 px-2 py-0.5 text-center font-bold text-xs transition-all ${
                              isEven ? MONTH_HEADER_PRIMARY_CLASS : MONTH_HEADER_SECONDARY_CLASS
                            }`}
                            style={{ top: 0, width: `${span * 5}rem`, minWidth: `${span * 5}rem` }}
                          >
                            {monthInfo.month}
                          </th>
                        );
                      })}
                      <th
                        colSpan={SUMMARY_COLUMNS.length}
                        className={`sticky z-40 border-2 px-2 py-0.5 text-center font-bold text-xs ${MONTH_HEADER_PRIMARY_CLASS}`}
                        style={{ top: 0, right: 0, width: SUMMARY_TOTAL_WIDTH_PX, minWidth: SUMMARY_TOTAL_WIDTH_PX }}
                      >
                        {language === 'es' ? 'Resumen' : 'Summary'}
                      </th>
                    </tr>
                    {/* Week row */}
                    <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                      <th
                        className={`sticky z-40 border border-blue-500 px-1 py-0.5 text-left font-bold bg-blue-600 uppercase text-xs whitespace-nowrap overflow-hidden text-ellipsis ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}
                        style={{ top: UNIFIED_HEADER_ROW_HEIGHT_PX, left: 0 }}
                      >
                        {t.people}
                      </th>
                      {allWeeksData.map((weekData, idx) => {
                        const isCurrentWeek = idx === currentDateWeekIndex;
                        return (
                          <th
                            key={`unified-dept-week-${weekData.date}`}
                            data-week-index={idx}
                            className={`sticky z-30 border px-0.5 py-0.5 text-center font-bold ${WEEK_COLUMN_WIDTH_CLASS} relative transition-all text-xs ${
                              isCurrentWeek
                                ? CURRENT_WEEK_STRONG_HEADER_CLASS
                                : weekData.isNextYear
                                  ? 'bg-gradient-to-b from-slate-300 to-slate-400 border-slate-500 text-slate-900'
                                  : 'bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white'
                            }`}
                            style={{ top: UNIFIED_HEADER_ROW_HEIGHT_PX }}
                          >
                            <div className="font-bold text-xs leading-none">CW{weekData.weekNum}</div>
                          </th>
                        );
                      })}
                      {SUMMARY_COLUMNS.map(({ key, rightOffset }) => (
                        <th
                          key={key}
                          className="sticky z-40 border px-1 py-0.5 text-center font-bold text-[10px] bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white whitespace-nowrap w-[60px] min-w-[60px] max-w-[60px]"
                          style={{ top: UNIFIED_HEADER_ROW_HEIGHT_PX, right: rightOffset }}
                        >
                          {SUMMARY_COLUMN_LABELS[key][language]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {filteredDepartmentProjects.map((proj) => {
                    const dept = departmentFilter as Department;
                    const scopeKey = getProjectOrderScopeKey(departmentFilter);
                    const isHighProbabilityProject = !!proj.isHighProbability;
                    const totalGridColumns = 1 + allWeeksData.length + SUMMARY_COLUMNS.length;
                    const projectHeaderClass = isHighProbabilityProject
                      ? 'bg-gradient-to-r from-amber-100 to-orange-100 hover:from-amber-200 hover:to-orange-200'
                      : 'bg-gray-100 hover:bg-gray-200';
                    return (
                    <tbody
                      key={proj.id}
                      ref={(el) => {
                        if (el) projectTableRefs.current.set(proj.id, el);
                        else projectTableRefs.current.delete(proj.id);
                      }}
                      className={`border-t-4 ${isHighProbabilityProject ? 'border-amber-400' : 'border-gray-400'}`}
                    >
                      {/* Project header row -- spans the whole grid, not sticky (scrolls away with the body) */}
                      <tr
                        className={`relative cursor-pointer transition ${projectHeaderClass} ${
                          dragOverState?.projectId === proj.id && dragOverState?.scopeKey === scopeKey ? 'ring-2 ring-blue-400' : ''
                        } ${dragState?.projectId === proj.id && dragState?.scopeKey === scopeKey ? 'opacity-60' : ''}`}
                        onClick={() => toggleProjectExpanded(proj.id)}
                        onDragOver={(e) => {
                          handleProjectDragOver(e);
                          updateDragOverPosition(e, proj.id, scopeKey);
                        }}
                        onDrop={(e) => handleProjectDrop(e, proj.id, scopeKey, orderedDepartmentProjects)}
                      >
                        {/* Sticky identifier cell: stays pinned on the left like the department
                            row below it, so the project is still identifiable after scrolling
                            right through the weeks. */}
                        <td
                          className={`sticky z-20 left-0 ${projectHeaderClass} border-r border-gray-300 px-1 py-1 ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}
                          title={proj.name}
                        >
                          <div className="flex items-center gap-0.5">
                            {expandedProjects[proj.id] ? (
                              <ChevronUp size={12} className="text-gray-600 flex-shrink-0" />
                            ) : (
                              <ChevronDown size={12} className="text-gray-600 flex-shrink-0" />
                            )}
                            <span className="font-bold text-xs truncate">{proj.name}</span>
                          </div>
                        </td>
                        <td colSpan={totalGridColumns - 1} className="relative p-1">
                          {dragOverState?.projectId === proj.id &&
                            dragOverState?.scopeKey === scopeKey &&
                            dragState?.projectId !== proj.id && (
                              <div
                                className={`absolute left-2 right-2 h-1 rounded-full bg-blue-500 shadow-md z-20 ${
                                  dragOverState.position === 'before' ? 'top-0' : 'bottom-0'
                                }`}
                              />
                            )}
                          <div className="flex items-center gap-1">
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
                            <div className="flex-1 min-w-0">
                              <div className="text-xs leading-tight flex items-center flex-wrap gap-1">
                                {proj.isClosed && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full border border-red-300 bg-red-50 px-1.5 py-0 text-[9px] font-bold text-red-700">
                                    <XCircle size={10} />
                                    {language === 'es' ? 'Cerrado' : 'Closed'}
                                  </span>
                                )}
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
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {expandedProjects[proj.id] && (
                        <>
                      {/* Project-relative week row (thin): 1..N from project start to end */}
                      <tr>
                        <td className={`sticky z-20 left-0 border border-gray-300 px-1 py-0 text-[9px] font-semibold text-slate-700 bg-slate-100 uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                        {SUMMARY_COLUMNS.map(({ key, rightOffset }) => (
                          <td
                            key={key}
                            style={{ right: rightOffset }}
                            className="border border-gray-300 bg-slate-50 sticky w-[60px] min-w-[60px] max-w-[60px] z-[15]"
                          ></td>
                        ))}
                      </tr>

                      {/* Department row for this project */}
                      <tr className="hover:bg-gray-50">
                        <td className={`sticky z-20 left-0 border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 pl-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                          const isLocked = isWeekLocked(week);
                          // Locked weeks stay clickable: hours are read-only there
                          // (Finance actuals), but the stage label can still be edited.
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
                            showShiftedRangeBorder,
                            showOverlappedShiftBorder,
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
                              title={isLocked ? (language === 'es' ? 'Semana bloqueada: las horas vienen del reporte de Finanzas, pero la etapa se puede editar' : 'Locked week: hours come from the Finance report, but the stage can still be edited') : undefined}
                              onClick={() => selectProjectCell(dept, week, proj.id)}
                              onDoubleClick={() => canEditThisDepartment && handleEditCell(dept, week, proj.id)}
                              className={`border p-0 relative text-xs transition-all ${
                                isLocked ? 'bg-slate-50' : ''
                              } ${
                                canEditThisDepartment ? 'cursor-pointer hover:shadow-md' : 'cursor-not-allowed'
                              } ${
                                isCurrentWeekColumn
                                  ? CURRENT_WEEK_SOFT_CELL_CLASS
                                  : 'border-gray-300'
                              } ${
                                isSelectedCell
                                  ? 'after:absolute after:inset-0 after:border-2 after:border-blue-600 after:rounded-none after:pointer-events-none after:z-[11]'
                                  : ''
                              }`}
                            >
                              {showShiftedRangeBorder && (
                                <div className="pointer-events-none absolute inset-0 border border-[#f97316] z-[8]" />
                              )}
                              {showOverlappedShiftBorder && (
                                <div className="pointer-events-none absolute inset-[1px] border border-black z-[9]" />
                              )}
                              {showShiftGapBackground && (
                                <div className="pointer-events-none absolute inset-0 border border-black bg-[#bfdbfe]/70 z-[10]" />
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
                        {renderProjectDepartmentSummaryCells(proj.id, dept)}
                      </tr>
                        </>
                      )}
                    </tbody>
                    );
                  })}
                </table>
              </div>
            )}
            </div>
        )}

        {/* Projects Table - Only in General View */}
        {departmentFilter === 'General' && (
          <div style={{ zoom: `${zoom / 100}` }}>
            {renderProjectListFilters()}

            <div className="capacity-projects-section-banner mt-2 mb-1 rounded-md border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-2 py-1">
              <h2 className="text-[11px] font-bold text-indigo-900 flex items-center gap-1">
                <ClipboardList size={12} className="text-indigo-700" />
                <span>{t.projectsSection}</span>
              </h2>
            </div>

              {projectsVisibleInCurrentView.length === 0 && (
                <div className="mb-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs font-medium text-slate-500">
                  {hasActiveProjectListFilters
                    ? (t.noProjectsMatchFilter || (language === 'es' ? 'No se encontraron proyectos con ese filtro.' : 'No projects matched the current filter.'))
                    : (t.selectProjectToView || (language === 'es' ? 'Selecciona un proyecto en el filtro para verlo.' : 'Select a project in the filter to view it.'))}
                </div>
              )}

              {/* Unified capacity grid: Capacity bar + every open project share ONE scroll
                  container (both axes) and ONE column grid, so the month/week header and the
                  Capacity-per-department rows can use plain CSS `position: sticky` to stay
                  pinned on top while scrolling down through many projects, and the
                  department/project-name column stays pinned on the left while scrolling
                  through weeks -- all handled natively by the browser, no JS scroll-sync. */}
              {projectsVisibleInCurrentView.length > 0 && (
                <div ref={generalCapacityScrollRef} className="overflow-auto border border-gray-300 rounded-lg bg-white" style={{ maxHeight: 'calc(100vh - 150px)' }}>
                  <table className="border-collapse text-xs table-fixed w-max min-w-full">
                    <thead>
                      {/* Month row. Every sticky header cell below gets an explicit pixel
                          `height` (not just padding/line-height) so UNIFIED_HEADER_ROW_HEIGHT_PX
                          stacking math is exact -- without it, small per-row differences in
                          padding/border compound across the 9 stacked sticky rows and the last
                          few (and the first project rows right under them) start overlapping as
                          you scroll. */}
                      <tr className="bg-gray-200 text-gray-700">
                        <th
                          className={`sticky border border-gray-300 px-1 py-0 text-left font-bold bg-gray-200 text-[9px] overflow-hidden ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}
                          style={{ top: 0, left: 0, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 50 }}
                        ></th>
                        {monthSpans.map((monthInfo, idx) => {
                          const isEven = idx % 2 === 0;
                          const span = monthInfo.endIdx - monthInfo.startIdx + 1;
                          return (
                            <th
                              key={`unified-month-${monthInfo.month}-${monthInfo.startIdx}`}
                              colSpan={span}
                              className={`sticky border-2 px-2 py-0.5 text-center font-bold text-[9px] transition-all overflow-hidden ${
                                isEven ? MONTH_HEADER_PRIMARY_CLASS : MONTH_HEADER_SECONDARY_CLASS
                              }`}
                              style={{ top: 0, width: `${span * 5}rem`, minWidth: `${span * 5}rem`, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 40 }}
                            >
                              {monthInfo.month}
                            </th>
                          );
                        })}
                        <th
                          colSpan={SUMMARY_COLUMNS.length}
                          className={`sticky border-2 px-2 py-0.5 text-center font-bold text-[9px] overflow-hidden ${MONTH_HEADER_PRIMARY_CLASS}`}
                          style={{ top: 0, right: 0, width: SUMMARY_TOTAL_WIDTH_PX, minWidth: SUMMARY_TOTAL_WIDTH_PX, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 50 }}
                        >
                          {language === 'es' ? 'Resumen' : 'Summary'}
                        </th>
                      </tr>
                      {/* Week row */}
                      <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                        <th
                          className={`sticky border border-blue-500 px-1 py-0.5 text-left font-bold bg-blue-600 uppercase text-[9px] whitespace-nowrap overflow-hidden text-ellipsis ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}
                          style={{ top: UNIFIED_HEADER_ROW_HEIGHT_PX, left: 0, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 50 }}
                        >
                          {t.people}
                        </th>
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;
                          return (
                            <th
                              key={`unified-week-${weekData.date}`}
                              data-week-index={idx}
                              className={`sticky border px-1 py-0.5 text-center font-bold ${WEEK_COLUMN_WIDTH_CLASS} max-w-20 relative transition-all text-[9px] overflow-hidden ${
                                isCurrentWeek
                                  ? CURRENT_WEEK_STRONG_HEADER_CLASS
                                  : weekData.isNextYear
                                    ? 'bg-gradient-to-b from-slate-300 to-slate-400 border-slate-500 text-slate-900'
                                    : 'bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white'
                              }`}
                              style={{ top: UNIFIED_HEADER_ROW_HEIGHT_PX, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 40 }}
                            >
                              <div className="font-bold text-[9px] leading-none">CW{weekData.weekNum}</div>
                            </th>
                          );
                        })}
                        {SUMMARY_COLUMNS.map(({ key, rightOffset }) => (
                          <th
                            key={key}
                            className="sticky border px-1 py-0.5 text-center font-bold text-[10px] bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white whitespace-nowrap w-[60px] min-w-[60px] max-w-[60px] overflow-hidden"
                            style={{ top: UNIFIED_HEADER_ROW_HEIGHT_PX, right: rightOffset, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 50 }}
                          >
                            {SUMMARY_COLUMN_LABELS[key][language]}
                          </th>
                        ))}
                      </tr>
                      {/* Capacity-per-department rows (toggle: "Mostrar/Ocultar Capacity" in the toolbar) */}
                      {showGlobalPanel && DEPARTMENTS.map((dept, deptIdx) => {
                        const deptIcon = getDepartmentIcon(dept);
                        const rowTop = UNIFIED_HEADER_ROW_HEIGHT_PX * 2 + deptIdx * UNIFIED_HEADER_ROW_HEIGHT_PX;
                        return (
                          <tr key={`unified-capbar-${dept}`}>
                            <th
                              className={`sticky border border-gray-300 px-0.5 py-0 text-left font-bold bg-gray-50 text-[9px] whitespace-nowrap overflow-hidden text-ellipsis ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}
                              style={{ top: rowTop, left: 0, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 50 }}
                            >
                              <span className="inline-flex items-center gap-0.5">
                                <span className={`text-xs ${deptIcon.color}`}>{deptIcon.icon}</span>
                                <span className="leading-none">{dept}</span>
                              </span>
                            </th>
                            {allWeeksData.map((weekData, idx) => {
                              const isCurrentWeek = idx === currentDateWeekIndex;
                              const deptWeekKey = `${dept}|${weekData.date}`;
                              const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;
                              const isMFG = dept === 'MFG';
                              const occupiedValue = isMFG ? totalWeekHours : totalWeekHours / 45;
                              const totalCapacity = getDepartmentTotalCapacityForWeek(dept, weekData.date);
                              const availableCapacity = totalCapacity - occupiedValue;
                              const unit = isMFG ? 'h' : 'people';
                              let bgColor = 'bg-gray-200'; let textColor = 'text-gray-700';
                              const utilPct = totalCapacity > 0 ? (occupiedValue / totalCapacity) * 100 : 0;
                              if (totalCapacity === 0) { bgColor = 'bg-gray-200'; textColor = 'text-gray-700'; }
                              else if (totalCapacity < 0) { bgColor = 'bg-red-700 animate-pulse'; textColor = 'text-white'; }
                              else if (utilPct >= 100) { bgColor = 'bg-red-700 animate-pulse'; textColor = 'text-white'; }
                              else if (utilPct >= 90) { bgColor = 'bg-red-500'; textColor = 'text-white'; }
                              else if (utilPct >= 70) { bgColor = 'bg-yellow-300'; textColor = 'text-yellow-900'; }
                              else { bgColor = 'bg-green-300'; textColor = 'text-green-900'; }
                              const displayTextColor = isCurrentWeek ? 'text-black' : textColor;
                              const displayTextWeight = isCurrentWeek ? 'font-black' : 'font-bold';
                              return (
                                <td
                                  key={`unified-capbar-cell-${dept}-${weekData.date}`}
                                  className={`sticky border-1.5 border-black text-[9px] font-bold text-center overflow-hidden ${bgColor} ${isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''}`}
                                  style={{ top: rowTop, height: UNIFIED_HEADER_ROW_HEIGHT_PX, maxHeight: UNIFIED_HEADER_ROW_HEIGHT_PX, zIndex: 30 }}
                                  title={`${t.capacityLabel} - CW${weekData.weekNum}: ${totalCapacity.toFixed(2)} ${unit} (Available: ${availableCapacity.toFixed(2)})`}
                                >
                                  <div className={`${displayTextColor} ${displayTextWeight} text-[10px]`}>{availableCapacity.toFixed(2)}</div>
                                </td>
                              );
                            })}
                            {/* No trailing Summary columns here on purpose -- Qtd/Used/Fcst/Util
                                is per-project data and this row is department capacity, not a
                                project, so there's nothing to show there. */}
                          </tr>
                        );
                      })}
                    </thead>
                    {filteredGeneralProjects.map((proj) => {
                        const scopeKey = getProjectOrderScopeKey('General');
                        const isHighProbabilityProject = !!proj.isHighProbability;
                        const totalGridColumns = 1 + allWeeksData.length + SUMMARY_COLUMNS.length;
                        const projectHeaderClass = isHighProbabilityProject
                          ? 'bg-gradient-to-r from-amber-100 to-orange-100 hover:from-amber-200 hover:to-orange-200'
                          : 'bg-gray-100 hover:bg-gray-200';
                        return (
                        <tbody
                      key={proj.id}
                      ref={(el) => {
                        if (el) projectTableRefs.current.set(proj.id, el);
                        else projectTableRefs.current.delete(proj.id);
                      }}
                      className={`border-t-4 ${isHighProbabilityProject ? 'border-amber-400' : 'border-gray-400'}`}
                    >
                          {/* Project header row -- spans the whole grid, not sticky (scrolls away with the body) */}
                          <tr
                            className={`relative cursor-pointer transition ${projectHeaderClass} ${
                              dragOverState?.projectId === proj.id && dragOverState?.scopeKey === scopeKey ? 'ring-2 ring-blue-400' : ''
                            } ${dragState?.projectId === proj.id && dragState?.scopeKey === scopeKey ? 'opacity-60' : ''}`}
                            onClick={() => toggleProjectExpanded(proj.id)}
                            onDragOver={(e) => {
                              handleProjectDragOver(e);
                              updateDragOverPosition(e, proj.id, scopeKey);
                            }}
                            onDrop={(e) => handleProjectDrop(e, proj.id, scopeKey, orderedGeneralProjects)}
                          >
                            {/* Sticky identifier cell: stays pinned on the left like the
                                department rows below it, so the project is still identifiable
                                after scrolling right through the weeks. */}
                            <td
                              className={`sticky z-20 left-0 ${projectHeaderClass} border-r border-gray-300 px-1 py-1 ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}
                              title={proj.name}
                            >
                              <div className="flex items-center gap-0.5">
                                {expandedProjects[proj.id] ? (
                                  <ChevronUp size={12} className="text-gray-600 flex-shrink-0" />
                                ) : (
                                  <ChevronDown size={12} className="text-gray-600 flex-shrink-0" />
                                )}
                                <span className="font-bold text-xs truncate">{proj.name}</span>
                              </div>
                            </td>
                            <td colSpan={totalGridColumns - 1} className="relative p-1">
                              {dragOverState?.projectId === proj.id &&
                                dragOverState?.scopeKey === scopeKey &&
                                dragState?.projectId !== proj.id && (
                                  <div
                                    className={`absolute left-2 right-2 h-1 rounded-full bg-blue-500 shadow-md z-20 ${
                                      dragOverState.position === 'before' ? 'top-0' : 'bottom-0'
                                    }`}
                                  />
                                )}
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
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs leading-tight flex items-center flex-wrap gap-1">
                                    {proj.isClosed && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full border border-red-300 bg-red-50 px-1.5 py-0 text-[9px] font-bold text-red-700">
                                        <XCircle size={10} />
                                        {language === 'es' ? 'Cerrado' : 'Closed'}
                                      </span>
                                    )}
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
                              </div>
                            </td>
                          </tr>
                          {expandedProjects[proj.id] && (
                            <>
                          {/* Project-relative week row (thin): 1..N from project start to end */}
                          <tr>
                            <td className={`sticky z-20 left-0 border border-gray-300 px-1 py-0 text-[9px] font-semibold text-slate-700 bg-slate-100 uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                            {SUMMARY_COLUMNS.map(({ key, rightOffset }) => (
                              <td
                                key={key}
                                style={{ right: rightOffset }}
                                className="border border-gray-300 bg-slate-50 sticky w-[60px] min-w-[60px] max-w-[60px] z-[15]"
                              ></td>
                            ))}
                          </tr>

                          {/* Show ALL 6 departments in the calendar */}
                          {DEPARTMENTS.map((dept) => {
                            return (
                              <tr key={`${proj.id}-${dept}`} className="hover:bg-gray-50">
                                <td className={`sticky z-20 left-0 border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 pl-0.5 whitespace-nowrap overflow-hidden text-ellipsis ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                                    showShiftedRangeBorder,
                                    showOverlappedShiftBorder,
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
                                        {showShiftedRangeBorder && (
                                          <div className="pointer-events-none absolute inset-0 border border-[#f97316] z-[8]" />
                                        )}
                                        {showOverlappedShiftBorder && (
                                          <div className="pointer-events-none absolute inset-[1px] border border-black z-[9]" />
                                        )}
                                        {showShiftGapBackground && (
                                          <div className="pointer-events-none absolute inset-0 border border-black bg-[#bfdbfe]/70 z-[10]" />
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
                                      {showShiftedRangeBorder && (
                                        <div className="pointer-events-none absolute inset-0 border border-[#f97316] z-[8]" />
                                      )}
                                      {showOverlappedShiftBorder && (
                                        <div className="pointer-events-none absolute inset-[1px] border border-black z-[9]" />
                                      )}
                                      {showShiftGapBackground && (
                                        <div className="pointer-events-none absolute inset-0 border border-black bg-[#bfdbfe]/70 z-[10]" />
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
                                {renderProjectDepartmentSummaryCells(proj.id, dept)}
                              </tr>
                            );
                          })}
                            </>
                          )}
                        </tbody>
                        );
                      })}
                  </table>
                </div>
              )}
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
          <div
            className="h-[94vh] min-h-[60vh] w-full max-w-[98vw] bg-white rounded-xl shadow-2xl border border-[#d8d0e4] overflow-hidden flex flex-col resize-y"
            style={{ resize: 'vertical' }}
          >
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-3 text-white flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">
                  {language === 'es' ? 'Cambios de Timing' : 'Timing Changes'}
                </h3>
                <p className="text-[11px] opacity-90">
                  {language === 'es'
                    ? 'Vista General - comparativo compacto semanal'
                    : 'General View - weekly compact comparison'}
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
                      : (language === 'es' ? 'Exportar cambios semanales' : 'Export weekly changes')}
                  </span>
                </button>
                <div className="text-[11px] text-[#6f5b80]">
                  {language === 'es'
                    ? `Semanas con cambios: ${timingChangesByWeek.length} | Proyectos con cambios: ${timingChangesByProject.length}`
                    : `Weeks with changes: ${timingChangesByWeek.length} | Projects with changes: ${timingChangesByProject.length}`}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-[#f7f4fb] p-4">
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
              ) : !timingCompactPreview ? (
                <div className="rounded-lg border border-[#dfd5ef] bg-white px-3 py-3 text-sm text-[#5d4a72]">
                  {language === 'es'
                    ? 'No se pudo construir la vista compacta del Excel para este rango.'
                    : 'The compact Excel preview could not be built for this range.'}
                </div>
              ) : (
                <div className="space-y-4">
                  {timingCompactPreview.projectGroups.map((group) => (
                    <div key={`timing-compact-${group.projectId}`} className="rounded-xl border border-[#d8d0e4] bg-white shadow-sm overflow-hidden">
                      <div className="px-4 py-2.5 bg-gradient-to-r from-[#f3ecff] to-[#eee5fb] border-b border-[#d8d0e4] flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-bold text-[#2e1a47] truncate">{group.projectName}</span>
                            <span className="text-[10px] font-semibold text-[#7a6b8f]">#{group.projectId.slice(0, 8)}</span>
                          </div>
                          <p className="text-[11px] text-[#6f5b80]">
                            {language === 'es'
                              ? 'Previsualizacion compacta del XLSX semanal'
                              : 'Weekly XLSX compact preview'}
                          </p>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="min-w-[1500px] w-full border-collapse text-[11px]">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-[#2e1a47] text-white">
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-left font-bold" style={getTimingCompactStickyColumnStyle(0)}>Project</th>
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-left font-bold" style={getTimingCompactStickyColumnStyle(1)}>{language === 'es' ? 'Vista' : 'View'}</th>
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-center font-bold" style={getTimingCompactStickyColumnStyle(2)}>DPTO</th>
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-center font-bold" style={getTimingCompactStickyColumnStyle(3)}>{language === 'es' ? 'Cambios' : 'Changes'}</th>
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-center font-bold" style={getTimingCompactStickyColumnStyle(4)}>{language === 'es' ? 'Cotizado' : 'Quoted'}</th>
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-center font-bold" style={getTimingCompactStickyColumnStyle(5)}>{language === 'es' ? 'Usado' : 'Used'}</th>
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-center font-bold" style={getTimingCompactStickyColumnStyle(6)}>{language === 'es' ? 'Pronostico' : 'Fcst'}</th>
                              <th className="sticky z-30 border border-[#d8d0e4] bg-[#2e1a47] px-3 py-2 text-center font-bold shadow-[8px_0_12px_-10px_rgba(46,26,71,0.5)]" style={getTimingCompactStickyColumnStyle(7)}>Util %</th>
                              {timingCompactPreview.weeklyRange.map((weekStartDate, weekIndex) => (
                                <th
                                  key={`${group.projectId}-${weekStartDate}`}
                                  className={`border border-[#d8d0e4] px-2 py-2 text-center font-bold min-w-[56px] ${getTimingCompactCurrentWeekMarkerClass(weekIndex === timingCompactPreview.currentWeekIndex)}`}
                                >
                                  {`CW${String(getWeekNumber(weekStartDate)).padStart(2, '0')}`}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[{ label: group.currentViewLabel, rows: group.currentRows, current: true }, { label: group.previousViewLabel, rows: group.previousRows, current: false }].map((viewBlock) =>
                                viewBlock.rows.map((row, rowIndex) => {
                                  const utilPalette = getUtilizationColor(row.metrics.utilizationPercent);
                                  const viewBg = viewBlock.current ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700';
                                  const metricHighlightCurrent = viewBlock.current;
                                  const separatorTopClass = !viewBlock.current && rowIndex === 0 ? 'border-t-[4px] border-t-[#7a6796]' : '';
                                  return (
                                    <tr key={`${group.projectId}-${viewBlock.label}-${row.department}`} className={row.changeDetected ? 'bg-amber-50/40' : 'bg-white'}>
                                      <td className={`sticky z-20 border border-[#e7deef] bg-white px-3 py-2 font-semibold text-[#2e1a47] align-middle ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(0)}>
                                        {rowIndex === 0 ? group.projectName : ''}
                                      </td>
                                      <td className={`sticky z-20 border border-[#e7deef] px-3 py-2 font-semibold align-middle ${viewBg} ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(1)}>
                                        {rowIndex === 0 ? viewBlock.label : ''}
                                      </td>
                                      <td className={`sticky z-20 border border-[#e7deef] px-3 py-2 text-center font-bold text-[#2e1a47] bg-slate-50 ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(2)}>
                                        {row.department}
                                      </td>
                                      <td className={`sticky z-20 border border-[#e7deef] px-3 py-2 text-center font-semibold ${row.changeDetected ? 'bg-amber-100 text-amber-900' : 'bg-slate-50 text-slate-400'} ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(3)}>
                                        {row.changeDetected
                                          ? (language === 'es' ? 'Hubo un cambio' : 'Change detected')
                                          : '-'}
                                      </td>
                                      <td className={`sticky z-20 border border-[#e7deef] px-3 py-2 text-center font-semibold ${row.metricDiffs.quotedHours ? `${getTimingCompactChangeHighlight(true, metricHighlightCurrent)} bg-indigo-100 text-indigo-900` : 'bg-indigo-50 text-indigo-700'} ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(4)}>
                                        {formatTimingCompactMetric(row.metrics.quotedHours)}
                                      </td>
                                      <td className={`sticky z-20 border border-[#e7deef] px-3 py-2 text-center font-semibold ${row.metricDiffs.usedHours ? `${getTimingCompactChangeHighlight(true, metricHighlightCurrent)} bg-emerald-100 text-emerald-900` : 'bg-emerald-50 text-emerald-700'} ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(5)}>
                                        {formatTimingCompactMetric(row.metrics.usedHours)}
                                      </td>
                                      <td className={`sticky z-20 border border-[#e7deef] px-3 py-2 text-center font-semibold ${row.metricDiffs.forecastedHours ? `${getTimingCompactChangeHighlight(true, metricHighlightCurrent)} bg-amber-100 text-amber-900` : 'bg-amber-50 text-amber-700'} ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(6)}>
                                        {formatTimingCompactMetric(row.metrics.forecastedHours)}
                                      </td>
                                      <td className={`sticky z-20 border border-[#e7deef] px-3 py-2 text-center font-bold shadow-[8px_0_12px_-10px_rgba(46,26,71,0.45)] ${utilPalette.bg} ${utilPalette.text} ${getTimingCompactChangeHighlight(row.metricDiffs.utilizationPercent, metricHighlightCurrent)} ${separatorTopClass}`} style={getTimingCompactStickyColumnStyle(7)}>
                                        {formatTimingCompactMetric(row.metrics.utilizationPercent, true)}
                                      </td>
                                      {row.cells.map((cell, cellIndex) => (
                                        <td
                                          key={`${group.projectId}-${viewBlock.label}-${row.department}-${timingCompactPreview.weeklyRange[cellIndex]}`}
                                          className={`border border-[#e7deef] px-2 py-2 text-center font-semibold ${getTimingCompactCellClasses(cell, row.department)} ${getTimingCompactChangeHighlight(cell.changed && cell.hasCapacityLoad, cell.highlightCurrent)} ${getTimingCompactCurrentWeekMarkerClass(cellIndex === timingCompactPreview.currentWeekIndex)} ${separatorTopClass}`}
                                        >
                                          {cell.value}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })
                            )}
                          </tbody>
                        </table>
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
                      const value = e.target.value.replace(',', '.');
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        setQuickProjectForm({ ...quickProjectForm, budgetHours: value });
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
        {showImportProjectModal && canImportProjectsInCurrentView && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-amber-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">{t.importProject || 'Import Existing Project'}</h2>
                <button
                  onClick={() => {
                    setShowImportProjectModal(false);
                    setImportProjectSearchTerm('');
                    setIsImportProjectSearchOpen(false);
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
                  <div ref={importProjectSearchContainerRef} className="space-y-2">
                    <input
                      type="text"
                      value={importProjectSearchTerm}
                      onFocus={() => setIsImportProjectSearchOpen(true)}
                      onChange={(e) => {
                        setImportProjectSearchTerm(e.target.value);
                        setImportProjectForm({ ...importProjectForm, projectId: '' });
                        setIsImportProjectSearchOpen(true);
                      }}
                      placeholder={t.searchProjectPlaceholder || (language === 'es' ? 'Escribe numero, nombre o cliente' : 'Type project number, name or client')}
                      className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition bg-white text-sm"
                    />
                    {isImportProjectSearchOpen && (
                      <div className="max-h-44 overflow-y-auto rounded-lg border-2 border-amber-200 bg-white">
                        {filteredProjectsForImport.length > 0 ? (
                          filteredProjectsForImport.map((proj) => (
                            <button
                              key={proj.id}
                              type="button"
                              onClick={() => {
                                setImportProjectForm({
                                  ...importProjectForm,
                                  projectId: proj.id,
                                  startDate: departmentFilter === 'PM' ? proj.startDate : importProjectForm.startDate,
                                  numberOfWeeks: departmentFilter === 'PM' ? proj.numberOfWeeks : importProjectForm.numberOfWeeks,
                                });
                                setImportProjectSearchTerm(proj.name);
                                setIsImportProjectSearchOpen(false);
                              }}
                              className={`block w-full border-b border-amber-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-amber-50 ${
                                importProjectForm.projectId === proj.id ? 'bg-amber-100 text-amber-900 font-semibold' : 'text-gray-700'
                              }`}
                            >
                              {proj.name} - {proj.client}
                              {proj.isHighProbability ? ` (${language === 'es' ? 'High Probability' : 'High Probability'})` : ''}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-sm text-gray-500">
                            {t.noProjectsMatchFilter || (language === 'es' ? 'No se encontraron proyectos con ese filtro.' : 'No projects matched the current filter.')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
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

                {departmentFilter !== 'PM' && (
                  <>
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
                  </>
                )}

                {/* Budget Hours for this department */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">{t.budgetHours || 'Budget Hours'}</label>
                  <input
                    type="text"
                    value={importProjectForm.budgetHours}
                    onChange={(e) => {
                      const value = e.target.value.replace(',', '.');
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        setImportProjectForm({ ...importProjectForm, budgetHours: value });
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
                      setImportProjectSearchTerm('');
                      setIsImportProjectSearchOpen(false);
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

        {/* SCIO Headcount Modal ("+ / - Staff") -- rendered here, outside the
            sticky department panel, so its z-index isn't trapped inside that
            panel's own stacking context (position: sticky + z-index create
            one; a nested `fixed` modal can never paint above siblings outside
            it no matter how high its own z-index goes). */}
        {departmentFilter !== 'General' && (
          <ScioHeadcountModal
            isOpen={isHeadcountModalOpen}
            department={departmentFilter as Department}
            language={language}
            onClose={() => setIsHeadcountModalOpen(false)}
            onSaved={loadScioTeamCapacity}
          />
        )}

        {/* External Staff Headcount Modal ("+ / - External Staff") -- same reasoning as the
            SCIO modal above for rendering it outside the sticky department panel. */}
        {departmentFilter !== 'General' && (
          <ExternalStaffHeadcountModal
            isOpen={isExternalStaffModalOpen}
            department={departmentFilter as Department}
            teams={departmentFilter === 'BUILD' ? activeTeams : getExternalTeamsFor(departmentFilter as Department)}
            language={language}
            onClose={() => setIsExternalStaffModalOpen(false)}
            onSaved={loadTeamsData}
          />
        )}

        {/* External Provider Rate Modal ("$ Rates") -- same reasoning as the modals above for
            rendering it outside the sticky department panel. */}
        {departmentFilter !== 'General' && (
          <ExternalProviderRateModal
            isOpen={isProviderRateModalOpen}
            department={departmentFilter as Department}
            teams={departmentFilter === 'BUILD' ? activeTeams : getExternalTeamsFor(departmentFilter as Department)}
            stageOptions={STAGE_OPTIONS[departmentFilter as Department]}
            getStageLabel={getStageLabel}
            language={language}
            onClose={() => setIsProviderRateModalOpen(false)}
            onSaved={() => setProviderRateVersion((v) => v + 1)}
          />
        )}

        {/* External Team Modal (MED/HD/MFG/PRG) */}
        {externalTeamModalDept && canEditDepartment(externalTeamModalDept) && (() => {
          const rateStageKeys = STAGE_OPTIONS[externalTeamModalDept].length > 0 ? STAGE_OPTIONS[externalTeamModalDept] : [''];
          const closeModal = () => {
            setExternalTeamModalDept(null);
            setExternalTeamName('');
            setExternalTeamHeadcount('');
            setExternalTeamRateInputs({});
          };
          const allRatesValid = rateStageKeys.every((stageKey) => {
            const num = parseFloat(externalTeamRateInputs[stageKey]);
            return Number.isFinite(num) && num >= 0;
          });

          return (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 bg-black bg-opacity-50 z-[80]" onClick={closeModal} />
              {/* Modal */}
              <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[90]">
                <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-96 max-h-[85vh] overflow-y-auto">
                  {/* Header */}
                  <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-teal-50 to-teal-100 rounded-t-lg sticky top-0">
                    <h2 className="text-lg font-semibold text-gray-800">{t.addPrgTeam}</h2>
                    <button onClick={closeModal} className="p-1 text-gray-600 hover:bg-gray-200 rounded transition" title={t.close}>
                      <X size={20} />
                    </button>
                  </div>

                  {/* Form Content */}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const department = externalTeamModalDept;
                      const initialHeadcount = Math.max(0, parseFloat(externalTeamHeadcount) || 0);
                      if (externalTeamName.trim() && department && allRatesValid) {
                        try {
                          // Create employee as subcontracted material for this department
                          await addEmployee({
                            name: externalTeamName.trim(),
                            role: 'External Team',
                            department,
                            capacity: 0, // External teams don't have internal capacity
                            isActive: true,
                            isSubcontractedMaterial: true,
                            subcontractCompany: externalTeamName.trim(),
                          });

                          // Create initial PrgExternalTeamCapacity record to persist the team,
                          // seeded with the staff headcount entered here (0 if left blank).
                          // This ensures the team appears after page refresh
                          const currentWeekStart = formatToISO(getWeekStart(new Date()));
                          await prgExternalTeamCapacityApi.create({
                            department,
                            teamName: externalTeamName.trim(),
                            weekStartDate: currentWeekStart,
                            capacity: initialHeadcount,
                          });
                          console.log('[CapacityMatrix] Created initial ExternalTeamCapacity for:', department, externalTeamName.trim(), 'capacity:', initialHeadcount);

                          // One hourly rate per stage of this department (a single flat rate,
                          // keyed '', when the department has no Stage concept -- see MFG).
                          await Promise.all(rateStageKeys.map((stageKey) => externalProviderRatesApi.create({
                            department,
                            providerName: externalTeamName.trim(),
                            stage: stageKey || null,
                            effectiveDate: currentWeekStart,
                            rate: parseFloat(externalTeamRateInputs[stageKey]),
                          })));

                          // Add to active teams array
                          const newTeams = [...getExternalTeamsFor(department), externalTeamName.trim()];
                          setExternalTeamsForDepartment(department, [...new Set(newTeams)]);
                          setProviderRateVersion((v) => v + 1);
                          closeModal();
                        } catch (error) {
                          console.error('Error adding external team:', error);
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
                        value={externalTeamName}
                        onChange={(e) => setExternalTeamName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        placeholder={t.egProviderAbc}
                        autoFocus
                      />
                    </div>

                    {/* Initial headcount Field */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t.availableStaffLabel}</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.5"
                        value={externalTeamHeadcount}
                        onChange={(e) => setExternalTeamHeadcount(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        placeholder={t.availableStaffPlaceholder}
                      />
                    </div>

                    {/* Per-stage hourly rate fields -- a provider's rate can differ by activity,
                        and can change later from the "$ Rates" button. */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Rate por hora ($/hr)' : 'Hourly rate ($/hr)'}
                      </label>
                      <div className="space-y-2">
                        {rateStageKeys.map((stageKey) => (
                          <div key={stageKey || 'flat'} className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 flex-1 truncate">
                              {stageKey ? getStageLabel(stageKey as Exclude<Stage, null>, t as Record<string, string>) : (language === 'es' ? 'Rate general' : 'Flat rate')}
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.5"
                              value={externalTeamRateInputs[stageKey] ?? ''}
                              onChange={(e) => setExternalTeamRateInputs((prev) => ({ ...prev, [stageKey]: e.target.value }))}
                              className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              placeholder="0.00"
                              required
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="submit"
                        disabled={!externalTeamName.trim() || !allRatesValid}
                        className="flex-1 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
                      >
                        {t.addButton}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </>
          );
        })()}

        {/* BUILD Subcontracted Team Modal */}
        {isBuildModalOpen && canEditDepartment('BUILD') && (() => {
          const rateStageKeys = STAGE_OPTIONS.BUILD;
          const closeModal = () => {
            setIsBuildModalOpen(false);
            setBuildTeamName('');
            setBuildTeamHeadcount('');
            setBuildTeamRateInputs({});
          };
          const allRatesValid = rateStageKeys.every((stageKey) => {
            const num = parseFloat(buildTeamRateInputs[stageKey]);
            return Number.isFinite(num) && num >= 0;
          });

          return (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 bg-black bg-opacity-50 z-[80]" onClick={closeModal} />
              {/* Modal */}
              <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[90]">
                <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-96 max-h-[85vh] overflow-y-auto">
                  {/* Header */}
                  <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-indigo-100 rounded-t-lg sticky top-0">
                    <h2 className="text-lg font-semibold text-gray-800">{t.addBuildTeam}</h2>
                    <button onClick={closeModal} className="p-1 text-gray-600 hover:bg-gray-200 rounded transition" title={t.close}>
                      <X size={20} />
                    </button>
                  </div>

                  {/* Form Content */}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const initialHeadcount = Math.max(0, parseFloat(buildTeamHeadcount) || 0);
                      if (buildTeamName.trim() && allRatesValid) {
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

                          // Create initial SubcontractedTeamCapacity record to persist the team,
                          // seeded with the staff headcount entered here (0 if left blank).
                          // This ensures the team appears after page refresh
                          const currentWeekStart = formatToISO(getWeekStart(new Date()));
                          await subcontractedTeamCapacityApi.create({
                            company: buildTeamName.trim(),
                            weekStartDate: currentWeekStart,
                            capacity: initialHeadcount,
                          });
                          console.log('[CapacityMatrix] Created initial SubcontractedTeamCapacity for:', buildTeamName.trim(), 'capacity:', initialHeadcount);

                          // One hourly rate per BUILD stage.
                          await Promise.all(rateStageKeys.map((stageKey) => externalProviderRatesApi.create({
                            department: 'BUILD',
                            providerName: buildTeamName.trim(),
                            stage: stageKey,
                            effectiveDate: currentWeekStart,
                            rate: parseFloat(buildTeamRateInputs[stageKey]),
                          })));

                          // Add to active teams array
                          const newTeams = [...activeTeams, buildTeamName.trim()];
                          setActiveTeams([...new Set(newTeams)]);
                          setProviderRateVersion((v) => v + 1);
                          closeModal();
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
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder={t.egCompanyXyz}
                        autoFocus
                      />
                    </div>

                    {/* Initial headcount Field */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t.availableStaffLabel}</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.5"
                        value={buildTeamHeadcount}
                        onChange={(e) => setBuildTeamHeadcount(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        placeholder={t.availableStaffPlaceholder}
                      />
                    </div>

                    {/* Per-stage hourly rate fields -- a provider's rate can differ by activity,
                        and can change later from the "$ Rates" button. */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {language === 'es' ? 'Rate por hora ($/hr)' : 'Hourly rate ($/hr)'}
                      </label>
                      <div className="space-y-2">
                        {rateStageKeys.map((stageKey) => (
                          <div key={stageKey} className="flex items-center gap-2">
                            <span className="text-xs text-gray-600 flex-1 truncate">
                              {getStageLabel(stageKey, t as Record<string, string>)}
                            </span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.5"
                              value={buildTeamRateInputs[stageKey] ?? ''}
                              onChange={(e) => setBuildTeamRateInputs((prev) => ({ ...prev, [stageKey]: e.target.value }))}
                              className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              placeholder="0.00"
                              required
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="submit"
                        disabled={!buildTeamName.trim() || !allRatesValid}
                        className="flex-1 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition"
                      >
                        {t.addButton}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </>
          );
        })()}

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
