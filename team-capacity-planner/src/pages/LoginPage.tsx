import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { authApi } from '../services/api';
import type { Language } from '../types';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const { login } = useAuth();
  const { language, setLanguage } = useLanguage();
  const t = useTranslation(language);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setVerificationMessage(null);
    setError(null);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.loginError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isUnverifiedAccount = (error || '').toLowerCase().includes('sin verificar')
    || (error || '').toLowerCase().includes('unverified');

  const handleResendVerificationCode = async () => {
    if (!email) {
      setError('Ingresa tu correo para reenviar el codigo');
      return;
    }

    setIsResendingCode(true);
    setVerificationMessage(null);
    try {
      await authApi.resendVerificationEmail(email);
      setVerificationMessage('Te enviamos un nuevo codigo de verificacion a tu correo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reenviar el codigo');
    } finally {
      setIsResendingCode(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-fade-in {
          animation: fade-in 0.6s ease-out;
        }
        .animate-shake {
          animation: shake 0.3s ease-in-out;
        }
      `}</style>

      <div className="brand-auth-bg min-h-screen flex items-center justify-center relative overflow-hidden px-4 py-8">
        {/* Decorative background elements */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_120%,rgba(206,0,55,0.18),rgba(46,26,71,0)_52%)]" />
        <div className="absolute top-0 right-0 w-48 h-48 md:w-96 md:h-96 bg-[#827691]/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 md:w-96 md:h-96 bg-[#ce0037]/10 rounded-full blur-3xl" />

        {/* Language selector */}
        <div className="absolute top-4 right-4 md:top-6 md:right-6 flex gap-2 z-20">
          <button
            onClick={() => setLanguage('es' as Language)}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 text-xl ${
              language === 'es'
                ? 'bg-gradient-to-r from-[#2e1a47] to-[#827691] text-white shadow-lg shadow-[#2e1a47]/40 scale-105'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white hover:scale-105'
            }`}
            title="Español"
          >
            🇲🇽
          </button>
          <button
            onClick={() => setLanguage('en' as Language)}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-300 text-xl ${
              language === 'en'
                ? 'bg-gradient-to-r from-[#2e1a47] to-[#827691] text-white shadow-lg shadow-[#2e1a47]/40 scale-105'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white hover:scale-105'
            }`}
            title="English"
          >
            🇺🇸
          </button>
        </div>

        {/* Card */}
        <div className="brand-auth-card relative z-10 p-6 md:p-8 rounded-2xl w-full max-w-md animate-fade-in">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 flex w-full max-w-[320px] items-center gap-3 rounded-xl border border-[#d5d1da]/35 bg-[#2a193f]/75 px-3 py-2 shadow-[0_10px_24px_rgba(16,8,28,0.35)] backdrop-blur-sm">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg border border-white/20 bg-[#1f1132]/70 p-1">
                <img
                  src="/scio-favicon.svg"
                  alt="SCIO Automation logo"
                  className="h-full w-full rounded-md object-contain"
                />
              </div>
              <div className="min-w-0 text-left">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#c7b9df]">
                  SCIO Automation
                </p>
                <p className="truncate text-lg font-bold leading-tight text-white">
                  {t.teamCapacity}
                </p>
                <p className="text-[11px] font-medium text-[#d5d1da]">
                  {t.teamCapacityPlanner}
                </p>
              </div>
            </div>
            <h1 className="brand-auth-title text-4xl mb-2">
              {t.loginTitle}
            </h1>
            <p className="text-[#d5d1da] text-sm">{t.loginSubtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg animate-shake backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm">{error}</span>
                </div>
                {isUnverifiedAccount && (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleResendVerificationCode}
                      disabled={isResendingCode}
                      className="text-left text-sm text-[#c7b9df] hover:text-[#ddd1ef] disabled:text-zinc-500 disabled:cursor-not-allowed"
                    >
                      {isResendingCode ? 'Reenviando codigo...' : 'Reenviar codigo de verificacion'}
                    </button>
                    <Link
                      to={`/register?step=verify&email=${encodeURIComponent(email)}`}
                      className="text-left text-sm text-[#c7b9df] hover:text-[#ddd1ef]"
                    >
                      Ir a verificar codigo
                    </Link>
                  </div>
                )}
              </div>
            )}

            {verificationMessage && (
              <div className="bg-green-500/10 border border-green-500/50 text-green-400 px-4 py-3 rounded-lg backdrop-blur-sm">
                <span className="text-sm">{verificationMessage}</span>
              </div>
            )}

            {/* Email field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-2">
                {t.email}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-[#c7b9df] transition-colors duration-300">
                  <Mail size={20} />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                           focus:outline-none focus:ring-2 focus:ring-[#827691]/50 focus:border-[#827691]
                             transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900"
                  placeholder={t.enterEmail}
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-300 mb-2">
                {t.password}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-[#c7b9df] transition-colors duration-300">
                  <Lock size={20} />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-12 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                           focus:outline-none focus:ring-2 focus:ring-[#827691]/50 focus:border-[#827691]
                             transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900"
                  placeholder={t.enterPassword}
                  required
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-white transition-colors duration-300"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-gradient-to-r from-[#2e1a47] to-[#827691] hover:from-[#3b2658] hover:to-[#978bab]
                         disabled:from-zinc-700 disabled:to-zinc-600 disabled:cursor-not-allowed
                         text-white font-semibold rounded-lg
                         transition-all duration-300
                         transform hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-[#2e1a47]/35
                         flex items-center justify-center"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t.loggingIn}
                </>
              ) : (
                t.login
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-7">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-zinc-800 text-zinc-500 font-medium">{t.or}</span>
            </div>
          </div>

          {/* Register link */}
          <Link
            to="/register"
            className="block w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-lg
                       transition-all duration-300 text-center border border-zinc-700 hover:border-zinc-600
                       hover:shadow-lg hover:scale-[1.01]"
          >
            {t.noAccountRegister}
          </Link>

          {/* Footer */}
          <div className="mt-7 text-center text-sm">
            <p className="text-zinc-500 hover:text-zinc-400 transition-colors duration-300">{t.contactAdmin}</p>
          </div>
        </div>
      </div>
    </>
  );
};

export default LoginPage;
