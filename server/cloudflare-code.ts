import fs from 'fs';
import path from 'path';

/**
 * 1:1 Production Source Code Exporter for Cloudflare Workers & Durable Objects
 * Directly serves the actual repository files rather than generating disconnected prototype templates.
 */
export function generateCloudflareWorkerCode(): {
  wranglerJson: string;
  workerIndexTs: string;
  durableObjectTs: string;
  readmeMd: string;
} {
  const rootDir = process.cwd();
  const workerDir = path.join(rootDir, 'cloudflare-worker');

  const wranglerPath = path.join(workerDir, 'wrangler.jsonc');
  const indexPath = path.join(workerDir, 'src', 'index.ts');
  const doPath = path.join(workerDir, 'src', 'durable-object.ts');
  const readmePath = path.join(workerDir, 'README.md');

  const wranglerJson = fs.existsSync(wranglerPath)
    ? fs.readFileSync(wranglerPath, 'utf-8')
    : '// wrangler.jsonc not found';

  const workerIndexTs = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf-8')
    : '// src/index.ts not found';

  const durableObjectTs = fs.existsSync(doPath)
    ? fs.readFileSync(doPath, 'utf-8')
    : '// src/durable-object.ts not found';

  const readmeMd = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, 'utf-8')
    : `# GateAI (V2 Production Architecture)

## 快速部署指南

1. 安装 Cloudflare Wrangler CLI 并登录：
\`\`\`bash
npm install -g wrangler
wrangler login
\`\`\`

2. 设置安全加密秘钥（AES-256-GCM 用于加密 SQLite 中的 API Key）：
\`\`\`bash
wrangler secret put KEY_ENCRYPTION_SECRET
\`\`\`

3. 部署到 Cloudflare 全球边缘网络（自动应用 SQLite 数据库迁移）：
\`\`\`bash
npx wrangler deploy
\`\`\`

4. 获取您的 Worker 域名并接入任意 OpenAI 兼容客户端（NextChat / Cherry Studio / Cursor 等）：
- Base URL: https://your-worker.workers.dev/v1
- API Key: <在控制台生成的 sk-gw-... 访问令牌>
`;

  return {
    wranglerJson,
    workerIndexTs,
    durableObjectTs,
    readmeMd
  };
}
