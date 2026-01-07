# Complete Changelog - Team Capacity Planner

All notable changes to this project will be documented in this file.

## [1.2.1] - January 6, 2026

### ✨ Features Added

#### 1. **localStorage Persistence Fix** (CRITICAL)
- **Issue**: Data in "SCIO Team Members" and "Hours per Week" fields disappeared when switching department tabs
- **Root Cause**: useState initializers with empty objects were overwriting loaded data from localStorage
- **Solution**: Implemented lazy initialization functions in useState hooks
  - Moved all localStorage loading logic into useState initializer functions
  - Data loads on first component render, before any state updates
  - Removed redundant useEffect load hooks (kept only save hooks)
- **Files Modified**: `src/pages/CapacityMatrixPage.tsx` (lines 62-121)
- **Impact**: SCIO team members, subcontracted personnel, and PRG external teams now persist correctly across tab switches

#### 2. **BUILD Department Stages**
- Added 5 new stage options for BUILD department:
  - `CABINETS_FRAMES` → Blue (100/900)
  - `OVERALL_ASSEMBLY` → Purple (200/900)
  - `FINE_TUNING` → Pink (100/900)
  - `COMMISSIONING` → Orange (100/900)
  - `SUPPORT` → Slate (100/900)
- Updated `STAGE_OPTIONS` constant in CapacityMatrixPage.tsx
- Files Modified:
  - `src/pages/CapacityMatrixPage.tsx` (line 23)
  - `src/utils/stageColors.ts` (lines 28-31)
- Impact: BUILD department now has full stage selection in capacity matrix

#### 3. **Capacity Display in General View**
- Fixed Capacity row to show calculated values instead of empty dashes
- Now displays the same capacity calculations as individual department views
- Formula: (SCIO Team Members + External Teams) - Total Assigned Hours
- Files Modified: `src/pages/CapacityMatrixPage.tsx` (line 1237)

### 🔧 Bug Fixes

#### 1. **localStorage Implementation Refactor**
- **Before**: Separate load/save useEffect hooks caused race conditions
- **After**: Single lazy initialization + save useEffects
- **Code Pattern**:
  ```typescript
  const [scioTeamMembers, setScioTeamMembers] = useState(() => {
    const saved = localStorage.getItem('scioTeamMembers');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading scioTeamMembers from localStorage', e);
      }
    }
    return { 'PM': {}, 'MED': {}, 'HD': {}, 'MFG': {}, 'BUILD': {}, 'PRG': {} };
  });
  ```

### 📖 Documentation Updates

#### 1. **README.md Comprehensive Update**
- Updated Project Structure with detailed file descriptions and line counts
- Enhanced Technology Stack section:
  - Added Core Technologies table with 8 technologies
  - Added Development Tools table
  - Added Architecture Highlights subsection
  - Expanded "What This Architecture Means" with 6 pros/cons
- Reorganized Color Coding Reference:
  - Separated Utilization Percentage Colors from Capacity Utilization Colors
  - Added Work Stage Colors with all 14 stages listed
  - Included Tailwind color values (100/900 notation)
- Restructured Features at a Glance by category:
  - Core Capacity Planning (6 features)
  - Project & Resource Management (7 features)
  - Advanced Features (7 features)
  - Work Assignment & Tracking (6 features)
  - Visualization & Filtering (4 features)
  - Data & Internationalization (5 features)
  - User Experience (5 features)
- Updated Version History with detailed v1.2.1 notes
- Updated version badge from 1.1.0 → 1.2.1

#### 2. **SYSTEM_DOCUMENTATION.md Update**
- Updated Current Version: v1.1.0 → v1.2.1 (January 6, 2026)

#### 3. **Translation Verification**
- Verified all 150+ translation strings in both Spanish and English
- No spelling or grammar errors found
- All UI labels correctly translated
- Stage names properly localized

### 🌐 Internationalization Status
- Spanish translations: ✅ Complete (375 lines)
- English translations: ✅ Complete (375 lines)
- Translation coverage: 150+ strings
- Language toggle: Fully functional (EN/ES)

### 📊 Code Statistics (v1.2.1)
| Component | Lines | Status |
|-----------|-------|--------|
| CapacityMatrixPage.tsx | 2,264 | Updated |
| ProjectsPage.tsx | 573 | No change |
| ResourcesPage.tsx | 530 | No change |
| projectStore.ts | 138 | No change |
| employeeStore.ts | 109 | No change |
| assignmentStore.ts | 85 | No change |
| translations.ts | 375 | Verified |
| stageColors.ts | 116 | Updated |
| dateUtils.ts | 120 | No change |
| App.tsx | 157 | No change |
| **Total** | **~4,267** | **Updated** |

### 🐛 Known Issues Resolved
1. ✅ SCIO Team Members data disappearing on tab switch
2. ✅ Hours per Week (MFG) data not persisting
3. ✅ External teams data not persisting in PRG
4. ✅ Subcontracted teams data not persisting in BUILD
5. ✅ Capacity display showing empty in General view

### 🔍 Quality Assurance
- ✅ Full TypeScript compilation
- ✅ No console errors
- ✅ localStorage persistence verified
- ✅ All 6 departments functional
- ✅ Stage selection modal working
- ✅ Capacity calculations accurate

---

## [1.2.0] - January 2026

### ✨ Features Added

#### 1. **BUILD Department - Subcontracted Teams Management**
- Add/delete custom subcontracted team names
- Support for: AMI, VICER, ITAX, MCI, MG Electrical
- Per-week team capacity inputs
- Advanced capacity formula: (SCIO + Teams) - Assigned
- Modal-based team addition interface

