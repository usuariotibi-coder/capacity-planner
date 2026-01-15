import { useState, useEffect } from 'react';
import { activityLogApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { formatDistanceToNow } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';

interface ActivityLog {
  id: string;
  user: {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
  } | null;
  action: string;
  model_name: string;
  object_id: string;
  changes: any;
  created_at: string;
}

export function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterModel, setFilterModel] = useState<string>('all');

  const { language } = useLanguage();
  const t = useTranslation(language);

  // Load activity logs
  useEffect(() => {
    const loadLogs = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await activityLogApi.getAll();
        setLogs(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading activity logs');
        console.error('Error loading activity logs:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadLogs();
  }, []);

  // Get unique actions and models
  const uniqueActions = Array.from(new Set(logs.map(log => log.action)));
  const uniqueModels = Array.from(new Set(logs.map(log => log.model_name)));

  // Filter logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      searchTerm === '' ||
      (log.user?.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.model_name.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesAction = filterAction === 'all' || log.action === filterAction;
    const matchesModel = filterModel === 'all' || log.model_name === filterModel;

    return matchesSearch && matchesAction && matchesModel;
  });

  // Format date
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const locale = language === 'es' ? es : enUS;
      return formatDistanceToNow(date, { addSuffix: true, locale });
    } catch {
      return dateString;
    }
  };

  // Get action color
  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'UPDATE':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'DELETE':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  // Get action icon
  const getActionIcon = (action: string) => {
    switch (action) {
      case 'CREATE':
        return '➕';
      case 'UPDATE':
        return '✏️';
      case 'DELETE':
        return '🗑️';
      default:
        return '📋';
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          📊 {t.activityLog || 'Activity Log'}
        </h1>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder={t.search || 'Search...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Filter by Action */}
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{t.allActions || 'All Actions'}</option>
            {uniqueActions.map(action => (
              <option key={action} value={action}>
                {getActionIcon(action)} {action}
              </option>
            ))}
          </select>

          {/* Filter by Model */}
          <select
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{t.allModels || 'All Models'}</option>
            {uniqueModels.map(model => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>

          {/* Results count */}
          <div className="flex items-center justify-end">
            <span className="text-sm text-gray-600">
              {filteredLogs.length} {t.results || 'results'}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="p-6 bg-red-50 border border-red-200 rounded-lg m-6">
            <p className="text-red-800">Error: {error}</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-gray-600 text-lg">
                {searchTerm || filterAction !== 'all' || filterModel !== 'all'
                  ? t.noResultsFound || 'No results found'
                  : t.noActivityYet || 'No activity yet'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 p-6">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Log Entry Header */}
                <button
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Action Badge */}
                    <div
                      className={`px-2 py-1 rounded font-semibold text-xs border flex-shrink-0 ${getActionColor(log.action)}`}
                    >
                      {getActionIcon(log.action)} {log.action}
                    </div>

                    {/* User Info */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {log.user?.username || 'Unknown User'}
                      </span>
                      <span className="text-xs text-gray-600">
                        {log.model_name} • {log.object_id.substring(0, 8)}...
                      </span>
                    </div>

                    {/* Timestamp */}
                    <div className="text-right flex-shrink-0">
                      <span className="text-xs text-gray-600 block">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Expand Icon */}
                  <div className="ml-2 flex-shrink-0">
                    {expandedId === log.id ? (
                      <ChevronUp size={18} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={18} className="text-gray-400" />
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {expandedId === log.id && (
                  <div className="border-t border-gray-200 bg-white p-4 space-y-3">
                    {/* User Details */}
                    {log.user && (
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <p className="text-xs font-semibold text-blue-900 mb-1">👤 User</p>
                        <p className="text-sm text-blue-800">
                          {log.user.first_name} {log.user.last_name}
                        </p>
                        <p className="text-xs text-blue-700 font-mono">
                          {log.user.username}
                        </p>
                      </div>
                    )}

                    {/* Object ID */}
                    <div className="bg-gray-50 p-3 rounded border border-gray-200">
                      <p className="text-xs font-semibold text-gray-700 mb-1">🔍 Object ID</p>
                      <p className="text-xs text-gray-600 font-mono break-all">
                        {log.object_id}
                      </p>
                    </div>

                    {/* Timestamp */}
                    <div className="bg-gray-50 p-3 rounded border border-gray-200">
                      <p className="text-xs font-semibold text-gray-700 mb-1">⏰ Timestamp</p>
                      <p className="text-xs text-gray-600 font-mono">
                        {new Date(log.created_at).toLocaleString(
                          language === 'es' ? 'es-ES' : 'en-US'
                        )}
                      </p>
                    </div>

                    {/* Changes */}
                    {log.changes && (
                      <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                        <p className="text-xs font-semibold text-yellow-900 mb-2">📝 Changes</p>
                        <pre className="text-xs text-yellow-900 bg-white p-2 rounded border border-yellow-100 overflow-auto max-h-48">
                          {JSON.stringify(log.changes, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
