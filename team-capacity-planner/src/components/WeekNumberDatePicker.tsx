import { useMemo, useRef } from 'react';
import Flatpickr from 'react-flatpickr';
import { Spanish } from 'flatpickr/dist/l10n/es';
import type { BaseOptions } from 'flatpickr/dist/types/options';
import { CalendarDays, X } from 'lucide-react';
import { formatToISO, getWeekNumber, getWeekStart, parseISODate } from '../utils/dateUtils';
import 'flatpickr/dist/themes/material_blue.css';
import './WeekNumberDatePicker.css';

type PickerLanguage = 'es' | 'en';

interface WeekNumberDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  language: PickerLanguage;
  className?: string;
  placeholder?: string;
  compact?: boolean;
}

export function WeekNumberDatePicker({
  value,
  onChange,
  language,
  className,
  placeholder,
  compact = false,
}: WeekNumberDatePickerProps) {
  const pickerRef = useRef<any>(null);
  const pickerValue = value || '';

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
    locale: language === 'es' ? Spanish : { firstDayOfWeek: 1 },
    disableMobile: true,
    position: 'auto center',
    monthSelectorType: 'dropdown',
    static: true,
    prevArrow: '<span class="tc-fp-arrow">‹</span>',
    nextArrow: '<span class="tc-fp-arrow">›</span>',
  }), [language]);

  const weekLabel = currentWeek !== null
    ? (language === 'es' ? `Semana ${currentWeek}` : `Week ${currentWeek}`)
    : null;

  const openCalendar = () => {
    pickerRef.current?.flatpickr?.open();
  };

  const enhanceCalendar = (instance: any) => {
    const calendar = instance?.calendarContainer as HTMLElement | undefined;
    if (!calendar) return;
    calendar.classList.add('tc-week-picker-calendar');

    if (calendar.querySelector('.tc-week-picker-footer')) return;

    const footer = document.createElement('div');
    footer.className = 'tc-week-picker-footer';

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'tc-week-picker-footer-btn primary';
    todayBtn.textContent = language === 'es' ? 'Hoy' : 'Today';
    todayBtn.addEventListener('click', () => {
      instance.setDate(new Date(), true);
    });

    const weekStartBtn = document.createElement('button');
    weekStartBtn.type = 'button';
    weekStartBtn.className = 'tc-week-picker-footer-btn secondary';
    weekStartBtn.textContent = language === 'es' ? 'Inicio semana' : 'Week start';
    weekStartBtn.addEventListener('click', () => {
      instance.setDate(getWeekStart(new Date()), true);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'tc-week-picker-footer-btn danger';
    clearBtn.textContent = language === 'es' ? 'Limpiar' : 'Clear';
    clearBtn.addEventListener('click', () => {
      instance.clear();
    });

    footer.appendChild(todayBtn);
    footer.appendChild(weekStartBtn);
    footer.appendChild(clearBtn);
    calendar.appendChild(footer);
  };

  const clearDate = () => {
    onChange('');
    pickerRef.current?.flatpickr?.clear();
  };

  const showWeekBadge = !compact;
  const showClearButton = !compact;
  const inputPaddingClass = compact ? '!pl-10 !pr-10' : '!pl-10 !pr-28';

  return (
    <div className={`tc-week-picker relative w-full ${compact ? 'tc-week-picker-compact' : ''}`}>
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
        value={pickerValue}
        options={options}
        onChange={(selectedDates) => {
          if (!selectedDates || selectedDates.length === 0) {
            onChange('');
            return;
          }
          onChange(formatToISO(selectedDates[0]));
        }}
        onReady={(_selectedDates, _dateStr, instance) => enhanceCalendar(instance)}
        onOpen={(_selectedDates, _dateStr, instance) => enhanceCalendar(instance)}
        className={`${className || ''} tc-week-picker-input ${inputPaddingClass}`}
        placeholder={placeholder || (language === 'es' ? 'Selecciona una fecha' : 'Select a date')}
      />
      <div className="tc-week-picker-right">
        {showClearButton && value && (
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
        {showWeekBadge && weekLabel && <span className="tc-week-picker-badge">{weekLabel}</span>}
      </div>
    </div>
  );
}
