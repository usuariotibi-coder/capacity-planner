import { useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Department, ExternalProviderRate, Stage } from '../types';
import type { Language } from '../utils/translations';
import { useTranslation } from '../utils/translations';
import { externalProviderRatesApi } from '../services/api';
import { formatToISO } from '../utils/dateUtils';

// Sentinel for the stage dropdown's "flat rate" option -- departments with no Stage concept
// (MFG) register everything under stage=null, same as ExternalProviderRateModal's creation
// flow in CapacityMatrixPage.
const FLAT_RATE_STAGE = '';

interface ExternalProviderRateModalProps {
  isOpen: boolean;
  department: Department;
  teams: string[];
  stageOptions: Exclude<Stage, null>[];
  getStageLabel: (stage: Stage, t: Record<string, string>) => string;
  language: Language;
  onClose: () => void;
  onSaved: () => void;
}

export function ExternalProviderRateModal({
  isOpen,
  department,
  teams,
  stageOptions,
  getStageLabel,
  language,
  onClose,
  onSaved,
}: ExternalProviderRateModalProps) {
  const t = useTranslation(language);
  const today = useMemo(() => formatToISO(new Date()), []);

  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedStage, setSelectedStage] = useState<string>(FLAT_RATE_STAGE);
  const [rates, setRates] = useState<ExternalProviderRate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [rateText, setRateText] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setSelectedProvider((prev) => (prev && teams.includes(prev) ? prev : teams[0] || ''));
  }, [isOpen, teams]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedStage(stageOptions.length > 0 ? stageOptions[0] : FLAT_RATE_STAGE);
  }, [isOpen, department, stageOptions]);

  useEffect(() => {
    if (!isOpen || !selectedProvider) {
      setRates([]);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    externalProviderRatesApi.getAll(department, selectedProvider)
      .then((data: ExternalProviderRate[]) => {
        if (!cancelled) setRates(data || []);
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
  }, [isOpen, department, selectedProvider]);

  const stageKeyFor = (stage: Stage) => stage || FLAT_RATE_STAGE;

  const ratesForSelectedStage = useMemo(
    () => rates.filter((r) => stageKeyFor(r.stage) === selectedStage),
    [rates, selectedStage]
  );

  const currentRate = useMemo(() => {
    const applicable = ratesForSelectedStage
      .filter((r) => r.effectiveDate <= today)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    return applicable[0]?.rate ?? null;
  }, [ratesForSelectedStage, today]);

  const sortedRates = useMemo(
    () => [...ratesForSelectedStage].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
    [ratesForSelectedStage]
  );

  if (!isOpen) return null;

  const resetForm = () => {
    setEffectiveDate(today);
    setRateText('');
    setComment('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;
    const rate = parseFloat(rateText);
    if (!Number.isFinite(rate) || rate < 0) {
      setError(language === 'es' ? 'Indica un rate válido (0 o mayor).' : 'Enter a valid rate (0 or more).');
      return;
    }
    if (!effectiveDate) {
      setError(language === 'es' ? 'Fecha inválida.' : 'Invalid date.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const created = await externalProviderRatesApi.create({
        department,
        providerName: selectedProvider,
        stage: selectedStage || null,
        effectiveDate,
        rate,
        comment: comment.trim(),
      });
      setRates((prev) => [...prev, created]);
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
      await externalProviderRatesApi.delete(id);
      setRates((prev) => prev.filter((r) => r.id !== id));
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
          <div className="border-b border-[#e5e0eb] px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-sm font-bold text-[#2e1a47]">
                {language === 'es' ? `${department} - Rates de Proveedores` : `${department} - Provider Rates`}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {language === 'es'
                  ? 'El rate de un proveedor puede cambiar con el tiempo: cada registro aplica desde su fecha en adelante, sin borrar el historial.'
                  : "A provider's rate can change over time: each entry applies from its own date forward, without erasing history."}
              </p>
            </div>
            <button onClick={onClose} className="p-1 text-gray-500 hover:bg-gray-100 rounded transition flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          {teams.length === 0 ? (
            <div className="px-5 py-6 text-sm text-gray-500">{t.noExternalProvidersYet}</div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-[#e5e0eb] flex-shrink-0 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">
                    {t.externalProviderLabel}
                  </label>
                  <select
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-[#2e1a47]"
                  >
                    {teams.map((team) => (
                      <option key={team} value={team}>{team}</option>
                    ))}
                  </select>
                </div>
                {stageOptions.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">{t.stage}</label>
                    <select
                      value={selectedStage}
                      onChange={(e) => setSelectedStage(e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-[#2e1a47]"
                    >
                      {stageOptions.map((stage) => (
                        <option key={stage} value={stage}>{getStageLabel(stage, t as Record<string, string>)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="px-5 py-3 bg-[#f6f3fb] border-b border-[#e5e0eb] flex-shrink-0">
                <span className="text-xs text-gray-600">
                  {language === 'es' ? 'Rate vigente hoy: ' : 'Current rate today: '}
                </span>
                <span className="text-sm font-bold text-[#2e1a47]">
                  {currentRate === null ? (language === 'es' ? 'sin registrar' : 'not registered') : `$${currentRate}/hr`}
                </span>
              </div>

              <form onSubmit={handleSubmit} className="px-5 py-3 border-b border-[#e5e0eb] flex-shrink-0 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">
                      {t.effectiveDateLabel}
                    </label>
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-[#2e1a47]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-600 mb-0.5">
                      {language === 'es' ? 'Nuevo rate ($/hr)' : 'New rate ($/hr)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={rateText}
                      onChange={(e) => setRateText(e.target.value)}
                      placeholder="e.g. 45.00"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-[#2e1a47]"
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
                    placeholder={language === 'es' ? 'ej. nuevo contrato firmado' : 'e.g. new contract signed'}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-[#2e1a47]"
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
                    : (language === 'es' ? 'Registrar rate' : 'Log rate')}
                </button>
              </form>

              <div className="overflow-y-auto flex-1 px-5 py-3">
                <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  {language === 'es' ? 'Historial' : 'History'}
                </h4>
                {isLoading ? (
                  <p className="text-xs text-gray-400">{language === 'es' ? 'Cargando...' : 'Loading...'}</p>
                ) : sortedRates.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    {language === 'es' ? 'Sin rates registrados todavía para esta fase.' : 'No rates logged yet for this stage.'}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {sortedRates.map((rateRow) => (
                      <li
                        key={rateRow.id}
                        className="flex items-center justify-between gap-2 border border-[#e5e0eb] rounded px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-[#2e1a47]">${rateRow.rate}/hr</span>
                          <span className="text-xs text-gray-600 ml-2">{rateRow.effectiveDate}</span>
                          {rateRow.comment && (
                            <p className="text-[11px] text-gray-500 truncate">{rateRow.comment}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(rateRow.id)}
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
