export type AmountHit = { value: number; text: string; index: number };

const AMOUNT_RE =
  /(?:₹|\brs\.?|\binr\b|\brupees?\b)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/-)?\s*(lakhs?|lacs?|crores?|crs?\b)?/gi;

/** Finds rupee amounts such as "Rs. 4,50,000/-", "₹ 50,000", "INR 2.5 lakh". */
export function findAmounts(text: string): AmountHit[] {
  const out: AmountHit[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const numeric = m[1].replace(/,+$/g, '').replace(/,/g, '');
    let value = Number.parseFloat(numeric);
    if (!Number.isFinite(value)) continue;
    const unit = (m[2] ?? '').toLowerCase();
    if (unit.startsWith('lakh') || unit.startsWith('lac')) value *= 100_000;
    else if (unit.startsWith('crore') || unit.startsWith('cr')) value *= 10_000_000;
    out.push({ value, text: m[0].trim(), index: m.index ?? 0 });
  }
  return out;
}

/** Parses the first rupee amount in `text`; null if none. */
export function parseAmountInr(text: string): number | null {
  const hits = findAmounts(text);
  return hits.length > 0 ? hits[0].value : null;
}

export function formatInr(value: number): string {
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
