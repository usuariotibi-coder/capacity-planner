import { useMemo } from 'react';
import Flatpickr from 'react-flatpickr';
import { Spanish } from 'flatpickr/dist/l10n/es';
import type { BaseOptions } from 'flatpickr/dist/types/options';
import { parseISODate } from '../utils/dateUtils';
import 'flatpickr/dist/themes/material_blue.css';

type PickerLanguage = 'es' | 'en';

interface WeekNumberDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  language: PickerLanguage;
  className?: string;
  placeholder?: string;
}

export function WeekNumberDatePicker({
  value,
  onChange,
  language,
  className,
  placeholder,
}: WeekNumberDatePickerProps) {
  const selectedDate = useMemo(() => {
    if (!value) return [];
    const parsed = parseISODate(value);
    return Number.isNaN(parsed.getTime()) ? [] : [parsed];
  }, [value]);

  const options: Partial<BaseOptions> = useMemo(() => ({
    dateFormat: 'Y-m-d',
    allowInput: true,
    weekNumbers: true,
    locale: language === 'es' ? Spanish : undefined,
    disableMobile: true,
    position: 'auto center',
  }), [language]);

  return (
    <Flatpickr
      value={selectedDate}
      options={options}
      onChange={(_, dateStr) => onChange(dateStr || '')}
      className={className}
      placeholder={placeholder}
    />
  );
}

