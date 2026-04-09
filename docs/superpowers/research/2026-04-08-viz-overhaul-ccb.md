---
date: 2026-04-08
feature: viz-overhaul
type: codebase-context-brief
---

# Codebase Context Brief — Phase 1 Visualization Overhaul

## STACK

Svelte 5 (runes, ^5.55.1), TypeScript ~6.0.2, Vite ^8.0.4, Canvas 2D (no WebGL in use yet), Vitest ^4.1.3 (185 tests across 18 files), Playwright ^1.59.1 for visual/a11y, lz-string ^1.5.0 (sole runtime dep). Self-hosted Inter + JetBrains Mono fonts.

## EXISTING PATTERNS

Error handling: renderers return early on null ctx — errors are silent (no throws, no logging). Test pattern: Vitest unit tests exist for renderers, stores, engine, and types (185 passing). Token enforcement: raw hex/px/duration values prohibited outside tokens.ts by ESLint no-restricted-syntax. Store pattern: measurement state is a single writable with explicit mutation methods; statistics is a pure derived store. Renderer pattern: each renderer is a plain class instantiated in TimelineCanvas.svelte onMount; no DI, direct instantiation. Frame scheduling: RenderScheduler separates data (dirty-flagged), effects (every frame), and interaction tiers with 8ms data budget and 10-frame overload streak protection.

## RELEVANT FILES

**src/lib/renderers/timeline-renderer.ts** — Primary target for adaptive Y-axis, X-axis labels, trace ribbons, additional gridlines. Key internals: `latencyToNorm()` uses hard-coded LOG_MIN/LOG_MAX (log10(1)–log10(10000)); `Y_GRID_MS` constant array drives gridline positions; `draw(pointsByEndpoint, freezeEvents)` is the single public render entry point; `computePoints()` is static, called from TimelineCanvas. `toCanvasCoords()` and `setMaxRound()` are public for coordinate conversion.

**src/lib/renderers/effects-renderer.ts** — Target for sonar ping visibility improvements and empty-state sweep animation. `addPing(ping: SonarPing)` / `draw(pings, now)` API is wired and functional. Currently has no concept of "no data" state.

**src/lib/components/TimelineCanvas.svelte** — Wires all renderers; calls `recomputePoints()` on store subscription, emits SonarPing via `effectsRenderer.addPing()`, calls `timelineRenderer.draw()`. Must pass computed Y-range and rolling window stats for new features.

**src/lib/types.ts** — Will need new interfaces for ribbon data (per-endpoint rolling percentiles) and possibly a TraceRibbon type. SonarPing already defined and sufficient.

**src/lib/tokens.ts** — Must receive new visual constants for ribbons, empty-state sweep parameters. No raw values outside this file.

**src/lib/stores/statistics.ts** — Currently recomputes full-history statistics. Trace ribbons need rolling window (last N samples). May need a second derived store or extended output.

**src/lib/utils/statistics.ts** — `percentile()` function already available. Rolling window can call directly.

## CONSTRAINTS

- tokens.ts is sole permitted location for raw visual values — ESLint enforces, violations fail build
- Three-canvas layer order (data z:1, effects z:2, interaction z:3) must not change
- RenderScheduler budget: data render target < 8ms; ribbon drawing adds to data budget
- SonarPing type's startTime field is mutable by design (eviction mutates in-place)
- statisticsStore is pure derived store with no side effects — rolling-window additions must remain side-effect-free
- haloCache in TimelineRenderer uses CanvasPattern keyed by color hex — ribbon fills must not share this cache
- Y_GRID_MS already includes 1, 5, 10, 50, 100, 500, 1000, 5000, 10000 — 10ms and 50ms gridlines exist but may not be visible at current fixed scale

## OPEN QUESTIONS

1. **Adaptive Y-axis minimum range** — When all latencies < 50ms, what's the minimum visible range? Spec mentions auto-ranging but doesn't specify floor. Proposal: 1ms floor, 2x headroom above max.
2. **Rolling window size** — Fixed N=20 samples (simple) vs time-based last 60s (semantically correct but needs timestamp arithmetic)?
3. **X-axis labels** — Round numbers (available directly on ScatterPoint) vs elapsed time (requires startedAt from measurementStore)?
4. **Empty-state trigger** — TimelineCanvas has no "empty" detection. Sweep must stop on first sample. Condition: running state + zero samples.
5. **Ribbon data source** — New derived store (testable, doubled derivation cost) vs compute in recomputePoints callback (simpler, less testable)?
6. **10ms/50ms gridlines** — Already in Y_GRID_MS array but may not render visibly at current fixed scale. Needs visual verification.
