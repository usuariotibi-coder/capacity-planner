import { useEffect } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useProjectStore } from '../stores/projectStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useAuth } from '../context/AuthContext';

/**
 * Hook to load all data from the API when user is authenticated
 */
export const useDataLoader = () => {
  const { isLoggedIn } = useAuth();
  const fetchEmployees = useEmployeeStore((state) => state.fetchEmployees);
  const fetchProjects = useProjectStore((state) => state.fetchProjects);
  const fetchAssignments = useAssignmentStore((state) => state.fetchAssignments);

  useEffect(() => {
    if (isLoggedIn) {
      // Load all data in parallel
      Promise.all([
        fetchEmployees(),
        fetchProjects(),
        fetchAssignments(),
      ]).catch(console.error);
    }
  }, [isLoggedIn, fetchEmployees, fetchProjects, fetchAssignments]);
};
