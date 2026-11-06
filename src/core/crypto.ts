/**
 * Web Crypto standard implementation for Cloudflare Workers & Node.js
 * Uses standard crypto.subtle without external binary dependencies.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * SHA-256 Hash for tokens and lookup identifiers
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

/**
 * Derive an AES-256-GCM CryptoKey from a secret passphrase.
 * Exported so a caller can derive once per request and reuse it.
 */
export async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const secretBytes = encoder.encode(secret);
  // Hash the secret to ensure it is 32 bytes (256 bits)
  const keyMaterial = await crypto.subtle.digest('SHA-256', secretBytes);
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt sensitive string (e.g. upstream API Key) using AES-256-GCM
 * Returns formatted string: "ivHex:ciphertextHex"
 */
export async function encryptKey(plaintext: string, secret: string): Promise<string> {
  if (!secret) throw new Error('Encryption secret is required');
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded as unknown as BufferSource
  );

  return `${bufferToHex(iv)}:${bufferToHex(ciphertext)}`;
}

/**
 * Decrypt with a pre-derived key (avoids re-deriving per key attempt).
 */
export async function decryptWithKey(encryptedString: string, key: CryptoKey): Promise<string> {
  if (!encryptedString.includes(':')) throw new Error('Invalid encrypted key format');
  const [ivHex, cipherHex] = encryptedString.split(':');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuffer(ivHex) as unknown as BufferSource },
    key,
    hexToBuffer(cipherHex) as unknown as BufferSource
  );
  return decoder.decode(decrypted);
}

/**
 * Decrypt string using AES-256-GCM
 */
export async function decryptKey(encryptedString: string, secret: string): Promise<string> {
  if (!secret) throw new Error('Encryption secret is required');
  if (!encryptedString.includes(':')) {
    throw new Error('Invalid encrypted key format');
  }

  const [ivHex, cipherHex] = encryptedString.split(':');
  const iv = hexToBuffer(ivHex);
  const ciphertext = hexToBuffer(cipherHex);
  const key = await deriveAesKey(secret);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource
  );

  return decoder.decode(decrypted);
}

/**
 * Hash password with PBKDF2 and salt (100,000 iterations)
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    256
  );

  return bufferToHex(derivedBits);
}

/**
 * Generate 16-byte random salt hex
 */
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bufferToHex(salt);
}

/**
 * Generate high-entropy Session Token
 */
export function generateSessionToken(): string {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  return 'sess_' + bufferToHex(tokenBytes);
}

/**
 * Generate secure Client Token (sk-gw-...)
 */
export function generateClientToken(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24));
  return 'sk-gw-' + bufferToHex(randomBytes);
}

/**
 * Mask key for UI display (e.g. "sk-a...bcde" or "AIza...1234")
 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****' + key.slice(-2);
  return key.slice(0, 4) + '...' + key.slice(-4);
}

/**
 * Extract key prefix for safe database index/filtering (e.g. "sk-ab...")
 */
export function extractKeyPrefix(key: string): string {
  // Same masking as maskKey (first 4 + last 4) so a prefix never exposes
  // half of a short custom-endpoint key.
  return maskKey(key);
}

/**
 * Constant-time string comparison to prevent timing attacks on passwords/tokens
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const lenA = a.length;
  const lenB = b.length;
  let diff = lenA ^ lenB;
  const maxLen = Math.max(lenA, lenB);
  for (let i = 0; i < maxLen; i++) {
    const codeA = i < lenA ? a.charCodeAt(i) : 0;
    const codeB = i < lenB ? b.charCodeAt(i) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}

/**
 * Enterprise-grade SSRF defense and URL validator
 * Enforces strict RFC compliance, blocks all private/internal/cloud-metadata IP ranges,
 * blocks abnormal encoded hosts (hex, octal, integer IPs), and disallows sensitive internal ports.
 */
