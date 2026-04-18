# RacingStrip component — spec

**Target file:** `src/lib/components/RacingStrip.svelte`
**Prototype reference:** `v2/view-overview-v2.jsx` → `RacingStrip`

## Purpose

Compare all endpoints on a **shared latency axis**. One row per endpoint, with that endpoint's central tendency (p50–p95 band), dispersion (band width), history (trailing sparkline), and current state (live dot) all plotted against the same x-scale.

Because every row uses the same scale, you can do two things at a glance the Classic SubDialsGrid couldn't:

1. **See correlation** — are all dots drifting right together (shared upstream), or is one popping out alone (endpoint-specific)?
2. **Rank by severity** — the rightmost dot is the worst offender. No math, no compare.

This is the Enriched Overview's main *workbench* — the dial tells you "something is wrong," the racing strip tells you "here is where."

## Props

```ts
interface Props {
  endpoints: Endpoint[];
  statsMap: Record<string, EndpointRuntimeData>;
  threshold: number;                       // ms
  focusedEpId: string | null;              // for highlighting the row matching the rail focus
  onClick: (e: MouseEvent, ep: Endpoint) => void;  // click → drill
}
```

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Per-endpoint comparison                                         │
│  Live latencies on shared axis        Click → Live · ⇧ → Diagnose│
├──────────────────────────────────────────────────────────────────┤
│  0            50          120┊trigger      200          300ms   │
├──────────────────────────────────────────────────────────────────┤
│  ● api-gateway       [══════●═════════════════] 127ms  p95 210  │
│  ● auth-service      [═════●═══════════════]    88ms   p95 142  │
│  ● legacy-ops  [══════════════●════════════════] 198ms  p95 320 │
│  ● cdn-origin  [══●═════]                       42ms   p95 68   │
│  ● analytics   [═══●════════]                   62ms   p95 95   │
└──────────────────────────────────────────────────────────────────┘
```

Each row is a `<button>`:

```
grid-template-columns: 180px 1fr 78px;
```

1. **Label column** (180px) — endpoint color dot + name.
2. **Track column** (1fr) — the shared-axis track with all the visualization.
3. **Stats column** (78px) — `live · p95`, mono, tabular-nums, right-aligned.

## Axis scale

Dynamic, clamped to `[150, 300]` ms:

```ts
const maxSeen = Math.max(
  150,
  Math.min(300, Math.ceil((Math.max(...endpointP95s, 0) * 1.2) / 30) * 30)
);
```

Rounded to the next 30ms boundary for clean axis labels. Updates when any endpoint's p95 changes substantially.

## Axis labels

Five tick labels above the rows:

```
[ 0 | maxSeen/3 | threshold (labelled "N trigger") | 2·maxSeen/3 | maxSeen ]
```

The threshold label floats on the axis at `(threshold / maxSeen) * 100%`. If threshold > maxSeen, clamp to 100%.

## Per-row elements (rendered in this z-order, back to front)

1. **Track background** — linear gradient split at the threshold position. Left of threshold: `rgba(255,255,255,.04)`. Right of threshold (the "unhappy zone"): `rgba(249,168,212,.06)` (pink tint at 6%).
2. **Threshold tick** — 1px vertical line at `(threshold / maxSeen) * 100%`. Color: `tokens.color.svg.thresholdStroke` at 40%.
3. **p50→p95 band** — horizontal rounded rectangle from `pctP50` to `pctP95`. Fill: `ep.color` at ~20% opacity. This is the endpoint's "where it usually lives" range. Min width `0.5%` so narrow bands remain visible.
4. **Trailing sparkline** — inline `<svg viewBox="0 0 100 28" preserveAspectRatio="none">`. Last 40 samples, one path, stroke = `ep.color` at 55% opacity. Lost samples break the path (`M` instead of `L`).
5. **Live dot** — 8–10px circle at `pctLat`. Fill: `ep.color`. Box-shadow glow = `ep.color` (larger when over threshold). CSS `transition: left 250ms ease-out` for smooth motion.

**Design rule:** nothing in the row should be drawn outside its track bounds. Clip to the track rectangle with `overflow: hidden; border-radius: 6px`.

## Row states

```css
.row:hover       → background rgba(255,255,255,.03); border-color: border
.row.focused     → background rgba(255,255,255,.05); border-color: border-bright
.row.over        → background rgba(249,168,212,.04)    /* when live > threshold */
```

Focused + over can combine.

## Interactions

| Input | Action |
|---|---|
| Click | `onClick(e, ep)` → handler routes to Live view with endpoint focused |
| Shift-click | `onClick(e, ep)` — handler inspects `e.shiftKey` and routes to Diagnose view instead |
| Hover | Row gets a background highlight and border |
| Focus (keyboard) | Same as hover. Enter key triggers click. |

## Accessibility

- Each row is a native `<button>` — participates in tab order, responds to Space/Enter.
- `aria-label`: `"{ep.label}, live {lat}ms, p95 {p95}ms, {state}"` where state is `"within threshold"` or `"above threshold"`.
- The sparkline is decorative: wrap in `<g aria-hidden="true">` inside the SVG.
- The colored dots use a color but also a labelled text name — color is not the only channel.

## Performance

- The sparkline SVG rerenders on every tick. It's 40 points × N endpoints; at 5 endpoints that's 200 points. Fine for SVG.
- If N > 20 endpoints, switch the sparkline to Canvas2D — but Enriched is not designed for >20 endpoint scenarios. The rail itself already bottlenecks at ~15.
- Live dot `transition: left` is hardware-accelerated; don't animate `width`/`height` on the dot when it crosses threshold — animate box-shadow or use a pseudo-element.

## Sizing / responsive

- Default 1fr track column means the row grows with the container.
- On narrow containers (<520px), drop the stats column (`78px`) and fold `live ms` into the track as a tooltip on the live dot. But: Enriched Overview is not a mobile target in v1. Park this.

## Empty / loading states

- No endpoints: render nothing (parent view handles the empty case).
- Endpoint with no samples yet: render the row label, greyed-out track, no band, no dot, stats show `—`.
