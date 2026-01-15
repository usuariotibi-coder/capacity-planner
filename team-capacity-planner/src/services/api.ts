/**
 * API Service - Handles all communication with the Django REST API
 */

const API_URL = import.meta.env.VITE_API_URL || 'https://capacity-planner-production.up.railway.app';

// Token storage keys
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

// Get stored tokens
export const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_TOKEN_KEY);

// Store tokens
export const setTokens = (access: string, refresh: string) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
};

// Clear tokens (logout)
export const clearTokens = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

// Check if user is authenticated
export const isAuthenticated = () => !!getAccessToken();

// Convert snake_case to camelCase
const toCamelCase = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

// Convert camelCase to snake_case
const toSnakeCase = (str: string): string => {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
};

// Transform object keys from snake_case to camelCase
const transformKeysToCamel = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(transformKeysToCamel);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = toCamelCase(key);
      acc[camelKey] = transformKeysToCamel(obj[key]);
      return acc;
    }, {} as any);
  }
  return obj;
};

// Keys that should NOT have their nested keys transformed (they contain department codes like PM, MED, etc.)
const PRESERVE_NESTED_KEYS = ['departmentHoursAllocated', 'department_hours_allocated'];

// Transform object keys from camelCase to snake_case
const transformKeysToSnake = (obj: any, preserveNestedKeys = false): any => {
  if (Array.isArray(obj)) {
    return obj.map(item => transformKeysToSnake(item, preserveNestedKeys));
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = toSnakeCase(key);
      // Check if this key's nested values should be preserved (not transformed)
      const shouldPreserveNested = PRESERVE_NESTED_KEYS.includes(key) || PRESERVE_NESTED_KEYS.includes(snakeKey);
      if (shouldPreserveNested) {
        // Keep nested object as-is (don't transform department codes like PM, MED, etc.)
        acc[snakeKey] = obj[key];
      } else {
        acc[snakeKey] = transformKeysToSnake(obj[key], preserveNestedKeys);
      }
      return acc;
    }, {} as any);
  }
  return obj;
};

// Refresh access token
const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_URL}/api/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem(ACCESS_TOKEN_KEY, data.access);
      return data.access;
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
  }

  clearTokens();
  return null;
};

// Base fetch with authentication
const apiFetch = async (endpoint: string, options: RequestInit = {}): Promise<any> => {
  let accessToken = getAccessToken();

  const makeRequest = async (token: string | null) => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    // Debug logging
    console.log(`[API] ${options.method || 'GET'} ${endpoint}`);
    if (options.body) {
      console.log('[API] Request body:', options.body);
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    return response;
  };

  let response = await makeRequest(accessToken);

  // If unauthorized, try to refresh token
  if (response.status === 401 && accessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await makeRequest(newToken);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[API] Error ${response.status}:`, errorText);
    let errorData = {};
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { detail: errorText || `HTTP error ${response.status}` };
    }
    const errorMessage = (errorData as any).detail ||
                         Object.values(errorData).flat().join(', ') ||
                         `HTTP error ${response.status}`;
    throw new Error(errorMessage);
  }

  // Handle 204 No Content (DELETE responses)
  if (response.status === 204) {
    console.log('[API] Success: 204 No Content');
    return null;
  }

  const data = await response.json();
  console.log('[API] Response:', data);
  return transformKeysToCamel(data);
};

// Auth API
export const authApi = {
  login: async (username: string, password: string) => {
    console.log('[LOGIN] Starting login request...');
    console.log('[LOGIN] API URL:', `${API_URL}/api/token/`);
    console.log('[LOGIN] Username:', username);

    try {
      const response = await fetch(`${API_URL}/api/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      console.log('[LOGIN] Response status:', response.status);
      console.log('[LOGIN] Response ok:', response.ok);

      if (!response.ok) {
        const errorData = await response.text();
        console.log('[LOGIN] Error response:', errorData);
        throw new Error('Credenciales inválidas');
      }

      const data = await response.json();
      console.log('[LOGIN] Success! Token received');
      setTokens(data.access, data.refresh);
      return data;
    } catch (error) {
      console.error('[LOGIN] Error:', error);
      throw error;
    }
  },

  logout: () => {
    clearTokens();
  },

  register: async (data: {
    email: string;
    password: string;
    confirm_password: string;
    first_name: string;
    last_name: string;
    department: string;
  }) => {
    const response = await fetch(`${API_URL}/api/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = Object.entries(errorData)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('; ');
      throw new Error(errorMessage || 'Registration failed');
    }

    return response.json();
  },

  verifyEmail: async (token: string) => {
    const response = await fetch(`${API_URL}/api/verify-email/${token}/`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Email verification failed');
    }

    return response.json();
  },

  resendVerificationEmail: async (email: string) => {
    const response = await fetch(`${API_URL}/api/resend-verification-email/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.error || 'Failed to resend verification email';
      throw new Error(errorMessage);
    }

    return response.json();
  },

  verifyCode: async (email: string, code: string) => {
    const response = await fetch(`${API_URL}/api/verify-code/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Verification failed');
    }

    return response.json();
  },
};

// Employees API
export const employeesApi = {
  getAll: async () => {
    const data = await apiFetch('/api/employees/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/employees/${id}/`);
  },

  create: async (employee: any) => {
    return apiFetch('/api/employees/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(employee)),
    });
  },

  update: async (id: string, employee: any) => {
    return apiFetch(`/api/employees/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(employee)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/employees/${id}/`, {
      method: 'DELETE',
    });
  },
};

