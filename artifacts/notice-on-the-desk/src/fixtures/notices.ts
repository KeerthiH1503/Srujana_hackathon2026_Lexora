import type {
  AnalysisResult,
  Claim,
  Evidence,
  NoticeType,
} from "@/types/analysis";

const SAMPLE_WATERMARK = "SYNTHETIC SAMPLE - NOT A REAL NOTICE";

function findEvidence(
  text: string,
  quote: string,
  expectedToBeFound = true,
): Evidence {
  const start = text.indexOf(quote);
  const foundInText = expectedToBeFound && start >= 0;

  return {
    quote,
    start: foundInText ? start : -1,
    end: foundInText ? start + quote.length : -1,
    foundInText,
  };
}

function claim(
  text: string,
  label: string,
  value: string,
  quote: string,
  confidence: Claim["confidence"] = "high",
): Claim {
  return {
    label,
    value,
    confidence,
    evidence: [findEvidence(text, quote)],
  };
}

function missingClaim(
  text: string,
  label: string,
  value: string,
  quote: string,
): Claim {
  return {
    label,
    value,
    confidence: "low",
    evidence: [findEvidence(text, quote, false)],
  };
}

function daysUntil(date: string): number {
  const target = Date.parse(`${date}T12:00:00Z`);
  const today = new Date();
  const todayNoon = Date.parse(
    `${today.toISOString().slice(0, 10)}T12:00:00Z`,
  );
  return Math.round((target - todayNoon) / 86_400_000);
}

function makeResult(
  result: Omit<AnalysisResult, "isPrecomputedSample">,
): AnalysisResult {
  return { ...result, isPrecomputedSample: true };
}

const gstText = `${SAMPLE_WATERMARK}
DEMO DEPARTMENT OF STATE TAX
Reference: DEMO-GST-26-104 | Date: 20 October 2026

To: Maya's Pantry
GSTIN: 29ABCDE1234F1Z5

Subject: Request for explanation about a return mismatch

Our sample records show a difference of ₹18,400 between the sales listed in your return and the records in this example. Please send a short explanation and copies of the relevant invoices by 12 November 2026.

This is a fictional training example. Do not send money or documents in response.`;

const chequeText = `${SAMPLE_WATERMARK}
MERIDIAN LEGAL SERVICES - FICTIONAL SAMPLE
Reference: DEMO-138-022 | Date: 18 October 2026

To: Arjun's Cycle Works
GSTIN: 27FGHJK4567L2M8

Subject: Sample demand about cheque 004218

This fictional letter refers to cheque 004218 for ₹48,000. It says the cheque was returned unpaid. The sample asks for payment within 15 days after receiving this letter. The fictional delivery date in this example is 18 October 2026.

This sample is not a real legal notice and does not state the law that applies to any real case.`;

const legalText = `${SAMPLE_WATERMARK}
NORTH STAR LEGAL - TRAINING DOCUMENT
Reference: DEMO-LGL-7021 | Date: 21 October 2026

To: Nila Home Foods

Subject: Request to stop using a business name

Our fictional client says your shop name is too similar to theirs. This sample asks you to stop using the name and send a written response by 20 November 2026.

The notice does not include a court name, case number, or copy of a registration record. This is a training example only.`;

const incomeTaxText = `${SAMPLE_WATERMARK}
DEMO INCOME TAX INFORMATION CENTRE
Reference: DEMO-IT-113 | Date: 6 October 2026

To: Devika Rao
PAN: ABCDE1234F

Subject: Sample request to review a filing

This fictional message asks you to check a difference of ₹7,250 in the sample return. It says a response is due within 30 days from the date of this message.

This is a fictional training example. It does not confirm a tax amount or a legal deadline.`;

const unclearText = `${SAMPLE_WATERMARK}
DEMO DISTRICT LICENSING OFFICE
Reference: DEMO-UNC-38 | Date: 22 October 2026

To: Kiran's Repair Shop

Subject: Follow-up about a licence record

Please reply by 10 November 2026.

The attached note says: "Send your reply before 14 November 2026."

This fictional sample contains two different dates. It is not possible to tell which one controls from this page alone.`;

