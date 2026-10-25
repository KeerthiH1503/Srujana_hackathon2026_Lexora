import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, findDates, isLeapYear, isValidYMD, parseSingleDate, todayIST } from '../src/lib/engine/dates';

describe('calendar arithmetic', () => {
  it('knows leap years', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isValidYMD(2028, 2, 29)).toBe(true);
    expect(isValidYMD(2027, 2, 29)).toBe(false);
    expect(isValidYMD(2026, 2, 31)).toBe(false);
    expect(isValidYMD(2026, 13, 1)).toBe(false);
  });
  it('adds days across months, years and a leap day', () => {
    expect(addDays('2026-10-15', 30)).toBe('2026-11-14');
    expect(addDays('2026-12-20', 15)).toBe('2027-01-04');
    expect(addDays('2028-02-20', 15)).toBe('2028-03-06');
    expect(addDays('2027-02-20', 15)).toBe('2027-03-07');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('adds months and clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
  it('counts days between dates, negative when earlier', () => {
    expect(daysBetween('2026-10-26', '2026-11-11')).toBe(16);
    expect(daysBetween('2026-10-26', '2026-10-23')).toBe(-3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
  it('gives todays date in India time', () => {
    // 2026-10-24 20:00 UTC is already 25 Oct in India (UTC+5:30)
    expect(todayIST(new Date('2026-10-24T20:00:00Z'))).toBe('2026-10-25');
    expect(todayIST(new Date('2026-10-24T10:00:00Z'))).toBe('2026-10-24');
  });
});

describe('date parsing', () => {
  it.each([
    ['12/10/2026', '2026-10-12'],
    ['12-10-2026', '2026-10-12'],
    ['12.10.2026', '2026-10-12'],
    ['2026-10-12', '2026-10-12'],
    ['12 October 2026', '2026-10-12'],
    ['12th October, 2026', '2026-10-12'],
    ['1st day of November 2026', '2026-11-01'],
    ['12-Oct-2026', '2026-10-12'],
    ['October 12, 2026', '2026-10-12'],
    ['29/02/2028', '2028-02-29'],
  ])('reads %s as %s', (text, iso) => {
    const r = parseSingleDate(`on or before ${text}.`);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.iso).toBe(iso);
  });
  it('treats numeric dates as day first (Indian convention)', () => {
    const r = parseSingleDate('05/10/2026');
    expect(r.kind === 'ok' && r.iso).toBe('2026-10-05');
  });
  it('refuses dates that do not exist', () => {
    expect(parseSingleDate('31/02/2026').kind).toBe('invalid');
    expect(parseSingleDate('29/02/2027').kind).toBe('invalid');
  });
  it('refuses two different dates in one quote', () => {
    expect(parseSingleDate('12/10/2026 and 15/10/2026').kind).toBe('multiple');
  });
  it('allows the same date written once or twice', () => {
    expect(parseSingleDate('12/10/2026 (12th October 2026)').kind).toBe('ok');
  });
  it('returns none when there is no date, and refuses two-digit years', () => {
    expect(parseSingleDate('as soon as possible').kind).toBe('none');
    expect(parseSingleDate("15 Oct '26").kind).toBe('none');
  });
  it('does not read reference numbers as dates', () => {
    expect(findDates('Ref No: DEMO/SCN/2026/0412 GSTIN 29ABCDE0000A1Z5')).toHaveLength(0);
  });
});