#### 2. **PRG Department - External Teams Management**
- Add/delete custom external team providers
- Per-week capacity inputs
- Same capacity formula as BUILD: (SCIO + Teams) - Assigned
- Modal-based team addition interface

#### 3. **localStorage Implementation**
- SCIO Team Members persistence
- Subcontracted Personnel persistence (BUILD)
- PRG External Personnel persistence
- Data survives page refresh (partial persistence)

### 🔧 Bug Fixes

#### 1. **"Number of Weeks" Field Validation**
- Fixed field to allow empty values
- Validation limited to max 52 weeks
- Can now be cleared properly

#### 2. **Start Date Display Format**
- Fixed "Configuration by Department" modal
- Now displays: "5 January 2026" format
- Consistent with user input (YYYY-MM-DD → "Day Month Year")

### 📖 Documentation
- Updated README with team management features
- Added subcontracted/external team descriptions
- Updated capacity formula documentation

### 🌐 Translation Updates
- Added 10+ new translation keys for team management
- Updated Spanish/English translations with corrections
- Grammar and spelling improvements

---

## [1.1.0] - December 2025

### ✨ Initial Release - MVP Features

#### Core Capacity Planning
- Interactive capacity matrix (62 weeks: 52 + 10)
- Department-specific views (6 departments)
- Real-time capacity calculations
- Current week highlighting
- Zoom controls (per-project + global)

#### Project Management
- Full CRUD operations
- Department-specific configurations
- Budget hours allocation (Quoted Hours)
- Used hours tracking (manual entry)
- Utilization percentage calculations

#### Resource Management
- Employee CRUD operations
- Department assignment
- Capacity inputs (hours/week)
- Assignment history calendar view
- 9 mock employees provided

#### Work Assignment
- 14 stage types across departments
- Stage color coding
- Employee selection for assignments
- Talent level calculation (hours ÷ 45)

#### Visualization
- Color-coded capacity indicators:
  - Green (0-50%): Low
  - Yellow (50-75%): Moderate
  - Red (75-100%): High
  - Pulsing Red (100%+): Critical
- 14 unique stage colors per department
- Department filtering (General + 6 depts)
- Legend toggle

#### Internationalization
- Full Spanish support
- Full English support
- 150+ translated strings
- Language toggle in header

#### User Experience
- Responsive design (Tailwind CSS)
- 6 department icons (lucide-react)
- Modal dialogs for CRUD
- Multi-year support (2024-2027)
- Year/week selectors

### 📊 Technical Stack
- React 19.2.0
- TypeScript 5.9.3
- Vite 7.2.4
- Zustand 5.0.9
- Tailwind CSS 3.4.19
- date-fns 4.1.0
- lucide-react 0.562.0

### 📋 Mock Data
- 9 employees (3-6 per department)
- 3 sample projects
- 6 sample assignments
- 3 sample facilities (AL, MI, MX)

---

## Architecture & Technical Debt

### Known Limitations
1. **Data Persistence**: Full refresh loses all project/employee data (only SCIO/teams persist)
2. **Single User**: No concurrent edit resolution
3. **No Audit Trail**: No historical change tracking
4. **In-Memory Only**: No backend database
5. **Mobile**: Limited mobile support

### Future Improvements
1. Backend API integration for full persistence
2. User authentication & role-based access
3. Data export (CSV, PDF)
4. Advanced analytics & reporting
5. Real-time collaboration
6. Mobile app version
7. Dark mode theme

---

## Development Notes

### State Management Architecture
```
App.tsx
├── CapacityMatrixPage
│   ├── useEmployeeStore (read/write)
│   ├── useAssignmentStore (read/write)
│   ├── useProjectStore (read/write)
│   ├── useBuildTeamsStore (read/write)
│   ├── usePRGTeamsStore (read/write)
│   └── localStorage: scioTeamMembers, subcontractedPersonnel, prgExternalPersonnel
├── ResourcesPage
│   └── All stores (various access patterns)
└── ProjectsPage
    └── Project, Assignment, Employee stores
```

### localStorage Schema (v1.2.1)
```javascript
localStorage.scioTeamMembers = {
  "PM": { "2026-01-06": 3, "2026-01-13": 3, ... },
  "MED": { "2026-01-06": 2, "2026-01-13": 3, ... },
  "HD": { ... },
  "MFG": { ... },
  "BUILD": { ... },
  "PRG": { ... }
}

localStorage.subcontractedPersonnel = {
  "AMI": { "2026-01-06": 2, ... },
  "VICER": { ... },
  "ITAX": { ... },
  "MCI": { ... },
  "MG Electrical": { ... }
}

localStorage.prgExternalPersonnel = {
  "CustomTeam1": { "2026-01-06": 1, ... },
  "CustomTeam2": { ... }
}
```

### Type System
- 6 Department types: PM, MED, HD, MFG, BUILD, PRG
- 14 Stage types (department-specific)
- 3 Facility types: AL, MI, MX
- Full TypeScript coverage, no `any` types

---

## Build & Deployment

### Development
```bash
npm run dev        # Start dev server (Vite)
npm run build      # TypeScript + Vite build
npm run lint       # ESLint check
npm run preview    # Preview production build
```

### Production Notes
- Single static bundle (HTML + CSS + JS)
- ~100KB minified + gzipped
- No backend server required
- Works offline (except API calls)
- localStorage provides temporary persistence

---

**Last Updated**: January 6, 2026
**Current Version**: 1.2.1
**Status**: Active Development
