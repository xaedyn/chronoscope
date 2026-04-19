# EndpointRail component — spec

**Target file:** `src/lib/components/EndpointRail.svelte`
**Prototype reference:** `v2/shell.jsx` → `EndpointRail`

## Purpose

The persistent left sidebar. Drives **endpoint focus globally** — no view owns its own endpoint picker. 264px fixed width, full viewport height.

## Structure

```
EndpointRail
├─ RailHeader
│    ├─ title "Endpoints"
│    └─ count badge
├─ RailList   (scrollable)
│    └─ RailRow (one per endpoint)
│         ├─ status pip (health color)
│         ├─ label + url
│         └─ p50 metric
└─ RailFooter
     └─ "+ Add endpoint" (opens EndpointDrawer — existing)
```

## RailRow layout

```
┌──────────────────────────────────────────┐
│ ●   api-us                      127 ms   │
│     api.us.example.com                    │
└──────────────────────────────────────────┘
```

- **Pip:** 7px circle, filled with `HEALTH_STYLE[classify(stats)].color`, with `8px {color}88` box-shadow.
- **Label:** 11.5px (`--ts-md`), t1, weight 500.
- **URL:** 10px (`--ts-sm`), mono, t3, truncated with ellipsis.
- **Metric:** 14px (`--ts-lg`), mono, tabular-nums, weight 500, colored in endpoint color. Unit (`ms`) 9px (`--ts-xs`) t4.

Use `fmtParts()` from `utils/format.ts` to split num/unit so the unit can be styled separately.

## States

| State | Visual |
|---|---|
| Default | Transparent bg, transparent border. |
| Hover | `tokens.color.glass.bg` bg. |
| Focused (active) | `tokens.color.glass.bgStrong` bg, `tokens.color.surface.border.bright` border. |
| No data yet | Metric shows `—`. Pip uses t4. |
| Disabled endpoint | Row dimmed to 50%. Pip neutral. |

## Interactions

| Interaction | Effect |
|---|---|
| Click row | `uiStore.setFocusedEndpoint(id)`. If already focused, unfocus (`null`). |
| Double-click row | `uiStore.setFocusedEndpoint(id)` + `uiStore.setActiveView('live')`. |
| Hover row | Local hover state only — does not affect other views. |
| Click "+ Add endpoint" | `uiStore.toggleEndpoints()` — opens existing EndpointDrawer. |

## Keyboard

- Rail rows are focusable in tab order.
- When a row has focus, `Enter` toggles focus state; `Space` drills to Live.
- Arrow keys move between rows (roving tabindex).

## Why no sparklines

The prototype originally had per-row sparklines. They were removed because:
1. Rail is a chrome surface; chrome shouldn't carry primary data.
2. Every view already has its own trace/band visualization.
3. Density made the rail feel noisy.

**Do not add sparklines back.** If you want live motion in the rail, use the pip's glow intensity as a quiet signal.

## Accessibility

- Rail is `<nav aria-label="Endpoints">`.
- Each row is `<button role="tab" aria-selected="{focused}">`.
- The count badge has `aria-label="{count} endpoints monitored"`.
- Pip color is **never the only signal** — the row is labeled with health status as well (add `aria-label` suffix: "...status: healthy/degraded/unhealthy").
