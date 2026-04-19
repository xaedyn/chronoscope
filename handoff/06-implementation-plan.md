# Implementation plan

Phased rollout. Each phase ships independently; nothing in a later phase is a prerequisite for shipping an earlier one.

---

## Phase 0 — Foundations (1–2 days)

**Goal:** land the plumbing before any view work. Safe to merge even if no view consumes it yet.

1. Add new tokens (`04-tokens-additions.md`) to `src/lib/tokens.ts`.
2. Extend `bridgeTokensToCss` in `App.svelte` to expose new CSS vars (`--ts-*`, `--tr-*`, new accent/surface vars).
3. Create `src/lib/utils/classify.ts` (health classifier, networkQuality). Full unit tests.
4. Extend `src/lib/utils/format.ts` with `fmt`, `fmtParts`, `fmtPct`, `fmtCount`. Full unit tests.
5. Add new fields to `UIState`, `Settings`, `EndpointStatistics` per `05-type-additions.md`. Land the persistence migration (version 4 → 5).
6. Compute `tier2P95` in `src/lib/utils/statistics.ts`.

**Ship checkpoint:** no visual change, but `npm run check` and tests pass; persisted v4 settings migrate cleanly.

---

## Phase 1 — Rail + view switcher (1 day)

**Goal:** persistent left rail + routing to a new `OverviewView` stub.

1. Build `src/lib/components/EndpointRail.svelte` per `03-components/endpoint-rail.md`.
2. Add view switcher segment to `Topbar.svelte`. Seven buttons: Overview / Live / Atlas / Strata / Terminal / Lanes.
3. Create `src/lib/components/views/OverviewView.svelte` as a stub ("Overview coming soon" centered in page).
4. Create `src/lib/components/views/ViewSwitcher.svelte` that routes on `$uiStore.activeView`. Map deprecated views (`timeline`/`heatmap`/`split`) to existing `LanesView` for now.
5. Wire the rail into `Layout.svelte`. 264px fixed-width column on the left.

**Ship checkpoint:** users can click through the topbar to empty views; rail is visible and clicking an endpoint sets `focusedEndpointId`.

---

## Phase 2 — Overview (2–3 days)

**Goal:** the dial, the primary reason the redesign is happening.

1. Build `ChronographDial.svelte` per `03-components/chronograph-dial.md`. Start with static geometry (no animation).
2. Wire it to `networkQualityStore`. Smoke test with real measurements.
3. Add live hand interpolation (rAF lerp).
4. Add orbit ring with per-endpoint markers. Over-threshold pulse animation.
5. Add threshold-cross rim pulse.
6. Build Overview's DiagnosisStrip + metrics triptych.
7. Accessibility pass — SVG `role="img"`, `aria-label`, off-screen live region for threshold crossings.

**Ship checkpoint:** Overview is shippable as the default view. Users can glance at it and see system health.

---

## Phase 2.5 — Enriched Overview (3–4 days)

**Goal:** upgrade Overview from "how healthy" to "where to look and why." See `02-view-specs/overview-enriched.md` for the full spec.

Ship this only after Phase 2 (Classic) is merged and stable. Enriched becomes the default Overview mode once this phase lands.

1. **Settings addition.** Add `overviewMode: 'classic' | 'enriched'` to settings (v5 → v6 migration). Default `'classic'` until the phase ships; flip to `'enriched'` in the release PR.
2. **Extract verdict logic.** Create `src/lib/utils/verdict.ts` with `computeCausalVerdict()` per `03-components/causal-verdict.md`. Unit test every branch — including the tied-dominant-phase edge case (deterministic alphabetical tiebreak) and the 0.7× threshold rule.
3. **Build `CausalVerdictStrip.svelte`** per spec. Pure-render component; takes the verdict as a prop, emits `onDrill`. Include the metrics triptych and drill CTA.
4. **Build `RacingStrip.svelte`** per `03-components/racing-strip.md`. Shared-axis layout; dynamic max clamped to [150, 300]ms rounded to 30ms. Per-row: threshold-split background, p50–p95 band, 40-sample sparkline, live dot. Click → Live, shift-click → Diagnose.
5. **Build `EventFeed.svelte`** per `03-components/event-feed.md`. Newest-loud fade rule (opacity = 1 - rank × 0.14). `feedArrive` animation on new event. Relative time labels auto-refresh on tick.
6. **Event derivation in OverviewView.** Component-local ring buffer, max 12. Detect `cross-up`, `cross-down`, and `shift` per tick per endpoint. Pass last 5 to the feed.
7. **Baseline computation.** Every 5s, compute p25/median/p75 over last 120s × all endpoints. Require ≥30 samples. Pass to the dial.
8. **Upgrade `ChronographDial.svelte` to v2.** Add `variant` prop, baseline arc layer, 60s quality trace, within-band label, breathing chrome (5 CSS-custom-property transitions over 900ms). See `03-components/chronograph-dial.md` → Dial v2 section. Classic callers still render as before.
9. **OverviewView layout.** Two-column grid (1.05fr / 1fr). Dial + verdict stack in left column; racing strip + event feed stack in right column. Delete the SubDialsGrid — superseded by the racing strip.
10. **A11y pass.** Verdict headline in a live region; event feed container `aria-live="polite"`; racing strip rows are real `<button>` elements; sparklines and decorative SVG layers wrapped in `aria-hidden="true"`.
11. **Flip the default.** Once soaked for a release, change the settings default and keep `'classic'` as an escape hatch for one more release.

**Ship checkpoint:** Enriched is the default. A user glancing at the page can read *one sentence* that names the problem, see the worst offender on the racing strip, and know at a glance whether today is normal (baseline arc + within-band label).

---

## Phase 3 — Live (2–3 days)

