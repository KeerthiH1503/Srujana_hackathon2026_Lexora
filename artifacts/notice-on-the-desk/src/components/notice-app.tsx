"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, Download, FileText, FolderOpen, Info, Landmark, LoaderCircle, Menu, Printer, Scale, ShieldAlert, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { analyse, ApiError, extractFiles, getBench, getHealth } from "@/lib/api";
import { trackerStorage } from "@/lib/storage";
import type { AnalysisResult, BenchResults, FactOverrides, NoticeType, Severity, Stage, TextSource, TrackedNotice } from "@/types/analysis";
import { useNoticeFlow } from "@/components/notice-flow-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";

type Page = "home" | "review" | "result" | "tracker" | "handoff" | "reliability";
const NOTICE_SAMPLES = [
  { file: "gst_show_cause.txt", label: "GST notice that matches the demo record" },
  { file: "gst_show_cause_ALTERED.txt", label: "Altered GST notice" },
  { file: "gst_show_cause_UNVERIFIED.txt", label: "GST notice without a demo record" },
  { file: "legal_notice_unclear_start.txt", label: "Legal notice with an unclear start date" },
  { file: "legal_notice_conflict.txt", label: "Legal notice with conflicting dates" },
  { file: "income_tax_suspicious.txt", label: "Income tax notice with warning signs" },
  { file: "income_tax_intimation.txt", label: "Income tax intimation" },
  { file: "cheque_bounce_138.txt", label: "Cheque return notice" },
];
const SAMPLE_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const NOTICE_TYPE_LABEL: Record<NoticeType, string> = {
  gst_show_cause: "GST show-cause notice",
  cheque_bounce_138: "Cheque return notice",
  it_intimation: "Income tax intimation",
  legal_notice: "Legal notice",
  unknown: "Notice type unclear",
};
const getNoticeTypeLabel = (type: NoticeType) => NOTICE_TYPE_LABEL[type];
const STEPS: Stage[] = ["received", "understood", "info_gathered", "professional_review", "response_prepared", "closed"];
const STEP_NAMES: Record<Stage, string> = { received: "Received", understood: "Understood", info_gathered: "Gathering information", professional_review: "Professional review", response_prepared: "Response prepared", closed: "Closed" };
const LEVEL: Record<Severity, string> = { routine: "Routine", action_needed: "Action needed", urgent: "Time-sensitive", see_professional_now: "Seek professional help now" };
const dateLabel = (s?: string) => s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not clear from the text";
function apiErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === "unreachable") return "Lexora's analysis service could not be reached. Nothing was analysed.";
    if (cause.status === 429) {
      const seconds = cause.retryAfterSeconds ?? 60;
      return `${cause.message} Try again in about ${seconds} seconds.`;
    }
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "The request could not be completed. Please try again.";
}
function isSupportedNoticeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ["application/pdf", "text/plain", "image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    /\.(pdf|txt|png|jpe?g|webp)$/i.test(name);
}

