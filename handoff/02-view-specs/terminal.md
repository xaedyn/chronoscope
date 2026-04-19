# Terminal view — spec (proposed, not yet prototyped)

> ⚠️ **Status: design direction only.** Unlike Overview, Live, and Atlas, Terminal is **not** in `v2/Chronoscope v2.html`. This spec captures intent and constraints; a visual prototype must be built and reviewed before implementation begins.

**Target file:** `src/lib/components/views/TerminalView.svelte`

## Purpose

The forensic / power-user view. A timestamped event log, keyboard-driven, that surfaces every anomaly: timeouts, errors, threshold crossings, freeze events, connection reuse changes. Answers "what *happened*, in order, with timestamps I can cite?"

This view is included in the handoff because it's valuable for a specific user (engineers debugging), but it should be **the last view to ship** and should be gated behind a "advanced / experimental" flag until prototyped and validated.

## Structure

```
TerminalView
├─ TerminalHeader
│    ├─ kicker: "TERMINAL · EVENT LOG"
│    ├─ filter pills: ALL | TIMEOUT | ERROR | THRESHOLD | FREEZE | RESUME
│    └─ actions: clear, export (copy to clipboard as JSONL)
└─ TerminalScroll
     └─ TerminalRow (one per event)
          ├─ timestamp (mono, t3)
          ├─ severity chip
          ├─ endpoint pip + label
          ├─ message
          └─ expandable payload (on click — show full sample JSON)
```

## Event types

Derived client-side from existing stores. No new event store needed; `deriveEvents()` runs as a Svelte derived store from `measurementStore`.

| Event | Source | Severity |
|---|---|---|
| `timeout` | `MeasurementSample.status === 'timeout'` | error |
| `error` | `MeasurementSample.status === 'error'` | error |
| `threshold_cross_up` | `MeasurementSample.latency > threshold` after previous sample was ≤ threshold | warn |
| `threshold_cross_down` | inverse | info |
| `freeze` | `MeasurementState.freezeEvents` | warn |
| `endpoint_added` | `endpointStore` subscription diff | info |
| `endpoint_removed` | same | info |
| `connection_reuse_changed` | `TimingPayload.connectionReused` diff between consecutive samples | info |

## Rendering

Monospace font throughout (`tokens.typography.mono.fontFamily`, 11px).

```
04:21:17.882  [WARN]   ● api-us      THRESHOLD CROSS UP     168ms (thr=120ms)
04:21:17.201  [INFO]   ● api-eu      reuse=true → false      +18ms delta
04:21:16.900  [ERROR]  ● api-asia    TIMEOUT                 5000ms
04:21:15.124  [INFO]   ● api-us      THRESHOLD CROSS DOWN   112ms
```

Severity chip colors (pulled from tokens):

| Severity | Color token |
|---|---|
| error | `tokens.color.heatmap.slow` |
| warn | `tokens.color.heatmap.elevated` |
| info | `tokens.color.text.t3` |

Hover a row → background `tokens.color.glass.bgHover`.
Click a row → expand payload inline. Keyboard: `↑/↓` to move, `Enter` to expand, `j/k` vim-style (optional, nice touch).

## Filter pills

One pill per event type; `ALL` is default. Clicking a pill toggles it; multi-select. Persist to `uiStore.terminalFilters` (see `05-type-additions.md`).

## Performance

- Cap visible events at 500. Older events are discarded.
- Virtualize the scroll list if count > 100 (use `svelte-virtual-list` or hand-roll — the footprint is small).
- `deriveEvents()` should be incremental — subscribe to `measurementStore`, diff the tail, and push new events onto a local buffer. Do not recompute from scratch on every sample.

## States

| State | Behavior |
|---|---|
| No events yet | Empty state: "No events recorded. Events appear here when samples cross thresholds, time out, or error." |
| Running | New events animate in at the top with a 200ms fade. |
| Stopped | Log is frozen; "PAUSED" chip in header. |
| Filter excludes all events | "No events match current filters." |

## Accessibility

- `TerminalScroll` has `role="log"` and `aria-live="polite"`.
- Each row is a real `<button>` (since it's clickable to expand).
- Filter pills: `aria-pressed`.
- Severity is conveyed by both color and the text chip (`[WARN]`/`[ERROR]`) — never color only.

## Out of scope for v1

- Search / regex filter — add in v2 if users ask.
- Persistence across sessions — events are ephemeral.
- Export as CSV — JSONL clipboard export only for now.
