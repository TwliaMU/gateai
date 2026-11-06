import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Send,
  Trash2,
  Sliders,
  User,
  Bot,
  Shield
} from 'lucide-react';
import type { ProviderConfig, ClientToken } from '../types/index.js';

interface PlaygroundTabProps {
  providers: ProviderConfig[];
  clients: ClientToken[];
  onRefresh: () => void;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const PlaygroundTab: React.FC<PlaygroundTabProps> = ({ providers, clients, onRefresh }) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '您好！我是多厂商负载均衡网关助手。您可以在此发送提示词测试不同厂商模型的流式响应。' }
  ]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [selectedToken, setSelectedToken] = useState<string>(clients[0]?.token || '');
  const [temperature, setTemperature] = useState(0.7);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastStats, setLastStats] = useState<{
    durationMs?: number;
    tokens?: number;
    model?: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const safeProviders = Array.isArray(providers) ? providers : [];
  const safeClients = Array.isArray(clients) ? clients : [];

  const allModels: string[] = [];
  for (const p of safeProviders.filter(p => p && p.enabled)) {
    const pModels = Array.isArray(p.models) ? p.models : [];
    for (const m of pModels) {
      if (m && typeof m === 'string' && !allModels.includes(m)) {
        allModels.push(m);
      }
    }
  }

  if (allModels.length === 0) {
    allModels.push('gemini-2.5-flash', 'gemini-2.5-pro', 'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet');
  }

  const currentClient = safeClients.find(c => c.token === selectedToken);
  const clientAllowedModels = useMemo(() => {
    if (!currentClient || !currentClient.allowedModels || currentClient.allowedModels.length === 0 || currentClient.allowedModels.includes('*')) {
      return allModels;
    }
    return currentClient.allowedModels;
  }, [currentClient, allModels]);

  useEffect(() => {
    if (clientAllowedModels.length > 0 && !clientAllowedModels.includes(selectedModel)) {
      setSelectedModel(clientAllowedModels[0]);
    }
  }, [clientAllowedModels, selectedModel]);

  useEffect(() => {
    if (!selectedToken && safeClients.length > 0) {
      setSelectedToken(safeClients[0]?.token || '');
    }
  }, [safeClients, selectedToken]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userText = input.trim();
    setInput('');

    const newMessages: Message[] = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);

    const assistantIndex = newMessages.length;
    setMessages([...newMessages, { role: 'assistant', content: '' }]);

    setIsStreaming(true);
    const startTime = Date.now();

    try {
      const adminToken = (typeof localStorage !== 'undefined' ? localStorage.getItem('admin-token') : '') || 'authenticated';
      const authToken = selectedToken || (safeClients[0] ? (safeClients[0].token || (safeClients[0] as any).tokenPrefix) : '') || 'sk-gw-admin-master';

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-Admin-Session': adminToken
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages,
          temperature,
          stream: true
        })
      });

      if (!res.ok) {
        const errorJson: any = await res.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || `HTTP ${res.status}: 请求失败`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const decoder = new TextDecoder('utf-8');
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              accumulated += delta;
              setMessages(prev => {
                const next = [...prev];
                next[assistantIndex] = { role: 'assistant', content: accumulated };
                return next;
              });
            }
          } catch {
            // ignore
          }
        }
      }

      const durationMs = Date.now() - startTime;
      setLastStats({
        durationMs,
        tokens: Math.ceil(accumulated.length / 3),
        model: selectedModel
      });
      onRefresh();
    } catch (err: any) {
      setMessages(prev => {
        const next = [...prev];
        next[assistantIndex] = {
          role: 'assistant',
          content: `⚠️ 请求异常: ${err.message || '未知错误'}`
        };
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const clearChat = () => {
    setMessages([
      { role: 'assistant', content: '对话已清空，请在下方输入内容测试。' }
    ]);
    setLastStats(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      {/* Chat Area */}
      <div className="lg:col-span-3 flex flex-col h-[480px] sm:h-[580px] lg:h-[650px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
        {/* Chat Header */}
        <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs bg-zinc-50 dark:bg-zinc-950">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">在线调试对话</span>
            <span className="font-mono text-zinc-500">[{selectedModel}]</span>
          </div>

          <button
            onClick={clearChat}
            className="flex items-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            清空
          </button>
        </div>

        {/* Message Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex items-start space-x-2.5 ${m.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}
            >
              <div
                className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-xs ${
                  m.role === 'user'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-950'
                    : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                {m.role === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
              </div>

              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-950'
                    : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap'
                }`}
              >
                {m.content || (isStreaming ? '...' : '')}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <form onSubmit={handleSend} className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center space-x-2 bg-zinc-50 dark:bg-zinc-950">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="输入测试提示词..."
            disabled={isStreaming}
            className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-zinc-500 text-xs"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-xs transition disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* Right Controls */}
      <div className="space-y-4 text-xs">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center">
            <Sliders className="w-3.5 h-3.5 mr-1 text-zinc-500" />
            调试选项
          </span>

          <div>
            <label className="text-zinc-500 block mb-1">授权凭证</label>
            <select
              value={selectedToken}
              onChange={e => setSelectedToken(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 font-mono truncate"
            >
              {safeClients.length === 0 ? (
                <option value="sk-gw-admin">默认管理员令牌 (sk-gw-admin)</option>
              ) : (
                safeClients.map(c => (
                  <option key={c.id} value={c.token}>
                    {c.name} {(!c.allowedModels || c.allowedModels.includes('*')) ? '(全部模型)' : `(${c.allowedModels.length} 个模型)`}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-zinc-500">测试模型</label>
              {currentClient && currentClient.allowedModels && !currentClient.allowedModels.includes('*') && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center font-medium">
                  <Shield className="w-2.5 h-2.5 mr-0.5" />
                  已限制 {currentClient.allowedModels.length} 个
                </span>
              )}
            </div>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 font-mono"
            >
              {clientAllowedModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex justify-between text-zinc-500 mb-1">
              <span>温度 (Temperature):</span>
              <span className="font-mono text-zinc-800 dark:text-zinc-200">{temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.1"
              value={temperature}
              onChange={e => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-zinc-900 dark:accent-white"
            />
          </div>
        </div>

        {lastStats && (
          <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-1.5">
            <span className="text-[11px] text-zinc-500 uppercase tracking-wider block">调用耗时与用量</span>
            <div className="flex justify-between font-mono">
              <span className="text-zinc-500">耗时:</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{lastStats.durationMs}ms</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-zinc-500">预估 Tokens:</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{lastStats.tokens}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
