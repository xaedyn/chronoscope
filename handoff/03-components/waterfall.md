# Waterfall component — spec

**Target file:** `src/lib/components/Waterfall.svelte`
**Prototype reference:** `v2/view-diagnose.jsx` → `Waterfall`
**Related existing file:** `src/lib/components/LaneHeaderWaterfall.svelte`

## Purpose

The phase-breakdown visualization used in AtlasView. Given tier-2 averages (or per-sample phases), render a stacked horizontal bar showing where time is spent.

The existing `LaneHeaderWaterfall.svelte` already does this for lanes. **Extract its core into a reusable component**, then have both the lane header and the new Atlas waterfall consume it.

## Refactor recommendation

Before implementing AtlasView:

1. Create `src/lib/components/PhaseBar.svelte` — pure visual, one stacked bar with phase labels.
2. Have `LaneHeaderWaterfall.svelte` consume `PhaseBar`.
3. Create `Waterfall.svelte` (AtlasView's component) to consume `PhaseBar` + hypothesis strip + sample strip.

This avoids duplicating the tier-2 rendering logic in two places.

## PhaseBar props

```ts
interface Props {
  phases: {
    dns: number;        // ms
    tcp: number;
    tls: number;
    ttfb: number;
    transfer: number;
  };
  total?: number;       // if omitted, computed as sum of phases
  height?: number;      // default 80
  showLabels?: boolean; // default true
  mode?: 'p50' | 'p95'; // affects label text only
}
```

## Rendering

Single full-width bar. Segment widths proportional to phase ms. Minimum segment width: 2px (so very small phases still get a sliver).

```svg
<svg viewBox="0 0 800 80" preserveAspectRatio="none">
  <rect x="0"   y="10" width="40"  height="50" fill="{tokens.color.tier2.dns}" />
  <rect x="40"  y="10" width="110" height="50" fill="{tokens.color.tier2.tcp}" />
  <rect x="150" y="10" width="170" height="50" fill="{tokens.color.tier2.tls}" />
  <rect x="320" y="10" width="420" height="50" fill="{tokens.color.tier2.ttfb}" />
  <rect x="740" y="10" width="60"  height="50" fill="{tokens.color.tier2.transfer}" />

  <!-- labels — only rendered when segment width >= 40px -->
  <text ... fill="{tokens.color.tier2.labelText}">
    SERVER · 180ms
  </text>
</svg>
```

- Segment radius: first segment rounded on left, last on right, middle square. Use clip-path or just accept straight edges (the existing lane waterfall uses straight edges).
- Label placement: centered within segment, 10px mono, `tokens.color.tier2.labelText`. Skip rendering when segment width < 40px.
- Hover a segment: tooltip with `{phase} — {ms}ms — {pct}%`.

## Hypothesis strip (Atlas only, not in PhaseBar)

Separate component in `Waterfall.svelte`. Computes:

```ts
function hypothesis(phases: PhaseBreakdown): {
  verdictPhase: PhaseName | 'mixed';
  text: string;
  dominantPct: number;
} {
  const total = sumPhases(phases);
  if (total === 0) return { verdictPhase: 'mixed', text: 'Awaiting tier-2 samples', dominantPct: 0 };

  const entries = Object.entries(phases) as [PhaseName, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const [topName, topMs] = entries[0];
  const topPct = topMs / total;

  if (topPct > 0.6) {
    return {
      verdictPhase: topName,
      text: `Slow ${PHASE_LABELS[topName]} — ${Math.round(topPct * 100)}% of total time.`,
      dominantPct: topPct,
    };
  }

  const [secondName, secondMs] = entries[1];
  if ((topMs + secondMs) / total > 0.8) {
    return {
      verdictPhase: 'mixed',
      text: `${PHASE_LABELS[topName]} and ${PHASE_LABELS[secondName]} dominate — ${Math.round(((topMs + secondMs) / total) * 100)}% together.`,
      dominantPct: (topMs + secondMs) / total,
    };
  }

  return {
    verdictPhase: 'mixed',
    text: 'No single phase dominates — investigate overall network conditions.',
    dominantPct: 0,
  };
}
```

## Sample strip (Atlas only)

8 rows, one per recent sample. Each row is its own mini PhaseBar at 14px height + total ms on the right.

Use `<table role="table">` for semantic structure. See `02-view-specs/atlas.md` for visual spec.

## Empty / skeleton states

| State | Render |
|---|---|
| No tier-2 data yet | Render segments in `tokens.color.text.t5` with `"awaiting"` pattern (diagonal stripe background). Labels hidden. |
| Sample has no tier-2 | In sample strip, render single flat bar in t4. |
| Timeout sample | Render single flat bar in `tokens.color.heatmap.slow`, marked "TIMEOUT". |
