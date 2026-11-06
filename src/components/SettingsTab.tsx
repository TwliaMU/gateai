import React, { useState, useEffect } from 'react';
import {
  Settings,
  Save,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import type { GlobalConfig, ProviderConfig } from '../types/index.js';
import { api } from '../services/api.js';

interface SettingsTabProps {
  providers: ProviderConfig[];
  onRefresh: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ providers, onRefresh }) => {
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passError, setPassError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);


  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setPassError('');

    if (newPassword.trim()) {
      if (newPassword.trim().length < 12) {
        setPassError('新密码长度不能少于 12 位');
        return;
      }
      if (newPassword.trim() !== confirmPassword.trim()) {
        setPassError('两次输入的新密码不一致');
        return;
      }
    }

    setIsSaving(true);
    setSavedSuccess(false);

    try {
      await api.updateConfig(config);

      if (newPassword.trim()) {
        await api.changeAdminPassword(oldPassword, newPassword.trim());
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      onRefresh();
    } catch (e: any) {
      setPassError(e.message || '保存设置失败');
    } finally {
      setIsSaving(false);
    }
  };

  if (!config) {
    return <div className="p-8 text-center text-xs text-zinc-400">加载设置中...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
          全局调度与安全配置
        </h2>
        <p className="text-xs text-zinc-500">
          配置默认备用厂商、容灾冷却时长与管理后台访问密码
        </p>
      </div>

      <form onSubmit={handleSave} className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4 text-xs">
        <div>
          <label className="text-zinc-700 dark:text-zinc-300 font-semibold block mb-1">
            默认备用厂商 (Default Fallback)
          </label>
          <select
            value={config.defaultProvider}
            onChange={e => setConfig({ ...config, defaultProvider: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-zinc-700 dark:text-zinc-300 font-semibold block mb-1">
            全局轮询策略 (Global LB Strategy)
          </label>
          <select
            value={config.defaultStrategy}
            onChange={e => setConfig({ ...config, defaultStrategy: e.target.value as any })}
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
          >
            <option value="round-robin">轮询 (Round-Robin)</option>
            <option value="random">随机抽样 (Random Polling)</option>
            <option value="least-errors">错误率最低优先</option>
            <option value="weighted">基于权重分流</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-zinc-700 dark:text-zinc-300 font-semibold block mb-1">
              429 自动冷却时长 (分钟)
            </label>
            <input
              type="number"
              min="1"
              max="1440"
              value={config.autoCooldownMinutes}
              onChange={e => setConfig({ ...config, autoCooldownMinutes: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="text-zinc-700 dark:text-zinc-300 font-semibold block mb-1">
              单请求故障转移最大重试
            </label>
            <input
              type="number"
              min="1"
              max="5"
              value={config.maxRetries}
              onChange={e => setConfig({ ...config, maxRetries: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          <span className="text-zinc-700 dark:text-zinc-300 font-semibold block">
            修改管理员密码 (若不修改请留空)
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-zinc-500 block mb-1 text-[11px]">当前原密码</label>
              <input
                type="password"
                placeholder="请输入原密码"
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-zinc-500 block mb-1 text-[11px]">新密码 (至少 12 位)</label>
              <input
                type="password"
                placeholder="输入新密码"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-zinc-500 block mb-1 text-[11px]">确认新密码</label>
              <input
                type="password"
                placeholder="再次输入新密码"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {passError && (
            <p className="text-red-500 text-[11px]">{passError}</p>
          )}
        </div>

        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="publicEndpoint"
              checked={config.enablePublicEndpoints}
              onChange={e => setConfig({ ...config, enablePublicEndpoints: e.target.checked })}
              className="rounded text-zinc-900 dark:text-white"
            />
            <label htmlFor="publicEndpoint" className="text-zinc-700 dark:text-zinc-300">
              允许免密公开调用 (无需附带 Token)
            </label>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold transition"
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            <span>{isSaving ? '保存中...' : '保存更改'}</span>
          </button>
        </div>

        {savedSuccess && (
          <div className="pt-2 flex items-center text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            <span>设置已成功保存！</span>
          </div>
        )}
      </form>

    </div>
  );
};
