import { create } from 'zustand';
import type { Assignment } from '../types';

interface AssignmentStore {
  assignments: Assignment[];
  addAssignment: (assignment: Assignment) => void;
  updateAssignment: (id: string, assignment: Partial<Assignment>) => void;
  deleteAssignment: (id: string) => void;
  getAssignmentsByEmployee: (employeeId: string) => Assignment[];
  getAssignmentsByWeek: (weekStartDate: string) => Assignment[];
}

const mockAssignments: Assignment[] = [
  {
    id: '1',
    employeeId: '1',
    projectId: '1',
    weekStartDate: '2025-01-15',
    hours: 20,
    stage: 'SWITCH_LAYOUT_REVISION',
  },
  {
    id: '2',
    employeeId: '1',
    projectId: '2',
    weekStartDate: '2025-01-15',
    hours: 15,
    stage: 'CONTROLS_DESIGN',
  },
  {
    id: '3',
    employeeId: '3',
    projectId: '1',
    weekStartDate: '2025-01-15',
    hours: 30,
    stage: 'CONCEPT',
  },
  {
    id: '4',
    employeeId: '3',
    projectId: '3',
    weekStartDate: '2025-01-15',
    hours: 10,
    stage: 'DETAIL_DESIGN',
  },
  {
    id: '5',
    employeeId: '1',
    projectId: '1',
    weekStartDate: '2025-01-22',
    hours: 35,
    stage: 'RELEASE',
  },
  {
    id: '6',
    employeeId: '5',
    projectId: '2',
    weekStartDate: '2025-01-22',
    hours: 20,
    stage: 'ONLINE',
  },
];

export const useAssignmentStore = create<AssignmentStore>((set, get) => ({
  // Initial state: load assignments from localStorage or use mock assignments
  assignments: (() => {
    const saved = localStorage.getItem('assignments');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading assignments from localStorage', e);
      }
    }
    return mockAssignments;
  })(),

  // Add a new assignment and persist to localStorage
  addAssignment: (assignment) =>
    set((state) => {
      const updatedAssignments = [...state.assignments, assignment];
      localStorage.setItem('assignments', JSON.stringify(updatedAssignments));
      return { assignments: updatedAssignments };
    }),

  // Update an existing assignment and persist to localStorage
  updateAssignment: (id, updates) =>
    set((state) => {
      const updatedAssignments = state.assignments.map((assign) =>
        assign.id === id ? { ...assign, ...updates } : assign
      );
      localStorage.setItem('assignments', JSON.stringify(updatedAssignments));
      return { assignments: updatedAssignments };
    }),

  // Delete an assignment and persist to localStorage
  deleteAssignment: (id) =>
    set((state) => {
      const updatedAssignments = state.assignments.filter((assign) => assign.id !== id);
      localStorage.setItem('assignments', JSON.stringify(updatedAssignments));
      return { assignments: updatedAssignments };
    }),

  // Get assignments by employee
  getAssignmentsByEmployee: (employeeId) =>
    get().assignments.filter((assign) => assign.employeeId === employeeId),

  // Get assignments by week
  getAssignmentsByWeek: (weekStartDate) =>
    get().assignments.filter((assign) => assign.weekStartDate === weekStartDate),
}));
