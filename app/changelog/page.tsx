import type { Metadata } from "next";
import { PUBLIC_CHANGELOG, PUBLIC_CHANGELOG_INTRO, PUBLIC_VENDOR, releasedOn } from "../../lib/public-claims/changelog";

export const metadata: Metadata = {
  title: `${PUBLIC_VENDOR} changelog (fictional)`,
  description: "Synthetic public changelog for the fictional vendor in the Promise Ledger demo.",
  robots: { index: false, follow: false },
};

export default function ChangelogPage() {
  return (
    <main className="changelog">
      <h1>{PUBLIC_VENDOR} changelog</h1>
      {PUBLIC_CHANGELOG_INTRO.map((sentence) => <p key={sentence} className="changelog-intro">{sentence}</p>)}
      {PUBLIC_CHANGELOG.map((entry) => (
        <section key={entry.release}>
          <h2>{entry.heading}</h2>
          <p className="changelog-date">Released <time dateTime={entry.date}>{releasedOn(entry.date)}</time></p>
          {entry.sentences.map((sentence) => <p key={sentence} className="changelog-claim">{sentence}</p>)}
        </section>
      ))}
    </main>
  );
}
