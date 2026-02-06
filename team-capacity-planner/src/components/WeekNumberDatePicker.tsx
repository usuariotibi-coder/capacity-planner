import { useMemo } from 'react';
import Flatpickr from 'react-flatpickr';
import { Spanish } from 'flatpickr/dist/l10n/es';
import type { BaseOptions } from 'flatpickr/dist/types/options';
import { CalendarDays } from 'lucide-react';
import { getWeekNumber, parseISODate } from '../utils/dateUtils';
import 'flatpickr/dist/themes/material_blue.css';
import './WeekNumberDatePicker.css';

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

  const currentWeek = useMemo(() => {
    if (!value) return null;
    const parsed = parseISODate(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return getWeekNumber(value);
  }, [value]);

  const options: Partial<BaseOptions> = useMemo(() => ({
    dateFormat: 'Y-m-d',
    allowInput: true,
    weekNumbers: true,
    locale: language === 'es' ? Spanish : undefined,
    disableMobile: true,
    position: 'auto center',
    monthSelectorType: 'static',
    prevArrow: '<span class="tc-fp-arrow">‹</span>',
    nextArrow: '<span class="tc-fp-arrow">›</span>',
  }), [language]);

  return (
    <div className="tc-week-picker relative w-full">
      <CalendarDays size={16} className="tc-week-picker-icon" />
      <Flatpickr
        value={selectedDate}
        options={options}
        onChange={(_, dateStr) => onChange(dateStr || '')}
        onOpen={(_selectedDates, _dateStr, instance) => {
          instance.calendarContainer.classList.add('tc-week-picker-calendar');
        }}
        className={`${className || ''} tc-week-picker-input !pl-10 !pr-16`}
        placeholder={placeholder}
      />
      {currentWeek !== null && (
        <span className="tc-week-picker-badge">CW {currentWeek}</span>
      )}
    </div>
  );
}
