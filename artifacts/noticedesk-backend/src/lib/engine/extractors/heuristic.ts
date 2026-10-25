// RULE-BASED EXTRACTOR. No AI, no network. Used (a) as a fallback when the AI provider is
// unavailable, and (b) so the test-suite and benchmark can run offline.
// It reports facts exactly as written; the same engine (deadline.ts etc.) consumes them.

import { classifyByKeywords } from '../classify';
import { findAmounts, formatInr } from '../amounts';
import { findDates } from '../dates';
import { NUM_WORD, parsePeriod } from '../period';
import { NOTICE_TYPE_CONFIG } from '../../rules';
import type { Extractor, RawExtraction } from '../schema';

const ABBREV_RE = /\b(Rs|No|Nos|Sec|Dt|Adv|Mr|Mrs|Ms|Dr|Smt|Shri|i\.e|e\.g|u\/s|w\.e\.f|approx|viz|vs)\./gi;
const PROTECT = '\u0001';

/** Splits into sentences without breaking at abbreviations such as "Rs." or "i.e.,". Offsets are preserved. */
function splitSentences(text: string): string[] {
  const protectedText = text.replace(ABBREV_RE, (m) => m.slice(0, -1) + PROTECT);
  return protectedText
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.split(PROTECT).join('.').trim())
    .filter((s) => s.length > 0);
}

const SENDER_RE =
  /^(?:from\s*[:\-]\s*)?(?:office of\b.*|(?:the\s+)?(?:assistant|deputy|joint|additional)?\s*commissioner\b.*|superintendent\b.*|income tax department.*|central(?:ized)? processing cent(?:re|er).*|.*\b(?:advocates?|associates|law (?:office|chambers|firm))\b.*|adv\.?\s.*)$/i;

const LAW_RE =
  /\b(?:section|sec\.|s\.)\s*\d+[A-Za-z]?(?:\s*\(\s*[0-9A-Za-z]+\s*\))*(?:\s*(?:of|under)\s+the\s+[A-Za-z.&()\- ]{2,70}?\bAct\b(?:,?\s*(?:19|20)\d{2})?)?/gi;

const DEMAND_TRIGGER =
  /\b(you are (?:hereby )?(?:required|directed|called upon|asked|requested|advised)|hereby (?:call|called) upon|show cause|why (?:the|a|an)\b[^.]{0,40}\b(?:penalt|demand|tax)|(?:pay|repay|remit|deposit)\b|payment of|submit (?:your |a )?(?:reply|response)|(?:reply|respond)\b)/i;

const PERIOD_VERB = /\b(pay|repay|remit|deposit|payment|reply|respond|response|submit|comply|appear|file|show cause|explain)\b/i;

const RISK_RES: RegExp[] = [
  /\bprosecut\w*/gi,
  /\bcriminal (?:complaint|case|proceedings?|liability)\b/gi,
  /\bimprisonment\b/gi,
  /\bex[- ]?parte\b/gi,
  /\bpenalt(?:y|ies)\b/gi,
  /\brecovery proceedings?\b/gi,
  /\bcoercive (?:action|steps|measures)\b/gi,
  /\b(?:appropriate )?legal (?:action|proceedings?)\b/gi,
  /\bcivil suit\b/gi,
  /\bcancell?ation of (?:your )?registration\b/gi,
];

const CLAUSE_RE = new RegExp(
  `(?:\\b(?:within|in|a period of|period of)\\s+)?(?:\\d{1,3}|${NUM_WORD}(?:[\\s-]${NUM_WORD})?)\\s*(?:\\([A-Za-z0-9\\s-]{1,25}\\)\\s*)?(?:days?|weeks?|months?)\\b[^.;,\\n]{0,70}`,
  'i',
);

type DateKind = 'notice' | 'receipt' | 'due' | 'hearing' | 'other';

