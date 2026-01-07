/**
 * PROJECT STORE
 *
 * Zustand store for managing project state globally.
 * Handles CRUD operations for projects and maintains department stage configurations.
 *
 * This is an in-memory store. For production, replace with backend API calls.
 */

import { create } from 'zustand';
import type { Project } from '../types';

/**
 * ProjectStore Interface
 * @property projects - Array of all projects
 * @property addProject - Add a new project
 * @property updateProject - Update an existing project by ID
 * @property deleteProject - Remove a project by ID
 */
interface ProjectStore {
  projects: Project[];
  addProject: (project: Project) => void;
  updateProject: (id: string, project: Partial<Project>) => void;
  deleteProject: (id: string) => void;
}

/**
 * Calculate the number of weeks between two dates
 * @param startDate - ISO format date string (YYYY-MM-DD)
 * @param endDate - ISO format date string (YYYY-MM-DD)
 * @returns Number of weeks (rounded up)
 */
const calculateWeeks = (startDate: string, endDate: string): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 7));
};

/**
 * MOCK PROJECTS
 * Sample data for development and testing
 * These will be replaced with API calls in production
 *
 * Each project includes:
 * - Basic info (name, client, dates, facility)
 * - Department stages with week ranges indicating when each department is active
 */
const mockProjects: Project[] = [
  {
    id: '1',
    name: 'Renovar Dashboard',
    client: 'ACME Corp',
    startDate: '2025-01-15',
    endDate: '2025-03-15',
    facility: 'AL',
    numberOfWeeks: calculateWeeks('2025-01-15', '2025-03-15'),
    departmentStages: {
      PM: [{ stage: null, weekStart: 3, weekEnd: 9 }],
      MED: [{ stage: null, weekStart: 3, weekEnd: 6 }],
      HD: [{ stage: null, weekStart: 3, weekEnd: 7 }],
      MFG: [{ stage: null, weekStart: 7, weekEnd: 9 }],
      BUILD: [{ stage: null, weekStart: 8, weekEnd: 9 }],
      PRG: [],
    },
  },
  {
    id: '2',
    name: 'API v2 Refactor',
    client: 'Tech Innovations',
    startDate: '2025-02-01',
    endDate: '2025-04-30',
    facility: 'MI',
    numberOfWeeks: calculateWeeks('2025-02-01', '2025-04-30'),
    departmentStages: {
      PM: [{ stage: null, weekStart: 6, weekEnd: 18 }],
      MED: [],
      HD: [{ stage: null, weekStart: 6, weekEnd: 12 }],
      MFG: [],
      BUILD: [],
      PRG: [{ stage: null, weekStart: 8, weekEnd: 16 }],
    },
  },
  {
    id: '3',
    name: 'Mobile App MVP',
    client: 'StartUp XYZ',
    startDate: '2025-01-20',
    endDate: '2025-05-20',
    facility: 'MX',
    numberOfWeeks: calculateWeeks('2025-01-20', '2025-05-20'),
    departmentStages: {
      PM: [{ stage: null, weekStart: 4, weekEnd: 22 }],
      MED: [{ stage: null, weekStart: 4, weekEnd: 8 }],
      HD: [{ stage: null, weekStart: 5, weekEnd: 14 }],
      MFG: [{ stage: null, weekStart: 15, weekEnd: 20 }],
      BUILD: [{ stage: null, weekStart: 16, weekEnd: 22 }],
      PRG: [{ stage: null, weekStart: 8, weekEnd: 20 }],
    },
  },
];

/**
 * Zustand Store Instance with localStorage Persistence
 *
 * Creates a singleton store for project state management with automatic persistence.
 * Uses lazy initialization to load projects from localStorage on first render.
 * Components access this store using the useProjectStore hook.
 *
 * Usage:
 * ```
 * const { projects, addProject, updateProject, deleteProject } = useProjectStore();
 * ```
 */
export const useProjectStore = create<ProjectStore>((set) => ({
  // Initial state: load projects from localStorage or use mock projects
  projects: (() => {
    const saved = localStorage.getItem('projects');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading projects from localStorage', e);
      }
    }
    return mockProjects;
  })(),

  // Add a new project to the store and persist to localStorage
  addProject: (project) =>
    set((state) => {
      const updatedProjects = [...state.projects, project];
      localStorage.setItem('projects', JSON.stringify(updatedProjects));
      return { projects: updatedProjects };
    }),

  // Update an existing project by ID (partial updates allowed) and persist to localStorage
  updateProject: (id, updates) =>
    set((state) => {
      const updatedProjects = state.projects.map((proj) =>
        proj.id === id ? { ...proj, ...updates } : proj
      );
      localStorage.setItem('projects', JSON.stringify(updatedProjects));
      return { projects: updatedProjects };
    }),

  // Delete a project by ID and persist to localStorage
  deleteProject: (id) =>
    set((state) => {
      const updatedProjects = state.projects.filter((proj) => proj.id !== id);
      localStorage.setItem('projects', JSON.stringify(updatedProjects));
      return { projects: updatedProjects };
    }),
}));
