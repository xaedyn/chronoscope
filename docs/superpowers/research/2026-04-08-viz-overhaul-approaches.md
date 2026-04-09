---
date: 2026-04-08
feature: viz-overhaul
type: approach-decision-memos
---

# Approach Decision Memos — Phase 1 Visualization Overhaul

---

## APPROACH: Percentile Viewport

### CORE IDEA
The Y-axis viewport is a sliding window over data percentiles, computed in a new derived store, with all rendering staying in the existing static-method pipeline.

### MECHANISM
A new `rollingStatisticsStore` derives from `measurementStore`, slicing the last 20 samples per endpoint and computing P2/P25/P50/P75/P98 via the existing `percentile()` utility. The Y-axis range is set to [P2, P98] of visible data across all endpoints, with a minimum span of 2x headroom above max and a 1ms floor. `latencyToNorm()` becomes a pure function that accepts `yMin`/`yMax` parameters instead of reading module-level constants, and `computePoints()` (still static) receives the computed range. `Y_GRID_MS` is filtered at draw time to only include values within the visible range. Trace ribbons are P25/P75 polygons computed in the store and passed to `draw()` as a new `ribbonsByEndpoint` parameter. The empty state is a boolean flag (`hasData`) checked in `EffectsRenderer.draw()` — when false, it runs a rotating sweep line with text overlay; when true, it draws pings normally. X-axis labels are round numbers with adaptive tick density computed from `plotWidth / labelWidth`. The DPR bug is fixed by making `computeLayout()` use CSS dimensions (`canvas.style.width/height`) instead of physical pixel dimensions.

### FIT ASSESSMENT
- **Scale fit:** matches — percentile computation is O(n log n) but only over a 20-sample window, trivially fast even at 1000+ rounds. Ribbon polygons are 2 paths per endpoint. Total data-tier render stays well under 8ms.
- **Team fit:** fits — no new paradigms. Store derivation, canvas path drawing, and percentile math are all patterns already in the codebase.
- **Operational:** Zero. All computation is client-side. No new dependencies.
- **Stack alignment:** fits — uses Svelte derived stores, Canvas 2D path fills, tokens.ts for new ribbon/sweep constants. No new deps.

### TRADEOFFS
- **Strong at:** Testability. The rolling statistics store is a pure derived store, unit-testable in isolation. Ribbon data and Y-range are computed outside renderers, making renderer tests deterministic. Minimal refactor surface — `computePoints` stays static, just gains parameters.
- **Sacrifices:** Log-scale fidelity. When data spans 10ms–5000ms, a percentile clamp on a linear viewport will compress the middle range. The approach must detect wide-range data and fall back to log scale, adding a conditional branch. Also, the store recomputes on every sample, even when the viewport hasn't meaningfully changed.

### WHAT WE'D BUILD
- `rollingStatisticsStore` — new derived store computing per-endpoint rolling P2/P25/P50/P75/P98
- `computeYRange()` — pure function: takes global P2/P98 across endpoints, returns `{ yMin, yMax, isLog }` with log fallback when range > 100x
- `latencyToNorm(ms, yMin, yMax, isLog)` — refactored normalization accepting dynamic range
- `drawRibbons(ribbonsByEndpoint)` — new method on TimelineRenderer drawing filled P25-P75 polygons with P50 center line
- `drawXAxis()` — new method on TimelineRenderer drawing adaptive round-number tick labels
- `drawEmptyState()` — new method on EffectsRenderer drawing rotating sweep line + instructional text
- `tokens.canvas.ribbon` — new token block for ribbon fill opacity, P50 line width, P50 line dash
- `tokens.canvas.emptyState` — new token block for sweep speed, text style, fade parameters
- DPR fix in `computeLayout()` — use `parseInt(canvas.style.width)` / `parseInt(canvas.style.height)`

### THE BET
Percentile-clamped auto-ranging with a log fallback produces readable charts across the full latency spectrum (sub-10ms to multi-second) without requiring user-adjustable scale controls.

### REVERSAL COST
If wrong at 30 days: **easy** — the Y-range computation is isolated in a pure function and a derived store. Swapping to a different scaling strategy means changing `computeYRange()` and `latencyToNorm()` without touching ribbon rendering, empty state, or X-axis code.

### WHAT WE'RE NOT BUILDING
- User-adjustable Y-axis range controls (manual zoom covers this)
- Time-domain X-axis (round numbers only — elapsed time is Phase 2)
- Heatmap/bucketed display mode (Honeycomb-style alternative)
- Animated transitions when Y-range changes (snaps immediately)
- WebGL acceleration

