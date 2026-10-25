// SHARED CONTRACT between backend and frontend.
// Do not change a field without telling the other developer the same day.

export type Evidence = {
  quote: string;
  /** Character offsets into AnalysisResult.extractedText. -1 when the quote was not found. */
  start: number;
  end: number;
  /** true only if the quote was found in the extracted notice text by code (not by the model). */
  foundInText: boolean;
};

export type Claim = {
  label: string;
  value: string;
  evidence: Evidence[];
  confidence: 'high' | 'medium' | 'low';
};

export type NoticeType =
  | 'gst_show_cause'
  | 'cheque_bounce_138'
  | 'it_intimation'
  | 'legal_notice'
  | 'unknown';

export type Severity = 'routine' | 'action_needed' | 'urgent' | 'see_professional_now';

export type Stage =
  | 'received'
  | 'understood'
  | 'info_gathered'
  | 'professional_review'
  | 'response_prepared'
  | 'closed';

export type AuthenticityCheck = {
  id: string;
  label: string;
  /** 'warning' = a sign worth checking. It is NEVER proof of fraud. */
  result: 'found' | 'not_found' | 'warning' | 'not_checked';
  detail: string;
  /** Exact text from the notice that triggered the check, when there is one. */
  evidence?: Evidence;
  /** true = team-defined warning sign, not a legal rule. */
  heuristic: boolean;
};

/**
 * Authenticity SIGNALS, not verification. Status is never "verified": only an official service can confirm a notice.
 */
export type Authenticity = {
  status: 'unverified' | 'warning_signs';
  summary: string;
  checks: AuthenticityCheck[];
  officialVerification: { label: string; url?: string }[];
  disclaimer: string;
};

/** Where a piece of text came from. OCR text can contain misread digits, so findings from it need review. */
export type TextSource = { method: 'text' | 'pdf_text' | 'ocr'; ocrConfidence?: number };

/** Status of one extracted field. A result is never more certain than the fields it depends on. */
export type FieldStatus = {
  field: string;
  label: string;
  value: string | null;
  /** checked = found in the notice text and read by code; needs_review = a person should confirm it. */
  status: 'checked' | 'needs_review' | 'not_found' | 'not_applicable';
  source: 'text' | 'pdf_text' | 'ocr' | 'user';
  reason?: string;
};

export type RecordFieldResult = 'match' | 'near_miss' | 'mismatch' | 'not_in_notice';

/** Comparison with a SYNTHETIC demo registry. It is not an official record and never proves a notice genuine. */
export type RecordComparison = {
  status: 'consistent' | 'differs' | 'no_record';
  source: 'synthetic_demo';
  sourceLabel: string;
  recordId?: string;
  nearestRecordId?: string;
  fields: { field: string; label: string; noticeValue: string | null; recordValue: string; result: RecordFieldResult }[];
  summary: string;
  disclaimer: string;
};

/** EXPERIMENTAL wording similarity (TF-IDF cosine). Not an authenticity assessment. */
export type TemplateSimilarity = {
  experimental: true;
  method: 'tf-idf cosine similarity';
  scores: { type: NoticeType; label: string; score: number }[];
  bestMatch: NoticeType | null;
  note: string;
};

/** Facts entered by the user to replace what the reader found (for example the date they received the notice). */
export type FactOverrides = {
  noticeType?: NoticeType;
  noticeDate?: string; // YYYY-MM-DD
  receiptDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  period?: { n: number; unit: 'days' | 'months'; anchor: 'receipt' | 'notice_date' };
};

/** Body of POST /api/analyse. */
export type AnalyseRequest = { text: string; source?: TextSource; overrides?: FactOverrides };

export type AnalysisResult = {
  id: string;
  noticeType: NoticeType;
  extractedText: string;
  extraction: {
    quality: 'good' | 'poor';
    warnings: string[];
    /** Always 'rules': no AI is used anywhere in this product. Show a "No AI used" badge. */
    method?: 'rules';
  };
  claims: Claim[];
  summaryPlain: string;
  professional: {
    recommendation: 'yes' | 'probably' | 'no';
    reasons: string[];
  };
  severity: {
    level: Severity;
    score: number;
    factors: { label: string; fired: boolean; weight: number }[];
  };
  deadline: {
    status: 'stated' | 'computed' | 'unclear' | 'conflict';
    /** ISO date YYYY-MM-DD. Only present for 'stated' and 'computed'. */
    date?: string;
    /** Negative when the date has passed. */
    daysLeft?: number;
    candidates?: { label: string; date: string }[];
    source: { quote?: string; ruleId?: string; ruleVerified: boolean };
    note?: string;
    /** true when the result depends on values a person should confirm (for example text read by OCR). */
    needsReview?: boolean;
    dependsOn?: string[];
  };
  chain: {
    evidence: string;
    interpretation: string;
    rule: string;
    decision: string;
    action: string;
  };
  consequences: { text: string; ruleId: string; verified: boolean }[];
  checklist: { id: string; label: string; why?: string }[];
  replyOutline: { heading: string; body: string }[];
  /** Added by backend (optional): signals that the notice may not be genuine, plus where to verify it officially. */
  authenticity?: Authenticity;
  /** Added by backend (optional): status of each key field, including whether it needs review. */
  fields?: FieldStatus[];
  /** Added by backend (optional): comparison with the synthetic demo registry. */
  recordComparison?: RecordComparison;
  /** Added by backend (optional): experimental wording similarity, shown separately from authenticity. */
  templateSimilarity?: TemplateSimilarity;
  isPrecomputedSample: boolean;
};

export type TrackedNotice = {
  result: AnalysisResult;
  stage: Stage;
  addedAt: string;
  unresolved: string[];
  docsGathered: string[];
};

export type BenchCase = {
  id: string;
  category: string;
  pass: boolean;
  reason: string;
  abstained: boolean;
};

export type BenchResults = {
  generatedAt: string;
  total: number;
  handled: number;
  abstained: number;
  /** All metrics are PERCENTAGES from 0 to 100, one decimal place. */
  metrics: {
    evidenceSupportRate: number;
    deadlineCorrectness: number;
    safeAbstentionRate: number;
  };
  cases: BenchCase[];
  /** Added by backend (optional): which extractor produced these results. */
  extractor?: 'heuristic';
  /** Added by backend (optional): plain-language caveats to show on the Reliability page. */
  notes?: string[];
};

/** Raw API error body returned by all backend routes on failure. */
export type ApiError = { error: string; code: string };

/** Body returned by POST /api/extract. */
export type ExtractResponse = {
  text: string;
  quality: 'good' | 'poor';
  warnings: string[];
  /** How the text was obtained. Pass it back to /api/analyse as `source`. */
  method: 'text' | 'pdf_text' | 'ocr';
  /** Mean OCR confidence 0-100 (OCR only). */
  ocrConfidence?: number;
  /** Words OCR was unsure about (OCR only). Show them to the user. */
  lowConfidenceWords?: string[];
};
