// RULES TABLE. This is the ONLY place legal knowledge lives.
// The AI model never supplies deadlines, section numbers or consequences.
//
// Each rule records: what it says, the source, whether it has been verified, and its limits.
// `verified: true` means a person checked the rule against the sources listed (last check date in
// `verifiedOn`). Anything marked `verified: false` is shown as "not verified" in the interface.
// TODO_VERIFY entries are the ones the legal lead must still confirm before the demo.

import type { NoticeType } from '../types/analysis';

export type Rule = {
  id: string;
  appliesTo: NoticeType | 'general';
  description: string;
  sources: { label: string; url?: string }[];
  verified: boolean;
  verifiedOn?: string; // ISO date
  /** 'primary' = bare act / judgment text; 'secondary' = reputable commentary quoting the act. */
  verifiedFrom?: 'primary' | 'secondary';
  limitations: string[];
};

export const RULES: Record<string, Rule> = {
  'R-STATED-DATE': {
    id: 'R-STATED-DATE',
    appliesTo: 'general',
    description: 'When a notice states its own response date, that stated date is reported as the deadline.',
    sources: [{ label: 'The notice itself' }],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'primary',
    limitations: [
      'This only reports what the notice says. It does not confirm that the date is legally valid or that it matches the statutory period.',
    ],
  },
  'R-COUNT-DAYS': {
    id: 'R-COUNT-DAYS',
    appliesTo: 'general',
    description:
      'When a period runs "from" a date, that first day is excluded and the last day is included (General Clauses Act, 1897, section 9).',
    sources: [
      { label: 'General Clauses Act 1897, s.9 (bare act text)', url: 'https://www.advocatekhoj.com/library/bareacts/generalclauses/9.php' },
      { label: 'Supreme Court decisions applying the rule (summary)', url: 'https://taxguru.in/?p=1082831' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'primary',
    limitations: [
      'Section 9 applies to Central Acts and Regulations. For periods set only by a private sender in a notice, courts generally follow the same approach, but confirm for your case.',
      'Public holidays and any extension of time are NOT considered by this tool.',
      'Month periods are counted by calendar month (a date that does not exist in the target month moves to its last day).',
    ],
  },
  'R-138-PAY-15': {
    id: 'R-138-PAY-15',
    appliesTo: 'cheque_bounce_138',
    description:
      'Section 138, Negotiable Instruments Act: after a valid demand notice, the drawer has 15 days from RECEIPT of the notice to pay. If payment is not made in that time, the cause of action for a complaint arises.',
    sources: [
      { label: 'Supreme Court judgment quoting s.138 (Crl. Appeal 27023 of 2018)', url: 'https://api.sci.gov.in/supremecourt/2018/27023/27023_2018_Judgement_08-May-2019.pdf' },
      { label: 'Delhi High Court on the 15-day payment period (LiveLaw report)', url: 'https://www.livelaw.in/amp/high-court/delhi-high-court/s138-ni-act-statutory-notice-period-to-lodge-cheque-bounce-complaint-is-15-days-not-45-days-delhi-high-court-302875' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'primary',
    limitations: [
      'The 15 days run from receipt of the notice, so the date of receipt matters. If it is not known the tool cannot give a single date.',
      'A notice that demands payment in fewer days does not shorten the 15-day statutory period; courts have looked at this question case by case.',
      'Whether the notice itself is valid (for example, sent within 30 days of the bank memo) is a legal question this tool does not decide.',
    ],
  },
  'R-138-COMPLAINT': {
    id: 'R-138-COMPLAINT',
    appliesTo: 'cheque_bounce_138',
    description:
      'If the drawer does not pay within 15 days of receiving the demand notice, the payee can file a complaint in court within one month (section 142). Offences under section 138 are pursued by complaint to a court.',
    sources: [
      { label: 'Supreme Court judgment quoting ss.138 and 142', url: 'https://api.sci.gov.in/supremecourt/2018/27023/27023_2018_Judgement_08-May-2019.pdf' },
      { label: 'Delhi High Court (Verdictum report)', url: 'https://www.verdictum.in/court-updates/high-courts/delhi-high-court/smt-rama-oberoi-vs-state-nct-of-delhi-anr-2025dhc7683-cheque-bounce-complaint-can-be-filed-if-drawer-fails-to-make-payment-within-15-days-of-service-of-notice-1590632' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'primary',
    limitations: ['Penalties and punishment are not stated here. Ask a lawyer about the consequences for your case.'],
  },
  'R-138-DEMAND-30': {
    id: 'R-138-DEMAND-30',
    appliesTo: 'cheque_bounce_138',
    description:
      'The payee must send the demand notice within 30 days of receiving the bank\'s information that the cheque was returned unpaid. This is a condition on the SENDER of the notice.',
    sources: [
      { label: 'Supreme Court judgment (Crl. Appeal 27023 of 2018)', url: 'https://api.sci.gov.in/supremecourt/2018/27023/27023_2018_Judgement_08-May-2019.pdf' },
      { label: 'Delhi High Court judgment (Crl. M.C. 7221/2025)', url: 'https://delhihighcourt.nic.in/app/showFileJudgment/NBK05012026CRLMM72212025_182121.pdf' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'primary',
    limitations: ['The tool does not check whether the sender met this condition. A lawyer should.'],
  },
  'R-GST-73-8': {
    id: 'R-GST-73-8',
    appliesTo: 'gst_show_cause',
    description:
      'Section 73(8), CGST Act (non-fraud cases): if the tax and interest are paid within 30 days of the issue of the show cause notice, no penalty is payable and proceedings on that notice are treated as concluded.',
    sources: [
      { label: 'TaxTMI article quoting s.73(8)', url: 'https://www.taxtmi.com/article/detailed?id=12178' },
      { label: 'Tally Solutions guide to section 73', url: 'https://tallysolutions.com/gst/section-73-cgst-act/' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'secondary',
    limitations: [
      'Applies to notices under section 73 (not fraud). Section 74 notices have different penalty rules.',
      'For tax periods from FY 2024-25 onwards, section 74A applies instead of sections 73 and 74. Check which section your notice cites.',
      'TODO_VERIFY against the bare Act on the CBIC / India Code site before the demo.',
    ],
  },
  'R-GST-REPLY-STATED': {
    id: 'R-GST-REPLY-STATED',
    appliesTo: 'gst_show_cause',
    description:
      'The GST law does not itself fix one reply date for a show cause notice. The notice states the date or period for the reply, which in practice is often up to 30 days and can be shorter.',
    sources: [
      { label: 'TaxTMI article on reply time for GST show cause notices', url: 'https://www.taxtmi.com/article/detailed?id=12178' },
      { label: 'ClearTax guide to show cause notices', url: 'https://cleartax.in/s/what-is-a-show-cause-notice-how-to-handle-it' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'secondary',
    limitations: ['If your notice does not state a reply date, ask the issuing officer or a professional. Do not assume 30 days.'],
  },
  'R-GST-IGNORE': {
    id: 'R-GST-IGNORE',
    appliesTo: 'gst_show_cause',
    description: 'If a show cause notice is ignored, a final order can be passed against the business with interest and penalty.',
    sources: [{ label: 'Tax2win guide to section 73', url: 'https://tax2win.in/guide/cgst-section-73' }],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'secondary',
    limitations: ['The amount of penalty depends on the section and facts. This tool does not calculate it.'],
  },
  'R-IT-143-1-A': {
    id: 'R-IT-143-1-A',
    appliesTo: 'it_intimation',
    description:
      'Section 143(1)(a), Income-tax Act: before making a proposed adjustment to a return, the department intimates it and gives 30 days from the issue of the intimation to respond. If there is no response, the adjustment is made.',
    sources: [
      { label: 'Moneylife report quoting the 30-day provision', url: 'https://www.moneylife.in/article/it-portal-glitches-taxpayers-receiving-notices-under-section-1431a-but-unable-to-respond/65319.html' },
      { label: 'Taxscan report quoting CBDT on the second proviso', url: 'https://www.taxscan.in/?p=16081' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'secondary',
    limitations: [
      'Applies to an intimation of PROPOSED ADJUSTMENT under s.143(1)(a). A processing intimation after the return is processed is different and is answered through other routes (for example, rectification or appeal).',
      'TODO_VERIFY against the Act text on the Income Tax Department site, including any amendments for the assessment year in the notice.',
    ],
  },
  'R-IT-143-1-INFO': {
    id: 'R-IT-143-1-INFO',
    appliesTo: 'it_intimation',
    description: 'An intimation after processing a return reports the computation. If you disagree, the usual routes are rectification or appeal; time limits depend on the route.',
    sources: [{ label: 'TODO_VERIFY: Income Tax Department guidance on rectification and appeal' }],
    verified: false,
    limitations: ['Time limits for rectification and appeal are NOT verified in this tool.'],
  },
  'R-LEGAL-NOTICE-GENERAL': {
    id: 'R-LEGAL-NOTICE-GENERAL',
    appliesTo: 'legal_notice',
    description:
      'A legal notice from a private party (customer, landlord, ex-employee) usually has no statutory deadline. The sender sets a period, and failing to respond can lead to a civil suit or a complaint.',
    sources: [{ label: 'TODO_VERIFY: general position; confirm with a lawyer for the specific claim' }],
    verified: false,
    limitations: ['Some claims have their own statutory rules (for example employment or tenancy laws). This tool does not cover them.'],
  },
  'R-IT-DIN': {
    id: 'R-IT-DIN',
    appliesTo: 'it_intimation',
    description:
      'Every communication from the Income Tax Department issued on or after 1 October 2019 must carry a Document Identification Number (DIN). A notice can be authenticated on the e-Filing portal without logging in.',
    sources: [
      { label: 'Income Tax e-Filing portal FAQ: Authenticate Notice/Order issued by ITD', url: 'https://www.incometax.gov.in/iec/foportal/help/authenticate-notice-faq' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'primary',
    limitations: [
      'Having a DIN does not prove a notice is genuine: it must be authenticated on the official service.',
      'The portal FAQ lists the details accepted for authentication; the tool does not call the service itself.',
    ],
  },
  'R-GST-RFN': {
    id: 'R-GST-RFN',
    appliesTo: 'gst_show_cause',
    description:
      'On the GST portal, a Reference Number (RFN) on communications from State GST officers can be checked under Services > User Services > Verify RFN (limited details are shown before login). For communications from Central GST officers, the CBIC DIN verification facility is used.',
    sources: [
      { label: 'GSTN advisory on RFN (state tax department copy)', url: 'https://comtax.up.nic.in/gsthome/GSTN_Advisory/Advisory_States-RFN.pdf' },
      { label: 'CBIC Circular 249/2025 on DIN and RFN', url: 'https://cbic-gst.gov.in/pdf/Circular-No-249-2025.pdf' },
    ],
    verified: true,
    verifiedOn: '2026-10-24',
    verifiedFrom: 'primary',
    limitations: [
      'Not every notice carries an RFN or DIN, and the tool cannot look the number up itself.',
      'TODO_VERIFY the exact menu path on the live GST portal before the demo, because portals change.',
    ],
  },
  'R-AUTH-HEURISTIC': {
    id: 'R-AUTH-HEURISTIC',
    appliesTo: 'general',
    description:
      'Warning signs such as personal payment IDs, non-government web or email addresses, urgent threats, or sender names that nearly match a known department are team-defined checks. They suggest the notice should be verified; they do not prove it is fake.',
    sources: [{ label: 'Team-defined heuristics (see src/lib/engine/authenticity.ts)' }],
    verified: false,
    limitations: [
      'The list of trusted department names is a small demo list, not an official database.',
      'A genuine notice can trigger a warning, and a fake notice can trigger none.',
    ],
  },
  'R-SEVERITY-HEURISTIC': {
    id: 'R-SEVERITY-HEURISTIC',
    appliesTo: 'general',
    description: 'Severity is a team-defined score from the factors shown. It is a triage aid, not a legal classification.',
    sources: [{ label: 'Team-defined heuristic (see src/lib/engine/severity.ts)' }],
    verified: false,
    limitations: ['Thresholds (for example amounts) are judgement calls and have not been validated by a professional.'],
  },
};

export function getRule(id: string): Rule | undefined {
  return RULES[id];
}

/**
 * A rule counts as verified only if: the flag is true, it was checked against a PRIMARY source,
 * and no TODO_VERIFY note is left in it. A flag alone is not enough.
 */
export function isRuleVerified(id: string | undefined): boolean {
  if (!id) return false;
  const rule = RULES[id];
  return !!rule && rule.verified === true && rule.verifiedFrom === 'primary' && !rule.limitations.some((l) => l.includes('TODO_VERIFY'));
}

export type StatutoryPeriod = {
  ruleId: string;
  n: number;
  anchor: 'receipt' | 'notice_date';
  /** binding = a notice cannot shorten this period for the recipient. */
  binding: boolean;
  label: string;
  /** Only apply the fallback when the text contains a matching hint (see deadline engine). */
  requiresHint?: 'itProposedAdjustment';
};

export type NoticeTypeConfig = {
  label: string;
  plainSummary: string;
  baselineSeverity: number;
  statutory?: StatutoryPeriod;
  /** Reference-only candidate shown when the deadline is unclear. */
  referenceCandidate?: { n: number; label: string; ruleId: string };
  rulesUsed: string[];
  consequences: { text: string; ruleId: string }[];
  checklist: { id: string; label: string; why: string }[];
  replyOutline: { heading: string; body: string }[];
  /** true = always recommend a professional (criminal exposure etc.). */
  alwaysProfessional: boolean;
};

const COMMON_REPLY_CLOSING = {
  heading: 'Request and reservation',
  body: 'State what you ask the sender to do (for example, withdraw the notice, accept your explanation, or give more time) and that you reserve your rights. [[FILL: your specific request]]',
};

export const NOTICE_TYPE_CONFIG: Record<NoticeType, NoticeTypeConfig> = {
  gst_show_cause: {
    label: 'GST show cause notice',
    plainSummary:
      'This looks like a GST show cause notice. The tax office says it may demand tax, interest or penalty and asks you to explain why it should not. Check the date by which the reply is due.',
    baselineSeverity: 30,
    referenceCandidate: {
      n: 30,
      label: 'Reference only: 30 days from the notice date (the period to pay tax and interest without penalty under section 73(8) for non-fraud cases)',
      ruleId: 'R-GST-73-8',
    },
    rulesUsed: ['R-GST-REPLY-STATED', 'R-GST-73-8', 'R-GST-IGNORE', 'R-STATED-DATE', 'R-COUNT-DAYS'],
    consequences: [
      { text: 'If the notice is not answered, a final order can be passed against the business, with interest and penalty.', ruleId: 'R-GST-IGNORE' },
      { text: 'In section 73 cases, paying the tax and interest within 30 days of the notice can avoid a penalty.', ruleId: 'R-GST-73-8' },
    ],
    checklist: [
      { id: 'gst-1', label: 'The full notice with all annexures and attachments', why: 'The annexures list the exact amounts and periods in question.' },
      { id: 'gst-2', label: 'GST returns for the periods named (GSTR-1 and GSTR-3B)', why: 'The department compares what you filed with its records.' },
      { id: 'gst-3', label: 'Input tax credit reconciliation (books versus GSTR-2B)', why: 'Many notices are about credit that does not match.' },
      { id: 'gst-4', label: 'Sales and purchase invoices, e-way bills and payment proofs', why: 'These support your explanation of each point.' },
      { id: 'gst-5', label: 'Any challans or payments already made', why: 'Payments already made may reduce the demand.' },
      { id: 'gst-6', label: 'Earlier letters or portal messages about this matter', why: 'They show the history and what you already told the department.' },
    ],
    replyOutline: [
      { heading: 'Reference', body: 'Notice number [[FILL: notice reference]], dated [[FILL: notice date]], issued by [[FILL: issuing office]], GSTIN [[FILL: your GSTIN]].' },
      { heading: 'Acknowledgement', body: 'Confirm that you received the notice on [[FILL: date received]] and that this is your reply.' },
      { heading: 'Facts and background', body: 'Explain your business and the transactions in question. [[FILL: short factual background]]' },
      { heading: 'Point-wise response', body: 'Reply to each allegation in the order the notice raises it, with the supporting document for each. [[FILL: your response to each point]]' },
      { heading: 'Documents attached', body: 'List each document you attach. [[FILL: document list]]' },
      COMMON_REPLY_CLOSING,
    ],
    alwaysProfessional: false,
  },
  cheque_bounce_138: {
    label: 'Cheque bounce demand notice (Section 138)',
    plainSummary:
      'This looks like a demand notice about a cheque that was returned unpaid. It asks you to pay the cheque amount. The law gives the person who issued the cheque 15 days from receiving the notice to pay, after which a court complaint can be filed.',
    baselineSeverity: 25,
    statutory: {
      ruleId: 'R-138-PAY-15',
      n: 15,
      anchor: 'receipt',
      binding: true,
      label: '15 days from the date you RECEIVED the notice (section 138)',
    },
    rulesUsed: ['R-138-PAY-15', 'R-138-COMPLAINT', 'R-138-DEMAND-30', 'R-STATED-DATE', 'R-COUNT-DAYS'],
    consequences: [
      { text: 'If the amount is not paid within 15 days of receiving the notice, the sender can file a criminal complaint in court within one month.', ruleId: 'R-138-COMPLAINT' },
    ],
    checklist: [
      { id: 'chq-1', label: 'The demand notice, and the proof of the DATE YOU RECEIVED it (postal receipt, courier or email record)', why: 'The 15 days run from receipt, so this date matters most.' },
      { id: 'chq-2', label: 'A copy of the cheque and the bank\'s return memo', why: 'They show the reason for the return and the date.' },
      { id: 'chq-3', label: 'The agreement, invoice or record of the debt the cheque relates to', why: 'It shows whether, and how much, is actually owed.' },
      { id: 'chq-4', label: 'Proof of any payment or part-payment already made', why: 'Payments already made change the amount demanded.' },
      { id: 'chq-5', label: 'Bank statements for the account the cheque was drawn on', why: 'They show the balance and transactions around the date.' },
      { id: 'chq-6', label: 'Messages or emails with the sender about this payment', why: 'They show what was agreed.' },
    ],
    replyOutline: [
      { heading: 'Reference', body: 'Your notice dated [[FILL: notice date]], received by me/us on [[FILL: date of receipt]], regarding cheque number [[FILL: cheque number]].' },
      { heading: 'Position on the debt', body: 'State whether the amount is owed, disputed or already paid, with dates and proof. [[FILL: your position and proof]]' },
      { heading: 'Payment or proposal', body: 'If you intend to pay, state the amount, date and mode. If you dispute it, state the grounds. [[FILL: payment details or grounds]]' },
      COMMON_REPLY_CLOSING,
    ],
    alwaysProfessional: true,
  },
  it_intimation: {
    label: 'Income tax intimation',
    plainSummary:
      'This looks like a message from the Income Tax Department about your return. Some intimations only report a computation; others propose an adjustment and ask for your response within a set time. Check which kind this is.',
    baselineSeverity: 10,
    statutory: {
      ruleId: 'R-IT-143-1-A',
      n: 30,
      anchor: 'notice_date',
      binding: false,
      label: '30 days from the date the intimation was issued (section 143(1)(a), proposed adjustments only)',
      requiresHint: 'itProposedAdjustment',
    },
    rulesUsed: ['R-IT-143-1-A', 'R-IT-143-1-INFO', 'R-STATED-DATE', 'R-COUNT-DAYS'],
    consequences: [
      { text: 'If you do not respond to a proposed adjustment in time, the adjustment is made to your return.', ruleId: 'R-IT-143-1-A' },
    ],
    checklist: [
      { id: 'it-1', label: 'The intimation or notice PDF and its reference number', why: 'The response is filed against this reference on the e-filing portal.' },
      { id: 'it-2', label: 'The income tax return you filed and its acknowledgement', why: 'The notice compares it with other records.' },
      { id: 'it-3', label: 'Form 26AS and AIS (Annual Information Statement)', why: 'Most mismatches come from these records.' },
      { id: 'it-4', label: 'Form 16 / 16A and the books or computation behind your return', why: 'They support the figures you reported.' },
      { id: 'it-5', label: 'Proof for each deduction or claim mentioned', why: 'Disallowed claims need proof.' },
    ],
    replyOutline: [
      { heading: 'Reference', body: 'PAN [[FILL: PAN]], assessment year [[FILL: year]], intimation number [[FILL: reference]], dated [[FILL: date]].' },
      { heading: 'Response to each proposed adjustment', body: 'For each item: say whether you agree, or explain why not, and attach proof. [[FILL: response for each adjustment]]' },
      { heading: 'Documents attached', body: 'List each document you attach. [[FILL: document list]]' },
    ],
    alwaysProfessional: false,
  },
  legal_notice: {
    label: 'Legal notice from a private party',
    plainSummary:
      'This looks like a legal notice from a person, company or their lawyer. It makes a demand and says what may follow if you do not comply. It is usually a private demand rather than a court order.',
    baselineSeverity: 15,
    rulesUsed: ['R-LEGAL-NOTICE-GENERAL', 'R-STATED-DATE', 'R-COUNT-DAYS'],
    consequences: [
      { text: 'The sender may start court action or file a complaint if the demand is not met. The right steps depend on the claim.', ruleId: 'R-LEGAL-NOTICE-GENERAL' },
    ],
    checklist: [
      { id: 'ln-1', label: 'The notice, with the envelope, courier slip or email showing when you received it', why: 'The date of receipt may decide when a period starts.' },
      { id: 'ln-2', label: 'The agreement, lease, invoice or offer letter behind the claim', why: 'It shows what was actually agreed.' },
      { id: 'ln-3', label: 'Proof of payments, receipts and delivery', why: 'They show what has already been done.' },
      { id: 'ln-4', label: 'Messages and emails with the sender', why: 'They show how the dispute developed.' },
      { id: 'ln-5', label: 'The sender\'s identity and the lawyer\'s details', why: 'You need them to reply and to check who is claiming.' },
    ],
    replyOutline: [
      { heading: 'Reference', body: 'Your notice dated [[FILL: notice date]], received on [[FILL: date received]].' },
      { heading: 'Facts as you understand them', body: 'Give your account of the dealings in date order. [[FILL: your account]]' },
      { heading: 'Response to the demand', body: 'Say whether you accept, dispute or partly accept each demand, with reasons and proof. [[FILL: your response]]' },
      COMMON_REPLY_CLOSING,
    ],
    alwaysProfessional: false,
  },
  unknown: {
    label: 'Not one of the supported notice types',
    plainSummary:
      'This does not clearly match one of the notice types this tool supports (GST show cause, cheque bounce demand, income tax intimation, legal notice). Treat any dates here with care and ask a professional.',
    baselineSeverity: 20,
    rulesUsed: ['R-STATED-DATE'],
    consequences: [],
    checklist: [
      { id: 'un-1', label: 'The full document and how and when you received it', why: 'A professional will need both.' },
      { id: 'un-2', label: 'Any earlier correspondence about the matter', why: 'It gives context.' },
    ],
    replyOutline: [],
    alwaysProfessional: false,
  },
};

/** Words in rules.ts marked TODO_VERIFY, used by the CLI check `npm run rules:check`. */
export function listUnverifiedRules(): Rule[] {
  return Object.values(RULES).filter((r) => !r.verified || r.limitations.some((l) => l.includes('TODO_VERIFY')));
}
