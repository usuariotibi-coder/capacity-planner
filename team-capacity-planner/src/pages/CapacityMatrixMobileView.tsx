import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, TrendingUp, Users, Calendar } from 'lucide-react';
import type { Project, Assignment, Employee, Department } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getDepartmentIcon } from '../utils/departmentIcons';

interface CapacityMatrixMobileViewProps {
  departmentFilter: 'General' | Department;
  projects: Project[];
  employees: Employee[];
  assignments: Assignment[];
  onAddAssignment?: () => void;
}

export function CapacityMatrixMobileView({
  departmentFilter,
  projects,
  employees,
  assignments,
  onAddAssignment,
}: CapacityMatrixMobileViewProps) {
  const { language } = useLanguage();
  const t = useTranslation(language);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  };

  // Filter projects based on department
  const filteredProjects =
    departmentFilter === 'General'
      ? projects
      : projects.filter(
          (p) =>
            p.visibleInDepartments &&
            p.visibleInDepartments.length > 0 &&
            p.visibleInDepartments.includes(departmentFilter)
        );

  // Calculate statistics
  const totalProjects = filteredProjects.length;
  const totalAssignments = filteredProjects.reduce((sum, p) => {
    const pAssignments = assignments.filter(a => a.projectId === p.id);
    return sum + pAssignments.length;
  }, 0);
  const totalHours = filteredProjects.reduce((sum, p) => {
    const pAssignments = assignments.filter(a => a.projectId === p.id);
    return sum + pAssignments.reduce((s, a) => s + a.hours, 0);
  }, 0);
  const uniqueEmployees = new Set(filteredProjects.flatMap(p =>
    assignments.filter(a => a.projectId === p.id).map(a => a.employeeId)
  )).size;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Mobile Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg px-4 py-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-lg font-bold">{t.capacityMatrix}</h1>
          {departmentFilter !== 'General' && (
            <div className="flex items-center gap-2 text-xs font-medium bg-white bg-opacity-20 px-2 py-1 rounded w-fit">
              {getDepartmentIcon(departmentFilter as Department).icon}
              <span>{departmentFilter}</span>
            </div>
          )}
        </div>
      </div>

      {/* Statistics Bar */}
      {totalProjects > 0 && (
        <div className="bg-white border-b border-gray-200 px-4 py-3 grid grid-cols-4 gap-2 text-center text-xs font-semibold">
          <div className="flex flex-col items-center gap-1">
            <TrendingUp size={16} className="text-blue-600" />
            <span className="text-gray-600">{t.projects}</span>
            <span className="text-lg font-bold text-blue-600">{totalProjects}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Users size={16} className="text-green-600" />
            <span className="text-gray-600">{t.resources}</span>
            <span className="text-lg font-bold text-green-600">{uniqueEmployees}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Calendar size={16} className="text-purple-600" />
            <span className="text-gray-600">{t.totalLabel}</span>
            <span className="text-lg font-bold text-purple-600">{totalAssignments}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-base">⏱️</span>
            <span className="text-gray-600">Horas</span>
            <span className="text-lg font-bold text-orange-600">{totalHours}h</span>
          </div>
        </div>
      )}

      {/* Mobile Projects List */}
      <div className="overflow-y-auto flex-1 p-4">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-sm font-medium text-gray-600 mb-1">{t.noProjects || 'No projects found'}</p>
            <p className="text-xs text-gray-500">Crea un proyecto para comenzar</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredProjects.map((project) => {
              const isExpanded = expandedProjects.has(project.id);
              const projectAssignments = assignments.filter(
                (a) => a.projectId === project.id
              );
              const assignedEmployees = new Set(projectAssignments.map((a) => a.employeeId));

              return (
                <div
                  key={project.id}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-md hover:shadow-lg transition-shadow"
                >
                  {/* Project Header - Click to expand */}
                  <button
                    onClick={() => toggleProject(project.id)}
                    className="w-full flex items-center justify-between p-4 hover:bg-blue-50 transition"
                  >
                    <div className="flex-1 text-left">
                      <h3 className="font-bold text-base text-gray-900 mb-1">{project.name}</h3>
                      <p className="text-xs text-gray-600 font-medium mb-2">👤 {project.client}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        <span className="text-xs bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-semibold">
                          👥 {assignedEmployees.size}
                        </span>
                        <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full font-semibold">
                          📋 {projectAssignments.length}
                        </span>
                        <span className="text-xs bg-orange-100 text-orange-800 px-2.5 py-1 rounded-full font-semibold">
                          ⏱️ {projectAssignments.reduce((sum, a) => sum + a.hours, 0)}h
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-3 text-gray-400">
                      {isExpanded ? (
                        <ChevronUp size={24} className="text-blue-600" />
                      ) : (
                        <ChevronDown size={24} className="text-gray-400" />
                      )}
                    </div>
                  </button>

                  {/* Expandable Details */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-gradient-to-b from-blue-50 to-white p-4 space-y-4">
                      {/* Project Info Cards */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-gray-600 text-[10px] font-semibold uppercase">{t.startDate}</span>
                          <p className="font-bold text-gray-900 mt-1">{project.startDate}</p>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-gray-600 text-[10px] font-semibold uppercase">{t.facility || 'Facility'}</span>
                          <p className="font-bold text-gray-900 mt-1">{project.facility}</p>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-gray-600 text-[10px] font-semibold uppercase">{t.weeks || 'Weeks'}</span>
                          <p className="font-bold text-gray-900 mt-1">{project.numberOfWeeks}</p>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-gray-200">
                          <span className="text-gray-600 text-[10px] font-semibold uppercase">PM</span>
                          <p className="font-bold text-gray-900 mt-1 text-sm">{project.projectManagerId ? '✓' : '-'}</p>
                        </div>
                      </div>

                      {/* Assigned Employees List */}
                      {projectAssignments.length > 0 ? (
                        <div>
                          <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                            👥 {t.teamResources || 'Team Resources'} ({assignedEmployees.size})
                          </h4>
                          <div className="space-y-2">
                            {Array.from(assignedEmployees).map((empId) => {
                              const employee = employees.find((e) => e.id === empId);
                              const empAssignments = projectAssignments.filter(
                                (a) => a.employeeId === empId
                              );
                              const totalHours = empAssignments.reduce(
                                (sum, a) => sum + a.hours,
                                0
                              );

                              return (
                                <div
                                  key={empId}
                                  className="bg-white p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition"
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="font-bold text-gray-900 text-sm">
                                        {employee?.name}
                                      </div>
                                      <div className="text-gray-600 text-xs mt-0.5">
                                        {employee?.role}
                                      </div>
                                      <div className="inline-block mt-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-medium">
                                        {employee?.department}
                                      </div>
                                    </div>
                                    <div className="text-right ml-2">
                                      <div className="text-lg font-bold text-blue-600">
                                        {totalHours}h
                                      </div>
                                      <div className="text-[10px] text-gray-500 font-medium">
                                        {empAssignments.length} asig.
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-6 bg-white rounded-lg border-2 border-dashed border-gray-300">
                          <p className="text-gray-500 text-sm">📭 {t.noAssignments || 'No assignments'}</p>
                        </div>
                      )}

                      {/* Add Assignment Button */}
                      <button
                        onClick={onAddAssignment}
                        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white text-sm font-bold px-4 py-3 rounded-lg transition shadow-md"
                      >
                        <Plus size={18} />
                        {t.add || 'Add'} {t.noAssignments || 'Assignment'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
