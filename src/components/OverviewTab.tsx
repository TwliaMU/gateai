import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  Activity,
  Zap,
  Layers,
  Key,
  Clock,
  CheckCircle2,
  RefreshCw,
  Plus,
  Server,
  Copy,
  Check,
  Shield,
  ExternalLink
} from 'lucide-react';
import type { SystemMetrics, ProviderConfig, ProxyLogItem } from '../types/index.js';

interface OverviewTabProps {
  metrics: SystemMetrics | null;
  providers: ProviderConfig[];
  recentLogs: ProxyLogItem[];
  onRefresh: () => void;
  onNavigateTab: (tab: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  metrics,
  providers,
  recentLogs,
  onRefresh,
  onNavigateTab
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [doVersion, setDoVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getHealth().then(
      d => { if (!cancelled && d.version) setDoVersion(d.version); },
      () => {}
    );
    return () => { cancelled = true; };
  }, []);

  const currentBaseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/v1`
    : 'https://your-worker.workers.dev/v1';

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(currentBaseUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const formatNumber = (num?: number) => {
    if (num === undefined || num === null) return '0';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            网关运行状态
          </h2>
          <p className="text-xs text-zinc-500">
            实时监控各厂商多密钥池并发、Token 吞吐量与故障转移
            {doVersion && <span className="ml-2 font-mono">DO 版本：{doVersion}</span>}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onRefresh}
            className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1 text-zinc-400" />
            刷新
          </button>
          <button
            onClick={() => onNavigateTab('keys')}
            className="flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 transition"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加密钥
          </button>
        </div>
      </div>

      {/* Gateway Base URL & Integration Banner */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start sm:items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-white shrink-0 mt-0.5 sm:mt-0">
            <Server className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">网关对外 API 接口地址 (Base URL)</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono">OpenAI Compatible</span>
            </div>
            <div className="mt-1 font-mono text-xs text-zinc-700 dark:text-zinc-300 select-all break-all">
              {currentBaseUrl}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-center shrink-0">
          <button
            onClick={handleCopyUrl}
            className="flex items-center px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition"
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-500 mr-1.5" /> : <Copy className="w-3.5 h-3.5 text-zinc-400 mr-1.5" />}
            <span>{copiedUrl ? '已复制地址' : '复制 Base URL'}</span>
          </button>
          <button
            onClick={() => onNavigateTab('clients')}
            className="flex items-center px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium transition"
          >
            <Shield className="w-3.5 h-3.5 mr-1.5" />
            <span>分配客户端令牌</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500 block mb-1">累计请求</span>
          <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {formatNumber(metrics?.totalRequests)}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500 block mb-1">消耗 Tokens</span>
          <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {formatNumber(metrics?.totalTokens)}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500 block mb-1">密钥在线状态</span>
          <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
            {metrics?.activeKeysCount ?? 0}
            <span className="text-xs text-zinc-400 font-normal ml-1">/ {metrics?.totalKeysCount ?? 0}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500 block mb-1">调用成功率</span>
          <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {metrics?.successRate ?? 100}%
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500 block mb-1">平均耗时</span>
          <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {metrics?.averageLatencyMs ?? 0}<span className="text-xs text-zinc-400 font-normal ml-0.5">ms</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <span className="text-[11px] text-zinc-500 block mb-1">活跃厂商</span>
          <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100">
            {metrics?.activeProvidersCount ?? 0}
          </div>
        </div>
      </div>

      {/* Provider Quota Cards */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          各厂商配额与密钥池分布
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {providers.map(p => {
            const stats = metrics?.providerStats?.[p.id] || {
              requests: 0,
              tokens: 0,
              errors: 0,
              healthyKeys: 0,
              totalKeys: 0
            };

            return (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{p.name}</span>
                    <span className="text-[11px] text-zinc-400 font-mono block">{p.baseUrl}</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded font-mono border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400">
                    {stats.healthyKeys} / {stats.totalKeys} Keys
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2 border-t border-zinc-100 dark:border-zinc-850">
                  <div>
                    <span className="text-[10px] text-zinc-400 block">请求</span>
                    <span className="font-mono font-semibold">{formatNumber(stats.requests)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block">Tokens</span>
                    <span className="font-mono font-semibold">{formatNumber(stats.tokens)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block">异常</span>
                    <span className={`font-mono font-semibold ${stats.errors > 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                      {stats.errors}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Requests Table */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">近期请求流水 (Recent Requests)</span>
          <button
            onClick={() => onNavigateTab('logs')}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition"
          >
            查看全部 &rarr;
          </button>
        </div>

        {recentLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-400">
            暂无调用记录，可在「在线调试」或外部客户端发起请求测试
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="py-2.5 px-4">时间</th>
                    <th className="py-2.5 px-4">模型</th>
                    <th className="py-2.5 px-4">厂商</th>
                    <th className="py-2.5 px-4">耗时</th>
                    <th className="py-2.5 px-4">Tokens</th>
                    <th className="py-2.5 px-4">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-850 text-zinc-700 dark:text-zinc-300">
                  {recentLogs.slice(0, 6).map(l => (
                    <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-850/50">
                      <td className="py-2 px-4 text-zinc-400">{new Date(l.timestamp).toLocaleTimeString()}</td>
                      <td className="py-2 px-4 font-semibold text-zinc-900 dark:text-zinc-100">{l.model}</td>
                      <td className="py-2 px-4 text-zinc-500">{l.providerName}</td>
                      <td className="py-2 px-4">{l.durationMs}ms</td>
                      <td className="py-2 px-4">{l.totalTokens > 0 ? l.totalTokens.toLocaleString() : '-'}</td>
                      <td className="py-2 px-4">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          l.statusCode >= 200 && l.statusCode < 300
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : l.statusCode === 429
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'bg-red-500/10 text-red-600 dark:text-red-400'
                        }`}>
                          {l.statusCode}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="block md:hidden divide-y divide-zinc-100 dark:divide-zinc-850">
              {recentLogs.slice(0, 5).map(l => (
                <div key={l.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 font-mono truncate">{l.model}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      l.statusCode >= 200 && l.statusCode < 300
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : l.statusCode === 429
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}>
                      {l.statusCode}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                    <span>{l.providerName} · {l.durationMs}ms</span>
                    <span>{new Date(l.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