const conflictText = `${SAMPLE_WATERMARK}
DEMO DISTRICT LICENSING OFFICE
Reference: DEMO-CONFLICT-39 | Date: 22 October 2026

To: Kiran's Repair Shop

Subject: Conflicting response dates

The first page says: "Please reply by 10 November 2026."
The final page says: "Your reply must arrive by 6 November 2026."

This fictional sample contains conflicting dates. It is not possible to select one deadline from this text alone.`;

export const sampleGst: AnalysisResult = makeResult({
  id: "sample-gst",
  noticeType: "gst_show_cause",
  extractedText: gstText,
  extraction: { quality: "good", warnings: [] },
  claims: [
    claim(gstText, "Sender", "Demo Department of State Tax", "DEMO DEPARTMENT OF STATE TAX"),
    claim(gstText, "Demand", "Explain a return mismatch and send invoices", "Please send a short explanation and copies of the relevant invoices"),
    claim(gstText, "Amount", "₹18,400", "₹18,400"),
    claim(gstText, "Key date", "12 November 2026", "by 12 November 2026"),
    missingClaim(
      gstText,
      "Law / section",
      "No law or section is named in the sample text",
      "Section 73 of the GST Act",
    ),
  ],
  summaryPlain:
    "This sample asks Maya's Pantry to explain a sales mismatch and share invoices by 12 November 2026. The notice does not name a law section.",
  professional: {
    recommendation: "probably",
    reasons: [
      "The sample asks for a money-related explanation.",
      "The legal basis is not shown in the text.",
    ],
  },
  severity: {
    level: "action_needed",
    score: 42,
    factors: [
      { label: "Response date is stated", fired: true, weight: 15 },
      { label: "Amount is mentioned", fired: true, weight: 12 },
      { label: "Legal section is missing", fired: true, weight: 15 },
      { label: "Court hearing is listed", fired: false, weight: 30 },
    ],
  },
  deadline: {
    status: "stated",
    date: "2026-11-12",
    daysLeft: daysUntil("2026-11-12"),
    source: {
      quote: "Please send a short explanation and copies of the relevant invoices by 12 November 2026.",
      ruleVerified: false,
    },
    note: "Date copied from this synthetic sample, not checked against an official source.",
  },
  chain: {
    evidence: "The sample asks for an explanation and invoices by 12 November 2026.",
    interpretation:
      "The business may need to gather the return and matching invoices.",
    rule: "No legal rule is verified in this demo.",
    decision: "A response date appears in the sample text.",
    action: "Check the original notice and discuss it with a tax professional if it is real.",
  },
  consequences: [
    {
      text: "Sample illustration only: a missed response may lead to more questions or further steps. The outcome depends on the real notice and applicable rules.",
      ruleId: "SAMPLE-ONLY",
      verified: false,
    },
  ],
  checklist: [
    { id: "gst-return", label: "Copy of the related GST return", why: "Compare the figures in the return with the notice." },
    { id: "gst-invoices", label: "Invoices for the period named in the notice", why: "The sample asks for copies of invoices." },
    { id: "gst-ledger", label: "Sales ledger for the same period", why: "It may help explain the difference." },
  ],
  replyOutline: [
    { heading: "Reference", body: "Regarding reference [[FILL: notice reference number]] dated [[FILL: notice date]]." },
    { heading: "What we found", body: "Our records show [[FILL: explain the difference using your records]]." },
    { heading: "Documents", body: "We are attaching [[FILL: list the documents included]]." },
  ],
});

