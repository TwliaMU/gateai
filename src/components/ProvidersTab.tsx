import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Settings,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Play,
  X,
  Sparkles,
  RefreshCw,
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Info
} from 'lucide-react';
import type { ProviderConfig, LoadBalanceStrategy, AuthHeaderFormat, ApiKeyItem } from '../types/index.js';
import { api } from '../services/api.js';

interface ProvidersTabProps {
  providers: ProviderConfig[];
  keys?: ApiKeyItem[];
  onRefresh: () => void;
  onNavigateToKeys: (providerId: string) => void;
}

export const ProvidersTab: React.FC<ProvidersTabProps> = ({
  providers,
  keys = [],
  onRefresh,
  onNavigateToKeys
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  // Model discovery state in modal
  const [fetchKey, setFetchKey] = useState('');
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [fetchedModelsList, setFetchedModelsList] = useState<string[]>([]);
  const [fetchSuccessMsg, setFetchSuccessMsg] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    id: '',
    name: '',
    type: 'custom',
    baseUrl: 'https://api.openai.com/v1',
    authHeaderFormat: 'bearer' as AuthHeaderFormat,
    authHeaderName: '',
    models: 'default-model',
    loadBalanceStrategy: 'round-robin' as LoadBalanceStrategy,
    timeoutSeconds: 60,
    maxRetries: 3,
    description: '',
    mappingSource: '',
    mappingTarget: ''
  });

  const openCreateModal = () => {
    setEditingProvider(null);
    setFetchKey('');
    setFetchedModelsList([]);
    setFetchModelsError(null);
    setFetchSuccessMsg(null);
    setFormData({
      id: 'custom-' + Math.random().toString(36).substring(2, 7),
      name: '',
      type: 'custom',
      baseUrl: 'https://api.example.com/v1',
      authHeaderFormat: 'bearer',
      authHeaderName: '',
      models: 'gpt-4o, claude-3-5-sonnet',
      loadBalanceStrategy: 'round-robin',
      timeoutSeconds: 60,
      maxRetries: 3,
      description: '',
      mappingSource: '',
      mappingTarget: ''
    });
    setIsModalOpen(true);
  };

  const openEditModal = (p: ProviderConfig) => {
    setEditingProvider(p);
    setFetchKey('');
    setFetchedModelsList([]);
    setFetchModelsError(null);
    setFetchSuccessMsg(null);
    const mappings = p.modelMappings ? Object.entries(p.modelMappings) : [];
    const modelsList = Array.isArray(p.models)
      ? p.models.join(', ')
      : typeof (p as any).models === 'string'
      ? (p as any).models
      : '';
    setFormData({
      id: p.id,
      name: p.name,
      type: p.type,
      baseUrl: p.baseUrl,
      authHeaderFormat: p.authHeaderFormat,
      authHeaderName: p.authHeaderName || '',
      models: modelsList,
      loadBalanceStrategy: p.loadBalanceStrategy || 'round-robin',
      timeoutSeconds: p.timeoutSeconds || 60,
      maxRetries: p.maxRetries || 3,
      description: p.description || '',
      mappingSource: mappings[0]?.[0] || '',
      mappingTarget: mappings[0]?.[1] || ''
    });
    setIsModalOpen(true);
  };

  const handleFetchUpstreamModels = async () => {
    if (!fetchKey.trim()) {
      setFetchModelsError('请先填入该厂商的 API Key');
      return;
    }
    setIsFetchingModels(true);
    setFetchModelsError(null);
    setFetchSuccessMsg(null);
    try {
      const res = await api.fetchUpstreamModels({
        providerId: editingProvider?.id,
        type: formData.type,
        baseUrl: formData.baseUrl,
        apiKey: fetchKey.trim(),
        authHeaderFormat: formData.authHeaderFormat,
        authHeaderName: formData.authHeaderName
      });

      if (res.success && res.models && res.models.length > 0) {
        setFetchedModelsList(res.models);
        setFetchSuccessMsg(`成功获取 ${res.models.length} 个模型 (耗时 ${res.latencyMs || 0}ms)`);
      } else {
        setFetchModelsError(res.error || '未能从上游获取到模型列表');
      }
    } catch (e: any) {
      setFetchModelsError(e.message || '网络请求异常，无法拉取模型');
    } finally {
      setIsFetchingModels(false);
    }
  };

  const applyFetchedModels = (mode: 'replace' | 'append') => {
    if (fetchedModelsList.length === 0) return;
    if (mode === 'replace') {
      setFormData(prev => ({ ...prev, models: fetchedModelsList.join(', ') }));
    } else {
      const currentList = formData.models.split(',').map(s => s.trim()).filter(Boolean);
      const combined = Array.from(new Set([...currentList, ...fetchedModelsList]));
      setFormData(prev => ({ ...prev, models: combined.join(', ') }));
    }
  };

  const toggleModelChip = (m: string) => {
    const currentList = formData.models.split(',').map(s => s.trim()).filter(Boolean);
    if (currentList.includes(m)) {
      setFormData(prev => ({
        ...prev,
        models: currentList.filter(x => x !== m).join(', ')
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        models: [...currentList, m].join(', ')
      }));
    }
  };

  const handleToggleEnabled = async (p: ProviderConfig) => {
    try {
      await api.updateProvider(p.id, { enabled: !p.enabled });
      onRefresh();
    } catch (err: any) {
      alert(err.message || '更新失败');
    }
  };

  const handleDelete = async (p: ProviderConfig) => {
    if (!confirm(`确定要删除厂商「${p.name}」吗？`)) return;
    try {
      await api.deleteProvider(p.id);
      onRefresh();
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('请填写厂商名称');
      return;
    }
    if (!formData.baseUrl.trim()) {
      alert('请填写接口基地址 (Base URL)');
      return;
    }

    try {
      const modelsArr = formData.models
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const modelMappings: Record<string, string> = {};
      if (formData.mappingSource.trim() && formData.mappingTarget.trim()) {
        modelMappings[formData.mappingSource.trim()] = formData.mappingTarget.trim();
      }

      const generatedId = ('custom-' + Math.random().toString(36).substring(2, 8));
      const providerId = formData.id.trim() || generatedId;

      const payload: Partial<ProviderConfig> = {
        name: formData.name.trim(),
        type: (formData.type as any) || 'custom',
        baseUrl: formData.baseUrl.trim(),
        authHeaderFormat: formData.authHeaderFormat || 'bearer',
        authHeaderName: formData.authHeaderName.trim() || undefined,
        models: modelsArr.length > 0 ? modelsArr : ['default-model'],
        modelMappings,
        loadBalanceStrategy: formData.loadBalanceStrategy || 'round-robin',
        timeoutSeconds: Number(formData.timeoutSeconds) || 60,
        maxRetries: Number(formData.maxRetries) || 3,
        description: formData.description.trim() || undefined,
        isCustom: editingProvider ? editingProvider.isCustom : true
      };

      if (editingProvider) {
        await api.updateProvider(editingProvider.id, payload);
      } else {
        await api.createProvider({ ...payload, id: providerId });
      }

      setIsModalOpen(false);
      onRefresh();
    } catch (err: any) {
      const message = typeof err === 'string'
        ? err
        : err?.message || (typeof err?.error === 'string' ? err.error : err?.error?.message) || '保存失败，请检查填写内容';
      alert(message);
    }
  };

  const handleTestConnection = async (p: ProviderConfig) => {
    setTestingId(p.id);
    setTestResult(null);
    try {
      const res = await api.testProvider({
        providerId: p.id,
        baseUrl: p.baseUrl,
        authHeaderFormat: p.authHeaderFormat,
        authHeaderName: p.authHeaderName
      });
      setTestResult({
        id: p.id,
        success: res.success,
        message: res.message
      });
    } catch (e: any) {
      setTestResult({
        id: p.id,
        success: false,
        message: e.message || '连接失败'
      });
    } finally {
      setTestingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(providers.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, providers.length);
  const paginatedProviders = providers.slice(startIndex, endIndex);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            厂商连接与协议设置
          </h2>
          <p className="text-xs text-zinc-500">
            配置 OpenAI、Gemini、Claude、DeepSeek 或添加自定义私有 API 端点
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 transition self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          添加自定义厂商
        </button>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paginatedProviders.map(p => {
          const isTesting = testingId === p.id;
          const result = testResult?.id === p.id ? testResult : null;

          return (
            <div
              key={p.id}
              className={`p-4 rounded-xl border bg-white dark:bg-zinc-900 flex flex-col justify-between transition ${
                p.enabled
                  ? 'border-zinc-200 dark:border-zinc-800'
                  : 'border-zinc-200 dark:border-zinc-850 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{p.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-500">
                      {p.isCustom ? '自定义' : '内置'}
                    </span>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => handleToggleEnabled(p)}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4.5 bg-zinc-200 dark:bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-zinc-900 dark:peer-checked:bg-white after:shadow-xs"></div>
                  </label>
                </div>

                <div className="mt-2 text-xs font-mono text-zinc-500 truncate" title={p.baseUrl}>
                  {p.baseUrl}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-mono text-zinc-600 dark:text-zinc-400">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/80">
                    {p.authHeaderFormat}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800/80">
                    {p.loadBalanceStrategy === 'round-robin'
                      ? '轮询'
                      : p.loadBalanceStrategy === 'weighted'
                      ? '权重分流'
                      : p.loadBalanceStrategy === 'least-errors'
                      ? '最低错误优先'
                      : '随机抽样'}
                  </span>
                </div>

                {/* Models tags */}
                <div className="mt-3 flex flex-wrap gap-1">
                  {(Array.isArray(p.models) ? p.models : []).slice(0, 3).map(m => (
                    <span
                      key={m}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/60"
                    >
                      {m}
                    </span>
                  ))}
                  {(Array.isArray(p.models) ? p.models : []).length > 3 && (
                    <span className="text-[10px] text-zinc-400 font-mono px-1 py-0.5">
                      +{(Array.isArray(p.models) ? p.models : []).length - 3}
                    </span>
                  )}
                </div>

                {result && (
                  <div
                    className={`mt-3 p-2 rounded-lg text-xs flex items-center space-x-1.5 border ${
                      result.success
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}
                  >
                    {result.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate">{result.message}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleTestConnection(p)}
                    disabled={isTesting}
                    className="flex items-center px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300 text-[11px] transition"
                  >
                    <Play className={`w-3 h-3 mr-1 ${isTesting ? 'animate-spin' : ''}`} />
                    <span>{isTesting ? '探测中' : '连通测试'}</span>
                  </button>
                  <button
                    onClick={() => openEditModal(p)}
                    className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    title="编辑设置"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  {p.isCustom && (
                    <button
                      onClick={() => handleDelete(p)}
                      className="p-1 text-zinc-400 hover:text-red-500"
                      title="删除厂商"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => onNavigateToKeys(p.id)}
                  className="font-medium text-zinc-900 dark:text-zinc-200 hover:underline"
                >
                  配置密钥 &rarr;
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {providers.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-zinc-500">
          <div className="flex items-center space-x-2">
            <span>
              显示 {providers.length > 0 ? startIndex + 1 : 0} - {endIndex} 项，共 {providers.length} 个厂商
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
                <option value={3}>3</option>
                <option value={6}>6</option>
                <option value={12}>12</option>
                <option value={24}>24</option>
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
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
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

      {/* Edit / Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                {editingProvider ? `编辑厂商 - ${editingProvider.name}` : '添加自定义 API 厂商'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">厂商名称 *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="如: SiliconFlow"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500 font-sans"
                  />
                </div>
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">标识 (ID) *</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingProvider)}
                    value={formData.id}
                    onChange={e => setFormData({ ...formData, id: e.target.value })}
                    placeholder="如: siliconflow"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">接口基地址 (Base URL) *</label>
                <input
                  type="url"
                  required
                  value={formData.baseUrl}
                  onChange={e => setFormData({ ...formData, baseUrl: e.target.value })}
                  placeholder="https://api.siliconflow.cn/v1"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">认证格式</label>
                  <select
                    value={formData.authHeaderFormat}
                    onChange={e => setFormData({ ...formData, authHeaderFormat: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                  >
                    <option value="bearer">Bearer {'<key>'}</option>
                    <option value="x-api-key">x-api-key: {'<key>'}</option>
                    <option value="custom-header">自定义 Header 头</option>
                    <option value="query-param">URL 参数 ?key=</option>
                  </select>
                  {formData.authHeaderFormat === 'query-param' && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      警告：该方式会把完整 Key 放进 URL（?key=），可能被上游访问日志记录；仅用于确实只支持 URL 参数的厂商。重定向拦截已开启，不会把 Key 跟随跳转送到未校验地址。
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">负载调度策略</label>
                  <select
                    value={formData.loadBalanceStrategy}
                    onChange={e => setFormData({ ...formData, loadBalanceStrategy: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                  >
                    <option value="round-robin">轮询 (Round-Robin) · 基础负载均衡</option>
                    <option value="weighted">基于权重分流 (Weighted) · 权重分摊</option>
                    <option value="least-errors">错误率最低优先 (Least Errors)</option>
                    <option value="random">随机抽样 (Random)</option>
                  </select>
                </div>
              </div>

              {/* Strategy Explanation Callout */}
              {formData.loadBalanceStrategy === 'weighted' && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
                  <div className="font-semibold flex items-center space-x-1">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    <span>权重在何处设置？</span>
                  </div>
                  <p className="leading-relaxed">
                    权重在<strong>「密钥池」</strong>中为该厂商的各个 API Key 单独配置（每个 Key 均有权重数值）。在调度时，网关将根据池中各正常 Key 的权重比例进行概率抽样分流（例如 Key A 权重为 8，Key B 权重为 2，则 A 分担约 80% 流量）。
                  </p>
                </div>
              )}
              {formData.loadBalanceStrategy === 'round-robin' && (
                <div className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400 space-y-1">
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center space-x-1">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    <span>轮询是否就是负载均衡？</span>
                  </div>
                  <p className="leading-relaxed">
                    是的，<strong>轮询是负载均衡体系中最经典也是最常用的基础策略</strong>。每次请求依次均摊到池中处于正常活跃状态的 API Key 上，实现并发削峰与 429 智能容灾转移。
                  </p>
                </div>
              )}

              {/* Upstream Models Discovery Tool */}
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-zinc-900 dark:text-zinc-100 font-medium">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>自动获取上游可用模型</span>
                  </div>
                  <span className="text-[10px] text-zinc-400">填入 API Key 自动探测</span>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="password"
                      value={fetchKey}
                      onChange={e => setFetchKey(e.target.value)}
                      placeholder="填入该厂商的 API Key (sk-... / AIza...)"
                      className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono text-[11px] focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleFetchUpstreamModels}
                    disabled={isFetchingModels || !fetchKey.trim()}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-medium text-xs flex items-center space-x-1.5 disabled:opacity-50 shrink-0 transition-all cursor-pointer"
                  >
                    {isFetchingModels ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>探测中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 dark:text-amber-600" />
                        <span>获取模型</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Quick key selector if pool has keys for this provider */}
                {editingProvider && keys.filter(k => k.providerId === editingProvider.id && k.key).length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-zinc-500">
                    <span>快捷选择已有密钥:</span>
                    {keys.filter(k => k.providerId === editingProvider.id && k.key).slice(0, 3).map(k => (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() => {
                          if (k.key) setFetchKey(k.key);
                        }}
                        className="px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                      >
                        {k.label || k.maskedKey}
                      </button>
                    ))}
                  </div>
                )}

                {/* Feedback Message */}
                {fetchSuccessMsg && (
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{fetchSuccessMsg}</span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => applyFetchedModels('replace')}
                        className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium text-[10px]"
                      >
                        一键覆盖
                      </button>
                      <button
                        type="button"
                        onClick={() => applyFetchedModels('append')}
                        className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/30 font-medium text-[10px]"
                      >
                        追加未有
                      </button>
                    </div>
                  </div>
                )}

                {fetchModelsError && (
                  <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-[11px] flex items-center space-x-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{fetchModelsError}</span>
                  </div>
                )}

                {/* Fetched models interactive chips */}
                {fetchedModelsList.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[10px] text-zinc-400">
                      <span>点击模型标签可快速添加/移除 (已选中的模型将高亮):</span>
                      <span>共 {fetchedModelsList.length} 个模型</span>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800/60">
                      {fetchedModelsList.map(m => {
                        const isSelected = formData.models.split(',').map(s => s.trim()).includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleModelChip(m)}
                            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all ${
                              isSelected
                                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-medium shadow-xs'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                          >
                            {isSelected ? `✓ ${m}` : `+ ${m}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">支持模型列表 (逗号分隔) *</label>
                <input
                  type="text"
                  required
                  value={formData.models}
                  onChange={e => setFormData({ ...formData, models: e.target.value })}
                  placeholder="deepseek-ai/DeepSeek-V3, deepseek-ai/DeepSeek-R1"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
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
    </div>
  );
};
