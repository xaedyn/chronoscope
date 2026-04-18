# Overview view — spec

**Target file:** `src/lib/components/views/OverviewView.svelte`
**Prototype reference:** `v2/view-overview.jsx` → `OverviewView`

## Purpose

The ambient, glanceable state of the system. One dial says "everything is fine" or "something is wrong"; one strip below suggests where to look.

## Structure

```
OverviewView
├─ MainDial                       (ChronographDial.svelte)
├─ SubDialsGrid   (optional)      — one small dial per endpoint, <= 6 endpoints
├─ DiagnosisStrip                 — verdict + worst endpoint + drill CTA
└─ Metrics        (bottom triptych) — "live median", "over threshold", "total samples"
```

## Layout (1440 reference width, centered)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                      ┌──────────────┐                           │
│                      │              │                           │
│                      │  MainDial    │   520px diameter          │
│                      │  (520×520)   │                           │
│                      │              │                           │
│                      └──────────────┘                           │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐      │
│   │  VERDICT     WORST ENDPOINT        [ DIAGNOSE → ]    │      │
│   └──────────────────────────────────────────────────────┘      │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│   │ live median  │  │ over thresh  │  │ samples      │          │
│   │   127 ms     │  │    2/5       │  │   12,483     │          │
│   └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Vertical rhythm: 48px dial → 24px → strip → 18px → metrics.
Horizontal: centered in viewport; max-width 920px.

## Behavior

- **Live hand** on the main dial tracks `networkQuality()` of all current stats — updates every 250ms max (smooth via requestAnimationFrame interpolation; see `03-components/chronograph-dial.md`).
- **Endpoint orbit ring** (outside the scale) shows each endpoint as a small colored bar at its live p50 angle. Pips pulse when an endpoint's last latency exceeds `threshold`.
- **Verdict** is derived from `networkQuality()`:
  - score >= 80 → `"Healthy"` (cyan)
  - score >= 50 → `"Degraded"` (amber)
  - score <  50 → `"Unhealthy"` (pink)
  - no data → `"Awaiting samples"` (t4)
- **Worst endpoint** is the endpoint with the highest p95 among stats with `ready: true`. Shows endpoint pip + label + p95.
- **"Diagnose →"** button routes to `AtlasView` with `focusedEndpointId` set to the worst endpoint.
- **Metrics triptych** values:
  - `live median`: median of all endpoints' `lastLatency` (skip nulls)
  - `over threshold`: count of endpoints where `lastLatency > threshold`, rendered as `N/M`
  - `samples`: sum of all `measurementStore.endpoints[id].samples.length`

## States

| State | Behavior |
|---|---|
| Idle (no samples) | Dial hand at 0°, verdict "Awaiting samples", orbit ring empty |
| Partial (some endpoints ready) | Dial hand interpolates from aggregate of ready stats; orbit shows only ready endpoints |
| Running (normal) | Full visualization, pulse effect on dial when hand crosses threshold |
| Stopped | Last values frozen; "PAUSED" badge on dial (use `tokens.color.text.t3` for text, no animation) |
| All endpoints down | Verdict "Unhealthy", dial hand at 300ms (pegged), all orbit pips pulsing |

## Keyboard

Overview doesn't own hotkeys. Global `1` switches to Overview (see `shortcuts.ts` addition in `05-type-additions.md`).

## Accessibility

- `role="img"` on dial SVG with `aria-label="{score} percent healthy, median latency {ms} milliseconds"`.
- Verdict text is the primary non-visual channel — must read before or in place of the dial.
- Metrics triptych uses real `<dl>/<dt>/<dd>` elements, not divs.
- Color is never the only channel: verdict always pairs color with text; orbit pips use both color and pulse animation.
- Focus order: Diagnose CTA is the only focusable element on the page. Tab goes rail → diagnose → topbar.

## Open questions

- Should the SubDialsGrid render when endpoint count is 2–4? Prototype hides it by default. Recommend: keep hidden in v1; prove value before adding.
- Threshold visualization on the dial arc — currently a pink arc from threshold→300. Should dragging the arc change the threshold? Prototype doesn't; recommend: don't. Threshold changes go through Tweaks/Settings only.
