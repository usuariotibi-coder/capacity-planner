import { useEffect, useState } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { changeOrdersApi } from '../services/api';
import type { Assignment, Employee, Department, ProjectChangeOrder } from '../types';
import { generateId } from '../utils/id';
import { getAllWeeksWithNextYear, normalizeWeekStartDate, parseISODate, formatToISO } from '../utils/dateUtils';
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
      const workbook = new ExcelJS.Workbook();
      const generatedAt = new Date();
      const dateStamp = generatedAt.toISOString().slice(0, 10);
      const generatedLabel = generatedAt.toLocaleString(language === 'es' ? 'es-ES' : 'en-US');

      const weeksForYear = allWeeksData
        .filter((week) => !week.isNextYear)
        .map((week) => {
          const normalizedWeek = normalizeWeekStartDate(week.date);
          const weekStartDate = parseISODate(normalizedWeek);
          if (Number.isNaN(weekStartDate.getTime())) return null;

          const days = Array.from({ length: 7 }, (_, offset) => {
            const dayDate = new Date(weekStartDate);
            dayDate.setDate(weekStartDate.getDate() + offset);
            return {
              offset,
              iso: formatToISO(dayDate),
              date: dayDate,
            };
          });

          return {
            weekStart: normalizedWeek,
            weekNum: week.weekNum,
            days,
          };
        })
        .filter((week): week is { weekStart: string; weekNum: number; days: { offset: number; iso: string; date: Date }[] } => Boolean(week));

      if (weeksForYear.length === 0) {
        alert(language === 'es'
          ? 'No se encontraron semanas para el año seleccionado.'
          : 'No weeks were found for the selected year.');
        return;
      }

      const dayColumns = weeksForYear.flatMap((week, weekIndex) =>
        week.days.map((day) => ({
          ...day,
          weekIndex,
          weekNum: week.weekNum,
          weekStart: week.weekStart,
        }))
      );
      const weekStartSet = new Set(weeksForYear.map((week) => week.weekStart));

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

      const BRAND_PURPLE = '2E1A47';
      const BRAND_PURPLE_ALT = '46236A';
      const BRAND_YELLOW = 'F6DD4E';
      const BORDER = '9CA3AF';
      const WHITE = 'FFFFFF';
      const WEEKEND_BG = 'D1D5DB';
      const PROJECT_COLORS = ['9FE7B8', 'F9D7A9', 'A5BFF3', 'F7CF68', 'DAB6EB', 'B8E8F2', 'F7B1B3', 'B2E0CE'];

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
          fill = WHITE,
          fontColor = '111827',
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
          top: { style: 'thin', color: { argb: BORDER } },
          left: { style: 'thin', color: { argb: BORDER } },
          bottom: { style: 'thin', color: { argb: BORDER } },
          right: { style: 'thin', color: { argb: BORDER } },
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
        if (typeof projectIndex !== 'number') return 'E5E7EB';
        return PROJECT_COLORS[projectIndex % PROJECT_COLORS.length];
      };

      const weekNumByStart = new Map(weeksForYear.map((week) => [week.weekStart, week.weekNum]));

      const forecastSheetName = `${department} Forecast ${selectedYear}`;
      const forecastSheet = workbook.addWorksheet(forecastSheetName);
      const firstDayCol = 4;
      const lastDayCol = firstDayCol + dayColumns.length - 1;
      forecastSheet.views = [{ state: 'frozen', xSplit: 3, ySplit: 6 }];
      forecastSheet.properties.defaultRowHeight = 18;
      forecastSheet.getColumn(1).width = 13;
      forecastSheet.getColumn(2).width = 13;
      forecastSheet.getColumn(3).width = 24;
      for (let col = firstDayCol; col <= lastDayCol; col += 1) {
        forecastSheet.getColumn(col).width = 5;
      }

      forecastSheet.mergeCells(1, 1, 1, lastDayCol);
      const titleCell = forecastSheet.getCell(1, 1);
      titleCell.value = `${forecastSheetName} | Capacity base: ${DEFAULT_WEEKLY_CAPACITY}h/week`;
      applyCellStyle(titleCell, { fill: BRAND_PURPLE, fontColor: WHITE, bold: true, size: 12, align: 'left' });

      forecastSheet.mergeCells(2, 1, 2, lastDayCol);
      const notesCell = forecastSheet.getCell(2, 1);
      const manualRowsLabel = department === 'HD' ? 'MNG/ASSY/PTO' : 'MNG/PTO';
      notesCell.value = `IND = unassigned time (only when week has no assignments) | ${manualRowsLabel} = manual rows | Generated: ${generatedLabel}`;
      applyCellStyle(notesCell, { fill: 'EDE9FE', fontColor: '1F2937', bold: true, align: 'left' });

      forecastSheet.mergeCells(3, 1, 3, lastDayCol);
      const legendCell = forecastSheet.getCell(3, 1);
      legendCell.value = 'Dashboard tabs included: Dashboard, Internal Dashboard';
      applyCellStyle(legendCell, { fill: 'F3F4F6', fontColor: '374151', align: 'left' });

      forecastSheet.mergeCells(4, 1, 6, 1);
      const resourceHeader = forecastSheet.getCell(4, 1);
      resourceHeader.value = 'Resource';
      applyCellStyle(resourceHeader, { fill: BRAND_PURPLE, fontColor: WHITE, bold: true });

      forecastSheet.mergeCells(4, 2, 6, 2);
      const typeHeader = forecastSheet.getCell(4, 2);
      typeHeader.value = 'Type';
      applyCellStyle(typeHeader, { fill: BRAND_PURPLE, fontColor: WHITE, bold: true });

      forecastSheet.mergeCells(4, 3, 6, 3);
      const detailHeader = forecastSheet.getCell(4, 3);
      detailHeader.value = 'Details';
      applyCellStyle(detailHeader, { fill: BRAND_PURPLE, fontColor: WHITE, bold: true });

      type HeaderGroup = { label: string; start: number; end: number };
      const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
      const monthGroups: HeaderGroup[] = [];
      dayColumns.forEach((day, index) => {
        const label = monthFormatter.format(day.date);
        const col = firstDayCol + index;
        const lastGroup = monthGroups[monthGroups.length - 1];
        if (!lastGroup || lastGroup.label !== label) {
          monthGroups.push({ label, start: col, end: col });
        } else {
          lastGroup.end = col;
        }
      });

      monthGroups.forEach((group, idx) => {
        forecastSheet.mergeCells(4, group.start, 4, group.end);
        const cell = forecastSheet.getCell(4, group.start);
        const useYellow = idx % 2 === 1;
        applyCellStyle(cell, {
          fill: useYellow ? BRAND_YELLOW : BRAND_PURPLE_ALT,
          fontColor: useYellow ? BRAND_PURPLE : WHITE,
          bold: true,
        });
        cell.value = group.label;
      });

      weeksForYear.forEach((week, index) => {
        const startCol = firstDayCol + (index * 7);
        const endCol = startCol + 6;
        forecastSheet.mergeCells(5, startCol, 5, endCol);
        const weekCell = forecastSheet.getCell(5, startCol);
        weekCell.value = `CW${week.weekNum}`;
        applyCellStyle(weekCell, { fill: 'DDD6FE', fontColor: '1F2937', bold: true });
      });

      dayColumns.forEach((day, index) => {
        const col = firstDayCol + index;
        const dayCell = forecastSheet.getCell(6, col);
        dayCell.value = day.date.getDate();
        applyCellStyle(dayCell, {
          fill: day.offset >= 5 ? WEEKEND_BG : WHITE,
          fontColor: '111827',
          bold: true,
        });
      });

      const sortedDepartmentEmployees = [...deptEmployees]
        .filter((employee) => employee.isActive)
        .sort((a, b) => a.name.localeCompare(b.name));

      let rowCursor = 7;
      sortedDepartmentEmployees.forEach((employee, employeeIndex) => {
        const employeeWeeks = assignmentByEmployeeWeek.get(employee.id) || new Map<string, Assignment[]>();
        const employeeProjects = new Map<string, { hours: number; changeOrders: Set<string> }>();
        employeeWeeks.forEach((weekAssignments) => {
          weekAssignments.forEach((assignment) => {
            const current = employeeProjects.get(assignment.projectId) || {
              hours: 0,
              changeOrders: new Set<string>(),
            };
            current.hours += getAssignmentHours(assignment);
            if (assignment.changeOrderId) {
              const coName = changeOrderById.get(assignment.changeOrderId)?.name;
              if (coName) current.changeOrders.add(coName);
            }
            employeeProjects.set(assignment.projectId, current);
          });
        });

        const orderedProjects = [...employeeProjects.entries()]
          .sort((a, b) => b[1].hours - a[1].hours);

        const includeAssyRow = department === 'HD';
        const indRow = rowCursor;
        const mngRow = rowCursor + 1;
        const assyRow = includeAssyRow ? rowCursor + 2 : null;
        const ptoRow = includeAssyRow ? rowCursor + 3 : rowCursor + 2;
        const projectStartRow = ptoRow + 1;
        const projectRowsCount = Math.max(1, orderedProjects.length);
        const blockEndRow = projectStartRow + projectRowsCount - 1;

        forecastSheet.mergeCells(indRow, 1, blockEndRow, 1);
        const nameCell = forecastSheet.getCell(indRow, 1);
        nameCell.value = `${employee.name}\n${employee.role || ''}`;
        applyCellStyle(nameCell, {
          fill: employeeIndex % 2 === 0 ? 'F9FAFB' : 'F3F4F6',
          bold: true,
          align: 'center',
        });
        nameCell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90, wrapText: true };

        const setupRowLabel = (row: number, label: string, fill: string, details: string) => {
          const labelCell = forecastSheet.getCell(row, 2);
          labelCell.value = label;
          applyCellStyle(labelCell, { fill, bold: true });
          const detailsCell = forecastSheet.getCell(row, 3);
          detailsCell.value = details;
          applyCellStyle(detailsCell, { fill: 'FFFFFF', align: 'left' });
        };

        setupRowLabel(indRow, 'IND', 'FFF200', 'Indirect / unassigned hours (auto)');
        setupRowLabel(mngRow, 'MNG', 'F8CBAD', 'Management (manual)');
        if (assyRow !== null) {
          setupRowLabel(assyRow, 'ASSY', 'FFE699', 'Assembly (manual)');
        }
        setupRowLabel(ptoRow, 'PTO', 'CFE2F3', 'PTO (manual)');

        const projectRowById = new Map<string, number>();
        if (orderedProjects.length === 0) {
          setupRowLabel(projectStartRow, '-', 'E5E7EB', 'No project assignment in selected year');
        } else {
          orderedProjects.forEach(([projectId, info], index) => {
            const row = projectStartRow + index;
            const project = projectById.get(projectId);
            const projectCode = getProjectCode(projectId);
            const highProbabilitySuffix = project?.isHighProbability ? ' (HP)' : '';
            const coList = [...info.changeOrders].join(', ');
            setupRowLabel(
              row,
              `${projectCode}${highProbabilitySuffix}`,
              getProjectFill(projectId),
              `${project?.name || 'Deleted project'} | ${formatHours(info.hours)}h${coList ? ` | CO: ${coList}` : ''}`
            );
            projectRowById.set(projectId, row);
          });
        }

        for (let row = indRow; row <= blockEndRow; row += 1) {
          for (let col = firstDayCol; col <= lastDayCol; col += 1) {
            const dayOffset = dayColumns[col - firstDayCol].offset;
            const cell = forecastSheet.getCell(row, col);
            applyCellStyle(cell, {
              fill: dayOffset >= 5 ? WEEKEND_BG : WHITE,
              fontColor: '111827',
              align: 'center',
              wrap: false,
            });
          }
        }

        let weeksWithoutAssignments = 0;

        weeksForYear.forEach((week, weekIndex) => {
          const weekAssignments = employeeWeeks.get(week.weekStart) || [];

          const startCol = firstDayCol + (weekIndex * 7);
          const fillRowWeekdays = (row: number, value: string, fill: string, fontColor = '111827') => {
            for (let offset = 0; offset < 5; offset += 1) {
              const cell = forecastSheet.getCell(row, startCol + offset);
              cell.value = value;
              applyCellStyle(cell, {
                fill,
                fontColor,
                bold: true,
                align: 'center',
                wrap: false,
              });
            }
          };

          if (weekAssignments.length === 0) {
            weeksWithoutAssignments += 1;
            fillRowWeekdays(indRow, 'IND', 'FFF200');
            return;
          }

          const projectHoursForWeek = new Map<string, number>();
          weekAssignments.forEach((assignment) => {
            const current = projectHoursForWeek.get(assignment.projectId) || 0;
            projectHoursForWeek.set(assignment.projectId, current + getAssignmentHours(assignment));
          });

          projectHoursForWeek.forEach((_hours, projectId) => {
            const row = projectRowById.get(projectId);
            if (!row) return;
            const projectCode = getProjectCode(projectId);
            fillRowWeekdays(row, projectCode, getProjectFill(projectId));
          });
        });

        const indDetailsCell = forecastSheet.getCell(indRow, 3);
        indDetailsCell.value = `Indirect / unassigned hours (auto) | ${weeksWithoutAssignments} weeks without assignments`;
        applyCellStyle(indDetailsCell, { fill: 'FFFFFF', align: 'left' });

        const separatorRow = blockEndRow + 1;
        forecastSheet.mergeCells(separatorRow, 1, separatorRow, lastDayCol);
        const separatorCell = forecastSheet.getCell(separatorRow, 1);
        separatorCell.value = '';
        applyCellStyle(separatorCell, { fill: 'EDE9FE' });

        rowCursor = separatorRow + 1;
      });

      const totalCapacityHours = sortedDepartmentEmployees.reduce(
        (sum, employee) => sum + (getEmployeeCapacity(employee) * weeksForYear.length),
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

      const topResourceRows = sortedDepartmentEmployees
        .map((employee) => {
          const employeeHours = (assignmentByEmployeeWeek.get(employee.id) || new Map<string, Assignment[]>());
          let totalHours = 0;
          employeeHours.forEach((rows) => {
            rows.forEach((assignment) => { totalHours += getAssignmentHours(assignment); });
          });
          return { employee, totalHours, activeWeeks: employeeHours.size };
        })
        .sort((a, b) => b.totalHours - a.totalHours)
        .slice(0, 12);

      const sortedProjects = [...projectSummary.entries()].sort((a, b) => b[1].hours - a[1].hours);

      const weeklyTotals = new Map<string, number>();
      departmentAssignments.forEach((assignment) => {
        const week = normalizeWeekStartDate(assignment.weekStartDate);
        weeklyTotals.set(week, (weeklyTotals.get(week) || 0) + getAssignmentHours(assignment));
      });

      const dashboardSheet = workbook.addWorksheet('Dashboard');
      dashboardSheet.columns = Array.from({ length: 16 }, () => ({ width: 14 }));
      dashboardSheet.views = [{ state: 'frozen', ySplit: 10 }];

      dashboardSheet.mergeCells(1, 1, 2, 16);
      const dashTitle = dashboardSheet.getCell(1, 1);
      dashTitle.value = `${department} Resources Dashboard ${selectedYear}`;
      applyCellStyle(dashTitle, { fill: BRAND_PURPLE, fontColor: WHITE, bold: true, size: 18, align: 'left' });

      dashboardSheet.mergeCells(3, 1, 3, 16);
      const dashSubTitle = dashboardSheet.getCell(3, 1);
      dashSubTitle.value = `Generated: ${generatedLabel} | View: weekly aggregation`;
      applyCellStyle(dashSubTitle, { fill: 'EDE9FE', align: 'left', bold: true, size: 10 });

      type KpiCard = {
        title: string;
        value: string;
        titleRange: [number, number, number, number];
        valueRange: [number, number, number, number];
        accent: string;
      };
      const kpiCards: KpiCard[] = [
        { title: 'Resources', value: `${sortedDepartmentEmployees.length}`, titleRange: [5, 1, 5, 3], valueRange: [6, 1, 8, 3], accent: 'DBEAFE' },
        { title: 'Projects', value: `${totalProjects}`, titleRange: [5, 4, 5, 6], valueRange: [6, 4, 8, 6], accent: 'DCFCE7' },
        { title: 'Assigned Hours', value: `${formatHours(totalAssignedHours)}h`, titleRange: [5, 7, 5, 9], valueRange: [6, 7, 8, 9], accent: 'FEF3C7' },
        { title: 'Avg Utilization', value: `${formatHours(avgUtilization)}%`, titleRange: [5, 10, 5, 12], valueRange: [6, 10, 8, 12], accent: 'FEE2E2' },
        { title: 'Change Orders', value: `${totalCOs}`, titleRange: [5, 13, 5, 16], valueRange: [6, 13, 8, 16], accent: 'EDE9FE' },
      ];

      kpiCards.forEach((card) => {
        dashboardSheet.mergeCells(card.titleRange[0], card.titleRange[1], card.titleRange[2], card.titleRange[3]);
        const titleCell = dashboardSheet.getCell(card.titleRange[0], card.titleRange[1]);
        titleCell.value = card.title;
        applyCellStyle(titleCell, { fill: BRAND_PURPLE_ALT, fontColor: WHITE, bold: true, size: 10 });

        dashboardSheet.mergeCells(card.valueRange[0], card.valueRange[1], card.valueRange[2], card.valueRange[3]);
        const valueCell = dashboardSheet.getCell(card.valueRange[0], card.valueRange[1]);
        valueCell.value = card.value;
        applyCellStyle(valueCell, { fill: card.accent, bold: true, size: 22 });
      });

      dashboardSheet.mergeCells(10, 1, 10, 8);
      const topResourcesTitle = dashboardSheet.getCell(10, 1);
      topResourcesTitle.value = 'Top Resources';
      applyCellStyle(topResourcesTitle, { fill: BRAND_PURPLE_ALT, fontColor: WHITE, bold: true, size: 11, align: 'left' });

      dashboardSheet.mergeCells(10, 9, 10, 16);
      const topProjectsTitle = dashboardSheet.getCell(10, 9);
      topProjectsTitle.value = 'Top Projects';
      applyCellStyle(topProjectsTitle, { fill: BRAND_PURPLE_ALT, fontColor: WHITE, bold: true, size: 11, align: 'left' });

      const resourceHeaderRow = 11;
      const resourceHeaders = ['#', 'Resource', 'Role', 'Assigned h', 'Cap h', 'Util %', 'Active weeks', 'Avg h/wk'];
      resourceHeaders.forEach((header, index) => {
        const cell = dashboardSheet.getCell(resourceHeaderRow, index + 1);
        cell.value = header;
        applyCellStyle(cell, { fill: 'DDD6FE', bold: true, size: 10 });
      });

      topResourceRows.forEach((entry, index) => {
        const rowNumber = resourceHeaderRow + 1 + index;
        const totalCapacity = getEmployeeCapacity(entry.employee) * weeksForYear.length;
        const util = totalCapacity > 0 ? (entry.totalHours / totalCapacity) * 100 : 0;
        const avgPerWeek = entry.activeWeeks > 0 ? entry.totalHours / entry.activeWeeks : 0;
        const values = [
          index + 1,
          entry.employee.name,
          entry.employee.role || '',
          formatHours(entry.totalHours),
          formatHours(totalCapacity),
          formatHours(util),
          entry.activeWeeks,
          formatHours(avgPerWeek),
        ];
        values.forEach((value, colOffset) => {
          const cell = dashboardSheet.getCell(rowNumber, colOffset + 1);
          cell.value = value;
          applyCellStyle(cell, {
            fill: index % 2 === 0 ? 'FFFFFF' : 'F9FAFB',
            align: colOffset <= 2 ? 'left' : 'center',
            size: 9,
          });
        });
      });

      const projectHeaderRow = 11;
      const projectHeaders = ['Code', 'Project', 'Client', 'Hours', 'Resources', 'COs', 'HP', 'Active weeks'];
      projectHeaders.forEach((header, index) => {
        const cell = dashboardSheet.getCell(projectHeaderRow, 9 + index);
        cell.value = header;
        applyCellStyle(cell, { fill: 'DDD6FE', bold: true, size: 10 });
      });

      sortedProjects.slice(0, 12).forEach(([projectId, summary], index) => {
        const project = projectById.get(projectId);
        const rowNumber = projectHeaderRow + 1 + index;
        const coCount = summary.changeOrders.size;
        const values = [
          getProjectCode(projectId),
          project?.name || 'Deleted project',
          project?.client || '',
          formatHours(summary.hours),
          summary.resources.size,
          coCount,
          project?.isHighProbability ? 'Yes' : 'No',
          summary.weeks.size,
        ];
        values.forEach((value, colOffset) => {
          const cell = dashboardSheet.getCell(rowNumber, 9 + colOffset);
          cell.value = value;
          applyCellStyle(cell, {
            fill: index % 2 === 0 ? 'FFFFFF' : 'F9FAFB',
            align: colOffset <= 2 ? 'left' : 'center',
            size: 9,
          });
          if (colOffset === 6 && value === 'Yes') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
            cell.font = { bold: true, size: 9, color: { argb: '92400E' } };
          }
        });
      });

      const weeklySectionStart = 26;
      dashboardSheet.mergeCells(weeklySectionStart, 1, weeklySectionStart, 16);
      const weeklySectionTitle = dashboardSheet.getCell(weeklySectionStart, 1);
      weeklySectionTitle.value = 'Weekly Load Snapshot';
      applyCellStyle(weeklySectionTitle, { fill: BRAND_PURPLE_ALT, fontColor: WHITE, bold: true, size: 11, align: 'left' });

      const weeklyHeaderRow = weeklySectionStart + 1;
      const weeklyHeaders = ['CW', 'Week Start', 'Assigned h', 'Capacity h', 'Util %', 'Load bar'];
      weeklyHeaders.forEach((header, idx) => {
        const col = idx === 5 ? 6 : idx + 1;
        if (idx === 5) {
          dashboardSheet.mergeCells(weeklyHeaderRow, 6, weeklyHeaderRow, 16);
        }
        const cell = dashboardSheet.getCell(weeklyHeaderRow, col);
        cell.value = header;
        applyCellStyle(cell, { fill: 'DDD6FE', bold: true, size: 10 });
      });

      const weeklyRows = weeksForYear.slice(0, 20).map((week) => {
        const assigned = weeklyTotals.get(week.weekStart) || 0;
        const capacity = sortedDepartmentEmployees.reduce((sum, employee) => sum + getEmployeeCapacity(employee), 0);
        const util = capacity > 0 ? (assigned / capacity) * 100 : 0;
        return { week, assigned, capacity, util };
      });

      weeklyRows.forEach((entry, index) => {
        const row = weeklyHeaderRow + 1 + index;
        const barUnits = Math.max(0, Math.min(20, Math.round((entry.util / 100) * 20)));
        const bar = `${'█'.repeat(barUnits)}${'░'.repeat(20 - barUnits)} ${formatHours(entry.util)}%`;
        const utilColor = entry.util > 100 ? 'FEE2E2' : entry.util >= 85 ? 'FEF3C7' : 'DCFCE7';
        const values: Array<{ col: number; value: string | number; align?: 'left' | 'center' }> = [
          { col: 1, value: entry.week.weekNum },
          { col: 2, value: entry.week.weekStart },
          { col: 3, value: formatHours(entry.assigned) },
          { col: 4, value: formatHours(entry.capacity) },
          { col: 5, value: formatHours(entry.util) },
        ];
        values.forEach((item) => {
          const cell = dashboardSheet.getCell(row, item.col);
          cell.value = item.value;
          applyCellStyle(cell, {
            fill: item.col === 5 ? utilColor : (index % 2 === 0 ? 'FFFFFF' : 'F9FAFB'),
            align: item.align || (item.col <= 2 ? 'left' : 'center'),
            size: 9,
          });
        });
        dashboardSheet.mergeCells(row, 6, row, 16);
        const barCell = dashboardSheet.getCell(row, 6);
        barCell.value = bar;
        applyCellStyle(barCell, { fill: utilColor, align: 'left', size: 9 });
      });

      const internalSheet = workbook.addWorksheet('Internal Dashboard');
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
      internalSheet.views = [{ state: 'frozen', ySplit: 6 }];

      internalSheet.mergeCells('A1:I1');
      const internalTitle = internalSheet.getCell('A1');
      internalTitle.value = `Internal Dashboard - ${department} (${selectedYear})`;
      applyCellStyle(internalTitle, { fill: BRAND_PURPLE, fontColor: WHITE, bold: true, size: 14, align: 'left' });

      internalSheet.mergeCells('A2:I2');
      const internalSubTitle = internalSheet.getCell('A2');
      internalSubTitle.value = `Generated: ${generatedLabel} | Source: assignments + projects + change orders`;
      applyCellStyle(internalSubTitle, { fill: 'EDE9FE', bold: true, align: 'left', size: 10 });

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
      internalSheet.getRow(4).eachCell((cell: any) => applyCellStyle(cell, { fill: BRAND_PURPLE_ALT, fontColor: WHITE, bold: true, size: 10 }));

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
          applyCellStyle(cell, { fill: idx % 2 === 0 ? 'FFFFFF' : 'F9FAFB', align: col <= 3 || col === 8 ? 'left' : 'center', size: 9 })
        );
        internalRow += 1;
      });

      internalRow += 1;
      internalSheet.mergeCells(internalRow, 1, internalRow, 9);
      const detailTitle = internalSheet.getCell(internalRow, 1);
      detailTitle.value = 'Assignment Detail';
      applyCellStyle(detailTitle, { fill: BRAND_PURPLE_ALT, fontColor: WHITE, bold: true, align: 'left', size: 11 });
      internalRow += 1;

      internalSheet.getRow(internalRow).values = ['Week Start', 'CW', 'Resource', 'Project', 'Project Code', 'Hours', 'CO', 'Stage', 'Comment'];
      internalSheet.getRow(internalRow).eachCell((cell: any) => applyCellStyle(cell, { fill: 'DDD6FE', bold: true, size: 10 }));
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
          applyCellStyle(cell, { fill: idx % 2 === 0 ? 'FFFFFF' : 'F9FAFB', align: col <= 4 || col >= 7 ? 'left' : 'center', size: 9 })
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

