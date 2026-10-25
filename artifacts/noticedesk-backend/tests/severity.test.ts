import { describe, expect, it } from 'vitest';
import { recommendProfessional, scoreSeverity } from '../src/lib/engine/severity';
import type { AnalysisResult } from '../src/types/analysis';

const okDeadline = (daysLeft: number): AnalysisResult['deadline'] => ({
  status: 'computed',
  date: '2026-11-14',
  daysLeft,
  source: { ruleId: 'R-COUNT-DAYS', ruleVerified: true },
});
const unclear: AnalysisResult['deadline'] = { status: 'unclear', source: { ruleVerified: false } };

describe('severity', () => {
  it('scores a calm income tax intimation as routine', () => {
    const s = scoreSeverity({ noticeType: 'it_intimation', text: 'Please respond within 30 days.', amountInr: 18_500, deadline: okDeadline(19), extractionPoor: false });
    expect(s.level).toBe('routine');
    expect(s.factors.filter((f) => f.fired)).toHaveLength(1);
  });
  it('scores a section 138 notice with a near deadline and a large amount as see_professional_now', () => {
    const s = scoreSeverity({
      noticeType: 'cheque_bounce_138',
      text: 'criminal prosecution and imprisonment',
      amountInr: 1_200_000,
      deadline: okDeadline(5),
      extractionPoor: false,
    });
    expect(s.level).toBe('see_professional_now');
    expect(s.score).toBeLessThanOrEqual(100);
  });
  it('adds weight when the deadline has passed or is unclear', () => {
    const passed = scoreSeverity({ noticeType: 'legal_notice', text: '', amountInr: null, deadline: okDeadline(-2), extractionPoor: false });
    expect(passed.factors.find((f) => f.label === 'Deadline has already passed')?.fired).toBe(true);
    const un = scoreSeverity({ noticeType: 'legal_notice', text: '', amountInr: null, deadline: unclear, extractionPoor: false });
    expect(un.factors.find((f) => f.label === 'Deadline could not be established')?.fired).toBe(true);
  });
  it('detects ex-parte / penalty and legal-action wording', () => {
    const s = scoreSeverity({ noticeType: 'gst_show_cause', text: 'decided ex-parte; appropriate legal action', amountInr: null, deadline: okDeadline(20), extractionPoor: false });
    expect(s.factors.filter((f) => f.fired).map((f) => f.weight)).toEqual(expect.arrayContaining([20, 20]));
  });
});

describe('professional recommendation', () => {
  const base = { noticeType: 'it_intimation' as const, severity: { level: 'routine' as const }, deadline: okDeadline(19), unverifiedClaims: 0, typeUncertain: false, extractionPoor: false, isNotice: true };
  it('says no only when everything is routine and verified', () => {
    expect(recommendProfessional(base).recommendation).toBe('no');
  });
  it('says probably when the deadline is unclear', () => {
    expect(recommendProfessional({ ...base, deadline: unclear }).recommendation).toBe('probably');
  });
  it('says probably when claims could not be verified', () => {
    expect(recommendProfessional({ ...base, unverifiedClaims: 2 }).recommendation).toBe('probably');
  });
  it('always says yes for a section 138 notice', () => {
    expect(recommendProfessional({ ...base, noticeType: 'cheque_bounce_138' }).recommendation).toBe('yes');
  });
  it('says yes for a conflict or a passed deadline', () => {
    expect(recommendProfessional({ ...base, deadline: { status: 'conflict', source: { ruleVerified: true } } }).recommendation).toBe('yes');
    expect(recommendProfessional({ ...base, deadline: okDeadline(-1) }).recommendation).toBe('yes');
  });
  it('always gives at least one reason', () => {
    expect(recommendProfessional(base).reasons.length).toBeGreaterThan(0);
  });
});
