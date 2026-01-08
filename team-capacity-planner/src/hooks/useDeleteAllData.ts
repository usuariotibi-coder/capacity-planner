import { useEmployeeStore } from '../stores/employeeStore';
import { useProjectStore } from '../stores/projectStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { employeesApi, projectsApi, assignmentsApi } from '../services/api';

export const useDeleteAllData = () => {
  const deleteAllData = async (): Promise<void> => {
    try {
      // Get all IDs from stores
      const employees = useEmployeeStore.getState().employees;
      const projects = useProjectStore.getState().projects;
      const assignments = useAssignmentStore.getState().assignments;

      // Delete assignments first (due to foreign key constraints)
      for (const assignment of assignments) {
        try {
          await assignmentsApi.delete(assignment.id);
        } catch (error) {
          console.error(`Error deleting assignment ${assignment.id}:`, error);
        }
      }

      // Delete projects
      for (const project of projects) {
        try {
          await projectsApi.delete(project.id);
        } catch (error) {
          console.error(`Error deleting project ${project.id}:`, error);
        }
      }

      // Delete employees
      for (const employee of employees) {
        try {
          await employeesApi.delete(employee.id);
        } catch (error) {
          console.error(`Error deleting employee ${employee.id}:`, error);
        }
      }

      // Clear all stores
      useEmployeeStore.setState({
        employees: [],
        hasFetched: false,
        isLoading: false,
        error: null,
      });

      useProjectStore.setState({
        projects: [],
        hasFetched: false,
        isLoading: false,
        error: null,
      });

      useAssignmentStore.setState({
        assignments: [],
        hasFetched: false,
        isLoading: false,
        error: null,
      });

      // Clear team stores
      useBuildTeamsStore.setState({
        activeTeams: new Set([]),
      });

      usePRGTeamsStore.setState({
        activeTeams: new Set([]),
      });

      // Clear localStorage
      localStorage.removeItem('scioTeamMembers');
      localStorage.removeItem('subcontractedPersonnel');
      localStorage.removeItem('externalPersonnel');

      console.log('[DeleteAllData] All data deleted successfully');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[DeleteAllData] Error:', errorMsg);
      throw error;
    }
  };

  return { deleteAllData };
};
