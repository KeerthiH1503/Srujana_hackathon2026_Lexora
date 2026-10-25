import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyse, AnalyseInputError } from '../src/lib/engine/analyse';
import { heuristicExtractor } from '../src/lib/engine/extractors/heuristic';
import { createSyntheticRegistry, type RegistryProvider } from '../src/lib/engine/records';
import { cosine, inverseDocumentFrequency, tfidfVector, tokenize } from '../src/lib/engine/tfidf';
import { computeTemplateSimilarity } from '../src/lib/engine/templateSimilarity';
import { imageSize, imageTooLarge } from '../src/lib/server/fileValidation';
import { checkRateLimit, clientKey, resetRateLimit } from '../src/lib/server/rateLimit';

const today = '2026-10-26';
const sample = (n: string) => readFileSync(path.join(process.cwd(), 'samples', n), 'utf8');
const run = (text: string, extra = {}) => analyse(text, { today, extractor: heuristicExtractor, ...extra });

describe('registry comparison: consistent / altered / unverified', () => {
  it('CONSISTENT: every field matches the demo record, and it still is not called verified', async () => {
    const r = await run(sample('gst_show_cause.txt'));
    expect(r.recordComparison?.status).toBe('consistent');
    expect(r.recordComparison?.source).toBe('synthetic_demo');
    expect(r.recordComparison?.sourceLabel).toMatch(/not an official record/);
    expect(r.recordComparison?.fields.filter((f) => f.result === 'match').length).toBeGreaterThanOrEqual(4);
    expect(r.authenticity?.status).not.toBe('verified' as never);
  });

  it('ALTERED: a changed amount and a misspelt sender are caught', async () => {
    const r = await run(sample('gst_show_cause_ALTERED.txt'));
    const rc = r.recordComparison!;
    expect(rc.status).toBe('differs');
    expect(rc.fields.find((f) => f.field === 'amount')?.result).toBe('mismatch');
    expect(rc.fields.find((f) => f.field === 'sender')?.result).toBe('near_miss');
    expect(r.authenticity?.status).toBe('warning_signs');
    expect(r.authenticity?.checks.find((c) => c.id === 'registry-comparison')?.result).toBe('warning');
    expect(r.professional.recommendation).toBe('yes');
  });

  it('UNVERIFIED: an identifier that is not in the registry is "no record", not "fake"', async () => {
    const r = await run(sample('gst_show_cause_UNVERIFIED.txt'));
    expect(r.recordComparison?.status).toBe('no_record');
    expect(r.recordComparison?.summary).toMatch(/not evidence either way/);
  });

  it('flags an identifier one or two characters away from a record (scan error or alteration)', async () => {
    const r = await run(sample('gst_show_cause.txt').replace('DEMO/SCN/2026/0412', 'DEMO/SCN/2026/0421'));
    expect(r.recordComparison?.status).toBe('differs');
    expect(r.recordComparison?.nearestRecordId).toBe('DEMO/SCN/2026/0412');
  });

  it('works with a different registry provider (the engine only depends on the interface)', async () => {
    const custom: RegistryProvider = createSyntheticRegistry([
      { id: 'DEMO/LN/2026/0001', noticeType: 'legal_notice', sender: 'Advocate Demo Rao, Law Chambers, Bengaluru', amountInr: 85_000, noticeDate: '2026-10-01', sections: [] },
    ]);
    const r = await run(sample('legal_notice_unclear_start.txt').replace('Date: 01/10/2026', 'Date: 01/10/2026\nRef No: DEMO/LN/2026/0001'), { registry: custom });
    expect(r.recordComparison?.recordId).toBe('DEMO/LN/2026/0001');
  });

  it('says so when the notice has no identifier', async () => {
    const r = await run(sample('legal_notice_unclear_start.txt'));
    expect(r.recordComparison?.status).toBe('no_record');
  });
});

