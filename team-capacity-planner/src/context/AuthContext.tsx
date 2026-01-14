import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi, isAuthenticated } from '../services/api';

interface AuthContextType {
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check authentication on mount and when storage changes
  useEffect(() => {
    console.log('[AuthContext] Checking authentication status...');
    const authenticated = isAuthenticated();
    console.log('[AuthContext] isAuthenticated:', authenticated);
    setIsLoggedIn(authenticated);
    setIsLoading(false);
  }, []);

  // Listen for storage changes (e.g., token set from login)
  useEffect(() => {
    const handleStorageChange = () => {
      console.log('[AuthContext] Storage changed, rechecking auth...');
      const authenticated = isAuthenticated();
      console.log('[AuthContext] Updated isAuthenticated:', authenticated);
      setIsLoggedIn(authenticated);
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
      console.log('[AuthContext] isLoggedIn state updated to:', authenticated);
    } catch (err) {
      console.error('[AuthContext] Login failed:', err);
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    authApi.logout();
    setIsLoggedIn(false);
    // Clear any cached data
    localStorage.removeItem('employees');
    localStorage.removeItem('projects');
    localStorage.removeItem('assignments');
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, isLoading, login, logout, error }}>
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
