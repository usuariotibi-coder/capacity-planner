/**
 * LANGUAGE TYPES
 * Supported languages in the application
 */
export type Language = 'es' | 'en';

/**
 * DEPARTMENT TYPES
 * Represents the 6 departments in the organization
 */
export type Department = 'PM' | 'MED' | 'HD' | 'MFG' | 'BUILD' | 'PRG' | 'PURCHASING';
export type ProjectVisibilityScope = Department | 'GENERAL';
// PM: Project Manager
// MED: Mechanical Design (Diseño Mecánico)
// HD: Hardware Design
// MFG: Manufacturing (Manufactura)
// BUILD: Assembly (Ensamble)
// PRG: Programming PLC

/**
 * USER DEPARTMENT TYPES (for permissions/registration)
 */
export type UserDepartment = Department | 'OTHER';
export type OtherDepartment = 'OPERATIONS' | 'FINANCE' | 'HUMAN_RESOURCES' | 'BUSINESS_INTELLIGENCE' | 'HEAD_ENGINEERING';

/**
 * FACILITY TYPES
 * Represents the 3 physical facilities/locations
 */
export type Facility = 'AL' | 'MI' | 'MX';
// AL: Facility A
// MI: Facility B
// MX: Facility C

/**
 * STAGE TYPES BY DEPARTMENT
 * Each department has specific stages representing work phases
 */
export type HDStage = 'SWITCH_LAYOUT_REVISION' | 'CONTROLS_DESIGN' | 'RELEASE' | 'RED_LINES' | 'SUPPORT';
export type MEDStage = 'CONCEPT' | 'DETAIL_DESIGN' | 'RELEASE' | 'RED_LINES' | 'SUPPORT';
export type BUILDStage = 'CABINETS_FRAMES' | 'OVERALL_ASSEMBLY' | 'FINE_TUNING' | 'COMMISSIONING' | 'SUPPORT';
export type PRGStage = 'OFFLINE' | 'ONLINE' | 'DEBUG' | 'COMMISSIONING' | 'SUPPORT_MANUALS_FLOW_CHARTS' | 'ROBOT_SIMULATION' | 'STANDARDS_REV_PROGRAMING_CONCEPT';
export type Stage = HDStage | MEDStage | BUILDStage | PRGStage | null;

/**
 * EMPLOYEE INTERFACE
 * Represents a team member with capacity information
 * @property id - Unique identifier (UUID)
 * @property name - Employee full name
 * @property role - Job title or position
 * @property department - Department assignment
 * @property capacity - Available hours per week
 * @property isActive - Whether employee is currently active
 * @property isSubcontractedMaterial - Whether this is subcontracted material (BUILD dept only)
 * @property subcontractCompany - Company name if subcontracted (AMI, VICER, ITAX, MCI, MG Electrical)
 * @property hireDate - Fecha de alta: date the employee started working with us (ISO format YYYY-MM-DD)
 * @property terminationDate - Fecha de baja: date the employee stopped working with us (ISO format YYYY-MM-DD)
 */
export interface Employee {
  id: string;
  name: string;
  role: string;
  department: Department;
  capacity: number; // hours/week
  isActive: boolean;
  isSubcontractedMaterial?: boolean; // Only for BUILD department
  subcontractCompany?: string; // Only for BUILD department: 'AMI' | 'VICER' | 'ITAX' | 'MCI' | 'MG Electrical'
  hireDate?: string | null; // ISO format YYYY-MM-DD
  terminationDate?: string | null; // ISO format YYYY-MM-DD
}

/**
 * DEPARTMENT STAGE CONFIG INTERFACE
 * Defines when and how a department works on a project
 * @property stage - Specific work phase (or null if no stage)
 * @property weekStart - Start week number (1-based, relative to project start)
 * @property weekEnd - End week number (1-based, relative to project start)
 * @property departmentStartDate - Actual start date for this department (ISO format YYYY-MM-DD)
 * @property durationWeeks - Duration in weeks for this department
 */
export interface DepartmentStageConfig {
  stage: Stage;
  weekStart: number; // 1-based week number relative to project start
  weekEnd: number;   // 1-based week number relative to project start
  departmentStartDate?: string; // ISO format YYYY-MM-DD - actual start date for this specific department
  durationWeeks?: number; // Duration in weeks for this department
}

/**
 * PROJECT INTERFACE
 * Represents a project with assigned departments and timelines
 * @property id - Unique identifier (UUID)
 * @property name - Project name
 * @property client - Client or company name
 * @property startDate - Project start date (ISO format YYYY-MM-DD)
 * @property endDate - Project end date (ISO format YYYY-MM-DD)
 * @property facility - Physical location
 * @property numberOfWeeks - Duration in weeks
 * @property projectManagerId - ID of the assigned Project Manager (PM department)
 * @property departmentStages - Department-specific timelines and stages
 */
