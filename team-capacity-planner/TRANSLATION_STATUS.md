# Translation Status Report

## Overview

This document outlines the translation work completed and remaining for the Team Capacity Planner application. The application is being converted from mixed Spanish/English to full bilingual support with default English.

---

## Translation Keys Added

A comprehensive set of 40+ new translation keys have been added to `src/utils/translations.ts` to support additional UI elements. These keys cover:

### Navigation & Headers
- `teamCapacity` - Team Capacity / Capacidad del Equipo
- `teamCapacityPlanner` - Team Capacity Planner / Planificador de Capacidad del Equipo
- `plannerSubtitle` - Planner / Planificador
- `hideSidebar` / `showSidebar` - Sidebar visibility toggles

### Controls & Buttons
- `zoomOut` / `zoomIn` - Zoom controls
- `toggleLegend` - Legend toggle
- `zoomLabel` - "Zoom:" label
- `quotedLabel` / `usedLabel` - Hours labels
- `utilizationLabel` - Utilization display

### Placeholders
- `egJohnDoe` - Example: John Doe / Ej: Juan Pérez
- `egDesignEngineer` - Example: Design Engineer / Ej: Ingeniero de Diseño
- `egRefreshDashboard` - Example: Refresh Dashboard / Ej: Actualizar Panel
- `egAcmeCorpDesign` - Example: ACME Corp - Redesign UI / Ej: ACME Corp - Diseñar IU

### Abbreviations
- `sem` - Week abbreviation (Spanish)
- `wk` - Week abbreviation (English)
- `hoursPerSemWeek` - Hours per week notation (h/sem, h/w)

### UI Elements
- `stageName` - Stage to Assign / Etapa a Asignar
- `noStageMessage` - No stage assigned / Sin etapa asignada
- `projectsSection` - Projects / Proyectos
- `capacityPanel` - Capacity Panel / Panel de Capacidad
- `hidePanelTooltip` / `showPanelButton` - Panel visibility
- `editedUsedHoursTitle` - Edit Used Hours / Editar Horas Utilizadas
- `capacidadParalaSemana` - Capacity for week / Capacidad para la semana

### Legend Items
- `globalPanelTitle` - Global Panel - Colors by Utilization
- `percentLow` / `percentModerate` / `percentHigh` / `percentCritical` - Utilization ranges
- `noDataLegend` / `hoursLegend` / `noAssignmentsLegend` - Legend items
- `withinRangeLegend` / `currentWeekLegend` / `outOfRangeLegend` - Range indicators

### Department Names (Full)
- `mechanicalDesign` - Mechanical Design / Diseño Mecánico
- `hardwareDesign` - Hardware Design / Diseño de Hardware
- `projectManager` - Project Manager / Gerente de Proyecto
- `manufacturing` - Manufacturing / Manufactura
- `assembly` - Assembly / Ensamble
- `programmingPLC` - Programming PLC / Programación PLC

---

## Status: Code Implementation Remaining

While all translation keys have been added to `translations.ts`, the following files still need to be updated to USE these new keys instead of hard-coded strings:

### 1. App.tsx
**Items to translate:**
- "Team Capacity" → `t.teamCapacity`
- "Planner" → `t.plannerSubtitle`
- "Team Capacity Planner v1.0" → Use `t.teamCapacityPlanner`
- "Hide sidebar" tooltip → `t.hideSidebar`
- "Show sidebar" tooltip → `t.showSidebar`
- "Español" button → Already uses emoji, keep
- "English" button → Already uses emoji, keep

**Lines to update:** ~50-133

---

### 2. ResourcesPage.tsx
**Items to translate:**
- "E.g.: John Doe" → `t.egJohnDoe` (line 166)
- "E.g.: Design Engineer" → `t.egDesignEngineer` (line 176)
- "sem" / "wk" abbreviations → `t.sem` / `t.wk` (line 262)
- Department names in headers → Use `getDepartmentIcon()` labels or new `t.mechanicalDesign`, etc.

**Lines to update:** ~160-270

---

### 3. ProjectsPage.tsx
**Items to translate:**
- "E.g.: Refresh Dashboard" → `t.egRefreshDashboard` (line 327)
- "E.g.: ACME Corp - Redesign UI" → `t.egAcmeCorpDesign` (line 337)
- Numeric placeholders "0" → Keep as is (no translation needed)

**Lines to update:** ~320-450

---

### 4. CapacityMatrixPage.tsx
**Items to translate (HIGH PRIORITY - Most changes needed):**

#### Header Section (lines 579-634)
- "General View" → `t.generalView`
- "Zoom out" → `t.zoomOut`
- "Zoom in" → `t.zoomIn`
- "Toggle Legend" → `t.toggleLegend`
- "Leyenda" → `t.legend` (already exists)

