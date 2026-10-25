import { describe, expect, it } from 'vitest';
import { assessTextQuality, findQuote, verifyQuote } from '../src/lib/engine/text';

const NOTICE = 'You are hereby\ndirected to pay Rs. 85,000/- within\n  15 days of receipt of this notice.';

describe('findQuote / verifyQuote', () => {
  it('finds an exact quote and returns offsets that slice back to the text', () => {
    const q = 'within\n  15 days of receipt';
    const hit = findQuote(NOTICE, q);
    expect(hit).not.toBeNull();
    expect(NOTICE.slice(hit!.start, hit!.end)).toBe(q);
  });

  it('tolerates different whitespace and line breaks', () => {
    const ev = verifyQuote(NOTICE, 'hereby directed to pay Rs. 85,000/- within 15 days');
    expect(ev.foundInText).toBe(true);
    expect(NOTICE.slice(ev.start, ev.end)).toBe(ev.quote);
  });

  it('tolerates curly quotes and letter case', () => {
    expect(verifyQuote('He said \u201Cpay now\u201D today', 'said "PAY NOW" today').foundInText).toBe(true);
  });

  it('rejects text that is not in the notice', () => {
    const ev = verifyQuote(NOTICE, 'within 30 days of the order');
    expect(ev.foundInText).toBe(false);
    expect(ev.start).toBe(-1);
  });

  it('rejects very short quotes that would match anywhere', () => {
    expect(findQuote(NOTICE, 'to')).toBeNull();
  });
});

describe('assessTextQuality', () => {
  it('accepts normal notice text', () => {
    expect(assessTextQuality('You are hereby directed to submit your reply within 30 days from the date of this notice, failing which action will be taken.').quality).toBe('good');
  });
  it('flags garbled OCR', () => {
    expect(assessTextQuality('N0t1ce Und3r Sect10n 7? 0f th3 CG5T Act 0ff1ce 0f the C0mm1ss1on3r d@te 1?/1O/2O26').quality).toBe('poor');
  });
  it('flags almost-empty text', () => {
    expect(assessTextQuality('hello').quality).toBe('poor');
  });
});
