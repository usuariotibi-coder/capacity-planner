import { useState, useEffect, useRef, useMemo, type DragEvent } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { scioTeamCapacityApi, subcontractedTeamCapacityApi, prgExternalTeamCapacityApi, changeOrdersApi, assignmentsApi, activityLogApi } from '../services/api';
import { getAllWeeksWithNextYear, formatToISO, parseISODate, getWeekStart, normalizeWeekStartDate } from '../utils/dateUtils';
import { calculateTalent, getStageColor, getStageLabel, getUtilizationColor } from '../utils/stageColors';
import { getDepartmentIcon, getDepartmentLabel } from '../utils/departmentIcons';
import { generateId } from '../utils/id';
import { ZoomIn, ZoomOut, ChevronDown, ChevronUp, Pencil, Plus, Minus, X, FolderPlus, ClipboardList, GripVertical } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../utils/translations';
import type { Department, Stage, Project, Assignment, Employee, ProjectChangeOrder } from '../types';
import { WeekNumberDatePicker } from '../components/WeekNumberDatePicker';

type DepartmentFilter = 'General' | Department;

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];
const SHARED_EDIT_DEPARTMENTS: Department[] = ['BUILD', 'MFG'];

const STAGE_OPTIONS: Record<Department, Exclude<Stage, null>[]> = {
  'HD': ['SWITCH_LAYOUT_REVISION', 'CONTROLS_DESIGN', 'RELEASE', 'RED_LINES', 'SUPPORT'],
  'MED': ['CONCEPT', 'DETAIL_DESIGN', 'RELEASE', 'RED_LINES', 'SUPPORT'],
  'BUILD': ['CABINETS_FRAMES', 'OVERALL_ASSEMBLY', 'FINE_TUNING', 'COMMISSIONING', 'SUPPORT'],
  'PRG': ['OFFLINE', 'ONLINE', 'DEBUG', 'COMMISSIONING', 'SUPPORT_MANUALS_FLOW_CHARTS', 'ROBOT_SIMULATION', 'STANDARDS_REV_PROGRAMING_CONCEPT'],
  'PM': [],
  'MFG': [],
};

interface CellEditState {
  department: Department;
  weekStart: string;
  projectId?: string;
}

interface CapacityMatrixPageProps {
  departmentFilter: DepartmentFilter;
}

