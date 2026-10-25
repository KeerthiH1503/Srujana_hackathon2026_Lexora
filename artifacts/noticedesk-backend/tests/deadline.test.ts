import { describe, expect, it } from 'vitest';
import { buildDateFact, computeDeadline, type DeadlineFacts } from '../src/lib/engine/deadline';
import { parsePeriod } from '../src/lib/engine/period';

const none: DeadlineFacts = { noticeDate: null, receiptDate: null, dueDate: null, period: null };
const today = '2026-10-26';
const run = (noticeType: Parameters<typeof computeDeadline>[0]['noticeType'], facts: Partial<DeadlineFacts>, hints = {}) =>
  computeDeadline({ noticeType, facts: { ...none, ...facts }, today, hints }).deadline;

describe('deadline engine', () => {
  it('uses the date stated in the notice', () => {
    const d = run('gst_show_cause', { dueDate: buildDateFact('11/11/2026') });
    expect(d).toMatchObject({ status: 'stated', date: '2026-11-11', daysLeft: 16 });
    expect(d.source.ruleId).toBe('R-STATED-DATE');
  });

  it('counts a period from the notice date, excluding the first day', () => {
    const d = run('legal_notice', { noticeDate: buildDateFact('12/10/2026'), period: parsePeriod('within 20 days from the date of this notice') });
    expect(d).toMatchObject({ status: 'computed', date: '2026-11-01' });
  });

  it('counts a receipt-based period from the date of receipt, not the notice date', () => {
    const d = run('legal_notice', {
      noticeDate: buildDateFact('01/10/2026'),
      receiptDate: buildDateFact('05/10/2026'),
      period: parsePeriod('within 15 days of receipt of this notice'),
    });
    expect(d.date).toBe('2026-10-20'); // 5 Oct + 15, NOT 1 Oct + 15
  });

  it('refuses to guess when the period runs from receipt but receipt is unknown', () => {
    const d = run('legal_notice', { noticeDate: buildDateFact('01/10/2026'), period: parsePeriod('within 15 days of receipt of this notice') });
    expect(d.status).toBe('unclear');
    expect(d.date).toBeUndefined();
    expect(d.candidates?.[0]).toMatchObject({ date: '2026-10-16' });
    expect(d.candidates?.[0].label).toMatch(/Earliest possible/);
  });

  it('refuses to guess when the anchor is not stated, and shows both candidates', () => {
    const d = run('legal_notice', {
      noticeDate: buildDateFact('01/10/2026'),
      receiptDate: buildDateFact('05/10/2026'),
      period: parsePeriod('within 15 days'),
    });
    expect(d.status).toBe('unclear');
    expect(d.candidates?.map((c) => c.date).sort()).toEqual(['2026-10-16', '2026-10-20']);
  });

  it('reports a conflict when the stated date and the counted date differ', () => {
    const d = run('legal_notice', {
      noticeDate: buildDateFact('10/10/2026'),
      dueDate: buildDateFact('30/10/2026'),
      period: parsePeriod('within 15 days from the date of this notice'),
    });
    expect(d.status).toBe('conflict');
    expect(d.date).toBeUndefined();
    expect(d.candidates?.map((c) => c.date).sort()).toEqual(['2026-10-25', '2026-10-30']);
  });

  it('accepts a stated date that agrees with the counted date', () => {
    const d = run('legal_notice', {
      noticeDate: buildDateFact('10/10/2026'),
      dueDate: buildDateFact('25/10/2026'),
      period: parsePeriod('within 15 days from the date of this notice'),
    });
    expect(d).toMatchObject({ status: 'stated', date: '2026-10-25' });
  });

  it('handles a leap year', () => {
    const d = computeDeadline({
      noticeType: 'legal_notice',
      facts: { ...none, noticeDate: buildDateFact('20/02/2028'), period: parsePeriod('within 15 days from the date of this notice') },
      today: '2028-02-25',
    }).deadline;
    expect(d.date).toBe('2028-03-06');
    expect(d.daysLeft).toBe(10);
  });

  it('applies the 15-day statutory period to a section 138 notice from the date of receipt', () => {
    const d = run('cheque_bounce_138', { noticeDate: buildDateFact('05/10/2026'), receiptDate: buildDateFact('08/10/2026') });
    expect(d).toMatchObject({ status: 'computed', date: '2026-10-23' });
    expect(d.source).toMatchObject({ ruleId: 'R-138-PAY-15', ruleVerified: true });
  });

  it('does not give a single date for a section 138 notice when receipt is unknown', () => {
    const d = run('cheque_bounce_138', { noticeDate: buildDateFact('05/10/2026') });
    expect(d.status).toBe('unclear');
    expect(d.candidates?.[0].date).toBe('2026-10-20');
  });

  it('flags a section 138 notice that demands payment sooner than the statutory 15 days', () => {
    const d = run('cheque_bounce_138', {
      noticeDate: buildDateFact('05/10/2026'),
      receiptDate: buildDateFact('08/10/2026'),
      period: parsePeriod('within 7 days of receipt of this notice'),
    });
    expect(d.status).toBe('conflict');
    expect(d.candidates?.map((c) => c.date).sort()).toEqual(['2026-10-15', '2026-10-23']);
  });

  it('uses the income tax 30-day fallback only for proposed adjustments', () => {
    const facts = { noticeDate: buildDateFact('15/10/2026') };
    expect(run('it_intimation', facts, { itProposedAdjustment: true })).toMatchObject({ status: 'computed', date: '2026-11-14' });
    expect(run('it_intimation', facts, { itProposedAdjustment: false }).status).toBe('unclear');
  });

  it('never invents a GST reply date; shows a labelled reference only', () => {
    const d = run('gst_show_cause', { noticeDate: buildDateFact('03/10/2026') });
    expect(d.status).toBe('unclear');
    expect(d.date).toBeUndefined();
    expect(d.candidates?.[0].label).toMatch(/Reference only/);
  });

  it('abstains when nothing usable is found', () => {
    expect(run('legal_notice', {}).status).toBe('unclear');
    expect(run('unknown', { noticeDate: buildDateFact('03/10/2026') }).status).toBe('unclear');
  });

  it('ignores an invalid date and says so', () => {
    const d = run('legal_notice', { noticeDate: buildDateFact('31/02/2026'), period: parsePeriod('within 15 days from the date of this notice') });
    expect(d.status).toBe('unclear');
    expect(d.note).toMatch(/not a real calendar date/);
  });

  it('abstains on ambiguous or inconsistent periods', () => {
    const multi = run('legal_notice', {
      noticeDate: buildDateFact('10/10/2026'),
      period: parsePeriod('within 15 days from the date of this notice and 30 days thereafter'),
    });
    expect(multi.status).toBe('unclear');
    const inconsistent = run('legal_notice', {
      noticeDate: buildDateFact('10/10/2026'),
      period: parsePeriod('within fifteen (30) days from the date of this notice'),
    });
    expect(inconsistent.status).toBe('unclear');
  });

  it('marks dates that have already passed', () => {
    const d = run('gst_show_cause', { dueDate: buildDateFact('20/10/2026') });
    expect(d.daysLeft).toBe(-6);
    expect(d.note).toMatch(/passed/);
  });

  it('counts month periods by calendar month', () => {
    const d = run('legal_notice', { noticeDate: buildDateFact('31/01/2027'), period: parsePeriod('within 1 month from the date of this notice') });
    expect(d.date).toBe('2027-02-28');
  });
});
