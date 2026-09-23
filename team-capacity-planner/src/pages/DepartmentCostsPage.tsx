import { useEffect, useRef, useState } from 'react';
import { DollarSign, Lock } from 'lucide-react';
import { departmentHourlyCostApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { Department, DepartmentHourlyCost } from '../types';

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'PURCHASING'];

export function DepartmentCostsPage() {
  const { language } = useLanguage();
  const isEs = language === 'es';
  const { hasFullAccess } = useAuth();

  const [costs, setCosts] = useState<Partial<Record<Department, number | ''>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingDept, setSavingDept] = useState<Department | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimeouts = useRef<Partial<Record<Department, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    if (!hasFullAccess) {
      setIsLoading(false);
      return;
    }
    (async () => {
      try {
        const data: DepartmentHourlyCost[] = await departmentHourlyCostApi.getAll();
        const nextCosts: Partial<Record<Department, number | ''>> = {};
        for (const row of data) {
          nextCosts[row.department] = row.hourlyCost;
        }
        setCosts(nextCosts);
      } catch (err) {
        console.error('[DepartmentCostsPage] Failed to load hourly costs:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [hasFullAccess]);

  const saveCost = async (department: Department, hourlyCost: number) => {
    setSavingDept(department);
    try {
      await departmentHourlyCostApi.create({ department, hourlyCost });
    } catch (err) {
      console.error('[DepartmentCostsPage] Failed to save hourly cost:', err);
      alert(
        isEs
          ? `Error al guardar el costo de ${department}: ${err instanceof Error ? err.message : String(err)}`
          : `Error saving ${department} cost: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSavingDept(current => (current === department ? null : current));
    }
  };

  const handleChange = (department: Department, value: string) => {
    if (value === '') {
      setCosts(prev => ({ ...prev, [department]: '' }));
      return;
    }
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    const clamped = Math.max(0, numVal);
    setCosts(prev => ({ ...prev, [department]: clamped }));

    if (saveTimeouts.current[department]) {
      clearTimeout(saveTimeouts.current[department]);
    }
    saveTimeouts.current[department] = setTimeout(() => {
      saveCost(department, clamped);
    }, 600);
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {DEPARTMENTS.map((dept) => (
                <div key={dept}>
                  <label className="block text-xs font-semibold mb-1 text-[#2e1a47]">
                    {dept}
                    {savingDept === dept && (
                      <span className="ml-1.5 text-[10px] font-normal text-[#827691]">
                        {isEs ? 'guardando…' : 'saving…'}
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#827691]">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={costs[dept] ?? ''}
                      onChange={(e) => handleChange(dept, e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-[#e5e0eb] rounded px-2 py-1.5 pl-5 focus:border-[#8b7bb8] focus:outline-none text-sm font-semibold"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#827691]">
                      /{isEs ? 'hr' : 'hr'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
