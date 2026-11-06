/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { HomePage } from './components/HomePage.js';
const AdminConsole = lazy(() => import('./components/AdminConsole.js').then(m => ({ default: m.AdminConsole })));
import { useTheme } from './hooks/useTheme.js';
import { api } from './services/api.js';
import type {
  SystemMetrics,
  ProviderConfig,
  ApiKeyItem,
  ClientToken,
  ProxyLogItem
} from './types/index.js';

const VALID_ADMIN_TABS = ['overview', 'providers', 'keys', 'clients', 'playground', 'logs', 'settings'];

// Lazy-admin load failure must not white-screen the whole app: a chunk
// that 404s in a deploy window gets a retry button instead.
class AdminErrorBoundary extends React.Component<
  { onRetry: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: unknown) { console.error('Admin console failed to load:', err); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-sm text-zinc-500">
          <span>后台加载失败，可能是新版本正在部署。</span>
          <button
            onClick={() => { this.setState({ hasError: false }); this.props.onRetry(); }}
            className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-medium"
          >
            后台加载失败，重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function parseHashRoute(): { view: 'home' | 'admin'; tab: string } {
  if (typeof window === 'undefined') {
    return { view: 'home', tab: 'overview' };
  }

  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  
  if (hash.startsWith('admin')) {
    const parts = hash.split('/');
    const tab = parts[1] && VALID_ADMIN_TABS.includes(parts[1]) ? parts[1] : 'overview';
    return { view: 'admin', tab };
  }

  // Fallback to localStorage if no hash is set
  const savedView = localStorage.getItem('admin-view');
  const savedTab = localStorage.getItem('admin-active-tab') || 'overview';
  const isAuth = localStorage.getItem('admin-auth') === 'true';

  if (savedView === 'admin' && isAuth) {
    const tab = VALID_ADMIN_TABS.includes(savedTab) ? savedTab : 'overview';
    return { view: 'admin', tab };
  }

  return { view: 'home', tab: 'overview' };
}

export default function App() {
  const { mode, setMode, resolvedTheme } = useTheme();

  const initialRoute = parseHashRoute();
  // The localStorage marker is never trusted on its own: the admin console
  // only renders after the stored session token passes a server probe
  // (see the verification effect below). Until then, start on the homepage.
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<'home' | 'admin'>('home');

  const [adminActiveTab, setAdminActiveTab] = useState<string>(() => {
    return initialRoute.tab;
  });

  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [clients, setClients] = useState<ClientToken[]>([]);
  const [logs, setLogs] = useState<ProxyLogItem[]>([]);

  // Sync route changes with URL hash and localStorage
  const syncRouteToUrl = useCallback((view: 'home' | 'admin', tab: string) => {
    if (typeof window === 'undefined') return;
    if (view === 'admin') {
      const targetHash = `#/admin/${tab}`;
      if (window.location.hash !== targetHash) {
        window.history.replaceState(null, '', targetHash);
      }
      localStorage.setItem('admin-view', 'admin');
      localStorage.setItem('admin-active-tab', tab);
    } else {
      if (window.location.hash && window.location.hash !== '#/home' && window.location.hash !== '#/') {
        window.history.replaceState(null, '', '#/home');
      }
      localStorage.setItem('admin-view', 'home');
    }
  }, []);

  // Listen for browser back/forward and hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const route = parseHashRoute();
      const isAuth = localStorage.getItem('admin-auth') === 'true';
      if (route.view === 'admin') {
        if (isAuth) {
          // Verify the stored session before rendering the admin console.
          api.getConfig().then(
            () => {
              setIsAdminLoggedIn(true);
              setCurrentView('admin');
              setAdminActiveTab(route.tab);
            },
            () => {
              localStorage.removeItem('admin-auth');
              localStorage.removeItem('admin-token');
              localStorage.removeItem('admin-view');
              setIsAdminLoggedIn(false);
              setCurrentView('home');
              syncRouteToUrl('home', 'overview');
            }
          );
        } else {
          setCurrentView('home');
          syncRouteToUrl('home', 'overview');
        }
      } else {
        setCurrentView('home');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [syncRouteToUrl]);

  const pollingInFlight = React.useRef(false);
  const loadData = useCallback(async () => {
    // Management data is only polled in the admin view while logged in.
    if (currentView !== 'admin' || !isAdminLoggedIn) return;
    // In-flight guard: a slow DO must not let polls stack up on it.
    if (pollingInFlight.current) return;
    pollingInFlight.current = true;
    try {
      const [m, p, k, c, l, authStatus] = await Promise.all([
        api.getMetrics().catch(() => null),
        api.getProviders().catch(() => []),
        api.getKeys().catch(() => []),
        api.getClients().catch(() => []),
        api.getLogs(60).catch(() => []),
        api.getAuthStatus().catch(() => null)
      ]);

      if (authStatus && !authStatus.isInitialized) {
        localStorage.removeItem('admin-auth');
        localStorage.removeItem('admin-token');
        localStorage.removeItem('admin-view');
        setIsAdminLoggedIn(false);
        setCurrentView('home');
        syncRouteToUrl('home', 'overview');
      }

      if (m) setMetrics(m);
      if (p) setProviders(p);
      if (k) setKeys(k);
      if (c) setClients(c);
      if (l) setLogs(l);
    } catch (err) {
      console.error('Failed to load gateway data:', err);
    } finally {
      pollingInFlight.current = false;
    }
  }, [syncRouteToUrl, currentView, isAdminLoggedIn]);

  // Verify a stored session marker on mount before rendering the admin console.
  useEffect(() => {
    if (localStorage.getItem('admin-auth') !== 'true') return;
    api.getConfig().then(
      () => {
        setIsAdminLoggedIn(true);
        if (initialRoute.view === 'admin') {
          setCurrentView('admin');
          setAdminActiveTab(initialRoute.tab);
        }
      },
      () => {
        localStorage.removeItem('admin-auth');
        localStorage.removeItem('admin-token');
        localStorage.removeItem('admin-view');
        setIsAdminLoggedIn(false);
        setCurrentView('home');
        syncRouteToUrl('home', 'overview');
      }
    );
    // Run once on mount; initialRoute is fixed at first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling: admin view only, paused while the tab is hidden.
  // On the homepage, only a single getAuthStatus probe runs.
  useEffect(() => {
    if (currentView !== 'admin' || !isAdminLoggedIn) {
      api.getAuthStatus().catch(() => null);
      return;
    }
    // Chained polling: the next 20s tick is scheduled only after the
    // previous round finishes (interval value unchanged, 20s).
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await loadData();
      if (!stopped) timer = setTimeout(tick, 20000);
    };
    const startPolling = () => {
      stopped = false;
      tick();
    };
    const stopPolling = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const handleVisibility = () => {
      if (document.hidden) stopPolling();
      else startPolling();
    };
    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [currentView, isAdminLoggedIn, loadData]);

  const handleEnterAdmin = (targetTab?: string) => {
    const tabToOpen = targetTab || adminActiveTab || 'overview';
    setIsAdminLoggedIn(true);
    setCurrentView('admin');
    setAdminActiveTab(tabToOpen);
    syncRouteToUrl('admin', tabToOpen);
  };

  const handleAdminTabChange = (newTab: string) => {
    setAdminActiveTab(newTab);
    syncRouteToUrl('admin', newTab);
  };

  const handleLogout = () => {
    api.logout().catch(() => null);
    localStorage.removeItem('admin-auth');
    localStorage.removeItem('admin-token');
    localStorage.removeItem('admin-view');
    setIsAdminLoggedIn(false);
    setCurrentView('home');
    syncRouteToUrl('home', 'overview');
  };

  const handleBackToHome = () => {
    setCurrentView('home');
    syncRouteToUrl('home', 'overview');
  };

  const [adminLoadKey, setAdminLoadKey] = useState(0);
  if (currentView === 'admin' && isAdminLoggedIn) {
    return (
      <AdminErrorBoundary key={adminLoadKey} onRetry={() => setAdminLoadKey(k => k + 1)}>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-zinc-500">正在加载后台…</div>}>
      <AdminConsole
        onBackToHome={handleBackToHome}
        onLogout={handleLogout}
        themeMode={mode}
        setThemeMode={setMode}
        resolvedTheme={resolvedTheme}
        metrics={metrics}
        providers={providers}
        keys={keys}
        clients={clients}
        logs={logs}
        onRefresh={loadData}
        activeTab={adminActiveTab}
        onTabChange={handleAdminTabChange}
      />
      </Suspense>
      </AdminErrorBoundary>
    );
  }

  return (
    <HomePage
      onEnterAdmin={handleEnterAdmin}
      isAdminLoggedIn={isAdminLoggedIn}
      themeMode={mode}
      setThemeMode={setMode}
      resolvedTheme={resolvedTheme}
    />
  );
}