function toCalendarText(entry: TrackedNotice): string {
  const result = entry.result;
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const uid = `${result.id}@notice-on-the-desk`;
  if (result.deadline.date) {
    const date = result.deadline.date.replaceAll("-", "");
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lexora//Action Ledger//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date}`,
      `DTEND;VALUE=DATE:${date}`,
      `SUMMARY:${escape(`Check notice deadline · ${getNoticeTypeLabel(result.noticeType)}`)}`,
      `DESCRIPTION:${escape(`${result.summaryPlain}\\nSource: ${result.deadline.source.quote || result.deadline.source.ruleId || "No date source recorded"}. Confirm against the original notice. Information only, not legal advice.`)}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lexora//Action Ledger//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escape(`Confirm notice deadline · ${getNoticeTypeLabel(result.noticeType)}`)}`,
    `DESCRIPTION:${escape("No date has been selected because the notice is unclear or conflicting. Confirm the date from the complete original notice. This is a reminder task, not a legal deadline.")}`,
    "END:VTODO",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

type TextSegment = { text: string; claimIndexes: number[] };
function evidenceSegments(result: AnalysisResult): TextSegment[] {
  const boundaries = new Set<number>([0, result.extractedText.length]);
  const ranges: { start: number; end: number; claimIndex: number }[] = [];
  result.claims.forEach((item, claimIndex) => {
    item.evidence.forEach((evidence) => {
      if (!evidence.foundInText || evidence.start < 0 || evidence.end <= evidence.start) return;
      const start = Math.min(evidence.start, result.extractedText.length);
      const end = Math.min(evidence.end, result.extractedText.length);
      if (end <= start) return;
      ranges.push({ start, end, claimIndex });
      boundaries.add(start);
      boundaries.add(end);
    });
  });
  const sorted = [...boundaries].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (end <= start) continue;
    const claimIndexes = ranges
      .filter((range) => range.start < end && range.end > start)
      .map((range) => range.claimIndex);
    segments.push({ text: result.extractedText.slice(start, end), claimIndexes });
  }
  return segments;
}
function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow"><span className="eyebrow-rule" />{children}</div>; }
function Heading({ label, title, intro }: { label: string; title: string; intro?: string }) { return <div className="page-heading"><div><Eyebrow>{label}</Eyebrow><h1>{title}</h1>{intro && <p>{intro}</p>}</div></div>; }
function Button({ children, onClick, outline = false, disabled = false, className = "" }: { children: ReactNode; onClick: () => void; outline?: boolean; disabled?: boolean; className?: string }) { return <button className={`button ${outline ? "button-outline" : "button-primary"} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>; }

export function NoticeApp({ page }: { page: Page }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = [{ name: "Analyse", href: "/" }, { name: "Action Ledger", href: "/tracker" }, { name: "Reliability", href: "/reliability" }];
  return <div className="min-h-[100dvh]">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand" href="/"><span className="brand-mark"><Landmark size={18} /></span><span>Lexora</span></Link>
      <span className="header-note">A clearer first read of official notices</span>
      <button className="mobile-menu" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
      <nav className={`main-nav ${menuOpen ? "is-open" : ""}`} aria-label="Main navigation">{nav.map((item) => <Link key={item.href} className={`nav-link ${pathname === item.href || (item.href === "/" && ["/review", "/result"].includes(pathname)) ? "active" : ""}`} onClick={() => setMenuOpen(false)} href={item.href}>{item.name}</Link>)}</nav>
    </div></header>
    <main id="main" className="site-main">
      {page === "home" && <HomePage />}
      {page === "review" && <ReviewPage />}
      {page === "result" && <ResultPage />}
      {page === "tracker" && <TrackerPage />}
      {page === "handoff" && <HandoffPage />}
      {page === "reliability" && <ReliabilityPage />}
    </main>
    <footer className="site-footer"><div className="footer-inner"><span className="footer-brand">Lexora</span><span>Information only, not legal advice.</span><Link href="/reliability#how-it-works-limits">How it works and limits <ArrowUpRight size={13} /></Link></div></footer>
  </div>;
}

function HomePage() {
  const router = useRouter();
  const { flow, updateFlow } = useNoticeFlow();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [slowReading, setSlowReading] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [failedSample, setFailedSample] = useState<string | null>(null);
  const [service, setService] = useState<"checking" | "reachable" | "unreachable">("checking");
  const [health, setHealth] = useState<{ ok: boolean; ai: false } | null>(null);
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [tab, setTab] = useState<"upload" | "paste" | "sample">("upload");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    getHealth().then((value) => {
      if (!current) return;
      setHealth(value);
      setService(value.ok ? "reachable" : "unreachable");
    }).catch(() => {
      if (current) {
        setHealth(null);
        setService("unreachable");
      }
    });
    return () => { current = false; };
  }, [healthAttempt]);

  const chooseSample = async (id: string) => {
    setBusy(true);
    setError("");
    setFailedSample(null);
    try {
      const sample = NOTICE_SAMPLES.find(({ file }) => file === id);
      if (!sample) throw new Error("That sample could not be found.");
      const response = await fetch(`${SAMPLE_BASE_PATH}/samples/${sample.file}`);
      if (!response.ok) throw new Error("The sample file could not be loaded.");
      const sampleText = await response.text();
      const result = await analyse({ text: sampleText, source: { method: "text" } });
      updateFlow({
        text: sampleText,
        result,
        isSample: result.isPrecomputedSample,
        quality: result.extraction.quality,
        warnings: result.extraction.warnings,
        source: { method: "text" },
        overrides: {},
        lowConfidenceWords: [],
        previewUrl: "",
        fileName: "",
        fileType: "",
      });
      router.push("/result");
      setFailedSample(null);
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setFailedSample(id);
    } finally {
      setBusy(false);
    }
  };

  const submitText = async () => {
    setError("");
    if (text.length < 20 || text.length > 30_000) {
      setError("Enter between 20 and 30,000 characters of notice text.");
      return;
    }
    if (flow.previewUrl.startsWith("blob:")) URL.revokeObjectURL(flow.previewUrl);
    updateFlow({ text, result: null, isSample: false, quality: "good", warnings: [], source: { method: "text" }, overrides: {}, lowConfidenceWords: [], previewUrl: "", fileName: "", fileType: "" });
    router.push("/review");
  };

  const addFiles = (incoming: File[]) => {
    const files = [...selectedFiles, ...incoming];
    if (files.length > 5) { setError("Upload at most 5 files (for example the pages of one notice)."); return; }
    if (files.some((file) => file.size === 0)) { setError("The file is empty."); return; }
    if (files.some((file) => file.size > 8 * 1024 * 1024)) { setError("The file is larger than 8 MB."); return; }
    if (files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) { setError("The files are larger than 20 MB in total."); return; }
    if (files.some((file) => !isSupportedNoticeFile(file))) { setError("Unsupported file. Upload a PDF, PNG, JPG, WEBP or a text file."); return; }
    setError("");
    setSelectedFiles(files);
  };

  const upload = async (files: File[] = selectedFiles) => {
    if (!files.length) return;
    setError("");
    if (files.length > 5) {
      setError("Upload at most 5 files (for example the pages of one notice).");
      return;
    }
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (files.some((file) => file.size === 0)) {
      setError("The file is empty.");
      return;
    }
    if (files.some((file) => file.size > 8 * 1024 * 1024)) {
      setError("The file is larger than 8 MB.");
      return;
    }
    if (totalBytes > 20 * 1024 * 1024) {
      setError("The files are larger than 20 MB in total.");
      return;
    }
    if (files.some((file) => !isSupportedNoticeFile(file))) {
      setError("Unsupported file. Upload a PDF, PNG, JPG, WEBP or a text file.");
      return;
    }
    setBusy(true);
    setSlowReading(false);
    const slowReadTimer = window.setTimeout(() => setSlowReading(true), 3_000);
    if (flow.previewUrl.startsWith("blob:")) URL.revokeObjectURL(flow.previewUrl);
    const firstFile = files[0];
    const firstName = firstFile.name.toLowerCase();
    const previewUrl = firstFile.type.startsWith("image/") || firstFile.type === "application/pdf" || firstName.endsWith(".pdf")
      ? URL.createObjectURL(firstFile)
      : "";
    try {
      const extracted = await extractFiles(files);
      updateFlow({
        text: extracted.text,
        warnings: extracted.warnings,
        quality: extracted.quality,
        isSample: false,
        result: null,
        previewUrl,
        fileName: files.map((file) => file.name).join(", "),
        fileType: firstFile.type,
        source: { method: extracted.method, ...(typeof extracted.ocrConfidence === "number" ? { ocrConfidence: extracted.ocrConfidence } : {}) },
        lowConfidenceWords: extracted.lowConfidenceWords ?? [],
      });
      setSelectedFiles([]);
      router.push("/review");
    } catch (cause) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError(apiErrorMessage(cause));
    }
    finally { window.clearTimeout(slowReadTimer); setSlowReading(false); setBusy(false); }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; };
  return <div className="home-page">
    <div className="home-topline"><span>PRIVATE BY DESIGN</span><span className="service-status"><i className={`service-dot ${service}`} aria-hidden="true" />{service === "checking" ? "Checking analysis service" : service === "reachable" ? "Analysis service reachable" : "Analysis service unreachable"}{health?.ai === false && <strong className="no-ai-badge">No AI used</strong>}{service === "unreachable" && <button className="service-retry" type="button" onClick={() => { setService("checking"); setHealthAttempt((attempt) => attempt + 1); }}>Check again</button>}</span></div>
    <section className="hero-grid"><div className="hero-copy"><Eyebrow>Understand the paper in front of you</Eyebrow><h1>Before you respond,<br /><em>understand</em> the notice.</h1><p className="hero-intro">A careful first read of official letters. Find the dates, stated claims, and questions worth asking next.</p><div className="hero-trust"><span><ShieldCheck size={16} /> Evidence-linked</span><span><Scale size={16} /> Cautious by design</span></div></div>
      <div className="desk-mark" aria-hidden="true"><div className="paper-sheet"><div className="paper-seal"><Landmark size={28} /></div><span className="paper-line pl-long" /><span className="paper-line pl-mid" /><span className="paper-line pl-short" /><span className="paper-divider" /><span className="paper-line pl-long" /><span className="paper-line pl-mid" /><div className="paper-stamp">NOTICE<br />RECEIVED</div></div><span className="desk-caption">A little more legible.<br />A little less overwhelming.</span></div>
    </section>
    <section className="intake-layout">
      <div className="intake-main">
        <div className="section-title"><span className="section-number">01</span><div><h2>Bring the notice into view</h2><p>Choose how you want to start.</p></div></div>
        <Tabs value={tab} onValueChange={(value) => { if (value === "upload" || value === "paste" || value === "sample") { setTab(value); setError(""); } }}>
        <TabsList className="intake-tabs" aria-label="Notice input method">
          {(["upload", "paste", "sample"] as const).map((value) => <TabsTrigger key={value} value={value} className="intake-tab">{value === "upload" ? "Upload" : value === "paste" ? "Paste text" : "Try a sample"}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={tab} className="intake-tab-panel">
        {tab === "upload" && <div>
          <button className={`upload-zone ${drag ? "dragging" : ""}`} disabled={busy} aria-busy={busy} onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)); }}>
            {busy ? <><LoaderCircle className="spin" size={24} /><span className="upload-title">{slowReading ? "Reading the photo. This can take up to a minute." : "Reading the selected files…"}</span><span className="upload-caption">The extracted text will be ready for your review.</span></> : <><span className="upload-icon"><UploadCloud size={22} /></span><span className="upload-title">Drop notice pages here, or <u>browse files</u></span><span className="upload-caption">Up to 5 PDF, image, or TXT pages · 8 MB each, 20 MB total</span></>}
          </button>
          <input ref={fileRef} type="file" multiple accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp,text/plain" onChange={onFile} className="visually-hidden" aria-label="Choose up to five notice pages" />
          <p className="privacy-note"><ShieldCheck size={14} /> Several photos? Add each page of the same notice, in order. Photo reading uses English OCR on the backend. Scanned PDFs are not read; upload photos of those pages.</p>
          {selectedFiles.length > 0 && <div className="selected-files"><p>Pages in upload order</p><ol>{selectedFiles.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><span>{index + 1}. {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB</span><button type="button" className="text-link" disabled={busy} aria-label={`Remove ${file.name}`} onClick={() => setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>Remove</button></li>)}</ol><Button disabled={busy} onClick={() => void upload()}>{busy ? "Reading pages…" : "Read these pages"}</Button></div>}
        </div>}
        {tab === "paste" && <div>
          <label className="field-label" htmlFor="notice-paste">Notice text <span>Remove personal details if you prefer</span></label>
          <textarea id="notice-paste" className="paste-area" rows={8} value={text} onChange={(e) => { setText(e.target.value); setError(""); }} placeholder="Paste the letter or notice text here…" />
          <div className="paste-counter" aria-live="polite">{text.length.toLocaleString()} / 30,000 characters · minimum 20</div>
          <Button className="analyze-start" disabled={busy || text.length < 20 || text.length > 30_000} onClick={() => void submitText()}>Review this text <ArrowRight size={16} /></Button>
          <p className="privacy-note"><ShieldCheck size={14} /> Nothing is added to the Action Ledger unless you choose to add it.</p>
        </div>}
        {tab === "sample" && <div className="sample-list sample-grid">
          {NOTICE_SAMPLES.map((sample, i) => <button key={sample.file} className="sample-card" disabled={busy} onClick={() => void chooseSample(sample.file)}><span className="sample-card-head"><span className="sample-index">0{i + 1}</span><span className="sample-badge"><span />Synthetic sample, not a real notice</span></span><strong>{sample.label}</strong><span>Analyse the provided sample through the connected backend.</span><span className="sample-card-foot">Open sample <ArrowUpRight size={14} /></span></button>)}
        </div>}
        </TabsContent>
        </Tabs>
        {error && <div className="form-error error-panel" role="alert" aria-live="polite"><AlertCircle size={16} /><span>{error}</span>{tab === "upload" && selectedFiles.length > 0 && <button onClick={() => void upload()}>Retry upload</button>}{tab === "sample" && failedSample && <button onClick={() => void chooseSample(failedSample)}>Retry sample</button>}</div>}
      </div>
      <aside className="sample-aside"><Eyebrow>CALM, OWNER-FIRST TRIAGE</Eyebrow><h2>Four questions, one clear first read.</h2><ul className="question-list"><li>What has arrived?</li><li>What must I do, and by when?</li><li>How urgent is it, and why?</li><li>Can I handle this, or should I get help?</li></ul><div className="sample-foot"><span className="sample-dot" />Demo content is synthetic. This tool provides information only, not legal advice.</div></aside>
    </section>
    <section className="privacy-strip"><ShieldCheck size={17} /><p><strong>Privacy first.</strong> Use synthetic or non-sensitive notices in this demo. Nothing is added to your Action Ledger unless you choose to save it; you can remove saved items anytime.</p></section>
    <section className="home-bottom"><span className="bottom-icon"><FileText size={19} /></span><p><strong>Start with what is written.</strong> Observations link back to source text, and uncertainty is labelled.</p><Link className="text-link" href="/reliability#how-it-works-limits">How it works and limits <ArrowRight size={14} /></Link></section>
  </div>;
}

function ReviewPage() {
  const router = useRouter();
  const { flow, updateFlow } = useNoticeFlow();
  const [text, setText] = useState(flow.text);
  const [warnings, setWarnings] = useState<string[]>(flow.warnings);
  const quality = flow.quality;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [periodValue, setPeriodValue] = useState(flow.overrides.period?.n?.toString() ?? "");
  const [periodUnit, setPeriodUnit] = useState<"days" | "months">(flow.overrides.period?.unit ?? "days");
  const [periodAnchor, setPeriodAnchor] = useState<"receipt" | "notice_date">(flow.overrides.period?.anchor ?? "receipt");
  const reviewTextRef = useRef<HTMLTextAreaElement>(null);
  const updateOverrides = (updates: Partial<FactOverrides>) => updateFlow({ overrides: { ...flow.overrides, ...updates } });
  const updatePeriod = (value: string, unit = periodUnit, anchor = periodAnchor) => {
    setPeriodValue(value);
    const n = Number(value);
    updateOverrides({ period: value && Number.isInteger(n) && n >= 1 && n <= 366 ? { n, unit, anchor } : undefined });
  };
  const highlightWord = (word: string) => {
    const start = text.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());
    if (start < 0 || !reviewTextRef.current) {
      setError(`“${word}” is not in the edited text. Check it in the original photo.`);
      return;
    }
    reviewTextRef.current.focus();
    reviewTextRef.current.setSelectionRange(start, start + word.length);
  };
  const run = async () => {
    if (!text.trim()) { setError("There is no extracted text to analyse. Return and add text or choose a sample."); return; }
    setBusy(true); setError("");
    try {
      const source: TextSource = flow.source;
      const result = await analyse({ text, source, overrides: flow.overrides });
      const resolved: AnalysisResult = {
        ...result,
        extractedText: text,
        isPrecomputedSample: flow.isSample || result.isPrecomputedSample,
        extraction: {
          ...result.extraction,
          quality: quality === "poor" ? "poor" : result.extraction.quality,
          warnings: [...new Set([...result.extraction.warnings, ...warnings])],
        },
      };
      updateFlow({ text, result: resolved, warnings: resolved.extraction.warnings });
      router.push("/result");
    } catch (cause) {
      const message = apiErrorMessage(cause);
      setError(message);
      toast({ title: "Analysis could not be completed", description: message, variant: "destructive" });
    }
    finally { setBusy(false); }
  };
  return <div className="content-page"><button className="back-link" onClick={() => router.push("/")}><ArrowLeft size={15} /> Back to start</button>
    <Heading label="STEP 02 / REVIEW" title="Check the text first." intro="Compare this extraction with your original document. Correct anything that is wrong before analysis." />
    {(warnings.length > 0 || quality === "poor") && <div className="notice-line warn"><AlertCircle size={16} /><span>{warnings.length ? warnings.join(" ") : "Text quality is marked poor. Check every date and amount against the original."} Compare important details with the original document.</span></div>}
    {flow.source.method === "ocr" && <section className="ocr-review" aria-label="Photo reading quality"><div className="ocr-review-heading"><strong>Photo text reading</strong><span>{typeof flow.source.ocrConfidence === "number" ? `${flow.source.ocrConfidence.toFixed(1)}% average confidence` : "Confidence unavailable"}</span></div><p>OCR can misread digits and dates. Check important details against your original.</p>{typeof flow.source.ocrConfidence === "number" && flow.source.ocrConfidence < 80 && <div className="ocr-hard-to-read" role="note">This photo was hard to read. Please check dates, amounts and numbers against your original.</div>}{flow.lowConfidenceWords.length > 0 && <div><p>Words to check in the photo:</p><ul>{flow.lowConfidenceWords.map((word, index) => <li key={`${word}-${index}`}><button type="button" onClick={() => highlightWord(word)}>{word}</button></li>)}</ul></div>}</section>}
    <div className="review-layout">
      <section className="file-preview" aria-label="Original file preview"><div className="preview-heading"><FileText size={16} /><strong>Original document</strong></div>
        {flow.previewUrl && flow.fileType.startsWith("image/") ? <img src={flow.previewUrl} alt={`Preview of ${flow.fileName || "uploaded notice"}`} /> : flow.previewUrl && (flow.fileType === "application/pdf" || flow.fileName.toLowerCase().endsWith(".pdf")) ? <iframe title={`PDF preview: ${flow.fileName || "notice"}`} src={flow.previewUrl} /> : <div className="preview-empty"><FileText size={24} /><span>{flow.fileName || "No file uploaded"}</span><small>{flow.fileName ? "Compare the text on the right with this source." : "Text was pasted or opened from a sample."}</small>{flow.fileName.includes(", ") && <small>The text combines the selected pages in order.</small>}</div>}
        {flow.fileName.includes(", ") && <ul className="preview-files">{flow.fileName.split(", ").map((name, index) => <li key={`${name}-${index}`}>Page {index + 1}: {name}</li>)}</ul>}
      </section>
      <div className="review-card"><div className="review-toolbar"><div className="review-doc"><span className="doc-icon"><FileText size={17} /></span><div><strong>Extracted notice text</strong><span>{text.length.toLocaleString()} characters · editable</span></div></div><span className={`quality-chip ${quality === "poor" ? "low" : ""}`}><span />{quality === "poor" ? "Review carefully" : "Text available"}</span></div>
        <label className="visually-hidden" htmlFor="review-text">Review and edit extracted notice text</label><textarea ref={reviewTextRef} id="review-text" value={text} onChange={(e) => { setText(e.target.value); updateFlow({ text: e.target.value }); }} className="review-text" rows={18} placeholder="No readable text found. Paste the words from the original document here." />
      </div>
    </div>
    {error && <div className="form-error error-panel" role="alert"><AlertCircle size={16} /><span>{error}</span><button onClick={() => void run()}>Retry analysis</button></div>}
    <details className="override-panel"><summary>Correct or add facts</summary><div><p>Enter only facts you know. The backend uses them with the text; Lexora does not calculate deadlines in the browser.</p><div className="override-fields">
      <label>Notice type<small>Choose a type only if you know it.</small><select value={flow.overrides.noticeType ?? ""} onChange={(event) => updateOverrides({ noticeType: event.target.value ? event.target.value as NoticeType : undefined })}><option value="">Let Lexora decide</option><option value="gst_show_cause">GST show-cause notice</option><option value="cheque_bounce_138">Cheque return notice</option><option value="it_intimation">Income tax intimation</option><option value="legal_notice">Legal notice</option><option value="unknown">Unknown</option></select></label>
      <label>Notice date<small>Use the date printed on the notice.</small><input type="date" value={flow.overrides.noticeDate ?? ""} onChange={(event) => updateOverrides({ noticeDate: event.target.value || undefined })} /></label>
      <label>Date you received it<small>Use the date it reached you.</small><input type="date" value={flow.overrides.receiptDate ?? ""} onChange={(event) => updateOverrides({ receiptDate: event.target.value || undefined })} /></label>
      <label>Due date stated<small>Enter a date only if the notice states one.</small><input type="date" value={flow.overrides.dueDate ?? ""} onChange={(event) => updateOverrides({ dueDate: event.target.value || undefined })} /></label>
      <label>Reply period in text<small>Enter the period exactly as stated.</small><input type="number" min="1" max="366" inputMode="numeric" value={periodValue} onChange={(event) => updatePeriod(event.target.value)} placeholder="For example, 30" /></label>
      <label>Period unit<small>Choose the unit written in the notice.</small><select value={periodUnit} onChange={(event) => { const unit = event.target.value as "days" | "months"; setPeriodUnit(unit); if (periodValue) updatePeriod(periodValue, unit, periodAnchor); }}><option value="days">Days</option><option value="months">Months</option></select></label>
      <label>Counted from<small>Choose the date the notice says to use.</small><select value={periodAnchor} onChange={(event) => { const anchor = event.target.value as "receipt" | "notice_date"; setPeriodAnchor(anchor); if (periodValue) updatePeriod(periodValue, periodUnit, anchor); }}><option value="receipt">Receipt date</option><option value="notice_date">Notice date</option></select></label>
    </div></div></details>
    <div className="review-actions"><div className="review-privacy"><ShieldCheck size={15} /> Your edits are used for this analysis.</div><Button disabled={busy || !text.trim()} onClick={() => void run()}>{busy ? <><LoaderCircle className="spin" size={16} /> Analysing…</> : <>Analyse this text <ArrowRight size={16} /></>}</Button></div>
  </div>;
}

function ResultPage() {
  const router = useRouter();
  const { flow, updateFlow } = useNoticeFlow();
  const result = flow.result;
  const [activeClaim, setActiveClaim] = useState<number | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [outline, setOutline] = useState<string[]>([]);
  const [added, setAdded] = useState(false);
  const [deadlineBusy, setDeadlineBusy] = useState(false);
  const [deadlineError, setDeadlineError] = useState("");
  useEffect(() => {
    setAdded(false);
    setChecked({});
    setActiveClaim(null);
    setOutline(result?.replyOutline.map((item) => item.body) ?? []);
  }, [result?.id]);
  const segments = useMemo(
    () => (result ? evidenceSegments(result) : []),
    [result],
  );
  if (!result) return <EmptyPage title="No analysis to show yet" body="Start by adding a notice, then review its text before analysis." action="Go to Analyse" onClick={() => router.push("/")} />;
  const saveTracker = () => {
    try {
      trackerStorage.add(result);
      setAdded(true);
    } catch {
      setAdded(false);
    }
  };
  const scrollToClaim = (index: number) => {
    setActiveClaim(index);
    window.setTimeout(() => {
      document.querySelector(`[data-highlight-for="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 40);
  };
  const scrollToHighlight = (index: number) => {
    setActiveClaim(index);
    document.querySelector(`[data-claim-card="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const openHandoff = () => {
    updateFlow({ result });
    router.push(`/handoff?id=${encodeURIComponent(result.id)}`);
  };
  const recommendation = {
    yes: "Yes — professional review is recommended",
    probably: "Probably — professional input may help",
    no: "No immediate professional review is flagged",
  }[result.professional.recommendation];
  const deadlineNeedsVerification =
    result.deadline.status === "unclear" || result.deadline.status === "conflict";
  const deadlineDependencies = new Set(result.deadline.dependsOn ?? []);
  const deadlineReviewReasons = (result.fields ?? [])
    .filter((field) => deadlineDependencies.has(field.field))
    .map((field) => field.reason)
    .filter((reason): reason is string => Boolean(reason));
  const provisionalReason = deadlineReviewReasons.join(" ") || result.deadline.note || "Confirm the source dates against the original notice.";
  const receiptDateField = result.fields?.find((field) => field.field === "receipt_date");
  const receiptDate = flow.overrides.receiptDate ?? (receiptDateField?.source === "user" ? receiptDateField.value ?? "" : "");
  const receiptDateWasEntered = receiptDateField?.source === "user";
  const rerunWithReceiptDate = async () => {
    if (!receiptDate) {
      setDeadlineError("Enter the date you received the notice before recalculating.");
      return;
    }
    setDeadlineBusy(true);
    setDeadlineError("");
    const overrides = { ...flow.overrides, receiptDate };
    try {
      const revised = await analyse({ text: result.extractedText, source: flow.source, overrides });
      updateFlow({ result: revised, overrides });
    } catch (cause) {
      setDeadlineError(apiErrorMessage(cause));
    } finally {
      setDeadlineBusy(false);
    }
  };
  const chainSteps = [
    ["Evidence", result.chain.evidence],
    ["Interpretation", result.chain.interpretation],
    ["Rule", result.chain.rule],
    ["Decision", deadlineNeedsVerification ? "Cannot establish — verify the original notice. No single date is selected." : result.chain.decision],
    ["Action", result.chain.action],
  ];
  return <div className="result-page">
    <div className="result-top"><button className="back-link" onClick={() => router.push("/review")}><ArrowLeft size={15} /> Edit what we read</button><span className="result-label"><span className="live-dot" /> FIRST READ · {result.isPrecomputedSample ? "SYNTHETIC SAMPLE" : "INTERPRETATION"}{result.extraction.method === "rules" && <span className="sample-badge">No AI used</span>}</span></div>
    <p className="visually-hidden" role="status" aria-live="polite">Analysis view ready.</p>
    {result.isPrecomputedSample && <div className="notice-line sample-callout"><Info size={16} /><span><strong>Pre-computed sample.</strong> This is an illustration using synthetic text, not an assessment of a real notice.</span></div>}
    <section className="verdict-card">
      <div><Eyebrow>DO I NEED A PROFESSIONAL?</Eyebrow><h2>{recommendation}</h2><p>{result.professional.reasons[0] || "The text alone does not settle this question."}</p><p className="verdict-summary"><strong>What arrived:</strong> {result.summaryPlain}</p></div>
      <details><summary>Why this suggestion?</summary><ul>{result.professional.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><p>This is a cautious prompt, not a legal conclusion.</p></details>
    </section>
    <p className="result-disclaimer">A structured reading of the supplied text, not a legal conclusion. Check dates and consequences against the original and applicable rules.</p>
    <div className="result-columns"><div className="result-main-col">
      <section className="result-section chain-section"><div className="result-section-head"><div><Eyebrow>01 / EVIDENCE CHAIN</Eyebrow><h2>From evidence to next step</h2></div></div><div className="reasoning-chain">{chainSteps.map(([label, value], index) => <div className={`chain-step ${label === "Decision" && deadlineNeedsVerification ? "decision-unclear" : ""}`} key={label}><span className="chain-num">0{index + 1}</span><div><span className="chain-label">{label}</span><p>{value || "No confident interpretation available."}</p>{label === "Rule" && <span className={`rule-status ${result.deadline.source.ruleVerified ? "rule-verified" : "rule-unverified"}`}>{result.deadline.source.ruleId ? `${result.deadline.source.ruleId} · ` : ""}{result.deadline.source.ruleVerified ? "Rule marked verified" : "Not independently verified"}</span>}</div></div>)}</div></section>
      <section className="deadline-severity-grid">
        <article className="result-section deadline-panel"><div className="result-section-head"><div><Eyebrow>02 / TIMING</Eyebrow><h2>Deadline</h2></div><span className={`deadline-state state-${result.deadline.status}`}>{result.deadline.status}</span></div>
          {deadlineNeedsVerification ? <div className="verify-callout"><ShieldAlert size={18} /><strong>Cannot establish — verify</strong><span>No single date is selected.</span></div> : <div className="deadline-date">{dateLabel(result.deadline.date)}{typeof result.deadline.daysLeft === "number" && <small>{result.deadline.daysLeft > 0 ? `${result.deadline.daysLeft} days left` : result.deadline.daysLeft === 0 ? "Due today" : `Passed ${Math.abs(result.deadline.daysLeft)} days ago`}</small>}</div>}
          {result.deadline.needsReview && <div className="provisional-callout" role="note"><ShieldAlert size={17} /><span><strong>Provisional — confirm the dates first.</strong><br />{provisionalReason}</span></div>}
          {result.deadline.status === "computed" && receiptDateWasEntered && <p className="user-date-note">Based on the date you entered.</p>}
          <p className="deadline-note">{result.deadline.note || "Timing may be unclear or calculated; check the original and any relevant rules."}</p>{result.deadline.source.quote && <blockquote className="deadline-quote">“{result.deadline.source.quote}”</blockquote>}{result.deadline.candidates?.map((candidate) => <p key={candidate.label} className="candidate-dates"><strong>{candidate.label}:</strong> {dateLabel(candidate.date)}</p>)}<p className={`rule-status ${result.deadline.source.ruleVerified ? "rule-verified" : "rule-unverified"}`}>{result.deadline.source.ruleId ? `${result.deadline.source.ruleId} · ` : ""}{result.deadline.source.ruleVerified ? "Source marked verified" : "Source not independently verified"}</p>
          {result.deadline.status === "unclear" && <div className="receipt-date-override"><label htmlFor="result-receipt-date">Date you received this<small>Use the date it reached you. Lexora will ask the backend to reassess the deadline.</small></label><input id="result-receipt-date" type="date" value={receiptDate} onChange={(event) => updateFlow({ overrides: { ...flow.overrides, receiptDate: event.target.value || undefined } })} /><button type="button" onClick={() => void rerunWithReceiptDate()} disabled={deadlineBusy}>{deadlineBusy ? "Rechecking…" : "Recheck with this date"}</button>{deadlineError && <p className="form-error" role="alert">{deadlineError}</p>}</div>}
        </article>
        <article className="result-section severity-factors-panel"><div className="result-section-head"><div><Eyebrow>03 / URGENCY</Eyebrow><h2>Severity</h2></div></div><div className={`severity-level severity-${result.severity.level}`}><span className="severity-icon"><AlertCircle size={16} /></span><strong>{LEVEL[result.severity.level]}</strong><TooltipProvider delayDuration={250}><Tooltip><TooltipTrigger asChild><button className="severity-score" aria-label="About the triage score">{result.severity.score}/100 <Info size={14} /></button></TooltipTrigger><TooltipContent className="severity-tooltip" side="top">A triage signal based on the supplied text, not a prediction of an outcome.</TooltipContent></Tooltip></TooltipProvider></div><ul className="factor-list">{result.severity.factors.map((factor, index) => <li key={`${factor.label}-${index}`}><span className={factor.fired ? "factor-fired" : "factor-not-fired"}>{factor.fired ? <CheckCircle2 size={15} /> : <span className="factor-empty" />}</span><span>{factor.label}</span><strong>{factor.fired ? "+" : ""}{factor.weight}</strong></li>)}</ul><p className="deadline-note">A triage signal only. It is not a prediction of an outcome.</p></article>
      </section>
       <section className="result-section key-fields-section"><div className="result-section-head"><div><Eyebrow>KEY FIELDS</Eyebrow><h2>Details read from the notice</h2></div></div>{result.fields?.length ? <ul className="key-fields-list">{result.fields.map((field) => <li key={field.field}><div><strong>{field.label}</strong><span>{field.value || "Not found"}</span></div><div className="key-field-meta"><span className={`field-state field-state-${field.status}`}>{field.status.replaceAll("_", " ")}</span><span>{field.source === "user" ? "Entered by you" : field.source === "ocr" ? "Read from photo (OCR)" : field.source === "pdf_text" ? "Read from PDF text" : "Read from text"}</span>{field.reason && <small>{field.reason}</small>}</div></li>)}</ul> : <p className="partial-fields-note">Field status was not returned for this result.</p>}</section>
       <section className="result-section claims-section"><div className="result-section-head"><div><Eyebrow>04 / WHAT THIS NOTICE SAYS</Eyebrow><h2>Evidence beside interpretation</h2></div><span className="interpretation-label">RULES BASED READING</span></div>
        {result.claims.length ? <div className="result-evidence-grid"><div className="source-text-panel"><div className="source-heading"><FileText size={15} /><strong>Notice text</strong></div><div className="source-text-content" aria-label="Notice text with evidence highlights">{segments.map((segment, index) => segment.claimIndexes.length ? <mark key={index} tabIndex={0} role="button" data-highlight-for={segment.claimIndexes[0]} className={`source-highlight ${segment.claimIndexes.some((claimIndex) => claimIndex === activeClaim) ? "is-active" : ""}`} aria-label={`Evidence linked to ${result.claims[segment.claimIndexes[0]].label}`} onMouseEnter={() => setActiveClaim(segment.claimIndexes[0])} onFocus={() => setActiveClaim(segment.claimIndexes[0])} onClick={() => scrollToHighlight(segment.claimIndexes[0])}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</div><p className="source-legend">Underlined text links to a claim. Patterns also work without colour.</p></div>
          <div className="claims-panel"><div className="claims-list">{result.claims.map((claim, index) => <article className={`claim-row ${activeClaim === index ? "is-active" : ""}`} data-claim-card={index} tabIndex={0} key={`${claim.label}-${index}`} onMouseEnter={() => scrollToClaim(index)} onFocus={() => scrollToClaim(index)}><div className="claim-detail"><span className="claim-label">{claim.label}</span><p>{claim.value}</p><span className={`confidence confidence-${claim.confidence}`}>{claim.confidence} confidence</span></div><div className="evidence-stack">{claim.evidence.length ? claim.evidence.map((evidence, quoteIndex) => <button key={quoteIndex} className="evidence-quote" disabled={!evidence.foundInText} onClick={() => evidence.foundInText && scrollToClaim(index)}><span className="quote-mark">“</span><span>{evidence.quote}</span><span className={`evidence-status ${evidence.foundInText ? "found" : "not-found"}`}>{evidence.foundInText ? "Found in notice text" : "Not found — unverified"}</span></button>) : <p className="no-evidence">No supporting quote was returned.</p>}</div></article>)}</div></div>
        </div> : <div className="empty-inline"><Info size={16} />No claims could be confidently identified. Check the original and seek help if needed.</div>}
      </section>
      {result.consequences.length > 0 && <section className="result-section consequence-section"><div className="result-section-head"><div><Eyebrow>05 / POSSIBLE CONSEQUENCES</Eyebrow><h2>If this is ignored, it can lead to…</h2></div></div><div className="consequence-steps">{result.consequences.map((consequence, index) => <article className="consequence-item" key={`${consequence.ruleId}-${index}`}><span className="consequence-number">0{index + 1}</span><div><p>{consequence.text}</p><span className={consequence.verified ? "rule-verified" : "rule-unverified"}>{consequence.verified ? "Rule reference marked verified" : `Not independently verified · ${consequence.ruleId}`}</span></div></article>)}</div></section>}
      {result.checklist.length > 0 && <section className="result-section checklist-section"><div className="result-section-head"><div><Eyebrow>06 / DOCUMENTS CHECKLIST</Eyebrow><h2>Things to gather or confirm</h2></div></div><ul className="checklist">{result.checklist.map((item) => <li key={item.id}><label className={checked[item.id] ? "checklist-item checked" : "checklist-item"}><input type="checkbox" checked={Boolean(checked[item.id])} onChange={(event) => setChecked((current) => ({ ...current, [item.id]: event.target.checked }))} /><span><strong>{item.label}</strong>{item.why && <small>{item.why}</small>}</span></label></li>)}</ul></section>}
      {result.replyOutline.length > 0 && <section className="result-section outline-section"><div className="result-section-head"><div><Eyebrow>07 / DRAFT REPLY OUTLINE</Eyebrow><h2>A template to discuss</h2></div></div><div className="notice-line warn"><Info size={16} /><span>Template only. A professional should review before sending.</span></div><div className="outline-list">{result.replyOutline.map((item, index) => <div key={`${item.heading}-${index}`}><span>0{index + 1}</span><section><strong>{item.heading}</strong><div className="editable-outline" contentEditable suppressContentEditableWarning aria-label={`Editable outline section: ${item.heading}`} onBlur={(event) => setOutline((current) => current.map((value, currentIndex) => currentIndex === index ? event.currentTarget.innerText : value))}>{(outline[index] ?? item.body).split(/(\[\[FILL:[^\]]+\]\])/g).map((part, partIndex) => part.startsWith("[[FILL:") ? <mark className="fill-chip" key={partIndex}>{part}</mark> : <span key={partIndex}>{part}</span>)}</div></section></div>)}</div></section>}
    </div>
    <aside className="result-side"><div className="side-card professional-card"><Eyebrow>WHEN TO GET HELP</Eyebrow><h3>{recommendation}</h3><ul>{result.professional.reasons.map((reason, index) => <li key={index}><span className="tiny-dash" />{reason}</li>)}</ul><p>Especially if a date is close, facts are disputed, or consequences may be significant.</p></div>
      <div className="side-card uncertainty-card"><div className="uncertainty-heading"><AlertCircle size={16} /><strong>What remains uncertain</strong></div><p>Text extraction can miss details. This tool does not verify the issuer, underlying facts, or current legal rules.</p>{result.extraction.warnings.map((warning, index) => <span key={index} className="uncertainty-item">{warning}</span>)}</div>
    </aside></div>
    <div className="result-sticky-actions"><div className="sticky-inner"><Button disabled={added} onClick={saveTracker}><Check size={15} />{added ? "Added to tracker" : "Add to tracker"}</Button><Button outline onClick={openHandoff}><Printer size={15} />Print handoff sheet</Button><button className="text-link" onClick={() => router.push("/")}><ArrowLeft size={14} />Analyse another</button></div></div>
    <div className="result-bottom"><Link className="text-link" href="/reliability#how-it-works-limits">How it works and limits <ArrowRight size={14} /></Link></div>
  </div>;
}

function EmptyPage({ title, body, action, onClick }: { title: string; body: string; action: string; onClick: () => void }) { return <div className="content-page"><div className="empty-state"><span className="empty-icon"><FolderOpen size={24} /></span><h2>{title}</h2><p>{body}</p><Button onClick={onClick}>{action} <ArrowRight size={15} /></Button></div></div>; }

function TrackerPage() {
  const router = useRouter();
  const { updateFlow } = useNoticeFlow();
  const [items, setItems] = useState<TrackedNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("soonest");
  const [expanded, setExpanded] = useState("");
  const refresh = () => { setLoading(true); setError(""); try { setItems(trackerStorage.list()); } catch (cause) { setError(cause instanceof Error ? cause.message : "We could not read the ledger."); } finally { setLoading(false); } };
  useEffect(() => { refresh(); }, []);
  const stage = (id: string, value: Stage) => { try { trackerStorage.updateStage(id, value); refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the stage."); } };
  const drop = (id: string) => { try { trackerStorage.delete(id); setRemove(""); refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove that notice."); } };
  const filteredItems = useMemo(() => {
    const filtered = items.filter((entry) =>
      (stageFilter === "all" || entry.stage === stageFilter) &&
      (severityFilter === "all" || entry.result.severity.level === severityFilter),
    );
    return filtered.sort((a, b) => {
      if (sortBy === "newest") return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      const aDate = a.result.deadline.date ? Date.parse(a.result.deadline.date) : Number.POSITIVE_INFINITY;
      const bDate = b.result.deadline.date ? Date.parse(b.result.deadline.date) : Number.POSITIVE_INFINITY;
      return sortBy === "latest" ? bDate - aDate : aDate - bDate;
    });
  }, [items, stageFilter, severityFilter, sortBy]);
  const downloadCalendar = (entry: TrackedNotice) => {
    const blob = new Blob([toCalendarText(entry)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${entry.result.id}-action-reminder.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const updateDetails = (entry: TrackedNotice, key: "unresolved" | "docsGathered", value: string) => {
    try {
      trackerStorage.updateDetails(entry.result.id, {
        [key]: value.split(/\n/).map((line) => line.trim()).filter(Boolean),
      });
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save those tracker details.");
    }
  };
  const openResult = (entry: TrackedNotice) => {
    updateFlow({ result: entry.result, text: entry.result.extractedText, isSample: entry.result.isPrecomputedSample });
    router.push("/result");
  };
  const openHandoff = (entry: TrackedNotice) => {
    updateFlow({ result: entry.result, text: entry.result.extractedText, isSample: entry.result.isPrecomputedSample });
    router.push(`/handoff?id=${encodeURIComponent(entry.result.id)}`);
  };
  const sender = (entry: TrackedNotice) =>
    entry.result.claims.find((claim) => claim.label.toLowerCase() === "sender")?.value || "Not identified";
  const dueLabel = (entry: TrackedNotice) => {
    const { daysLeft, status } = entry.result.deadline;
    if (status === "unclear" || status === "conflict" || typeof daysLeft !== "number") return "Verify date";
    if (daysLeft < 0) return `${Math.abs(daysLeft)} days overdue`;
    if (daysLeft === 0) return "Due today";
    return `${daysLeft} days left`;
  };
  const setDocumentGathered = (entry: TrackedNotice, documentId: string, gathered: boolean) => {
    try {
      const current = entry.docsGathered;
      trackerStorage.updateDetails(entry.result.id, {
        docsGathered: gathered
          ? [...new Set([...current, documentId])]
          : current.filter((value) => value !== documentId),
      });
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update gathered documents.");
    }
  };
  return <div className="content-page tracker-page"><Heading label="YOUR WORKING LIST" title="Action Ledger" intro="A private place to track what you have read, gathered, and still need to check." />
    <div className="tracker-toolbar"><div><strong>{loading ? "Loading your ledger…" : `${filteredItems.length} ${filteredItems.length === 1 ? "notice" : "notices"}`}</strong><span>Moving a draft or outline never changes a notice stage.</span></div><Button outline onClick={() => router.push("/")}>Add notice <ArrowRight size={15} /></Button></div>
    <div className="tracker-filters"><label>Stage <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">All stages</option>{STEPS.map((step) => <option key={step} value={step}>{STEP_NAMES[step]}</option>)}</select></label><label>Severity <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">All levels</option>{Object.entries(LEVEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Sort <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="soonest">Soonest date</option><option value="latest">Latest date</option><option value="newest">Recently added</option></select></label></div>
    {error && <div className="error-panel" role="alert"><AlertCircle size={16} /><span>{error}</span><button onClick={refresh}>Retry</button></div>}
    {loading ? <div className="tracker-skeleton" aria-label="Loading tracker"><div className="loading-panel"><span className="skeleton-line wide" /><span className="skeleton-line" /></div></div> : items.length === 0 ? <div className="empty-state"><span className="empty-icon"><FolderOpen size={24} /></span><h2>A clear desk, for now.</h2><p>Add an analysis to keep an eye on its next steps.</p><Button onClick={() => router.push("/")}>Analyse a notice <ArrowRight size={15} /></Button></div> : filteredItems.length === 0 ? <div className="empty-state compact-empty"><span className="empty-icon"><FolderOpen size={24} /></span><h2>No notices match these filters.</h2><p>Change a filter to see more items.</p><Button outline onClick={() => { setStageFilter("all"); setSeverityFilter("all"); }}>Clear filters</Button></div> : <div className="ledger-table-wrap"><table className="ledger-table"><thead><tr><th>Notice</th><th>Type</th><th>Sender</th><th>Deadline</th><th>Severity</th><th>Stage</th><th>Actions</th></tr></thead><tbody>{filteredItems.map((entry) => <Fragment key={entry.result.id}><tr>
      <td data-label="Notice"><button className="ledger-title" onClick={() => openResult(entry)}>{entry.result.summaryPlain}</button><span className="ledger-meta">Added {dateLabel(entry.addedAt)}</span></td>
      <td data-label="Type">{getNoticeTypeLabel(entry.result.noticeType)}</td>
      <td data-label="Sender">{sender(entry)}</td>
      <td data-label="Deadline"><strong className={`countdown-chip ${entry.result.deadline.daysLeft !== undefined && entry.result.deadline.daysLeft < 0 ? "overdue" : ""}`}>{entry.result.deadline.daysLeft !== undefined && entry.result.deadline.daysLeft < 0 && <AlertCircle size={14} />}{dueLabel(entry)}</strong><span className="ledger-meta">{dateLabel(entry.result.deadline.date)}</span></td>
      <td data-label="Severity"><span className={`severity-text severity-${entry.result.severity.level}`}><AlertCircle size={14} aria-hidden="true" />{LEVEL[entry.result.severity.level]}</span></td>
      <td data-label="Stage"><label className="visually-hidden" htmlFor={`stage-${entry.result.id}`}>Stage for {entry.result.summaryPlain}</label><select id={`stage-${entry.result.id}`} className="stage-select" value={entry.stage} onChange={(event) => stage(entry.result.id, event.target.value as Stage)}>{STEPS.map((step) => <option key={step} value={step}>{STEP_NAMES[step]}</option>)}</select></td>
      <td data-label="Actions"><div className="ledger-actions"><button className="icon-button" aria-label={`Download calendar reminder for ${entry.result.summaryPlain}`} onClick={() => downloadCalendar(entry)}><Download size={16} /></button><button className="icon-button" aria-label={`Open handoff sheet for ${entry.result.summaryPlain}`} onClick={() => openHandoff(entry)}><ArrowUpRight size={16} /></button><button className="icon-button danger-icon" aria-label={`Remove ${entry.result.summaryPlain} from Action Ledger`} onClick={() => setRemove(entry.result.id)}><Trash2 size={16} /></button><button className="icon-button" aria-label={`${expanded === entry.result.id ? "Collapse" : "Expand"} details for ${entry.result.summaryPlain}`} aria-expanded={expanded === entry.result.id} onClick={() => setExpanded(expanded === entry.result.id ? "" : entry.result.id)}><ChevronDown className={expanded === entry.result.id ? "rotate" : ""} size={16} /></button></div></td>
      </tr>{expanded === entry.result.id && <tr className="ledger-detail-row"><td colSpan={7}><div className="ledger-detail-grid"><section><h3>Evidence summary</h3><p>{entry.result.summaryPlain}</p><h3>Deadline basis</h3><p>{entry.result.deadline.source.quote || entry.result.deadline.source.ruleId || "No basis recorded."} <span className="rule-unverified">{entry.result.deadline.source.ruleVerified ? "Source marked verified" : "Not independently verified"}</span></p><h3>Next action</h3><p>{entry.result.chain.action}</p></section><section><h3>Unresolved questions</h3><label className="visually-hidden" htmlFor={`unresolved-${entry.result.id}`}>Unresolved questions, one per line</label><textarea id={`unresolved-${entry.result.id}`} defaultValue={entry.unresolved.join("\n")} onBlur={(event) => updateDetails(entry, "unresolved", event.target.value)} placeholder="Add a question to check…" rows={4} /><h3>Documents gathered</h3><div className="gathered-list">{entry.result.checklist.map((document) => <label key={document.id}><input type="checkbox" checked={entry.docsGathered.includes(document.id)} onChange={(event) => setDocumentGathered(entry, document.id, event.target.checked)} />{document.label}</label>)}</div></section></div></td></tr>}
    </Fragment>)}</tbody></table></div>}
    {remove && <AlertDialog open onOpenChange={(open) => { if (!open) setRemove(""); }}><AlertDialogContent className="delete-dialog"><AlertDialogHeader><AlertDialogTitle>Remove this notice from your ledger?</AlertDialogTitle><AlertDialogDescription>This removes the saved entry from this browser. It does not change the original notice.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel asChild><button type="button" className="button button-outline" onClick={() => setRemove("")}>Keep it</button></AlertDialogCancel><AlertDialogAction asChild><button type="button" className="button button-danger" onClick={() => drop(remove)}>Remove notice</button></AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
    <div className="notice-line"><Info size={16} /><span>Ledger entries are stored locally in this browser. Remove an item here or clear browser data anytime.</span></div>
  </div>;
}

function HandoffPage() {
  const router = useRouter();
  const [id, setId] = useState("");
  const { flow } = useNoticeFlow();
  const [entry, setEntry] = useState<TrackedNotice | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id") || "");
  }, []);
  useEffect(() => {
    try {
      setEntry(trackerStorage.get(id));
    } catch {
      setEntry(null);
    }
  }, [id]);
  const result = flow.result?.id === id ? flow.result : entry?.result ?? null;
  if (!result) return <EmptyPage title="Handoff sheet unavailable" body="Open a notice from the Action Ledger to prepare its handoff sheet." action="Open Action Ledger" onClick={() => router.push("/tracker")} />;
  return <div className="handoff-wrap"><div className="handoff-controls"><button className="back-link" onClick={() => router.push("/tracker")}><ArrowLeft size={15} /> Action Ledger</button><Button className="no-print" onClick={() => window.print()}><Printer size={16} /> Print this sheet</Button></div>
    <article className="handoff-sheet"><div className="handoff-top"><div className="brand-small"><span className="brand-mark"><Landmark size={16} /></span>Lexora</div><span>PREPARED FOR A CONVERSATION</span></div><Eyebrow>NOTICE HANDOFF · PERSONAL NOTES</Eyebrow><h1>What I understand<br />so far.</h1><p className="handoff-lead">A factual starting point to discuss with a qualified professional. This is an interpretation of supplied text, not legal advice.</p>
      <div className="handoff-meta"><div><span>NOTICE TYPE</span><strong>{getNoticeTypeLabel(result.noticeType)}</strong></div><div><span>SENDER</span><strong>{result.claims.find((claim) => claim.label.toLowerCase() === "sender")?.value || "Not identified"}</strong></div><div><span>DEADLINE AS READ</span><strong>{result.deadline.status === "unclear" || result.deadline.status === "conflict" ? "Cannot establish — verify" : dateLabel(result.deadline.date)}</strong><small>{result.deadline.status}</small></div><div><span>ATTENTION INDICATOR</span><strong className={`severity-text severity-${result.severity.level}`}><AlertCircle size={14} aria-hidden="true" />{LEVEL[result.severity.level]}</strong></div></div>
      <HandoffSection number="01" title="Short summary"><p>{result.summaryPlain}</p></HandoffSection>
      <HandoffSection number="02" title="Deadline basis"><p>{result.deadline.source.quote || result.deadline.source.ruleId || "No date source was identified."}</p><p>{result.deadline.note || "Confirm the date against the original notice."}</p>{result.deadline.candidates?.map((candidate) => <p key={candidate.label}><strong>{candidate.label}:</strong> {dateLabel(candidate.date)}</p>)}</HandoffSection>
      <HandoffSection number="03" title="Severity factors"><ul>{result.severity.factors.map((factor, index) => <li key={`${factor.label}-${index}`}>{factor.fired ? "Factor present" : "Factor not present"}: {factor.label} <small>Weight: {factor.weight}</small></li>)}</ul><p>{LEVEL[result.severity.level]} · {result.severity.score}/100 · Triage signal only.</p></HandoffSection>
      <HandoffSection number="04" title="Key quotes to check"><ul>{result.claims.flatMap((claim) => claim.evidence.filter((evidence) => evidence.foundInText).map((evidence, index) => <li key={`${claim.label}-${index}`}><strong>{claim.label}:</strong> “{evidence.quote}”</li>))}</ul></HandoffSection>
      <HandoffSection number="05" title="Documents gathered and still missing"><ul>{result.checklist.map((item) => <li key={item.id}><strong>{entry?.docsGathered.includes(item.id) ? "Gathered" : "Still needed"}:</strong> {item.label}<small>{item.why || "Confirm against the original notice."}</small></li>)}</ul></HandoffSection>
      <HandoffSection number="06" title="Unresolved questions"><ul>{entry?.unresolved.length ? entry.unresolved.map((question, index) => <li key={index}>{question}</li>) : <li>No unresolved questions have been added yet.</li>}</ul></HandoffSection>
      <HandoffSection number="07" title="Questions I would like to ask"><ul>{result.professional.reasons.slice(0, 3).map((reason, index) => <li key={index}>{reason}</li>)}</ul></HandoffSection>
      <div className="handoff-note"><Info size={16} /><p>Dates and rule references should be checked against the original notice and current law. This tool does not verify facts or legal applicability.</p></div><div className="notes-area"><span>MY NOTES</span><div /></div><footer className="handoff-footer">Lexora · Created {new Date().toLocaleDateString("en-IN")} · For discussion only</footer>
    </article></div>;
}
function HandoffSection({ number, title, children }: { number: string; title: string; children: ReactNode }) { return <section className="handoff-section"><span className="handoff-num">{number}</span><div><h2>{title}</h2>{children}</div></section>; }

function ReliabilityPage() {
  const [bench, setBench] = useState<BenchResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("all");
  const load = async () => { setLoading(true); setError(false); try { setBench(await getBench()); } catch { setError(true); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const cases = useMemo(() => (bench?.cases || []).filter((c) => filter === "all" || filter === "abstained" ? filter === "all" || c.abstained : c.pass === (filter === "pass")), [bench, filter]);
  const metrics = bench ? [{ label: "Evidence support", value: bench.metrics.evidenceSupportRate, note: "Claims supported by a source quote" }, { label: "Deadline handling", value: bench.metrics.deadlineCorrectness, note: "Deadline cases handled as expected" }, { label: "Safe abstention", value: bench.metrics.safeAbstentionRate, note: "Unclear cases left uncertain" }] : [];
  return <div className="content-page reliability-page"><Heading label="MEASUREMENT, NOT A PROMISE" title="Reliability is a practice." intro="A small benchmark of synthetic cases helps us see where the tool performs well—and where it should hold back." />
    <div className="reliability-callout"><span className="callout-symbol"><Scale size={21} /></span><div><strong>These scores are not a measure of legal correctness.</strong><p>They describe performance on limited sample cases, not your notice, jurisdiction, or a real-world outcome.</p></div></div>
      {loading ? <div className="loading-panel"><span className="skeleton-line wide" /><span className="skeleton-line" /></div> : error || !bench ? <div className="error-panel" role="alert"><AlertCircle size={16} /><span>Benchmark data is temporarily unavailable.</span><button onClick={() => void load()}>Retry</button></div> : <>
      <div className="benchmark-meta"><span><span className="live-dot" /> SAMPLE DATA · FIXTURE BENCHMARK</span><span>{bench.total} synthetic cases · updated {dateLabel(bench.generatedAt)}</span></div>
      <section className="metrics-grid" aria-label="Benchmark metrics">{metrics.map((m) => <article className="metric-card" key={m.label}><div className="metric-head"><span>{m.label}</span><Info size={15} /></div><strong>{Math.round(m.value * 100)}<small>%</small></strong><p>{m.note}</p><div className="metric-rule"><span style={{ width: `${Math.max(0, Math.min(100, m.value * 100))}%` }} /></div></article>)}</section>
      <div className="bench-summary"><div><strong>{bench.handled}</strong><span>handled</span></div><span className="summary-separator">/</span><div><strong>{bench.total}</strong><span>sample cases</span></div><span className="bench-abstain"><strong>{bench.abstained}</strong> safe abstentions</span></div>
      <section className="cases-section"><div className="cases-head"><div><Eyebrow>CASE-BY-CASE</Eyebrow><h2>Where the sample set stands</h2></div><label className="filter-wrap"><span className="visually-hidden">Filter cases</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All cases</option><option value="pass">Expected handling</option><option value="fail">Needs review</option><option value="abstained">Abstained</option></select></label></div>
        {cases.length ? <div className="case-table-wrap"><table className="case-table"><thead><tr><th>CASE</th><th>EXPECTED HANDLING</th><th>OUTCOME</th><th>STATUS</th></tr></thead><tbody>{cases.map((c) => <tr key={c.id}><td><strong>{c.id}</strong><span>{c.category}</span></td><td>{c.reason}</td><td>{c.abstained ? "Abstained" : c.pass ? "Handled" : "Needs review"}</td><td><span className={`case-state ${c.pass ? "pass" : "fail"}`}>{c.pass ? "Expected" : "Review"}</span></td></tr>)}</tbody></table></div> : <div className="empty-inline"><Info size={16} />No cases match this filter.</div>}
       </section><section className="reliability-notes" id="how-it-works-limits"><div><Eyebrow>HOW IT WORKS AND LIMITS</Eyebrow><h2>A sample is not a guarantee.</h2></div><div><ul><li>Test cases are synthetic and limited in number.</li><li>Rules may change and may not apply to your facts.</li><li>Text extraction can omit or misread crucial details.</li><li>A qualified professional can assess your circumstances.</li></ul><p className="sample-method-note">Cases are synthetic and written by the team; results show consistency on known cases, not a guarantee of real-world accuracy.</p><p className="sample-method-note">Benchmark values come from the analysis service and describe only its limited synthetic test set.</p></div></section>
    </>}
  </div>;
}