export const sampleCheque: AnalysisResult = makeResult({
  id: "sample-cheque",
  noticeType: "cheque_bounce_138",
  extractedText: chequeText,
  extraction: { quality: "good", warnings: [] },
  claims: [
    claim(chequeText, "Sender", "Meridian Legal Services (fictional)", "MERIDIAN LEGAL SERVICES - FICTIONAL SAMPLE"),
    claim(chequeText, "Demand", "Payment requested for cheque 004218", "asks for payment within 15 days after receiving this letter"),
    claim(chequeText, "Amount", "₹48,000", "₹48,000"),
    claim(chequeText, "Key date", "18 October 2026 (fictional delivery date)", "18 October 2026"),
    claim(chequeText, "Law / section", "Section 138 is suggested by the sample category, not found in the notice text", "Negotiable Instruments Act, section 138", "low"),
  ],
  summaryPlain:
    "This fictional letter refers to an unpaid cheque for ₹48,000 and asks for payment within 15 days of receipt. The named law is not in the text.",
  professional: {
    recommendation: "yes",
    reasons: [
      "The sample concerns a cheque dispute and a money demand.",
      "A professional can check the original documents and the rules that apply.",
    ],
  },
  severity: {
    level: "urgent",
    score: 68,
    factors: [
      { label: "Short response window", fired: true, weight: 25 },
      { label: "Money demand", fired: true, weight: 18 },
      { label: "Legal dispute language", fired: true, weight: 25 },
      { label: "Official court date shown", fired: false, weight: 32 },
    ],
  },
  deadline: {
    status: "computed",
    date: "2026-11-02",
    daysLeft: daysUntil("2026-11-02"),
    source: {
      quote: "The fictional delivery date in this example is 18 October 2026.",
      ruleId: "DEMO-CALENDAR-15D",
      ruleVerified: false,
    },
    note: "Demo arithmetic: 15 calendar days after the fictional delivery date. This is not a legal calculation.",
  },
  chain: {
    evidence: "The sample says payment is requested within 15 days after receipt.",
    interpretation: "The sample provides a 15-day window and a fictional delivery date.",
    rule: "DEMO-CALENDAR-15D — example date counting only; not a verified legal rule.",
    decision: "A sample date can be counted, but a real deadline must be checked.",
    action: "Preserve the original letter and contact a qualified professional promptly if this is real.",
  },
  consequences: [
    {
      text: "Sample illustration only: a cheque dispute can involve further legal steps. A professional must check the real notice and dates before drawing conclusions.",
      ruleId: "SAMPLE-ONLY",
      verified: false,
    },
  ],
  checklist: [
    { id: "cheque-copy", label: "Copy of the cheque", why: "Confirm the cheque number and amount." },
    { id: "cheque-return", label: "Bank return memo", why: "Check the bank's stated reason and date." },
    { id: "cheque-delivery", label: "Proof of when the letter arrived", why: "The sample counts from a fictional receipt date." },
  ],
  replyOutline: [
    { heading: "Reference", body: "I am writing about [[FILL: reference number]] dated [[FILL: date]]." },
    { heading: "Our records", body: "Our records show [[FILL: explain the payment or dispute]]." },
    { heading: "Documents", body: "I am attaching [[FILL: list supporting documents]]." },
  ],
});

