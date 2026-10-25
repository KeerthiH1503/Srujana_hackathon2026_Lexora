import { ocrAvailable } from '../../../lib/engine/ocr';
import { preflight, withCors } from '../../../lib/server/cors';

async function handle(req: Request): Promise<Response> {
  // Reading the request makes Next.js run this on every call instead of freezing the answer at build time.
  void new URL(req.url).searchParams.get('detail');
  return Response.json(
    {
      ok: true,
      ai: false,
      engine: 'rules (regular expressions, date arithmetic, edit distance, TF-IDF cosine)',
      imageReading: (await ocrAvailable()) ? 'classic OCR (Tesseract)' : 'unavailable (OCR language file missing)',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export const GET = withCors(handle);
export const OPTIONS = (req: Request) => preflight(req);
