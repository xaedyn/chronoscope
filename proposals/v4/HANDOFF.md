# HANDOFF — Vessel v4 → Claude Code

This document is the bridge between the design package in `proposals/v4/` and the existing Chronoscope source tree (Svelte 5 at chronoscope.dev). It tells Claude Code exactly what to translate, in what order, and what to throw away from the current shipped design.

## 1. The package you're translating from

```
proposals/v4/
├── DIRECTION-v4.md            — the cross-cutting design memo (READ FIRST)
├── style-guide-v4.html        — the design system documentation (live tokens demo)
├── index.html                 — landing/marketing surface
├── proposal-cold-v4.html      — first-visit empty state + acquisition sequence
├── proposal-overview-v4.html  — mission status (current /overview)
├── proposal-live-v4.html      — 3D orbital tracker (current /live)
├── proposal-investigate-v4.html — per-station analysis (current /investigate)
├── proposal-endpoint-v4.html  — single-station drill (current /endpoint/:id)
├── proposal-transit-v4.html   — outside-vantage probe (NEW route)
├── proposal-report-v4.html    — session signature (current /report)
├── proposal-error-v4.html     — carrier-lost detail (NEW state)
└── proposal-settings-v4.html  — settings drawer (overlay component)
```

Each HTML file is self-contained, vanilla CSS in a `<style>` block, vanilla JS at the bottom. Three.js is loaded via importmap. Open any file by double-click; no build step.

## 2. Surface → route mapping

| v4 file | Svelte 5 route | New or existing |
| --- | --- | --- |
| `index.html` | `/` | replaces current landing |
| `proposal-cold-v4.html` | `/` (initial empty state branch) | NEW — replaces auto-start |
| `proposal-overview-v4.html` | `/overview` | redesigns existing |
| `proposal-live-v4.html` | `/live` | redesigns existing |
| `proposal-investigate-v4.html` | `/investigate` | redesigns existing |
| `proposal-endpoint-v4.html` | `/endpoint/:id` | redesigns existing |
| `proposal-transit-v4.html` | `/transit` (or `/investigate/transit`) | **NEW route** |
| `proposal-report-v4.html` | `/report` | redesigns existing |
| `proposal-error-v4.html` | `/endpoint/:id?state=lost` (or modal) | **NEW state** |
| `proposal-settings-v4.html` | `<Settings />` overlay component | redesigns existing drawer |

## 3. Translation order — do these phases in sequence

### Phase A — Tokens & chrome (no functional change)

1. **Replace `tokens.ts`** with the v4 palette. Style-guide-v4.html `§01 Color` section is the source of truth. Key tokens:
   - `bg: #03050A`, `bg-2: #080C14`, `bg-3: #11171F`, `bg-4: #1A2230`
   - `fg: #F2EBDB`, `fg-2: #A39A87`, `fg-3: #5F594D`, `fg-4: #36322B`
   - `rule: rgba(242, 235, 219, 0.06)`, `rule-strong: rgba(242, 235, 219, 0.14)`
   - Station hues: `station-A: #B7D3EC` (Sirius), `station-B: #8CD4C9` (Vega), `station-C: #E8D597` (Sun), `station-D: #D78E68` (Betelgeuse)
   - Severity: `sev-warn: #E8C36F`, `sev-bad: #D27258`, `sev-crit: #B14238`
   - Phase: `phase-dns/tcp/tls/ttfb/xfer` (see Investigate)

2. **Swap fonts.** Load Hanken Grotesk (weights 200, 300, 400, 500, 600, 700) and Space Mono (400, 700) via Google Fonts. Remove Sora + Martian Mono.

3. **Build shared `<Masthead>` component.** Brand crest + nav + carrier-tag + gear icon + Stop/Share. See any v4 file's `.masthead` for reference markup.

4. **Build shared `<Breadcrumb>` component.** Used on detail pages (endpoint, transit, error).

5. **Build the universal `<KeyboardHelp>` overlay.** Listens for `?` keypress, shows the shortcut grid. Same component embedded in every page.

### Phase B — The orbital scene component (the hardest piece)

