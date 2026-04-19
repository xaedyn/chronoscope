# Architecture mapping — prototype → Svelte tree

The prototype is a single React HTML file with ad-hoc state. This doc maps each prototype piece to where it lands in the existing Svelte codebase.

## High-level layout

Prototype shell:
```
App
├─ Topbar (status, view switcher, controls)
├─ EndpointRail (persistent left — 264px)
└─ <view>        ← one of: Overview | Live | Atlas | Strata | Terminal
```

Svelte target — extend `Layout.svelte`:
```
Layout.svelte
├─ Topbar.svelte                         (existing — add view switcher segment)
├─ EndpointRail.svelte                   (NEW — replaces/augments EndpointPanel.svelte for new views)
├─ ViewSwitcher.svelte                   (NEW — tiny wrapper; routes on $uiStore.activeView)
│   ├─ OverviewView.svelte               (NEW)
│   ├─ LiveView.svelte                   (NEW — reuses TimelineCanvas in "scope" mode)
│   ├─ AtlasView.svelte                  (NEW)
│   ├─ StrataView.svelte                 (NEW)
│   ├─ TerminalView.svelte               (NEW)
│   └─ LanesView.svelte                  (existing — kept as 6th view "Lanes · legacy")
└─ FooterBar.svelte                      (existing)
```

## Per-piece mapping

| Prototype file / component | Svelte target |
|---|---|
| `v2/shell.jsx` → `Shell` | `Layout.svelte` (minor edits) |
| `v2/shell.jsx` → `EndpointRail` | `src/lib/components/EndpointRail.svelte` (NEW) |
| `v2/shell.jsx` → `Topbar` | merge into existing `Topbar.svelte` — add the view-switcher segment |
| `v2/view-overview.jsx` → `OverviewView` | `src/lib/components/views/OverviewView.svelte` (NEW) |
| `v2/view-overview.jsx` → `MainDial` | `src/lib/components/ChronographDial.svelte` (NEW) |
| `v2/view-overview.jsx` → `SubDial` | inlined in `OverviewView` (small enough) |
| `v2/view-overview.jsx` → `DiagnosisStrip` | inlined in `OverviewView` |
| `v2/view-live.jsx` → `LiveView` | `src/lib/components/views/LiveView.svelte` (NEW) |
| `v2/view-live.jsx` → `ScopeCanvas` | `src/lib/components/ScopeCanvas.svelte` (NEW) — or extend `TimelineCanvas.svelte` with a `mode="scope"` flag |
| `v2/view-live.jsx` → `LiveFooter` | inlined in `LiveView` |
| `v2/view-diagnose.jsx` → `DiagnoseView` | `src/lib/components/views/AtlasView.svelte` (NEW) |
| `v2/view-diagnose.jsx` → `Waterfall` | `src/lib/components/Waterfall.svelte` (NEW — extends existing `LaneHeaderWaterfall.svelte`) |
| *(not prototyped)* → `StrataView` | `src/lib/components/views/StrataView.svelte` (NEW) — **prototype first** |
| *(not prototyped)* → `TerminalView` | `src/lib/components/views/TerminalView.svelte` (NEW) — **prototype first** |
| `v2/shared.jsx` → `classify`, `fmt`, `fmtPct`, `fmtCount`, `fmtParts`, `networkQuality` | `src/lib/utils/format.ts` + `src/lib/utils/classify.ts` (NEW) |
| `v2/engine.jsx` → synthetic data generator | **delete** — the real app has `measurement-engine.ts` |

## State mapping

The prototype uses a single `useReducer` for everything. In Svelte we split across existing + new stores:

| Prototype state key | Svelte store |
|---|---|
| `endpoints[]` | `endpointStore` (existing) |
| `statsMap` | `statisticsStore` (existing) + `measurementStore` (existing) |
| `tick`, `running` | derived from `measurementStore.lifecycle` |
| `threshold` | NEW field on `settingsStore` (was `timeout`; threshold is separate — see `05-type-additions.md`) |
| `view` | `uiStore.activeView` — **extend the union** to include new views |
| `focusedEpId` | NEW: `uiStore.focusedEndpointId` (see `05-type-additions.md`) |
| `split`, `timeRange` | NEW: `uiStore.liveOptions` (see `05-type-additions.md`) |
| `tweaksOpen` | N/A — Tweaks panel is prototype-only, not shipping |

## Data contract

The prototype's synthetic `statsMap[epId] = { stats, samples, last }` already matches the real contracts closely:

| Prototype shape | Real type (already in `types.ts`) |
|---|---|
| `stats.p50`, `p95`, `p99`, `p25`, `p75`, `p90`, `min`, `max`, `stddev` | `EndpointStatistics` — exact match |
| `stats.ready` | `EndpointStatistics.ready` — exact match |
| `stats.tier2Averages.{dnsLookup, tcpConnect, tlsHandshake, ttfb, contentTransfer}` | `EndpointStatistics.tier2Averages` — exact match |
| `samples[i] = { round, latency, status, timestamp, tier2 }` | `MeasurementSample` — exact match |
| `last` | `measurementStore.endpoints[id].lastLatency/lastStatus` + helper to get latest sample |

**No data-layer changes needed.** Every piece of information the new views display already exists in the real stores. The prototype's generator can be removed entirely; replace its imports with store subscriptions.

## Routing

`uiStore.activeView` currently unions `'timeline' | 'heatmap' | 'split'`. Extend to:

```ts
export type ActiveView =
  | 'overview'   // NEW — default post-migration
  | 'live'       // NEW
  | 'atlas'      // NEW
  | 'strata'     // NEW
  | 'terminal'   // NEW
  | 'lanes'      // alias for old 'split' — keeps legacy view available
  | 'timeline'   // deprecate after 1 release
  | 'heatmap'    // deprecate after 1 release
  | 'split';     // deprecate after 1 release
```

`applyPersistedSettings` must migrate any persisted `timeline`/`heatmap`/`split` → `lanes` on load. See persistence migration notes in `06-implementation-plan.md`.
