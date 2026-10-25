import { getDocumentProxy } from 'unpdf';
import { ocrAvailable, ocrImage } from '../../../lib/engine/ocr';
import { assessTextQuality } from '../../../lib/engine/text';
import { preflight, withCors } from '../../../lib/server/cors';
import {
  MAX_FILES, MAX_TOTAL_BYTES, MAX_UPLOAD_BYTES, detectFileKind, imageSize, imageTooLarge,
} from '../../../lib/server/fileValidation';
import { checkRateLimit, clientKey, rateLimitPerMinute } from '../../../lib/server/rateLimit';

export const maxDuration = 120;

const MAX_PDF_PAGES = 20;
const MAX_CHARS = 30_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (status: number, code: string, error: string, headers?: Record<string, string>) => json({ error, code }, status, headers);

type Method = 'text' | 'pdf_text' | 'ocr';

async function handle(req: Request): Promise<Response> {
  const rl = checkRateLimit(`extract:${clientKey(req)}`, rateLimitPerMinute());
  if (!rl.ok) return fail(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', { 'Retry-After': String(rl.retryAfterSec) });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'bad_request', 'Send the file(s) as multipart form data in a field named "file".');
  }
  const files = form.getAll('file').filter((f): f is File => f instanceof Blob) as File[];
  if (files.length === 0) return fail(400, 'no_file', 'No file was uploaded (field name must be "file").');
  if (files.length > MAX_FILES) return fail(400, 'too_many_files', `Upload at most ${MAX_FILES} files (for example the pages of one notice).`);
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_BYTES) return fail(413, 'too_large', 'The files are larger than 20 MB in total.');

  const warnings: string[] = [];
  const pieces: string[] = [];
  const methods = new Set<Method>();
  let confSum = 0;
  let confWords = 0;
  const lowWords: string[] = [];

  for (const [index, file] of files.entries()) {
    const label = files.length > 1 ? `File ${index + 1}: ` : '';
    if (file.size === 0) return fail(400, 'empty_file', `${label}The file is empty.`);
    if (file.size > MAX_UPLOAD_BYTES) return fail(413, 'too_large', `${label}The file is larger than 8 MB.`);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = detectFileKind(bytes);
    if (!kind) return fail(415, 'unsupported_type', `${label}Unsupported file. Upload a PDF, PNG, JPG, WEBP or a text file.`);

    try {
      if (kind === 'text') {
        methods.add('text');
        pieces.push(new TextDecoder('utf-8').decode(bytes));
      } else if (kind === 'pdf') {
        methods.add('pdf_text');
        const pdf = await getDocumentProxy(bytes);
        if (pdf.numPages > MAX_PDF_PAGES) warnings.push(`${label}Only the first ${MAX_PDF_PAGES} pages were read.`);
        // Read pages one by one so pages after the limit are never processed.
        const pageTexts: string[] = [];
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n++) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          pageTexts.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n'));
        }
        const text = pageTexts.join('\n');
        if (text.trim().length < 40) {
          warnings.push(`${label}This PDF has almost no readable text. It may be a scan: upload clear photos of the pages instead, or paste the text.`);
        }
        pieces.push(text);
      } else {
        if (!(await ocrAvailable())) {
          return fail(422, 'ocr_unavailable', 'Reading images needs the OCR language file (npm install @tesseract.js-data/eng). Paste the text or upload a text-based PDF instead.');
        }
        if (imageTooLarge(imageSize(bytes, kind))) {
          return fail(413, 'image_too_large', `${label}The image dimensions are too large. Use a photo up to 10,000 pixels on each side.`);
        }
        methods.add('ocr');
        const r = await ocrImage(bytes);
        pieces.push(r.text);
        confSum += r.confidence * r.wordCount;
        confWords += r.wordCount;
        lowWords.push(...r.lowConfidenceWords);
        if (r.wordCount === 0) warnings.push(`${label}No text could be read from this image. Try a clearer, straighter photo.`);
      }
    } catch {
      return fail(422, 'unreadable_file', `${label}The file could not be read. It may be damaged or password-protected.`);
    }
  }

  let text = pieces.map((p, i) => (pieces.length > 1 ? `--- page ${i + 1} ---\n${p.trim()}` : p.trim())).join('\n\n').replace(/\r\n/g, '\n').trim();
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    warnings.push('The text was long and was cut at 30,000 characters.');
  }

  const method: Method = methods.has('ocr') ? 'ocr' : methods.has('pdf_text') ? 'pdf_text' : 'text';
  const ocrConfidence = confWords > 0 ? Math.round((confSum / confWords) * 10) / 10 : undefined;
  if (method === 'ocr') {
    warnings.push('This text was read from an image by OCR. Check dates, amounts and reference numbers against the original before analysing.');
  }
  const q = assessTextQuality(text);
  return json({
    text,
    quality: q.quality,
    warnings: [...warnings, ...q.warnings],
    method,
    ...(ocrConfidence !== undefined ? { ocrConfidence, lowConfidenceWords: [...new Set(lowWords)].slice(0, 25) } : {}),
  });
}

export const POST = withCors(handle);
export const OPTIONS = (req: Request) => preflight(req);
