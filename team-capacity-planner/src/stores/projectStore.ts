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
      console.log('[Store] Creating project:', projectData);
      const newProject = await projectsApi.create(projectData);
      console.log('[Store] Project created:', newProject);
      set((state) => ({ projects: [...state.projects, newProject] }));
      return newProject;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error al crear proyecto';
      console.error('[Store] Error creating project:', errorMsg);
      set({ error: errorMsg });
      alert(`Error al crear proyecto: ${errorMsg}`);
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
      console.log('[Store] Updating project:', id, updates);
      await projectsApi.update(id, updates);
      console.log('[Store] Project updated successfully');
    } catch (error) {
      // Revert on error
      const errorMsg = error instanceof Error ? error.message : 'Error al actualizar proyecto';
      console.error('[Store] Error updating project:', errorMsg);
      set({ projects: originalProjects });
      set({ error: errorMsg });
      alert(`Error al actualizar proyecto: ${errorMsg}`);
    }
  },

  deleteProject: async (id) => {
    const originalProjects = get().projects;
    const projectToDelete = originalProjects.find(p => p.id === id);

    console.log('[Store] Starting delete for project:', id, projectToDelete?.name);

    // Optimistic update - remove from UI immediately
    set((state) => ({
      projects: state.projects.filter((proj) => proj.id !== id),
    }));

    try {
      console.log('[Store] Sending DELETE request to API for project:', id);
      await projectsApi.delete(id);
      console.log('[Store] ✅ Project deleted successfully from server:', id);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error al eliminar proyecto';
      console.error('[Store] ❌ Error deleting project:', errorMsg);
      console.error('[Store] Reverting optimistic update...');
      set({ projects: originalProjects });
      set({ error: errorMsg });
      alert(`Error al eliminar proyecto: ${errorMsg}`);
      throw error;
    }
  },
}));
