import React, { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, User, Building2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { authApi } from '../services/api';
import { PasswordRequirementsChecklist } from '../components/PasswordRequirementsChecklist';
import { getPasswordCriteria, getPasswordStrength } from '../utils/passwordValidation';
import type { Language, UserDepartment, OtherDepartment } from '../types';

const DEPARTMENTS: UserDepartment[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'OTHER'];
const OTHER_DEPARTMENTS: OtherDepartment[] = [
  'OPERATIONS',
  'FINANCE',
  'HUMAN_RESOURCES',
  'BUSINESS_INTELLIGENCE',
  'HEAD_ENGINEERING',
];

type Step = 'register' | 'verify' | 'success';

const RegisterPage: React.FC = () => {
  const [step, setStep] = useState<Step>('register');
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    department: '' as UserDepartment | '',
    otherDepartment: '' as OtherDepartment | '',
  });
  const [verificationCode, setVerificationCode] = useState(['', '', '', '', '', '']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const initializedFromQuery = useRef(false);

  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { language, setLanguage } = useLanguage();
  const t = useTranslation(language);
  const hasConfirmPassword = formData.confirmPassword.trim().length > 0;
  const passwordsMatch = hasConfirmPassword && formData.password === formData.confirmPassword;
  const passwordCriteria = getPasswordCriteria(formData.password);

  useEffect(() => {
    if (initializedFromQuery.current) return;
    initializedFromQuery.current = true;

    const emailFromQuery = (searchParams.get('email') || '').trim().toLowerCase();
    const startStep = (searchParams.get('step') || '').trim().toLowerCase();

    if (!emailFromQuery) return;

    setFormData(prev => ({
      ...prev,
      email: prev.email || emailFromQuery,
    }));

    if (startStep === 'verify') {
      setStep('verify');
    }
  }, [searchParams]);

  // Cooldown timer for resend
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    if (name === 'password') {
      setPasswordStrength(value ? getPasswordStrength(value) : null);
    }
  };

  // Handle verification code input
  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...verificationCode];
    newCode[index] = value.slice(-1);
    setVerificationCode(newCode);

    if (value && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !verificationCode[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newCode = [...verificationCode];
    for (let i = 0; i < pastedData.length; i++) {
      newCode[i] = pastedData[i];
    }
    setVerificationCode(newCode);
    const nextIndex = Math.min(pastedData.length, 5);
    codeInputRefs.current[nextIndex]?.focus();
  };

  const handleResendCode = async () => {
    if (resendCooldown > 0) return;

    setIsResendingCode(true);
    setResendMessage(null);
    setError(null);

    try {
      await authApi.resendVerificationEmail(formData.email);
      setResendMessage(t.codeSent || 'New code sent to your email');
      setResendCooldown(60);
      setVerificationCode(['', '', '', '', '', '']);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setIsResendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.email || !formData.password || !formData.confirmPassword ||
        !formData.firstName || !formData.lastName || !formData.department) {
      setError(t.completeAllFields);
      return;
    }
    if (formData.department === 'OTHER' && !formData.otherDepartment) {
      setError(t.selectOtherDepartment || t.completeAllFields);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError(t.passwordsDoNotMatch);
      return;
    }

    if (formData.password.length < 8) {
      setError(t.passwordTooShort);
      return;
    }

    const strength = getPasswordStrength(formData.password);
    if (strength === 'weak') {
      setError(t.passwordMustBeStrong || 'Password must be strong');
      return;
    }

    setIsSubmitting(true);

    try {
      await authApi.register({
        email: formData.email,
        password: formData.password,
        confirm_password: formData.confirmPassword,
        first_name: formData.firstName,
        last_name: formData.lastName,
        department: formData.department as string,
        other_department: formData.department === 'OTHER' ? formData.otherDepartment : undefined,
      });

      setVerificationCode(['', '', '', '', '', '']);
      setResendMessage(t.codeSent || 'Code sent to your email');
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.registrationError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const code = verificationCode.join('');
    if (code.length !== 6) {
      setError(t.enterCompleteCode || 'Please enter the complete 6-digit code');
      return;
    }

    setIsSubmitting(true);

    try {
      await authApi.verifyCode(formData.email, code);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setVerificationCode(['', '', '', '', '', '']);
      codeInputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Language toggle component
  const LanguageToggle = () => (
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
  );

  // SUCCESS STEP
  if (step === 'success') {
    return (
      <>
        <style>{`
          @keyframes scale-in {
            from {
              transform: scale(0);
              opacity: 0;
            }
            to {
              transform: scale(1);
              opacity: 1;
            }
          }
          @keyframes draw-check {
            from {
              stroke-dasharray: 1000;
              stroke-dashoffset: 1000;
            }
            to {
              stroke-dasharray: 1000;
              stroke-dashoffset: 0;
            }
          }
          .animate-scale-in {
            animation: scale-in 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
          }
          .animate-draw-check {
            animation: draw-check 0.5s ease-in-out 0.3s forwards;
            stroke-dasharray: 1000;
            stroke-dashoffset: 1000;
          }
        `}</style>

        <div className="brand-auth-bg min-h-screen flex items-center justify-center relative overflow-hidden px-4 py-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(59,130,246,0.1),rgba(0,0,0,0))]" />
          <div className="absolute top-0 right-0 w-48 h-48 md:w-96 md:h-96 bg-green-500/5 rounded-full blur-3xl" />

          <div className="brand-auth-card relative z-10 p-6 md:p-8 rounded-2xl w-full max-w-md">
            <div className="text-center">
              <div className="relative mb-6">
                <div className="w-24 h-24 mx-auto rounded-full bg-green-500/20 animate-ping absolute inset-0 m-auto" />
                <div className="relative w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-green-500 to-green-600
                            flex items-center justify-center shadow-2xl shadow-green-500/50
                            animate-scale-in">
                  <svg
                    className="w-12 h-12 text-white animate-draw-check"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">{t.registrationSuccessTitle || 'Registration Successful!'}</h2>
              <p className="text-zinc-400 mb-8">
                {t.registrationSuccessMessage || 'Your email has been verified. You can now log in.'}
              </p>

              <button
                type="button"
                onClick={() => {
                  window.location.href = '/login';
                }}
                className="w-full py-3 px-4 bg-gradient-to-r from-[#2e1a47] to-[#827691] hover:from-[#3b2658] hover:to-[#978bab]
                           text-white font-semibold rounded-lg
                           transition-all duration-300
                           transform hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-[#2e1a47]/35"
              >
                {t.backToLogin}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // VERIFICATION STEP
  if (step === 'verify') {
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

        <div className="brand-auth-bg min-h-screen flex items-center justify-center py-12 px-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(59,130,246,0.1),rgba(0,0,0,0))]" />
          <div className="absolute top-0 right-0 w-48 h-48 md:w-96 md:h-96 bg-[#827691]/10 rounded-full blur-3xl" />

          <LanguageToggle />

          <div className="brand-auth-card relative z-10 p-6 md:p-8 rounded-2xl w-full max-w-md animate-fade-in">
            <div className="text-center mb-8">
              <div className="mb-4 flex justify-center">
              <Mail size={48} className="text-[#d5d1da]" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">{t.verifyYourEmail || 'Verify Your Email'}</h1>
              <p className="text-zinc-400 text-sm">
                {t.codeSentTo || 'We sent a 6-digit code to'}
              </p>
              <p className="text-[#f6d5df] font-medium">{formData.email}</p>
            </div>

            <form onSubmit={handleVerifyCode} className="space-y-6">
              {error && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg animate-shake text-sm">
                  {error}
                </div>
              )}

              {resendMessage && (
                <div className="bg-green-500/10 border border-green-500/50 text-green-400 px-4 py-3 rounded-lg text-sm text-center">
                  {resendMessage}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-3 text-center">
                  {t.enterVerificationCode || 'Enter verification code'}
                </label>
                <div className="flex justify-center gap-2" onPaste={handleCodePaste}>
                  {verificationCode.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => { codeInputRefs.current[index] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeChange(index, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(index, e)}
                      className="w-12 h-14 text-center text-2xl font-bold bg-zinc-900/50 border border-zinc-700 rounded-lg text-white
                                 focus:outline-none focus:ring-2 focus:ring-[#827691]/40 focus:border-[#827691]
                                 transition-all duration-300 hover:border-zinc-600"
                      disabled={isSubmitting}
                    />
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-2 text-center">
                  {t.codeExpiresIn || 'Code expires in 15 minutes'}
                </p>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || verificationCode.join('').length !== 6}
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
                    {t.verifying || 'Verifying...'}
                  </>
                ) : (
                  t.verifyCode || 'Verify Code'
                )}
              </button>
            </form>

            <div className="mt-6 text-center space-y-3">
              <p className="text-zinc-400 text-sm">{t.didntReceiveCode || "Didn't receive the code?"}</p>
              <button
                onClick={handleResendCode}
                disabled={isResendingCode || resendCooldown > 0}
                className="text-[#d5d1da] hover:text-white text-sm font-medium transition-colors disabled:text-zinc-500 disabled:cursor-not-allowed"
              >
                {isResendingCode ? (
                  t.resendingCode || 'Sending...'
                ) : resendCooldown > 0 ? (
                  `${t.resendCodeIn || 'Resend code in'} ${resendCooldown}s`
                ) : (
                  t.resendCode || 'Resend Code'
                )}
              </button>

              <button
                onClick={() => {
                  setStep('register');
                  setError(null);
                  setResendMessage(null);
                  setVerificationCode(['', '', '', '', '', '']);
                }}
                className="block w-full text-zinc-400 hover:text-zinc-300 text-sm transition-colors"
              >
                {t.changeEmail || '← Change email address'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // REGISTER STEP
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

        <div className="brand-auth-bg min-h-screen flex items-center justify-center py-12 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(59,130,246,0.1),rgba(0,0,0,0))]" />
        <div className="absolute top-0 right-0 w-48 h-48 md:w-96 md:h-96 bg-[#827691]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 md:w-96 md:h-96 bg-amber-500/5 rounded-full blur-3xl" />

        <LanguageToggle />

        <div className="brand-auth-card relative z-10 p-6 md:p-8 rounded-2xl w-full max-w-md animate-fade-in">
          <div className="text-center mb-8">
            <h1 className="brand-auth-title text-4xl mb-2">
              {t.registerTitle}
            </h1>
            <p className="text-zinc-400 text-sm">{t.registerSubtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg animate-shake text-sm">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span>{error}</span>
                </div>
              </div>
            )}

            {/* Name fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-zinc-300 mb-2">
                  {t.firstName}
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-[#c7b9df] transition-colors duration-300">
                    <User size={20} />
                  </div>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    value={formData.firstName}
                    onChange={handleChange}
                    className="w-full pl-11 pr-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                               focus:outline-none focus:ring-2 focus:ring-[#827691]/50 focus:border-[#827691]
                               transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900"
                    placeholder={t.egJohn}
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-zinc-300 mb-2">
                  {t.lastName}
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-[#c7b9df] transition-colors duration-300">
                    <User size={20} />
                  </div>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    value={formData.lastName}
                    onChange={handleChange}
                    className="w-full pl-11 pr-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                               focus:outline-none focus:ring-2 focus:ring-[#827691]/40 focus:border-[#827691]
                               transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900"
                    placeholder={t.egDoe}
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>

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
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                             focus:outline-none focus:ring-2 focus:ring-[#827691]/50 focus:border-[#827691]
                             transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900"
                  placeholder="user@example.com"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Department field */}
            <div>
              <label htmlFor="department" className="block text-sm font-medium text-zinc-300 mb-2">
                {t.department}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-[#c7b9df] transition-colors duration-300">
                  <Building2 size={20} />
                </div>
                <select
                  id="department"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-white
                             focus:outline-none focus:ring-2 focus:ring-[#827691]/50 focus:border-[#827691]
                             transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900
                             [&>option]:bg-zinc-900 [&>option]:text-white"
                  required
                  disabled={isSubmitting}
                >
                  <option value="" className="bg-zinc-900 text-white">{t.selectDepartment}</option>
                  {DEPARTMENTS.map(dept => (
                    <option key={dept} value={dept} className="bg-zinc-900 text-white">
                      {dept === 'OTHER' ? t.departmentOther : dept}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {formData.department === 'OTHER' && (
              <div>
                <label htmlFor="otherDepartment" className="block text-sm font-medium text-zinc-300 mb-2">
                  {t.otherDepartmentLabel}
                </label>
                <select
                  id="otherDepartment"
                  name="otherDepartment"
                  value={formData.otherDepartment}
                  onChange={handleChange}
                  className="w-full pl-11 pr-4 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-white
                             focus:outline-none focus:ring-2 focus:ring-[#827691]/50 focus:border-[#827691]
                             transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900
                             [&>option]:bg-zinc-900 [&>option]:text-white"
                  disabled={isSubmitting}
                >
                  <option value="" className="bg-zinc-900 text-white">{t.selectOtherDepartment}</option>
                  {OTHER_DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept} className="bg-zinc-900 text-white">
                      {dept === 'OPERATIONS' && t.departmentOperations}
                      {dept === 'FINANCE' && t.departmentFinance}
                      {dept === 'HUMAN_RESOURCES' && t.departmentHumanResources}
                      {dept === 'BUSINESS_INTELLIGENCE' && t.departmentBusinessIntelligence}
                      {dept === 'HEAD_ENGINEERING' && t.departmentHeadEngineering}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={handleChange}
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
                  disabled={isSubmitting}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

              {/* Password strength indicator */}
              {passwordStrength && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-400">{t.passwordStrength}</span>
                    <span className={`text-xs font-semibold ${
                      passwordStrength === 'weak' ? 'text-red-400' :
                      passwordStrength === 'medium' ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {passwordStrength === 'weak' && t.weak}
                      {passwordStrength === 'medium' && t.medium}
                      {passwordStrength === 'strong' && t.strong}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
                    <div className={`h-full w-full rounded-full transition-all duration-500 ${
                      passwordStrength === 'weak'
                        ? 'bg-red-500 shadow-lg shadow-red-500/50'
                        : passwordStrength === 'medium'
                          ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50'
                          : 'bg-green-500 shadow-lg shadow-green-500/50'
                    }`} />
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-400 mt-2">{t.passwordRequirements}</p>
              <PasswordRequirementsChecklist criteria={passwordCriteria} t={t} />
            </div>

            {/* Confirm password field */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-300 mb-2">
                {t.confirmPassword}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 group-focus-within:text-[#c7b9df] transition-colors duration-300">
                  <Lock size={20} />
                </div>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="w-full pl-11 pr-12 py-3 bg-zinc-900/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500
                             focus:outline-none focus:ring-2 focus:ring-[#827691]/50 focus:border-[#827691]
                             transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-900"
                  placeholder={t.confirmPasswordPlaceholder}
                  required
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-white transition-colors duration-300"
                  disabled={isSubmitting}
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

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-gradient-to-r from-[#2e1a47] to-[#827691] hover:from-[#3b2658] hover:to-[#978bab]
                         disabled:from-zinc-700 disabled:to-zinc-600 disabled:cursor-not-allowed
                         text-white font-semibold rounded-lg
                         transition-all duration-300
                         transform hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-[#2e1a47]/35
                         flex items-center justify-center mt-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t.registering}
                </>
              ) : (
                t.register
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-[#d5d1da] hover:text-white text-sm font-medium transition-colors"
            >
              {t.alreadyHaveAccount}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default RegisterPage;
