import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, Clipboard, Clock3, FileText, FolderOpen, Info, Landmark, LoaderCircle, Menu, Printer, Scale, ShieldCheck, Trash2, UploadCloud, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { analyse, extractFile, getBench } from '@/lib/api';
import { trackerStorage } from '@/lib/storage';
import { noticeSamples } from '@/fixtures/notices';
import type { AnalysisResult, BenchResults, Severity, Stage, TrackedNotice } from '@/types/analysis';
import { Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const SAMPLE_LABELS = ['GST show-cause notice', 'Cheque return notice', 'Ordinary legal notice', 'Income tax intimation', 'Unclear / conflicting dates'];
const SAMPLES = noticeSamples.map((result, index) => ({ name: SAMPLE_LABELS[index], text: result.extractedText }));
const STAGES: Stage[] = ['received', 'understood', 'info_gathered', 'professional_review', 'response_prepared', 'closed'];
const STAGE_LABEL: Record<Stage, string> = { received: 'Received', understood: 'Understood', info_gathered: 'Gathering information', professional_review: 'Professional review', response_prepared: 'Response prepared', closed: 'Closed' };
const SEVERITY_LABEL: Record<Severity, string> = { routine: 'Routine', action_needed: 'Action needed', urgent: 'Time-sensitive', see_professional_now: 'Seek professional help now' };
const fmtDate = (value?: string) => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not clear from the text';
const stored = (key: string) => { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } };
const save = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* session storage may be unavailable */ } };

