import { useEffect, useState } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { changeOrdersApi } from '../services/api';
import type { Assignment, Employee, Department, ProjectChangeOrder } from '../types';
import { generateId } from '../utils/id';
import { getAllWeeksWithNextYear, normalizeWeekStartDate, getWeekStart, formatToISO } from '../utils/dateUtils';
import { Plus, Trash2, Edit2, ChevronDown, ChevronUp, Calendar, X, Download, FileSpreadsheet } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { useAuth } from '../context/AuthContext';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];
const SHARED_EDIT_DEPARTMENTS: Department[] = ['BUILD', 'MFG'];
const HEAD_ENGINEERING_MANAGED_DEPARTMENTS: Department[] = ['MED', 'HD'];
const DEFAULT_WEEKLY_CAPACITY = 45;

export function ResourcesPage() {
  const { employees, addEmployee, deleteEmployee, updateEmployee } = useEmployeeStore();
  const assignments = useAssignmentStore((state) => state.assignments);
  const fetchAssignments = useAssignmentStore((state) => state.fetchAssignments);
  const projects = useProjectStore((state) => state.projects);
  const { activeTeams } = useBuildTeamsStore();
  const { activeTeams: prgActiveTeams } = usePRGTeamsStore();
  const { language } = useLanguage();
  const t = useTranslation(language);
  const { hasFullAccess, isReadOnly, currentUserDepartment, currentUserOtherDepartment } = useAuth();
  const hasHeadEngineeringScope =
    currentUserDepartment === 'OTHER' &&
    currentUserOtherDepartment === 'HEAD_ENGINEERING';
  const canCreateEmployee =
    hasFullAccess ||
    hasHeadEngineeringScope ||
    (!isReadOnly && Boolean(currentUserDepartment && DEPARTMENTS.includes(currentUserDepartment as Department)));
  const canEditEmployee = (department: Department) => {
    if (hasFullAccess) return true;
    if (isReadOnly) return false;
    if (hasHeadEngineeringScope) {
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
  const getDefaultDepartment = (): Department => {
    if (hasHeadEngineeringScope) {
      return 'MED';
    }
    if (!hasFullAccess && !isReadOnly && currentUserDepartment && DEPARTMENTS.includes(currentUserDepartment as Department)) {
      return currentUserDepartment as Department;
    }
    return 'PM';
  };
  const lockedDepartment: Department | null =
    !hasFullAccess &&
    !isReadOnly &&
    !hasHeadEngineeringScope &&
    currentUserDepartment &&
    DEPARTMENTS.includes(currentUserDepartment as Department)
      ? (currentUserDepartment as Department)
      : null;
  const availableDepartmentOptions: Department[] = hasHeadEngineeringScope
    ? HEAD_ENGINEERING_MANAGED_DEPARTMENTS
    : DEPARTMENTS;

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Employee>>({
    name: '',
    role: '',
    department: getDefaultDepartment(),
    capacity: DEFAULT_WEEKLY_CAPACITY,
    isSubcontractedMaterial: false,
    subcontractCompany: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());
  const [exportingDepartment, setExportingDepartment] = useState<Department | null>(null);
  const minYearOption = 2024;
  const maxYearOption = new Date().getFullYear() + 10;
  const yearOptions = Array.from(
    { length: maxYearOption - minYearOption + 1 },
    (_, idx) => minYearOption + idx
  );

  const allWeeksData = getAllWeeksWithNextYear(selectedYear);
  const lastWeek = Math.max(
    ...allWeeksData.filter((week) => !week.isNextYear).map((week) => week.weekNum),
    52
  );

  const getAssignmentHours = (assignment: Assignment): number => {
    if (typeof assignment.totalHours === 'number') {
      return assignment.totalHours;
    }

    if (typeof assignment.hours === 'number' && assignment.hours !== 0) {
      return assignment.hours;
    }

    const scioHours = typeof assignment.scioHours === 'number' ? assignment.scioHours : 0;
    const externalHours = typeof assignment.externalHours === 'number' ? assignment.externalHours : 0;
    return scioHours + externalHours;
  };

  const hasWorkHours = (assignment: Assignment): boolean => getAssignmentHours(assignment) > 0;

  // Keep resources view in sync with backend for the selected year.
  useEffect(() => {
    const weeks = getAllWeeksWithNextYear(selectedYear);
    const rangeStart = weeks[0]?.date || `${selectedYear}-01-01`;
    const rangeEnd = weeks[weeks.length - 1]?.date || `${selectedYear + 1}-12-31`;

    const refreshAssignments = () => {
      void fetchAssignments({ startDate: rangeStart, endDate: rangeEnd, force: true });
    };

    refreshAssignments();
    const intervalId = window.setInterval(refreshAssignments, 60000);
    return () => window.clearInterval(intervalId);
  }, [selectedYear, fetchAssignments]);

  // Toggle calendar visibility for an employee
  const toggleEmployeeCalendar = (employeeId: string) => {
    setExpandedEmployees((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(employeeId)) {
        newSet.delete(employeeId);
      } else {
        newSet.add(employeeId);
      }
      return newSet;
    });
  };

  // Get assignments for an employee
  const getEmployeeAssignments = (employeeId: string) => {
    return assignments.filter((a) => a.employeeId === employeeId && hasWorkHours(a));
  };

  // Get project color based on project index for visual distinction
  const getProjectColor = (projectId: string) => {
    const projectIndex = projects.findIndex((p) => p.id === projectId);
    const colors = [
      { bg: 'bg-blue-200', text: 'text-blue-900', border: 'border-blue-400' },
      { bg: 'bg-green-200', text: 'text-green-900', border: 'border-green-400' },
      { bg: 'bg-purple-200', text: 'text-purple-900', border: 'border-purple-400' },
      { bg: 'bg-orange-200', text: 'text-orange-900', border: 'border-orange-400' },
      { bg: 'bg-pink-200', text: 'text-pink-900', border: 'border-pink-400' },
      { bg: 'bg-cyan-200', text: 'text-cyan-900', border: 'border-cyan-400' },
      { bg: 'bg-yellow-200', text: 'text-yellow-900', border: 'border-yellow-400' },
      { bg: 'bg-red-200', text: 'text-red-900', border: 'border-red-400' },
    ];
    // Handle case where project is not found (deleted project)
    if (projectIndex === -1) {
      return { bg: 'bg-gray-200', text: 'text-gray-900', border: 'border-gray-400' };
    }
    return colors[projectIndex % colors.length];
  };

  const formatHours = (value: number): string => {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    if (Number.isInteger(rounded)) {
      return rounded.toString();
    }
    return rounded.toFixed(2).replace(/\.?0+$/, '');
  };

  const getEmployeeCapacity = (employee?: Partial<Employee>): number => {
    const capacityValue = employee?.capacity;
    // Legacy records were initialized with 40h; current business rule is 45h/week.
    if (typeof capacityValue === 'number' && capacityValue === 40) {
      return DEFAULT_WEEKLY_CAPACITY;
    }
    if (typeof capacityValue === 'number' && Number.isFinite(capacityValue) && capacityValue > 0) {
      return capacityValue;
    }
    return DEFAULT_WEEKLY_CAPACITY;
  };

  const handleExportDepartmentResources = async (department: Department, deptEmployees: Employee[]) => {
    if (exportingDepartment) return;
    if (deptEmployees.length === 0) {
      alert(language === 'es' ? 'No hay recursos para exportar en este departamento.' : 'There are no resources to export in this department.');
      return;
    }

    setExportingDepartment(department);
    try {
      const ExcelJS = await import('exceljs');
      const generatedAt = new Date();
      const dateStamp = generatedAt.toISOString().slice(0, 10);
      const generatedLabel = generatedAt.toLocaleString(language === 'es' ? 'es-ES' : 'en-US');
      const workbook = new ExcelJS.Workbook();

      const templateResponse = await fetch('/templates/resources-export-template.xlsx', { cache: 'no-store' });
      if (!templateResponse.ok) {
        throw new Error(`Template download failed: ${templateResponse.status}`);
      }
      const templateBuffer = await templateResponse.arrayBuffer();
      await workbook.xlsx.load(templateBuffer);

      const forecastTemplateNameCandidates = [
        `HD Forecast ${selectedYear}`,
        'HD Forecast 2026',
        'HD Forecast 2025',
      ];
      const forecastTemplate =
        forecastTemplateNameCandidates
          .map((name) => workbook.getWorksheet(name))
          .find((sheet): sheet is NonNullable<typeof sheet> => Boolean(sheet)) ||
        workbook.worksheets.find((sheet) => /forecast/i.test(sheet.name));

      if (!forecastTemplate) {
        throw new Error('Forecast template sheet was not found.');
      }

      const dashboardTemplate = workbook.getWorksheet('Dashboard') || workbook.addWorksheet('Dashboard');
      const internalDashboardTemplate = workbook.getWorksheet('Internal Dashboard') || workbook.addWorksheet('Internal Dashboard');

      const keepSheetNames = new Set([
        forecastTemplate.name,
        dashboardTemplate.name,
        internalDashboardTemplate.name,
      ]);
      [...workbook.worksheets].forEach((sheet) => {
        if (!keepSheetNames.has(sheet.name)) {
          workbook.removeWorksheet(sheet.id);
        }
      });

      const forecastSheetName = `${department} Forecast ${selectedYear}`;
      const forecastSheet = workbook.getWorksheet(forecastTemplate.name)!;
      forecastSheet.name = forecastSheetName;
      const dashboardSheet = workbook.getWorksheet(dashboardTemplate.name)!;
      const internalSheet = workbook.getWorksheet(internalDashboardTemplate.name)!;

      const firstDayCol = 3; // C
      const dayEntries: Array<{
        col: number;
        date: Date;
        day: number;
        month: number;
        year: number;
        weekNumber: number;
        weekStart: string;
        isWeekend: boolean;
      }> = [];

      const yearStart = new Date(selectedYear, 0, 1);
      const yearEnd = new Date(selectedYear, 11, 31);
      let current = new Date(yearStart);
      let weekNumber = 1;
      let dayIdx = 0;
      while (current <= yearEnd) {
        if (dayIdx > 0 && current.getDay() === 1) {
          weekNumber += 1;
        }
        const weekStartDate = getWeekStart(current);
        dayEntries.push({
          col: firstDayCol + dayIdx,
          date: new Date(current),
          day: current.getDate(),
          month: current.getMonth(),
          year: current.getFullYear(),
          weekNumber,
          weekStart: formatToISO(weekStartDate),
          isWeekend: current.getDay() === 0 || current.getDay() === 6,
        });
        current.setDate(current.getDate() + 1);
        dayIdx += 1;
      }
      const lastDayCol = firstDayCol + dayEntries.length - 1;
      const weekStartSet = new Set(dayEntries.map((entry) => entry.weekStart));

      const departmentEmployeeIds = new Set(deptEmployees.map((employee) => employee.id));
      const departmentAssignments = assignments.filter((assignment) =>
        departmentEmployeeIds.has(assignment.employeeId) &&
        hasWorkHours(assignment) &&
        weekStartSet.has(normalizeWeekStartDate(assignment.weekStartDate))
      );

      const projectById = new Map(projects.map((project) => [project.id, project]));
      const projectIndexById = new Map(projects.map((project, index) => [project.id, index]));

      let allChangeOrders: ProjectChangeOrder[] = [];
      try {
        const changeOrderRows = await changeOrdersApi.getAll();
        allChangeOrders = (Array.isArray(changeOrderRows) ? changeOrderRows : [])
          .filter((order) => order?.department === department);
      } catch (changeOrderError) {
        console.error('[ResourcesPage] Failed to load change orders for export:', changeOrderError);
      }
      const changeOrderById = new Map(allChangeOrders.map((order) => [order.id, order]));

      const assignmentByEmployeeWeek = new Map<string, Map<string, Assignment[]>>();
      departmentAssignments.forEach((assignment) => {
        const normalizedWeek = normalizeWeekStartDate(assignment.weekStartDate);
        const employeeWeeks = assignmentByEmployeeWeek.get(assignment.employeeId) || new Map<string, Assignment[]>();
        const currentWeekAssignments = employeeWeeks.get(normalizedWeek) || [];
        currentWeekAssignments.push(assignment);
        employeeWeeks.set(normalizedWeek, currentWeekAssignments);
        assignmentByEmployeeWeek.set(assignment.employeeId, employeeWeeks);
      });

      const projectSummary = new Map<string, { hours: number; resources: Set<string>; changeOrders: Set<string>; weeks: Set<string> }>();
      departmentAssignments.forEach((assignment) => {
        const entry = projectSummary.get(assignment.projectId) || {
          hours: 0,
          resources: new Set<string>(),
          changeOrders: new Set<string>(),
          weeks: new Set<string>(),
        };
        entry.hours += getAssignmentHours(assignment);
        entry.resources.add(assignment.employeeId);
        entry.weeks.add(normalizeWeekStartDate(assignment.weekStartDate));
        if (assignment.changeOrderId) {
          const changeOrderName = changeOrderById.get(assignment.changeOrderId)?.name;
          if (changeOrderName) entry.changeOrders.add(changeOrderName);
        }
        projectSummary.set(assignment.projectId, entry);
      });

      const PALETTE = {
        purpleDark: '2E1A47',
        purpleSoft: 'D9D2E9',
        yellow: 'F6DD4E',
        gridWeekday: 'BFBFBF',
        gridWeekend: 'A6A6A6',
        white: 'FFFFFF',
        black: '111111',
        border: '6B7280',
      };
      const PROJECT_COLORS = ['E31A1C', 'FF4D4F', 'E08F2A', '8CC152', '3BAFDA', '4A89DC', '8E44AD', '1ABC9C', 'D35400', 'C0392B'];

      const applyCellStyle = (
        cell: any,
        options: {
          fill?: string;
          fontColor?: string;
          bold?: boolean;
          size?: number;
          align?: 'left' | 'center' | 'right';
          vertical?: 'top' | 'middle' | 'bottom';
          wrap?: boolean;
        } = {}
      ) => {
        const {
          fill = PALETTE.white,
          fontColor = PALETTE.black,
          bold = false,
          size = 9,
          align = 'center',
          vertical = 'middle',
          wrap = true,
        } = options;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.font = { bold, size, color: { argb: fontColor } };
        cell.alignment = { horizontal: align, vertical, wrapText: wrap };
        cell.border = {
          top: { style: 'thin', color: { argb: PALETTE.border } },
          left: { style: 'thin', color: { argb: PALETTE.border } },
          bottom: { style: 'thin', color: { argb: PALETTE.border } },
          right: { style: 'thin', color: { argb: PALETTE.border } },
        };
      };

      const getProjectCode = (projectId: string): string => {
        const project = projectById.get(projectId);
        if (!project?.name) return 'N/A';
        const numberMatch = project.name.match(/\b\d{3,5}\b/);
        if (numberMatch) return numberMatch[0];
        const token = project.name.split('-')[0].trim();
        return token.slice(0, 12).toUpperCase();
      };

      const getProjectFill = (projectId: string): string => {
        const project = projectById.get(projectId);
        if (project?.isHighProbability) return 'FFD966';
        const projectIndex = projectIndexById.get(projectId);
        if (typeof projectIndex !== 'number') return 'D9D9D9';
        return PROJECT_COLORS[projectIndex % PROJECT_COLORS.length];
      };

      const weekNumByStart = new Map<string, number>();
      dayEntries.forEach((day) => {
        if (!weekNumByStart.has(day.weekStart)) {
          weekNumByStart.set(day.weekStart, day.weekNumber);
        }
      });

      const currentMerges = Object.keys((forecastSheet as any)._merges || {});
      currentMerges.forEach((range) => forecastSheet.unMergeCells(range));

      const clearMaxRow = Math.max(forecastSheet.rowCount, 500);
      const clearMaxCol = Math.max(forecastSheet.columnCount, lastDayCol + 4);
      for (let row = 1; row <= clearMaxRow; row += 1) {
        for (let col = 1; col <= clearMaxCol; col += 1) {
          const cell = forecastSheet.getCell(row, col);
          cell.value = null;
        }
      }

      forecastSheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
      forecastSheet.properties.defaultRowHeight = 18;
      forecastSheet.getColumn(1).width = 8;
      forecastSheet.getColumn(2).width = 11;
      for (let col = firstDayCol; col <= lastDayCol; col += 1) {
        forecastSheet.getColumn(col).width = 4;
      }

      forecastSheet.getCell('A1').value = 'SCIO';
      applyCellStyle(forecastSheet.getCell('A1'), { fill: PALETTE.white, fontColor: PALETTE.purpleDark, bold: true, size: 14 });
      forecastSheet.getCell('B1').value = 'Month';
      forecastSheet.getCell('B2').value = 'Week';
      forecastSheet.getCell('B3').value = 'Day';
      applyCellStyle(forecastSheet.getCell('B1'), { fill: PALETTE.white, bold: true, align: 'left', size: 12 });
      applyCellStyle(forecastSheet.getCell('B2'), { fill: PALETTE.white, bold: true, align: 'left', size: 12 });
      applyCellStyle(forecastSheet.getCell('B3'), { fill: PALETTE.white, bold: true, align: 'left', size: 12 });

      type Group = { startCol: number; endCol: number; label: string };
      const monthGroups: Group[] = [];
      dayEntries.forEach((day) => {
        const label = day.date.toLocaleString('en-US', { month: 'long' });
        const lastGroup = monthGroups[monthGroups.length - 1];
        if (!lastGroup || lastGroup.label !== label) {
          monthGroups.push({ startCol: day.col, endCol: day.col, label });
        } else {
          lastGroup.endCol = day.col;
        }
      });

      const weekGroups: Group[] = [];
      dayEntries.forEach((day) => {
        const label = String(day.weekNumber);
        const lastGroup = weekGroups[weekGroups.length - 1];
        if (!lastGroup || lastGroup.label !== label) {
          weekGroups.push({ startCol: day.col, endCol: day.col, label });
        } else {
          lastGroup.endCol = day.col;
        }
      });

      monthGroups.forEach((group, idx) => {
        forecastSheet.mergeCells(1, group.startCol, 1, group.endCol);
        const monthCell = forecastSheet.getCell(1, group.startCol);
        monthCell.value = `${group.label} ${selectedYear}`;
        applyCellStyle(monthCell, {
          fill: idx % 2 === 0 ? PALETTE.purpleDark : PALETTE.yellow,
          fontColor: idx % 2 === 0 ? PALETTE.white : PALETTE.black,
          bold: true,
          size: 10,
        });
      });

      weekGroups.forEach((group) => {
        forecastSheet.mergeCells(2, group.startCol, 2, group.endCol);
        const weekCell = forecastSheet.getCell(2, group.startCol);
        weekCell.value = group.label;
        applyCellStyle(weekCell, { fill: PALETTE.white, bold: true, size: 18 });
      });

      dayEntries.forEach((day) => {
        const dayCell = forecastSheet.getCell(3, day.col);
        dayCell.value = day.day;
        applyCellStyle(dayCell, {
          fill: PALETTE.white,
          bold: true,
          size: 12,
        });
      });

      const sortedDepartmentEmployees = [...deptEmployees]
        .filter((employee) => employee.isActive)
        .sort((a, b) => a.name.localeCompare(b.name));

      const dayColumnsByWeekStart = new Map<string, number[]>();
      dayEntries.forEach((day) => {
        const columns = dayColumnsByWeekStart.get(day.weekStart) || [];
        columns.push(day.col);
        dayColumnsByWeekStart.set(day.weekStart, columns);
      });

      let rowCursor = 4;
      sortedDepartmentEmployees.forEach((employee) => {
        const employeeWeeks = assignmentByEmployeeWeek.get(employee.id) || new Map<string, Assignment[]>();

        const employeeProjects = new Map<string, { hours: number; changeOrders: Set<string> }>();
        employeeWeeks.forEach((weekAssignments) => {
          weekAssignments.forEach((assignment) => {
            const currentProject = employeeProjects.get(assignment.projectId) || {
              hours: 0,
              changeOrders: new Set<string>(),
            };
            currentProject.hours += getAssignmentHours(assignment);
            if (assignment.changeOrderId) {
              const coName = changeOrderById.get(assignment.changeOrderId)?.name;
              if (coName) currentProject.changeOrders.add(coName);
            }
            employeeProjects.set(assignment.projectId, currentProject);
          });
        });

        const orderedProjects = [...employeeProjects.entries()]
          .sort((a, b) => b[1].hours - a[1].hours);

        const indRow = rowCursor;
        const mngRow = rowCursor + 1;
        const assyRow = rowCursor + 2;
        const ptoRow = rowCursor + 3;
        const projectStartRow = rowCursor + 4;
        const projectRowsCount = Math.max(8, orderedProjects.length || 1);
        const blockEndRow = projectStartRow + projectRowsCount - 1;

        forecastSheet.mergeCells(indRow, 2, blockEndRow, 2);
        const resourceCell = forecastSheet.getCell(indRow, 2);
        resourceCell.value = employee.name;
        applyCellStyle(resourceCell, {
          fill: PALETTE.white,
          bold: true,
          align: 'center'
        });
        resourceCell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90, wrapText: true };

        const setupRowLabel = (row: number, label: string, fill: string) => {
          const labelCell = forecastSheet.getCell(row, 2);
          labelCell.value = label;
          applyCellStyle(labelCell, { fill, bold: true });
          const projectCodeCell = forecastSheet.getCell(row, 1);
          projectCodeCell.value = label;
          applyCellStyle(projectCodeCell, {
            fill,
            bold: true,
            fontColor: '101010',
          });
        };

        setupRowLabel(indRow, 'IND', 'FFF200');
        setupRowLabel(mngRow, 'MNG', 'FFD966');
        setupRowLabel(assyRow, 'ASSY', 'F4B183');
        setupRowLabel(ptoRow, 'PTO', 'BDD7EE');

        const projectRowById = new Map<string, number>();
        orderedProjects.forEach(([projectId], index) => {
          const row = projectStartRow + index;
          const projectCode = getProjectCode(projectId);
          const fill = getProjectFill(projectId);
          const labelCell = forecastSheet.getCell(row, 1);
          labelCell.value = projectCode;
          applyCellStyle(labelCell, {
            fill,
            bold: true,
            fontColor: PALETTE.black,
          });
          const leftCell = forecastSheet.getCell(row, 2);
          leftCell.value = '';
          applyCellStyle(leftCell, { fill: PALETTE.white });
          projectRowById.set(projectId, row);
        });

        for (let extraIndex = orderedProjects.length; extraIndex < projectRowsCount; extraIndex += 1) {
          const row = projectStartRow + extraIndex;
          const labelCell = forecastSheet.getCell(row, 1);
          labelCell.value = '';
          applyCellStyle(labelCell, { fill: PALETTE.white });
          const leftCell = forecastSheet.getCell(row, 2);
          leftCell.value = '';
          applyCellStyle(leftCell, { fill: PALETTE.white });
        }

        for (let row = indRow; row <= blockEndRow; row += 1) {
          for (let col = firstDayCol; col <= lastDayCol; col += 1) {
            const dayEntry = dayEntries[col - firstDayCol];
            const cell = forecastSheet.getCell(row, col);
            applyCellStyle(cell, {
              fill: dayEntry.isWeekend ? PALETTE.gridWeekend : PALETTE.gridWeekday,
              fontColor: PALETTE.black,
              align: 'center',
              wrap: false,
            });
          }
        }

        dayColumnsByWeekStart.forEach((weekColumns, weekStart) => {
          const weekdayColumns = weekColumns.filter((column) => {
            const dayEntry = dayEntries[column - firstDayCol];
            return !dayEntry.isWeekend;
          });
          const weekAssignments = employeeWeeks.get(weekStart) || [];
          if (weekAssignments.length === 0) {
            weekdayColumns.forEach((column) => {
              const cell = forecastSheet.getCell(indRow, column);
              cell.value = 'IND';
              applyCellStyle(cell, {
                fill: 'FFF200',
                bold: true,
                wrap: false,
              });
            });
            return;
          }

          const projectHoursForWeek = new Map<string, { hours: number; code: string; fill: string }>();
          weekAssignments.forEach((assignment) => {
            const existing = projectHoursForWeek.get(assignment.projectId) || {
              hours: 0,
              code: getProjectCode(assignment.projectId),
              fill: getProjectFill(assignment.projectId),
            };
            existing.hours += getAssignmentHours(assignment);
            projectHoursForWeek.set(assignment.projectId, existing);
          });

          projectHoursForWeek.forEach((entry, projectId) => {
            const row = projectRowById.get(projectId);
            if (!row) return;
            weekdayColumns.forEach((column) => {
              const cell = forecastSheet.getCell(row, column);
              cell.value = entry.code;
              applyCellStyle(cell, {
                fill: entry.fill,
                bold: true,
                wrap: false,
              });
            });
          });
        });

        const separatorRow = blockEndRow + 1;
        for (let col = 1; col <= lastDayCol; col += 1) {
          applyCellStyle(forecastSheet.getCell(separatorRow, col), { fill: PALETTE.white });
        }

        rowCursor = separatorRow + 1;
      });

      dashboardSheet.columns = [
        { width: 26 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
      ];

      dashboardSheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.value = null;
        });
      });
      dashboardSheet.mergeCells('A1:E1');
      const dashTitle = dashboardSheet.getCell('A1');
      dashTitle.value = `Dashboard - ${department} (${selectedYear})`;
      applyCellStyle(dashTitle, { fill: PALETTE.purpleDark, fontColor: PALETTE.white, bold: true, size: 12, align: 'left' });

      dashboardSheet.mergeCells('A2:E2');
      const dashSubTitle = dashboardSheet.getCell('A2');
      dashSubTitle.value = `Generated: ${generatedLabel}`;
      applyCellStyle(dashSubTitle, { fill: PALETTE.purpleSoft, align: 'left', bold: true });

      const totalCapacityHours = sortedDepartmentEmployees.reduce(
        (sum, employee) => sum + (getEmployeeCapacity(employee) * Math.max(1, weekNumByStart.size)),
        0
      );
      const totalAssignedHours = departmentAssignments.reduce((sum, assignment) => sum + getAssignmentHours(assignment), 0);
      const avgUtilization = totalCapacityHours > 0 ? (totalAssignedHours / totalCapacityHours) * 100 : 0;
      const totalProjects = projectSummary.size;
      const totalCOs = new Set(
        departmentAssignments
          .map((assignment) => assignment.changeOrderId)
          .filter((changeOrderId): changeOrderId is string => Boolean(changeOrderId))
      ).size;

      const kpiHeaders = ['Resources', 'Projects', 'Assigned Hours', 'Avg Utilization', 'Change Orders'];
      const kpiValues = [
        sortedDepartmentEmployees.length,
        totalProjects,
        `${formatHours(totalAssignedHours)}h`,
        `${formatHours(avgUtilization)}%`,
        totalCOs,
      ];

      for (let col = 1; col <= 5; col += 1) {
        const headerCell = dashboardSheet.getCell(4, col);
        headerCell.value = kpiHeaders[col - 1];
        applyCellStyle(headerCell, { fill: PALETTE.purpleDark, fontColor: PALETTE.white, bold: true });

        const valueCell = dashboardSheet.getCell(5, col);
        valueCell.value = kpiValues[col - 1];
        applyCellStyle(valueCell, { fill: PALETTE.white, bold: true, size: 11 });
      }

      dashboardSheet.getCell('A7').value = 'Top Resources (assigned hours)';
      applyCellStyle(dashboardSheet.getCell('A7'), { fill: PALETTE.purpleDark, fontColor: PALETTE.white, bold: true, align: 'left' });
      dashboardSheet.mergeCells('A7:E7');
      applyCellStyle(dashboardSheet.getCell('A7'), { fill: PALETTE.purpleDark, fontColor: PALETTE.white, bold: true, align: 'left' });

      const topResourceRows = sortedDepartmentEmployees
        .map((employee) => {
          const employeeHours = (assignmentByEmployeeWeek.get(employee.id) || new Map<string, Assignment[]>());
          let totalHours = 0;
          employeeHours.forEach((rows) => {
            rows.forEach((assignment) => { totalHours += getAssignmentHours(assignment); });
          });
          return { employee, totalHours };
        })
        .sort((a, b) => b.totalHours - a.totalHours)
        .slice(0, 10);

      dashboardSheet.getRow(8).values = ['Resource', 'Role', 'Assigned h', 'Capacity h', 'Utilization %'];
      dashboardSheet.getRow(8).eachCell((cell: any) => applyCellStyle(cell, { fill: PALETTE.purpleSoft, bold: true }));

      topResourceRows.forEach((entry, index) => {
        const rowNumber = 9 + index;
        const totalCapacity = getEmployeeCapacity(entry.employee) * Math.max(1, weekNumByStart.size);
        const util = totalCapacity > 0 ? (entry.totalHours / totalCapacity) * 100 : 0;
        dashboardSheet.getRow(rowNumber).values = [
          entry.employee.name,
          entry.employee.role || '',
          formatHours(entry.totalHours),
          formatHours(totalCapacity),
          formatHours(util),
        ];
        dashboardSheet.getRow(rowNumber).eachCell((cell: any, col: number) =>
          applyCellStyle(cell, { fill: index % 2 === 0 ? PALETTE.white : 'F9FAFB', align: col <= 2 ? 'left' : 'center' })
        );
      });

      internalSheet.columns = [
        { width: 14 },
        { width: 28 },
        { width: 20 },
        { width: 14 },
        { width: 12 },
        { width: 12 },
        { width: 14 },
        { width: 36 },
        { width: 12 },
      ];

      internalSheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.value = null;
        });
      });
      internalSheet.mergeCells('A1:I1');
      const internalTitle = internalSheet.getCell('A1');
      internalTitle.value = `Internal Dashboard - ${department} (${selectedYear})`;
      applyCellStyle(internalTitle, { fill: PALETTE.purpleDark, fontColor: PALETTE.white, bold: true, size: 12, align: 'left' });

      internalSheet.mergeCells('A2:I2');
      const internalSubTitle = internalSheet.getCell('A2');
      internalSubTitle.value = `Generated: ${generatedLabel}`;
      applyCellStyle(internalSubTitle, { fill: PALETTE.purpleSoft, bold: true, align: 'left' });

      internalSheet.getRow(4).values = [
        'Project Code',
        'Project',
        'Client',
        'High Probability',
        'Hours',
        'Resources',
        'CO count',
        'Change Orders',
        'Weeks',
      ];
      internalSheet.getRow(4).eachCell((cell: any) => applyCellStyle(cell, { fill: PALETTE.purpleDark, fontColor: PALETTE.white, bold: true }));

      const sortedProjects = [...projectSummary.entries()].sort((a, b) => b[1].hours - a[1].hours);
      let internalRow = 5;
      sortedProjects.forEach(([projectId, summary], idx) => {
        const project = projectById.get(projectId);
        internalSheet.getRow(internalRow).values = [
          getProjectCode(projectId),
          project?.name || 'Deleted project',
          project?.client || '',
          project?.isHighProbability ? 'Yes' : 'No',
          formatHours(summary.hours),
          summary.resources.size,
          summary.changeOrders.size,
          [...summary.changeOrders].join(', '),
          summary.weeks.size,
        ];
        internalSheet.getRow(internalRow).eachCell((cell: any, col: number) =>
          applyCellStyle(cell, { fill: idx % 2 === 0 ? PALETTE.white : 'F9FAFB', align: col <= 3 || col === 8 ? 'left' : 'center' })
        );
        internalRow += 1;
      });

      internalRow += 1;
      internalSheet.mergeCells(internalRow, 1, internalRow, 9);
      const detailTitle = internalSheet.getCell(internalRow, 1);
      detailTitle.value = 'Assignment Detail';
      applyCellStyle(detailTitle, { fill: PALETTE.purpleDark, fontColor: PALETTE.white, bold: true, align: 'left' });
      internalRow += 1;

      internalSheet.getRow(internalRow).values = ['Week Start', 'CW', 'Resource', 'Project', 'Project Code', 'Hours', 'CO', 'Stage', 'Comment'];
      internalSheet.getRow(internalRow).eachCell((cell: any) => applyCellStyle(cell, { fill: PALETTE.purpleSoft, bold: true }));
      internalRow += 1;

      const sortedAssignments = [...departmentAssignments].sort((a, b) => {
        const aWeek = normalizeWeekStartDate(a.weekStartDate);
        const bWeek = normalizeWeekStartDate(b.weekStartDate);
        if (aWeek !== bWeek) return aWeek.localeCompare(bWeek);
        const aEmployee = employees.find((employee) => employee.id === a.employeeId)?.name || '';
        const bEmployee = employees.find((employee) => employee.id === b.employeeId)?.name || '';
        return aEmployee.localeCompare(bEmployee);
      });

      sortedAssignments.forEach((assignment, idx) => {
        const normalizedWeek = normalizeWeekStartDate(assignment.weekStartDate);
        const employeeName = employees.find((employee) => employee.id === assignment.employeeId)?.name || 'Deleted resource';
        const project = projectById.get(assignment.projectId);
        const coName = assignment.changeOrderId ? (changeOrderById.get(assignment.changeOrderId)?.name || '') : '';
        internalSheet.getRow(internalRow).values = [
          normalizedWeek,
          weekNumByStart.get(normalizedWeek) || '',
          employeeName,
          project?.name || 'Deleted project',
          getProjectCode(assignment.projectId),
          formatHours(getAssignmentHours(assignment)),
          coName,
          assignment.stage || '',
          assignment.comment || '',
        ];
        internalSheet.getRow(internalRow).eachCell((cell: any, col: number) =>
          applyCellStyle(cell, { fill: idx % 2 === 0 ? PALETTE.white : 'F9FAFB', align: col <= 4 || col >= 7 ? 'left' : 'center' })
        );
        internalRow += 1;
      });

      const fileName = `${department.toLowerCase()}-forecast-${selectedYear}-${dateStamp}.xlsx`;
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
      console.error('[ResourcesPage] Error exporting resources by department:', error);
      alert(language === 'es'
        ? 'Ocurrio un error al exportar el Excel del departamento.'
        : 'An error occurred while exporting the department Excel file.');
    } finally {
      setExportingDepartment(null);
    }
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveDepartment = (lockedDepartment || formData.department) as Department | undefined;
    const canSubmit =
      Boolean(effectiveDepartment && canEditEmployee(effectiveDepartment)) &&
      (editingId ? true : canCreateEmployee);
    if (!canSubmit) return;

    if (!formData.name || !formData.role || !effectiveDepartment) {
      alert(t.completeAllFields);
      return;
    }

    if (editingId) {
      updateEmployee(editingId, { ...formData, department: effectiveDepartment });
      setEditingId(null);
    } else {
      const newEmployee: Employee = {
        id: generateId(),
        name: formData.name,
        role: formData.role,
        department: effectiveDepartment,
        capacity: formData.capacity || DEFAULT_WEEKLY_CAPACITY,
        isActive: true,
        isSubcontractedMaterial: formData.isSubcontractedMaterial,
        subcontractCompany: formData.subcontractCompany,
      };
      addEmployee(newEmployee);
    }

    setFormData({ name: '', role: '', department: getDefaultDepartment(), capacity: DEFAULT_WEEKLY_CAPACITY, isSubcontractedMaterial: false, subcontractCompany: '' });
    setIsFormOpen(false);
  };

  const handleEdit = (employee: Employee) => {
    if (!canEditEmployee(employee.department)) return;
    setFormData({ ...employee, capacity: getEmployeeCapacity(employee) });
    setEditingId(employee.id);
    setIsFormOpen(true);
  };

  const handleCancel = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({ name: '', role: '', department: getDefaultDepartment(), capacity: DEFAULT_WEEKLY_CAPACITY, isSubcontractedMaterial: false, subcontractCompany: '' });
  };

  const getDepartmentColor = (dept: Department) => {
    const colors: Record<Department, string> = {
      'PM': 'bg-[#f4f1f8] border-[#d5d1da]',
      'MED': 'bg-[#f1f7f7] border-[#c9dedf]',
      'HD': 'bg-[#f2eef8] border-[#d5d1da]',
      'MFG': 'bg-[#fbf2ec] border-[#e9d8ca]',
      'BUILD': 'bg-[#eef6f1] border-[#d4e4da]',
      'PRG': 'bg-[#f3f7ed] border-[#d9e3c8]',
    };
    return colors[dept];
  };

  return (
    <div className="brand-page-shell resources-page flex flex-col h-full min-h-0 overflow-hidden">
      <div className="brand-page-header sticky top-0 z-30 px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
          <h1 className="brand-title text-xl sm:text-2xl md:text-3xl">{t.teamResources}</h1>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
              <Calendar size={20} className="text-[#4f3a70] flex-shrink-0" />
              <label className="text-xs sm:text-sm font-semibold text-[#4f3a70] whitespace-nowrap">{t.year}:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="brand-select px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-[#2e1a47] bg-[#f4f1f8] hover:bg-[#ece7f3] transition"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                if (!canCreateEmployee) return;
                setFormData({ name: '', role: '', department: getDefaultDepartment(), capacity: DEFAULT_WEEKLY_CAPACITY, isSubcontractedMaterial: false, subcontractCompany: '' });
                setEditingId(null);
                setIsFormOpen(true);
              }}
              disabled={!canCreateEmployee}
              className={`flex items-center justify-center sm:justify-start gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                canCreateEmployee
                  ? 'brand-btn-primary text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Plus size={18} className="sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">{t.addEmployee}</span>
              <span className="sm:hidden">+ {t.addEmployee}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Form */}
      {isFormOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={handleCancel}
          />
          {/* Modal */}
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 p-4 sm:p-0">
            <div className="brand-panel w-full max-w-[95vw] sm:max-w-md max-h-screen overflow-auto">
              {/* Header */}
              <div className="brand-page-header flex items-center justify-between p-6">
                <h2 className="brand-title text-xl font-semibold">
                  {editingId ? t.editEmployee : t.newEmployee}
                </h2>
                <button
                  onClick={handleCancel}
                  className="p-1 text-[#6c6480] hover:bg-[#e8e2f1] rounded transition"
                  title={t.cancel}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {/* Name Field */}
                <div>
                  <label className="block text-sm font-medium text-[#4f3a70] mb-2">{t.name}</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="brand-input w-full px-3 py-2 text-[#2e1a47]"
                    placeholder={t.egJohnDoe}
                    autoFocus
                  />
                </div>

                {/* Department Field */}
                <div>
                  <label className="block text-sm font-medium text-[#4f3a70] mb-2">{t.department}</label>
                  <select
                    value={lockedDepartment || formData.department || getDefaultDepartment()}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value as Department })}
                    className="brand-select w-full px-3 py-2 text-[#2e1a47]"
                    disabled={Boolean(lockedDepartment)}
                  >
                    {availableDepartmentOptions.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Conditional Fields for BUILD Department - After Department */}
                {formData.department === 'BUILD' && (
                  <>
                    {/* Subcontracted Material Checkbox */}
                    <div className="flex items-center gap-3 p-3 bg-[#f0ebf7] rounded-lg border border-[#d5d1da]">
                      <input
                        type="checkbox"
                        id="isSubcontracted"
                        checked={formData.isSubcontractedMaterial || false}
                        onChange={(e) => setFormData({
                          ...formData,
                          isSubcontractedMaterial: e.target.checked,
                          subcontractCompany: e.target.checked ? formData.subcontractCompany : ''
                        })}
                        className="w-4 h-4 text-[#2e1a47] rounded focus:ring-2 focus:ring-[#827691]"
                      />
                      <label htmlFor="isSubcontracted" className="text-sm font-medium text-[#4f3a70] cursor-pointer">
                        {t.isSubcontractedMaterial}
                      </label>
                    </div>

                    {/* Company Selection - Show only if subcontracted and in BUILD department */}
                    {formData.isSubcontractedMaterial && (
                      <div>
                        <label className="block text-sm font-medium text-[#4f3a70] mb-2">{t.selectCompany}</label>
                        <select
                          value={formData.subcontractCompany || ''}
                          onChange={(e) => setFormData({ ...formData, subcontractCompany: e.target.value })}
                          className="brand-select w-full px-3 py-2 text-[#2e1a47]"
                        >
                          <option value="">-- {t.selectCompany} --</option>
                          {Array.from(activeTeams).map((team) => (
                            <option key={team} value={team}>{team}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}

                {/* Conditional Fields for PRG Department - After Department */}
                {formData.department === 'PRG' && (
                  <>
                    {/* External Team Checkbox */}
                    <div className="flex items-center gap-3 p-3 bg-[#f0ebf7] rounded-lg border border-[#d5d1da]">
                      <input
                        type="checkbox"
                        id="isExternalTeam"
                        checked={formData.isSubcontractedMaterial || false}
                        onChange={(e) => setFormData({
                          ...formData,
                          isSubcontractedMaterial: e.target.checked,
                          subcontractCompany: e.target.checked ? formData.subcontractCompany : ''
                        })}
                        className="w-4 h-4 text-[#2e1a47] rounded focus:ring-2 focus:ring-[#827691]"
                      />
                      <label htmlFor="isExternalTeam" className="text-sm font-medium text-[#4f3a70] cursor-pointer">
                        {t.isSubcontractedMaterial}
                      </label>
                    </div>

                    {/* Team Selection - Show only if external team and in PRG department */}
                    {formData.isSubcontractedMaterial && (
                      <div>
                        <label className="block text-sm font-medium text-[#4f3a70] mb-2">{t.selectTeam}</label>
                        <select
                          value={formData.subcontractCompany || ''}
                          onChange={(e) => setFormData({ ...formData, subcontractCompany: e.target.value })}
                          className="brand-select w-full px-3 py-2 text-[#2e1a47]"
                        >
                          <option value="">{t.selectTeamPlaceholder}</option>
                          {Array.from(prgActiveTeams).map((team) => (
                            <option key={team} value={team}>{team}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}

                {/* Role Field */}
                <div>
                  <label className="block text-sm font-medium text-[#4f3a70] mb-2">{t.role}</label>
                  <input
                    type="text"
                    value={formData.role || ''}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="brand-input w-full px-3 py-2 text-[#2e1a47]"
                    placeholder={t.egDesignEngineer}
                  />
                </div>

                {/* Capacity Field */}
                <div>
                  <label className="block text-sm font-medium text-[#4f3a70] mb-2">{t.capacity}</label>
                  <input
                    type="number"
                    value={formData.capacity || DEFAULT_WEEKLY_CAPACITY}
                    onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                    className="brand-input w-full px-3 py-2 text-[#2e1a47]"
                    min="1"
                    max="168"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-[#e8e2f1]">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="brand-btn-soft flex-1 px-4 py-2 font-semibold rounded-lg transition"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="brand-btn-primary flex-1 px-4 py-2 text-white font-semibold rounded-lg transition"
                  >
                    {editingId ? t.update : t.create}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      <div className="overflow-y-auto flex-1 min-h-0 p-6">
        {/* Employees grouped by department */}
        {DEPARTMENTS.map((dept) => {
          // Filter out system placeholder employees (names like "MFG Employee 1", "PM Employee 1", etc.)
          const isPlaceholderEmployee = (employee: Employee) => {
            const name = employee.name?.trim() || '';
            const role = employee.role?.trim().toLowerCase() || '';
            return (
              role === 'placeholder' ||
              /^(PM|MED|HD|MFG|PRG|BUILD) Employee \d+$/.test(name) ||
              /^(PM|MED|HD|MFG|PRG|BUILD) Placeholder$/.test(name)
            );
          };
          const isCompanyPlaceholder = (e: any) =>
            e.isSubcontractedMaterial &&
            e.subcontractCompany &&
            e.subcontractCompany === e.name &&
            (e.capacity === 0 || e.capacity === 0.0);
          const deptEmployees = employees.filter(
            (e) => e.department === dept && !isPlaceholderEmployee(e) && !isCompanyPlaceholder(e)
          );
          if (deptEmployees.length === 0) return null;

          return (
            <div key={dept} className={`mb-8 border rounded-lg p-4 ${getDepartmentColor(dept)}`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-gray-800">{dept} {t.departmentLabel}</h2>
                <button
                  type="button"
                  onClick={() => void handleExportDepartmentResources(dept, deptEmployees)}
                  disabled={exportingDepartment !== null}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1.5 text-white text-sm font-semibold shadow-sm hover:from-emerald-600 hover:to-teal-600 disabled:opacity-60 disabled:cursor-not-allowed transition"
                  title={language === 'es' ? `Exportar recursos de ${dept}` : `Export ${dept} resources`}
                >
                  {exportingDepartment === dept ? (
                    <div className="h-4 w-4 rounded-full border-b-2 border-white animate-spin" />
                  ) : (
                    <FileSpreadsheet size={16} />
                  )}
                  <span>{language === 'es' ? 'Exportar Excel' : 'Export Excel'}</span>
                  <Download size={14} />
                </button>
              </div>
              <div className="space-y-2">
                {deptEmployees.map((emp) => {
                  const empAssignments = getEmployeeAssignments(emp.id);
                  const isExpanded = expandedEmployees.has(emp.id);
                  const totalAssignedHours = empAssignments.reduce((sum, a) => sum + getAssignmentHours(a), 0);
                  const uniqueProjects = [...new Set(empAssignments.map(a => a.projectId))];

                  return (
                    <div key={emp.id} className="bg-white rounded-lg border border-gray-300 overflow-hidden">
                      {/* Employee Row */}
                      <div className="flex items-center justify-between p-3 hover:bg-gray-50">
                        <div className="flex items-center gap-4 flex-1">
                          {/* Expand/Collapse Button */}
                          <button
                            onClick={() => toggleEmployeeCalendar(emp.id)}
                            className={`p-1.5 rounded transition ${
                              empAssignments.length > 0
                                ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                                : 'bg-gray-100 text-gray-400'
                            }`}
                            title={empAssignments.length > 0 ? t.viewCalendar : t.noAssignmentsYet}
                          >
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </button>

                          {/* Employee Info */}
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 items-center">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-800">{emp.name}</span>
                                {/* External/Subcontracted badge for BUILD and PRG */}
                                {(emp.department === 'BUILD' || emp.department === 'PRG') && (
                                  emp.isSubcontractedMaterial && emp.subcontractCompany ? (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                                      emp.department === 'BUILD'
                                        ? 'bg-violet-200 text-violet-800'
                                        : 'bg-cyan-200 text-cyan-800'
                                    }`}>
                                      🏢 {emp.subcontractCompany}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-green-200 text-green-800">
                                      🏠 {t.internal}
                                    </span>
                                  )
                                )}
                              </div>
                              <div className="text-xs text-gray-500">{emp.role}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-sm font-medium">{getEmployeeCapacity(emp)}h/{language === 'es' ? 'sem' : 'wk'}</div>
                              <div className="text-xs text-gray-500">{t.capacity.split(' ')[0]}</div>
                            </div>
                            <div className="text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                emp.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {emp.isActive ? t.active : t.inactive}
                              </span>
                            </div>
                            <div className="text-center">
                              {empAssignments.length > 0 ? (
                                <div className="flex items-center justify-center gap-2">
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                    {uniqueProjects.length} {uniqueProjects.length !== 1 ? t.projectsCount : t.projectLabel}
                                  </span>
                                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                    {formatHours(totalAssignedHours)}h {t.total}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">{t.noAssignments}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1">
                          <button
                            onClick={() => canEditEmployee(emp.department) && handleEdit(emp)}
                            disabled={!canEditEmployee(emp.department)}
                            className={`p-1.5 rounded transition ${
                              canEditEmployee(emp.department) ? 'text-blue-500 hover:bg-blue-100' : 'text-gray-400 cursor-not-allowed'
                            }`}
                            title={t.edit}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => canEditEmployee(emp.department) && deleteEmployee(emp.id)}
                            disabled={!canEditEmployee(emp.department)}
                            className={`p-1.5 rounded transition ${
                              canEditEmployee(emp.department) ? 'text-red-500 hover:bg-red-100' : 'text-gray-400 cursor-not-allowed'
                            }`}
                            title={t.delete}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Mini Calendar - Expandable */}
                      {isExpanded && empAssignments.length > 0 && (
                        <div className="border-t border-gray-200 bg-gray-50 p-3">
                          {/* Project Legend */}
                          <div className="mb-3 flex flex-wrap gap-2">
                            <span className="text-xs font-semibold text-gray-600">{t.projectsLabelColon}</span>
                            {uniqueProjects.map((projId) => {
                              const project = projects.find(p => p.id === projId);
                              const colorInfo = getProjectColor(projId);
                              return (
                                <span
                                  key={projId}
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorInfo.bg} ${colorInfo.text} border ${colorInfo.border}`}
                                >
                                  {project?.name || 'Project'}
                                </span>
                              );
                            })}
                          </div>

                          {/* Calendar Grid - Hidden on mobile */}
                          <div className="hidden md:block overflow-x-auto">
                            <div className="flex gap-0.5 min-w-max">
                              {allWeeksData.map((weekData) => {
                                const weekAssignments = empAssignments.filter(a => a.weekStartDate === weekData.date);
                                const weekTotalHours = weekAssignments.reduce((sum, a) => sum + getAssignmentHours(a), 0);
                                const hasAssignment = weekAssignments.length > 0;

                                // Aggregate hours by project for this week (for tooltip and color logic).
                                const weekProjectHours = weekAssignments.reduce<Record<string, number>>((acc, assignment) => {
                                  const assignmentHours = getAssignmentHours(assignment);
                                  if (assignmentHours <= 0) return acc;
                                  acc[assignment.projectId] = (acc[assignment.projectId] || 0) + assignmentHours;
                                  return acc;
                                }, {});
                                const weekProjects = Object.keys(weekProjectHours);
                                const sortedProjectBreakdown = Object.entries(weekProjectHours)
                                  .sort(([, hoursA], [, hoursB]) => hoursB - hoursA);
                                const weekTooltip = hasAssignment
                                  ? [
                                      `${t.weekAbbr} ${weekData.weekNum}: ${formatHours(weekTotalHours)}h`,
                                      `${weekProjects.length} ${weekProjects.length === 1 ? t.projectLabel : t.projectsCount}`,
                                      ...sortedProjectBreakdown.map(([projectId, projectHours]) => {
                                        const projectName =
                                          projects.find((p) => p.id === projectId)?.name ||
                                          (language === 'es' ? 'Proyecto' : 'Project');
                                        return `- ${projectName}: ${formatHours(projectHours)}h`;
                                      }),
                                    ].join('\n')
                                  : `${t.weekAbbr} ${weekData.weekNum}: ${t.noAssignment}`;

                                return (
                                  <div
                                    key={weekData.date}
                                    className={`w-8 h-12 flex flex-col items-center justify-center rounded text-xs border ${
                                      hasAssignment
                                        ? weekProjects.length === 1
                                          ? `${getProjectColor(weekProjects[0]).bg} ${getProjectColor(weekProjects[0]).border}`
                                          : 'bg-gradient-to-b from-blue-200 to-purple-200 border-purple-300'
                                        : 'bg-white border-gray-200'
                                    }`}
                                    title={weekTooltip}
                                  >
                                    <span className={`text-xs font-bold ${hasAssignment ? 'text-gray-700' : 'text-gray-400'}`}>
                                      {weekData.weekNum}
                                    </span>
                                    {hasAssignment && (
                                      <span className="text-xs font-semibold text-gray-600">
                                        {formatHours(weekTotalHours)}h
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Week Labels */}
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                            <span>← {t.week} 1</span>
                            <span className="flex-1 text-center">{selectedYear}</span>
                            <span>{t.week} {lastWeek}+ →</span>
                          </div>
                        </div>
                      )}

                      {/* No assignments message */}
                      {isExpanded && empAssignments.length === 0 && (
                        <div className="border-t border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
                          {t.noAssignmentsMessage}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

