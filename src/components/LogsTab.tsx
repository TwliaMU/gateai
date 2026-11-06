import React, { useState } from 'react';
import {
  FileText,
  Search,
  Trash2,
  Download,
  Eye,
  X
} from 'lucide-react';
import type { ProxyLogItem, ProviderConfig } from '../types/index.js';
import { api } from '../services/api.js';

interface LogsTabProps {
  logs: ProxyLogItem[];
  providers: ProviderConfig[];
  onRefresh: () => void;
}

export const LogsTab: React.FC<LogsTabProps> = ({ logs, providers, onRefresh }) => {
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLog, setSelectedLog] = useState<ProxyLogItem | null>(null);

  const filtered = logs.filter(l => {
    if (providerFilter !== 'all' && l.providerId !== providerFilter) return false;
    if (statusFilter === 'success' && (l.statusCode < 200 || l.statusCode >= 300)) return false;
    if (statusFilter === '429' && l.statusCode !== 429) return false;
    if (statusFilter === 'error' && (l.statusCode < 400 || l.statusCode === 429)) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const match =
        l.model.toLowerCase().includes(term) ||
        l.clientTokenName.toLowerCase().includes(term) ||
        l.keyMasked.toLowerCase().includes(term);
      if (!match) return false;
    }
    return true;
  });

  const handleClearLogs = async () => {
    if (!confirm('确定要清空请求审计日志吗？')) return;
    try {
      await api.clearLogs();
      onRefresh();
    } catch (e: any) {
      alert(e.message || '清空失败');
    }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `proxy-logs-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            请求链路审计日志
          </h2>
          <p className="text-xs text-zinc-500">
            监控每一次请求的调度厂商、命中密钥、耗时与 Token 消耗
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleExportJson}
            className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 transition"
          >
            <Download className="w-3.5 h-3.5 mr-1 text-zinc-400" />
            导出
          </button>
          <button
            onClick={handleClearLogs}
            className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:text-red-500 transition"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            清空
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3 h-3 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索模型或客户端..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-2.5 py-1.5 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center space-x-1.5">
          <span className="text-zinc-500">厂商:</span>
          <select
            value={providerFilter}
            onChange={e => setProviderFilter(e.target.value)}
            className="px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 font-mono"
          >
            <option value="all">全部</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-1.5">
          <span className="text-zinc-500">状态:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 font-mono"
          >
            <option value="all">全部</option>
            <option value="success">200 成功</option>
            <option value="429">429 限流</option>
            <option value="error">5xx/4xx 异常</option>
          </select>
        </div>
      </div>

      {/* Logs List: Desktop Table + Mobile Cards */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-400">暂无审计日志</div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="py-2.5 px-4">时间</th>
                    <th className="py-2.5 px-4">模型</th>
                    <th className="py-2.5 px-4">厂商</th>
                    <th className="py-2.5 px-4">命中密钥</th>
                    <th className="py-2.5 px-4">耗时</th>
                    <th className="py-2.5 px-4">Tokens</th>
                    <th className="py-2.5 px-4">状态</th>
                    <th className="py-2.5 px-4 text-right">详情</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-850 text-zinc-700 dark:text-zinc-300">
                  {filtered.map(l => (
                    <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-850/50">
                      <td className="py-2 px-4 text-zinc-400">{new Date(l.timestamp).toLocaleTimeString()}</td>
                      <td className="py-2 px-4 font-semibold text-zinc-900 dark:text-zinc-100">{l.model}</td>
                      <td className="py-2 px-4 text-zinc-500">{l.providerName}</td>
                      <td className="py-2 px-4 text-zinc-400">{l.keyMasked}</td>
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
                      <td className="py-2 px-4 text-right">
                        <button
                          onClick={() => setSelectedLog(l)}
                          className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                        >
                          <Eye className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="block md:hidden divide-y divide-zinc-100 dark:divide-zinc-850">
              {filtered.map(l => (
                <div
                  key={l.id}
                  onClick={() => setSelectedLog(l)}
                  className="p-3 space-y-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-850/40 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 truncate pr-2 font-mono">{l.model}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                      l.statusCode >= 200 && l.statusCode < 300
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : l.statusCode === 429
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}>
                      HTTP {l.statusCode}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                    <span>{l.providerName} · {l.durationMs}ms</span>
                    <span>{new Date(l.timestamp).toLocaleTimeString()}</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono pt-0.5">
                    <span className="truncate">{l.keyMasked || '默认密钥'}</span>
                    <span>{l.totalTokens > 0 ? `${l.totalTokens} Tokens` : '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 font-sans">请求详细记录</h3>
              <button onClick={() => setSelectedLog(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 py-1">
              <div className="flex justify-between"><span className="text-zinc-500 font-sans">时间:</span> <span>{new Date(selectedLog.timestamp).toLocaleTimeString()}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500 font-sans">模型:</span> <span className="font-bold">{selectedLog.model}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500 font-sans">厂商:</span> <span>{selectedLog.providerName}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500 font-sans">Key:</span> <span>{selectedLog.keyMasked}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500 font-sans">耗时:</span> <span>{selectedLog.durationMs}ms</span></div>
              <div className="flex justify-between"><span className="text-zinc-500 font-sans">Tokens:</span> <span>{selectedLog.totalTokens}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500 font-sans">流式:</span> <span>{selectedLog.isStream ? '是' : '否'}</span></div>
              {selectedLog.errorMessage && (
                <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-500 font-sans">
                  {selectedLog.errorMessage}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold font-sans"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
