// AUTHENTICITY SIGNALS. Deterministic checks only (regular expressions, string similarity, rules).
// IMPORTANT: this module can raise warning signs. It can NEVER confirm that a notice is genuine.
// Only the issuing authority's official verification service can do that, so the status is never "verified".

import type { Authenticity, AuthenticityCheck, NoticeType, RecordComparison } from '../../types/analysis';
import { similarityRatio } from './similarity';
import { verifyQuote } from './text';

/** Small DEMO list of department names. Not an official database. */
export const TRUSTED_SENDER_NAMES = [
  'Income Tax Department',
  'Central Board of Direct Taxes',
  'Central Board of Indirect Taxes and Customs',
  'Goods and Services Tax Network',
  'Directorate General of GST Intelligence',
  'Centralized Processing Centre',
] as const;

const GOV_NOTICE_TYPES: NoticeType[] = ['gst_show_cause', 'it_intimation'];

const DIN_RE = /\b(?:DIN|Document\s+Identification\s+Number)\b(?:\s*&\s*Notice\s*No\.?)?\s*(?:No\.?|Number)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/().\-]{7,})/i;
const RFN_RE = /\b(?:RFN|Reference\s+Number)\b\s*[:\-]?\s*([A-Z0-9][A-Z0-9/().\-]{5,})/i;
const REF_RE = /\b(?:Ref(?:erence)?\.?\s*(?:No\.?|Number)\s*[:\-]?|Ref(?:erence)?\s*[:\-]|Notice\s+(?:No\.?|Number)\s*[:\-]?|Our\s+Ref\.?\s*[:\-]?)\s*([A-Z0-9][A-Z0-9/().\-]{4,})/i;

const UPI_RE = /\b[a-z0-9][a-z0-9._-]{1,}@(?:ok(?:sbi|hdfcbank|icici|axis)|ybl|paytm|upi|apl|ibl|axl|sbi|icici|hdfcbank|axisbank|oksbi)\b/i;
const PAYMENT_TO_PERSON_RE = /\b(?:pay(?:ment)?|transfer|send|deposit)\b[^.\n]{0,60}\b(?:upi|qr code|google pay|gpay|phonepe|paytm|gift card|bitcoin|crypto|wallet)\b/i;
const URGENT_THREAT_RE = /\b(?:within\s+(?:12|24|48)\s+hours|immediate(?:ly)? arrest|arrest warrant|your (?:bank )?account will be (?:frozen|blocked|seized)|do not (?:tell|inform) anyone)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s)>,]+|\bwww\.[^\s)>,]+/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const SHORTENER_RE = /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|is\.gd)\b/i;

const isGovDomain = (host: string) => /(?:^|\.)(?:gov\.in|nic\.in)$/i.test(host);