6. **Build `<OrbitalScene>` as a single shared Svelte component.** Accepts props:
   - `mode`: `'live' | 'focus' | 'transit' | 'error' | 'cold' | 'static'`
   - `focusedStation`: `'A' | 'B' | 'C' | 'D' | null`
   - `stationData`: `Record<station, number[]>` (the latency buffer)
   - `gapRegions`: optional `Array<{ stationId, startAngle, endAngle }>` for error state
   - `revealProgress`: `0–1` for assembly sequences
   - `sweepAngle`: derived from elapsed time

   The component handles: WebGL setup, camera drift + mouse parallax, star field, orbital rings with shader sweep, pulse points with diffraction shader, sweep beam, home station + halo, raycaster for tooltips.

   Reference: `proposal-live-v4.html` lines ~590–~1300. The shader strings (vertex + fragment) should live in `.glsl` files imported via Vite's `?raw` suffix.

7. **Build `<TuningIndicator>` as a separate component.** SVG-based deviation needle. See `proposal-live-v4.html` for the implementation.

### Phase C — Per-surface composition

8. Build each route by composing the shared components above + surface-specific chrome. The HTML files in `proposals/v4/` are nearly 1:1 templates — copy markup, replace template-string interpolation with Svelte runes.

### Phase D — Polish

9. **Audio engine.** `proposal-live-v4.html` has the Web Audio API code. Extract to `lib/audio.ts`. 4 sound primitives: tick, threshold-cross, carrier-lost, session-start.
10. **Settings persistence.** Hook the drawer's controls to `localStorage`.
11. **View Transitions API** on nav clicks where supported (see `proposal-overview-v4.html`).
12. **Print stylesheet** on Report (`@media print` rules already in `proposal-report-v4.html`).

## 4. What to delete from current chronoscope.dev

- `Sora` and `Martian Mono` font imports
- All cyan (`#67e8f9`) and pink (`#f9a8d4`) brand-accent uses — replace with station palette
- The current glass-blur card styling — replace with bordered `bg-2` panels
- The existing `tokens.ts` color values (keep the file structure; replace contents)
- Any v2/v3 era components if they exist
- The auto-start measurement behavior on first visit — replace with the cold-visit page's explicit Begin button

## 5. What carries over unchanged

- The underlying measurement engine (Web Workers, synchronized rounds)
- Resource Timing phase extraction logic
- The `tokens.ts` enforcement pattern (ESLint + Stylelint blocking raw hex)
- Cloudflare Pages deploy
- The 60-second window default + 1-second cadence default

## 6. Known gaps the design doesn't yet address

- **Live data integration** — the prototype simulates probes; production needs the Web Worker probe loop wired into `<OrbitalScene>` props
- **Real Cloudflare Worker for outside transit** — `/transit` shows a designed result; production needs the worker that fans out to IAD/LHR/NRT
- **Real session sharing** — `/report?r=…` URL fragment encoding
- **Hosted report KV upload** — the toggle exists in Settings but no backend
- **Companion-agent connection** — install card is built; the connected/streaming state UI is not
- **375 px screen-reader path** — `<OrbitalScene>` needs an `aria-fallback` table for assistive tech

## 7. Per-shader hand-off notes

The Live scene contains 4 distinct shaders:

**Star vertex/fragment** (~80 lines) — additive blending, size attenuation. Lift verbatim.

**Ring shader (sweep-aware)** (~30 lines) — fragment shader computes `atan2(vPos.y, vPos.x)`, brightens at the sweep position with exponential falloff. The Error page's variant adds a gap-regions uniform.

**Pulse point shader** (~50 lines) — vertex handles size attenuation + age-based pop. Fragment draws core + halo + Airy ring + diffraction spikes from `gl_PointCoord`. The single most distinctive visual element in the system.

**Home halo shader** (~20 lines) — fresnel-rim glow with sine breathing.

## 8. Recommended Claude Code prompt to start

> Read `HANDOFF.md` and `DIRECTION-v4.md`. Then read `style-guide-v4.html` for the token system. Then begin Phase A: update `src/lib/tokens.ts` with the Vessel palette and replace the font imports in `src/app.html`. Show me a screenshot of any one current surface before and after so I can confirm the visual swap is right.

That's the first concrete step. After Phase A lands cleanly, move to Phase B.

— Vessel handoff package, 2026-05-23
