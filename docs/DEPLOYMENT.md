# Promise Ledger — Vercel deployment

## Identity and access

- Project: **promise-ledger**, in the owner's existing **Hobby** workspace, verified September 20, 2026.
- Assigned production domain: **https://promise-ledger-chi.vercel.app**. Vercel assigned the suffix; the project and product names remain Promise Ledger.
- Repository: `assafbar2/promise-ledger`, **private**; its `main` branch is connected to this project.
- Publication state: **production deployment succeeded September 20, 2026**. Anonymous HTTP verification passed at 22:59 UTC (3:59 p.m. Pacific): homepage, six static assets, status, all three reference scenarios, live-disabled failure, and cross-origin rejection. See the [saved smoke report](DEPLOYMENT-SMOKE-2026-09-20.json).
- No plan upgrade, paid add-on, database, storage service, custom-domain purchase, or change to other projects is part of this release.

Share **https://promise-ledger-chi.vercel.app**, which was tested without cookies and does not require a Vercel login. The generated team/branch deployment aliases redirect to Vercel authentication; do not use those as the demo link. Existing preview protection was preserved.

## Hosted functionality

The first release is a **reference-only synthetic demo**. Run evidence checks, switch among three scenarios, inspect original sources, prepare/edit/approve drafts, and export. Refreshing clears session state. Nothing sends to a customer.

No Nebius key or demo token is configured on Vercel. `/api/status` must report `liveConfigured: false`; live requests must fail explicitly without calling a provider. This avoids publishing the exposed key or consuming provider credits during a public rehearsal. Do not present this release as hosted live AI or as the complete qualifying hackathon entry.

Before enabling hosted inference: rotate the exposed key with owner approval, verify free credit and stop-usage protection, establish bounded access, and rehearse both six-document live scenarios. The evaluation CLI budget does not protect the app's endpoint. Never put provider keys in chat, browser inputs, Git, build arguments, recordings, or client code.

## Build and release

```bash
npm ci
npm run check
npm run eval
npm run test:vercel
```

The existing local/Worker scripts remain unchanged. `build:vercel` selects the pinned Nitro adapter and writes Vercel Build Output API files to `.vercel/output`. `test:vercel` exercises the compiled function, all three reference scenarios, and fail-closed live/cross-origin access.

The Vercel branch bundles Tailwind's CSS dependency in the RSC/SSR environments: otherwise the adapter externalizes it and Vite tries to read a module name as a filesystem path. The function has a 75-second execution limit; the provider timeout is 60 seconds. Neither is a spending cap.

`vercel.json` specifies the dedicated build command and no Next.js framework preset. `.vercelignore` excludes every local environment file, dependencies, previous outputs, and scratch work. CLI linking can append a Vercel OIDC token to ignored `.env.local`; preserve permissions 0600. No local environment file may be uploaded.

Before publication, run tests, a full dependency audit, source/bundle secret scans, and an upload preview. After publication, test the production URL without Vercel cookies, reference API results, static assets, and missing-key live failure. Keep GitHub private until the owner separately authorizes public source.

## Recording and submission boundary

The [recording script](DEMO-SCRIPT.md) contains 300 spoken words, targeting 2:45 with pauses. Live footage and narration will be captured and synchronized separately; no video is recorded or uploaded by this deployment work.

The final entry needs real NVIDIA-on-Nebius use as well as working test access. A video alone is insufficient. Judges must not need the owner's Vercel login. Free live access must last through December 15, 2026, at noon Pacific; current trial credits do not establish that future availability.
