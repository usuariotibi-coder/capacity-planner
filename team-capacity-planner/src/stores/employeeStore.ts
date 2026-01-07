import { create } from 'zustand';
import type { Employee } from '../types';
import { employeesApi, isAuthenticated } from '../services/api';

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
      const newEmployee = await employeesApi.create(employee);
      set((state) => ({ employees: [...state.employees, newEmployee] }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Error al crear empleado' });
      throw error;
    }
  },

  updateEmployee: async (id, updates) => {
    const originalEmployees = get().employees;

    // Optimistic update
    set((state) => ({
      employees: state.employees.map((emp) =>
        emp.id === id ? { ...emp, ...updates } : emp
      ),
    }));

    try {
      await employeesApi.update(id, updates);
    } catch (error) {
      // Revert on error
      set({ employees: originalEmployees });
      set({ error: error instanceof Error ? error.message : 'Error al actualizar empleado' });
    }
  },

  deleteEmployee: async (id) => {
    const originalEmployees = get().employees;

    // Optimistic update
    set((state) => ({
      employees: state.employees.filter((emp) => emp.id !== id),
    }));

    try {
      await employeesApi.delete(id);
    } catch (error) {
      // Revert on error
      set({ employees: originalEmployees });
      set({ error: error instanceof Error ? error.message : 'Error al eliminar empleado' });
      throw error;
    }
  },
}));
