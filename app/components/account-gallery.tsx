"use client";

import { useMemo } from "react";
import { ArrowDownToLine, ArrowRight, ClipboardPaste, FolderOpen, HardDrive, Trash2 } from "lucide-react";
import type { AccountPack } from "@/lib/accounts";
import { referenceAnalysis } from "@/lib/accounts/reference";
import { VERDICTS } from "@/lib/verdicts";

export type SavedByoSummary = { id: string; name: string; sources: number; stage: "draft" | "confirm" | "decided"; updatedAt: string };

const ATTENTION = ["blocked", "overdue", "verify", "unknown"];

export function AccountGallery({ accounts, activeId, saved, persistence, onOpenSample, onNewByo, onOpenByo, onDeleteByo, onExportAll, onClearAll }: {
  accounts: readonly AccountPack[];
  activeId: string;
  saved: SavedByoSummary[];
  persistence: "on" | "unavailable" | "loading";
  onOpenSample: (id: string) => void;
  onNewByo: () => void;
  onOpenByo: (id: string) => void;
  onDeleteByo: (id: string) => void;
  onExportAll: () => void;
  onClearAll: () => void;
}) {
  const previews = useMemo(() => accounts.map((pack) => {
    const analysis = referenceAnalysis(pack);
    const headline = analysis.commitments.find((commitment) => commitment.featureId === pack.headlineFeatureId)!;
    return { pack, headline, promises: analysis.commitments.filter((commitment) => commitment.intent === "committed").length, attention: analysis.commitments.filter((commitment) => ATTENTION.includes(commitment.verdict)).length, sources: analysis.sources.length };
  }), [accounts]);
  return (
    <section className="gallery-section" aria-labelledby="gallery-title">
      <div className="section-heading"><div><h2 id="gallery-title">Sample accounts <span>{accounts.length}</span></h2><p>Fictional customers, each with its own synthetic evidence pack. One click loads the reference result; then run the check live.</p></div></div>
      <div className="account-grid">
        {previews.map(({ pack, headline, promises, attention, sources }) => {
          const workspaceId = `sample:${pack.id}`;
          const active = activeId === workspaceId;
          return (
            <button key={pack.id} className={`account-card ${active ? "active" : ""}`} onClick={() => onOpenSample(pack.id)} aria-pressed={active} data-tour={pack.id === accounts[1]?.id ? "account-card" : undefined}>
              <span className="account-top"><span className="account-avatar">{pack.initials}</span><span><strong>{pack.name}</strong><small>{pack.industry}</small></span>{active && <span className="account-open">Open</span>}</span>
              <span className="account-situation">{pack.situation}</span>
              <span className="account-headline"><span>Headline</span><span>{headline.title}</span><span className={`badge ${VERDICTS[headline.verdict].className}`}><span />{VERDICTS[headline.verdict].label}</span></span>
              <span className="account-stats">{promises} promises · {attention} need attention · {sources} sources<ArrowRight size={13} /></span>
            </button>
          );
        })}
        <button className={`account-card byo-card ${activeId.startsWith("byo:") ? "" : ""}`} onClick={onNewByo} data-tour="byo-card">
          <span className="account-top"><span className="account-avatar byo"><ClipboardPaste size={16} /></span><span><strong>Bring your own evidence</strong><small>Paste text or drop .txt, .md, .csv, .eml</small></span></span>
          <span className="account-situation">Nemotron proposes commitments and availability facts with exact quotes. You confirm or correct every fact, then the same rules decide.</span>
          <span className="account-stats">Start a new workspace<ArrowRight size={13} /></span>
        </button>
      </div>

      <div className="section-heading saved-heading"><div><h2>Your workspaces <span>{saved.length}</span></h2><p><HardDrive size={11} /> {persistence === "on" ? "Saved in this browser only (localStorage). Nothing is stored on a server." : persistence === "loading" ? "Checking browser storage…" : "This browser blocks local storage, so workspaces last only until you refresh."}</p></div>
        <div className="saved-actions"><button className="button secondary" onClick={onExportAll}><ArrowDownToLine size={13} />Export all</button><button className="button secondary danger" onClick={onClearAll}><Trash2 size={13} />Clear all local data</button></div></div>
      {saved.length === 0 ? <p className="saved-empty">No bring-your-own workspaces yet. Sample accounts remember their last run and reviews automatically.</p>
        : <ul className="saved-list">{saved.map((workspace) => <li key={workspace.id} className={activeId === workspace.id ? "active" : ""}>
          <FolderOpen size={15} aria-hidden="true" />
          <div><strong>{workspace.name}</strong><small>{workspace.sources} source{workspace.sources === 1 ? "" : "s"} · {workspace.stage === "decided" ? "verdicts ready" : workspace.stage === "confirm" ? "facts awaiting your confirmation" : "draft"} · updated {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(workspace.updatedAt))}</small></div>
          <button className="button secondary" onClick={() => onOpenByo(workspace.id)}>Open</button>
          <button className="icon-button" onClick={() => onDeleteByo(workspace.id)} aria-label={`Delete workspace ${workspace.name}`}><Trash2 size={14} /></button>
        </li>)}</ul>}
    </section>
  );
}
