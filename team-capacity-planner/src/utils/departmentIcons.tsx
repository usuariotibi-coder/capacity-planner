import { Cog, Zap, Cpu, Factory, Wrench, Microchip } from 'lucide-react';
import type { Department } from '../types';

/**
 * Department icons and colors configuration
 */
export const departmentIcons: Record<Department, { icon: React.ReactNode; color: string }> = {
  'MED': {
    icon: <Cog size={18} />,
    color: 'text-blue-600',
  },
  'HD': {
    icon: <Zap size={18} />,
    color: 'text-yellow-600',
  },
  'PM': {
    icon: <Cpu size={18} />,
    color: 'text-purple-600',
  },
  'MFG': {
    icon: <Factory size={18} />,
    color: 'text-orange-600',
  },
  'BUILD': {
    icon: <Wrench size={18} />,
    color: 'text-red-600',
  },
  'PRG': {
    icon: <Microchip size={18} />,
    color: 'text-green-600',
  },
};

/**
 * Department label translation keys
 */
export const departmentLabelKeys: Record<Department, string> = {
  'MED': 'mechanicalDesign',
  'HD': 'hardwareDesign',
  'PM': 'projectManager',
  'MFG': 'manufacturing',
  'BUILD': 'assembly',
  'PRG': 'programmingPLC',
};

/**
 * Get translated department label
 *
 * @param dept - The department code
 * @param t - Translation object from useTranslation hook
 * @returns Translated department label
 */
export function getDepartmentLabel(dept: Department, t: Record<string, string>): string {
  const key = departmentLabelKeys[dept];
  if (key && t[key]) {
    return t[key];
  }
  return dept;
}

/**
 * Get department icon and color
 *
 * @param dept - The department code
 * @returns Object with icon and color
 */
export function getDepartmentIcon(dept: Department) {
  return departmentIcons[dept] || { icon: null, color: 'text-gray-600' };
}
