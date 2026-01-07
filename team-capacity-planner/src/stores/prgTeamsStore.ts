/**
 * PRG TEAMS STORE
 *
 * Zustand store for managing active PRG department teams globally.
 * Keeps track of which external teams are active for PRG (Programming PLC) department.
 *
 * This is an in-memory store. For production, replace with backend API calls.
 */

import { create } from 'zustand';

/**
 * PRGTeamsStore Interface
 * @property activeTeams - Set of active team names
 * @property setActiveTeams - Update the set of active teams
 */
interface PRGTeamsStore {
  activeTeams: Set<string>;
  setActiveTeams: (teams: Set<string>) => void;
}

/**
 * Global store for PRG department teams
 * Initial state: no teams by default (user adds them as needed)
 */
export const usePRGTeamsStore = create<PRGTeamsStore>((set) => ({
  activeTeams: new Set([]),
  setActiveTeams: (teams) => set({ activeTeams: teams }),
}));
