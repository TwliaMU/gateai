import React, { useState, useMemo } from 'react';
import {
  Shield,
  Plus,
  Copy,
  Check,
  Trash2,
  Code,
  X,
  Edit3,
  Globe,
  Sparkles,
  Layers,
  Search,
  Cpu,
  Terminal,
  CheckSquare,
  Square,
  ChevronDown,
  Info
} from 'lucide-react';
import type { ClientToken, ProviderConfig } from '../types/index.js';
import { api } from '../services/api.js';

interface ClientsTabProps {
  clients: ClientToken[];
  providers: ProviderConfig[];
  onRefresh: () => void;
}

export const ClientsTab: React.FC<ClientsTabProps> = ({ clients, providers, onRefresh }) => {
  const safeClients = Array.isArray(clients) ? clients : [];
  const safeProviders = Array.isArray(providers) ? providers : [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientToken | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedModelList, setCopiedModelList] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [selectedClientForGuide, setSelectedClientForGuide] = useState<ClientToken | null>(null);

  // Modal Form State
  const [formName, setFormName] = useState('');
  const [formToken, setFormToken] = useState('');
  const [formRpmLimit, setFormRpmLimit] = useState<number>(60);
  const [formQuotaTokens, setFormQuotaTokens] = useState<number>(500000);
  const [formQuotaRequests, setFormQuotaRequests] = useState<number>(1000);
  
  // Model selection mode: 'all' (wildcard '*') vs 'custom' (explicit list)
  const [modelMode, setModelMode] = useState<'all' | 'custom'>('all');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [customModelInput, setCustomModelInput] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');

  const baseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/v1`
    : 'https://your-domain.workers.dev/v1';

  // Extract all available models across upstream providers with provider metadata
  const upstreamModelInfoList = useMemo(() => {
    const list: Array<{
      model: string;
      providerId: string;
      providerName: string;
      providerType: string;
    }> = [];
    const seen = new Set<string>();

    for (const p of safeProviders.filter(p => p && p.enabled)) {
      const pModels = Array.isArray(p.models) ? p.models : [];
      for (const m of pModels) {
        if (m && typeof m === 'string' && !seen.has(m)) {
          seen.add(m);
          list.push({
            model: m,
            providerId: p.id,
            providerName: p.name,
            providerType: p.type
          });
        }
      }
      if (p.modelMappings) {
        for (const alias of Object.keys(p.modelMappings)) {
          if (alias && !seen.has(alias)) {
            seen.add(alias);
            list.push({
              model: alias,
              providerId: p.id,
              providerName: p.name,
              providerType: p.type
            });
          }
        }
      }
    }

    // Default fallback models if no providers configured yet
    if (list.length === 0) {
      const defaults = [
        { model: 'gemini-2.5-flash', providerId: 'gemini', providerName: 'Google Gemini', providerType: 'gemini' },
        { model: 'gemini-2.5-pro', providerId: 'gemini', providerName: 'Google Gemini', providerType: 'gemini' },
        { model: 'gpt-4o', providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
        { model: 'gpt-4o-mini', providerId: 'openai', providerName: 'OpenAI', providerType: 'openai' },
        { model: 'claude-3-5-sonnet', providerId: 'anthropic', providerName: 'Anthropic Claude', providerType: 'anthropic' },
        { model: 'deepseek-chat', providerId: 'deepseek', providerName: 'DeepSeek', providerType: 'deepseek' }
      ];
      list.push(...defaults);
    }

    return list;
  }, [safeProviders]);

  const allAvailableModelNames = useMemo(() => upstreamModelInfoList.map(item => item.model), [upstreamModelInfoList]);

  // Filtered models in modal based on search & provider filter
  const filteredModelItems = useMemo(() => {
    return upstreamModelInfoList.filter(item => {
      const matchesSearch = !modelSearchQuery.trim() || 
        item.model.toLowerCase().includes(modelSearchQuery.toLowerCase().trim()) ||
        item.providerName.toLowerCase().includes(modelSearchQuery.toLowerCase().trim());
      const matchesProvider = providerFilter === 'all' || item.providerId === providerFilter;
      return matchesSearch && matchesProvider;
    });
  }, [upstreamModelInfoList, modelSearchQuery, providerFilter]);

  const openCreateModal = () => {
    setEditingClient(null);
    setFormName('客户端令牌 ' + (safeClients.length + 1));
    setFormToken('sk-gw-' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10));
    setFormRpmLimit(60);
    setFormQuotaTokens(500000);
    setFormQuotaRequests(1000);
    setModelMode('all');
    setSelectedModels([]);
    setModelSearchQuery('');
    setProviderFilter('all');
    setCustomModelInput('');
    setIsModalOpen(true);
  };

  const openEditModal = (client: ClientToken) => {
    setEditingClient(client);
    setFormName(client.name || '');
    setFormToken(client.token || (client as any).tokenPrefix || '');
    setFormRpmLimit(Number(client.rpmLimit || 0));
    setFormQuotaTokens(Number(client.quotaLimitTokens || 0));
    setFormQuotaRequests(Number(client.quotaLimitRequests || 0));
    
    const clientAllowed = Array.isArray(client.allowedModels) ? client.allowedModels : ['*'];
    if (clientAllowed.includes('*') || clientAllowed.length === 0) {
      setModelMode('all');
      setSelectedModels([]);
    } else {
      setModelMode('custom');
      setSelectedModels([...clientAllowed]);
    }

    setModelSearchQuery('');
    setProviderFilter('all');
    setCustomModelInput('');
    setIsModalOpen(true);
  };

  const handleCopy = (id: string, token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedTokenId(id);
    setTimeout(() => setCopiedTokenId(null), 2000);
  };

  const handleToggleStatus = async (c: ClientToken) => {
    const nextStatus = c.status === 'active' ? 'revoked' : 'active';
    try {
      await api.updateClient(c.id, { status: nextStatus });
      onRefresh();
    } catch (e: any) {
      alert(e.message || '更新状态失败');
    }
  };

  const handleDelete = async (c: ClientToken) => {
    if (!confirm(`确定要移除客户端令牌「${c.name}」吗？`)) return;
    try {
      await api.deleteClient(c.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message || '删除失败');
    }
  };

  const toggleModelSelection = (modelName: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelName)) {
        return prev.filter(m => m !== modelName);
      } else {
        return [...prev, modelName];
      }
    });
  };

  const selectAllUpstreamModels = () => {
    setSelectedModels(Array.from(new Set([...selectedModels, ...allAvailableModelNames])));
  };

  const selectProviderModels = (providerId: string) => {
    const pModels = upstreamModelInfoList.filter(item => item.providerId === providerId).map(i => i.model);
    setSelectedModels(prev => Array.from(new Set([...prev, ...pModels])));
  };

  const clearAllSelectedModels = () => {
    setSelectedModels([]);
  };

  const addCustomModel = () => {
    const trimmed = customModelInput.trim();
    if (!trimmed) return;
    if (!selectedModels.includes(trimmed)) {
      setSelectedModels(prev => [...prev, trimmed]);
    }
    setCustomModelInput('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formToken.trim()) {
      alert('请填写客户端名称与令牌');
      return;
    }

    let finalAllowedModels: string[] = ['*'];
    if (modelMode === 'custom') {
      if (selectedModels.length === 0) {
        alert('请至少勾选一个授权可用的模型，或切换为「全部模型 (*)」');
        return;
      }
      finalAllowedModels = selectedModels;
    }

    try {
      const payload = {
        name: formName.trim(),
        token: formToken.trim(),
        rpmLimit: Number(formRpmLimit),
        quotaLimitTokens: Number(formQuotaTokens),
        quotaLimitRequests: Number(formQuotaRequests),
        allowedProviders: ['*'],
        allowedModels: finalAllowedModels
      };

      if (editingClient) {
        await api.updateClient(editingClient.id, payload);
      } else {
        await api.addClient(payload);
      }

      setIsModalOpen(false);
      onRefresh();
    } catch (e: any) {
      alert(e.message || '保存失败');
    }
  };

  const openGuide = (c: ClientToken) => {
    setSelectedClientForGuide(c);
    setIsGuideOpen(true);
  };

  // Helper to get allowed models for a given client
  const getClientAllowedModels = (c: ClientToken): string[] => {
    if (!c.allowedModels || c.allowedModels.length === 0 || c.allowedModels.includes('*')) {
      return allAvailableModelNames;
    }
    return c.allowedModels;
  };

  const getProviderBadgeColor = (type: string) => {
    switch (type) {
      case 'gemini':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900/50';
      case 'openai':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50';
      case 'anthropic':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900/50';
      case 'deepseek':
        return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-900/50';
      case 'groq':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900/50';
      default:
        return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" />
            下游客户端令牌与模型权限
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            为第三方软件或团队分配专属访问密钥 (sk-gw-...)，从上游厂商中精准勾选开放的模型权限与速率配额
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="flex items-center px-3.5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 shadow-xs transition self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          创建客户端令牌
        </button>
      </div>

      {/* Client Tokens Grid */}
      {safeClients.length === 0 ? (
        <div className="p-12 text-center text-xs text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl bg-zinc-50/50 dark:bg-zinc-950/50">
          <Shield className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
          <p className="font-medium text-zinc-600 dark:text-zinc-400">暂无客户端令牌</p>
          <p className="text-zinc-400 text-[11px] mt-1">点击右上角按钮创建第一个客户端令牌，并配置可调用的上游模型</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {safeClients.map(c => {
            const isCopied = copiedTokenId === c.id;
            const tokenStr = c.token || (c as any).tokenPrefix || '';
            const displayToken = tokenStr.length > 20
              ? `${tokenStr.slice(0, 10)}...${tokenStr.slice(-6)}`
              : (tokenStr || 'sk-gw-***');
            const usedTokens = Number(c.quotaUsedTokens || 0);
            const limitTokens = Number(c.quotaLimitTokens || 0);
            const rpm = Number(c.rpmLimit || 0);
            const isWildcard = !c.allowedModels || c.allowedModels.length === 0 || c.allowedModels.includes('*');
            const allowedList = c.allowedModels || ['*'];

            return (
              <div
                key={c.id}
                className={`p-4 rounded-2xl border bg-white dark:bg-zinc-900 flex flex-col justify-between transition shadow-xs ${
                  c.status === 'active'
                    ? 'border-zinc-200/80 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    : 'border-zinc-200 dark:border-zinc-850 opacity-65'
                }`}
              >
                <div>
                  {/* Title & Status */}
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate pr-2">
                      {c.name || '未命名客户端'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                      c.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
                    }`}>
                      {c.status === 'active' ? '正常授权' : '已吊销'}
                    </span>
                  </div>

                  {/* Token Key Box */}
                  <div className="mt-2.5 flex items-center justify-between bg-zinc-50 dark:bg-zinc-950 px-3 py-2 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60">
                    <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200 truncate select-all">
                      {displayToken}
                    </span>
                    <button
                      onClick={() => handleCopy(c.id, tokenStr)}
                      className="ml-2 p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition shrink-0"
                      title="复制完整 Token"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Allowed Models Badge & List */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className="text-zinc-500 font-medium flex items-center gap-1">
                        <Cpu className="w-3 h-3 text-zinc-400" />
                        提供下游可用模型:
                      </span>
                      {isWildcard ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                          <Globe className="w-2.5 h-2.5 mr-1" />
                          全部上游模型 (*)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <Shield className="w-2.5 h-2.5 mr-1" />
                          已限制 {allowedList.length} 个模型
                        </span>
                      )}
                    </div>

                    {/* Chips Preview */}
                    <div className="flex flex-wrap gap-1.5">
                      {isWildcard ? (
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                          包含网关接入的全部厂商模型（下游 GET /v1/models 可见全部）
                        </span>
                      ) : (
                        <>
                          {allowedList.slice(0, 4).map(m => (
                            <span
                              key={m}
                              className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                            >
                              {m}
                            </span>
                          ))}
                          {allowedList.length > 4 && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                              +{allowedList.length - 4} 更多
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quotas & RPM */}
                  <div className="mt-3.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 text-xs space-y-1.5 text-zinc-600 dark:text-zinc-400">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">已用 Tokens:</span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100 font-medium">
                        {usedTokens.toLocaleString()} / {limitTokens > 0 ? limitTokens.toLocaleString() : '无限制'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">速率限制:</span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100 font-medium">
                        {rpm > 0 ? `${rpm} RPM` : '无限制'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => openGuide(c)}
                      className="flex items-center px-2 py-1 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium transition"
                    >
                      <Code className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                      <span>接入指引</span>
                    </button>
                    <button
                      onClick={() => openEditModal(c)}
                      className="flex items-center px-2 py-1 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium transition"
                    >
                      <Edit3 className="w-3.5 h-3.5 mr-1 text-blue-500" />
                      <span>编辑 / 模型权限</span>
                    </button>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => handleToggleStatus(c)}
                      className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                    >
                      {c.status === 'active' ? '吊销' : '启用'}
                    </button>
                    <button
                      onClick={() => handleDelete(c)}
                      className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition"
                      title="删除令牌"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal with Advanced Model Selector */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  {editingClient ? '编辑客户端令牌与可用模型' : '创建客户端访问令牌'}
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  配置令牌基本参数及向下游客户端开放的上游可用模型
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              {/* Basic Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">客户端名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="如: NextChat 网页端 / Cherry Studio"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-500 transition"
                  />
                </div>

                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">访问令牌 (Token Key) *</label>
                  <input
                    type="text"
                    required
                    placeholder="sk-gw-..."
                    value={formToken}
                    onChange={e => setFormToken(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 transition"
                  />
                </div>
              </div>

              {/* Rate Limit & Quotas */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/80 dark:border-zinc-800">
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">
                    RPM 速率限制 (0 为不限)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formRpmLimit}
                    onChange={e => setFormRpmLimit(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono"
                  />
                </div>
                <div>
                  <label className="text-zinc-700 dark:text-zinc-300 font-medium block mb-1">
                    Token 配额 (0 为不限)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formQuotaTokens}
                    onChange={e => setFormQuotaTokens(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono"
                  />
                </div>
              </div>

              {/* Upstream Model Selection Section */}
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/80 dark:border-zinc-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    设置可用的模型 (提供给下游使用并显示)
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    下游 GET /v1/models 仅返回已授权模型
                  </span>
                </div>

                {/* Mode Selector */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModelMode('all')}
                    className={`flex items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition ${
                      modelMode === 'all'
                        ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white shadow-xs'
                        : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5 mr-1.5" />
                    全部模型 (* 通配符)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setModelMode('custom');
                      if (selectedModels.length === 0) {
                        setSelectedModels(allAvailableModelNames.slice(0, 3));
                      }
                    }}
                    className={`flex items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition ${
                      modelMode === 'custom'
                        ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white shadow-xs'
                        : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5 mr-1.5" />
                    从上游厂商勾选指定模型
                  </button>
                </div>

                {/* Custom Model Picker Box */}
                {modelMode === 'custom' && (
                  <div className="space-y-3 pt-2">
                    {/* Quick Action Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-zinc-200/60 dark:border-zinc-800/60">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={selectAllUpstreamModels}
                          className="px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 text-[11px] font-medium transition"
                        >
                          全选全部上游 ({allAvailableModelNames.length})
                        </button>
                        <button
                          type="button"
                          onClick={clearAllSelectedModels}
                          className="px-2 py-1 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 text-[11px] transition"
                        >
                          清空所选
                        </button>
                      </div>

                      {/* Select by Provider shortcuts */}
                      <div className="flex flex-wrap items-center gap-1">
                        {safeProviders.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectProviderModels(p.id)}
                            className="px-2 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition"
                            title={`快速添加 ${p.name} 的所有可用模型`}
                          >
                            +{p.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Search and Provider Filter */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="搜索厂商或模型名 (如 gemini, gpt, claude, deepseek)..."
                          value={modelSearchQuery}
                          onChange={e => setModelSearchQuery(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-xs focus:outline-none"
                        />
                      </div>

                      <select
                        value={providerFilter}
                        onChange={e => setProviderFilter(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs"
                      >
                        <option value="all">全部厂商</option>
                        {safeProviders.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Models List / Checkbox Grid */}
                    <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                      {filteredModelItems.length === 0 ? (
                        <div className="text-center py-4 text-zinc-400 text-xs">
                          没有找到匹配的模型
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {filteredModelItems.map(item => {
                            const isSelected = selectedModels.includes(item.model);
                            return (
                              <div
                                key={item.model}
                                onClick={() => toggleModelSelection(item.model)}
                                className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer select-none transition ${
                                  isSelected
                                    ? 'bg-zinc-900/5 dark:bg-white/10 border-zinc-400 dark:border-zinc-600'
                                    : 'bg-zinc-50/50 dark:bg-zinc-950/40 border-zinc-200/70 dark:border-zinc-800/70 hover:border-zinc-300 dark:hover:border-zinc-700'
                                }`}
                              >
                                <div className="flex items-center space-x-2 truncate">
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                                  ) : (
                                    <Square className="w-4 h-4 text-zinc-400 shrink-0" />
                                  )}
                                  <span className="font-mono text-xs text-zinc-900 dark:text-zinc-100 truncate font-medium">
                                    {item.model}
                                  </span>
                                </div>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${getProviderBadgeColor(item.providerType)}`}>
                                  {item.providerName}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Add Custom Model Name Manually */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="手动添加未列出的模型标识 (如 custom-model-v1)..."
                        value={customModelInput}
                        onChange={e => setCustomModelInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addCustomModel();
                          }
                        }}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={addCustomModel}
                        disabled={!customModelInput.trim()}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium disabled:opacity-50 transition"
                      >
                        添加
                      </button>
                    </div>

                    {/* Selected Summary Tags */}
                    <div className="p-2.5 rounded-lg bg-zinc-100/80 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          已勾选 {selectedModels.length} 个模型 (将开放给下游):
                        </span>
                        {selectedModels.length > 0 && (
                          <span className="text-zinc-400 text-[10px]">点击标签可快速移除</span>
                        )}
                      </div>
                      {selectedModels.length === 0 ? (
                        <p className="text-amber-600 dark:text-amber-400 text-[11px]">
                          ⚠️ 未勾选任何模型，请在上方勾选或切换为「全部模型 (*)」
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                          {selectedModels.map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => toggleModelSelection(m)}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 hover:border-red-400 hover:text-red-500 transition group"
                            >
                              <span>{m}</span>
                              <X className="w-3 h-3 ml-1 text-zinc-400 group-hover:text-red-500" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-xs font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-xs transition shadow-sm"
                >
                  {editingClient ? '保存配置' : '创建令牌'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Guide Modal */}
      {isGuideOpen && selectedClientForGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Code className="w-4 h-4 text-emerald-500" />
                  下游接入与模型指引 - {selectedClientForGuide.name}
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  标准 OpenAI 兼容接口，可无缝对接各类客户端及 AI 应用
                </p>
              </div>
              <button
                onClick={() => setIsGuideOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Endpoint credentials */}
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 space-y-2.5 font-mono">
                <div>
                  <span className="text-zinc-500 font-sans block text-[11px] mb-0.5">API 接口地址 (Base URL):</span>
                  <div className="text-zinc-900 dark:text-zinc-100 font-semibold select-all bg-white dark:bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    {baseUrl}
                  </div>
                </div>
                <div>
                  <span className="text-zinc-500 font-sans block text-[11px] mb-0.5">API 密钥 (Token):</span>
                  <div className="text-zinc-900 dark:text-zinc-100 font-semibold select-all break-all bg-white dark:bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    {selectedClientForGuide.token || (selectedClientForGuide as any).tokenPrefix || 'sk-gw-***'}
                  </div>
                </div>
              </div>

              {/* Models provided by this token */}
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-850 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-blue-500" />
                    该令牌提供给下游可用的模型列表
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const models = getClientAllowedModels(selectedClientForGuide);
                      navigator.clipboard.writeText(models.join('\n'));
                      setCopiedModelList(true);
                      setTimeout(() => setCopiedModelList(false), 2000);
                    }}
                    className="flex items-center text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {copiedModelList ? <Check className="w-3 h-3 mr-1 text-emerald-500" /> : <Copy className="w-3 h-3 mr-1" />}
                    复制模型列表
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  {getClientAllowedModels(selectedClientForGuide).map(m => (
                    <span
                      key={m}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              {/* cURL Example */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400 font-medium flex items-center gap-1">
                    <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                    cURL 快速测试调用示例
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const sampleModel = getClientAllowedModels(selectedClientForGuide)[0] || 'gemini-2.5-flash';
                      const curl = `curl ${baseUrl}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${selectedClientForGuide.token || 'sk-gw-***'}" \\\n  -d '{\n    "model": "${sampleModel}",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`;
                      navigator.clipboard.writeText(curl);
                      setCopiedCurl(true);
                      setTimeout(() => setCopiedCurl(false), 2000);
                    }}
                    className="flex items-center text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                  >
                    {copiedCurl ? <Check className="w-3 h-3 mr-1 text-emerald-500" /> : <Copy className="w-3 h-3 mr-1" />}
                    复制 cURL
                  </button>
                </div>

                <pre className="p-3 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-[11px] overflow-x-auto leading-relaxed border border-zinc-800">
                  {`curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${selectedClientForGuide.token || 'sk-gw-***'}" \\
  -d '{
    "model": "${getClientAllowedModels(selectedClientForGuide)[0] || 'gemini-2.5-flash'}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
                </pre>
              </div>

              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-[11px] flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  在 NextChat、Cherry Studio、LobeChat、Cursor 等客户端中，将 API 域名设置为上述 Base URL 并填入该 Token，客户端刷新模型列表时即可获取在此设置的可用模型。
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setIsGuideOpen(false)}
                className="px-5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-xs transition"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
