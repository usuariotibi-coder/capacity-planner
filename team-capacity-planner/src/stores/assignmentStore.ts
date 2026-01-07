import { create } from 'zustand';
import type { Assignment } from '../types';
import { assignmentsApi, isAuthenticated } from '../services/api';

interface AssignmentStore {
  assignments: Assignment[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchAssignments: () => Promise<void>;
  addAssignment: (assignment: Omit<Assignment, 'id'>) => Promise<void>;
  updateAssignment: (id: string, assignment: Partial<Assignment>) => void;
  deleteAssignment: (id: string) => Promise<void>;
  getAssignmentsByEmployee: (employeeId: string) => Assignment[];
  getAssignmentsByWeek: (weekStartDate: string) => Assignment[];
}

export const useAssignmentStore = create<AssignmentStore>((set, get) => ({
  assignments: [],
  isLoading: false,
  error: null,
  hasFetched: false,

  fetchAssignments: async () => {
    if (!isAuthenticated()) return;
    if (get().hasFetched) return;

    set({ isLoading: true, error: null });
    try {
      const data = await assignmentsApi.getAll();
      set({ assignments: data, isLoading: false, hasFetched: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al cargar asignaciones',
        isLoading: false
      });
    }
  },

  addAssignment: async (assignment) => {
    try {
      const newAssignment = await assignmentsApi.create(assignment);
      set((state) => ({ assignments: [...state.assignments, newAssignment] }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Error al crear asignación' });
      throw error;
    }
  },

  updateAssignment: async (id, updates) => {
    const originalAssignments = get().assignments;

    // Optimistic update
    set((state) => ({
      assignments: state.assignments.map((assign) =>
        assign.id === id ? { ...assign, ...updates } : assign
      ),
    }));

    try {
      await assignmentsApi.update(id, updates);
    } catch (error) {
      // Revert on error
      set({ assignments: originalAssignments });
      set({ error: error instanceof Error ? error.message : 'Error al actualizar asignación' });
    }
  },

  deleteAssignment: async (id) => {
    const originalAssignments = get().assignments;

    set((state) => ({
      assignments: state.assignments.filter((assign) => assign.id !== id),
    }));

    try {
      await assignmentsApi.delete(id);
    } catch (error) {
      set({ assignments: originalAssignments });
      set({ error: error instanceof Error ? error.message : 'Error al eliminar asignación' });
      throw error;
    }
  },

  getAssignmentsByEmployee: (employeeId) =>
    get().assignments.filter((assign) => assign.employeeId === employeeId),

  getAssignmentsByWeek: (weekStartDate) =>
    get().assignments.filter((assign) => assign.weekStartDate === weekStartDate),
}));