export const sampleLegal: AnalysisResult = makeResult({
  id: "sample-legal",
  noticeType: "legal_notice",
  extractedText: legalText,
  extraction: { quality: "good", warnings: [] },
  claims: [
    claim(legalText, "Sender", "North Star Legal (fictional)", "NORTH STAR LEGAL - TRAINING DOCUMENT"),
    claim(legalText, "Demand", "Stop using a similar business name and respond", "asks you to stop using the name and send a written response"),
    claim(legalText, "Amount", "No amount stated", "₹25,000", "low"),
    claim(legalText, "Key date", "20 November 2026", "by 20 November 2026"),
    missingClaim(legalText, "Law / section", "No law or section is shown", "Trade Marks Act, section 29"),
  ],
  summaryPlain:
    "This sample asks Nila Home Foods to stop using a business name and send a written response by 20 November 2026. It does not include supporting records.",
  professional: {
    recommendation: "yes",
    reasons: [
      "The request could affect the business name.",
      "The sample does not include a registration record or court details.",
    ],
  },
  severity: {
    level: "action_needed",
    score: 55,
    factors: [
      { label: "Response date is stated", fired: true, weight: 15 },
      { label: "Business rights are disputed", fired: true, weight: 25 },
      { label: "Court case number shown", fired: false, weight: 25 },
      { label: "Money demand shown", fired: false, weight: 15 },
    ],
  },
  deadline: {
    status: "stated",
    date: "2026-11-20",
    daysLeft: daysUntil("2026-11-20"),
    source: {
      quote: "This sample asks you to stop using the name and send a written response by 20 November 2026.",
      ruleVerified: false,
    },
    note: "Date copied from this synthetic sample. It is not a verified legal deadline.",
  },
  chain: {
    evidence: "The sample asks the shop to stop using a name and respond by 20 November 2026.",
    interpretation: "The sender appears to challenge the business name.",
    rule: "No legal rule or registration record is verified in this demo.",
    decision: "The request may affect the business and needs a careful review.",
    action: "Keep the original notice and ask a qualified professional to review it.",
  },
  consequences: [
    {
      text: "Sample illustration only: a name dispute may continue or lead to formal steps. The real outcome depends on facts and applicable law.",
      ruleId: "SAMPLE-ONLY",
      verified: false,
    },
  ],
  checklist: [
    { id: "legal-registration", label: "Business name registration papers", why: "Compare the names and dates." },
    { id: "legal-proof", label: "Earlier invoices, signs, and website records", why: "These may show how the name has been used." },
    { id: "legal-envelope", label: "Original envelope or delivery record", why: "Keep proof of when it arrived." },
  ],
  replyOutline: [
    { heading: "Reference", body: "I am responding to [[FILL: reference number]] dated [[FILL: date]]." },
    { heading: "Our position", body: "Our records about the business name show [[FILL: facts to confirm with a professional]]." },
    { heading: "Request", body: "Please provide [[FILL: documents or clarification requested]]." },
  ],
});

export const sampleIncomeTax: AnalysisResult = makeResult({
  id: "sample-it",
  noticeType: "it_intimation",
  extractedText: incomeTaxText,
  extraction: { quality: "good", warnings: [] },
  claims: [
    claim(incomeTaxText, "Sender", "Demo Income Tax Information Centre", "DEMO INCOME TAX INFORMATION CENTRE"),
    claim(incomeTaxText, "Demand", "Review a difference in the sample return", "asks you to check a difference of ₹7,250"),
    claim(incomeTaxText, "Amount", "₹7,250", "₹7,250"),
    claim(incomeTaxText, "Key date", "30 days from 6 October 2026 (sample calculation)", "within 30 days from the date of this message"),
    claim(incomeTaxText, "Law / section", "No law or section is shown", "Income Tax Act section 143(1)", "low"),
  ],
  summaryPlain:
    "This fictional message asks Devika Rao to check a ₹7,250 difference and says to respond within 30 days from 6 October 2026.",
  professional: {
    recommendation: "probably",
    reasons: [
      "The sample refers to a tax return difference.",
      "The actual account and official portal are not checked in this demo.",
    ],
  },
  severity: {
    level: "action_needed",
    score: 38,
    factors: [
      { label: "Response window is stated", fired: true, weight: 15 },
      { label: "Tax amount is mentioned", fired: true, weight: 10 },
      { label: "Official account checked", fired: false, weight: 20 },
      { label: "Court hearing listed", fired: false, weight: 30 },
    ],
  },
  deadline: {
    status: "computed",
    date: "2026-11-05",
    daysLeft: daysUntil("2026-11-05"),
    source: {
      quote: "It says a response is due within 30 days from the date of this message.",
      ruleId: "DEMO-CALENDAR-30D",
      ruleVerified: false,
    },
    note: "Demo arithmetic: 30 calendar days from the fictional message date. Verify any real deadline against an official source.",
  },
  chain: {
    evidence: "The sample says a response is due within 30 days from 6 October 2026.",
    interpretation: "The sample asks the recipient to review a return difference.",
    rule: "DEMO-CALENDAR-30D — example date counting only; not a verified legal rule.",
    decision: "A sample date can be counted, but the official account and real deadline are unknown.",
    action: "Check the official tax portal and consult a tax professional if the message is real.",
  },
  consequences: [
    {
      text: "Sample illustration only: an unanswered tax message may lead to further notices or steps. Check the official account before acting.",
      ruleId: "SAMPLE-ONLY",
      verified: false,
    },
  ],
  checklist: [
    { id: "it-return", label: "Filed return and acknowledgement", why: "Compare the filed details with the message." },
    { id: "it-portal", label: "Official portal record", why: "Confirm that the message appears in the correct account." },
    { id: "it-payment", label: "Payment receipts and tax records", why: "These may explain a difference." },
  ],
  replyOutline: [
    { heading: "Reference", body: "Regarding [[FILL: official notice or reference number]]." },
    { heading: "Return details", body: "The filed return shows [[FILL: details to confirm against the official account]]." },
    { heading: "Supporting records", body: "I am attaching [[FILL: list documents reviewed by your adviser]]." },
  ],
});

