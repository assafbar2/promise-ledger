"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Bug, Check, CheckCheck, ChevronRight, CircleAlert, ClipboardPaste, Compass, Database, FileCheck2, FileText, FlaskConical, GitBranch, Globe, HardDrive, Layers3, LayoutGrid, LockKeyhole, MessageSquare, MoreHorizontal, Search, Settings2, ShieldCheck, Sparkles, UserCheck, X } from "lucide-react";
import { AccountGallery, type SavedByoSummary } from "@/app/components/account-gallery";
import { AgentTrace, formatMs, formatUsd } from "@/app/components/agent-trace";
import { ByoPanel } from "@/app/components/byo-panel";
import { ProviderStatus, RuntimeAlert, SourceOrigin } from "@/app/components/evidence-sources";
import { GuidedTour, type TourStep } from "@/app/components/guided-tour";
import { PublicClaimCard, PublicClaimDraftWarning } from "@/app/components/public-claim";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { ClaimList, NarrativeOrigin, OwnerNudge } from "@/app/components/narrative";
import { accountPack, northstar, SAMPLE_ACCOUNTS, SCENARIO_LABEL } from "@/lib/accounts";
import { referenceAnalysis } from "@/lib/accounts/reference";
import { detectInjection } from "@/lib/byo/injection";
import { decideRequest, initialReview } from "@/lib/byo/review";
import { DEFAULT_WORKSPACE_NAME } from "@/lib/byo/sources";
import { readPipelineEvents } from "@/lib/pipeline/events";
import { modelInfo } from "@/lib/pipeline/models";
import { plannedSteps, type PlannedModels } from "@/lib/pipeline/steps";
import { idleTrace, replayDelayMs, traceReducer, type TraceState } from "@/lib/pipeline/trace-state";
import { draftUpdate } from "@/lib/reconcile";
import type { AnalyzedCommitment, Analysis, ByoProposal, Scenario, Source, SourceKind, Verdict } from "@/lib/schema";
import { VERDICTS as verdicts } from "@/lib/verdicts";
import { clearStore, exportPayload, loadStore, newByoWorkspace, removeWorkspace, sampleWorkspaceId, saveStore, TOUR_KEY, upsertWorkspace, type AuditEvent, type ByoDraft, type Review, type SavedWorkspace, type WorkspaceStore } from "@/lib/workspaces";
import "@/app/components/workspace.css";

type View = "ledger" | "review" | "sources" | "activity" | "accounts" | "byo";
type LiveAccess = { open: boolean; perIpPerHour: number; perDay: number; durableLimits: boolean; ownerToken: boolean; spendOk: boolean; models: PlannedModels };

function parseLiveAccess(status: unknown): LiveAccess | null {
  if (typeof status !== "object" || status === null || !("liveConfigured" in status) || status.liveConfigured !== true || !("liveAccess" in status)) return null;
  const access = status.liveAccess;
  if (typeof access !== "object" || access === null) return null;
  const value = access as Record<string, unknown>;
  const pipeline = "pipeline" in status && typeof status.pipeline === "object" && status.pipeline !== null ? status.pipeline as Record<string, unknown> : {};
  const modelId = (entry: unknown) => typeof entry === "object" && entry !== null && "id" in entry && typeof entry.id === "string" ? entry.id : null;
  const extraction = modelId(pipeline.extraction) ?? ("model" in status && typeof status.model === "string" ? status.model : null);
  const spendOk = "spend" in status && typeof status.spend === "object" && status.spend !== null && (status.spend as Record<string, unknown>).available === true;
  return { open: value.open === true, perIpPerHour: typeof value.perIpPerHour === "number" ? value.perIpPerHour : 0, perDay: typeof value.perDay === "number" ? value.perDay : 0, durableLimits: value.durableLimits === true, ownerToken: value.ownerToken === true, spendOk, models: { triage: modelId(pipeline.triage), extraction, narrative: modelId(pipeline.narrative) } };
}

const SOURCE_KIND_LABEL: Record<SourceKind, string> = { Meeting: "Meeting", Support: "Support", Engineering: "Engineering", Availability: "Availability", PublicClaim: "Public claim", Runtime: "Runtime errors", UserSupplied: "User supplied" };
const VIEW_LABEL: Record<View, string> = { ledger: "Commitment ledger", review: "Review queue", sources: "Evidence sources", activity: "Activity log", accounts: "Accounts", byo: "Bring your own evidence" };
const ATTENTION = ["blocked", "overdue", "verify", "unknown"];
const NORTHSTAR_WORKSPACE = sampleWorkspaceId(northstar.id);

function openedEvent(name: string, kind: "sample" | "byo"): AuditEvent {
  return kind === "sample"
    ? { id: 0, title: "Reference workspace opened", detail: `${name}: synthetic fixture loaded. No model call or customer communication.` }
    : { id: 0, title: "Bring-your-own workspace opened", detail: `${name}: evidence you add stays in this browser until you run a check. Nothing is sent to a customer.` };
}

function emptyByoAnalysis(name: string): Analysis {
  return { mode: "reference", model: null, runId: "byo-empty", asOf: new Date().toISOString(), scenario: "blocked", account: { id: "byo", name, kind: "byo" }, commitments: [], sources: [], elapsedMs: 0, usage: null, pipeline: { replay: true, steps: plannedSteps("reference", null), checks: [], providers: [], budgetUsd: null, reservedUsd: null, costUsd: null } };
}

