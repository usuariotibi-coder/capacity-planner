import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ResourcesPage } from './pages/ResourcesPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CapacityMatrixPage } from './pages/CapacityMatrixPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import { Users, Briefcase, Grid3x3, Menu, X, LogOut } from 'lucide-react';
import type { Department } from './types';
import { useLanguage } from './context/LanguageContext';
import { useTranslation } from './utils/translations';
import { useAuth } from './context/AuthContext';
import { useDataLoader } from './hooks/useDataLoader';

type Page = 'resources' | 'projects' | 'capacity';
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
  const { isLoggedIn, isLoading, logout } = useAuth();

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
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  const navItems: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
    { id: 'capacity', label: t.capacityMatrix, icon: <Grid3x3 size={20} /> },
    { id: 'resources', label: t.resources, icon: <Users size={20} /> },
    { id: 'projects', label: t.projects, icon: <Briefcase size={20} /> },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'resources':
        return <ResourcesPage />;
      case 'projects':
        return <ProjectsPage />;
      case 'capacity':
        return <CapacityMatrixPage departmentFilter={departmentFilter} />;
      default:
        return <CapacityMatrixPage departmentFilter={departmentFilter} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Overlay for mobile when sidebar is open */}
      {sidebarOpen && window.innerWidth < 768 && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } fixed md:relative z-50 md:z-auto h-full bg-slate-800 text-white transition-all duration-300 overflow-y-auto flex flex-col shadow-lg`}
      >
        <div className="p-6 border-b border-slate-700 flex-shrink-0">
          <h1 className="text-2xl font-bold">{t.teamCapacity}</h1>
          <p className="text-xs text-slate-400 mt-1">{t.plannerSubtitle}</p>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentPage(item.id);
                if (window.innerWidth < 768) {
                  setSidebarOpen(false);
                }
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                currentPage === item.id
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              {item.icon}
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        {currentPage === 'capacity' && (
          <div className="p-4 border-t border-slate-700 flex-shrink-0 overflow-y-auto">
            <button
              onClick={() => {
                setDepartmentFilter('General');
                if (window.innerWidth < 768) {
                  setSidebarOpen(false);
                }
              }}
              className={`w-full mb-4 px-3 py-2 rounded text-sm font-semibold transition ${
                departmentFilter === 'General'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              📊 {t.general}
            </button>

            <label className="block text-xs font-semibold text-slate-400 mb-2">{t.viewDepartment}</label>
            <select
              value={departmentFilter === 'General' ? '' : departmentFilter}
              onChange={(e) => {
                setDepartmentFilter((e.target.value as DepartmentFilter) || 'General');
                if (window.innerWidth < 768) {
                  setSidebarOpen(false);
                }
              }}
              className="w-full bg-slate-700 text-white text-sm rounded px-2 py-2 border border-slate-600 hover:border-blue-500 transition"
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

        <div className="p-4 border-t border-slate-700 flex-shrink-0">
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded-lg transition mb-2"
          >
            <LogOut size={16} />
            {t.logout}
          </button>
          <p className="text-xs text-slate-400">{t.teamCapacityPlanner} v1.1.0</p>
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

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-md">
              <button
                onClick={() => setLanguage('es')}
                className={`px-2 py-0.5 rounded text-base transition ${
                  language === 'es'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
                title="Español"
              >
                🌮
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-2 py-0.5 rounded text-base transition ${
                  language === 'en'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
                title="English"
              >
                🍔
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
