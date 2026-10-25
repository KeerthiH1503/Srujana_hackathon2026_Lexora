import { z } from 'zod';

export const NoticeTypeSchema = z.enum([
  'gst_show_cause',
  'cheque_bounce_138',
  'it_intimation',
  'legal_notice',
  'unknown',
]);

const Quoted = z.object({
  /** Short plain value (for display). */
  value: z.string().max(400),
  /** Exact text copied from the notice. Checked by code against the notice text. */
  quote: z.string().max(600),
});

/**
 * What an extractor returns. It reports FACTS AS WRITTEN with exact quotes.
 * Code then verifies every quote against the notice, parses dates and counts days.
 */
export const RawExtractionSchema = z.object({
  isNotice: z.boolean(),
  noticeType: NoticeTypeSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  sender: Quoted.nullable(),
  laws: z.array(Quoted).max(8),
  demand: Quoted.nullable(),
  amount: Quoted.nullable(),
  /** Exact text of the date as written in the notice (just the date text). */
  noticeDate: z.string().max(60).nullable(),
  receiptDate: z.string().max(60).nullable(),
  dueDate: z.string().max(60).nullable(),
  /** Exact phrase giving the time allowed to reply/pay, e.g. "within 15 days of receipt of this notice". */
  responsePeriod: z.string().max(300).nullable(),
  /** Exact phrases showing consequences threatened (prosecution, penalty, ex-parte, legal action...). */
  riskPhrases: z.array(z.string().max(300)).max(8),
  summaryPlain: z.string().max(1200),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

export interface Extractor {
  name: 'heuristic' | 'mock';
  extract(text: string): Promise<RawExtraction>;
}

export class ExtractionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}
