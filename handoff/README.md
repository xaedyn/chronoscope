# Chronoscope v2 — Implementation Handoff

This package hands off the prototype at `../v2/Chronoscope v2.html` (canonical source of truth) to the real Svelte 5 + TypeScript + Vite codebase at `xaedyn/chronoscope`.

**New here? Read `CLAUDE_CODE_START_HERE.md` first.**

The canonical prototype lives at `../v2/Chronoscope v2.html` (relative to this handoff package). It proposes **three new views** that sit on top of the existing Glass Lanes infrastructure, plus **two further view ideas** described on paper but not yet prototyped:

| View | Status | Purpose | Existing analog |
|---|---|---|---|
| **Overview** (chronograph dial) | ✅ prototyped | Ambient glanceable health | `SummaryCards.svelte` |
| **Overview · Enriched** | ✅ prototyped | Dial + baseline + racing strip + events + causal verdict | layers on top of Overview |
| **Live** (oscilloscope) | ✅ prototyped | Real-time scope of last ~60s | `TimelineCanvas.svelte` (split mode) |
| **Diagnose · Atlas** (waterfall) | ✅ prototyped | Per-request phase breakdown | `LaneHeaderWaterfall.svelte` (extended) |
| **Strata** (percentile bands) | 📝 proposed only | Long-range distribution shape | `HeatmapCanvas.svelte` |
| **Terminal** (forensic journal) | 📝 proposed only | Keyboard-driven event log | new |

The three prototyped views (+ Enriched upgrade) are ready to implement against the specs. Strata and Terminal should be **prototyped before building** — their specs in this package are design direction, not visual sign-off.

**Overview ships in two phases.** Phase 2 delivers Classic Overview (the dial + diagnosis strip + metrics triptych). Phase 2.5 layers on the Enriched upgrade: baseline arc, 60s quality trace, racing strip, event feed, causal verdict, and breathing chrome. Enriched becomes the default Overview mode once it ships. See `02-view-specs/overview.md` and `02-view-specs/overview-enriched.md`.

The rest of the app — Topbar, Controls, SettingsDrawer, SharePopover, EndpointDrawer, persistence, share URLs, worker/engine — is unchanged.

## Reading order

1. **`01-architecture-mapping.md`** — where each prototype piece lands in the Svelte tree.
2. **`02-view-specs/`** — one spec per new view.
3. **`03-components/`** — shared building blocks the views depend on.
4. **`04-tokens-additions.md`** — new entries for `src/lib/tokens.ts` (the only file allowed to contain raw visual values).
5. **`05-type-additions.md`** — new entries for `src/lib/types.ts` and new stores.
6. **`06-implementation-plan.md`** — phased rollout, ordering, risk calls.

## Design decisions locked before handoff

- **Chronograph dial style:** Minimal only. Mechanical (brushed bezel / jewel screws / sub-dial) is explicitly out.
- **Oscilloscope style:** Clean only. CRT (scanlines / vignette / phosphor) is explicitly out.
- **Endpoint selection:** global concept. The persistent left rail drives focus across every view. No per-view endpoint pickers.
- **Tier 2 palette:** already in `tokens.color.tier2` (dns/tcp/tls/ttfb/transfer). Reuse everywhere — waterfall, sample strip, hypothesis evidence. Do not reintroduce phase colors anywhere else.
- **Typography scale:** 10px floor for UI labels, 11px for mono metadata, 13px body. All latency displays use `font-variant-numeric: tabular-nums`. All percentile/ms/count formatting goes through a single `fmt()` helper (see `03-components/shared.md`).

## Out of scope for this handoff

- Settings drawer redesign (explicitly deferred in existing tokens — `tokens.color.chrome` comment).
- Share popover redesign.
- Mobile/tablet layouts — desktop-first prototype, responsive rules TBD.
- Theming / light mode — single dark theme only.

## File authority

For the three prototyped views, `../v2/Chronoscope v2.html` is the **visual source of truth**. Where this handoff and the prototype disagree, the prototype wins &mdash; treat these docs as annotations on a running design, not a replacement for it.

For Strata and Terminal, there is no prototype to defer to. The specs in `02-view-specs/strata.md` and `02-view-specs/terminal.md` describe intent and constraints; the design work itself still needs to be done (prototype first, then spec sign-off, then build).
