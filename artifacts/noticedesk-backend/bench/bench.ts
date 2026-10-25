// Benchmark library. It calls the SAME analyse() function the app uses (no separate demo path).
// Expected results in bench/cases/*.json were written BEFORE running and must never be edited to match output.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { analyse } from '../src/lib/engine/analyse';
import type { Extractor, RawExtraction } from '../src/lib/engine/schema';
import type { AnalysisResult, BenchCase, BenchResults, Severity } from '../src/types/analysis';

export type BenchCaseFile = {
  id: string;
  category: string;
  description: string;
  today: string;
  text: string;
  expected: {
    noticeType: AnalysisResult['noticeType'];
    deadline: { kind: 'date'; date: string } | { kind: 'undeterminable' };
    professional: ('yes' | 'probably' | 'no')[];
    severity?: Severity;
    unsupportedClaimsFlagged?: boolean;
  };
  stress?: boolean;
  hard?: boolean;
  /** Simulated extractor output, used to stress-test grounding with invented claims. */
  extractorOutput?: RawExtraction;
};

export async function loadCases(dir = path.join(process.cwd(), 'bench', 'cases')): Promise<BenchCaseFile[]> {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const out: BenchCaseFile[] = [];
  for (const f of files) out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as BenchCaseFile);
  return out;
}

export type CaseOutcome = {
  case: BenchCaseFile;
  result: AnalysisResult | null;
  error?: string;
  failures: string[];
  pass: boolean;
  abstained: boolean;
};

export async function runCase(c: BenchCaseFile, extractor: Extractor): Promise<CaseOutcome> {
  const useExtractor: Extractor = c.extractorOutput
    ? { name: 'mock', extract: async () => c.extractorOutput as RawExtraction }
    : extractor;
  let result: AnalysisResult;
  try {
    result = await analyse(c.text, { extractor: useExtractor, today: c.today, id: c.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return { case: c, result: null, error: msg, failures: [`analysis failed: ${msg}`], pass: false, abstained: true };
  }
  const failures: string[] = [];
  const e = c.expected;
  if (result.noticeType !== e.noticeType) failures.push(`notice type was ${result.noticeType}, expected ${e.noticeType}`);

  const status = result.deadline.status;
  const hasDate = (status === 'stated' || status === 'computed') && !!result.deadline.date;
  if (e.deadline.kind === 'date') {
    if (!hasDate) failures.push(`no deadline given (status ${status}), expected ${e.deadline.date}`);
    else if (result.deadline.date !== e.deadline.date) failures.push(`deadline was ${result.deadline.date}, expected ${e.deadline.date}`);
  } else if (hasDate || (status !== 'unclear' && status !== 'conflict')) {
    failures.push(`gave a deadline (${result.deadline.date ?? status}) where none can be established`);
  }
  if (!e.professional.includes(result.professional.recommendation)) {
    failures.push(`professional recommendation was ${result.professional.recommendation}, expected ${e.professional.join(' or ')}`);
  }
  if (e.severity && result.severity.level !== e.severity) failures.push(`severity was ${result.severity.level}, expected ${e.severity}`);
  if (e.unsupportedClaimsFlagged) {
    const flagged = result.claims.some((cl) => cl.evidence.some((ev) => !ev.foundInText));
    if (!flagged) failures.push('invented claims were not flagged as not found in the notice');
  }
  return { case: c, result, failures, pass: failures.length === 0, abstained: !hasDate };
}

const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

export function summarize(outcomes: CaseOutcome[], extractorName: 'heuristic', now = new Date()): BenchResults {
  const total = outcomes.length;
  const abstained = outcomes.filter((o) => o.abstained).length;

  let claimsFound = 0;
  let claimsAll = 0;
  for (const o of outcomes) {
    if (o.case.stress || !o.result) continue;
    for (const cl of o.result.claims) {
      for (const ev of cl.evidence) {
        claimsAll++;
        if (ev.foundInText) claimsFound++;
      }
    }
  }

  const needDate = outcomes.filter((o) => o.case.expected.deadline.kind === 'date');
  const dateCorrect = needDate.filter(
    (o) => o.case.expected.deadline.kind === 'date' && o.result?.deadline.date === o.case.expected.deadline.date && !o.abstained,
  ).length;

  const needAbstain = outcomes.filter((o) => o.case.expected.deadline.kind === 'undeterminable');
  const abstainedOk = needAbstain.filter((o) => o.abstained && o.result && !o.result.deadline.date).length;

  const cases: BenchCase[] = outcomes.map((o) => ({
    id: o.case.id,
    category: o.case.category + (o.case.hard ? ' [known hard]' : '') + (o.case.stress ? ' [stress]' : ''),
    pass: o.pass,
    reason: o.pass ? 'All checks passed.' : o.failures.join('; '),
    abstained: o.abstained,
  }));

  const notes: string[] = [
    'The cases are synthetic and were written by the team. Expected results were written before running and are not edited to match output.',
    'Results show consistency on these known cases. They are not a guarantee of accuracy on real notices.',
    'Evidence support is measured over claims in the non-stress cases. It checks that quoted text exists in the notice; it does not prove the reading of that text is correct.',
    'Deadline correctness is measured only on cases where a person can read the correct date. Safe abstention is measured only on cases where no single date can be established.',
    'Cases marked known hard are limits we expect to miss; they are included on purpose.',
  ];
  notes.push('No AI is used. Evidence support is high by construction because the rule-based reader copies text directly from the notice.');

  return {
    generatedAt: now.toISOString(),
    total,
    handled: total - abstained,
    abstained,
    metrics: {
      evidenceSupportRate: pct(claimsFound, claimsAll),
      deadlineCorrectness: pct(dateCorrect, needDate.length),
      safeAbstentionRate: pct(abstainedOk, needAbstain.length),
    },
    cases,
    extractor: extractorName,
    notes,
  };
}
