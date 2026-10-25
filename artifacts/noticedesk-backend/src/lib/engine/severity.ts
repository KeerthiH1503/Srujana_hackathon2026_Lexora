// Explainable, rule-based severity and professional-help recommendation.
// Thresholds are team-defined heuristics (rule R-SEVERITY-HEURISTIC) and are shown to the user.

import type { AnalysisResult, NoticeType, Severity } from '../../types/analysis';
import { NOTICE_TYPE_CONFIG } from '../rules';

type Factor = AnalysisResult['severity']['factors'][number];

export type SeverityInput = {
  noticeType: NoticeType;
  text: string;
  amountInr: number | null;
  deadline: AnalysisResult['deadline'];
  extractionPoor: boolean;
};

const CRIMINAL_RE = /\b(prosecut\w*|criminal (?:complaint|case|proceedings?|liability)|imprisonment|offence punishable|punishable)\b/i;
const PENALTY_RE = /\b(penalt(?:y|ies)|recovery proceedings?|attachment|coercive|ex[- ]?parte|cancell?ation of (?:your )?registration|recovery)\b/i;
const LEGAL_ACTION_RE = /\b(legal (?:action|proceedings?)|civil suit|file a (?:suit|complaint|case)|appropriate (?:legal )?(?:action|proceedings?)|court)\b/i;

export function scoreSeverity(input: SeverityInput): { level: Severity; score: number; factors: Factor[] } {
  const cfg = NOTICE_TYPE_CONFIG[input.noticeType];
  const { text, amountInr, deadline } = input;
  const daysLeft = deadline.daysLeft;
  const hasDate = (deadline.status === 'stated' || deadline.status === 'computed') && daysLeft !== undefined;

  const factors: Factor[] = [
    { label: `Notice type baseline (${cfg.label})`, fired: true, weight: cfg.baselineSeverity },
    { label: 'Criminal or prosecution language, or a criminal provision', fired: input.noticeType === 'cheque_bounce_138' || CRIMINAL_RE.test(text), weight: 40 },
    { label: 'Warns of penalty, recovery action or an ex-parte order', fired: PENALTY_RE.test(text), weight: 20 },
    { label: 'Warns of legal action or court proceedings', fired: LEGAL_ACTION_RE.test(text), weight: 20 },
    { label: 'Amount of Rs. 5,00,000 or more', fired: amountInr !== null && amountInr >= 500_000, weight: 20 },
    { label: 'Amount of Rs. 50,000 to Rs. 4,99,999', fired: amountInr !== null && amountInr >= 50_000 && amountInr < 500_000, weight: 10 },
    { label: 'Deadline has already passed', fired: hasDate && (daysLeft as number) < 0, weight: 35 },
    { label: 'Deadline within 7 days', fired: hasDate && (daysLeft as number) >= 0 && (daysLeft as number) <= 7, weight: 25 },
    { label: 'Deadline within 8 to 15 days', fired: hasDate && (daysLeft as number) > 7 && (daysLeft as number) <= 15, weight: 10 },
    { label: 'Deadline could not be established', fired: deadline.status === 'unclear' || deadline.status === 'conflict', weight: 15 },
    { label: 'The scan or extracted text is poor quality', fired: input.extractionPoor, weight: 10 },
  ];

  const score = Math.min(100, factors.filter((f) => f.fired).reduce((s, f) => s + f.weight, 0));
  const level: Severity =
    score >= 70 ? 'see_professional_now' : score >= 50 ? 'urgent' : score >= 25 ? 'action_needed' : 'routine';
  return { level, score, factors };
}

export function recommendProfessional(input: {
  noticeType: NoticeType;
  severity: { level: Severity };
  deadline: AnalysisResult['deadline'];
  unverifiedClaims: number;
  typeUncertain: boolean;
  extractionPoor: boolean;
  isNotice: boolean;
  authenticityWarnings?: number;
  needsReview?: boolean;
}): AnalysisResult['professional'] {
  const cfg = NOTICE_TYPE_CONFIG[input.noticeType];
  const yes: string[] = [];
  const maybe: string[] = [];

  if (input.severity.level === 'see_professional_now' || input.severity.level === 'urgent') {
    yes.push('The notice scores as urgent on the factors shown, so professional advice is recommended.');
  }
  if (cfg.alwaysProfessional) {
    yes.push('This type of notice can lead to a criminal complaint. A lawyer should look at it.');
  }
  if (input.deadline.status === 'conflict') {
    yes.push('The dates in the notice conflict, so the real deadline needs to be confirmed by a professional.');
  }
  if (input.deadline.daysLeft !== undefined && input.deadline.daysLeft < 0) {
    yes.push('The deadline appears to have passed.');
  }

  if (input.severity.level === 'action_needed') maybe.push('The notice needs action and you may want advice on the response.');
  if (input.deadline.status === 'unclear') maybe.push('The deadline could not be established from the notice text.');
  if (input.unverifiedClaims > 0) maybe.push('Some details could not be found in the notice text and were not relied on.');
  if (input.typeUncertain) maybe.push('The notice type is uncertain.');
  if (input.extractionPoor) maybe.push('The text quality is poor, so details may be missing or wrong.');
  if ((input.authenticityWarnings ?? 0) > 0) maybe.push('Warning signs were found that the notice may not be genuine. Verify it on the official service before paying or replying.');
  if (input.needsReview) maybe.push('The deadline depends on values read from an image or that are unclear. Confirm them against the original.');
  if (!input.isNotice || input.noticeType === 'unknown') maybe.push('This does not clearly match a supported notice type.');

  if (yes.length > 0) return { recommendation: 'yes', reasons: [...yes, ...maybe] };
  if (maybe.length > 0) return { recommendation: 'probably', reasons: maybe };
  return {
    recommendation: 'no',
    reasons: ['The notice looks routine and every key detail was found in the text. You can usually handle this yourself, but check the deadline first.'],
  };
}
