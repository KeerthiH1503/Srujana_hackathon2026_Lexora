// Reads a response/payment period such as "within fifteen (15) days of receipt of this notice".
// The period is parsed from the QUOTED notice text by code, not trusted from the model.

export type PeriodAnchor = 'receipt' | 'notice_date' | 'unspecified';

export type Period = {
  n: number;
  unit: 'days' | 'months';
  anchor: PeriodAnchor;
  quote: string;
  /** Set when the wording cannot be read to a single reliable period. */
  problem?: 'multiple' | 'inconsistent';
};

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
export const NUM_WORD =
  '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';

export function wordToNumber(words: string): number | null {
  const tokens = words.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 2) return null;
  let total = 0;
  for (const t of tokens) {
    if (t in ONES) total += ONES[t];
    else if (t in TENS) total += TENS[t];
    else return null;
  }
  return total;
}

export const PERIOD_RE = new RegExp(
  `\\b(?:(\\d{1,3})|(${NUM_WORD}(?:[\\s-]${NUM_WORD})?))\\s*(?:\\(\\s*([A-Za-z0-9\\s-]{1,25}?)\\s*\\)\\s*)?(days?|weeks?|months?)\\b`,
  'gi',
);

function detectAnchor(context: string): PeriodAnchor {
  const c = context.toLowerCase();
  const receipt = /\b(receipt|receiving|receive|received|service of|served|delivery|delivered)\b/.test(c);
  const noticeDate = /\bdate of (this |the |issue|issuance|notice|letter|intimation)|from the date hereof|date hereof|from the date of issue|of issue of this|from the date of this\b/.test(c);
  if (receipt && !noticeDate) return 'receipt';
  if (noticeDate && !receipt) return 'notice_date';
  return 'unspecified';
}

/**
 * Parses a period from a quote. Returns null when no period is present.
 * When several different periods appear, or digits and words disagree,
 * the result carries a `problem` so the deadline engine abstains.
 */
export function parsePeriod(quote: string): Period | null {
  PERIOD_RE.lastIndex = 0;
  const found: { n: number; unit: 'days' | 'months'; end: number; inconsistent: boolean }[] = [];
  for (const m of quote.matchAll(PERIOD_RE)) {
    let n: number | null = null;
    let inconsistent = false;
    const digits = m[1] !== undefined ? Number(m[1]) : null;
    const words = m[2] !== undefined ? wordToNumber(m[2]) : null;
    const paren = m[3];
    const parenNum = paren === undefined ? null : /^\d+$/.test(paren.trim()) ? Number(paren.trim()) : wordToNumber(paren);
    const main = digits ?? words;
    if (main === null) continue;
    n = main;
    if (parenNum !== null && parenNum !== main) inconsistent = true;
    const unitRaw = m[4].toLowerCase();
    if (unitRaw.startsWith('week')) n *= 7;
    const unit: 'days' | 'months' = unitRaw.startsWith('month') ? 'months' : 'days';
    found.push({ n, unit, end: (m.index ?? 0) + m[0].length, inconsistent });
  }
  if (found.length === 0) return null;
  const distinct = new Set(found.map((f) => `${f.n}-${f.unit}`));
  const first = found[0];
  const after = quote.slice(first.end, first.end + 80).split(/[.;,\n]/)[0];
  const period: Period = {
    n: first.n,
    unit: first.unit,
    anchor: detectAnchor(after),
    quote,
  };
  if (distinct.size > 1) period.problem = 'multiple';
  else if (found.some((f) => f.inconsistent)) period.problem = 'inconsistent';
  return period;
}
