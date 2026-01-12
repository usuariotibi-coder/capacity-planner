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
 * @property activeTeams - Set of active team names
 * @property setActiveTeams - Update the set of active teams
 * @property loadActiveTeams - Load active teams from API
 */
interface BuildTeamsStore {
  activeTeams: Set<string>;
  setActiveTeams: (teams: Set<string>) => void;
  loadActiveTeams: () => Promise<void>;
}

/**
 * Global store for BUILD department teams
 * Initial state: empty, loads from API on demand
 */
export const useBuildTeamsStore = create<BuildTeamsStore>((set) => ({
  activeTeams: new Set([]),
  setActiveTeams: (teams) => set({ activeTeams: teams }),
  loadActiveTeams: async () => {
    try {
      console.log('[BuildTeamsStore] Loading active teams from API...');
      const data = await subcontractedTeamCapacityApi.getAll();

      // Extract unique company names
      const uniqueCompanies = new Set<string>();
      for (const record of data) {
        if (record.company) {
          uniqueCompanies.add(record.company);
        }
      }

      set({ activeTeams: uniqueCompanies });
      console.log('[BuildTeamsStore] Active teams loaded:', Array.from(uniqueCompanies));
    } catch (error) {
      console.error('[BuildTeamsStore] Error loading active teams:', error);
    }
  },
}));
