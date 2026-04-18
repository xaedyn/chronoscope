# Atlas · Diagnose view — spec

**Target file:** `src/lib/components/views/AtlasView.svelte`
**Prototype reference:** `v2/view-diagnose.jsx` → `DiagnoseView` + `Waterfall`

## Purpose

The per-request forensic view. For a selected endpoint, show **where time is spent** inside a single request — DNS, TCP connect, TLS handshake, server processing (TTFB), content transfer — and surface a hypothesis about the bottleneck.

## Structure

```
AtlasView
├─ AtlasHeader
│    ├─ kicker: "DIAGNOSE · ATLAS · REQUEST WATERFALL"
│    ├─ title: endpoint label + url
│    ├─ hint (shown only when no endpoint is focused)
│    └─ actions: P50 / P95 toggle, "Back to Live"
└─ Waterfall
     ├─ phase waterfall chart (hero)
     ├─ hypothesis strip (verdict + evidence)
     └─ sample strip (last 8 samples as horizontal bars)
```

**No in-view endpoint picker** — selection comes from the persistent left rail (see `03-components/endpoint-rail.md`).

## Phase waterfall (hero)

Horizontal stacked bar, full width, ~80px tall. Segments in order:

| # | Phase | Token color | Source |
|---|---|---|---|
| 1 | DNS lookup | `tokens.color.tier2.dns` | `stats.tier2Averages.dnsLookup` |
| 2 | TCP connect | `tokens.color.tier2.tcp` | `stats.tier2Averages.tcpConnect` |
| 3 | TLS handshake | `tokens.color.tier2.tls` | `stats.tier2Averages.tlsHandshake` |
| 4 | Server (TTFB) | `tokens.color.tier2.ttfb` | `stats.tier2Averages.ttfb` |
| 5 | Transfer | `tokens.color.tier2.transfer` | `stats.tier2Averages.contentTransfer` |

Each segment shows its ms value inside if ≥ 40px wide, otherwise on hover. Segment labels (`DNS` / `TCP` / `TLS` / `SERVER` / `TRANSFER`) sit below the bar, aligned with segment centers, in `tokens.color.tier2.labelText`.

Mode toggle (P50/P95) affects which averages are summed — P50 uses `tier2Averages` (these are means); for P95 a new field is needed (see `05-type-additions.md`).

## Hypothesis strip

Below the waterfall, a single card with:

```
┌──────────────────────────────────────────────────────────────────┐
│  VERDICT                                                         │
│  ┌─────────┐                                                     │
│  │ SERVER  │  Slow upstream server — 68% of P95 time is TTFB.    │
│  └─────────┘                                                     │
│                                                                  │
│  EVIDENCE                                                        │
│  • DNS      8ms      ●                                           │
│  • TCP     22ms      ●●                                          │
│  • TLS     34ms      ●●●                                         │
│  • SERVER 180ms      ●●●●●●●●●●●●●●●●●                           │  ← highlighted
│  • TRANSFER 12ms     ●                                           │
└──────────────────────────────────────────────────────────────────┘
```

**Hypothesis rules** (simple heuristic):

- If any phase > 60% of total → "The {phase} phase is the bottleneck."
- Else if top-2 phases > 80% of total → "{Phase A} and {Phase B} dominate."
- Else → "No single phase dominates — investigate overall network conditions."

Evidence bullets use tier2 phase colors as pips. The dominating phase is emphasized with t1 text; others use t3.

## Sample strip

Bottom of the view. Shows the last 8 samples as stacked horizontal bars, each colored by phase, with total ms on the right.

```
round 1283    ████ ██ ███ ████████████ ██          247ms
round 1282    ██   ██ ██  █████        █           119ms
...
```

Source: `measurementStore.endpoints[id].samples.slice(-8)`, where each `MeasurementSample.tier2` gives the phase breakdown. If `tier2` is undefined for a sample (tier-1 only), render a flat neutral bar in `tokens.color.text.t4` — do not fabricate phases.

## States

| State | Behavior |
|---|---|
| No endpoint focused | Header kicker shows, title is `—`, hint reads: "Select an endpoint from the left rail to diagnose a specific link." Waterfall area shows empty-state message. |
| Endpoint focused, no tier-2 data yet | Show skeleton waterfall (neutral segments); hypothesis shows "Awaiting tier-2 samples". |
| Endpoint focused, tier-2 ready | Full render. |
| Endpoint disabled | Still renders last-known state; add disabled overlay. |

## Accessibility

- Waterfall SVG `role="img"` with `aria-label` listing all phases and their ms values.
- Hypothesis verdict is the primary text channel — must not be skippable by screen readers.
- P50/P95 toggle is a `<button>` group with `aria-pressed`.
- Sample strip is a `<table>` semantically (one row per sample, columns: round, phases, total). Visually styled as bars.
