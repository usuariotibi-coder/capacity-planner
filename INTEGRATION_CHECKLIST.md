# Frontend-Backend Integration Checklist

Complete checklist for integrating the frontend with the new Django REST API backend.

## 📋 Pre-Integration Setup

### Backend Setup (Completed)
- ✅ Django project created with production settings
- ✅ PostgreSQL database models defined
- ✅ REST API endpoints implemented
- ✅ JWT authentication configured
- ✅ Docker and Railway deployment ready
- ✅ Comprehensive documentation provided
- ✅ Test data available (run_local.bat or run_local.sh)

### Frontend Preparation
- [ ] Review [backend/BACKEND_SUMMARY.md](./backend/BACKEND_SUMMARY.md)
- [ ] Review [backend/API_DOCUMENTATION.md](./backend/API_DOCUMENTATION.md)
- [ ] Understand JWT authentication flow
- [ ] Plan API integration strategy

## 🔧 Configuration

### Step 1: Create API Configuration

Create or update `team-capacity-planner/src/config/api.ts`:

```typescript
// Local development
export const API_BASE_URL = 'http://localhost:8000/api';
export const API_TOKEN_ENDPOINT = 'http://localhost:8000/api/token';

// Or production (after Railway deployment)
// export const API_BASE_URL = 'https://your-app.railway.app/api';
// export const API_TOKEN_ENDPOINT = 'https://your-app.railway.app/api/token';

export const API_ENDPOINTS = {
  // Authentication
  TOKEN: `${API_TOKEN_ENDPOINT}/`,
  TOKEN_REFRESH: `${API_TOKEN_ENDPOINT}refresh/`,

  // Resources
  EMPLOYEES: `${API_BASE_URL}/employees`,
  PROJECTS: `${API_BASE_URL}/projects`,
  ASSIGNMENTS: `${API_BASE_URL}/assignments`,
  DEPARTMENT_STAGES: `${API_BASE_URL}/department-stages`,
  PROJECT_BUDGETS: `${API_BASE_URL}/project-budgets`,
  ACTIVITY_LOGS: `${API_BASE_URL}/activity-logs`,

  // Custom actions
  EMPLOYEE_CAPACITY_SUMMARY: (id: string) => `${API_BASE_URL}/employees/${id}/capacity-summary/`,
  EMPLOYEE_WORKLOAD: (id: string) => `${API_BASE_URL}/employees/${id}/workload/`,
  PROJECT_STATISTICS: (id: string) => `${API_BASE_URL}/projects/${id}/statistics/`,
  PROJECT_BUDGET_REPORT: (id: string) => `${API_BASE_URL}/projects/${id}/budget-report/`,
  ASSIGNMENTS_BY_WEEK: `${API_BASE_URL}/assignments/by-week/`,
  CAPACITY_BY_DEPT: `${API_BASE_URL}/assignments/capacity-by-dept/`,
};
```

### Step 2: Create API Service Layer

Create `team-capacity-planner/src/services/api.ts`:

```typescript
import { API_ENDPOINTS } from '../config/api';

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  token?: string;
}

class ApiService {
  private baseUrl = API_ENDPOINTS.API_BASE_URL;

  async request<T>(
    endpoint: string,
    options: ApiRequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      headers = {},
      body,
      token,
    } = options;

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Authentication
  async login(username: string, password: string) {
    return this.request<{ access: string; refresh: string }>(
      API_ENDPOINTS.TOKEN,
      {
        method: 'POST',
        body: { username, password },
      }
    );
  }

  async refreshToken(refreshToken: string) {
    return this.request<{ access: string }>(
      API_ENDPOINTS.TOKEN_REFRESH,
      {
        method: 'POST',
        body: { refresh: refreshToken },
      }
    );
  }

  // Generic CRUD
  async getList<T>(
    endpoint: string,
    token: string,
    params?: Record<string, string>
  ): Promise<{ results: T[]; count: number; next?: string; previous?: string }> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }
    return this.request(url.toString(), { token });
  }

  async getDetail<T>(endpoint: string, id: string, token: string): Promise<T> {
    return this.request(`${endpoint}/${id}/`, { token });
  }

  async create<T>(endpoint: string, data: any, token: string): Promise<T> {
    return this.request(endpoint, {
      method: 'POST',
      body: data,
      token,
    });
  }

  async update<T>(endpoint: string, id: string, data: any, token: string): Promise<T> {
    return this.request(`${endpoint}/${id}/`, {
      method: 'PUT',
      body: data,
      token,
    });
  }

  async delete(endpoint: string, id: string, token: string): Promise<void> {
    return this.request(`${endpoint}/${id}/`, {
      method: 'DELETE',
      token,
    });
  }

  // Resource-specific methods
  async getEmployees(token: string, params?: Record<string, string>) {
    return this.getList(API_ENDPOINTS.EMPLOYEES, token, params);
  }

  async getProjects(token: string, params?: Record<string, string>) {
    return this.getList(API_ENDPOINTS.PROJECTS, token, params);
  }

  async getAssignments(token: string, params?: Record<string, string>) {
    return this.getList(API_ENDPOINTS.ASSIGNMENTS, token, params);
  }

  async getAssignmentsByWeek(weekStartDate: string, token: string) {
    return this.getList(API_ENDPOINTS.ASSIGNMENTS, token, {
      week_start_date: weekStartDate,
    });
  }

  async getCapacityByDept(token: string) {
    return this.request(API_ENDPOINTS.CAPACITY_BY_DEPT, { token });
  }
}

export const apiService = new ApiService();
```

