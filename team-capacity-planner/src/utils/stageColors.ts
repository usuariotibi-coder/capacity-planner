/**
 * STAGE COLORS & TALENT CALCULATION
 *
 * Maps project stages to Tailwind CSS colors for visual differentiation.
 * Also provides talent level calculation from hours.
 */

import type { Department, Stage } from '../types';

/**
 * Stage to Color Mapping
 * Each stage has a unique Tailwind background and text color combination
 * Organized by department for easier maintenance
 *
 * @property bg - Tailwind background color class
 * @property text - Tailwind text color class
 */
export const stageColors: Record<string, { bg: string; text: string }> = {
  // ========== HD DEPARTMENT STAGES ==========
  SWITCH_LAYOUT_REVISION: { bg: 'bg-[#E2F0D9]', text: 'text-slate-900' },
  CONTROLS_DESIGN: { bg: 'bg-[#D9E1F2]', text: 'text-slate-900' },

  // ========== MED DEPARTMENT STAGES ==========
  CONCEPT: { bg: 'bg-[#C6E0B4]', text: 'text-slate-900' },
  DETAIL_DESIGN: { bg: 'bg-[#A9D18E]', text: 'text-slate-900' },

  // ========== BUILD DEPARTMENT STAGES ==========
  CABINETS_FRAMES: { bg: 'bg-[#FBE5D6]', text: 'text-slate-900' },
  OVERALL_ASSEMBLY: { bg: 'bg-[#FFD966]', text: 'text-slate-900' },
  FINE_TUNING: { bg: 'bg-[#FFC000]', text: 'text-slate-900' },

  // ========== PRG DEPARTMENT STAGES ==========
  OFFLINE: { bg: 'bg-[#FFF2CC]', text: 'text-slate-900' },
  ONLINE: { bg: 'bg-[#9DC3E6]', text: 'text-slate-900' },
  DEBUG: { bg: 'bg-[#2E75B6]', text: 'text-white' },
  COMMISSIONING: { bg: 'bg-[#FF0000]', text: 'text-white' },

  // ========== COMMON STAGES (ALL DEPARTMENTS) ==========
  RELEASE: { bg: 'bg-[#70AD47]', text: 'text-white' },
  RED_LINES: { bg: 'bg-[#FF0000]', text: 'text-white' },
  SUPPORT: { bg: 'bg-[#F4CCCC]', text: 'text-slate-900' },
  SUPPORT_MANUALS_FLOW_CHARTS: { bg: 'bg-[#FCE4D6]', text: 'text-slate-900' },
  ROBOT_SIMULATION: { bg: 'bg-[#D9D2E9]', text: 'text-slate-900' },
  STANDARDS_REV_PROGRAMING_CONCEPT: { bg: 'bg-[#EAD1DC]', text: 'text-slate-900' },
};

type NonNullStage = Exclude<Stage, null>;

// Department-specific overrides for legacy spreadsheet compatibility.
// HD uses a dedicated palette in operational artifacts.
const departmentStageColorOverrides: Partial<Record<Department, Partial<Record<NonNullStage, { bg: string; text: string }>>>> = {
  HD: {
    SWITCH_LAYOUT_REVISION: { bg: 'bg-[#D9E1F2]', text: 'text-slate-900' },
    CONTROLS_DESIGN: { bg: 'bg-[#ACB9CA]', text: 'text-slate-900' },
    RELEASE: { bg: 'bg-[#44546A]', text: 'text-white' },
    RED_LINES: { bg: 'bg-[#FF0000]', text: 'text-white' },
    SUPPORT: { bg: 'bg-[#F4CCCC]', text: 'text-slate-900' },
  },
};

/**
 * Stage label keys for translations
 * Maps stage codes to translation keys
 */
