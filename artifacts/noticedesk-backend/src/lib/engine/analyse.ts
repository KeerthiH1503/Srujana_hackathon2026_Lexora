// ANALYSIS PIPELINE (no AI): text -> rule-based reader -> code verifies every quote ->
// deterministic deadline -> explainable severity -> professional recommendation -> authenticity signals.
// A result is never more certain than the fields it depends on: text read by OCR, or a date a person
// should confirm, marks the dependent deadline as "needs review".

import type {
  AnalysisResult, Claim, Evidence, FactOverrides, FieldStatus, NoticeType, TextSource,
} from '../../types/analysis';
import { NOTICE_TYPE_CONFIG, RULES, isRuleVerified } from '../rules';
import { findAmounts, formatInr, parseAmountInr } from './amounts';
import { checkAuthenticity, findIdentifier } from './authenticity';
import { classifyByKeywords } from './classify';
import { buildDateFact, computeDeadline, type DateFact } from './deadline';
import { isISODate, todayIST, type ISODate } from './dates';
import { parsePeriod, type Period } from './period';
import { compareWithRegistry, syntheticRegistry, type RegistryProvider } from './records';
import type { Extractor, RawExtraction } from './schema';
import { recommendProfessional, scoreSeverity } from './severity';
import { computeTemplateSimilarity } from './templateSimilarity';
import { assessTextQuality, verifyQuote } from './text';

export const MIN_TEXT = 20;
export const MAX_TEXT = 30_000;
/** Mean OCR confidence below this adds an extra warning. A team heuristic, not a calibrated threshold. */
export const LOW_OCR_CONFIDENCE = 80;

export class AnalyseInputError extends Error {
  constructor(message: string, public readonly code: 'too_short' | 'too_long' | 'bad_override') {
    super(message);
    this.name = 'AnalyseInputError';
  }
}

export type AnalyseOptions = {
  extractor: Extractor;
  /** Today's date (YYYY-MM-DD, India). Injectable so tests and benchmarks are repeatable. */
  today?: ISODate;
  id?: string;
  extraWarnings?: string[];
  /** How the text was obtained. OCR text can contain misread digits. */
  source?: TextSource;
  /** Facts entered by the user, which replace what the reader found. */
  overrides?: FactOverrides;
  registry?: RegistryProvider;
};

