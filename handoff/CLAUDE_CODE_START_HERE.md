# START HERE — Claude Code Implementation Brief

You are implementing a redesign of the **Chronoscope** app (browser-based HTTP latency diagnostic). This file is your entry point. Read it in full before touching code.

---

## Target repository

`xaedyn/chronoscope` — Svelte 5 + TypeScript + Vite. The user will `cd` into their local clone and run you there. The existing app is **already working** in production; this is an additive redesign, not a rewrite.

## What you are building

Three new "views" that sit on top of the existing Glass Lanes engine, plus token/type scaffolding to support them. The existing Topbar, Controls, SettingsDrawer, SharePopover, persistence layer, worker, and engine **do not change**.

New views to build (in order):
1. **Overview** — ambient chronograph dial ("is everything OK at a glance?")
2. **Live** — oscilloscope-style real-time scope of the last ~60s
3. **Diagnose · Atlas** — per-request waterfall with phase breakdown

Two further views are **proposed but not prototyped** — see "Do not build blindly" below.

---

## About the files in this bundle

**`prototype/Chronoscope v2.html` (in this bundle) is a design reference, not production code.** It is a single-file HTML/React prototype built to communicate look, feel, density, motion, and interaction. You are **not** porting JSX to Svelte line-by-line.

Your job is to **recreate the prototype's designs inside the existing Svelte 5 codebase**, using its established patterns:
- Svelte 5 runes (`$state`, `$derived`, `$effect`) — not React hooks
- The existing `src/lib/stores/` pattern for shared state
- The existing `src/lib/tokens.ts` as the single source of visual values — no raw hex/px/ms literals in components
- The existing `src/lib/types.ts` for domain types
- Svelte 5 snippet syntax for slots/composition

Where the prototype and this handoff docs disagree, **the prototype wins** for the three prototyped views. Treat the docs as annotations on a running design.

## Fidelity

**High-fidelity.** The prototype has final colors, typography, spacing, timing, and interaction details. Match it pixel-level:
- Exact token values are in `04-tokens-additions.md`
- Exact layout measurements are in each view spec under `02-view-specs/`
- Motion timings, easing curves, and state transitions are specified

If a value isn't in the docs, read it off the prototype — do not invent.

---

## Reading order

Work through these in sequence. Don't skip ahead.

1. **`README.md`** — project-level framing, what's in/out of scope, design decisions already locked.
2. **`01-architecture-mapping.md`** — where each prototype piece lands in the Svelte tree. Maps prototype components → `src/lib/components/*.svelte` files.
3. **`04-tokens-additions.md`** — **apply this first**. New entries merge into `src/lib/tokens.ts`. Everything else depends on these tokens existing.
4. **`05-type-additions.md`** — **apply this second**. New entries merge into `src/lib/types.ts` plus two new stores.
5. **`03-components/shared.md`** — shared building blocks (format helpers, endpoint rail, view switcher). Build these before the views.
6. **`02-view-specs/overview.md`** — build the Overview view.
7. **`02-view-specs/live.md`** — build the Live view.
8. **`02-view-specs/atlas.md`** — build the Diagnose · Atlas view.
9. **`06-implementation-plan.md`** — phased rollout with effort estimates and risk calls. Use this to check your progress and decide when to open PRs.

Open `prototype/Chronoscope v2.html` in a browser alongside your editor the entire time. You will reference it constantly. (It's a single HTML file with sibling `.jsx` files in `prototype/` — open it with a local static server, e.g. `python3 -m http.server` from the `prototype/` folder, then visit `http://localhost:8000/Chronoscope%20v2.html`.)

---

## Do not build blindly

Two views — **Strata** (percentile bands) and **Terminal** (forensic journal) — are described in `02-view-specs/strata.md` and `02-view-specs/terminal.md` as design direction only. **There is no prototype for them.** Do not implement them from those specs alone.

When you reach that point in the plan, stop and tell the user: *"Strata and Terminal need to be prototyped before I build them. Want me to mock them in HTML first, or skip for now?"*

---

## Rules of engagement

- **Tokens are the only source of visual truth.** No raw hex, no raw px for spacing, no raw ms for motion in components. Everything goes through `tokens.*`. If you need a value that doesn't exist, add it to the tokens file and reference it.
- **Formatting goes through one helper.** All latency/ms/count/percentile formatting uses the `fmt()` helper defined in `03-components/shared.md`. Do not write ad-hoc `toFixed(1)` calls in component templates.
- **Tabular numerals everywhere numeric.** Every latency readout uses `font-variant-numeric: tabular-nums`. This is non-negotiable for the aesthetic.
- **Endpoint selection is global.** The left rail drives focus across every view. Do not add per-view endpoint pickers.
- **Tier 2 palette is locked.** `tokens.color.tier2` (dns/tcp/tls/ttfb/transfer) is the only phase palette, used in waterfall, sample strip, and hypothesis evidence. Do not reintroduce phase colors anywhere else.
- **Phase 0 (tokens + types + fmt + persistence migration) must land and be merged before any view work.** It's zero-visual-risk and unblocks everything else.
- **Open a PR per phase.** Don't bundle phases. The user wants to review each step.

---

## Checklist before you start coding

- [ ] You have read this file, `README.md`, `01-architecture-mapping.md`, and `06-implementation-plan.md` in full.
- [ ] You have opened `prototype/Chronoscope v2.html` in a browser and clicked through all three views.
- [ ] You have read the existing `src/lib/tokens.ts` and `src/lib/types.ts` in the repo so you understand the patterns you're extending.
- [ ] You have confirmed with the user which phase to start on (default: Phase 0).

When ready, propose Phase 0 as a PR plan, get sign-off, and proceed.
