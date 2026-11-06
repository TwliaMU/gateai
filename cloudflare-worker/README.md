# GateAI (V2 唯一生产架构)

基于 **Cloudflare Workers + Durable Objects (SQLite)** 原生架构打造的企业级多厂商 AI 负载均衡网关。

---

## 🌟 核心特性
- **唯一生产架构**：Cloudflare Worker 负责边缘路由、CORS、安全检查与限流；Durable Object 维护单例 SQLite 状态、原子事务与密钥调度。
- **高安全凭证管理**：API Key 采用 AES-256-GCM 密文存储，哈希索引防泄漏，UI 绝不返回明文；管理员密码采用 Web Crypto PBKDF2 + Salt 保护；客户端令牌采用 SHA-256 哈希鉴权。
- **状态感知负载均衡**：真正落地确定性 Round-Robin（持久化 cursor）、Weighted 权重分流、Least-Errors 故障规避与 Priority-Failover 优先级降级。
- **429 智能容灾与熔断自愈**：读取 upstream `Retry-After` 头动态设定冷却周期，连续失败自动触发 Circuit Breaker（熔断器）规避雪崩。
- **标准化流式传输 (SSE)**：统一解析 upstream 数据块，解决 chunk 切片、拼接与 `data: [DONE]` 序列化；流式首字节发送前支持透明故障转移。
- **全栈一体化托管 (Workers Static Assets)**：同一个 Worker 同时托管 React 前端管理控制台与后端 Durable Objects 网关，无需部署两套服务。

---

## 🚀 部署指南（Cloudflare Workers）

### 途径 1：Wrangler 命令行一键部署（最快推荐）

1. **克隆项目并安装依赖**：
   ```bash
   git clone <你的仓库地址>
   cd gateai
   npm install
   ```

2. **一键构建并发布至 Cloudflare Workers**：
   ```bash
   npm run deploy
   ```
   *该命令会自动先打包前端 Vite 产物到 `dist/`，随后通过 Wrangler 一并部署 Worker、静态资源与 Durable Objects。*

3. **设置加密密钥（AES-256-GCM 密钥，用于加密各厂商 API Key）**：
   ```bash
   npx wrangler secret put KEY_ENCRYPTION_SECRET
   ```

---

### 途径 2：Cloudflare 控制台 Git 自动构建部署 (Workers Builds)

如果你希望在 Cloudflare 仪表盘绑定 GitHub 仓库实现代码推送自动构建：

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)；
2. 导航至 **Compute (Workers) -> Workers & Pages -> 创建应用程序**；
3. **重要**：选择 **「Workers」** 选项卡（**不要选择 Pages**）；
4. 点击 **「连接 Git (Workers Builds)」** 并选择你的 GitHub 仓库；
5. 构建配置：
   - **Root directory（根目录）**：留空（即 `/`）
   - **Build command（构建命令）**：`npm run build`
   - **Deploy command（部署命令）**：`npx wrangler deploy`
6. 在 Worker 设置中的 **Variables & Secrets** 添加密钥：
   - `KEY_ENCRYPTION_SECRET`
7. 点击保存并部署即可。

---

## 接入测试
- **管理控制台**：浏览器访问 `https://<your-worker>.workers.dev/`
- **OpenAI 兼容端点**：`https://<your-worker>.workers.dev/v1/chat/completions`
- **模型列表**：`https://<your-worker>.workers.dev/v1/models`
- **客户端认证头**：`Authorization: Bearer sk-gw-...`

