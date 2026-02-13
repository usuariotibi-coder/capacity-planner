import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ResourcesPage } from './pages/ResourcesPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CapacityMatrixPage } from './pages/CapacityMatrixPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { RegisteredUsersPage } from './pages/RegisteredUsersPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Users, Briefcase, Grid3x3, PanelLeftOpen, PanelLeftClose, LogOut, FileText, Lock, User, Moon, Sun } from 'lucide-react';
import type { Department } from './types';
import { useLanguage } from './context/LanguageContext';
import { useTranslation } from './utils/translations';
import { useAuth } from './context/AuthContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useInactivityLogout } from './hooks/useInactivityLogout';

type Page = 'resources' | 'projects' | 'capacity' | 'activity-log' | 'registered-users';
type DepartmentFilter = 'General' | Department;

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG'];

function MainApp() {
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    // Load current page from localStorage if available
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('currentPage');
      return (saved as Page) || 'capacity';
    }
    return 'capacity';
  });

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Check if window exists (SSR safety)
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768; // Desktop (md) or larger
    }
    return true;
  });

  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>(() => {
    // Load department filter from localStorage if available
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('departmentFilter');
      return (saved as DepartmentFilter) || 'General';
    }
    return 'General';
  });
  const [theme, setTheme] = useState<'day' | 'night'>(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('uiTheme');
      return savedTheme === 'night' ? 'night' : 'day';
    }
    return 'day';
  });
  const { language, setLanguage } = useLanguage();
  const t = useTranslation(language);
  const {
    isLoggedIn,
    isLoading,
    logout,
    currentUser,
    currentUserDepartment,
    currentUserOtherDepartment,
  } = useAuth();

  const canManageRegisteredUsers =
    currentUserDepartment === 'OTHER' &&
    currentUserOtherDepartment === 'BUSINESS_INTELLIGENCE';

  console.log('[MainApp] Render: isLoggedIn=', isLoggedIn, 'isLoading=', isLoading);

  // Load data from API when authenticated
  useDataLoader();

  // Handle inactivity logout (20 minutes)
  useInactivityLogout();

  useEffect(() => {
    // Save current page to localStorage
    localStorage.setItem('currentPage', currentPage);
  }, [currentPage]);

  useEffect(() => {
    if (!canManageRegisteredUsers && currentPage === 'registered-users') {
      setCurrentPage('capacity');
    }
  }, [canManageRegisteredUsers, currentPage]);

  useEffect(() => {
    // Save department filter to localStorage
    localStorage.setItem('departmentFilter', departmentFilter);
  }, [departmentFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('uiTheme', theme);
  }, [theme]);

  useEffect(() => {
    // Handle resize event
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      if (isMobile && sidebarOpen) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarOpen]);

  if (isLoading) {
    console.log('[MainApp] Still loading...');
    return (
      <div className="brand-auth-bg min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#d5d1da]"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    console.log('[MainApp] Not logged in, redirecting to /login');
    return <Navigate to="/login" replace />;
  }

  console.log('[MainApp] Authenticated! Rendering main content');

  const navItems: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
    { id: 'capacity', label: t.capacityMatrix, icon: <Grid3x3 size={14} /> },
    { id: 'resources', label: t.resources, icon: <Users size={14} /> },
    { id: 'projects', label: t.projects, icon: <Briefcase size={14} /> },
    { id: 'activity-log', label: t.activityLog || 'Activity Log', icon: <FileText size={14} /> },
  ];
  if (canManageRegisteredUsers) {
    navItems.push({
      id: 'registered-users',
      label: t.registeredUsers || 'Registered Users',
      icon: <User size={14} />,
    });
  }

  const departmentDisplayLabel = (() => {
    if (!currentUserDepartment) return '';
    if (currentUserDepartment !== 'OTHER') return currentUserDepartment;
    if (!currentUserOtherDepartment) return t.departmentOther || 'Other';
    if (currentUserOtherDepartment === 'OPERATIONS') return t.departmentOperations || 'Operations';
    if (currentUserOtherDepartment === 'FINANCE') return t.departmentFinance || 'Finance';
    if (currentUserOtherDepartment === 'HUMAN_RESOURCES') return t.departmentHumanResources || 'Human Resources';
    if (currentUserOtherDepartment === 'BUSINESS_INTELLIGENCE') return t.departmentBusinessIntelligence || 'Business Intelligence';
    return currentUserOtherDepartment;
  })();

  const userRoleLabel =
    departmentDisplayLabel || (language === 'es' ? 'Administrador' : 'Administrator');

  const mobileDepartmentCode = (() => {
    if (!currentUserDepartment) return '';
    if (currentUserDepartment !== 'OTHER') return currentUserDepartment;
    if (currentUserOtherDepartment === 'BUSINESS_INTELLIGENCE') return 'BI';
    if (currentUserOtherDepartment === 'HUMAN_RESOURCES') return 'HR';
    if (currentUserOtherDepartment === 'OPERATIONS') return 'OPS';
    if (currentUserOtherDepartment === 'FINANCE') return 'FIN';
    return 'OTH';
  })();

  const renderPage = () => {
    switch (currentPage) {
      case 'resources':
        return <ResourcesPage />;
      case 'projects':
        return <ProjectsPage />;
      case 'activity-log':
        return <ActivityLogPage />;
      case 'registered-users':
        return <RegisteredUsersPage />;
      case 'capacity':
        return <CapacityMatrixPage departmentFilter={departmentFilter} />;
      default:
        return <CapacityMatrixPage departmentFilter={departmentFilter} />;
    }
  };

  return (
    <div className="brand-app-shell flex h-[100dvh] overflow-hidden">
      {/* Sidebar - inline flex, not overlay */}
      <div
        className={`${
          sidebarOpen ? 'w-12 md:w-40' : 'w-0'
        } brand-sidebar -mt-px h-[calc(100%+1px)] text-white transition-all duration-300 overflow-hidden flex flex-col shadow-sm border-r border-white/15 flex-shrink-0 min-h-0`}
      >
        <div className="p-1.5 md:p-3 border-b border-white/15 flex-shrink-0">
          <div className="flex items-center justify-center md:justify-start gap-2">
            <div className="w-7 h-7 rounded-md bg-white/12 border border-white/30 flex items-center justify-center">
              <Grid3x3 size={14} className="text-white" />
            </div>
            <div className="hidden md:block min-w-0">
              <h1 className="text-[13px] font-semibold leading-tight tracking-tight truncate text-white">{t.teamCapacity}</h1>
              <p className="text-[9px] text-[#d5d1da] mt-0.5 truncate">{t.plannerSubtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">

        <nav className="px-1.5 md:px-2.5 pt-0.5 md:pt-1 pb-1.5 md:pb-2.5 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentPage(item.id);
              }}
              className={`w-full flex flex-col md:flex-row items-center justify-center md:justify-start gap-0 md:gap-1.5 px-1 md:px-2.5 py-1.5 md:py-1.5 rounded-md border transition text-[8px] md:text-[11px] ${
                currentPage === item.id
                  ? 'bg-gradient-to-r from-[#827691] to-[#2E1A47] text-white border-[#9c92ab] shadow-[0_8px_16px_rgba(46,26,71,0.35)]'
                  : 'text-[#d8d2e5] border-transparent hover:bg-white/10 hover:border-white/20'
              }`}
              title={item.label}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="font-medium text-center md:text-left leading-none">{item.label}</span>
            </button>
          ))}
        </nav>

        {currentPage === 'capacity' && (
          <div className="p-1.5 md:p-3 border-t border-white/15 space-y-1.5">
            <button
              onClick={() => {
                setDepartmentFilter('General');
              }}
              className={`w-full px-1.5 md:px-2.5 py-1 md:py-1.5 rounded-md text-[8px] md:text-[11px] font-semibold transition leading-tight ${
                departmentFilter === 'General'
                  ? 'bg-gradient-to-r from-[#827691] to-[#2E1A47] text-white border border-[#9c92ab]'
                  : 'bg-white/10 text-[#d8d2e5] hover:bg-white/15 border border-white/20'
              }`}
              title={t.general}
            >
              <span className="md:hidden">{t.general}</span>
              <span className="hidden md:inline">{t.general}</span>
            </button>

            <label className="hidden md:block text-[9px] font-semibold text-[#d5d1da] tracking-wide">{t.viewDepartment}</label>
            <select
              value={departmentFilter === 'General' ? '' : departmentFilter}
              onChange={(e) => {
                setDepartmentFilter((e.target.value as DepartmentFilter) || 'General');
              }}
              className="w-full bg-white/10 text-white text-[9px] md:text-[11px] rounded-md px-2 py-1 border border-white/20 hover:border-[#d5d1da] transition leading-tight"
            >
              <option value="" className="text-[#2e1a47] bg-white">{t.selectDepartment}</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept} className="text-[#2e1a47] bg-white">
                  {dept}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="p-1.5 md:p-3 border-t border-white/15 space-y-1">
          <button
            onClick={() => window.location.href = '/change-password'}
            className="w-full flex items-center justify-center md:justify-start gap-1.5 px-1.5 md:px-2.5 py-1.5 md:py-1.5 text-[9px] md:text-[11px] text-[#d8d2e5] hover:bg-white/12 rounded-md transition border border-transparent hover:border-white/20"
            title={t.changePassword}
          >
            <Lock size={12} className="md:w-3 md:h-3" />
            <span className="hidden md:inline">{t.changePassword}</span>
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center md:justify-start gap-1.5 px-1.5 md:px-2.5 py-1.5 md:py-1.5 text-[9px] md:text-[11px] text-[#d8d2e5] hover:bg-white/12 rounded-md transition border border-transparent hover:border-white/20"
            title={t.logout}
          >
            <LogOut size={12} className="md:w-3 md:h-3" />
            <span className="hidden md:inline">{t.logout}</span>
          </button>
          <p className="hidden md:block text-[9px] text-[#d5d1da] text-center">{t.teamCapacityPlanner}</p>
        </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${sidebarOpen ? '-ml-px' : ''}`}>
        <div className="brand-header px-2.5 md:px-3 py-1 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-[#d5d1da] hover:border-[#827691] hover:bg-[#f3eff8] rounded-md transition flex-shrink-0 text-[#2e1a47]"
              title={sidebarOpen ? t.hideSidebar : t.showSidebar}
            >
              {sidebarOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
              <span className="hidden md:inline text-[10px] font-medium text-[#6c6480]">
                {sidebarOpen ? t.hideSidebar : t.showSidebar}
              </span>
            </button>
            <h2 className="text-[12px] font-semibold tracking-tight text-[#2e1a47] truncate leading-none">
              {navItems.find((item) => item.id === currentPage)?.label}
            </h2>
          </div>

          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            {/* User Info Widget - Responsive */}
            {currentUser && (
              <div
                className="user-profile-pill hidden sm:flex items-center justify-between gap-2 pl-3 pr-2 py-1.5"
                title={userRoleLabel ? `${currentUser} - ${userRoleLabel}` : currentUser}
              >
                <div className="user-profile-info min-w-0">
                  <p className="user-profile-name truncate text-[11px] font-semibold leading-none">
                    {currentUser}
                  </p>
                  <p className="user-profile-role mt-0.5 truncate text-[10px] leading-none">
                    {userRoleLabel}
                  </p>
                </div>
                <div className="user-profile-avatar h-9 w-9 shrink-0 rounded-full flex items-center justify-center">
                  <span className="user-profile-avatar-text text-[12px] font-bold">
                    {currentUser.charAt(0).toUpperCase()}
                    {currentUser.split(' ').length > 1 ? currentUser.split(' ')[1].charAt(0).toUpperCase() : ''}
                  </span>
                </div>
              </div>
            )}

            {/* Mobile User Widget */}
            {currentUser && (
              <div className="user-session-mobile sm:hidden flex items-center gap-1 flex-shrink-0">
                <div
                  className="user-session-mobile-avatar w-7 h-7 rounded-full flex items-center justify-center"
                  title={departmentDisplayLabel ? `${currentUser} - ${departmentDisplayLabel}` : currentUser}
                >
                  <span className="user-session-mobile-initial text-[10px] font-bold">
                    {currentUser.charAt(0).toUpperCase()}
                  </span>
                </div>
                {mobileDepartmentCode && (
                  <span className="user-session-mobile-dept rounded border px-1 py-0.5 text-[9px] font-bold">
                    {mobileDepartmentCode}
                  </span>
                )}
              </div>
            )}

            {/* Theme Selector */}
            <div className="theme-toggle flex items-center gap-0.5 p-0.5 rounded-md flex-shrink-0 border">
              <button
                onClick={() => setTheme('day')}
                className={`theme-toggle-btn px-1.5 py-0.5 rounded text-[10px] font-semibold transition inline-flex items-center gap-1 ${
                  theme === 'day' ? 'is-active' : ''
                }`}
                title={t.dayMode}
                aria-label={t.dayMode}
              >
                <Sun size={11} />
                <span className="hidden md:inline">{t.dayMode}</span>
              </button>
              <button
                onClick={() => setTheme('night')}
                className={`theme-toggle-btn px-1.5 py-0.5 rounded text-[10px] font-semibold transition inline-flex items-center gap-1 ${
                  theme === 'night' ? 'is-active' : ''
                }`}
                title={t.nightMode}
                aria-label={t.nightMode}
              >
                <Moon size={11} />
                <span className="hidden md:inline">{t.nightMode}</span>
              </button>
            </div>

            {/* Language Selector - Responsive */}
            <div className="lang-toggle flex items-center gap-0.5 p-0.5 rounded-md flex-shrink-0 border">
              <button
                onClick={() => setLanguage('es')}
                className={`lang-toggle-btn px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${
                  language === 'es'
                    ? 'is-active'
                    : ''
                }`}
                title="Espanol"
              >
                ES
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`lang-toggle-btn px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${
                  language === 'en'
                    ? 'is-active'
                    : ''
                }`}
                title="English"
              >
                EN
              </button>
            </div>

            {currentPage === 'capacity' && departmentFilter !== 'General' && (
              <div className="text-[10px] font-semibold text-[#2e1a47] bg-gradient-to-r from-[#ede8f5] to-[#f6f3fb] border border-[#d5d1da] px-1.5 py-0.5 rounded-md flex items-center gap-1 flex-shrink-0">
                <span className="w-1 h-1 rounded-full bg-[#ce0037]"></span>
                {t.viewing} {departmentFilter}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden min-h-0">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedTheme = localStorage.getItem('uiTheme');
    document.documentElement.setAttribute('data-theme', savedTheme === 'night' ? 'night' : 'day');
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email/:token" element={<EmailVerificationPage />} />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute>
              <ChangePasswordPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <MainApp />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