### INDUSTRY PRECEDENT
Datadog percentage-based threshold bounds for auto-scaling chart axes [VERIFIED].

---

## APPROACH: Hybrid Scale Engine

### CORE IDEA
The renderer itself owns scale state as instance fields, dynamically switching between log and linear modes based on data distribution, with ribbon geometry computed during the render pass alongside point positions.

### MECHANISM
`LOG_MIN` and `LOG_MAX` become mutable instance fields on `TimelineRenderer`, updated at the start of each `draw()` call. A new `ScaleEngine` inner class encapsulates the decision: if `max/min < 20x`, use linear scale for maximum visual spread; if `20x–500x`, use log scale; if `>500x`, use log with P2–P98 clamping. The engine exposes `toNorm(ms)` and `fromNorm(y)` methods that replace the module-level `latencyToNorm()`. `computePoints()` moves from static to instance method — it needs the current scale context. Ribbons are computed inside `draw()` in the same loop that processes points: for each endpoint, accumulate a rolling P25/P75/P50 buffer (last 20 points) and emit ribbon geometry inline. This avoids a separate store and keeps ribbon data co-located with render logic. The empty state lives in a new `EmptyStateLayer` class drawn on the effects canvas, with its own `requestAnimationFrame` loop that self-terminates on first data. X-axis uses round numbers with label collision detection (measure text width, skip labels that would overlap). The DPR fix normalizes all layout math to CSS pixels by dividing `canvas.width` by `dpr` in `computeLayout()`.

### FIT ASSESSMENT
- **Scale fit:** matches — scale decision is O(1) per frame (min/max tracked incrementally). Ribbon accumulation is O(window_size) per endpoint per frame, negligible. The scale engine adds ~0.1ms overhead.
- **Team fit:** fits — instance methods and inner classes are straightforward TypeScript. The `ScaleEngine` abstraction is new but small (~40 lines).
- **Operational:** Zero. All client-side.
- **Stack alignment:** fits — no new deps. Stays within Canvas 2D and tokens.ts. However, `computePoints()` moving to instance means TimelineCanvas.svelte must call it on the renderer instance instead of the class, a wiring change.

### TRADEOFFS
- **Strong at:** Visual quality across extreme data ranges. The three-mode scale engine (linear/log/clamped-log) maximizes canvas utilization for any data distribution. Co-locating ribbon computation with rendering avoids stale-data bugs and eliminates store derivation cost. The scale mode is visible to the user via gridline spacing, making the chart self-documenting.
- **Sacrifices:** Testability. Ribbon computation inside the renderer is harder to unit test — you need a canvas context (or mock) to verify ribbon geometry. The `ScaleEngine` is testable in isolation, but integration testing requires rendering. `computePoints()` becoming an instance method breaks the current call site in `recomputePoints()` and requires renderer to be initialized before points can be computed.

### WHAT WE'D BUILD
- `ScaleEngine` — inner class on TimelineRenderer: `{ mode: 'linear' | 'log' | 'clamped-log', yMin, yMax, toNorm(ms), fromNorm(y), computeGridlines() }`
- `TimelineRenderer.computePoints()` — refactored from static to instance method, uses `this.scaleEngine.toNorm()`
- `TimelineRenderer.drawRibbons()` — computes rolling percentiles from points in-place, draws filled paths
- `TimelineRenderer.drawXAxis()` — round-number labels with collision detection via `ctx.measureText()`
- `EmptyStateLayer` — standalone class for effects canvas, self-managing animation lifecycle
- `tokens.canvas.ribbon` — fill opacity, median line width
- `tokens.canvas.emptyState` — sweep angular velocity, text content, fade alpha
- DPR fix in `computeLayout()` — divide physical dimensions by `window.devicePixelRatio`

### THE BET
A renderer that owns its own scale intelligence produces better visual output than external percentile computation, because scale decisions and rendering are inherently coupled — the renderer knows what looks good at the current canvas size.

### REVERSAL COST
If wrong at 30 days: **hard** — `computePoints()` moving to instance method changes the contract between TimelineCanvas.svelte and TimelineRenderer. Reverting means re-extracting scale logic and restoring the static method, touching both the renderer and its sole consumer. The `EmptyStateLayer` as a separate class is easy to swap, but the ribbon-in-renderer coupling is structural.

