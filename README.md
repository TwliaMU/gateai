# GateAI

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20Workers%20%2B%20Durable%20Objects-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![SQLite](https://img.shields.io/badge/Storage-Durable%20Objects%20SQLite-blue?logo=sqlite)](https://developers.cloudflare.com/durable-objects/)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-green)](https://platform.openai.com/docs/api-reference)

多厂商 AI 负载均衡网关，采用 **Cloudflare Pages + Workers + Durable Objects (SQLite)** 作为生产架构。

统一聚合 Google Gemini、OpenAI、Anthropic Claude、DeepSeek、Groq、xAI Grok、Mistral AI、Cohere、OpenRouter 共 9 家厂商（`/v1/models` 共 40 个模型）及自定义私有模型端点，提供 Key 池轮询、权重调度、429 冷却与兜底、按厂商重试与 OpenAI 兼容协议转译，对外只暴露 OpenAI 兼容接口（`/v1`）。

> 仓库说明：主份在自托管 Git 服务（https://git.nashermes.workers.dev/twila/gateai），GitHub（TwliaMU/gateai）是镜像。线上站点：https://gateai.pages.dev

---

## 🏛️ 系统架构

```text
                    ┌────────────────────────────┐
                    │   Cloudflare Pages         │
                    │   前端 dist + Functions    │
                    │   中间件转接 /api /v1      │
                    │   /chat /health            │
                    └─────────────┬──────────────┘
                                  │ 绑定 AI_GATEWAY_DO
                    ┌─────────────▼──────────────┐
                    │   Durable Object (DO)      │
                    │     Gateway Controller     │
                    │   单例 global_master_balancer│
                    │ ┌────────────────────────┐ │
                    │ │      Native SQLite     │ │
                    │ │  - providers           │ │
                    │ │  - api_keys (AES 加密) │ │
                    │ │  - client_tokens (哈希)│ │
                    │ │  - rate_limits         │ │
                    │ │  - proxy_logs          │ │
                    │ │  - admin_audit         │ │
                    │ └────────────────────────┘ │
                    └─────────────┬──────────────┘
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
       Google Gemini            OpenAI             Claude / DeepSeek /
                                                    Groq / xAI / Mistral /
                                                    Cohere / OpenRouter / 自定义
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  ▼
                    OpenAI Compatible API (/v1)
```

Pages 项目内不能创建 Durable Object，所以完整版是两件套，缺一不可：DO Worker `aimultigate-do`（脚本名刻意不改，改了会换命名空间丢数据）+ Pages 项目 `gateai`。

---

## 🚀 部署指南（当前路线）

1. **DO Worker（先部署）**：`aimultigate-do`，配置见 `cloudflare-worker/wrangler-do.jsonc`，只挂 DO、不挂静态资源。部署后在该 Worker 上设 Secret `KEY_ENCRYPTION_SECRET`（DO 内加密厂商 Key 用，Pages 侧不读它）。管理员密码、厂商、Key 全存在这个 DO 里，删/建 Pages 不动它。
2. **Pages 项目（后部署）**：项目名 `gateai`，配置见根目录 `wrangler.jsonc`（`pages_build_output_dir: ./dist`，DO 绑定 `AI_GATEWAY_DO` 指向脚本 `aimultigate-do` 的 `AiGatewayDurableObject` 类；Pages 不支持 `--config` 指定自定义路径，所以 Pages 配置必须放在根目录 `wrangler.jsonc`）。注意：旧的两个 Worker 配置已于 2026-10-28 归档到 `~/workspace/aimultigate-archived-configs-2026-10-28/`，工作目录不再保留，以免误用它们部署出第二个空 DO。当前唯一有效的配置是根目录 `wrangler.jsonc`（Pages）与 `cloudflare-worker/wrangler-do.jsonc`（DO Worker）。前端在 `dist`，接口由 `functions/_middleware.ts` 转接：只转 `/api/*`、`/v1/*`、`/chat/*`、`/health`，其余放行静态资源；转接逻辑（CORS 收紧到 `https://gateai.pages.dev`、10MB 上限、IP 透传、DO 单例 `global_master_balancer`）与原 Worker 入口对齐。

```bash
npm install
npm run deploy:do      # 先：DO Worker（部署脚本已含 tsc 类型检查）
npm run deploy:pages   # 后：Pages（构建 dist + 上传 functions + 静态）
```

上线后域名为 `https://gateai.pages.dev`。旧 `aimultigate.pages.dev` 项目已删除，DO 数据（管理员密码、厂商、Key）仍在 `aimultigate-do` Worker 里，新 Pages 项目绑回同一 DO，不用重新初始化。注意：一旦用了根目录 `wrangler.jsonc` 做 Pages 配置，该文件就是 Pages 配置的唯一事实来源，Dashboard 里对应字段不可再改。

部署清单（每次改 DO 代码必做）：改动 `cloudflare-worker/src/durable-object.ts` 时必须同步 bump 该文件顶部的 `DO_CODE_VERSION`（当前 `2026-11-05-opt-fix`），否则 `/health` 会继续报旧版本号，无法分辨是旧实例未回收还是新代码有问题；改动后先部署 DO 再部署 Pages，并在后台概览里核对显示的 DO 版本。

当前版本要点（2026-11-05 优化批，`DO_CODE_VERSION = 2026-11-05-opt-fix`）：流式用量按实际结算、404 立即跳厂商、429 先试同厂商下一 Key、整请求 120 秒截止、审计显式归属、CORS 默认收紧、登录 IP 用 `cf-connecting-ip`。未实测项：流式用量、429 重试、截止时间需在密钥池填好真实 Key 后补测。

## 🔑 访问与客户端接入

### 1. 管理后台
- 打开 `https://gateai.pages.dev/`，点击右上角盾牌图标进入管理后台。管理员登录只用密码（单密码制，没有用户名），首次访问需初始化设置管理员密码（基于 PBKDF2 + Salt 保护）。后台调试（Playground）走管理员会话聊天，有 60 RPM 上限。

### 2. 客户端接入
兼容 NextChat、Cherry Studio、LobeChat、Cursor、LangChain 等任意支持 OpenAI 格式的客户端：
- **API Base URL**：`https://gateai.pages.dev/v1`
- **API Key**：在管理控制台为下游应用生成的访问令牌（`sk-gw-...`），按厂商/模型/RPM/配额隔离；免密公开调用默认关闭。

### 3. 密钥池与兜底
- 9 家厂商全部启用、策略轮询，但密钥池需在后台自行填写厂商 Key（不要写进代码或仓库，厂商 Key 与 `KEY_ENCRYPTION_SECRET` 绝不进仓库，见 `.gitignore`）。
- 同厂商多 Key 按策略轮换，429 按 Retry-After 冷却单个 Key，401 标无效；主厂商 Key 全挂后按已启用厂商顺序兜底，试的仍是同一模型名，跨厂商不同模型名需模型映射。

---

## 🛠️ 本地开发与调试

> 注意：`server.ts` 与 `server/` 仅供本地调试，线上行为以 Pages + Durable Object 为准（例如本地与线上 `/v1/embeddings` 现均为 501，不再返回模拟向量）。

```bash
# 启动本地开发环境（支持前端热更新与代理转发）
npm install
npm run dev
# 打开 http://localhost:3000
```

## 📁 目录

- `src/`：前端（React + Vite + Tailwind）与网关核心（`core/`、`adapters/`）
- `cloudflare-worker/`：DO Worker（`src/durable-object.ts` 网关控制器、`src/index.ts` 入口）
- `functions/`：Pages 中间件（`_middleware.ts`）
- `server.ts`、`server/`：本地调试服务
- `public/`：PWA 图标与静态资源
