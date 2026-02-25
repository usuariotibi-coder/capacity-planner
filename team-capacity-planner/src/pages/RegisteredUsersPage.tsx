import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Pencil, Plus, RefreshCw, Save, Trash2, User, X } from 'lucide-react';
import { registeredUsersApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { useAuth } from '../context/AuthContext';
import { PasswordRequirementsChecklist } from '../components/PasswordRequirementsChecklist';
import { getPasswordCriteria, getPasswordStrength } from '../utils/passwordValidation';
import type { OtherDepartment, RegisteredUser, UserDepartment } from '../types';

const USER_DEPARTMENTS: UserDepartment[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'OTHER'];
const OTHER_DEPARTMENTS: OtherDepartment[] = [
  'OPERATIONS',
  'FINANCE',
  'HUMAN_RESOURCES',
  'BUSINESS_INTELLIGENCE',
  'HEAD_ENGINEERING',
];

interface EditState {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  department: UserDepartment | '';
  otherDepartment: OtherDepartment | '';
  isActive: boolean;
}

interface CreateState {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  department: UserDepartment | '';
  otherDepartment: OtherDepartment | '';
  isActive: boolean;
}

interface ResetPasswordState {
  user: RegisteredUser;
  password: string;
  confirmPassword: string;
}

const INITIAL_CREATE_STATE: CreateState = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  department: '',
  otherDepartment: '',
  isActive: true,
};

