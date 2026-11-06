/**
 * Pages Functions 转接层（GateAI Pages 路线）
 *
 * Pages 项目内不能创建 Durable Object，DO 必须先以单独 Worker
 *（cloudflare-worker/wrangler-do.jsonc，脚本名 aimultigate-do）部署，
 *再以绑定 AI_GATEWAY_DO 挂到本 Pages 项目上。
 *
 * 本中间件只转接网关与管理接口，其余请求一律放行给静态资源：
 *   转接：/api/*、/v1/*、/chat/*、/health
 *   放行：/、/*.js、/*.css、图片、PWA 清单等（dist 静态产物）
 *
 * 转接逻辑与原 Worker 入口 cloudflare-worker/src/index.ts 对齐：
 * 同一个 DO 单例（idFromName('global_master_balancer')）、同一套
 * CORS 预检、10MB 体积上限、cf-connecting-ip / cf-ipcountry 透传、
 * 以及回包的 CORS 与安全头。DO 本身会把 /api/* 归一化为 /admin/*，
 * 所以这里原样转发请求 URL，不改路径。
 */

interface GatewayEnv {
  AI_GATEWAY_DO?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  ALLOWED_ORIGINS?: string;
}

function isSpaFallbackPath(pathname: string): boolean {
  if (pathname === '/') return false;
  if (isApiRequest(pathname)) return false;
  // Only extension-less paths are SPA routes; real files (js/css/png/...)
  // keep their 404 instead of being masked by index.html.
  const lastSegment = pathname.split('/').pop() || '';
  return !lastSegment.includes('.');
}

const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, x-api-key, X-Admin-Session, x-provider, x-requested-with';

async function capBodyIfLengthless(request: Request): Promise<Request | null> {
  // Streaming 10 MB cap for bodies without content-length (chunked).
  // Returns null when over the cap; otherwise a request with a buffered body.
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > 10 * 1024 * 1024) { try { await reader.cancel(); } catch {} return null; }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return new Request(request.url, { method: request.method, headers: request.headers, body: merged as any });
}

function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000',
    // Report-only CSP: observed, never enforced (2026-11-05 decision).
    // No report-uri/report-to, so nothing is sent anywhere.
    'Content-Security-Policy-Report-Only': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://gateai.pages.dev; img-src 'self' data:; font-src 'self' data:",
  };
}

function isApiRequest(pathname: string): boolean {
  return (
    pathname === '/api' || pathname.startsWith('/api/') ||
    pathname === '/v1' || pathname.startsWith('/v1/') ||
    pathname === '/chat' || pathname.startsWith('/chat/') ||
    pathname === '/health'
  );
}

export async function onRequest(context: {
  request: Request;
  env: GatewayEnv;
  next: () => Promise<Response>;
}): Promise<Response> {
  const { request, env, next } = context;
  let effectiveRequest: Request = request;
  const url = new URL(request.url);

  // 非接口请求：直接走静态资源，不碰 DO。
  if (!isApiRequest(url.pathname)) {
    const staticResp = await next();
    // SPA fallback: extension-less path that has no static file serves
    // index.html so client-side routing works; API paths never reach here.
    if (staticResp.status === 404 && isSpaFallbackPath(url.pathname)) {
      // Pages runtime accepts a rewritten request in next(); the local
      // type only declares next() with no arguments, hence the cast.
      const fallback = await (next as (req: Request) => Promise<Response>)(new Request(new URL('/index.html', url.origin), request));
      const fh = new Headers(fallback.headers);
      for (const [k, v] of Object.entries(securityHeaders())) fh.set(k, v);
      return new Response(fallback.body, { status: fallback.status, statusText: fallback.statusText, headers: fh });
    }
    const sh = new Headers(staticResp.headers);
    for (const [k, v] of Object.entries(securityHeaders())) sh.set(k, v);
    return new Response(staticResp.body, { status: staticResp.status, statusText: staticResp.statusText, headers: sh });
  }

  const origin = request.headers.get('Origin') || '*';
  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    : ['https://gateai.pages.dev'];
  // Disallowed origins get NO Access-Control-Allow-Origin header (previously
  // the first allowed origin was returned, which browsers reject anyway).
  const allowOriginHeader: string | null =
    allowedOrigins.includes('*') || allowedOrigins.includes(origin)
      ? origin
      : null;

  // CORS 预检：与 Worker 入口一致，DO 不处理 OPTIONS。
  if (request.method === 'OPTIONS') {
    const preflightHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      'Access-Control-Max-Age': '86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    };
    if (allowOriginHeader) preflightHeaders['Access-Control-Allow-Origin'] = allowOriginHeader;
    return new Response(null, { status: 204, headers: preflightHeaders });
  }

  if (!env.AI_GATEWAY_DO) {
    const headers503: Record<string, string> = { 'Content-Type': 'application/json' };
    if (allowOriginHeader) headers503['Access-Control-Allow-Origin'] = allowOriginHeader;
    return new Response(
      JSON.stringify({
        error: {
          message:
            'AI_GATEWAY_DO binding is not configured on this Pages project. Deploy the aimultigate-do Worker first, then bind its Durable Object namespace as AI_GATEWAY_DO and redeploy.',
        },
      }),
      { status: 503, headers: headers503 },
    );
  }

  // 10MB 体积上限，与 Worker 入口一致。
  const contentLength = request.headers.get('content-length');
  if (!contentLength && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
    const capped = await capBodyIfLengthless(request);
    if (!capped) {
      return new Response(
        JSON.stringify({ error: { message: 'Payload Too Large: maximum 10MB' } }),
        { status: 413, headers: { 'Content-Type': 'application/json' } },
      );
    }
    effectiveRequest = capped;
  }
  if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ error: { message: 'Payload Too Large: maximum 10MB' } }),
      {
        status: 413,
        headers: (() => {
          const h: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN',
          };
          if (allowOriginHeader) h['Access-Control-Allow-Origin'] = allowOriginHeader;
          return h;
        })(),
      },
    );
  }

  // 透传边缘地理与客户端 IP，与 Worker 入口一致。
  const clientIp =
    effectiveRequest.headers.get('cf-connecting-ip') ||
    effectiveRequest.headers.get('x-forwarded-for') ||
    '';
  const clientCountry = effectiveRequest.headers.get('cf-ipcountry') || '';
  let forwardRequest = effectiveRequest;
  if (clientIp || clientCountry) {
    const forwardedHeaders = new Headers(effectiveRequest.headers);
    // Edge overwrites x-client-ip unconditionally with the real
    // Cloudflare client IP: a client-supplied header must never be
    // allowed to choose its own rate-limit bucket.
    if (clientIp) {
      forwardedHeaders.set('x-client-ip', clientIp);
    }
    if (clientCountry && !forwardedHeaders.has('x-client-country')) {
      forwardedHeaders.set('x-client-country', clientCountry);
    }
    forwardRequest = new Request(effectiveRequest, { headers: forwardedHeaders });
  }

  const doId = env.AI_GATEWAY_DO.idFromName('global_master_balancer');
  const gatewayDo = env.AI_GATEWAY_DO.get(doId);
  const response = await gatewayDo.fetch(forwardRequest);

  const newHeaders = new Headers(response.headers);
  if (allowOriginHeader) newHeaders.set('Access-Control-Allow-Origin', allowOriginHeader);
  else newHeaders.delete('Access-Control-Allow-Origin');
  newHeaders.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS',
  );
  newHeaders.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  for (const [k, v] of Object.entries(securityHeaders())) newHeaders.set(k, v);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
