# Overview view — Enriched upgrade

**Target file:** `src/lib/components/views/OverviewView.svelte` (upgraded in place)
**Prototype reference:** `v2/view-overview-v2.jsx` → `OverviewViewV2`

This spec layers on top of [`overview.md`](./overview.md). Build the Classic Overview first (Phase 2). The Enriched upgrade is Phase 2.5 — it ships as the default after the Classic version is proven.

## Why Enriched

The Classic Overview tells you "how healthy." Enriched tells you **where to look** and **why**: it distinguishes shared-phase upstream problems from endpoint-specific ones, shows trend instead of snapshot, and surfaces live events as they happen.

Five upgrades, each load-bearing:

| Upgrade | Answers |
|---|---|
| Baseline arc | "Is this normal or unusual?" |
| 60s quality trace | "Trending up, down, or stable?" |
| Racing strip | "Which endpoint is the worst? Are they correlated?" |
| Event feed | "What just happened?" |
| Causal verdict | "Is it upstream or endpoint-specific?" |

Plus two polish-layer upgrades from the signature design pass:
- **Breathing chrome** — dial stroke/tick/score weight respond to the score
- **Newest-loud event feed** — the most recent event is visually louder than older ones

## Layout

Two-column grid. `grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr)`, gap 24px.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   ┌─────────────────────────┐    ┌─────────────────────────────────┐    │
│   │                         │    │  RACING STRIP                   │    │
│   │    MAIN DIAL V2         │    │  ┌───────────────────────────┐  │    │
│   │                         │    │  │ ep · ━━━━━━━ dot  127ms   │  │    │
│   │   [baseline arc]        │    │  │ ep · ━━━━  dot      42ms  │  │    │
│   │   [60s trace]           │    │  │ ep · ━━━━━━━━ dot  198ms  │  │    │
│   │   [endpoint orbit]      │    │  └───────────────────────────┘  │    │
│   │                         │    └─────────────────────────────────┘    │
│   └─────────────────────────┘    ┌─────────────────────────────────┐    │
│   ┌─────────────────────────┐    │  EVENT FEED                     │    │
│   │  CAUSAL VERDICT         │    │  ┌───────────────────────────┐  │    │
│   │  DNS slow on 2 eps...   │    │  │ 2s ago · ep · crossed up  │  │    │
│   │  [ diagnose ep → ]      │    │  │ 47s     · ep · recovered  │  │    │
│   └─────────────────────────┘    │  │ 1m      · ep · p95 shift  │  │    │
│                                  │  └───────────────────────────┘  │    │
│                                  └─────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

Verdict sits directly below the dial, spanning the left column. Racing strip and event feed stack in the right column.

**Note:** Classic's SubDialsGrid is **removed**. The racing strip supersedes it — same information (per-endpoint state) with better comparability.

## Component tree

```
OverviewView (enriched)
├─ MainDialV2                  (03-components/chronograph-dial.md — v2 enhancements section)
├─ CausalVerdictStrip          (03-components/causal-verdict.md)
├─ RacingStrip                 (03-components/racing-strip.md)
└─ EventFeed                   (03-components/event-feed.md)
```

## Data dependencies

Beyond what Classic uses:

| Need | Source |
|---|---|
| `scoreHistory` — 60 samples of `networkQuality()` | Component-local ring buffer, one entry per tick |
| `events` — threshold-cross + p95-shift events | Component-local ring buffer, max 12 entries |
| `tier2` per endpoint (phase breakdown) | Already computed in statistics — see `04-tokens-additions.md` |
| `stats.stddev` per endpoint | Already computed |
| `stats.p50`, `stats.p95` per endpoint | Already computed |

## Quality history buffer

Keep a component-local ref array of `{ tick: number, score: number }`, max 60 entries. Append one entry per `tick` change. Do **not** store this in the Redux/store layer — it's view-local and only matters while Overview is mounted.

## Event derivation

Per tick, compare each endpoint's current state to the previous tick's state:

| Condition | Event kind |
|---|---|
| `latency > threshold` this tick, `<=` last tick | `cross-up` |
| `latency <= threshold` this tick, `>` last tick | `cross-down` |
| `abs(p95 - prevP95) / prevP95 > 0.35` AND `tick % 8 === 0` | `shift` |

Keep last 12 events. Show last 5 in the feed. See `03-components/event-feed.md` for rendering.

## Causal verdict

Computed from aggregate stats + tier2 phase dominance. See `03-components/causal-verdict.md` for the full decision tree. The verdict is **a single sentence** — no detail line, no multi-part block.

## States

Same as Classic, plus:

| State | Enriched behavior |
|---|---|
| Idle (<2 samples) | Quality trace hidden; events list shows "Calibrating…"; verdict shows "Calibrating…" |
| All healthy | Verdict: "All links within tolerance." Baseline arc shows the cluster. Feed: "No crossings in window. Network steady." |
| One endpoint over threshold | Verdict: "{label} degraded alone — endpoint-specific." Drill CTA targets that endpoint. |
| Multiple endpoints, shared dominant phase | Verdict: "{phase} slow on N endpoints — likely upstream." Drill CTA targets the worst endpoint. |
| Loss elevated | Verdict: "Packet loss elevated to N.N%." |
| Jitter elevated | Verdict: "Jitter elevated — σ N.Nms." |

## Keyboard

Same as Classic. No new shortcuts. The racing strip rows and event feed rows are button elements and participate in normal tab order.

## Accessibility

In addition to Classic's requirements:

- Racing strip rows: `<button>` with `aria-label="{ep.label} live {lat}ms, p95 {p95}ms, {over/within} threshold"`.
- Event feed rows: `<button>` with `aria-label="{timeLabel} {ep.label} {action}"`.
- Causal verdict: the headline text IS the accessible label; the `tone` class (`good`/`warn`) must not be the only signal — include a text cue in the headline (we already do: "within tolerance" vs "slow on" vs "degraded alone").
- Quality trace: decorative; wrap in `<g aria-hidden="true">`.

## Feature flag

Land Enriched behind `settings.overviewMode: 'classic' | 'enriched'`. Default to `'enriched'` once shipped. Keep `'classic'` available for a release as a fallback. See `05-type-additions.md` for the settings addition.

## Open questions

- **Event feed persistence across view switches:** should the event buffer live in `measurementStore` (visible to all views) or stay component-local? Recommend: component-local for v1. Promote to a shared store only if Terminal view (when built) needs to read the same buffer.
- **Racing strip on very wide viewports:** currently fills its column. On >1600px, should we add a second row of endpoint rows instead of letting each row grow unbounded? Defer — observe real usage.
