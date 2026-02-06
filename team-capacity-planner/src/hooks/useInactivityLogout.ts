import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiUrl';

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // Check session status every 5 minutes
const BASE_URL = API_BASE_URL;
const API_URL = `${BASE_URL}/api`;

export const useInactivityLogout = () => {
  const { logout, isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoggedIn) return;

    let inactivityTimer: ReturnType<typeof setTimeout>;
    let sessionCheckTimer: ReturnType<typeof setTimeout>;
    let sessionStatusEndpointAvailable = true;

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
        });

        // Only force logout for explicit auth failures.
        if (response.status === 401 || response.status === 403) {
          console.log('[useInactivityLogout] Session inactive on backend, logging out...');
          logout();
          return;
        }

        // Some deployments don't expose this endpoint. Don't treat that as an inactive session.
        if (response.status === 404) {
          sessionStatusEndpointAvailable = false;
          clearInterval(sessionCheckTimer);
          console.warn('[useInactivityLogout] /session-status/ returned 404. Disabling backend session checks and keeping local inactivity timer.');
          return;
        }

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

    // Handle tab/window close - logout when user closes the tab/browser
    const handleBeforeUnload = () => {
      console.log('[useInactivityLogout] Tab/window closing, logging out...');
      // Use sendBeacon to ensure logout request completes even if tab is closing
      const refreshToken = localStorage.getItem('refresh_token');
      const accessToken = localStorage.getItem('access_token');

      if (refreshToken && accessToken) {
        try {
          // Use navigator.sendBeacon for reliable delivery when page unloads
          navigator.sendBeacon(`${API_URL}/logout/`, JSON.stringify({
            refresh: refreshToken,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
          }));
        } catch (error) {
          console.error('[useInactivityLogout] Error sending logout beacon:', error);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

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
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isLoggedIn, logout]);
};
