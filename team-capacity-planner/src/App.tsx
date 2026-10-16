import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ProjectsPage } from './pages/ProjectsPage';
import { CapacityMatrixPage } from './pages/CapacityMatrixPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { GuidePage } from './pages/GuidePage';
import { RegisteredUsersPage } from './pages/RegisteredUsersPage';
import { FinanceImportPage } from './pages/FinanceImportPage';
import { DepartmentCostsPage } from './pages/DepartmentCostsPage';
import LoginPage from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Briefcase, Grid3x3, ChevronLeft, ChevronRight, LogOut, FileText, Lock, User, Moon, Sun, BookOpen, FileSpreadsheet, DollarSign, Layers, Building2 } from 'lucide-react';
import type { Department } from './types';
import { useLanguage } from './context/LanguageContext';
import { useTranslation } from './utils/translations';
import { useAuth } from './context/AuthContext';
import { useDataLoader } from './hooks/useDataLoader';
import { useInactivityLogout } from './hooks/useInactivityLogout';

type Page = 'projects' | 'guide' | 'capacity' | 'activity-log' | 'registered-users' | 'finance-import' | 'department-costs';
type DepartmentFilter = 'General' | Department;

const DEPARTMENTS: Department[] = ['PM', 'MED', 'HD', 'MFG', 'BUILD', 'PRG', 'PURCHASING'];

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

  // DOM node (rendered in the sidebar, after the department selector) that CapacityMatrixPage
  // portals its year selector / current-week badge / export buttons into, so they live in the
  // nav instead of the page's own top toolbar. State (not a plain ref) so mounting it triggers
  // a re-render and the portal target is available on the same page CapacityMatrixPage reads it.
  const [sidebarToolbarEl, setSidebarToolbarEl] = useState<HTMLDivElement | null>(null);
  const sidebarToolbarRef = useCallback((el: HTMLDivElement | null) => {
    setSidebarToolbarEl(el);
  }, []);

  // Same idea, but for the collapsed (icon rail) sidebar: just the year selector, portaled in
  // as a compact icon-select so it stays usable while collapsed (General/department stay in
  // App.tsx itself since departmentFilter lives here, not in CapacityMatrixPage).
  const [sidebarToolbarCollapsedEl, setSidebarToolbarCollapsedEl] = useState<HTMLDivElement | null>(null);
  const sidebarToolbarCollapsedRef = useCallback((el: HTMLDivElement | null) => {
    setSidebarToolbarCollapsedEl(el);
  }, []);

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
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const userMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [userMenuPosition, setUserMenuPosition] = useState<{ bottom: number; left: number } | null>(null);
  const { language, setLanguage } = useLanguage();
  const t = useTranslation(language);
  const {
    isLoggedIn,
    isLoading,
    logout,
    currentUser,
    currentUserDepartment,
    currentUserOtherDepartment,
    hasFullAccess,
    isSuperuser,
  } = useAuth();

  // Mirrors the backend's _has_bi_management_access: superusers manage
  // registered users regardless of department (most don't have a
  // UserProfile/department at all), or a BI-department user.
  const canManageRegisteredUsers =
    isSuperuser ||
    (currentUserDepartment === 'OTHER' && currentUserOtherDepartment === 'BUSINESS_INTELLIGENCE');

  console.log('[MainApp] Render: isLoggedIn=', isLoggedIn, 'isLoading=', isLoading);

  // Load data from API when authenticated
  useDataLoader();

  // Handle inactivity logout (90 minutes)
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
    if (!hasFullAccess && currentPage === 'finance-import') {
      setCurrentPage('capacity');
    }
  }, [hasFullAccess, currentPage]);

  useEffect(() => {
    if (!hasFullAccess && currentPage === 'department-costs') {
      setCurrentPage('capacity');
    }
  }, [hasFullAccess, currentPage]);

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

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const updateUserMenuPosition = () => {
      if (!userMenuTriggerRef.current) return;
      const rect = userMenuTriggerRef.current.getBoundingClientRect();
      setUserMenuPosition({
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
        left: Math.max(8, rect.left),
      });
    };

    updateUserMenuPosition();
    window.addEventListener('resize', updateUserMenuPosition);
    window.addEventListener('scroll', updateUserMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateUserMenuPosition);
      window.removeEventListener('scroll', updateUserMenuPosition, true);
    };
  }, [isUserMenuOpen]);

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
    { id: 'projects', label: t.projects, icon: <Briefcase size={14} /> },
    { id: 'guide', label: t.guide || 'Guia', icon: <BookOpen size={14} /> },
    { id: 'activity-log', label: t.activityLog || 'Activity Log', icon: <FileText size={14} /> },
  ];
  if (canManageRegisteredUsers) {
    navItems.push({
      id: 'registered-users',
      label: t.registeredUsers || 'Registered Users',
      icon: <User size={14} />,
    });
  }
  if (hasFullAccess) {
    navItems.push({
      id: 'finance-import',
      label: language === 'es' ? 'Import Finanzas' : 'Finance Import',
      icon: <FileSpreadsheet size={14} />,
    });
    navItems.push({
      id: 'department-costs',
      label: language === 'es' ? 'Costo por Hora' : 'Hourly Cost',
      icon: <DollarSign size={14} />,
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
    if (currentUserOtherDepartment === 'HEAD_ENGINEERING') return t.departmentHeadEngineering || 'Head Engineering';
    return currentUserOtherDepartment;
  })();

  const userRoleLabel =
    departmentDisplayLabel || (language === 'es' ? 'Administrador' : 'Administrator');

  const renderPage = () => {
    switch (currentPage) {
      case 'projects':
        return <ProjectsPage />;
      case 'guide':
        return <GuidePage />;
      case 'activity-log':
        return <ActivityLogPage />;
      case 'registered-users':
        return <RegisteredUsersPage />;
      case 'finance-import':
        return <FinanceImportPage />;
      case 'department-costs':
        return <DepartmentCostsPage />;
      case 'capacity':
        return <CapacityMatrixPage departmentFilter={departmentFilter} sidebarToolbarContainer={sidebarToolbarEl} sidebarToolbarCollapsedContainer={sidebarToolbarCollapsedEl} />;
      default:
        return <CapacityMatrixPage departmentFilter={departmentFilter} sidebarToolbarContainer={sidebarToolbarEl} sidebarToolbarCollapsedContainer={sidebarToolbarCollapsedEl} />;
    }
  };

  return (
    <div className="brand-app-shell flex h-[100dvh] overflow-hidden relative">
      {/* Sidebar - inline flex, not overlay. Collapsed = narrow icon-only rail (not hidden). */}
      <div
        className={`${
          sidebarOpen ? 'w-44' : 'w-14'
        } brand-sidebar -mt-px h-[calc(100%+1px)] text-white transition-all duration-300 overflow-visible flex flex-col shadow-sm border-r border-white/15 flex-shrink-0 min-h-0 relative`}
      >
        {/* Small discrete toggle, attached to the sidebar's edge */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute top-3 -right-2.5 z-[210] inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#2e1a47] hover:bg-[#3b2658] text-white border border-white/30 shadow-md transition-colors"
          title={sidebarOpen ? t.hideSidebar : t.showSidebar}
          aria-label={sidebarOpen ? t.hideSidebar : t.showSidebar}
        >
          {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>

        <div className="overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="p-1.5 md:p-3 border-b border-white/15 flex-shrink-0">
          <div className={`flex items-center gap-2 ${sidebarOpen ? 'justify-start' : 'justify-center'}`}>
            <div className="w-7 h-7 rounded-md bg-white/12 border border-white/30 flex items-center justify-center flex-shrink-0">
              <Grid3x3 size={14} className="text-white" />
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <h1 className="text-[13px] font-semibold leading-tight tracking-tight truncate text-white">{t.teamCapacity}</h1>
                <p className="text-[9px] text-[#d5d1da] mt-0.5 truncate">{t.plannerSubtitle}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">

        <nav className="px-1.5 md:px-2.5 pt-0.5 md:pt-1 pb-1.5 md:pb-2.5 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentPage(item.id);
              }}
              className={`w-full flex items-center gap-0 ${sidebarOpen ? 'justify-start gap-1.5 px-2.5' : 'justify-center px-1'} py-1.5 rounded-md border transition text-[11px] ${
                currentPage === item.id
                  ? 'bg-gradient-to-r from-[#827691] to-[#2E1A47] text-white border-[#9c92ab] shadow-[0_8px_16px_rgba(46,26,71,0.35)]'
                  : 'text-[#d8d2e5] border-transparent hover:bg-white/10 hover:border-white/20'
              }`}
              title={item.label}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {sidebarOpen && <span className="font-medium text-left leading-none truncate">{item.label}</span>}
            </button>
          ))}
        </nav>

        {currentPage === 'capacity' && sidebarOpen && (
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
              {t.general}
            </button>

            <label className="block text-[9px] font-semibold text-[#d5d1da] tracking-wide">{t.viewDepartment}</label>
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

            {/* CapacityMatrixPage portals its year selector / current-week badge / export
                buttons into this node, placed right after the department selector. */}
            <div ref={sidebarToolbarRef} />
          </div>
        )}

        {/* Collapsed rail: General / department / year stay usable as icon-sized controls
            instead of disappearing with the rest of the expanded filter block. Department and
            year are native <select>s made invisible (opacity-0) and overlaid on an icon so
            the dropdown still opens and works, just without visible text. */}
        {currentPage === 'capacity' && !sidebarOpen && (
          <div className="p-1.5 border-t border-white/15 space-y-1.5 flex flex-col items-center">
            <button
              onClick={() => setDepartmentFilter('General')}
              className={`w-9 h-9 flex items-center justify-center rounded-md border transition ${
                departmentFilter === 'General'
                  ? 'bg-gradient-to-r from-[#827691] to-[#2E1A47] border-[#9c92ab] text-white'
                  : 'bg-white/10 border-white/20 text-[#d8d2e5] hover:bg-white/15'
              }`}
              title={t.general}
              aria-label={t.general}
            >
              <Layers size={14} />
            </button>

            <div className="relative w-9 h-9">
              <select
                value={departmentFilter === 'General' ? '' : departmentFilter}
                onChange={(e) => {
                  setDepartmentFilter((e.target.value as DepartmentFilter) || 'General');
                }}
                className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                title={t.viewDepartment}
                aria-label={t.viewDepartment}
              >
                <option value="" className="text-[#2e1a47] bg-white">{t.selectDepartment}</option>
                {DEPARTMENTS.map((dept) => (
                  <option key={dept} value={dept} className="text-[#2e1a47] bg-white">{dept}</option>
                ))}
              </select>
              <div
                className={`absolute inset-0 pointer-events-none rounded-md border flex items-center justify-center transition peer-focus:ring-2 peer-focus:ring-white/40 peer-hover:bg-white/15 ${
                  departmentFilter !== 'General'
                    ? 'bg-gradient-to-r from-[#827691] to-[#2E1A47] border-[#9c92ab] text-white'
                    : 'bg-white/10 border-white/20 text-[#d8d2e5]'
                }`}
              >
                <Building2 size={14} />
              </div>
            </div>

            {/* CapacityMatrixPage portals a matching icon-select for the year here. */}
            <div ref={sidebarToolbarCollapsedRef} />
          </div>
        )}

        {/* Spacer pushes the account/settings block to the bottom of the sidebar */}
        <div className="flex-1" />

        {/* Account & settings - formerly the top bar, now integrated into the sidebar */}
        {currentUser && (
          <div className="p-1.5 md:p-3 border-t border-white/15 space-y-1.5 flex-shrink-0">
            <div ref={userMenuRef} className="relative">
              <button
                ref={userMenuTriggerRef}
                type="button"
                onClick={() => setIsUserMenuOpen((prev) => !prev)}
                className={`w-full flex items-center gap-2 rounded-md border border-white/20 bg-white/10 hover:bg-white/15 transition px-1 md:px-2 py-1.5 ${sidebarOpen ? 'justify-start' : 'justify-center'}`}
                title={userRoleLabel ? `${currentUser} - ${userRoleLabel}` : currentUser}
              >
                <div className="h-7 w-7 rounded-full bg-white/15 border border-white/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[11px] font-bold text-white">
                    {currentUser.charAt(0).toUpperCase()}
                    {currentUser.split(' ').length > 1 ? currentUser.split(' ')[1].charAt(0).toUpperCase() : ''}
                  </span>
                </div>
                {sidebarOpen && (
                  <div className="min-w-0 text-left">
                    <p className="truncate text-[11px] font-semibold leading-none text-white">
                      {currentUser}
                    </p>
                    <p className="mt-0.5 truncate text-[9px] leading-none text-[#d5d1da]">
                      {userRoleLabel}
                    </p>
                  </div>
                )}
              </button>
              {isUserMenuOpen && (
                <div
                  className="fixed z-[200] min-w-[168px] rounded-md border border-white/20 bg-[#2E1A47] p-1 shadow-lg"
                  style={
                    userMenuPosition
                      ? { bottom: `${userMenuPosition.bottom}px`, left: `${userMenuPosition.left}px` }
                      : undefined
                  }
                >
                  <button
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      window.location.href = '/change-password';
                    }}
                    className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-[#d8d2e5] hover:bg-white/12 transition"
                  >
                    <Lock size={12} />
                    <span>{t.changePassword}</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-[#d8d2e5] hover:bg-white/12 transition"
                  >
                    <LogOut size={12} />
                    <span>{t.logout}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Theme Selector */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-white/20 bg-white/10">
              <button
                onClick={() => setTheme('day')}
                className={`flex-1 flex items-center justify-center gap-1 px-1 py-1 rounded text-[9px] md:text-[10px] font-semibold transition ${
                  theme === 'day' ? 'bg-white/25 text-white' : 'text-[#d8d2e5] hover:bg-white/10'
                }`}
                title={t.dayMode}
                aria-label={t.dayMode}
              >
                <Sun size={11} />
                {sidebarOpen && <span>{t.dayMode}</span>}
              </button>
              <button
                onClick={() => setTheme('night')}
                className={`flex-1 flex items-center justify-center gap-1 px-1 py-1 rounded text-[9px] md:text-[10px] font-semibold transition ${
                  theme === 'night' ? 'bg-white/25 text-white' : 'text-[#d8d2e5] hover:bg-white/10'
                }`}
                title={t.nightMode}
                aria-label={t.nightMode}
              >
                <Moon size={11} />
                {sidebarOpen && <span>{t.nightMode}</span>}
              </button>
            </div>

            {/* Language Selector */}
            {sidebarOpen && (
              <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-white/20 bg-white/10">
                <button
                  onClick={() => setLanguage('es')}
                  className={`flex-1 px-1 py-1 rounded text-[9px] md:text-[10px] font-semibold transition ${
                    language === 'es' ? 'bg-white/25 text-white' : 'text-[#d8d2e5] hover:bg-white/10'
                  }`}
                  title="Espanol"
                >
                  ES
                </button>
                <button
                  onClick={() => setLanguage('en')}
                  className={`flex-1 px-1 py-1 rounded text-[9px] md:text-[10px] font-semibold transition ${
                    language === 'en' ? 'bg-white/25 text-white' : 'text-[#d8d2e5] hover:bg-white/10'
                  }`}
                  title="English"
                >
                  EN
                </button>
              </div>
            )}
          </div>
        )}

        </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 -ml-px">
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
