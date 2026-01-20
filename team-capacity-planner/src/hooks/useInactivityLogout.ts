import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // Check session status every 5 minutes
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const useInactivityLogout = () => {
  const { logout, isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoggedIn) return;

    let inactivityTimer: ReturnType<typeof setTimeout>;
    let sessionCheckTimer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      // Clear existing timer
      clearTimeout(inactivityTimer);

      // Set new timer for inactivity logout
      inactivityTimer = setTimeout(() => {
        console.log('[useInactivityLogout] User inactive for 30 minutes, logging out...');
        logout();
      }, INACTIVITY_TIMEOUT);
    };

    // Check session status with backend
    const checkSessionStatus = async () => {
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          logout();
          return;
        }

        const response = await fetch(`${API_URL}/session-status/`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          console.log('[useInactivityLogout] Session inactive on backend, logging out...');
          logout();
        }
      } catch (error) {
        console.error('[useInactivityLogout] Error checking session status:', error);
      }
    };

    // Start periodic session status checks
    sessionCheckTimer = setInterval(checkSessionStatus, SESSION_CHECK_INTERVAL);

    // List of events that indicate user activity
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

    // Add event listeners
    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    // Handle page visibility change (useful for mobile when app comes back from background)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[useInactivityLogout] App back in focus, checking session...');
        checkSessionStatus();
        resetTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initialize timer on mount
    resetTimer();

    // Cleanup
    return () => {
      clearTimeout(inactivityTimer);
      clearInterval(sessionCheckTimer);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLoggedIn, logout]);
};
