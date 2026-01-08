import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Project, Assignment, Employee, Department } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getDepartmentIcon } from '../utils/departmentIcons';
import { getAllWeeksWithNextYear } from '../utils/dateUtils';

interface CapacityMatrixMobileViewProps {
  departmentFilter: 'General' | Department;
  projects: Project[];
  employees: Employee[];
  assignments: Assignment[];
  scioTeamMembers?: Record<Department, Record<string, number>>;
  activeTeams?: Set<string>;
  subcontractedPersonnel?: Record<string, Record<string, number | undefined>>;
  prgActiveTeams?: Set<string>;
  prgExternalPersonnel?: Record<string, Record<string, number | undefined>>;
  onAddAssignment?: () => void;
}

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];

const defaultScioTeamMembers: Record<Department, Record<string, number>> = {
  'PM': {},
  'MED': {},
  'HD': {},
  'MFG': {},
  'BUILD': {},
  'PRG': {},
};

export function CapacityMatrixMobileView({
  departmentFilter,
  projects,
  employees,
  assignments,
  scioTeamMembers = defaultScioTeamMembers,
  activeTeams = new Set(),
  subcontractedPersonnel = {},
  prgActiveTeams = new Set(),
  prgExternalPersonnel = {},
}: CapacityMatrixMobileViewProps) {
  const { language } = useLanguage();
  const t = useTranslation(language);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const allWeeksData = getAllWeeksWithNextYear(selectedYear);

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

  const dept = departmentFilter as Department;

  // Filter projects
  const filteredProjects =
    departmentFilter === 'General'
      ? projects
      : projects.filter(
          (p) =>
            p.visibleInDepartments &&
            p.visibleInDepartments.length > 0 &&
            p.visibleInDepartments.includes(departmentFilter)
        );

  // Show all weeks
  const weeksToShow = allWeeksData;

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-50">
      {/* Mobile Header */}
      <div className="sticky top-0 z-30 bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg px-4 py-3">
        <h1 className="text-base font-bold mb-2">{t.capacityMatrix}</h1>
        <div className="flex items-center gap-2 justify-between">
          {departmentFilter !== 'General' && (
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {getDepartmentIcon(departmentFilter as Department).icon}
              <span>{departmentFilter}</span>
            </div>
          )}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="border border-white rounded px-2 py-1 text-xs font-semibold text-blue-700 bg-white"
          >
            <option value={2024}>2024</option>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto flex-1">
        {departmentFilter === 'General' ? (
          // General View - Show summary of all departments
          <div className="p-3 space-y-3">
            {DEPARTMENTS.map((d) => {
              const deptIcon = getDepartmentIcon(d);
              const deptEmployees = employees.filter((e) => e.department === d && !e.isSubcontractedMaterial);
              const deptAssignments = assignments.filter((a) => {
                const emp = employees.find((e) => e.id === a.employeeId);
                return emp?.department === d;
              });

              return (
                <div
                  key={d}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl ${deptIcon.color}`}>{deptIcon.icon}</span>
                    <div className="flex-1">
                      <h3 className="font-bold text-sm text-gray-900">{d}</h3>
                      <p className="text-xs text-gray-600">
                        👥 {deptEmployees.length} • 📋 {deptAssignments.reduce((s, a) => s + a.hours, 0).toFixed(0)}h
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Department-specific View - Show detailed capacity matrix
          <div className="p-2 space-y-2">
            {/* Weekly Occupancy Panel */}
            <div className="bg-white rounded-lg border border-indigo-200 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-3 py-2 border-b border-indigo-200">
                <h3 className="text-xs font-bold text-indigo-800">{t.totalLabel || 'Total'}</h3>
              </div>
              <div className="overflow-x-auto">
                <div className="flex gap-0.5 p-2 min-w-min">
                  {weeksToShow.map((weekData) => {
                    const deptAssignments = assignments.filter((a) => {
                      const emp = employees.find((e) => e.id === a.employeeId);
                      return a.weekStartDate === weekData.date && emp?.department === dept;
                    });
                    const totalHours = deptAssignments.reduce((sum, a) => sum + a.hours, 0);
                    const displayValue = dept === 'MFG' ? totalHours : totalHours / 45;
                    return (
                      <div key={`total-${weekData.date}`} className="flex flex-col items-center flex-shrink-0 text-center">
                        <div className="text-[9px] font-bold text-gray-700 mb-0.5">W{weekData.weekNum}</div>
                        <div className="bg-orange-300 text-orange-900 rounded text-[9px] font-bold px-1.5 py-1 min-w-[32px]">
                          {displayValue.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* SCIO Team Capacity Panel */}
            <div className="bg-white rounded-lg border border-purple-200 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-purple-50 to-purple-50 px-3 py-2 border-b border-purple-200">
                <h3 className="text-xs font-bold text-purple-800">
                  {dept === 'MFG' ? t.hoursPerWeek : t.scioTeamMembers}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <div className="flex gap-0.5 p-2 min-w-min">
                  {weeksToShow.map((weekData) => {
                    const capacity = scioTeamMembers?.[dept]?.[weekData.date] || 0;
                    return (
                      <div key={`scio-${weekData.date}`} className="flex flex-col items-center flex-shrink-0 text-center">
                        <div className="text-[9px] font-bold text-gray-700 mb-0.5">W{weekData.weekNum}</div>
                        <div className="bg-purple-100 text-purple-900 rounded text-[9px] font-bold px-1.5 py-1 min-w-[32px]">
                          {capacity.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Subcontracted Personnel (BUILD only) */}
            {dept === 'BUILD' &&
              Array.from(activeTeams).map((company) => (
                <div
                  key={`subcontract-${company}`}
                  className="bg-white rounded-lg border border-violet-200 overflow-hidden shadow-sm"
                >
                  <div className="bg-gradient-to-r from-violet-50 to-violet-50 px-3 py-2 border-b border-violet-200">
                    <h3 className="text-xs font-bold text-violet-800 truncate">{company}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <div className="flex gap-0.5 p-2 min-w-min">
                      {weeksToShow.map((weekData) => {
                        const count = subcontractedPersonnel?.[company]?.[weekData.date] || 0;
                        return (
                          <div key={`${company}-${weekData.date}`} className="flex flex-col items-center flex-shrink-0 text-center">
                            <div className="text-[9px] font-bold text-gray-700 mb-0.5">W{weekData.weekNum}</div>
                            <div className="bg-violet-100 text-violet-900 rounded text-[9px] font-bold px-1.5 py-1 min-w-[32px]">
                              {count.toFixed(0)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}

            {/* External Teams (PRG only) */}
            {dept === 'PRG' &&
              Array.from(prgActiveTeams).map((team) => (
                <div
                  key={`prg-${team}`}
                  className="bg-white rounded-lg border border-cyan-200 overflow-hidden shadow-sm"
                >
                  <div className="bg-gradient-to-r from-cyan-50 to-cyan-50 px-3 py-2 border-b border-cyan-200">
                    <h3 className="text-xs font-bold text-cyan-800 truncate">{team}</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <div className="flex gap-0.5 p-2 min-w-min">
                      {weeksToShow.map((weekData) => {
                        const count = prgExternalPersonnel?.[team]?.[weekData.date] || 0;
                        return (
                          <div key={`${team}-${weekData.date}`} className="flex flex-col items-center flex-shrink-0 text-center">
                            <div className="text-[9px] font-bold text-gray-700 mb-0.5">W{weekData.weekNum}</div>
                            <div className="bg-cyan-100 text-cyan-900 rounded text-[9px] font-bold px-1.5 py-1 min-w-[32px]">
                              {count.toFixed(0)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}

            {/* Projects List */}
            {filteredProjects.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-bold text-gray-800 mb-2 px-1">📋 {t.projects}</h3>
                <div className="space-y-2">
                  {filteredProjects.map((project) => {
                    const isExpanded = expandedProjects.has(project.id);
                    const projectAssignments = assignments.filter((a) => a.projectId === project.id);
                    const totalHours = projectAssignments.reduce((sum, a) => sum + a.hours, 0);

                    return (
                      <div
                        key={project.id}
                        className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm"
                      >
                        <button
                          onClick={() => toggleProject(project.id)}
                          className="w-full flex items-center justify-between p-2.5 hover:bg-blue-50 transition"
                        >
                          <div className="flex-1 text-left">
                            <h4 className="font-semibold text-sm text-gray-900">{project.name}</h4>
                            <p className="text-xs text-gray-600 mt-0.5">{project.client}</p>
                            <div className="flex gap-1 mt-1">
                              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                {projectAssignments.length}
                              </span>
                              <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
                                {totalHours}h
                              </span>
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp size={18} className="text-blue-600 flex-shrink-0" />
                          ) : (
                            <ChevronDown size={18} className="text-gray-400 flex-shrink-0" />
                          )}
                        </button>
                        {isExpanded && projectAssignments.length > 0 && (
                          <div className="border-t border-gray-200 bg-gray-50 p-2 max-h-40 overflow-y-auto">
                            <div className="space-y-1">
                              {projectAssignments.map((assignment) => {
                                const emp = employees.find((e) => e.id === assignment.employeeId);
                                return (
                                  <div key={assignment.id} className="text-xs bg-white p-2 rounded border border-gray-100">
                                    <div className="font-medium text-gray-900">{emp?.name}</div>
                                    <div className="text-gray-600 text-[11px]">{emp?.role}</div>
                                    <div className="font-bold text-blue-600 mt-1">{assignment.hours}h</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
