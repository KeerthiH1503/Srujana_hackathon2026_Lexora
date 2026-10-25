import { describe, expect, it } from 'vitest';
import { loadCases, runCase, summarize } from '../bench/bench';
import { heuristicExtractor } from '../src/lib/engine/extractors/heuristic';

describe('benchmark', () => {
  it('has 12 to 15 synthetic cases covering the required categories', async () => {
    const cases = await loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.length).toBeLessThanOrEqual(15);
    const cats = cases.map((c) => c.category).join(' | ');
    for (const need of ['clear notice', 'ambiguous start date', 'missing information', 'conflicting dates', 'unsupported claim', 'poor quality', 'non-notice', 'high risk']) {
      expect(cats, need).toContain(need);
    }
    for (const c of cases) expect(c.text, c.id).toMatch(/SYNTHETIC SAMPLE|^[\s\S]{40,}/);
  });

  it('SAFETY INVARIANT: never returns a date where the expected answer is "undeterminable"', async () => {
    const cases = await loadCases();
    for (const c of cases.filter((x) => x.expected.deadline.kind === 'undeterminable')) {
      const o = await runCase(c, heuristicExtractor);
      expect(o.result?.deadline.date, c.id).toBeUndefined();
    }
  });

  it('never marks a case with invented claims as fully supported', async () => {
    const cases = await loadCases();
    const stress = cases.find((c) => c.stress)!;
    const o = await runCase(stress, heuristicExtractor);
    expect(o.pass).toBe(true);
    expect(o.result!.claims.some((c) => c.evidence.some((e) => !e.foundInText))).toBe(true);
  });

  it('computes metrics with the documented definitions', async () => {
    const cases = await loadCases();
    const outcomes = [];
    for (const c of cases) outcomes.push(await runCase(c, heuristicExtractor));
    const s = summarize(outcomes, 'heuristic', new Date('2026-10-25T00:00:00Z'));
    expect(s.total).toBe(cases.length);
    expect(s.handled + s.abstained).toBe(s.total);
    for (const v of Object.values(s.metrics)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    const needDate = cases.filter((c) => c.expected.deadline.kind === 'date').length;
    const correct = outcomes.filter((o) => o.case.expected.deadline.kind === 'date' && o.result?.deadline.date === (o.case.expected.deadline as { date: string }).date).length;
    expect(s.metrics.deadlineCorrectness).toBe(Math.round((correct / needDate) * 1000) / 10);
    expect(s.cases).toHaveLength(cases.length);
    expect(s.extractor).toBe('heuristic');
  });

  it('keeps the two known-hard cases honest: they are reported as failures, not hidden', async () => {
    const cases = await loadCases();
    const hard = cases.filter((c) => c.hard);
    expect(hard.length).toBeGreaterThanOrEqual(2);
    for (const c of hard) {
      const o = await runCase(c, heuristicExtractor);
      expect(o.pass, `${c.id} should be a known failure of the rule-based extractor`).toBe(false);
      expect(o.result?.deadline.date, `${c.id} must abstain, not guess`).toBeUndefined();
    }
  });
});
