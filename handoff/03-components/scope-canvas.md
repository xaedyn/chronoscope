# ScopeCanvas component — spec

**Target file:** `src/lib/components/ScopeCanvas.svelte`
**Prototype reference:** `v2/view-live.jsx` → `ScopeCanvas`

## Purpose

The oscilloscope renderer. Shows the last N rounds of latency as continuous polylines per endpoint.

## Rendering choice

**Prototype uses SVG polylines.** For production, **use Canvas2D** — reuse the rendering infrastructure of the existing `TimelineCanvas.svelte`:

- Same `render-scheduler.ts` — off-main-thread scheduling
- Same `timeline-data-pipeline.ts` — produces `FrameData`
- Same Canvas2D setup in `timeline-renderer.ts` — swap the data-source logic

This gives you the 60fps path for free and keeps the team's render patterns consistent. The SVG in the prototype is a fidelity shortcut, not a recommendation.

## Props

```ts
interface Props {
  endpoints: Endpoint[];
  statsMap: Record<string, EndpointRuntimeData>;
  threshold: number;
  onThresholdChange?: (ms: number) => void;   // optional — v2
  onDrill: (endpointId: string) => void;
  height: number;                              // 220 (split) | 540 (unified/solo)
  solo?: boolean;                              // true when single endpoint
}
```

## Coordinate system

Fixed design coordinate space: **1440×640**. Render canvas to container size; draw in the design space and scale transform-wise.

- **X axis:** round index. Last 60 rounds visible (`tokens.lane.chartWindow`). Right edge = latest.
- **Y axis:** linear 0–300ms. Above 300ms clamps at top; render a chevron at that x position.
- **Padding:** `tokens.lane.chartPaddingX` horizontal, `tokens.lane.chartPaddingY` vertical.

## Layers (back to front)

1. **Grid — horizontal.** Hairline at every 15ms (minor, `tokens.color.svg.gridLine`) and 60ms (major, rgba(255,255,255,.06)).
2. **Grid — vertical.** Hairline every 10 rounds. Major every 30 rounds with round-index label (mono 9px, t4).
3. **Threshold line.** Horizontal dashed pink line at `threshold`ms. Stroke `tokens.color.svg.thresholdStroke` @ 50% opacity, dash `[4, 4]`.
4. **Traces.** One polyline per endpoint. Stroke = endpoint color. `lineWidth=1.5`. `lineCap="round"`. No fill.
5. **Sample markers** *(optional)*. A dot at each sample point if `sampleCount <= 30`; otherwise just the polyline.
6. **Overflow chevrons.** For any sample > 300ms, draw a 6px chevron at the top edge at that round's x, in endpoint color.
7. **Timeouts/errors.** For status `timeout` → pink chevron at top edge, no polyline connection across. For status `error` → violet chevron.
8. **Cursor.** On hover: vertical 1px line at mouse x, plus a small dot on each trace at that round.

## Trace data

Per endpoint, build the polyline from `measurementStore.endpoints[id].samples.slice(-60)`:

```ts
const points = samples.map(s => [
  xScale(s.round),
  s.status === 'ok' ? yScale(Math.min(s.latency, 300)) : yScale(300)
]);
```

Break the polyline at every non-`ok` sample (move to, don't line to).

## Hover / tooltip

Throttled `mousemove` (16ms). Convert mouse x → round index. For each endpoint, find the sample at that round. Render tooltip at mouse position:

```
┌──────────────────────────┐
│ api-us         round 1283│
│ ● 127 ms       ok        │
│ 04:21:17.882             │
└──────────────────────────┘
```

Use `tokens.color.tooltip.bg`, backdrop-filter blur 8px, border `tokens.color.glass.border`, 12px padding, radius `tokens.radius.sm`, mono 10px.

**Z-index:** `40` minimum. Tooltip must stack above every other surface in the app (including Tweaks, Topbar, orbit overlays).

## Interactions

| Event | Effect |
|---|---|
| Hover a trace (within 6px perpendicular) | Highlight that endpoint's trace; others drop to 40% opacity. |
| Click a trace | `onDrill(endpointId)` → routes to Atlas. |
| Double-click background | No-op (reserved). |
| Keyboard focus | Crosshair at center. Arrow keys move round-by-round. |

## Performance

- Clear & redraw only on frame budget or data change — not on every `tick`.
- When data hasn't changed since last frame (e.g. paused), skip redraw.
- Cap traces at 10 endpoints × 60 samples = 600 draw ops. Comfortably 60fps.

## Accessibility

SVG/Canvas wrapped in `<div role="img" aria-label="...">`. Off-screen `<ul aria-live="polite">` lists current values once every 2s for screen readers:

```
<li>api-us: 127 ms, okay</li>
<li>api-eu: 94 ms, okay</li>
<li>api-asia: 340 ms, over threshold</li>
```
