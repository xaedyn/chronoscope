# Strata view — spec (proposed, not yet prototyped)

> ⚠️ **Status: design direction only.** Unlike Overview, Live, and Atlas, Strata is **not** in `v2/Chronoscope v2.html`. This spec captures intent and constraints; a visual prototype must be built and reviewed before implementation begins. Treat the layout and interactions below as starting points for that prototype, not final sign-off.

**Target file:** `src/lib/components/views/StrataView.svelte`

## Purpose

The long-range distribution view — what does this endpoint's latency *shape* look like over time, not just its live value? Answers "is this endpoint consistent?" and "is it slowly drifting?"

Complements Live (last ~60s) and Atlas (single-request phases). Strata is minutes-to-hours.

## Structure

```
StrataView
├─ StrataHeader
│    ├─ kicker: "STRATA · LATENCY DISTRIBUTION OVER TIME"
│    └─ time range selector (5m / 15m / 1h / 24h)
├─ StrataGrid
│    └─ StrataRow (one per endpoint)
│         ├─ endpoint label + live p50 badge
│         ├─ distribution band (the star)
│         └─ summary stats (p50, p95, stddev)
└─ StrataLegend (at bottom — what the bands mean)
```

## Distribution band

The hero visualization. For each endpoint, one horizontal strip:

```
p50 127ms   ┌──────────────────────────────────────────────┐
            │░░░░░░░░░░▓▓▓▓▓▓████████▓▓▓▓▓░░░░░░░░         │   ← density bands
            │                     |                         │   ← live marker (vertical line)
            └──────────────────────────────────────────────┘
            0ms                                        300ms+
```

**How to draw the band:**

- X axis: latency ms, linear 0–300 (or log if range exceeds).
- Band height: 4 stratum layers stacked:
  1. p25–p75 core band (brightest, full endpoint color)
  2. p10–p90 shoulder (50% opacity)
  3. min–max whisker (20% opacity)
  4. *optional*: current live p50 marker (1px vertical line, white)
- Render samples as a **kernel density estimate** over the active time range. Simple Gaussian KDE with bandwidth = stddev / 4 is fine.

**For v1:** skip the KDE, use percentile bands only — p25, p50, p75, p90, p95, p99 as vertical ticks in the endpoint color; the band between p25 and p75 is filled. This ships faster and reads cleanly. Upgrade to KDE in v2 if needed.

## Data source

Each row consumes the full `samples` buffer for its endpoint, filtered to the active time range:

```ts
const rangeMs = { '5m': 5*60e3, '15m': 15*60e3, '1h': 60*60e3, '24h': 24*60*60e3 }[range];
const cutoff = Date.now() - rangeMs;
const recentSamples = samples.filter(s => s.timestamp >= cutoff);
```

Recompute percentiles from `recentSamples` client-side using existing `src/lib/utils/statistics.ts`. Do **not** use `statisticsStore` here — that's the all-time rolling stats, which doesn't honor the range selector.

## Interactions

| Interaction | Effect |
|---|---|
| Click endpoint row | Focus in rail. Row gets a brighter border. |
| Double-click row | Drill to AtlasView for that endpoint. |
| Change time range | Recompute percentiles for all rows. Animate band transitions over 200ms (`tokens.timing.fadeIn`, `tokens.easing.decelerate`). |
| Hover band | Tooltip shows all percentiles: p50, p75, p90, p95, p99. |

## States

| State | Behavior |
|---|---|
| No samples in range | Row shows "No samples in last {range}" in t4. |
| < 30 samples in range | Low-confidence indicator — band is rendered with 50% opacity and a "low confidence" pill next to the label. |
| Normal | Full render. |
| Endpoint disabled | Row dimmed; band still shown. |

## Accessibility

- Each row is a `<button>` with `aria-label` summarizing stats: "API US, median 127ms, 95th percentile 284ms, standard deviation 42ms".
- Time range selector is a `<button>` group with `aria-pressed`.
- Bands are decorative; numeric stats column is the non-visual source of truth.

## Open questions

- For 24h with high sample counts, KDE computation could get expensive. Recommend: cap at 5000 most recent samples per row for band computation.
- Should rows be sortable? Prototype keeps them in rail order. Recommend: add a "sort by p95 desc" toggle in v2.