export const stageLabelKeys: Record<string, string> = {
  SWITCH_LAYOUT_REVISION: 'stageSwitchLayoutRevision',
  CONTROLS_DESIGN: 'stageControlsDesign',
  CONCEPT: 'stageConcept',
  DETAIL_DESIGN: 'stageDetailDesign',
  CABINETS_FRAMES: 'stageCabinetsFrames',
  OVERALL_ASSEMBLY: 'stageOverallAssembly',
  FINE_TUNING: 'stageFineTuning',
  OFFLINE: 'stageOffline',
  ONLINE: 'stageOnline',
  DEBUG: 'stageDebug',
  COMMISSIONING: 'stageCommissioning',
  RELEASE: 'stageRelease',
  RED_LINES: 'stageRedLines',
  SUPPORT: 'stageSupport',
  SUPPORT_MANUALS_FLOW_CHARTS: 'stageSupportManualsFlowCharts',
  ROBOT_SIMULATION: 'stageRobotSimulation',
  STANDARDS_REV_PROGRAMING_CONCEPT: 'stageStandardsRevProgrammingConcept',
};

/**
 * Get translated stage label
 *
 * @param stage - The stage code
 * @param t - Translation object from useTranslation hook
 * @returns Translated stage label
 */
export function getStageLabel(stage: Stage, t: Record<string, string>): string {
  if (!stage) {
    return t.stageNone || 'No Stage';
  }
  const key = stageLabelKeys[stage];
  if (key && t[key]) {
    return t[key];
  }
  // Fallback: convert underscores to spaces and capitalize
  return stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Get Tailwind color classes for a specific stage
 *
 * @param stage - The stage to get colors for (or null for default)
 * @returns Object with bg and text color classes
 *
 * @example
 * const colors = getStageColor('ONLINE');
 * // Returns: { bg: 'bg-green-100', text: 'text-green-900' }
 */
export function getStageColor(stage: Stage, department?: Department): { bg: string; text: string } {
  if (!stage) {
    return { bg: 'bg-gray-100', text: 'text-gray-900' };
  }

  if (department) {
    const override = departmentStageColorOverrides[department]?.[stage as NonNullStage];
    if (override) return override;
  }

  return stageColors[stage] || { bg: 'bg-gray-100', text: 'text-gray-900' };
}

/**
 * Calculate talent level from hours
 *
 * Converts total hours to talent level units.
 * Baseline: 45 hours = 1.0 talent unit
 * Example: 90 hours = 2.0 talent (full-time equivalent)
 *
 * @param hours - Total hours allocated
 * @returns Talent level (normalized to 45-hour baseline)
 *
 * @example
 * calculateTalent(45) // Returns: 1
 * calculateTalent(90) // Returns: 2
 * calculateTalent(22.5) // Returns: 0.5
 */
export function calculateTalent(hours: number): number {
  return parseFloat((hours / 45).toFixed(2));
}

/**
 * Get color classes based on utilization percentage
 *
 * Color scale:
 * - Green (<70%): Underutilized
 * - Yellow (70-89%): Moderate utilization
 * - Red (90-99%): High utilization - becoming critical
 * - Red Intense (100%+): Over-utilized - OVER BUDGET with animation
 *
 * @param utilizationPercent - Utilization percentage (0-100+)
 * @returns Object with bg and text color classes
 *
 * @example
 * getUtilizationColor(35) // Returns: { bg: 'bg-green-100', text: 'text-green-900' }
 * getUtilizationColor(75) // Returns: { bg: 'bg-yellow-100', text: 'text-yellow-900' }
 * getUtilizationColor(95) // Returns: { bg: 'bg-red-500', text: 'text-white font-bold' }
 * getUtilizationColor(120) // Returns: { bg: 'bg-red-700 animate-pulse', text: 'text-white font-black' } - INTENSE RED
 */
export function getUtilizationColor(utilizationPercent: number): { bg: string; text: string } {
  if (utilizationPercent >= 100) {
    // OVER-ALLOCATED: Intense red with pulse animation to show over budget
    return { bg: 'bg-red-700 animate-pulse shadow-lg', text: 'text-white font-black' };
  }
  if (utilizationPercent >= 90) {
    // High utilization: Red but not pulsing yet
    return { bg: 'bg-red-500', text: 'text-white font-bold' };
  }
  if (utilizationPercent >= 70) {
    return { bg: 'bg-yellow-100', text: 'text-yellow-900' };
  }
  return { bg: 'bg-green-100', text: 'text-green-900' };
}
