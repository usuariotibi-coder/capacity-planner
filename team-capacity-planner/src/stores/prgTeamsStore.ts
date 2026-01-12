/**
 * PRG TEAMS STORE
 *
 * Zustand store for managing active PRG department teams globally.
 * Keeps track of which external teams are active for PRG (Programming PLC) department.
 *
 * Loads unique team names from PrgExternalTeamCapacity API to determine active teams.
 */

import { create } from 'zustand';
import { prgExternalTeamCapacityApi } from '../services/api';

/**
 * PRGTeamsStore Interface
 * @property activeTeams - Set of active team names
 * @property setActiveTeams - Update the set of active teams
 * @property loadActiveTeams - Load active teams from API
 */
interface PRGTeamsStore {
  activeTeams: Set<string>;
  setActiveTeams: (teams: Set<string>) => void;
  loadActiveTeams: () => Promise<void>;
}

/**
 * Global store for PRG department teams
 * Initial state: empty, loads from API on demand
 */
export const usePRGTeamsStore = create<PRGTeamsStore>((set) => ({
  activeTeams: new Set([]),
  setActiveTeams: (teams) => set({ activeTeams: teams }),
  loadActiveTeams: async () => {
    try {
      console.log('[PRGTeamsStore] Loading active teams from API...');
      const data = await prgExternalTeamCapacityApi.getAll();

      // Extract unique team names
      const uniqueTeams = new Set<string>();
      for (const record of data) {
        if (record.teamName) {
          uniqueTeams.add(record.teamName);
        }
      }

      set({ activeTeams: uniqueTeams });
      console.log('[PRGTeamsStore] Active teams loaded:', Array.from(uniqueTeams));
    } catch (error) {
      console.error('[PRGTeamsStore] Error loading active teams:', error);
    }
  },
}));
