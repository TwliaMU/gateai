import React, { useState } from 'react';
import {
  Activity,
  Layers,
  Key,
  Shield,
  Terminal,
  FileText,
  Settings,
  ArrowLeft,
  LogOut,
  Copy,
  Check
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle.js';
import { PWAInstallButton } from './PWAInstallButton.js';
import { SiteFooter } from './SiteFooter.js';
import { OverviewTab } from './OverviewTab.js';
import { ProvidersTab } from './ProvidersTab.js';
import { KeyPoolTab } from './KeyPoolTab.js';
import { ClientsTab } from './ClientsTab.js';
import { PlaygroundTab } from './PlaygroundTab.js';
import { LogsTab } from './LogsTab.js';
import { SettingsTab } from './SettingsTab.js';
import type { ThemeMode } from '../hooks/useTheme.js';
import type {
  SystemMetrics,
  ProviderConfig,
  ApiKeyItem,
  ClientToken,
  ProxyLogItem
} from '../types/index.js';

interface AdminConsoleProps {
  onBackToHome: () => void;
  onLogout: () => void;
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  resolvedTheme: 'dark' | 'light';
  metrics: SystemMetrics | null;
  providers: ProviderConfig[];
  keys: ApiKeyItem[];
  clients: ClientToken[];
  logs: ProxyLogItem[];
  onRefresh: () => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  onBackToHome,
  onLogout,
  themeMode,
  setThemeMode,
  resolvedTheme,
  metrics,
  providers,
  keys,
  clients,
  logs,
  onRefresh,
  activeTab: controlledActiveTab,
  onTabChange
}) => {
  const [internalActiveTab, setInternalActiveTab] = useState<string>('overview');
  const activeTab = controlledActiveTab || internalActiveTab;

  const handleSelectTab = (tab: string) => {
    setInternalActiveTab(tab);
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('all');
  const [copiedUrl, setCopiedUrl] = useState(false);

  const currentBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/v1`
    : 'https://your-worker.workers.dev/v1';

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(currentBaseUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const navItems = [
    { id: 'overview', label: '监控概览', icon: Activity },
    { id: 'providers', label: '厂商配置', icon: Layers },
    { id: 'keys', label: '密钥池', icon: Key },
    { id: 'clients', label: '客户端令牌', icon: Shield },
    { id: 'playground', label: '在线调试', icon: Terminal },
    { id: 'logs', label: '审计日志', icon: FileText },
    { id: 'settings', label: '全局配置', icon: Settings },
  ];

  const handleNavigateToKeys = (providerId: string) => {
    setSelectedProviderFilter(providerId);
    handleSelectTab('keys');
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans transition-colors duration-150">
      {/* Admin Top Navbar */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <button
              onClick={onBackToHome}
              className="flex items-center text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition mr-1"
              title="返回首页"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              <span>首页</span>
            </button>
            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <span className="font-semibold text-xs sm:text-sm">控制台</span>
              <span className="text-[10px] sm:text-[11px] px-1.5 py-0.2 rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono">
                {metrics?.activeKeysCount ?? 0} Keys
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="hidden md:flex items-center text-xs font-mono bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-zinc-600 dark:text-zinc-400">
              <span className="mr-1 select-all">{currentBaseUrl}</span>
              <button onClick={handleCopyUrl} className="hover:text-zinc-900 dark:hover:text-white">
                {copiedUrl ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>

            <ThemeToggle mode={themeMode} setMode={setThemeMode} resolvedTheme={resolvedTheme} />

            <PWAInstallButton variant="compact" />

            <button
              onClick={onLogout}
              className="flex items-center px-2.5 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
              title="退出登录"
            >
              <LogOut className="w-3.5 h-3.5 mr-1" />
              <span className="hidden sm:inline">退出</span>
            </button>
          </div>
        </div>

        {/* Sub-nav Tab Bar */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto scrollbar-none border-t border-zinc-100 dark:border-zinc-900">
          <nav className="flex space-x-1 py-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectTab(item.id)}
                  className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition ${
                    isActive
                      ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-white font-semibold'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 mr-1.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        {activeTab === 'overview' && (
          <OverviewTab
            metrics={metrics}
            providers={providers}
            recentLogs={logs}
            onRefresh={onRefresh}
            onNavigateTab={handleSelectTab}
          />
        )}

        {activeTab === 'providers' && (
          <ProvidersTab
            providers={providers}
            keys={keys}
            onRefresh={onRefresh}
            onNavigateToKeys={handleNavigateToKeys}
          />
        )}

        {activeTab === 'keys' && (
          <KeyPoolTab
            keys={keys}
            providers={providers}
            selectedProviderFilter={selectedProviderFilter}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'clients' && (
          <ClientsTab
            clients={clients}
            providers={providers}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'playground' && (
          <PlaygroundTab
            providers={providers}
            clients={clients}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'logs' && (
          <LogsTab
            logs={logs}
            providers={providers}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            providers={providers}
            onRefresh={onRefresh}
          />
        )}
      </main>

      <SiteFooter />
    </div>
  );
};
