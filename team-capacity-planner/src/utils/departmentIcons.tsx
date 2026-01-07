import { Cog, Zap, Cpu, Factory, Wrench, Microchip } from 'lucide-react';
import type { Department } from '../types';

export const departmentIcons: Record<Department, { icon: React.ReactNode; color: string; label: string }> = {
  'MED': {
    icon: <Cog size={18} />,
    color: 'text-blue-600',
    label: 'Diseño Mecánico'
  },
  'HD': {
    icon: <Zap size={18} />,
    color: 'text-yellow-600',
    label: 'Hardware Design'
  },
  'PM': {
    icon: <Cpu size={18} />,
    color: 'text-purple-600',
    label: 'Project Manager'
  },
  'MFG': {
    icon: <Factory size={18} />,
    color: 'text-orange-600',
    label: 'Manufactura'
  },
  'BUILD': {
    icon: <Wrench size={18} />,
    color: 'text-red-600',
    label: 'Ensamble'
  },
  'PRG': {
    icon: <Microchip size={18} />,
    color: 'text-green-600',
    label: 'Programación PLC'
  },
};

export function getDepartmentIcon(dept: Department) {
  return departmentIcons[dept] || { icon: null, color: 'text-gray-600', label: dept };
}
