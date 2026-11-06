import React, { useEffect, useState } from 'react';
import { Shield, X } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle.js';
import { PWAInstallButton } from './PWAInstallButton.js';
import { SiteFooter } from './SiteFooter.js';
import { NightSky } from './NightSky.js';
import type { ThemeMode } from '../hooks/useTheme.js';
import { api } from '../services/api.js';

interface HomePageProps {
  onEnterAdmin: () => void;
  isAdminLoggedIn: boolean;
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  resolvedTheme: 'dark' | 'light';
}

export const HomePage: React.FC<HomePageProps> = ({
  onEnterAdmin,
  isAdminLoggedIn,
  themeMode,
  setThemeMode,
  resolvedTheme
}) => {
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'initialize'>('login');
  const [loginPassword, setLoginPassword] = useState('');
  const [initPassword, setInitPassword] = useState('');
  const [initConfirmPassword, setInitConfirmPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const adminTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const closeLoginModal = () => {
    setIsLoginModalOpen(false);
    // Return focus to the trigger so keyboard users are not stranded.
    adminTriggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isLoginModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeLoginModal(); return; }
      if (e.key !== 'Tab') return;
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;
      const els = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
      if (els.length === 0) return;
      const first = els[0]; const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLoginModalOpen]);

  useEffect(() => {
    let cancelled = false;
    api.getHealth()
      .then(data => { if (!cancelled) setIsOnline(data.status === 'healthy'); })
      .catch(() => { if (!cancelled) setIsOnline(false); });
    return () => { cancelled = true; };
  }, []);

  const dotColors = isOnline === null
    ? ['#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8', '#e4e4e7']
    : isOnline
      ? ['#065f46', '#047857', '#059669', '#10b981', '#34d399', '#6ee7b7']
      : ['#7f1d1d', '#991b1b', '#dc2626', '#ef4444', '#f87171', '#fca5a5'];
  const statusText = isOnline === null ? '检测中' : isOnline ? '在线' : '离线';

  const handleOpenAdmin = async () => {
    setLoginError('');
    setLoginPassword('');
    setInitPassword('');
    setInitConfirmPassword('');
    try {
      const status = await api.getAuthStatus();
      if (!status.isInitialized) {
        setAuthMode('initialize');
        setIsLoginModalOpen(true);
      } else {
        if (isAdminLoggedIn) {
          onEnterAdmin();
        } else {
          setAuthMode('login');
          setIsLoginModalOpen(true);
        }
      }
    } catch {
      // An auth-status probe failure must not enter the admin console
      // directly (an expired session used to flash the admin skeleton);
      // always go through the login modal instead.
      setAuthMode('login');
      setIsLoginModalOpen(true);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginPassword.trim()) {
      setLoginError('请输入后台密码');
      return;
    }
    setIsSubmitting(true);
    setLoginError('');
    try {
      const res = await api.loginAdmin(loginPassword.trim());
      if (res.needInitialize) {
        setAuthMode('initialize');
        setLoginError('系统尚未初始化密码，请先完成密码设置');
        return;
      }
      if (res.success) {
        localStorage.setItem('admin-auth', 'true');
        setIsLoginModalOpen(false);
        onEnterAdmin();
      } else {
        setLoginError(res.error || '密码错误，请重试');
      }
    } catch (err: any) {
      setLoginError(err.message || '登录异常');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (initPassword.length < 12) {
      setLoginError('密码长度不能少于 12 位');
      return;
    }
    if (initPassword !== initConfirmPassword) {
      setLoginError('两次输入的密码不一致');
      return;
    }
    setIsSubmitting(true);
    setLoginError('');
    try {
      await api.initializeAdminPassword(initPassword);
      localStorage.setItem('admin-auth', 'true');
      setIsLoginModalOpen(false);
      onEnterAdmin();
    } catch (err: any) {
      setLoginError(err.message || '初始化密码失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans selection:bg-zinc-200 dark:selection:bg-zinc-800 transition-colors duration-150">
      <header className="border-b border-zinc-200 dark:border-zinc-850 bg-white/80 dark:bg-zinc-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2.5 sm:space-x-3">
            <img src="/icon.svg" alt="GateAI 图标" className="w-8 h-8 rounded-lg shrink-0" />
            <span className="font-semibold text-sm tracking-tight">GateAI</span>
          </div>

          <div className="flex items-center space-x-2">
            <ThemeToggle mode={themeMode} setMode={setThemeMode} resolvedTheme={resolvedTheme} />
            <PWAInstallButton variant="compact" />
            <button
              ref={adminTriggerRef} onClick={handleOpenAdmin}
              className="flex items-center justify-center p-2 sm:px-3 sm:py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition shadow-xs text-xs font-semibold"
              title={isAdminLoggedIn ? '进入管理后台' : '管理员登录'}
              aria-label="管理员登录入口"
            >
              <Shield className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
              <span className="hidden sm:inline sm:ml-1.5">{isAdminLoggedIn ? '进入后台' : '后台登录'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className={`relative flex-1 w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex items-center justify-center overflow-hidden ${resolvedTheme === 'dark' ? '' : 'bg-white'}`}>
        {resolvedTheme === 'dark' ? <NightSky /> : null}
        <div className="relative z-10 flex items-center space-x-3 sm:space-x-4" title={`GateAI · ${statusText}`} aria-label={`GateAI，网关${statusText}`}>
          <span className={`text-5xl sm:text-7xl font-bold tracking-tight ${resolvedTheme === 'dark' ? 'text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]' : 'text-zinc-900'}`}>
            GateAI
          </span>
          <span className="flex items-center space-x-1.5 sm:space-x-2 pt-2 sm:pt-3">
            {dotColors.map((color, idx) => (
              <span
                key={idx}
                className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
          <span className="sr-only">{statusText}</span>
        </div>
      </main>

      <SiteFooter />

      {isLoginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs" onClick={closeLoginModal}>
          <div role="dialog" aria-modal="true" aria-label="管理员登录" onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-md bg-zinc-900 dark:bg-white flex items-center justify-center text-white dark:text-zinc-950">
                  <Shield className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                    {authMode === 'initialize' ? '首次登入 · 初始化密码' : '管理员登录'}
                  </h3>
                  {authMode === 'initialize' && (
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      首次使用 · 强制初始化
                    </span>
                  )}
                </div>
              </div>
              <button
                aria-label="关闭登录弹窗"
                onClick={() => setIsLoginModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-500 leading-relaxed">
              {authMode === 'initialize'
                ? '系统检测到为首次登入后台。为了保障各厂商 API 密钥与网关安全，必须先初始化管理员密码。'
                : '请输入您设置的管理员密码以进入控制台。'}
            </p>

            {authMode === 'initialize' ? (
              <form onSubmit={handleInitSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">
                    设置新密码 (至少 12 位) *
                  </label>
                  <input
                    type="password"
                    autoFocus
                    required
                    minLength={12}
                    autoComplete="new-password" placeholder="请输入新管理员密码"
                    value={initPassword}
                    onChange={e => {
                      setInitPassword(e.target.value);
                      setLoginError('');
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
                  />
                </div>

                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">
                    确认新密码 *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={12}
                    autoComplete="new-password" placeholder="请再次输入新密码"
                    value={initConfirmPassword}
                    onChange={e => {
                      setInitConfirmPassword(e.target.value);
                      setLoginError('');
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
                  />
                </div>

                {loginError && <p className="text-red-500 text-[11px] mt-1">{loginError}</p>}

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold transition disabled:opacity-50"
                  >
                    {isSubmitting ? '正在初始化...' : '确认并初始化密码'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleLoginSubmit} className="space-y-3 text-xs">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">
                    管理员密码 *
                  </label>
                  <input
                    type="password"
                    autoFocus
                    required
                    autoComplete="current-password" placeholder="请输入后台密码"
                    value={loginPassword}
                    onChange={e => {
                      setLoginPassword(e.target.value);
                      setLoginError('');
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
                  />
                  {loginError && <p className="text-red-500 text-[11px] mt-1">{loginError}</p>}
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold transition disabled:opacity-50"
                  >
                    {isSubmitting ? '正在验证...' : '进入后台'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
