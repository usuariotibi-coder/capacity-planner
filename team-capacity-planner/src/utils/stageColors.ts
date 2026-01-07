/**
 * STAGE COLORS & TALENT CALCULATION
 *
 * Maps project stages to Tailwind CSS colors for visual differentiation.
 * Also provides talent level calculation from hours.
 */

import type { Stage } from '../types';

/**
 * Stage to Color Mapping
 * Each stage has a unique Tailwind background and text color combination
 * Organized by department for easier maintenance
 *
 * @property bg - Tailwind background color class
 * @property text - Tailwind text color class
 * @property label - Human-readable stage name
 */
export const stageColors: Record<string, { bg: string; text: string; label: string }> = {
  // ========== HD DEPARTMENT STAGES ==========
  SWITCH_LAYOUT_REVISION: { bg: 'bg-purple-100', text: 'text-purple-900', label: 'Switch Layout Revision' },
  CONTROLS_DESIGN: { bg: 'bg-indigo-100', text: 'text-indigo-900', label: 'Controls Design' },

  // ========== MED DEPARTMENT STAGES ==========
  CONCEPT: { bg: 'bg-sky-100', text: 'text-sky-900', label: 'Concept' },
  DETAIL_DESIGN: { bg: 'bg-cyan-100', text: 'text-cyan-900', label: 'Detail Design' },

  // ========== BUILD DEPARTMENT STAGES ==========
  CABINETS_FRAMES: { bg: 'bg-blue-100', text: 'text-blue-900', label: 'Cabinets / Frames' },
  OVERALL_ASSEMBLY: { bg: 'bg-purple-200', text: 'text-purple-900', label: 'Overall Assembly' },
  FINE_TUNING: { bg: 'bg-pink-100', text: 'text-pink-900', label: 'Fine Tuning' },

  // ========== PRG DEPARTMENT STAGES ==========
  OFFLINE: { bg: 'bg-lime-100', text: 'text-lime-900', label: 'Offline' },
  ONLINE: { bg: 'bg-green-100', text: 'text-green-900', label: 'Online' },
  DEBUG: { bg: 'bg-amber-100', text: 'text-amber-900', label: 'Debug' },
  COMMISSIONING: { bg: 'bg-orange-100', text: 'text-orange-900', label: 'Commissioning' },

  // ========== COMMON STAGES (ALL DEPARTMENTS) ==========
  RELEASE: { bg: 'bg-emerald-100', text: 'text-emerald-900', label: 'Release' },
  RED_LINES: { bg: 'bg-red-100', text: 'text-red-900', label: 'Red Lines' },
  SUPPORT: { bg: 'bg-slate-100', text: 'text-slate-900', label: 'Support' },
  SUPPORT_MANUALS_FLOW_CHARTS: { bg: 'bg-stone-100', text: 'text-stone-900', label: 'Support/Manuals/Flow Charts' },
  ROBOT_SIMULATION: { bg: 'bg-zinc-100', text: 'text-zinc-900', label: 'Robot Simulation' },
  STANDARDS_REV_PROGRAMING_CONCEPT: { bg: 'bg-neutral-100', text: 'text-neutral-900', label: 'Standards Rev/Programming Concept' },
};

/**
 * Get Tailwind color classes for a specific stage
 *
 * @param stage - The stage to get colors for (or null for default)
 * @returns Object with bg, text color classes and human-readable label
 *
 * @example
 * const colors = getStageColor('ONLINE');
 * // Returns: { bg: 'bg-green-100', text: 'text-green-900', label: 'Online' }
 */
export function getStageColor(stage: Stage): { bg: string; text: string; label: string } {
  if (!stage) {
    return { bg: 'bg-gray-100', text: 'text-gray-900', label: 'No Stage' };
  }
  return stageColors[stage] || { bg: 'bg-gray-100', text: 'text-gray-900', label: stage };
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
 * - Green (0-50%): Underutilized
 * - Yellow (50-75%): Moderate utilization
 * - Red (75-100%): High utilization - becoming critical
 * - Red Intense (100%+): Over-utilized - OVER BUDGET with animation
 *
 * @param utilizationPercent - Utilization percentage (0-100+)
 * @returns Object with bg and text color classes
 *
 * @example
 * getUtilizationColor(35) // Returns: { bg: 'bg-green-100', text: 'text-green-900' }
 * getUtilizationColor(65) // Returns: { bg: 'bg-yellow-100', text: 'text-yellow-900' }
 * getUtilizationColor(85) // Returns: { bg: 'bg-red-500', text: 'text-white font-bold' }
 * getUtilizationColor(120) // Returns: { bg: 'bg-red-700 animate-pulse', text: 'text-white font-black' } - INTENSE RED
 */
export function getUtilizationColor(utilizationPercent: number): { bg: string; text: string } {
  if (utilizationPercent >= 100) {
    // OVER-ALLOCATED: Intense red with pulse animation to show over budget
    return { bg: 'bg-red-700 animate-pulse shadow-lg', text: 'text-white font-black' };
  }
  if (utilizationPercent >= 75) {
    // High utilization: Red but not pulsing yet
    return { bg: 'bg-red-500', text: 'text-white font-bold' };
  }
  if (utilizationPercent >= 50) {
    return { bg: 'bg-yellow-100', text: 'text-yellow-900' };
  }
  return { bg: 'bg-green-100', text: 'text-green-900' };
}
