import type { Evidence } from '../../types/analysis';

const CHAR_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u00A0': ' ',
};

const MIN_QUOTE_LEN = 4;

/**
 * Normalises typographic quotes/dashes and collapses whitespace.
 * `map[i]` is the index in the ORIGINAL string of normalised character i,
 * so a match in the normalised text can be mapped back to exact original offsets.
 */
export function normalizeWithMap(input: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < input.length; i++) {
    let ch = input[i];
    if (ch === '\u200B' || ch === '\uFEFF') continue;
    const mapped = CHAR_MAP[ch];
    if (mapped !== undefined) ch = mapped;
    if (/\s/.test(ch)) {
      if (!inSpace && out.length > 0) {
        out += ' ';
        map.push(i);
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    out += ch;
    map.push(i);
  }
  return { text: out, map };
}

/** Finds `quote` inside `haystack`, tolerant of whitespace, typographic quotes and letter case. */
export function findQuote(haystack: string, quote: string): { start: number; end: number } | null {
  const q = normalizeWithMap(quote).text.trim();
  if (q.length < MIN_QUOTE_LEN) return null;
  const h = normalizeWithMap(haystack);
  let idx = h.text.indexOf(q);
  if (idx === -1) {
    const lowerH = h.text.toLowerCase();
    const lowerQ = q.toLowerCase();
    if (lowerH.length === h.text.length && lowerQ.length === q.length) {
      idx = lowerH.indexOf(lowerQ);
    }
  }
  if (idx === -1) return null;
  const start = h.map[idx];
  const end = h.map[idx + q.length - 1] + 1;
  return { start, end };
}

/** Builds an Evidence object. The returned quote is the exact text sliced from the notice. */
export function verifyQuote(text: string, quote: string): Evidence {
  const hit = findQuote(text, quote);
  if (!hit) return { quote, start: -1, end: -1, foundInText: false };
  return { quote: text.slice(hit.start, hit.end), start: hit.start, end: hit.end, foundInText: true };
}

/** Heuristic check of extracted text quality (OCR/PDF extraction problems). */
export function assessTextQuality(text: string): { quality: 'good' | 'poor'; warnings: string[] } {
  const warnings: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length < 80) warnings.push('Very little text was found. The document may be incomplete or a scan.');
  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const digits = (trimmed.match(/[0-9]/g) ?? []).length;
  const visible = trimmed.replace(/\s/g, '').length || 1;
  const oddChars = (trimmed.match(/[^A-Za-z0-9\s.,;:()\-_/\\'"%&@#₹*+=?!\u2018\u2019\u201C\u201D\u2013\u2014[\]]/g) ?? []).length;
  if ((letters + digits) / visible < 0.7) warnings.push('A large share of the text is symbols. The scan may be poor.');
  if (oddChars / visible > 0.08) warnings.push('The text contains many unusual characters. Please check it before relying on it.');
  // Digits embedded in words (OCR confusions such as "d@te", "N0tice").
  const mixedTokens = (trimmed.match(/\b[A-Za-z]+[0-9@$][A-Za-z0-9@$]*\b/g) ?? []).length;
  const words = (trimmed.match(/\b\w+\b/g) ?? []).length || 1;
  if (mixedTokens / words > 0.06) warnings.push('Many words look garbled (letters mixed with digits or symbols). The scan may be poor.');
  return { quality: warnings.length > 0 ? 'poor' : 'good', warnings };
}