## 🔐 Authentication

### Step 3: Create Auth Store

Replace or update `team-capacity-planner/src/stores/authStore.ts`:

```typescript
import { create } from 'zustand';
import { apiService } from '../services/api';

interface AuthStore {
  token: string | null;
  refreshToken: string | null;
  user: any | null;
  isLoading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: localStorage.getItem('access_token') || null,
  refreshToken: localStorage.getItem('refresh_token') || null,
  user: null,
  isLoading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiService.login(username, password);
      localStorage.setItem('access_token', response.access);
      localStorage.setItem('refresh_token', response.refresh);
      set({
        token: response.access,
        refreshToken: response.refresh,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({
      token: null,
      refreshToken: null,
      user: null,
    });
  },

  refreshAccessToken: async () => {
    const { refreshToken } = get();
    if (!refreshToken) return;

    try {
      const response = await apiService.refreshToken(refreshToken);
      localStorage.setItem('access_token', response.access);
      set({ token: response.access });
    } catch (error) {
      get().logout();
      throw error;
    }
  },

  isAuthenticated: () => !!get().token,
}));
```

## 📊 Store Migration

### Step 4: Migrate Employee Store

Replace `team-capacity-planner/src/stores/employeeStore.ts`:

```typescript
import { create } from 'zustand';
import type { Employee } from '../types';
import { apiService } from '../services/api';
import { useAuthStore } from './authStore';

interface EmployeeStore {
  employees: Employee[];
  isLoading: boolean;
  error: string | null;

  fetchEmployees: () => Promise<void>;
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<Employee>;
  updateEmployee: (id: string, updates: Partial<Employee>) => Promise<Employee>;
  deleteEmployee: (id: string) => Promise<void>;
  getEmployeeById: (id: string) => Employee | undefined;
}

export const useEmployeeStore = create<EmployeeStore>((set, get) => ({
  employees: [],
  isLoading: false,
  error: null,

  fetchEmployees: async () => {
    set({ isLoading: true, error: null });
    try {
      const token = useAuthStore.getState().token;
      if (!token) throw new Error('Not authenticated');

      const data = await apiService.getEmployees(token);
      set({ employees: data.results, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch employees',
        isLoading: false,
      });
    }
  },

  addEmployee: async (employee) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Not authenticated');

    const newEmployee = await apiService.create<Employee>(
      '/api/employees',
      employee,
      token
    );
    set((state) => ({
      employees: [...state.employees, newEmployee],
    }));
    return newEmployee;
  },

  updateEmployee: async (id, updates) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Not authenticated');

    const updated = await apiService.update<Employee>(
      '/api/employees',
      id,
      updates,
      token
    );
    set((state) => ({
      employees: state.employees.map((e) => (e.id === id ? updated : e)),
    }));
    return updated;
  },

  deleteEmployee: async (id) => {
    const token = useAuthStore.getState().token;
    if (!token) throw new Error('Not authenticated');

    await apiService.delete('/api/employees', id, token);
    set((state) => ({
      employees: state.employees.filter((e) => e.id !== id),
    }));
  },

  getEmployeeById: (id) => get().employees.find((e) => e.id === id),
}));
```

### Step 5: Migrate Project Store

Similar pattern for `team-capacity-planner/src/stores/projectStore.ts`

### Step 6: Migrate Assignment Store

Similar pattern for `team-capacity-planner/src/stores/assignmentStore.ts`

## 🧪 Testing Integration

### Step 7: Test Authentication

- [ ] Create login form that calls `useAuthStore.login()`
- [ ] Verify token is stored in localStorage
- [ ] Test token refresh on 401 response
- [ ] Test logout clears tokens

### Step 8: Test Employee Operations