export function validateSafeUrl(urlStr: string): { safe: boolean; error?: string } {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { safe: false, error: '只允许 https: 或 http: 协议' };
    }

    // Check disallowed dangerous internal ports
    if (parsed.port) {
      const portNum = parseInt(parsed.port, 10);
      const dangerousPorts = [
        21, 22, 23, 25, 53, 111, 135, 137, 138, 139, 445,
        1433, 1521, 2375, 2376, 2379, 3306, 3389, 5432, 6379,
        8500, 9200, 11211, 27017, 28017
      ];
      if (dangerousPorts.includes(portNum)) {
        return { safe: false, error: `禁止探测敏感内部服务端口 (${portNum})` };
      }
    }

    const host = parsed.hostname.toLowerCase().trim();

    if (!host) {
      return { safe: false, error: '主机名不能为空' };
    }

    // Block localhost and standard loopback hostnames
    if (host === 'localhost' || host.endsWith('.localhost') || host === 'ip6-localhost' || host === 'ip6-loopback') {
      return { safe: false, error: '禁止访问 localhost 及回环域名' };
    }

    // Block internal private suffixes
    if (
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.lan') ||
      host.endsWith('.corp') ||
      host.endsWith('.home.arpa')
    ) {
      return { safe: false, error: '禁止访问私有内网或局域网域名' };
    }

    // Block cloud metadata hostnames
    if (host === 'metadata.google.internal' || host === 'instance-data' || host.includes('metadata.internal')) {
      return { safe: false, error: '禁止访问云服务元数据端点' };
    }

    // Check IPv6 loopback / unique local / link-local
    if (host === '::1' || host === '::' || host === '[::1]' || host === '[::]') {
      return { safe: false, error: '禁止访问 IPv6 回环地址' };
    }
    const cleanIpv6 = host.replace(/^\[/, '').replace(/\]$/, '');
    if (cleanIpv6.startsWith('fe80:') || cleanIpv6.startsWith('fc00:') || cleanIpv6.startsWith('fd00:')) {
      return { safe: false, error: '禁止访问 IPv6 私有或链路本地地址' };
    }

    // Check IPv4-mapped IPv6 like [::ffff:127.0.0.1]
    const ipv4MappedMatch = cleanIpv6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    const ipToCheck = ipv4MappedMatch ? ipv4MappedMatch[1] : host;

    // Check integer or hex encoded IPs (e.g. 2130706433 or 0x7f000001)
    if (/^\d+$/.test(ipToCheck)) {
      return { safe: false, error: '禁止使用纯数字编码的 IP 格式' };
    }
    if (/^0x[0-9a-f]+$/i.test(ipToCheck)) {
      return { safe: false, error: '禁止使用十六进制编码的 IP 格式' };
    }

    // Check standard dot-decimal IPv4
    const ipv4Parts = ipToCheck.split('.');
    if (ipv4Parts.length === 4 && ipv4Parts.every(p => /^\d+$/.test(p))) {
      const nums = ipv4Parts.map(p => parseInt(p, 10));
      if (nums.some(n => n < 0 || n > 255)) {
        return { safe: false, error: '非法 IPv4 地址' };
      }
      const [b0, b1] = nums;

      // 0.0.0.0/8
      if (b0 === 0) return { safe: false, error: '禁止访问 0.0.0.0/8 广播源地址' };
      // 127.0.0.0/8 (Loopback)
      if (b0 === 127) return { safe: false, error: '禁止访问 127.0.0.0/8 回环网段' };
      // 10.0.0.0/8 (Private RFC 1918)
      if (b0 === 10) return { safe: false, error: '禁止访问 10.0.0.0/8 私有网段' };
      // 172.16.0.0/12 (Private RFC 1918: 172.16 - 172.31)
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return { safe: false, error: '禁止访问 172.16.0.0/12 私有网段' };
      // 192.168.0.0/16 (Private RFC 1918)
      if (b0 === 192 && b1 === 168) return { safe: false, error: '禁止访问 192.168.0.0/16 私有网段' };
      // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Metadata 169.254.169.254)
      if (b0 === 169 && b1 === 254) return { safe: false, error: '禁止访问 169.254.0.0/16 链路本地与元数据网段' };
      // 100.64.0.0/10 (CGNAT)
      if (b0 === 100 && b1 >= 64 && b1 <= 127) return { safe: false, error: '禁止访问运营商 NAT 网段' };
      // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
      if (b0 >= 224) return { safe: false, error: '禁止访问组播或保留网段' };
    }

    return { safe: true };
  } catch {
    return { safe: false, error: 'URL 格式无效' };
  }
}