export const sampleUnclear: AnalysisResult = makeResult({
  id: "sample-unclear",
  noticeType: "unknown",
  extractedText: unclearText,
  extraction: { quality: "poor", warnings: ["Two different response dates appear in the sample."] },
  claims: [
    claim(unclearText, "Sender", "Demo District Licensing Office", "DEMO DISTRICT LICENSING OFFICE"),
    claim(unclearText, "Demand", "Reply about a licence record", "Follow-up about a licence record"),
    claim(unclearText, "Key date", "10 November 2026", "Please reply by 10 November 2026.", "medium"),
    claim(unclearText, "Key date", "14 November 2026", "Send your reply before 14 November 2026.", "medium"),
    missingClaim(unclearText, "Law / section", "No law or section is shown", "Licensing Act section 14"),
  ],
  summaryPlain:
    "This sample asks for a reply about a licence record, but it gives two different dates. The correct date cannot be determined from this page.",
  professional: {
    recommendation: "yes",
    reasons: [
      "The two dates do not match.",
      "The legal basis is not shown.",
    ],
  },
  severity: {
    level: "urgent",
    score: 72,
    factors: [
      { label: "Conflicting dates appear", fired: true, weight: 35 },
      { label: "Licence status may be affected", fired: true, weight: 22 },
      { label: "Legal section missing", fired: true, weight: 15 },
      { label: "Court date listed", fired: false, weight: 30 },
    ],
  },
  deadline: {
    status: "unclear",
    candidates: [
      { label: "First page", date: "2026-11-10" },
      { label: "Attached note", date: "2026-11-14" },
    ],
    source: {
      quote: "The main text and attached note show different dates.",
      ruleVerified: false,
    },
    note: "Do not rely on either date until the full notice is checked.",
  },
  chain: {
    evidence: "The main text says 10 November; the attached note says 14 November.",
    interpretation: "The sample contains two possible response dates.",
    rule: "No verified rule resolves the difference.",
    decision: "Cannot establish — verify the original notice.",
    action: "Check every page and contact the issuing office or a qualified professional.",
  },
  consequences: [
    {
      text: "Sample illustration only: missing a real response date may lead to follow-up steps. The correct date must be confirmed first.",
      ruleId: "SAMPLE-ONLY",
      verified: false,
    },
  ],
  checklist: [
    { id: "unclear-pages", label: "Every page and attachment", why: "The two dates may come from different parts of the notice." },
    { id: "unclear-envelope", label: "Envelope and delivery proof", why: "The received date may matter." },
    { id: "unclear-call", label: "Contact details for the issuing office", why: "Ask which date applies and keep a note of the answer." },
  ],
  replyOutline: [
    { heading: "Reference", body: "Regarding [[FILL: reference number]] received on [[FILL: date received]]." },
    { heading: "Clarification", body: "The notice appears to list both [[FILL: first date]] and [[FILL: second date]]. Please confirm the applicable response date." },
    { heading: "Next step", body: "We will respond after confirming [[FILL: required information]]." },
  ],
});

