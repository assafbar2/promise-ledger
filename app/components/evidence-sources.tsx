"use client";

import { ArrowUpRight, Bug, CircleAlert, History, Radio } from "lucide-react";
import type { EvidenceProviderReport, RuntimeFinding, Source } from "@/lib/schema";
import "./evidence-sources.css";

function utc(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(date)} UTC`;
}

/** Where a provider-fetched source came from: live or recorded, and a link to the original. */
export function SourceOrigin({ source }: { source: Source }) {
  const provenance = source.provenance;
  if (!source.url && !provenance?.fetchedAt) return null;
  return (
    <div className="source-origin">
      {provenance?.fetchedAt && <span className={`origin-pill ${provenance.recorded ? "recorded" : "live"}`}>{provenance.recorded ? <History size={11} /> : <Radio size={11} />}{provenance.recorded ? `Recorded response · captured ${utc(provenance.fetchedAt)}` : `Fetched live · ${utc(provenance.fetchedAt)}`}</span>}
      {source.url && <a href={source.url} target="_blank" rel="noopener noreferrer">{source.kind === "Runtime" ? "Sentry issue · owner sign-in" : "Open original"}<ArrowUpRight size={11} /></a>}
    </div>
  );
}

/** Evidence providers beyond the curated pack, including explicit failures. */
export function ProviderStatus({ providers }: { providers: EvidenceProviderReport[] }) {
  const external = providers.filter((provider) => provider.trust !== "curated");
  if (external.length === 0) return null;
  return (
    <ul className="provider-status" aria-label="Connected evidence providers">
      {external.map((provider) => (
        <li key={provider.id} className={provider.status}>
          {provider.status === "failed" ? <CircleAlert size={13} /> : <Radio size={13} />}
          <strong>{provider.label}</strong>
          <span>{provider.status === "failed" ? provider.error ?? "Unavailable." : `${provider.sourceCount} ${provider.sourceCount === 1 ? "source" : "sources"}${provider.recorded ? " · recorded response" : " · live"}`}</span>
        </li>
      ))}
    </ul>
  );
}

export function RuntimeAlert({ finding, sources }: { finding: RuntimeFinding; sources: Source[] }) {
  const cited = sources.filter((source) => finding.evidence.some((evidence) => evidence.sourceId === source.id));
  const recorded = cited.some((source) => source.provenance?.recorded);
  return (
    <div className="runtime-alert" role="note">
      <span><Bug size={13} />FAILING AT RUNTIME</span>
      <p><strong>{finding.count} {finding.count === 1 ? "error event" : "error events"}</strong> for this customer and feature{finding.issues > 1 ? ` across ${finding.issues} issues` : ""}, {finding.issues > 1 ? "at least " : ""}{finding.users} {finding.users === 1 ? "user" : "users"} affected. Last seen {utc(finding.lastSeen)}.</p>
      <small>{recorded ? "Recorded Sentry response." : "Live from Sentry."} Runtime errors can lower a verdict. A quiet error feed never proves delivery.</small>
    </div>
  );
}
