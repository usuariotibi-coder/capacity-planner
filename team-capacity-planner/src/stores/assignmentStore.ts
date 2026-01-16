import { create } from 'zustand';
import type { Assignment } from '../types';
import { assignmentsApi, isAuthenticated, activityLogApi } from '../services/api';

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
      console.log('[Store] Creating assignment:', assignment);
      const newAssignment = await assignmentsApi.create(assignment);
      console.log('[Store] Assignment created:', newAssignment);
      set((state) => ({ assignments: [...state.assignments, newAssignment] }));

      // Log activity
      await activityLogApi.logActivity(
        'created',
        'Assignment',
        newAssignment.id,
        { assignment: newAssignment }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error al crear asignación';
      console.error('[Store] Error creating assignment:', errorMsg);
      set({ error: errorMsg });
      alert(`Error al crear asignación: ${errorMsg}`);
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
      console.log('[Store] Updating assignment:', id, updates);
      await assignmentsApi.update(id, updates);
      console.log('[Store] Assignment updated successfully');

      // Log activity
      await activityLogApi.logActivity(
        'updated',
        'Assignment',
        id,
        { updates }
      );

      // Refetch assignments to ensure UI is in sync with backend
      console.log('[Store] Refetching assignments after update...');
      await get().fetchAssignments();
      console.log('[Store] Assignments refetched successfully');
    } catch (error) {
      // Revert on error
      const errorMsg = error instanceof Error ? error.message : 'Error al actualizar asignación';
      console.error('[Store] Error updating assignment:', errorMsg);
      set({ assignments: originalAssignments });
      set({ error: errorMsg });
      alert(`Error al actualizar asignación: ${errorMsg}`);
    }
  },

  deleteAssignment: async (id) => {
    const originalAssignments = get().assignments;
    const deletedAssignment = originalAssignments.find((a) => a.id === id);

    set((state) => ({
      assignments: state.assignments.filter((assign) => assign.id !== id),
    }));

    try {
      console.log('[Store] Deleting assignment:', id);
      await assignmentsApi.delete(id);
      console.log('[Store] Assignment deleted successfully');

      // Log activity
      await activityLogApi.logActivity(
        'deleted',
        'Assignment',
        id,
        { assignment: deletedAssignment }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error al eliminar asignación';
      console.error('[Store] Error deleting assignment:', errorMsg);
      set({ assignments: originalAssignments });
      set({ error: errorMsg });
      alert(`Error al eliminar asignación: ${errorMsg}`);
      throw error;
    }
  },

  getAssignmentsByEmployee: (employeeId) =>
    get().assignments.filter((assign) => assign.employeeId === employeeId),

  getAssignmentsByWeek: (weekStartDate) =>
    get().assignments.filter((assign) => assign.weekStartDate === weekStartDate),
}));
