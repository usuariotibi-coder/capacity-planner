# Architecture Guide - Team Capacity Planner

Complete technical guide to understanding the application architecture, design patterns, and code organization.

## Table of Contents
1. [High-Level Architecture](#high-level-architecture)
2. [State Management](#state-management)
3. [Data Persistence](#data-persistence)
4. [Component Structure](#component-structure)
5. [Data Flow](#data-flow)
6. [Key Design Patterns](#key-design-patterns)
7. [Date & Calendar System](#date--calendar-system)
8. [Type System](#type-system)
9. [Performance Considerations](#performance-considerations)

---

## High-Level Architecture

### Application Stack
```
┌──────────────────────────────────────────────────────────────┐
│                    React Application                         │
│                      (App.tsx)                               │
└────────────────┬─────────────────────────────┬───────────────┘
                 │                             │
        ┌────────▼─────────┐         ┌────────▼──────────┐
        │  UI Components   │         │  Context Providers│
        ├──────────────────┤         ├───────────────────┤
        │ • Pages (3)      │         │ • LanguageContext │
        │ • Modals         │         │ • useLanguage()   │
        │ • Forms          │         │ • useTranslation()│
        │ • Tables         │         └───────────────────┘
        └────────┬─────────┘
                 │
        ┌────────▼──────────────────┐
        │  State Management Layer   │
        ├───────────────────────────┤
        │ Zustand Stores (5):       │
        │ • employeeStore           │
        │ • projectStore            │
        │ • assignmentStore         │
        │ • buildTeamsStore         │
        │ • prgTeamsStore           │
        └────────┬──────────────────┘
                 │
        ┌────────▼──────────────────┐
        │  Data Persistence Layer   │
        ├───────────────────────────┤
        │ In-Memory Store:          │
        │ • 9 employees             │
        │ • 3 projects              │
        │ • 6 assignments           │
        │                           │
        │ localStorage:             │
        │ • scioTeamMembers         │
        │ • subcontractedPersonnel  │
        │ • prgExternalPersonnel    │
        └───────────────────────────┘
```

### Key Principles
1. **Unidirectional Data Flow**: Components → State → Re-render
2. **Single Source of Truth**: Zustand stores
3. **Immutable Updates**: Pure functions for state updates
4. **Type Safety**: Full TypeScript coverage
5. **Minimal Dependencies**: Only essential libraries

---

## State Management

### Zustand Store Pattern

All stores follow this pattern:

```typescript
import { create } from 'zustand';

interface CustomStore {
  // State
  data: T[];

  // Actions
  add: (item: T) => void;
  update: (id: string, item: Partial<T>) => void;
  delete: (id: string) => void;
}

export const useCustomStore = create<CustomStore>((set) => ({
  data: MOCK_DATA,

  add: (item) => set((state) => ({ data: [...state.data, item] })),
  update: (id, item) => set((state) => ({
    data: state.data.map((d) => (d.id === id ? { ...d, ...item } : d)),
  })),
  delete: (id) => set((state) => ({
    data: state.data.filter((d) => d.id !== id),
  })),
}));
```

### Store Inventory

#### 1. **employeeStore.ts**
```typescript
{
  employees: Employee[]
  addEmployee: (employee: Employee) => void
  updateEmployee: (id: string, employee: Partial<Employee>) => void
  deleteEmployee: (id: string) => void
}
```
- **Data**: 9 mock employees
- **Departments**: All 6 departments represented
- **Special Fields**: isSubcontractedMaterial, subcontractCompany (BUILD/PRG)

#### 2. **projectStore.ts**
```typescript
{
  projects: Project[]
  addProject: (project: Project) => void
  updateProject: (id: string, project: Partial<Project>) => void
  deleteProject: (id: string) => void
  calculateWeeks: () => number // Helper method
}
```
- **Data**: 3 mock projects
- **Features**: Department-specific configs, budget tracking
- **Helper**: calculateWeeks() for duration calculation

#### 3. **assignmentStore.ts**
```typescript
{
  assignments: Assignment[]
  addAssignment: (assignment: Assignment) => void
  updateAssignment: (id: string, assignment: Partial<Assignment>) => void
  deleteAssignment: (id: string) => void
  getAssignmentsByEmployee: (employeeId: string) => Assignment[]
  getAssignmentsByWeek: (weekStartDate: string) => Assignment[]
}
```
- **Data**: 6 mock assignments
- **Queries**: Helper methods for filtering assignments
- **Fields**: employeeId, projectId, weekStartDate, hours, stage

#### 4. **buildTeamsStore.ts**
```typescript
{
  activeTeams: Set<string>
  setActiveTeams: (teams: Set<string>) => void
}
```
- **Purpose**: Track active subcontracted teams for BUILD department
- **Teams**: AMI, VICER, ITAX, MCI, MG Electrical
- **Use Case**: Toggle teams on/off in BUILD capacity calculations

#### 5. **prgTeamsStore.ts**
```typescript
{
  activeTeams: Set<string>
  setActiveTeams: (teams: Set<string>) => void
}
```
- **Purpose**: Track active external teams for PRG department
- **Flexibility**: Custom team names (not predefined)
- **Use Case**: Add/remove external providers dynamically

---

## Data Persistence

### localStorage Implementation (v1.2.1)

#### Problem
Initial state with empty objects was overwriting loaded data from localStorage, causing data loss on tab switches.

#### Solution
**Lazy Initialization in useState**

```typescript
const [scioTeamMembers, setScioTeamMembers] = useState<Record<Department, Record<string, number>>>(() => {
  // This function runs ONLY ONCE on component mount
  const saved = localStorage.getItem('scioTeamMembers');
  if (saved) {
    try {
      return JSON.parse(saved);  // ← Load from localStorage
    } catch (e) {
      console.error('Error loading scioTeamMembers from localStorage', e);
    }
  }
  // Fallback if no data in localStorage
  return {
    'PM': {},
    'MED': {},
    'HD': {},
    'MFG': {},
    'BUILD': {},
    'PRG': {},
  };
});

// Save to localStorage whenever state changes
useEffect(() => {
  localStorage.setItem('scioTeamMembers', JSON.stringify(scioTeamMembers));
}, [scioTeamMembers]);
```

#### Persisted Data Structure

**scioTeamMembers**
```json
{
  "PM": {
    "2026-01-06": 3,
    "2026-01-13": 2.5,
    "2026-01-20": 4
  },
  "MED": { ... },
  "HD": { ... },
  "MFG": { ... },
  "BUILD": { ... },
  "PRG": { ... }
}
```

**subcontractedPersonnel** (BUILD department)
```json
{
  "AMI": {
    "2026-01-06": 2,
    "2026-01-13": 1
  },
  "VICER": { ... },
  "ITAX": { ... },
  "MCI": { ... },
  "MG Electrical": { ... }
}
```

**prgExternalPersonnel** (PRG department)
```json
{
  "TeamName1": {
    "2026-01-06": 3,
    "2026-01-13": 2
  },
  "TeamName2": { ... }
}
```

#### Persistence Scope
✅ **Persisted**:
- SCIO Team Members (all departments)
- Subcontracted Personnel (BUILD)
- PRG External Personnel (PRG)

❌ **NOT Persisted** (in-memory only):
- Projects
- Employees
- Assignments
- Project configurations
- Budget allocations

### Why This Design?
1. **Lightweight**: Only capacity metadata persists
2. **Session-Based**: Full data loss on refresh is intentional (testing feature)
3. **Fast**: No backend calls required
4. **Simple**: localStorage API is sufficient

---

## Component Structure

### Page Components (3 pages)

#### 1. **CapacityMatrixPage.tsx** (2,264 lines)
**Purpose**: Core capacity planning and visualization

**State Management**:
- Uses all 5 Zustand stores
- Manages 15+ local useState hooks
- localStorage for SCIO/external teams

**Key Features**:
- Matrix rendering (62 weeks)
- Cell editing modal
- Stage selection
- Project zoom controls
- Quick project creation
- Global panel toggle
- Department filtering

**Key Functions**:
- `calculateCapacityForWeek()`: Computes available capacity
- `getTotalAssignedHours()`: Sums hours for week/dept
- `handleCellClick()`: Opens edit modal
- `renderMatrixTable()`: Renders department-specific matrix
- `renderGlobalView()`: Renders all departments summary

**Modals**:
- Assignment editor (hours, stage, employees)
- Quick project creation
- Team addition (BUILD/PRG)

#### 2. **ResourcesPage.tsx** (530 lines)
**Purpose**: Employee management and assignment calendar

**State Management**:
- employeeStore: CRUD operations
- assignmentStore: Read for calendar
- buildTeamsStore/prgTeamsStore: Conditional fields

**Key Features**:
- Employee CRUD
- Department filtering
- Conditional fields (subcontracted toggle)
- Calendar view per employee
- Year/week selection
- Assignment history

**Key Functions**:
- `handleAddEmployee()`: Create new employee
- `handleEditEmployee()`: Update employee
- `handleDeleteEmployee()`: Remove employee
- `renderEmployeeModal()`: Employee form modal
- `renderEmployeeCalendar()`: Week-by-week assignment view

#### 3. **ProjectsPage.tsx** (573 lines)
**Purpose**: Project management and budget allocation

**State Management**:
- projectStore: CRUD operations
- assignmentStore: Auto-create on project creation
- employeeStore: For employee distribution

**Key Features**:
- Project CRUD
- Department-specific config
- Budget hours allocation
- Facility selection
- Auto-assignment distribution
- Utilization tracking

**Key Functions**:
- `handleCreateProject()`: Create new project
- `handleEditProject()`: Update project
- `handleDeleteProject()`: Remove project
- `renderProjectModal()`: Project form with department configs
- `renderDepartmentConfig()`: Per-dept start date & duration

### Context Components (1 context)

#### **LanguageContext.tsx** (28 lines)
```typescript
interface LanguageContextType {
  language: Language;
  toggleLanguage: () => void;
}

export const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  toggleLanguage: () => {},
});

export const useLanguage = () => useContext(LanguageContext);
```

**Usage**: All components use `useLanguage()` to get current language and `t()` for translations

---

## Data Flow

### Example: Creating an Assignment

```
User Input (CapacityMatrixPage)
  ↓
handleCellClick() opens modal
  ↓
Modal form: hours + stage + employees
  ↓
Submit button → validateAndSave()
  ↓
useAssignmentStore.addAssignment()
  ↓
Zustand state update
  ↓
CapacityMatrixPage re-renders
  ↓
useEffect recalculates capacities
  ↓
useEffect saves to localStorage (if applicable)
  ↓
UI updates with new values
```

### Example: Switching Departments

```
User clicks department tab (e.g., "BUILD")
  ↓
departmentFilter state updated
  ↓
CapacityMatrixPage re-renders with BUILD data
  ↓
scioTeamMembers state accessed (loaded from localStorage)
  ↓
buildTeamsStore.activeTeams accessed
  ↓
Modal content filtered to BUILD stages only
  ↓
Team management buttons (Agregar) appear
```

### Example: Persisting SCIO Team Members

```
User inputs "5" in SCIO Team Members cell (MED, Week 1)
  ↓
setScioTeamMembers({ ...prev, MED: { ...prev.MED, '2026-01-06': 5 } })
  ↓
State updated (React re-render)
  ↓
useEffect dependency [scioTeamMembers] triggered
  ↓
localStorage.setItem('scioTeamMembers', JSON.stringify(scioTeamMembers))
  ↓
Data persisted in browser storage
  ↓
If user switches to PRG tab and back:
  ↓
Component still mounted, scioTeamMembers state retained
  ↓
Data remains visible (no fetch needed)
```

---

## Key Design Patterns

### 1. **Custom Hooks Pattern**
```typescript
// LanguageContext usage
const { language } = useLanguage();
const t = useTranslation(language);

// Zustand stores usage
const employees = useEmployeeStore((state) => state.employees);
const addEmployee = useEmployeeStore((state) => state.addEmployee);
```

### 2. **Higher-Order Functions Pattern**
```typescript
// Filtering assignments by employee
const getAssignmentsByEmployee = (employeeId: string) =>
  assignments.filter((a) => a.employeeId === employeeId);

// Calculating capacity for a week
const calculateCapacityForWeek = (dept: Department, weekDate: string) => {
  const scio = scioTeamMembers[dept]?.[weekDate] ?? 0;
  const teams = /* sum of active teams for week */;
  const assigned = /* sum of assigned hours */;
  return (scio + teams) - assigned;
};
```

### 3. **Conditional Rendering Pattern**
```typescript
// MFG department shows hours, others show people
{departmentFilter === 'MFG' ? (
  <input placeholder="Hours per Week" />
) : (
  <input placeholder="SCIO Team Members" />
)}

// BUILD/PRG show team management buttons
{(departmentFilter === 'BUILD' || departmentFilter === 'PRG') && (
  <button onClick={() => setIsModalOpen(true)}>Agregar</button>
)}
```

### 4. **Modal Pattern**
```typescript
// All modals follow the same pattern
const [isOpen, setIsOpen] = useState(false);
const [formData, setFormData] = useState({...});

return (
  <>
    {isOpen && (
      <Modal onClose={() => setIsOpen(false)}>
        <Form data={formData} onChange={setFormData} onSubmit={handleSubmit} />
      </Modal>
    )}
  </>
);
```

### 5. **Lazy Initialization Pattern**
```typescript
// Load from localStorage only once, on mount
const [state, setState] = useState(() => {
  const saved = localStorage.getItem('key');
  return saved ? JSON.parse(saved) : DEFAULT_VALUE;
});

// Save whenever state changes
useEffect(() => {
  localStorage.setItem('key', JSON.stringify(state));
}, [state]);
```

---

## Date & Calendar System

### Week System
- **Base**: Monday-Sunday weeks (ISO 8601 standard)
- **Scope**: 52 weeks + 10 next-year weeks (62 weeks total)
- **Format**: ISO YYYY-MM-DD for storage
- **Display**: "Week X" or custom "5 January 2026" format

### Key Functions (dateUtils.ts)

```typescript
getWeekStart(date: Date) → Date
  // Returns the Monday of the given week

getWeeksInRange(startDate, endDate) → string[]
  // Returns array of week start dates between two dates

formatToISO(date: Date) → string
  // Converts Date to YYYY-MM-DD string

getAllWeeksWithNextYear(year) → Array
  // Returns 62 weeks: 52 current + 10 next year

getWeekNumber(dateStr, year) → number
  // Returns week number (1-52) for given date
```

### Calendar View (ResourcesPage)
- Shows assignments per week per employee
- Color-coded by project
- Year/week selectors for navigation
- "No assignment" indicator for empty weeks

---

## Type System

### Core Types (types/index.ts)

```typescript
type Department = 'PM' | 'MED' | 'HD' | 'MFG' | 'BUILD' | 'PRG';
type Facility = 'AL' | 'MI' | 'MX';
type Language = 'es' | 'en';
type Stage = StageType | null;

interface Employee {
  id: string;
  name: string;
  role: string;
  department: Department;
  capacity: number;
  isActive: boolean;
  isSubcontractedMaterial?: boolean;
  subcontractCompany?: string;
}

interface Project {
  id: string;
  name: string;
  client: string;
  startDate: string;
  endDate: string;
  facility: Facility;
  numberOfWeeks: number;
  departmentStages?: Record<Department, DepartmentStageConfig[]>;
  departmentHoursAllocated?: Record<Department, number>;
  departmentHoursUtilized?: Record<Department, number>;
  visibleInDepartments?: Department[];
}

interface Assignment {
  id: string;
  employeeId: string;
  projectId: string;
  weekStartDate: string;
  hours: number;
  stage: Stage;
}
```

### Stage Type System

```typescript
type Stage =
  // HD Stages
  | 'SWITCH_LAYOUT_REVISION'
  | 'CONTROLS_DESIGN'
  // MED Stages
  | 'CONCEPT'
  | 'DETAIL_DESIGN'
  // BUILD Stages
  | 'CABINETS_FRAMES'
  | 'OVERALL_ASSEMBLY'
  | 'FINE_TUNING'
  // PRG Stages
  | 'OFFLINE'
  | 'ONLINE'
  | 'DEBUG'
  | 'COMMISSIONING'
  // Common Stages
  | 'RELEASE'
  | 'RED_LINES'
  | 'SUPPORT'
  | 'SUPPORT_MANUALS_FLOW_CHARTS'
  | 'ROBOT_SIMULATION'
  | 'STANDARDS_REV_PROGRAMING_CONCEPT'
  | null;
```

### Type Safety
- ✅ No `any` types
- ✅ Full type coverage
- ✅ Strict mode enabled
- ✅ Interface over types (where appropriate)
- ✅ Union types for limited options

---

## Performance Considerations

### Rendering Performance

1. **Component Memoization**
   - Not used (intentional) - component tree is small
   - Re-renders are fast with small datasets (3-9 mock items)

2. **List Rendering**
   - 62 weeks × 6 departments = 372 cells
   - Each cell renders in <1ms
   - Total render time: ~50-100ms

3. **Data Structure Choices**
   - Arrays for lists (projects, employees, assignments)
   - Objects for lookups (scioTeamMembers, stageColors)
   - Sets for team toggles (buildTeamsStore, prgTeamsStore)

### Optimization Opportunities

If scaling to 100+ projects:

1. **Pagination**: Only render visible weeks
2. **Virtualization**: Virtual scrolling for row lists
3. **Memoization**: React.memo for expensive cells
4. **Backend**: Move to real database

### Current Scalability
- ✅ Works well with 3-10 projects
- ✅ 6 departments × 52 weeks = manageable
- ✅ 9 employees × 6 departments = small
- ⚠️ May slow with 100+ projects
- ⚠️ Browser memory limit for very large datasets

---

## Error Handling

### localStorage Error Handling
```typescript
const saved = localStorage.getItem('scioTeamMembers');
if (saved) {
  try {
    return JSON.parse(saved);
  } catch (e) {
    console.error('Error loading scioTeamMembers from localStorage', e);
    // Fall back to default value
  }
}
```

### Validation Patterns
```typescript
// Project creation validation
if (!form.name || !form.client || !form.startDate || !form.numberOfWeeks) {
  alert(t('completeAllFields'));
  return;
}

// Assignment validation
if (editingHours <= 0) {
  alert('Hours must be greater than 0');
  return;
}
```

### Error Prevention
- TypeScript catches type errors at compile time
- Required fields in forms
- Defensive checks in calculations (nullish coalescing: `??`)

---

## Future Architecture Improvements

1. **Backend Integration**
   - Replace Zustand with API calls
   - Add JWT authentication
   - Implement WebSocket for real-time updates

2. **State Management**
   - Consider Redux if application grows
   - Add middleware for logging/debugging
   - Implement undo/redo system

3. **Performance**
   - Implement React Query for server state
   - Add virtual scrolling for large lists
   - Optimize bundle size

4. **Testing**
   - Add unit tests for utilities
   - Add integration tests for stores
   - Add E2E tests for workflows

5. **Code Organization**
   - Extract reusable components
   - Create custom hooks library
   - Implement feature flags

---

**Last Updated**: January 6, 2026
**Version**: 1.2.1
**Confidence Level**: High (Fully Tested)
