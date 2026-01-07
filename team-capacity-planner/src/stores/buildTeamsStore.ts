/**
 * BUILD TEAMS STORE
 *
 * Zustand store for managing active BUILD department teams globally.
 * Keeps track of which subcontracted teams are active (AMI, VICER, ITAX, MCI, MG Electrical).
 *
 * This is an in-memory store. For production, replace with backend API calls.
 */

import { create } from 'zustand';

/**
 * BuildTeamsStore Interface
 * @property activeTeams - Set of active team names
 * @property setActiveTeams - Update the set of active teams
 */
interface BuildTeamsStore {
  activeTeams: Set<string>;
  setActiveTeams: (teams: Set<string>) => void;
}

/**
 * Global store for BUILD department teams
 * Initial state: no teams by default (user adds them via popup)
 */
export const useBuildTeamsStore = create<BuildTeamsStore>((set) => ({
  activeTeams: new Set([]),
  setActiveTeams: (teams) => set({ activeTeams: teams }),
}));
