import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Lock, Save } from 'lucide-react';
import { departmentHourlyCostApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { Department, DepartmentHourlyCost } from '../types';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'PURCHASING'];

type SavedInfo = {
  hourlyCost: number;
  updatedByUsername?: string | null;
  updatedAt?: string;
};

export function DepartmentCostsPage() {
  const { language } = useLanguage();
  const isEs = language === 'es';
  const { hasFullAccess } = useAuth();

  // `saved` mirrors the backend (last persisted value + who/when); `draft` is
  // the in-progress edit shown in the inputs. They only merge back together
  // when the user explicitly presses Save -- no autosave on keystroke.
  const [saved, setSaved] = useState<Partial<Record<Department, SavedInfo>>>({});
  const [draft, setDraft] = useState<Partial<Record<Department, number | ''>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasFullAccess) {
      setIsLoading(false);
      return;
    }
    (async () => {
      try {
        const data: DepartmentHourlyCost[] = await departmentHourlyCostApi.getAll();
        const nextSaved: Partial<Record<Department, SavedInfo>> = {};
        const nextDraft: Partial<Record<Department, number | ''>> = {};
        for (const row of data) {
          // DRF serializes DecimalField as a string (e.g. "20.00"); normalize
          // to a number so later dirty-checks against the numeric draft state
          // aren't comparing "20.00" !== 20 forever.
          const numericCost = Number(row.hourlyCost);
          nextSaved[row.department] = {
            hourlyCost: numericCost,
            updatedByUsername: row.updatedByUsername,
            updatedAt: row.updatedAt,
          };
          nextDraft[row.department] = numericCost;
        }
        setSaved(nextSaved);
        setDraft(nextDraft);
      } catch (err) {
        console.error('[DepartmentCostsPage] Failed to load hourly costs:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [hasFullAccess]);

  const handleChange = (department: Department, value: string) => {
    if (value === '') {
      setDraft(prev => ({ ...prev, [department]: '' }));
      return;
    }
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    setDraft(prev => ({ ...prev, [department]: Math.max(0, numVal) }));
  };

  const dirtyDepartments = useMemo(
    () =>
      DEPARTMENTS.filter((dept) => {
        const draftVal = draft[dept];
        if (draftVal === '' || draftVal === undefined) return false;
        const savedVal = saved[dept]?.hourlyCost;
        return savedVal === undefined || draftVal !== savedVal;
      }),
    [draft, saved]
  );

  const handleSave = async () => {
    if (dirtyDepartments.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      const results = await Promise.all(
        dirtyDepartments.map((dept) =>
          departmentHourlyCostApi.create({ department: dept, hourlyCost: draft[dept] as number })
        )
      );
      setSaved(prev => {
        const next = { ...prev };
        results.forEach((result: DepartmentHourlyCost) => {
          next[result.department] = {
            hourlyCost: Number(result.hourlyCost),
            updatedByUsername: result.updatedByUsername,
            updatedAt: result.updatedAt,
          };
        });
        return next;
      });
    } catch (err) {
      console.error('[DepartmentCostsPage] Failed to save hourly costs:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const formatUpdatedAt = (iso?: string) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString(isEs ? 'es-MX' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  if (!hasFullAccess) {
    return (
      <div className="h-full flex items-center justify-center bg-[#f8f6fb] p-6">
        <div className="bg-white border border-[#e5e0eb] rounded-lg p-8 text-center max-w-md">
          <Lock size={32} className="mx-auto text-[#827691] mb-3" />
          <h1 className="text-lg font-bold text-[#2e1a47] mb-1">
            {isEs ? 'Acceso restringido' : 'Restricted access'}
          </h1>
          <p className="text-sm text-[#6c6480]">
            {isEs
              ? 'Solo PM/Business Intelligence pueden configurar el costo por hora de los departamentos.'
              : 'Only PM/Business Intelligence can configure department hourly costs.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f8f6fb] p-3 md:p-5">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-[#2e1a47] flex items-center gap-2">
              <DollarSign size={22} />
              {isEs ? 'Costo por Hora por Departamento' : 'Department Hourly Cost'}
            </h1>
            <p className="text-xs md:text-sm text-[#6c6480] mt-1">
              {isEs
                ? 'Tarifa global de costo por hora para el personal de cada departamento, usada en reportes de costos de proyecto.'
                : 'Global hourly cost rate for each department\'s staff, used for project cost reporting.'}
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={dirtyDepartments.length === 0 || isSaving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#5b3d8f] hover:bg-[#4a3175] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={16} />
            {isSaving
              ? (isEs ? 'Guardando…' : 'Saving…')
              : (isEs ? 'Guardar cambios' : 'Save changes')}
            {dirtyDepartments.length > 0 && !isSaving && ` (${dirtyDepartments.length})`}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="bg-white border border-[#e5e0eb] rounded-lg p-4">
          {isLoading ? (
            <div className="text-sm text-[#6c6480] py-6 text-center">
              {isEs ? 'Cargando...' : 'Loading...'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {DEPARTMENTS.map((dept) => {
                const isDirty = dirtyDepartments.includes(dept);
                const info = saved[dept];
                const updatedAtLabel = formatUpdatedAt(info?.updatedAt);
                return (
                  <div key={dept}>
                    <label className="block text-xs font-semibold mb-1 text-[#2e1a47]">
                      {dept}
                      {isDirty && (
                        <span className="ml-1.5 text-[10px] font-normal text-amber-600">
                          {isEs ? 'sin guardar' : 'unsaved'}
                        </span>
                      )}
                    </label>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#827691]">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft[dept] ?? ''}
                        onChange={(e) => handleChange(dept, e.target.value)}
                        placeholder="0.00"
                        className={`w-full border rounded px-2 py-1.5 pl-5 focus:outline-none text-sm font-semibold ${
                          isDirty
                            ? 'border-amber-400 focus:border-amber-500'
                            : 'border-[#e5e0eb] focus:border-[#8b7bb8]'
                        }`}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#827691]">
                        /{isEs ? 'hr' : 'hr'}
                      </span>
                    </div>
                    {info?.updatedByUsername && updatedAtLabel && (
                      <p className="text-[10px] text-[#9a91a8] mt-1 truncate">
                        {isEs ? 'Últ. cambio: ' : 'Last changed: '}
                        {info.updatedByUsername} · {updatedAtLabel}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
