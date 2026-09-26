"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Bug, Check, CheckCheck, ChevronRight, CircleAlert, ClipboardPaste, Database, FileCheck2, FileText, FlaskConical, GitBranch, Globe, Layers3, LockKeyhole, MessageSquare, MoreHorizontal, Search, Settings2, ShieldCheck, Sparkles, X } from "lucide-react";
import { AgentTrace, formatMs, formatUsd } from "@/app/components/agent-trace";
import { ProviderStatus, RuntimeAlert, SourceOrigin } from "@/app/components/evidence-sources";
import { ClaimList, NarrativeOrigin, OwnerNudge } from "@/app/components/narrative";
import { ACCOUNT, AS_OF, createScenario, referenceCommitments } from "@/lib/fixtures";
import { readPipelineEvents } from "@/lib/pipeline/events";
import { modelInfo } from "@/lib/pipeline/models";
import { templateNarrative } from "@/lib/pipeline/narrative";
import { plannedSteps, type PlannedModels } from "@/lib/pipeline/steps";
import { idleTrace, replayDelayMs, traceReducer, type TraceState } from "@/lib/pipeline/trace-state";
import { draftUpdate, reconcile } from "@/lib/reconcile";
import type { AnalyzedCommitment, Analysis, Scenario, Source, SourceKind, Verdict } from "@/lib/schema";
import { VERDICTS as verdicts } from "@/lib/verdicts";

type View = "ledger" | "review" | "sources" | "activity";
type Review = { commitmentId: string; text: string; approved: boolean; runId: string };
type AuditEvent = { id: number; title: string; detail: string };
type LiveAccess = { open: boolean; perIpPerHour: number; perDay: number; durableLimits: boolean; ownerToken: boolean; models: PlannedModels };

function parseLiveAccess(status: unknown): LiveAccess | null {
  if (typeof status !== "object" || status === null || !("liveConfigured" in status) || status.liveConfigured !== true || !("liveAccess" in status)) return null;
  const access = status.liveAccess;
  if (typeof access !== "object" || access === null) return null;
  const value = access as Record<string, unknown>;
  const pipeline = "pipeline" in status && typeof status.pipeline === "object" && status.pipeline !== null ? status.pipeline as Record<string, unknown> : {};
  const modelId = (entry: unknown) => typeof entry === "object" && entry !== null && "id" in entry && typeof entry.id === "string" ? entry.id : null;
  const extraction = modelId(pipeline.extraction) ?? ("model" in status && typeof status.model === "string" ? status.model : null);
  return { open: value.open === true, perIpPerHour: typeof value.perIpPerHour === "number" ? value.perIpPerHour : 0, perDay: typeof value.perDay === "number" ? value.perDay : 0, durableLimits: value.durableLimits === true, ownerToken: value.ownerToken === true, models: { triage: modelId(pipeline.triage), extraction, narrative: modelId(pipeline.narrative) } };
}

const SOURCE_KIND_LABEL: Record<SourceKind, string> = { Meeting: "Meeting", Support: "Support", Engineering: "Engineering", Availability: "Availability", PublicClaim: "Public claim", Runtime: "Runtime errors", UserSupplied: "User supplied" };

