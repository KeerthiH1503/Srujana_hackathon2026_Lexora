import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyse } from '../src/lib/engine/analyse';
import { checkAuthenticity } from '../src/lib/engine/authenticity';
import { heuristicExtractor } from '../src/lib/engine/extractors/heuristic';
import { levenshtein, similarityRatio, tokenJaccard } from '../src/lib/engine/similarity';

const sample = (n: string) => readFileSync(path.join(process.cwd(), 'samples', n), 'utf8');
const get = (a: ReturnType<typeof checkAuthenticity>, id: string) => a.checks.find((c) => c.id === id)!;

describe('string similarity', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });
  it('scores near-identical names high and unrelated names low', () => {
    expect(similarityRatio('Income Tax Departmant', 'Income Tax Department')).toBeGreaterThan(0.9);
    expect(similarityRatio('Income Tax Department', 'Income Tax Department')).toBe(1);
    expect(similarityRatio('Sample Traders', 'Income Tax Department')).toBeLessThan(0.5);
  });
  it('compares word sets', () => {
    expect(tokenJaccard('income tax department', 'department of income tax')).toBeCloseTo(0.75, 2);
  });
});

describe('authenticity signals', () => {
  it('flags every deliberate warning sign in the suspicious sample', () => {
    const a = checkAuthenticity(sample('income_tax_suspicious.txt'), 'it_intimation');
    expect(a.status).toBe('warning_signs');
    expect(get(a, 'domains').result).toBe('warning');
    expect(get(a, 'payment-route').result).toBe('warning');
    expect(get(a, 'pressure').result).toBe('warning');
    expect(get(a, 'sender-name').result).toBe('warning');
    expect(get(a, 'sender-name').detail).toMatch(/Departmant/);
    expect(get(a, 'identifier').result).toBe('warning');
    expect(a.officialVerification[0].url).toContain('incometax.gov.in');
  });

  it('every evidence quote it shows really is in the notice', () => {
    const text = sample('income_tax_suspicious.txt');
    for (const c of checkAuthenticity(text, 'it_intimation').checks) {
      if (c.evidence) {
        expect(c.evidence.foundInText).toBe(true);
        expect(text.slice(c.evidence.start, c.evidence.end)).toBe(c.evidence.quote);
      }
    }
  });

  it('NEVER reports a notice as verified, even when nothing is wrong', () => {
    const clean = 'Income Tax Department - Centralized Processing Centre\nDIN & Notice No: ITBA/AST/S/143(1)/2026-27/1067890123(1)\nPlease respond on the e-Filing portal https://www.incometax.gov.in within 30 days.';
    const a = checkAuthenticity(clean, 'it_intimation');
    expect(a.status).toBe('unverified');
    expect(get(a, 'identifier').result).toBe('found');
    expect(get(a, 'sender-name').result).toBe('found');
    expect(get(a, 'domains').result).toBe('found');
    expect(get(a, 'digital-signature').result).toBe('not_checked');
    expect(a.summary).toMatch(/does not mean the notice is genuine/);
  });

  it('does not apply government-domain checks to private legal notices', () => {
    const a = checkAuthenticity('Advocate Demo Rao, reachable at demo.rao@gmail.com. Pay within 15 days.', 'legal_notice');
    expect(a.checks.find((c) => c.id === 'domains')).toBeUndefined();
    expect(a.status).toBe('unverified');
    expect(a.officialVerification[0].label).toMatch(/No single public service/);
  });

  it('points GST notices to the RFN and CBIC DIN services', () => {
    const urls = checkAuthenticity('Show cause notice GSTIN 29ABCDE0000A1Z5', 'gst_show_cause').officialVerification.map((v) => v.url);
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining('gst.gov.in'), expect.stringContaining('cbic-gst.gov.in')]));
  });

  it('is attached to every analysis and pushes the recommendation to see a professional', async () => {
    const r = await analyse(sample('income_tax_suspicious.txt'), { today: '2026-10-26', extractor: heuristicExtractor });
    expect(r.authenticity?.status).toBe('warning_signs');
    expect(r.extraction.method).toBe('rules');
    expect(r.professional.recommendation).not.toBe('no');
    expect(r.professional.reasons.join(' ')).toMatch(/Warning signs/);
  });

  it('does not change the genuine-looking income tax sample from "no professional needed"', async () => {
    const r = await analyse(sample('income_tax_intimation.txt'), { today: '2026-10-26', extractor: heuristicExtractor });
    expect(r.authenticity?.status).toBeDefined();
    expect(r.authenticity?.status).not.toBe('verified' as never);
  });
});
