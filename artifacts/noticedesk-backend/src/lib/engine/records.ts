// REGISTRY COMPARISON. The analysis engine talks to a RegistryProvider interface, so a real source could replace
// the synthetic demo one later without rewriting the engine. Today the only provider is a SYNTHETIC demo registry.
// It is NOT a government database, and a match never proves a notice is genuine.

import type { NoticeType, RecordComparison, RecordFieldResult } from '../../types/analysis';
import { levenshtein, similarityRatio } from './similarity';

export type RegistryRecord = {
  id: string;
  noticeType: NoticeType;
  sender: string;
  amountInr: number | null;
  noticeDate: string | null; // YYYY-MM-DD
  sections: string[];
};

export type RegistryLookupResult =
  | { found: true; record: RegistryRecord }
  | { found: false; nearest?: { id: string; distance: number } };

export interface RegistryProvider {
  readonly source: 'synthetic_demo';
  readonly label: string;
  lookup(identifier: string): Promise<RegistryLookupResult>;
}

export const normalizeId = (id: string) => id.replace(/\s+/g, '').toUpperCase();

/** SYNTHETIC records that match the demo samples. Not real. */
const SYNTHETIC_RECORDS: RegistryRecord[] = [
  {
    id: 'DEMO/SCN/2026/0412',
    noticeType: 'gst_show_cause',
    sender: 'Office of the Assistant Commissioner of CGST, Range II, Division Demo, Bengaluru',
    amountInr: 345_000,
    noticeDate: '2026-10-12',
    sections: ['Section 73'],
  },
  {
    id: 'ITBA/AST/S/143(1)/2026-27/1000000001(1)',
    noticeType: 'it_intimation',
    sender: 'Income Tax Department - Centralized Processing Centre, Bengaluru',
    amountInr: 18_500,
    noticeDate: '2026-10-15',
    sections: ['143(1)(a)'],
  },
];

export function createSyntheticRegistry(records: RegistryRecord[] = SYNTHETIC_RECORDS): RegistryProvider {
  return {
    source: 'synthetic_demo',
    label: 'Synthetic demo registry (not an official record)',
    async lookup(identifier: string): Promise<RegistryLookupResult> {
      const key = normalizeId(identifier);
      const exact = records.find((r) => normalizeId(r.id) === key);
      if (exact) return { found: true, record: exact };
      let nearest: { id: string; distance: number } | undefined;
      for (const r of records) {
        const distance = levenshtein(key, normalizeId(r.id));
        if (distance <= 2 && (!nearest || distance < nearest.distance)) nearest = { id: r.id, distance };
      }
      return { found: false, nearest };
    },
  };
}

export const syntheticRegistry = createSyntheticRegistry();

export type NoticeFacts = {
  identifier: string | null;
  sender: string | null;
  amountInr: number | null;
  noticeDate: string | null;
  /** Section strings found in the notice text. */
  sections: string[];
};

const DISCLAIMER =
  'This compares the notice with a synthetic demo registry built for this prototype. It is not an official record. Only the issuing authority can confirm a notice is genuine.';

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9()]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function compareWithRegistry(provider: RegistryProvider, facts: NoticeFacts): Promise<RecordComparison> {
  const base = { source: provider.source, sourceLabel: provider.label, disclaimer: DISCLAIMER } as const;
  if (!facts.identifier) {
    return { ...base, status: 'no_record', fields: [], summary: 'No identifier was found in the notice, so there was nothing to look up in the demo registry.' };
  }
  const found = await provider.lookup(facts.identifier);
  if (!found.found) {
    if (found.nearest) {
      return {
        ...base,
        status: 'differs',
        nearestRecordId: found.nearest.id,
        fields: [{ field: 'identifier', label: 'Identifier', noticeValue: facts.identifier, recordValue: found.nearest.id, result: 'near_miss' }],
        summary: `The identifier is ${found.nearest.distance} character${found.nearest.distance === 1 ? '' : 's'} away from a record in the demo registry. That can be a scanning mistake or an alteration. Check the original.`,
      };
    }
    return { ...base, status: 'no_record', fields: [], summary: 'The identifier is not in the demo registry, so the notice could not be compared. That is not evidence either way.' };
  }

  const r = found.record;
  const fields: RecordComparison['fields'] = [
    { field: 'identifier', label: 'Identifier', noticeValue: facts.identifier, recordValue: r.id, result: 'match' },
  ];

  // A "match" must be exact after normalising case and punctuation. A single changed letter in a long name
  // scores very high on similarity, which is exactly what an altered notice looks like, so it is a near miss.
  const senderA = facts.sender ? clean(facts.sender) : null;
  const sim = senderA === null ? null : similarityRatio(senderA, clean(r.sender));
  fields.push({
    field: 'sender',
    label: 'Sender',
    noticeValue: facts.sender,
    recordValue: r.sender,
    result: senderA === null || sim === null ? 'not_in_notice' : senderA === clean(r.sender) ? 'match' : sim >= 0.8 ? 'near_miss' : 'mismatch',
  });

  const amountResult: RecordFieldResult = facts.amountInr === null ? 'not_in_notice' : facts.amountInr === r.amountInr ? 'match' : 'mismatch';
  fields.push({
    field: 'amount',
    label: 'Amount',
    noticeValue: facts.amountInr === null ? null : `₹${facts.amountInr.toLocaleString('en-IN')}`,
    recordValue: r.amountInr === null ? 'none' : `₹${r.amountInr.toLocaleString('en-IN')}`,
    result: amountResult,
  });

  const dateResult: RecordFieldResult = facts.noticeDate === null ? 'not_in_notice' : facts.noticeDate === r.noticeDate ? 'match' : 'mismatch';
  fields.push({ field: 'noticeDate', label: 'Notice date', noticeValue: facts.noticeDate, recordValue: r.noticeDate ?? 'none', result: dateResult });

  const noticeSections = facts.sections.map(clean);
  const sectionOk = r.sections.every((s) => noticeSections.some((n) => n.includes(clean(s))));
  fields.push({
    field: 'sections',
    label: 'Section cited',
    noticeValue: facts.sections.length ? facts.sections.join('; ') : null,
    recordValue: r.sections.join('; '),
    result: facts.sections.length === 0 ? 'not_in_notice' : sectionOk ? 'match' : 'mismatch',
  });

  const bad = fields.filter((f) => f.result === 'near_miss' || f.result === 'mismatch');
  const unchecked = fields.filter((f) => f.result === 'not_in_notice').length;
  if (bad.length > 0) {
    return {
      ...base,
      status: 'differs',
      recordId: r.id,
      fields,
      summary: `The identifier is in the demo registry but ${bad.map((b) => b.label.toLowerCase()).join(', ')} ${bad.length === 1 ? 'differs' : 'differ'} from the record. This does not prove the notice is fake, but verify it officially before paying or replying.`,
    };
  }
  return {
    ...base,
    status: 'consistent',
    recordId: r.id,
    fields,
    summary: `Every field found in the notice matches the demo registry record${unchecked ? ` (${unchecked} field${unchecked === 1 ? '' : 's'} could not be compared)` : ''}. This is a demo registry, so it is not verification.`,
  };
}
