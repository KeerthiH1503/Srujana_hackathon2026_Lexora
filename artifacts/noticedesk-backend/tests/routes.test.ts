import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectFileKind } from '../src/lib/server/fileValidation';
import { resetRateLimit } from '../src/lib/server/rateLimit';
import { makePdf } from './helpers';

const NOTICE =
  'Advocate Demo Kumar, Law Office, Bengaluru\nDate: 05/10/2026\nLEGAL NOTICE\nUnder instructions from my client, you are hereby called upon to pay Rs. 85,000/- within 15 days of receipt of this notice. This notice was delivered to you on 08/10/2026.';

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const upload = (bytes: Uint8Array | string, name = 'notice.txt', type = 'text/plain') => {
  const form = new FormData();
  form.set('file', new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type }), name);
  return new Request('http://localhost/api/extract', { method: 'POST', body: form });
};

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name)));

beforeEach(() => {
  resetRateLimit();
  vi.stubEnv('RATE_LIMIT_PER_MIN', '50');
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/analyse', () => {
  it('returns a full analysis for valid notice text', async () => {
    const { POST } = await import('../src/app/api/analyse/route');
    const res = await POST(post('/api/analyse', { text: NOTICE }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.noticeType).toBe('legal_notice');
    expect(body.deadline.status).toBe('computed');
    expect(body.deadline.date).toBe('2026-10-23');
  });
  it('rejects invalid JSON, short text and missing fields with clear errors', async () => {
    const { POST } = await import('../src/app/api/analyse/route');
    const bad = await POST(new Request('http://localhost/api/analyse', { method: 'POST', body: 'not json' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('bad_request');
    const short = await POST(post('/api/analyse', { text: 'hi' }));
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe('invalid_request');
    const missing = await POST(post('/api/analyse', {}));
    expect(missing.status).toBe(400);
  });
  it('rejects oversized bodies', async () => {
    const { POST } = await import('../src/app/api/analyse/route');
    const res = await POST(post('/api/analyse', { text: NOTICE }, { 'content-length': '999999' }));
    expect(res.status).toBe(413);
  });
  it('rate-limits repeated calls', async () => {
    vi.stubEnv('RATE_LIMIT_PER_MIN', '2');
    const { POST } = await import('../src/app/api/analyse/route');
    expect((await POST(post('/api/analyse', { text: NOTICE }))).status).toBe(200);
    expect((await POST(post('/api/analyse', { text: NOTICE }))).status).toBe(200);
    const third = await POST(post('/api/analyse', { text: NOTICE }));
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBeTruthy();
  });
  it('accepts the OCR source and user-entered facts', async () => {
    const { POST } = await import('../src/app/api/analyse/route');
    const res = await POST(post('/api/analyse', {
      text: 'LEGAL NOTICE. Under instructions from my client, you are hereby called upon to pay Rs. 85,000/- within 15 days of receipt of this notice. Date: 01/10/2026',
      source: { method: 'ocr', ocrConfidence: 91 },
      overrides: { receiptDate: '2026-10-05' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deadline).toMatchObject({ status: 'computed', date: '2026-10-20', needsReview: true });
  });
  it('rejects impossible override dates', async () => {
    const { POST } = await import('../src/app/api/analyse/route');
    const res = await POST(post('/api/analyse', { text: NOTICE, overrides: { receiptDate: '2026-02-31' } }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/extract', () => {
  it('reads a text file', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const res = await POST(upload(NOTICE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toContain('LEGAL NOTICE');
    expect(['good', 'poor']).toContain(body.quality);
  });
  it('reads text from a PDF', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const pdf = makePdf(['LEGAL NOTICE dated 05/10/2026', 'You are hereby called upon to pay Rs. 85,000/- within 15 days of receipt of this notice.']);
    const res = await POST(upload(pdf, 'notice.pdf', 'application/pdf'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toContain('LEGAL NOTICE');
    expect(body.text).toContain('15 days of receipt');
  });
  it('trusts the file contents, not the file name or declared type', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const binary = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // looks like a Windows executable
    const res = await POST(upload(binary, 'notice.pdf', 'application/pdf'));
    expect(res.status).toBe(415);
  });
  it('rejects empty and oversized files and missing uploads', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    expect((await POST(upload(''))).status).toBe(400);
    const huge = new Uint8Array(8 * 1024 * 1024 + 1).fill(65);
    expect((await POST(upload(huge))).status).toBe(413);
    const noFile = new Request('http://localhost/api/extract', { method: 'POST', body: new FormData() });
    expect((await POST(noFile)).status).toBe(400);
  });
  it('reads a clean photo with classic OCR and reports confidence', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const res = await POST(upload(fixture('notice_clean.png'), 'photo.png', 'image/png'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe('ocr');
    expect(body.text).toContain('LEGAL NOTICE');
    expect(body.text).toContain('08/10/2026');
    expect(body.ocrConfidence).toBeGreaterThan(80);
    expect(body.warnings.join(' ')).toMatch(/OCR/);
  });
  it('reports LOW confidence and uncertain words for a degraded photo', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const res = await POST(upload(fixture('notice_degraded.png'), 'bad.png', 'image/png'));
    const body = await res.json();
    expect(body.method).toBe('ocr');
    expect(body.ocrConfidence).toBeLessThan(80);
    expect(body.lowConfidenceWords.length).toBeGreaterThan(0);
  });
  it('joins several pages into one text', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const form = new FormData();
    form.append('file', new Blob([fixture('notice_clean.png')], { type: 'image/png' }), 'p1.png');
    form.append('file', new Blob([fixture('notice_page2.png')], { type: 'image/png' }), 'p2.png');
    const res = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.text).toContain('--- page 1 ---');
    expect(body.text).toContain('--- page 2 ---');
    expect(body.text).toContain('Advocate Demo Kumar');
  });
  it('rejects too many files and oversized image dimensions', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const form = new FormData();
    for (let i = 0; i < 6; i++) form.append('file', new Blob(['notice text number ' + i]), `n${i}.txt`);
    expect((await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }))).status).toBe(400);
    // A PNG header that claims 20,000 x 20,000 pixels
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20]);
    const res = await POST(upload(png, 'huge.png', 'image/png'));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('image_too_large');
  });
  it('warns when a PDF has no readable text', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const res = await POST(upload(makePdf(['']), 'scan.pdf', 'application/pdf'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quality).toBe('poor');
    expect(body.warnings.join(' ')).toMatch(/scan|little text/i);
  });
});

describe('GET /api/health and /api/bench', () => {
  it('says plainly that no AI is used', async () => {
    const { GET } = await import('../src/app/api/health/route');
    const body = await (await GET(new Request('http://localhost/api/health'))).json();
    expect(body).toMatchObject({ ok: true, ai: false });
    expect(body.imageReading).toMatch(/OCR/);
  });
  it('serves benchmark results once they exist, or a clear 404', async () => {
    const { GET } = await import('../src/app/api/bench/route');
    const res = await GET(new Request('http://localhost/api/bench'));
    expect([200, 404]).toContain(res.status);
    if (res.status === 404) expect((await res.json()).code).toBe('no_results');
    else expect((await res.json()).metrics).toBeDefined();
  });
});

describe('file type detection', () => {
  it('detects real types from bytes', () => {
    expect(detectFileKind(new TextEncoder().encode('%PDF-1.7 ...'))).toBe('pdf');
    expect(detectFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectFileKind(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(detectFileKind(new TextEncoder().encode('plain text notice'))).toBe('text');
  });
  it('rejects unknown binary data', () => {
    expect(detectFileKind(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull();
  });
});