function hostOf(urlLike: string): string | null {
  try {
    const u = new URL(urlLike.startsWith('http') ? urlLike : `https://${urlLike}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export type FoundIdentifier = { kind: 'DIN' | 'RFN' | 'reference number'; value: string; quote: string };

/** Finds a DIN, RFN or reference number printed on the notice. */
export function findIdentifier(text: string): FoundIdentifier | null {
  const din = DIN_RE.exec(text);
  const rfn = RFN_RE.exec(text);
  const ref = REF_RE.exec(text);
  const m = din ?? rfn ?? ref;
  if (!m) return null;
  return {
    kind: din ? 'DIN' : rfn ? 'RFN' : 'reference number',
    value: m[1].replace(/[.,;:]+$/, ''),
    quote: m[0],
  };
}

function evidenceFor(text: string, quote: string) {
  const ev = verifyQuote(text, quote);
  return ev.foundInText ? ev : undefined;
}

export function officialVerificationFor(type: NoticeType): Authenticity['officialVerification'] {
  switch (type) {
    case 'it_intimation':
      return [
        {
          label: 'Income Tax e-Filing portal: "Authenticate Notice/Order Issued by ITD" (works without logging in)',
          url: 'https://www.incometax.gov.in/iec/foportal/',
        },
      ];
    case 'gst_show_cause':
      return [
        { label: 'GST portal: Services > User Services > Verify RFN (State GST officers)', url: 'https://www.gst.gov.in/' },
        { label: 'CBIC DIN verification (Central GST officers)', url: 'https://cbic-gst.gov.in/' },
      ];
    case 'cheque_bounce_138':
    case 'legal_notice':
      return [
        { label: 'No single public service verifies private legal notices. Contact the sender or the advocate using details you find independently, not the ones printed in the notice.' },
      ];
    default:
      return [{ label: 'Identify the issuing authority and use its official verification service, or ask a professional.' }];
  }
}

export function checkAuthenticity(text: string, noticeType: NoticeType, comparison?: RecordComparison): Authenticity {
  const checks: AuthenticityCheck[] = [];
  const isGov = GOV_NOTICE_TYPES.includes(noticeType);

  // 1. Identifier present (DIN / RFN / reference number). Presence is NOT proof.
  const din = DIN_RE.exec(text);
  const rfn = RFN_RE.exec(text);
  const ref = REF_RE.exec(text);
  const idMatch = din ?? rfn ?? ref;
  const idKind = din ? 'DIN' : rfn ? 'RFN' : ref ? 'reference number' : null;
  if (idMatch && idKind) {
    checks.push({
      id: 'identifier',
      label: 'Notice identifier',
      result: 'found',
      detail: `A ${idKind} is printed on the notice. Its presence does not prove the notice is genuine: copied numbers are easy to fake. Check it on the official service.`,
      evidence: evidenceFor(text, idMatch[0]),
      heuristic: false,
    });
  } else {
    const itNote = noticeType === 'it_intimation'
      ? ' The Income Tax Department says communications issued on or after 1 October 2019 must carry a DIN, so confirm on the e-Filing portal before acting.'
      : '';
    checks.push({
      id: 'identifier',
      label: 'Notice identifier',
      result: isGov ? 'warning' : 'not_found',
      detail: `No DIN, RFN or reference number was found in the text.${itNote}`,
      heuristic: noticeType !== 'it_intimation',
    });
  }

  // 2. Web addresses and email domains (only meaningful for government-type notices).
  if (isGov) {
    const hosts: { host: string; quote: string }[] = [];
    for (const m of text.matchAll(URL_RE)) {
      const host = hostOf(m[0]);
      if (host) hosts.push({ host, quote: m[0] });
    }
    for (const m of text.matchAll(EMAIL_RE)) hosts.push({ host: m[1].toLowerCase(), quote: m[0] });
    const odd = hosts.filter((h) => !isGovDomain(h.host) || SHORTENER_RE.test(h.host));
    if (odd.length > 0) {
      checks.push({
        id: 'domains',
        label: 'Web or email addresses',
        result: 'warning',
        detail: `This notice type normally comes from a government address (ending gov.in or nic.in), but it contains: ${[...new Set(odd.map((o) => o.host))].slice(0, 3).join(', ')}.`,
        evidence: evidenceFor(text, odd[0].quote),
        heuristic: true,
      });
    } else if (hosts.length > 0) {
      checks.push({ id: 'domains', label: 'Web or email addresses', result: 'found', detail: 'Addresses in the notice use government domains. Scammers can still imitate them, so this is not proof.', heuristic: true });
    } else {
      checks.push({ id: 'domains', label: 'Web or email addresses', result: 'not_found', detail: 'No web or email addresses were found in the text.', heuristic: true });
    }
  }

  // 3. Payment instructions that point to a person rather than an official payment route.
  const upi = UPI_RE.exec(text);
  const payPerson = PAYMENT_TO_PERSON_RE.exec(text);
  if (upi || payPerson) {
    const hit = (upi ?? payPerson) as RegExpExecArray;
    checks.push({
      id: 'payment-route',
      label: 'Payment instructions',
      result: 'warning',
      detail: 'The notice asks for payment through a personal-style route (UPI ID, QR code, wallet, gift card or crypto). Check how the issuing authority actually accepts payment before paying anything.',
      evidence: evidenceFor(text, hit[0]),
      heuristic: true,
    });
  } else {
    checks.push({ id: 'payment-route', label: 'Payment instructions', result: 'not_found', detail: 'No personal-style payment instructions were found.', heuristic: true });
  }

  // 4. Pressure or threats typical of scams.
  const threat = URGENT_THREAT_RE.exec(text);
  checks.push(
    threat
      ? { id: 'pressure', label: 'Pressure wording', result: 'warning', detail: 'The notice uses pressure wording (very short deadlines or arrest threats) often seen in scams. Verify before reacting.', evidence: evidenceFor(text, threat[0]), heuristic: true }
      : { id: 'pressure', label: 'Pressure wording', result: 'not_found', detail: 'No scam-style pressure wording was found.', heuristic: true },
  );

  // 5. Look-alike sender names (edit-distance comparison with a small demo list).
  if (isGov) {
    const words = text.split(/\s+/).filter(Boolean);
    let best: { name: string; found: string; score: number } | null = null;
    for (const name of TRUSTED_SENDER_NAMES) {
      const k = name.split(' ').length;
      for (let i = 0; i + k <= words.length; i++) {
        const window = words.slice(i, i + k).join(' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
        const score = similarityRatio(window, name);
        if (score >= 0.82 && (!best || score > best.score)) best = { name, found: window, score };
      }
    }
    if (best && best.score < 1) {
      checks.push({
        id: 'sender-name',
        label: 'Sender name',
        result: 'warning',
        detail: `"${best.found}" is very close to, but not exactly, "${best.name}" (similarity ${Math.round(best.score * 100)}%). Look-alike names are a common trick.`,
        evidence: evidenceFor(text, best.found),
        heuristic: true,
      });
    } else if (best) {
      checks.push({
        id: 'sender-name',
        label: 'Sender name',
        result: 'found',
        detail: `The name "${best.name}" appears exactly. A correct name does not prove a notice is genuine.`,
        evidence: evidenceFor(text, best.found),
        heuristic: true,
      });
    } else {
      checks.push({ id: 'sender-name', label: 'Sender name', result: 'not_found', detail: 'No known department name was found in the text.', heuristic: true });
    }
  }

  // 6. Comparison with the SYNTHETIC demo registry (never official).
  if (comparison) {
    checks.push({
      id: 'registry-comparison',
      label: 'Demo registry comparison',
      result: comparison.status === 'differs' ? 'warning' : comparison.status === 'consistent' ? 'found' : 'not_checked',
      detail: `${comparison.summary} (Source: ${comparison.sourceLabel}.)`,
      heuristic: true,
    });
  }

  // 7. Things this tool cannot check.
  checks.push({
    id: 'digital-signature',
    label: 'Digital signature and official record',
    result: 'not_checked',
    detail: 'This tool does not check digital signatures or look the notice up in any official record. Use the official service below.',
    heuristic: false,
  });

  const warnings = checks.filter((c) => c.result === 'warning').length;
  return {
    status: warnings > 0 ? 'warning_signs' : 'unverified',
    summary:
      warnings > 0
        ? `${warnings} warning sign${warnings === 1 ? '' : 's'} found. This does not prove the notice is fake. Verify it on the official service before paying or replying.`
        : 'No warning signs were found, but that does not mean the notice is genuine. Only the official service can confirm it.',
    checks,
    officialVerification: officialVerificationFor(noticeType),
    disclaimer: 'These are signals, not verification. A genuine notice can trigger a warning and a fake one can trigger none.',
  };
}
