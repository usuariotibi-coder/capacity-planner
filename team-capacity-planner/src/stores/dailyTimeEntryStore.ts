import { create } from 'zustand';
import type { DailyTimeEntry } from '../types';
import { dailyTimeEntriesApi, isAuthenticated } from '../services/api';

interface DailyTimeEntryStore {
  entries: DailyTimeEntry[];
  isLoading: boolean;
  error: string | null;
  lastFetchKey: string | null;
  fetchEntries: (options: { startDate: string; endDate: string; force?: boolean }) => Promise<void>;
  addEntry: (entry: Omit<DailyTimeEntry, 'id'>) => Promise<void>;
  updateEntry: (id: string, entry: Partial<DailyTimeEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
}

export const useDailyTimeEntryStore = create<DailyTimeEntryStore>((set, get) => ({
  entries: [],
  isLoading: false,
  error: null,
  lastFetchKey: null,

  fetchEntries: async ({ startDate, endDate, force = false }) => {
    if (!isAuthenticated()) return;

    const fetchKey = `${startDate}|${endDate}`;
    if (get().lastFetchKey === fetchKey && !force) return;

    set({ isLoading: true, error: null });
    try {
      const results = await dailyTimeEntriesApi.getAll({ startDate, endDate });
      set({ entries: results || [], isLoading: false, lastFetchKey: fetchKey });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al cargar el registro diario',
        isLoading: false,
      });
    }
  },

  addEntry: async (entry) => {
    try {
      const created = await dailyTimeEntriesApi.create(entry);
      set((state) => ({ entries: [...state.entries, created] }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error al crear la entrada';
      set({ error: errorMsg });
      alert(`Error al crear la entrada: ${errorMsg}`);
      throw error;
    }
  },

  updateEntry: async (id, updates) => {
    const original = get().entries;
    set((state) => ({
      entries: state.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    }));
    try {
      await dailyTimeEntriesApi.update(id, updates);
    } catch (error) {
      set({ entries: original });
      const errorMsg = error instanceof Error ? error.message : 'Error al actualizar la entrada';
      set({ error: errorMsg });
      alert(`Error al actualizar la entrada: ${errorMsg}`);
      throw error;
    }
  },

  deleteEntry: async (id) => {
    const original = get().entries;
    set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }));
    try {
      await dailyTimeEntriesApi.delete(id);
    } catch (error) {
      set({ entries: original });
      const errorMsg = error instanceof Error ? error.message : 'Error al eliminar la entrada';
      set({ error: errorMsg });
      alert(`Error al eliminar la entrada: ${errorMsg}`);
      throw error;
    }
  },
}));
