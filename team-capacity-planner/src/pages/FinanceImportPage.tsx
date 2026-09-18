import { useEffect, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import { financeImportApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import type { FinanceImportLog } from '../types';

export function FinanceImportPage() {
  const { language } = useLanguage();
  const isEs = language === 'es';
  const { hasFullAccess } = useAuth();

  const [logs, setLogs] = useState<FinanceImportLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<FinanceImportLog | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const data = await financeImportApi.getAll();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[FinanceImportPage] Failed to load import history:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (hasFullAccess) {
      void loadLogs();
    }
  }, [hasFullAccess]);

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
              ? 'Solo administradores pueden importar el reporte de Finanzas.'
              : 'Only administrators can import the Finance report.'}
          </p>
        </div>
      </div>
    );
  }

  const handleFileSelected = async (file: File) => {
    setError(null);
    setLastResult(null);
    setIsUploading(true);
    try {
      const result = await financeImportApi.uploadFile(file);
      setLastResult(result);
      await loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f8f6fb] p-3 md:p-5">
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[#2e1a47] flex items-center gap-2">
            <FileSpreadsheet size={22} />
            {isEs ? 'Import de Finanzas' : 'Finance Import'}
          </h1>
          <p className="text-xs md:text-sm text-[#6c6480] mt-1">
            {isEs
              ? 'Sube el reporte semanal/mensual de Finanzas (WIP acumulado) para actualizar las horas reales de semanas pasadas. Las semanas anteriores a la actual quedan bloqueadas para edición manual y se llenan con este reporte.'
              : 'Upload the weekly/monthly Finance report (cumulative WIP) to update real hours for past weeks. Weeks before the current one are locked to manual edits and filled from this report instead.'}
          </p>
        </div>

        {/* Upload area */}
        <div className="bg-white border border-[#e5e0eb] rounded-lg p-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full border-2 border-dashed border-[#d5d1da] rounded-lg py-10 flex flex-col items-center gap-2 text-[#6c6480] hover:border-[#827691] hover:bg-[#faf9fc] transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <div className="h-8 w-8 rounded-full border-b-2 border-[#827691] animate-spin" />
            ) : (
              <Upload size={28} />
            )}
            <span className="text-sm font-semibold">
              {isUploading
                ? (isEs ? 'Procesando...' : 'Processing...')
                : (isEs ? 'Selecciona el archivo .xlsx de Finanzas' : 'Select the Finance .xlsx file')}
            </span>
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {lastResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
              <CheckCircle2 size={16} />
              {isEs ? 'Import completado' : 'Import complete'}
            </div>
            <div className="text-xs text-emerald-900 grid grid-cols-2 md:grid-cols-4 gap-2">
              <div><span className="font-semibold">{lastResult.reportDatesProcessed.length}</span> {isEs ? 'fechas de reporte' : 'report dates'}</div>
              <div><span className="font-semibold">{lastResult.weeklyActualsWritten}</span> {isEs ? 'semanas escritas' : 'weeks written'}</div>
              <div><span className="font-semibold">{lastResult.newProjectsCreated.length}</span> {isEs ? 'proyectos nuevos' : 'new projects'}</div>
              <div><span className="font-semibold">{lastResult.jobCodesSeededOnly.length}</span> {isEs ? 'jobs solo con línea base' : 'jobs seeded only'}</div>
            </div>
            {lastResult.newProjectsCreated.length > 0 && (
              <div className="text-xs text-emerald-900">
                <span className="font-semibold">{isEs ? 'Nuevos:' : 'New:'}</span> {lastResult.newProjectsCreated.join(', ')}
              </div>
            )}
            {lastResult.warnings.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2">
                {lastResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}
          </div>
        )}

        {/* History */}
        <div className="bg-white border border-[#e5e0eb] rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-[#e5e0eb] text-sm font-semibold text-[#2e1a47]">
            {isEs ? 'Historial de imports' : 'Import history'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f3eef8] text-[#4a4458] text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">{isEs ? 'Fecha' : 'Date'}</th>
                  <th className="text-left px-3 py-2">{isEs ? 'Archivo' : 'File'}</th>
                  <th className="text-left px-3 py-2">{isEs ? 'Usuario' : 'User'}</th>
                  <th className="text-right px-3 py-2">{isEs ? 'Semanas' : 'Weeks'}</th>
                  <th className="text-right px-3 py-2">{isEs ? 'Proyectos nuevos' : 'New projects'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoadingLogs && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">{isEs ? 'Cargando...' : 'Loading...'}</td></tr>
                )}
                {!isLoadingLogs && logs.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">{isEs ? 'Aún no hay imports.' : 'No imports yet.'}</td></tr>
                )}
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-[#2e1a47]">{new Date(log.createdAt).toLocaleString(isEs ? 'es-ES' : 'en-US')}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{log.fileName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{log.uploadedByUsername || '-'}</td>
                    <td className="px-3 py-2 text-right">{log.weeklyActualsWritten}</td>
                    <td className="px-3 py-2 text-right">{log.newProjectsCreated.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