export const sampleConflict: AnalysisResult = makeResult({
  id: "sample-unclear-conflict",
  noticeType: "unknown",
  extractedText: conflictText,
  extraction: { quality: "poor", warnings: ["Two different response dates appear on different pages."] },
  claims: [
    claim(conflictText, "Sender", "Demo District Licensing Office", "DEMO DISTRICT LICENSING OFFICE"),
    claim(conflictText, "Key date", "10 November 2026", "Please reply by 10 November 2026.", "medium"),
    claim(conflictText, "Key date", "6 November 2026", "Your reply must arrive by 6 November 2026.", "medium"),
    missingClaim(conflictText, "Law / section", "No law or section is shown", "Licensing Act section 14"),
  ],
  summaryPlain:
    "This sample gives two different response dates on separate pages. Do not choose one without checking the complete original notice.",
  professional: {
    recommendation: "yes",
    reasons: [
      "The dates conflict across pages.",
      "The full notice and applicable rules need professional review.",
    ],
  },
  severity: {
    level: "urgent",
    score: 84,
    factors: [
      { label: "Conflicting dates appear", fired: true, weight: 40 },
      { label: "Licence status may be affected", fired: true, weight: 24 },
      { label: "Legal section missing", fired: true, weight: 20 },
      { label: "Court date listed", fired: false, weight: 30 },
    ],
  },
  deadline: {
    status: "conflict",
    candidates: [
      { label: "First page", date: "2026-11-10" },
      { label: "Final page", date: "2026-11-06" },
    ],
    source: {
      quote: "The first and final pages show different dates.",
      ruleVerified: false,
    },
    note: "No single date is selected. Confirm the controlling date using the full original notice.",
  },
  chain: {
    evidence: "The first page says 10 November; the final page says 6 November.",
    interpretation: "The dates conflict across pages.",
    rule: "No verified rule resolves the conflict.",
    decision: "Cannot establish — verify the original notice.",
    action: "Contact the issuing office or a qualified professional promptly.",
  },
  consequences: [
    {
      text: "Sample illustration only: relying on the wrong date could mean a response is late. Confirm the date before acting.",
      ruleId: "SAMPLE-ONLY",
      verified: false,
    },
  ],
  checklist: [
    { id: "conflict-pages", label: "Complete notice with all pages", why: "The dates differ between pages." },
    { id: "conflict-proof", label: "Proof of delivery date", why: "Keep the original envelope or receipt." },
    { id: "conflict-confirmation", label: "Written date confirmation", why: "Record the answer from the issuing office or adviser." },
  ],
  replyOutline: [
    { heading: "Reference", body: "Regarding [[FILL: reference number]] received on [[FILL: date received]]." },
    { heading: "Date clarification", body: "The first page lists [[FILL: first date]], while the final page lists [[FILL: second date]]. Please confirm which date applies." },
    { heading: "Next step", body: "We will respond after confirming [[FILL: required action]]." },
  ],
});

export const noticeSamples: AnalysisResult[] = [
  sampleGst,
  sampleCheque,
  sampleLegal,
  sampleIncomeTax,
  sampleUnclear,
];

export const noticeFixtures: Record<string, AnalysisResult> = {
  [sampleGst.id]: sampleGst,
  [sampleCheque.id]: sampleCheque,
  [sampleLegal.id]: sampleLegal,
  [sampleIncomeTax.id]: sampleIncomeTax,
  [sampleUnclear.id]: sampleUnclear,
  [sampleConflict.id]: sampleConflict,
};

export function getSampleResult(id: string): AnalysisResult | undefined {
  return noticeFixtures[id];
}

export function findMatchingSyntheticNotice(text: string): AnalysisResult | undefined {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return undefined;

  return Object.values(noticeFixtures).find((fixture) => {
    const fixtureText = fixture.extractedText
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    return normalized === fixtureText;
  });
}

export function getNoticeTypeLabel(type: NoticeType): string {
  const labels: Record<NoticeType, string> = {
    gst_show_cause: "GST show-cause",
    cheque_bounce_138: "Cheque notice",
    it_intimation: "Income tax intimation",
    legal_notice: "Legal notice",
    unknown: "Needs review",
  };
  return labels[type];
}

export { SAMPLE_WATERMARK };
