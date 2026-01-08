import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { Project, Assignment, Employee, Department } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';

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

  return (
    <div className="flex flex-col h-screen">
      {/* Mobile Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-md px-4 py-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-xl font-bold text-gray-800">{t.capacityMatrix}</h1>
          {departmentFilter !== 'General' && (
            <div className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded w-fit">
              {t.viewing} {departmentFilter}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Projects List */}
      <div className="overflow-y-auto flex-1 p-4">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">{t.noProjects || 'No projects found'}</p>
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
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm"
                >
                  {/* Project Header - Click to expand */}
                  <button
                    onClick={() => toggleProject(project.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex-1 text-left">
                      <h3 className="font-semibold text-sm text-gray-900">{project.name}</h3>
                      <p className="text-xs text-gray-600 mt-0.5">{project.client}</p>
                      <div className="flex gap-2 mt-1.5">
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                          {assignedEmployees.size} {t.resources || 'resources'}
                        </span>
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                          {projectAssignments.length}h {t.total}
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {isExpanded ? (
                        <ChevronUp size={20} className="text-gray-600" />
                      ) : (
                        <ChevronDown size={20} className="text-gray-600" />
                      )}
                    </div>
                  </button>

                  {/* Expandable Details */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-gray-50 p-3 space-y-3">
                      {/* Project Info */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-gray-600">{t.startDate}:</span>
                          <p className="font-medium text-gray-900">{project.startDate}</p>
                        </div>
                        <div>
                          <span className="text-gray-600">{t.facility || 'Facility'}:</span>
                          <p className="font-medium text-gray-900">{project.facility}</p>
                        </div>
                      </div>

                      {/* Assigned Employees List */}
                      {projectAssignments.length > 0 ? (
                        <div>
                          <h4 className="text-xs font-semibold text-gray-700 mb-2">
                            👥 {t.teamResources || 'Team Resources'}
                          </h4>
                          <div className="space-y-1">
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
                                  className="bg-white p-2 rounded border border-gray-200 text-xs"
                                >
                                  <div className="font-medium text-gray-900">
                                    {employee?.name}
                                  </div>
                                  <div className="text-gray-600">
                                    {employee?.role} ({employee?.department})
                                  </div>
                                  <div className="text-blue-600 font-semibold mt-1">
                                    {totalHours}h {t.total || 'hours'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 text-center py-2">
                          {t.noAssignments || 'No assignments'}
                        </div>
                      )}

                      {/* Add Assignment Button */}
                      <button
                        onClick={onAddAssignment}
                        className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium px-3 py-2 rounded transition"
                      >
                        <Plus size={16} />
                        {t.add || 'Add'}
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
