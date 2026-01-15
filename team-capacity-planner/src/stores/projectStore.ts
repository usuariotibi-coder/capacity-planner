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
  fetchProjects: (force?: boolean) => Promise<void>;
  addProject: (project: Project) => Promise<Project>;
  updateProject: (id: string, project: Partial<Project>) => void;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  isLoading: false,
  error: null,
  hasFetched: false,

  fetchProjects: async (force = false) => {
    if (!isAuthenticated()) return;

    // Skip if already fetched unless force refresh is requested
    if (get().hasFetched && !force) {
      console.log('[ProjectStore] Skipping fetch - already fetched and force=false');
      return;
    }

    console.log('[ProjectStore] Starting fetch projects (force=' + force + ')');
    set({ isLoading: true, error: null });
    try {
      const data = await projectsApi.getAll();
      console.log('[ProjectStore] Fetched projects:', {
        count: data?.length,
        hasData: !!data,
        firstProjectName: data?.[0]?.name,
        firstProjectHasQuoted: data?.[0]?.departmentHoursAllocated ? 'YES' : 'NO',
        firstProjectQuoted: data?.[0]?.departmentHoursAllocated
      });

      // Create a new array reference to ensure React detects the change
      const newProjects = Array.isArray(data) ? [...data] : data;
      set({ projects: newProjects, isLoading: false, hasFetched: true });
      console.log('[ProjectStore] Projects state updated successfully with new reference');
    } catch (error) {
      console.error('[ProjectStore] Error fetching projects:', error);
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

      // Refetch projects to ensure UI is in sync with backend
      console.log('[Store] Refetching projects after update...');
      await get().fetchProjects(true);
      console.log('[Store] Projects refetched successfully');
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
