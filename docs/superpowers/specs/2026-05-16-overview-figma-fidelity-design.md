# Overview Figma Fidelity Design

**Created:** 2026-05-16  
**Status:** Design contract for the next Overview fidelity implementation sequence  
**Scope:** Chronoscope Overview only  
**Decision:** The Figma Overview concept is the visual contract. Chronoscope's evidence model, real data, and trust-safe copy remain the product contract.

---

## Purpose

The current live Overview matches the rough information architecture of the Figma concept, but it does not match the concept's quality. It feels structurally translated instead of visually designed.

This spec defines how to move the Overview from "same general components" to "agency-signoff faithful." The goal is not to make a screenshot-perfect static clone. The goal is a real Svelte Overview that preserves Chronoscope's measurement and trust boundaries while matching the Figma concept's composition, hierarchy, density, depth, and polish.

The target outcome:

> A first-time visitor should immediately feel that Chronoscope is a premium diagnostic instrument, not a dark dashboard with improved panels.

## Reference Inputs

Primary visual reference:

- User-provided Figma Overview screenshots in the 2026-05-16 conversation.
- Frozen Figma reference artifacts under `docs/artifacts/figma-alignment-reference/screenshots/overview-*.png`.
- Existing acceptance contract: `docs/vision/figma-alignment-acceptance-spec.md`.

Current live evidence:

- `https://chronoscope.dev/` captured at `2048x1000` on 2026-05-16.
- Live screenshot artifact generated during review: `/tmp/chronoscope-live-overview-2048-settled.png`.

The implementation must compare against the Figma screenshots and the current live screenshot before merging. The laptop reference is the most important first pass because it shows the full Overview composition at a common browser size without relying on a tall monitor.

## What 100% Means

### 100% Structural Fidelity

The real Overview must match the Figma concept in:

- Top app bar anatomy and relative height.
- Secondary navigation row anatomy and relative height.
- Brand placement, nav placement, and primary run-control placement.
- First-viewport composition: hero card first, lower endpoint/event grid visible beneath it.
- Hero card width, height, alignment, and internal two-column balance.
- Score ring as a supporting module, not a dominant instrument.
- Verdict content order: status badge, headline, measured fact, interpretation, primary CTA, secondary evidence CTA.
- Lower section order: measured endpoints on the left, event log on the right at desktop.
- Mobile hierarchy: top bar, navigation, verdict card, measured endpoints, event log, with no horizontal page overflow.

Reference layout targets:

- At `1440x900`, top app bar is approximately `72px` tall and secondary nav is approximately `68px` tall.
- At `1440x900`, the hero card starts around `142px` from the top, is horizontally centered, and spans approximately `1020px` wide by `350px` tall.
- At `1440x900`, the lower grid begins within roughly `36px` below the hero card and remains visible in the first viewport.
- At desktop/laptop widths, measured endpoints occupy the wider left column and event log occupies the narrower right column.
- At `2048x1330`, the same proportions scale up without making the hero feel small or the lower grid feel detached.
- At `390x844`, the Overview stacks without horizontal page scroll and without hiding the primary run action.

### 100% Visual Fidelity

The real Overview must match the Figma concept in:

- Dark atmospheric page background with subtle depth, not a flat black canvas.
- Larger, more confident hero card presence.
- Softer surface treatment with a visible but restrained border.
- Clear cyan active state, amber degraded state, green healthy state, rose failure state.
- Premium button styling: gradient primary CTA, strong Start/Stop control, precise icon spacing.
- Cleaner typography rhythm: readable sans for product language, mono only for endpoint/timing/status technical labels.
- Endpoint rows that are large enough to scan and compare.
- Sparklines that are visibly meaningful at default desktop scale.
- Event log that reads as a human timeline, not internal diagnostic noise.
- Consistent icon weight, color, and optical alignment.

### Allowed Deviations

Chronoscope may intentionally differ from the Figma screenshot only when the difference improves product truth or preserves real functionality:

- Real endpoint names may differ from prototype endpoint names.
- Real measured values may differ from prototype values.
- Copy must remain evidence-bound and may be less causal than the Figma text.
- Healthy, collecting, degraded, and failure states must all be designed, even if the Figma screenshot mostly shows degraded.
- Secondary controls may exist if Chronoscope needs them, but they must be visually subordinate and not clutter the shell.
- Report remains a top-level nav item because it is now part of the accepted product IA.

### Disallowed Deviations

The implementation fails fidelity if:

- The page still reads as a flat dark dashboard.
- The hero card looks smaller, weaker, or less intentional than Figma.
- Navigation includes decorative numeric suffixes.
- Top-right controls feel like unexplained debug or utility buttons.
- The primary CTA in a healthy state is awkward or lower-value than the secondary action.
- Endpoint rows include a large global axis that visually competes with row content.
- The event log primarily exposes internal collection messages instead of a concise user timeline.
- Desktop first viewport has excessive empty top space or cramped lower content.
- Mobile has horizontal page overflow, clipped controls, or a dial-first first viewport.

## Surface Design

### 1. Shell

The shell should feel like the Figma concept:

- Brand mark and `CHRONOSCOPE` left-aligned in the top app bar.
- Primary Start/Stop action on the far right.
- Settings on the far right as a single quiet icon.
- Endpoint/share/run details controls remain available but must not visually compete with Start/Stop.
- Secondary nav row contains `Overview`, `Live`, `Investigate`, `Report`.
- Remove nav index numbers.
- Active tab gets the Figma-style cyan underline and darker active background.

The top bar should be calmer than the live version. The current cluster of three square icon buttons plus a pink Stop button makes the app feel technical and provisional. The new shell should either:

- Combine secondary controls behind one compact details/menu control, or
- Restyle them as lower-emphasis icon buttons with clear labels/tooltips and Figma-consistent geometry.

### 2. Hero Verdict Card

The hero is the main product moment. It must carry the page.

Required anatomy:

1. Score ring column.
2. Status badge row.
3. Headline.
4. Measured fact.
5. Interpretation.
6. Primary CTA.
7. Secondary evidence CTA.

Sizing and rhythm:

- Desktop card should be visually closer to the Figma screenshot: broad, centered, and tall enough to breathe.
- The score ring should sit optically centered in the left third of the card.
- Text should sit in the right two-thirds of the card with a wide readable line length.
- The headline should be large but not wrap awkwardly for common healthy/degraded/collecting states.
- Card padding should make the content feel deliberate, not mechanically centered.
- At `1440x900`, the hero should not leave the lower grid pushed out of sight for the default four-endpoint state.
- At `1440x900`, the hero content block should align similarly to the reference: score ring left, status/headline/copy/actions right, with the primary CTA below the text rather than drifting low or shrinking.

Copy rules:

- Keep "Measured Fact" and "Interpretation" labels because they reinforce trust.
- Replace awkward inline confidence wording with cleaner evidence-bound phrasing.
- Do not say Wi-Fi, ISP, route, DNS, TLS, API, or server is likely fine/broken unless the evidence model supports it.
- Healthy state should lead with a share/view-evidence action, not a vague diagnostic action.
- Collecting state should avoid implying certainty before enough samples exist.

State examples:

- Healthy headline: `This test looks healthy.`
- Healthy measured fact: `Clean browser-visible run: successful checks across all measured sites.`
- Healthy interpretation: `Chronoscope has not seen a meaningful slowdown or failure in this window.`
- Degraded headline: `One endpoint is slower than the others from your browser.`
- Degraded measured fact: `Your browser is reaching the other measured sites normally, but <endpoint> is showing repeated latency spikes.`
- Degraded interpretation: `That points to this browser path or that endpoint. An outside check can help separate local-path evidence from broader service evidence.`
- Collecting headline: `Collecting enough data to call this test.`
- Collecting interpretation: `Chronoscope needs a few successful checks before it can compare endpoints responsibly.`

### 3. Score Ring

The score ring should support the verdict without becoming the old app's dominant dial.

Requirements:

- Keep the compact Figma-style ring.
- Use stronger cyan/green/amber/rose state coloring.
- Remove excessive glow or heavy chronograph styling.
- Keep the score explanation short and accurate.
- Avoid "Based on aggregate latency" unless the score explanation truly maps to that phrase.

### 4. Measured Endpoints

Measured endpoints must become cleaner and more readable.

Requirements:

- Remove or demote the global axis row that currently sits above the endpoint cards.
- Each row includes status icon, endpoint label, short status phrase, compact sparkline, latency, and variation/delta.
- Row height should be closer to Figma: generous enough to scan but dense enough for four default endpoints.
- Endpoint labels should be visually strong but not oversized.
- Supporting phrases should be plain and compact.
- Sparklines should be larger and clearer than the current live version.
- Latency and variation should align consistently on the right.

Allowed timeline signal:

- A compact per-row time signal is allowed if it does not introduce global chart clutter.
- If a shared timeline axis remains, it must be visually subordinate and not consume the section header.

### 5. Event Log

The event log should feel like a digest of what happened, not debug telemetry.

Requirements:

- Desktop event log stays to the right of measured endpoints.
- Entries use readable event language with timestamps.
- Healthy runs should avoid empty or self-referential messages like `No meaningful changes...` as the dominant content.
- Collection state may show that samples are being gathered, but this should not feel like an error or internal state dump.
- Provide one compact action to view the evidence trail.
- Use color only to encode meaningful event severity or endpoint identity.

Example event language:

- `Run started from this browser`
- `All measured sites stayed within the current threshold`
- `<endpoint> latency spiked above <threshold>`
- `<endpoint> timed out at the browser limit`
- `Outside check captured a clean comparison`

### 6. Background And Depth

The page background is a major part of the Figma quality gap.

Requirements:

- Preserve a deep near-black base.
- Add restrained blue/teal/purple depth across the page like the concept.
- Do not add discrete decorative blobs or obvious gradient orbs.
- Hero and lower panels should blend into the atmosphere while keeping readable borders.
- Avoid one-note cyan-on-black styling.

### 7. Mobile

Mobile must be designed, not compressed.

Requirements:

- No horizontal page overflow at `375px`, `390px`, or `430px`.
- Top controls remain understandable and reachable.
- Nav can horizontally scroll only if active item and primary action remain obvious.
- Hero card stacks score, verdict, and actions in a readable order.
- Endpoint rows remain legible without forcing table-style horizontal scrolling.
- Event log follows measured endpoints unless a future mobile tab treatment is explicitly approved.

## Implementation Architecture

Stay in the current Svelte stack.

Likely files:

- `src/lib/components/FigmaOverviewView.svelte`
- `src/lib/components/Topbar.svelte`
- `src/lib/components/ViewSwitcher.svelte`
- `src/lib/components/StatusOverview.svelte` if still used by current routing
- `src/lib/tokens.ts`
- `tests/visual/figma-alignment.spec.ts`
- `tests/visual/figma-fidelity-gate.spec.ts`
- `tests/unit/components/topbar.test.ts`
- `tests/unit/components/figma-overview-view.test.ts` if present or created

Do not add:

- React
- Tailwind
- Component libraries
- Charting libraries
- Prototype hardcoded data

Data must remain real:

- Endpoints come from the existing endpoint/measurement stores.
- Verdict state comes from existing diagnostic narrative/scoring utilities.
- Remote/local proof CTAs wire into existing proof flows.
- Share/report actions use existing share/report utilities.

## PR Sequence

### PR 1: Overview Fidelity Contract And Tests

Goal:

- Make the visual target executable enough that future PRs cannot pass while obviously drifting.

Scope:

- Add this spec.
- Add or update deterministic Overview screenshot coverage.
- Add assertions for no nav numbers, correct top-level nav labels, and no horizontal overflow.
- Add screenshot capture instructions to the PR template or test output if needed.

Merge gate:

- Typecheck, lint, unit tests, build, targeted visual tests.
- Local live screenshot compared against reference and current live screenshot.

### PR 2: Shell Fidelity

Goal:

- Make the shell look like the Figma shell.

Scope:

- Top app bar proportions.
- Secondary nav proportions.
- Remove nav index numbers.
- Simplify top-right controls.
- Restyle Start/Stop.
- Preserve endpoint/share/settings/run-details functionality.

Merge gate:

- Desktop and mobile screenshots.
- Topbar/unit tests.
- Accessibility check for icon controls.

### PR 3: Hero Verdict Fidelity

Goal:

- Rebuild the hero card as the first-viewport centerpiece.

Scope:

- Hero card width, height, padding, and background treatment.
- Score ring scale and placement.
- Healthy/degraded/collecting/failure state copy hierarchy.
- Primary/secondary CTA mapping.
- Copy safety tests for new visible text.

Merge gate:

- Desktop, laptop, mobile screenshots.
- Unit tests for state/action selection.
- Copy-safety tests.

### PR 4: Endpoint And Event Fidelity

Goal:

- Make lower Overview content match Figma's clarity.

Scope:

- Endpoint row hierarchy.
- Sparkline readability.
- Remove/demote noisy global axis.
- Event log copy and visual treatment.
- Evidence trail action placement.

Merge gate:

- Deterministic degraded fixture screenshot.
- Healthy and collecting state screenshot.
- Event language unit tests.

### PR 5: Final Overview Agency Gate

Goal:

- Stop only when the Overview passes a direct visual review.

Scope:

- Side-by-side inspection of Figma reference and implementation.
- Polish spacing, colors, line heights, icon weights, button states, and responsive edge cases.
- Deploy and smoke live production.

Merge gate:

- Typecheck, lint, unit tests, build.
- Targeted visual tests.
- Axe/accessibility tests.
- Production smoke after Cloudflare deploy.
- Screenshot ledger with at least five concrete comparison points.

## Acceptance Checklist

The Overview is ready only when all of these are true:

- The first viewport unmistakably resembles the Figma Overview concept.
- The hero card feels like the centerpiece.
- The score ring is supportive, not dominant.
- Navigation has no numeric suffixes.
- Top-right controls feel designed and understandable.
- The primary CTA makes sense for healthy, degraded, collecting, and failure states.
- Endpoint rows are easier to scan than the current live version.
- Event log reads like a user timeline.
- No horizontal overflow at mobile widths.
- The copy stays more accurate than the Figma prototype.
- Live production has been smoke-tested after merge.

## Fidelity Review Ledger

Every implementation PR after this spec must include a short ledger with these comparison points:

| Point | Reference Evidence | Render Evidence | Required Result |
| --- | --- | --- | --- |
| Shell | Figma `overview-laptop-1440x900.png` top bar and nav | New `1440x900` screenshot | Same hierarchy; no nav numbers; controls visually subordinate except Start/Stop |
| Hero | Figma hero card bounds and internal balance | New `1440x900` screenshot | Card is broad, centered, atmospheric, and first-viewport dominant |
| Typography | Figma headline/body/label rhythm | New `1440x900` screenshot and computed styles if needed | Product language uses readable sans; mono is limited to technical labels/data |
| Lower Grid | Figma measured endpoints and event log | New `1440x900` screenshot | Endpoint rows and event log are visible, readable, and aligned beneath hero |
| Mobile | Figma `overview-mobile-390x844.png` | New `390x844` screenshot | Same hierarchy without horizontal page overflow |
| Truth Copy | Claim registry and diagnostic narrative tests | Unit/copy-safety output | No unsupported causal claims introduced for visual fidelity |

## Known Product-Truth Deviations From Figma

These are intentional and should not be "fixed" for visual fidelity:

- The Figma phrase implying local Wi-Fi and core ISP are likely fine is too strong for browser-only evidence in some cases. Chronoscope should use narrower evidence-bound language.
- Chronoscope should not claim an outside network check proves global availability. It is a second vantage, not universal truth.
- Chronoscope may show collecting and healthy states more often than the degraded Figma screenshot because real data determines state.
- Report remains a top-level nav item.

The default decision is to keep all existing Chronoscope capabilities and visual-fit them into the Figma composition. If a control cannot fit without cluttering the shell, it should move into a compact menu or popover rather than remain as a competing top-level button.