type FormValidationScope = 'quick' | 'import';
type PdfExportScope = 'single' | 'all' | 'selected';
const PROJECT_ORDER_STORAGE_KEY = 'capacity_project_order_by_scope_v1';
const CURRENT_WEEK_HEADER_CLASS = 'bg-stone-300 text-stone-900 border-stone-600';
const CURRENT_WEEK_RING_CLASS = 'ring-2 ring-stone-600 shadow-md';
const CURRENT_WEEK_EDITABLE_CLASS = 'ring-2 ring-stone-600 shadow-md border-stone-500 bg-gradient-to-b from-stone-100 to-zinc-100';
const CURRENT_WEEK_STRONG_HEADER_CLASS = 'bg-gradient-to-b from-stone-500 via-stone-600 to-zinc-700 text-white border-2 border-zinc-800 shadow-lg ring-2 ring-stone-300';
const CURRENT_WEEK_SOFT_CELL_CLASS = 'border-zinc-600 border-2 shadow-md bg-gradient-to-b from-stone-100 to-zinc-100';
const MONTH_HEADER_PRIMARY_CLASS = 'bg-gradient-to-b from-[#4f3a70] to-[#2e1a47] text-white border-[#2e1a47] shadow-md';
const MONTH_HEADER_SECONDARY_CLASS = 'bg-yellow-300 text-yellow-900 border-yellow-400 shadow-md';
const WEEK_COLUMN_WIDTH_CLASS = 'w-20 min-w-20';
const GENERAL_LEFT_COLUMN_WIDTH_CLASS = 'w-12 min-w-12 max-w-12';
const DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS = 'w-14 min-w-14 max-w-14';

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

  // Debug: Log when projects change
  useEffect(() => {
    console.log('[CapacityMatrixPage] Projects updated:', {
      count: projects?.length,
      firstProjectName: projects?.[0]?.name,
      firstProjectHasQuoted: projects?.[0]?.departmentHoursAllocated ? 'YES' : 'NO'
    });
  }, [projects]);
  const { language } = useLanguage();
  const { hasFullAccess, isReadOnly, currentUserDepartment } = useAuth();
  const t = useTranslation(language);
  const locale = language === 'es' ? 'es-ES' : 'en-US';

  const [editingCell, setEditingCell] = useState<CellEditState | null>(null);
  const [editingHours, setEditingHours] = useState<number>(0);
  const [editingScioHours, setEditingScioHours] = useState<number>(0);
  const [initialScioHours, setInitialScioHours] = useState<number>(0);
  const [editingExternalHours, setEditingExternalHours] = useState<number>(0);
  const [editingHoursInput, setEditingHoursInput] = useState<string>('');
  const [editingScioHoursInput, setEditingScioHoursInput] = useState<string>('');
  const [editingExternalHoursInput, setEditingExternalHoursInput] = useState<string>('');
  const [editingStage, setEditingStage] = useState<Stage>(null);
  const [editingComment, setEditingComment] = useState<string>('');
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(new Set());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [zoom, setZoom] = useState<number>(100);
  const [showLegend, setShowLegend] = useState<boolean>(false);
  const [showGlobalPanel, setShowGlobalPanel] = useState<boolean>(true);
  const [showDepartmentPanel, setShowDepartmentPanel] = useState<boolean>(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const minYearOption = 2024;
  const maxYearOption = new Date().getFullYear() + 10;
  const yearOptions = Array.from(
    { length: maxYearOption - minYearOption + 1 },
    (_, idx) => minYearOption + idx
  );

  useEffect(() => {
    const weeks = getAllWeeksWithNextYear(selectedYear);
    const rangeStart = weeks[0]?.date || `${selectedYear}-01-01`;
    const rangeEnd = weeks[weeks.length - 1]?.date || `${selectedYear + 1}-12-31`;
    // Do not force here: useDataLoader already fetches the current-year range on login.
    // We only want to refetch when the range actually changes (e.g. user selects another year).
    fetchAssignments({ startDate: rangeStart, endDate: rangeEnd });
  }, [selectedYear, fetchAssignments]);

  // SCIO Team Members state - store capacity per department and per week
  // Structure: { dept: { weekDate: hours } }
  // Now loads from API instead of localStorage
  const [scioTeamMembers, setScioTeamMembers] = useState<Record<Department, Record<string, number>>>({
    'PM': {},
    'MED': {},
    'HD': {},
    'MFG': {},
    'BUILD': {},
    'PRG': {},
  });

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
        console.log('[CapacityMatrix] 📊 Total SCIO records loaded:', data?.length || 0);

        // Transform API data to our state structure
        const newScioTeamMembers: Record<Department, Record<string, number>> = {
          'PM': {},
          'MED': {},
          'HD': {},
          'MFG': {},
          'BUILD': {},
          'PRG': {},
        };
        const newRecordIds: Record<string, string> = {};

        for (const record of data) {
          const dept = record.department as Department;
          const weekDate = normalizeWeekStartDate(record.weekStartDate);
          const capacity = record.capacity;

          if (dept && weekDate && newScioTeamMembers[dept]) {
            newScioTeamMembers[dept][weekDate] = capacity;
            newRecordIds[`${dept}-${weekDate}`] = record.id;
          }
        }

        setScioTeamMembers(newScioTeamMembers);
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

  // Normalize scioTeamMembers to ensure all departments exist in the structure
  // This prevents "Cannot read properties of undefined" errors when accessing dept[date]
  useEffect(() => {
    const departments: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];
    const hasAllDepts = departments.every(dept => scioTeamMembers[dept] !== undefined);

    if (!hasAllDepts) {
      const normalized: Record<Department, Record<string, number>> = {
        'PM': scioTeamMembers['PM'] || {},
        'MED': scioTeamMembers['MED'] || {},
        'HD': scioTeamMembers['HD'] || {},
        'MFG': scioTeamMembers['MFG'] || {},
        'BUILD': scioTeamMembers['BUILD'] || {},
        'PRG': scioTeamMembers['PRG'] || {},
      };
      setScioTeamMembers(normalized);
    }
  }, []);

  // Function to save SCIO Team Capacity to API
  const saveScioTeamCapacity = async (dept: Department, weekDate: string, capacity: number) => {
    const recordKey = `${dept}-${weekDate}`;
    const existingId = scioTeamRecordIds[recordKey];

    console.log('[CapacityMatrix] saveScioTeamCapacity called:', { dept, weekDate, capacity, existingId, recordKey });

    try {
      if (capacity === 0 && existingId) {
        // Delete the record if capacity is 0
        console.log('[CapacityMatrix] Deleting SCIO capacity:', recordKey);
        await scioTeamCapacityApi.delete(existingId);
        console.log('[CapacityMatrix] ✅ SCIO capacity deleted successfully');

        // Log activity
        await activityLogApi.logActivity(
          'deleted',
          'ScioTeamCapacity',
          existingId,
          { department: dept, weekStartDate: weekDate }
        );

        setScioTeamRecordIds(prev => {
          const newIds = { ...prev };
          delete newIds[recordKey];
          return newIds;
        });
      } else if (existingId) {
        // Update existing record
        console.log('[CapacityMatrix] Updating SCIO capacity:', recordKey, capacity);
        const updateResult = await scioTeamCapacityApi.update(existingId, { capacity });
        console.log('[CapacityMatrix] ✅ SCIO capacity updated successfully:', updateResult);

        // Log activity
        await activityLogApi.logActivity(
          'updated',
          'ScioTeamCapacity',
          existingId,
          { department: dept, weekStartDate: weekDate, capacity }
        );
      } else if (capacity > 0) {
        // Create new record
        console.log('[CapacityMatrix] Creating SCIO capacity:', recordKey, capacity);
        let createdSuccessfully = false;
        let createdRecordId: string | null = null;

        try {
          console.log('[CapacityMatrix] Sending CREATE request to API...');
          const result = await scioTeamCapacityApi.create({
            department: dept,
            weekStartDate: weekDate,
            capacity: capacity,
          });
          console.log('[CapacityMatrix] ✅ CREATE succeeded, result:', result);
          console.log('[CapacityMatrix] 🎯 Record ID assigned:', result.id);
          createdSuccessfully = true;
          createdRecordId = result.id;

          setScioTeamRecordIds(prev => ({
            ...prev,
            [recordKey]: result.id,
          }));
        } catch (createError) {
          const createErrorMsg = createError instanceof Error ? createError.message : 'Error desconocido';
          console.log('[CapacityMatrix] ❌ CREATE failed:', createErrorMsg);
          console.log('[CapacityMatrix] Checking if this is a unique constraint violation...');

          // If create fails due to unique constraint, try to update instead
          // This happens when the record already exists but we don't have the ID
          if (createErrorMsg.includes('conjunto único') || createErrorMsg.includes('unique')) {
            console.log('[CapacityMatrix] Detected unique constraint violation, fetching all records to find existing one...');
            try {
              const allScioRecords = await scioTeamCapacityApi.getAll();
              console.log('[CapacityMatrix] Fetched all SCIO records, total count:', allScioRecords.length);

              const existingRecord = allScioRecords.find(
                (r: any) => r.department === dept && r.weekStartDate === weekDate
              );

              if (existingRecord) {
                console.log('[CapacityMatrix] ✅ Found existing record, updating it with ID:', existingRecord.id);
                const updateResult = await scioTeamCapacityApi.update(existingRecord.id, { capacity });
                console.log('[CapacityMatrix] ✅ UPDATE succeeded:', updateResult);
                createdSuccessfully = true;
                createdRecordId = existingRecord.id;

                setScioTeamRecordIds(prev => ({
                  ...prev,
                  [recordKey]: existingRecord.id,
                }));
              } else {
                console.log('[CapacityMatrix] ❌ No existing record found, will throw original error');
                throw createError;
              }
            } catch (getError) {
              console.error('[CapacityMatrix] ❌ Failed to fetch or update existing record:', getError);
              throw getError;
            }
          } else {
            // Not a unique constraint error, throw it
            throw createError;
          }
        }

        if (!createdSuccessfully) {
          throw new Error('Failed to create or update SCIO capacity record');
        }

        // Log activity if successfully created
        if (createdRecordId) {
          await activityLogApi.logActivity(
            'created',
            'ScioTeamCapacity',
            createdRecordId,
            { department: dept, weekStartDate: weekDate, capacity }
          );
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] ❌ Final error saving SCIO capacity:', errorMsg);
      alert(`Error al guardar capacidad SCIO (${dept} - ${weekDate}): ${errorMsg}`);
    }
  };

  // Debounced save to avoid too many API calls while typing
  const scioSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleScioTeamChange = (dept: Department, weekDate: string, newCapacity: number) => {
    if (!hasFullAccess) {
      return;
    }
    console.log('[CapacityMatrix] handleScioTeamChange called:', { dept, weekDate, newCapacity });

    // Update local state immediately
    setScioTeamMembers(prev => ({
      ...prev,
      [dept]: {
        ...(prev[dept] || {}),
        [weekDate]: newCapacity,
      },
    }));

    // Debounce the API call (wait 500ms after last keystroke)
    const timeoutKey = `${dept}-${weekDate}`;
    if (scioSaveTimeouts.current[timeoutKey]) {
      console.log('[CapacityMatrix] Clearing previous timeout for key:', timeoutKey);
      clearTimeout(scioSaveTimeouts.current[timeoutKey]);
    }
    console.log('[CapacityMatrix] Setting debounce timeout for key:', timeoutKey);
    scioSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      console.log('[CapacityMatrix] Debounce timeout fired for key:', timeoutKey);
      saveScioTeamCapacity(dept, weekDate, newCapacity);
    }, 500);
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
  const isSyncingHorizontalScrollRef = useRef(false);
  const syncedBaseScrollLeftRef = useRef(0);

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
    }>();

    projects.forEach((proj) => {
      DEPARTMENTS.forEach((dept) => {
        let deptStartDate: string | undefined;
        let deptDuration = 0;

        if (dept === 'PM') {
          deptStartDate = proj.startDate;
          deptDuration = proj.numberOfWeeks || 0;
        } else {
          const deptStages = proj.departmentStages?.[dept];
          const deptFirstStage = deptStages && deptStages.length > 0 ? deptStages[0] : null;
          deptStartDate = deptFirstStage?.departmentStartDate;
          deptDuration = deptFirstStage?.durationWeeks || 0;

          if (!deptDuration && deptFirstStage?.weekEnd && deptFirstStage?.weekStart) {
            deptDuration = deptFirstStage.weekEnd - deptFirstStage.weekStart + 1;
          }

          if (!deptStartDate && deptFirstStage?.weekStart && proj.startDate) {
            const fallbackStart = parseISODate(proj.startDate);
            fallbackStart.setDate(fallbackStart.getDate() + ((deptFirstStage.weekStart - 1) * 7));
            deptStartDate = formatToISO(fallbackStart);
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
        const deptDisplayDate = deptStartDate
          ? new Date(deptStartDate).toLocaleDateString(locale)
          : t.notConfigured;

        map.set(`${proj.id}|${dept}`, {
          deptStartDate,
          deptEndDate,
          deptDisplayDate,
          effectiveStartDate,
          effectiveEndDate,
        });
      });
    });

    return map;
  }, [projects, locale, t.notConfigured]);
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
      if (!cellEntry.stage && assignment.stage) {
        cellEntry.stage = assignment.stage;
      }
      if (cellEntry.comment === undefined && assignment.comment) {
        cellEntry.comment = assignment.comment;
      }
      byCell.set(cellKey, cellEntry);

      const deptWeekKey = `${dept}|${normalizedWeekStart}`;
      deptWeekTotals.set(deptWeekKey, (deptWeekTotals.get(deptWeekKey) || 0) + assignment.hours);

      if (assignment.externalHours) {
        deptWeekExternalTotals.set(
          deptWeekKey,
          (deptWeekExternalTotals.get(deptWeekKey) || 0) + assignment.externalHours
        );
      }
    });

    return { byCell, deptWeekTotals, deptWeekExternalTotals };
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
    return projects.filter((proj) => {
      if (proj.visibleInDepartments && proj.visibleInDepartments.length > 0) {
        return proj.visibleInDepartments.includes(dept);
      }
      return true;
    });
  }, [projects, departmentFilter]);

  const generalProjects = useMemo(() => {
    if (departmentFilter !== 'General') {
      return [];
    }

    const { rangeStart, rangeEnd } = weekRange;
    return projects.filter((proj) => {
      if (proj.visibleInDepartments && proj.visibleInDepartments.length > 0) {
        return false;
      }

      const projectStart = proj.startDate || '';
      const projectEnd = proj.endDate || proj.startDate || '';
      const projectOverlapsRange = projectStart && projectEnd
        ? projectStart <= rangeEnd && projectEnd >= rangeStart
        : false;

      const hasAssignmentsInRange = assignmentProjectIdsInRange.has(proj.id);

      return projectOverlapsRange || hasAssignmentsInRange;
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

  const isPlaceholderEmployee = (emp?: Employee | null) =>
    !!emp && (emp.role === 'Placeholder' || emp.name.endsWith('Placeholder'));

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

  // Get projects that are not visible in the current department (available for import)
  const getAvailableProjectsForImport = (): Project[] => {
    const dept = departmentFilter as Department;
    return projects.filter(proj => {
      // Exclude projects that already have this department in visibleInDepartments
      if (proj.visibleInDepartments && proj.visibleInDepartments.includes(dept)) {
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
      setProjectZoom(projectId, boundedZoom);
      return;
    }
    setZoom(boundedZoom);
  };

  const setScrollLeftIfNeeded = (container: HTMLDivElement | null, targetScrollLeft: number) => {
    if (!container) return;
    if (Math.abs(container.scrollLeft - targetScrollLeft) > 0.5) {
      container.scrollLeft = targetScrollLeft;
    }
  };

  const syncHorizontalScrollToCanonical = (canonicalScrollLeft: number) => {
    const safeCanonicalScrollLeft = Math.max(0, canonicalScrollLeft);
    syncedBaseScrollLeftRef.current = safeCanonicalScrollLeft;

    if (isGeneralView) {
      setScrollLeftIfNeeded(generalCapacityScrollRef.current, safeCanonicalScrollLeft);
    } else {
      setScrollLeftIfNeeded(departmentCapacityScrollRef.current, safeCanonicalScrollLeft);
    }

    projectTableRefs.current.forEach((container) => {
      setScrollLeftIfNeeded(container, safeCanonicalScrollLeft);
    });
  };

  const runSyncedHorizontalScroll = (canonicalScrollLeft: number) => {
    if (isSyncingHorizontalScrollRef.current) return;

    isSyncingHorizontalScrollRef.current = true;
    syncHorizontalScrollToCanonical(canonicalScrollLeft);

    requestAnimationFrame(() => {
      isSyncingHorizontalScrollRef.current = false;
    });
  };

  const handleCapacityHorizontalScroll = (scrollLeft: number) => {
    if (isSyncingHorizontalScrollRef.current) return;
    runSyncedHorizontalScroll(scrollLeft);
  };

  const handleProjectHorizontalScroll = (scrollLeft: number) => {
    if (isSyncingHorizontalScrollRef.current) return;
    runSyncedHorizontalScroll(scrollLeft);
  };

  // Effect to reset scroll to first week when departmentFilter changes
  useEffect(() => {
    syncedBaseScrollLeftRef.current = 0;
    syncHorizontalScrollToCanonical(0);
  }, [departmentFilter]);

  // Keep alignment after zoom changes/re-renders.
  useEffect(() => {
    syncHorizontalScrollToCanonical(syncedBaseScrollLeftRef.current);
  }, [projectZooms, isGeneralView]);

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

    if (isMobile) {
      return (
        <div
          key={dept}
          className="w-[122px] bg-gradient-to-br from-blue-50 to-indigo-50 rounded p-0.5 border border-gray-100"
          title={`${departmentTitleLabel}
${t.quotedLabel}: ${formatHours(totalQuotedHoursValue)}h (CO ${formatHours(quotedChangeOrdersValue)}h)
${t.usedLabel}: ${formatHours(utilizedHoursValue)}h
${t.pronosticado}: ${formatHours(forecastedHoursValue)}h
${t.utilizationLabel}: ${utilizationPercent}%`}
        >
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <span className={`text-[9px] ${deptInfo.color}`}>{deptInfo.icon}</span>
            <span className="text-[9px] font-bold text-gray-800">{dept}</span>
          </div>
          {showDepartmentLongLabel && (
            <div className="text-[8px] text-gray-600 text-center font-semibold truncate mb-0.5">
              {deptLabel}
            </div>
          )}
          <div className="space-y-[2px] mb-0.5">
            <div className="flex items-center justify-between rounded bg-slate-100 border border-slate-300 px-1 py-[1px] text-slate-700 leading-none">
              <span className="text-[7px] font-semibold">{t.quotedLabel}</span>
              <span className="text-[8px] font-bold">{formatHours(totalQuotedHoursValue)}h</span>
            </div>
            <div className="flex items-center justify-between rounded bg-slate-100 border border-slate-300 px-1 py-[1px] text-slate-700 leading-none">
              <span className="text-[7px] font-semibold">{t.usedLabel}</span>
              <span className="text-[8px] font-bold">{formatHours(utilizedHoursValue)}h</span>
            </div>
            <div className="flex items-center justify-between rounded bg-slate-100 border border-slate-300 px-1 py-[1px] text-slate-700 leading-none">
              <span className="text-[7px] font-semibold">{t.pronosticado}</span>
              <span className="text-[8px] font-bold">{formatHours(forecastedHoursValue)}h</span>
            </div>
          </div>
          <div className={`px-0.5 py-[1px] rounded text-[9px] font-bold text-center leading-none ${utilizationColorInfo.bg} ${utilizationColorInfo.text}`}>
            {utilizationPercent}%
          </div>
        </div>
      );
    }

    return (
      <div
        key={dept}
        className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded p-0.5 border border-gray-100"
        title={`${departmentTitleLabel}
${t.quotedLabel}: ${formatHours(totalQuotedHoursValue)}h (CO ${formatHours(quotedChangeOrdersValue)}h)
${t.usedLabel}: ${formatHours(utilizedHoursValue)}h
${t.pronosticado}: ${formatHours(forecastedHoursValue)}h
${t.utilizationLabel}: ${utilizationPercent}%`}
      >
        <div className="flex items-center justify-center gap-1 mb-0">
          <span className={`text-[9px] ${deptInfo.color}`}>{deptInfo.icon}</span>
          <span className="text-[9px] font-bold text-gray-800">{dept}</span>
        </div>
        {showDepartmentLongLabel && (
          <div className="text-[8px] text-gray-600 text-center font-semibold truncate mb-0.5">
            {deptLabel}
          </div>
        )}
        <div className="grid grid-cols-3 gap-0.5 text-center mb-0.5">
          <div className="rounded bg-slate-100 border border-slate-300 px-0.5 py-[1px] text-slate-700 leading-none">
            <div className="text-[7px] font-semibold truncate">{t.quotedLabel}</div>
            <div className="text-[8px] font-bold">{formatHours(totalQuotedHoursValue)}h</div>
          </div>
          <div className="rounded bg-slate-100 border border-slate-300 px-0.5 py-[1px] text-slate-700 leading-none">
            <div className="text-[7px] font-semibold truncate">{t.usedLabel}</div>
            <div className="text-[8px] font-bold">{formatHours(utilizedHoursValue)}h</div>
          </div>
          <div className="rounded bg-slate-100 border border-slate-300 px-0.5 py-[1px] text-slate-700 leading-none">
            <div className="text-[7px] font-semibold truncate">{t.pronosticado}</div>
            <div className="text-[8px] font-bold">{formatHours(forecastedHoursValue)}h</div>
          </div>
        </div>
        <div className={`px-0.5 py-[1px] rounded text-[9px] font-bold text-center leading-none ${utilizationColorInfo.bg} ${utilizationColorInfo.text}`}>
          {utilizationPercent}%
        </div>
      </div>
    );
  };

  const canEditDepartment = (department: Department): boolean => {
    if (hasFullAccess) return true;
    if (isReadOnly) return false;
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
    setEditingComment(initialComment);
    setSelectedEmployees(assignedEmployeeIds);
  };

  const handleSaveCell = async () => {
    if (!editingCell) return;
    if (!canEditDepartment(editingCell.department)) {
      alert(t.readOnlyView || 'Read-only view');
      return;
    }

    // For BUILD and PRG, use separate SCIO and external hours
    const isBuildOrPRG = editingCell && (editingCell.department === 'BUILD' || editingCell.department === 'PRG');
    const totalHours = isBuildOrPRG ? (editingScioHours + editingExternalHours) : editingHours;

    if (!editingCell || totalHours === 0) {
      setEditingCell(null);
      setEditingStage(null);
      setEditingComment('');
      setEditingScioHours(0);
      setInitialScioHours(0);
      setEditingExternalHours(0);
      setEditingHoursInput('');
      setEditingScioHoursInput('');
      setEditingExternalHoursInput('');
      setSelectedEmployees(new Set());
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

    // Persist exactly what user selected in the modal.
    // If selection is empty, we should remove current assignments instead of restoring previous ones.
    const targetEmployeeIds = Array.from(selectedEmployees).filter((employeeId) => {
      const emp = employeeById.get(employeeId);
      return !!emp &&
        emp.isActive &&
        !isPlaceholderEmployee(emp) &&
        !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0);
    });
    if (targetEmployeeIds.length > 0) {
      // Update or create assignments for selected employees
      const upsertPromises = targetEmployeeIds.map(async (employeeId) => {
        const existingAssign = deptAssignments.find(a => a.employeeId === employeeId);
        const hoursPerEmployee = Math.round((totalHours / targetEmployeeIds.length) * 100) / 100;

        // For BUILD and PRG, split hours proportionally
        let scioHours = editingScioHours;
        let externalHours = editingExternalHours;
        if (targetEmployeeIds.length > 1) {
          scioHours = Math.round((editingScioHours / targetEmployeeIds.length) * 100) / 100;
          externalHours = Math.round((editingExternalHours / targetEmployeeIds.length) * 100) / 100;
        }

        const updateData: any = {
          hours: hoursPerEmployee,
          stage: editingStage,
          comment: editingComment || undefined,
        };

        // Add SCIO and external hours for BUILD and PRG departments
        if (isBuildOrPRG) {
          updateData.scioHours = scioHours;
          updateData.externalHours = externalHours;
        }

        if (existingAssign) {
          // Update existing assignment
          await updateAssignment(existingAssign.id, updateData, { skipRefetch: true });
        } else {
          // Create new assignment
          if (editingCell.projectId) {
            const newAssignment: any = {
              employeeId,
              projectId: editingCell.projectId,
              weekStartDate: editingCell.weekStart,
              hours: hoursPerEmployee,
              stage: editingStage,
              comment: editingComment || undefined,
            };

            // Add SCIO and external hours for BUILD and PRG departments
            if (isBuildOrPRG) {
              newAssignment.scioHours = scioHours;
              newAssignment.externalHours = externalHours;
            }

            console.log('[CapacityMatrix] Creating new assignment for employee:', employeeId, newAssignment);
            await addAssignment(newAssignment);
          }
        }
      });
      await Promise.all(upsertPromises);

      // Delete assignments for employees that were deselected
      const assignmentsToDelete = deptAssignments.filter((assign) => !targetEmployeeIds.includes(assign.employeeId));
      await resetAssignmentsToZero(assignmentsToDelete);
    } else {
      const existingPlaceholderAssignment = deptAssignments.find((assign) => {
        const emp = employeeById.get(assign.employeeId) || assign.employee;
        return !!emp && isPlaceholderEmployee(emp);
      });

      // No resources selected: keep at most one placeholder assignment with the entered hours.
      // Reset all non-placeholder assignments to avoid delete throttling.
      const assignmentsToReset = deptAssignments.filter((assign) => assign.id !== existingPlaceholderAssignment?.id);
      await resetAssignmentsToZero(assignmentsToReset);

      // Create new assignment for placeholder resource when no one is selected
      console.log('[CapacityMatrix] Looking for available employee in department:', editingCell.department);
      console.log('[CapacityMatrix] All employees:', employees.map(e => ({ name: e.name, dept: e.department, active: e.isActive })));
      const availableEmployee = await getOrCreatePlaceholderEmployee(editingCell.department);

      console.log('[CapacityMatrix] Found available employee:', availableEmployee);
      console.log('[CapacityMatrix] Project ID:', editingCell.projectId);

      if (availableEmployee && editingCell.projectId) {
        const placeholderUpdateData: any = {
          hours: totalHours,
          stage: editingStage,
          comment: editingComment || undefined,
        };

        // Add SCIO and external hours for BUILD and PRG departments
        if (isBuildOrPRG) {
          placeholderUpdateData.scioHours = editingScioHours;
          placeholderUpdateData.externalHours = editingExternalHours;
        }

        if (existingPlaceholderAssignment) {
          await updateAssignment(existingPlaceholderAssignment.id, placeholderUpdateData, { skipRefetch: true });
        } else {
          const newAssignment: any = {
            employeeId: availableEmployee.id,
            projectId: editingCell.projectId,
            weekStartDate: editingCell.weekStart,
            ...placeholderUpdateData,
          };
          console.log('[CapacityMatrix] Creating new assignment:', newAssignment);
          await addAssignment(newAssignment);
        }
      } else {
        if (!availableEmployee) {
          console.error('[CapacityMatrix] No placeholder employee available for department:', editingCell.department);
          alert('No se pudo crear un recurso automatico para guardar estas horas. Intenta de nuevo.');
        }
        if (!editingCell.projectId) {
          console.error('[CapacityMatrix] No project ID available');
          alert('Error: No se encontro el ID del proyecto.');
        }
      }
    }

    setEditingCell(null);
    setEditingStage(null);
    setEditingComment('');
    setEditingScioHours(0);
    setInitialScioHours(0);
    setEditingExternalHours(0);
    setEditingHoursInput('');
    setEditingScioHoursInput('');
    setEditingExternalHoursInput('');
    setSelectedEmployees(new Set());

    // Refresh in background so the modal closes immediately after save.
    void fetchAssignments(true);
  };

  const renderCellContent = (department: Department, weekStart: string, project?: Project) => {
    const projectId = project?.id;
    const { totalHours, talent, stage, assignments: cellAssignments, comment: cellComment } = getDepartmentWeekData(department, weekStart, projectId);
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
    const stageColor = stage ? getStageColor(stage) : null;
    const isGeneralView = departmentFilter === 'General';

    // Get project info for tooltip
    const projectStartDate = projectId ? (projectStartDisplayById.get(projectId) || 'N/A') : 'N/A';
    const deptDisplayDate = deptMeta?.deptDisplayDate || t.notConfigured;

    // Build tooltip text, including comment if present
    let tooltipText = `📅 ${t.projectTooltip}: ${projectStartDate}\n👷 ${department}: ${deptDisplayDate}`;
    if (cellComment) {
      tooltipText += `\n\n💬 ${cellComment}`;
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
    if (totalHours === 0 && cellAssignments.length === 0) {
      const canEdit = departmentFilter !== 'General' && canEditDepartment(departmentFilter as Department);

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
          cellBgClass = 'bg-purple-100';
          cellTextClass = 'text-purple-600';
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
          onClick={() => canEdit && handleEditCell(department, weekStart, projectId)}
          className={`p-3 text-center text-sm h-full flex flex-col items-center justify-center rounded ${canEdit ? 'cursor-pointer hover:opacity-80' : ''} ${cellBgClass} ${cellTextClass}`}
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

    const outOfEstimatedRange = projectId ? !isDeptWeekInRange : false;

    return (
      <div
        className={`p-1 rounded text-center text-xs font-semibold h-full flex flex-col items-center justify-center relative group ${
          stageColor ? stageColor.bg : 'bg-blue-100'
        } ${stageColor ? stageColor.text : 'text-blue-900'} ${
          outOfEstimatedRange ? 'border border-dashed border-red-500' : ''
        }`}
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
            💬
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
    // These are company placeholders used in "Ocupación semanal total", not actual resources
    const deptEmployees = employees.filter(emp =>
      emp.department === editingCell.department &&
      emp.isActive &&
      !(emp.isSubcontractedMaterial && emp.subcontractCompany === emp.name && emp.capacity === 0)
    );
    const isBuildOrPRGDepartment = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
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
    const scioInputLocked = selectedEmployeeList.length > 0 && hasExternalSelected && !hasInternalSelected && initialScioHours === 0;
    const weekData = weekDataByDate.get(editingCell.weekStart);
    const weekNum = weekData?.weekNum || 1;
    const year = weekData?.isNextYear ? selectedYear + 1 : selectedYear;

    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => {
            setEditingCell(null);
            setEditingStage(null);
            setEditingHours(0);
            setEditingComment('');
            setEditingHoursInput('');
            setEditingScioHoursInput('');
            setEditingExternalHoursInput('');
            setInitialScioHours(0);
            setSelectedEmployees(new Set());
          }}
        />
        {/* Modal */}
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-2xl p-6 w-96 z-50 max-h-screen overflow-y-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800">
              {t.editAssignment} - {t.weekAbbr} {weekNum}/{year}
            </h3>
            <button
              onClick={() => {
                setEditingCell(null);
                setEditingStage(null);
                setEditingHours(0);
                setEditingComment('');
                setEditingHoursInput('');
                setEditingScioHoursInput('');
                setEditingExternalHoursInput('');
                setInitialScioHours(0);
                setSelectedEmployees(new Set());
              }}
              className="text-gray-500 hover:text-gray-700 transition text-2xl leading-none"
            >
              ✕
            </button>
          </div>

          {/* Hours input - For BUILD and PRG, show separate SCIO and External hours */}
          {editingCell && (editingCell.department === 'BUILD' || editingCell.department === 'PRG') ? (
            <div className="mb-4 space-y-3">
              {/* SCIO Hours input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.scioHours}</label>
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
                      // Update total hours for backward compatibility
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-500"
                  placeholder="0"
                />
              </div>

              {/* External Hours input - conditionally shown based on selected external resource */}
              {selectedEmployeeList.length > 0 && hasExternalSelected && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.enterExternalHours}</label>
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
                        // Update total hours for backward compatibility
                        setEditingHours(editingScioHours + num);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveCell();
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          ) : (
            /* Standard hours input for other departments */
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">⏱️ {t.hours}</label>
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>
          )}

          {/* Stage selection dropdown */}
          {stageOptions.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">🏷️ {t.stage}</label>
              <select
                value={(editingStage || '') as string}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditingStage(value === '' ? null : (value as Stage));
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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

          {/* Employee selection - Hide for MFG department */}
          {deptEmployees.length > 0 && editingCell.department !== 'MFG' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">👥 {t.availableResources} ({deptEmployees.length})</label>
              <div className="space-y-2 min-h-[180px] max-h-52 overflow-y-auto bg-gray-50 p-2 rounded border border-gray-200">
                {deptEmployees.map((emp) => {
                  const isExternal = emp.isSubcontractedMaterial && emp.subcontractCompany;
                  const isBuildOrPRG = editingCell.department === 'BUILD' || editingCell.department === 'PRG';
                  return (
                    <label key={emp.id} className={`flex items-center gap-2 cursor-pointer p-1 rounded transition ${isExternal && isBuildOrPRG ? 'hover:bg-violet-50 bg-violet-50/50' : 'hover:bg-blue-50'}`}>
                      <input
                        type="checkbox"
                        checked={selectedEmployees.has(emp.id)}
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
                            🏢 {emp.subcontractCompany}
                          </span>
                        ) : (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                            🏠 Interno
                          </span>
                        )
                      )}
                      <span className="text-xs text-gray-500 ml-auto">{emp.capacity}{t.hoursPerSemWeek}</span>
                    </label>
                  );
                })}
              </div>
              {selectedEmployeeList.length > 0 && (
                <div className="mt-2 text-xs bg-blue-50 text-blue-700 p-2 rounded border border-blue-200">
                  ✓ {selectedEmployeeList.length} {selectedEmployeeList.length !== 1 ? t.resourcesSelected : t.resourceSelected}
                </div>
              )}
            </div>
          )}

          {/* Comment input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">💬 {t.comment}</label>
            <textarea
              value={editingComment}
              onChange={(e) => setEditingComment(e.target.value)}
              className="w-full min-h-[120px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
              placeholder={t.commentPlaceholder}
              rows={4}
            />
          </div>

          {/* Delete Confirmation Dialog */}
          {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center rounded-lg">
              <div className="bg-white rounded-lg shadow-2xl p-6 max-w-sm mx-4 border-2 border-red-200">
                <h3 className="text-lg font-bold text-red-700 mb-2">{t.deleteConfirm || 'Confirmar Eliminación'}</h3>
                <p className="text-sm text-gray-700 mb-4">
                  {t.deleteAllDataConfirm || '¿Estás seguro de que deseas eliminar estos datos?'}
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
                          setShowDeleteConfirm(false);
                          setEditingCell(null);
                          setEditingStage(null);
                          setEditingHours(0);
                          setEditingComment('');
                          setEditingHoursInput('');
                          setEditingScioHoursInput('');
                          setEditingExternalHoursInput('');
                          setSelectedEmployees(new Set());
                        }
                      } finally {
                        setIsDeleting(false);
                      }
                    }}
                    disabled={isDeleting}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition flex items-center gap-2"
                  >
                    {isDeleting && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                    {isDeleting ? (t.deletingData || 'Eliminando...') : '🗑️ ' + (t.delete || 'Eliminar')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 justify-between pt-4 border-t border-gray-200">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition border border-red-200"
            >
              🗑️ {t.delete}
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setEditingCell(null);
                  setEditingStage(null);
                  setEditingHours(0);
                  setEditingComment('');
                  setEditingHoursInput('');
                  setEditingScioHoursInput('');
                  setEditingExternalHoursInput('');
                  setSelectedEmployees(new Set());
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleSaveCell}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition"
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
    <div className="brand-page-shell h-full flex flex-col">
      {/* Edit Cell Modal */}
      {renderEditModal()}
      {/* Change Order Modal */}
      {isChangeOrderModalOpen && changeOrderContext && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
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
          {/* Zoom controls - ultra compact */}
          <div className="flex items-center gap-0.5 bg-[#ede8f5] rounded-md p-0.5 flex-shrink-0 border border-[#d5d1da]">
            <button
              onClick={() => setZoom(Math.max(50, zoom - 10))}
              className="p-0.5 hover:bg-[#e2dced] rounded transition text-[#2e1a47]"
              title={t.zoomOut}
            >
              <ZoomOut size={12} />
            </button>
            <span className="text-[9px] font-semibold text-[#2e1a47] w-6 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom(Math.min(200, zoom + 10))}
              className="p-0.5 hover:bg-[#e2dced] rounded transition text-[#2e1a47]"
              title={t.zoomIn}
            >
              <ZoomIn size={12} />
            </button>
          </div>

          {/* Year selector - ultra compact */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="border border-[#d5d1da] rounded px-1 py-0.5 text-[9px] font-semibold text-[#2e1a47] bg-[#f4f1f8] hover:bg-[#ebe6f2] transition flex-shrink-0"
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
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-[#2e1a47] hover:bg-[#3a2556] text-white text-[9px] font-semibold rounded transition flex-shrink-0"
            title={t.toggleLegend}
          >
            <span>{showLegend ? '▼' : '▶'}</span>
            <span className="hidden sm:inline">{t.legend}</span>
          </button>

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
                <div className="sticky top-0 z-40 mb-2 bg-gradient-to-r from-[#f2eef8] to-[#ece7f3] border border-[#d5d1da] rounded-lg p-2 shadow-sm">
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
                      onScroll={(e) => handleCapacityHorizontalScroll(e.currentTarget.scrollLeft)}
                    >
                    <div className="inline-block min-w-full">
                      {/* Week headers row */}
                      <div className="flex gap-0.5 mb-0.5">
                        {/* Empty cell for label column */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 text-[8px] font-bold text-indigo-700 flex items-center justify-center`}>
                          {t.people}
                        </div>

                        {/* Week number headers */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;
                          return (
                            <div
                              key={`dept-header-${weekData.date}`}
                              className={`w-10 flex-shrink-0 text-center text-[8px] font-bold px-1 py-0.5 rounded-md border-1.5 ${
                                isCurrentWeek
                                  ? CURRENT_WEEK_HEADER_CLASS
                                  : 'bg-blue-100 text-blue-900 border-blue-300'
                              }`}
                            >
                              CW{weekData.weekNum}
                            </div>
                          );
                        })}
                      </div>

                      {/* Total row - sum of occupied people in that week (or hours for MFG) */}
                      <div className="flex gap-0.5 mb-0.5">
                        {/* Label */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-orange-100 to-orange-50 text-orange-800 border-orange-300`}>
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
                          let bgColor = 'bg-green-300 border-green-400';
                          let textColor = 'text-green-900';

                          if (isMFG) {
                            // For MFG: color based on hours (different thresholds)
                            if (totalWeekHours >= 360) {
                              bgColor = 'bg-red-500 border-red-600';
                              textColor = 'text-white';
                            } else if (totalWeekHours >= 225) {
                              bgColor = 'bg-orange-400 border-orange-500';
                              textColor = 'text-white';
                            } else if (totalWeekHours >= 112.5) {
                              bgColor = 'bg-yellow-300 border-yellow-400';
                              textColor = 'text-yellow-900';
                            }
                          } else {
                            // For other departments: color based on people
                            if (displayValue >= 8) {
                              bgColor = 'bg-red-500 border-red-600';
                              textColor = 'text-white';
                            } else if (displayValue >= 5) {
                              bgColor = 'bg-orange-400 border-orange-500';
                              textColor = 'text-white';
                            } else if (displayValue >= 2.5) {
                              bgColor = 'bg-yellow-300 border-yellow-400';
                              textColor = 'text-yellow-900';
                            }
                          }

                          return (
                            <div
                              key={`total-${dept}-${weekData.date}`}
                              className={`w-10 flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-md border-1.5 text-[8px] font-bold ${bgColor} ${
                                isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''
                              }`}
                              title={`${t.totalLabel} - CW${weekData.weekNum}: ${displayValue.toFixed(2)} ${unit}`}
                            >
                              <div className={`${textColor} font-bold text-[9px]`}>
                                {displayValue.toFixed(2)}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* SCIO Team Members / Hours per Week row - edit capacity per week */}
                      <div className="flex gap-0.5 mb-0.5">
                        {/* Label */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-purple-100 to-purple-50 text-purple-800 border-purple-300`}>
                          {dept === 'MFG' ? t.hoursPerWeek : t.scioTeamMembers}
                        </div>

                        {/* Week inputs for SCIO capacity */}
                        <div className="flex gap-0.5">
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
                                className={`w-10 flex-shrink-0 border-1.5 rounded-md px-1 py-0.5 text-[8px] font-bold text-center focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-400 disabled:cursor-not-allowed disabled:opacity-60 ${
                                  isCurrentWeek ? CURRENT_WEEK_EDITABLE_CLASS : 'bg-gradient-to-b from-purple-50 to-purple-25 border-purple-300'
                                }`}
                                placeholder="0"
                                title={`Capacidad para la semana ${weekData.weekNum}`}
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
                            <div key={`subcontract-${company}`} className="flex gap-0.5 mb-0.5 group">
                              {/* Company Label with delete button */}
                              <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-violet-100 to-violet-50 text-violet-900 border-violet-400 shadow-sm hover:shadow-md transition-all`}>
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
                              <div className="flex gap-0.5">
                                {allWeeksData.map((weekData, idx) => {
                                  const isCurrentWeek = idx === currentDateWeekIndex;
                                  return (
                                    <div
                                      key={`subcontract-${company}-${weekData.date}`}
                                      className={`w-10 flex-shrink-0 border-1.5 rounded-md py-0.5 flex items-center justify-center transition-all ${
                                        isCurrentWeek
                                          ? CURRENT_WEEK_EDITABLE_CLASS
                                          : 'border-violet-300 bg-gradient-to-b from-violet-50 to-violet-25 hover:border-violet-400'
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
                                        className="w-8 text-[8px] font-bold bg-transparent focus:outline-none text-center border-none text-violet-900 disabled:cursor-not-allowed disabled:text-gray-400"
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
                            <div className="flex gap-0.5 mb-0.5">
                              {/* Label column - clickable to open popup */}
                              <button
                                onClick={() => setIsBuildModalOpen(true)}
                                className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-indigo-100 to-indigo-50 text-indigo-800 border-indigo-300 hover:from-indigo-200 hover:to-indigo-100 hover:border-indigo-400 cursor-pointer transition-all`}
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
                            <div key={`prg-external-${team}`} className="flex gap-0.5 mb-0.5 group">
                              {/* Team Label with delete button */}
                              <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-cyan-100 to-cyan-50 text-cyan-900 border-cyan-400 shadow-sm hover:shadow-md transition-all`}>
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
                              <div className="flex gap-0.5">
                                {allWeeksData.map((weekData, idx) => {
                                  const isCurrentWeek = idx === currentDateWeekIndex;
                                  return (
                                    <div
                                      key={`prg-external-${team}-${weekData.date}`}
                                      className={`w-10 flex-shrink-0 border-1.5 rounded-md py-0.5 flex items-center justify-center transition-all ${
                                        isCurrentWeek
                                          ? CURRENT_WEEK_EDITABLE_CLASS
                                          : 'border-cyan-300 bg-gradient-to-b from-cyan-50 to-cyan-25 hover:border-cyan-400'
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
                                        className="w-8 text-[8px] font-bold bg-transparent focus:outline-none text-center border-none text-cyan-900 disabled:cursor-not-allowed disabled:text-gray-400"
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
                            <div className="flex gap-0.5 mb-0.5">
                              {/* Label column - clickable to open popup */}
                              <button
                                onClick={() => setIsPRGModalOpen(true)}
                                className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-teal-100 to-teal-50 text-teal-800 border-teal-300 hover:from-teal-200 hover:to-teal-100 hover:border-teal-400 cursor-pointer transition-all`}
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
                        <div className="flex gap-0.5 mb-0.5">
                          {/* Label */}
                          <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-purple-100 to-purple-50 text-purple-800 border-purple-300`}>
                            {dept === 'BUILD' ? '🏢 Ext' : '👥 Ext'}
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
                                className={`w-10 flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-md border-1.5 text-[8px] font-bold text-purple-700 transition-all ${
                                  totalExternalHours > 0
                                    ? 'bg-purple-200 border-purple-400 shadow-sm'
                                    : 'bg-purple-50 border-purple-300'
                                } ${isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''}`}
                                title={`Horas externas - ${totalExternalHours}h`}
                              >
                                <div className="font-black text-[9px]">
                                  {totalExternalHours > 0 ? totalExternalHours : '-'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Capacity row - department capacity minus occupied (hours for MFG, people for others) */}
                      <div className="flex gap-0.5 mb-0.5">
                        {/* Label */}
                        <div className={`${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-green-100 to-green-50 text-green-800 border-green-300`}>
                          {t.capacityLabel}
                        </div>

                        {/* Week cells */}
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;

                            // Get SCIO Team Members / Hours per Week capacity for this week
                            const weekCapacity = scioTeamMembers[dept]?.[weekData.date] || 0;

                            // Calculate total hours occupied for this department this week
                            const deptWeekKey = `${dept}|${weekData.date}`;
                            const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;

                          // For MFG: use hours directly. For other departments: convert to people
                          const isMFG = dept === 'MFG';
                          const occupiedValue = isMFG ? totalWeekHours : totalWeekHours / 45;

                          // For BUILD department: include all subcontracted personnel in capacity calculation
                          // For PRG department: include external teams in capacity calculation
                          let totalCapacity = weekCapacity;
                          if (dept === 'BUILD') {
                            // Sum all subcontracted teams: predefined teams + custom teams added by user
                            // Predefined teams (AMI, VICER, ITAX, MCI, MG Electrical) use subcontractedPersonnel
                            // Custom teams use activeTeams with their own data in subcontractedPersonnel
                            const subcontractSum = Array.from(activeTeams).reduce((sum, company) => {
                              return sum + (subcontractedPersonnel[company]?.[weekData.date] || 0);
                            }, 0);

                            // Also add any predefined teams that might have data but aren't in activeTeams
                            const predefinedTeams = ['AMI', 'VICER', 'ITAX', 'MCI', 'MG Electrical'];
                            const predefinedSum = predefinedTeams.reduce((sum, company) => {
                              // Only count if not already in activeTeams (to avoid double counting)
                              if (!activeTeams.includes(company)) {
                                return sum + (subcontractedPersonnel[company]?.[weekData.date] || 0);
                              }
                              return sum;
                            }, 0);

                            totalCapacity = weekCapacity + subcontractSum + predefinedSum;
                          } else if (dept === 'PRG') {
                            const externalSum = prgActiveTeams.reduce((sum, team) => {
                              return sum + (prgExternalPersonnel[team]?.[weekData.date] || 0);
                            }, 0);
                            totalCapacity = weekCapacity + externalSum;
                          }

                          const availableCapacity = totalCapacity - occupiedValue;
                          const unit = isMFG ? 'h' : 'people';

                          // Determine color based on utilization percentage
                          let bgColor = 'bg-gray-200 border-gray-400';
                          let textColor = 'text-gray-700';
                          const utilizationPercentForCapacity = totalCapacity > 0
                            ? (occupiedValue / totalCapacity) * 100
                            : 0;

                          // If no capacity set, show gray
                          if (totalCapacity === 0) {
                            bgColor = 'bg-gray-200 border-gray-400';
                            textColor = 'text-gray-700';
                          } else if (utilizationPercentForCapacity >= 100) {
                            // Critical: 100%+ utilization
                            bgColor = 'bg-red-700 border-red-800 animate-pulse';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 90) {
                            // High: 90-99%
                            bgColor = 'bg-red-500 border-red-600';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 70) {
                            // Moderate: 70-89%
                            bgColor = 'bg-yellow-300 border-yellow-400';
                            textColor = 'text-yellow-900';
                          } else {
                            // Healthy: <70%
                            bgColor = 'bg-green-300 border-green-400';
                            textColor = 'text-green-900';
                          }

                          return (
                            <div
                              key={`capacity-${dept}-${weekData.date}`}
                              className={`w-10 flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-md border-1.5 text-[8px] font-bold ${bgColor} ${
                                isCurrentWeek ? CURRENT_WEEK_RING_CLASS : ''
                              }`}
                              title={`${t.capacityLabel} - CW${weekData.weekNum}: ${totalCapacity.toFixed(2)} ${unit} (Available: ${availableCapacity.toFixed(2)})`}
                            >
                              <div className={`${textColor} font-bold text-[9px]`}>
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

            <h2 className="text-sm font-bold mt-2 mb-1 text-gray-800 border-l-4 border-blue-600 pl-2">{t.projectsSection}</h2>

            {/* Projects in department view - each with individual zoom controls */}
            {/* Filter: If project has visibleInDepartments, only show in those departments. Otherwise, show in all. */}
            {orderedDepartmentProjects.map((proj) => {
              const dept = departmentFilter as Department;
              const scopeKey = getProjectOrderScopeKey(departmentFilter);
              const changeOrderSummary = getChangeOrderSummary(dept, proj.id);

              return (
                <div
                  key={proj.id}
                  className={`relative mb-2 border rounded-lg shadow-sm bg-white overflow-hidden transition ${
                    dragOverState?.projectId === proj.id && dragOverState?.scopeKey === scopeKey
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-300'
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
                  <div className="bg-gray-100 hover:bg-gray-200 cursor-pointer border-b border-gray-300" onClick={() => toggleProjectExpanded(proj.id)}>
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
                          <span className="text-gray-400">•</span>
                          <span className="text-gray-600">{proj.client}</span>
                          <span className="text-gray-400">•</span>
                          <span className="bg-blue-100 text-blue-700 px-1 py-0 rounded text-xs font-semibold">
                            {(projectDurationWeeksById.get(proj.id) ?? proj.numberOfWeeks)} weeks
                          </span>
                          {proj.projectManagerId && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                👨‍💼 {projectManagerNameById.get(proj.id) || 'PM'}
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
                        className="overflow-x-auto border border-gray-300 bg-white"
                        style={{ scrollBehavior: 'smooth' }}
                        onScroll={(e) => handleProjectHorizontalScroll(e.currentTarget.scrollLeft)}
                        ref={(el) => {
                          if (el) {
                            projectTableRefs.current.set(proj.id, el);
                            const targetScrollLeft = syncedBaseScrollLeftRef.current;
                            setScrollLeftIfNeeded(el, targetScrollLeft);
                          } else {
                            projectTableRefs.current.delete(proj.id);
                          }
                        }}
                      >
                      <table className="border-collapse text-xs w-full">
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
                          <th className={`border border-blue-500 px-1 py-0.5 text-left font-bold sticky left-0 bg-blue-600 z-10 uppercase text-xs ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                                      ? 'bg-gradient-to-b from-blue-500 to-blue-600 border-blue-400 text-white'
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
                        <td className={`border border-gray-300 px-1 py-0 text-[9px] font-semibold text-slate-700 bg-slate-100 sticky left-0 z-10 uppercase tracking-wide ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
                          {t.projectWeek || 'Project Week'}
                        </td>
                        {allWeeksData.map((weekData, weekIdx) => {
                          const isCurrentWeekColumn = weekIdx === currentDateWeekIndex;
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
                        <td className={`border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 sticky left-0 z-10 pl-0.5 ${DEPARTMENT_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                          return (
                            <td
                              key={`${proj.id}-${dept}-${week}`}
                              data-week-index={weekIdx}
                              onClick={() => canEditThisDepartment && handleEditCell(dept, week, proj.id)}
                              className={`border p-0 relative text-xs transition-all ${
                                canEditThisDepartment ? 'cursor-pointer hover:shadow-md' : ''
                              } ${
                                isCurrentWeekColumn
                                  ? CURRENT_WEEK_SOFT_CELL_CLASS
                                  : 'border-gray-300'
                              }`}
                            >
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
              <div className="sticky top-0 z-40 mb-0.5 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-0.5 shadow-sm">
                <h2 className="text-[10px] font-bold mb-0.5 text-green-800 flex items-center gap-0.5 justify-between">
                  <div className="flex items-center gap-0.5">
                    <span>💚</span>
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
                onScroll={(e) => handleCapacityHorizontalScroll(e.currentTarget.scrollLeft)}
              >
                <div className="inline-block min-w-full">
                  {/* Week headers row */}
                  <div className="flex gap-0.5 mb-0.5">
                    {/* Empty cell for department names column */}
                    <div className={`${GENERAL_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0`}></div>

                    {/* Week number headers */}
                    {allWeeksData.map((weekData, idx) => {
                      const isCurrentWeek = idx === currentDateWeekIndex;
                      return (
                        <div
                          key={`header-${weekData.date}`}
                          className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 text-center text-[8px] font-bold p-0.5 rounded border ${
                            isCurrentWeek
                              ? CURRENT_WEEK_HEADER_CLASS
                              : 'bg-blue-100 text-blue-900 border-blue-300'
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
                      <div key={`dept-${dept}`} className="flex gap-0.5 mb-0.5">
                        {/* Department name column */}
                        <div className={`${GENERAL_LEFT_COLUMN_WIDTH_CLASS} flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold p-0.5 rounded border ${deptIcon.color} bg-white`}>
                          <span title={dept}>{dept}</span>
                        </div>

                        {/* Week cells for this department */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;

                          // Get SCIO Team Members / Hours per Week capacity for this week
                          const weekCapacity = scioTeamMembers[dept]?.[weekData.date] || 0;

                          // Calculate total hours occupied for this department this week
                          const deptWeekKey = `${dept}|${weekData.date}`;
                          const totalWeekHours = assignmentIndex.deptWeekTotals.get(deptWeekKey) || 0;

                          // For MFG: use hours directly. For other departments: convert to people
                          const isMFG = dept === 'MFG';
                          const occupiedValue = isMFG ? totalWeekHours : totalWeekHours / 45;

                          // For BUILD department: include all subcontracted personnel in capacity calculation
                          // For PRG department: include external teams in capacity calculation
                          let totalCapacity = weekCapacity;
                          if (dept === 'BUILD') {
                            // Sum all subcontracted teams: predefined teams + custom teams added by user
                            const subcontractSum = Array.from(activeTeams).reduce((sum, company) => {
                              return sum + (subcontractedPersonnel[company]?.[weekData.date] || 0);
                            }, 0);

                            // Also add any predefined teams that might have data but aren't in activeTeams
                            const predefinedTeams = ['AMI', 'VICER', 'ITAX', 'MCI', 'MG Electrical'];
                            const predefinedSum = predefinedTeams.reduce((sum, company) => {
                              // Only count if not already in activeTeams (to avoid double counting)
                              if (!activeTeams.includes(company)) {
                                return sum + (subcontractedPersonnel[company]?.[weekData.date] || 0);
                              }
                              return sum;
                            }, 0);

                            totalCapacity = weekCapacity + subcontractSum + predefinedSum;
                          } else if (dept === 'PRG') {
                            const externalSum = prgActiveTeams.reduce((sum, team) => {
                              return sum + (prgExternalPersonnel[team]?.[weekData.date] || 0);
                            }, 0);
                            totalCapacity = weekCapacity + externalSum;
                          }

                          const availableCapacity = totalCapacity - occupiedValue;
                          const unit = isMFG ? 'h' : 'people';

                          // Determine color based on utilization percentage
                          let bgColor = 'bg-gray-200 border-gray-400';
                          let textColor = 'text-gray-700';
                          const utilizationPercentForCapacity = totalCapacity > 0
                            ? (occupiedValue / totalCapacity) * 100
                            : 0;

                          // If no capacity set, show gray
                          if (totalCapacity === 0) {
                            bgColor = 'bg-gray-200 border-gray-400';
                            textColor = 'text-gray-700';
                          } else if (utilizationPercentForCapacity >= 100) {
                            // Critical: 100%+ utilization
                            bgColor = 'bg-red-700 border-red-800 animate-pulse';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 90) {
                            // High: 90-99%
                            bgColor = 'bg-red-500 border-red-600';
                            textColor = 'text-white';
                          } else if (utilizationPercentForCapacity >= 70) {
                            // Moderate: 70-89%
                            bgColor = 'bg-yellow-300 border-yellow-400';
                            textColor = 'text-yellow-900';
                          } else {
                            // Healthy: <70%
                            bgColor = 'bg-green-300 border-green-400';
                            textColor = 'text-green-900';
                          }

                          return (
                            <div
                              key={`${dept}-${weekData.date}`}
                              className={`${WEEK_COLUMN_WIDTH_CLASS} flex-shrink-0 flex flex-col items-center justify-center p-0.5 rounded border text-[7px] font-semibold ${bgColor} ${
                                isCurrentWeek ? 'ring-1 ring-slate-500 shadow-sm' : ''
                              }`}
                              title={`${dept} - CW${weekData.weekNum}${weekData.isNextYear ? ` (${selectedYear + 1})` : ''}: ${totalCapacity.toFixed(2)} ${unit} (Available: ${availableCapacity.toFixed(2)})`}
                            >
                              {totalCapacity > 0 ? (
                                <div className={`${textColor} font-bold text-[7px]`}>
                                  {availableCapacity.toFixed(2)}
                                </div>
                              ) : (
                                <div className={`${textColor} text-[6px]`}>—</div>
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
                💚 Show Capacity
              </button>
            )}

            <h2 className="text-sm font-bold mt-2 mb-1 text-gray-800 border-l-4 border-blue-600 pl-2">Projects Matrix</h2>

              {orderedGeneralProjects.map((proj) => {
                const scopeKey = getProjectOrderScopeKey('General');
                return (
                <div
                  key={proj.id}
                  className={`relative mb-1 border rounded-lg shadow-sm bg-white overflow-hidden transition ${
                    dragOverState?.projectId === proj.id && dragOverState?.scopeKey === scopeKey
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-300'
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
                  <div className="bg-gray-100 hover:bg-gray-200 cursor-pointer p-1 border-b border-gray-300" onClick={() => toggleProjectExpanded(proj.id)}>
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
                          <span className="text-gray-400">•</span>
                          <span className="text-gray-600">{proj.client}</span>
                          <span className="text-gray-400">•</span>
                          <span className="bg-blue-100 text-blue-700 px-1 py-0 rounded text-xs font-semibold">
                            {(projectDurationWeeksById.get(proj.id) ?? proj.numberOfWeeks)} weeks
                          </span>
                          {proj.projectManagerId && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                👨‍💼 {projectManagerNameById.get(proj.id) || 'PM'}
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
                      <div className="bg-white rounded p-0.5 border border-gray-200 m-0.5 overflow-x-auto" style={{ scrollBehavior: 'smooth' }}>
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
                        onScroll={(e) => handleProjectHorizontalScroll(e.currentTarget.scrollLeft)}
                        ref={(el) => {
                          if (el) {
                            projectTableRefs.current.set(proj.id, el);
                            const targetScrollLeft = syncedBaseScrollLeftRef.current;
                            setScrollLeftIfNeeded(el, targetScrollLeft);
                          } else {
                            projectTableRefs.current.delete(proj.id);
                          }
                        }}
                      >
                      <table className="border-collapse text-xs w-full">
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
                            <th className={`border border-blue-500 px-1 py-0.5 text-left font-bold sticky left-0 bg-blue-600 z-30 uppercase text-xs ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                                        ? 'bg-gradient-to-b from-blue-500 to-blue-600 border-blue-400 text-white'
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
                            <td className={`border border-gray-300 px-1 py-0 text-[9px] font-semibold text-slate-700 bg-slate-100 sticky left-0 z-10 uppercase tracking-wide ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                                <td className={`border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 sticky left-0 z-10 pl-0.5 ${GENERAL_LEFT_COLUMN_WIDTH_CLASS}`}>
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
                                  const stageColor = assignmentStage ? getStageColor(assignmentStage) : null;

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

                                  return (
                                    <td
                                      key={`${proj.id}-${dept}-${week}`}
                                      data-week-index={weekIdx}
                                      className={`border p-0 relative text-xs ${
                                        isCurrentWeekColumn
                                          ? CURRENT_WEEK_SOFT_CELL_CLASS
                                          : 'border-gray-300'
                                      } ${
                                        stageColor ? stageColor.bg : isInRange ? 'bg-green-50' : 'bg-gray-50'
                                      }`}
                                    >
                                      {totalHours === 0 ? (
                                        <div className={`p-0.5 text-center text-[10px] rounded font-medium leading-tight relative ${
                                          stageColor
                                            ? `${stageColor.text}`
                                            : isDeptWeekInRange
                                              ? isDeptFirstWeek
                                                ? 'text-orange-600 bg-orange-100'
                                                : 'text-purple-600 bg-purple-100'
                                              : isInRange
                                                ? 'text-green-600 bg-green-50'
                                                : 'text-gray-400'
                                        }`}>
                                          {cellComment && (
                                            <button
                                              onClick={() => setViewingComment({ comment: cellComment, projectName: proj.name, department: dept })}
                                              className="absolute top-0.5 right-0.5 text-amber-600 hover:text-amber-800 cursor-pointer"
                                              title={cellComment}
                                            >
                                              💬
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
                                            '—'
                                          )}
                                        </div>
                                      ) : (
                                        <div className={`p-0 rounded text-center text-[10px] font-semibold leading-tight relative ${
                                          stageColor ? `${stageColor.bg} ${stageColor.text}` : 'bg-blue-100 text-blue-900'
                                        } ${!isDeptWeekInRange ? 'border border-dashed border-red-500' : ''}`}>
                                          {cellComment && (
                                            <button
                                              onClick={() => setViewingComment({ comment: cellComment, projectName: proj.name, department: dept })}
                                              className="absolute top-0.5 left-0.5 text-amber-600 hover:text-amber-800 cursor-pointer"
                                              title={cellComment}
                                            >
                                              💬
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

      {/* Leyenda - Expandable in place */}
      {showLegend && (
        <div className="mx-2 my-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            {departmentFilter === 'General' && (
              <>
                <h3 className="text-xs font-bold text-indigo-900 mb-2">Global Panel - Colors by Utilization</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-green-300 rounded border border-green-400 flex-shrink-0"></div>
                    <span className="text-gray-700 font-medium">0-50% (Low)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-yellow-300 rounded border border-yellow-400 flex-shrink-0"></div>
                    <span className="text-gray-700 font-medium">50-75% (Moderate)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-orange-400 rounded border border-orange-500 flex-shrink-0"></div>
                    <span className="text-gray-700 font-medium">75-100% (High)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-red-500 rounded border border-red-600 flex-shrink-0"></div>
                    <span className="text-gray-700 font-medium">100%+ (Critical)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-gray-100 rounded border border-gray-300 flex-shrink-0"></div>
                    <span className="text-gray-700 font-medium">No data</span>
                  </div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-100 rounded border border-blue-300 flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">h</div>
                <span className="text-gray-700 font-medium">Hours</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-white rounded border border-gray-300 flex items-center justify-center text-gray-400 flex-shrink-0">—</div>
                <span className="text-gray-700 font-medium">No assignments</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-100 rounded border border-green-300 flex items-center justify-center text-green-600 text-sm flex-shrink-0">○</div>
                <span className="text-gray-700 font-medium">Within range</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-slate-300 rounded border border-slate-500 text-slate-900 flex items-center justify-center text-xs font-bold flex-shrink-0">S</div>
                <span className="text-gray-700 font-medium">Current week</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-red-50 rounded border border-dashed border-red-500 flex-shrink-0"></div>
                <span className="text-gray-700 font-medium">Out of range</span>
              </div>
            </div>
            <div className="text-xs text-blue-900">
              {departmentFilter === 'General' && (
                <span>📌 Read-only view. Select a department to edit. Colors in the Global panel represent weekly capacity utilization per department.</span>
              )}
              {departmentFilter !== 'General' && (
                <span>💡 Background colors indicate project stages.</span>
              )}
            </div>
          </div>
        )}

        {/* Quick Project Creation Modal */}
        {showQuickProjectModal && canManageProjectsInCurrentDepartment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-blue-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">➕ {t.createProject}</h2>
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
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">📋 {t.job}</label>
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
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">👥 {t.customer}</label>
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
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">📅 {t.startDate}</label>
                  <WeekNumberDatePicker
                    value={quickProjectForm.startDate}
                    onChange={(date) => setQuickProjectForm({ ...quickProjectForm, startDate: date })}
                    language={language}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                  />
                </div>

                {/* Number of Weeks */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">⏱️ {t.numberOfWeeks}</label>
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
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">🏭 {t.facility}</label>
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
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">💚 {t.budgetHours || 'Horas Presupuestadas'}</label>
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

        {/* Import Existing Project Modal */}
        {showImportProjectModal && canManageProjectsInCurrentDepartment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-amber-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">📂 {t.importProject || 'Import Existing Project'}</h2>
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
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">📋 {t.selectProject || 'Select Project'}</label>
                  <select
                    value={importProjectForm.projectId}
                    onChange={(e) => setImportProjectForm({ ...importProjectForm, projectId: e.target.value })}
                    className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition bg-white text-sm"
                  >
                    <option value="">{t.selectAProject || '-- Select a project --'}</option>
                    {getAvailableProjectsForImport().map((proj) => (
                      <option key={proj.id} value={proj.id}>
                        {proj.name} - {proj.client}
                      </option>
                    ))}
                  </select>
                  {importProjectForm.projectId && (() => {
                    const selectedProject = projects.find(p => p.id === importProjectForm.projectId);
                    return selectedProject && (
                      <div className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-600">
                        <div><strong>{t.facility || 'Facility'}:</strong> {selectedProject.facility}</div>
                        <div><strong>{t.projectDates || 'Project Dates'}:</strong> {selectedProject.startDate} → {selectedProject.endDate}</div>
                      </div>
                    );
                  })()}
                </div>

                {/* Start Date for this department */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">📅 {t.startDateDept || 'Start Date for'} {departmentFilter}</label>
                  <WeekNumberDatePicker
                    value={importProjectForm.startDate}
                    onChange={(date) => setImportProjectForm({ ...importProjectForm, startDate: date })}
                    language={language}
                    className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition bg-white text-sm"
                  />
                </div>

                {/* Number of Weeks for this department */}
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">⏱️ {t.numberOfWeeks}</label>
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
                  <label className="block text-sm font-bold mb-1.5 text-gray-700">💚 {t.budgetHours || 'Budget Hours'}</label>
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
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-rose-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">
                  {language === 'es' ? '📄 Exportar Timeline PDF' : '📄 Export Timeline PDF'}
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
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => {
                setIsPRGModalOpen(false);
                setPRGTeamName('');
              }}
            />
            {/* Modal */}
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50">
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
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => {
                setIsBuildModalOpen(false);
                setBuildTeamName('');
              }}
            />
            {/* Modal */}
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50">
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
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-amber-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">💬 {t.comment}</h2>
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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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
