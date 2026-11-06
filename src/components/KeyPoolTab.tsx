import React, { useState } from 'react';
import {
  Key,
  Plus,
  FileSpreadsheet,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Edit2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { ApiKeyItem, ProviderConfig } from '../types/index.js';
import { api } from '../services/api.js';

interface KeyPoolTabProps {
  keys: ApiKeyItem[];
  providers: ProviderConfig[];
  selectedProviderFilter?: string;
  onRefresh: () => void;
}

export const KeyPoolTab: React.FC<KeyPoolTabProps> = ({
  keys,
  providers,
  selectedProviderFilter,
  onRefresh
}) => {
  const [providerFilter, setProviderFilter] = useState<string>(selectedProviderFilter || 'all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isSingleModalOpen, setIsSingleModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Edit Key Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKeyItem | null>(null);
  const [editForm, setEditForm] = useState({
    id: '',
    providerId: '',
    key: '',
    maskedKey: '',
    label: '',
    weight: 1,
    status: 'active' as ApiKeyItem['status']
  });
  const [isTestingEditKey, setIsTestingEditKey] = useState(false);
  const [editKeyTestResult, setEditKeyTestResult] = useState<{
    success: boolean;
    models?: string[];
    count?: number;
    error?: string;
    latencyMs?: number;
  } | null>(null);

  // Model probing state for Single Key Modal
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<{
    success: boolean;
    models?: string[];
    count?: number;
    error?: string;
    latencyMs?: number;
  } | null>(null);
  const [syncToProvider, setSyncToProvider] = useState(true);

  const safeKeys = Array.isArray(keys) ? keys : [];
  const safeProviders = Array.isArray(providers) ? providers : [];

  const [singleForm, setSingleForm] = useState({
    providerId: safeProviders[0]?.id || 'gemini',
    key: '',
    label: '',
    weight: 1
  });

  const [batchForm, setBatchForm] = useState({
    providerId: safeProviders[0]?.id || 'gemini',
    rawKeys: ''
  });

  const handleTestAndFetchModels = async () => {
    if (!singleForm.key.trim()) return;
    setIsTestingKey(true);
    setKeyTestResult(null);
    try {
      const res = await api.fetchUpstreamModels({
        providerId: singleForm.providerId,
        apiKey: singleForm.key.trim()
      });
      setKeyTestResult(res);
    } catch (e: any) {
      setKeyTestResult({ success: false, error: e.message || '网络探测异常' });
    } finally {
      setIsTestingKey(false);
    }
  };

  const filteredKeys = safeKeys.filter(k => {
    if (providerFilter !== 'all' && k.providerId !== providerFilter) return false;
    if (statusFilter !== 'all' && k.status !== statusFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredKeys.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredKeys.length);
  const paginatedKeys = filteredKeys.slice(startIndex, endIndex);

  const openEditModal = (key: ApiKeyItem) => {
    setEditingKey(key);
    setEditForm({
      id: key.id,
      providerId: key.providerId,
      key: '', // leave empty by default, placeholder shows instructions
      maskedKey: key.maskedKey,
      label: key.label || '',
      weight: key.weight || 1,
      status: key.status || 'active'
    });
    setEditKeyTestResult(null);
    setIsEditModalOpen(true);
  };

  const handleTestEditKey = async () => {
    const keyToTest = editForm.key.trim() || editingKey?.key;
    if (!keyToTest) {
      alert('请先输入有效的 API Key 明文以供测试');
      return;
    }
    setIsTestingEditKey(true);
    setEditKeyTestResult(null);
    try {
      const res = await api.fetchUpstreamModels({
        providerId: editForm.providerId,
        apiKey: keyToTest
      });
      setEditKeyTestResult(res);
    } catch (e: any) {
      setEditKeyTestResult({ success: false, error: e.message || '网络探测异常' });
    } finally {
      setIsTestingEditKey(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKey) return;
    try {
      const updates: Partial<ApiKeyItem> = {
        providerId: editForm.providerId,
        label: editForm.label.trim() || undefined,
        weight: Math.max(1, Number(editForm.weight) || 1),
        status: editForm.status
      };
      if (editForm.key && editForm.key.trim()) {
        updates.key = editForm.key.trim();
      }
      await api.updateKey(editingKey.id, updates);
      setIsEditModalOpen(false);
      setEditingKey(null);
      onRefresh();
    } catch (e: any) {
      alert(e.message || '更新密钥失败');
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const handleToggleStatus = async (key: ApiKeyItem) => {
    const nextStatus = key.status === 'active' ? 'disabled' : 'active';
    try {
      await api.updateKey(key.id, { status: nextStatus });
      onRefresh();
    } catch (e: any) {
      alert(e.message || '更新状态失败');
    }
  };

  const handleDelete = async (key: ApiKeyItem) => {
    if (!confirm(`确定要移除密钥「${key.label || key.maskedKey}」吗？`)) return;
    try {
      await api.deleteKey(key.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message || '删除失败');
    }
  };

  const handleResetCooldown = async (key: ApiKeyItem) => {
    try {
      await api.updateKey(key.id, { status: 'active', lastError: undefined });
      onRefresh();
    } catch (e: any) {
      alert(e.message || '重置失败');
    }
  };

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleForm.key.trim()) return;
    try {
      await api.addKey({
        providerId: singleForm.providerId,
        key: singleForm.key.trim(),
        label: singleForm.label.trim() || undefined,
        weight: Number(singleForm.weight) || 1
      });

      // If user enabled syncing models and we got models from upstream probe
      if (syncToProvider && keyTestResult?.success && keyTestResult.models && keyTestResult.models.length > 0) {
        const targetProv = safeProviders.find(p => p.id === singleForm.providerId);
        if (targetProv) {
          const existingModels = Array.isArray(targetProv.models) ? targetProv.models : [];
          const merged = Array.from(new Set([...existingModels, ...keyTestResult.models]));
          await api.updateProvider(targetProv.id, { models: merged }).catch(() => {});
        }
      }

      setIsSingleModalOpen(false);
      setKeyTestResult(null);
      setSingleForm({ providerId: safeProviders[0]?.id || 'gemini', key: '', label: '', weight: 1 });
      onRefresh();
    } catch (e: any) {
      alert(e.message || '添加失败');
    }
  };

  const handleBatchAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = batchForm.rawKeys
      .split(/[\n,;]+/)
      .map(k => k.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      alert('请至少输入一个有效密钥');
      return;
    }

    try {
      const res = await api.batchAddKeys(batchForm.providerId, lines);
      alert(`已成功导入 ${res.addedCount} 个密钥`);
      setIsBatchModalOpen(false);
      setBatchForm({ providerId: providers[0]?.id || 'gemini', rawKeys: '' });
      onRefresh();
    } catch (e: any) {
      alert(e.message || '批量导入失败');
    }
  };

  const handleCheckAll = async () => {
    setIsCheckingAll(true);
    try {
      const providerParam = providerFilter === 'all' ? undefined : providerFilter;
      const res = await api.testAllKeys(providerParam);
      onRefresh();
      alert(`已完成 ${res.results.length} 个密钥健康检测`);
    } catch (e: any) {
      alert(e.message || '检测失败');
    } finally {
      setIsCheckingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            上游密钥池调度
          </h2>
          <p className="text-xs text-zinc-500">
            管理各厂商 API Key 轮询池、429 冷却队列与权重分配
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleCheckAll}
            disabled={isCheckingAll}
            className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isCheckingAll ? 'animate-spin' : ''}`} />
            <span>巡检</span>
          </button>
          <button
            onClick={() => setIsBatchModalOpen(true)}
            className="flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
            批量导入
          </button>
          <button
            onClick={() => setIsSingleModalOpen(true)}
            className="flex items-center px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 transition"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加密钥
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
        <div className="flex items-center space-x-1.5">
          <span className="text-zinc-500">厂商:</span>
          <select
            value={providerFilter}
            onChange={e => {
              setProviderFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 font-mono"
          >
            <option value="all">全部厂商 ({safeKeys.length})</option>
            {safeProviders.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({safeKeys.filter(k => k.providerId === p.id).length})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-1.5">
          <span className="text-zinc-500">状态:</span>
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 font-mono"
          >
            <option value="all">全部状态</option>
            <option value="active">正常活跃</option>
            <option value="rate_limited">429 限流冷却中</option>
            <option value="invalid">失效</option>
            <option value="disabled">已禁用</option>
          </select>
        </div>
      </div>

      {/* Key List: Desktop Table + Mobile Cards */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {filteredKeys.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-400">当前筛选暂无密钥</div>
        ) : (
          <>
            {/* Desktop Table (Hidden on Mobile) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-50 dark:bg-zinc-950 text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="py-2.5 px-4">厂商</th>
                    <th className="py-2.5 px-4">密钥与标签</th>
                    <th className="py-2.5 px-4">状态</th>
                    <th className="py-2.5 px-4">权重</th>
                    <th className="py-2.5 px-4">成功 / 错误</th>
                    <th className="py-2.5 px-4">Tokens</th>
                    <th className="py-2.5 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-850 text-zinc-700 dark:text-zinc-300">
                  {paginatedKeys.map(k => {
                    const isCopied = copiedKeyId === k.id;
                    const prov = safeProviders.find(p => p.id === k.providerId);

                    return (
                      <tr key={k.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-850/50">
                        <td className="py-2.5 px-4 font-sans font-medium text-zinc-900 dark:text-zinc-100">
                          {prov?.name || k.providerId}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center space-x-2">
                            {k.label && <span className="font-sans text-zinc-900 dark:text-zinc-100 font-medium">{k.label}</span>}
                            <span className="text-zinc-400 select-all">{k.maskedKey}</span>
                            <button
                              onClick={() => handleCopy(k.id, k.key || k.maskedKey)}
                              className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                              title="复制密钥"
                            >
                              {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            k.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : k.status === 'rate_limited'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-red-500/10 text-red-600 dark:text-red-400'
                          }`}>
                            {k.status === 'active' ? '活跃' : k.status === 'rate_limited' ? '429 冷却' : k.status === 'disabled' ? '已禁用' : '失效'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-zinc-800 dark:text-zinc-200">{k.weight}</td>
                        <td className="py-2.5 px-4">
                          <span className="text-emerald-600 dark:text-emerald-400">{k.successCount || 0}</span>
                          <span className="text-zinc-400 mx-1">/</span>
                          <span className={(k.errorCount || 0) > 0 ? 'text-red-500' : 'text-zinc-400'}>{k.errorCount || 0}</span>
                        </td>
                        <td className="py-2.5 px-4 text-zinc-900 dark:text-zinc-100 font-semibold">
                          {(k.totalTokens || 0) > 0 ? k.totalTokens.toLocaleString() : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-right space-x-1.5 font-sans">
                          {k.status === 'rate_limited' && (
                            <button
                              onClick={() => handleResetCooldown(k)}
                              className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              恢复
                            </button>
                          )}
                          <button
                            onClick={() => openEditModal(k)}
                            className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition"
                            title="编辑密钥"
                          >
                            <Edit2 className="w-3.5 h-3.5 inline" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(k)}
                            className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                          >
                            {k.status === 'active' ? '禁用' : '启用'}
                          </button>
                          <button
                            onClick={() => handleDelete(k)}
                            className="p-1 text-zinc-400 hover:text-red-500 transition"
                            title="删除密钥"
                          >
                            <Trash2 className="w-3.5 h-3.5 inline" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List (Visible only on Mobile) */}
            <div className="block md:hidden divide-y divide-zinc-100 dark:divide-zinc-850">
              {paginatedKeys.map(k => {
                const isCopied = copiedKeyId === k.id;
                const prov = safeProviders.find(p => p.id === k.providerId);

                return (
                  <div key={k.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                          {prov?.name || k.providerId}
                        </span>
                        {k.label && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            {k.label}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <span className="text-[10px] font-mono px-1 py-0.2 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold">
                          权重:{k.weight || 1}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          k.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : k.status === 'rate_limited'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'bg-red-500/10 text-red-600 dark:text-red-400'
                        }`}>
                          {k.status === 'active' ? '活跃' : k.status === 'rate_limited' ? '429 冷却' : k.status === 'disabled' ? '已禁用' : '失效'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-950 p-2 rounded-lg border border-zinc-200/60 dark:border-zinc-800/60 text-xs font-mono">
                      <span className="text-zinc-700 dark:text-zinc-300 truncate select-all">{k.maskedKey}</span>
                      <button
                        onClick={() => handleCopy(k.id, k.key || k.maskedKey)}
                        className="ml-2 p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-500 pt-1">
                      <div>成功/错误: <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{k.successCount || 0}</span> / <span className={(k.errorCount || 0) > 0 ? 'text-red-500 font-semibold' : 'text-zinc-400'}>{k.errorCount || 0}</span></div>
                      <div className="text-right">Tokens: <span className="text-zinc-900 dark:text-zinc-100 font-semibold">{(k.totalTokens || 0) > 0 ? k.totalTokens.toLocaleString() : '-'}</span></div>
                    </div>

                    <div className="flex items-center justify-end space-x-2 pt-2 border-t border-zinc-100 dark:border-zinc-850/60 text-xs">
                      {k.status === 'rate_limited' && (
                        <button
                          onClick={() => handleResetCooldown(k)}
                          className="px-2 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px]"
                        >
                          恢复
                        </button>
                      )}
                      <button
                        onClick={() => openEditModal(k)}
                        className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 flex items-center space-x-1"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>编辑</span>
                      </button>
                      <button
                        onClick={() => handleToggleStatus(k)}
                        className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400"
                      >
                        {k.status === 'active' ? '禁用' : '启用'}
                      </button>
                      <button
                        onClick={() => handleDelete(k)}
                        className="p-1 text-zinc-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Pagination Controls */}
      {filteredKeys.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-zinc-500">
          <div className="flex items-center space-x-2">
            <span>
              显示 {filteredKeys.length > 0 ? startIndex + 1 : 0} - {endIndex} 项，共 {filteredKeys.length} 个密钥
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">|</span>
            <div className="flex items-center space-x-1">
              <span>每页</span>
              <select
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 font-mono text-xs"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span>项</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={validCurrentPage <= 1}
              className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center"
              title="上一页"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-0.5" />
              <span>上一页</span>
            </button>

            <div className="flex items-center space-x-1 px-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
                Math.max(0, validCurrentPage - 3),
                Math.min(totalPages, validCurrentPage + 2)
              ).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-7 h-7 rounded-lg text-xs font-mono transition ${
                    validCurrentPage === page
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={validCurrentPage >= totalPages}
              className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center"
              title="下一页"
            >
              <span>下一页</span>
              <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </button>
          </div>
        </div>
      )}

      {/* Single Key Modal */}
      {isSingleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">添加单个 API 密钥</h3>
              <button onClick={() => setIsSingleModalOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSingle} className="space-y-3 text-xs">
              <div>
                <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">所属厂商 *</label>
                <select
                  value={singleForm.providerId}
                  onChange={e => setSingleForm({ ...singleForm, providerId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                >
                  {safeProviders.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium">API Key 明文 *</label>
                  <button
                    type="button"
                    onClick={handleTestAndFetchModels}
                    disabled={isTestingKey || !singleForm.key.trim()}
                    className="text-[11px] text-zinc-900 dark:text-zinc-100 hover:underline flex items-center space-x-1 disabled:opacity-40 cursor-pointer"
                  >
                    {isTestingKey ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>探测中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span>测试并获取可用模型</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  type="password"
                  required
                  placeholder="sk-... 或 AIzaSy..."
                  value={singleForm.key}
                  onChange={e => setSingleForm({ ...singleForm, key: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                />

                {/* Key Test / Upstream Probe Result */}
                {keyTestResult && (
                  <div className={`mt-2 p-2.5 rounded-lg text-[11px] border ${
                    keyTestResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                  }`}>
                    {keyTestResult.success ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between font-medium">
                          <div className="flex items-center space-x-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span>连通正常 · 获取到 {keyTestResult.models?.length || 0} 个上游可用模型</span>
                          </div>
                          <span className="text-[10px] text-zinc-400 font-mono">{keyTestResult.latencyMs || 0}ms</span>
                        </div>

                        {keyTestResult.models && keyTestResult.models.length > 0 && (
                          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pt-1">
                            {keyTestResult.models.slice(0, 10).map(m => (
                              <span key={m} className="px-1.5 py-0.2 rounded bg-white/60 dark:bg-zinc-900/60 font-mono text-[10px]">
                                {m}
                              </span>
                            ))}
                            {keyTestResult.models.length > 10 && (
                              <span className="text-[10px] text-zinc-400 self-center">
                                +{keyTestResult.models.length - 10} 更多
                              </span>
                            )}
                          </div>
                        )}

                        <label className="flex items-center space-x-1.5 pt-1 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={syncToProvider}
                            onChange={e => setSyncToProvider(e.target.checked)}
                            className="rounded border-zinc-300 text-zinc-900 focus:ring-0"
                          />
                          <span>保存时自动将这些模型同步至厂商模型库</span>
                        </label>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span>{keyTestResult.error || '连通失败，请检查 Key 或网络'}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">标签备注</label>
                  <input
                    type="text"
                    placeholder="如: 个人主账号"
                    value={singleForm.label}
                    onChange={e => setSingleForm({ ...singleForm, label: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">调度权重 (Weight) *</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={singleForm.weight}
                    onChange={e => setSingleForm({ ...singleForm, weight: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsSingleModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-zinc-500"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Keys Modal */}
      {isBatchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">批量导入 API 密钥</h3>
              <button onClick={() => setIsBatchModalOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBatchAdd} className="space-y-3 text-xs">
              <div>
                <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">目标厂商 *</label>
                <select
                  value={batchForm.providerId}
                  onChange={e => setBatchForm({ ...batchForm, providerId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                >
                  {safeProviders.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">密钥列表 (一行一个) *</label>
                <textarea
                  rows={5}
                  required
                  placeholder="key-1...&#10;key-2...&#10;key-3..."
                  value={batchForm.rawKeys}
                  onChange={e => setBatchForm({ ...batchForm, rawKeys: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-zinc-500"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold"
                >
                  开始导入
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Key Modal */}
      {isEditModalOpen && editingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100">
                  <Edit2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">编辑 API 密钥</h3>
                  <p className="text-[10px] text-zinc-400 font-mono truncate max-w-[200px]">{editingKey.maskedKey}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingKey(null);
                }}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">所属厂商 *</label>
                  <select
                    value={editForm.providerId}
                    onChange={e => setEditForm({ ...editForm, providerId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                  >
                    {safeProviders.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">密钥状态 *</label>
                  <select
                    value={editForm.status}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                  >
                    <option value="active">正常活跃 (Active)</option>
                    <option value="disabled">已禁用 (Disabled)</option>
                    <option value="rate_limited">429 限流冷却 (Rate Limited)</option>
                    <option value="invalid">失效异常 (Invalid)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">标签备注</label>
                <input
                  type="text"
                  placeholder="如: 主力账号、应急备用 Key"
                  value={editForm.label}
                  onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* Weight Setting */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium">调度权重 (Weight) *</label>
                  <span className="text-[10px] text-zinc-400 font-mono">当前数值: {editForm.weight}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={editForm.weight}
                    onChange={e => setEditForm({ ...editForm, weight: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-28 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                  />
                  <div className="flex-1 text-[11px] text-zinc-500 leading-tight">
                    在厂商策略为「基于权重分流」时生效，权重占总权重的比例即为该 Key 分担流量的概率。
                  </div>
                </div>
              </div>

              {/* API Key Edit (optional update) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium">更新 API Key 明文 (选填)</label>
                  <button
                    type="button"
                    onClick={handleTestEditKey}
                    disabled={isTestingEditKey || (!editForm.key.trim() && !editingKey.key)}
                    className="text-[11px] text-zinc-900 dark:text-zinc-100 hover:underline flex items-center space-x-1 disabled:opacity-40 cursor-pointer"
                  >
                    {isTestingEditKey ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>测试中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span>连通性探测</span>
                      </>
                    )}
                  </button>
                </div>
                <input
                  type="password"
                  placeholder="留空则保持原 Key 不变，输入新 Key 则覆盖更新"
                  value={editForm.key}
                  onChange={e => setEditForm({ ...editForm, key: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                />
                <span className="text-[10px] text-zinc-400 mt-1 block">
                  当前掩码: <span className="font-mono text-zinc-600 dark:text-zinc-300">{editingKey.maskedKey}</span>
                </span>

                {/* Test Result Display */}
                {editKeyTestResult && (
                  <div className={`mt-2 p-2.5 rounded-lg text-[11px] border ${
                    editKeyTestResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                  }`}>
                    {editKeyTestResult.success ? (
                      <div className="flex items-center justify-between font-medium">
                        <div className="flex items-center space-x-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span>连通正常 · 获取到 {editKeyTestResult.models?.length || 0} 个可用模型</span>
                        </div>
                        <span className="text-[10px] font-mono">{editKeyTestResult.latencyMs || 0}ms</span>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span>{editKeyTestResult.error || '连通失败，请检查密钥'}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Readonly Metrics summary */}
              <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/60 dark:border-zinc-800/60 grid grid-cols-3 gap-2 text-center text-[10px] font-mono text-zinc-500">
                <div>
                  <div className="text-zinc-400">总调用</div>
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200 mt-0.5">{editingKey.totalRequests || 0}</div>
                </div>
                <div>
                  <div className="text-zinc-400">累计 Tokens</div>
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200 mt-0.5">{(editingKey.totalTokens || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-zinc-400">成功 / 错误</div>
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200 mt-0.5">
                    <span className="text-emerald-600 dark:text-emerald-400">{editingKey.successCount || 0}</span> / <span className={(editingKey.errorCount || 0) > 0 ? 'text-red-500' : ''}>{editingKey.errorCount || 0}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingKey(null);
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold"
                >
                  保存更新
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
