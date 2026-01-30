import { useEffect } from 'react';
import { useEmployeeStore } from '../stores/employeeStore';
import { useProjectStore } from '../stores/projectStore';
import { useAssignmentStore } from '../stores/assignmentStore';
import { useAuth } from '../context/AuthContext';
import { useBuildTeamsStore } from '../stores/buildTeamsStore';
import { usePRGTeamsStore } from '../stores/prgTeamsStore';
import { normalizeWeekStartDate } from '../utils/dateUtils';
import {
  scioTeamCapacityApi,
  subcontractedTeamCapacityApi,
  prgExternalTeamCapacityApi,
  departmentWeeklyTotalApi,
} from '../services/api';

interface CapacityItem {
  [key: string]: any;
}

/**
 * Hook to load all data from the API when user is authenticated
 */
export const useDataLoader = () => {
  const { isLoggedIn } = useAuth();
  const fetchEmployees = useEmployeeStore((state) => state.fetchEmployees);
  const fetchProjects = useProjectStore((state) => state.fetchProjects);
  const fetchAssignments = useAssignmentStore((state) => state.fetchAssignments);
  const { setActiveTeams } = useBuildTeamsStore();
  const { setActiveTeams: setPRGActiveTeams } = usePRGTeamsStore();

  useEffect(() => {
    if (isLoggedIn) {
      // Load all data in parallel
      Promise.all([
        fetchEmployees(),
        fetchProjects(),
        fetchAssignments(),
        // Load SCIO team capacity from backend
        scioTeamCapacityApi.getAll()
          .then((results: CapacityItem[]) => {
            if (results && Array.isArray(results)) {
              // Store in localStorage for quick access
              localStorage.setItem('scioTeamMembers', JSON.stringify(
                results.reduce((acc: any, item: CapacityItem) => {
                  const dept = item.department;
                  const weekDate = normalizeWeekStartDate(item.weekStartDate);
                  if (!acc[dept]) acc[dept] = {};
                  acc[dept][weekDate] = item.capacity;
                  return acc;
                }, {})
              ));
            }
          }),
        // Load subcontracted team capacity from backend
        subcontractedTeamCapacityApi.getAll()
          .then((results: CapacityItem[]) => {
            if (results && Array.isArray(results)) {
              const subcontracted = results.reduce((acc: any, item: CapacityItem) => {
                const company = item.company;
                const weekDate = normalizeWeekStartDate(item.weekStartDate);
                if (!acc[company]) acc[company] = {};
                acc[company][weekDate] = item.capacity;
                return acc;
              }, {});
              localStorage.setItem('subcontractedPersonnel', JSON.stringify(subcontracted));

              // Extract active teams (as array, not Set)
              const activeTeams = Array.from(new Set(results.map((item: CapacityItem) => item.company)));
              setActiveTeams(activeTeams);
            }
          }),
        // Load PRG external team capacity from backend
        prgExternalTeamCapacityApi.getAll()
          .then((results: CapacityItem[]) => {
            if (results && Array.isArray(results)) {
              const prgExternal = results.reduce((acc: any, item: CapacityItem) => {
                const teamName = item.teamName;
                const weekDate = normalizeWeekStartDate(item.weekStartDate);
                if (!acc[teamName]) acc[teamName] = {};
                acc[teamName][weekDate] = item.capacity;
                return acc;
              }, {});
              localStorage.setItem('prgExternalPersonnel', JSON.stringify(prgExternal));

              // Extract active teams (as array, not Set)
              const activeTeams = Array.from(new Set(results.map((item: CapacityItem) => item.teamName)));
              setPRGActiveTeams(activeTeams);
            }
          }),
        // Load department weekly totals from backend
        departmentWeeklyTotalApi.getAll()
          .then((results: CapacityItem[]) => {
            if (results && Array.isArray(results)) {
              // Store in localStorage for quick access
              localStorage.setItem('departmentWeeklyTotals', JSON.stringify(
                results.reduce((acc: any, item: CapacityItem) => {
                  const dept = item.department;
                  const weekDate = normalizeWeekStartDate(item.weekStartDate);
                  if (!acc[dept]) acc[dept] = {};
                  acc[dept][weekDate] = item.totalHours;
                  return acc;
                }, {})
              ));
            }
          }),
      ]).catch(console.error);
    }
  }, [isLoggedIn, fetchEmployees, fetchProjects, fetchAssignments, setActiveTeams, setPRGActiveTeams]);
};