export interface Project {
  id: string;
  projectNumber?: string | null; // Canonical project number/code, e.g. '3268' or '3268-CO01'
  name: string;
  client: string;
  startDate: string; // ISO format YYYY-MM-DD
  endDate: string;   // ISO format YYYY-MM-DD
  facility: Facility;
  numberOfWeeks: number;
  projectManagerId?: string; // ID of the assigned Project Manager (PM department)
  isHighProbability?: boolean; // Marks projects with high execution probability
  isHidden?: boolean;
  hiddenAt?: string | null;
  isClosed?: boolean;
  closedAt?: string | null;
  departmentStages?: Record<Department, DepartmentStageConfig[]>;
  departmentHoursAllocated?: Record<Department, number>; // Budget hours per department (presupuesto/cotizado)
  departmentHoursUtilized?: Record<Department, number>; // Hours utilized/used per department (horas utilizadas - manually entered)
  departmentHoursForecast?: Record<Department, number>; // Forecasted hours per department (horas pronosticadas - manually entered)
  visibleInDepartments?: ProjectVisibilityScope[]; // Departments where this project is visible (GENERAL allows showing in General view too)
}

/**
 * PROJECT CHANGE ORDER INTERFACE
 * Represents quoted change order hours per project and department
 * @property id - Unique identifier (UUID)
 * @property projectId - Reference to Project
 * @property department - Department assignment
 * @property name - Change order name (e.g., CO01)
 * @property hoursQuoted - Quoted hours for this change order
 */
export interface ProjectChangeOrder {
  id: string;
  projectId: string;
  department: Department;
  name: string;
  hoursQuoted: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * REGISTERED USER INTERFACE
 * Represents users created through the registration flow (BI management view)
 */
export interface RegisteredUser {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  dateJoined: string;
  lastLogin?: string | null;
  department?: UserDepartment | null;
  otherDepartment?: OtherDepartment | null;
}

/**
 * ASSIGNMENT INTERFACE
 * Represents hours allocated to a specific project, department, and week
 * Links employees to projects for capacity tracking
 * @property id - Unique identifier (UUID)
 * @property employeeId - Reference to Employee
 * @property projectId - Reference to Project
 * @property weekStartDate - Week start date (ISO format YYYY-MM-DD)
 * @property hours - Number of hours allocated (legacy, equal to scioHours + externalHours for compatibility)
 * @property scioHours - Internal (SCIO) hours allocated (BUILD and PRG departments only)
 * @property externalHours - External/subcontracted hours allocated (BUILD and PRG departments only)
 * @property stage - Work phase/stage for this assignment
 * @property comment - Optional comment/note for this assignment
 */
export interface Assignment {
  id: string;
  employeeId: string;
  projectId: string;
  changeOrderId?: string | null;
  department?: Department; // Effective department: departmentOverride if set, otherwise the employee's own
  homeDepartment?: Department; // The employee's own department, regardless of any support override
  departmentOverride?: Department | null; // Set when this employee is supporting a department other than their own
  weekStartDate: string; // ISO format YYYY-MM-DD
  hours: number; // Total hours: scioHours + externalHours (backward compatible)
  scioHours?: number; // Internal SCIO hours (BUILD and PRG only)
  externalHours?: number; // External/subcontracted hours (BUILD and PRG only)
  totalHours?: number; // API computed: scioHours + externalHours or hours
  stage: Stage;
  comment?: string; // Optional comment for this assignment
  employee?: Employee;
  project?: Project;
}

/**
 * SCIO HEADCOUNT EVENT
 * A hire (positive delta) or departure (negative delta) logged against a
 * department's SCIO Team Members headcount, effective on a given date. Saving
 * one recomputes and overwrites ScioTeamCapacity.capacity for every week from
 * the earliest event's week forward -- see the backend's
 * recompute_scio_capacity_from_events. Anonymous by design: not linked to a
 * named Employee record.
 */
export interface ScioHeadcountEvent {
  id: string;
  department: Department;
  effectiveDate: string; // ISO format YYYY-MM-DD
  delta: number; // Signed headcount change, e.g. +1 for a hire, -2 for two departures
  comment?: string;
  createdByUsername?: string | null;
  createdAt?: string;
}

/**
 * PROJECT DEPARTMENT WEEKLY ACTUAL
 * Real historical hours per project/department/week, sourced from the Finance
 * actuals report (no per-employee breakdown available). Past weeks are locked to
 * manual editing; the Capacity Matrix reads "Used" hours for those weeks from here
 * instead of from Assignment records.
 */
export interface ProjectDepartmentWeeklyActual {
  id: string;
  projectId: string;
  department: Department;
  weekStartDate: string; // ISO format YYYY-MM-DD
  hours: number; // Can be negative when Finance issues a correction
}

export interface FinanceImportLog {
  id: string;
  uploadedBy?: number | null;
  uploadedByUsername?: string | null;
  fileName: string;
  reportDatesProcessed: string[];
  newProjectsCreated: string[];
  weeklyActualsWritten: number;
  jobCodesSeededOnly: string[];
  warnings: string[];
  createdAt: string;
}

/**
 * DAILY TIME ENTRY TYPES
 * Daily actuals log: what an employee actually spent hours on, per calendar day.
 * Separate from Assignment (weekly planning) — this is a finer-grained "what really
 * happened" record: project work, project-issue resolution (OIL), non-project
 * indirect time (IND), or vacation (VAC).
 */
export type TimeEntryType = 'PROJECT' | 'OIL' | 'IND' | 'VAC';

export interface DailyTimeEntry {
  id: string;
  employeeId: string;
  employeeName?: string; // Read-only, from API
  department?: Department; // Read-only, the employee's department
  date: string; // ISO format YYYY-MM-DD
  entryType: TimeEntryType;
  projectId?: string | null; // Required for PROJECT and OIL, must be null for IND/VAC
  projectName?: string | null; // Read-only, from API
  hours: number;
  comment?: string;
}
