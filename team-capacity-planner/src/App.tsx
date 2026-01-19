import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ResourcesPage } from './pages/ResourcesPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CapacityMatrixPage } from './pages/CapacityMatrixPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import { Users, Briefcase, Grid3x3, Menu, X, LogOut, FileText } from 'lucide-react';
import type { Department } from './types';
import { useLanguage } from './context/LanguageContext';
import { useTranslation } from './utils/translations';
import { useAuth } from './context/AuthContext';
import { useDataLoader } from './hooks/useDataLoader';

type Page = 'resources' | 'projects' | 'capacity' | 'activity-log';
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
  const { isLoggedIn, isLoading, logout, currentUser } = useAuth();

  console.log('[MainApp] Render: isLoggedIn=', isLoggedIn, 'isLoading=', isLoading);

  // Load data from API when authenticated
  useDataLoader();

  useEffect(() => {
    // Save current page to localStorage
    localStorage.setItem('currentPage', currentPage);
  }, [currentPage]);

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
    { id: 'capacity', label: t.capacityMatrix, icon: <Grid3x3 size={20} /> },
    { id: 'resources', label: t.resources, icon: <Users size={20} /> },
    { id: 'projects', label: t.projects, icon: <Briefcase size={20} /> },
    { id: 'activity-log', label: t.activityLog || 'Activity Log', icon: <FileText size={20} /> },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'resources':
        return <ResourcesPage />;
      case 'projects':
        return <ProjectsPage />;
      case 'activity-log':
        return <ActivityLogPage />;
      case 'capacity':
        return <CapacityMatrixPage departmentFilter={departmentFilter} />;
      default:
        return <CapacityMatrixPage departmentFilter={departmentFilter} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - inline flex, not overlay */}
      <div
        className={`${
          sidebarOpen ? 'w-24 md:w-56' : 'w-0'
        } h-full bg-slate-800 text-white transition-all duration-300 overflow-hidden flex flex-col shadow-lg flex-shrink-0`}
      >
        <div className="p-0.5 md:p-6 border-b border-slate-700 flex-shrink-0">
          <h1 className="text-[8px] md:text-2xl font-bold text-center md:text-left whitespace-nowrap overflow-hidden">📊</h1>
          <h1 className="hidden md:block text-2xl font-bold">{t.teamCapacity}</h1>
          <p className="hidden md:block text-xs text-slate-400 mt-1">{t.plannerSubtitle}</p>
        </div>

        <nav className="p-0.5 md:p-4 space-y-0 md:space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentPage(item.id);
              }}
              className={`w-full flex flex-col md:flex-row items-center justify-center md:justify-start gap-0 md:gap-3 px-0.5 md:px-4 py-1 md:py-3 rounded-lg transition text-[8px] md:text-sm ${
                currentPage === item.id
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-300 hover:bg-slate-700'
              }`}
              title={item.label}
            >
              <span className="flex-shrink-0 text-sm md:text-xl">{item.icon}</span>
              <span className="font-medium text-center md:text-left leading-none">{item.label}</span>
            </button>
          ))}
        </nav>

        {currentPage === 'capacity' && (
          <div className="p-0.5 md:p-4 border-t border-slate-700 flex-shrink-0 overflow-y-auto max-h-20 md:max-h-none space-y-0.5 md:space-y-2">
            <button
              onClick={() => {
                setDepartmentFilter('General');
              }}
              className={`w-full px-1 md:px-3 py-0.5 md:py-2 rounded text-[8px] md:text-sm font-semibold transition leading-tight ${
                departmentFilter === 'General'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
              title={t.general}
            >
              <span className="md:hidden">📊</span>
              <span className="hidden md:inline">📊 {t.general}</span>
            </button>

            <label className="hidden md:block text-xs font-semibold text-slate-400">{t.viewDepartment}</label>
            <select
              value={departmentFilter === 'General' ? '' : departmentFilter}
              onChange={(e) => {
                setDepartmentFilter((e.target.value as DepartmentFilter) || 'General');
              }}
              className="w-full bg-slate-700 text-white text-[8px] md:text-sm rounded px-1 md:px-2 py-0.5 md:py-2 border border-slate-600 hover:border-blue-500 transition leading-tight"
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

        <div className="p-0.5 md:p-4 border-t border-slate-700 flex-shrink-0">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center md:justify-start gap-1 px-1 md:px-3 py-1 md:py-2 text-[9px] md:text-sm text-slate-300 hover:bg-slate-700 rounded-lg transition mb-0.5 md:mb-2"
            title={t.logout}
          >
            <LogOut size={14} className="md:w-4 md:h-4" />
            <span className="hidden md:inline">{t.logout}</span>
          </button>
          <p className="hidden md:block text-xs text-slate-400 text-center">{t.teamCapacityPlanner}</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-3 py-1.5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 hover:bg-gray-100 rounded transition flex-shrink-0"
              title={sidebarOpen ? t.hideSidebar : t.showSidebar}
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <h2 className="text-sm font-semibold text-gray-800 truncate">
              {navItems.find((item) => item.id === currentPage)?.label}
            </h2>
          </div>

          <div className="flex items-center gap-1 md:gap-3 flex-shrink-0">
            {/* User Info Widget - Responsive */}
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 md:gap-3 px-2 md:px-4 py-1 md:py-2 bg-gradient-to-r from-blue-600 to-blue-500 rounded-lg md:rounded-xl border border-blue-400 shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all">
                <div className="w-8 md:w-10 h-8 md:h-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs md:text-sm font-bold text-white">
                    {currentUser.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs md:text-sm font-bold text-white truncate">
                    {currentUser}
                  </span>
                  <span className="text-[10px] md:text-xs text-blue-100 font-medium">
                    {t.loggedIn || 'Logged in'}
                  </span>
                </div>
              </div>
            )}

            {/* Mobile User Icon Only */}
            {currentUser && (
              <div className="sm:hidden w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 flex items-center justify-center border border-blue-400 shadow-lg shadow-blue-500/30 flex-shrink-0" title={currentUser}>
                <span className="text-xs font-bold text-white">
                  {currentUser.charAt(0).toUpperCase()}
                </span>
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
              <div className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded flex-shrink-0">
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
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </Router>
  );
}

export default App;
