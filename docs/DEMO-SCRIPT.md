# Promise Ledger — final video script

**Creative lock: September 20, 2026. Target: 2:45; hard ceiling: under 3:00 including credits.**

**The story:** a customer-success manager is one update away from calling something delivered. Promise Ledger catches the gap, explains it, and helps them send the truth instead.

**The line to remember:** A closed ticket is not a kept promise.

This is the recording script, not a claim that footage or narration has been captured. The live scenes require genuine, successful NVIDIA-on-Nebius runs. The hosted reference demo is useful for rehearsal but must never stand in for live extraction footage.

## Narration — read verbatim

### 00:00–00:18 · What we built

We built Promise Ledger to help customer-success teams answer one question: did we actually deliver what we promised?

Because a closed engineering ticket is not a kept customer promise.

### 00:18–00:38 · The customer problem

Meet Northstar, our fictional customer. Their security review needs audit exports. Engineering says done. But their access is disabled, and the export button is missing.

A confident “it's shipped” update would be wrong. Promise Ledger catches that gap before the update goes out.

### 00:38–01:02 · The real AI workflow

Let's run the evidence check.

NVIDIA Nemotron 3 Super, running on Nebius Token Factory, extracts commitments and quotations from six synthetic source documents. Our server checks those quotations against the originals.

Here are the actual model, run identifier, and token usage—not a canned response.

### 01:02–01:25 · The proof, not just the answer

Open the evidence trail. Here's the promise. Here's the completed engineering work. And here's Northstar's disabled access.

Built, enabled, and customer-verified are separate checks. Deterministic rules—not the language model—decide the delivery status.

The verdict: delivery gap. Built does not mean delivered.

### 01:25–01:51 · Turn evidence into action

Now prepare the customer update. The template says implementation is complete, but access is still pending. It doesn't invent a new delivery date.

I review the evidence, edit the wording, approve, and export. Nothing sends automatically. Change an approved draft, and the approval clears.

### 01:51–02:13 · Show that the result can change

Now switch to the scenario where access is enabled and Northstar's acceptance test passed. Run the check again.

Now it's verified delivered. Not because the model sounds more confident—because the evidence changed. The old approval is cleared, too.

### 02:13–02:34 · Measured evidence and honest limits

In a separate extraction evaluation, we recorded seven of eight development matches and thirty-two of thirty-two frozen held-out matches, with latency, usage, and run identifiers saved.

These are small synthetic tests, not proof of production accuracy. The missed development case is documented.

### 02:34–02:45 · Close

Promise Ledger turns scattered promises into evidence-backed customer updates.

Not another confident summary. A check before you say “delivered.”

## Shot list — synchronize footage to these beats

| Time | Capture | Direction |
| --- | --- | --- |
| 00:00 | Product name, Northstar workspace, ledger | Start inside the real product. No logo animation or long intro. Keep “Synthetic demo” visible. |
| 00:12 | Gap banner | Overlay: **A closed ticket ≠ a kept promise.** Let the sentence land. |
| 00:18 | Audit-export row and **Inspect the gap** | Briefly show the engineering completion and disabled entitlement. Do not simulate an actual email being sent. |
| 00:38 | **Run evidence check** | Select **Nebius + NVIDIA Nemotron** and enter the separate demo token before the take. Keep the token and settings off camera. The initial reference label must not be relabeled as live. |
| 00:48 | Successful result and provenance | Show **Live Nemotron run**, actual model/run details and usage only after a real response. If the wait is shortened, overlay **Inference wait shortened**; don't present edit duration as latency. |
| 01:02 | **Audit log export** → **Evidence trail** | Hold readable quotations on screen. Highlight built=true, enabled=false, verified=false in sequence. Use a gentle crop, not frantic scrolling. |
| 01:25 | **Prepare customer update** | Keep the draft readable. Overlay **Template draft · human review · no automatic sending**. |
| 01:34 | Edit → **Approve this draft** → **Export approved draft** | Record the real export. Then make one short wording change and show approval clearing. Leave the downloaded file and its path out of the take. |
| 01:51 | **Enabled + customer verified** → **Run evidence check** | Return to the ledger. Capture a second successful live call, then the verified verdict and cleared review state. Do not splice in reference output. |
| 02:13 | Evaluation evidence card | Show **Development 7/8 · frozen held-out 32/32 · synthetic exact-match extraction cases · one development mismatch**. Credit the September 19 run. Keep both scores equally visible. |
| 02:34 | Back to the ledger and product name | End card: **Promise Ledger — A check before you say “delivered.”** Add only a verified testing link and an approved public-source link; omit any unavailable link. |

## Recording direction

- Warm, clear, assured delivery; not a sales-announcer voice. Slow slightly for “Built does not mean delivered” and the closing line.
- Use a clean 16:9 desktop capture, ideally 1920×1080. Enlarge text enough that the evidence is readable at normal video playback size.
- Record narration as eight separate takes matching the sections. Leave clean room before and after each take for synchronization. Use the actual read duration to adjust edit points; timestamps are targets, not permission to rush.
- Keep pointer motion deliberate. Give each verdict a moment to register. Avoid rapid zooms, unnecessary transitions, unrelated tabs, console windows, account pages, and notifications.
- Prefer clean voice without background music. Include checked English captions and pronounce the product **Promise Ledger**, the provider **Nebius**, and the model **Nemotron** consistently.
- If running long, shorten the evaluation sentence before cutting the evidence trail or human-review interaction. Never exceed the event's three-minute limit.

## Capture gates — complete before recording the live scenes

- [ ] Rotate the exposed provider credential with owner approval; never reuse it on a public deployment.
- [ ] Reverify free credit, prices, and **Stop usage after trial**. No top-up, paid rollover, or paid service is authorized. The evaluation CLI budget does not protect the app's live endpoint.
- [ ] Configure a distinct demo-access token and perform both complete six-document live UI runs successfully. Save their actual provenance; the separate 40-case evaluation is not proof these UI scenes work.
- [ ] Rehearse approve → export → edit-clears-approval and new-analysis-clears-review against the exact build being filmed.
- [ ] Remove provider credentials, demo tokens, account menus, and private material from every recorded frame. Enter the demo token off camera; never enter the provider key in the browser.
- [ ] Keep the fixed synthetic snapshot, fictional customer, template drafts, session-only approvals, and lack of outbound sending truthful. Do not claim live CRM integration, real customers, retention gains, production accuracy, or measured time savings.
- [ ] Time the exported video, review the captions, and verify it plays publicly on YouTube while signed out. Upload and final submission require owner authorization.

## Evidence and submission requirements

Evaluation evidence: [September 19 results](evaluation/LIVE-RESULTS-2026-09-19.md). The model received 40 requests: seven exact development matches, one development mismatch, 32 frozen held-out matches, and no provider/validation errors. Do not tune against the observed holdout.

Requirements were checked September 20, 2026 against the [official rules](https://nebiusglobalaihackathon.devpost.com/rules#4-how-to-enter) and [What to Submit](https://nebiusglobalaihackathon.devpost.com/). The video must show the functioning project and explain the NVIDIA/Nebius integration aloud. It does not replace working judge access, public licensed source, or the rest of the submission.