function newId(): string {
  return `an_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function verified(text: string, quote: string | null | undefined): Evidence | null {
  if (!quote || !quote.trim()) return null;
  return verifyQuote(text, quote);
}


export async function analyse(rawText: string, opts: AnalyseOptions): Promise<AnalysisResult> {
  const text = rawText.replace(/\r\n/g, '\n').trim();
  if (text.length < MIN_TEXT) throw new AnalyseInputError('The notice text is too short to analyse.', 'too_short');
  if (text.length > MAX_TEXT) throw new AnalyseInputError('The notice text is too long (limit 30,000 characters).', 'too_long');

  const today = opts.today && isISODate(opts.today) ? opts.today : todayIST();
  const method = opts.source?.method ?? 'text';
  const isOcr = method === 'ocr';
  const ov = opts.overrides ?? {};
  for (const key of ['noticeDate', 'receiptDate', 'dueDate'] as const) {
    const v = ov[key];
    if (v !== undefined && !isISODate(v)) throw new AnalyseInputError(`${key} must be a real date in YYYY-MM-DD form.`, 'bad_override');
  }
  if (ov.period && (!Number.isInteger(ov.period.n) || ov.period.n < 1 || ov.period.n > 366)) {
    throw new AnalyseInputError('period.n must be a whole number from 1 to 366.', 'bad_override');
  }

  const warnings: string[] = [...(opts.extraWarnings ?? [])];
  const quality = assessTextQuality(text);
  warnings.push(...quality.warnings);
  if (isOcr) {
    const conf = opts.source?.ocrConfidence;
    warnings.push(
      `This text was read from an image by OCR${conf !== undefined ? ` (average confidence ${conf}%)` : ''}. OCR can misread digits, so check dates and numbers against the original.`,
    );
    if (conf !== undefined && conf < LOW_OCR_CONFIDENCE) warnings.push('OCR confidence is low. Dates and numbers are especially likely to contain mistakes.');
  }

  const raw: RawExtraction = await opts.extractor.extract(text);

  // ---- notice type, cross-checked by keywords --------------------------------------------------
  const kw = classifyByKeywords(text);
  const noticeType: NoticeType = ov.noticeType ?? (raw.isNotice ? raw.noticeType : 'unknown');
  let typeUncertain = false;
  if (!ov.noticeType && noticeType !== 'unknown' && kw.type !== 'unknown' && kw.type !== noticeType && kw.score >= 4) {
    typeUncertain = true;
    warnings.push(`The notice type is uncertain: it was read as "${NOTICE_TYPE_CONFIG[noticeType].label}" but keywords suggest "${NOTICE_TYPE_CONFIG[kw.type].label}".`);
  }
  if (ov.noticeType) warnings.push(`The notice type was set by you: ${NOTICE_TYPE_CONFIG[ov.noticeType].label}.`);
  if (!raw.isNotice && !ov.noticeType) warnings.push('This document does not look like a notice.');
  if (noticeType === 'unknown') {
    warnings.push('The notice type was not recognised, so this is a limited analysis: only dates the notice itself states are used, and no type-specific legal period is applied.');
  }
  const cfg = NOTICE_TYPE_CONFIG[noticeType];

  // ---- claims with code-verified evidence ---------------------------------------------------------
  const claims: Claim[] = [];
  let unverified = 0;
  const conf = (found: boolean, ok = true): Claim['confidence'] =>
    !found || !ok ? 'low' : raw.confidence === 'high' ? 'high' : raw.confidence === 'medium' ? 'medium' : 'low';

  const addQuoted = (label: string, q: { value: string; quote: string } | null, ok = true) => {
    if (!q) return null;
    const ev = verified(text, q.quote);
    if (!ev) return null;
    if (!ev.foundInText) unverified++;
    claims.push({ label, value: q.value, evidence: [ev], confidence: conf(ev.foundInText, ok) });
    return ev;
  };

  const senderEv = addQuoted('Sender', raw.sender);
  const sections: string[] = [];
  raw.laws.forEach((law, i) => {
    const ev = addQuoted(i === 0 ? 'Law or section cited' : `Law or section cited (${i + 1})`, law);
    if (ev?.foundInText) sections.push(ev.quote);
  });
  addQuoted('What the notice asks or alleges', raw.demand);

  let amountInr: number | null = null;
  let amountFound = false;
  if (raw.amount) {
    const ev = verified(text, raw.amount.quote);
    const fromQuote = parseAmountInr(raw.amount.quote);
    const fromValue = parseAmountInr(raw.amount.value);
    const agrees = fromQuote === null || fromValue === null || fromQuote === fromValue;
    if (ev) {
      if (!ev.foundInText) unverified++;
      if (!agrees) warnings.push('The amount reported does not match the amount in the quoted text, so it was not relied on.');
      claims.push({
        label: 'Amount mentioned',
        value: fromQuote !== null ? formatInr(fromQuote) : raw.amount.value,
        evidence: [ev],
        confidence: conf(ev.foundInText, agrees),
      });
      if (ev.foundInText && agrees && fromQuote !== null) {
        amountInr = fromQuote;
        amountFound = true;
      }
    }
  }
  if (amountInr === null && !raw.amount) {
    const all = findAmounts(text);
    if (all.length > 0) amountInr = Math.max(...all.map((a) => a.value));
  }

  // ---- dates and period: only text that really appears in the notice is used, unless the user entered it -------
  const fieldStatus: FieldStatus[] = [];
  const userFact = (label: string, iso: string): DateFact => {
    claims.push({ label: `${label} (entered by you)`, value: iso, evidence: [], confidence: 'high' });
    return { quote: `Entered by you: ${iso}`, iso };
  };
  const dateFact = (field: string, label: string, q: string | null, override: string | undefined): DateFact => {
    if (override) {
      fieldStatus.push({ field, label, value: override, status: 'checked', source: 'user', reason: 'Entered by you.' });
      return userFact(label[0].toUpperCase() + label.slice(1), override);
    }
    if (!q) {
      fieldStatus.push({ field, label, value: null, status: 'not_found', source: method, reason: 'Not found in the notice text.' });
      return null;
    }
    const ev = verified(text, q);
    if (!ev) {
      fieldStatus.push({ field, label, value: null, status: 'not_found', source: method });
      return null;
    }
    if (!ev.foundInText) {
      unverified++;
      warnings.push(`The reader reported a ${label} ("${q.slice(0, 60)}") that does not appear in the notice, so it was ignored.`);
      claims.push({ label: label[0].toUpperCase() + label.slice(1), value: q, evidence: [ev], confidence: 'low' });
      fieldStatus.push({ field, label, value: null, status: 'not_found', source: method, reason: 'Not found in the notice text.' });
      return null;
    }
    const fact = buildDateFact(ev.quote);
    claims.push({
      label: label[0].toUpperCase() + label.slice(1),
      value: fact?.iso ?? ev.quote,
      evidence: [ev],
      confidence: conf(true, !!fact?.iso),
    });
    const ok = !!fact?.iso;
    fieldStatus.push({
      field,
      label,
      value: fact?.iso ?? ev.quote,
      status: !ok || isOcr ? 'needs_review' : 'checked',
      source: method,
      reason: !ok
        ? `"${ev.quote}" could not be read as a single valid date.`
        : isOcr
          ? 'Read from an image by OCR. Check the digits against the original.'
          : 'Found in the notice text and read by code.',
    });
    return fact;
  };

  const noticeDate = dateFact('notice_date', 'notice date', raw.noticeDate, ov.noticeDate);
  const receiptDate = dateFact('receipt_date', 'date of receipt', raw.receiptDate, ov.receiptDate);
  const dueDate = dateFact('due_date', 'date stated for the reply', raw.dueDate, ov.dueDate);

  let period: Period | null = null;
  if (ov.period) {
    period = {
      n: ov.period.n,
      unit: ov.period.unit,
      anchor: ov.period.anchor,
      quote: `Entered by you: ${ov.period.n} ${ov.period.unit} from ${ov.period.anchor === 'receipt' ? 'receipt' : 'the notice date'}`,
    };
    claims.push({ label: 'Time allowed to respond (entered by you)', value: `${ov.period.n} ${ov.period.unit}`, evidence: [], confidence: 'high' });
    fieldStatus.push({ field: 'response_period', label: 'time allowed to respond', value: `${ov.period.n} ${ov.period.unit}`, status: 'checked', source: 'user', reason: 'Entered by you.' });
  } else if (raw.responsePeriod) {
    const ev = verified(text, raw.responsePeriod);
    if (ev && ev.foundInText) {
      period = parsePeriod(ev.quote);
      const ok = !!period && !period.problem;
      claims.push({
        label: 'Time allowed to respond',
        value: period && !period.problem ? `${period.n} ${period.unit}` : ev.quote,
        evidence: [ev],
        confidence: conf(true, ok),
      });
      fieldStatus.push({
        field: 'response_period',
        label: 'time allowed to respond',
        value: ok ? `${period?.n} ${period?.unit}` : ev.quote,
        status: !ok || isOcr ? 'needs_review' : 'checked',
        source: method,
        reason: !ok ? 'The wording is ambiguous or inconsistent.' : isOcr ? 'Read from an image by OCR. Check the number against the original.' : 'Found in the notice text and read by code.',
      });
    } else if (ev) {
      unverified++;
      warnings.push('The reader reported a response period that does not appear in the notice, so it was ignored.');
      claims.push({ label: 'Time allowed to respond', value: raw.responsePeriod, evidence: [ev], confidence: 'low' });
      fieldStatus.push({ field: 'response_period', label: 'time allowed to respond', value: null, status: 'not_found', source: method });
    }
  } else {
    fieldStatus.push({ field: 'response_period', label: 'time allowed to respond', value: null, status: 'not_found', source: method, reason: 'Not found in the notice text.' });
  }

  // ---- identifier, sender, amount statuses ----------------------------------------------------------
  const ident = findIdentifier(text);
  fieldStatus.push({
    field: 'reference',
    label: 'identifier (DIN, RFN or reference number)',
    value: ident?.value ?? null,
    status: ident ? (isOcr ? 'needs_review' : 'checked') : 'not_found',
    source: method,
    reason: ident ? (isOcr ? 'Read by OCR. One wrong character changes the identifier.' : 'Found in the notice text.') : 'Not found in the notice text.',
  });
  fieldStatus.push({
    field: 'sender',
    label: 'sender',
    value: raw.sender?.value ?? null,
    status: senderEv?.foundInText ? (isOcr ? 'needs_review' : 'checked') : 'not_found',
    source: method,
    reason: senderEv?.foundInText ? undefined : 'Not found in the notice text.',
  });
  fieldStatus.push({
    field: 'amount',
    label: 'amount',
    value: amountInr === null ? null : formatInr(amountInr),
    status: amountInr === null ? 'not_found' : isOcr ? 'needs_review' : 'checked',
    source: method,
    reason: amountInr === null ? 'No rupee amount found.' : isOcr ? 'Read by OCR. Check the digits against the original.' : amountFound ? 'Found in the notice text.' : 'Largest amount found in the text.',
  });

  // ---- deadline (pure code), then propagate uncertainty ----------------------------------------------
  const itProposedAdjustment = /143\s*\(\s*1\s*\)\s*\(\s*a\s*\)|proposed adjustment/i.test(text);
  const computed = computeDeadline({
    noticeType,
    facts: { noticeDate, receiptDate, dueDate, period },
    today,
    hints: { itProposedAdjustment },
  });
  const deadline = { ...computed.deadline };
  const usedFields = [
    noticeDate && 'notice_date', receiptDate && 'receipt_date', dueDate && 'due_date', period && 'response_period',
  ].filter((f): f is string => !!f);
  const reviewFields = fieldStatus.filter((f) => usedFields.includes(f.field) && f.status === 'needs_review').map((f) => f.field);
  const hasResultToReview = deadline.date !== undefined || (deadline.candidates?.length ?? 0) > 0;
  if (hasResultToReview && reviewFields.length > 0) {
    deadline.needsReview = true;
    deadline.dependsOn = reviewFields;
    deadline.note = [deadline.note, `This depends on values that need review (${reviewFields.join(', ')}). Confirm them against the original before relying on it.`]
      .filter(Boolean)
      .join(' ');
  }

  // ---- registry comparison, authenticity, similarity ------------------------------------------------
  const noticeDateIso = noticeDate?.iso ?? null;
  const comparison = await compareWithRegistry(opts.registry ?? syntheticRegistry, {
    identifier: ident?.value ?? null,
    sender: senderEv?.foundInText ? raw.sender?.value ?? null : null,
    amountInr: amountInr,
    noticeDate: noticeDateIso,
    sections,
  });
  const authenticity = checkAuthenticity(text, noticeType, comparison);
  const authenticityWarnings = authenticity.checks.filter((c) => c.result === 'warning').length;
  const templateSimilarity = computeTemplateSimilarity(text);

  // ---- severity and recommendation -------------------------------------------------------------------
  const severity = scoreSeverity({ noticeType, text, amountInr, deadline, extractionPoor: quality.quality === 'poor' });
  const professional = recommendProfessional({
    noticeType,
    severity,
    deadline,
    unverifiedClaims: unverified,
    typeUncertain,
    extractionPoor: quality.quality === 'poor',
    isNotice: raw.isNotice || !!ov.noticeType,
    authenticityWarnings,
    needsReview: deadline.needsReview === true,
  });

  // ---- evidence chain (strings for the UI) ---------------------------------------------------------------
  const ruleId = deadline.source.ruleId;
  const rule = ruleId ? RULES[ruleId] : undefined;
  const periodUsable = period && !period.problem ? period : null;
  const quotesShown = [periodUsable?.quote, dueDate?.iso ? dueDate.quote : undefined]
    .filter((q): q is string => !!q && (q.startsWith('Entered by you') || !!verified(text, q)?.foundInText));
  const firstNote = deadline.note ? deadline.note.split('. ')[0].replace(/\.$/, '') + '.' : '';
  const provisional = deadline.needsReview ? 'Provisional (confirm the dates first). ' : '';
  const chain: AnalysisResult['chain'] = {
    evidence: quotesShown.length > 0
      ? `The notice says: ${quotesShown.map((q) => `"${q}"`).join(' and ')}`
      : 'No response date or time period was found in the notice text.',
    interpretation: periodUsable
      ? `The notice gives ${periodUsable.n} ${periodUsable.unit} to respond, counted ${periodUsable.anchor === 'receipt' ? 'from the date you receive it' : periodUsable.anchor === 'notice_date' ? 'from the notice date' : 'from a date it does not make clear'}.`
      : dueDate?.iso
        ? `The notice states the date itself: ${dueDate.iso}.`
        : 'The notice does not give a clear date or period that can be relied on.',
    rule: rule ? `${rule.id}: ${rule.description}${rule.verified ? '' : ' (not verified)'}` : 'No verified rule could be applied.',
    decision:
      deadline.status === 'unclear'
        ? `Cannot establish a single deadline from the notice and the verified rules. ${firstNote}`.trim()
        : deadline.status === 'conflict'
          ? `The dates conflict, so no single deadline is given. ${computed.basis}`
          : `${provisional}Deadline ${deadline.date}. ${computed.basis}`,
    action:
      professional.recommendation === 'yes'
        ? 'Speak to a CA or lawyer now, taking the notice, proof of when you received it, and the documents on the checklist.'
        : professional.recommendation === 'probably'
          ? 'Gather the documents on the checklist, confirm the deadline, and consider getting professional advice before replying.'
          : 'Gather the documents on the checklist and reply before the deadline.',
  };

  
  return {
    id: opts.id ?? newId(),
    noticeType,
    extractedText: text,
    extraction: { quality: quality.quality, warnings: Array.from(new Set(warnings)), method: 'rules' },
    claims,
    summaryPlain: noticeType === 'unknown' && !raw.isNotice ? cfg.plainSummary : raw.summaryPlain || cfg.plainSummary,
    professional,
    severity,
    deadline,
    chain,
    consequences: cfg.consequences.map((c) => ({ text: c.text, ruleId: c.ruleId, verified: isRuleVerified(c.ruleId) })),
    checklist: cfg.checklist,
    replyOutline: cfg.replyOutline,
    authenticity,
    fields: fieldStatus,
    recordComparison: comparison,
    templateSimilarity,
    isPrecomputedSample: false,
  };
}
