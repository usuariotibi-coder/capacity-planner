import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import type { PasswordCriteria } from '../utils/passwordValidation';

interface PasswordRequirementsChecklistProps {
  criteria: PasswordCriteria;
  t: any;
  variant?: 'dark' | 'light';
}

export const PasswordRequirementsChecklist: React.FC<PasswordRequirementsChecklistProps> = ({
  criteria,
  t,
  variant = 'dark',
}) => {
  const isLight = variant === 'light';

  const items = [
    {
      key: 'minLength',
      met: criteria.minLength,
      label: t.passwordRuleMinLength || 'At least 8 characters',
    },
    {
      key: 'uppercase',
      met: criteria.uppercase,
      label: t.passwordRuleUppercase || 'At least one uppercase letter',
    },
    {
      key: 'lowercase',
      met: criteria.lowercase,
      label: t.passwordRuleLowercase || 'At least one lowercase letter',
    },
    {
      key: 'number',
      met: criteria.number,
      label: t.passwordRuleNumber || 'At least one number',
    },
    {
      key: 'special',
      met: criteria.special,
      label: t.passwordRuleSpecial || 'At least one special character',
    },
  ];

  return (
    <div
      className={`mt-2 rounded-lg p-3 space-y-1.5 ${
        isLight
          ? 'border border-[#ddd9e5] bg-white'
          : 'border border-zinc-700/70 bg-zinc-900/40'
      }`}
    >
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2">
          {item.met ? (
            <CheckCircle2
              size={14}
              className={`${isLight ? 'text-emerald-600' : 'text-emerald-400'} flex-shrink-0`}
            />
          ) : (
            <Circle
              size={14}
              className={`${isLight ? 'text-[#a7a1b6]' : 'text-zinc-500'} flex-shrink-0`}
            />
          )}
          <span
            className={`text-xs ${
              item.met
                ? isLight
                  ? 'text-emerald-700'
                  : 'text-emerald-300'
                : isLight
                  ? 'text-[#6f6782]'
                  : 'text-zinc-400'
            }`}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
};
