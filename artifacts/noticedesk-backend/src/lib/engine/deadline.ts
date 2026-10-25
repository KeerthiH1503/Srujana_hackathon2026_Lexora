// DEADLINE ENGINE. Pure, deterministic, no AI, no network.
// It never invents a date: when the needed facts or rules are missing it returns
// status 'unclear' (or 'conflict') with candidates so a person can verify.

import type { AnalysisResult, NoticeType } from '../../types/analysis';
import { NOTICE_TYPE_CONFIG, isRuleVerified } from '../rules';
import { addDays, addMonths, daysBetween, parseSingleDate, type ISODate } from './dates';
import type { Period } from './period';

export type Deadline = AnalysisResult['deadline'];

export type DateFact = {
  quote: string;
  iso?: ISODate;
  problem?: 'multiple' | 'invalid' | 'none';
} | null;

export type DeadlineFacts = {
  noticeDate: DateFact;
  receiptDate: DateFact;
  dueDate: DateFact;
  period: Period | null;
};

export type DeadlineHints = { itProposedAdjustment?: boolean };

export type DeadlineComputation = { deadline: Deadline; basis: string };

export function buildDateFact(quote: string | null | undefined): DateFact {
  if (!quote || !quote.trim()) return null;
  const r = parseSingleDate(quote);
  if (r.kind === 'ok') return { quote, iso: r.iso };
  if (r.kind === 'invalid') return { quote, problem: 'invalid' };
  if (r.kind === 'multiple') return { quote, problem: 'multiple' };
  return { quote, problem: 'none' };
}

function addPeriod(iso: ISODate, p: Pick<Period, 'n' | 'unit'>): ISODate {
  return p.unit === 'months' ? addMonths(iso, p.n) : addDays(iso, p.n);
}

function periodText(p: Pick<Period, 'n' | 'unit'>): string {
  return `${p.n} ${p.unit === 'months' ? (p.n === 1 ? 'month' : 'months') : p.n === 1 ? 'day' : 'days'}`;
}

type Candidate = { label: string; date: ISODate };

