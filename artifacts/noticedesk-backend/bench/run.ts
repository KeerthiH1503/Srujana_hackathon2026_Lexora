// Run with: npm run bench
// Runs every case in bench/cases through the SAME analyse() function the app uses and writes bench/results.json.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { heuristicExtractor } from '../src/lib/engine/extractors/heuristic';
import { loadCases, runCase, summarize } from './bench';

const out = (s: string) => process.stdout.write(s + '\n');

async function main(): Promise<void> {
  const cases = await loadCases();
  out(`Running ${cases.length} cases (rule-based reader, no AI)...\n`);
  const outcomes = [];
  for (const c of cases) {
    const o = await runCase(c, heuristicExtractor);
    outcomes.push(o);
    out(`${o.pass ? 'PASS' : 'FAIL'}  ${c.id}${o.pass ? '' : '\n        ' + o.failures.join('\n        ')}`);
  }
  const summary = summarize(outcomes, 'heuristic');
  await fs.writeFile(path.join(process.cwd(), 'bench', 'results.json'), JSON.stringify(summary, null, 2) + '\n');

  const passed = outcomes.filter((o) => o.pass).length;
  out(`\n${passed} of ${summary.total} cases passed.`);
  out(`Evidence support:      ${summary.metrics.evidenceSupportRate}%`);
  out(`Deadline correctness:  ${summary.metrics.deadlineCorrectness}%`);
  out(`Safe abstention:       ${summary.metrics.safeAbstentionRate}%`);
  out(`Handled ${summary.handled}, abstained ${summary.abstained}.`);
  out('Written to bench/results.json');
}

main().catch((err) => {
  out(`Benchmark failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exit(1);
});