describe('experimental template similarity', () => {
  it('uses real TF-IDF cosine maths', () => {
    const docs = [tokenize('show cause notice gst tax'), tokenize('cheque dishonoured notice bank')];
    const idf = inverseDocumentFrequency(docs);
    const a = tfidfVector(docs[0], idf);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
    expect(cosine(a, tfidfVector(docs[1], idf))).toBeLessThan(0.5);
    expect(cosine(new Map(), a)).toBe(0);
  });
  it('ranks the matching template first for each sample, and labels itself experimental', () => {
    const gst = computeTemplateSimilarity(sample('gst_show_cause.txt'));
    expect(gst.scores[0].type).toBe('gst_show_cause');
    expect(gst.experimental).toBe(true);
    expect(gst.note).toMatch(/not an authenticity check/);
    expect(computeTemplateSimilarity(sample('cheque_bounce_138.txt')).scores[0].type).toBe('cheque_bounce_138');
    expect(computeTemplateSimilarity(sample('income_tax_intimation.txt')).scores[0].type).toBe('it_intimation');
  });
  it('gives no best match for unrelated text', () => {
    expect(computeTemplateSimilarity('Thank you for your order of chairs. Lunch is at noon on Friday.').bestMatch).toBeNull();
  });
  it('is kept separate from the authenticity checks and never changes the recommendation', async () => {
    const r = await run(sample('income_tax_intimation.txt'));
    expect(r.templateSimilarity).toBeDefined();
    expect(r.authenticity?.checks.some((c) => /similar/i.test(c.label))).toBe(false);
  });
});

describe('OCR provenance: results are never more certain than their inputs', () => {
  const text = sample('cheque_bounce_138.txt');
  it('marks OCR-derived dates and the dependent deadline as needing review', async () => {
    const r = await run(text, { source: { method: 'ocr', ocrConfidence: 93 } });
    expect(r.deadline.date).toBe('2026-10-23');
    expect(r.deadline.needsReview).toBe(true);
    expect(r.deadline.dependsOn).toEqual(expect.arrayContaining(['notice_date', 'receipt_date']));
    expect(r.fields?.find((f) => f.field === 'receipt_date')).toMatchObject({ status: 'needs_review', source: 'ocr' });
    expect(r.chain.decision).toMatch(/Provisional/);
    expect(r.professional.reasons.join(' ')).toMatch(/image|unclear/);
    expect(r.extraction.warnings.join(' ')).toMatch(/OCR/);
  });
  it('adds a low-confidence warning below the OCR threshold', async () => {
    const r = await run(text, { source: { method: 'ocr', ocrConfidence: 49 } });
    expect(r.extraction.warnings.join(' ')).toMatch(/confidence is low/);
  });
  it('does not flag review for text-based sources', async () => {
    for (const method of ['text', 'pdf_text'] as const) {
      const r = await run(text, { source: { method } });
      expect(r.deadline.needsReview).toBeUndefined();
      expect(r.fields?.find((f) => f.field === 'receipt_date')?.status).toBe('checked');
    }
  });
  it('reports a missing field as not_found rather than inventing it', async () => {
    const r = await run(sample('legal_notice_unclear_start.txt'));
    expect(r.fields?.find((f) => f.field === 'receipt_date')).toMatchObject({ status: 'not_found', value: null });
  });
});

