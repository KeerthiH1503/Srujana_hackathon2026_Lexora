import { describe, expect, it } from 'vitest';
import { parsePeriod, wordToNumber } from '../src/lib/engine/period';
import { findAmounts, parseAmountInr } from '../src/lib/engine/amounts';

describe('parsePeriod', () => {
  it('reads digits and the receipt anchor', () => {
    const p = parsePeriod('within 15 days of receipt of this notice');
    expect(p).toMatchObject({ n: 15, unit: 'days', anchor: 'receipt' });
    expect(p?.problem).toBeUndefined();
  });
  it('reads words with a matching bracketed number', () => {
    expect(parsePeriod('within fifteen (15) days from the date of this notice')).toMatchObject({ n: 15, anchor: 'notice_date' });
  });
  it('reads compound number words', () => {
    expect(wordToNumber('forty five')).toBe(45);
    expect(wordToNumber('twenty-one')).toBe(21);
    expect(parsePeriod('within forty-five days of service')?.n).toBe(45);
  });
  it('converts weeks to days and recognises months', () => {
    expect(parsePeriod('within 2 weeks of receipt')).toMatchObject({ n: 14, unit: 'days' });
    expect(parsePeriod('within one month of receipt')).toMatchObject({ n: 1, unit: 'months', anchor: 'receipt' });
  });
  it('recognises months with digits', () => {
    expect(parsePeriod('within 1 month from the date of issue')).toMatchObject({ n: 1, unit: 'months', anchor: 'notice_date' });
  });
  it('marks an unclear anchor as unspecified', () => {
    expect(parsePeriod('within 15 days of this notice')?.anchor).toBe('unspecified');
    expect(parsePeriod('within 15 days')?.anchor).toBe('unspecified');
  });
  it('flags inconsistent words and digits', () => {
    expect(parsePeriod('within fifteen (30) days of receipt')?.problem).toBe('inconsistent');
  });
  it('flags several different periods', () => {
    expect(parsePeriod('pay within 15 days of receipt and file within 30 days')?.problem).toBe('multiple');
  });
  it('returns null when there is no period', () => {
    expect(parsePeriod('please reply at the earliest')).toBeNull();
  });
});

describe('amounts', () => {
  it('reads Indian-format rupee amounts', () => {
    expect(parseAmountInr('Rs. 3,45,000/-')).toBe(345000);
    expect(parseAmountInr('₹ 50,000')).toBe(50000);
    expect(parseAmountInr('INR 2.5 lakh')).toBe(250000);
    expect(parseAmountInr('Rs 1.2 crore')).toBe(12_000_000);
    expect(parseAmountInr('Rs. 12,00,000/- was dishonoured')).toBe(1_200_000);
  });
  it('ignores text without an amount', () => {
    expect(findAmounts('invoice number 118 dated 12/10/2026')).toHaveLength(0);
  });
});
