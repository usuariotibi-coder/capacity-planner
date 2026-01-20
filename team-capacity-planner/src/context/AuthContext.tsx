import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi, isAuthenticated, getAccessToken } from '../services/api';

// Decode JWT without verification (safe for client-side)
const decodeToken = (token: string): any => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const decoded = JSON.parse(atob(parts[1]));
    return decoded;
  } catch (error) {
    console.error('[AuthContext] Error decoding token:', error);
    return null;
  }
};

interface AuthContextType {
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
  currentUser: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  // Extract user name from token
  const extractUsername = () => {
    const token = getAccessToken();
    if (!token) {
      setCurrentUser(null);
      return;
    }

    const decoded = decodeToken(token);
    if (decoded) {
      // Use first_name and last_name from token if available
      if (decoded.first_name || decoded.last_name) {
        const firstName = decoded.first_name || '';
        const lastName = decoded.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim();
        if (fullName) {
          setCurrentUser(fullName);
          return;
        }
      }
      // Fallback to username if name fields are empty
      if (decoded.username) {
        const formatted = decoded.username
          .split('.')
          .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join(' ');
        setCurrentUser(formatted);
      }
    }
  };

  // Check authentication on mount and when storage changes
  useEffect(() => {
    console.log('[AuthContext] Checking authentication status...');
    const authenticated = isAuthenticated();
    console.log('[AuthContext] isAuthenticated:', authenticated);
    setIsLoggedIn(authenticated);
    if (authenticated) {
      extractUsername();
    } else {
      setCurrentUser(null);
    }
    setIsLoading(false);
  }, []);

  // Listen for storage changes (e.g., token set from login)
  useEffect(() => {
    const handleStorageChange = () => {
      console.log('[AuthContext] Storage changed, rechecking auth...');
      const authenticated = isAuthenticated();
      console.log('[AuthContext] Updated isAuthenticated:', authenticated);
      setIsLoggedIn(authenticated);
      if (authenticated) {
        extractUsername();
      } else {
        setCurrentUser(null);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const login = async (username: string, password: string) => {
    console.log('[AuthContext] login() called');
    setIsLoading(true);
    setError(null);
    try {
      console.log('[AuthContext] Calling authApi.login...');
      await authApi.login(username, password);
      console.log('[AuthContext] authApi.login completed, updating isLoggedIn...');
      // Force check authentication after token is stored
      const authenticated = isAuthenticated();
      console.log('[AuthContext] isAuthenticated after login:', authenticated);
      setIsLoggedIn(authenticated);
      if (authenticated) {
        extractUsername();
      }
      console.log('[AuthContext] isLoggedIn state updated to:', authenticated);
    } catch (err) {
      console.error('[AuthContext] Login failed:', err);
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    // Call backend to deactivate session (async but don't block UI)
    authApi.logout().catch((error) => {
      console.error('[AuthContext] Logout backend call failed:', error);
    });

    // Immediately update local state
    setIsLoggedIn(false);
    setCurrentUser(null);

    // Clear any cached data
    localStorage.removeItem('employees');
    localStorage.removeItem('projects');
    localStorage.removeItem('assignments');
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, isLoading, login, logout, error, currentUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