export function RegisteredUsersPage() {
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RegisteredUser | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createState, setCreateState] = useState<CreateState>(INITIAL_CREATE_STATE);
  const [isCreating, setIsCreating] = useState(false);
  const [resetPasswordState, setResetPasswordState] = useState<ResetPasswordState | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const { language } = useLanguage();
  const t = useTranslation(language);
  const { currentUserDepartment, currentUserOtherDepartment } = useAuth();

  const canManageRegisteredUsers =
    currentUserDepartment === 'OTHER' &&
    currentUserOtherDepartment === 'BUSINESS_INTELLIGENCE';

  const locale = language === 'es' ? 'es-MX' : 'en-US';

  const otherDepartmentLabel = (value?: string | null) => {
    if (!value) return '-';
    if (value === 'OPERATIONS') return t.departmentOperations;
    if (value === 'FINANCE') return t.departmentFinance;
    if (value === 'HUMAN_RESOURCES') return t.departmentHumanResources;
    if (value === 'BUSINESS_INTELLIGENCE') return t.departmentBusinessIntelligence;
    if (value === 'HEAD_ENGINEERING') return t.departmentHeadEngineering;
    return value;
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (a.dateJoined < b.dateJoined ? 1 : -1)),
    [users]
  );

  const hasCreatePassword = createState.password.length > 0;
  const createPasswordStrength = useMemo(
    () => (hasCreatePassword ? getPasswordStrength(createState.password) : null),
    [createState.password, hasCreatePassword]
  );
  const createPasswordCriteria = useMemo(
    () => getPasswordCriteria(createState.password),
    [createState.password]
  );
  const hasCreateConfirmPassword = createState.confirmPassword.length > 0;
  const createPasswordsMatch = hasCreateConfirmPassword && createState.password === createState.confirmPassword;
  const hasResetPassword = (resetPasswordState?.password || '').length > 0;
  const resetPasswordStrength = useMemo(
    () => (hasResetPassword ? getPasswordStrength(resetPasswordState?.password || '') : null),
    [hasResetPassword, resetPasswordState?.password]
  );
  const resetPasswordCriteria = useMemo(
    () => getPasswordCriteria(resetPasswordState?.password || ''),
    [resetPasswordState?.password]
  );
  const hasResetConfirmPassword = (resetPasswordState?.confirmPassword || '').length > 0;
  const resetPasswordsMatch = hasResetConfirmPassword
    && (resetPasswordState?.password || '') === (resetPasswordState?.confirmPassword || '');
  const resetPasswordMissingRules = useMemo(() => {
    const missing: string[] = [];
    if (!resetPasswordCriteria.minLength) missing.push(t.passwordRuleMinLength || 'At least 8 characters');
    if (!resetPasswordCriteria.uppercase) missing.push(t.passwordRuleUppercase || 'At least one uppercase letter');
    if (!resetPasswordCriteria.lowercase) missing.push(t.passwordRuleLowercase || 'At least one lowercase letter');
    if (!resetPasswordCriteria.number) missing.push(t.passwordRuleNumber || 'At least one number');
    if (!resetPasswordCriteria.special) missing.push(t.passwordRuleSpecial || 'At least one special character');
    return missing;
  }, [resetPasswordCriteria, t]);
  const resetPasswordSecurityHint = useMemo(() => {
    if (!hasResetPassword) {
      return language === 'es'
        ? 'Escribe una contrasena para ver los requisitos de seguridad.'
        : 'Type a password to see the security requirements.';
    }
    if (resetPasswordMissingRules.length > 0) {
      const prefix = language === 'es' ? 'Te falta cumplir:' : 'Still missing:';
      return `${prefix} ${resetPasswordMissingRules.join(', ')}.`;
    }
    return language === 'es'
      ? 'Requisitos de seguridad completos.'
      : 'Security requirements complete.';
  }, [hasResetPassword, language, resetPasswordMissingRules]);

  const loadUsers = async (withSpinner = true) => {
    if (!canManageRegisteredUsers) return;
    if (withSpinner) setIsLoading(true);
    setError(null);
    try {
      const data = await registeredUsersApi.getAll();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.registeredUsersLoadError || 'Error loading users'));
    } finally {
      if (withSpinner) {
        setIsLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageRegisteredUsers]);

  const startEdit = (user: RegisteredUser) => {
    setEditState({
      id: user.id,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      department: (user.department as UserDepartment) || '',
      otherDepartment: (user.otherDepartment as OtherDepartment) || '',
      isActive: Boolean(user.isActive),
    });
  };

  const cancelEdit = () => {
    setEditState(null);
    setIsSaving(false);
  };

  const openCreateModal = () => {
    setError(null);
    setCreateState(INITIAL_CREATE_STATE);
    setIsCreateOpen(true);
  };

  const closeCreateModal = () => {
    if (isCreating) return;
    setIsCreateOpen(false);
    setCreateState(INITIAL_CREATE_STATE);
  };

  const openResetPasswordModal = (user: RegisteredUser) => {
    setError(null);
    setResetPasswordState({
      user,
      password: '',
      confirmPassword: '',
    });
  };

  const closeResetPasswordModal = () => {
    if (isResettingPassword) return;
    setResetPasswordState(null);
  };

  const handleCreate = async () => {
    if (!createState.firstName.trim() || !createState.lastName.trim() || !createState.email.trim() || !createState.password) {
      setError(t.completeAllFields);
      return;
    }
    if (!createState.department) {
      setError(t.selectDepartment);
      return;
    }
    if (createState.department === 'OTHER' && !createState.otherDepartment) {
      setError(t.selectOtherDepartment);
      return;
    }
    if (createState.password !== createState.confirmPassword) {
      setError(t.passwordsDoNotMatch);
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const payload = {
        first_name: createState.firstName.trim(),
        last_name: createState.lastName.trim(),
        email: createState.email.trim().toLowerCase(),
        password: createState.password,
        is_active: createState.isActive,
        department: createState.department,
        other_department: createState.department === 'OTHER' ? createState.otherDepartment : null,
      };
      const created = await registeredUsersApi.create(payload);
      setUsers((prev) => [created, ...prev]);
      setIsCreateOpen(false);
      setCreateState(INITIAL_CREATE_STATE);
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.registeredUsersSaveError || 'Error creating user'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleSave = async () => {
    if (!editState) return;
    if (!editState.email.trim()) {
      setError(t.completeAllFields);
      return;
    }
    if (!editState.department) {
      setError(t.selectDepartment);
      return;
    }
    if (editState.department === 'OTHER' && !editState.otherDepartment) {
      setError(t.selectOtherDepartment);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        first_name: editState.firstName.trim(),
        last_name: editState.lastName.trim(),
        email: editState.email.trim().toLowerCase(),
        is_active: editState.isActive,
        department: editState.department,
        other_department: editState.department === 'OTHER' ? editState.otherDepartment : null,
      };
      const updated = await registeredUsersApi.update(editState.id, payload);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
      setEditState(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.registeredUsersSaveError || 'Error saving user'));
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDeleteUser = async (user: RegisteredUser) => {
    setIsDeletingId(user.id);
    setError(null);
    try {
      await registeredUsersApi.delete(user.id);
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
      if (editState?.id === user.id) {
        setEditState(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : (t.registeredUsersDeleteError || 'Error deleting user'));
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordState) return;
    if (!resetPasswordState.password || !resetPasswordState.confirmPassword) {
      setError(t.completeAllFields);
      return;
    }
    if (resetPasswordState.password !== resetPasswordState.confirmPassword) {
      setError(t.passwordsDoNotMatch);
      return;
    }

    const strength = getPasswordStrength(resetPasswordState.password);
    if (strength === 'weak') {
      setError(t.passwordMustBeStrong || 'Password must be strong or medium');
      return;
    }

    setIsResettingPassword(true);
    setError(null);
    try {
      await registeredUsersApi.resetPassword(
        resetPasswordState.user.id,
        resetPasswordState.password,
        resetPasswordState.confirmPassword
      );
      setResetPasswordState(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (t.registeredUsersResetPasswordError || 'Error resetting user password')
      );
    } finally {
      setIsResettingPassword(false);
    }
  };

  if (!canManageRegisteredUsers) {
    return (
      <div className="brand-page-shell registered-users-page p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          {t.onlyBusinessIntelligenceAccess || 'Only Business Intelligence can access this view.'}
        </div>
      </div>
    );
  }

  return (
    <div className="brand-page-shell registered-users-page flex flex-col h-full">
      <div className="brand-page-header px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="brand-title text-2xl font-bold flex items-center gap-2">
              <User size={22} className="text-[#4f3a70]" />
              {t.registeredUsersTitle || t.registeredUsers || 'Registered Users'}
            </h1>
            <p className="brand-subtitle text-sm mt-1">
              {t.registeredUsersSubtitle || 'Manage users created from register screen.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreateModal}
              className="brand-btn-primary inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold transition"
            >
              <Plus size={16} />
              {language === 'es' ? 'Nuevo usuario' : 'New user'}
            </button>
            <button
              onClick={() => {
                if (isRefreshing) return;
                setIsRefreshing(true);
                loadUsers(false);
              }}
              className="brand-btn-primary inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-semibold transition"
              disabled={isRefreshing}
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              {t.refresh || 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#827691]"></div>
          </div>
        ) : sortedUsers.length === 0 ? (
          <div className="brand-panel rounded-lg p-6 text-sm text-[#6c6480]">
            {t.registeredUsersEmpty || 'No registered users found.'}
          </div>
        ) : (
          <div className="brand-panel overflow-x-auto rounded-lg border border-[#d5d1da] bg-white">
            <table className="brand-table min-w-full text-sm">
              <thead className="border-b border-[#d5d1da]">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">{t.name}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.email}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.department}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.otherDepartmentLabel || 'Sub-department'}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.status || 'Status'}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.registeredOn || 'Registered on'}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.lastLogin || 'Last login'}</th>
                  <th className="px-3 py-2 text-left font-semibold">{t.actions}</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((user) => {
                  const isEditing = editState?.id === user.id;
                  return (
                    <tr key={user.id} className="border-b border-gray-100 align-top">
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              value={editState.firstName}
                              onChange={(e) => setEditState((prev) => prev ? { ...prev, firstName: e.target.value } : null)}
                              className="brand-input px-2 py-1 text-sm"
                              placeholder={t.firstName}
                            />
                            <input
                              value={editState.lastName}
                              onChange={(e) => setEditState((prev) => prev ? { ...prev, lastName: e.target.value } : null)}
                              className="brand-input px-2 py-1 text-sm"
                              placeholder={t.lastName}
                            />
                          </div>
                        ) : (
                          <span>{`${user.firstName || ''} ${user.lastName || ''}`.trim() || '-'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <input
                            value={editState.email}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, email: e.target.value } : null)}
                            className="brand-input px-2 py-1 text-sm w-full min-w-[220px]"
                            placeholder={t.email}
                          />
                        ) : (
                          <span>{user.email}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select
                            value={editState.department}
                            onChange={(e) =>
                              setEditState((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      department: e.target.value as UserDepartment,
                                      otherDepartment: e.target.value === 'OTHER' ? prev.otherDepartment : '',
                                    }
                                  : null
                              )
                            }
                            className="brand-select px-2 py-1 text-sm w-full"
                          >
                            <option value="">{t.selectDepartment}</option>
                            {USER_DEPARTMENTS.map((dept) => (
                              <option key={dept} value={dept}>
                                {dept === 'OTHER' ? t.departmentOther : dept}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{user.department === 'OTHER' ? t.departmentOther : (user.department || '-')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing && editState.department === 'OTHER' ? (
                          <select
                            value={editState.otherDepartment}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, otherDepartment: e.target.value as OtherDepartment } : null)}
                            className="brand-select px-2 py-1 text-sm w-full min-w-[180px]"
                          >
                            <option value="">{t.selectOtherDepartment}</option>
                            {OTHER_DEPARTMENTS.map((dept) => (
                              <option key={dept} value={dept}>
                                {otherDepartmentLabel(dept)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{otherDepartmentLabel(user.otherDepartment)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select
                            value={editState.isActive ? 'true' : 'false'}
                            onChange={(e) => setEditState((prev) => prev ? { ...prev, isActive: e.target.value === 'true' } : null)}
                            className="brand-select px-2 py-1 text-sm"
                          >
                            <option value="true">{t.active}</option>
                            <option value="false">{t.inactive}</option>
                          </select>
                        ) : (
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {user.isActive ? t.active : t.inactive}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(user.dateJoined)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(user.lastLogin)}</td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleSave}
                              disabled={isSaving}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold disabled:bg-green-400"
                            >
                              <Save size={14} />
                              {t.save}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold"
                            >
                              <X size={14} />
                              {t.cancel}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openResetPasswordModal(user)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold"
                              title={t.registeredUsersResetPasswordAction || 'Reset password'}
                            >
                              <KeyRound size={14} />
                              {t.registeredUsersResetPasswordAction || 'Reset pass'}
                            </button>
                            <button
                              onClick={() => startEdit(user)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 brand-btn-primary text-white text-xs font-semibold"
                            >
                              <Pencil size={14} />
                              {t.edit}
                            </button>
                            <button
                              onClick={() => setDeleteTarget(user)}
                              disabled={isDeletingId === user.id}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:bg-red-400"
                            >
                              <Trash2 size={14} />
                              {t.delete}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-4">
          <div
            className="absolute inset-0"
            onClick={closeCreateModal}
          />
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-[#d5d1da] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#e4e1e8] bg-gradient-to-r from-[#f8f7fb] to-white">
              <h3 className="text-lg font-bold text-[#2e1a47]">
                {language === 'es' ? 'Registrar nuevo usuario' : 'Register new user'}
              </h3>
              <p className="text-sm text-[#6c6480]">
                {language === 'es'
                  ? 'Crea y administra usuarios desde esta pantalla.'
                  : 'Create and manage users from this screen.'}
              </p>
            </div>

            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.firstName}</label>
                  <input
                    value={createState.firstName}
                    onChange={(e) => setCreateState((prev) => ({ ...prev, firstName: e.target.value }))}
                    className="brand-input px-3 py-2 text-sm w-full"
                    placeholder={t.firstName}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.lastName}</label>
                  <input
                    value={createState.lastName}
                    onChange={(e) => setCreateState((prev) => ({ ...prev, lastName: e.target.value }))}
                    className="brand-input px-3 py-2 text-sm w-full"
                    placeholder={t.lastName}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.email}</label>
                <input
                  type="email"
                  value={createState.email}
                  onChange={(e) => setCreateState((prev) => ({ ...prev, email: e.target.value }))}
                  className="brand-input px-3 py-2 text-sm w-full"
                  placeholder={t.email}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.password}</label>
                  <input
                    type="password"
                    value={createState.password}
                    onChange={(e) => setCreateState((prev) => ({ ...prev, password: e.target.value }))}
                    className="brand-input px-3 py-2 text-sm w-full"
                    placeholder={t.password}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.confirmPassword}</label>
                  <input
                    type="password"
                    value={createState.confirmPassword}
                    onChange={(e) => setCreateState((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                    className="brand-input px-3 py-2 text-sm w-full"
                    placeholder={t.confirmPassword}
                  />
                  {hasCreateConfirmPassword && (
                    <p className={`text-[11px] mt-1 ${createPasswordsMatch ? 'text-green-700' : 'text-red-600'}`}>
                      {createPasswordsMatch
                        ? (t.passwordsMatch || 'Passwords match')
                        : t.passwordsDoNotMatch}
                    </p>
                  )}
                </div>
              </div>

              {hasCreatePassword && (
                <div className="rounded-xl border border-[#ddd9e5] bg-[#f8f7fb] p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[#6f6782]">
                      {t.passwordStrength || 'Password strength'}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        createPasswordStrength === 'weak'
                          ? 'text-red-600'
                          : createPasswordStrength === 'medium'
                            ? 'text-amber-600'
                            : 'text-emerald-700'
                      }`}
                    >
                      {createPasswordStrength === 'weak' && (t.weak || 'Weak')}
                      {createPasswordStrength === 'medium' && (t.medium || 'Medium')}
                      {createPasswordStrength === 'strong' && (t.strong || 'Strong')}
                    </span>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-[#ded8e8] overflow-hidden">
                    <div
                      className={`h-full w-full rounded-full transition-all duration-500 ${
                        createPasswordStrength === 'weak'
                          ? 'bg-red-500'
                          : createPasswordStrength === 'medium'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                      }`}
                    />
                  </div>

                  <p className="text-[11px] text-[#6f6782] mt-2">
                    {t.passwordRequirements || 'Password requirements'}
                  </p>
                  <PasswordRequirementsChecklist
                    criteria={createPasswordCriteria}
                    t={t}
                    variant="light"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.department}</label>
                  <select
                    value={createState.department}
                    onChange={(e) =>
                      setCreateState((prev) => ({
                        ...prev,
                        department: e.target.value as UserDepartment,
                        otherDepartment: e.target.value === 'OTHER' ? prev.otherDepartment : '',
                      }))
                    }
                    className="brand-select px-3 py-2 text-sm w-full"
                  >
                    <option value="">{t.selectDepartment}</option>
                    {USER_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept === 'OTHER' ? t.departmentOther : dept}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">
                    {t.otherDepartmentLabel || 'Sub-department'}
                  </label>
                  <select
                    value={createState.otherDepartment}
                    onChange={(e) => setCreateState((prev) => ({ ...prev, otherDepartment: e.target.value as OtherDepartment }))}
                    className="brand-select px-3 py-2 text-sm w-full"
                    disabled={createState.department !== 'OTHER'}
                  >
                    <option value="">{t.selectOtherDepartment}</option>
                    {OTHER_DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {otherDepartmentLabel(dept)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.status || 'Status'}</label>
                <select
                  value={createState.isActive ? 'true' : 'false'}
                  onChange={(e) => setCreateState((prev) => ({ ...prev, isActive: e.target.value === 'true' }))}
                  className="brand-select px-3 py-2 text-sm w-full max-w-xs"
                >
                  <option value="true">{t.active}</option>
                  <option value="false">{t.inactive}</option>
                </select>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#e4e1e8] flex items-center justify-end gap-2 bg-white">
              <button
                onClick={closeCreateModal}
                disabled={isCreating}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-60"
              >
                <X size={14} />
                {t.cancel}
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 bg-[#4f3a70] hover:bg-[#3f2d5a] text-white text-sm font-semibold disabled:opacity-70"
              >
                {isCreating ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                {language === 'es' ? 'Registrar usuario' : 'Register user'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetPasswordState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-4">
          <div
            className="absolute inset-0"
            onClick={closeResetPasswordModal}
          />
          <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-[#d5d1da] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#e4e1e8] bg-gradient-to-r from-[#fff7ed] to-white">
              <h3 className="text-lg font-bold text-[#2e1a47]">
                {t.registeredUsersResetPasswordTitle || 'Reset password'}
              </h3>
              <p className="text-sm text-[#6c6480]">
                {t.registeredUsersResetPasswordSubtitle || 'Set a new password for this user.'}
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="rounded-lg border border-[#e7e1d6] bg-[#fffaf3] p-3">
                <p className="text-sm font-semibold text-[#433055]">
                  {`${resetPasswordState.user.firstName || ''} ${resetPasswordState.user.lastName || ''}`.trim() || '-'}
                </p>
                <p className="text-xs text-[#6f6782]">{resetPasswordState.user.email}</p>
                <p className="text-xs text-amber-700 mt-2">
                  {t.registeredUsersResetPasswordWarning || 'Active sessions for this user will be closed and they will need to sign in again.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.newPasswordLabel || 'New Password'}</label>
                  <input
                    type="password"
                    value={resetPasswordState.password}
                    onChange={(e) => setResetPasswordState((prev) => prev ? { ...prev, password: e.target.value } : null)}
                    className="brand-input px-3 py-2 text-sm w-full"
                    placeholder={t.newPasswordPlaceholder || 'Enter new password'}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-[#4f3a70]">{t.confirmNewPasswordLabel || 'Confirm New Password'}</label>
                  <input
                    type="password"
                    value={resetPasswordState.confirmPassword}
                    onChange={(e) => setResetPasswordState((prev) => prev ? { ...prev, confirmPassword: e.target.value } : null)}
                    className="brand-input px-3 py-2 text-sm w-full"
                    placeholder={t.confirmNewPasswordPlaceholder || 'Confirm password'}
                  />
                  {hasResetConfirmPassword && (
                    <p className={`text-[11px] mt-1 ${resetPasswordsMatch ? 'text-green-700' : 'text-red-600'}`}>
                      {resetPasswordsMatch
                        ? (t.passwordsMatch || 'Passwords match')
                        : t.passwordsDoNotMatch}
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-[#ddd9e5] bg-[#f8f7fb] p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#6f6782]">
                    {t.passwordStrength || 'Password strength'}
                  </span>
                  {hasResetPassword ? (
                    <span
                      className={`text-xs font-semibold ${
                        resetPasswordStrength === 'weak'
                          ? 'text-red-600'
                          : resetPasswordStrength === 'medium'
                            ? 'text-amber-600'
                            : 'text-emerald-700'
                      }`}
                    >
                      {resetPasswordStrength === 'weak' && (t.weak || 'Weak')}
                      {resetPasswordStrength === 'medium' && (t.medium || 'Medium')}
                      {resetPasswordStrength === 'strong' && (t.strong || 'Strong')}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#8a8498]">
                      {language === 'es' ? 'Pendiente' : 'Pending'}
                    </span>
                  )}
                </div>

                <div className="h-1.5 w-full rounded-full bg-[#ded8e8] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      !hasResetPassword
                        ? 'w-0'
                        : `w-full ${
                          resetPasswordStrength === 'weak'
                            ? 'bg-red-500'
                            : resetPasswordStrength === 'medium'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        }`
                    }`}
                  />
                </div>

                <p className="text-[11px] text-[#6f6782] mt-2">
                  {t.passwordRequirements || 'Password requirements'}
                </p>
                <PasswordRequirementsChecklist
                  criteria={resetPasswordCriteria}
                  t={t}
                  variant="light"
                />
                <p
                  className={`text-[11px] mt-2 ${
                    !hasResetPassword
                      ? 'text-[#7d7690]'
                      : resetPasswordMissingRules.length > 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                  }`}
                >
                  {resetPasswordSecurityHint}
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#e4e1e8] flex items-center justify-end gap-2 bg-white">
              <button
                onClick={closeResetPasswordModal}
                disabled={isResettingPassword}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-60"
              >
                <X size={14} />
                {t.cancel}
              </button>
              <button
                onClick={handleResetPassword}
                disabled={isResettingPassword}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-70"
              >
                {isResettingPassword ? <RefreshCw size={14} className="animate-spin" /> : <KeyRound size={14} />}
                {t.registeredUsersResetPasswordAction || 'Reset pass'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-4">
          <div
            className="absolute inset-0"
            onClick={() => {
              if (isDeletingId) return;
              setDeleteTarget(null);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-red-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-red-100 bg-gradient-to-r from-red-50 to-rose-50">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {t.delete || 'Delete'} {t.registeredUsers || 'User'}
                  </h3>
                  <p className="text-sm text-slate-600">
                    {t.deleteConfirm || 'Please confirm this action.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {`${deleteTarget.firstName || ''} ${deleteTarget.lastName || ''}`.trim() || '-'}
                </p>
                <p className="text-xs text-slate-600">{deleteTarget.email}</p>
              </div>
              <p className="text-sm text-slate-700">
                {language === 'es'
                  ? 'Esta accion eliminara el usuario de forma permanente.'
                  : 'This action will permanently delete the user.'}
              </p>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-white">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(isDeletingId)}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold disabled:opacity-60"
              >
                <X size={14} />
                {t.cancel}
              </button>
              <button
                onClick={() => confirmDeleteUser(deleteTarget)}
                disabled={isDeletingId === deleteTarget.id}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:bg-red-400"
              >
                {isDeletingId === deleteTarget.id ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {t.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
