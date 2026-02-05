import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, ArrowLeft, Languages } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation, type Language } from '../utils/translations';

const BASE_URL = import.meta.env.VITE_API_URL || 'https://capacity-planner-production.up.railway.app';
const API_URL = `${BASE_URL}/api`;

export const ChangePasswordPage = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const t = useTranslation(language);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);

  const calculatePasswordStrength = (password: string): 'weak' | 'medium' | 'strong' => {
    if (password.length < 8) return 'weak';

    let strength = 0;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z\d]/.test(password)) strength++;

    if (strength >= 3) return 'strong';
    if (strength >= 2) return 'medium';
    return 'weak';
  };

  const hasConfirmPassword = confirmPassword.trim().length > 0;
  const passwordsMatch = hasConfirmPassword && newPassword === confirmPassword;

  const handleNewPasswordChange = (value: string) => {
    setNewPassword(value);
    setPasswordStrength(value ? calculatePasswordStrength(value) : null);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      if (!currentPassword || !newPassword || !confirmPassword) {
        setError(t.completeAllFields);
        setIsLoading(false);
        return;
      }

      if (newPassword !== confirmPassword) {
        setError(t.passwordsDoNotMatch);
        setIsLoading(false);
        return;
      }

      if (newPassword.length < 8) {
        setError(t.passwordTooShort);
        setIsLoading(false);
        return;
      }

      const token = localStorage.getItem('access_token');

      await axios.post(
        `${API_URL}/change-password/`,
        {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setSuccess(t.changePasswordSuccessMessage || 'Password updated successfully. Please sign in again.');

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordStrength(null);

      setTimeout(() => {
        logout();
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || t.changePasswordError || 'Error changing password';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 px-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(59,130,246,0.1),rgba(0,0,0,0))]" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />

      <div className="absolute top-4 right-4 md:top-6 md:right-6 z-20 flex items-center gap-2 bg-zinc-900/70 border border-zinc-700 rounded-xl px-2 py-1.5">
        <Languages size={14} className="text-zinc-300" />
        <button
          onClick={() => setLanguage('es' as Language)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
            language === 'es' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
          title="Espanol"
          type="button"
        >
          MX
        </button>
        <button
          onClick={() => setLanguage('en' as Language)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
            language === 'en' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
          title="English"
          type="button"
        >
          US
        </button>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={20} />
          <span>{t.back || 'Back'}</span>
        </button>

        <div className="bg-zinc-800/90 backdrop-blur-xl p-8 rounded-2xl shadow-2xl shadow-black/50 border border-zinc-700/50">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-blue-500 to-amber-400 bg-clip-text text-transparent mb-2">
            {t.changePassword}
          </h1>
          <p className="text-zinc-400 text-sm mb-6">
            {t.changePasswordSubtitle || 'Update your password for better security'}
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="bg-green-500/10 border border-green-500/50 text-green-400 px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">{t.currentPasswordLabel || 'Current Password'}</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-blue-400 transition-colors">
                  <Lock size={20} />
                </div>
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-11 pr-12 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500
                             transition-all duration-300 hover:border-zinc-600 disabled:opacity-50"
                  placeholder={t.currentPasswordPlaceholder || 'Enter your current password'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-white transition-colors"
                >
                  {showCurrentPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">{t.newPasswordLabel || 'New Password'}</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-blue-400 transition-colors">
                  <Lock size={20} />
                </div>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => handleNewPasswordChange(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-11 pr-12 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500
                             transition-all duration-300 hover:border-zinc-600 disabled:opacity-50"
                  placeholder={t.newPasswordPlaceholder || 'Enter a new password (min. 8 characters)'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-white transition-colors"
                >
                  {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {passwordStrength && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-400">{t.passwordStrength}</span>
                    <span
                      className={`text-xs font-semibold ${
                        passwordStrength === 'weak'
                          ? 'text-red-400'
                          : passwordStrength === 'medium'
                          ? 'text-yellow-400'
                          : 'text-green-400'
                      }`}
                    >
                      {passwordStrength === 'weak' && t.weak}
                      {passwordStrength === 'medium' && t.medium}
                      {passwordStrength === 'strong' && t.strong}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
                    <div
                      className={`h-full w-full rounded-full transition-all duration-500 ${
                        passwordStrength === 'weak'
                          ? 'bg-red-500 shadow-lg shadow-red-500/50'
                          : passwordStrength === 'medium'
                          ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50'
                          : 'bg-green-500 shadow-lg shadow-green-500/50'
                      }`}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-zinc-400 mt-2">{t.passwordRequirements}</p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">{t.confirmNewPasswordLabel || 'Confirm New Password'}</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-blue-400 transition-colors">
                  <Lock size={20} />
                </div>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-11 pr-12 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500
                             transition-all duration-300 hover:border-zinc-600 disabled:opacity-50"
                  placeholder={t.confirmNewPasswordPlaceholder || 'Confirm your new password'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-white transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {hasConfirmPassword && (
                <p className={`text-xs mt-2 ${passwordsMatch ? 'text-green-400' : 'text-red-400'}`}>
                  {passwordsMatch ? (t.passwordsMatch || 'Passwords match') : t.passwordsDoNotMatch}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-amber-500
                         disabled:from-zinc-700 disabled:to-zinc-600 disabled:cursor-not-allowed
                         text-white font-semibold rounded-lg
                         transition-all duration-300
                         transform hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/50
                         active:scale-[0.98]
                         flex items-center justify-center"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t.changingPassword || 'Changing...'}
                </>
              ) : (
                t.changePassword
              )}
            </button>
          </form>

          <p className="text-xs text-zinc-500 mt-4 text-center">
            {t.changePasswordReLoginInfo || 'For security, you will need to sign in again after changing your password.'}
          </p>
        </div>
      </div>
    </div>
  );
};
