# Team Capacity Planner - System Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Technologies & Tools](#technologies--tools)
3. [System Architecture](#system-architecture)
4. [Data Model](#data-model)
5. [Module Descriptions](#module-descriptions)
6. [File Structure](#file-structure)
7. [Key Features](#key-features)
8. [MFG Department Special Logic](#mfg-department-special-logic)
9. [Internationalization](#internationalization)
10. [Development Guide](#development-guide)

---

## Project Overview

### Purpose
The **Team Capacity Planner** is a web-based application designed to manage and visualize team capacity allocation across multiple projects and departments. It enables project managers to:

- Create and manage projects with department-specific timelines
- Assign human resources to projects by department and week
- Visualize capacity allocation in matrix format
- Track project progress and resource utilization
- Monitor department workload across multiple concurrent projects
- Track budget vs actual hours (Quoted vs Used)

### Project Type
- **Frontend Application** (100% Client-Side)
- **Target Users**: Project Managers, Resource Planners, Department Heads

### Current Version
v1.2.1 (January 6, 2026)

---

## Technologies & Tools

### Frontend Stack
| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 19.2.0 | UI framework for building interactive components |
| **TypeScript** | 5.9.3 | Type-safe JavaScript for maintainability |
| **Vite** | 7.2.4 | Fast build tool and development server |
| **Tailwind CSS** | 3.4.19 | Utility-first CSS framework for styling |
| **Zustand** | 5.0.9 | Lightweight state management library |
| **date-fns** | 4.1.0 | Date manipulation and formatting utilities |
| **Lucide React** | 0.562.0 | Icon library (UI icons) |

### Development Tools
| Tool | Version | Purpose |
|------|---------|---------|
| **TypeScript** | ~5.9.3 | Static type checking |
| **ESLint** | 9.39.1 | Code quality and style enforcement |
| **Autoprefixer** | 10.4.23 | CSS vendor prefixing |
| **PostCSS** | 8.5.6 | CSS transformation |

### Environment
- **Node.js**: v18+ LTS recommended
- **Package Manager**: npm
- **Browser Support**: Modern browsers (Chrome, Firefox, Safari, Edge)

---

## System Architecture

### Architecture Pattern
**Component-Based Architecture** with **State Management via Zustand**

```
┌─────────────────────────────────────────────────────┐
│           React Application (App.tsx)                │
│    ┌─────────────────────────────────────────┐      │
│    │       LanguageContext Provider           │      │
│    └─────────────────────────────────────────┘      │
└────────────┬────────────────────────────────────────┘
             │
     ┌───────┴────────┬──────────────┬─────────────┐
     │                │              │             │
┌────▼────┐    ┌─────▼─────┐   ┌────▼────┐  ┌───▼──────┐
│ Projects│    │ Resources │   │Capacity │  │Navigation│
│  Page   │    │   Page    │   │ Matrix  │  │ Sidebar  │
└────┬────┘    └─────┬─────┘   └────┬────┘  └──────────┘
     │               │              │
     └───────────────┼──────────────┘
                     │
         ┌───────────▼───────────┐
         │   Zustand Stores      │
         ├───────────────────────┤
         │ • ProjectStore        │
         │ • EmployeeStore       │
         │ • AssignmentStore     │
         └───────┬───────────────┘
                 │
         ┌───────▼────────────┐
         │   Data Layer       │
         ├────────────────────┤
         │ Mock Data          │
         │ (In-Memory Store)  │
         └────────────────────┘
```

### Data Flow
1. **User Interaction** → React Components
2. **State Updates** → Zustand Stores
3. **Side Effects** → Auto-calculated metrics
4. **Re-render** → Component display updated

---

## Data Model

### Core Entities

#### 1. **Project**
Represents a project with assigned departments and timelines.

```typescript
interface Project {
  id: string;                              // Unique identifier
  name: string;                            // Project name (JOB number)
  client: string;                          // Client/Company name
  startDate: string;                       // ISO format (YYYY-MM-DD)
  endDate: string;                         // ISO format (YYYY-MM-DD)
  facility: Facility;                      // Location code (AL, MI, MX)
  numberOfWeeks: number;                   // Duration in weeks
  departmentStages?: Record<
    Department,
    DepartmentStageConfig[]
  >;                                       // Department-specific schedules
  departmentHoursAllocated?: Record<
    Department,
    number
  >;                                       // Budget/Quoted hours per department
  departmentHoursUtilized?: Record<
    Department,
    number
  >;                                       // Used hours per department (manual)
}
```

#### 2. **Employee**
Represents a team member with capacity information.

```typescript
interface Employee {
  id: string;                              // Unique identifier
  name: string;                            // Full name
  role: string;                            // Job title/role
  department: Department;                  // Department assignment
  capacity: number;                        // Available hours per week
  isActive: boolean;                       // Active status flag
}
```

#### 3. **Assignment**
Represents hours allocated to a project in a specific week.

```typescript
interface Assignment {
  id: string;                              // Unique identifier
  employeeId: string;                      // Reference to Employee
  projectId: string;                       // Reference to Project
  weekStartDate: string;                   // ISO format (YYYY-MM-DD)
  hours: number;                           // Allocated hours
  stage: Stage;                            // Work stage/phase
}
```

#### 4. **DepartmentStageConfig**
Defines when a department is active in a project.

```typescript
interface DepartmentStageConfig {
  stage: Stage;                            // Work stage (or null)
  weekStart: number;                       // Relative week number (1-based)
  weekEnd: number;                         // Relative week number (1-based)
  departmentStartDate?: string;            // Actual start date (ISO)
  durationWeeks?: number;                  // Duration for this department
}
```

### Enums

#### Department
```typescript
type Department = 'PM' | 'MED' | 'HD' | 'MFG' | 'BUILD' | 'PRG';
```
- **PM**: Project Manager
- **MED**: Mechanical Design
- **HD**: Hardware Design
- **MFG**: Manufacturing (Special hours-based mode)
- **BUILD**: Assembly/Build
- **PRG**: Programming PLC

#### Facility
```typescript
type Facility = 'AL' | 'MI' | 'MX';
```
- **AL**: Facility A
- **MI**: Facility B (Midwest)
- **MX**: Facility C (Mexico)

#### Stage Types
```typescript
// HD Stages
type HDStage = 'SWITCH_LAYOUT_REVISION' | 'CONTROLS_DESIGN' | 'RELEASE' | 'RED_LINES' | 'SUPPORT';

// MED Stages
type MEDStage = 'CONCEPT' | 'DETAIL_DESIGN' | 'RELEASE' | 'RED_LINES' | 'SUPPORT';

// PRG Stages
type PRGStage = 'OFFLINE' | 'ONLINE' | 'DEBUG' | 'COMMISSIONING' |
               'SUPPORT_MANUALS_FLOW_CHARTS' | 'ROBOT_SIMULATION' |
               'STANDARDS_REV_PROGRAMING_CONCEPT';

type Stage = HDStage | MEDStage | PRGStage | null;
```

### Data Relationships

```
Project (1) ──── (Many) DepartmentStageConfig
   │
   └────────────────┐
                    │
Employee (1) ──── (Many) Assignment ──── (1) Project
```

---

## Module Descriptions

### Pages

#### 1. **CapacityMatrixPage** (`src/pages/CapacityMatrixPage.tsx`)
**Purpose**: Main dashboard for viewing and editing weekly capacity allocation.

**Size**: ~1,600 lines

**Key Features**:

1. **Two View Modes:**
   - **General View**: Read-only aggregated view of all departments
   - **Department-Specific View**: Editable view for individual departments

2. **General View Features:**
   - Global capacity summary panel
   - Color-coded utilization indicators
   - Projects matrix with all 6 departments
   - Expandable projects with assignment details

3. **Department-Specific View Features:**
   - Weekly Occupancy Total row (Total)
   - SCIO Team Members / Hours per Week inputs
   - Capacity row (Available = SCIO - Occupied)
   - Projects list with per-project zoom controls
   - Editable cells with modal popup
   - Utilized Hours (Used) editing with pencil icon
   - Quoted Hours display

4. **Visual Indicators:**
   - Current week with red ring and shadow
   - Department start week with "Init" indicator
   - Week out-of-range warning icon (⚠)
   - Color-coded capacity cells

**State Management:**
- `expandedProjects`: Track expanded projects
- `editingCell`: Current editing cell
- `scioTeamMembers`: Weekly capacity per department
- `selectedYear`: Year selection (2024-2027)
- `zoom`: Zoom level per project

---

#### 2. **ProjectsPage** (`src/pages/ProjectsPage.tsx`)
**Purpose**: Project management and configuration.

**Size**: ~560 lines

**Key Features:**
- Project CRUD operations
- Department-specific date and duration configuration
- Auto-calculated project end dates
- Budget hours allocation per department
- Form modal with validation

**Auto-Assignment Generation:**
- Creates assignments when project is created
- Distributes hours across active employees
- Spreads hours evenly across project weeks

---

#### 3. **ResourcesPage** (`src/pages/ResourcesPage.tsx`)
**Purpose**: Employee/Resource management interface.

**Size**: ~400 lines

**Key Features:**
- Employee CRUD operations
- Department grouping with unique colors
- Mini calendar view per employee
- Assignment tracking with project colors
- Active/Inactive status toggle

---

### Stores (Zustand)

#### 1. **ProjectStore** (`src/stores/projectStore.ts`)
```typescript
interface ProjectStore {
  projects: Project[];
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
}
```

#### 2. **EmployeeStore** (`src/stores/employeeStore.ts`)
```typescript
interface EmployeeStore {
  employees: Employee[];
  addEmployee: (employee: Employee) => void;
  updateEmployee: (id: string, updates: Partial<Employee>) => void;
  deleteEmployee: (id: string) => void;
}
```

#### 3. **AssignmentStore** (`src/stores/assignmentStore.ts`)
```typescript
interface AssignmentStore {
  assignments: Assignment[];
  addAssignment: (assignment: Assignment) => void;
  updateAssignment: (id: string, updates: Partial<Assignment>) => void;
  deleteAssignment: (id: string) => void;
  getAssignmentsByEmployee: (employeeId: string) => Assignment[];
  getAssignmentsByWeek: (weekStartDate: string) => Assignment[];
}
```

---

### Utilities

#### 1. **dateUtils.ts**
Date manipulation and week calculations.

| Function | Description |
|----------|-------------|
| `getWeek1Start(year)` | Returns Monday of week 1 for a year |
| `getWeekNumber(dateStr, year)` | Converts ISO date to week number (1-52) |
| `getCurrentWeekNumber()` | Returns current week number |
| `getAllWeeksWithNextYear(year)` | Returns 62 weeks (52 + 10 next year) |
| `formatToISO(date)` | Formats date to YYYY-MM-DD |

#### 2. **departmentIcons.tsx**
Department visual configuration.

```typescript
const departmentIcons: Record<Department, {icon, color, label}> = {
  'MED': { icon: <Cog />, color: 'text-blue-600', label: 'Mechanical Design' },
  'HD': { icon: <Zap />, color: 'text-yellow-600', label: 'Hardware Design' },
  'PM': { icon: <Cpu />, color: 'text-purple-600', label: 'Project Manager' },
  'MFG': { icon: <Factory />, color: 'text-orange-600', label: 'Manufacturing' },
  'BUILD': { icon: <Wrench />, color: 'text-red-600', label: 'Assembly' },
  'PRG': { icon: <Microchip />, color: 'text-green-600', label: 'Programming PLC' }
};
```

#### 3. **stageColors.ts**
Stage colors and talent calculations.

| Function | Description |
|----------|-------------|
| `getStageColor(stage)` | Returns `{bg, text, label}` for a stage |
| `calculateTalent(hours)` | Converts hours to talent (hours ÷ 45) |
| `getUtilizationColor(percent)` | Returns colors based on utilization % |

#### 4. **translations.ts**
Internationalization strings (250+ keys).

```typescript
export const translations = {
  es: { /* Spanish translations */ },
  en: { /* English translations */ }
};

export const useTranslation = (language: Language) => translations[language];
```

#### 5. **id.ts**
ID generation utility.

```typescript
export const generateId = (): string => `${Date.now()}-${randomString}`;
```

---

## File Structure

```
team-capacity-planner/
├── src/
│   ├── components/              # (Reserved for reusable components)
│   ├── context/
│   │   └── LanguageContext.tsx  # Language provider (default: 'en')
│   ├── pages/
│   │   ├── CapacityMatrixPage.tsx  # Main capacity dashboard
│   │   ├── ProjectsPage.tsx        # Project management
│   │   └── ResourcesPage.tsx       # Employee management
│   ├── stores/
│   │   ├── projectStore.ts         # Project state (Zustand)
│   │   ├── employeeStore.ts        # Employee state (Zustand)
│   │   └── assignmentStore.ts      # Assignment state (Zustand)
│   ├── types/
│   │   └── index.ts                # TypeScript definitions
│   ├── utils/
│   │   ├── dateUtils.ts            # Date calculations
│   │   ├── departmentIcons.tsx     # Department icons/colors
│   │   ├── stageColors.ts          # Stage colors
│   │   ├── translations.ts         # i18n translations
│   │   └── id.ts                   # ID generation
│   ├── App.tsx                     # Main app component
│   ├── App.css                     # App styles
│   ├── index.css                   # Global styles + input fixes
│   └── main.tsx                    # Entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── postcss.config.js
```

---

## Key Features

### 1. **Capacity Matrix**
- Matrix view with weeks as columns
- Departments/projects as rows
- Color-coded capacity levels
- Expandable/collapsible projects

### 2. **Weekly Capacity System**
- SCIO Team Members / Hours per Week inputs
- Per-department, per-week configuration
- Capacity calculation: SCIO capacity - Occupied

### 3. **Utilization Tracking**
- Quoted Hours: Budget allocation per department
- Used Hours: Manual entry via pencil icon
- Utilization %: (Used ÷ Quoted) × 100
- Color coding: Green/Yellow/Red

### 4. **Time Management**
- ISO week date standard (Week 1-52)
- Year transitions with next year preview
- Current week highlighting with red ring
- Auto-scroll to current week

### 5. **UI/UX Features**
- Zoom controls (50%-200%) per project
- Collapsible legend in header
- Language toggle (EN/ES)
- Responsive design

---

## MFG Department Special Logic

The **MFG (Manufacturing)** department operates differently from other departments:

### Key Differences

| Feature | Other Departments | MFG |
|---------|-------------------|-----|
| **Display Unit** | People (hours ÷ 45) | Hours (direct) |
| **Input Label** | "SCIO Team Members" | "Hours per Week" |
| **Employee Selection** | Yes (in modal) | No |
| **Color Thresholds** | People-based | Hours-based |

### Color Thresholds

**Non-MFG Departments (People-based):**
| People | Color | Status |
|--------|-------|--------|
| < 2.5 | Green | Low |
| 2.5 - 5 | Yellow | Moderate |
| 5 - 8 | Orange | High |
| ≥ 8 | Red | Critical |

**MFG Department (Hours-based):**
| Hours | Color | Status |
|-------|-------|--------|
| < 112.5 | Green | Low |
| 112.5 - 225 | Yellow | Moderate |
| 225 - 360 | Orange | High |
| ≥ 360 | Red | Critical |

### Implementation
```typescript
const isMFG = dept === 'MFG';
const displayValue = isMFG ? totalWeekHours : totalWeekHours / 45;
const unit = isMFG ? 'h' : 'people';
```

---

## Internationalization

### Supported Languages
- **English (en)** - Default
- **Spanish (es)**

### Implementation
```typescript
// LanguageContext.tsx
const [language, setLanguage] = useState<Language>('en');

// Usage in components
const { language } = useLanguage();
const t = useTranslation(language);

// Example
<span>{t.capacityMatrix}</span>  // "Capacity Matrix" or "Matriz de Capacidad"
```

### Translation Keys (250+)
- Navigation labels
- Button text
- Form labels
- Status messages
- Legend items
- Error messages

---

## Development Guide

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint
```

### Adding a New Feature

1. **Update Types** (`src/types/index.ts`)
2. **Create/Update Store** (`src/stores/`)
3. **Build UI Component** (`src/pages/`)
4. **Add Utilities if Needed** (`src/utils/`)
5. **Add Translations** (`src/utils/translations.ts`)
6. **Test and Build**

### Code Style Guidelines

- **TypeScript**: Use strict types, avoid `any`
- **Components**: Functional components with hooks
- **State**: Zustand stores for shared state
- **Naming**:
  - PascalCase for components
  - camelCase for functions/variables
  - UPPERCASE for constants

---

## Performance Considerations

### Current Optimizations
- Zustand store subscriptions (selective re-renders)
- Efficient DOM rendering with keys
- CSS transforms for animations

### Scaling Recommendations
- Backend API for persistence
- Pagination for large datasets
- Virtual scrolling for long lists
- Caching strategies

---

## Known Limitations

1. **Data Persistence**: In-memory only; lost on refresh
2. **Concurrency**: No multi-user conflict resolution
3. **Validation**: Limited input validation
4. **Scalability**: UI may slow with 100+ projects
5. **Mobile**: Optimized for desktop

---

## Future Enhancements

- [ ] Backend API integration
- [ ] User authentication
- [ ] Real-time collaboration
- [ ] Export/Import (CSV, Excel)
- [ ] Advanced analytics
- [ ] Mobile responsive improvements
- [ ] Dark mode theme
- [ ] Automated capacity alerts

---

*Last Updated: December 2025*
*Version: 1.1.0*
