import { useState, useEffect } from 'react';
import { activityLogApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { formatDistanceToNow } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import { ChevronDown, ChevronUp, Clock, FileText, Pencil, Plus, Search, Tag, Trash2, User } from 'lucide-react';

interface ActivityLog {
  id: string;
  user: {
    id: number;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  action: string;
  modelName: string;
  objectId: string;
  changes: any;
  createdAt: string;
  formattedCreatedAt?: string;
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
        console.log('[ActivityLog] Raw data from API:', data);
        if (Array.isArray(data) && data.length > 0) {
          console.log('[ActivityLog] First log entry:', data[0]);
          console.log('[ActivityLog] User object:', data[0].user);
        }
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
  const uniqueActions = Array.from(new Set(logs.map(log => log.action).filter(Boolean)));
  const uniqueModels = Array.from(new Set(logs.map(log => log.modelName).filter(Boolean)));

  // Filter logs
  const filteredLogs = logs.filter(log => {
    const actionValue = log.action || '';
    const modelValue = log.modelName || '';
    const matchesSearch =
      searchTerm === '' ||
      (log.user?.username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      actionValue.toLowerCase().includes(searchTerm.toLowerCase()) ||
      modelValue.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesAction = filterAction === 'all' || actionValue === filterAction;
    const matchesModel = filterModel === 'all' || modelValue === filterModel;

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

  const normalizeAction = (action?: string) => (action || '').toLowerCase();
  const isCreateAction = (action: string) => ['create', 'created'].includes(normalizeAction(action));
  const isUpdateAction = (action: string) => ['update', 'updated'].includes(normalizeAction(action));
  const isDeleteAction = (action: string) => ['delete', 'deleted', 'remove', 'removed'].includes(normalizeAction(action));

  const getActionLabel = (action: string) => {
    if (isCreateAction(action)) return language === 'es' ? 'Creado' : 'Created';
    if (isUpdateAction(action)) return language === 'es' ? 'Actualizado' : 'Updated';
    if (isDeleteAction(action)) return language === 'es' ? 'Eliminado' : 'Deleted';
    if (!action) return language === 'es' ? 'Accion' : 'Action';
    return action.charAt(0).toUpperCase() + action.slice(1).toLowerCase();
  };

  const getActionDetailLabel = (action: string) => {
    if (isCreateAction(action)) return language === 'es' ? 'Creado con' : 'Created with';
    if (isUpdateAction(action)) return language === 'es' ? 'Campos actualizados' : 'Updated fields';
    if (isDeleteAction(action)) return language === 'es' ? 'Eliminado' : 'Deleted';
    return getActionLabel(action);
  };

  const getActionTone = (action: string) => {
    if (isCreateAction(action)) {
      return {
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        iconBg: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        accent: 'border-l-emerald-400',
      };
    }
    if (isUpdateAction(action)) {
      return {
        badge: 'bg-[#ece7f3] text-[#2e1a47] border-[#c9c0d8]',
        iconBg: 'bg-[#e0d9ea] text-[#2e1a47] border-[#c9c0d8]',
        accent: 'border-l-[#827691]',
      };
    }
    if (isDeleteAction(action)) {
      return {
        badge: 'bg-red-50 text-red-700 border-red-200',
        iconBg: 'bg-red-100 text-red-700 border-red-200',
        accent: 'border-l-red-400',
      };
    }
    return {
      badge: 'bg-slate-100 text-slate-700 border-slate-200',
      iconBg: 'bg-slate-100 text-slate-700 border-slate-200',
      accent: 'border-l-slate-300',
    };
  };

  const getActionIcon = (action: string) => {
    if (isCreateAction(action)) return <Plus size={16} />;
    if (isUpdateAction(action)) return <Pencil size={16} />;
    if (isDeleteAction(action)) return <Trash2 size={16} />;
    return <FileText size={16} />;
  };

  const hasValue = (value: any) => value !== null && value !== undefined && value !== '';

  const formatShortDate = (value: any) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
      return value.includes('T') ? value.split('T')[0] : value;
    }
    if (value instanceof Date) return value.toISOString().split('T')[0];
    return String(value);
  };

  const formatTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const locale = language === 'es' ? 'es-MX' : 'en-US';
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
    } catch {
      return '';
    }
  };

  const formatUserName = (user: ActivityLog['user']) => {
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;

    const fallback = user?.username || user?.email || '';
    if (!fallback) return language === 'es' ? 'Usuario' : 'User';

    const base = fallback.includes('@') ? fallback.split('@')[0] : fallback;
    const cleaned = base.replace(/[._-]+/g, ' ').trim();
    if (!cleaned) return language === 'es' ? 'Usuario' : 'User';

    return cleaned
      .split(' ')
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const noiseFields = [
    'weeknumber',
    'stagedisplay',
    'externalhours',
    'totalhours',
    'assignmentcount',
    'projectmanager',
  ];

  const isDisplayValue = (value: any) => {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return false;
    if (typeof value === 'object') return false;
    return true;
  };

  const shouldHideField = (key: string, value: any) => {
    const lowerKey = key.toLowerCase();
    return isInternalField(key) || noiseFields.includes(lowerKey) || !isDisplayValue(value);
  };

  // List of internal/technical fields to hide from users
  const internalFields = [
    'id', 'uuid', 'object_id', 'objectid', 'created_at', 'createdat', 'updated_at', 'updatedat', 'created_by', 'updated_by',
    'createdat', 'updatedat', 'userid', 'user_id', 'projectid', 'project_id',
    'employeeid', 'employee_id', 'assignmentid', 'assignment_id', 'sciohours',
    'sciohoursallocated', 'sciohours_allocated', 'scio_hours', 'scio_hours_allocated',
    'department_hours_allocated', 'departmenthours', 'departmenthoursallocated',
    'allocationid', 'allocation_id', 'teamid', 'team_id', 'capacityid', 'capacity_id',
    'companyid', 'company_id', 'externalteamid', 'external_team_id', 'modified_by',
    'modifiedby', 'modified_at', 'modifiedat', 'is_active', 'isactive', 'is_deleted',
    'isdeleted', 'deleted_at', 'deletedat'
  ];

  // Check if a field should be hidden (internal/technical)
  const isInternalField = (key: string): boolean => {
    const lowerKey = key.toLowerCase();
    return internalFields.includes(lowerKey);
  };

  // Map of field names to human-readable labels
  const fieldLabels: Record<string, string> = {
    'hours': 'Hours',
    'hoursAssigned': 'Hours Assigned',
    'hours_assigned': 'Hours Assigned',
    'projectName': 'Project',
    'project_name': 'Project',
    'employeeName': 'Employee',
    'employee_name': 'Employee',
    'name': 'Name',
    'title': 'Title',
    'description': 'Description',
    'status': 'Status',
    'weekStartDate': 'Week Starting',
    'week_start_date': 'Week Starting',
    'startDate': 'Start Date',
    'start_date': 'Start Date',
    'endDate': 'End Date',
    'end_date': 'End Date',
    'client': 'Client',
    'facility': 'Facility/Location',
    'capacity': 'Capacity',
    'teamName': 'Team',
    'team_name': 'Team',
    'company': 'Company',
    'role': 'Role',
    'department': 'Department',
    'stage': 'Stage',
    'comment': 'Notes/Comment'
  };

  // Format key names for display
  const formatKeyName = (key: string): string => {
    // Check if we have a custom label for this field
    if (fieldLabels[key]) {
      return fieldLabels[key];
    }
    // Otherwise, convert snake_case to Title Case
    return key
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Format value for display - simple and clear
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'string') {
      if (value.length > 80) {
        return value.substring(0, 77) + '...';
      }
      return value;
    }
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return `[${value.length} items]`;
      }
      return '(complex data)';
    }
    return String(value);
  };

  // Check if there's a nested object (like Assignment, Project, etc.)
  const extractMainObject = (changes: any): { objectType: string; data: any } | null => {
    if (!changes || typeof changes !== 'object') return null;

    const entries = Object.entries(changes);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (typeof value === 'object' && value !== null) {
        return { objectType: key, data: value };
      }
    }
    return null;
  };

  // Extract important summary information from changes
  const extractSummaryInfo = (changes: any, modelName: string) => {
    if (!changes || typeof changes !== 'object') return null;

    const mainObj = extractMainObject(changes);
    const data = mainObj ? mainObj.data : changes;

    const summary: any = {
      hours: null,
      project: null,
      employee: null,
      week: null,
      status: null,
      description: null,
    };

    // Extract important fields based on model type
    if (modelName === 'Assignment') {
      summary.hours = data.hours || data.hoursAssigned;
      summary.employee = data.employeeName || data.employee_name;
      summary.project = data.projectName || data.project_name;
      summary.week = data.weekStartDate || data.week_start_date;
      summary.status = data.status;
    } else if (modelName === 'Project') {
      summary.project = data.name || data.projectName;
      summary.description = data.description;
      summary.status = data.status;
    } else if (modelName === 'TeamCapacity' || modelName === 'SubcontractedTeamCapacity' || modelName === 'PrgExternalTeamCapacity') {
      summary.hours = data.capacity || data.hours;
      summary.project = data.projectName || data.project_name || data.project;
      summary.employee = data.teamName || data.team_name || data.company;
      summary.week = data.weekStartDate || data.week_start_date;
    }

    return summary;
  };

  return (
    <div className="brand-page-shell activity-log-page flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="brand-page-header px-6 py-4 flex-shrink-0">
        <h1 className="brand-title text-2xl font-bold mb-4 flex items-center gap-2">
          <FileText size={22} className="text-[#4f3a70]" />
          {t.activityLog || 'Activity Log'}
        </h1>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-[#8a8298]" />
            <input
              type="text"
              placeholder={t.search || 'Search...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="brand-input w-full pl-9 pr-3 py-2 text-sm"
            />
          </div>

          {/* Filter by Action */}
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="brand-select px-3 py-2 text-sm"
          >
            <option value="all">{t.allActions || 'All Actions'}</option>
            {uniqueActions.map(action => (
              <option key={action} value={action}>
                {getActionLabel(action)}
              </option>
            ))}
          </select>

          {/* Filter by Model */}
          <select
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            className="brand-select px-3 py-2 text-sm"
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
            <span className="text-sm text-[#6c6480]">
              {filteredLogs.length} {t.results || 'results'}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#827691]"></div>
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
          <div className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {filteredLogs.map((log) => {
                const summary = extractSummaryInfo(log.changes, log.modelName);
                const tone = getActionTone(log.action);
                const actionLabel = getActionLabel(log.action);
                const modelLabel = log.modelName || (language === 'es' ? 'Registro' : 'Record');
                const isUpdate = isUpdateAction(log.action);
                const isExpanded = expandedId === log.id;
                const createdAtValue = log.createdAt || log.formattedCreatedAt || '';
                const timeLabel = formatTime(createdAtValue);
                const userLabel = formatUserName(log.user);
                const resourceLabel = (log.modelName || '').toLowerCase().includes('team')
                  ? (language === 'es' ? 'Equipo' : 'Team')
                  : (language === 'es' ? 'Empleado' : 'Employee');

                const summaryItems = [
                  hasValue(summary?.project) && {
                    label: language === 'es' ? 'Proyecto' : 'Project',
                    value: summary?.project,
                    className: 'bg-[#ece7f3] text-[#2e1a47] border-[#c9c0d8]',
                  },
                  hasValue(summary?.hours) && {
                    label: language === 'es' ? 'Horas' : 'Hours',
                    value: `${summary?.hours}h`,
                    className: 'bg-slate-50 text-slate-700 border-slate-200',
                  },
                  hasValue(summary?.employee) && {
                    label: resourceLabel,
                    value: summary?.employee,
                    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  },
                  hasValue(summary?.week) && {
                    label: language === 'es' ? 'Semana' : 'Week',
                    value: formatShortDate(summary?.week),
                    className: 'bg-amber-50 text-amber-700 border-amber-200',
                  },
                ].filter(Boolean) as Array<{ label: string; value: string; className: string }>;

                return (
                  <div
                    key={log.id}
                    className={`brand-panel border rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow border-l-4 ${tone.accent} ${isExpanded ? 'lg:col-span-2' : ''}`}
                  >
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className="w-full px-4 py-3 bg-white hover:bg-[#f7f4fb] flex items-start justify-between gap-3 transition-colors"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className={`h-9 w-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${tone.iconBg}`}>
                          {getActionIcon(log.action)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border ${tone.badge}`}>
                              {actionLabel}
                            </span>
                            <span className="text-sm font-semibold text-[#2e1a47] truncate">{modelLabel}</span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#6c6480]">
                            <span className="inline-flex items-center gap-1.5 min-w-0">
                              <User size={12} className="text-[#8a8298]" />
                              <span className="font-medium text-[#4f3a70] truncate">{userLabel}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Clock size={12} className="text-[#8a8298]" />
                              {formatDate(createdAtValue)}{timeLabel ? ` - ${timeLabel}` : ''}
                            </span>
                          </div>

                          {summaryItems.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {summaryItems.map(item => (
                                <span
                                  key={`${item.label}-${item.value}`}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${item.className}`}
                                  title={String(item.value)}
                                >
                                  <span className="text-[10px] uppercase tracking-wide opacity-70">{item.label}</span>
                                  <span className="max-w-[180px] truncate">{item.value}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-1 flex-shrink-0">
                        {isExpanded ? (
                          <ChevronUp size={18} className="text-[#8a8298]" />
                        ) : (
                          <ChevronDown size={18} className="text-[#8a8298]" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[#e7e1ef] bg-white p-4 space-y-3">
                        {log.user && (
                          <div className="bg-[#ece7f3] p-3 rounded border border-[#c9c0d8]">
                            <p className="text-xs font-semibold text-[#2e1a47] mb-1 flex items-center gap-2">
                              <User size={12} className="text-[#4f3a70]" />
                              {language === 'es' ? 'Usuario' : 'User'}
                            </p>
                            <p className="text-sm text-[#2e1a47]">{userLabel}</p>
                          </div>
                        )}

                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                          <p className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-2">
                            <Tag size={12} className="text-slate-400" />
                            {getActionDetailLabel(log.action)}
                          </p>

                          {(() => {
                            const updatePayload =
                              isUpdateAction(log.action) &&
                              log.changes &&
                              typeof log.changes === 'object' &&
                              (log.changes as any).updates &&
                              typeof (log.changes as any).updates === 'object'
                                ? { objectType: null, data: (log.changes as any).updates }
                                : null;
                            const mainObj = updatePayload || extractMainObject(log.changes);

                            if (!log.changes) {
                              return (
                                <div className="text-sm text-slate-600 bg-white p-2 rounded border border-slate-200">
                                  No changes recorded
                                </div>
                              );
                            }

                            if (mainObj) {
                              const { objectType, data } = mainObj;
                              const entries = Object.entries(data).filter(([key, value]) => !shouldHideField(key, value));

                              const importantFields = ['hours', 'hoursAssigned', 'projectName', 'project_name', 'employeeName', 'employee_name', 'weekStartDate', 'week_start_date', 'name', 'status', 'teamName', 'team_name', 'company', 'capacity', 'title', 'description', 'client', 'facility', 'endDate', 'end_date', 'startDate', 'start_date'];
                              const visibleEntries = isUpdate
                                ? entries
                                : entries.filter(([key]) => importantFields.includes(key));
                              const prioritized = visibleEntries.sort((a, b) => {
                                const aImportant = importantFields.includes(a[0]) ? 0 : 1;
                                const bImportant = importantFields.includes(b[0]) ? 0 : 1;
                                return aImportant - bImportant;
                              });

                              const displayedEntries = prioritized.slice(0, 10);

                              if (displayedEntries.length === 0) {
                                return (
                                  <div className="text-sm text-slate-600 bg-white p-2 rounded border border-slate-200">
                                    No user-visible changes
                                  </div>
                                );
                              }

                              return (
                                <div className="space-y-2">
                                  {objectType && (
                                    <div className="inline-flex items-center gap-2 bg-slate-100 text-slate-700 text-xs font-semibold px-3 py-1 rounded-full border border-slate-200 mb-2">
                                      {objectType}
                                    </div>
                                  )}
                                  <div className="grid grid-cols-1 gap-2">
                                    {displayedEntries.map(([key, value]) => {
                                      const isImportant = importantFields.includes(key);
                                      return (
                                        <div
                                          key={key}
                                          className={`p-3 rounded border ${
                                            isImportant
                                              ? 'bg-[#ece7f3] border-[#c9c0d8]'
                                              : 'bg-white border-slate-200'
                                          }`}
                                        >
                                          <div className="flex justify-between items-start gap-3">
                                            <span className={`text-sm font-semibold whitespace-nowrap ${
                                              isImportant ? 'text-[#2e1a47]' : 'text-slate-700'
                                            }`}>
                                              {formatKeyName(key)}
                                            </span>
                                            <span className="text-sm text-gray-900 font-medium text-right break-words flex-1">
                                              {formatValue(value)}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {visibleEntries.length > 10 && (
                                      <div className="text-xs text-slate-500 italic px-2 py-1">
                                        +{visibleEntries.length - 10} more fields
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            }

                            if (typeof log.changes === 'object') {
                              const entries = Object.entries(log.changes).filter(([key, value]) => !shouldHideField(key, value));

                              if (entries.length === 0) {
                                return (
                                  <div className="text-sm text-slate-600 bg-white p-2 rounded border border-slate-200">
                                    No user-visible changes
                                  </div>
                                );
                              }

                              const importantFields = ['hours', 'hoursAssigned', 'projectName', 'project_name', 'employeeName', 'employee_name', 'weekStartDate', 'week_start_date', 'name', 'status', 'title', 'description', 'client', 'facility', 'endDate', 'end_date', 'startDate', 'start_date'];
                              const visibleEntries = isUpdate
                                ? entries
                                : entries.filter(([key]) => importantFields.includes(key));
                              const prioritized = visibleEntries.sort((a, b) => {
                                const aImportant = importantFields.includes(a[0]) ? 0 : 1;
                                const bImportant = importantFields.includes(b[0]) ? 0 : 1;
                                return aImportant - bImportant;
                              });

                              const displayedEntries = prioritized.slice(0, 10);

                              return (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-1 gap-2">
                                    {displayedEntries.map(([key, value]) => {
                                      const isImportant = importantFields.includes(key);
                                      return (
                                        <div
                                          key={key}
                                          className={`p-3 rounded border ${
                                            isImportant
                                              ? 'bg-[#ece7f3] border-[#c9c0d8]'
                                              : 'bg-white border-slate-200'
                                          }`}
                                        >
                                          <div className="flex justify-between items-start gap-3">
                                            <span className={`text-sm font-semibold whitespace-nowrap ${
                                              isImportant ? 'text-[#2e1a47]' : 'text-slate-700'
                                            }`}>
                                              {formatKeyName(key)}
                                            </span>
                                            <span className="text-sm text-gray-900 font-medium text-right break-words flex-1">
                                              {formatValue(value)}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {visibleEntries.length > 10 && (
                                      <div className="text-xs text-slate-500 italic px-2 py-1">
                                        +{visibleEntries.length - 10} more fields
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div className="text-sm text-slate-600 bg-white p-2 rounded border border-slate-200">
                                {String(log.changes)}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