### WHAT WE'RE NOT BUILDING
- Separate derived store for rolling statistics (computation lives in renderer)
- Animated scale transitions (snaps per frame)
- User-selectable scale mode toggle
- Time-domain X-axis
- WebGL fallback

### INDUSTRY PRECEDENT
uPlot dynamically selects linear vs log scale based on data range and computes band fills during the render pass [VERIFIED].

---

## APPROACH: Layered Data Pipeline

### CORE IDEA
A new `TimelineDataPipeline` module sits between stores and renderers, transforming raw measurements into render-ready geometry (points, ribbons, axis ticks, Y-range) in a single pass, keeping both stores and renderers stateless with respect to scale.

### MECHANISM
`TimelineDataPipeline` is a pure function module (no class, no state) with one entry point: `prepareFrame(endpoints, measureState) => FrameData`. `FrameData` contains: `pointsByEndpoint`, `ribbonsByEndpoint`, `yRange`, `xTicks`, and `hasData`. The pipeline: (1) scans all samples to find global min/max latency, (2) applies percentile clamping (P2–P98) with log-scale when range > 50x, (3) normalizes all points against the computed range, (4) computes rolling P25/P50/P75 ribbons per endpoint using a sliding window, (5) generates adaptive X-axis tick positions and labels, (6) returns the complete `FrameData` struct. TimelineRenderer becomes a pure drawing machine — it receives `FrameData` and paints it. No scale logic, no point computation, no statistics. `computePoints()` is removed entirely. The empty state is a `hasData: false` flag in `FrameData` that TimelineCanvas checks to route rendering to either `timelineRenderer.draw(frameData)` or `effectsRenderer.drawEmptyState()`. The DPR fix is applied in TimelineCanvas's `resizeCanvases()` by passing CSS dimensions (not physical) to the pipeline and renderers.

### FIT ASSESSMENT
- **Scale fit:** matches — the pipeline runs once per store update, not per frame. At 1000 rounds x 10 endpoints = 10K points, the full pipeline (scan + percentile + normalize + ribbon) completes in <2ms on modern hardware. Renderer just draws pre-computed geometry.
- **Team fit:** fits — pure functions are the simplest paradigm. The pipeline is a single file with no class instantiation, no lifecycle, no canvas dependency. Highly testable.
- **Operational:** Zero. All client-side.
- **Stack alignment:** fits — no new deps. The pipeline is plain TypeScript. Renderers stay Canvas 2D. Tokens enforce visual constants. The main change is TimelineCanvas calling `prepareFrame()` instead of `computePoints()`.

### TRADEOFFS
- **Strong at:** Separation of concerns and testability. The pipeline is 100% unit-testable without canvas mocks — it produces data structures, not pixels. Renderers become trivially testable too (given geometry, does it draw correctly?). Scale logic, ribbon math, and tick generation are all co-located in one module, making the data flow auditable. Adding new visualizations (e.g., Phase 2 heatmap) means adding output fields to `FrameData`, not modifying renderers.
- **Sacrifices:** Indirection. There's now a three-layer pipeline (store → pipeline → renderer) instead of two (store → renderer). The `FrameData` interface is a new contract to maintain. If the pipeline and renderer get out of sync on the `FrameData` shape, TypeScript catches it, but it's still more surface area.

### WHAT WE'D BUILD
- `TimelineDataPipeline` — pure function module: `prepareFrame(endpoints, measureState) => FrameData`
- `FrameData` interface — `{ pointsByEndpoint, ribbonsByEndpoint, yRange: { min, max, isLog }, xTicks: { position, label }[], hasData: boolean }`
- `RibbonData` interface — `{ p25Path: [x, y][], p50Path: [x, y][], p75Path: [x, y][] }` per endpoint
- `TimelineRenderer.draw(frameData)` — simplified to receive pre-computed geometry, removes `computePoints()`, removes scale logic
- `TimelineRenderer.drawRibbons(ribbons)` — draws pre-computed ribbon paths
- `TimelineRenderer.drawXAxis(ticks)` — draws pre-computed tick positions and labels
- `EffectsRenderer.drawEmptyState()` — rotating sweep + instructional text, called when `hasData === false`
- `tokens.canvas.ribbon` — fill opacity, median line style
- `tokens.canvas.emptyState` — sweep parameters
- DPR fix in `TimelineCanvas.resizeCanvases()` and `computeLayout()`

### THE BET
Extracting all data transformation into a pipeline module produces cleaner architecture that pays off immediately in testability and pays forward when Phase 2 adds heatmaps, waterfall views, and time-domain axes.

