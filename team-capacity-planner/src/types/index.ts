/**
 * DEPARTMENT TYPES
 * Represents the 6 departments in the organization
 */
export type Department = 'PM' | 'MED' | 'HD' | 'MFG' | 'BUILD' | 'PRG';
// PM: Project Manager
// MED: Mechanical Design (Diseño Mecánico)
// HD: Hardware Design
// MFG: Manufacturing (Manufactura)
// BUILD: Assembly (Ensamble)
// PRG: Programming PLC

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
  name: string;
  client: string;
  startDate: string; // ISO format YYYY-MM-DD
  endDate: string;   // ISO format YYYY-MM-DD
  facility: Facility;
  numberOfWeeks: number;
  projectManagerId?: string; // ID of the assigned Project Manager (PM department)
  departmentStages?: Record<Department, DepartmentStageConfig[]>;
  departmentHoursAllocated?: Record<Department, number>; // Budget hours per department (presupuesto/cotizado)
  departmentHoursUtilized?: Record<Department, number>; // Hours utilized/used per department (horas utilizadas - manually entered)
  departmentHoursForecast?: Record<Department, number>; // Forecasted hours per department (horas pronosticadas - manually entered)
  visibleInDepartments?: Department[]; // Departments where this project is visible (for quick-created projects)
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
  weekStartDate: string; // ISO format YYYY-MM-DD
  hours: number; // Total hours: scioHours + externalHours (backward compatible)
  scioHours?: number; // Internal SCIO hours (BUILD and PRG only)
  externalHours?: number; // External/subcontracted hours (BUILD and PRG only)
  stage: Stage;
  comment?: string; // Optional comment for this assignment
}