function focusCommitment(analysis: Analysis) {
  const headline = analysis.account.kind === "sample" ? accountPack(analysis.account.id)?.headlineFeatureId : null;
  return analysis.commitments.find((commitment) => commitment.featureId === headline)?.id ?? analysis.commitments.find((commitment) => ATTENTION.includes(commitment.verdict))?.id ?? analysis.commitments[0]?.id ?? "";
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

function longDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
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

type StreamOutcome = { analysis: Analysis | null; proposal: ByoProposal | null };

export default function Home() {
  const [analysis, setAnalysis] = useState<Analysis>(() => referenceAnalysis(northstar));
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
  const liveSelectable = liveConfigured && liveAccess.spendOk && (liveAccess.open || liveAccess.ownerToken);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [trace, setTrace] = useState<TraceState | null>(null);
  const [traceExpanded, setTraceExpanded] = useState(true);
  const shownTrace = trace ?? idleTrace(mode, plannedSteps(mode, liveAccess?.models ?? null));
  const [detailTab, setDetailTab] = useState<"evidence" | "draft">("evidence");
  const [events, setEvents] = useState<AuditEvent[]>([openedEvent(northstar.name, "sample")]);
  const [workspaceId, setWorkspaceId] = useState(NORTHSTAR_WORKSPACE);
  const [byoDraft, setByoDraft] = useState<ByoDraft | null>(null);
  const [store, setStore] = useState<WorkspaceStore>({ version: 1, activeId: NORTHSTAR_WORKSPACE, workspaces: [] });
  const [persistence, setPersistence] = useState<"loading" | "on" | "unavailable">("loading");
  const [tourOpen, setTourOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const loaded = useRef(false);

  const pack = workspaceId.startsWith("sample:") ? accountPack(workspaceId.slice(7)) : null;
  const byoActive = workspaceId.startsWith("byo:");
  const accountName = analysis.account.name;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { signal: controller.signal }).then((response) => response.json()).then((status) => {
      const access = parseLiveAccess(status);
      setLiveAccess(access);
      if (access?.open && access.spendOk) setMode("live");
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  function hydrate(workspace: SavedWorkspace | null, id: string) {
    const samplePack = id.startsWith("sample:") ? accountPack(id.slice(7)) : null;
    const name = workspace?.name ?? samplePack?.name ?? DEFAULT_WORKSPACE_NAME;
    const next = workspace?.analysis ?? (samplePack ? referenceAnalysis(samplePack) : emptyByoAnalysis(name));
    setWorkspaceId(id);
    setAnalysis(next);
    setReviews(workspace?.reviews ?? []);
    setEvents(workspace?.events.length ? workspace.events : [openedEvent(name, samplePack ? "sample" : "byo")]);
    setScenario(workspace?.scenario ?? samplePack?.defaultScenario ?? "blocked");
    setByoDraft(samplePack ? null : workspace?.byo ?? { workspace: name === DEFAULT_WORKSPACE_NAME ? "" : name, sources: [], proposal: null, review: null });
    setSelectedId(focusCommitment(next));
    setTrace(null);
    setError("");
    setOfferReference(false);
    setDetailTab("evidence");
    setFilter("all");
    setSearch("");
  }

  useEffect(() => {
    // Deferred so the server-rendered reference view hydrates first; storage is read once.
    let tourTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      let available = false;
      try { const probe = "promise-ledger:probe"; localStorage.setItem(probe, "1"); localStorage.removeItem(probe); available = true; } catch { available = false; }
      if (!available) { setPersistence("unavailable"); return; }
      const saved = loadStore(localStorage);
      const requested = new URLSearchParams(window.location.search).get("account");
      const linked = requested && accountPack(requested) ? sampleWorkspaceId(requested) : null;
      if (saved) setStore(saved);
      const activeId = linked ?? saved?.activeId;
      const active = saved?.workspaces.find((workspace) => workspace.id === activeId) ?? null;
      if (active) hydrate(active, active.id);
      else if (linked) hydrate(null, linked);
      if (requested) window.history.replaceState(null, "", window.location.pathname);
      loaded.current = true;
      setPersistence("on");
      let tourDone = false;
      try { tourDone = localStorage.getItem(TOUR_KEY) === "1"; } catch { tourDone = true; }
      if (!tourDone) tourTimer = setTimeout(() => setTourOpen(true), 600);
    }, 0);
    return () => { clearTimeout(timer); clearTimeout(tourTimer); };
  }, []);

  const currentWorkspace = useCallback((): SavedWorkspace => ({
    id: workspaceId,
    kind: byoActive ? "byo" : "sample",
    accountId: byoActive ? "byo" : pack?.id ?? northstar.id,
    name: byoActive ? (byoDraft?.workspace.trim() || DEFAULT_WORKSPACE_NAME) : pack?.name ?? northstar.name,
    scenario,
    analysis,
    reviews,
    events,
    byo: byoActive ? byoDraft : null,
    updatedAt: new Date().toISOString(),
  }), [analysis, byoActive, byoDraft, events, pack, reviews, scenario, workspaceId]);

  useEffect(() => {
    if (!loaded.current) return;
    setStore((previous) => ({ ...upsertWorkspace(previous, currentWorkspace()), activeId: workspaceId }));
  }, [currentWorkspace, workspaceId]);

  useEffect(() => {
    if (persistence !== "on" || !loaded.current) return;
    const timer = setTimeout(() => { if (!saveStore(localStorage, store)) setNotice("This browser refused to save the workspace (storage full?). Export it to keep a copy."); }, 400);
    return () => clearTimeout(timer);
  }, [persistence, store]);

  useEffect(() => {
    if (!byoDraft?.proposal?.continuation) return;
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [byoDraft?.proposal?.continuation]);

  const selected = analysis.commitments.find((commitment) => commitment.id === selectedId) ?? analysis.commitments[0];
  const activeReview = reviews.find((review) => review.commitmentId === selected?.id);
  const attentionCount = analysis.commitments.filter((commitment) => ATTENTION.includes(commitment.verdict)).length;
  const gap = analysis.commitments.find((commitment) => commitment.verdict === "blocked");
  const crashing = analysis.commitments.find((commitment) => commitment.runtime);
  const visibleCommitments = useMemo(() => analysis.commitments.filter((commitment) => {
    const matchesView = view !== "review" || reviews.some((review) => review.commitmentId === commitment.id);
    const matchesFilter = filter === "all" || (filter === "attention" ? ATTENTION.includes(commitment.verdict) : commitment.verdict === filter);
    return matchesView && matchesFilter && `${commitment.title} ${commitment.owner ?? ""}`.toLowerCase().includes(search.toLowerCase());
  }), [analysis.commitments, filter, reviews, search, view]);
  const savedByo: SavedByoSummary[] = store.workspaces.filter((workspace) => workspace.kind === "byo").map((workspace) => {
    const live = workspace.id === workspaceId ? currentWorkspace() : workspace;
    return { id: live.id, name: live.name, sources: live.byo?.sources.length ?? 0, stage: (live.analysis && live.analysis.commitments.length > 0 ? "decided" : live.byo?.proposal ? "confirm" : "draft") as SavedByoSummary["stage"], updatedAt: live.updatedAt };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const continuationValid = Boolean(mode === "live" && liveSelectable && byoDraft?.proposal?.continuation && Date.parse(byoDraft.proposal.continuation.expiresAt) > clock);

  function record(title: string, detail: string) {
    setEvents((previous) => [{ id: previous.length, title, detail }, ...previous]);
  }

  function navigate(next: View) {
    setView(next);
    setFilter("all");
    setSearch("");
  }

  function openWorkspace(id: string) {
    if (id !== workspaceId) {
      const saved = store.workspaces.find((workspace) => workspace.id === id) ?? null;
      hydrate(saved, id);
      setNotice("");
    }
  }

  function openSample(accountId: string) {
    openWorkspace(sampleWorkspaceId(accountId));
    navigate("ledger");
  }

  function newByo() {
    const workspace = newByoWorkspace("");
    setStore((previous) => upsertWorkspace(previous, workspace));
    hydrate(workspace, workspace.id);
    navigate("byo");
  }

  function deleteByo(id: string) {
    if (!window.confirm("Delete this workspace and its evidence from this browser?")) return;
    setStore((previous) => removeWorkspace(previous, id, NORTHSTAR_WORKSPACE));
    if (id === workspaceId) hydrate(store.workspaces.find((workspace) => workspace.id === NORTHSTAR_WORKSPACE) ?? null, NORTHSTAR_WORKSPACE);
  }

  function clearAll() {
    if (!window.confirm("Clear every saved workspace, review and pasted source from this browser? Export first if you want a copy.")) return;
    clearStore(localStorage);
    const fresh: WorkspaceStore = { version: 1, activeId: NORTHSTAR_WORKSPACE, workspaces: [] };
    setStore(fresh);
    hydrate(null, NORTHSTAR_WORKSPACE);
    navigate("accounts");
    setNotice("All local data cleared from this browser.");
  }

  function exportAll() {
    download("promise-ledger-workspaces.json", exportPayload(upsertWorkspace(store, currentWorkspace())), "application/json");
    setNotice("All workspaces exported. The file stays on your device.");
  }

  function closeTour() {
    setTourOpen(false);
    try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* storage unavailable */ }
  }

  async function streamPipeline(body: Record<string, unknown>, runMode: "reference" | "live"): Promise<StreamOutcome> {
    const token = accessToken.trim();
    const response = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(runMode === "live" && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ mode: runMode, ...body }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok || !response.body) {
      const result: unknown = await response.json().catch(() => null);
      const details = typeof result === "object" && result !== null ? result as Record<string, unknown> : {};
      setOfferReference(runMode === "live" && (details.fallback === "reference" || response.status === 429));
      if (typeof details.code === "string" && details.code.startsWith("live_spend_")) {
        setLiveAccess((previous) => previous && { ...previous, spendOk: false });
        setMode("reference");
      }
      throw new Error(typeof details.error === "string" ? details.error : response.status === 429 ? "Too many requests from your connection right now. Wait a minute and try again." : "The evidence check failed.");
    }
    setTraceExpanded(true);
    const outcome: StreamOutcome = { analysis: null, proposal: null };
    let streamError: { error: string; fallback?: string } | null = null;
    for await (const event of readPipelineEvents(response.body)) {
      if (runMode === "reference") await sleep(replayDelayMs(event));
      setTrace((previous) => traceReducer(previous ?? idleTrace(runMode, []), event));
      if (event.type === "result") outcome.analysis = event.analysis;
      if (event.type === "proposal") outcome.proposal = event.proposal;
      if (event.type === "error") streamError = event;
    }
    if (streamError) {
      setOfferReference(runMode === "live" && streamError.fallback === "reference");
      throw new Error(streamError.error);
    }
    return outcome;
  }

  function applyAnalysis(completed: Analysis, label: string) {
    setAnalysis(completed);
    setSelectedId(focusCommitment(completed));
    setReviews([]);
    setDetailTab("evidence");
    const fallbacks = completed.pipeline.steps.filter((step) => step.status === "fallback" || step.status === "skipped").map((step) => step.label);
    const unavailable = completed.pipeline.providers.filter((provider) => provider.status === "failed").map((provider) => provider.error ?? `${provider.label} unavailable.`);
    setNotice(`${completed.mode === "live" ? "Agent pipeline" : "Reference replay"} complete${fallbacks.length ? `, with a labelled fallback in ${fallbacks.join(" and ")}` : ""}. ${unavailable.length ? `${unavailable.join(" ")} Verdicts use the remaining evidence. ` : ""}Previous draft approvals have been cleared.`);
    record("Evidence reconciled", `${completed.account.name} · ${completed.commitments.length} records · ${completed.pipeline.steps.map((step) => `${step.label}: ${step.status}`).join(", ")} · ${completed.mode === "live" ? `${formatUsd(completed.pipeline.costUsd)} estimated` : "no model call"} · ${label}`);
  }

  async function run(work: () => Promise<void>, failureDetail: string) {
    setRunning(true);
    setError("");
    setOfferReference(false);
    setNotice("");
    try { await work(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The evidence check could not finish.");
      record("Evidence check failed", failureDetail);
    } finally { setRunning(false); }
  }

  async function runAnalysis(runMode: "reference" | "live" = mode) {
    if (byoActive) { navigate("byo"); return; }
    await run(async () => {
      const { analysis: next } = await streamPipeline({ scenario, account: pack?.id ?? northstar.id }, runMode);
      if (!next) throw new Error("The evidence check ended before returning results.");
      applyAnalysis(next, scenario);
    }, "The previous results remain visible. No fallback or delivery action was taken.");
  }

  async function extractByo() {
    if (!byoDraft) return;
    const runMode = mode;
    await run(async () => {
      const { proposal } = await streamPipeline({ byo: { phase: "extract", workspace: byoDraft.workspace, sources: byoDraft.sources } }, runMode);
      if (!proposal) throw new Error("The extraction ended before returning proposed facts.");
      setByoDraft({ ...byoDraft, workspace: proposal.account.name === DEFAULT_WORKSPACE_NAME ? byoDraft.workspace : proposal.account.name, proposal, review: initialReview(proposal) });
      setNotice(`${proposal.commitments.length} commitments and ${proposal.facts.length} availability facts proposed${runMode === "live" ? ", using one live run" : " by the pattern matcher"}. Confirm or correct each fact; the rules decide only after that.`);
      record("Evidence extracted", `${proposal.account.name} · ${proposal.sources.length} sources · ${proposal.extractor === "nemotron" ? `${proposal.model ?? "Nemotron"} · ${formatUsd(proposal.pipeline.costUsd)} estimated` : "pattern matcher, no AI"} · nothing decided yet`);
    }, "Nothing was extracted. Your sources are unchanged.");
  }

  async function decideByo(useLive: boolean) {
    if (!byoDraft?.proposal) return;
    const proposal = byoDraft.proposal;
    const review = byoDraft.review ?? initialReview(proposal);
    const byo = decideRequest(byoDraft.workspace, byoDraft.sources, proposal, review);
    const runMode = useLive ? "live" : "reference";
    await run(async () => {
      if (useLive) setByoDraft({ ...byoDraft, proposal: { ...proposal, continuation: null } });
      const { analysis: next } = await streamPipeline({ byo, ...(useLive && proposal.continuation ? { continuation: proposal.continuation.token } : {}) }, runMode);
      if (!next) throw new Error("The rules ended before returning verdicts.");
      applyAnalysis(next, `${byo.facts.length} confirmed facts`);
      navigate("ledger");
    }, "No verdicts were recorded. Your confirmations are kept; you can re-run the rules without AI.");
  }

  function runReferenceInstead() {
    setMode("reference");
    if (byoActive && byoDraft?.proposal) void decideByo(false);
    else if (byoActive) navigate("byo");
    else void runAnalysis("reference");
  }

  function openSource(sourceId: string) {
    navigate("sources");
    setSearch(sourceId);
  }

  function prepareDraft(commitment: AnalyzedCommitment) {
    setSelectedId(commitment.id);
    if (!reviews.some((review) => review.commitmentId === commitment.id)) {
      setReviews((previous) => [...previous, { commitmentId: commitment.id, text: commitment.narrative?.draftText ?? draftUpdate(commitment, accountName), approved: false, runId: analysis.runId }]);
      record("Customer update drafted", `${commitment.id} · ${commitment.narrative?.origin === "model" ? `Written by ${commitment.narrative.model ? modelInfo(commitment.narrative.model).name : "Nemotron"}, guardrail-checked` : "Template-based wording"}, grounded in the current verdict. Not sent.`);
    }
    setDetailTab("draft");
    setNotice("Draft ready for your review. Nothing has been sent.");
  }

  function exportLedger() {
    download(`promise-ledger-${analysis.account.id}-evidence.json`, JSON.stringify({ account: analysis.account, syntheticData: analysis.account.kind === "sample", storage: persistence === "on" ? "this browser (localStorage)" : "session memory", analysis, reviews, events }, null, 2), "application/json");
    setNotice("Evidence package exported with sources, verdicts, and reviews.");
  }

  const tourSteps: TourStep[] = [
    { target: "accounts", title: "Four fictional customers", body: "Each sample account has its own synthetic evidence pack and story. Switch here in one click; every workspace is remembered in this browser." },
    { target: "run", title: "Run the evidence check", body: "Nemotron Nano triages the sources, Super extracts promises with exact quotes, then Ultra explains. Reference mode replays the same steps with no AI call.", before: () => navigate("ledger") },
    { target: "ledger", title: "Rules decide, not the model", body: "Built, enabled and customer-verified are separate checks. Open any promise to see its exact quotes and a draft that is never sent automatically." },
    { target: "byo-nav", title: "Bring your own evidence", body: "Paste notes, tickets or telemetry lines, or drop .txt, .md, .csv and .eml files. You confirm every extracted fact before the rules read it." },
    { target: "storage", title: "Yours, and only here", body: "Workspaces are saved in this browser's local storage. Export or clear them any time from Accounts. Nothing is sent to a customer." },
  ];

  const heading: Record<View, [string, string, string]> = {
    ledger: ["Promises made.", "Truth checked.", "Know what was promised, what shipped, and what your customer can actually use."],
    review: ["Thoughtful updates.", "Human approved.", "Review the evidence, edit the message, then decide. Nothing sends automatically."],
    sources: ["Every claim.", "Back to its source.", byoActive ? `${analysis.sources.length} sources you supplied, treated as untrusted text. Links in them are never opened.` : `${analysis.sources.length} synthetic source documents. No real customer systems are connected.`],
    activity: ["A clear record.", "No silent actions.", persistence === "on" ? "Saved with this workspace in your browser. Export it or clear it from Accounts." : "Your current session only. Export it before leaving; refreshing clears this history."],
    accounts: ["Four customers.", "One reality check.", "Pick a fictional sample account, each with its own synthetic evidence pack, or bring your own evidence."],
    byo: ["Your evidence.", "Same rules.", "Nemotron proposes commitments and availability facts with exact quotes. You confirm them. Deterministic rules decide."],
  };
  const [titleA, titleB, subtitle] = heading[view];
  const workspaceLabel = byoActive ? (byoDraft?.workspace.trim() || DEFAULT_WORKSPACE_NAME) : pack?.name ?? northstar.name;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to commitments</a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Promise Ledger home"><span className="brand-symbol"><Layers3 size={23} strokeWidth={1.8} /></span><span>promise<span className="brand-light">ledger</span><small>CUSTOMER TRUST, VERIFIED.</small></span></Link>
        <button className="workspace" onClick={() => navigate("accounts")} data-tour="accounts" aria-label={`Current workspace: ${workspaceLabel}. Switch account`}><span className="workspace-avatar">{byoActive ? <ClipboardPaste size={14} /> : pack?.initials ?? "N"}</span><div>{workspaceLabel}<small>{byoActive ? "Your evidence · untrusted text" : "Synthetic demo account"}</small></div><LayoutGrid size={13} /></button>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button className={view === "accounts" ? "nav-item active" : "nav-item"} aria-current={view === "accounts" ? "page" : undefined} onClick={() => navigate("accounts")}><LayoutGrid size={18} />Accounts<span className="nav-count">{SAMPLE_ACCOUNTS.length + savedByo.length}</span></button>
          <button className={view === "ledger" ? "nav-item active" : "nav-item"} aria-current={view === "ledger" ? "page" : undefined} onClick={() => navigate("ledger")}><BookOpen size={18} />Commitment ledger<span className="nav-count">{analysis.commitments.length}</span></button>
          <button className={view === "review" ? "nav-item active" : "nav-item"} aria-current={view === "review" ? "page" : undefined} onClick={() => navigate("review")}><FileCheck2 size={18} />Review queue{reviews.length > 0 && <span className="nav-count">{reviews.length}</span>}</button>
          <button className={view === "sources" ? "nav-item active" : "nav-item"} aria-current={view === "sources" ? "page" : undefined} onClick={() => navigate("sources")}><Database size={18} />Evidence sources</button>
          <button className={view === "byo" ? "nav-item active" : "nav-item"} aria-current={view === "byo" ? "page" : undefined} onClick={() => { if (!byoActive) { const latest = savedByo[0]; if (latest) openWorkspace(latest.id); else { newByo(); return; } } navigate("byo"); }} data-tour="byo-nav"><ClipboardPaste size={18} />Bring your own</button>
          <button className={view === "activity" ? "nav-item active" : "nav-item"} aria-current={view === "activity" ? "page" : undefined} onClick={() => navigate("activity")}><Activity size={18} />Activity log</button>
        </nav>
        <div className="sidebar-note"><ShieldCheck size={22} /><h3>Trust is in the details.</h3><p>A closed ticket is not a kept promise. Verify the customer’s reality.</p><span>HUMAN APPROVAL, ALWAYS <ArrowUpRight size={13} /></span></div>
        <div className="sidebar-bottom"><div className="storage-note" data-tour="storage"><HardDrive size={13} /><span>{persistence === "on" ? "Saved in this browser only" : persistence === "loading" ? "Checking browser storage…" : "Not saved: storage blocked"}</span></div><button className="nav-item" onClick={() => setTourOpen(true)}><Compass size={17} />Take the tour</button><button className="nav-item" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={17} />Demo controls</button><div className="profile"><span className="profile-avatar">AB</span><div>Assaf Barnir<small>Builder workspace</small></div><LockKeyhole size={14} /></div></div>
      </aside>

      <div className="main-shell">
        <header className="topbar"><div><span className="breadcrumb">{workspaceLabel}</span><ChevronRight size={13} /><strong>{VIEW_LABEL[view]}</strong></div><div className="topbar-right"><ThemeToggle /><span className="demo-pill"><span />{byoActive ? "Your evidence" : "Synthetic demo"}</span><span className="avatar-mini">AB</span></div></header>
        <main id="main-content">
          <section className="page-heading"><div><div className="eyebrow"><span />THE CUSTOMER REALITY CHECK</div><h1>{titleA}<br className="mobile-break" /> <span>{titleB}</span></h1><p>{subtitle}</p></div>{view !== "byo" && <button className="button primary run-button" onClick={() => runAnalysis()} disabled={running} data-tour="run">{byoActive ? <ClipboardPaste size={16} /> : <Sparkles size={16} className={running ? "spinning" : ""} />}{running ? "Checking evidence…" : byoActive ? "Review your evidence" : "Run evidence check"}</button>}</section>

          {view !== "accounts" && <section className="demo-toolbar" aria-label="Analysis controls">{pack ? <div><FlaskConical size={15} /><strong>Demo scenario</strong><select aria-label="Demo scenario" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)} disabled={running}>{pack.scenarios.map((option) => <option key={option} value={option}>{SCENARIO_LABEL[option]}</option>)}</select></div> : <div><ClipboardPaste size={15} /><strong>Your evidence</strong><span className="toolbar-note">{byoDraft?.sources.length ?? 0} sources · checked against today’s date · never sent to a customer</span></div>}<button className="text-button" onClick={() => setSettingsOpen(!settingsOpen)}>{mode === "live" ? "Engine: live Nemotron · rate-limited" : "Reference mode · no AI call"}<Settings2 size={13} /></button></section>}
          {settingsOpen && <section className="settings-panel" aria-label="Demo settings"><div><h3>Choose your evidence engine</h3><p>Live mode runs a multi-model NVIDIA Nemotron pipeline on Nebius: Nano triages sources, Super extracts commitments, deterministic rules decide, then Ultra explains and drafts. Reference mode replays the same steps with hand-labelled fixtures and template drafts, with no AI call.</p></div><label>Engine<select value={mode} onChange={(event) => setMode(event.target.value as "reference" | "live")} disabled={running}><option value="live" disabled={!liveSelectable}>Nebius + NVIDIA Nemotron{!liveConfigured ? " · not configured" : !liveSelectable ? " · paused" : ""}</option><option value="reference">Reference fixture · no external call</option></select></label>{mode === "live" && liveAccess?.ownerToken && <details className="owner-token"><summary>Owner access token (optional)</summary><label>Token for higher limits<input type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Leave empty for open live mode" /></label></details>}<p className="settings-footnote">{liveAccess && !liveAccess.spendOk ? "Live runs are off: this demo has used its free-credit allowance, or its total AI spend can't be verified right now. The reference replay runs the same evidence checks with no AI call." : liveAccess?.open ? `Live runs are open to everyone, no token needed. To protect free credits they are limited to ${liveAccess.perIpPerHour} per hour per connection and ${liveAccess.perDay} per day overall; a full pipeline, including a bring-your-own extraction and its confirmation, counts as one run. Only the selected sample pack, or the evidence you add, is sent to Nebius. Reference mode is always available.` : liveConfigured ? "Open live runs are paused by the project owner. Reference mode is always available." : "Live inference is not configured on this server. Reference mode is always available."}</p></section>}
          {pack && view !== "accounts" && scenario !== analysis.scenario && <div className="inline-notice"><CircleAlert size={15} />Scenario changed. Run the evidence check to refresh results.</div>}
          {error && <div className="error-message" role="alert"><CircleAlert size={17} /><span>{error} Previous results are retained.</span>{offerReference && <button className="error-action" onClick={runReferenceInstead} disabled={running}>{byoActive && byoDraft?.proposal ? "Re-run the rules without AI" : "Run reference check"}</button>}<button aria-label="Dismiss error" onClick={() => { setError(""); setOfferReference(false); }}><X size={15} /></button></div>}
          {notice && <div className="inline-notice" role="status"><Check size={15} /><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div>}

          {view === "accounts" && <AccountGallery accounts={SAMPLE_ACCOUNTS} activeId={workspaceId} saved={savedByo} persistence={persistence} onOpenSample={openSample} onNewByo={newByo} onOpenByo={(id) => { openWorkspace(id); navigate("byo"); }} onDeleteByo={deleteByo} onExportAll={exportAll} onClearAll={clearAll} />}

          {view === "byo" && byoDraft && <>
            {(trace || running) && <AgentTrace trace={shownTrace} expanded={traceExpanded} onToggle={() => setTraceExpanded(!traceExpanded)} onOpenSource={openSource} />}
            <ByoPanel draft={byoDraft} onChange={setByoDraft} live={mode === "live" && liveSelectable} liveNote="Nemotron 3 Nano triages, then Nemotron 3 Super proposes commitments and availability facts, each with an exact quote. Extraction plus the later explain step count as one live run." running={running} continuationValid={continuationValid} decided={analysis.account.kind === "byo" && analysis.commitments.length > 0} onExtract={() => void extractByo()} onDecide={(useLive) => void decideByo(useLive)} onViewLedger={() => navigate("ledger")} onOpenSource={openSource} />
          </>}

          {view === "ledger" && <AgentTrace trace={shownTrace} expanded={traceExpanded} onToggle={() => setTraceExpanded(!traceExpanded)} onOpenSource={openSource} />}

          {(view === "ledger" || view === "review" || view === "sources" || view === "activity") && <section className="metrics" aria-label="Ledger summary"><div className="metric"><span>Active commitments <BookOpen size={15} /></span><strong>{analysis.commitments.filter((commitment) => commitment.intent === "committed").length}<small>promises to keep</small></strong></div><div className="metric"><span>Need your attention <CircleAlert size={15} /></span><strong className="metric-warning">{attentionCount}<small>worth a closer look</small></strong></div><div className="metric"><span>Verified delivered <CheckCheck size={16} /></span><strong className="metric-success">{analysis.commitments.filter((commitment) => commitment.verdict === "verified").length}<small>backed by customer evidence</small></strong></div><div className="metric"><span>Evidence sources <Layers3 size={15} /></span><strong>{analysis.sources.length}<small>every claim has a trail</small></strong></div></section>}

          {view === "ledger" && analysis.commitments.length > 0 && <section className={`insight-banner ${gap || crashing ? "gap" : "clear"}`}><div className="insight-icon">{gap || crashing ? <CircleAlert size={21} /> : <ShieldCheck size={21} />}</div><div><div className="insight-label">{gap || crashing ? "CAUGHT BEFORE THE CUSTOMER UPDATE" : "EVIDENCE OVER ASSUMPTIONS"}</div><h2>{gap ? `“Done” in engineering. Not delivered to ${accountName}.` : crashing ? `Enabled for ${accountName}. Failing for ${accountName}.` : analysis.commitments.some((commitment) => commitment.verdict === "unknown") && analysis.scenario === "stale" ? "Old evidence cannot prove today’s availability." : "The status changed because the evidence changed."}</h2><p>{gap ? `${gap.title} is built, but ${accountName}’s access is still switched off. Don’t send the delivery email just yet.` : crashing?.runtime ? `${crashing.title} passed acceptance, but error monitoring shows ${crashing.runtime.count} errors for ${accountName} since then. Hold the “it works” message.` : "Built, enabled, and customer-verified are separate checks. The ledger keeps that distinction visible."}</p></div>{(gap ?? crashing) && <button onClick={() => { setSelectedId((gap ?? crashing)!.id); setDetailTab("evidence"); document.getElementById("evidence-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}>Inspect the gap<ArrowRight size={16} /></button>}</section>}

          {(view === "ledger" || view === "review") && <section className="ledger-section" data-tour="ledger" aria-busy={running}><div className="section-heading"><div><h2>{view === "review" ? "Customer updates" : "The commitment ledger"}<span>{view === "review" ? reviews.length : analysis.commitments.length}</span></h2><p>{accountName} <span> / </span> {analysis.account.kind === "byo" ? `Checked against ${longDate(analysis.asOf)}` : `Snapshot: ${longDate(analysis.asOf)}`}</p></div><button className="button secondary" onClick={exportLedger}><ArrowDownToLine size={14} />Export evidence</button></div><div className="ledger-workbench"><div className="ledger-list"><div className="table-toolbar"><div className="filter-tabs" role="group" aria-label="Filter commitments">{[{ value: "all", label: "All" }, { value: "attention", label: "Needs attention" }, { value: "verified", label: "Verified" }].map((option) => <button key={option.value} onClick={() => setFilter(option.value)} aria-pressed={filter === option.value}>{option.label}{option.value === "attention" && <span>{attentionCount}</span>}</button>)}</div><div className="search-box"><Search size={14} /><input aria-label="Search commitments" placeholder="Find a promise…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div><div className="table-columns"><span>COMMITMENT / OWNER</span><span>DUE</span><span>REALITY CHECK</span></div><div className="commitment-rows">{visibleCommitments.map((commitment) => <button key={commitment.id} className={`commitment-row ${selected?.id === commitment.id ? "selected" : ""}`} onClick={() => { setSelectedId(commitment.id); setDetailTab(view === "review" ? "draft" : "evidence"); }} aria-pressed={selected?.id === commitment.id}><span className="commitment-name"><span className={`row-icon ${verdicts[commitment.verdict].className}`}>{commitment.verdict === "verified" ? <CheckCheck size={16} /> : commitment.verdict === "blocked" ? <CircleAlert size={16} /> : <FileText size={16} />}</span><span><strong>{commitment.title}</strong><small>{commitment.id} <span>·</span> {commitment.owner ?? "No owner agreed"}</small></span></span><span className={`due-date ${commitment.verdict === "overdue" ? "late" : ""}`}>{shortDate(commitment.dueDate)}</span><span className="row-status"><Badge verdict={commitment.verdict} /><ChevronRight size={14} /></span></button>)}</div>{visibleCommitments.length === 0 && <div className="empty-state"><FileCheck2 size={28} /><h3>{view === "review" && reviews.length === 0 ? "Nothing waiting on you. Yet." : analysis.commitments.length === 0 && byoActive ? "No verdicts yet" : "No matching commitments"}</h3><p>{view === "review" && reviews.length === 0 ? "Open a commitment and prepare a customer update. It will appear here for your review." : analysis.commitments.length === 0 && byoActive ? "Add your evidence, confirm the extracted facts, and the rules will fill this ledger." : "Try another filter or search term."}</p><button className="button secondary" onClick={() => { navigate(analysis.commitments.length === 0 && byoActive ? "byo" : "ledger"); }}>{analysis.commitments.length === 0 && byoActive ? "Add evidence" : "Open the ledger"} <ArrowRight size={14} /></button></div>}<div className="table-footnote"><ShieldCheck size={13} />“Delivered” requires customer-specific evidence. Always.</div></div>
            {selected && <aside className="evidence-panel" id="evidence-detail" aria-label={`Details for ${selected.title}`}><div className="detail-eyebrow"><span>{selected.id} <span> / </span> EVIDENCE BRIEF</span><span className="detail-dots"><MoreHorizontal size={17} /></span></div><h2>{selected.title}</h2><Badge verdict={selected.verdict} /><div className="detail-tabs" role="group" aria-label="Evidence brief view"><button onClick={() => setDetailTab("evidence")} aria-pressed={detailTab === "evidence"}>Evidence trail</button><button onClick={() => activeReview ? setDetailTab("draft") : prepareDraft(selected)} aria-pressed={detailTab === "draft"}>Customer update{activeReview?.approved && <Check size={12} />}</button></div>
              {detailTab === "evidence" ? <><div className="verdict-block"><span>THE REALITY</span><p>{selected.reason}</p></div><div className="delivery-checks">{([{ name: "Built", value: selected.fact?.built }, { name: "Enabled", value: selected.fact?.enabled }, { name: "Verified", value: selected.fact?.verified }]).map((check) => <div key={check.name} className={check.value === true ? "check-pass" : check.value === false ? "check-fail" : "check-unknown"}><span>{check.value === true ? <Check size={13} /> : check.value === false ? <X size={13} /> : <span>?</span>}</span><small>{check.name}</small></div>)}</div>{selected.fact?.confirmation && <p className="confirmed-note"><UserCheck size={12} />Confirmed by you from a {selected.fact.confirmation.proposedBy === "nemotron" ? "Nemotron" : "pattern-matcher"} proposal{selected.fact.confirmation.corrected.length ? `; you corrected ${selected.fact.confirmation.corrected.join(", ")}` : ", unchanged"}.</p>}{selected.runtime && <RuntimeAlert finding={selected.runtime} sources={analysis.sources} />}{selected.verdict === "unknown" && <p className="evidence-warning">Signal values above are not proof: {selected.reason}</p>}{selected.publicClaim && <PublicClaimCard note={selected.publicClaim} source={analysis.sources.find((source) => source.id === selected.publicClaim?.sourceId)} onOpenSource={openSource} />}{selected.narrative && <div className="narrative-block"><span>{selected.verdict === "verified" ? "WHY THE EVIDENCE AGREES" : ["blocked", "unknown", "overdue", "verify"].includes(selected.verdict) ? "WHY THE EVIDENCE DISAGREES" : "WHAT THE EVIDENCE SAYS"}</span><NarrativeOrigin narrative={selected.narrative} /><ClaimList claims={selected.narrative.explanation} onOpenSource={openSource} label="Why the evidence disagrees" /></div>}<div className="timeline">{[...selected.evidence, ...(selected.fact?.evidence ?? []), ...(selected.runtime?.evidence ?? [])].map((evidence, index) => { const source = analysis.sources.find((candidate) => candidate.id === evidence.sourceId); return source ? <div className="timeline-item" key={`${source.id}-${index}`}><span className={`timeline-icon ${source.kind.toLowerCase()}`}><SourceIcon source={source} /></span><div><div className="timeline-heading"><strong>{SOURCE_KIND_LABEL[source.kind]}</strong><span>{shortDate(source.observedAt.slice(0, 10))}</span></div><p className="source-title">{source.title}</p><blockquote>“{evidence.quote}”</blockquote><button className="source-link" onClick={() => { navigate("sources"); setSearch(source.id); }}>{source.id} · View source <ArrowUpRight size={11} /></button></div></div> : null; })}</div><div className="next-step"><span><ArrowRight size={14} />RECOMMENDED NEXT STEP</span><p>{selected.nextAction}</p></div>{selected.narrative && <OwnerNudge narrative={selected.narrative} owner={selected.owner} onOpenSource={openSource} />}{selected.intent !== "tentative" && <button className="button primary draft-button" onClick={() => prepareDraft(selected)}><FileText size={15} />Prepare customer update<ArrowRight size={15} /></button>}<p className="no-send"><LockKeyhole size={11} />For your review. Never sent automatically.</p></> : activeReview ? <div className="draft-editor"><div className="draft-status"><span className={`badge ${activeReview.approved ? "success" : "warning"}`}><span />{activeReview.approved ? "Approved locally" : "Needs human review"}</span></div>{selected.narrative && <NarrativeOrigin narrative={selected.narrative} />}<PublicClaimDraftWarning note={selected.publicClaim} accountName={accountName} /><label htmlFor="customer-draft">Customer update · editable draft</label><textarea id="customer-draft" value={activeReview.text} onChange={(event) => setReviews((previous) => previous.map((review) => review.commitmentId === selected.id ? { ...review, text: event.target.value, approved: false } : review))} /><p>{selected.narrative?.origin === "model" ? "Model-written after the verdict was fixed. Your edits are not re-checked, so review them against the sources. Editing clears approval." : "Template-generated wording. Editing clears approval. No new dates are invented."}</p>{selected.narrative && <details className="draft-sources"><summary>Sources behind this draft</summary><ClaimList claims={selected.narrative.customerUpdate} onOpenSource={openSource} label="Customer update claims" /></details>}<button className="button primary draft-button" disabled={activeReview.approved || activeReview.text.trim().length < 20} onClick={() => { setReviews((previous) => previous.map((review) => review.commitmentId === selected.id ? { ...review, approved: true } : review)); record("Draft approved locally", `${selected.id} · Review applies only to this evidence run. Nothing sent.`); setNotice("Approved in this workspace. Export the draft when you are ready."); }}><CheckCheck size={15} />{activeReview.approved ? "Review complete · not sent" : "Approve this draft"}</button><button className="button secondary draft-button" disabled={!activeReview.approved} onClick={() => download(`${selected.id}-approved-update.md`, `${activeReview.text}\n\n---\n${analysis.account.kind === "sample" ? "Synthetic demo" : "Your evidence"} · locally reviewed, not sent.\nEvidence run: ${activeReview.runId}\n`, "text/markdown")}><ArrowDownToLine size={14} />Export approved draft</button><p className="no-send"><LockKeyhole size={11} />No email or CRM sending capability exists.</p></div> : null}
            </aside>}
          </div></section>}

          {view === "sources" && <section className="sources-section"><div className="section-heading"><div><h2>Source library <span>{analysis.sources.length}</span></h2><p>Read the original. Check the interpretation.</p></div><div className="search-box"><Search size={14} /><input aria-label="Search evidence sources" placeholder="Search sources…" value={search} onChange={(event) => setSearch(event.target.value)} /></div></div><ProviderStatus providers={analysis.pipeline.providers} /><div className="source-grid">{analysis.sources.filter((source) => `${source.id} ${source.text} ${source.title}`.toLowerCase().includes(search.toLowerCase())).map((source) => { const injection = detectInjection(source.text); return <article className="source-card" key={source.id}><div className="source-card-top"><span className="source-type"><SourceIcon source={source} />{SOURCE_KIND_LABEL[source.kind]}</span><span>{source.id}</span></div><h3>{source.title}</h3><p className="source-meta">{source.author} · {shortDate(source.observedAt.slice(0, 10))}</p>{injection && <p className="byo-flag"><ShieldCheck size={12} />Addresses an AI system (“{injection}”). Treated as data, never as instructions.</p>}<pre>{source.text}</pre><SourceOrigin source={source} /><footer>{source.kind === "PublicClaim" ? <><Globe size={12} />Public claim, not customer evidence</> : <><LockKeyhole size={12} />{source.kind === "UserSupplied" ? "Supplied by you · untrusted text, stored only in this browser" : "Synthetic, account-scoped evidence"}</>}</footer></article>; })}</div>{analysis.sources.length === 0 && <div className="empty-state"><Database size={28} /><h3>No sources yet</h3><p>Add evidence and run the rules; the sources they used appear here.</p><button className="button secondary" onClick={() => navigate("byo")}>Add evidence <ArrowRight size={14} /></button></div>}</section>}
          {view === "activity" && <section className="activity-section"><div className="section-heading"><div><h2>Workspace activity <span>{events.length}</span></h2><p>Transparent actions, not a persistent compliance audit.</p></div><button className="button secondary" onClick={exportLedger}><ArrowDownToLine size={14} />Export activity</button></div>{events.map((event) => <div className="audit-event" key={event.id}><span className="audit-icon"><Activity size={16} /></span><div><h3>{event.title}</h3><p>{event.detail}</p></div><span className="event-number">#{String(event.id + 1).padStart(2, "0")}</span></div>)}</section>}
          <footer className="page-footer"><span><ShieldCheck size={13} />Evidence first. Human judgment always.</span><span>{analysis.mode === "reference" ? "Deterministic reference demo" : `Live pipeline · extraction by ${analysis.model} · ${formatUsd(analysis.pipeline.costUsd)} estimated`} <span>·</span> {analysis.elapsedMs > 0 ? `${formatMs(analysis.elapsedMs)} · ` : ""}{persistence === "on" ? "Saved in this browser only" : "Session-only data"}</span></footer>
        </main>
      </div>
      {tourOpen && <GuidedTour steps={tourSteps} onClose={closeTour} />}
    </div>
  );
}
