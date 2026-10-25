# Notice on the Desk: backend (no AI)

A rule-based notice triage engine. **There is no AI, no language model and no API key anywhere in it.** It uses regular expressions, deterministic date arithmetic, exact and fuzzy (edit-distance) matching, TF-IDF cosine similarity, rule-based scoring, and classic OCR (Tesseract) for photos.

Say "classical algorithms and classic OCR", not "no machine learning at all": Tesseract's recogniser is a trained model internally. It is an OCR engine, not a generative model.

## 1. Install (5 minutes)

Unzip into the **root of your Next.js project** (the folder with `package.json`) and let it merge. If your frontend already has `src/types/analysis.ts`, **replace it with this one** (it is a superset: only optional fields were added).

```bash
node scripts/setup-backend.mjs      # adds npm scripts AND patches next.config.ts (required for photo uploads)
npm install zod unpdf tesseract.js @tesseract.js-data/eng
npm install -D vitest tsx @types/node@^22    # the @types/node bump avoids a peer-dependency error
cat .env.backend.example >> .env.local       # optional
npm test            # expect: 13 files, 163 tests passed
npm run bench       # expect: 13 of 15 cases passed (2 are known-hard on purpose)
npm run dev
```

Photo uploads **only work if `next.config.ts` contains `serverExternalPackages: ['tesseract.js']`**. The setup script adds it. Without it the OCR worker cannot find its script and the upload hangs. Replit: nothing else to configure; there are no secrets.

## 2. What is in the zip

| Path | Role |
|---|---|
| `src/types/analysis.ts` | Shared contract with the frontend |
| `src/lib/rules.ts` | **All legal knowledge**: rules, sources, verified flags, checklists, reply outlines |
| `src/lib/engine/dates.ts`, `period.ts` | Date parsing and arithmetic (UTC, leap years, invalid dates); reads "within fifteen (15) days of receipt..." |
| `src/lib/engine/deadline.ts` | **Deadline engine**: stated / computed / unclear / conflict. Never guesses |
| `src/lib/engine/text.ts` | Quote verification with exact offsets; text-quality check |
| `src/lib/engine/extractors/heuristic.ts` | The reader (regular expressions and sentence rules) |
| `src/lib/engine/severity.ts` | Explainable severity score and "do I need a professional?" |
| `src/lib/engine/authenticity.ts`, `similarity.ts` | Warning signs: identifier, domains, payment route, pressure wording, look-alike names (Levenshtein) |
| `src/lib/engine/records.ts` | Registry comparison behind a replaceable `RegistryProvider` interface (synthetic demo registry today) |
| `src/lib/engine/tfidf.ts`, `templateSimilarity.ts` | Experimental wording similarity (TF-IDF + cosine) |
| `src/lib/engine/ocr.ts` | Classic OCR with confidence and uncertain words |
| `src/lib/engine/analyse.ts` | The pipeline that ties it together |
| `src/lib/server/*` | CORS, rate limit, file-type and image-size checks |
| `src/app/api/{analyse,extract,bench,health}/route.ts` | The four endpoints |
| `bench/` | 15 synthetic cases, runner, `results.json` |
| `tests/` | 163 tests (+ OCR image fixtures) |
| `samples/` | 8 synthetic notices: GST, cheque-bounce, income tax, unclear start, conflict, suspicious, **altered**, **unverified** |

## 3. How a notice is analysed

1. Text arrives: pasted, from a text PDF, or from a photo (OCR).
2. The reader reports **facts as written**, each with an exact quote.
3. Code checks **every quote really appears in the notice** and records exact offsets. Anything not found is flagged and ignored.
4. Code parses dates and periods **from the quoted text itself**.
5. The deadline engine applies verified rules with fixed counting rules (first day excluded, last included).
6. Each key field gets a status. **A result is never more certain than its inputs**: dates read by OCR are marked `needs_review`, and so is any deadline that depends on them.
7. Severity (visible score), recommendation (with reasons), authenticity signals, registry comparison and experimental similarity are added.

If a fact is missing or ambiguous the answer is **unclear** (with candidate dates) or **conflict**. It is never a guessed date. A person can then **enter the missing fact** (for example the date they received the notice) and the whole result is recomputed.

## 4. API

Errors are always `{ "error": "...", "code": "..." }`. Responses are `Cache-Control: no-store`. Notice text is never logged or stored.

```bash
# 1) Photos, PDFs or text files -> text. Up to 5 files (pages of one notice), 8 MB each, 20 MB total.
curl -s -F "file=@page1.png" -F "file=@page2.png" localhost:3000/api/extract
#   -> { text, quality, warnings, method: "ocr"|"pdf_text"|"text", ocrConfidence?, lowConfidenceWords? }

# 2) Text -> analysis. Pass `source` straight back from step 1. `overrides` are facts the user entered.
curl -s -X POST localhost:3000/api/analyse -H 'content-type: application/json' -d '{
  "text": "...20 to 30000 characters...",
  "source": { "method": "ocr", "ocrConfidence": 93 },
  "overrides": { "receiptDate": "2026-10-05", "noticeType": "legal_notice",
                 "period": { "n": 15, "unit": "days", "anchor": "receipt" } }
}'

curl -s localhost:3000/api/bench     # benchmark results (404 until `npm run bench` has run once; the zip ships a results file)
curl -s localhost:3000/api/health    # { ai: false, engine, imageReading }
```

