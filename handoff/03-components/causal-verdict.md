# CausalVerdictStrip component — spec

**Target file:** `src/lib/components/CausalVerdictStrip.svelte`
**Prototype reference:** `v2/view-overview-v2.jsx` → `CausalVerdictStrip` + `computeCausalVerdict`

## Purpose

A single sentence that names the cause and points at what to do about it. The sentence distinguishes **shared-phase upstream** problems ("DNS slow on 3 endpoints — likely upstream.") from **endpoint-specific** problems ("legacy-ops degraded alone — endpoint-specific.").

This is the Overview's highest-value output. It converts raw stats into a diagnosis.

## The sentence is the product

Not a headline plus a detail. Not a summary plus a trace. **One sentence.** If the engineer needs to see the underlying stats, the metrics triptych is below it and the racing strip is next to it. The verdict's job is to be a confident, scannable, conclusion.

## Props

```ts
interface Verdict {
  tone: 'good' | 'warn';
  headline: string;              // the one sentence
  phase?: Tier2Phase;            // set when headline cites a dominant phase
  worstEpId?: string;            // set when only one endpoint is degraded
}

interface Props {
  verdict: Verdict;
  endpoints: Endpoint[];
  statsMap: Record<string, EndpointRuntimeData>;
  onDrill: (epId: string) => void;
}
```

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ● DNS slow on 2 endpoints — likely upstream.                   │
│  ─────────────────────────────────────────────                  │
│  MEDIAN  147ms    JITTER  12.4σ    LOSS  0.3%      [ Diagnose → ]│
└─────────────────────────────────────────────────────────────────┘
```

Grid: two columns. Row 1 (headline) spans both. Row 2 splits into metrics (left, auto-sized) and drill CTA (right).

```css
.verdict {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px 22px;
  align-items: center;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 18px;
}
.verdict-main    { grid-column: 1 / -1; }
.verdict-metrics { grid-column: 1; padding-top: 10px; border-top: 1px solid var(--border); }
.verdict-drill   { grid-column: 2; align-self: center; }
```

## Tone

Two visual states — **good** and **warn**. No "critical" as a separate tone; the sentence itself escalates the language.

| Tone | Border | Background | Dot |
|---|---|---|---|
| `good` | `rgba(134,239,172,.25)` | `var(--panel)` | mint, no animation |
| `warn` | `rgba(251,191,36,.30)` | linear-gradient 3% amber overlay | amber, `pulse 1.8s` |

The dot is 8px circle with a 0 0 8px glow matching its color. The pulse animates opacity 1 → 0.55 → 1 on 1.8s infinite.

## The decision tree (`computeCausalVerdict`)

```
INPUT: rows = endpoints with stats; threshold

if rows.length === 0:
  → { tone: 'good', headline: 'Calibrating…' }

overCount = count(rows where stats.p50 > threshold)
avgLoss   = mean(rows.stats.lossPercent)
avgJit    = mean(rows.stats.stddev)

if overCount === 0 AND avgLoss < 1 AND avgJit < 25:
  → { tone: 'good', headline: 'All links within tolerance.' }

# Compute dominant phase per endpoint using tier2
dominance[] = for each row with tier2:
  dom = argmax over phases of tier2[phase] / sum(tier2)
  { ep, stats, dom, domPct }

# Count unhealthy endpoints by shared dominant phase
unhealthyCounts[phase] = count(dominance where stats.p50 > threshold * 0.7 AND dom === phase)
topPhase = argmax of unhealthyCounts

if overCount >= 2 AND topPhase count >= 2:
  → { tone: 'warn',
      headline: `${phaseLabels[topPhase]} slow on ${count} endpoints — likely upstream.`,
      phase: topPhase }

if overCount === 1:
  bad = the one row where stats.p50 > threshold
  → { tone: 'warn',
      headline: `${bad.ep.label} degraded alone — endpoint-specific.`,
      worstEpId: bad.ep.id }

