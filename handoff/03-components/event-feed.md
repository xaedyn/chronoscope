# EventFeed component — spec

**Target file:** `src/lib/components/EventFeed.svelte`
**Prototype reference:** `v2/view-overview-v2.jsx` → `EventFeed`

## Purpose

A live pulse of the most recent threshold crossings and p95 shifts. Newest event is loud; older events fade into the background. Clicking an event drills into that endpoint's Live view.

This is the "what just happened?" channel — complements the racing strip's "what's happening right now?" and the dial's "how does it feel overall?".

## Props

```ts
type EventKind = 'cross-up' | 'cross-down' | 'shift';

interface FeedEvent {
  t: number;         // ms timestamp
  epId: string;
  kind: EventKind;
  value?: number;    // latency at crossing (cross-up / cross-down)
  from?: number;     // prior p95 (shift)
  to?: number;       // new p95 (shift)
  threshold?: number;
}

interface Props {
  events: FeedEvent[];         // most-recent-first
  endpoints: Endpoint[];
  onDrill: (epId: string) => void;
}
```

## Layout

```
┌──────────────────────────────────────────────────────┐
│  Recent events                                       │
│  Threshold activity                                  │
├──────────────────────────────────────────────────────┤
│  2s ago   ● api-gateway    crossed up · 182ms        │  ← newest, loudest
│  12s ago  ● auth-service   recovered · 94ms          │  ← -14% opacity
│  47s ago  ● api-gateway    p95 shift · 98→210ms      │  ← -28% opacity
│  1m ago   ● legacy-ops     crossed up · 215ms        │  ← -42% opacity
│  3m ago   ● cdn-origin     recovered · 58ms          │  ← -56% opacity
└──────────────────────────────────────────────────────┘
```

Each row:

```
grid-template-columns: 58px 10px 120px 1fr;
gap: 8px;
```

1. Time column (`2s ago`, `1m ago`) — mono, tabular, `t4`
2. Endpoint dot
3. Endpoint name — truncate with ellipsis
4. Action phrase — `"crossed up · 182ms"`, `"recovered · 94ms"`, `"p95 shift · 98→210ms"`. The numeric part is `<em>` for the tone color.

## The newest-loud rule

This is the signature of the feed. Older events fade by rank:

```css
.feed-row {
  opacity: calc(1 - var(--rank, 0) * 0.14);
  transition: background 140ms, opacity 400ms;
}
.feed-row:hover { opacity: 1; }
.feed-row.latest { font-size: var(--ts-base); }             /* 13 vs 11 */
.feed-row.latest .feed-name { color: #fff; font-weight: 500; }
.feed-row.latest .feed-dot  { width: 8px; height: 8px; box-shadow: 0 0 6px currentColor; }
```

`--rank` is set inline: row 0 = 0, row 1 = 1, etc.

Opacities:

| Rank | Opacity |
|---|---|
| 0 (latest) | 1.00 |
| 1          | 0.86 |
| 2          | 0.72 |
| 3          | 0.58 |
| 4          | 0.44 |

Hovering any row restores full opacity and the hover background (`rgba(255,255,255,.04)`).

## New-event animation

When a new event arrives (latest key changes), the new row slides in from the left and flashes a subtle highlight:

```css
.feed-row.arrived {
  animation: feedArrive 1.2s cubic-bezier(.2,.7,.2,1) both;
}
@keyframes feedArrive {
  0%   { background: rgba(255,255,255,.1);  transform: translateX(-4px); }
  30%  { background: rgba(255,255,255,.06); transform: none; }
  100% { background: transparent; }
}
```

Track the latest event key (`${t}-${epId}-${kind}`) in a ref; toggle the `arrived` class for 1.2s when it changes.

## Action phrase color coding

Via the `kind` class:

| Kind | `<em>` color |
|---|---|
| `cross-up` | pink (`tokens.color.accent.pink`) |
| `cross-down` | mint (`tokens.color.accent.mint`) |
| `shift` | amber (`tokens.color.accent.amber`) |

This is the only place in the Overview where the event tone is expressed — the row body stays neutral.

## Time formatting

Compute `now - ev.t` once per render (not per row). Then:

```ts
function relTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
```

Overview updates every tick; time labels auto-refresh without special logic.

## Empty state

```
<div class="feed-empty">No crossings in window. Network steady.</div>
```

Mono, `t4`, slightly indented. Shown when `events.length === 0`. **Do not** show a placeholder event list.

## Interactions

| Input | Action |
|---|---|
| Click row | `onDrill(epId)` → parent routes to Live view with endpoint focused |
| Hover | Row opacity goes to 1; background highlight |
| Keyboard | `<button>` per row; Enter/Space triggers drill |

## Accessibility

- Each row is a `<button>` with `aria-label="{timeLabel} {ep.label} {action} {value}"`.
- The header (`Recent events` / `Threshold activity`) uses a real `<h3>` + subtitle.
- The fading opacity is not the only signal for "older" — the time label (`3m ago`) is the primary channel. Screen readers never see opacity.
- When a new event arrives, announce via an off-screen live region: `aria-live="polite"` attribute on the feed container, with the latest event as the first child. Don't use `aria-live` on each row.

## Max items

5 rows shown. The underlying events ring buffer holds 12 (for future use by Terminal view). Excess is not rendered.

## Data flow

The feed does **not** own event derivation. The OverviewView detects threshold crossings and p95 shifts per tick (see `02-view-specs/overview-enriched.md` → Event derivation), pushes to a local ring buffer, and passes the slice to this component as the `events` prop.

This keeps the component pure — render only. No store subscriptions, no effect hooks beyond the `arrived` animation ref.
