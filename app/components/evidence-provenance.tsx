import { CircleAlert, Globe, LockKeyhole, ShieldCheck } from "lucide-react";
import type { EvidenceProviderReport, Source } from "@/lib/schema";

function count(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/** One line per evidence provider in the run: what it supplied, or why it supplied nothing. */
export function ProviderStrip({ providers }: { providers: EvidenceProviderReport[] }) {
  if (providers.length === 0) return null;
  return (
    <ul className="provider-strip" aria-label="Evidence providers">
      {providers.map((provider) => (
        <li key={provider.id} className={`provider-${provider.status} trust-${provider.trust}`}>
          {provider.status === "ok" ? <ShieldCheck size={12} aria-hidden="true" /> : <CircleAlert size={12} aria-hidden="true" />}
          <strong>{provider.label}</strong>
          <span>{provider.status === "ok"
            ? `${count(provider.sourceCount, "source")}${provider.signalCount ? ` · ${count(provider.signalCount, "signal")}` : ""}${provider.recorded ? " · reference fixture" : ""}${provider.trust === "untrusted" ? " · cannot set verdicts" : ""}`
            : provider.error ?? "Not available."}</span>
        </li>
      ))}
    </ul>
  );
}

/** Source-card footer: provider provenance for fetched sources, the synthetic label otherwise. */
export function SourceProvenance({ source }: { source: Source }) {
  if (source.kind !== "PublicClaim") return <footer><LockKeyhole size={12} />Synthetic, account-scoped evidence</footer>;
  const { provenance } = source;
  const fetched = provenance?.recorded ? "Reference fixture, no Tavily call" : `Fetched by Tavily Extract${provenance?.fetchedAt ? ` at ${provenance.fetchedAt.slice(0, 16).replace("T", " ")} UTC` : ""}${provenance?.requestId ? ` · request ${provenance.requestId.slice(0, 8)}` : ""}`;
  return (
    <footer className="public-claim-footer">
      <Globe size={12} />
      <span>Public claim, not customer evidence · {fetched}{source.url && <> · <a href={source.url} target="_blank" rel="noopener noreferrer">{new URL(source.url).host}{new URL(source.url).pathname}</a></>}</span>
    </footer>
  );
}
