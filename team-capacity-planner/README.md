# Team Capacity Planner

A modern web application for managing and visualizing team capacity allocation across multiple projects and departments.

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![Version](https://img.shields.io/badge/version-1.2.1-blue)
![License](https://img.shields.io/badge/license-Proprietary-red)

---

## Overview

**Team Capacity Planner** enables organizations to:
- Create and manage projects with department-specific timelines
- Allocate resources by department and week
- Visualize capacity in intuitive matrix format
- Track project progress and resource utilization
- Monitor department workload across concurrent projects
- Track budget vs actual hours (Quoted vs Used)

Perfect for:
- Project Managers
- Resource Planners
- Department Heads
- Executive Leadership

---

## Key Features

### Capacity Matrix Visualization
- Interactive matrix showing hours allocated per department per week
- Toggle between General view and department-specific views
- Current week highlighting with red border indicator
- Expandable project details with zoom controls
- SCIO Team Members / Hours per Week capacity inputs
- Real-time capacity calculations with automatic updates
- Persistent data storage using browser localStorage

### Department-Specific Views
Six departments supported with unique calculation modes:

| Code | Name | Calculation Mode | Special Features |
|------|------|------------------|----|
| **PM** | Project Manager | People-based (hours ÷ 45) | - |
| **MED** | Mechanical Design | People-based (hours ÷ 45) | - |
| **HD** | Hardware Design | People-based (hours ÷ 45) | - |
| **MFG** | Manufacturing | **Hours-based** (direct hours) | Special hours mode |
| **BUILD** | Assembly | People-based (hours ÷ 45) | Subcontracted teams support |
| **PRG** | Programming PLC | People-based (hours ÷ 45) | External teams support |

### BUILD Department - Subcontracted Teams
- Add custom subcontracted team names (e.g., MG, AMI, VICER)
- Define team capacity per week
- Capacity formula: **Capacity = (SCIO Team Members + Sum of all active teams) - Total assigned**
- Modal-based team addition
- Delete teams with visual indicators
- All data automatically persists

### PRG Department - External Teams
- Add custom external team providers
- Define external team capacity per week
- Capacity formula: **Capacity = (SCIO Team Members + Sum of all external teams) - Total assigned**
- Same functionality as BUILD department
- Modal-based team addition
- Delete teams with visual indicators

### MFG Special Handling
- Shows hours directly instead of converting to people
- No employee selection in assignment modal
- Different color thresholds for capacity indicators
- "Hours per Week" label instead of "SCIO Team Members"

### Project Management
- Create projects with client info and duration
- Configure department-specific start dates and durations
- Auto-calculate project timelines
- Budget hours allocation per department (Quoted Hours)
- Used hours tracking with utilization percentage

### Resource Allocation
- Assign hours per department per week
- Track work stages and phases
- Auto-generated assignments on project creation
- Direct cell-level editing in capacity matrix
- Employee selection for hour distribution

### Utilization Tracking
- Define allocated hours budget per department per project (Quoted)
- Manual entry of used hours via pencil icon
- Automatic calculation of utilization percentage: (Used ÷ Quoted) × 100
- Color-coded utilization indicators:
  - 🟢 Green (0-50%): Under-utilized
  - 🟡 Yellow (50-75%): Balanced
  - 🔴 Red (75%+): High utilization

### Visual Features
- Responsive design with Tailwind CSS
- Department-specific icons and colors
- Zoom controls (50%-200%) per project
- Collapsible legend in header
- Current week indicator with red ring
- Stage color coding for visual differentiation

### Internationalization
- Full English and Spanish language support
- Language toggle in header (default: English)
- 250+ translated strings

---

## Quick Start

### Prerequisites
- Node.js v18.0.0 or higher
- npm v9.0.0 or higher

### Installation & Running

```bash
# Clone repository
git clone <repository-url>
cd team-capacity-planner

# Install dependencies
npm install

# Start development server
npm run dev
```

Once running, open **http://localhost:5179** in your browser. (Or follow the URL shown in the terminal - the port may vary if 5179 is already in use).

### Build for Production

```bash
npm run build
npm run preview
```

---

## Usage Guide

### Getting Started

1. **Create a Project**
   - Navigate to "Projects" page
   - Click "ADD NEW JOB"
   - Fill in project details: name, client, dates, facility
   - Configure department timelines (start date and duration)
   - Set budget hours per department
   - Save the project

2. **View Capacity Matrix**
   - Go to "Capacity Matrix" page
   - Use General view for overview of all departments
   - Select specific department for detailed editing

3. **Assign Work Hours**
   - In department view, click on any cell in the capacity matrix
   - Specify hours, stage, and assign to employees
   - Hours are distributed among selected employees
   - For MFG: Only hours input (no employee selection)

4. **Track Utilization**
   - View "Quoted" and "Used" values in project cards
   - Click pencil icon to edit Used hours
   - Monitor utilization percentage with color coding

5. **Configure Weekly Capacity**
   - In "SCIO Team Members" row (or "Hours per Week" for MFG)
   - Enter available capacity per week
   - "Capacity" row shows: (SCIO + External teams) - Occupied

6. **Manage Subcontracted/External Teams (BUILD & PRG Only)**
   - **In BUILD Department:**
     - Click "Agregar" (Add) button to add subcontracted teams
     - Enter custom team name (e.g., "MG", "AMI", "VICER")
     - Enter team members/capacity per week
     - Delete teams using the red minus icon on hover
   - **In PRG Department:**
     - Same process as BUILD for external team providers
     - Enter provider names and capacity
   - Capacity automatically recalculates: (SCIO + Team1 + Team2 + ...) - Assigned

### Navigation

- **Capacity Matrix**: View and edit capacity allocation
- **Projects**: Create and manage projects
- **Resources**: Manage employees and departments

---

## Project Structure

```
src/
├── pages/                        # Main page components
│   ├── CapacityMatrixPage.tsx   # Core capacity planning matrix (2,264 lines)
│   │                            # Features: matrix view, zoom, assignments, team management
│   ├── ResourcesPage.tsx        # Employee management (530 lines)
│   │                            # Features: CRUD employees, calendar view, department filtering
│   └── ProjectsPage.tsx         # Project management (573 lines)
│                                # Features: create/edit projects, budget allocation, auto-assignments
│
├── stores/                       # Zustand state management (in-memory)
│   ├── employeeStore.ts        # 9 mock employees (109 lines)
│   ├── projectStore.ts         # 3 mock projects (138 lines)
│   ├── assignmentStore.ts      # 6 mock assignments (85 lines)
│   ├── buildTeamsStore.ts      # BUILD dept active teams (30 lines)
│   └── prgTeamsStore.ts        # PRG dept active teams (30 lines)
│
├── context/                      # React Context API
│   └── LanguageContext.tsx      # Language toggle (ES/EN) - 28 lines
│
├── types/                        # TypeScript definitions (116 lines)
│   └── index.ts                 # Department, Stage, Employee, Project, Assignment interfaces
│
├── utils/                        # Utility functions
│   ├── dateUtils.ts            # Week calculations, date formatting (120 lines)
│   ├── stageColors.ts          # Stage→color mapping, talent calculations (116 lines)
│   │                           # Features: 14 stage colors, utilization colors
│   ├── departmentIcons.tsx     # Department icons and names (40 lines)
│   ├── translations.ts         # 150+ translated strings (375 lines)
│   │                           # Full bilingual: Spanish + English
│   └── id.ts                   # ID generation helper (4 lines)
│
├── App.tsx                       # Main app container & router (157 lines)
│                                # Features: 3-page navigation, sidebar, language toggle
├── App.css                       # Component-specific styles
├── index.css                     # Global styles, Tailwind config
└── main.tsx                      # React entry point (14 lines)
```

---

## Technology Stack

### Current Implementation: **FRONTEND ONLY**

This application is a **100% Frontend (Client-Side) Solution**:
- All data stored **in-memory** using Zustand state management
- **No backend server** required
- No database connections
- No API endpoints
- localStorage for SCIO/External team persistence (not core data)
- Perfect for local testing, prototyping, and capacity planning demonstrations

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 19.2.0 | Modern UI framework with hooks |
| **TypeScript** | 5.9.3 | Full type safety, no `any` types |
| **Vite** | 7.2.4 | Lightning-fast build tool & dev server |
| **Zustand** | 5.0.9 | Minimal state management (5 stores) |
| **Tailwind CSS** | 3.4.19 | Utility-first styling & responsive design |
| **Lucide React** | 0.562.0 | 6 department icons + UI controls |
| **date-fns** | 4.1.0 | Date calculations & formatting |
| **ESLint** | 9.39.1 | Code quality & consistency |

### Development Tools

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 18.0.0+ | Runtime environment |
| **npm** | 9.0.0+ | Package management |

### Architecture Highlights
- **State Management**: 5 Zustand stores (employees, projects, assignments, buildTeams, prgTeams)
- **Data Persistence**: localStorage for SCIO team members & external personnel only
- **Date System**: ISO format (YYYY-MM-DD) with 52-week + 10-week-next-year view
- **Styling**: 100% Tailwind CSS (no custom CSS in components)
- **Icons**: lucide-react for consistent UI
- **Internationalization**: React Context + 375-line translation file (ES/EN)
- **Type Safety**: Full TypeScript coverage with 116 lines of type definitions

### What This Architecture Means
- ✅ **Fast & Responsive**: No network latency, instant calculations
- ✅ **Works Offline**: No internet connection required
- ✅ **Easy Deployment**: Single static HTML/CSS/JS bundle
- ✅ **Lightweight**: ~100KB minified (production build)
- ⚠️ **Data is Temporary**: Full refresh loses all project/employee data (only SCIO/teams persist)
- ⚠️ **Single User**: No concurrent edit resolution or multi-user support
- ⚠️ **No Audit Trail**: No historical data tracking

---

## Color Coding Reference

### Utilization Percentage Colors (Budget Tracking)
Automatic color coding for utilization percentage: (Used Hours ÷ Quoted Hours) × 100

| Utilization % | Color | Status | Animation |
|---|---|---|---|
| 0–50% | 🟢 Green | Under-utilized | None |
| 50–75% | 🟡 Yellow | Balanced | None |
| 75–100% | 🔴 Red (500) | High utilization | None |
| 100%+ | 🔴 Red (700) | **Over-allocated** | Pulse animation |

### Capacity Utilization Colors (Department Weekly View)

**Non-MFG Departments** (People-based, hours ÷ 45):
| People Occupied | Color | Status |
|---|---|---|
| < 2.5 | 🟢 Green (100) | Low |
| 2.5 – 5 | 🟡 Yellow (100) | Moderate |
| 5 – 8 | 🟠 Orange (100) | High |
| ≥ 8 | 🔴 Red (700) + pulse | **Critical** |

**MFG Department** (Hours-based, direct hours):
| Hours per Week | Color | Status |
|---|---|---|
| < 112.5 | 🟢 Green (100) | Low |
| 112.5 – 225 | 🟡 Yellow (100) | Moderate |
| 225 – 360 | 🟠 Orange (100) | High |
| ≥ 360 | 🔴 Red (700) + pulse | **Critical** |

### Work Stage Colors
14 stages with unique Tailwind colors for visual differentiation:

**HD (Hardware Design):**
- SWITCH_LAYOUT_REVISION → Purple (100/900)
- CONTROLS_DESIGN → Indigo (100/900)

**MED (Mechanical Design):**
- CONCEPT → Sky (100/900)
- DETAIL_DESIGN → Cyan (100/900)

**BUILD (Assembly):**
- CABINETS_FRAMES → Blue (100/900)
- OVERALL_ASSEMBLY → Purple (200/900)
- FINE_TUNING → Pink (100/900)

**PRG (Programming):**
- OFFLINE → Lime (100/900)
- ONLINE → Green (100/900)
- DEBUG → Amber (100/900)
- COMMISSIONING → Orange (100/900)

**Common (All Departments):**
- RELEASE → Emerald (100/900)
- RED_LINES → Red (100/900)
- SUPPORT → Slate (100/900)
- SUPPORT_MANUALS_FLOW_CHARTS → Stone (100/900)
- ROBOT_SIMULATION → Zinc (100/900)
- STANDARDS_REV_PROGRAMING_CONCEPT → Neutral (100/900)

---

## Documentation

- **[SYSTEM_DOCUMENTATION.md](./SYSTEM_DOCUMENTATION.md)** - Complete system architecture and technical details
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick reference guide
- **[DEPENDENCIES.md](./DEPENDENCIES.md)** - Setup guide and dependencies
- **[UTILIZATION_GUIDE.md](./UTILIZATION_GUIDE.md)** - Utilization tracking guide

---

## Available Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm run preview  # Preview production
npm run lint     # Check code quality
```

---

## Features at a Glance

### Core Capacity Planning
✅ Interactive capacity matrix by department & week (62 weeks total)
✅ Real-time capacity calculations with instant updates
✅ Week-based scheduling (52 weeks + 10 next-year weeks)
✅ Current week highlighting with visual indicator
✅ Zoom controls per project (50–200%) + global zoom
✅ Per-project expandable/collapsible details

### Project & Resource Management
✅ Project CRUD operations with full configuration
✅ Department-specific timelines (independent start/end per dept)
✅ Budget hours allocation per department (Quoted Hours)
✅ Used hours tracking with utilization percentage
✅ Automatic assignment creation on project creation
✅ Employee CRUD operations (9 mock employees)
✅ Facility assignment (AL, MI, MX)

### Advanced Features
✅ Subcontracted team management (BUILD department)
  - Custom team names (AMI, VICER, ITAX, MCI, MG Electrical)
  - Per-week team capacity inputs
  - Capacity formula: (SCIO + Team1 + Team2 + ...) - Assigned
✅ External team management (PRG department)
  - Custom provider names
  - Per-week capacity inputs
  - Same advanced capacity formula as BUILD
✅ MFG Department special hours-based mode
  - Direct hours tracking (no people conversion)
  - "Hours per Week" label instead of "SCIO Team Members"
  - Different utilization thresholds

### Work Assignment & Tracking
✅ Stage-based work assignment (14 stages across departments)
✅ Employee selection for hour distribution
✅ Color-coded stage identification
✅ Assignment history per employee (calendar view)
✅ SCIO Team Members weekly capacity inputs
✅ Automatic talent calculation (hours ÷ 45 baseline)

### Visualization & Filtering
✅ Color-coded capacity utilization indicators
  - Green (0–50%): Low utilization
  - Yellow (50–75%): Moderate
  - Red (75–100%): High
  - Pulsing Red (100%+): Over-allocated
✅ Stage color coding (14 unique colors per department)
✅ Department-specific filtering (General view + 6 departments)
✅ Read-only General view (edit in department-specific views)
✅ Legend toggle with comprehensive color reference

### Data & Internationalization
✅ Persistent storage for SCIO team members (localStorage)
✅ Persistent storage for subcontracted/external personnel (localStorage)
✅ Bilingual support (Spanish + English)
  - 150+ translated strings
  - Language toggle in header
✅ Employee status indicators (Internal/External badges)
✅ Project utilization percentage tracking

### User Experience
✅ Responsive design with Tailwind CSS
✅ Department-specific icons (6 unique icons)
✅ Modal-based team addition interface
✅ Quick project creation modal from capacity view
✅ Multi-year support (2024–2027)
✅ Year selector for timeline navigation

---

## Known Limitations

- In-memory data storage (lost on refresh)
- No concurrent edit resolution
- Limited mobile support
- UI may slow with 100+ projects
- No data export/import functionality

---

## Future Enhancements

- Backend API integration for persistence
- User authentication
- Real-time collaboration
- Export/Import features (CSV, Excel)
- Advanced analytics and reporting
- Mobile app
- Dark mode theme

---

## Support

For questions or issues, see:
- [SYSTEM_DOCUMENTATION.md](./SYSTEM_DOCUMENTATION.md)
- [DEPENDENCIES.md](./DEPENDENCIES.md)
- Inline code comments

---

**Last Updated**: January 6, 2026
**Version**: 1.2.1
**Status**: Active Development

---

## Version History

### v1.2.1 (January 6, 2026)
- ✨ **Fixed localStorage persistence** for SCIO team members, subcontracted personnel, and PRG external teams
  - Implemented lazy initialization in useState to load from localStorage on first render
  - Data now persists when switching between department tabs
  - Removed redundant load useEffect hooks
- ✨ Added BUILD department stages to stage selection modal
  - Stages: Cabinets/Frames, Overall Assembly, Fine Tuning, Commissioning, Support
  - Each stage has unique color coding in capacity matrix
- 🔧 Improved Capacity display in General view
  - Now shows calculated capacity values from individual department screens
- 📖 **Comprehensive documentation update**
  - Updated README with detailed project structure
  - Enhanced Technology Stack section
  - Reorganized and expanded Color Coding Reference
  - Restructured Features at a Glance by category
  - Added 375-line translation reference
- 🌐 Verified all translations (150+ strings, ES/EN)
- 🐛 Code analysis & architecture documentation

### v1.2.0 (January 2026)
- ✨ Added subcontracted team management for BUILD department
  - Support for AMI, VICER, ITAX, MCI, MG Electrical teams
  - Modal-based team addition
  - Per-week capacity inputs
- ✨ Added external team management for PRG department
  - Custom provider names
  - Per-week capacity inputs
  - Same capacity formula as BUILD: (SCIO + Teams) - Assigned
- ✨ Implemented advanced capacity formula across departments
- ✨ Initial localStorage implementation for team persistence
- 🔧 Fixed "Number of Weeks" field in Projects page to allow empty values
- 🔧 Fixed Start Date display format in "Configuration by Department" modal
  - Now displays: "5 January 2026" format consistently
- 📖 Updated documentation with new team management features
- 🌐 Updated translations with corrected grammar, spelling, and capitalization
- 🎨 Improved UI consistency across departments

### v1.1.0 (December 2025)
- ✨ Initial release - MVP with core features
- ✨ Core capacity matrix functionality
  - Interactive matrix view by department & week
  - 52 weeks + 10 next-year weeks support
  - Real-time calculations
- ✨ Department-specific views (6 departments: PM, MED, HD, MFG, BUILD, PRG)
- ✨ Project management (CRUD operations)
- ✨ Employee resource allocation
- ✨ Stage-based work assignment (14 stages)
- ✨ Bilingual support (Spanish + English)
- ✨ Utilization tracking (Quoted vs Used hours)
- ✨ Color-coded capacity indicators
