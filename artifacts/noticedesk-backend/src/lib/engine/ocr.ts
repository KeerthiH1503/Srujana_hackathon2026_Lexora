// Classic OCR (Tesseract). No generative AI. Runs on the server with a language file shipped in node_modules,
// so it works offline. OCR can misread digits (8/3, 0/O), so callers must treat OCR text as needing review.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type OcrResult = {
  text: string;
  /** Mean word confidence, 0-100. */
  confidence: number;
  wordCount: number;
  lowConfidenceWords: string[];
};

/** Words below this confidence are listed for the user. A team heuristic, not a calibrated threshold. */
export const LOW_WORD_CONFIDENCE = 70;
const OCR_TIMEOUT_MS = 60_000;

type Env = Record<string, string | undefined>;

export function ocrLangPath(env: Env = process.env): string {
  return env.OCR_LANG_PATH ?? path.join(process.cwd(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');
}

export async function ocrAvailable(env: Env = process.env): Promise<boolean> {
  try {
    await fs.access(path.join(ocrLangPath(env), 'eng.traineddata.gz'));
    return true;
  } catch {
    return false;
  }
}

type WordLike = { text?: string; confidence?: number };
type Walkable = { words?: WordLike[]; blocks?: Walkable[]; paragraphs?: Walkable[]; lines?: Walkable[] };

function collectWords(node: Walkable | null | undefined, out: WordLike[] = []): WordLike[] {
  if (!node) return out;
  if (Array.isArray(node.words)) out.push(...node.words);
  for (const key of ['blocks', 'paragraphs', 'lines'] as const) {
    for (const child of node[key] ?? []) collectWords(child, out);
  }
  return out;
}

let queue: Promise<unknown> = Promise.resolve();

/** Reads text from an image. Runs one job at a time to bound memory use. */
export function ocrImage(bytes: Uint8Array, env: Env = process.env): Promise<OcrResult> {
  const job = () => runOcr(bytes, env);
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

async function runOcr(bytes: Uint8Array, env: Env): Promise<OcrResult> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    langPath: ocrLangPath(env),
    gzip: true,
    cachePath: path.join(os.tmpdir(), 'noticedesk-ocr'),
    logger: () => undefined,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      worker.recognize(Buffer.from(bytes), {}, { text: true, blocks: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OCR timed out')), OCR_TIMEOUT_MS);
      }),
    ]);
    const data = result.data as unknown as Walkable & { text?: string; confidence?: number };
    const words = collectWords(data).filter((w) => (w.text ?? '').trim().length > 0);
    const low = words.filter((w) => (w.confidence ?? 100) < LOW_WORD_CONFIDENCE).map((w) => (w.text ?? '').trim());
    const mean = words.length
      ? words.reduce((s, w) => s + (w.confidence ?? 0), 0) / words.length
      : typeof data.confidence === 'number' ? data.confidence : 0;
    return {
      text: (data.text ?? '').trim(),
      confidence: Math.round(mean * 10) / 10,
      wordCount: words.length,
      lowConfidenceWords: [...new Set(low)].slice(0, 25),
    };
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate().catch(() => undefined);
  }
}
