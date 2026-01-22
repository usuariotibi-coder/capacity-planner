import { create } from 'zustand';
import type { Employee } from '../types';
import { employeesApi, isAuthenticated, activityLogApi } from '../services/api';
import { getChangedFields } from '../utils/activityLog';

interface EmployeeStore {
  employees: Employee[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchEmployees: () => Promise<void>;
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>;
  updateEmployee: (id: string, employee: Partial<Employee>) => void;
  deleteEmployee: (id: string) => Promise<void>;
}

export const useEmployeeStore = create<EmployeeStore>((set, get) => ({
  employees: [],
  isLoading: false,
  error: null,
  hasFetched: false,

  fetchEmployees: async () => {
    if (!isAuthenticated()) return;
    if (get().hasFetched) return; // Already fetched

    set({ isLoading: true, error: null });
    try {
      const data = await employeesApi.getAll();
      set({ employees: data, isLoading: false, hasFetched: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al cargar empleados',
        isLoading: false
      });
    }
  },

  addEmployee: async (employee) => {
    try {
      console.log('[Store] Creating employee:', employee);
      const newEmployee = await employeesApi.create(employee);
      console.log('[Store] Employee created:', newEmployee);
      set((state) => ({ employees: [...state.employees, newEmployee] }));

      // Log activity
      await activityLogApi.logActivity(
        'CREATE',
        'Employee',
        newEmployee.id,
        employee
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error al crear empleado';
      console.error('[Store] Error creating employee:', errorMsg);
      set({ error: errorMsg });
      alert(`Error al crear empleado: ${errorMsg}`);
      throw error;
    }
  },

  updateEmployee: async (id, updates) => {
    const originalEmployees = get().employees;
    const originalEmployee = originalEmployees.find((emp) => emp.id === id);
    const changedUpdates = getChangedFields(originalEmployee, updates);

    // Optimistic update
    set((state) => ({
      employees: state.employees.map((emp) =>
        emp.id === id ? { ...emp, ...updates } : emp
      ),
    }));

    try {
      console.log('[Store] Updating employee:', id, updates);
      await employeesApi.update(id, updates);
      console.log('[Store] Employee updated successfully');

      // Log activity
      if (Object.keys(changedUpdates).length > 0) {
        await activityLogApi.logActivity(
          'UPDATE',
          'Employee',
          id,
          { updates: changedUpdates }
        );
      }
    } catch (error) {
      // Revert on error
      const errorMsg = error instanceof Error ? error.message : 'Error al actualizar empleado';
      console.error('[Store] Error updating employee:', errorMsg);
      set({ employees: originalEmployees });
      set({ error: errorMsg });
      alert(`Error al actualizar empleado: ${errorMsg}`);
    }
  },

  deleteEmployee: async (id) => {
    const originalEmployees = get().employees;

    // Optimistic update
    set((state) => ({
      employees: state.employees.filter((emp) => emp.id !== id),
    }));

    try {
      console.log('[Store] Deleting employee:', id);
      await employeesApi.delete(id);
      console.log('[Store] Employee deleted successfully');

      // Log activity
      await activityLogApi.logActivity(
        'DELETE',
        'Employee',
        id
      );
    } catch (error) {
      // Revert on error
      const errorMsg = error instanceof Error ? error.message : 'Error al eliminar empleado';
      console.error('[Store] Error deleting employee:', errorMsg);
      set({ employees: originalEmployees });
      set({ error: errorMsg });
      alert(`Error al eliminar empleado: ${errorMsg}`);
      throw error;
    }
  },
}));
