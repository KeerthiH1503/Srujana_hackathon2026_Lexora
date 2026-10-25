import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES, isRuleVerified } from '../src/lib/rules';
import { resetRateLimit } from '../src/lib/server/rateLimit';
import { makeMultiPagePdf } from './helpers';

beforeEach(() => {
  resetRateLimit();
  vi.stubEnv('RATE_LIMIT_PER_MIN', '50');
});
afterEach(() => vi.unstubAllEnvs());

describe('rule verification status', () => {
  it('is true only for a flagged rule checked against a primary source with no TODO_VERIFY left', () => {
    for (const rule of Object.values(RULES)) {
      const expected = rule.verified === true && rule.verifiedFrom === 'primary' && !rule.limitations.some((l) => l.includes('TODO_VERIFY'));
      expect(isRuleVerified(rule.id)).toBe(expected);
    }
  });
  it('treats secondary-source and TODO rules as not verified', () => {
    for (const id of ['R-GST-73-8', 'R-GST-REPLY-STATED', 'R-GST-IGNORE', 'R-IT-143-1-A', 'R-GST-RFN']) expect(isRuleVerified(id)).toBe(false);
    for (const id of ['R-138-PAY-15', 'R-138-COMPLAINT', 'R-138-DEMAND-30', 'R-COUNT-DAYS', 'R-IT-DIN']) expect(isRuleVerified(id)).toBe(true);
    expect(isRuleVerified(undefined)).toBe(false);
  });
});

describe('request and file limits', () => {
  it('reads only the first 20 pages of a long PDF', async () => {
    const { POST } = await import('../src/app/api/extract/route');
    const pages = Array.from({ length: 25 }, (_, i) => `PAGE-MARKER-${i + 1}`);
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(makeMultiPagePdf(pages))], { type: 'application/pdf' }), 'long.pdf');
    const res = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toContain('PAGE-MARKER-20');
    expect(body.text).not.toContain('PAGE-MARKER-21');
    expect(body.warnings.join(' ')).toMatch(/first 20 pages/);
  });
  it('rejects an oversized body even when Content-Length is false', async () => {
    const { POST } = await import('../src/app/api/analyse/route');
    const res = await POST(new Request('http://localhost/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '10' }, body: JSON.stringify({ text: 'x'.repeat(200_000) }) }));
    expect(res.status).toBe(413);
  });
});
