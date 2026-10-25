// Run once from your project root:  node scripts/setup-backend.mjs
// It adds the npm scripts the backend needs and prints the install command.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Photo reading (OCR) needs tesseract.js to stay outside Next's bundle, or its worker script cannot be found.
function patchNextConfig() {
  const candidates = ['next.config.ts', 'next.config.mjs', 'next.config.js'];
  const file = candidates.find((f) => existsSync(f));
  if (!file) return console.log("No next.config file found. Add serverExternalPackages: ['tesseract.js'] to your Next config.");
  const src = readFileSync(file, 'utf8');
  if (src.includes('serverExternalPackages')) return console.log(`${file}: serverExternalPackages already set. Make sure it includes 'tesseract.js'.`);
  const patched = src.replace(/(const\s+nextConfig[^=]*=\s*\{)/, "$1\n  serverExternalPackages: ['tesseract.js'],");
  if (patched === src) return console.log(`Could not patch ${file}. Add this inside the config object: serverExternalPackages: ['tesseract.js'],`);
  writeFileSync(file, patched);
  console.log(`${file}: added serverExternalPackages: ['tesseract.js'] (needed for photo uploads).`);
}

const file = 'package.json';
if (!existsSync(file)) {
  console.log('package.json not found. Run this from the project root.');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(file, 'utf8'));
pkg.scripts = pkg.scripts ?? {};
const wanted = {
  test: 'vitest run',
  'test:watch': 'vitest',
  bench: 'tsx bench/run.ts',
  typecheck: 'tsc --noEmit',
};
const added = [];
for (const [k, v] of Object.entries(wanted)) {
  if (pkg.scripts[k] && pkg.scripts[k] !== v) {
    console.log(`Keeping your existing "${k}" script: ${pkg.scripts[k]}`);
    continue;
  }
  if (!pkg.scripts[k]) added.push(k);
  pkg.scripts[k] = v;
}
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log(added.length ? `Added scripts: ${added.join(', ')}` : 'Scripts already present.');
patchNextConfig();
console.log(
  [
    '',
    'Now run:',
    '  npm install zod unpdf tesseract.js @tesseract.js-data/eng',
    '  npm install -D vitest tsx @types/node@^22',
    '',
  ].join('\n'),
);