Limits are **per endpoint**: `/api/analyse` takes text only (160 KB body, 30,000 characters). Files go to `/api/extract`. Image dimensions are capped (10,000 px a side, 40 megapixels) and PDFs at 20 pages. File type is detected from the bytes, not the file name.

Codes: `invalid_request` 400, `bad_request` 400, `bad_override` 400, `no_file` 400, `too_many_files` 400, `too_large` 413, `image_too_large` 413, `unsupported_type` 415, `ocr_unavailable` 422, `unreadable_file` 422, `rate_limited` 429 (with `Retry-After`).

## 5. Changes to the contract (tell the frontend developer)

- `Evidence.start/end` are **-1** when `foundInText` is false. Do not highlight those. User-entered facts have `evidence: []`.
- `BenchResults.metrics` are **percentages (0 to 100)**.
- New optional fields (all safe to ignore, all worth showing):
  - `extraction.method` is always `"rules"`: show a **"No AI used"** badge.
  - `fields[]`: status of each key field (`checked`, `needs_review`, `not_found`) with its source (`text`, `pdf_text`, `ocr`, `user`) and a reason.
  - `deadline.needsReview` and `deadline.dependsOn`: show the deadline as **provisional** with the reason.
  - `authenticity`: signals (never "verified") and official verification links.
  - `recordComparison`: `consistent` / `differs` / `no_record` against the **synthetic demo registry**, field by field. Always show its `sourceLabel`.
  - `templateSimilarity`: **experimental**. Show it in a separate, muted card labelled "Experimental text similarity, not an authenticity check". Do not give it a warning colour.
  - `BenchResults.extractor` and `notes`.
- `/api/extract` now returns `method`, `ocrConfidence` and `lowConfidenceWords`. **Pass `method` and `ocrConfidence` back to `/api/analyse` as `source`.** Show `lowConfidenceWords` so the user can check them.
- Frontend features this enables: an editable "Review what we read" panel (dates, period, notice type) that re-calls `/api/analyse` with `overrides`; a "Date you received it" field when the deadline is unclear.

## 6. Rules: what is verified and what you must still check

Checked on 2026-10-24 against the sources in `rules.ts` (primary = judgment, Act or official portal; secondary = reputable commentary quoting the Act):

- Primary: `R-138-PAY-15`, `R-138-COMPLAINT`, `R-138-DEMAND-30` (Supreme Court and Delhi High Court); `R-COUNT-DAYS` (General Clauses Act s.9); `R-IT-DIN` (Income Tax e-Filing portal FAQ); `R-GST-RFN` (GSTN advisory, CBIC Circular 249/2025).
- **Secondary only**: `R-GST-73-8`, `R-GST-REPLY-STATED`, `R-GST-IGNORE`, `R-IT-143-1-A`.

**Before the demo the legal lead must** run `grep -rn TODO_VERIFY src`, confirm each against the bare Act or official portal, then update `verifiedOn`. Unverified rules (`R-LEGAL-NOTICE-GENERAL`, `R-IT-143-1-INFO`, `R-SEVERITY-HEURISTIC`, `R-AUTH-HEURISTIC`) are shown to users as "not verified". Never flip `verified` to true without checking.

**Verification status in the API (changed in v4).** A rule is reported as verified (`consequences[].verified`, `deadline.source.ruleVerified`) only if its flag is true, it was checked against a **primary** source, and no `TODO_VERIFY` note is left in it. So `R-GST-73-8`, `R-GST-REPLY-STATED`, `R-GST-IGNORE`, `R-IT-143-1-A` (secondary sources) and `R-GST-RFN` (open menu-path note) now show as **not verified**, even though their flags are true. The five primary-source rules (`R-138-*`, `R-COUNT-DAYS`, `R-IT-DIN`) still show as verified.

## 7. Benchmark (`npm run bench`)

15 synthetic cases; expected results were written **before** the first run. The same `analyse()` the app uses runs every case.

Last run: **13 of 15 passed**. Evidence support 100%, deadline correctness 77.8% (7 of 9 cases with a readable date), safe abstention 100% (6 of 6). The two failures are **known-hard cases kept on purpose** (`14_date_in_words_HARD`: "the fifteenth of November"; `15_two_digit_year_HARD`: "15 Oct '26"). The reader abstains instead of guessing, and a user can enter the date themselves.

Honest limits: cases are synthetic and team-written; evidence support is 100% by construction (the reader copies text); passing says nothing about real notices. One input edit after the first run: case 06 gained a DIN line because rule `R-IT-DIN`, added later, says real income tax communications carry one. Its expected results were not changed.

