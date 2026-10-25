// Deterministic date helpers. All arithmetic is done in UTC on whole days,
// so there are no time-zone or daylight-saving surprises.

export type ISODate = string; // YYYY-MM-DD

const MS_PER_DAY = 86_400_000;

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_RE =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function isValidYMD(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1990 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function toUTC(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(t: number): ISODate {
  const dt = new Date(t);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function isISODate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && isValidYMD(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** Adds calendar days (the start day itself is NOT counted: addDays(d, 1) is the next day). */
export function addDays(iso: ISODate, n: number): ISODate {
  return fromUTC(toUTC(iso) + n * MS_PER_DAY);
}

/** Adds calendar months; if the target month is shorter the date is clamped to its last day. */
export function addMonths(iso: ISODate, n: number): ISODate {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: ISODate, toIso: ISODate): number {
  return Math.round((toUTC(toIso) - toUTC(fromIso)) / MS_PER_DAY);
}

/** Today's date in India (IST, UTC+5:30) as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): ISODate {
  return fromUTC(now.getTime() + 5.5 * 3_600_000);
}

export type DateHit = {
  /** null when the text looked like a date but is not a real calendar date (e.g. 31/02/2026). */
  iso: ISODate | null;
  text: string;
  index: number;
};

const PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => [number, number, number] }[] = [
  // 2026-10-12, 2026/10/12
  {
    re: /(?<![\d/.\-])(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})(?!\d)/g,
    build: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
  },
  // 12/10/2026, 12-10-2026, 12.10.2026  (Indian convention: day first)
  {
    re: /(?<![\d/.\-])(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?!\d)/g,
    build: (m) => [Number(m[3]), Number(m[2]), Number(m[1])],
  },
  // 12 October 2026, 12th Oct, 2026, 12th day of October 2026, 12-Oct-2026
  {
    re: new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+day)?(?:\\s+of)?[\\s,.\\-]*${MONTH_RE}\\b\\.?[\\s,.\\-]*(\\d{4})(?!\\d)`, 'gi'),
    build: (m) => [Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])],
  },
  // October 12, 2026
  {
    re: new RegExp(`\\b${MONTH_RE}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,|\\s)\\s*(\\d{4})(?!\\d)`, 'gi'),
    build: (m) => [Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])],
  },
];

/** Finds every date-looking string in `text`, in order, without overlaps. */
export function findDates(text: string): DateHit[] {
  const raw: DateHit[] = [];
  for (const { re, build } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const [y, mo, d] = build(m as RegExpExecArray);
      raw.push({
        iso: isValidYMD(y, mo, d) ? toISO(y, mo, d) : null,
        text: m[0],
        index: m.index ?? 0,
      });
    }
  }
  raw.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const out: DateHit[] = [];
  let lastEnd = -1;
  for (const hit of raw) {
    if (hit.index < lastEnd) continue;
    out.push(hit);
    lastEnd = hit.index + hit.text.length;
  }
  return out;
}

export type SingleDate =
  | { kind: 'ok'; iso: ISODate; hit: DateHit }
  | { kind: 'none' }
  | { kind: 'invalid'; hit: DateHit }
  | { kind: 'multiple'; hits: DateHit[] };

/** Parses a quote that is expected to contain exactly one date. Never guesses. */
export function parseSingleDate(text: string): SingleDate {
  const hits = findDates(text);
  if (hits.length === 0) return { kind: 'none' };
  const valid = hits.filter((h) => h.iso !== null);
  const distinct = new Set(valid.map((h) => h.iso));
  if (hits.length > valid.length && valid.length === 0) return { kind: 'invalid', hit: hits[0] };
  if (distinct.size > 1 || (hits.length > valid.length && valid.length > 0)) return { kind: 'multiple', hits };
  return { kind: 'ok', iso: valid[0].iso as ISODate, hit: valid[0] };
}
