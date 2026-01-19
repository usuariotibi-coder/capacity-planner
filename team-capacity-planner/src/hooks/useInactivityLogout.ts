import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

export const useInactivityLogout = () => {
  const { logout, isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoggedIn) return;

    let inactivityTimer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      // Clear existing timer
      clearTimeout(inactivityTimer);

      // Set new timer for inactivity logout
      inactivityTimer = setTimeout(() => {
        console.log('[useInactivityLogout] User inactive for 1 hour, logging out...');
        logout();
      }, INACTIVITY_TIMEOUT);
    };

    // List of events that indicate user activity
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

    // Add event listeners
    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    // Initialize timer on mount
    resetTimer();

    // Cleanup
    return () => {
      clearTimeout(inactivityTimer);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [isLoggedIn, logout]);
};
