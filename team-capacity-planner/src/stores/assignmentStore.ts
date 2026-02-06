import { create } from 'zustand';
import type { Assignment } from '../types';
import { assignmentsApi, isAuthenticated, activityLogApi } from '../services/api';
import { normalizeWeekStartDate } from '../utils/dateUtils';
import { getChangedFields } from '../utils/activityLog';

type FetchAssignmentsOptions = {
  force?: boolean;
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  /**
   * When true, missing params are taken from the last successful fetch.
   * This keeps legacy calls like fetchAssignments(true) working as "force refresh".
   */
  reuseLastParams?: boolean;
};

type UpdateAssignmentOptions = {
  skipRefetch?: boolean;
};

interface AssignmentStore {
  assignments: Assignment[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  lastFetchKey: string | null;
  lastFetchParams: Omit<FetchAssignmentsOptions, 'force' | 'reuseLastParams'> | null;
  fetchRequestId: number;
  mutationVersion: number;
  fetchAssignments: (options?: boolean | FetchAssignmentsOptions) => Promise<void>;
  addAssignment: (assignment: Omit<Assignment, 'id'>) => Promise<void>;
  updateAssignment: (id: string, assignment: Partial<Assignment>, options?: UpdateAssignmentOptions) => Promise<void>;
  deleteAssignment: (id: string) => Promise<void>;
  removeAssignmentsByProject: (projectId: string) => void;
  getAssignmentsByEmployee: (employeeId: string) => Assignment[];
  getAssignmentsByWeek: (weekStartDate: string) => Assignment[];
}

export const useAssignmentStore = create<AssignmentStore>((set, get) => ({
  assignments: [],
  isLoading: false,
  error: null,
  hasFetched: false,
  lastFetchKey: null,
  lastFetchParams: null,
  fetchRequestId: 0,
  mutationVersion: 0,

  fetchAssignments: async (options = false) => {
    const normalizedOptions: FetchAssignmentsOptions = typeof options === 'boolean'
      ? { force: options, reuseLastParams: true }
      : options;

    const { force = false, reuseLastParams = false } = normalizedOptions;
    let { startDate, endDate, pageSize } = normalizedOptions;

    if (!isAuthenticated()) return;

    if (reuseLastParams) {
      const last = get().lastFetchParams;
      startDate = startDate ?? last?.startDate;
      endDate = endDate ?? last?.endDate;
      pageSize = pageSize ?? last?.pageSize;
    }

    // Bigger pages reduce the number of rerenders/network roundtrips on the Capacity Matrix.
    const effectivePageSize = pageSize ?? 500;
    const fetchKey = JSON.stringify({
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      pageSize: effectivePageSize,
    });

    if (get().lastFetchKey === fetchKey && !force) {
      return;
    }

    const prevState = get();
    const shouldClear = prevState.lastFetchKey !== fetchKey;
    const requestId = prevState.fetchRequestId + 1;
    set({
      // Avoid flicker when we are just force-refreshing the same range (e.g. after an edit).
      // When the range changes (year switch), we clear so the UI doesn't show wrong data.
      assignments: shouldClear ? [] : prevState.assignments,
      isLoading: true,
      error: null,
      hasFetched: shouldClear ? false : prevState.hasFetched,
      fetchRequestId: requestId,
      lastFetchKey: fetchKey,
      lastFetchParams: { startDate, endDate, pageSize: effectivePageSize },
    });

    try {
      let aggregated: Assignment[] = [];
      const results = await assignmentsApi.getAll({
        startDate,
        endDate,
        pageSize: effectivePageSize,
        onPage: shouldClear ? (page) => {
          if (get().fetchRequestId !== requestId) return;

          const normalizedPage = page.map((assignment) => ({
            ...assignment,
            weekStartDate: normalizeWeekStartDate(assignment.weekStartDate),
          }));

          aggregated = aggregated.concat(normalizedPage);
          set({ assignments: aggregated });
        } : undefined,
      });

      if (get().fetchRequestId !== requestId) return;
      // Normalize again from the full result set in case we didn't stream pages.
      const normalizedAll = (results || []).map((assignment) => ({
        ...assignment,
        weekStartDate: normalizeWeekStartDate(assignment.weekStartDate),
      }));
      set({ assignments: normalizedAll, isLoading: false, hasFetched: true });
    } catch (error) {
      if (get().fetchRequestId !== requestId) return;
      set({
        error: error instanceof Error ? error.message : 'Error al cargar asignaciones',
        isLoading: false
      });
    }
  },

  addAssignment: async (assignment) => {
    try {
      const normalizedAssignment = {
        ...assignment,
        weekStartDate: normalizeWeekStartDate(assignment.weekStartDate),
      };
      console.log('[Store] Creating assignment:', normalizedAssignment);
      const newAssignment = await assignmentsApi.create(normalizedAssignment);
      console.log('[Store] Assignment created:', newAssignment);
      set((state) => ({
        assignments: [
          ...state.assignments,
          { ...newAssignment, weekStartDate: normalizeWeekStartDate(newAssignment.weekStartDate) },
        ],
        mutationVersion: state.mutationVersion + 1,
      }));

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

  updateAssignment: async (id, updates, options = {}) => {
    const { skipRefetch = false } = options;
    const originalAssignments = get().assignments;
    const originalAssignment = originalAssignments.find((assign) => assign.id === id);
    const normalizedUpdates = updates.weekStartDate
      ? { ...updates, weekStartDate: normalizeWeekStartDate(updates.weekStartDate) }
      : updates;
    const changedUpdates = getChangedFields(originalAssignment, normalizedUpdates);

    // Optimistic update
    set((state) => ({
      assignments: state.assignments.map((assign) =>
        assign.id === id ? { ...assign, ...normalizedUpdates } : assign
      ),
    }));

    try {
      console.log('[Store] Updating assignment:', id, normalizedUpdates);
      await assignmentsApi.update(id, normalizedUpdates);
      console.log('[Store] Assignment updated successfully');
      set((state) => ({ mutationVersion: state.mutationVersion + 1 }));

      // Log activity
      if (Object.keys(changedUpdates).length > 0) {
        await activityLogApi.logActivity(
          'updated',
          'Assignment',
          id,
          { updates: changedUpdates }
        );
      }

      if (!skipRefetch) {
        // Refetch assignments to ensure UI is in sync with backend
        console.log('[Store] Refetching assignments after update...');
        await get().fetchAssignments(true);
        console.log('[Store] Assignments refetched successfully');
      }
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
      set((state) => ({ mutationVersion: state.mutationVersion + 1 }));

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

  removeAssignmentsByProject: (projectId) =>
    set((state) => ({
      assignments: state.assignments.filter((assign) => assign.projectId !== projectId),
    })),

  getAssignmentsByEmployee: (employeeId) =>
    get().assignments.filter((assign) => assign.employeeId === employeeId),

  getAssignmentsByWeek: (weekStartDate) =>
    get().assignments.filter((assign) => assign.weekStartDate === weekStartDate),
}));
