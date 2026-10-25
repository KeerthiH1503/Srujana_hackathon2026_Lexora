import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { corsHeaders, parseAllowedOrigins, preflight } from '../src/lib/server/cors';
import { resetRateLimit } from '../src/lib/server/rateLimit';

const FRONTEND = 'https://lexroa.example.app';
const req = (origin?: string, method = 'GET') => new Request('http://localhost/api/x', { method, headers: origin ? { origin } : {} });
const NOTICE = 'LEGAL NOTICE. Under instructions from my client, you are hereby called upon to pay Rs. 85,000/- within 15 days of receipt of this notice. Date: 01/10/2026';

beforeEach(() => resetRateLimit());
afterEach(() => vi.unstubAllEnvs());

describe('CORS configuration', () => {
  it('sends no CORS headers when ALLOWED_ORIGINS is not set (same-origin only)', () => {
    expect(corsHeaders(req(FRONTEND), {})).toEqual({});
  });
  it('parses a list, ignoring spaces, case and trailing slashes', () => {
    expect(parseAllowedOrigins({ ALLOWED_ORIGINS: ' https://A.example.app/ , http://localhost:5173 ' })).toEqual(['https://a.example.app', 'http://localhost:5173']);
  });
  it('allows a listed origin, and repeats that exact origin (not *)', () => {
    const h = corsHeaders(req(FRONTEND), { ALLOWED_ORIGINS: `${FRONTEND},http://localhost:5173` });
    expect(h['Access-Control-Allow-Origin']).toBe(FRONTEND);
    expect(h.Vary).toBe('Origin');
    expect(h['Access-Control-Allow-Headers']).toMatch(/Authorization/);
    expect(h['Access-Control-Expose-Headers']).toMatch(/Retry-After/);
  });
  it('does NOT allow an unlisted origin or a look-alike', () => {
    const env = { ALLOWED_ORIGINS: FRONTEND };
    for (const bad of ['https://evil.example.com', 'https://lexroa.example.app.evil.com', 'http://lexroa.example.app', 'null']) {
      expect(corsHeaders(req(bad), env)['Access-Control-Allow-Origin'], bad).toBeUndefined();
    }
    expect(corsHeaders(req('https://evil.example.com'), env).Vary).toBe('Origin');
  });
  it('supports an explicit wildcard', () => {
    expect(corsHeaders(req('https://anything.example'), { ALLOWED_ORIGINS: '*' })['Access-Control-Allow-Origin']).toBe('*');
  });
  it('adds nothing for a request with no Origin header (curl, same-origin)', () => {
    expect(corsHeaders(req(), { ALLOWED_ORIGINS: FRONTEND })['Access-Control-Allow-Origin']).toBeUndefined();
  });
  it('answers a preflight with 204 and the allowed methods and headers', () => {
    vi.stubEnv('ALLOWED_ORIGINS', FRONTEND);
    const res = preflight(req(FRONTEND, 'OPTIONS'));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toMatch(/Content-Type/);
  });
});

describe('CORS on every route', () => {
  beforeEach(() => vi.stubEnv('ALLOWED_ORIGINS', FRONTEND));
  const withOrigin = (path: string, init: RequestInit = {}, origin = FRONTEND) =>
    new Request(`http://localhost${path}`, { ...init, headers: { origin, ...(init.headers as Record<string, string> | undefined) } });

  it('analyse: success, validation errors and rate-limit errors all carry CORS headers', async () => {
    const { POST, OPTIONS } = await import('../src/app/api/analyse/route');
    const ok = await POST(withOrigin('/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: NOTICE }) }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    const bad = await POST(withOrigin('/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"hi"}' }));
    expect(bad.status).toBe(400);
    expect(bad.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    const pre = await OPTIONS(withOrigin('/api/analyse', { method: 'OPTIONS' }));
    expect(pre.status).toBe(204);
  });
  it('analyse: a disallowed origin gets no permission header', async () => {
    const { POST } = await import('../src/app/api/analyse/route');
    const res = await POST(withOrigin('/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: NOTICE }) }, 'https://evil.example.com'));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('analyse: the 429 response is readable by the allowed frontend and exposes Retry-After', async () => {
    vi.stubEnv('RATE_LIMIT_PER_MIN', '1');
    const { POST } = await import('../src/app/api/analyse/route');
    const mk = () => withOrigin('/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: NOTICE }) });
    await POST(mk());
    const limited = await POST(mk());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    expect(limited.headers.get('access-control-expose-headers')).toMatch(/Retry-After/);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
  it('extract: uploads (a simple request, no preflight) still get the response header, errors included', async () => {
    const { POST, OPTIONS } = await import('../src/app/api/extract/route');
    const form = new FormData();
    form.set('file', new Blob([NOTICE], { type: 'text/plain' }), 'n.txt');
    const ok = await POST(withOrigin('/api/extract', { method: 'POST', body: form }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    const none = await POST(withOrigin('/api/extract', { method: 'POST', body: new FormData() }));
    expect(none.status).toBe(400);
    expect(none.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    expect((await OPTIONS(withOrigin('/api/extract', { method: 'OPTIONS' }))).status).toBe(204);
  });
  it('health and bench carry CORS headers', async () => {
    const health = await import('../src/app/api/health/route');
    const h = await health.GET(withOrigin('/api/health'));
    expect(h.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    expect((await health.OPTIONS(withOrigin('/api/health', { method: 'OPTIONS' }))).status).toBe(204);
    const bench = await import('../src/app/api/bench/route');
    const b = await bench.GET(withOrigin('/api/bench'));
    expect(b.headers.get('access-control-allow-origin')).toBe(FRONTEND);
  });
  it('without ALLOWED_ORIGINS no route sends any CORS header', async () => {
    vi.unstubAllEnvs();
    const health = await import('../src/app/api/health/route');
    const res = await health.GET(withOrigin('/api/health'));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toBeNull();
  });
});
