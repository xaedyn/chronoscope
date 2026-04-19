# Phase notes — Chronoscope v2 redesign

Accumulating log of watch-items surfaced during phased delivery but deferred
for later attention. Each entry names the phase it came from, the signal, and
the condition under which it becomes actionable.

## Phase 1 decisions

- **Lanes stayed enabled** in `ViewSwitcher` (only 4 of 5 non-Overview tabs
  disabled, instead of the briefed 5 of 5). Reason: the Phase 0 v4→v5
  migration rewrites every legacy `activeView` (`timeline`/`heatmap`/`split`)
  to `'lanes'`, so disabling the Lanes tab would strand users with no UI
  route to the existing Glass Lanes visualization. Plan to disable/retire
  alongside legacy view removal in **Phase 7**.
- **Disabled-tab pattern** (`tabindex=-1` + `title` tooltip "Prototype in
  progress — not yet available." + `aria-disabled` + `aria-pressed` for the
  toggle state) is the template for Phases 2–6. Each phase that brings a
  view online just flips `enabled: true` on its `VIEWS` entry in
  `ViewSwitcher.svelte`.

## Open watch-items

### DeepSource Category A — "function declaration in global scope" (Phase 0)
DeepSource JavaScript flags every `export function` at module top level in
`classify.ts`, `format.ts`, `persistence.ts`, and the co-located test files
(11 hits in Phase 0; +1 on `networkLevel` in Phase 1; expected to grow with
each phase). The rule is mis-calibrated for ES modules: `export function` is
*scoped to the module*, not global. The same pattern exists throughout the
pre-existing codebase without being flagged, which suggests the rule was
enabled after most of the repo was written.

**Action:** add a suppression rule to `.deepsource.toml` (or disable the
specific analyzer check) in a small maintenance PR when convenient. Keeps
the "blocking issues" state honest so future real findings don't get lost
in noise. Becoming higher-priority as the count climbs.

### `readSettingsField` cyclomatic complexity 12 (Phase 0)
`src/lib/utils/persistence.ts` — introduced during the `normalizeV5` refactor
that split per-field readers out of the main normalizer. The helper is a
linear shape validator (one ternary per Settings field), so its complexity
reflects field count rather than cognitive complexity. Splitting further
would pad the file without improving readability.

**Action:** revisit if **Phase 2.5 or later** adds more fields to `Settings`
(e.g. `overviewMode`, additional threshold knobs). At that point, break
`readCorsMode` / `readRegion` out as their own helpers, bringing the parent
back under 10.

### Rail drill destination is `'lanes'` until Live ships (Phase 1)
`src/lib/components/EndpointRail.svelte` — both `handleDoubleClick` and
`handleKeydown` (Space) call `uiStore.setActiveView('lanes')`. The
`endpoint-rail.md` spec says drill should go to **Live**, but Live is
disabled in Phase 1 and would route to the Overview stub. Lanes is the
only working detail view today, so it's the right Phase 1 destination.

**Action:** when **Phase 3** lands the Live view, swap both call sites
(double-click + Space-keydown) to `setActiveView('live')`. Comments in the
file already flag the TODO.

### Phase 1 script-only nitpicks deferred (Phase 1)
`scripts/phase-1-screenshots.mjs` — CodeRabbit flagged two minor patterns:
1. The `epMod.endpointStore.subscribe` Promise pattern uses `const unsub`
   referenced inside the synchronous callback. Current code works because
   `setTimeout(unsub, 0)` defers the access past initialization, but a
   future refactor that reads `unsub` synchronously would TDZ-crash.
2. No `try/finally` around the browser lifecycle — a thrown navigation or
   `evaluate` would leak the Chromium process.

**Action:** clean up alongside any future expansion of the screenshot
script (e.g., when Phase 2/3 adds dial / live screenshots and the script
grows enough to warrant proper structure). Not worth a standalone PR.

## Resolved

### CodeRabbit auto-review on v2 redesign branch (Phase 0 → Phase 1)
The `.coderabbit.yaml` widening landed in Phase 0 PR #44 — that PR's
manual trigger was a no-op because CodeRabbit had already evaluated and
cached "skip" for that base branch. **PR #45 (Phase 1) confirmed the
config works:** auto-review fired without prompting, posted 6 actionable
comments + 2 nitpicks, then a follow-up review with 2 more after the
cleanup commit. Future phase PRs will get reviewed automatically.
