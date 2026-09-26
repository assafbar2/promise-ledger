import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Bug, Check, CircleAlert, ClipboardPaste, FileCheck2, Gauge, Globe, Layers3, LockKeyhole, Quote, Scale, ShieldCheck, Sparkles, X } from "lucide-react";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { SAMPLE_ACCOUNTS } from "@/lib/accounts";
import "@/app/landing.css";

export const metadata: Metadata = {
  title: { absolute: "Promise Ledger — Promises made. Truth checked." },
};

const REPO = "https://github.com/assafbar2/promise-ledger";

function GithubMark({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>;
}

const STEPS = [
  { n: "01", name: "Triage", model: "Nemotron 3 Nano", body: "Labels every source and routes conversations to extraction. Delivery records go straight to the rules." },
  { n: "02", name: "Extract", model: "Nemotron 3 Super", body: "Pulls out commitments, owners and dates, each with an exact quote. Anything it cannot ground is dropped; a failed extraction stops the run." },
  { n: "03", name: "Decide", model: "Deterministic rules · no model", body: "An ordered policy turns customer-specific built, enabled and verified facts into one of seven conservative verdicts." },
  { n: "04", name: "Explain", model: "Nemotron 3 Ultra", body: "Only after the verdict is fixed: why the evidence disagrees, a customer update and a nudge for the owner, each claim cited." },
];

const MODELS = [
  { role: "Triage", name: "Nemotron 3 Nano", id: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" },
  { role: "Extract", name: "Nemotron 3 Super", id: "nvidia/nemotron-3-super-120b-a12b" },
  { role: "Explain", name: "Nemotron 3 Ultra", id: "nvidia/Nemotron-3-Ultra-550b-a55b" },
];

function EvidenceCard() {
  return (
    <figure className="lp-card" aria-label="Example evidence brief for Northstar's audit log export">
      <div className="lp-card-top"><span>PL-101 <span aria-hidden="true">/</span> EVIDENCE BRIEF</span><span className="lp-badge gap"><span aria-hidden="true" />Delivery gap</span></div>
      <h3>Audit log export</h3>
      <p className="lp-card-meta">Northstar · promised by Maya Chen · due Sep 14</p>
      <blockquote className="lp-quote"><Quote size={13} aria-hidden="true" />Maya Chen: I will make audit log export available to Northstar by 2026-09-14.<cite>Meeting · SRC-01</cite></blockquote>
      <ul className="lp-checks" aria-label="Delivery checks">
        <li className="pass"><span><Check size={13} aria-hidden="true" /></span>Built</li>
        <li className="fail"><span><X size={13} aria-hidden="true" /></span>Enabled</li>
        <li className="unknown"><span aria-hidden="true">?</span>Verified</li>
      </ul>
      <div className="lp-conflict"><Globe size={14} aria-hidden="true" /><div><strong>Publicly GA ≠ usable by this customer</strong><span>Vendor changelog: “Audit log export is generally available (2026-09-12).”</span></div></div>
      <p className="lp-reality"><span>THE REALITY</span>The customer-specific audit_export entitlement is disabled. Don’t send the delivery email yet.</p>
      <p className="lp-card-foot"><LockKeyhole size={12} aria-hidden="true" />Draft for your review. Never sent automatically.</p>
    </figure>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="lp-nav">
        <Link href="/" className="lp-brand" aria-label="Promise Ledger home"><span className="lp-brand-mark"><Layers3 size={19} strokeWidth={1.9} aria-hidden="true" /></span><span className="lp-brand-word">promise<span>ledger</span></span></Link>
        <nav aria-label="Page sections">
          <a href="#problem">Problem</a>
          <a href="#how">How it works</a>
          <a href="#guardrails">Guardrails</a>
          <a href="#nemotron">Nemotron on Nebius</a>
        </nav>
        <div className="lp-nav-actions">
          <a className="lp-icon-link" href={REPO} aria-label="Source code on GitHub"><GithubMark /></a>
          <ThemeToggle className="lp-icon-link" />
          <Link className="lp-button primary small" href="/app">Try it live<ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow"><span aria-hidden="true" />THE CUSTOMER REALITY CHECK</p>
            <h1 id="hero-title">Promises made. <em>Truth checked.</em></h1>
            <p className="lp-lead">Engineering closed the ticket. Can the customer actually use it? Promise Ledger checks every customer promise against customer-specific evidence, shows the gap, and drafts an honest update for you to approve.</p>
            <div className="lp-cta">
              <Link className="lp-button primary" href="/app"><Sparkles size={16} aria-hidden="true" />Try it live</Link>
              <a className="lp-button secondary" href="#how">See how it works<ArrowRight size={15} aria-hidden="true" /></a>
            </div>
            <p className="lp-hero-note">No sign-up. Four fictional sample accounts. Live runs are rate-limited; the reference replay is always free.</p>
            <p className="lp-powered"><Gauge size={15} aria-hidden="true" /><span>Powered by <strong>NVIDIA Nemotron</strong> on <strong>Nebius Token Factory</strong></span></p>
          </div>
          <EvidenceCard />
        </section>

        <section className="lp-section" id="problem" aria-labelledby="problem-title">
          <p className="lp-eyebrow"><span aria-hidden="true" />THE PROBLEM</p>
          <h2 id="problem-title">“Done” in engineering is not <em>delivered to the customer.</em></h2>
          <p className="lp-section-lead">A customer-success manager has to answer one question honestly: can I tell this customer we delivered what we promised? The systems they read each tell a different part of the story.</p>
          <div className="lp-grid three">
            <article className="lp-tile"><span className="lp-tile-kind">Engineering ticket</span><blockquote>“ENG-428 audit log export: implementation complete; built=true.”</blockquote><p>The ticket closed. Its definition of done stops at the merge, not at this customer’s workspace.</p></article>
            <article className="lp-tile"><span className="lp-tile-kind">Public changelog</span><blockquote>“Audit log export is generally available.”</blockquote><p>General availability says nothing about one customer’s plan, entitlement or feature flag.</p></article>
            <article className="lp-tile warn"><span className="lp-tile-kind">The customer</span><blockquote>“The audit export button is still missing in our Northstar workspace.”</blockquote><p>Send the “it’s live” email now and you spend trust you can’t easily win back.</p></article>
          </div>
        </section>

        <section className="lp-section" id="approach" aria-labelledby="approach-title">
          <p className="lp-eyebrow"><span aria-hidden="true" />THE APPROACH</p>
          <h2 id="approach-title">Models read. Rules decide. <em>People send.</em></h2>
          <div className="lp-grid three">
            <article className="lp-principle"><span className="lp-principle-icon"><Quote size={18} aria-hidden="true" /></span><h3>Models read</h3><p>NVIDIA Nemotron models triage the sources, extract promises and explain disagreements. Every claim cites source text, checked character for character.</p></article>
            <article className="lp-principle"><span className="lp-principle-icon"><Scale size={18} aria-hidden="true" /></span><h3>Rules decide</h3><p>Built, enabled and customer-verified are separate facts. A deterministic policy sets every verdict, and no model can change one.</p></article>
            <article className="lp-principle"><span className="lp-principle-icon"><FileCheck2 size={18} aria-hidden="true" /></span><h3>People send</h3><p>Drafts are editable and approved locally. Export exists; sending does not. A closed ticket never earns a green badge on its own.</p></article>
          </div>
        </section>

        <section className="lp-band" id="how" aria-labelledby="how-title">
          <div className="lp-band-inner">
            <p className="lp-eyebrow on-dark"><span aria-hidden="true" />HOW IT WORKS</p>
            <h2 id="how-title">One run. Four steps. <em>Three Nemotron models.</em></h2>
            <p className="lp-section-lead">The live agent view streams every step as it happens: the model, latency, tokens, estimated cost, and each cited quote with its exact-match check.</p>
            <ol className="lp-steps">
              {STEPS.map((step) => (
                <li key={step.n} className={step.n === "03" ? "rules" : ""}>
                  <span className="lp-step-n">{step.n}</span>
                  <h3>{step.name}</h3>
                  <span className="lp-step-model">{step.model}</span>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
            <h3 className="lp-band-sub">Evidence the rules can weigh</h3>
            <div className="lp-grid three">
              <article className="lp-evidence"><ClipboardPaste size={18} aria-hidden="true" /><h4>Sample packs or your own evidence</h4><p>Meeting notes, tickets and availability snapshots. Paste text or drop .txt, .md, .csv or .eml files; you confirm every extracted fact before the rules read it.</p></article>
              <article className="lp-evidence"><Globe size={18} aria-hidden="true" /><h4>Public claims · Tavily Extract</h4><p>Fetches the vendor’s public changelog at runtime and shows it beside the verdict: “Publicly GA ≠ usable by this customer”. It never changes the verdict.</p></article>
              <article className="lp-evidence"><Bug size={18} aria-hidden="true" /><h4>Runtime errors · error monitoring</h4><p>Errors for this customer and feature after acceptance lower “verified” to “needs verification”. A quiet error feed never proves delivery.</p></article>
            </div>
          </div>
        </section>

        <section className="lp-section" id="guardrails" aria-labelledby="guardrails-title">
          <p className="lp-eyebrow"><span aria-hidden="true" />GUARDRAILS</p>
          <h2 id="guardrails-title">Checked before you ever see a draft.</h2>
          <ul className="lp-guardrails">
            <li><ShieldCheck size={17} aria-hidden="true" /><div><strong>Exact quotes only</strong><span>Every cited quote is matched against its source as it streams. “Not in source” is shown, not hidden.</span></div></li>
            <li><ShieldCheck size={17} aria-hidden="true" /><div><strong>No new dates or promises</strong><span>Customer updates cannot add a date, a timeframe or “will be enabled” that the evidence doesn’t contain.</span></div></li>
            <li><ShieldCheck size={17} aria-hidden="true" /><div><strong>No verdict changes</strong><span>Ultra writes after the rules decide, with no verdict field to fill in. Contradicting the facts is rejected.</span></div></li>
            <li><ShieldCheck size={17} aria-hidden="true" /><div><strong>Visible fallbacks</strong><span>A brief that fails a check becomes a labelled template draft, with the exact reason on screen.</span></div></li>
            <li><ShieldCheck size={17} aria-hidden="true" /><div><strong>Bounded cost</strong><span>Each live run reserves its worst case before any model call, under a $0.05 per-run ceiling and shared rate limits.</span></div></li>
            <li><ShieldCheck size={17} aria-hidden="true" /><div><strong>Nothing sends</strong><span>No email or CRM write exists. Approval is local, and export is the only way out.</span></div></li>
          </ul>
        </section>

        <section className="lp-section lp-nemotron" id="nemotron" aria-labelledby="nemotron-title">
          <div>
            <p className="lp-eyebrow"><span aria-hidden="true" />POWERED BY</p>
            <h2 id="nemotron-title">NVIDIA Nemotron on <em>Nebius Token Factory.</em></h2>
            <p className="lp-section-lead">Three open NVIDIA Nemotron models, served by Nebius Token Factory’s inference API, each do one job. The browser never sees a key; every call runs server-side with a strict schema and a budget.</p>
            <dl className="lp-stats">
              <div><dt>Full live run</dt><dd>16–20 s</dd></div>
              <div><dt>Estimated cost per run</dt><dd>≈ $0.01</dd></div>
              <div><dt>Frozen held-out cases</dt><dd>32 / 32</dd></div>
            </dl>
            <p className="lp-fineprint">Measured in September 2026 on synthetic data: a four-run pipeline smoke test and a small assistant-authored evaluation of the Super extraction step. Not a real-world accuracy claim.</p>
          </div>
          <ul className="lp-models" aria-label="Models in the pipeline">
            {MODELS.map((model) => <li key={model.id}><span>{model.role}</span><strong>{model.name}</strong><code>{model.id}</code></li>)}
          </ul>
        </section>

        <section className="lp-section" id="try" aria-labelledby="try-title">
          <p className="lp-eyebrow"><span aria-hidden="true" />TRY IT</p>
          <h2 id="try-title">Four fictional customers. <em>One reality check.</em></h2>
          <div className="lp-grid four">
            {SAMPLE_ACCOUNTS.map((pack) => (
              <a key={pack.id} className="lp-account" href={`/app?account=${pack.id}`}>
                <span className="lp-account-top"><span className="lp-avatar" aria-hidden="true">{pack.initials}</span><span><strong>{pack.name}</strong><small>{pack.industry}</small></span></span>
                <span className="lp-account-body">{pack.situation}</span>
                <span className="lp-account-go">Open {pack.name}<ArrowRight size={14} aria-hidden="true" /></span>
              </a>
            ))}
          </div>
          <div className="lp-honest" role="note">
            <CircleAlert size={18} aria-hidden="true" />
            <div>
              <strong>Honest about what this is</strong>
              <p>Every customer, person and document in the samples is fictional, and snapshots are fixed at September 13, 2026. No real CRM, support desk or customer system is connected. Reference mode replays a hand-labelled trace with no AI calls and says so on screen. Evidence you bring stays in your browser until you run a check; a live run sends it to Nebius for inference.</p>
            </div>
          </div>
          <div className="lp-final">
            <Link className="lp-button primary" href="/app"><Sparkles size={16} aria-hidden="true" />Try it live</Link>
            <a className="lp-button secondary" href={REPO}><GithubMark size={15} />Read the source</a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="lp-brand small"><span className="lp-brand-mark"><Layers3 size={15} strokeWidth={1.9} aria-hidden="true" /></span><span className="lp-brand-word">promise<span>ledger</span></span></span>
        <span>Built for the Nebius × NVIDIA Global AI Hackathon · MIT licensed</span>
        <nav aria-label="Footer">
          <Link href="/app">Open the app</Link>
          <a href={REPO}>GitHub<ArrowUpRight size={12} aria-hidden="true" /></a>
          <Link href="/changelog">Fictional vendor changelog</Link>
        </nav>
      </footer>
    </div>
  );
}