describe('user-entered facts (human in the loop)', () => {
  it('resolves an unclear deadline when the user supplies the date they received the notice', async () => {
    const base = await run(sample('legal_notice_unclear_start.txt'));
    expect(base.deadline.status).toBe('unclear');
    const r = await run(sample('legal_notice_unclear_start.txt'), { overrides: { receiptDate: '2026-10-05' } });
    expect(r.deadline).toMatchObject({ status: 'computed', date: '2026-10-20' });
    expect(r.fields?.find((f) => f.field === 'receipt_date')).toMatchObject({ status: 'checked', source: 'user' });
    expect(r.claims.some((c) => c.label.includes('entered by you') && c.evidence.length === 0)).toBe(true);
  });
  it('lets the user fix a date the reader could not understand', async () => {
    const hard = sample('gst_show_cause.txt').replace('11/11/2026', 'the eleventh of November, 2026');
    expect((await run(hard)).deadline.status).not.toBe('stated');
    const r = await run(hard, { overrides: { dueDate: '2026-11-11' } });
    expect(r.deadline).toMatchObject({ status: 'stated', date: '2026-11-11' });
  });
  it('lets the user set the notice type and the response period', async () => {
    const r = await run('Please settle the amount of Rs. 5,000/- as soon as possible. Date: 02/10/2026', {
      overrides: { noticeType: 'legal_notice', period: { n: 10, unit: 'days', anchor: 'notice_date' } },
    });
    expect(r.noticeType).toBe('legal_notice');
    expect(r.deadline).toMatchObject({ status: 'computed', date: '2026-10-12' });
  });
  it('rejects impossible override values', async () => {
    await expect(run(sample('gst_show_cause.txt'), { overrides: { receiptDate: '2026-02-30' } })).rejects.toBeInstanceOf(AnalyseInputError);
    await expect(run(sample('gst_show_cause.txt'), { overrides: { period: { n: 0, unit: 'days', anchor: 'receipt' } } })).rejects.toBeInstanceOf(AnalyseInputError);
  });
});

describe('unknown notices still get a safe, limited analysis', () => {
  it('uses only dates the notice states, says the scope is limited, and never invents a legal period', async () => {
    const r = await run('Kindly note that the amount of Rs. 9,000/- must be paid on or before 05/11/2026 without fail. Date: 01/10/2026');
    expect(r.noticeType).toBe('unknown');
    expect(r.deadline).toMatchObject({ status: 'stated', date: '2026-11-05' });
    expect(r.extraction.warnings.join(' ')).toMatch(/limited analysis/);
    expect(r.professional.recommendation).not.toBe('no');
    expect(r.authenticity).toBeDefined();
    expect(r.checklist.length).toBeGreaterThan(0);
  });
  it('abstains on an unknown notice that only gives a period from receipt', async () => {
    const r = await run('Kindly pay Rs. 9,000/- within 10 days of receipt of this letter. Date: 01/10/2026');
    expect(r.deadline.status).toBe('unclear');
    expect(r.deadline.date).toBeUndefined();
  });
});

describe('upload safety helpers', () => {
  it('reads PNG dimensions from the header', () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x04, 0xe2, 0, 0, 0x01, 0x4a]);
    expect(imageSize(png, 'png')).toEqual({ width: 1250, height: 330 });
  });
  it('measures a real JPEG and flags oversized images', () => {
    expect(imageTooLarge({ width: 20_000, height: 100 })).toBe(true);
    expect(imageTooLarge({ width: 9_000, height: 9_000 })).toBe(true);
    expect(imageTooLarge({ width: 4_000, height: 3_000 })).toBe(false);
    expect(imageTooLarge(null)).toBe(false);
  });
});

describe('rate limit identity cannot be spoofed with a forged header', () => {
  const req = (xff?: string) => new Request('http://localhost/x', { headers: xff ? { 'x-forwarded-for': xff } : {} });
  it('ignores X-Forwarded-For unless the proxy is trusted', () => {
    expect(clientKey(req('1.1.1.1'), {})).toBe('shared');
    expect(clientKey(req('2.2.2.2'), {})).toBe('shared');
  });
  it('uses the LAST entry (added by your own proxy) when trusted', () => {
    const env = { TRUST_PROXY_HEADERS: 'true' };
    expect(clientKey(req('forged.1.1.1, 9.9.9.9'), env)).toBe('9.9.9.9');
    expect(clientKey(req('forged.2.2.2, 9.9.9.9'), env)).toBe('9.9.9.9');
  });
  it('a forged header cannot escape the limit', () => {
    resetRateLimit();
    for (let i = 0; i < 3; i++) checkRateLimit(clientKey(req(`10.0.0.${i}`), {}), 3);
    expect(checkRateLimit(clientKey(req('10.0.0.99'), {}), 3).ok).toBe(false);
  });
});
