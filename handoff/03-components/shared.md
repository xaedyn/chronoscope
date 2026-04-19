# Shared utilities — spec

**Target files:** `src/lib/utils/format.ts`, `src/lib/utils/classify.ts`
**Prototype reference:** `v2/shared.jsx`

These are the small but critical functions the new views all depend on. They already exist in part — audit before duplicating.

## 1. `fmt()` — latency formatter

**Target:** `src/lib/utils/format.ts` (extend existing).

Single source of truth for rendering ms values. **All ms displays must go through this.**

```ts
/**
 * Format a millisecond value for display.
 *
 *   fmt(0.43)   → "0.43"
 *   fmt(12)     → "12"
 *   fmt(127.4)  → "127"
 *   fmt(1234)   → "1,234"
 *   fmt(null)   → "—"
 *   fmt(Infinity) → "—"
 */
export function fmt(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—';
  if (ms < 1) return ms.toFixed(2);
  if (ms < 10) return ms.toFixed(1);
  if (ms < 10000) return Math.round(ms).toLocaleString();
  return (ms / 1000).toFixed(1) + 's';
}
```

## 2. `fmtParts()` — split num + unit

For cases where number and unit need independent styling (rail metric, overview triptych):

```ts
export function fmtParts(ms: number | null | undefined): { num: string; unit: string } {
  if (ms == null || !isFinite(ms)) return { num: '—', unit: '' };
  if (ms < 10000) return { num: fmt(ms), unit: 'ms' };
  return { num: (ms / 1000).toFixed(1), unit: 's' };
}
```

## 3. `fmtPct()` and `fmtCount()`

```ts
export function fmtPct(ratio: number): string {
  return Math.round(ratio * 100) + '%';
}

export function fmtCount(n: number): string {
  return n.toLocaleString();
}
```

## 4. `classify()` — health classifier

**Target:** `src/lib/utils/classify.ts` (new).

Takes endpoint stats → returns a health bucket. Centralized so dial color, rail pip color, and verdict text can't disagree.

```ts
import type { EndpointStatistics } from '$lib/types';

export type HealthBucket = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthStyle {
  color: string;       // CSS color
  glow: string;        // CSS color, typically `${color}55`
  label: string;       // "Healthy" | "Degraded" | ...
  tone: string;        // darker variant for arcs/borders
}

export const HEALTH_STYLES: Record<HealthBucket, HealthStyle> = {
  healthy:   { color: 'var(--accent-cyan)', glow: 'var(--accent-cyan-glow)', label: 'Healthy',   tone: 'var(--accent-cyan-tone)' },
  degraded:  { color: 'var(--accent-amber)', glow: 'var(--accent-amber-glow)', label: 'Degraded',  tone: 'var(--accent-amber-tone)' },
  unhealthy: { color: 'var(--accent-pink)', glow: 'var(--accent-pink-glow)', label: 'Unhealthy', tone: 'var(--accent-pink-tone)' },
  unknown:   { color: 'var(--t4)',          glow: 'transparent',              label: 'No data',   tone: 'var(--t4)' },
};

/**
 * Classify an endpoint's current health from its rolling stats and threshold.
 *
 * - healthy:   p95 <= threshold AND p50 <= threshold * 0.5
 * - degraded:  p95 <= threshold * 2 OR p50 <= threshold
 * - unhealthy: otherwise
 * - unknown:   stats not ready
 */
export function classify(stats: EndpointStatistics | null, threshold: number): HealthBucket {
  if (!stats || !stats.ready) return 'unknown';
  const p50 = stats.p50 ?? Infinity;
  const p95 = stats.p95 ?? Infinity;

  if (p95 <= threshold && p50 <= threshold * 0.5) return 'healthy';
  if (p95 <= threshold * 2 || p50 <= threshold)   return 'degraded';
  return 'unhealthy';
}
```

## 5. `networkQuality()` — aggregate score

Takes all stats → returns 0–100 overall score for the main dial.

```ts
/**
 * Overall network health score from all endpoints' stats.
 *
 * Score is an inverse weighted of endpoints breaching threshold:
 *   - 100 = all endpoints healthy
 *   - 0   = all endpoints unhealthy
 *   - unknown endpoints (not ready yet) are excluded from the denominator
 */
export function networkQuality(
  stats: EndpointStatistics[],
  threshold: number,
): number | null {
  const ready = stats.filter(s => s && s.ready);
  if (ready.length === 0) return null;

  let score = 0;
  for (const s of ready) {
    const bucket = classify(s, threshold);
    score += bucket === 'healthy' ? 100 : bucket === 'degraded' ? 60 : 20;
  }
  return Math.round(score / ready.length);
}
```

## 6. Endpoint color resolver

The existing `tokens.color.endpoint[]` array has N colors. Resolve deterministically from endpoint ID:

```ts
export function endpointColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const palette = tokens.color.endpoint;
  return palette[Math.abs(h) % palette.length];
}
```

If the project already assigns colors in order (first-registered-gets-first-color), preserve that behavior — use `endpointStore.indexOf(id)` instead.

## Testing notes

- Pure functions — unit test every one. Target 100% branch coverage on `classify` and `networkQuality`.
- `fmt(null)`, `fmt(undefined)`, `fmt(NaN)`, `fmt(Infinity)`, `fmt(-1)` must all return `"—"`.
- `classify(null, 120)` must return `'unknown'`, not throw.
