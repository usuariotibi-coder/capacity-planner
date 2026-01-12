import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from '../utils/translations';
import { authApi } from '../services/api';

const EmailVerificationPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = useTranslation(language);

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('');
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (token) {
      verifyEmail(token);
    }
  }, [token]);

  useEffect(() => {
    if (status === 'success' && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (status === 'success' && countdown === 0) {
      navigate('/login');
    }
  }, [status, countdown, navigate]);

  const verifyEmail = async (verificationToken: string) => {
    try {
      const response = await authApi.verifyEmail(verificationToken);
      setStatus('success');
      setMessage(response.message || t.emailVerifiedSuccess);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : t.emailVerificationError);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md">
        {status === 'verifying' && (
          <div className="text-center">
            <div className="mb-6">
              <svg className="animate-spin mx-auto h-16 w-16 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">{t.verifyingEmail}</h2>
            <p className="text-gray-300">{t.pleaseWait}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="mb-6">
              <svg className="mx-auto h-16 w-16 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">{t.emailVerified}</h2>
            <p className="text-gray-300 mb-6">{message}</p>
            <p className="text-sm text-gray-400 mb-6">
              {t.redirectingIn} {countdown} {t.seconds}...
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              {t.loginNow}
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="mb-6">
              <svg className="mx-auto h-16 w-16 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">{t.verificationFailed}</h2>
            <p className="text-red-400 mb-6">{message}</p>
            <div className="space-y-3">
              <button
                onClick={() => navigate('/login')}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                {t.backToLogin}
              </button>
              <button
                onClick={() => navigate('/register')}
                className="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
              >
                {t.registerAgain}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailVerificationPage;
