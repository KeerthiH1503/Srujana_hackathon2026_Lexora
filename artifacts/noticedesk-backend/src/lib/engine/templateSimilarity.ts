// EXPERIMENTAL wording similarity to team-written templates (TF-IDF + cosine).
// The templates are our own short descriptions of typical wording, NOT official government templates.
// A similarity score says how alike two texts are. It says nothing about whether a notice is genuine.

import type { NoticeType, TemplateSimilarity } from '../../types/analysis';
import { NOTICE_TYPE_CONFIG } from '../rules';
import { cosine, inverseDocumentFrequency, tfidfVector, tokenize } from './tfidf';

export const TEMPLATES: Record<Exclude<NoticeType, 'unknown'>, string> = {
  gst_show_cause:
    'Show cause notice under section of the CGST Act. GSTIN registered person. It appears that input tax credit availed in excess, tax short paid, interest and penalty. You are required to show cause why the tax along with interest and penalty should not be demanded. Submit your reply on or before the date stated. Personal hearing is fixed. In default the matter will be decided on the basis of available records.',
  cheque_bounce_138:
    'Demand notice under section 138 of the Negotiable Instruments Act. Under instructions from my client. Cheque number drawn on bank was returned unpaid dishonoured insufficient funds. You are called upon to pay the cheque amount within fifteen days of receipt of this notice, failing which criminal proceedings will be initiated.',
  it_intimation:
    'Income Tax Department intimation under section 143 of the Income-tax Act. Assessment year PAN return of income processed. Proposed adjustment mismatch with Form 26AS. Submit your response on the e-filing portal within thirty days. If no response is received the adjustment will be made.',
  legal_notice:
    'Legal notice. Under instructions from my client advocate. You are hereby called upon to pay the outstanding amount or comply within the period stated from the date of this notice, failing which my client will be constrained to take appropriate legal action at your risk as to costs and consequences.',
};

const TYPES = Object.keys(TEMPLATES) as Exclude<NoticeType, 'unknown'>[];
const templateTokens = TYPES.map((t) => tokenize(TEMPLATES[t]));
const idf = inverseDocumentFrequency(templateTokens);
const templateVectors = templateTokens.map((tokens) => tfidfVector(tokens, idf));

export function computeTemplateSimilarity(text: string): TemplateSimilarity {
  const v = tfidfVector(tokenize(text), idf);
  const scores = TYPES.map((type, i) => ({
    type: type as NoticeType,
    label: NOTICE_TYPE_CONFIG[type].label,
    score: Math.round(cosine(v, templateVectors[i]) * 1000) / 10,
  })).sort((a, b) => b.score - a.score);
  return {
    experimental: true,
    method: 'tf-idf cosine similarity',
    scores,
    bestMatch: scores[0].score >= 10 ? scores[0].type : null,
    note: 'Experimental. This only compares wording with short team-written templates. It is not an authenticity check: a high score does not make a notice genuine and a low score does not make it fake.',
  };
}
