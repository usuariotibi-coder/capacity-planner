import { useState, useEffect, useRef } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { projectsApi, scioTeamCapacityApi, subcontractedTeamCapacityApi, prgExternalTeamCapacityApi, activityLogApi } from '../services/api';
import { getAllWeeksWithNextYear, formatToISO } from '../utils/dateUtils';
import { calculateTalent, getStageColor, getUtilizationColor } from '../utils/stageColors';
import { getDepartmentIcon, getDepartmentLabel } from '../utils/departmentIcons';
import { generateId } from '../utils/id';
import { ZoomIn, ZoomOut, ChevronDown, ChevronUp, Pencil, Plus, Minus, X, FolderPlus } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import type { Department, Stage, Project } from '../types';

type DepartmentFilter = 'General' | Department;

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];

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

export function CapacityMatrixPage({ departmentFilter }: CapacityMatrixPageProps) {
  const employees = useEmployeeStore((state) => state.employees);
  const addEmployee = useEmployeeStore((state) => state.addEmployee);
  const assignments = useAssignmentStore((state) => state.assignments);
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
  const t = useTranslation(language);

  const [editingCell, setEditingCell] = useState<CellEditState | null>(null);
  const [editingHours, setEditingHours] = useState<number>(0);
  const [editingScioHours, setEditingScioHours] = useState<number>(0);
  const [editingExternalHours, setEditingExternalHours] = useState<number>(0);
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
        return JSON.parse(saved);
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
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading prgExternalPersonnel from localStorage', e);
      }
    }
    return {};
  });

  // Modal state for adding PRG external teams
  const [isPRGModalOpen, setIsPRGModalOpen] = useState(false);
  const [prgTeamName, setPRGTeamName] = useState('');

  // Modal state for adding BUILD subcontracted teams
  const [isBuildModalOpen, setIsBuildModalOpen] = useState(false);
  const [buildTeamName, setBuildTeamName] = useState('');

  // Per-project zoom levels
  const [projectZooms, setProjectZooms] = useState<Record<string, number>>({});

  // Utilized hours editing state (Used Hours)
  const [editingUtilized, setEditingUtilized] = useState<{ projectId: string; department: Department } | null>(null);
  const [utilizedHours, setUtilizedHours] = useState<string>('');

  // Forecasted hours editing state (Forecasted Hours)
  const [editingForecast, setEditingForecast] = useState<{ projectId: string; department: Department } | null>(null);
  const [forecastHours, setForecastHours] = useState<string>('');

  // Comment view state for General view (read-only comment display)
  const [viewingComment, setViewingComment] = useState<{ comment: string; projectName: string; department: string } | null>(null);

  // Quick project creation modal state
  const [showQuickProjectModal, setShowQuickProjectModal] = useState(false);
  const [quickProjectForm, setQuickProjectForm] = useState({
    name: '',
    client: '',
    startDate: '',
    numberOfWeeks: '' as any,
    facility: 'AL' as 'AL' | 'MI',
    budgetHours: 0,
  });

  // Import existing project modal state
  const [showImportProjectModal, setShowImportProjectModal] = useState(false);
  const [importProjectForm, setImportProjectForm] = useState({
    projectId: '',
    startDate: '',
    numberOfWeeks: '' as any,
    budgetHours: 0,
  });

  // Initialize with all projects expanded by default
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(
    projects.reduce((acc, proj) => ({ ...acc, [proj.id]: true }), {})
  );

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
          const weekDate = record.weekStartDate;
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

        for (const record of subcontractedData) {
          const company = record.company;
          const weekDate = record.weekStartDate;
          const capacity = record.capacity;

          if (company && weekDate) {
            if (!newSubcontractedPersonnel[company]) {
              newSubcontractedPersonnel[company] = {};
            }
            newSubcontractedPersonnel[company][weekDate] = capacity;
            newSubcontractedRecordIds[`${company}-${weekDate}`] = record.id;
          }
        }
        setSubcontractedPersonnel(newSubcontractedPersonnel);
        setSubcontractedRecordIds(newSubcontractedRecordIds);
        console.log('[CapacityMatrix] Subcontracted Team Capacity loaded');

        // Load PRG external team capacity data
        console.log('[CapacityMatrix] Loading PRG External Team Capacity from API...');
        const prgExternalData = await prgExternalTeamCapacityApi.getAll();
        const newPrgExternalPersonnel: Record<string, Record<string, number | undefined>> = {};
        const newPrgExternalRecordIds: Record<string, string> = {};

        for (const record of prgExternalData) {
          const teamName = record.teamName;
          const weekDate = record.weekStartDate;
          const capacity = record.capacity;

          if (teamName && weekDate) {
            if (!newPrgExternalPersonnel[teamName]) {
              newPrgExternalPersonnel[teamName] = {};
            }
            newPrgExternalPersonnel[teamName][weekDate] = capacity;
            newPrgExternalRecordIds[`${teamName}-${weekDate}`] = record.id;
          }
        }
        setPRGExternalPersonnel(newPrgExternalPersonnel);
        setPrgExternalRecordIds(newPrgExternalRecordIds);
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
    console.log('[CapacityMatrix] saveSubcontractedCapacity called:', { company, weekDate, capacity });

    try {
      if (capacity === undefined || capacity === 0) {
        // Don't save undefined or 0 values
        console.log('[CapacityMatrix] Skipping Subcontracted save - capacity is', capacity);
        return;
      }

      console.log('[CapacityMatrix] Saving Subcontracted capacity:', company, weekDate, capacity);
      let savedSuccessfully = false;

      try {
        console.log('[CapacityMatrix] Sending CREATE request to API...');
        const result = await subcontractedTeamCapacityApi.create({
          company,
          weekStartDate: weekDate,
          capacity,
        });
        console.log('[CapacityMatrix] ✅ CREATE succeeded:', result);
        savedSuccessfully = true;

        // Log activity
        await activityLogApi.logActivity(
          'created',
          'SubcontractedTeamCapacity',
          result.id,
          { company, weekStartDate: weekDate, capacity }
        );
      } catch (createError) {
        const createErrorMsg = createError instanceof Error ? createError.message : 'Error desconocido';
        console.log('[CapacityMatrix] ❌ CREATE failed:', createErrorMsg);

        // If create fails due to unique constraint, try to update instead
        if (createErrorMsg.includes('conjunto único') || createErrorMsg.includes('unique')) {
          console.log('[CapacityMatrix] Detected unique constraint violation, trying to find and update existing record...');
          try {
            const allRecords = await subcontractedTeamCapacityApi.getAll();
            console.log('[CapacityMatrix] Fetched all Subcontracted records, total count:', allRecords.length);

            const existingRecord = allRecords.find(
              (r: any) => r.company === company && r.weekStartDate === weekDate
            );

            if (existingRecord) {
              console.log('[CapacityMatrix] ✅ Found existing record, updating it with ID:', existingRecord.id);
              const updateResult = await subcontractedTeamCapacityApi.update(existingRecord.id, { capacity });
              console.log('[CapacityMatrix] ✅ UPDATE succeeded:', updateResult);
              savedSuccessfully = true;

              // Log activity
              await activityLogApi.logActivity(
                'updated',
                'SubcontractedTeamCapacity',
                existingRecord.id,
                { company, weekStartDate: weekDate, capacity }
              );
            } else {
              console.log('[CapacityMatrix] ❌ No existing record found, will throw original error');
              throw createError;
            }
          } catch (getError) {
            console.error('[CapacityMatrix] ❌ Failed to fetch or update existing record:', getError);
            throw getError;
          }
        } else {
          throw createError;
        }
      }

      if (!savedSuccessfully) {
        throw new Error('Failed to save Subcontracted capacity record');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] ❌ Final error saving Subcontracted capacity:', errorMsg);
      alert(`Error al guardar capacidad de ${company} (${weekDate}): ${errorMsg}`);
    }
  };

  // Debounced saves for subcontracted and PRG external personnel
  const subcontractedSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const prgExternalSaveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleSubcontractedChange = (company: string, weekDate: string, newCount: number | undefined) => {
    console.log('[CapacityMatrix] handleSubcontractedChange called:', { company, weekDate, newCount });

    // Update local state immediately
    setSubcontractedPersonnel(prev => ({
      ...prev,
      [company]: {
        ...(prev[company] || {}),
        [weekDate]: newCount,
      },
    }));

    // Debounce the API call
    const timeoutKey = `${company}-${weekDate}`;
    if (subcontractedSaveTimeouts.current[timeoutKey]) {
      console.log('[CapacityMatrix] Clearing previous Subcontracted timeout for key:', timeoutKey);
      clearTimeout(subcontractedSaveTimeouts.current[timeoutKey]);
    }
    console.log('[CapacityMatrix] Setting Subcontracted debounce timeout for key:', timeoutKey);
    subcontractedSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      console.log('[CapacityMatrix] Subcontracted debounce timeout fired for key:', timeoutKey);
      if (newCount !== undefined && newCount > 0) {
        saveSubcontractedCapacity(company, weekDate, newCount);
      }
    }, 500);
  };

  // Save PRG External Team Capacity to API
  const savePrgExternalCapacity = async (teamName: string, weekDate: string, capacity: number | undefined) => {
    console.log('[CapacityMatrix] savePrgExternalCapacity called:', { teamName, weekDate, capacity });

    try {
      if (capacity === undefined || capacity === 0) {
        // Don't save undefined or 0 values
        console.log('[CapacityMatrix] Skipping PRG External save - capacity is', capacity);
        return;
      }

      console.log('[CapacityMatrix] Saving PRG External capacity:', teamName, weekDate, capacity);
      let savedSuccessfully = false;

      try {
        console.log('[CapacityMatrix] Sending CREATE request to API...');
        const result = await prgExternalTeamCapacityApi.create({
          teamName,
          weekStartDate: weekDate,
          capacity,
        });
        console.log('[CapacityMatrix] ✅ CREATE succeeded:', result);
        savedSuccessfully = true;

        // Log activity
        await activityLogApi.logActivity(
          'created',
          'PrgExternalTeamCapacity',
          result.id,
          { teamName, weekStartDate: weekDate, capacity }
        );
      } catch (createError) {
        const createErrorMsg = createError instanceof Error ? createError.message : 'Error desconocido';
        console.log('[CapacityMatrix] ❌ CREATE failed:', createErrorMsg);

        // If create fails due to unique constraint, try to update instead
        if (createErrorMsg.includes('conjunto único') || createErrorMsg.includes('unique')) {
          console.log('[CapacityMatrix] Detected unique constraint violation, trying to find and update existing record...');
          try {
            const allRecords = await prgExternalTeamCapacityApi.getAll();
            console.log('[CapacityMatrix] Fetched all PRG External records, total count:', allRecords.length);

            const existingRecord = allRecords.find(
              (r: any) => r.teamName === teamName && r.weekStartDate === weekDate
            );

            if (existingRecord) {
              console.log('[CapacityMatrix] ✅ Found existing record, updating it with ID:', existingRecord.id);
              const updateResult = await prgExternalTeamCapacityApi.update(existingRecord.id, { capacity });
              console.log('[CapacityMatrix] ✅ UPDATE succeeded:', updateResult);
              savedSuccessfully = true;

              // Log activity
              await activityLogApi.logActivity(
                'updated',
                'PrgExternalTeamCapacity',
                existingRecord.id,
                { teamName, weekStartDate: weekDate, capacity }
              );
            } else {
              console.log('[CapacityMatrix] ❌ No existing record found, will throw original error');
              throw createError;
            }
          } catch (getError) {
            console.error('[CapacityMatrix] ❌ Failed to fetch or update existing record:', getError);
            throw getError;
          }
        } else {
          throw createError;
        }
      }

      if (!savedSuccessfully) {
        throw new Error('Failed to save PRG External capacity record');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] ❌ Final error saving PRG External capacity:', errorMsg);
      alert(`Error al guardar capacidad PRG (${teamName} - ${weekDate}): ${errorMsg}`);
    }
  };

  const handlePrgExternalChange = (teamName: string, weekDate: string, newCount: number | undefined) => {
    console.log('[CapacityMatrix] handlePrgExternalChange called:', { teamName, weekDate, newCount });

    // Update local state immediately
    setPRGExternalPersonnel(prev => ({
      ...prev,
      [teamName]: {
        ...(prev[teamName] || {}),
        [weekDate]: newCount,
      },
    }));

    // Debounce the API call
    const timeoutKey = `${teamName}-${weekDate}`;
    if (prgExternalSaveTimeouts.current[timeoutKey]) {
      console.log('[CapacityMatrix] Clearing previous PRG External timeout for key:', timeoutKey);
      clearTimeout(prgExternalSaveTimeouts.current[timeoutKey]);
    }
    console.log('[CapacityMatrix] Setting PRG External debounce timeout for key:', timeoutKey);
    prgExternalSaveTimeouts.current[timeoutKey] = setTimeout(() => {
      console.log('[CapacityMatrix] PRG External debounce timeout fired for key:', timeoutKey);
      if (newCount !== undefined && newCount > 0) {
        savePrgExternalCapacity(teamName, weekDate, newCount);
      }
    }, 500);
  };

  // Delete team handler
  const handleDeleteTeam = async () => {
    if (!deleteConfirmation.isOpen || !deleteConfirmation.teamName || !deleteConfirmation.type) {
      return;
    }

    setIsDeleting(true);
    try {
      const teamName = deleteConfirmation.teamName;
      const type = deleteConfirmation.type;

      if (type === 'subcontracted') {
        // Delete all records for this company from database
        const recordsToDelete = Object.keys(subcontractedRecordIds).filter(
          key => key.startsWith(`${teamName}-`)
        );

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

      // Log activity
      await activityLogApi.logActivity(
        'DELETE',
        type === 'subcontracted' ? 'SubcontractedTeamCapacity' : 'PrgExternalTeamCapacity',
        teamName,
        { type, teamName }
      );

      setDeleteConfirmation({ isOpen: false, type: null, teamName: '' });
    } catch (error) {
      console.error('[CapacityMatrix] Error deleting team:', error);
      alert(`${t.errorDeletingTeam || 'Error deleting team'}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Refs for table containers
  const departmentsTableRef = useRef<HTMLDivElement>(null);
  const projectsTableRef = useRef<HTMLDivElement>(null);
  const projectTableRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const allWeeksData = getAllWeeksWithNextYear(selectedYear);
  const currentDate = formatToISO(new Date());

  // Find the current week - it's the week that contains today's date
  const currentDateWeekIndex = allWeeksData.findIndex((w) => {
    const weekStart = new Date(w.date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const today = new Date(currentDate);
    return today >= weekStart && today <= weekEnd;
  });

  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const handleCreateQuickProject = () => {
    if (!quickProjectForm.name || !quickProjectForm.client || !quickProjectForm.startDate || !quickProjectForm.numberOfWeeks) {
      alert(t.completeAllFields);
      return;
    }

    const dept = departmentFilter as Department;
    const startDateISO = quickProjectForm.startDate;
    const numberOfWeeks = quickProjectForm.numberOfWeeks as number;

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
        [dept]: quickProjectForm.budgetHours,
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
    setShowQuickProjectModal(false);
    setQuickProjectForm({
      name: '',
      client: '',
      startDate: '',
      numberOfWeeks: '',
      facility: 'AL',
      budgetHours: 0,
    });
  };

  // Handle importing an existing project to the current department
  const handleImportProject = async () => {
    if (!importProjectForm.projectId || !importProjectForm.startDate || !importProjectForm.numberOfWeeks) {
      alert(t.completeAllFields);
      return;
    }

    const dept = departmentFilter as Department;
    const selectedProject = projects.find(p => p.id === importProjectForm.projectId);
    if (!selectedProject) {
      alert('Project not found');
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
    newDepartmentHoursAllocated[dept] = importProjectForm.budgetHours;

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

    setShowImportProjectModal(false);
    setImportProjectForm({
      projectId: '',
      startDate: '',
      numberOfWeeks: '',
      budgetHours: 0,
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

  // Effect to reset scroll to first week when departmentFilter changes
  useEffect(() => {
    // Reset scroll position to start of year (first week)
    if (departmentsTableRef.current) {
      departmentsTableRef.current.scrollLeft = 0;
    }
    if (projectsTableRef.current) {
      projectsTableRef.current.scrollLeft = 0;
    }
  }, [departmentFilter]);

  // Get total hours and stage for a department in a week (optionally filtered by project)
  const getDepartmentWeekData = (department: Department, weekStart: string, projectId?: string) => {
    // Filter assignments by week AND by department (through employee)
    const deptAssignments = assignments.filter((a) => {
      if (a.weekStartDate !== weekStart) return false;
      if (projectId && a.projectId !== projectId) return false;
      const emp = employees.find((e) => e.id === a.employeeId);
      return emp && emp.department === department;
    });

    const totalHours = deptAssignments.reduce((sum, a) => sum + a.hours, 0);
    const talent = calculateTalent(totalHours);
    const stage = deptAssignments.length > 0 ? deptAssignments[0].stage : null;

    return { totalHours, talent, assignments: deptAssignments, stage };
  };

  // Calculate utilization percentage for a department in a project
  // Formula: (Used Hours + Forecasted Hours / Quoted Hours) * 100
  // Used Hours = departmentHoursUtilized (manually entered)
  // Forecasted Hours = departmentHoursForecast (manually entered)
  // Quoted Hours = departmentHoursAllocated (budget)
  const getUtilizationPercent = (department: Department, projectId: string): number => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return 0;

    // Get utilized hours (manually entered)
    const utilizedHoursValue = project.departmentHoursUtilized?.[department] || 0;

    // Get forecasted hours (manually entered)
    const forecastedHoursValue = project.departmentHoursForecast?.[department] || 0;

    // Get quoted hours (budget)
    const quotedHours = project.departmentHoursAllocated?.[department] || 0;
    if (quotedHours === 0) return 0;

    return Math.round(((utilizedHoursValue + forecastedHoursValue) / quotedHours) * 100);
  };

  // Get utilized hours (manually entered) for a department in a project
  const getUtilizedHours = (department: Department, projectId: string): number => {
    const project = projects.find(p => p.id === projectId);
    return project?.departmentHoursUtilized?.[department] || 0;
  };

  // Get forecasted hours (manually entered) for a department in a project
  const getForecastedHours = (department: Department, projectId: string): number => {
    const project = projects.find(p => p.id === projectId);
    return project?.departmentHoursForecast?.[department] || 0;
  };

  // Get quoted hours (budget) for a department in a project
  const getQuotedHours = (department: Department, projectId: string): number => {
    const project = projects.find(p => p.id === projectId);
    const quotedHours = project?.departmentHoursAllocated?.[department] || 0;
    if (project && quotedHours === 0) {
      console.log(`[getQuotedHours] Project ${project.name}, Dept ${department}: ${quotedHours}`, {
        projectId,
        departmentHoursAllocated: project.departmentHoursAllocated
      });
    }
    return quotedHours;
  };

  // Check if a week is within a project's date range
  const isWeekInProjectRange = (weekStart: string, project: typeof projects[0]) => {
    return weekStart >= project.startDate && weekStart <= project.endDate;
  };

  const handleEditCell = (department: Department, weekStart: string, projectId?: string) => {
    if (departmentFilter === 'General') return; // No edit in General view

    const { totalHours, assignments: deptAssignments } = getDepartmentWeekData(department, weekStart, projectId);
    const firstAssignmentStage = deptAssignments.length > 0 ? deptAssignments[0].stage : null;
    const firstAssignmentComment = deptAssignments.length > 0 ? deptAssignments[0].comment || '' : '';

    // Initialize selected employees from existing assignments
    const assignedEmployeeIds = new Set(deptAssignments.map(a => a.employeeId));

    // For BUILD and PRG departments, initialize SCIO and external hours separately
    let totalScioHours = 0;
    let totalExternalHours = 0;

    if ((department === 'BUILD' || department === 'PRG') && deptAssignments.length > 0) {
      const firstAssignment = deptAssignments[0];
      totalScioHours = firstAssignment.scioHours || 0;
      totalExternalHours = firstAssignment.externalHours || 0;
    }

    setEditingCell({ department, weekStart, projectId });
    setEditingHours(totalHours);
    setEditingScioHours(totalScioHours);
    setEditingExternalHours(totalExternalHours);
    setEditingStage(firstAssignmentStage);
    setEditingComment(firstAssignmentComment);
    setSelectedEmployees(assignedEmployeeIds);
  };

  const handleSaveCell = () => {
    // For BUILD and PRG, use separate SCIO and external hours
    const isBuildOrPRG = editingCell && (editingCell.department === 'BUILD' || editingCell.department === 'PRG');
    const totalHours = isBuildOrPRG ? (editingScioHours + editingExternalHours) : editingHours;

    if (!editingCell || totalHours === 0) {
      setEditingCell(null);
      setEditingStage(null);
      setEditingComment('');
      setEditingScioHours(0);
      setEditingExternalHours(0);
      setSelectedEmployees(new Set());
      return;
    }

    const { assignments: deptAssignments } = getDepartmentWeekData(
      editingCell.department,
      editingCell.weekStart,
      editingCell.projectId
    );

    // If user selected specific employees, use those; otherwise use existing assignments
    const targetEmployeeIds = selectedEmployees.size > 0
      ? Array.from(selectedEmployees)
      : deptAssignments.map(a => a.employeeId);

    if (targetEmployeeIds.length > 0) {
      // Update or create assignments for selected employees
      targetEmployeeIds.forEach((employeeId) => {
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
          updateAssignment(existingAssign.id, updateData);
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
            addAssignment(newAssignment);
          }
        }
      });

      // Delete assignments for employees that were deselected
      deptAssignments.forEach((assign) => {
        if (!targetEmployeeIds.includes(assign.employeeId)) {
          // Note: We don't have a deleteAssignment function, so we'll set hours to 0
          // This is a limitation of the current data model
          updateAssignment(assign.id, {
            hours: 0,
            stage: editingStage,
          });
        }
      });
    } else {
      // Create new assignment for first available employee in department
      console.log('[CapacityMatrix] Looking for available employee in department:', editingCell.department);
      console.log('[CapacityMatrix] All employees:', employees.map(e => ({ name: e.name, dept: e.department, active: e.isActive })));

      const availableEmployee = employees.find(
        (emp) => emp.department === editingCell.department && emp.isActive
      );

      console.log('[CapacityMatrix] Found available employee:', availableEmployee);
      console.log('[CapacityMatrix] Project ID:', editingCell.projectId);

      if (availableEmployee && editingCell.projectId) {
        const newAssignment: any = {
          employeeId: availableEmployee.id,
          projectId: editingCell.projectId,
          weekStartDate: editingCell.weekStart,
          hours: totalHours,
          stage: editingStage,
          comment: editingComment || undefined,
        };

        // Add SCIO and external hours for BUILD and PRG departments
        if (isBuildOrPRG) {
          newAssignment.scioHours = editingScioHours;
          newAssignment.externalHours = editingExternalHours;
        }

        console.log('[CapacityMatrix] Creating new assignment:', newAssignment);
        addAssignment(newAssignment);
      } else {
        // Show error if no employee found
        if (!availableEmployee) {
          console.error('[CapacityMatrix] ❌ No active employee found for department:', editingCell.department);
          alert(`No hay empleados activos en el departamento ${editingCell.department}. Por favor agregue un empleado primero.`);
        }
        if (!editingCell.projectId) {
          console.error('[CapacityMatrix] ❌ No project ID available');
          alert('Error: No se encontró el ID del proyecto.');
        }
      }
    }

    setEditingCell(null);
    setEditingStage(null);
    setEditingComment('');
    setEditingScioHours(0);
    setEditingExternalHours(0);
    setSelectedEmployees(new Set());
  };

  // Handlers for editing utilized hours (Used Hours)
  const handleEditUtilized = (projectId: string, department: Department, currentHours: number) => {
    setEditingUtilized({ projectId, department });
    setUtilizedHours(currentHours.toString());
  };

  const handleSaveUtilized = async () => {
    if (!editingUtilized) return;

    const newValue = parseInt(utilizedHours) || 0;
    const projectId = editingUtilized.projectId;
    const department = editingUtilized.department;

    try {
      console.log('[CapacityMatrix] Saving utilized hours:', {
        projectId: projectId,
        department: department,
        newValue: newValue,
      });

      // Call the new endpoint that directly updates ProjectBudget hours_utilized
      await projectsApi.updateBudgetHours(projectId, {
        department: department,
        hoursUtilized: newValue,
      });

      console.log('[CapacityMatrix] ✓ Utilized hours saved successfully to backend');

      // Close modal immediately
      setEditingUtilized(null);
      setUtilizedHours('');

      // Refetch projects in the background to sync UI
      console.log('[CapacityMatrix] Refetching projects from backend...');
      const store = useProjectStore.getState();
      await store.fetchProjects(true);
      console.log('[CapacityMatrix] ✓ Projects refetched successfully');

      // Show brief success message
      const successMsg = `Horas utilizadas guardadas (${department}: ${newValue}h)`;
      console.log('[CapacityMatrix] Success:', successMsg);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] Error saving utilized hours:', errorMsg);
      alert(`Error al guardar horas utilizadas: ${errorMsg}`);
      setEditingUtilized(null);
      setUtilizedHours('');
    }
  };

  const handleCancelUtilized = () => {
    setEditingUtilized(null);
    setUtilizedHours('');
  };

  // Handlers for editing forecasted hours (Forecasted Hours)
  const handleEditForecast = (projectId: string, department: Department, currentHours: number) => {
    setEditingForecast({ projectId, department });
    setForecastHours(currentHours.toString());
  };

  const handleSaveForecast = async () => {
    if (!editingForecast) return;

    const newValue = parseInt(forecastHours) || 0;
    const projectId = editingForecast.projectId;
    const department = editingForecast.department;

    try {
      console.log('[CapacityMatrix] Saving forecasted hours:', {
        projectId: projectId,
        department: department,
        newValue: newValue,
      });

      // Call the new endpoint that directly updates ProjectBudget hours_forecast
      await projectsApi.updateBudgetHours(projectId, {
        department: department,
        hoursForecast: newValue,
      });

      console.log('[CapacityMatrix] ✓ Forecasted hours saved successfully to backend');

      // Close modal immediately
      setEditingForecast(null);
      setForecastHours('');

      // Refetch projects in the background to sync UI
      console.log('[CapacityMatrix] Refetching projects from backend...');
      const store = useProjectStore.getState();
      await store.fetchProjects(true);
      console.log('[CapacityMatrix] ✓ Projects refetched successfully');

      // Show brief success message
      const successMsg = `Horas pronosticadas guardadas (${department}: ${newValue}h)`;
      console.log('[CapacityMatrix] Success:', successMsg);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[CapacityMatrix] Error saving forecasted hours:', errorMsg);
      alert(`Error al guardar horas pronosticadas: ${errorMsg}`);
      setEditingForecast(null);
      setForecastHours('');
    }
  };

  const handleCancelForecast = () => {
    setEditingForecast(null);
    setForecastHours('');
  };

  const renderCellContent = (department: Department, weekStart: string, projectId?: string) => {
    const { totalHours, talent, stage, assignments: cellAssignments } = getDepartmentWeekData(department, weekStart, projectId);
    const weekData = allWeeksData.find((w) => w.date === weekStart);
    const weekNum = weekData?.weekNum || 1;

    // Get comment from first assignment (comments are shared across assignments in same cell)
    const cellComment = cellAssignments.length > 0 ? cellAssignments[0].comment : undefined;

    // Get project and department stage info for visual indicators
    const project = projects.find(p => p.id === projectId);

    // Special case for PM: use project start date and total duration
    // PM department spans the entire project lifecycle
    let deptStartDate: string | undefined;
    let deptDuration: number;

    if (department === 'PM' && project) {
      // PM uses the project's start date and total number of weeks
      deptStartDate = project.startDate;
      deptDuration = project.numberOfWeeks || 0;
    } else {
      // Other departments use their specific configuration
      const deptStages = project?.departmentStages?.[department];
      const deptFirstStage = deptStages && deptStages.length > 0 ? deptStages[0] : null;
      deptStartDate = deptFirstStage?.departmentStartDate;
      deptDuration = deptFirstStage?.durationWeeks || 0;
    }

    // Calculate department end date by adding weeks to start date
    let deptEndDate = '';
    if (deptStartDate && deptDuration > 0) {
      const endDate = new Date(deptStartDate);
      endDate.setDate(endDate.getDate() + (deptDuration * 7) - 1);
      deptEndDate = endDate.toISOString().split('T')[0];
    }

    // Check if current week is within department range using date comparison
    const isDeptWeekInRange = deptStartDate && deptEndDate && weekStart >= deptStartDate && weekStart <= deptEndDate;
    const isDeptFirstWeek = deptStartDate && weekStart === deptStartDate;

    // Get stage color for styling
    const stageColor = stage ? getStageColor(stage) : null;
    const isGeneralView = departmentFilter === 'General';

    // Get project info for tooltip
    const projectStartDate = project?.startDate ? new Date(project.startDate).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US') : 'N/A';
    const deptDisplayDate = deptStartDate
      ? new Date(deptStartDate).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')
      : t.notConfigured;

    // Build tooltip text, including comment if present
    let tooltipText = `📅 ${t.projectTooltip}: ${projectStartDate}\n👷 ${department}: ${deptDisplayDate}`;
    if (cellComment) {
      tooltipText += `\n\n💬 ${cellComment}`;
    }

    // Calculate consecutive week number within the department using dates
    let deptConsecutiveWeek = 0;
    if (isDeptWeekInRange && deptStartDate) {
      const startMs = new Date(deptStartDate).getTime();
      const currentMs = new Date(weekStart).getTime();
      const weeksDiff = Math.floor((currentMs - startMs) / (7 * 24 * 60 * 60 * 1000));
      deptConsecutiveWeek = weeksDiff + 1;
    }

    // Read-only display
    if (totalHours === 0) {
      const canEdit = departmentFilter !== 'General';

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
              <span className="text-xs opacity-75">{deptStartDate}</span>
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

    return (
      <div
        className={`p-1 rounded text-center text-xs font-semibold h-full flex flex-col items-center justify-center relative group ${
          stageColor ? stageColor.bg : 'bg-blue-100'
        } ${stageColor ? stageColor.text : 'text-blue-900'}`}
        title={tooltipText}
      >
        {isGeneralView ? (
          <div className="text-[10px] font-bold leading-tight">{talent}</div>
        ) : (
          <>
            <div className="text-[10px] font-bold leading-tight">{totalHours}h</div>
            <div className="text-[10px] opacity-75 leading-tight">{talent}</div>
          </>
        )}
        {/* Show utilization % in project-specific views */}
        {projectId && utilizationColor && (
          <div className={`text-[10px] font-bold px-1 py-0 rounded mt-0.5 leading-tight ${utilizationColor.bg} ${utilizationColor.text}`}>
            {utilizationPercent}%
          </div>
        )}
        {stage && <div className="text-[10px] opacity-60 font-normal leading-tight">{stage}</div>}
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
    const weekData = allWeeksData.find(w => w.date === editingCell.weekStart);
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
                  inputMode="numeric"
                  value={editingScioHours || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditingScioHours(val === '' ? 0 : Math.max(0, parseInt(val) || 0));
                    // Update total hours for backward compatibility
                    setEditingHours((val === '' ? 0 : Math.max(0, parseInt(val) || 0)) + editingExternalHours);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveCell();
                    }
                  }}
                  disabled={selectedEmployees.size > 0 && Array.from(selectedEmployees).some(empId => {
                    const emp = employees.find(e => e.id === empId);
                    return emp?.isSubcontractedMaterial;
                  })}
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-500"
                  placeholder="0"
                />
              </div>

              {/* External Hours input - conditionally shown based on selected external resource */}
              {selectedEmployees.size > 0 && Array.from(selectedEmployees).some(empId => {
                const emp = employees.find(e => e.id === empId);
                return emp?.isSubcontractedMaterial;
              }) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.enterExternalHours}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editingExternalHours || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditingExternalHours(val === '' ? 0 : Math.max(0, parseInt(val) || 0));
                      // Update total hours for backward compatibility
                      setEditingHours(editingScioHours + (val === '' ? 0 : Math.max(0, parseInt(val) || 0)));
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
                inputMode="numeric"
                value={editingHours || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditingHours(val === '' ? 0 : Math.max(0, parseInt(val) || 0));
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
                    {(t as Record<string, string>)[`stage${stage.split('_').map(word => word.charAt(0) + word.slice(1).toLowerCase()).join('')}`] || stage.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Employee selection - Hide for MFG department */}
          {deptEmployees.length > 0 && editingCell.department !== 'MFG' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">👥 {t.availableResources} ({deptEmployees.length})</label>
              <div className="space-y-2 max-h-32 overflow-y-auto bg-gray-50 p-2 rounded border border-gray-200">
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
              {selectedEmployees.size > 0 && (
                <div className="mt-2 text-xs bg-blue-50 text-blue-700 p-2 rounded border border-blue-200">
                  ✓ {selectedEmployees.size} {selectedEmployees.size !== 1 ? t.resourcesSelected : t.resourceSelected}
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder={t.commentPlaceholder}
              rows={2}
            />
          </div>

          {/* Delete Confirmation Dialog */}
          {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center rounded-lg">
              <div className="bg-white rounded-lg shadow-2xl p-6 max-w-sm mx-4 border-2 border-red-200">
                <h3 className="text-lg font-bold text-red-700 mb-2">⚠️ {t.deleteConfirm || 'Confirmar Eliminación'}</h3>
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
                      setIsDeleting(true);
                      try {
                        if (editingCell) {
                          // Find and delete the assignment for this cell
                          const cellAssignments = assignments.filter(
                            a => a.projectId === editingCell.projectId && a.weekStartDate === editingCell.weekStart
                          );

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
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Edit Cell Modal */}
      {renderEditModal()}
      {/* Sticky Header - Responsive */}
      <div className="sticky top-0 z-50 bg-white shadow-sm border-b border-gray-200">
        <div className="px-1 py-1 flex flex-wrap items-center gap-1">
          {/* Zoom controls - ultra compact */}
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5 flex-shrink-0">
            <button
              onClick={() => setZoom(Math.max(50, zoom - 10))}
              className="p-0.5 hover:bg-gray-200 rounded transition text-gray-700"
              title={t.zoomOut}
            >
              <ZoomOut size={12} />
            </button>
            <span className="text-[9px] font-semibold text-gray-700 w-6 text-center">{zoom}%</span>
            <button
              onClick={() => setZoom(Math.min(200, zoom + 10))}
              className="p-0.5 hover:bg-gray-200 rounded transition text-gray-700"
              title={t.zoomIn}
            >
              <ZoomIn size={12} />
            </button>
          </div>

          {/* Year selector - ultra compact */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="border border-blue-300 rounded px-1 py-0.5 text-[9px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition flex-shrink-0"
          >
            <option value={2024}>2024</option>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>

          {/* Current Week Info - ultra compact */}
          {currentDateWeekIndex >= 0 && (
            <div className="bg-gradient-to-r from-red-500 to-rose-600 text-white px-1 py-0.5 rounded-md shadow-sm flex items-center gap-0.5 text-[9px] flex-shrink-0">
              <span className="font-bold">🎯</span>
              <span className="font-bold">W{currentDateWeekIndex >= 0 ? allWeeksData[currentDateWeekIndex]?.weekNum : '-'}</span>
            </div>
          )}

          {/* Legend Toggle Button - ultra compact */}
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-500 hover:bg-blue-600 text-white text-[9px] font-semibold rounded transition flex-shrink-0"
            title={t.toggleLegend}
          >
            <span>{showLegend ? '▼' : '▶'}</span>
            <span className="hidden sm:inline">{t.legend}</span>
          </button>

          {/* Create Project Button - Only in department view (except PM) */}
          {departmentFilter !== 'General' && departmentFilter !== 'PM' && (
            <button
              onClick={() => setShowQuickProjectModal(true)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-500 hover:bg-green-600 text-white text-[9px] font-semibold rounded transition flex-shrink-0"
              title={t.createProject || 'Create Project'}
            >
              <Plus size={10} />
              <span className="hidden sm:inline">{t.createProject || 'Create'}</span>
            </button>
          )}

          {/* Import Existing Project Button - Only in department view (except PM) */}
          {departmentFilter !== 'General' && departmentFilter !== 'PM' && getAvailableProjectsForImport().length > 0 && (
            <button
              onClick={() => setShowImportProjectModal(true)}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-semibold rounded transition flex-shrink-0"
              title={t.importProject || 'Import Existing Project'}
            >
              <FolderPlus size={10} />
              <span className="hidden sm:inline">{t.importProject || 'Import'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-2">

        {/* Tabla de Departamentos - Only show for department-specific views */}
        {departmentFilter !== 'General' && (
          <>
            {/* Department Weekly Occupancy Summary Panel */}
            {(() => {
              const dept = departmentFilter as Department;
              const deptIcon = getDepartmentIcon(dept);

              return (
                <div className="sticky top-0 z-40 mb-2 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-2 shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-xs font-bold text-indigo-800 flex items-center gap-1">
                      <span className={deptIcon.color}>{deptIcon.icon}</span>
                      <span>{dept} - {t.weeklyOccupancyTotal}</span>
                    </h2>
                    <button
                      onClick={() => setShowDepartmentPanel(!showDepartmentPanel)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold text-xs cursor-pointer transition"
                      title={showDepartmentPanel ? 'Hide panel' : 'Show panel'}
                    >
                      {showDepartmentPanel ? '▼' : '▶'}
                    </button>
                  </div>

                  {/* Weekly occupancy calendar */}
                  {showDepartmentPanel && (
                    <div className="overflow-x-auto">
                    <div className="inline-block min-w-full">
                      {/* Week headers row */}
                      <div className="flex gap-0.5 mb-0.5">
                        {/* Empty cell for label column */}
                        <div className="w-14 flex-shrink-0 text-[8px] font-bold text-indigo-700 flex items-center justify-center">
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
                                  ? 'bg-red-300 text-red-900 border-red-500'
                                  : 'bg-blue-100 text-blue-900 border-blue-300'
                              }`}
                            >
                              W{weekData.weekNum}
                            </div>
                          );
                        })}
                      </div>

                      {/* Total row - sum of occupied people in that week (or hours for MFG) */}
                      <div className="flex gap-0.5 mb-0.5">
                        {/* Label */}
                        <div className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-orange-100 to-orange-50 text-orange-800 border-orange-300">
                          {t.totalLabel}
                        </div>

                        {/* Week cells */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;

                          // Calculate total occupied people for this department in this week
                          const deptAssignments = assignments.filter(a => {
                            const emp = employees.find(e => e.id === a.employeeId);
                            return a.weekStartDate === weekData.date && emp?.department === dept;
                          });

                          const totalWeekHours = deptAssignments.reduce((sum, a) => sum + a.hours, 0);

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
                                isCurrentWeek ? 'ring-2 ring-red-600 shadow-md' : ''
                              }`}
                              title={`${t.totalLabel} - W${weekData.weekNum}: ${displayValue.toFixed(2)} ${unit}`}
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
                        <div className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-purple-100 to-purple-50 text-purple-800 border-purple-300">
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
                                onChange={(e) => {
                                  const newCapacity = parseFloat(e.target.value) || 0;
                                  handleScioTeamChange(dept, weekData.date, newCapacity);
                                }}
                                className={`w-10 flex-shrink-0 border-1.5 rounded-md px-1 py-0.5 text-[8px] font-bold text-center focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-400 ${
                                  isCurrentWeek ? 'ring-2 ring-red-600 shadow-md border-red-500 bg-gradient-to-b from-red-50 to-orange-50' : 'bg-gradient-to-b from-purple-50 to-purple-25 border-purple-300'
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
                              <div className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-violet-100 to-violet-50 text-violet-900 border-violet-400 shadow-sm hover:shadow-md transition-all">
                                <span className="truncate max-w-[40px]" title={company}>{company}</span>
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
                                          ? 'ring-2 ring-red-500 shadow-md border-red-400 bg-gradient-to-b from-red-50 to-orange-50'
                                          : 'border-violet-300 bg-gradient-to-b from-violet-50 to-violet-25 hover:border-violet-400'
                                      }`}
                                    >
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={subcontractedPersonnel[company]?.[weekData.date] !== undefined && subcontractedPersonnel[company]?.[weekData.date] !== 0 ? subcontractedPersonnel[company][weekData.date] : ''}
                                        onChange={(e) => {
                                          const newCount = e.target.value === '' ? undefined : parseInt(e.target.value);
                                          handleSubcontractedChange(company, weekData.date, newCount);
                                        }}
                                        className="w-8 text-[8px] font-bold bg-transparent focus:outline-none text-center border-none text-violet-900"
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
                          <div className="flex gap-0.5 mb-0.5">
                            {/* Label column - clickable to open popup */}
                            <button
                              onClick={() => setIsBuildModalOpen(true)}
                              className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-indigo-100 to-indigo-50 text-indigo-800 border-indigo-300 hover:from-indigo-200 hover:to-indigo-100 hover:border-indigo-400 cursor-pointer transition-all"
                              title={t.clickToAddSubcontractedTeam}
                            >
                              {t.addButton}
                            </button>
                          </div>
                        </>
                      )}

                      {/* Add External Team button row - Only for PRG department */}
                      {dept === 'PRG' && (
                        <>
                          {/* Team rows - Only show active teams */}
                          {prgActiveTeams.map((team) => (
                            <div key={`prg-external-${team}`} className="flex gap-0.5 mb-0.5 group">
                              {/* Team Label with delete button */}
                              <div className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center relative text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-cyan-100 to-cyan-50 text-cyan-900 border-cyan-400 shadow-sm hover:shadow-md transition-all">
                                <span className="truncate max-w-[40px]" title={team}>{team}</span>
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
                                          ? 'ring-2 ring-red-500 shadow-md border-red-400 bg-gradient-to-b from-red-50 to-orange-50'
                                          : 'border-cyan-300 bg-gradient-to-b from-cyan-50 to-cyan-25 hover:border-cyan-400'
                                      }`}
                                    >
                                      <input
                                        type="number"
                                        step="1"
                                        min="0"
                                        value={prgExternalPersonnel[team] && prgExternalPersonnel[team][weekData.date] !== undefined && prgExternalPersonnel[team][weekData.date] !== 0 ? prgExternalPersonnel[team][weekData.date] : ''}
                                        onChange={(e) => {
                                          const newCount = e.target.value === '' ? undefined : parseInt(e.target.value);
                                          handlePrgExternalChange(team, weekData.date, newCount);
                                        }}
                                        className="w-8 text-[8px] font-bold bg-transparent focus:outline-none text-center border-none text-cyan-900"
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
                          <div className="flex gap-0.5 mb-0.5">
                            {/* Label column - clickable to open popup */}
                            <button
                              onClick={() => setIsPRGModalOpen(true)}
                              className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-teal-100 to-teal-50 text-teal-800 border-teal-300 hover:from-teal-200 hover:to-teal-100 hover:border-teal-400 cursor-pointer transition-all"
                              title={t.clickToAddExternalTeam}
                            >
                              {t.addButton}
                            </button>
                          </div>
                        </>
                      )}

                      {/* External Hours row - For BUILD and PRG departments only */}
                      {(dept === 'BUILD' || dept === 'PRG') && (
                        <div className="flex gap-0.5 mb-0.5">
                          {/* Label */}
                          <div className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-purple-100 to-purple-50 text-purple-800 border-purple-300">
                            {dept === 'BUILD' ? '🏢 Ext' : '👥 Ext'}
                          </div>

                          {/* Week cells */}
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;

                            // Calculate total external hours for this week across ALL projects
                            const deptAssignments = assignments.filter(a => {
                              const emp = employees.find(e => e.id === a.employeeId);
                              return a.weekStartDate === weekData.date && emp?.department === dept;
                            });

                            const totalExternalHours = deptAssignments.reduce((sum, a) => sum + (a.externalHours || 0), 0);

                            return (
                              <div
                                key={`external-${dept}-${weekData.date}`}
                                className={`w-10 flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-md border-1.5 text-[8px] font-bold text-purple-700 transition-all ${
                                  totalExternalHours > 0
                                    ? 'bg-purple-200 border-purple-400 shadow-sm'
                                    : 'bg-purple-50 border-purple-300'
                                } ${isCurrentWeek ? 'ring-2 ring-red-600 shadow-md' : ''}`}
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
                        <div className="w-14 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold px-1 py-0.5 rounded-md border-2 bg-gradient-to-br from-green-100 to-green-50 text-green-800 border-green-300">
                          {t.capacityLabel}
                        </div>

                        {/* Week cells */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;

                          // Get SCIO Team Members / Hours per Week capacity for this week
                          const weekCapacity = scioTeamMembers[dept]?.[weekData.date] || 0;

                          // Calculate total hours occupied for this department this week
                          const deptAssignments = assignments.filter(a => {
                            const emp = employees.find(e => e.id === a.employeeId);
                            return a.weekStartDate === weekData.date && emp?.department === dept;
                          });

                          const totalWeekHours = deptAssignments.reduce((sum, a) => sum + a.hours, 0);

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

                          // Determine color based on available capacity
                          let bgColor = 'bg-gray-200 border-gray-400';
                          let textColor = 'text-gray-700';

                          // If no capacity set, show gray
                          if (totalCapacity === 0) {
                            bgColor = 'bg-gray-200 border-gray-400';
                            textColor = 'text-gray-700';
                          } else if (availableCapacity <= 0) {
                            // Red: Over-allocated or fully occupied
                            bgColor = 'bg-red-500 border-red-600';
                            textColor = 'text-white';
                          } else if (isMFG) {
                            // For MFG: use percentage-based thresholds on available hours
                            if (availableCapacity < totalCapacity * 0.25) {
                              bgColor = 'bg-orange-400 border-orange-500';
                              textColor = 'text-white';
                            } else if (availableCapacity < totalCapacity * 0.5) {
                              bgColor = 'bg-yellow-300 border-yellow-400';
                              textColor = 'text-yellow-900';
                            } else {
                              bgColor = 'bg-green-300 border-green-400';
                              textColor = 'text-green-900';
                            }
                          } else {
                            // For other departments: use percentage-based thresholds on available people
                            if (availableCapacity < totalCapacity * 0.25) {
                              bgColor = 'bg-orange-400 border-orange-500';
                              textColor = 'text-white';
                            } else if (availableCapacity < totalCapacity * 0.5) {
                              bgColor = 'bg-yellow-300 border-yellow-400';
                              textColor = 'text-yellow-900';
                            } else {
                              bgColor = 'bg-green-300 border-green-400';
                              textColor = 'text-green-900';
                            }
                          }

                          return (
                            <div
                              key={`capacity-${dept}-${weekData.date}-${assignments.length}-${JSON.stringify(subcontractedPersonnel)}`}
                              className={`w-10 flex-shrink-0 flex flex-col items-center justify-center px-1 py-0.5 rounded-md border-1.5 text-[8px] font-bold ${bgColor} ${
                                isCurrentWeek ? 'ring-2 ring-red-600 shadow-md' : ''
                              }`}
                              title={`${t.capacityLabel} - W${weekData.weekNum}: ${totalCapacity.toFixed(2)} ${unit} (Available: ${availableCapacity.toFixed(2)})`}
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

            {/* Global zoom controls for departments view */}
            <div className="flex items-center gap-1.5 mb-2 p-1.5 bg-blue-50 rounded-lg border border-blue-200">
              <span className="text-xs font-semibold text-blue-900">{t.zoomLabel}</span>
              <button onClick={() => setZoom(Math.max(50, zoom - 10))} className="p-0.5 bg-blue-500 hover:bg-blue-600 text-white rounded transition" title={t.zoomOut}>
                <ZoomOut size={14} />
              </button>
              <input
                type="range"
                min="50"
                max="200"
                step="10"
                value={zoom}
                onChange={(e) => setZoom(parseInt(e.target.value))}
                className="w-20 cursor-pointer h-1.5"
              />
              <button onClick={() => setZoom(Math.min(200, zoom + 10))} className="p-0.5 bg-blue-500 hover:bg-blue-600 text-white rounded transition" title={t.zoomIn}>
                <ZoomIn size={14} />
              </button>
              <span className="text-xs font-semibold text-blue-900">{zoom}%</span>
            </div>

            {/* Projects in department view - each with individual zoom controls */}
            {/* Filter: If project has visibleInDepartments, only show in those departments. Otherwise, show in all. */}
            {projects.filter((proj) => {
              const dept = departmentFilter as Department;

              // If project was created from a specific department (has visibleInDepartments),
              // only show it in those departments
              if (proj.visibleInDepartments && proj.visibleInDepartments.length > 0) {
                return proj.visibleInDepartments.includes(dept);
              }

              // Projects created from Projects page (no visibleInDepartments) appear in all departments
              return true;
            }).map((proj) => {
              const dept = departmentFilter as Department;

              return (
                <div key={proj.id} className="mb-2 border border-gray-300 rounded-lg shadow-sm bg-white overflow-hidden">
                  {/* Project header - Includes metrics for department view */}
                  <div className="bg-gray-100 hover:bg-gray-200 cursor-pointer border-b border-gray-300" onClick={() => toggleProjectExpanded(proj.id)}>
                    {/* Row 1: Project info */}
                    <div className="p-1 flex items-center gap-1">
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
                            {(() => {
                              const start = new Date(proj.startDate);
                              const end = new Date(proj.endDate);
                              const diffTime = Math.abs(end.getTime() - start.getTime());
                              const diffWeeks = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
                              return `${diffWeeks} weeks`;
                            })()}
                          </span>
                          {proj.projectManagerId && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                👨‍💼 {employees.find((e) => e.id === proj.projectManagerId)?.name || 'PM'}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {/* Desktop: Metrics inline */}
                      <div className="hidden md:flex items-stretch gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const dept = departmentFilter as Department;
                          const quotedHoursValue = getQuotedHours(dept, proj.id);
                          const utilizedHoursValue = getUtilizedHours(dept, proj.id);
                          const forecastedHoursValue = getForecastedHours(dept, proj.id);
                          const utilizationPercent = getUtilizationPercent(dept, proj.id);
                          const utilizationColorInfo = getUtilizationColor(utilizationPercent);

                          return (
                            <>
                              <div className="bg-blue-100 rounded px-2 py-1 border border-blue-300 text-center min-w-fit flex flex-col justify-center">
                                <div className="text-[10px] text-blue-700 font-bold">Quoted</div>
                                <div className="text-[11px] font-black text-blue-700">{quotedHoursValue}h</div>
                              </div>
                              <div className="bg-purple-100 rounded px-2 py-1 border border-purple-300 text-center min-w-fit flex flex-col justify-center relative">
                                <button
                                  onClick={() => handleEditUtilized(proj.id, dept, utilizedHoursValue)}
                                  className="absolute -top-1.5 -right-1.5 p-1 bg-purple-500 hover:bg-purple-600 text-white rounded-full transition shadow-lg"
                                  title={t.editUsedHours}
                                >
                                  <Pencil size={10} />
                                </button>
                                <div className="text-[10px] text-purple-700 font-bold">Used</div>
                                <div className="text-[11px] font-black text-purple-700">{utilizedHoursValue}h</div>
                              </div>
                              <div className="bg-orange-100 rounded px-2 py-1 border border-orange-300 text-center min-w-fit flex flex-col justify-center relative">
                                <button
                                  onClick={() => handleEditForecast(proj.id, dept, forecastedHoursValue)}
                                  className="absolute -top-1.5 -right-1.5 p-1 bg-orange-500 hover:bg-orange-600 text-white rounded-full transition shadow-lg"
                                  title={t.editForecastedHours}
                                >
                                  <Pencil size={10} />
                                </button>
                                <div className="text-[10px] text-orange-700 font-bold">Forecast</div>
                                <div className="text-[11px] font-black text-orange-700">{forecastedHoursValue}h</div>
                              </div>
                              <div className={`rounded px-2 py-1 border text-center min-w-fit flex flex-col justify-center ${utilizationColorInfo.bg}`}>
                                <div className={`text-[10px] font-bold ${utilizationColorInfo.text}`}>Util</div>
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
                          onClick={() => setProjectZoom(proj.id, Math.max(50, getProjectZoom(proj.id) - 10))}
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
                          value={getProjectZoom(proj.id)}
                          onChange={(e) => setProjectZoom(proj.id, parseInt(e.target.value))}
                          className="w-12 cursor-pointer h-1"
                        />
                        <button
                          onClick={() => setProjectZoom(proj.id, Math.min(200, getProjectZoom(proj.id) + 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom In"
                        >
                          <ZoomIn size={10} />
                        </button>
                        <span className="text-[9px] font-semibold text-indigo-900">{getProjectZoom(proj.id)}%</span>
                      </div>
                    </div>
                    {/* Row 2: Mobile only - Metrics and Zoom in separate row */}
                    <div className="md:hidden px-1 pb-1 flex items-center justify-between gap-1 border-t border-gray-200 pt-1" onClick={(e) => e.stopPropagation()}>
                      {/* Metrics - Compact horizontal layout */}
                      <div className="flex items-center gap-1">
                        {(() => {
                          const dept = departmentFilter as Department;
                          const quotedHoursValue = getQuotedHours(dept, proj.id);
                          const utilizedHoursValue = getUtilizedHours(dept, proj.id);
                          const forecastedHoursValue = getForecastedHours(dept, proj.id);
                          const utilizationPercent = getUtilizationPercent(dept, proj.id);
                          const utilizationColorInfo = getUtilizationColor(utilizationPercent);

                          return (
                            <>
                              <div className="bg-blue-100 rounded px-1.5 py-0.5 border border-blue-300 text-center flex flex-col">
                                <span className="text-[7px] text-blue-600 font-semibold leading-none">Quoted</span>
                                <span className="text-[9px] text-blue-700 font-bold leading-none">{quotedHoursValue}h</span>
                              </div>
                              <div className="bg-purple-100 rounded px-1.5 py-0.5 border border-purple-300 text-center relative flex flex-col">
                                <button
                                  onClick={() => handleEditUtilized(proj.id, dept, utilizedHoursValue)}
                                  className="absolute -top-1 -right-1 p-0.5 bg-purple-500 hover:bg-purple-600 text-white rounded-full transition shadow"
                                  title={t.editUsedHours}
                                >
                                  <Pencil size={8} />
                                </button>
                                <span className="text-[7px] text-purple-600 font-semibold leading-none">Used</span>
                                <span className="text-[9px] text-purple-700 font-bold leading-none">{utilizedHoursValue}h</span>
                              </div>
                              <div className="bg-orange-100 rounded px-1.5 py-0.5 border border-orange-300 text-center relative flex flex-col">
                                <button
                                  onClick={() => handleEditForecast(proj.id, dept, forecastedHoursValue)}
                                  className="absolute -top-1 -right-1 p-0.5 bg-orange-500 hover:bg-orange-600 text-white rounded-full transition shadow"
                                  title={t.editForecastedHours}
                                >
                                  <Pencil size={8} />
                                </button>
                                <span className="text-[7px] text-orange-600 font-semibold leading-none">Forecast</span>
                                <span className="text-[9px] text-orange-700 font-bold leading-none">{forecastedHoursValue}h</span>
                              </div>
                              <div className={`rounded px-1.5 py-0.5 border text-center flex flex-col ${utilizationColorInfo.bg}`}>
                                <span className={`text-[7px] font-semibold leading-none ${utilizationColorInfo.text}`}>Util</span>
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
                          onClick={() => setProjectZoom(proj.id, Math.max(50, getProjectZoom(proj.id) - 10))}
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
                          value={getProjectZoom(proj.id)}
                          onChange={(e) => setProjectZoom(proj.id, parseInt(e.target.value))}
                          className="w-10 cursor-pointer h-1"
                        />
                        <button
                          onClick={() => setProjectZoom(proj.id, Math.min(200, getProjectZoom(proj.id) + 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom In"
                        >
                          <ZoomIn size={10} />
                        </button>
                        <span className="text-[8px] font-semibold text-indigo-900">{getProjectZoom(proj.id)}%</span>
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
                          <div className="bg-blue-100 rounded px-1.5 py-0.5 border border-blue-300 text-center min-w-fit">
                            <div className="text-xs text-blue-700 font-bold">{t.quotedLabel}</div>
                            <div className="text-xs font-black text-blue-700">{quotedHoursValue}h</div>
                          </div>

                          {/* Used Hours (manually entered) with Edit Button */}
                          <div className="bg-purple-100 rounded px-2 py-0.5 border border-purple-300 relative min-w-fit">
                            <button
                              onClick={() => handleEditUtilized(proj.id, dept, utilizedHoursValue)}
                              className="absolute top-0.5 left-0.5 p-0.5 bg-purple-500 hover:bg-purple-600 text-white rounded transition"
                              title={t.editUsedHours}
                            >
                              <Pencil size={8} />
                            </button>
                            <div className="text-center pl-3">
                              <div className="text-xs text-purple-700 font-bold">{t.usedLabel}</div>
                              <div className="text-xs font-black text-purple-700">{utilizedHoursValue}h</div>
                            </div>
                          </div>

                          {/* Forecasted Hours (manually entered) with Edit Button */}
                          <div className="bg-orange-100 rounded px-2 py-0.5 border border-orange-300 relative min-w-fit">
                            <button
                              onClick={() => handleEditForecast(proj.id, dept, forecastedHoursValue)}
                              className="absolute top-0.5 left-0.5 p-0.5 bg-orange-500 hover:bg-orange-600 text-white rounded transition"
                              title={t.editForecastedHours}
                            >
                              <Pencil size={8} />
                            </button>
                            <div className="text-center pl-3">
                              <div className="text-xs text-orange-700 font-bold">{t.pronosticado}</div>
                              <div className="text-xs font-black text-orange-700">{forecastedHoursValue}h</div>
                            </div>
                          </div>

                          {/* Utilization % = (Used + Forecasted / Quoted) * 100 */}
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
                        onClick={() => setProjectZoom(proj.id, Math.max(50, getProjectZoom(proj.id) - 10))}
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
                        value={getProjectZoom(proj.id)}
                        onChange={(e) => setProjectZoom(proj.id, parseInt(e.target.value))}
                        className="w-12 cursor-pointer h-1.5"
                      />
                      <button
                        onClick={() => setProjectZoom(proj.id, Math.min(200, getProjectZoom(proj.id) + 10))}
                        className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                        title="Zoom In"
                      >
                        <ZoomIn size={12} />
                      </button>
                      <span className="text-xs font-semibold text-indigo-900">{getProjectZoom(proj.id)}%</span>
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
                    <div style={{ zoom: `${getProjectZoom(proj.id) / 100}` }}>
                      <div className="overflow-x-auto border border-gray-300 bg-white" style={{ scrollBehavior: 'smooth' }}>
                      <table className="border-collapse text-xs w-full">
                        <thead>
                        <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                          <th className="border border-blue-500 px-1 py-0.5 text-left font-bold sticky left-0 bg-blue-600 z-10 uppercase text-xs">
                            {proj.name}
                          </th>
                          {allWeeksData.map((weekData, idx) => {
                            const isCurrentWeek = idx === currentDateWeekIndex;
                            return (
                              <th
                                key={weekData.date}
                                data-week-index={idx}
                                className={`border px-0.5 py-0.5 text-center font-bold min-w-20 relative transition-all text-xs ${
                                  isCurrentWeek
                                    ? 'bg-gradient-to-b from-red-500 via-orange-500 to-red-600 text-white border-2 border-red-700 shadow-lg ring-2 ring-red-300'
                                    : weekData.isNextYear
                                      ? 'bg-gradient-to-b from-blue-500 to-blue-600 border-blue-400 text-white'
                                      : 'bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white'
                                }`}
                              >
                                <div className={`font-bold text-xs leading-none`}>W{weekData.weekNum}</div>
                              </th>
                            );
                          })}
                        </tr>
                    </thead>
                    <tbody>
                      {/* Department row for this project */}
                      <tr className="hover:bg-gray-50">
                        <td className="border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 sticky left-0 z-10 pl-0.5">
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
                          return (
                            <td
                              key={`${proj.id}-${dept}-${week}`}
                              data-week-index={weekIdx}
                              onClick={() => handleEditCell(dept, week, proj.id)}
                              className={`border p-0 relative text-xs cursor-pointer transition-all hover:shadow-md ${
                                isCurrentWeekColumn
                                  ? 'border-red-500 border-2 shadow-md bg-gradient-to-b from-red-50 to-orange-50'
                                  : 'border-gray-300'
                              }`}
                            >
                              {renderCellContent(dept, week, proj.id)}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                    </table>
                      </div>
                    </div>
                  )}

                  {/* Utilized Hours editing modal - floating overlay centered on screen */}
                  {(() => {
                    const dept = departmentFilter as Department;
                    const isEditingThisUtilized = editingUtilized?.projectId === proj.id && editingUtilized?.department === dept;
                    const deptInfo = getDepartmentIcon(dept);

                    if (!isEditingThisUtilized) return null;

                    return (
                      <>
                        {/* Backdrop */}
                        <div
                          className="fixed inset-0 bg-black bg-opacity-50 z-40"
                          onClick={handleCancelUtilized}
                        />
                        {/* Modal */}
                        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 p-4 sm:p-0">
                          <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-full max-w-[95vw] sm:max-w-md">
                            {/* Header */}
                            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-purple-100">
                              <div className="flex items-center gap-3">
                                <span className={`text-3xl ${deptInfo.color}`}>{deptInfo.icon}</span>
                                <div>
                                  <h3 className="text-lg font-bold text-gray-800">{getDepartmentLabel(dept as Department, t)}</h3>
                                  <div className="text-xs text-gray-600">{t.editUsedHours}</div>
                                </div>
                              </div>
                              <button
                                onClick={handleCancelUtilized}
                                className="p-1 text-gray-600 hover:bg-gray-200 rounded transition"
                                title={t.cancel}
                              >
                                <X size={20} />
                              </button>
                            </div>

                            {/* Content */}
                            <div className="p-6 space-y-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">{t.hours}</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={utilizedHours}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '' || /^\d+$/.test(val)) {
                                      setUtilizedHours(val);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveUtilized();
                                    }
                                  }}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                  autoFocus
                                  placeholder="0"
                                />
                              </div>
                            </div>

                            {/* Footer */}
                            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3 justify-end">
                              <button
                                onClick={handleCancelUtilized}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition"
                              >
                                {t.cancel}
                              </button>
                              <button
                                onClick={handleSaveUtilized}
                                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded hover:bg-purple-700 transition"
                              >
                                {t.save}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}

                  {/* Forecasted Hours editing modal - floating overlay centered on screen */}
                  {(() => {
                    const dept = departmentFilter as Department;
                    const isEditingThisForecast = editingForecast?.projectId === proj.id && editingForecast?.department === dept;
                    const deptInfo = getDepartmentIcon(dept);

                    if (!isEditingThisForecast) return null;

                    return (
                      <>
                        {/* Backdrop */}
                        <div
                          className="fixed inset-0 bg-black bg-opacity-50 z-40"
                          onClick={handleCancelForecast}
                        />
                        {/* Modal */}
                        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 p-4 sm:p-0">
                          <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-full max-w-[95vw] sm:max-w-md">
                            {/* Header */}
                            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-orange-100">
                              <div className="flex items-center gap-3">
                                <span className={`text-3xl ${deptInfo.color}`}>{deptInfo.icon}</span>
                                <div>
                                  <h3 className="text-lg font-bold text-gray-800">{getDepartmentLabel(dept as Department, t)}</h3>
                                  <div className="text-xs text-gray-600">{t.editForecastedHours}</div>
                                </div>
                              </div>
                              <button
                                onClick={handleCancelForecast}
                                className="p-1 text-gray-600 hover:bg-gray-200 rounded transition"
                                title={t.cancel}
                              >
                                <X size={20} />
                              </button>
                            </div>

                            {/* Content */}
                            <div className="p-6 space-y-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">{t.hours}</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={forecastHours}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '' || /^\d+$/.test(val)) {
                                      setForecastHours(val);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveForecast();
                                    }
                                  }}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                  autoFocus
                                  placeholder="0"
                                />
                              </div>
                            </div>

                            {/* Footer */}
                            <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3 justify-end">
                              <button
                                onClick={handleCancelForecast}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition"
                              >
                                {t.cancel}
                              </button>
                              <button
                                onClick={handleSaveForecast}
                                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded hover:bg-orange-700 transition"
                              >
                                {t.save}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              );
            })}
            </>
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
              <div className="overflow-x-auto">
                <div className="inline-block min-w-full">
                  {/* Week headers row */}
                  <div className="flex gap-0.5 mb-0.5">
                    {/* Empty cell for department names column */}
                    <div className="w-10 flex-shrink-0"></div>

                    {/* Week number headers */}
                    {allWeeksData.map((weekData, idx) => {
                      const isCurrentWeek = idx === currentDateWeekIndex;
                      return (
                        <div
                          key={`header-${weekData.date}`}
                          className={`w-16 flex-shrink-0 text-center text-[8px] font-bold p-0.5 rounded border ${
                            isCurrentWeek
                              ? 'bg-red-300 text-red-900 border-red-500'
                              : 'bg-blue-100 text-blue-900 border-blue-300'
                          }`}
                        >
                          W{weekData.weekNum}
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
                        <div className={`w-10 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold p-0.5 rounded border ${deptIcon.color} bg-white`}>
                          <span title={dept}>{dept}</span>
                        </div>

                        {/* Week cells for this department */}
                        {allWeeksData.map((weekData, idx) => {
                          const isCurrentWeek = idx === currentDateWeekIndex;

                          // Get SCIO Team Members / Hours per Week capacity for this week
                          const weekCapacity = scioTeamMembers[dept]?.[weekData.date] || 0;

                          // Calculate total hours occupied for this department this week
                          const deptAssignments = assignments.filter(a => {
                            const emp = employees.find(e => e.id === a.employeeId);
                            return a.weekStartDate === weekData.date && emp?.department === dept;
                          });

                          const totalWeekHours = deptAssignments.reduce((sum, a) => sum + a.hours, 0);

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

                          // Determine color based on available capacity
                          let bgColor = 'bg-gray-200 border-gray-400';
                          let textColor = 'text-gray-700';

                          // If no capacity set, show gray
                          if (totalCapacity === 0) {
                            bgColor = 'bg-gray-200 border-gray-400';
                            textColor = 'text-gray-700';
                          } else if (availableCapacity <= 0) {
                            // Red: Over-allocated or fully occupied
                            bgColor = 'bg-red-500 border-red-600';
                            textColor = 'text-white';
                          } else if (isMFG) {
                            // For MFG: use percentage-based thresholds on available hours
                            if (availableCapacity < totalCapacity * 0.25) {
                              bgColor = 'bg-orange-400 border-orange-500';
                              textColor = 'text-white';
                            } else if (availableCapacity < totalCapacity * 0.5) {
                              bgColor = 'bg-yellow-300 border-yellow-400';
                              textColor = 'text-yellow-900';
                            } else {
                              bgColor = 'bg-green-300 border-green-400';
                              textColor = 'text-green-900';
                            }
                          } else {
                            // For other departments: use percentage-based thresholds on available people
                            if (availableCapacity < totalCapacity * 0.25) {
                              bgColor = 'bg-orange-400 border-orange-500';
                              textColor = 'text-white';
                            } else if (availableCapacity < totalCapacity * 0.5) {
                              bgColor = 'bg-yellow-300 border-yellow-400';
                              textColor = 'text-yellow-900';
                            } else {
                              bgColor = 'bg-green-300 border-green-400';
                              textColor = 'text-green-900';
                            }
                          }

                          return (
                            <div
                              key={`${dept}-${weekData.date}`}
                              className={`w-16 flex-shrink-0 flex flex-col items-center justify-center p-0.5 rounded border text-[7px] font-semibold ${bgColor} ${
                                isCurrentWeek ? 'ring-1 ring-red-600 shadow-md' : ''
                              }`}
                              title={`${dept} - W${weekData.weekNum}${weekData.isNextYear ? ` (${selectedYear + 1})` : ''}: ${totalCapacity.toFixed(2)} ${unit} (Available: ${availableCapacity.toFixed(2)})`}
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

              {projects.filter((proj) => {
                // Filter projects that have activity in the selected year range
                const yearStart = `${selectedYear}-01-01`;
                const yearEnd = `${selectedYear + 1}-12-31`; // Include next year weeks too

                // If in General view, exclude quick-created projects (those with visibleInDepartments)
                // Check if array has elements, not just that it exists (empty array [] is truthy)
                if (departmentFilter === 'General' && proj.visibleInDepartments && proj.visibleInDepartments.length > 0) {
                  return false;
                }

                return proj.startDate <= yearEnd && proj.endDate >= yearStart;
              }).map((proj) => (
                <div key={proj.id} className="mb-1 border border-gray-300 rounded-lg shadow-sm bg-white overflow-hidden">
                  {/* Project header */}
                  <div className="bg-gray-100 hover:bg-gray-200 cursor-pointer p-1 border-b border-gray-300" onClick={() => toggleProjectExpanded(proj.id)}>
                    <div className="flex items-center justify-between gap-1">
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
                            {proj.numberOfWeeks} weeks
                          </span>
                          {proj.projectManagerId && (
                            <>
                              <span className="text-gray-400">•</span>
                              <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                👨‍💼 {employees.find((e) => e.id === proj.projectManagerId)?.name || 'PM'}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Zoom controls */}
                      <div className="flex items-center gap-0.5 ml-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs font-semibold text-indigo-900">Z:</span>
                        <button
                          onClick={() => setProjectZoom(proj.id, Math.max(50, getProjectZoom(proj.id) - 10))}
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
                          value={getProjectZoom(proj.id)}
                          onChange={(e) => setProjectZoom(proj.id, parseInt(e.target.value))}
                          className="w-12 cursor-pointer h-1.5"
                        />
                        <button
                          onClick={() => setProjectZoom(proj.id, Math.min(200, getProjectZoom(proj.id) + 10))}
                          className="p-0.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded transition"
                          title="Zoom In"
                        >
                          <ZoomIn size={12} />
                        </button>
                        <span className="text-xs font-semibold text-indigo-900 ml-0.5">{getProjectZoom(proj.id)}%</span>
                      </div>
                    </div>

                  </div>

                  {/* Expandable content - includes hours panel AND table */}
                  {expandedProjects[proj.id] && (
                    <>
                      {/* Quoted and Used Hours by Department - ALL departments (Read-only in General View) */}
                      <div className="bg-white rounded p-0 border border-gray-200 m-0.5">
                        {/* Show ALL 6 departments in 6 columns - NO edit buttons in General view */}
                        <div className="grid grid-cols-6 gap-0">
                          {DEPARTMENTS.map((dept) => {
                            const utilizedHoursValue = proj.departmentHoursUtilized?.[dept] || 0;
                            const cotizadasHoursValue = proj.departmentHoursAllocated?.[dept] || 0;
                            const utilizationPercent = getUtilizationPercent(dept, proj.id);
                            const utilizationColorInfo = getUtilizationColor(utilizationPercent);
                            const deptInfo = getDepartmentIcon(dept);

                            return (
                              <div key={dept} className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded p-0.5 border border-gray-100 text-center">
                                <div className="flex items-center justify-center gap-0 mb-0">
                                  <span className={`text-[10px] ${deptInfo.color}`}>{deptInfo.icon}</span>
                                </div>
                                <div className="text-[10px] text-gray-700 mb-0 leading-tight">
                                  <span className="font-semibold text-[10px]">{cotizadasHoursValue}</span>
                                  <span className="text-gray-500 text-[10px]">/</span>
                                  <span className="font-semibold text-[10px]">{utilizedHoursValue}</span>
                                </div>
                                <div className={`px-0 py-0 rounded text-[10px] font-bold text-center leading-none ${utilizationColorInfo.bg} ${utilizationColorInfo.text}`}>
                                  {utilizationPercent}%
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="overflow-x-auto" style={{ scrollBehavior: 'smooth', zoom: `${getProjectZoom(proj.id) / 100}` }} ref={(el) => {
                        if (el) {
                          projectTableRefs.current.set(proj.id, el);
                        }
                      }}>
                      <table className="border-collapse text-xs w-full">
                        <thead>
                          <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white sticky top-0 z-20">
                            <th className="border border-blue-500 px-1 py-0.5 text-left font-bold sticky left-0 bg-blue-600 z-30 uppercase text-xs">
                              Dpto
                            </th>
                            {allWeeksData.map((weekData, idx) => {
                              const isCurrentWeek = idx === currentDateWeekIndex;
                              return (
                                <th
                                  key={weekData.date}
                                  data-week-index={idx}
                                  className={`border px-0.5 py-0.5 text-center font-bold min-w-20 relative transition-all text-xs ${
                                    isCurrentWeek
                                      ? 'bg-gradient-to-b from-red-500 via-orange-500 to-red-600 text-white border-2 border-red-700 shadow-lg ring-2 ring-red-300'
                                      : weekData.isNextYear
                                        ? 'bg-gradient-to-b from-blue-500 to-blue-600 border-blue-400 text-white'
                                        : 'bg-gradient-to-b from-blue-600 to-blue-700 border-blue-500 text-white'
                                  }`}
                                >
                                  {isCurrentWeek && (
                                    <>
                                      <div className="absolute -top-1.5 left-1/2 transform -translate-x-1/2 bg-red-700 text-white px-0.5 py-0 rounded-full text-xs font-bold whitespace-nowrap shadow-md">
                                        🎯
                                      </div>
                                    </>
                                  )}
                                  <div className={`font-bold text-xs leading-none`}>W{weekData.weekNum}</div>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {/* Show ALL 6 departments in the calendar */}
                          {DEPARTMENTS.map((dept) => {
                            return (
                              <tr key={`${proj.id}-${dept}`} className="hover:bg-gray-50">
                                <td className="border border-gray-300 px-0.5 py-0 text-xs text-gray-700 bg-gray-50 sticky left-0 z-10 pl-0.5">
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
                                  const projectDeptAssignments = assignments.filter((a) => {
                                    if (a.projectId !== proj.id || a.weekStartDate !== week) return false;
                                    const emp = employees.find((e) => e.id === a.employeeId);
                                    return emp && emp.department === dept;
                                  });

                                  const totalHours = projectDeptAssignments.reduce((sum, a) => sum + a.hours, 0);
                                  const talent = calculateTalent(totalHours);
                                  const isInRange = isWeekInProjectRange(week, proj);

                                  // Get the stage from actual assignments (what was selected when adding hours)
                                  const assignmentStage = projectDeptAssignments.length > 0 ? projectDeptAssignments[0].stage : null;
                                  const stageColor = assignmentStage ? getStageColor(assignmentStage) : null;

                                  // Get comment from first assignment (comments are shared across assignments in same cell)
                                  const cellComment = projectDeptAssignments.length > 0 ? projectDeptAssignments[0].comment : undefined;

                                  // Get department-specific start and duration info
                                  const deptStages = proj.departmentStages?.[dept];
                                  const deptFirstStage = deptStages && deptStages.length > 0 ? deptStages[0] : null;

                                  // Calculate the actual week index from the department's start date
                                  const deptStartDate = deptFirstStage?.departmentStartDate;
                                  const deptDuration = deptFirstStage?.durationWeeks || 0;

                                  // Calculate department end date by adding weeks to start date
                                  let deptEndDate = '';
                                  if (deptStartDate && deptDuration > 0) {
                                    const endDate = new Date(deptStartDate);
                                    endDate.setDate(endDate.getDate() + (deptDuration * 7) - 1);
                                    deptEndDate = endDate.toISOString().split('T')[0];
                                  }

                                  // Check if current week is within department range using date comparison
                                  // For departments WITHOUT specific departmentStages, use project dates instead
                                  const effectiveDeptStartDate = deptStartDate || proj.startDate;
                                  const effectiveDeptEndDate = deptEndDate || proj.endDate;
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
                                          ? 'border-red-500 border-2 shadow-md bg-gradient-to-b from-red-50 to-orange-50'
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
                                            <span className="font-semibold text-[7px]">{assignmentStage}</span>
                                          ) : isDeptWeekInRange ? (
                                            <>
                                              {isDeptFirstWeek ? (
                                                <span className="text-[10px] font-bold">1</span>
                                              ) : (
                                                <span className="font-bold text-[10px]">{deptConsecutiveWeek}</span>
                                              )}
                                            </>
                                          ) : isInRange ? (
                                            <span className="text-[10px]">○</span>
                                          ) : (
                                            '—'
                                          )}
                                        </div>
                                      ) : (
                                        <div className={`p-0 rounded text-center text-[10px] font-semibold leading-tight relative ${
                                          stageColor ? `${stageColor.bg} ${stageColor.text}` : 'bg-blue-100 text-blue-900'
                                        } ${!isDeptWeekInRange ? 'border border-dashed border-red-500 bg-red-50' : ''}`}>
                                          {cellComment && (
                                            <button
                                              onClick={() => setViewingComment({ comment: cellComment, projectName: proj.name, department: dept })}
                                              className="absolute top-0.5 left-0.5 text-amber-600 hover:text-amber-800 cursor-pointer"
                                              title={cellComment}
                                            >
                                              💬
                                            </button>
                                          )}
                                          {!isDeptWeekInRange && (
                                            <div className="absolute top-0.5 -right-0.5 text-red-600 font-bold text-[10px]">⚠</div>
                                          )}
                                          <div className="text-[10px] font-bold leading-tight">{totalHours}h</div>
                                          <div className="text-[10px] opacity-75 leading-tight">{talent}</div>
                                          {stageColor && assignmentStage && (
                                            <div className="text-[7px] font-semibold leading-tight">{assignmentStage}</div>
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
              ))}
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
                <div className="w-6 h-6 bg-yellow-400 rounded border border-yellow-500 flex items-center justify-center text-xs font-bold flex-shrink-0">S</div>
                <span className="text-gray-700 font-medium">Current week</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-red-50 rounded border border-dashed border-red-500 flex items-center justify-center text-red-600 text-sm font-bold flex-shrink-0">⚠</div>
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
        {showQuickProjectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-blue-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">➕ {t.createProject}</h2>
                <button
                  onClick={() => setShowQuickProjectModal(false)}
                  className="hover:bg-blue-700 p-1 rounded transition"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleCreateQuickProject(); }} className="p-6 space-y-4">
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
                  <input
                    type="date"
                    value={quickProjectForm.startDate}
                    onChange={(e) => setQuickProjectForm({ ...quickProjectForm, startDate: e.target.value })}
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
                    onChange={(e) => setQuickProjectForm({ ...quickProjectForm, facility: e.target.value as 'AL' | 'MI' })}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 focus:border-blue-500 focus:outline-none transition bg-white text-sm"
                  >
                    <option value="AL">AL</option>
                    <option value="MI">MI</option>
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
                        const num = value === '' ? 0 : parseInt(value);
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
                    onClick={() => setShowQuickProjectModal(false)}
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
        {showImportProjectModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="bg-amber-600 text-white px-6 py-4 flex items-center justify-between rounded-t-lg">
                <h2 className="text-lg font-bold">📂 {t.importProject || 'Import Existing Project'}</h2>
                <button
                  onClick={() => setShowImportProjectModal(false)}
                  className="hover:bg-amber-700 p-1 rounded transition"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleImportProject(); }} className="p-6 space-y-4">
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
                  <input
                    type="date"
                    value={importProjectForm.startDate}
                    onChange={(e) => setImportProjectForm({ ...importProjectForm, startDate: e.target.value })}
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
                        const num = value === '' ? 0 : parseInt(value);
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
                    onClick={() => setShowImportProjectModal(false)}
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

        {/* PRG External Team Modal */}
        {isPRGModalOpen && (
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
                        const currentWeekStart = formatToISO(new Date());
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
        {isBuildModalOpen && (
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
                        const currentWeekStart = formatToISO(new Date());
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
