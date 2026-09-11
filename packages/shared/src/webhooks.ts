/**
 * Webhook 署名（API 側の署名生成と SDK 側の検証で共有）
 *   X-payCcount-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + "." + body))>
 * Web Crypto だけを使うので Node 18+ / Workers / ブラウザで動く。
 */
const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 署名ヘッダー値を生成する */
export async function signWebhookPayload(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const v1 = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  return `t=${timestamp},v1=${v1}`;
}

export interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(header: string): ParsedSignature {
  let timestamp = -1;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't' && v) timestamp = Number(v);
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!Number.isFinite(timestamp) || timestamp < 0 || signatures.length === 0) {
    throw new WebhookSignatureError('署名ヘッダーの形式が正しくありません');
  }
  return { timestamp, signatures };
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 署名を検証する。不正なら WebhookSignatureError を投げる。
 * @param toleranceSec タイムスタンプの許容ずれ（デフォルト 300 秒）
 */
export async function verifyWebhookSignature(
  body: string,
  header: string | null | undefined,
  secret: string,
  toleranceSec = 300,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header) throw new WebhookSignatureError('署名ヘッダーがありません');
  const { timestamp, signatures } = parseSignatureHeader(header);
  if (toleranceSec > 0 && Math.abs(now - timestamp) > toleranceSec) {
    throw new WebhookSignatureError('署名のタイムスタンプが許容範囲外です');
  }
  const expected = await hmacSha256Hex(secret, `${timestamp}.${body}`);
  if (!signatures.some((s) => timingSafeEqualHex(s, expected))) {
    throw new WebhookSignatureError('署名が一致しません');
  }
  return true;
}

/** SHA-256 の 16 進文字列（APIキーのハッシュ等） */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
