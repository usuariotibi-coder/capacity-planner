/**
 * EXTERNAL TEAMS STORE
 *
 * Zustand store for managing active "external team" rosters, globally, for every
 * department that has the add-an-external-team feature: MED, HD, MFG, PRG.
 * (BUILD has its own separate system -- see buildTeamsStore.ts/SubcontractedTeamCapacity.)
 *
 * Loads unique (department, team name) pairs from the external-team-capacity API
 * (still served from the `PrgExternalTeamCapacity` model/endpoint -- generalized
 * from PRG-only without a rename, see that model's docstring).
 */

import { create } from 'zustand';
import { prgExternalTeamCapacityApi } from '../services/api';
import type { Department } from '../types';

interface ExternalTeamsStore {
  teamsByDepartment: Partial<Record<Department, string[]>>;
  setTeamsForDepartment: (department: Department, teams: string[]) => void;
  loadActiveTeams: () => Promise<void>;
}

export const useExternalTeamsStore = create<ExternalTeamsStore>((set, get) => ({
  teamsByDepartment: {},
  setTeamsForDepartment: (department, teams) =>
    set({ teamsByDepartment: { ...get().teamsByDepartment, [department]: teams } }),
  loadActiveTeams: async () => {
    try {
      console.log('[ExternalTeamsStore] Loading active teams from API...');
      const data = await prgExternalTeamCapacityApi.getAll();

      const byDepartment: Partial<Record<Department, Set<string>>> = {};
      (data || []).forEach((record: any) => {
        const department = record.department as Department;
        const teamName = record.teamName;
        if (!department || !teamName) return;
        if (!byDepartment[department]) byDepartment[department] = new Set();
        byDepartment[department]!.add(teamName);
      });

      const teamsByDepartment: Partial<Record<Department, string[]>> = {};
      Object.entries(byDepartment).forEach(([department, teams]) => {
        teamsByDepartment[department as Department] = Array.from(teams || []);
      });

      set({ teamsByDepartment });
      console.log('[ExternalTeamsStore] Active teams loaded:', teamsByDepartment);
    } catch (error) {
      console.error('[ExternalTeamsStore] Error loading active teams:', error);
    }
  },
}));
