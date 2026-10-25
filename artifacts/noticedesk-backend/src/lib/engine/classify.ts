import type { NoticeType } from '../../types/analysis';

type Rule = { re: RegExp; weight: number };

const PATTERNS: Record<Exclude<NoticeType, 'unknown'>, Rule[]> = {
  gst_show_cause: [
    { re: /show[\s-]*cause/i, weight: 2 },
    { re: /\bGSTIN\b/, weight: 2 },
    { re: /\b(?:CGST|SGST|IGST)\b|goods and services tax/i, weight: 2 },
    { re: /section\s*(?:73|74A?)\b/i, weight: 2 },
    { re: /\bDRC-?0\d\b/i, weight: 2 },
    { re: /\bGST\b/, weight: 1 },
  ],
  cheque_bounce_138: [
    { re: /section\s*138\b/i, weight: 3 },
    { re: /negotiable instruments act/i, weight: 3 },
    { re: /dishono(?:u)?r(?:ed)?/i, weight: 2 },
    { re: /\bcheque\b/i, weight: 1 },
    { re: /return memo|cheque return|returned unpaid/i, weight: 1 },
  ],
  it_intimation: [
    { re: /income[\s-]*tax/i, weight: 2 },
    { re: /143\s*\(\s*1\s*\)/, weight: 3 },
    { re: /intimation/i, weight: 1 },
    { re: /\bPAN\b/, weight: 1 },
    { re: /assessment year/i, weight: 2 },
    { re: /proposed adjustment/i, weight: 2 },
    { re: /\bCPC\b|centralized processing/i, weight: 1 },
  ],
  legal_notice: [
    { re: /legal notice/i, weight: 3 },
    { re: /\badvocates?\b/i, weight: 2 },
    { re: /under instructions? (?:from|of) (?:my|our) client/i, weight: 3 },
    { re: /hereby (?:call|called) upon/i, weight: 2 },
    { re: /\bmy clients?\b/i, weight: 1 },
  ],
};

export type Classification = {
  type: NoticeType;
  score: number;
  scores: Record<Exclude<NoticeType, 'unknown'>, number>;
};

/** Keyword-based classification used (a) by the rule-based extractor and (b) as a cross-check on the AI's answer. */
export function classifyByKeywords(text: string): Classification {
  const scores = { gst_show_cause: 0, cheque_bounce_138: 0, it_intimation: 0, legal_notice: 0 };
  for (const type of Object.keys(PATTERNS) as (keyof typeof scores)[]) {
    for (const { re, weight } of PATTERNS[type]) {
      if (re.test(text)) scores[type] += weight;
    }
  }
  const order = (Object.keys(scores) as (keyof typeof scores)[]).sort((a, b) => scores[b] - scores[a]);
  let best = order[0];
  // A section 138 notice is usually also an advocate's legal notice: prefer the specific type.
  if (scores.cheque_bounce_138 >= 3 && scores.cheque_bounce_138 >= scores.legal_notice - 1) best = 'cheque_bounce_138';
  const score = scores[best];
  return { type: score >= 3 ? best : 'unknown', score, scores };
}
