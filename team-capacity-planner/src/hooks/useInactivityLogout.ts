import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiUrl';

const INACTIVITY_TIMEOUT = 90 * 60 * 1000; // 90 minutes in milliseconds
const SESSION_CHECK_INTERVAL = 60 * 1000; // Check session status every 1 minute
const BASE_URL = API_BASE_URL;
const API_URL = `${BASE_URL}/api`;

export const useInactivityLogout = () => {
  const { logout, isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoggedIn) return;

    let inactivityTimer: ReturnType<typeof setTimeout>;
    let sessionCheckTimer: ReturnType<typeof setInterval>;
    let sessionStatusEndpointAvailable = true;
    const resetTimer = () => {
      // Clear existing timer
      clearTimeout(inactivityTimer);

      // Set new timer for inactivity logout
      inactivityTimer = setTimeout(() => {
        console.log('[useInactivityLogout] User inactive for 90 minutes, logging out...');
        logout();
      }, INACTIVITY_TIMEOUT);
    };

    // Check session status with backend
    const checkSessionStatus = async () => {
      if (!sessionStatusEndpointAvailable) {
        return;
      }

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
          cache: 'no-store',
        });

        // Some deployments don't expose this endpoint. Don't treat that as an inactive session.
        if (response.status === 404) {
          sessionStatusEndpointAvailable = false;
          clearInterval(sessionCheckTimer);
          console.warn('[useInactivityLogout] /session-status/ returned 404. Disabling backend session checks and keeping local inactivity timer.');
          return;
        }

        // Avoid false-positive logouts from transient 401/403 responses.
        // Only log out when backend explicitly confirms inactivity.
        if (response.status === 401 || response.status === 403) {
          let backendConfirmedInactive = false;
          try {
            const errorData = await response.clone().json();
            const statusValue = String(errorData?.status || '').toLowerCase();
            const detailValue = String(errorData?.detail || '').toLowerCase();
            backendConfirmedInactive =
              statusValue === 'inactive' ||
              detailValue.includes('sesion inactiva') ||
              detailValue.includes('session inactive');
          } catch {
            backendConfirmedInactive = false;
          }

          if (backendConfirmedInactive) {
            console.log('[useInactivityLogout] Session inactive on backend (confirmed), logging out...');
            logout();
            return;
          }

          console.warn(
            '[useInactivityLogout] Session status returned auth failure without explicit inactivity confirmation. Ignoring check.'
          );
          return;
        }

        if (response.ok) return;
        if (!response.ok) {
          console.warn('[useInactivityLogout] Session status check failed with status:', response.status);
        }
      } catch (error) {
        // Transient network issues should not log out users.
        console.warn('[useInactivityLogout] Error checking session status (ignored):', error);
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
