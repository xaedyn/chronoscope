# ChronographDial component — spec

**Target file:** `src/lib/components/ChronographDial.svelte`
**Prototype reference:** `v2/view-overview.jsx` → `MainDial`

## Purpose

The Overview hero visualization. A 520×520 analog dial showing aggregate network health, with an orbit ring of live endpoint markers around the outside.

## Props

```ts
interface Props {
  score: number | null;              // 0–100 from networkQuality(), null if no data
  liveMedian: number | null;         // ms
  threshold: number;                 // ms
  endpoints: Endpoint[];
  statsMap: Record<string, EndpointRuntimeData>;
  tick: number;                      // increments per measurement round
  running: boolean;
}
```

## Geometry constants

```ts
const SIZE   = 520;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER_R = 240;
const INNER_R = 186;

// Angle mapping: 0ms at -135°, 300ms at +135° (270° arc, bottom gap)
const START_ANG = -135;
const END_ANG   =  135;
const latToAng = (ms: number) =>
  START_ANG + clamp(ms / 300, 0, 1) * (END_ANG - START_ANG);
```

## Layers (from back to front)

1. **Background disc** — `outerR + 8` hairline ring for structure.
2. **Dial face** — `outerR` radius, fill gradient from `tokens.color.surface.deep` to near-black center.
3. **Concentric guides** — hairline circles at `outerR - 36` and `60` (no function; adds depth).
4. **Threshold arc** — arc from `latToAng(threshold)` to `END_ANG`, stroke `tokens.color.svg.thresholdStroke` at 35% opacity.
5. **Tick marks** — every 15ms (minor) + every 60ms (major), inward from `outerR - 2`.
6. **Numeric labels** — `[0, 60, 120, 180, 240, 300]` at `outerR - 30`, mono, 10px.
7. **Endpoint orbit ring** — dedicated track *outside* the scale. See below.
8. **Hand** — white line from hub to `outerR - 10` at `latToAng(liveMedian)`. Thickness 2.2px, rounded, glow filter.
9. **Central hub** — 8px dark disc with 2.5px white center.

## Orbit ring (the critical bit)

The orbit is a separate layer that keeps the dial face clean. Sits at:

```ts
const ORBIT_R = OUTER_R + 4;  // just outside the scale
const BAR_INNER = ORBIT_R - 3;
const BAR_OUTER = ORBIT_R + 3;
```

Draw in order:
1. **Track:** thick hairline circle at `ORBIT_R`, 6px stroke, rgba(255,255,255,.06).
2. **Track edge:** thin stroke at `ORBIT_R`, 0.8px, rgba(255,255,255,.1).
3. **Per-endpoint marker:** for each endpoint with `lastLatency != null`:
   - Angle: `latToAng(lastLatency)`
   - **Bar:** short radial line from `BAR_INNER` to `BAR_OUTER`, stroke = endpoint color, 2.5px rounded.
   - **Pip:** small circle at `BAR_OUTER + 4`, r=2.2 (r=3 if over threshold), fill = endpoint color.
   - **Pulse:** if `lastLatency > threshold`, animate pip radius 2.2 → 4 → 2.2 over 1.4s, infinite.

**Design rule:** never put endpoint markers inside the dial face (overlapping ticks/labels/hand). The orbit ring is the only correct home for them.

## Live hand animation

The hand must smoothly interpolate between sample values — not snap. Use rAF:

```ts
let displayAng = $state(latToAng(liveMedian));
$effect(() => {
  const target = latToAng(liveMedian ?? 0);
  let raf: number;
  const step = () => {
    displayAng = displayAng + (target - displayAng) * 0.15;
    if (Math.abs(target - displayAng) > 0.1) raf = requestAnimationFrame(step);
  };
  step();
  return () => cancelAnimationFrame(raf);
});
```

`0.15` lerp factor is tuned for the prototype. Reduce for slower/more deliberate motion.

## Pulse effect

When the hand crosses `threshold`, pulse the rim ring (stroke at `outerR - 4`) from regular weight to the health tone for 400ms. Track threshold-cross events in the component — compare current vs previous `liveMedian`.

## Sizing

Fixed 520px in the prototype. In production, make it responsive by setting a container at `min(520px, 80vw)` and scaling the SVG with `viewBox="0 0 520 520"` and `preserveAspectRatio="xMidYMid meet"`.

## Accessibility

Wrap SVG with:
```
<div role="img" aria-label="Network health dial: {score ?? 'no data'} percent healthy,
     median latency {liveMedian ?? 'unknown'} milliseconds,
     {endpoints.length} endpoints monitored.">
```

Live region (off-screen, `aria-live="polite"`, throttled to 2s updates) announces threshold crossings: "Median latency crossed threshold — now {liveMedian}ms, threshold {threshold}ms."

---

# Dial v2 — enhancements for Enriched Overview

Ships with Phase 2.5 (see `06-implementation-plan.md`). Three additions to the Classic dial, no removals. The classic layers still compose the base — v2 adds layers on top and modulates existing layers' weights.

**Target file:** same — `ChronographDial.svelte`. Gate via a `variant: 'classic' | 'v2'` prop, default `'v2'` once Enriched is the default Overview mode.

## Props additions

```ts
interface Props {
  // …all Classic props, plus:
  variant?: 'classic' | 'v2';              // default 'v2'
  scoreHistory?: Array<{ tick: number; score: number }>;  // for quality trace
  baseline?: { p25: number; median: number; p75: number } | null;
  // Baseline is computed by the view from last 120s of samples; see below
}
```

Classic callers pass neither `scoreHistory` nor `baseline` — dial renders exactly as before.

