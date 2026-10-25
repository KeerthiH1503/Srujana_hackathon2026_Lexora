import { promises as fs } from 'node:fs';
import path from 'node:path';
import { preflight, withCors } from '../../../lib/server/cors';

async function handle(req: Request): Promise<Response> {
  // Reading the request makes Next.js run this on every call instead of freezing the answer at build time.
  void new URL(req.url).pathname;
  try {
    const file = path.join(process.cwd(), 'bench', 'results.json');
    const data = await fs.readFile(file, 'utf8');
    return new Response(data, { headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { error: 'No benchmark results yet. Run "npm run bench" first.', code: 'no_results' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export const GET = withCors(handle);
export const OPTIONS = (req: Request) => preflight(req);
