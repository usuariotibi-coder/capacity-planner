import { useState } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useProjectStore } from '../stores/projectStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import type { Employee, Department } from '../types';
import { generateId } from '../utils/id';
import { getAllWeeksWithNextYear } from '../utils/dateUtils';
import { Plus, Trash2, Edit2, ChevronDown, ChevronUp, Calendar, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];

export function ResourcesPage() {
  const { employees, addEmployee, deleteEmployee, updateEmployee } = useEmployeeStore();
  const assignments = useAssignmentStore((state) => state.assignments);
  const projects = useProjectStore((state) => state.projects);
  const { activeTeams } = useBuildTeamsStore();
  const { activeTeams: prgActiveTeams } = usePRGTeamsStore();
  const { language } = useLanguage();
  const t = useTranslation(language);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<Employee>>({
    name: '',
    role: '',
    department: 'PM',
    capacity: 40,
    isSubcontractedMaterial: false,
    subcontractCompany: '',
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());

  const allWeeksData = getAllWeeksWithNextYear(selectedYear);

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
    return assignments.filter((a) => a.employeeId === employeeId);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.role || !formData.department) {
      alert(t.completeAllFields);
      return;
    }

    if (editingId) {
      updateEmployee(editingId, formData);
      setEditingId(null);
    } else {
      const newEmployee: Employee = {
        id: generateId(),
        name: formData.name,
        role: formData.role,
        department: formData.department,
        capacity: formData.capacity || 40,
        isActive: true,
        isSubcontractedMaterial: formData.isSubcontractedMaterial,
        subcontractCompany: formData.subcontractCompany,
      };
      addEmployee(newEmployee);
    }

    setFormData({ name: '', role: '', department: 'PM', capacity: 40, isSubcontractedMaterial: false, subcontractCompany: '' });
    setIsFormOpen(false);
  };

  const handleEdit = (employee: Employee) => {
    setFormData(employee);
    setEditingId(employee.id);
    setIsFormOpen(true);
  };

  const handleCancel = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({ name: '', role: '', department: 'PM', capacity: 40, isSubcontractedMaterial: false, subcontractCompany: '' });
  };

  const getDepartmentColor = (dept: Department) => {
    const colors: Record<Department, string> = {
      'PM': 'bg-blue-50 border-blue-200',
      'MED': 'bg-cyan-50 border-cyan-200',
      'HD': 'bg-purple-50 border-purple-200',
      'MFG': 'bg-orange-50 border-orange-200',
      'BUILD': 'bg-green-50 border-green-200',
      'PRG': 'bg-lime-50 border-lime-200',
    };
    return colors[dept];
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-md px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">{t.teamResources}</h1>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
              <Calendar size={20} className="text-blue-600 flex-shrink-0" />
              <label className="text-xs sm:text-sm font-semibold text-gray-700 whitespace-nowrap">{t.year}:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="border-2 border-blue-300 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition"
              >
                <option value={2024}>2024</option>
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>
            <button
              onClick={() => setIsFormOpen(true)}
              className="flex items-center justify-center sm:justify-start gap-2 bg-blue-500 hover:bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base"
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
            <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-full max-w-[95vw] sm:max-w-md max-h-screen overflow-auto">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-blue-100">
                <h2 className="text-xl font-semibold text-gray-800">
                  {editingId ? t.editEmployee : t.newEmployee}
                </h2>
                <button
                  onClick={handleCancel}
                  className="p-1 text-gray-600 hover:bg-gray-200 rounded transition"
                  title={t.cancel}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {/* Name Field */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.name}</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t.egJohnDoe}
                    autoFocus
                  />
                </div>

                {/* Department Field */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.department}</label>
                  <select
                    value={formData.department || 'PM'}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value as Department })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <input
                        type="checkbox"
                        id="isSubcontracted"
                        checked={formData.isSubcontractedMaterial || false}
                        onChange={(e) => setFormData({
                          ...formData,
                          isSubcontractedMaterial: e.target.checked,
                          subcontractCompany: e.target.checked ? formData.subcontractCompany : ''
                        })}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <label htmlFor="isSubcontracted" className="text-sm font-medium text-gray-700 cursor-pointer">
                        {t.isSubcontractedMaterial}
                      </label>
                    </div>

                    {/* Company Selection - Show only if subcontracted and in BUILD department */}
                    {formData.isSubcontractedMaterial && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">{t.selectCompany}</label>
                        <select
                          value={formData.subcontractCompany || ''}
                          onChange={(e) => setFormData({ ...formData, subcontractCompany: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    <div className="flex items-center gap-3 p-3 bg-teal-50 rounded-lg border border-teal-200">
                      <input
                        type="checkbox"
                        id="isExternalTeam"
                        checked={formData.isSubcontractedMaterial || false}
                        onChange={(e) => setFormData({
                          ...formData,
                          isSubcontractedMaterial: e.target.checked,
                          subcontractCompany: e.target.checked ? formData.subcontractCompany : ''
                        })}
                        className="w-4 h-4 text-teal-600 rounded focus:ring-2 focus:ring-teal-500"
                      />
                      <label htmlFor="isExternalTeam" className="text-sm font-medium text-gray-700 cursor-pointer">
                        {t.isSubcontractedMaterial}
                      </label>
                    </div>

                    {/* Team Selection - Show only if external team and in PRG department */}
                    {formData.isSubcontractedMaterial && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">{t.selectTeam}</label>
                        <select
                          value={formData.subcontractCompany || ''}
                          onChange={(e) => setFormData({ ...formData, subcontractCompany: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.role}</label>
                  <input
                    type="text"
                    value={formData.role || ''}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder={t.egDesignEngineer}
                  />
                </div>

                {/* Capacity Field */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.capacity}</label>
                  <input
                    type="number"
                    value={formData.capacity || 40}
                    onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min="1"
                    max="168"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition"
                  >
                    {editingId ? t.update : t.create}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      <div className="overflow-y-auto flex-1 p-8">
        {/* Employees grouped by department */}
        {DEPARTMENTS.map((dept) => {
          // Filter out system placeholder employees (names like "MFG Employee 1", "PM Employee 1", etc.)
          const isPlaceholderEmployee = (name: string) =>
            /^(PM|MED|HD|MFG|PRG|BUILD) Employee \d+$/.test(name) || name === 'MFG Placeholder';
          const deptEmployees = employees.filter((e) => e.department === dept && !isPlaceholderEmployee(e.name));
          if (deptEmployees.length === 0) return null;

          return (
            <div key={dept} className={`mb-8 border rounded-lg p-4 ${getDepartmentColor(dept)}`}>
              <h2 className="text-xl font-bold mb-4 text-gray-800">{dept} {t.departmentLabel}</h2>
              <div className="space-y-2">
                {deptEmployees.map((emp) => {
                  const empAssignments = getEmployeeAssignments(emp.id);
                  const isExpanded = expandedEmployees.has(emp.id);
                  const totalAssignedHours = empAssignments.reduce((sum, a) => sum + a.hours, 0);
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
                                    {totalAssignedHours}h {t.total}
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
                            onClick={() => handleEdit(emp)}
                            className="p-1.5 text-blue-500 hover:bg-blue-100 rounded transition"
                            title={t.edit}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => deleteEmployee(emp.id)}
                            className="p-1.5 text-red-500 hover:bg-red-100 rounded transition"
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
                                const weekTotalHours = weekAssignments.reduce((sum, a) => sum + a.hours, 0);
                                const hasAssignment = weekAssignments.length > 0;

                                // Get unique projects for this week
                                const weekProjects = [...new Set(weekAssignments.map(a => a.projectId))];

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
                                    title={hasAssignment
                                      ? `${t.weekAbbr} ${weekData.weekNum}: ${weekTotalHours}h - ${weekProjects.map(pId => projects.find(p => p.id === pId)?.name).join(', ')}`
                                      : `${t.weekAbbr} ${weekData.weekNum}: ${t.noAssignment}`
                                    }
                                  >
                                    <span className={`text-xs font-bold ${hasAssignment ? 'text-gray-700' : 'text-gray-400'}`}>
                                      {weekData.weekNum}
                                    </span>
                                    {hasAssignment && (
                                      <span className="text-xs font-semibold text-gray-600">
                                        {weekTotalHours}h
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
                            <span>{t.week} 52+ →</span>
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
