# Changelog - Team Capacity Planner

## December 2025 - UI Improvements & Optimizations

### Global Panel Redesign
- **Vertical Calendar Layout**: Transformed Global panel from horizontal to vertical calendar format
  - Weeks displayed as columns (W1, W2, etc.)
  - Departments displayed as rows
  - Better visual organization and easier horizontal scrolling

- **Sticky Department Column**: Made department names column immobile during horizontal scrolling
  - Added `sticky left-0 z-10` CSS classes
  - Departments remain visible while browsing through weeks

- **People Needed Calculation**: Simplified cell display in Global panel
  - Changed from showing: hours, employee count, utilization %
  - Now shows only: people needed calculation (hours ÷ 45)
  - Displays with 2 decimal places (e.g., 2.33, 1.50)
  - Color-coded by utilization percentage:
    - 🟢 Green (0-50%): Low utilization
    - 🟡 Yellow (50-75%): Moderate utilization
    - 🟠 Orange (75-100%): High utilization
    - 🔴 Red (100%+): Over-allocated

### UI Text Changes
- **Week Label**: Changed "s" suffix to "weeks" in project headers
  - Now displays: "12 weeks" instead of "12s"
  - Applied in General view project list

### Space Optimization - Hours Section
- **Reduced Font Sizes**: Compressed hours panel display
  - Changed icon size from `text-xs` to `text-[10px]`
  - Changed hours/utilization text from `text-xs` to `text-[10px]`
  - Reduced all font sizes uniformly for compact display

- **Reduced Padding**: Minimized vertical spacing
  - Changed padding from `p-0` to `p-0.5`
  - Maintains readability while reducing overall height

### Visual Improvements
- Maintained color-coded utilization indicators across all views
- Preserved responsive design and accessibility
- All changes built and tested successfully

## Technical Details

### Modified Files
1. **CapacityMatrixPage.tsx**
   - Line 921: Added `sticky left-0 z-10` to department column
   - Line 994: Changed cell display to `(totalWeekHours / 45).toFixed(2)`
   - Line 1028: Changed "s" to "weeks" in week display
   - Lines 1051-1077: Optimized hours panel with smaller fonts and padding

### Code Changes Summary
```typescript
// Global Panel - Department Column (Line 938)
<div className={`w-10 flex-shrink-0 sticky left-0 z-10 flex items-center justify-center text-[8px] font-bold p-0.5 rounded border ${deptIcon.color} bg-white`}>

// Global Panel - People Calculation (Line 994)
{totalWeekHours > 0 ? (
  <div className={`${textColor} font-bold text-[7px]`}>
    {(totalWeekHours / 45).toFixed(2)}
  </div>
) : (
  <div className={`${textColor} text-[6px]`}>—</div>
)}

// Hours Panel - Optimized Display (Line 1051-1077)
<div key={dept} className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded p-0.5 border border-gray-100 text-center">
  <div className="flex items-center justify-center gap-0 mb-0">
    <span className={`text-[10px] ${deptInfo.color}`}>{deptInfo.icon}</span>
  </div>
  <div className="text-[10px] text-gray-700 mb-0 leading-tight">
    <span className="font-semibold text-[10px]">{cotizadasHoursValue}</span>
    <span className="text-gray-500 text-[10px]">/</span>
    <span className="font-semibold text-[10px]">{utilizedHoursValue}</span>
  </div>
  <div className={`px-0 py-0 rounded text-[10px] font-bold text-center leading-none ${utilizationColorInfo.bg} ${utilizationColorInfo.text}`}>
    {utilizationPercent}%
  </div>
</div>
```

## Build Status
- ✅ All changes compiled successfully
- ✅ No TypeScript errors
- ✅ Responsive design maintained
- ✅ All visual elements working correctly

## Features Preserved
- ✅ Zoom controls (50%-200%)
- ✅ Year selector (2024-2027)
- ✅ Current week highlighting
- ✅ Color-coded utilization indicators
- ✅ Department filtering
- ✅ Project expandable sections
- ✅ Capacity calculations
- ✅ Legend and documentation

## Next Steps (Pending)
- Additional UI refinements as needed
- Performance optimization if required
- Further space compression in other sections
- User feedback implementation