## New layer: baseline arc

A low-contrast arc showing **where the network usually lives**. If today's median sits inside the arc, "today is normal." If the hand is outside it, "today is unusual."

Where to draw:

```ts
const BASELINE_R = OUTER_R - 48;          // inside the tick track
const bStart = latToAng(baseline.p25);
const bEnd   = latToAng(baseline.p75);
```

Render as a stroked arc:

- Stroke width: 14px
- Stroke: `rgba(255,255,255,.07)` (the "normal band" tone)
- Round linecaps
- A subtle 1.5px tick at `latToAng(baseline.median)` using `rgba(255,255,255,.14)` to mark the central tendency

Hide the arc entirely when `baseline == null` or when sample count in the baseline window < 30 (low confidence).

**Baseline computation** (in the view, not the dial):

```ts
// In OverviewView, over last 120s of allEndpoints × allSamples
const recent = allSamples.filter(s => s.t >= now - 120_000 && s.latency != null);
if (recent.length >= 30) {
  const sorted = [...recent.map(s => s.latency)].sort((a,b) => a-b);
  baseline = {
    p25:    quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75:    quantile(sorted, 0.75),
  };
}
```

Recompute every 5s, not every tick — expensive and the band shouldn't jitter.

## New layer: 60s quality trace

A small sparkline **inside the dial**, below the score readout, showing the last 60 samples of `networkQuality()`. Tells you if the score is trending up, down, or holding.

Geometry (inside the face, below center):

```
viewBox offset: (CX - 70, CY + 34)
width: 140, height: 26
```

Plot:

- X: 0..140 mapped over the `scoreHistory.length` points
- Y: `26 - (score / 100 * 24) - 1` (inverted, 0 at bottom, 100 at top)
- Path: single `<path>`, stroke = dynamic (see below), 1.4px, round linecaps, no fill
- Below the path, a gradient fill to the baseline: `stroke-opacity: 0`, `fill: url(#trace-grad)` — gradient goes from the stroke color at 20% opacity at top to 0 at bottom

Dynamic stroke color, lerped from score:

```ts
if (liveScore >= 70)      trace = tokens.color.accent.mint;
else if (liveScore >= 45) trace = tokens.color.accent.amber;
else                      trace = tokens.color.accent.pink;
```

Hide when `scoreHistory.length < 4` — render a `CALIBRATING` label instead in the same slot.

## Breathing chrome

The whole dial "inhales" as the network is healthy and "exhales" as it degrades. All five of these transitions run in parallel over **900ms ease**, driven by `liveScore`:

| Element | Healthy (score ≥ 70) | Degraded (score < 45) |
|---|---|---|
| Outer ring stroke opacity | 0.14 | 0.32 |
| Dial face stroke width | 1.2px | 2.2px |
| Tick marks opacity | 0.32 (minor) / 0.6 (major) | 0.55 / 0.85 |
| Scale labels opacity | 0.42 | 0.68 |
| Central score font-weight | 500 | 700 |

Interpolate linearly between the two extremes as the score moves across `[45, 70]`. Below 45: full "degraded" state. Above 70: full "healthy" state.

Implementation: compute a `weight` scalar (0 = healthy, 1 = degraded) and bind CSS custom properties:

```svelte
<script>
  let weight = $derived(clamp((70 - (liveScore ?? 70)) / 25, 0, 1));
</script>
<svg style="
  --ring-opacity:   {0.14 + weight * 0.18};
  --face-stroke:    {1.2 + weight * 1.0}px;
  --tick-minor-op:  {0.32 + weight * 0.23};
  --tick-major-op:  {0.60 + weight * 0.25};
  --label-op:       {0.42 + weight * 0.26};
  --score-weight:   {500 + weight * 200};
  transition: --ring-opacity 900ms ease, ... ;
">
```

If the browser doesn't honor custom-property transitions (Safari historically stingy), fall back to animating the individual SVG attribute via `svelte/motion` tween.

**Design rule:** the breathing is subtle. If a user can consciously watch it "pulse," you've gone too far — back the amplitudes down by 30%.

## The "inside band / outside band" label

A small status pill below the score and trace, but inside the dial face. Tells you *in words* whether today is normal.

```
┌──────────────┐
│  94          │  ← score
│  ╱╲╱╲╲╱╲╱    │  ← quality trace
│ WITHIN BAND  │  ← this label
└──────────────┘
```

Logic:

```ts
if (!baseline || liveMedian == null) label = null;
else if (liveMedian >= baseline.p25 && liveMedian <= baseline.p75) label = 'WITHIN BAND';
else if (liveMedian > baseline.p75)  label = 'ABOVE BAND';
else                                  label = 'BELOW BAND';
```

Render in the same mono micro-label style as the scale labels — 10px, 0.14em tracking, `t4` at rest, `amber` when `ABOVE BAND`, `mint` when `WITHIN BAND`.

## What v2 does NOT change

- Geometry (size, radii, angle mapping) — unchanged
- Orbit ring — unchanged
- Hand interpolation (rAF lerp) — unchanged
- Threshold arc — unchanged
- Pulse on threshold cross — unchanged

A Classic reader should be able to understand the v2 dial without new knowledge; v2 just adds signal.

## Accessibility additions

- Baseline arc is decorative; wrap in `<g aria-hidden="true">`
- Quality trace is decorative; same
- Within-band label is NOT decorative — include it in the main `aria-label`:

```
aria-label="Network health dial: {score}% healthy, median {liveMedian}ms,
            {withinBand}, {endpoints.length} endpoints monitored."
```

Where `withinBand` is `"within normal range"`, `"above normal range"`, or `"below normal range"`.
