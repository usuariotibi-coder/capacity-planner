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
import { Users, Briefcase, Grid3x3, PanelLeftOpen, PanelLeftClose, LogOut, FileText, Lock, User, Building2 } from 'lucide-react';
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
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
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
    { id: 'capacity', label: t.capacityMatrix, icon: <Grid3x3 size={16} /> },
    { id: 'resources', label: t.resources, icon: <Users size={16} /> },
    { id: 'projects', label: t.projects, icon: <Briefcase size={16} /> },
    { id: 'activity-log', label: t.activityLog || 'Activity Log', icon: <FileText size={16} /> },
  ];
  if (canManageRegisteredUsers) {
    navItems.push({
      id: 'registered-users',
      label: t.registeredUsers || 'Registered Users',
      icon: <User size={16} />,
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

  const departmentChipTone = (() => {
    switch (currentUserDepartment) {
      case 'PM':
        return 'bg-blue-500/25 text-blue-50 border-blue-200/40';
      case 'MED':
        return 'bg-cyan-500/25 text-cyan-50 border-cyan-200/40';
      case 'HD':
        return 'bg-purple-500/25 text-purple-50 border-purple-200/40';
      case 'MFG':
        return 'bg-orange-500/25 text-orange-50 border-orange-200/40';
      case 'BUILD':
        return 'bg-emerald-500/25 text-emerald-50 border-emerald-200/40';
      case 'PRG':
        return 'bg-lime-500/25 text-lime-50 border-lime-200/40';
      case 'OTHER':
        return 'bg-teal-500/25 text-teal-50 border-teal-200/40';
      default:
        return 'bg-white/20 text-white border-white/30';
    }
  })();

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
    <div className="flex h-screen bg-gray-50 text-slate-800">
      {/* Sidebar - inline flex, not overlay */}
      <div
        className={`${
          sidebarOpen ? 'w-14 md:w-44' : 'w-0'
        } h-full bg-slate-900 text-white transition-all duration-300 overflow-hidden flex flex-col shadow-md flex-shrink-0 min-h-0`}
      >
        <div className="p-1.5 md:p-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center justify-center md:justify-start gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/40 flex items-center justify-center">
              <Grid3x3 size={16} className="text-blue-200" />
            </div>
            <div className="hidden md:block min-w-0">
              <h1 className="text-sm font-semibold leading-tight tracking-tight truncate">{t.teamCapacity}</h1>
              <p className="text-[10px] text-slate-400 mt-0.5 truncate">{t.plannerSubtitle}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">

        <nav className="p-1.5 md:p-3 space-y-1.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentPage(item.id);
              }}
              className={`w-full flex flex-col md:flex-row items-center justify-center md:justify-start gap-0 md:gap-2 px-1 md:px-3 py-1.5 md:py-2 rounded-md transition text-[8px] md:text-xs ${
                currentPage === item.id
                  ? 'bg-blue-500/95 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title={item.label}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="font-medium text-center md:text-left leading-none">{item.label}</span>
            </button>
          ))}
        </nav>

        {currentPage === 'capacity' && (
          <div className="p-1.5 md:p-3 border-t border-slate-800 space-y-1.5">
            <button
              onClick={() => {
                setDepartmentFilter('General');
              }}
              className={`w-full px-1.5 md:px-3 py-1 md:py-2 rounded-md text-[8px] md:text-xs font-semibold transition leading-tight ${
                departmentFilter === 'General'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              title={t.general}
            >
              <span className="md:hidden">{t.general}</span>
              <span className="hidden md:inline">{t.general}</span>
            </button>

            <label className="hidden md:block text-[10px] font-semibold text-slate-400 tracking-wide">{t.viewDepartment}</label>
            <select
              value={departmentFilter === 'General' ? '' : departmentFilter}
              onChange={(e) => {
                setDepartmentFilter((e.target.value as DepartmentFilter) || 'General');
              }}
              className="w-full bg-slate-800 text-white text-[9px] md:text-xs rounded-md px-2 py-1.5 border border-slate-700 hover:border-blue-500 transition leading-tight"
            >
              <option value="">{t.selectDepartment}</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="p-1.5 md:p-3 border-t border-slate-800 space-y-1">
          <button
            onClick={() => window.location.href = '/change-password'}
            className="w-full flex items-center justify-center md:justify-start gap-1.5 px-1.5 md:px-3 py-1.5 md:py-2 text-[9px] md:text-xs text-slate-300 hover:bg-slate-800 rounded-md transition"
            title={t.changePassword}
          >
            <Lock size={13} className="md:w-3.5 md:h-3.5" />
            <span className="hidden md:inline">{t.changePassword}</span>
          </button>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center md:justify-start gap-1.5 px-1.5 md:px-3 py-1.5 md:py-2 text-[9px] md:text-xs text-slate-300 hover:bg-slate-800 rounded-md transition"
            title={t.logout}
          >
            <LogOut size={13} className="md:w-3.5 md:h-3.5" />
            <span className="hidden md:inline">{t.logout}</span>
          </button>
          <p className="hidden md:block text-[10px] text-slate-400 text-center">{t.teamCapacityPlanner}</p>
        </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="inline-flex items-center gap-1.5 px-2 py-1 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-md transition flex-shrink-0"
              title={sidebarOpen ? t.hideSidebar : t.showSidebar}
            >
              {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
              <span className="hidden md:inline text-xs font-medium text-slate-600">
                {sidebarOpen ? t.hideSidebar : t.showSidebar}
              </span>
            </button>
            <h2 className="text-sm font-semibold tracking-tight text-slate-800 truncate leading-none">
              {navItems.find((item) => item.id === currentPage)?.label}
            </h2>
          </div>

          <div className="flex items-center gap-1 md:gap-3 flex-shrink-0">
            {/* User Info Widget - Responsive */}
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 md:gap-3 px-2 md:px-4 py-1.5 md:py-2.5 bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 rounded-xl border border-blue-300 shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all">
                <div className="relative w-8 md:w-10 h-8 md:h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs md:text-sm font-bold text-white">
                    {currentUser.charAt(0).toUpperCase()}
                  </span>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-blue-600"></span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs md:text-sm font-bold text-white truncate">
                    {currentUser}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                    <span className="text-[10px] md:text-xs text-blue-100 font-medium whitespace-nowrap">
                      {t.loggedIn || 'Logged in'}
                    </span>
                    {departmentDisplayLabel && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${departmentChipTone}`}>
                        <Building2 size={10} />
                        <span className="truncate max-w-[140px]">{departmentDisplayLabel}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Mobile User Widget */}
            {currentUser && (
              <div className="sm:hidden flex items-center gap-1 flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 flex items-center justify-center border border-blue-400 shadow-lg shadow-blue-500/30"
                  title={departmentDisplayLabel ? `${currentUser} - ${departmentDisplayLabel}` : currentUser}
                >
                  <span className="text-xs font-bold text-white">
                    {currentUser.charAt(0).toUpperCase()}
                  </span>
                </div>
                {mobileDepartmentCode && (
                  <span className="px-1.5 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-bold">
                    {mobileDepartmentCode}
                  </span>
                )}
              </div>
            )}

            {/* Language Selector - Responsive */}
            <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-md flex-shrink-0">
              <button
                onClick={() => setLanguage('es')}
                className={`px-1.5 md:px-2 py-0.5 rounded text-sm md:text-base transition ${
                  language === 'es'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
                title="Español"
              >
                🇲🇽
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-1.5 md:px-2 py-0.5 rounded text-sm md:text-base transition ${
                  language === 'en'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
                title="English"
              >
                🇺🇸
              </button>
            </div>

            {currentPage === 'capacity' && departmentFilter !== 'General' && (
              <div className="text-xs font-semibold text-blue-700 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 px-2 py-1 rounded-md flex items-center gap-1 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                {t.viewing} {departmentFilter}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}

function App() {
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