function classifyDate(before: string): DateKind {
  if (/(hearing|appear|appearance|personal)[^.\n]{0,50}$/i.test(before)) return 'hearing';
  if (/\b(dated|date|dt)\s*[:.\-]?\s*$/i.test(before)) return 'notice';
  if (
    /\b(on or before|not later than|no later than|latest by|before|reply by|respond by|pay(?:ment)? by|submit\w* by|due (?:date|on|by)|last date(?: for [a-z ]+)?(?: is)?)\s*(?:the\s*)?$/i.test(before)
  ) {
    return 'due';
  }
  if (/(receiv\w*|deliver\w*|serv(?:ed|ice)|receipt|handed over|acknowledg\w*)[^.\n]{0,60}$/i.test(before)) return 'receipt';
  return 'other';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

export function extractHeuristic(text: string): RawExtraction {
  const cls = classifyByKeywords(text);
  const noticeWordCount = (text.match(/\bnotice\b/gi) ?? []).length;
  const isNotice = cls.type !== 'unknown' || noticeWordCount >= 3;
  const cfg = NOTICE_TYPE_CONFIG[cls.type];

  // Sender: first plausible letterhead/sign-off line near the top.
  let sender: RawExtraction['sender'] = null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 14);
  for (const line of lines) {
    if (line.length <= 140 && SENDER_RE.test(line)) {
      sender = { value: line.replace(/^from\s*[:\-]\s*/i, ''), quote: line.replace(/^from\s*[:\-]\s*/i, '') };
      break;
    }
  }

  // Laws / sections cited.
  const laws: RawExtraction['laws'] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LAW_RE)) {
    const q = m[0].replace(/\s+/g, ' ').trim();
    const key = q.toLowerCase();
    if (seen.has(key) || q.length < 6) continue;
    // Skip a shorter mention that is already covered by a longer one (e.g. "Section 138" after "Section 138 of the ... Act").
    if (laws.some((l) => l.value.toLowerCase().startsWith(key))) continue;
    seen.add(key);
    laws.push({ value: q, quote: m[0].trim() });
    if (laws.length >= 4) break;
  }

  const sentences = splitSentences(text);

  // Main demand: first sentence that asks the reader to do something.
  let demand: RawExtraction['demand'] = null;
  for (const s of sentences) {
    if (s.length >= 20 && DEMAND_TRIGGER.test(s)) {
      const q = truncate(s, 400);
      demand = { value: truncate(s, 220), quote: q };
      break;
    }
  }

  // Amount: the largest rupee amount mentioned.
  let amount: RawExtraction['amount'] = null;
  const amounts = findAmounts(text);
  if (amounts.length > 0) {
    const top = amounts.reduce((a, b) => (b.value > a.value ? b : a));
    amount = { value: formatInr(top.value), quote: top.text };
  }

  // Dates, classified by the words just before each one (same line).
  let noticeDate: string | null = null;
  let receiptDate: string | null = null;
  let dueDate: string | null = null;
  for (const hit of findDates(text)) {
    const lineStart = text.lastIndexOf('\n', hit.index - 1) + 1;
    const before = text.slice(Math.max(lineStart, hit.index - 90), hit.index);
    const kind = classifyDate(before);
    if (kind === 'notice' && noticeDate === null) noticeDate = hit.text;
    else if (kind === 'receipt' && receiptDate === null) receiptDate = hit.text;
    else if (kind === 'due' && dueDate === null) dueDate = hit.text;
  }

  // Response period: from a sentence that is about paying/replying, not e.g. the sender's own time limit.
  let responsePeriod: string | null = null;
  for (const s of sentences) {
    if (!PERIOD_VERB.test(s)) continue;
    const whole = parsePeriod(s);
    if (!whole) continue;
    if (whole.problem === 'multiple') {
      responsePeriod = truncate(s, 300);
      break;
    }
    const m = CLAUSE_RE.exec(s);
    if (m && parsePeriod(m[0])) {
      responsePeriod = m[0].trim();
      break;
    }
  }

  const riskPhrases: string[] = [];
  for (const re of RISK_RES) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m && !riskPhrases.includes(m[0])) riskPhrases.push(m[0]);
  }

  const summaryPlain =
    `Rule-based summary (the AI summary was not used): ${cfg.plainSummary}` +
    (demand ? ` The main request in the notice reads: "${truncate(demand.value, 200)}"` : '');

  return {
    isNotice,
    noticeType: cls.type,
    confidence: cls.type === 'unknown' ? 'low' : cls.score >= 6 ? 'high' : 'medium',
    sender,
    laws,
    demand,
    amount,
    noticeDate,
    receiptDate,
    dueDate,
    responsePeriod,
    riskPhrases: riskPhrases.slice(0, 8),
    summaryPlain: truncate(summaryPlain, 1100),
  };
}

export const heuristicExtractor: Extractor = {
  name: 'heuristic',
  async extract(text: string) {
    return extractHeuristic(text);
  },
};
