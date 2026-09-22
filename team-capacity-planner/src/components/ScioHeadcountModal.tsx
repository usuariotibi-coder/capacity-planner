import { useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Department, ScioHeadcountEvent } from '../types';
import type { Language } from '../utils/translations';
import { useTranslation } from '../utils/translations';
import { scioHeadcountEventsApi } from '../services/api';
import { formatToISO, parseISODate } from '../utils/dateUtils';

interface ScioHeadcountModalProps {
  isOpen: boolean;
  department: Department;
  language: Language;
  onClose: () => void;
  onSaved: () => void;
}

export function ScioHeadcountModal({ isOpen, department, language, onClose, onSaved }: ScioHeadcountModalProps) {
  const t = useTranslation(language);
  const [events, setEvents] = useState<ScioHeadcountEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(() => formatToISO(new Date()));
  const [deltaText, setDeltaText] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    scioHeadcountEventsApi.getAll(department)
      .then((data: ScioHeadcountEvent[]) => {
        if (!cancelled) setEvents(data || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, department]);

  const currentHeadcount = useMemo(() => {
    const todayWeek = formatToISO(new Date());
    return events
      .filter((e) => e.effectiveDate <= todayWeek)
      .reduce((sum, e) => sum + e.delta, 0);
  }, [events]);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
    [events]
  );

  if (!isOpen) return null;

  const resetForm = () => {
    setEffectiveDate(formatToISO(new Date()));
    setDeltaText('');
    setComment('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const delta = parseFloat(deltaText);
    if (!Number.isFinite(delta) || delta === 0) {
      setError(language === 'es'
        ? 'Indica un cambio distinto de cero (positivo para altas, negativo para bajas).'
        : 'Enter a non-zero change (positive for hires, negative for departures).');
      return;
    }
    if (!effectiveDate || Number.isNaN(parseISODate(effectiveDate).getTime())) {
      setError(language === 'es' ? 'Fecha inválida.' : 'Invalid date.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const created = await scioHeadcountEventsApi.create({
        department,
        effectiveDate,
        delta,
        comment: comment.trim(),
      });
      setEvents((prev) => [...prev, created]);
      resetForm();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setIsSaving(true);
    setError(null);
    try {
      await scioHeadcountEventsApi.delete(id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 z-[80]" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-[90] p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="border-b border-[#e5e0eb] px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-sm font-bold text-[#2e1a47]">
                {language === 'es' ? `Personal ${department} - Altas y Bajas` : `${department} Staff - Hires & Departures`}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {language === 'es'
                  ? 'Registra cambios de personal; SCIO Team Members se recalcula automáticamente semana a semana.'
                  : 'Log staffing changes; SCIO Team Members is recalculated automatically week by week.'}
              </p>
            </div>
            <button onClick={onClose} className="p-1 text-gray-500 hover:bg-gray-100 rounded transition flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          {/* Current headcount */}
          <div className="px-5 py-3 bg-[#f6f3fb] border-b border-[#e5e0eb] flex-shrink-0">
            <span className="text-xs text-gray-600">
              {language === 'es' ? 'Personal disponible hoy: ' : 'Available staff today: '}
            </span>
            <span className="text-sm font-bold text-[#2e1a47]">{currentHeadcount}</span>
          </div>

          {/* New event form */}
          <form onSubmit={handleSubmit} className="px-5 py-3 border-b border-[#e5e0eb] flex-shrink-0 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">
                  {language === 'es' ? 'Fecha efectiva' : 'Effective date'}
                </label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-[#2e1a47]"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">
                  {language === 'es' ? 'Cambio (+ alta / - baja)' : 'Change (+ hire / - departure)'}
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={deltaText}
                  onChange={(e) => setDeltaText(e.target.value)}
                  placeholder={language === 'es' ? 'ej. 2 o -1' : 'e.g. 2 or -1'}
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-[#2e1a47]"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">
                {language === 'es' ? 'Comentario (opcional)' : 'Comment (optional)'}
              </label>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={language === 'es' ? 'ej. se incorpora Juan Pérez' : 'e.g. Juan Pérez joins the team'}
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-[#2e1a47]"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded px-2 py-1.5 text-xs text-red-700">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={isSaving}
              className="w-full px-3 py-1.5 text-xs font-semibold text-white bg-[#2e1a47] rounded hover:bg-[#3b2658] disabled:opacity-50 transition"
            >
              {isSaving
                ? (language === 'es' ? 'Guardando...' : 'Saving...')
                : (language === 'es' ? 'Registrar cambio' : 'Log change')}
            </button>
          </form>

          {/* Event history */}
          <div className="overflow-y-auto flex-1 px-5 py-3">
            <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {language === 'es' ? 'Historial' : 'History'}
            </h4>
            {isLoading ? (
              <p className="text-xs text-gray-400">{language === 'es' ? 'Cargando...' : 'Loading...'}</p>
            ) : sortedEvents.length === 0 ? (
              <p className="text-xs text-gray-400">
                {language === 'es' ? 'Sin cambios registrados todavía.' : 'No changes logged yet.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sortedEvents.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-2 border border-[#e5e0eb] rounded px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <span className={`text-xs font-bold ${event.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {event.delta >= 0 ? '+' : ''}{event.delta}
                      </span>
                      <span className="text-xs text-gray-600 ml-2">{event.effectiveDate}</span>
                      {event.comment && (
                        <p className="text-[11px] text-gray-500 truncate">{event.comment}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(event.id)}
                      disabled={isSaving}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition flex-shrink-0"
                      title={t.delete}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
