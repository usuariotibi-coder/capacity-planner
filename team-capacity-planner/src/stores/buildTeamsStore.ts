/**
 * BUILD TEAMS STORE
 *
 * Zustand store for managing active BUILD department teams globally.
 * Keeps track of which subcontracted teams are active (AMI, VICER, ITAX, MCI, MG Electrical).
 *
 * Loads unique company names from SubcontractedTeamCapacity API to determine active teams.
 */

import { create } from 'zustand';
import { subcontractedTeamCapacityApi } from '../services/api';

/**
 * BuildTeamsStore Interface
 * @property activeTeams - Array of active team names
 * @property setActiveTeams - Update the array of active teams
 * @property loadActiveTeams - Load active teams from API
 */
interface BuildTeamsStore {
  activeTeams: string[];
  setActiveTeams: (teams: string[]) => void;
  loadActiveTeams: () => Promise<void>;
}

/**
 * Global store for BUILD department teams
 * Initial state: empty, loads from API on demand
 * Using arrays instead of Sets for better Zustand reactivity
 */
export const useBuildTeamsStore = create<BuildTeamsStore>((set) => ({
  activeTeams: [],
  setActiveTeams: (teams) => set({ activeTeams: teams }),
  loadActiveTeams: async () => {
    try {
      console.log('[BuildTeamsStore] Loading active teams from API...');
      const data = await subcontractedTeamCapacityApi.getAll();

      // Extract unique company names
      const uniqueCompanies = Array.from(new Set(data.map((r: any) => r.company).filter(Boolean)));

      set({ activeTeams: uniqueCompanies });
      console.log('[BuildTeamsStore] Active teams loaded:', uniqueCompanies);
    } catch (error) {
      console.error('[BuildTeamsStore] Error loading active teams:', error);
    }
  },
}));
