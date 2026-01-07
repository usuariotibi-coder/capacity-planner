/**
 * PROJECT STORE
 *
 * Zustand store for managing project state globally.
 * Handles CRUD operations for projects via the Django REST API.
 */

import { create } from 'zustand';
import type { Project } from '../types';
import { projectsApi, isAuthenticated } from '../services/api';

interface ProjectStore {
  projects: Project[];
  isLoading: boolean;
  error: string | null;
  hasFetched: boolean;
  fetchProjects: () => Promise<void>;
  addProject: (project: Project) => Promise<Project>;
  updateProject: (id: string, project: Partial<Project>) => void;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  isLoading: false,
  error: null,
  hasFetched: false,

  fetchProjects: async () => {
    if (!isAuthenticated()) return;
    if (get().hasFetched) return;

    set({ isLoading: true, error: null });
    try {
      const data = await projectsApi.getAll();
      set({ projects: data, isLoading: false, hasFetched: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Error al cargar proyectos',
        isLoading: false
      });
    }
  },

  addProject: async (project) => {
    try {
      // Remove local id, API will generate one
      const { id: _localId, ...projectData } = project;
      const newProject = await projectsApi.create(projectData);
      set((state) => ({ projects: [...state.projects, newProject] }));
      return newProject;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Error al crear proyecto' });
      throw error;
    }
  },

  updateProject: async (id, updates) => {
    const originalProjects = get().projects;

    // Optimistic update
    set((state) => ({
      projects: state.projects.map((proj) =>
        proj.id === id ? { ...proj, ...updates } : proj
      ),
    }));

    try {
      await projectsApi.update(id, updates);
    } catch (error) {
      // Revert on error
      set({ projects: originalProjects });
      set({ error: error instanceof Error ? error.message : 'Error al actualizar proyecto' });
    }
  },

  deleteProject: async (id) => {
    const originalProjects = get().projects;

    set((state) => ({
      projects: state.projects.filter((proj) => proj.id !== id),
    }));

    try {
      await projectsApi.delete(id);
    } catch (error) {
      set({ projects: originalProjects });
      set({ error: error instanceof Error ? error.message : 'Error al eliminar proyecto' });
      throw error;
    }
  },
}));
