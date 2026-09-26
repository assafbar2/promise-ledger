"use client";

import { useRef, useState, type DragEvent } from "react";
import { AlertTriangle, ArrowRight, Check, CheckCheck, ClipboardPaste, FileUp, Lock, PencilLine, Plus, ScanSearch, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { emailAsText, parseEml } from "@/lib/byo/eml";
import { exampleEvidence } from "@/lib/byo/example";
import { detectInjection } from "@/lib/byo/injection";
import { BYO_FILE_EXTENSIONS, BYO_LIMITS, BYO_SOURCE_TYPE_LABEL, BYO_SOURCE_TYPES, encodedBytes, type ByoSourceType } from "@/lib/byo/limits";
import { duplicateConfirmedFeatures, featureOptions, initialReview, type ByoReview, type FactEdit } from "@/lib/byo/review";
import { sanitizeText } from "@/lib/byo/sanitize";
import type { ByoSourceInput } from "@/lib/byo/schema";
import { byoUsage } from "@/lib/byo/sources";
import type { ByoDraft } from "@/lib/workspaces";

const bytes = (value: number) => value.toLocaleString("en-US");

function toLocalInput(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string, fallback: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function nextId(sources: ByoSourceInput[]) {
  for (let index = 1; index <= 99; index++) {
    const id = `U-${String(index).padStart(2, "0")}`;
    if (!sources.some((source) => source.id === id)) return id;
  }
  return "U-99";
}

function typeForFile(name: string): ByoSourceType {
  const lower = name.toLowerCase();
  if (lower.endsWith(".eml")) return "email";
  if (lower.endsWith(".csv")) return "telemetry";
  if (/meeting|call|sync|notes/.test(lower)) return "meeting";
  if (/ticket|support|case/.test(lower)) return "ticket";
  if (/slack|chat|thread/.test(lower)) return "chat";
  return "notes";
}

function Tri({ label, value, original, onChange }: { label: string; value: boolean | null; original: boolean | null; onChange: (value: boolean | null) => void }) {
  const options: { value: boolean | null; text: string }[] = [{ value: true, text: "Yes" }, { value: false, text: "No" }, { value: null, text: "Unknown" }];
  return (
    <fieldset className={`tri ${value !== original ? "changed" : ""}`}>
      <legend>{label}{value !== original && <small> · corrected</small>}</legend>
      {options.map((option) => <button type="button" key={String(option.value)} aria-pressed={value === option.value} className={option.value === true ? "yes" : option.value === false ? "no" : "unknown"} onClick={() => onChange(option.value)}>{option.text}</button>)}
    </fieldset>
  );
}

export function ByoPanel({ draft, onChange, live, liveNote, running, continuationValid, decided, onExtract, onDecide, onViewLedger, onOpenSource }: {
  draft: ByoDraft;
  onChange: (draft: ByoDraft) => void;
  live: boolean;
  liveNote: string;
  running: boolean;
  continuationValid: boolean;
  decided: boolean;
  onExtract: () => void;
  onDecide: (useLive: boolean) => void;
  onViewLedger: () => void;
  onOpenSource: (sourceId: string) => void;
}) {
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteType, setPasteType] = useState<ByoSourceType>("meeting");
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { sources, proposal } = draft;
  const review = draft.review ?? (proposal ? initialReview(proposal) : null);
  const locked = proposal !== null;
  const usage = byoUsage(sources);
  const pasteBytes = encodedBytes(sanitizeText(pasteText));
  const overTotal = usage.totalBytes > BYO_LIMITS.maxTotalBytes;
  const full = sources.length >= BYO_LIMITS.maxSources;

  function addSources(additions: Omit<ByoSourceInput, "id">[]) {
    const next = [...sources];
    const skipped: string[] = [];
    for (const addition of additions) {
      if (next.length >= BYO_LIMITS.maxSources) { skipped.push(`"${addition.title}" was not added: at most ${BYO_LIMITS.maxSources} sources.`); continue; }
      const text = sanitizeText(addition.text);
      if (!text) { skipped.push(`"${addition.title}" is empty.`); continue; }
      if (encodedBytes(text) > BYO_LIMITS.maxSourceBytes) { skipped.push(`"${addition.title}" is ${bytes(encodedBytes(text))} bytes; each source can be at most ${bytes(BYO_LIMITS.maxSourceBytes)}.`); continue; }
      next.push({ ...addition, id: nextId(next), text, title: addition.title.slice(0, BYO_LIMITS.maxTitleChars) || "Untitled source" });
    }
    setProblems(skipped);
    onChange({ ...draft, sources: next });
  }

  function addPaste() {
    addSources([{ type: pasteType, title: pasteTitle.trim() || `${BYO_SOURCE_TYPE_LABEL[pasteType]} (pasted)`, observedAt: new Date().toISOString(), text: pasteText }]);
    setPasteText("");
    setPasteTitle("");
  }

  async function addFiles(files: FileList | File[]) {
    const additions: Omit<ByoSourceInput, "id">[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      if (!BYO_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension))) { rejected.push(`${file.name}: only ${BYO_FILE_EXTENSIONS.join(", ")} files are accepted.`); continue; }
      if (file.size > BYO_LIMITS.maxFileBytes) { rejected.push(`${file.name} is larger than ${Math.round(BYO_LIMITS.maxFileBytes / 1000)} KB.`); continue; }
      const raw = await file.text();
      if (/\u0000/.test(raw) || (raw.match(/\ufffd/g)?.length ?? 0) > 8) { rejected.push(`${file.name} does not look like plain text.`); continue; }
      if (lower.endsWith(".eml")) {
        const email = parseEml(raw);
        if (!email.body) { rejected.push(`${file.name} has no readable text body.`); continue; }
        additions.push({ type: "email", title: email.subject ?? file.name, observedAt: email.date ?? new Date(file.lastModified || Date.now()).toISOString(), text: emailAsText(email) });
      } else {
        additions.push({ type: typeForFile(file.name), title: file.name, observedAt: new Date(file.lastModified || Date.now()).toISOString(), text: raw });
      }
    }
    addSources(additions);
    if (rejected.length) setProblems((previous) => [...rejected, ...previous]);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!locked && event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  function updateSource(id: string, patch: Partial<ByoSourceInput>) {
    onChange({ ...draft, sources: sources.map((source) => source.id === id ? { ...source, ...patch } : source) });
  }

  function setReview(next: ByoReview) {
    onChange({ ...draft, review: next });
  }

  function editFact(id: string, patch: Partial<FactEdit>) {
    if (!review) return;
    setReview({ ...review, facts: { ...review.facts, [id]: { ...review.facts[id], ...patch } } });
  }

  const confirmedCount = review ? Object.values(review.facts).filter((edit) => edit.confirmed).length : 0;
  const duplicates = review ? duplicateConfirmedFeatures(review) : [];
  const included = review && proposal ? proposal.commitments.filter((commitment) => review.commitments[commitment.id]?.included !== false).length : 0;
  const options = proposal ? featureOptions(proposal) : [];

  return (
    <section className="byo-section" aria-labelledby="byo-title">
      <div className="byo-step">
        <div className="byo-step-head"><span className="byo-step-number">1</span><div><h2 id="byo-title">Add your evidence</h2><p>Meeting notes, tickets, Slack threads, emails or telemetry lines. Text only: links are never opened, and every word is treated as untrusted data, never as instructions.</p></div></div>
        <label className="byo-name">Customer or workspace name<input value={draft.workspace} maxLength={BYO_LIMITS.maxWorkspaceNameChars} disabled={locked || running} onChange={(event) => onChange({ ...draft, workspace: event.target.value })} placeholder="e.g. Acme Corp" /></label>
        {!locked && <div className="byo-inputs">
          <div className="byo-paste">
            <div className="byo-paste-row">
              <label>Type<select value={pasteType} onChange={(event) => setPasteType(event.target.value as ByoSourceType)}>{BYO_SOURCE_TYPES.map((type) => <option key={type} value={type}>{BYO_SOURCE_TYPE_LABEL[type]}</option>)}</select></label>
              <label className="grow">Title<input value={pasteTitle} maxLength={BYO_LIMITS.maxTitleChars} onChange={(event) => setPasteTitle(event.target.value)} placeholder="e.g. Weekly sync, 22 Sep" /></label>
            </div>
            <label className="byo-textarea">Paste text<textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={"Jordan Lee: I will make group booking import available by 2026-10-01.\naccount=acme; feature=group-import; built=true; enabled=false"} /></label>
            <div className="byo-paste-foot"><span className={pasteBytes > BYO_LIMITS.maxSourceBytes ? "over" : ""}>{bytes(pasteBytes)} / {bytes(BYO_LIMITS.maxSourceBytes)} bytes</span><button className="button secondary" onClick={addPaste} disabled={!pasteText.trim() || full || pasteBytes > BYO_LIMITS.maxSourceBytes}><Plus size={13} />Add as source</button></div>
          </div>
          <div className={`byo-drop ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
            <FileUp size={22} aria-hidden="true" />
            <strong>Drop files here</strong>
            <span>{BYO_FILE_EXTENSIONS.join(" · ")} · up to {BYO_LIMITS.maxSources} sources</span>
            <button className="button secondary" onClick={() => fileInput.current?.click()} disabled={full}>Choose files</button>
            <input ref={fileInput} type="file" multiple hidden accept=".txt,.md,.csv,.eml,text/plain,text/markdown,text/csv,message/rfc822" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }} />
            <span className="byo-or">or</span>
            <button className="text-button" onClick={() => { const example = exampleEvidence(); onChange({ ...draft, workspace: example.workspace, sources: example.sources, proposal: null, review: null }); setProblems([]); }}><ClipboardPaste size={12} />Load example evidence (fictional hotel chain)</button>
          </div>
        </div>}
        {problems.length > 0 && <ul className="byo-problems" role="alert">{problems.map((problem) => <li key={problem}><AlertTriangle size={12} />{problem}</li>)}<li><button onClick={() => setProblems([])} aria-label="Dismiss"><X size={12} /></button></li></ul>}
        <div className="byo-meter" aria-live="polite"><span>{sources.length} of {BYO_LIMITS.maxSources} sources</span><span className="meter-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (usage.totalBytes / BYO_LIMITS.maxTotalBytes) * 100)}%` }} className={overTotal ? "over" : ""} /></span><span className={overTotal ? "over" : ""}>{bytes(usage.totalBytes)} of {bytes(BYO_LIMITS.maxTotalBytes)} bytes</span></div>
        {sources.length > 0 && <ol className="byo-sources">{sources.map((source, index) => {
          const injection = detectInjection(source.text);
          return <li key={source.id}>
            <div className="byo-source-head">
              <span className="cite-chip">{source.id}</span>
              <select aria-label={`Type of ${source.id}`} value={source.type} disabled={locked || running} onChange={(event) => updateSource(source.id, { type: event.target.value as ByoSourceType })}>{BYO_SOURCE_TYPES.map((type) => <option key={type} value={type}>{BYO_SOURCE_TYPE_LABEL[type]}</option>)}</select>
              <input aria-label={`Title of ${source.id}`} className="grow" value={source.title} maxLength={BYO_LIMITS.maxTitleChars} disabled={locked || running} onChange={(event) => updateSource(source.id, { title: event.target.value })} />
              <label className="byo-observed">Observed<input type="datetime-local" value={toLocalInput(source.observedAt)} disabled={locked || running} onChange={(event) => updateSource(source.id, { observedAt: fromLocalInput(event.target.value, source.observedAt) })} /></label>
              <span className="byo-size">{bytes(usage.perSource[index])} B</span>
              {!locked && <button className="icon-button" aria-label={`Remove ${source.id}`} onClick={() => onChange({ ...draft, sources: sources.filter((candidate) => candidate.id !== source.id) })} disabled={running}><Trash2 size={13} /></button>}
            </div>
            {injection && <p className="byo-flag"><ShieldCheck size={12} />Addresses an AI system (“{injection}”). It stays evidence, never instructions.</p>}
            <details><summary>Preview text</summary><pre>{source.text}</pre></details>
          </li>;
        })}</ol>}
      </div>

      <div className="byo-step">
        <div className="byo-step-head"><span className="byo-step-number">2</span><div><h2>Extract commitments and facts</h2><p>{live ? liveNote : "Reference mode uses a pattern matcher, no AI: it finds explicit “Name: I will … by YYYY-MM-DD” promises and key=value availability lines only."}</p></div></div>
        {locked ? <div className="byo-locked"><Lock size={13} /><span>Sources are locked while you review what was extracted from them.</span><button className="text-button" onClick={() => onChange({ ...draft, proposal: null, review: null })} disabled={running}><PencilLine size={12} />Edit evidence (clears the extracted facts)</button></div>
          : <button className="button primary byo-action" onClick={onExtract} disabled={running || sources.length === 0 || overTotal} data-tour="byo-extract">{live ? <Sparkles size={15} /> : <ScanSearch size={15} />}{running ? "Extracting…" : live ? "Extract with Nemotron · uses 1 live run" : "Extract with the pattern matcher · no AI"}</button>}
      </div>

      {proposal && review && <div className="byo-step" data-tour="byo-confirm">
        <div className="byo-step-head"><span className="byo-step-number">3</span><div><h2>Confirm or correct the facts</h2><p>{proposal.extractor === "nemotron" ? `Proposed by ${proposal.model ?? "Nemotron"}.` : "Proposed by the pattern matcher."} Nothing is decided yet. Rules read only the facts you confirm; unconfirmed facts are ignored and their promises show “Evidence needed”.</p></div></div>
        {proposal.flagged.length > 0 && <div className="byo-note"><ShieldCheck size={14} /><span>{proposal.flagged.map((item) => `${item.sourceId} ${item.reason}`).join("; ")}. Treated as data; it cannot change a verdict.</span></div>}
        {proposal.dropped.length > 0 && <div className="byo-note warn"><AlertTriangle size={14} /><span>{proposal.dropped.length} proposed item{proposal.dropped.length === 1 ? " was" : "s were"} dropped because {proposal.dropped.length === 1 ? "it was" : "they were"} not grounded in exact source text: {proposal.dropped.slice(0, 3).join("; ")}.</span></div>}

        <h3 className="byo-subhead">Commitments <span>{included} of {proposal.commitments.length} included</span></h3>
        {proposal.commitments.length === 0 ? <p className="saved-empty">No commitments were found. The rules need at least one promise to check.</p> : <ul className="byo-commitments">{proposal.commitments.map((commitment) => {
          const edit = review.commitments[commitment.id];
          return <li key={commitment.id} className={edit?.included === false ? "excluded" : ""}>
            <label className="byo-include"><input type="checkbox" checked={edit?.included !== false} onChange={(event) => setReview({ ...review, commitments: { ...review.commitments, [commitment.id]: { ...edit, included: event.target.checked } } })} /><span className="visually-hidden">Include {commitment.title}</span></label>
            <div><strong>{commitment.title}</strong><small>{commitment.featureId} · {commitment.owner ?? "no owner"} · {commitment.dueDate ?? "no date"}</small><blockquote>“{commitment.evidence[0].quote}” <button className="cite-chip" onClick={() => onOpenSource(commitment.evidence[0].sourceId)}>{commitment.evidence[0].sourceId}</button></blockquote></div>
            <select aria-label={`Intent of ${commitment.title}`} value={edit?.intent ?? commitment.intent} onChange={(event) => setReview({ ...review, commitments: { ...review.commitments, [commitment.id]: { ...edit, intent: event.target.value as "committed" | "tentative" } } })}><option value="committed">Committed</option><option value="tentative">Only discussed</option></select>
          </li>;
        })}</ul>}

        <h3 className="byo-subhead">Availability facts <span>{confirmedCount} of {proposal.facts.length} confirmed</span>{proposal.facts.length > 0 && <button className="text-button" onClick={() => setReview({ ...review, facts: Object.fromEntries(Object.entries(review.facts).map(([id, edit]) => [id, { ...edit, confirmed: true }])) })}><CheckCheck size={12} />Confirm all as shown</button>}</h3>
        {proposal.facts.length === 0 ? <p className="saved-empty">No availability facts were found, so every promise will read “Evidence needed”. Add telemetry lines, an entitlement export or a customer confirmation, then extract again.</p> : <ul className="byo-facts">{proposal.facts.map((fact) => {
          const edit = review.facts[fact.id];
          if (!edit) return null;
          return <li key={fact.id} className={edit.confirmed ? "confirmed" : ""}>
            <div className="fact-head">
              <label>Feature<select value={edit.featureId} onChange={(event) => editFact(fact.id, { featureId: event.target.value })}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              <label>Observed<input type="datetime-local" value={toLocalInput(edit.observedAt)} onChange={(event) => editFact(fact.id, { observedAt: fromLocalInput(event.target.value, edit.observedAt) })} /></label>
            </div>
            <div className="fact-tris">
              <Tri label="Built" value={edit.built} original={fact.built} onChange={(value) => editFact(fact.id, { built: value })} />
              <Tri label="Enabled for this customer" value={edit.enabled} original={fact.enabled} onChange={(value) => editFact(fact.id, { enabled: value })} />
              <Tri label="Customer verified" value={edit.verified} original={fact.verified} onChange={(value) => editFact(fact.id, { verified: value })} />
            </div>
            {fact.evidence.map((evidence, index) => <blockquote key={index}>“{evidence.quote}” <button className="cite-chip" onClick={() => onOpenSource(evidence.sourceId)}>{evidence.sourceId}</button></blockquote>)}
            <label className="fact-confirm"><input type="checkbox" checked={edit.confirmed} onChange={(event) => editFact(fact.id, { confirmed: event.target.checked })} />I checked this against the quote{edit.confirmed && <Check size={12} />}</label>
          </li>;
        })}</ul>}
        {duplicates.length > 0 && <p className="byo-note warn"><AlertTriangle size={14} /><span>Confirm only one fact per feature: {duplicates.join(", ")}.</span></p>}
        <div className="byo-decide">
          {continuationValid && <button className="button primary byo-action" disabled={running || duplicates.length > 0 || included === 0} onClick={() => onDecide(true)}><Sparkles size={15} />{running ? "Deciding…" : `Let the rules decide, then Ultra explains · no extra run`}</button>}
          <button className={`button ${continuationValid ? "secondary" : "primary"} byo-action`} disabled={running || duplicates.length > 0 || included === 0} onClick={() => onDecide(false)}><ArrowRight size={15} />{continuationValid ? "Rules only, with template drafts · no AI" : "Let the rules decide · template drafts, no AI"}</button>
          <p>{confirmedCount} confirmed fact{confirmedCount === 1 ? "" : "s"} · {included} commitment{included === 1 ? "" : "s"}. {proposal.continuation && !continuationValid ? "The live explain step for this extraction has expired or was used; re-running the rules is free." : ""}</p>
        </div>
        {decided && <button className="text-button byo-view" onClick={onViewLedger}>Verdicts are ready. Open the ledger<ArrowRight size={12} /></button>}
      </div>}
    </section>
  );
}