export function computeDeadline(args: {
  noticeType: NoticeType;
  facts: DeadlineFacts;
  today: ISODate;
  hints?: DeadlineHints;
}): DeadlineComputation {
  const { noticeType, facts, today } = args;
  const hints = args.hints ?? {};
  const cfg = NOTICE_TYPE_CONFIG[noticeType];
  const notes: string[] = [];

  const noteProblem = (label: string, fact: DateFact) => {
    if (fact?.problem) {
      const why =
        fact.problem === 'invalid' ? 'is not a real calendar date'
        : fact.problem === 'multiple' ? 'contains more than one date'
        : 'did not contain a readable date';
      notes.push(`The ${label} ("${fact.quote}") ${why}, so it was not used.`);
    }
  };
  noteProblem('notice date', facts.noticeDate);
  noteProblem('date of receipt', facts.receiptDate);
  noteProblem('stated due date', facts.dueDate);

  const nd = facts.noticeDate?.iso;
  const rd = facts.receiptDate?.iso;
  const stated = facts.dueDate?.iso;
  const period = facts.period;

  // ---- 1. Work out what the period (if any) gives --------------------------------------
  let periodDate: ISODate | undefined;
  let periodBasis = '';
  if (period?.problem) {
    notes.push(
      period.problem === 'multiple'
        ? `The notice mentions more than one time period ("${period.quote}"), so none was used.`
        : `The time period in the notice ("${period.quote}") is written inconsistently (words and digits differ), so it was not used.`,
    );
  } else if (period) {
    const anchorIso = period.anchor === 'receipt' ? rd : period.anchor === 'notice_date' ? nd : undefined;
    if (anchorIso) {
      periodDate = addPeriod(anchorIso, period);
      const anchorName = period.anchor === 'receipt' ? 'date of receipt' : 'notice date';
      periodBasis = `Counted ${periodText(period)} from the ${anchorName} (${anchorIso}), excluding that first day and including the last: ${periodDate}.`;
    }
  }

  const finish = (d: Omit<Deadline, 'daysLeft'> & { date?: ISODate }, basis: string): DeadlineComputation => {
    const out: Deadline = { ...d };
    if (out.date) {
      out.daysLeft = daysBetween(today, out.date);
      if (out.daysLeft < 0) {
        notes.push('This date appears to have passed. Ask a professional urgently whether anything can still be done.');
      }
    }
    if (out.status === 'computed') {
      notes.push('Public holidays and extensions are not considered. Confirm the final date.');
    }
    if (notes.length > 0) out.note = notes.join(' ');
    return { deadline: out, basis };
  };

  const sourceFor = (ruleId: string, quote?: string): Deadline['source'] => ({
    quote,
    ruleId,
    ruleVerified: isRuleVerified(ruleId),
  });

  // ---- 2. A binding statutory minimum (section 138 cheque notices) ----------------------
  const statutory = cfg.statutory;
  const statutoryApplies =
    !!statutory && (!statutory.requiresHint || (statutory.requiresHint === 'itProposedAdjustment' && hints.itProposedAdjustment === true));

  const checkBindingConflict = (chosen: ISODate, chosenLabel: string, chosenQuote?: string): DeadlineComputation | null => {
    if (!statutory || !statutory.binding) return null;
    const anchor = statutory.anchor === 'receipt' ? rd : nd;
    const earliest = anchor ?? (statutory.anchor === 'receipt' ? nd : undefined);
    if (!earliest) return null;
    const minDate = addDays(earliest, statutory.n);
    if (chosen < minDate) {
      const exact = anchor !== undefined;
      notes.push(
        `The date in the notice is earlier than the statutory minimum (${statutory.label}). ` +
          (exact ? '' : 'The date of receipt is not stated, so the true minimum may be even later. ') +
          'Do not rely on the earlier date without professional advice.',
      );
      return finish(
        {
          status: 'conflict',
          candidates: [
            { label: chosenLabel, date: chosen },
            { label: exact ? `Statutory minimum: ${statutory.label}` : `Earliest possible statutory minimum (if received the day it was issued)`, date: minDate },
          ],
          source: sourceFor(statutory.ruleId, chosenQuote),
        },
        `The notice's date (${chosen}) is earlier than the statutory minimum of ${statutory.n} days (${minDate}).`,
      );
    }
    if (!anchor) {
      notes.push('The date of receipt is not stated. The statutory 15 days run from receipt, so confirm that date.');
    }
    return null;
  };

  // ---- 3. Decide ------------------------------------------------------------------------
  // 3a. Stated date and period disagree -> conflict
  if (stated && periodDate && stated !== periodDate) {
    notes.push('The notice gives a date and a time period that do not agree. Verify which one applies.');
    return finish(
      {
        status: 'conflict',
        candidates: [
          { label: `Date stated in the notice`, date: stated },
          { label: `Counted from "${period?.quote ?? ''}"`, date: periodDate },
        ],
        source: sourceFor('R-STATED-DATE', facts.dueDate?.quote),
      },
      `Stated date ${stated} and counted date ${periodDate} differ.`,
    );
  }

  // 3b. Stated date
  if (stated) {
    const binding = checkBindingConflict(stated, 'Date stated in the notice', facts.dueDate?.quote);
    if (binding) return binding;
    return finish(
      { status: 'stated', date: stated, source: sourceFor('R-STATED-DATE', facts.dueDate?.quote) },
      `The notice states the date itself: ${stated}.`,
    );
  }

  // 3c. Period with a usable anchor
  if (periodDate && period) {
    const binding = checkBindingConflict(periodDate, `Counted from "${period.quote}"`, period.quote);
    if (binding) return binding;
    return finish(
      { status: 'computed', date: periodDate, source: sourceFor('R-COUNT-DAYS', period.quote) },
      periodBasis,
    );
  }

  // 3d. Statutory fallback when the notice gives neither a date nor a usable period
  if (statutory && statutoryApplies && !period?.problem) {
    const anchor = statutory.anchor === 'receipt' ? rd : nd;
    if (anchor) {
      const date = addDays(anchor, statutory.n);
      return finish(
        { status: 'computed', date, source: sourceFor(statutory.ruleId, undefined) },
        `The notice gives no date, so the statutory period applies: ${statutory.label}. Counted from ${anchor}: ${date}.`,
      );
    }
  }

  // 3e. Cannot establish a single date -> explain and list candidates
  const candidates: Candidate[] = [];
  if (period && !period.problem && !periodDate) {
    if (period.anchor === 'receipt') {
      notes.push(`The notice says the period runs from receipt, but no date of receipt was found. A single deadline cannot be established.`);
      if (nd) candidates.push({ label: `Earliest possible: ${periodText(period)} from the notice date (if received the day it was issued)`, date: addPeriod(nd, period) });
    } else if (period.anchor === 'notice_date') {
      notes.push('The notice says the period runs from its own date, but no readable notice date was found.');
      if (rd) candidates.push({ label: `If counted from the date of receipt`, date: addPeriod(rd, period) });
    } else {
      notes.push(`The notice gives a period ("${period.quote}") but does not make clear which date it runs from. A single deadline cannot be established.`);
      if (nd) candidates.push({ label: `If counted from the notice date`, date: addPeriod(nd, period) });
      if (rd) candidates.push({ label: `If counted from the date of receipt`, date: addPeriod(rd, period) });
    }
  } else if (!period) {
    notes.push('No response date or time period was found in the notice text.');
  }
  if (statutory && !candidates.length) {
    const earliestBase = nd;
    if (statutory.binding && earliestBase) {
      candidates.push({ label: `Earliest possible statutory date (${statutory.label}), if received the day it was issued`, date: addDays(earliestBase, statutory.n) });
      notes.push('Confirm the date you received the notice.');
    }
  }
  if (noticeType === 'gst_show_cause' && cfg.referenceCandidate && nd) {
    candidates.push({ label: cfg.referenceCandidate.label, date: addDays(nd, cfg.referenceCandidate.n) });
    notes.push('The GST law does not fix one reply date; the notice should state it. Ask the issuing office or a professional.');
  }
  if (noticeType === 'unknown') {
    notes.push('This notice type is not supported, so no legal period was applied.');
  }

  return finish(
    {
      status: 'unclear',
      candidates: candidates.length ? candidates : undefined,
      source: { quote: period?.quote, ruleId: undefined, ruleVerified: false },
    },
    'A single deadline could not be established from the notice text and the verified rules. Verify with a professional.',
  );
}
