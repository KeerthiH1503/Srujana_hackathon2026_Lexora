// CORS for a frontend hosted on a different origin (for example a static site calling this backend).
// Configure with ALLOWED_ORIGINS, a comma-separated list of exact origins:
//   ALLOWED_ORIGINS=https://lexroa.example.app,http://localhost:5173
// With no value, NO CORS headers are sent (same-origin use only). "*" allows any origin: acceptable for a public,
// cookie-free demo API, but remember that it lets any website call your backend from a visitor's browser.
// The browser enforces CORS; it does not protect the server from non-browser callers.

type Env = Record<string, string | undefined>;

const normalize = (origin: string) => origin.trim().replace(/\/+$/, '').toLowerCase();

export function parseAllowedOrigins(env: Env = process.env): string[] | '*' {
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map(normalize).filter(Boolean);
  return list.includes('*') ? '*' : list;
}

const COMMON = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Access-Control-Max-Age': '86400',
} as const;

export function corsHeaders(req: Request, env: Env = process.env): Record<string, string> {
  const allowed = parseAllowedOrigins(env);
  if (allowed !== '*' && allowed.length === 0) return {};
  // Vary tells caches the answer depends on the caller's Origin.
  const headers: Record<string, string> = { Vary: 'Origin' };
  const origin = req.headers.get('origin');
  if (!origin) return headers;
  if (allowed === '*') return { ...headers, 'Access-Control-Allow-Origin': '*', ...COMMON };
  if (allowed.includes(normalize(origin))) return { ...headers, 'Access-Control-Allow-Origin': origin, ...COMMON };
  return headers; // not allowed: no Access-Control-Allow-Origin, so the browser blocks the response
}

/** Answer to a browser preflight (OPTIONS) request. */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** Adds CORS headers to every response of a route handler, including errors. */
export function withCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    const res = await handler(req);
    for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
    return res;
  };
}
