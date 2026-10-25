// Simple in-memory rate limiter to protect the API key during a demo.
// Limitation: state is per server instance (it resets on restart and is not shared across serverless instances).

const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimit(): void {
  hits.clear();
}

/**
 * Identity used for rate limiting.
 * X-Forwarded-For can be forged by the client, so it is IGNORED unless TRUST_PROXY_HEADERS=true.
 * Only set that on a host whose proxy overwrites the header (test it: see README). When trusted, the LAST entry is used,
 * because that is the one added by your own proxy; earlier entries are client-supplied.
 * When not trusted, all callers share one bucket, which still protects the server (and any paid keys) from floods.
 */
export function clientKey(req: Request, env: Record<string, string | undefined> = process.env): string {
  if ((env.TRUST_PROXY_HEADERS ?? '').toLowerCase() === 'true') {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) {
      const parts = fwd.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
  }
  return 'shared';
}

export function rateLimitPerMinute(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.RATE_LIMIT_PER_MIN);
  return Number.isFinite(n) && n > 0 ? n : 60;
}
