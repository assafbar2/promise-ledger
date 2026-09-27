import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Layers3 } from "lucide-react";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="not-found-mark" aria-hidden="true"><Layers3 size={22} strokeWidth={1.8} /></span>
      <p className="eyebrow"><span />404 · NOT FOUND</p>
      <h1>No promise at this address.</h1>
      <p>The page you asked for doesn’t exist. The demo and its four sample accounts are one click away.</p>
      <div className="not-found-actions">
        <Link className="button primary" href="/app">Open the app<ArrowRight size={14} aria-hidden="true" /></Link>
        <Link className="button secondary" href="/">Back to the home page</Link>
      </div>
    </main>
  );
}
