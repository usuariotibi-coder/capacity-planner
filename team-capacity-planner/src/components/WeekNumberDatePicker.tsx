import { useMemo, useRef } from 'react';
import Flatpickr from 'react-flatpickr';
import { Spanish } from 'flatpickr/dist/l10n/es';
import type { BaseOptions } from 'flatpickr/dist/types/options';
import { CalendarDays, X } from 'lucide-react';
import { formatToISO, getWeekNumber, parseISODate } from '../utils/dateUtils';
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
  const pickerRef = useRef<any>(null);

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
    altInput: true,
    altFormat: language === 'es' ? 'd/m/Y' : 'm/d/Y',
    allowInput: true,
    weekNumbers: true,
    locale: language === 'es' ? Spanish : { firstDayOfWeek: 1 },
    disableMobile: true,
    position: 'auto center',
    monthSelectorType: 'static',
    prevArrow: '<span class="tc-fp-arrow">‹</span>',
    nextArrow: '<span class="tc-fp-arrow">›</span>',
  }), [language]);

  const weekLabel = currentWeek !== null
    ? (language === 'es' ? `Semana ${currentWeek}` : `Week ${currentWeek}`)
    : null;

  const openCalendar = () => {
    pickerRef.current?.flatpickr?.open();
  };

  const clearDate = () => {
    onChange('');
    pickerRef.current?.flatpickr?.clear();
  };

  return (
    <div className="tc-week-picker relative w-full">
      <button
        type="button"
        onClick={openCalendar}
        className="tc-week-picker-icon-btn"
        aria-label={language === 'es' ? 'Abrir calendario' : 'Open calendar'}
      >
        <CalendarDays size={16} className="tc-week-picker-icon" />
      </button>
      <Flatpickr
        ref={pickerRef}
        value={selectedDate}
        options={options}
        onChange={(selectedDates) => {
          if (!selectedDates || selectedDates.length === 0) {
            onChange('');
            return;
          }
          onChange(formatToISO(selectedDates[0]));
        }}
        onOpen={(_selectedDates, _dateStr, instance) => {
          instance.calendarContainer.classList.add('tc-week-picker-calendar');
        }}
        className={`${className || ''} tc-week-picker-input !pl-10 !pr-28`}
        placeholder={placeholder || (language === 'es' ? 'Selecciona una fecha' : 'Select a date')}
      />
      <div className="tc-week-picker-right">
        {value && (
          <button
            type="button"
            onClick={clearDate}
            className="tc-week-picker-clear"
            aria-label={language === 'es' ? 'Limpiar fecha' : 'Clear date'}
            title={language === 'es' ? 'Limpiar fecha' : 'Clear date'}
          >
            <X size={12} />
          </button>
        )}
        {weekLabel && <span className="tc-week-picker-badge">{weekLabel}</span>}
      </div>
    </div>
  );
}
