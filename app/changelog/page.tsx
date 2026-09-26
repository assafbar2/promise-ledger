import type { Metadata } from "next";
import { PUBLIC_CHANGELOG, PUBLIC_CHANGELOG_INTRO, PUBLIC_VENDOR, releasedOn } from "../../lib/public-claims/changelog";

export const metadata: Metadata = {
  title: `${PUBLIC_VENDOR} changelog (fictional)`,
  description: "Synthetic public changelog for the fictional vendor in the Promise Ledger demo.",
  robots: { index: false, follow: false },
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-sans text-slate-800">
      <h1 className="text-2xl font-semibold">{PUBLIC_VENDOR} changelog</h1>
      {PUBLIC_CHANGELOG_INTRO.map((sentence) => <p key={sentence} className="mt-3 text-sm text-slate-600">{sentence}</p>)}
      {PUBLIC_CHANGELOG.map((entry) => (
        <section key={entry.release} className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-lg font-medium">{entry.heading}</h2>
          <p className="text-xs text-slate-500">Released <time dateTime={entry.date}>{releasedOn(entry.date)}</time></p>
          {entry.sentences.map((sentence) => <p key={sentence} className="mt-2">{sentence}</p>)}
        </section>
      ))}
    </main>
  );
}