function AppShell({ children }: { children: ReactNode }) {
  const [path, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = [{ label: 'Analyse', href: '/' }, { label: 'Action Ledger', href: '/tracker' }, { label: 'Reliability', href: '/reliability' }];
  return <div className="min-h-[100dvh]">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" onClick={() => navigate('/')} aria-label="Lexora home"><span className="brand-mark"><Landmark size={19} strokeWidth={1.65} /></span><span>Notice <i>on</i> the Desk</span></button>
        <span className="header-note">A clearer first read of official notices</span>
        <button className="mobile-menu" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <nav className={`main-nav ${mobileOpen ? 'is-open' : ''}`} aria-label="Main navigation">
          {nav.map((item) => <button key={item.href} className={`nav-link ${path === item.href || (item.href === '/' && ['/review', '/result'].includes(path)) ? 'active' : ''}`} onClick={() => { navigate(item.href); setMobileOpen(false); }}>{item.label}</button>)}
        </nav>
      </div>
    </header>
    <main id="main" className="site-main">{children}</main>
    <footer className="site-footer"><div className="footer-inner"><span className="footer-brand">Lexora</span><span>For orientation, not legal advice.</span><button onClick={() => navigate('/reliability')}>How we measure reliability <ArrowUpRight size={13} /></button></div></footer>
  </div>;
}

function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow"><span className="eyebrow-rule" />{children}</div>; }
function PageHeading({ label, title, intro, aside }: { label: string; title: string; intro?: string; aside?: ReactNode }) {
  return <div className="page-heading"><div><Eyebrow>{label}</Eyebrow><h1>{title}</h1>{intro && <p>{intro}</p>}</div>{aside && <div className="heading-aside">{aside}</div>}</div>;
}
function NoticeLine({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'good' }) { return <div className={`notice-line ${tone}`}><Info size={16} aria-hidden="true" /><span>{children}</span></div>; }
function LoadingPanel() { return <div className="loading-panel" role="status" aria-label="Loading"><span className="skeleton-line wide" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>; }

function Home() {
  const [, navigate] = useLocation();
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const startReview = (content = text, warnings: string[] = []) => {
    if (!content.trim()) { setError('Add notice text or choose a sample to continue.'); return; }
    save('notice-text', content);
    save('notice-warnings', JSON.stringify(warnings));
    save('notice-sample', 'false');
    navigate('/review');
  };
  const handleFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const extracted = await extractFile(file);
      save('notice-text', extracted.text);
      save('notice-warnings', JSON.stringify(extracted.warnings || []));
      save('notice-quality', extracted.quality);
      save('notice-sample', 'false');
      navigate('/review');
    } catch { setError('We could not read that file. Try a text-based PDF or paste the notice instead.'); }
    finally { setUploading(false); }
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => { void handleFile(event.target.files?.[0]); event.target.value = ''; };
  const sampleClick = (sample: typeof SAMPLES[number]) => {
    save('notice-text', sample.text);
    save('notice-warnings', '[]');
    save('notice-sample', 'true');
    save('notice-sample-name', sample.name);
    navigate('/review');
  };
  return <div className="home-page">
    <div className="home-topline"><span>PRIVATE BY DESIGN</span><span>01 / START HERE</span></div>
    <section className="hero-grid">
      <div className="hero-copy"><Eyebrow>Understand the paper in front of you</Eyebrow><h1>Before you respond,<br /><em>understand</em> the notice.</h1><p className="hero-intro">A careful first read of official letters. Find the dates, the stated claims, and the questions worth asking next.</p>
        <div className="hero-trust"><span><ShieldCheck size={17} /> Evidence-linked</span><span><Scale size={17} /> Cautious by design</span></div>
      </div>
      <div className="desk-mark" aria-hidden="true"><div className="paper-sheet"><div className="paper-seal"><Landmark size={29} strokeWidth={1.3} /></div><span className="paper-line pl-long" /><span className="paper-line pl-mid" /><span className="paper-line pl-short" /><span className="paper-divider" /><span className="paper-line pl-long" /><span className="paper-line pl-mid" /><div className="paper-stamp">NOTICE<br />RECEIVED</div></div><span className="desk-caption">A little more legible.<br />A little less overwhelming.</span></div>
    </section>
    <section className="intake-layout">
      <div className="intake-main">
        <div className="section-title"><span className="section-number">01</span><div><h2>Bring the notice into view</h2><p>Nothing is sent until you choose to analyse.</p></div></div>
        <button className={`upload-zone ${dragging ? 'dragging' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files[0]); }} disabled={uploading}>
          {uploading ? <><LoaderCircle className="spin" size={25} /><span className="upload-title">Reading your document…</span><span className="upload-caption">This may take a moment.</span></> : <><span className="upload-icon"><UploadCloud size={22} /></span><span className="upload-title">Drop a notice here, or <u>browse files</u></span><span className="upload-caption">PDF, DOCX, TXT or image · sensitive details may be removed first</span></>}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" className="visually-hidden" onChange={onFileChange} aria-label="Choose a notice file" />
        <div className="or-divider"><span>OR PASTE TEXT</span></div>
        <label className="field-label" htmlFor="notice-paste">Notice text <span>Remove personal details if you prefer</span></label>
        <textarea id="notice-paste" className="paste-area" value={text} onChange={(e) => { setText(e.target.value); setError(''); }} placeholder="Paste the letter or notice text here…" rows={6} />
        {error && <p className="form-error" role="alert"><AlertCircle size={15} />{error}</p>}
        <button className="button button-primary analyze-start" onClick={() => startReview()} disabled={!text.trim()}><span>Review extracted text</span><ArrowRight size={16} /></button>
        <p className="privacy-note"><ShieldCheck size={14} /> You can review extracted text before analysis.</p>
      </div>
      <aside className="sample-aside"><Eyebrow>Explore with a sample</Eyebrow><h2>Try a synthetic notice</h2><p className="sample-intro">No personal details. Each example is made up for demonstration.</p><div className="sample-list">{SAMPLES.map((sample, index) => <button key={sample.name} className="sample-link" onClick={() => sampleClick(sample)}><span className="sample-index">0{index + 1}</span><span>{sample.name}</span><ArrowUpRight size={15} /></button>)}</div><div className="sample-foot"><span className="sample-dot" /> Sample content is not a real notice or legal guidance.</div></aside>
    </section>
    <section className="home-bottom"><div className="bottom-icon"><FileText size={20} /></div><p><strong>Start with what is written.</strong> We link each observation to text we can point to, and label what is uncertain.</p><button className="text-link" onClick={() => navigate('/reliability')}>See reliability notes <ArrowRight size={14} /></button></section>
  </div>;
}

function Review() {
  const [, navigate] = useLocation();
  const [text, setText] = useState(() => stored('notice-text'));
  const [warnings, setWarnings] = useState<string[]>(() => { try { return JSON.parse(stored('notice-warnings') || '[]'); } catch { return []; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState(stored('notice-quality') || 'good');
  const runAnalysis = async () => {
    if (!text.trim()) { setError('There is no extracted text to analyse.'); return; }
    setBusy(true); setError('');
    try {
      const result = await analyse({ text });
      result.extractedText = text;
      result.extraction = { ...result.extraction, quality: quality === 'poor' ? 'poor' : result.extraction.quality, warnings: [...new Set([...(result.extraction?.warnings || []), ...warnings])] };
      result.isPrecomputedSample = stored('notice-sample') === 'true';
      save('notice-result', JSON.stringify(result));
      navigate('/result');
    } catch { setError('Analysis could not be completed just now. Your text remains here; please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="content-page">
    <button className="back-link" onClick={() => navigate('/')}><ArrowLeft size={15} /> Back to start</button>
    <PageHeading label="STEP 02 / REVIEW" title="Check the text first." intro="Compare this extraction with your original document. Correct anything that is wrong before analysis." />
    {warnings.length > 0 && <NoticeLine tone="warn">Some text may be incomplete or unclear. Check every date and amount against the original.</NoticeLine>}
    {quality === 'poor' && warnings.length === 0 && <NoticeLine tone="warn">The extraction quality is marked as poor. Details may be missing; check against the original.</NoticeLine>}
    <div className="review-card">
      <div className="review-toolbar"><div className="review-doc"><span className="doc-icon"><FileText size={17} /></span><div><strong>Extracted notice text</strong><span>{text.length.toLocaleString()} characters · editable</span></div></div><span className={`quality-chip ${quality === 'poor' ? 'low' : ''}`}><span />{quality === 'poor' ? 'Review carefully' : 'Text available'}</span></div>
      <label className="visually-hidden" htmlFor="review-text">Review and edit extracted notice text</label>
      <textarea id="review-text" value={text} onChange={(e) => setText(e.target.value)} className="review-text" rows={18} placeholder="No notice text found. Return to start and paste the text or upload a file." />
      {warnings.length > 0 && <div className="warning-list"><strong>Extraction notes</strong>{warnings.map((warning, index) => <span key={index}><AlertCircle size={14} />{warning}</span>)}</div>}
    </div>
    {error && <p className="form-error" role="alert"><AlertCircle size={15} />{error}</p>}
    <div className="review-actions"><div className="review-privacy"><ShieldCheck size={15} /> Your edits are used for this analysis.</div><button className="button button-primary" disabled={busy || !text.trim()} onClick={() => void runAnalysis()}>{busy ? <><LoaderCircle className="spin" size={16} /> Analysing…</> : <>Analyse this text <ArrowRight size={16} /></>}</button></div>
  </div>;
}

function getResult() { try { return JSON.parse(stored('notice-result')) as AnalysisResult; } catch { return null; } }
function EvidenceText({ text, evidence }: { text: string; evidence: AnalysisResult['claims'][number]['evidence'] }) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const focusQuote = (index: number) => {
    const item = evidence[index];
    setSelected(index);
    if (item?.start >= 0 && item.end > item.start) {
      const area = document.getElementById('source-text') as HTMLTextAreaElement | null;
      if (area) { area.focus(); area.setSelectionRange(item.start, item.end); area.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    } else sourceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  return <div className="evidence-stack">{evidence.length ? evidence.map((item, i) => <button key={`${item.start}-${i}`} className={`evidence-quote ${selected === i ? 'selected' : ''}`} onClick={() => focusQuote(i)} disabled={!item.foundInText}><span className="quote-mark">“</span><span>{item.quote}</span><span className={`evidence-status ${item.foundInText ? 'found' : 'not-found'}`}>{item.foundInText ? 'In text' : 'Not found'}</span></button>) : <p className="no-evidence">No supporting quote was returned for this claim.</p>}</div>;
}
function ResultPage() {
  const [, navigate] = useLocation();
  const result = useMemo(getResult, []);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [tracked, setTracked] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!result) return <div className="content-page"><EmptyState title="No analysis to show yet" body="Start by adding a notice, then review its text before analysis." action="Go to Analyse" onAction={() => navigate('/')} /></div>;
  const deadline = result.deadline;
  const risk = result.severity;
  const saveToTracker = async () => {
    const item: TrackedNotice = { result, stage: 'received', addedAt: new Date().toISOString(), unresolved: result.claims.filter((claim) => claim.confidence === 'low').map((claim) => claim.label), docsGathered: [] };
    trackerStorage.add(item.result);
    setTracked(true);
  };
  const copySummary = async () => { try { await navigator.clipboard.writeText(`${result.summaryPlain}\n\nFor orientation only; not legal advice.`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } };
  return <div className="result-page">
    <div className="result-top"><button className="back-link" onClick={() => navigate('/review')}><ArrowLeft size={15} /> Edit notice text</button><span className="result-label"><span className="live-dot" /> FIRST READ · {result.isPrecomputedSample ? 'SYNTHETIC SAMPLE' : 'INTERPRETATION'}</span></div>
    {result.isPrecomputedSample && <NoticeLine>Sample analysis: this is an illustrative interpretation of synthetic text, not an assessment of a real notice.</NoticeLine>}
    <section className="result-intro">
      <div className="result-summary"><Eyebrow>At a glance</Eyebrow><h1>{result.summaryPlain || 'A first read of your notice'}</h1><p className="result-disclaimer">This is an interpretation of the text provided, not a legal conclusion. Dates and consequences should be checked against the original notice and applicable rules.</p></div>
      <div className={`severity-card severity-${risk.level}`}><span className="severity-caption">ATTENTION INDICATOR</span><strong>{SEVERITY_LABEL[risk.level] || 'Needs review'}</strong><span>{risk.score}/100 · An orientation signal, not a prediction of outcome.</span></div>
    </section>
    <div className="result-actionbar"><div><span className="actionbar-label">Suggested next step</span><strong>{result.professional.recommendation === 'yes' ? 'Consider prompt professional review' : result.professional.recommendation === 'probably' ? 'A professional may help clarify this' : 'Verify details before deciding how to respond'}</strong></div><div className="actionbar-buttons"><button className="button button-outline" onClick={() => void copySummary()}><Clipboard size={15} />{copied ? 'Copied' : 'Copy summary'}</button><button className="button button-primary" onClick={() => void saveToTracker()} disabled={tracked}><Check size={15} />{tracked ? 'In Action Ledger' : 'Add to Action Ledger'}</button></div></div>
    <div className="result-columns">
      <div className="result-main-col">
        <section className="result-section"><div className="result-section-head"><div><Eyebrow>01 / NOTICE DETAILS</Eyebrow><h2>What the text appears to say</h2></div><span className="interpretation-label">INTERPRETATION</span></div>
          {result.claims?.length ? <div className="claims-list">{result.claims.map((claim, index) => <article className="claim-row" key={`${claim.label}-${index}`}><div className="claim-detail"><span className="claim-label">{claim.label}</span><p>{claim.value}</p><span className={`confidence confidence-${claim.confidence}`}>{claim.confidence} confidence</span></div><EvidenceText evidence={claim.evidence || []} text={result.extractedText} /></article>)}</div> : <EmptyInline>We could not identify distinct claims. Read the original notice and seek help if its meaning is unclear.</EmptyInline>}
        </section>
        <section className="result-section deadline-panel"><div className="result-section-head"><div><Eyebrow>02 / TIMING</Eyebrow><h2>Deadline mentioned</h2></div><span className={`deadline-state state-${deadline.status}`}>{deadline.status}</span></div>
          <div className="deadline-date">{deadline.date ? fmtDate(deadline.date) : 'No date confidently identified'}{typeof deadline.daysLeft === 'number' && <small>{deadline.daysLeft >= 0 ? `${deadline.daysLeft} days from today` : `${Math.abs(deadline.daysLeft)} days ago (check promptly)`}</small>}</div>
          <p className="deadline-note">{deadline.note || 'The timing shown is taken from the text or a cautious estimate; it may not match a legal deadline.'}</p>
          {deadline.source.quote && <blockquote className="deadline-quote">“{deadline.source.quote}”</blockquote>}
          {deadline.candidates?.length ? <div className="candidate-dates"><strong>Dates that may need checking</strong>{deadline.candidates.map((item) => <span key={`${item.label}-${item.date}`}>{item.label}: {fmtDate(item.date)}</span>)}</div> : null}
          {!deadline.source.ruleVerified && <p className="unverified-note"><Info size={14} /> Any rule-based calculation is not independently verified.</p>}
        </section>
        <section className="result-section chain-section"><div className="result-section-head"><div><Eyebrow>03 / HOW TO READ THIS</Eyebrow><h2>From evidence to next step</h2></div></div>
          <div className="reasoning-chain">{[['Text observed', result.chain.evidence], ['Possible meaning', result.chain.interpretation], ['Rule context', result.chain.rule], ['Decision', result.chain.decision], ['Action to consider', result.chain.action]].map(([label, value], index) => <div className="chain-step" key={label}><span className="chain-num">0{index + 1}</span><div><span className="chain-label">{label}</span><p>{value || 'No confident interpretation available.'}</p></div></div>)}</div>
        </section>
        {!!result.checklist?.length && <section className="result-section"><div className="result-section-head"><div><Eyebrow>04 / PRACTICAL CHECKLIST</Eyebrow><h2>Things to gather or confirm</h2></div></div><ul className="checklist">{result.checklist.map((item) => <li key={item.id}><span className="check-box"><Check size={12} /></span><span><strong>{item.label}</strong>{item.why && <small>{item.why}</small>}</span></li>)}</ul></section>}
        {!!result.replyOutline?.length && <section className="result-section"><div className="result-section-head"><div><Eyebrow>05 / IF YOU REPLY</Eyebrow><h2>A neutral outline to discuss</h2></div></div><NoticeLine tone="warn">This is a discussion outline, not a ready-to-send legal response.</NoticeLine><div className="outline-list">{result.replyOutline.map((point, index) => <div key={`${point.heading}-${index}`}><span>0{index + 1}</span><section><strong>{point.heading}</strong><p>{point.body}</p></section></div>)}</div></section>}
      </div>
      <aside className="result-side">
        <div className="side-card professional-card"><Eyebrow>WHEN TO GET HELP</Eyebrow><h3>{result.professional.recommendation === 'yes' ? 'Professional advice may be important.' : 'Consider a qualified professional.'}</h3><ul>{result.professional.reasons?.map((reason, index) => <li key={index}><span className="tiny-dash" />{reason}</li>)}</ul><p>Especially if a deadline is close, facts are disputed, or the consequences are significant.</p></div>
        <div className="side-card uncertainty-card"><div className="uncertainty-heading"><AlertCircle size={16} /><strong>What remains uncertain</strong></div><p>Text extraction can miss details. This tool does not verify the issuer, underlying facts, or current legal rules.</p>{result.extraction?.warnings?.map((warning, index) => <span key={index} className="uncertainty-item">{warning}</span>)}</div>
        {!!result.consequences?.length && <div className="side-card consequence-card"><Eyebrow>POTENTIAL CONSEQUENCES</Eyebrow>{result.consequences.map((item, index) => <div key={index} className="consequence-item"><p>{item.text}</p><span className={item.verified ? 'is-cited' : 'not-cited'}>{item.verified ? 'Cited rule · verify applicability' : 'Unverified rule reference'}</span></div>)}</div>}
        <button className="source-toggle" aria-expanded={sourceOpen} onClick={() => setSourceOpen(!sourceOpen)}><span><FileText size={16} />Source text</span><ChevronDown className={sourceOpen ? 'rotate' : ''} size={16} /></button>
        {sourceOpen && <div className="source-panel" ref={(node) => { if (node) node.dataset.source = 'true'; }}><p>Analysis is grounded in the text below. Highlighted selections are quotes returned as evidence.</p><label className="visually-hidden" htmlFor="source-text">Source notice text</label><textarea id="source-text" readOnly value={result.extractedText} rows={15} /></div>}
      </aside>
    </div>
    <div className="result-bottom"><button className="text-link" onClick={() => navigate('/')}><ArrowLeft size={14} /> Analyse another notice</button><button className="text-link" onClick={() => navigate('/reliability')}>About reliability <ArrowRight size={14} /></button></div>
  </div>;
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><FolderOpen size={24} /></span><h2>{title}</h2><p>{body}</p><button className="button button-primary" onClick={onAction}>{action} <ArrowRight size={15} /></button></div>;
}
function EmptyInline({ children }: { children: ReactNode }) { return <div className="empty-inline"><Info size={17} />{children}</div>; }
function Tracker() {
  const [, navigate] = useLocation();
  const [items, setItems] = useState<TrackedNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [confirmId, setConfirmId] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError(false);
    try { setItems(trackerStorage.list()); } catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const changeStage = async (id: string, stage: Stage) => { try { trackerStorage.updateStage(id, stage); await refresh(); } catch { setError(true); } };
  const removeItem = async (id: string) => { try { trackerStorage.delete(id); setConfirmId(''); await refresh(); } catch { setError(true); } };
  return <div className="content-page tracker-page">
    <PageHeading label="YOUR WORKING LIST" title="Action Ledger" intro="A private place to keep track of what you have read, gathered, and still need to check." aside={<span className="private-badge"><ShieldCheck size={14} /> Stored on this device</span>} />
    <div className="tracker-toolbar"><div><strong>{loading ? 'Loading your ledger…' : `${items.length} ${items.length === 1 ? 'notice' : 'notices'}`}</strong><span>Move a notice through the steps at your own pace.</span></div><button className="button button-outline" onClick={() => navigate('/')}><span>＋</span> Add notice</button></div>
    {error && <div className="error-panel" role="alert"><AlertCircle size={16} /><span>We could not update the ledger. Please try again.</span><button onClick={() => void refresh()}>Retry</button></div>}
    {loading ? <div className="tracker-skeleton"><LoadingPanel /><LoadingPanel /></div> : items.length === 0 ? <EmptyState title="A clear desk, for now." body="Add an analysis to your ledger when you want to keep an eye on its next steps." action="Analyse a notice" onAction={() => navigate('/')} /> : <div className="ledger-list">{items.map((item) => <article className="ledger-row" key={item.result.id}>
      <div className="ledger-date"><span>ADDED</span><strong>{fmtDate(item.addedAt)}</strong></div>
      <div className="ledger-main"><button className="ledger-title" onClick={() => { save('notice-result', JSON.stringify(item.result)); navigate('/result'); }}>{item.result.summaryPlain || item.result.noticeType.replaceAll('_', ' ')}</button><span className="ledger-meta">{item.result.noticeType.replaceAll('_', ' ')} · {SEVERITY_LABEL[item.result.severity.level]}</span>{item.unresolved?.length > 0 && <span className="ledger-unresolved">{item.unresolved.length} detail{item.unresolved.length === 1 ? '' : 's'} need checking</span>}</div>
      <div className="ledger-stage"><label htmlFor={`stage-${item.result.id}`}>Current step</label><select id={`stage-${item.result.id}`} value={item.stage} onChange={(e) => void changeStage(item.result.id, e.target.value as Stage)}>{STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABEL[stage]}</option>)}</select></div>
      <div className="ledger-actions"><button aria-label="Open handoff sheet" className="icon-button" title="Prepare handoff sheet" onClick={() => { save('handoff-result', JSON.stringify(item.result)); navigate(`/handoff/${item.result.id}`); }}><ArrowUpRight size={16} /></button><button aria-label={`Remove ${item.result.noticeType} from ledger`} className="icon-button danger-icon" title="Remove from ledger" onClick={() => setConfirmId(item.result.id)}><Trash2 size={16} /></button></div>
      {confirmId === item.result.id && <div className="confirm-strip" role="alertdialog" aria-label="Confirm removal"><span>Remove this notice from your ledger?</span><button onClick={() => void removeItem(item.result.id)}>Remove</button><button onClick={() => setConfirmId('')}>Keep it</button></div>}
    </article>)}</div>}
    <NoticeLine>Ledger entries are stored locally in this browser. Clearing site data may remove them.</NoticeLine>
  </div>;
}

function Handoff() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [result, setResult] = useState<AnalysisResult | null>(() => { try { return JSON.parse(stored('handoff-result')) as AnalysisResult; } catch { return null; } });
  useEffect(() => { if (params.id && !result) { const item = trackerStorage.get(params.id); if (item) setResult(item.result); } }, [params.id, result]);
  const printPage = () => window.print();
  if (!result) return <div className="content-page"><EmptyState title="Handoff sheet unavailable" body="Open a notice from the Action Ledger to prepare its handoff sheet." action="Open Action Ledger" onAction={() => navigate('/tracker')} /></div>;
  return <div className="handoff-wrap">
    <div className="handoff-controls"><button className="back-link" onClick={() => navigate('/tracker')}><ArrowLeft size={15} /> Action Ledger</button><button className="button button-primary no-print" onClick={printPage}><Printer size={16} /> Print this sheet</button></div>
    <article className="handoff-sheet">
      <div className="handoff-top"><div className="brand-small"><span className="brand-mark"><Landmark size={17} /></span>Lexora</div><span>PREPARED FOR A CONVERSATION</span></div>
      <Eyebrow>NOTICE HANDOFF · PERSONAL NOTES</Eyebrow>
      <h1>What I understand<br />so far.</h1>
      <p className="handoff-lead">A factual starting point to discuss with a qualified professional. This sheet is an interpretation of supplied text, not legal advice.</p>
      <div className="handoff-meta"><div><span>NOTICE TYPE</span><strong>{result.noticeType.replaceAll('_', ' ')}</strong></div><div><span>DEADLINE AS READ</span><strong>{fmtDate(result.deadline.date)}</strong></div><div><span>ATTENTION INDICATOR</span><strong>{SEVERITY_LABEL[result.severity.level]}</strong></div></div>
      <section className="handoff-section"><span className="handoff-num">01</span><div><h2>Short summary</h2><p>{result.summaryPlain}</p></div></section>
      <section className="handoff-section"><span className="handoff-num">02</span><div><h2>Details to verify against the original</h2><ul>{result.claims.slice(0, 5).map((claim, index) => <li key={index}><strong>{claim.label}:</strong> {claim.value}<small>{claim.evidence?.[0]?.foundInText ? `Quoted: “${claim.evidence[0].quote}”` : 'No supporting text quote identified.'}</small></li>)}</ul></div></section>
      <section className="handoff-section"><span className="handoff-num">03</span><div><h2>Questions I would like to ask</h2><ul>{result.checklist.slice(0, 5).map((item) => <li key={item.id}>{item.label}<small>{item.why || 'Confirm this against the source document.'}</small></li>)}{result.professional.reasons.slice(0, 2).map((reason, index) => <li key={`reason-${index}`}>{reason}</li>)}</ul></div></section>
      <div className="handoff-note"><Info size={16} /><p>Any dates or rule references on this sheet should be checked against the original notice and current law. This tool does not verify facts or legal applicability.</p></div>
      <div className="notes-area"><span>MY NOTES</span><div /></div>
      <footer className="handoff-footer">Lexora · Created {new Date().toLocaleDateString('en-IN')} · For discussion only</footer>
    </article>
  </div>;
}

function Reliability() {
  const [bench, setBench] = useState<BenchResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('all');
  const load = useCallback(async () => { setLoading(true); setError(false); try { setBench(await getBench()); } catch { setError(true); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const cases = useMemo(() => (bench?.cases || []).filter((item) => filter === 'all' || (filter === 'abstained' ? item.abstained : item.pass === (filter === 'pass'))), [bench, filter]);
  const metrics = bench ? [
    { label: 'Evidence support', value: bench.metrics.evidenceSupportRate, note: 'Claims supported by a source quote' },
    { label: 'Deadline handling', value: bench.metrics.deadlineCorrectness, note: 'Deadline cases handled as expected' },
    { label: 'Safe abstention', value: bench.metrics.safeAbstentionRate, note: 'Unclear cases left uncertain' },
  ] : [];
  return <div className="content-page reliability-page">
    <PageHeading label="MEASUREMENT, NOT A PROMISE" title="Reliability is a practice." intro="A small benchmark of synthetic cases helps us see where this tool performs well—and where it should hold back." aside={<span className="sample-badge"><span /> SYNTHETIC TEST DATA</span>} />
    <div className="reliability-callout"><div className="callout-symbol"><Scale size={21} /></div><div><strong>These scores are not a measure of legal correctness.</strong><p>They describe performance on a limited set of sample cases, not your notice, your jurisdiction, or a real-world outcome.</p></div></div>
    {loading ? <LoadingPanel /> : error || !bench ? <div className="error-panel"><AlertCircle size={16} /><span>Benchmark data is temporarily unavailable.</span><button onClick={() => void load()}>Retry</button></div> : <>
      <div className="benchmark-meta"><span><span className="live-dot" /> SAMPLE BENCHMARK</span><span>{bench.total} synthetic cases · updated {fmtDate(bench.generatedAt)}</span></div>
      <section className="metrics-grid" aria-label="Benchmark metrics">{metrics.map((metric) => <article className="metric-card" key={metric.label}><div className="metric-head"><span>{metric.label}</span><Info size={15} aria-hidden="true" /></div><strong>{Math.round(metric.value * 100)}<small>%</small></strong><p>{metric.note}</p><div className="metric-rule"><span style={{ width: `${Math.max(0, Math.min(100, metric.value * 100))}%` }} /></div></article>)}</section>
      <div className="bench-summary"><div><strong>{bench.handled}</strong><span>handled</span></div><span className="summary-separator">/</span><div><strong>{bench.total}</strong><span>sample cases</span></div><span className="bench-abstain"><strong>{bench.abstained}</strong> safe abstentions</span></div>
      <section className="cases-section"><div className="cases-head"><div><Eyebrow>CASE-BY-CASE</Eyebrow><h2>Where the sample set stands</h2></div><label className="filter-wrap"><span className="visually-hidden">Filter cases</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All cases</option><option value="pass">Expected handling</option><option value="fail">Needs review</option><option value="abstained">Abstained</option></select></label></div>
        {cases.length ? <div className="case-table-wrap"><table className="case-table"><thead><tr><th>CASE</th><th>EXPECTED HANDLING</th><th>OUTCOME</th><th>STATUS</th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td><strong>{item.id}</strong><span>{item.category}</span></td><td>{item.reason}</td><td>{item.abstained ? 'Abstained' : item.pass ? 'Handled' : 'Needs review'}</td><td><span className={`case-state ${item.pass ? 'pass' : 'fail'}`}>{item.pass ? 'Expected' : 'Review'}</span></td></tr>)}</tbody></table></div> : <EmptyInline>No cases match this filter.</EmptyInline>}
      </section>
      <section className="reliability-notes"><div><Eyebrow>IMPORTANT LIMITS</Eyebrow><h2>A sample is not a guarantee.</h2></div><ul><li>Test cases are synthetic and limited in number.</li><li>Rules may change and may not apply to your facts.</li><li>Text extraction can omit or misread crucial details.</li><li>A qualified professional can assess your circumstances.</li></ul></section>
    </>}
  </div>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function Router() {
  return <AppShell><RoutedErrorBoundary><Switch>
    <Route path="/" component={Home} /><Route path="/review" component={Review} /><Route path="/result" component={ResultPage} /><Route path="/tracker" component={Tracker} /><Route path="/handoff/:id" component={Handoff} /><Route path="/reliability" component={Reliability} />
    <Route><div className="content-page"><EmptyState title="This page is not on the desk." body="The page you asked for could not be found." action="Return to Analyse" onAction={() => window.location.assign('/')} /></div></Route>
  </Switch></RoutedErrorBoundary></AppShell>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
