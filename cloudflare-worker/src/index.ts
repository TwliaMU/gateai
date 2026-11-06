/**
 * Cloudflare Worker Entry Point (HTTP / Routing / CORS / Security / DO Forwarding)
 */

export interface DurableObjectNamespaceBinding {
  idFromName(name: string): any;
  get(id: any): { fetch(request: Request): Promise<Response> };
}

export interface Env {
  AI_GATEWAY_DO: DurableObjectNamespaceBinding;
  KEY_ENCRYPTION_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

export { AiGatewayDurableObject } from './durable-object.js';

const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, x-api-key, X-Admin-Session, x-provider, x-requested-with';

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

function withSecurityHeaders(resp: Response): Response {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(securityHeaders())) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

async function capBodyIfLengthless(request: Request): Promise<Request | null> {
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

function isApiPath(pathname: string): boolean {
  return (
    pathname === '/api' || pathname.startsWith('/api/') ||
    pathname === '/v1' || pathname.startsWith('/v1/') ||
    pathname === '/chat' || pathname.startsWith('/chat/') ||
    pathname === '/health'
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') || '*';
    const allowedOrigins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : ['https://gateai.pages.dev'];
    const allowOriginHeader: string | null = (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) ? origin : null;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const h: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        'Access-Control-Max-Age': '86400',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN'
      };
      if (allowOriginHeader) h['Access-Control-Allow-Origin'] = allowOriginHeader;
      return new Response(null, { status: 204, headers: h });
    }

    const url = new URL(request.url);

    // Serve Static UI Assets if ASSETS binding is present (Workers Static Assets)
    const isApiRequest = isApiPath(url.pathname);

    if (env.ASSETS && request.method === 'GET' && !isApiRequest) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return withSecurityHeaders(assetResponse);
        }
        // SPA Fallback: if browser navigation route without file extension, serve index.html
        if (!url.pathname.includes('.')) {
          const indexReq = new Request(new URL('/', request.url), request);
          const indexResponse = await env.ASSETS.fetch(indexReq);
          if (indexResponse.status !== 404) {
            return withSecurityHeaders(indexResponse);
          }
        }
      } catch {
        // Fallback to API / DO handling
      }
    }

    // Root Welcome / Ping (When no static assets or explicit API request)
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'GateAI (V2)',
        endpoints: {
          chat: '/v1/chat/completions',
          models: '/v1/models',
          admin: '/admin'
        }
      }, null, 2), {
        headers: (() => {
          const h: Record<string, string> = { 'Content-Type': 'application/json', ...securityHeaders() };
          if (allowOriginHeader) h['Access-Control-Allow-Origin'] = allowOriginHeader;
          return h;
        })()
      });
    }

    // Enforce Request Body Size Limit (10MB)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: { message: 'Payload Too Large: maximum 10MB' } }), {
        status: 413,
        headers: (() => {
          const h: Record<string, string> = { 'Content-Type': 'application/json', ...securityHeaders() };
          if (allowOriginHeader) h['Access-Control-Allow-Origin'] = allowOriginHeader;
          return h;
        })()
      });
    }

    // Chunked (length-less) body cap, same 10 MB limit as above.
    let effectiveRequest = request;
    if (!request.headers.get('content-length') && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
      const capped = await capBodyIfLengthless(request);
      if (!capped) {
        return new Response(JSON.stringify({ error: { message: 'Payload Too Large: maximum 10MB' } }), { status: 413, headers: { 'Content-Type': 'application/json' } });
      }
      effectiveRequest = capped;
    }

    // Attach Cloudflare Edge geolocation and client IP metadata
    const clientIp = effectiveRequest.headers.get('cf-connecting-ip') || effectiveRequest.headers.get('x-forwarded-for') || '';
    const clientCountry = effectiveRequest.headers.get('cf-ipcountry') || '';
    
    let forwardRequest = effectiveRequest;
    if (clientIp || clientCountry) {
      const forwardedHeaders = new Headers(effectiveRequest.headers);
      // Edge overwrites x-client-ip unconditionally (see middleware).
      if (clientIp) {
        forwardedHeaders.set('x-client-ip', clientIp);
      }
      if (clientCountry && !forwardedHeaders.has('x-client-country')) {
        forwardedHeaders.set('x-client-country', clientCountry);
      }
      forwardRequest = new Request(effectiveRequest, { headers: forwardedHeaders });
    }

    // Forward to Global Singleton Durable Object
    const doId = env.AI_GATEWAY_DO.idFromName('global_master_balancer');
    const gatewayDo = env.AI_GATEWAY_DO.get(doId);

    const response = await gatewayDo.fetch(forwardRequest);

    // Clone response to attach CORS & security hardening headers
    const newHeaders = new Headers(response.headers);
    if (allowOriginHeader) newHeaders.set('Access-Control-Allow-Origin', allowOriginHeader);
    else newHeaders.delete('Access-Control-Allow-Origin');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    for (const [k, v] of Object.entries(securityHeaders())) newHeaders.set(k, v);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
};
