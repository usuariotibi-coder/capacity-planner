import { create } from 'zustand';
import type { Employee } from '../types';

interface EmployeeStore {
  employees: Employee[];
  addEmployee: (employee: Employee) => void;
  updateEmployee: (id: string, employee: Partial<Employee>) => void;
  deleteEmployee: (id: string) => void;
}

const mockEmployees: Employee[] = [
  // HD Department
  {
    id: '1',
    name: 'María García',
    role: 'Design Engineer',
    department: 'HD',
    capacity: 40,
    isActive: true,
  },
  {
    id: '2',
    name: 'José Manuel',
    role: 'Senior Designer',
    department: 'HD',
    capacity: 40,
    isActive: true,
  },
  // MED Department
  {
    id: '3',
    name: 'Laura Pérez',
    role: 'Mechanical Engineer',
    department: 'MED',
    capacity: 40,
    isActive: true,
  },
  {
    id: '4',
    name: 'Fernando Ruiz',
    role: 'Design Specialist',
    department: 'MED',
    capacity: 40,
    isActive: true,
  },
  // PRG Department
  {
    id: '5',
    name: 'Carlos López',
    role: 'Programmer',
    department: 'PRG',
    capacity: 40,
    isActive: true,
  },
  {
    id: '6',
    name: 'Ana Rodríguez',
    role: 'Senior Programmer',
    department: 'PRG',
    capacity: 40,
    isActive: true,
  },
  // PM Department
  {
    id: '7',
    name: 'Roberto García',
    role: 'Project Manager',
    department: 'PM',
    capacity: 35,
    isActive: true,
  },
  // MFG Department
  {
    id: '8',
    name: 'Patricia Martínez',
    role: 'Manufacturing Engineer',
    department: 'MFG',
    capacity: 40,
    isActive: true,
  },
  // BUILD Department
  {
    id: '9',
    name: 'Miguel Sánchez',
    role: 'Build Engineer',
    department: 'BUILD',
    capacity: 40,
    isActive: true,
  },
];

export const useEmployeeStore = create<EmployeeStore>((set) => ({
  // Initial state: load employees from localStorage or use mock employees
  employees: (() => {
    const saved = localStorage.getItem('employees');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading employees from localStorage', e);
      }
    }
    return mockEmployees;
  })(),

  // Add a new employee and persist to localStorage
  addEmployee: (employee) =>
    set((state) => {
      const updatedEmployees = [...state.employees, employee];
      localStorage.setItem('employees', JSON.stringify(updatedEmployees));
      return { employees: updatedEmployees };
    }),

  // Update an existing employee and persist to localStorage
  updateEmployee: (id, updates) =>
    set((state) => {
      const updatedEmployees = state.employees.map((emp) =>
        emp.id === id ? { ...emp, ...updates } : emp
      );
      localStorage.setItem('employees', JSON.stringify(updatedEmployees));
      return { employees: updatedEmployees };
    }),

  // Delete an employee and persist to localStorage
  deleteEmployee: (id) =>
    set((state) => {
      const updatedEmployees = state.employees.filter((emp) => emp.id !== id);
      localStorage.setItem('employees', JSON.stringify(updatedEmployees));
      return { employees: updatedEmployees };
    }),
}));