#### Cell Editing Modal (lines 352-460)
- "Sem" abbreviation → `t.sem`
- "Etapa a Asignar:" → `t.stageName`
- "Sin etapa asignada" → `t.noStageMessage`
- "Hours" → `t.hours` (already exists)
- "Select Stage" → `t.selectStage` (already exists)
- "No stage" → `t.noStage` (already exists)
- "Available Resources" → `t.availableResources` (already exists)
- "h/sem" unit → `t.hoursPerSemWeek`
- "recurso/recursos seleccionado/s" → `t.resourceSelected` / `t.resourcesSelected` (already exist)
- "Guardar" → `t.save` (already exists)
- "Cancelar" → `t.cancel` (already exists)

#### Department View (lines 881-1358)
- "Proyectos" → `t.projectsSection`
- "Zoom:" → `t.zoomLabel`
- "Zoom Out" → `t.zoomOut`
- "Zoom In" → `t.zoomIn`
- "Quoted" → `t.quotedLabel`
- "Used" → `t.usedLabel`
- "Edit used hours" → `t.editUsedHours` (already exists)
- "Utilización" → `t.utilizationLabel`
- "Z:" → `t.zoomLabel`
- "Edit Used Hours" → `t.editedUsedHoursTitle`
- "Capacidad para la semana" → `t.capacidadParalaSemana`

#### General View (lines 1127-1587)
- "Capacity" → `t.capacityLabel` (already exists)
- "Hide Capacity panel" → `t.hidePanelTooltip`
- "Show Capacity panel" → `t.hidePanelTooltip`
- "Show Capacity" → `t.showPanelButton`
- "Projects Matrix" → `t.projectsMatrix` (already exists)
- "Dpto" → `t.dpto` (already exists)
- "Init" → `t.init` (already exists)
- "Available:" → Use `t.availableCapacity`

#### Legend Items (lines 1543-1587)
- "Global Panel - Colors by Utilization" → `t.globalPanelTitle`
- "0-50% (Low)" → `t.percentLow`
- "50-75% (Moderate)" → `t.percentModerate`
- "75-100% (High)" → `t.percentHigh`
- "100%+ (Critical)" → `t.percentCritical`
- "No data" → `t.noDataLegend`
- "Hours" → `t.hoursLegend`
- "No assignments" → `t.noAssignmentsLegend`
- "Within range" → `t.withinRangeLegend`
- "Current week" → `t.currentWeekLegend`
- "Out of range" → `t.outOfRangeLegend`

---

### 5. departmentIcons.tsx
**Items to translate:**
Department labels are currently hard-coded. Should use translation keys:
- "Diseño Mecánico" → `t.mechanicalDesign` (line 8)
- "Hardware Design" → `t.hardwareDesign` (line 13)
- "Project Manager" → `t.projectManager` (line 18)
- "Manufactura" → `t.manufacturing` (line 23)
- "Ensamble" → `t.assembly` (line 28)
- "Programación PLC" → `t.programmingPLC` (line 33)

**Note:** This file exports a constant, so translations would need to be applied at runtime rather than at definition time. Alternative: Keep the current approach and update translations.ts to match all languages.

---

## Implementation Priority

### Priority 1 (Critical)
- CapacityMatrixPage.tsx - Most user-facing text
- App.tsx - Main navigation labels

### Priority 2 (High)
- departmentIcons.tsx - Department labels appear throughout
- ResourcesPage.tsx - Form placeholders and abbreviations
- ProjectsPage.tsx - Form placeholders

### Priority 3 (Medium)
- Tooltip translations
- Legend item translations

---

## Quick Implementation Checklist

- [ ] Update App.tsx to use translation keys
- [ ] Update ResourcesPage.tsx to use translation keys
- [ ] Update ProjectsPage.tsx to use translation keys
- [ ] Update CapacityMatrixPage.tsx (MAIN FILE - ~40+ changes)
- [ ] Update departmentIcons.tsx to use translation keys
- [ ] Test all UI in both English and Spanish
- [ ] Verify abbreviations display correctly in both languages
- [ ] Test all modals and tooltips for translation

---

## Notes

1. **Existing Translations**: Many keys already exist in translations.ts. Only NEW keys needed to be added (40+).

2. **Mixed Status**: Currently, some parts of the app use translations (buttons like Save/Cancel) while others use hard-coded strings (abbreviations like "W", "Dpto").

3. **Default Language**: Application now defaults to English ('en') as set in LanguageContext.tsx.

4. **Abbreviations**: Week abbreviations differ by language:
   - Spanish: "sem" (semana)
   - English: "W"

5. **Department Names**: The departmentIcons.tsx file contains hard-coded labels that should be translatable. Current options:
   - Option A: Refactor departmentIcons to fetch labels from translations at runtime
   - Option B: Update translations.ts to match both languages for all department names

---

## Files Modified

- `src/utils/translations.ts` - Added 40+ new translation keys ✅

## Files Needing Updates

- `src/App.tsx` - ~7 items
- `src/pages/ResourcesPage.tsx` - ~4 items
- `src/pages/ProjectsPage.tsx` - ~3 items
- `src/pages/CapacityMatrixPage.tsx` - ~50+ items
- `src/utils/departmentIcons.tsx` - 6 department labels

---

*Document Created: December 2025*
*Total Translation Keys: 290+ (250 existing + 40 new)*
*Implementation Status: Translation keys ready, code integration remaining*
