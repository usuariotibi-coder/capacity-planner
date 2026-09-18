# Quick Reference Guide - Team Capacity Planner

## Navigation Overview

```
┌─────────────────────────────────────────────────────────┐
│  [Capacity Matrix]  [Resources]  [Projects]    [EN/ES]  │
├─────────────────────────────────────────────────────────┤
│  Viewing: [General ▼]  [2026 ▼]  [W1]  [Legend ▼]      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│               Main Content Area                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Department Views

### Available Departments

| Code | Name | Calculation Mode |
|------|------|------------------|
| **PM** | Project Manager | People (hours ÷ 45) |
| **MED** | Mechanical Design | People (hours ÷ 45) |
| **HD** | Hardware Design | People (hours ÷ 45) |
| **MFG** | Manufacturing | **Hours (direct)** |
| **BUILD** | Assembly | People (hours ÷ 45) |
| **PRG** | Programming PLC | People (hours ÷ 45) |

### MFG Special Mode
- Shows hours directly (not converted to people)
- Label: "Hours per Week" instead of "SCIO Team Members"
- No employee selection in assignment modal
- Different color thresholds

---

## Capacity Matrix Layout

### General View
```
┌─────────────────────────────────────────────────────────┐
│ Global - Weekly Capacity                                │
├─────────┬──────┬──────┬──────┬──────┬──────┬──────┬────┤
│ Dept    │  W1  │  W2  │  W3  │  W4  │  W5  │  W6  │... │
├─────────┼──────┼──────┼──────┼──────┼──────┼──────┼────┤
│ PM      │ 1.00 │ 0.67 │ 2.33 │ 1.50 │ 0.89 │ 2.00 │    │
│ MED     │ 1.33 │ 2.00 │ 1.67 │ 0.56 │ 1.89 │ 1.11 │    │
│ HD      │ 2.00 │ 1.50 │ 0.78 │ 2.22 │ 1.44 │ 0.67 │    │
│ MFG     │  90h │ 120h │  80h │ 100h │  95h │ 110h │    │
│ BUILD   │ 1.67 │ 0.44 │ 1.11 │ 2.44 │ 1.22 │ 1.33 │    │
│ PRG     │ 1.50 │ 2.00 │ 0.98 │ 1.67 │ 2.11 │ 0.56 │    │
└─────────┴──────┴──────┴──────┴──────┴──────┴──────┴────┘
```

### Department-Specific View
```
┌─────────────────────────────────────────────────────────┐
│ MED - Weekly Occupancy Total                            │
├─────────────┬──────┬──────┬──────┬──────┬──────┬───────┤
│ Persons     │  W1  │  W2  │  W3  │  W4  │  W5  │ ...   │
├─────────────┼──────┼──────┼──────┼──────┼──────┼───────┤
│ Total       │ 1.33 │ 2.00 │ 1.67 │ 0.56 │ 1.89 │       │
│ SCIO Members│  [3] │  [3] │  [3] │  [3] │  [3] │       │ ← Editable
│ Capacity    │ 1.67 │ 1.00 │ 1.33 │ 2.44 │ 1.11 │       │
└─────────────┴──────┴──────┴──────┴──────┴──────┴───────┘

