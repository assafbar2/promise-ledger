"use client";

import { useState } from "react";
import { Check, Copy, Cpu, FileText, ShieldCheck } from "lucide-react";
import { modelInfo } from "@/lib/pipeline/models";
import type { Claim, Narrative } from "@/lib/schema";

export function NarrativeOrigin({ narrative }: { narrative: Narrative }) {
  if (narrative.origin === "model") {
    return <p className="narrative-origin model"><Cpu size={12} aria-hidden="true" /><span><strong>Written by {narrative.model ? modelInfo(narrative.model).name : "Nemotron"}</strong> after the rules decided. Guardrails passed: exact citations, no new dates or promises, verdict unchanged.</span></p>;
  }
  return <p className="narrative-origin template"><FileText size={12} aria-hidden="true" /><span><strong>Template draft.</strong> {narrative.fallbackReason ? `${narrative.fallbackReason.replace(/^Template draft:\s*/, "").replace(/^./, (letter) => letter.toUpperCase())}.` : "Built from the verdict and exact evidence, with no AI call."}</span></p>;
}

export function ClaimList({ claims, onOpenSource, label }: { claims: Claim[]; onOpenSource: (sourceId: string) => void; label: string }) {
  return (
    <ul className="claim-list" aria-label={label}>
      {claims.map((claim, index) => <li key={index}>
        <p>{claim.text}</p>
        <details>
          <summary>
            <ShieldCheck size={11} aria-hidden="true" />
            {claim.citations.length} exact {claim.citations.length === 1 ? "quote" : "quotes"}
            <span className="claim-sources">{[...new Set(claim.citations.map((citation) => citation.sourceId))].join(", ")}</span>
          </summary>
          {claim.citations.map((citation, citationIndex) => <blockquote key={citationIndex}>“{citation.quote}”<button className="cite-chip" onClick={() => onOpenSource(citation.sourceId)} aria-label={`Open source ${citation.sourceId}`}>{citation.sourceId}</button></blockquote>)}
        </details>
      </li>)}
    </ul>
  );
}

export function OwnerNudge({ narrative, owner, onOpenSource }: { narrative: Narrative; owner: string | null; onOpenSource: (sourceId: string) => void }) {
  const [copied, setCopied] = useState(false);
  const text = narrative.ownerNudge.map((claim) => claim.text).join(" ");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }
  return (
    <div className="owner-nudge">
      <div className="owner-nudge-head"><span>INTERNAL NUDGE{owner ? ` · ${owner.toUpperCase()}` : ""}</span><button onClick={copy} aria-label="Copy internal nudge">{copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button></div>
      <ClaimList claims={narrative.ownerNudge} onOpenSource={onOpenSource} label="Internal nudge" />
      <p className="nudge-note">For your team only. Not sent anywhere.</p>
    </div>
  );
}
