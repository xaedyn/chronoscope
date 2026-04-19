# Live view — spec

**Target file:** `src/lib/components/views/LiveView.svelte`
**Prototype reference:** `v2/view-live.jsx` → `LiveView`

## Purpose

The real-time oscilloscope — shows the last N seconds of latency as a continuous trace per endpoint. Primary "is it happening right now?" surface. Replaces the current `timeline` and `split` views.

## Structure

```
LiveView
├─ LiveHeader
│    ├─ title + focused endpoint chip
│    ├─ Unified / Split toggle
│    └─ TRIG readout (threshold display only; read-only on this view)
├─ ScopeCanvas    (one or many)
└─ LiveFooter     (stats strip — per-endpoint mini readouts)
```

When `split === false`: one ScopeCanvas at 540px height, all endpoints overlaid.
When `split === true`: one ScopeCanvas per endpoint, 220px each, stacked.

When `focusedEndpointId` is set: show only that endpoint, in solo view (single scope, 540px).

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  LIVE · OSCILLOSCOPE      [ UNIFIED | SPLIT ]   TRIG 120ms  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ScopeCanvas                                                │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ● api-us   127ms  p95 284ms  ↑2%      ● api-eu  94ms  ... │
└─────────────────────────────────────────────────────────────┘
```

## ScopeCanvas

Extended spec in `03-components/scope-canvas.md`. Summary:

- Fixed coordinate space: 1440×640 (preserveAspectRatio="none", scales to container).
- X axis: last 60 rounds (configurable later). Latest on the right.
- Y axis: linear 0–300ms (matches dial scale). Above 300ms clamps at top edge with visual overflow indicator.
- Grid: hairline at every 60ms (major) and 15ms (minor). Time gridlines at every 10 rounds.
- Traces: one polyline per endpoint, colored from `tokens.color.endpoint[]`.
- Threshold line: horizontal pink dashed line at `threshold`ms.
- Overflow markers: when a sample > 300ms, render a chevron at the top edge at that round.
- Cursor: crosshair on hover; tooltip follows showing `{round, latency, status, timestamp}`.

## Interactions

| Interaction | Effect |
|---|---|
| Click endpoint in rail | Focus that endpoint (solo mode). Click again or press `Esc` to unfocus. |
| Double-click a trace | Drill to AtlasView with that endpoint focused. |
| Hover a trace | Show tooltip. Highlight that endpoint's row in the rail. |
| Toggle Unified/Split | Swap rendering. Threshold, focus, range, hover state all preserved. |
| Scroll on canvas | Reserved — do not capture. (Future: time-range zoom.) |
| Drag threshold line | NOT IMPLEMENTED in prototype. Keep read-only on this view for v1 — threshold change goes through Settings or Overview. |

## States

| State | Behavior |
|---|---|
| Idle | Empty canvas with hairline grid + threshold line only. Subtle "awaiting samples" centered text (`tokens.color.text.t4`). |
| Running with data | Traces scroll right-to-left as samples arrive. |
| Stopped | Last 60 rounds frozen. Add `PAUSED` overlay top-right corner (12px mono, t3). |
| Endpoint disabled | Trace not rendered. Stats row shows muted. |
| Sample timeout | Render chevron at top edge (300ms peg) at that round in pink; no connect to previous/next sample (gap). |
| Sample error | Same as timeout but violet chevron. |

## Accessibility

- SVG `role="img"` with a live-updating `aria-label` describing current state: "Live latency scope, 5 endpoints, median 127ms, 2 over threshold".
- Tooltips also have text alternatives in an off-screen `aria-live="polite"` region, throttled to once per 2s.
- Split/Unified toggle is a real `<button>` group with `aria-pressed`.
- Focus indicator on canvas when keyboard-focused; arrow keys move crosshair round-by-round.

## Performance budget

- Max 10 endpoints × 60 rounds = 600 points rendered per frame.
- Target 60fps on mid-range laptops. If that bends, switch ScopeCanvas from SVG polylines to Canvas2D (existing `TimelineCanvas.svelte` is already Canvas2D — reuse its rendering core, swap the axes/scale; see `03-components/scope-canvas.md`).

## Open questions

- Should the threshold line's pink color shift when the median crosses it (e.g., trace color under threshold vs over)? Prototype keeps trace color constant. Recommend: constant trace colors; threshold itself is the only mover.
- Should "Unified" use additive blending for overlapping traces? Currently no. Recommend: no — accessibility (colorblind users) depends on discrete traces.
