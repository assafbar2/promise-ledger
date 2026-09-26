// Synthetic public content for the fictional vendor in the demo story. It is served at
// /changelog so Tavily can fetch it at runtime from the app's own allowlisted domain.
// Every sentence is a complete claim on its own so exact quotes stay short and dated.

export const PUBLIC_VENDOR = "Acme Workspace";
export const PUBLIC_CHANGELOG_PATH = "/changelog";

export type ChangelogEntry = { release: string; date: string; heading: string; sentences: string[] };

export const PUBLIC_CHANGELOG_INTRO = [
  "Acme Workspace is a fictional vendor. This page is synthetic demo content for Promise Ledger and describes no real product.",
  "Availability for an individual workspace depends on its plan and entitlements.",
];

export function releasedOn(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}

/** The page's visible text, one block per line, as Tavily Extract returns it in `text` format. */
export function changelogText() {
  return [
    `${PUBLIC_VENDOR} changelog`,
    ...PUBLIC_CHANGELOG_INTRO,
    ...PUBLIC_CHANGELOG.flatMap((entry) => [entry.heading, `Released ${releasedOn(entry.date)}`, ...entry.sentences]),
  ].join("\n");
}

export const PUBLIC_CHANGELOG: ChangelogEntry[] = [
  {
    release: "2.14",
    date: "2026-09-12",
    heading: "Release 2.14",
    sentences: [
      "Audit log export is generally available (2026-09-12).",
      "Admins can export workspace audit logs as CSV or JSON from Settings.",
    ],
  },
  {
    release: "2.13",
    date: "2026-08-20",
    heading: "Release 2.13",
    sentences: [
      "SCIM provisioning is in public beta (2026-08-20) and is not generally available yet.",
      "EU data residency is planned; no release date has been announced.",
    ],
  },
  {
    release: "2.11",
    date: "2026-06-02",
    heading: "Release 2.11",
    sentences: [
      "SAML single sign-on is generally available (2026-06-02).",
    ],
  },
];
