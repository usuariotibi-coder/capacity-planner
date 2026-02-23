import { useEffect, useState } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { changeOrdersApi } from '../services/api';
import type { Assignment, Employee, Department, ProjectChangeOrder } from '../types';
import { generateId } from '../utils/id';
import { getAllWeeksWithNextYear } from '../utils/dateUtils';
import { Plus, Trash2, Edit2, ChevronDown, ChevronUp, Calendar, X, Download, FileSpreadsheet } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { useAuth } from '../context/AuthContext';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];
const SHARED_EDIT_DEPARTMENTS: Department[] = ['BUILD', 'MFG'];

export function ResourcesPage() {
  const { employees, addEmployee, deleteEmployee, updateEmployee } = useEmployeeStore();
  const assignments = useAssignmentStore((state) => state.assignments);
  const fetchAssignments = useAssignmentStore((state) => state.fetchAssignments);
  const projects = useProjectStore((state) => state.projects);
  const { activeTeams } = useBuildTeamsStore();
  const { activeTeams: prgActiveTeams } = usePRGTeamsStore();
  const { language } = useLanguage();
  const t = useTranslation(language);
  const { hasFullAccess, isReadOnly, currentUserDepartment } = useAuth();
  const canCreateEmployee = hasFullAccess || (!isReadOnly && Boolean(currentUserDepartment));
  const canEditEmployee = (department: Department) => {
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
  const getDefaultDepartment = (): Department => {
    if (!hasFullAccess && !isReadOnly && currentUserDepartment && DEPARTMENTS.includes(currentUserDepartment as Department)) {
      return currentUserDepartment as Department;
    }
    return 'PM';
  };
  const lockedDepartment = (!hasFullAccess && !isReadOnly && currentUserDepartment) ? currentUserDepartment : null;

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Employee>>({
    name: '',
    role: '',
    department: getDefaultDepartment(),
    capacity: 40,
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

      const weekMap = new Map(allWeeksData.map((week) => [week.date, week.weekNum]));
      const projectById = new Map(projects.map((project) => [project.id, project]));
      const departmentEmployeeIds = new Set(deptEmployees.map((employee) => employee.id));
      const departmentAssignments = assignments.filter((assignment) =>
        departmentEmployeeIds.has(assignment.employeeId) && hasWorkHours(assignment)
      );

      let allChangeOrders: ProjectChangeOrder[] = [];
      try {
        const changeOrderRows = await changeOrdersApi.getAll();
        allChangeOrders = (Array.isArray(changeOrderRows) ? changeOrderRows : []).filter((order) => order?.department === department);
      } catch (changeOrderError) {
        console.error('[ResourcesPage] Failed to load change orders for export:', changeOrderError);
      }
      const changeOrderById = new Map(allChangeOrders.map((order) => [order.id, order]));

      const HEADER_FILL = '2E1A47';
      const HEADER_TEXT = 'FFFFFF';
      const ACCENT_FILL = 'EDE9FE';
      const BODY_BORDER = 'D6D3E1';

      const applyHeader = (cell: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
        cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: BODY_BORDER } },
          left: { style: 'thin', color: { argb: BODY_BORDER } },
          bottom: { style: 'thin', color: { argb: BODY_BORDER } },
          right: { style: 'thin', color: { argb: BODY_BORDER } },
        };
      };

      const applyBody = (cell: any, fill = 'FFFFFF', align: 'left' | 'center' | 'right' = 'left') => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.font = { color: { argb: '1F2937' }, size: 9 };
        cell.alignment = { vertical: 'middle', horizontal: align, wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: BODY_BORDER } },
          left: { style: 'thin', color: { argb: BODY_BORDER } },
          bottom: { style: 'thin', color: { argb: BODY_BORDER } },
          right: { style: 'thin', color: { argb: BODY_BORDER } },
        };
      };

      const summarySheet = workbook.addWorksheet(language === 'es' ? 'Resumen Recursos' : 'Resource Summary');
      summarySheet.columns = [
        { header: language === 'es' ? 'Recurso' : 'Resource', key: 'resource', width: 28 },
        { header: language === 'es' ? 'Rol' : 'Role', key: 'role', width: 24 },
        { header: language === 'es' ? 'Capacidad h/sem' : 'Capacity h/wk', key: 'capacity', width: 14 },
        { header: language === 'es' ? 'Estado' : 'Status', key: 'status', width: 12 },
        { header: language === 'es' ? 'Horas Asignadas' : 'Assigned Hours', key: 'hours', width: 15 },
        { header: language === 'es' ? 'Proyectos' : 'Projects', key: 'projects', width: 12 },
        { header: language === 'es' ? 'Change Orders' : 'Change Orders', key: 'changeOrders', width: 14 },
        { header: language === 'es' ? 'Promedio h/sem' : 'Avg h/week', key: 'avg', width: 14 },
      ];

      summarySheet.mergeCells('A1:H1');
      const summaryTitle = summarySheet.getCell('A1');
      summaryTitle.value = `${language === 'es' ? 'Exportacion de Recursos' : 'Resources Export'} - ${department}`;
      applyHeader(summaryTitle);
      summaryTitle.font = { ...summaryTitle.font, size: 13 };

      summarySheet.mergeCells('A2:H2');
      const summaryMeta = summarySheet.getCell('A2');
      summaryMeta.value = `${language === 'es' ? 'Ano' : 'Year'}: ${selectedYear} | ${language === 'es' ? 'Generado' : 'Generated'}: ${generatedLabel}`;
      applyBody(summaryMeta, ACCENT_FILL, 'left');

      summarySheet.getRow(3).values = summarySheet.columns.map((column) => column.header as string);
      summarySheet.getRow(3).eachCell((cell: any) => applyHeader(cell));

      deptEmployees.forEach((employee) => {
        const employeeAssignments = departmentAssignments.filter((assignment) => assignment.employeeId === employee.id);
        const totalHours = employeeAssignments.reduce((sum, assignment) => sum + getAssignmentHours(assignment), 0);
        const uniqueProjects = new Set(employeeAssignments.map((assignment) => assignment.projectId));
        const employeeChangeOrders = new Set(
          employeeAssignments
            .map((assignment) => assignment.changeOrderId)
            .filter((changeOrderId): changeOrderId is string => Boolean(changeOrderId))
        );
        const avgPerWeek = allWeeksData.length > 0 ? totalHours / allWeeksData.length : totalHours;

        summarySheet.addRow({
          resource: employee.name,
          role: employee.role,
          capacity: employee.capacity || 0,
          status: employee.isActive ? (language === 'es' ? 'Activo' : 'Active') : (language === 'es' ? 'Inactivo' : 'Inactive'),
          hours: Math.round(totalHours * 100) / 100,
          projects: uniqueProjects.size,
          changeOrders: employeeChangeOrders.size,
          avg: Math.round(avgPerWeek * 100) / 100,
        });
      });

      for (let row = 4; row <= summarySheet.rowCount; row += 1) {
        const current = summarySheet.getRow(row);
        current.eachCell((cell: any, colNumber: number) => {
          const isNumeric = [3, 5, 6, 7, 8].includes(colNumber);
          applyBody(cell, 'FFFFFF', isNumeric ? 'center' : 'left');
        });
      }

      const detailSheet = workbook.addWorksheet(language === 'es' ? 'Asignaciones' : 'Assignments');
      detailSheet.columns = [
        { header: language === 'es' ? 'Recurso' : 'Resource', key: 'resource', width: 24 },
        { header: language === 'es' ? 'Semana' : 'Week', key: 'week', width: 12 },
        { header: 'CW', key: 'cw', width: 8 },
        { header: language === 'es' ? 'Proyecto' : 'Project', key: 'project', width: 30 },
        { header: language === 'es' ? 'Cliente' : 'Client', key: 'client', width: 20 },
        { header: language === 'es' ? 'Horas Totales' : 'Total Hours', key: 'hours', width: 12 },
        { header: language === 'es' ? 'Horas SCIO' : 'SCIO Hours', key: 'scio', width: 12 },
        { header: language === 'es' ? 'Horas Externas' : 'External Hours', key: 'external', width: 14 },
        { header: language === 'es' ? 'Etapa' : 'Stage', key: 'stage', width: 24 },
        { header: language === 'es' ? 'Change Order' : 'Change Order', key: 'co', width: 18 },
        { header: language === 'es' ? 'CO Cotizado (h)' : 'CO Quoted (h)', key: 'coQuoted', width: 14 },
        { header: language === 'es' ? 'Comentario' : 'Comment', key: 'comment', width: 36 },
      ];
      detailSheet.getRow(1).values = detailSheet.columns.map((column) => column.header as string);
      detailSheet.getRow(1).eachCell((cell: any) => applyHeader(cell));

      const sortedAssignments = [...departmentAssignments].sort((a, b) => {
        const employeeA = employees.find((employee) => employee.id === a.employeeId)?.name || '';
        const employeeB = employees.find((employee) => employee.id === b.employeeId)?.name || '';
        if (employeeA !== employeeB) return employeeA.localeCompare(employeeB);
        return a.weekStartDate.localeCompare(b.weekStartDate);
      });

      sortedAssignments.forEach((assignment) => {
        const employee = employees.find((item) => item.id === assignment.employeeId);
        const project = projectById.get(assignment.projectId);
        const changeOrder = assignment.changeOrderId ? changeOrderById.get(assignment.changeOrderId) : undefined;
        const scioHours = typeof assignment.scioHours === 'number' ? assignment.scioHours : 0;
        const externalHours = typeof assignment.externalHours === 'number' ? assignment.externalHours : 0;

        detailSheet.addRow({
          resource: employee?.name || (language === 'es' ? 'Recurso eliminado' : 'Deleted resource'),
          week: assignment.weekStartDate,
          cw: weekMap.get(assignment.weekStartDate) || '',
          project: project?.name || (language === 'es' ? 'Proyecto eliminado' : 'Deleted project'),
          client: project?.client || '',
          hours: Math.round(getAssignmentHours(assignment) * 100) / 100,
          scio: Math.round(scioHours * 100) / 100,
          external: Math.round(externalHours * 100) / 100,
          stage: assignment.stage || '',
          co: changeOrder?.name || '',
          coQuoted: changeOrder?.hoursQuoted || 0,
          comment: assignment.comment || '',
        });
      });

      if (detailSheet.rowCount === 1) {
        detailSheet.addRow({
          resource: language === 'es' ? 'Sin asignaciones para este departamento en el ano seleccionado.' : 'No assignments for this department in the selected year.',
        });
      }

      for (let row = 2; row <= detailSheet.rowCount; row += 1) {
        const current = detailSheet.getRow(row);
        current.eachCell((cell: any, colNumber: number) => {
          const isNumeric = [2, 3, 6, 7, 8, 11].includes(colNumber);
          applyBody(cell, row % 2 === 0 ? 'FFFFFF' : 'FAFAFF', isNumeric ? 'center' : 'left');
        });
      }

      const projectSheet = workbook.addWorksheet(language === 'es' ? 'Proyectos y CO' : 'Projects and CO');
      projectSheet.columns = [
        { header: language === 'es' ? 'Proyecto' : 'Project', key: 'project', width: 32 },
        { header: language === 'es' ? 'Cliente' : 'Client', key: 'client', width: 20 },
        { header: language === 'es' ? 'Horas Departamento' : 'Department Hours', key: 'hours', width: 16 },
        { header: language === 'es' ? '# Recursos' : '# Resources', key: 'resources', width: 12 },
        { header: language === 'es' ? 'Change Orders' : 'Change Orders', key: 'coList', width: 46 },
      ];
      projectSheet.getRow(1).values = projectSheet.columns.map((column) => column.header as string);
      projectSheet.getRow(1).eachCell((cell: any) => applyHeader(cell));

      const projectAccumulator = new Map<string, { hours: number; resources: Set<string> }>();
      departmentAssignments.forEach((assignment) => {
        const entry = projectAccumulator.get(assignment.projectId) || { hours: 0, resources: new Set<string>() };
        entry.hours += getAssignmentHours(assignment);
        entry.resources.add(assignment.employeeId);
        projectAccumulator.set(assignment.projectId, entry);
      });

      const projectRows = [...projectAccumulator.entries()]
        .sort((a, b) => b[1].hours - a[1].hours);

      projectRows.forEach(([projectId, data]) => {
        const project = projectById.get(projectId);
        const projectChangeOrders = allChangeOrders
          .filter((order) => order.projectId === projectId)
          .map((order) => `${order.name} (${formatHours(order.hoursQuoted || 0)}h)`)
          .join(', ');

        projectSheet.addRow({
          project: project?.name || (language === 'es' ? 'Proyecto eliminado' : 'Deleted project'),
          client: project?.client || '',
          hours: Math.round(data.hours * 100) / 100,
          resources: data.resources.size,
          coList: projectChangeOrders || (language === 'es' ? 'Sin change orders' : 'No change orders'),
        });
      });

      if (projectSheet.rowCount === 1) {
        projectSheet.addRow({
          project: language === 'es' ? 'Sin datos de proyectos para este departamento.' : 'No project data for this department.',
        });
      }

      for (let row = 2; row <= projectSheet.rowCount; row += 1) {
        const current = projectSheet.getRow(row);
        current.eachCell((cell: any, colNumber: number) => {
          const isNumeric = [3, 4].includes(colNumber);
          applyBody(cell, row % 2 === 0 ? 'FFFFFF' : 'FAFAFF', isNumeric ? 'center' : 'left');
        });
      }

      const fileName = `resources-${department.toLowerCase()}-${selectedYear}-${dateStamp}.xlsx`;
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
    const canSubmit = editingId
      ? Boolean(effectiveDepartment && canEditEmployee(effectiveDepartment))
      : canCreateEmployee;
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
        capacity: formData.capacity || 40,
        isActive: true,
        isSubcontractedMaterial: formData.isSubcontractedMaterial,
        subcontractCompany: formData.subcontractCompany,
      };
      addEmployee(newEmployee);
    }

    setFormData({ name: '', role: '', department: getDefaultDepartment(), capacity: 40, isSubcontractedMaterial: false, subcontractCompany: '' });
    setIsFormOpen(false);
  };

  const handleEdit = (employee: Employee) => {
    if (!canEditEmployee(employee.department)) return;
    setFormData(employee);
    setEditingId(employee.id);
    setIsFormOpen(true);
  };

  const handleCancel = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({ name: '', role: '', department: getDefaultDepartment(), capacity: 40, isSubcontractedMaterial: false, subcontractCompany: '' });
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
                setFormData({ name: '', role: '', department: getDefaultDepartment(), capacity: 40, isSubcontractedMaterial: false, subcontractCompany: '' });
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
                    value={(lockedDepartment as Department) || formData.department || 'PM'}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value as Department })}
                    className="brand-select w-full px-3 py-2 text-[#2e1a47]"
                    disabled={Boolean(lockedDepartment)}
                  >
                    {DEPARTMENTS.map((dept) => (
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
                    value={formData.capacity || 40}
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
                              <div className="text-sm font-medium">{emp.capacity}h/{language === 'es' ? 'sem' : 'wk'}</div>
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

