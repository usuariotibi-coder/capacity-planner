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
 * @property activeTeams - Array of active team names
 * @property setActiveTeams - Update the array of active teams
 * @property loadActiveTeams - Load active teams from API
 */
interface PRGTeamsStore {
  activeTeams: string[];
  setActiveTeams: (teams: string[]) => void;
  loadActiveTeams: () => Promise<void>;
}

/**
 * Global store for PRG department teams
 * Initial state: empty, loads from API on demand
 * Using arrays instead of Sets for better Zustand reactivity
 */
export const usePRGTeamsStore = create<PRGTeamsStore>((set) => ({
  activeTeams: [],
  setActiveTeams: (teams) => set({ activeTeams: teams }),
  loadActiveTeams: async () => {
    try {
      console.log('[PRGTeamsStore] Loading active teams from API...');
      const data = await prgExternalTeamCapacityApi.getAll();

      // Extract unique team names
      const uniqueTeams = Array.from(new Set(data.map((r: any) => r.teamName).filter(Boolean)));

      set({ activeTeams: uniqueTeams });
      console.log('[PRGTeamsStore] Active teams loaded:', uniqueTeams);
    } catch (error) {
      console.error('[PRGTeamsStore] Error loading active teams:', error);
    }
  },
}));
