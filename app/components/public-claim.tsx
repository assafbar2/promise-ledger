import { CircleAlert, Globe, Info } from "lucide-react";
import type { PublicClaimNote, Source } from "@/lib/schema";

export function PublicClaimCard({ note, source, onOpenSource }: { note: PublicClaimNote; source: Source | undefined; onOpenSource: (sourceId: string) => void }) {
  const recorded = source?.provenance?.recorded === true;
  return (
    <div className={`public-claim ${note.conflict ? "conflict" : "consistent"}`} role={note.conflict ? "note" : undefined}>
      <span className="public-claim-label"><Globe size={11} aria-hidden="true" />PUBLIC CLAIM, NOT CUSTOMER EVIDENCE</span>
      <p className="public-claim-message">{note.conflict ? <CircleAlert size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}<span>{note.message}</span></p>
      <blockquote>“{note.quote}”</blockquote>
      <p className="public-claim-meta">
        <button className="cite-chip" onClick={() => onOpenSource(note.sourceId)} aria-label={`Open source ${note.sourceId}`}>{note.sourceId}</button>
        <span>{`${recorded ? "Recorded Tavily response · no live call" : "Fetched live by Tavily Extract"}${source?.provenance?.requestId ? ` · request ${source.provenance.requestId.slice(0, 8)}` : ""} · exact quote from the returned text`}</span>
        {note.url && <a href={note.url} target="_blank" rel="noopener noreferrer">View page</a>}
      </p>
    </div>
  );
}

export function PublicClaimDraftWarning({ note, accountName }: { note: PublicClaimNote | null | undefined; accountName: string }) {
  if (!note?.conflict) return null;
  return <p className="public-claim-warning" role="note"><CircleAlert size={12} aria-hidden="true" />The public changelog calls this generally available, but {accountName} can&apos;t use it yet. Don&apos;t tell them it&apos;s live.</p>;
}