// Projects API
export const projectsApi = {
  getAll: async () => {
    const data = await apiFetch('/api/projects/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/projects/${id}/`);
  },

  create: async (project: any) => {
    return apiFetch('/api/projects/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(project)),
    });
  },

  update: async (id: string, project: any) => {
    return apiFetch(`/api/projects/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(project)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/projects/${id}/`, {
      method: 'DELETE',
    });
  },

  updateBudgetHours: async (id: string, budgetUpdate: { department: string; hoursUtilized?: number; hoursForecast?: number }) => {
    return apiFetch(`/api/projects/${id}/update-budget-hours/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(budgetUpdate)),
    });
  },
};

// Assignments API
export const assignmentsApi = {
  getAll: async () => {
    const data = await apiFetch('/api/assignments/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/assignments/${id}/`);
  },

  create: async (assignment: any) => {
    return apiFetch('/api/assignments/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(assignment)),
    });
  },

  update: async (id: string, assignment: any) => {
    return apiFetch(`/api/assignments/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(assignment)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/assignments/${id}/`, {
      method: 'DELETE',
    });
  },
};

// SCIO Team Capacity API
export const scioTeamCapacityApi = {
  getAll: async () => {
    const data = await apiFetch('/api/scio-team-capacity/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/scio-team-capacity/${id}/`);
  },

  create: async (capacity: any) => {
    return apiFetch('/api/scio-team-capacity/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(capacity)),
    });
  },

  update: async (id: string, capacity: any) => {
    return apiFetch(`/api/scio-team-capacity/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(capacity)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/scio-team-capacity/${id}/`, {
      method: 'DELETE',
    });
  },
};

// Subcontracted Team Capacity API
export const subcontractedTeamCapacityApi = {
  getAll: async () => {
    const data = await apiFetch('/api/subcontracted-team-capacity/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/subcontracted-team-capacity/${id}/`);
  },

  create: async (capacity: any) => {
    return apiFetch('/api/subcontracted-team-capacity/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(capacity)),
    });
  },

  update: async (id: string, capacity: any) => {
    return apiFetch(`/api/subcontracted-team-capacity/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(capacity)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/subcontracted-team-capacity/${id}/`, {
      method: 'DELETE',
    });
  },
};

// PRG External Team Capacity API
export const prgExternalTeamCapacityApi = {
  getAll: async () => {
    const data = await apiFetch('/api/prg-external-team-capacity/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/prg-external-team-capacity/${id}/`);
  },

  create: async (capacity: any) => {
    return apiFetch('/api/prg-external-team-capacity/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(capacity)),
    });
  },

  update: async (id: string, capacity: any) => {
    return apiFetch(`/api/prg-external-team-capacity/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(capacity)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/prg-external-team-capacity/${id}/`, {
      method: 'DELETE',
    });
  },
};

// Department Weekly Total API
export const departmentWeeklyTotalApi = {
  getAll: async () => {
    const data = await apiFetch('/api/department-weekly-total/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/department-weekly-total/${id}/`);
  },

  create: async (total: any) => {
    return apiFetch('/api/department-weekly-total/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(total)),
    });
  },

  update: async (id: string, total: any) => {
    return apiFetch(`/api/department-weekly-total/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(total)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/department-weekly-total/${id}/`, {
      method: 'DELETE',
    });
  },
};

// Project Budget API
export const projectBudgetsApi = {
  getAll: async () => {
    const data = await apiFetch('/api/project-budgets/');
    return data.results || data;
  },

  get: async (id: string) => {
    return apiFetch(`/api/project-budgets/${id}/`);
  },

  create: async (budget: any) => {
    return apiFetch('/api/project-budgets/', {
      method: 'POST',
      body: JSON.stringify(transformKeysToSnake(budget)),
    });
  },

  update: async (id: string, budget: any) => {
    return apiFetch(`/api/project-budgets/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(transformKeysToSnake(budget)),
    });
  },

  delete: async (id: string) => {
    return apiFetch(`/api/project-budgets/${id}/`, {
      method: 'DELETE',
    });
  },
};

// Activity Log API
export const activityLogApi = {
  getAll: async () => {
    const data = await apiFetch('/api/activity-logs/');
    return data.results || data;
  },

  logActivity: async (action: string, modelName: string, objectId: string, changes?: any) => {
    try {
      await apiFetch('/api/activity-logs/', {
        method: 'POST',
        body: JSON.stringify({
          action,
          model_name: modelName,
          object_id: objectId,
          changes: changes || null,
        }),
      });
    } catch (error) {
      // Log errors silently to avoid disrupting user actions
      console.warn('[ActivityLog] Failed to log activity:', error);
    }
  },
};
