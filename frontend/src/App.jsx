import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Database, LayoutGrid, AlertCircle, Languages } from 'lucide-react';
import clsx from 'clsx';

import ReviewPage from './features/review/ReviewPage';
import MemoryBrowser from './features/memory/MemoryBrowser';
import MaintenancePage from './features/maintenance/MaintenancePage';
import TokenAuth from './components/TokenAuth';
import { ToastContainer } from './components/Toast';
import { AUTH_ERROR_EVENT } from './lib/api';
import { detectLocale } from './i18n/index';
import { Button } from './components/ui/button';
import { cn } from './lib/utils';
import i18n from './i18n';

const consumeTokenFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return false;

  localStorage.setItem('api_token', token);
  params.delete('token');
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
  return true;
};

// Maintenance (brain cleanup) is fully automated server-side (autoForget cron);
// the manual UI was removed. The route stays reachable as an escape hatch.
const NAV_ITEMS = [
  { to: '/review', icon: ShieldCheck, key: 'app.nav.review' },
  { to: '/memory', icon: Database, key: 'app.nav.memory' },
];

function Layout() {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Top Navigation Bar */}
      <div className="h-12 border-b border-border bg-card flex items-center px-4 gap-6 flex-shrink-0 z-10">
        <div className="font-bold flex items-center gap-2 mr-4">
          <LayoutGrid className="w-5 h-5 text-primary" />
          <span data-testid="app-brand">{t('app.nav.brand')}</span>
        </div>

        <nav className="flex items-center gap-1 h-full">
          {NAV_ITEMS.map(({ to, icon: Icon, key }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'h-full flex items-center gap-2 px-4 text-sm font-medium border-b-2 transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                )
              }
            >
              <Icon size={16} />
              {t(key)}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => i18n.changeLanguage(i18n.resolvedLanguage === 'zh' ? 'en' : 'zh')}
            className="text-muted-foreground hover:text-foreground"
            title={t('app.nav.language')}
          >
            <Languages size={16} />
            {i18n.resolvedLanguage === 'zh' ? 'EN' : '中'}
          </Button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<Navigate to="/review" replace />} />

          <Route path="/review" element={<ReviewPage />} />

          <Route path="/memory" element={<MemoryBrowser />} />

          <Route path="/maintenance" element={<MaintenancePage />} />
        </Routes>
      </div>

      <ToastContainer />
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return consumeTokenFromUrl() || !!localStorage.getItem('api_token');
  });
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [backendError, setBackendError] = useState(false);

  const handleAuthError = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  const handleAuthenticated = useCallback(() => {
    setIsAuthenticated(true);
    setBackendError(false);
  }, []);

  // 组件挂载时，尝试发送一个无 token 的请求探测后端是否连通及鉴权状态
  useEffect(() => {
    let mounted = true;

    const checkAuthStatus = async () => {
      try {
        const { getDomains } = await import('./lib/api');
        await getDomains();
        if (mounted) {
          setIsAuthenticated(true);
          setBackendError(false);
          setIsCheckingAuth(false);
        }
      } catch (error) {
        if (mounted) {
          if (!error.response) {
            // 没有响应，说明是网络错误（后端未启动）
            setBackendError(true);
          } else if (error.response.status === 401) {
            setIsAuthenticated(false);
            setBackendError(false);
          } else {
            setBackendError(false);
          }
          setIsCheckingAuth(false);
        }
      }
    };

    checkAuthStatus();

    return () => {
      mounted = false;
    };
  }, []);

  // 监听 401 事件，切换回认证界面
  useEffect(() => {
    window.addEventListener(AUTH_ERROR_EVENT, handleAuthError);
    return () => {
      window.removeEventListener(AUTH_ERROR_EVENT, handleAuthError);
    };
  }, [handleAuthError]);

  useEffect(() => {
    if (!isCheckingAuth && isAuthenticated) {
      detectLocale();
    }
  }, [isCheckingAuth, isAuthenticated]);

  if (isCheckingAuth) {
    return (
      <div data-testid="app-loading" className="flex flex-col items-center justify-center h-screen bg-slate-950 text-slate-400">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin mb-4"></div>
        <div className="text-sm">{t('app.loading.connecting')}</div>
      </div>
    );
  }

  if (backendError) {
    return (
      <div data-testid="error-connection-refused" className="flex flex-col items-center justify-center h-screen bg-slate-950 text-slate-400">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6 text-red-500" />
        </div>
        <div className="text-lg font-bold text-slate-100 mb-1">{t('app.error.connection_refused')}</div>
        <div className="text-sm text-slate-500 max-w-md text-center mt-2 space-y-2">
          <p>{t('app.error.troubleshooting')}</p>
          <ul className="list-disc text-left pl-6 space-y-1">
            <li>{t('app.error.check_backend')}</li>
            <li><strong>{t('app.error.check_port_title')}</strong>{t('app.error.check_port_detail')}</li>
            <li>{t('app.error.check_docker')}</li>
          </ul>
        </div>
        <button
          data-testid="retry-btn"
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition-colors"
        >
          {t('app.error.retry')}
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <TokenAuth onAuthenticated={handleAuthenticated} />;
  }

  return (
    // Whole panel lives under /admin so Cloudflare Access guards the entire app.
    <BrowserRouter basename="/admin">
      <Layout />
    </BrowserRouter>
  );
}

export default App;