Projects:
┌─────────────────────────────────────────────────────────┐
│ JOB-001 | Client A | Quoted: 150h | Used: 120h | 80%   │
├─────────────┬──────┬──────┬──────┬──────┬──────┬───────┤
│ Init │ W1  │  W2  │  W3  │  W4  │  W5  │ ...          │
│ 1    │ 8h  │ 16h  │ 12h  │  8h  │ 10h  │              │
└─────────────┴──────┴──────┴──────┴──────┴──────┴───────┘
```

---

## Color Coding Reference

### Capacity Utilization (Non-MFG)

| People | Color | Status |
|--------|-------|--------|
| < 2.5 | 🟢 Green | Low |
| 2.5 - 5 | 🟡 Yellow | Moderate |
| 5 - 8 | 🟠 Orange | High |
| ≥ 8 | 🔴 Red | Critical |

### Capacity Utilization (MFG - Hours)

| Hours | Color | Status |
|-------|-------|--------|
| < 112.5 | 🟢 Green | Low |
| 112.5 - 225 | 🟡 Yellow | Moderate |
| 225 - 360 | 🟠 Orange | High |
| ≥ 360 | 🔴 Red | Critical |

### Utilization Percentage

| Percentage | Color | Status |
|------------|-------|--------|
| 0-50% | 🟢 Green | Under-utilized |
| 50-75% | 🟡 Yellow | Balanced |
| 75%+ | 🔴 Red | High utilization |

---

## Common Tasks

### 1. Create a New Project
1. Go to **Projects** page
2. Click **"ADD NEW JOB"**
3. Fill in: Name, Client, Start Date, Weeks, Facility
4. Set budget hours per department
5. Configure department start dates and durations
6. Click **"Create Project"**

### 2. Assign Hours to a Project
1. Go to **Capacity Matrix**
2. Select a department (e.g., MED)
3. Find your project in the list
4. Click on a week cell
5. Enter hours in the modal
6. Select stage (if applicable)
7. Select employees to distribute hours
8. Click **"Save"**

### 3. Edit Used Hours
1. In department view, find project card
2. Click the pencil icon (✏️) next to "Used"
3. Enter actual hours used
4. Click **"Save"**
5. Utilization % updates automatically

### 4. Configure Weekly Capacity
1. In department view, find "SCIO Team Members" row
2. Click on a week cell (input field)
3. Enter number of available people (or hours for MFG)
4. "Capacity" row updates: SCIO - Occupied

### 5. View Current Week
1. Current week is highlighted with red ring
2. Badge shows "W[number]" in header
3. All current week cells have red border

---

## Visual Indicators

| Indicator | Meaning |
|-----------|---------|
| 🔴 Red ring | Current week |
| ⚠️ Warning icon | Week out of project range |
| "Init" label | Department start week |
| "1", "2", "3"... | Week number within department timeline |
| ✏️ Pencil icon | Edit Used Hours |

---

## Zoom Controls

| Level | Use Case |
|-------|----------|
| 50% | See many weeks at once |
| 75% | Compact view |
| 100% | Default |
| 150% | Detailed view |
| 200% | Maximum detail |

Each project has independent zoom controls.

---

## Keyboard/Mouse Actions

| Action | Result |
|--------|--------|
| Horizontal Scroll | Navigate between weeks |
| Click Project Header | Expand/Collapse |
| Click Department | Switch to department view |
| Click Week Cell | Open edit modal |
| Click Zoom +/- | Adjust project zoom |
| Click Year Dropdown | Change year (2024-2027) |
| Click Legend | Expand/Collapse legend |

---

## Calculations

### Talent Conversion
```
People = Hours ÷ 45
```
Example: 90 hours = 2.00 people

### Capacity Available
```
Capacity = SCIO Team Members - Occupied
```
Example: 3 people - 1.5 occupied = 1.5 available

### Utilization Percentage
```
Utilization % = (Used Hours ÷ Quoted Hours) × 100
```
Example: 120 used ÷ 150 quoted = 80%

---

## Troubleshooting

### Issue: Cannot see Global Panel
**Solution**: Click "Show Global" button or select "General" view

### Issue: Numbers are too small
**Solution**: Use Zoom controls (+/-) to increase size

### Issue: Cannot edit cells
**Solution**: Make sure you're in a department-specific view, not General

### Issue: Colors not updating
**Solution**: Refresh page; data is recalculated on load

### Issue: Data lost after refresh
**Note**: Application uses in-memory storage. All data is temporary.

---

## Language Toggle

- 🍔 = English
- 🌮 = Spanish

Located in the header. Default: English

---

## References

- **README.md** - Overview and setup
- **SYSTEM_DOCUMENTATION.md** - Technical details
- **DEPENDENCIES.md** - Dependencies and installation
- **UTILIZATION_GUIDE.md** - Utilization tracking guide

---

*Last Updated: December 2025*
*Version: 1.1.0*
