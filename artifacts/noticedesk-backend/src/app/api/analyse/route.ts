import { z } from 'zod';
import { analyse, AnalyseInputError, MAX_TEXT, MIN_TEXT } from '../../../lib/engine/analyse';
import { heuristicExtractor } from '../../../lib/engine/extractors/heuristic';
import { preflight, withCors } from '../../../lib/server/cors';
import { checkRateLimit, clientKey, rateLimitPerMinute } from '../../../lib/server/rateLimit';

export const maxDuration = 30;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Text only. Files go to /api/extract, which has its own, larger limits. */
const BodySchema = z.object({
  text: z.string().min(MIN_TEXT).max(MAX_TEXT),
  source: z
    .object({ method: z.enum(['text', 'pdf_text', 'ocr']), ocrConfidence: z.number().min(0).max(100).optional() })
    .optional(),
  overrides: z
    .object({
      noticeType: z.enum(['gst_show_cause', 'cheque_bounce_138', 'it_intimation', 'legal_notice', 'unknown']).optional(),
      noticeDate: isoDate.optional(),
      receiptDate: isoDate.optional(),
      dueDate: isoDate.optional(),
      period: z
        .object({ n: z.number().int().min(1).max(366), unit: z.enum(['days', 'months']), anchor: z.enum(['receipt', 'notice_date']) })
        .optional(),
    })
    .optional(),
});
/** 30,000 characters can take up to ~120 KB as UTF-8 text; the extra room covers JSON overhead and overrides. */
const MAX_BODY_BYTES = 160_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (status: number, code: string, error: string, headers?: Record<string, string>) => json({ error, code }, status, headers);

/** Reads the request body up to `max` bytes. Returns null as soon as the limit is passed. */
async function readLimited(req: Request, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function handle(req: Request): Promise<Response> {
  const rl = checkRateLimit(`analyse:${clientKey(req)}`, rateLimitPerMinute());
  if (!rl.ok) return fail(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', { 'Retry-After': String(rl.retryAfterSec) });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return fail(413, 'too_large', 'The request is too large. Send extracted text here; upload files to /api/extract.');

  // Do not trust Content-Length: count the bytes actually received and stop at the limit.
  const raw = await readLimited(req, MAX_BODY_BYTES);
  if (raw === null) return fail(413, 'too_large', 'The request is too large. Send extracted text here; upload files to /api/extract.');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_request', 'The request body must be JSON like {"text": "..."}.');
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'invalid_request', `Send notice text between ${MIN_TEXT} and ${MAX_TEXT} characters. Optional: "source" and "overrides" (dates as YYYY-MM-DD).`);
  }

  try {
    const result = await analyse(parsed.data.text, {
      extractor: heuristicExtractor,
      source: parsed.data.source,
      overrides: parsed.data.overrides,
    });
    return json(result);
  } catch (err) {
    if (err instanceof AnalyseInputError) return fail(400, err.code, err.message);
    return fail(500, 'internal_error', 'Something went wrong while analysing the notice.');
  }
}

export const POST = withCors(handle);
export const OPTIONS = (req: Request) => preflight(req);
