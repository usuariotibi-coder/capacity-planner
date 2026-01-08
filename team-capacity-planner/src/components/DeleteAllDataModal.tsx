import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Language } from '../utils/translations';
import { useTranslation } from '../utils/translations';

interface DeleteAllDataModalProps {
  isOpen: boolean;
  isLoading: boolean;
  language: Language;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function DeleteAllDataModal({
  isOpen,
  isLoading,
  language,
  onConfirm,
  onCancel,
}: DeleteAllDataModalProps) {
  const t = useTranslation(language);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    try {
      setError(null);
      await onConfirm();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t.dataDeletedError;
      setError(errorMsg);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
          {/* Header */}
          <div className="bg-red-50 border-b border-red-200 px-6 py-4 flex items-start gap-3">
            <AlertTriangle size={24} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-lg font-bold text-red-900">
                {t.deleteAllData}
              </h3>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            <p className="text-sm font-semibold text-gray-900">
              {t.deleteAllDataConfirm}
            </p>
            <p className="text-sm text-gray-600">
              {t.deleteAllDataWarning}
            </p>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3 justify-end">
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {t.cancel}
            </button>
            <button
              onClick={handleConfirm}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  {t.deletingData}
                </>
              ) : (
                t.deleteConfirm
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