**Goal:** replace legacy `split` view as the primary realtime surface.

1. **Decide rendering path:** SVG (prototype parity, faster to ship) vs Canvas2D (future-proof, reuse `timeline-renderer.ts` infra). Recommendation: Canvas2D — reuse existing renderer, swap scale & data source.
2. Build `ScopeCanvas.svelte` per `03-components/scope-canvas.md`.
3. Build `LiveView.svelte` with Unified/Split toggle. Wire focused-endpoint solo mode.
4. Tooltip rendering (`tokens.color.tooltip.*`).
5. Keyboard navigation (arrow keys move crosshair).
6. Performance validation — 10 endpoints × 60 rounds at 60fps on a mid-laptop baseline.

**Ship checkpoint:** Live is the daily-driver surface. At this point Overview + Live together cover ~80% of use cases; you can remove the deprecated `timeline`/`heatmap` fallbacks from `ViewSwitcher`.

---

## Phase 4 — Atlas (2 days)

**Goal:** drill-in for a focused endpoint.

1. Extract `PhaseBar.svelte` from `LaneHeaderWaterfall.svelte`. Refactor the lane header to consume it.
2. Build `Waterfall.svelte` per `03-components/waterfall.md`.
3. Build `AtlasView.svelte`. P50/P95 toggle.
4. Hypothesis strip logic (pure function — unit test it exhaustively).
5. Sample strip — last 8 samples as mini-bars.
6. "Back to Live" return button — clears focus, routes.

**Ship checkpoint:** a user who notices a slow endpoint on Live can double-click → land on Atlas → get a verdict.

---

## Phase 5 — Strata (prototype first, then 2 days to build)

**Prerequisite: design-prototype this view before scheduling implementation.** The Strata spec in `02-view-specs/strata.md` captures intent, but no visual prototype exists. Build a Strata prototype in the same style as the existing `v2/Chronoscope v2.html` and get sign-off before starting engineering.

**Goal (post-prototype):** long-range distribution view.

1. Build `StrataView.svelte` with time range selector.
2. Per-row percentile band (start with discrete ticks, not KDE — see spec).
3. Client-side percentile recomputation on range change. Animate band transitions.
4. Low-confidence indicator (< 30 samples in range).

**Ship checkpoint:** Strata ships. Skip KDE for v1 — the percentile band with ticks reads cleanly and is cheaper to compute.

---

## Phase 6 — Terminal (prototype first, then 2 days to build, gated)

**Prerequisite: design-prototype this view before scheduling implementation.** Same as Strata &mdash; no visual prototype exists yet.

**Goal (post-prototype):** the forensic log. Gated behind `settings.showAdvancedViews` flag; not in the topbar by default.

1. Build `terminalEventsStore` + event derivation listener in `App.svelte`.
2. Build `TerminalView.svelte` with severity chips, expandable rows, filter pills.
3. Virtualization if event count exceeds 100.
4. Clipboard export (JSONL).
5. Gate behind `Settings > Advanced > Show Terminal view`.

**Ship checkpoint:** Terminal available for engineers; not yet promoted in the topbar.

---

## Phase 7 — Deprecation (1 day)

**Goal:** retire the old views.

1. Remove `timeline`, `heatmap`, `split` from `ActiveView` union.
2. Remove `TimelineCanvas.svelte` if no other consumer (ScopeCanvas should have reused its renderer, not inherited the component).
3. Remove `HeatmapCanvas.svelte` once Strata covers its use cases — confirm with users first.
4. Drop the `'lanes'` alias from the topbar view switcher. Keep `LanesView.svelte` as a hidden escape hatch accessible via URL param (`?view=lanes`) for one release.
5. Bump persisted version 5 → 6; remove migration code for v4 → v5 from earlier release.

---

## Cross-cutting: never do these
- **Never bypass tokens.** New colors or sizes go through `04-tokens-additions.md`; don't inline hex codes in Svelte.
- **Never put endpoint pickers inside views.** The rail is the single source of focus. Any view that needs a "different endpoint" flow must call `uiStore.setFocusedEndpoint()`.
- **Never ship a view without accessibility.** Each view's spec has an a11y section — review before PR.
- **Never fabricate phase data.** If `tier2` is missing on a sample, render a neutral bar; don't make up DNS/TCP/TLS numbers.
- **Never recompute `networkQuality()` or `classify()` inline.** Always go through the derived store or the util function — these are the alignment points that keep the dial, rail, and verdict consistent.
- **Never use `scrollIntoView`** — the existing codebase has a scroll-manager pattern; follow it.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| ScopeCanvas 60fps regression vs current TimelineCanvas | Reuse `timeline-renderer.ts` core; swap data pipeline only. Benchmark early. |
| Persistence migration breaks existing users | Land Phase 0 migration behind a feature flag; backfill telemetry for 1 release before removing v4 support. |
| `networkQualityStore` thrashes on every sample | Throttle the derived store to 250ms updates; dial hand interpolates the rest. |
| Tier-2 p95 adds CPU on `statistics.ts` hot path | Compute p95 on the same cadence as averages (not every sample); reuse existing percentile helper. |
| Terminal event buffer leaks memory | Hard cap at 500 events + virtualize. Add a devtools panel in dev mode to monitor. |

---

## Definition of done

A view is "done" when:
1. It matches the prototype at 1440px reference width (spot-check with `v2/Chronoscope v2.html`).
2. All values flow through `tokens.ts`.
3. Keyboard-only navigation works end-to-end.
4. Screen reader reads meaningful output (tested with VoiceOver + NVDA).
5. `npm run check` passes.
6. Added tests for any new pure function (`classify`, `hypothesis`, `networkQuality`, new format helpers).
7. Bundle-size delta < +10KB gzip vs main for that view.