### REVERSAL COST
If wrong at 30 days: **easy** — the pipeline is a single module with a single entry point. If the indirection proves unnecessary, inline `prepareFrame()` back into `recomputePoints()` in TimelineCanvas.svelte. The renderer's simplified `draw(frameData)` signature is strictly better than the current one regardless of where the data comes from.

### WHAT WE'RE NOT BUILDING
- Incremental/differential pipeline (recomputes full frame each time)
- Web Worker offloading for pipeline computation
- Animated Y-axis transitions
- Time-domain X-axis (round numbers only)
- User-configurable pipeline parameters

### INDUSTRY PRECEDENT
Observable Plot separates data transformation (marks, scales, channels) from rendering (SVG/Canvas output), enabling the same data pipeline to target multiple render backends [VERIFIED].

---

## Comparison Matrix

| Criterion | Percentile Viewport | Hybrid Scale Engine | Layered Data Pipeline |
|---|---|---|---|
| **AC1: Adaptive Y-axis (60% canvas utilization)** | STRONG — P2-P98 clamp with log fallback directly targets 60%+ utilization; pure function is easy to tune | STRONG — three-mode scale engine (linear/log/clamped-log) adapts to any data distribution; renderer owns the decision | STRONG — pipeline computes optimal range per frame; same percentile-clamp logic but co-located with all other transforms |
| **AC2: Sonar ping visibility** | STRONG — pings use corrected DPR coordinates from fixed `toCanvasCoords()`; no architectural change to ping flow | STRONG — same DPR fix; `toCanvasCoords()` uses instance scale engine for correct positioning | STRONG — pipeline provides normalized points; `toCanvasCoords()` uses `FrameData.yRange` for correct positioning |
| **AC3: Trace ribbons (P25-P75)** | STRONG — ribbons computed in dedicated derived store, fully testable, passed to renderer as data | PARTIAL — ribbons computed inside renderer during draw pass; functional but harder to unit test without canvas context | STRONG — ribbons computed in pipeline as pure data, passed to renderer; fully testable without canvas |
| **AC4: X-axis labels** | STRONG — adaptive tick density from plotWidth/labelWidth; straightforward addition to renderer | STRONG — collision detection via `ctx.measureText()` is more precise but couples label logic to canvas | STRONG — tick positions and labels pre-computed in pipeline; renderer just draws them |
| **AC5: Empty state animation** | STRONG — boolean flag in EffectsRenderer; sweep draws when no data; stops on first sample | STRONG — dedicated `EmptyStateLayer` class with self-managing lifecycle; cleanest separation | STRONG — `hasData` flag in FrameData; TimelineCanvas routes to empty state renderer; clean conditional |
| **Scale fit** | STRONG — O(window) store derivation + O(n) render; well within 8ms budget at 10K points | STRONG — O(1) scale decision + O(window) inline ribbon; slightly faster due to no store overhead | STRONG — O(n) single-pass pipeline; amortized cost same as others; no per-frame redundancy |
| **Team fit** | STRONG — follows existing store-derives-from-store pattern; smallest conceptual delta from current code | PARTIAL — `ScaleEngine` inner class and instance-method `computePoints()` are new patterns; manageable but unfamiliar | STRONG — pure functions are the simplest paradigm; new module but zero new patterns |
| **Operational burden** | NONE — all client-side | NONE — all client-side | NONE — all client-side |
| **Stack alignment** | STRONG — Svelte derived stores, Canvas 2D, tokens.ts; zero new deps | STRONG — Canvas 2D, tokens.ts; zero new deps; but changes renderer's public API (static → instance) | STRONG — plain TypeScript module, Canvas 2D, tokens.ts; zero new deps; simplifies renderer API |
| **Testability** | STRONG — store is pure derived, range function is pure, renderer receives data | PARTIAL — scale engine testable in isolation; ribbons and integrated behavior need canvas context | STRONG — pipeline is 100% pure functions; renderer tests receive pre-computed geometry |
| **Reversal cost** | LOW — range logic isolated in pure function + derived store | HIGH — instance-method migration and scale engine are structural; reversal touches renderer + consumer | LOW — pipeline is one module with one entry point; can inline back trivially |
| **Phase 2 extensibility** | PARTIAL — adding heatmap/waterfall requires new store derivations and renderer methods independently | PARTIAL — renderer already owns data transforms, but adding modes increases its complexity | STRONG — pipeline gains new output fields; renderers gain new draw methods; clean extension path |
