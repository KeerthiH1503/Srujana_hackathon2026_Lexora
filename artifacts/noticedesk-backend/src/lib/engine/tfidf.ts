// Classic TF-IDF weighting and cosine similarity (a standard data-mining technique). No AI.

const STOP = new Set([
  'the', 'and', 'for', 'you', 'your', 'are', 'was', 'were', 'with', 'this', 'that', 'will', 'shall', 'has', 'have',
  'not', 'from', 'any', 'all', 'may', 'can', 'who', 'its', 'our', 'his', 'her', 'their', 'been', 'being', 'such',
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((t) => !STOP.has(t));
}

export type Vector = Map<string, number>;

export function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Smoothed inverse document frequency over a small corpus of token lists. */
export function inverseDocumentFrequency(corpus: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of corpus) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = corpus.length;
  const idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 1)) + 1);
  return idf;
}

/** Sublinear TF x IDF vector. Words outside the vocabulary are ignored. */
export function tfidfVector(tokens: string[], idf: Map<string, number>): Vector {
  const v: Vector = new Map();
  for (const [t, count] of termFrequencies(tokens)) {
    const w = idf.get(t);
    if (w !== undefined) v.set(t, (1 + Math.log(count)) * w);
  }
  return v;
}

export function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  for (const [t, w] of a) {
    const o = b.get(t);
    if (o !== undefined) dot += w * o;
  }
  const norm = (v: Vector) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
  const na = norm(a);
  const nb = norm(b);
  return na === 0 || nb === 0 ? 0 : dot / (na * nb);
}