## 8. OCR: what we measured

Synthetic test photos (in `tests/fixtures/`), real OCR output:

| Photo | Mean confidence | What happened |
|---|---|---|
| Clean | 95.6% | Every date, amount and sentence read correctly |
| Degraded (blur, noise, low resolution) | 49% | "15 days" was read as "18", "85,000" as "85.0007". The engine **abstained** (deadline unclear) and warned |

So OCR text is always treated as needing review, and below 80% mean confidence an extra warning is shown. **That 80% line is a team heuristic from a handful of synthetic images, not a calibrated threshold.** Test it on real photos of your own before relying on it.

## 9. Authenticity signals, registry comparison, similarity

- **Authenticity signals**: identifier present (DIN / RFN / reference), government-style domains, personal payment routes (UPI, QR, gift card), pressure wording, look-alike department names (Levenshtein distance against a small demo list). Status is `unverified` or `warning_signs`, **never "verified"**. Official services are linked: Income Tax "Authenticate Notice/Order" (works without login), GST "Verify RFN", CBIC DIN.
- **Registry comparison**: compares identifier (exact, with a 1-2 character near-miss check), sender (exact vs near miss), amount, date and section against a **synthetic** registry behind a `RegistryProvider` interface. It reports `consistent`, `differs` or `no_record`. `no_record` is **not** evidence either way. A real source could replace the provider without touching the engine, but none exists today and none is implied.
- **Template similarity**: TF-IDF cosine against four short team-written templates. Experimental. It says how alike two wordings are, nothing about authenticity.

## 10. CORS (frontend on a different origin)

If the frontend is a static site on another origin, the browser blocks calls to this backend unless it sends CORS headers. Set the frontend's exact origin(s):

```
ALLOWED_ORIGINS=https://your-frontend.example.app,http://localhost:5173
```

- Exact origins only (scheme + host + port, no path). Look-alikes and `http` vs `https` do not match.
- Every response carries the headers, errors and `429` included, and `Retry-After` is exposed so the frontend can read it. Browser preflight (`OPTIONS`) is answered with 204.
- No value means no CORS headers (same-origin use only). `*` allows any website to call your API from a visitor's browser: fine for a public, cookie-free demo, but say so.
- CORS is enforced by browsers only. It does not protect the server from `curl`, scripts or other servers, and it is not authentication.
- Test it (replace the URLs):
  `curl -i -X OPTIONS https://YOUR-BACKEND/api/analyse -H "Origin: https://your-frontend.example.app" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"`
  You should see `204` and `access-control-allow-origin: https://your-frontend.example.app`. With a different `Origin` the header must be absent.
- Setting `ALLOWED_ORIGINS` requires a restart of the backend.

## 11. Before you deploy: the rate limiter

`X-Forwarded-For` can be forged by a client, so it is **ignored by default** and all callers share one bucket (60 requests per minute, `RATE_LIMIT_PER_MIN`). To get per-client limits, set `TRUST_PROXY_HEADERS=true` **only if your host's proxy overwrites that header**, then test it: send `curl -H "X-Forwarded-For: 1.2.3.4" ...` and confirm that changing the value does not give you a fresh limit. When trusted, the **last** entry is used. The limiter is in memory (resets on restart, not shared across instances). I could not test your host's proxy behaviour.

## 11b. Fixes from the external review (v4)

- `/api/extract` reads only the first 20 PDF pages, page by page (tested with a 25-page PDF). Before, it warned but read everything.
- `/api/analyse` counts the bytes it actually receives and stops at 160 KB, even when `Content-Length` is missing or false (tested).
- Rule verification status is stricter, as described in section 6.
- Still open: confirm the rules in `rules.ts` against the bare Acts, and test with notices written by someone who did not write the rules.

## 12. Known limits

- Four notice types plus `unknown`. For `unknown`, only dates the notice itself states are used, and the result says the analysis is limited.
- Public holidays and extensions are not considered. Dates need a four-digit year. Word dates ("the fifteenth of November") are not read.
- OCR is English only and has no deskewing or denoising. A scanned (image-only) PDF is not read: upload photos of the pages instead. A rotated or skewed photo will read poorly.
- `bench/results.json` is read from disk; on serverless hosts that do not ship it, run locally or on Replit.
- Not legal advice.

## 13. Short answers for the jury

- **Where is the AI?** There is none. Regular expressions, deterministic date maths, edit distance, TF-IDF cosine, rule-based scoring and classic OCR.
- **How do you know a notice is fake?** We don't claim to. We show warning signs and a comparison with a demo registry, and send the user to the official service.
- **How do you stop wrong answers?** Every claim needs a quote found in the notice; deadlines come from tested code and a rules table with sources; OCR text and unclear dates are marked for review; and the user can enter the date themselves.
- **Why not just use the government portal?** Portals verify some notices. They do not tell you what the notice means, how urgent it is, when it is due, or whether you need a professional. We do that and say plainly where we cannot.