function initialAnalysis(): Analysis {
  const { sources, facts } = createScenario("blocked");
  const commitments = referenceCommitments.map((commitment) => reconcile(commitment, facts, ACCOUNT.id, AS_OF)).map((commitment): AnalyzedCommitment => ({ ...commitment, narrative: commitment.intent === "committed" ? templateNarrative(commitment, null) : null }));
  return { mode: "reference", model: null, runId: "reference-initial", asOf: AS_OF, scenario: "blocked", commitments, sources, elapsedMs: 0, usage: null, pipeline: { replay: true, steps: plannedSteps("reference", null), checks: [], providers: [], budgetUsd: null, reservedUsd: null, costUsd: null } };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Badge({ verdict }: { verdict: Verdict }) {
  const status = verdicts[verdict];
  return <span className={`badge ${status.className}`}><span />{status.label}</span>;
}

function SourceIcon({ source }: { source: Source }) {
  if (source.kind === "Meeting" || source.kind === "Support") return <MessageSquare size={15} />;
  if (source.kind === "Engineering") return <GitBranch size={15} />;
  if (source.kind === "PublicClaim") return <Globe size={15} />;
  if (source.kind === "Runtime") return <Bug size={15} />;
  if (source.kind === "UserSupplied") return <ClipboardPaste size={15} />;
  return <Database size={15} />;
}

function shortDate(date: string | null) {
  if (!date) return "Not agreed";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const [analysis, setAnalysis] = useState<Analysis>(initialAnalysis);
  const [view, setView] = useState<View>("ledger");
  const [selectedId, setSelectedId] = useState("PL-101");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [scenario, setScenario] = useState<Scenario>("blocked");
  const [mode, setMode] = useState<"reference" | "live">("reference");
  const [accessToken, setAccessToken] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [offerReference, setOfferReference] = useState(false);
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [liveAccess, setLiveAccess] = useState<LiveAccess | null>(null);
  const liveConfigured = liveAccess !== null;
  const liveSelectable = liveConfigured && (liveAccess.open || liveAccess.ownerToken);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [trace, setTrace] = useState<TraceState | null>(null);
  const [traceExpanded, setTraceExpanded] = useState(true);
  const shownTrace = trace ?? idleTrace(mode, plannedSteps(mode, liveAccess?.models ?? null));
  const [detailTab, setDetailTab] = useState<"evidence" | "draft">("evidence");
  const [events, setEvents] = useState<AuditEvent[]>([{ id: 0, title: "Reference workspace opened", detail: "Synthetic fixture loaded. No model call or customer communication." }]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { signal: controller.signal }).then((response) => response.json()).then((status) => {
      const access = parseLiveAccess(status);
      setLiveAccess(access);
      if (access?.open) setMode("live");
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  const selected = analysis.commitments.find((commitment) => commitment.id === selectedId) ?? analysis.commitments[0];
  const activeReview = reviews.find((review) => review.commitmentId === selected?.id);
  const attentionCount = analysis.commitments.filter((commitment) => ["blocked", "overdue", "verify", "unknown"].includes(commitment.verdict)).length;
  const gap = analysis.commitments.find((commitment) => commitment.verdict === "blocked");
  const crashing = analysis.commitments.find((commitment) => commitment.runtime);
  const visibleCommitments = useMemo(() => analysis.commitments.filter((commitment) => {
    const matchesView = view !== "review" || reviews.some((review) => review.commitmentId === commitment.id);
    const matchesFilter = filter === "all" || (filter === "attention" ? ["blocked", "overdue", "verify", "unknown"].includes(commitment.verdict) : commitment.verdict === filter);
    return matchesView && matchesFilter && `${commitment.title} ${commitment.owner ?? ""}`.toLowerCase().includes(search.toLowerCase());
  }), [analysis.commitments, filter, reviews, search, view]);

  function record(title: string, detail: string) {
    setEvents((previous) => [{ id: previous.length, title, detail }, ...previous]);
  }

  function navigate(next: View) {
    setView(next);
    setFilter("all");
    setSearch("");
  }

  async function runAnalysis(runMode: "reference" | "live" = mode) {
    setRunning(true);
    setError("");
    setOfferReference(false);
    setNotice("");
    try {
      const token = accessToken.trim();
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(runMode === "live" && token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ mode: runMode, scenario }),
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok || !response.body) {
        const result: unknown = await response.json().catch(() => null);
        const details = typeof result === "object" && result !== null ? result as Record<string, unknown> : {};
        setOfferReference(runMode === "live" && (details.fallback === "reference" || response.status === 429));
        throw new Error(typeof details.error === "string" ? details.error : response.status === 429 ? "Too many requests from your connection right now. Wait a minute and try again." : "The evidence check failed.");
      }
      setTraceExpanded(true);
      let next: Analysis | null = null;
      let streamError: { error: string; fallback?: string } | null = null;
      for await (const event of readPipelineEvents(response.body)) {
        if (runMode === "reference") await sleep(replayDelayMs(event));
        setTrace((previous) => traceReducer(previous ?? idleTrace(runMode, []), event));
        if (event.type === "result") next = event.analysis;
        if (event.type === "error") streamError = event;
      }
      if (streamError) {
        setOfferReference(runMode === "live" && streamError.fallback === "reference");
        throw new Error(streamError.error);
      }
      if (!next) throw new Error("The evidence check ended before returning results.");
      const completed: Analysis = next;
      setAnalysis(completed);
      setSelectedId(completed.commitments.find((commitment) => commitment.featureId === "audit-export")?.id ?? completed.commitments[0]?.id ?? "");
      setReviews([]);
      setDetailTab("evidence");
      const fallbacks = completed.pipeline.steps.filter((step) => step.status === "fallback" || step.status === "skipped").map((step) => step.label);
      const unavailable = completed.pipeline.providers.filter((provider) => provider.status === "failed").map((provider) => provider.error ?? `${provider.label} unavailable.`);
      setNotice(`${completed.mode === "live" ? "Agent pipeline" : "Reference replay"} complete${fallbacks.length ? `, with a labelled fallback in ${fallbacks.join(" and ")}` : ""}. ${unavailable.length ? `${unavailable.join(" ")} Verdicts use the remaining evidence. ` : ""}Previous draft approvals have been cleared.`);
      record("Evidence reconciled", `${completed.commitments.length} records · ${completed.pipeline.steps.map((step) => `${step.label}: ${step.status}`).join(", ")} · ${completed.mode === "live" ? `${formatUsd(completed.pipeline.costUsd)} estimated` : "no model call"} · ${scenario}`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "The evidence check could not finish.";
      setError(message);
      record("Evidence check failed", "The previous results remain visible. No fallback or delivery action was taken.");
    } finally { setRunning(false); }
  }

  function runReferenceInstead() {
    setMode("reference");
    void runAnalysis("reference");
  }

  function openSource(sourceId: string) {
    navigate("sources");
    setSearch(sourceId);
  }

  function prepareDraft(commitment: AnalyzedCommitment) {
    setSelectedId(commitment.id);
    if (!reviews.some((review) => review.commitmentId === commitment.id)) {
      setReviews((previous) => [...previous, { commitmentId: commitment.id, text: commitment.narrative?.draftText ?? draftUpdate(commitment), approved: false, runId: analysis.runId }]);
      record("Customer update drafted", `${commitment.id} · ${commitment.narrative?.origin === "model" ? `Written by ${commitment.narrative.model ? modelInfo(commitment.narrative.model).name : "Nemotron"}, guardrail-checked` : "Template-based wording"}, grounded in the current verdict. Not sent.`);
    }
    setDetailTab("draft");
    setNotice("Draft ready for your review. Nothing has been sent.");
  }

  function exportLedger() {
    download("promise-ledger-evidence.json", JSON.stringify({ account: ACCOUNT, syntheticData: true, persistentAudit: false, analysis, reviews, events }, null, 2), "application/json");
    setNotice("Evidence package exported with sources, verdicts, and session reviews.");
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to commitments</a>
      <aside className="sidebar">
        <a href="#main-content" className="brand" aria-label="Promise Ledger home"><span className="brand-symbol"><Layers3 size={23} strokeWidth={1.8} /></span><span>promise<span className="brand-light">ledger</span><small>CUSTOMER TRUST, VERIFIED.</small></span></a>
        <div className="workspace"><span className="workspace-avatar">N</span><div>Northstar workspace<small>Synthetic demo account</small></div><LockKeyhole size={13} /></div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button className={view === "ledger" ? "nav-item active" : "nav-item"} onClick={() => navigate("ledger")}><BookOpen size={18} />Commitment ledger<span className="nav-count">{analysis.commitments.length}</span></button>
          <button className={view === "review" ? "nav-item active" : "nav-item"} onClick={() => navigate("review")}><FileCheck2 size={18} />Review queue{reviews.length > 0 && <span className="nav-count">{reviews.length}</span>}</button>
          <button className={view === "sources" ? "nav-item active" : "nav-item"} onClick={() => navigate("sources")}><Database size={18} />Evidence sources</button>
          <button className={view === "activity" ? "nav-item active" : "nav-item"} onClick={() => navigate("activity")}><Activity size={18} />Activity log</button>
        </nav>
        <div className="sidebar-note"><ShieldCheck size={22} /><h3>Trust is in the details.</h3><p>A closed ticket is not a kept promise. Verify the customer’s reality.</p><span>HUMAN APPROVAL, ALWAYS <ArrowUpRight size={13} /></span></div>
        <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={17} />Demo controls</button><div className="profile"><span className="profile-avatar">AB</span><div>Assaf Barnir<small>Builder workspace</small></div><LockKeyhole size={14} /></div></div>
      </aside>

      <div className="main-shell">
        <header className="topbar"><div><span className="breadcrumb">Workspace</span><ChevronRight size={13} /><strong>{view === "ledger" ? "Commitment ledger" : view === "review" ? "Review queue" : view === "sources" ? "Evidence sources" : "Activity log"}</strong></div><div className="topbar-right"><span className="demo-pill"><span />Synthetic demo</span><span className="avatar-mini">AB</span></div></header>
        <main id="main-content">
          <section className="page-heading"><div><div className="eyebrow"><span />THE CUSTOMER REALITY CHECK</div><h1>{view === "ledger" ? <>Promises made.<br className="mobile-break" /> <span>Truth checked.</span></> : view === "review" ? <>Thoughtful updates.<br className="mobile-break" /> <span>Human approved.</span></> : view === "sources" ? <>Every claim.<br className="mobile-break" /> <span>Back to its source.</span></> : <>A clear record.<br className="mobile-break" /> <span>No silent actions.</span></>}</h1><p>{view === "ledger" ? "Know what was promised, what shipped, and what your customer can actually use." : view === "review" ? "Review the evidence, edit the message, then decide. Nothing sends automatically." : view === "sources" ? `${analysis.sources.length} synthetic source documents. No real customer systems are connected.` : "Your current session only. Export it before leaving; refreshing clears this history."}</p></div><button className="button primary run-button" onClick={() => runAnalysis()} disabled={running}><Sparkles size={16} className={running ? "spinning" : ""} />{running ? "Checking evidence…" : "Run evidence check"}</button></section>

          <section className="demo-toolbar" aria-label="Analysis controls"><div><FlaskConical size={15} /><strong>Demo scenario</strong><select aria-label="Demo scenario" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)} disabled={running}><option value="blocked">Built, but not available</option><option value="enabled">Enabled + customer verified</option><option value="stale">Stale availability evidence</option><option value="crashing">Enabled, but crashing · recorded Sentry</option></select></div><button className="text-button" onClick={() => setSettingsOpen(!settingsOpen)}>{mode === "live" ? "Engine: live Nemotron · rate-limited" : "Reference mode · no AI call"}<Settings2 size={13} /></button></section>
          {settingsOpen && <section className="settings-panel" aria-label="Demo settings"><div><h3>Choose your evidence engine</h3><p>Live mode runs a multi-model NVIDIA Nemotron pipeline on Nebius: Nano triages sources, Super extracts commitments, deterministic rules decide, then Ultra explains and drafts. Reference mode replays the same steps with hand-labelled fixtures and template drafts, with no AI call.</p></div><label>Engine<select value={mode} onChange={(event) => setMode(event.target.value as "reference" | "live")} disabled={running}><option value="live" disabled={!liveSelectable}>Nebius + NVIDIA Nemotron{!liveConfigured ? " · not configured" : !liveSelectable ? " · paused" : ""}</option><option value="reference">Reference fixture · no external call</option></select></label>{mode === "live" && liveAccess?.ownerToken && <details className="owner-token"><summary>Owner access token (optional)</summary><label>Token for higher limits<input type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Leave empty for open live mode" /></label></details>}<p className="settings-footnote">{liveAccess?.open ? `Live runs are open to everyone, no token needed. To protect free credits they are limited to ${liveAccess.perIpPerHour} per hour per connection and ${liveAccess.perDay} per day overall; a full pipeline counts as one run. Only the synthetic source pack is sent to Nebius. Reference mode is always available.` : liveConfigured ? "Open live runs are paused by the project owner. Reference mode is always available." : "Live inference is not configured on this server. Reference mode is always available."}</p></section>}
          {scenario !== analysis.scenario && <div className="inline-notice"><CircleAlert size={15} />Scenario changed. Run the evidence check to refresh results.</div>}
          {error && <div className="error-message" role="alert"><CircleAlert size={17} /><span>{error} Previous results are retained.</span>{offerReference && <button className="error-action" onClick={runReferenceInstead} disabled={running}>Run reference check</button>}<button aria-label="Dismiss error" onClick={() => { setError(""); setOfferReference(false); }}><X size={15} /></button></div>}
          {notice && <div className="inline-notice" role="status"><Check size={15} /><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div>}
          {view === "ledger" && <AgentTrace trace={shownTrace} expanded={traceExpanded} onToggle={() => setTraceExpanded(!traceExpanded)} onOpenSource={openSource} />}

          <section className="metrics" aria-label="Ledger summary"><div className="metric"><span>Active commitments <BookOpen size={15} /></span><strong>{analysis.commitments.filter((commitment) => commitment.intent === "committed").length}<small>promises to keep</small></strong></div><div className="metric"><span>Need your attention <CircleAlert size={15} /></span><strong className="metric-warning">{attentionCount}<small>worth a closer look</small></strong></div><div className="metric"><span>Verified delivered <CheckCheck size={16} /></span><strong className="metric-success">{analysis.commitments.filter((commitment) => commitment.verdict === "verified").length}<small>backed by customer evidence</small></strong></div><div className="metric"><span>Evidence sources <Layers3 size={15} /></span><strong>{analysis.sources.length}<small>every claim has a trail</small></strong></div></section>

          {view === "ledger" && <section className={`insight-banner ${gap || crashing ? "gap" : "clear"}`}><div className="insight-icon">{gap || crashing ? <CircleAlert size={21} /> : <ShieldCheck size={21} />}</div><div><div className="insight-label">{gap || crashing ? "CAUGHT BEFORE THE CUSTOMER UPDATE" : "EVIDENCE OVER ASSUMPTIONS"}</div><h2>{gap ? "“Done” in engineering. Not delivered to Northstar." : crashing ? "Enabled for Northstar. Failing for Northstar." : scenario === "stale" ? "Old evidence cannot prove today’s availability." : "The status changed because the evidence changed."}</h2><p>{gap ? "Audit export passed CI, but the customer’s feature flag is off. Don’t send the delivery email just yet." : crashing?.runtime ? `${crashing.title} passed acceptance, but Sentry shows ${crashing.runtime.count} errors for Northstar since then. Hold the “it works” message.` : "Built, enabled, and customer-verified are separate checks. The ledger keeps that distinction visible."}</p></div>{(gap ?? crashing) && <button onClick={() => { setSelectedId((gap ?? crashing)!.id); setDetailTab("evidence"); document.getElementById("evidence-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}>Inspect the gap<ArrowRight size={16} /></button>}</section>}

          {(view === "ledger" || view === "review") && <section className="ledger-section"><div className="section-heading"><div><h2>{view === "review" ? "Customer updates" : "The commitment ledger"}<span>{view === "review" ? reviews.length : analysis.commitments.length}</span></h2><p>Northstar <span> / </span> Snapshot: September 13, 2026</p></div><button className="button secondary" onClick={exportLedger}><ArrowDownToLine size={14} />Export evidence</button></div><div className="ledger-workbench"><div className="ledger-list"><div className="table-toolbar"><div className="filter-tabs" aria-label="Filter commitments">{[{ value: "all", label: "All" }, { value: "attention", label: "Needs attention" }, { value: "verified", label: "Verified" }].map((option) => <button key={option.value} onClick={() => setFilter(option.value)} aria-pressed={filter === option.value}>{option.label}{option.value === "attention" && <span>{attentionCount}</span>}</button>)}</div><div className="search-box"><Search size={14} /><input aria-label="Search commitments" placeholder="Find a promise…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div><div className="table-columns"><span>COMMITMENT / OWNER</span><span>DUE</span><span>REALITY CHECK</span></div><div className="commitment-rows">{visibleCommitments.map((commitment) => <button key={commitment.id} className={`commitment-row ${selected?.id === commitment.id ? "selected" : ""}`} onClick={() => { setSelectedId(commitment.id); setDetailTab(view === "review" ? "draft" : "evidence"); }} aria-pressed={selected?.id === commitment.id}><span className="commitment-name"><span className={`row-icon ${verdicts[commitment.verdict].className}`}>{commitment.verdict === "verified" ? <CheckCheck size={16} /> : commitment.verdict === "blocked" ? <CircleAlert size={16} /> : <FileText size={16} />}</span><span><strong>{commitment.title}</strong><small>{commitment.id} <span>·</span> {commitment.owner ?? "No owner agreed"}</small></span></span><span className={`due-date ${commitment.verdict === "overdue" ? "late" : ""}`}>{shortDate(commitment.dueDate)}</span><span className="row-status"><Badge verdict={commitment.verdict} /><ChevronRight size={14} /></span></button>)}</div>{visibleCommitments.length === 0 && <div className="empty-state"><FileCheck2 size={28} /><h3>{view === "review" && reviews.length === 0 ? "Nothing waiting on you. Yet." : "No matching commitments"}</h3><p>{view === "review" && reviews.length === 0 ? "Open a commitment and prepare a customer update. It will appear here for your review." : "Try another filter or search term."}</p><button className="button secondary" onClick={() => { navigate("ledger"); }}>Open the ledger <ArrowRight size={14} /></button></div>}<div className="table-footnote"><ShieldCheck size={13} />“Delivered” requires customer-specific evidence. Always.</div></div>
            {selected && <aside className="evidence-panel" id="evidence-detail" aria-label={`Details for ${selected.title}`}><div className="detail-eyebrow"><span>{selected.id} <span> / </span> EVIDENCE BRIEF</span><span className="detail-dots"><MoreHorizontal size={17} /></span></div><h2>{selected.title}</h2><Badge verdict={selected.verdict} /><div className="detail-tabs"><button onClick={() => setDetailTab("evidence")} aria-pressed={detailTab === "evidence"}>Evidence trail</button><button onClick={() => activeReview ? setDetailTab("draft") : prepareDraft(selected)} aria-pressed={detailTab === "draft"}>Customer update{activeReview?.approved && <Check size={12} />}</button></div>
              {detailTab === "evidence" ? <><div className="verdict-block"><span>THE REALITY</span><p>{selected.reason}</p></div><div className="delivery-checks">{([{ name: "Built", value: selected.fact?.built }, { name: "Enabled", value: selected.fact?.enabled }, { name: "Verified", value: selected.fact?.verified }]).map((check) => <div key={check.name} className={check.value === true ? "check-pass" : check.value === false ? "check-fail" : "check-unknown"}><span>{check.value === true ? <Check size={13} /> : check.value === false ? <X size={13} /> : <span>?</span>}</span><small>{check.name}</small></div>)}</div>{selected.runtime && <RuntimeAlert finding={selected.runtime} sources={analysis.sources} />}{selected.verdict === "unknown" && <p className="evidence-warning">Signal values above are not proof: {selected.reason}</p>}{selected.narrative && <div className="narrative-block"><span>{selected.verdict === "verified" ? "WHY THE EVIDENCE AGREES" : ["blocked", "unknown", "overdue", "verify"].includes(selected.verdict) ? "WHY THE EVIDENCE DISAGREES" : "WHAT THE EVIDENCE SAYS"}</span><NarrativeOrigin narrative={selected.narrative} /><ClaimList claims={selected.narrative.explanation} onOpenSource={openSource} label="Why the evidence disagrees" /></div>}<div className="timeline">{[...selected.evidence, ...(selected.fact?.evidence ?? []), ...(selected.runtime?.evidence ?? [])].map((evidence, index) => { const source = analysis.sources.find((candidate) => candidate.id === evidence.sourceId); return source ? <div className="timeline-item" key={`${source.id}-${index}`}><span className={`timeline-icon ${source.kind.toLowerCase()}`}><SourceIcon source={source} /></span><div><div className="timeline-heading"><strong>{SOURCE_KIND_LABEL[source.kind]}</strong><span>{shortDate(source.observedAt.slice(0, 10))}</span></div><p className="source-title">{source.title}</p><blockquote>“{evidence.quote}”</blockquote><button className="source-link" onClick={() => { navigate("sources"); setSearch(source.id); }}>{source.id} · View source <ArrowUpRight size={11} /></button></div></div> : null; })}</div><div className="next-step"><span><ArrowRight size={14} />RECOMMENDED NEXT STEP</span><p>{selected.nextAction}</p></div>{selected.narrative && <OwnerNudge narrative={selected.narrative} owner={selected.owner} onOpenSource={openSource} />}{selected.intent !== "tentative" && <button className="button primary draft-button" onClick={() => prepareDraft(selected)}><FileText size={15} />Prepare customer update<ArrowRight size={15} /></button>}<p className="no-send"><LockKeyhole size={11} />For your review. Never sent automatically.</p></> : activeReview ? <div className="draft-editor"><div className="draft-status"><span className={`badge ${activeReview.approved ? "success" : "warning"}`}><span />{activeReview.approved ? "Approved locally" : "Needs human review"}</span></div>{selected.narrative && <NarrativeOrigin narrative={selected.narrative} />}<label htmlFor="customer-draft">Customer update · editable draft</label><textarea id="customer-draft" value={activeReview.text} onChange={(event) => setReviews((previous) => previous.map((review) => review.commitmentId === selected.id ? { ...review, text: event.target.value, approved: false } : review))} /><p>{selected.narrative?.origin === "model" ? "Model-written after the verdict was fixed. Your edits are not re-checked, so review them against the sources. Editing clears approval." : "Template-generated wording. Editing clears approval. No new dates are invented."}</p>{selected.narrative && <details className="draft-sources"><summary>Sources behind this draft</summary><ClaimList claims={selected.narrative.customerUpdate} onOpenSource={openSource} label="Customer update claims" /></details>}<button className="button primary draft-button" disabled={activeReview.approved || activeReview.text.trim().length < 20} onClick={() => { setReviews((previous) => previous.map((review) => review.commitmentId === selected.id ? { ...review, approved: true } : review)); record("Draft approved locally", `${selected.id} · Review applies only to this evidence run. Nothing sent.`); setNotice("Approved in this session. Export the draft when you are ready."); }}><CheckCheck size={15} />{activeReview.approved ? "Review complete · not sent" : "Approve this draft"}</button><button className="button secondary draft-button" disabled={!activeReview.approved} onClick={() => download(`${selected.id}-approved-update.md`, `${activeReview.text}\n\n---\nSynthetic demo · locally reviewed, not sent.\nEvidence run: ${activeReview.runId}\n`, "text/markdown")}><ArrowDownToLine size={14} />Export approved draft</button><p className="no-send"><LockKeyhole size={11} />No email or CRM sending capability exists.</p></div> : null}
            </aside>}
          </div></section>}

          {view === "sources" && <section className="sources-section"><div className="section-heading"><div><h2>Source library <span>{analysis.sources.length}</span></h2><p>Read the original. Check the interpretation.</p></div><div className="search-box"><Search size={14} /><input aria-label="Search evidence sources" placeholder="Search sources…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div><ProviderStatus providers={analysis.pipeline.providers} /><div className="source-grid">{analysis.sources.filter((source) => `${source.id} ${source.text} ${source.title}`.toLowerCase().includes(search.toLowerCase())).map((source) => <article className="source-card" key={source.id}><div className="source-card-top"><span className="source-type"><SourceIcon source={source} />{SOURCE_KIND_LABEL[source.kind]}</span><span>{source.id}</span></div><h3>{source.title}</h3><p className="source-meta">{source.author} · {shortDate(source.observedAt.slice(0, 10))}</p><pre>{source.text}</pre><SourceOrigin source={source} /><footer><LockKeyhole size={12} />Synthetic, account-scoped evidence</footer></article>)}</div></section>}
          {view === "activity" && <section className="activity-section"><div className="section-heading"><div><h2>Session activity <span>{events.length}</span></h2><p>Transparent actions, not a persistent compliance audit.</p></div><button className="button secondary" onClick={exportLedger}><ArrowDownToLine size={14} />Export session</button></div>{events.map((event) => <div className="audit-event" key={event.id}><span className="audit-icon"><Activity size={16} /></span><div><h3>{event.title}</h3><p>{event.detail}</p></div><span className="event-number">#{String(event.id + 1).padStart(2, "0")}</span></div>)}</section>}
          <footer className="page-footer"><span><ShieldCheck size={13} />Evidence first. Human judgment always.</span><span>{analysis.mode === "reference" ? "Deterministic reference demo" : `Live pipeline · extraction by ${analysis.model} · ${formatUsd(analysis.pipeline.costUsd)} estimated`} <span>·</span> {analysis.elapsedMs > 0 ? `${formatMs(analysis.elapsedMs)} · ` : ""}Session-only data</span></footer>
        </main>
      </div>
    </div>
  );
}