- [ ] Fetch and display employees
- [ ] Create new employee
- [ ] Update existing employee
- [ ] Delete employee
- [ ] Filter by department
- [ ] Search by name

### Step 9: Test Project Operations

- [ ] Fetch and display projects
- [ ] Create new project
- [ ] Update existing project
- [ ] Delete project
- [ ] Get project statistics
- [ ] Get project budget report

### Step 10: Test Assignment Operations

- [ ] Fetch and display assignments
- [ ] Create new assignment
- [ ] Update assignment (hours, stage, etc)
- [ ] Delete assignment
- [ ] Get assignments by week
- [ ] Get capacity by department
- [ ] Verify scio_hours + external_hours = total hours

## 🔄 Data Migration

### Step 11: Handle Initial Data

Once backend is working:

```typescript
// In your app initialization
const initializeApp = async () => {
  const token = useAuthStore.getState().token;

  if (token) {
    // Fetch all data from backend
    await useEmployeeStore.getState().fetchEmployees();
    await useProjectStore.getState().fetchProjects();
    await useAssignmentStore.getState().fetchAssignments();
  }
};
```

### Step 12: Clear Old LocalStorage Data

```typescript
// Optional: Remove old localStorage keys if they exist
localStorage.removeItem('employees');
localStorage.removeItem('projects');
localStorage.removeItem('assignments');
```

## 🐛 Error Handling

### Step 13: Add Error Handling

```typescript
// In components using the stores
const EmployeeList = () => {
  const { employees, isLoading, error, fetchEmployees } = useEmployeeStore();

  useEffect(() => {
    fetchEmployees().catch((err) => {
      console.error('Failed to fetch employees:', err);
      // Show error to user
    });
  }, []);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (employees.length === 0) return <div>No employees</div>;

  return (
    <ul>
      {employees.map((emp) => (
        <li key={emp.id}>{emp.name}</li>
      ))}
    </ul>
  );
};
```

## 📱 UI Components to Update

### Step 14: Update Components

- [ ] Login page - use `useAuthStore.login()`
- [ ] Employee list - use `useEmployeeStore`
- [ ] Project list - use `useProjectStore`
- [ ] Assignment table - use `useAssignmentStore`
- [ ] Weekly capacity view - use `getAssignmentsByWeek()`
- [ ] Department capacity - use `getCapacityByDept()`
- [ ] Create/Edit dialogs - validate and submit to API
- [ ] Delete confirmations - call API delete endpoint

## ✅ Verification Checklist

Before considering integration complete:

- [ ] Login/authentication working
- [ ] All CRUD operations working for Employees
- [ ] All CRUD operations working for Projects
- [ ] All CRUD operations working for Assignments
- [ ] Filtering and searching working
- [ ] Weekly capacity calculations correct
- [ ] Department capacity calculations correct
- [ ] No console errors
- [ ] No unhandled promise rejections
- [ ] Responsive to network errors gracefully
- [ ] Tokens refreshed automatically on expiration
- [ ] Data persists after page reload
- [ ] Pagination working (if implemented)

## 🚀 Deployment

### Step 15: Deploy to Railway

Once frontend and backend are working together locally:

1. Push backend changes to GitHub
2. Push frontend changes to GitHub
3. Deploy backend to Railway (see [backend/DEPLOYMENT.md](./backend/DEPLOYMENT.md))
4. Get Railway backend URL
5. Update frontend `API_BASE_URL` to production URL
6. Deploy frontend to Railway or your hosting
7. Test production integration

## 📞 Common Issues

### CORS Error: "Access to XMLHttpRequest blocked"
- **Solution**: Check `CORS_ALLOWED_ORIGINS` in backend `.env`
- Include frontend domain in CORS_ALLOWED_ORIGINS

### 401 Unauthorized
- **Solution**: Ensure token is being sent in Authorization header
- Check if token is expired (refresh it)
- Verify credentials are correct

### 404 Not Found
- **Solution**: Check API endpoint URL matches backend configuration
- Verify resource ID is correct
- Check if resource exists in database

### Network Error: "Failed to fetch"
- **Solution**: Ensure backend is running
- Check network connectivity
- Verify backend URL is correct
- Check browser console for CORS errors

## 📚 Resources

- [Backend Summary](./backend/BACKEND_SUMMARY.md)
- [API Documentation](./backend/API_DOCUMENTATION.md)
- [Local Testing Guide](./backend/LOCAL_TESTING.md)
- [Deployment Guide](./backend/DEPLOYMENT.md)

---

**Integration Status**: Ready to Begin
**Estimated Time**: 2-4 hours depending on complexity
**Difficulty**: Medium

Good luck with the integration! Start with Step 1-2 (configuration), then test authentication, then migrate one store at a time.