if avgLoss > 1:
  → { tone: 'warn', headline: `Packet loss elevated to ${avgLoss.toFixed(1)}%.` }

if avgJit > 25:
  → { tone: 'warn', headline: `Jitter elevated — σ ${avgJit.toFixed(1)}ms.` }

# Fallback
→ { tone: 'warn', headline: `${overCount} endpoint${s} above threshold.` }
```

**Phase labels:**

```ts
const phaseLabels = {
  dns:      'DNS',
  tcp:      'TCP handshake',
  tls:      'TLS handshake',
  ttfb:     'TTFB',
  transfer: 'Transfer',
};
```

**Design decisions locked into the tree:**

- Threshold for "unhealthy" when checking phase dominance is **0.7× threshold**, not 1.0×. A phase can be dominant before the endpoint is fully over threshold, and that's still signal.
- Two-endpoint minimum before we call it "upstream" — one endpoint sharing a dominant phase with nothing else is not evidence of upstream.
- Loss > 1% and jitter > 25ms are separate branches. Either alone produces a verdict, even if no endpoint is over threshold.
- Copy ends with a period. Confident statements, not telegrams.

Extract this function to `src/lib/utils/verdict.ts`. **Unit test it exhaustively** — every branch, plus the "tied dominant phase" edge case (equal counts across two phases → pick either deterministically by alphabetical order).

## Drill button

```
┌──────────────────────────┐
│ Diagnose  api-gateway →  │
└──────────────────────────┘
```

Shows when `drillEp` is resolvable — either `verdict.worstEpId` or the overall worst-p95 endpoint as fallback. Hidden when there's no bad endpoint (tone: `good`).

On click: `onDrill(drillEp.id)` → parent routes to Diagnose view with endpoint focused.

```css
.verdict-drill {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  background: rgba(103,232,249,.08);
  border: 1px solid rgba(103,232,249,.25);
  color: var(--cyan);
  font-family: var(--mono); font-size: var(--ts-sm);
  letter-spacing: var(--tr-label);
  text-transform: uppercase;
}
.verdict-drill:hover { background: rgba(103,232,249,.15); }
```

Endpoint label in the button uses the endpoint's color; the arrow uses cyan.

## Metrics triptych

Three mini-metrics, inline, below the headline:

| Label | Value | Unit |
|---|---|---|
| MEDIAN | `round(avgP50)` | ms |
| JITTER | `avgJit.toFixed(1)` | σ |
| LOSS | `avgLoss.toFixed(1)` | % |

Styling: label is 9.5px mono all-caps `t4`; value is 17px mono `t1` with unit as 11px `t3`. Tabular-nums always.

Use these as the *backing evidence* for the verdict, never as the verdict itself. If a user is skimming, they should read the sentence; if they want to verify, they look at the triptych.

## States

| State | Behavior |
|---|---|
| Idle (no stats) | Headline "Calibrating…", good tone, no drill button, metrics show `—` |
| Good (all healthy) | "All links within tolerance.", good tone, no drill |
| Warn (any branch) | warn tone, headline per tree, drill button visible if endpoint resolvable |
| Stopped | Freeze last verdict; do not say "Calibrating…" on stop |

## Accessibility

- Headline is in an `<h2>` for the view (or `role="status"` on the container, `aria-live="polite"`). A verdict change is the most important signal on the page — screen readers should hear it.
- Drill button has `aria-label="Diagnose ${drillEp.label}, route to diagnose view"`.
- Metrics use `<dl>/<dt>/<dd>` triples.
- The dot is decorative: `aria-hidden="true"`. Tone is conveyed by the words in the sentence.

## What this component is not

- Not a notification center. The event feed is the activity log; this is the diagnosis.
- Not a history. Renders the current verdict only.
- Not multi-line. If you find yourself wanting a second sentence, simplify the first one instead.
