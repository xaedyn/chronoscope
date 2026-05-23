# DIRECTION v4 — Vessel

**Author:** design partner, session 4
**Date:** 2026-05-23
**Status:** committed direction · full v4 surface set delivered
**Supersedes:** v3 (Orrery). Vessel keeps Orrery's orbital thesis and escalates the visual execution to a real WebGL observatory at award-grade fidelity.

---

## Thesis

**Chronoscope is a desk-sized observatory rendered in real 3D.** The synchronized-round measurement model that v3 sketched as a 2D floor plan becomes, in v4, a tilted-perspective scene with depth, parallax, atmosphere, and bloom-quality phosphor. The metaphor — *your browser is a small observatory; the network is the sky it watches* — is no longer a graphic, it is a place the user enters and inhabits.

This is not Vessel-as-decoration on top of Orrery. It is the design moment that takes the v3 idea seriously enough to commit to actual 3D — and demonstrates that the network-diagnostic category has not been claimed at this fidelity by any product currently shipping.

## What carried over from v3 (and what didn't)

**Kept:**
- The orbital diagram as the system's single load-bearing form
- Concentric orbits at fixed radii, one per station, pulses arriving at their angular time-slots
- The sweep as the now-line / write-head
- Astronomical / radio-observatory vocabulary in diagnostic copy (transit, carrier, drift, Doppler)
- The four-station default set and its semantics

**Escalated:**
- 2D SVG → real WebGL via Three.js (depth, perspective, parallax)
- Flat ink-on-canvas → phosphor-shader points with diffraction spikes, halos, breathing
- Static rings → custom shader rings that light up under the sweep
- Decorative stars → real 3D star field at radius 60–120 with size attenuation and proper depth parallax
- Linear loaders → cinematic "Acquiring carrier" sequences with assembly animations
- Inert flat colors → bloom-quality emissive surfaces with proper additive blending

**Refused:**
- Bloom postprocessing (the CDN-served addon proved flaky; we matched the look with brighter shader output instead)
- Custom cursors (visual gimmick with no diagnostic value)
- Audio by default (it's a toggle, off on first load)
- Any literal "globe" or "world map" rendering (geographic decoration, not measurement evidence)

## Type system

**Hanken Grotesk** + **Space Mono** — same families as v3, used more aggressively.

- **Hanken Grotesk** at weight 200 for hero numerics and verdict copy. The 200 weight is non-negotiable for hero scale: at 240 px+ the ultralight letterforms become the dominant graphic identity of the product.
- **Hanken Grotesk** at 300–500 for body and labels.
- **Space Mono** for all numerics, station IDs, coordinates, telemetry labels, timestamps. Tabular figures always.

**Scale doubled vs. v3:**
- Hero numerics now 240–320 px (was 100–140)
- Section titles 32–52 px (was 22–30)
- Hero verdicts 64–96 px (was 48–72)

The brief warned against typographic risk that doesn't earn its place. Every hero numeral does measurement work — it *is* the most important latency value on the page. The scale is functional, not decorative.

## Color system

Solid warm-black canvas (`#03050A`), warm bone-white foreground (`#F2EBDB`), four station hues calibrated to real stellar luminance bands, four-step severity overlay.

| Token | Value | Origin |
| --- | --- | --- |
| `bg` | `#03050A` | Cool warm-black; deeper than v3's `#04060B` for stronger contrast with stars |
| `fg` | `#F2EBDB` | Warm bone-white, contrast 14.6:1 |
| `station-A` | `#B7D3EC` | Sirius blue-white — Google |
| `station-B` | `#8CD4C9` | Vega cyan — Edge |
| `station-C` | `#E8D597` | Sun yellow-white — AWS |
| `station-D` | `#D78E68` | Betelgeuse red-orange — Fastly |
| `sev-warn` | `#E8C36F` | 70% of trigger |
| `sev-bad` | `#D27258` | Over trigger |
| `sev-crit` | `#B14238` | Timeout / carrier-lost |

The full WCAG AA audit is in the engineering notes file the team will produce; all foreground/background pairs verified ≥4.5:1.

## Motion language — 5 primitives

1. **Camera drift + mouse parallax.** Slow continuous orbit at ~0.00005 rad/frame plus a cursor-driven offset lerped at 4.5% per frame. Active on every surface that has a 3D scene. Honors `prefers-reduced-motion`.
2. **Sweep rotation.** Single thin beam-mesh rotates around the focused orbit, completing one revolution per `windowSeconds` (default 60). The sweep's angular position is fed to ring shaders so the orbit *lights up under it.*
3. **Pulse stamp.** New pulse arrives at the slot the sweep is currently passing — visible as a sudden bright dot that decays into the orbit's history over 2 s. Implemented as a per-vertex `age` attribute in the shader.
4. **Assembly sequences.** Loader counts up "Acquiring carrier 000 → 247" (~1.5 s), then the scene assembles: rings draw outward staggered (~1.8 s), pulses materialize on each orbit as their ring completes, sweep fades in last. Used on cold-visit and every surface's initial load.
5. **Strike-through animation.** The carrier-lost state animates a 1 px crimson line across the failed station's name over 600 ms. Used only on error-state surfaces.

All motion is GPU-cheap (single transforms or shader uniforms), honors `prefers-reduced-motion: reduce`, and frame-budgets at <2 ms per RAF tick on a 2024 mid-tier laptop.

## Chrome system

Consistent across all 9 surfaces:
- **Masthead** — 14 px padded, sticky on scrolling pages, blurred backdrop, brand crest + tag, nav (4 routes), carrier-tag pulser, action buttons
- **Breadcrumb / coordinate strip** — second band below masthead, mono coords, route hierarchy
- **Vignette** — radial darkening at 30% → 96% from center, layered over every WebGL stage
- **Star field** — 1,200–3,000 points depending on canvas size, sphere-distributed at r=60–120
- **Footer bar** — mono telemetry with cert ID, page-specific center text, right-aligned context

## Surface set delivered

Nine surfaces, full visitor arc:

1. **`index.html`** — landing with cinematic hero + 4 surface preview cards + how-it-works + stations palette + CTA
2. **`proposal-cold-v4.html`** — first-visit empty state with 3-phase animation (cold → acquiring → live)
3. **`proposal-overview-v4.html`** — mission status with verdict at hero scale + compact orbital diagram + 4-state switcher
4. **`proposal-live-v4.html`** — 3D orbital tracker, sweep-aware ring shaders, tuning indicator, mouse parallax, audio toggle
5. **`proposal-investigate-v4.html`** — per-station polar distribution + percentile ladder + phase decomposition with "Carrier opaque" honesty
6. **`proposal-endpoint-v4.html`** — single-station drill-down with one big orbit + 3 ghost orbits + full session pulses + station switcher
7. **`proposal-transit-v4.html`** — outside-vantage probe with target-at-center + 4 vantage origins + comparison grid + 3-cell decision matrix
8. **`proposal-report-v4.html`** — completed session signature with cinematic imprint + scrub rail + real PNG export
9. **`proposal-error-v4.html`** — carrier-lost state with shader-rendered gap regions in the orbit + last-known-good anchor + pattern classification + recovery guidance
10. **`proposal-settings-v4.html`** — slide-in settings drawer with sectioned form controls + endpoint management + companion-agent install card

The visitor arc: index → cold → live → endpoint → transit → report. The operator arc: live → investigate → endpoint → transit → error → recovery.

## What this design says about Chronoscope, in one sentence

*It treats the act of network observation as a real spatial experience — not a dashboard, not a graph, but a room you stand in.*

## Engineering notes for translation

### Three.js patterns to lift

- **ESM via importmap** loading from `cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`. Postprocessing addons (`EffectComposer`, `UnrealBloomPass`) failed to load through both unpkg and jsdelivr in our prototypes — the look is achieved with shader brightness instead. If the production team can resolve this with a bundled Three.js, bloom would push the visual ceiling further.
- **Shader-based pulse points.** Each station's pulses are a single `THREE.Points` mesh with per-vertex `position`, `color`, `aSize`, `aAge`, `aReveal` attributes. The vertex shader handles size attenuation by view depth; the fragment shader draws core + halo + outer ring + diffraction spikes from `gl_PointCoord`. Don't substitute `THREE.Sprite` — it's heavier and doesn't give us the per-instance shading control.
- **Sweep-aware ring shader.** The orbital ring fragment shader computes its own angular position via `atan2(vPos.y, vPos.x)`, compares to a `uSweep` uniform, and brightens at the sweep position with an exponential falloff. This is what makes the sweep visibly "energize" the orbit.
- **Custom dpr handling.** `renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))` and `renderer.setSize(w, h, false)` (third arg = don't update CSS). Resize on window resize and on parent-element resize.
- **Star field as `THREE.Points`** with sphere-shell distribution and size attenuation; not a skybox texture.

### Svelte 5 translation guidance

- Each surface becomes a `+page.svelte` route. The shared chrome (masthead, breadcrumb, vignette, star field) goes in `+layout.svelte`.
- The WebGL scene is a single component (`<Orrery />`) that accepts props: `focusedStation`, `mode` (live/static/error), `stationData`, `gapRegions`. Internal RAF loop runs onMount, cleans up on destroy.
- Color/font tokens belong in `src/lib/tokens.ts` per the existing project convention. The four station hues are the only non-negotiable values; severity colors and chrome neutrals can be lightly adjusted to taste.
- The shader strings should live in `.glsl` files imported via Vite's `?raw` suffix, not inline JS template literals. Easier to maintain and gives the team syntax highlighting.

### What I did not have time for

- **Mobile (375px) reflow** — every surface uses `@media (max-width: 720px)` rules but full mobile-first reconsideration of the WebGL scenes is deferred. On phones the orbital scene should probably squash to a portrait-aspect 2D version.
- **Real outside-transit integration** — the transit surface shows a designed result, not a working Cloudflare Workers call.
- **PDF export of the Report** — the canvas `toDataURL` exports a PNG; a real PDF version (the "star-catalog page") would benefit from server-side rendering or a print stylesheet.
- **Companion-agent UI** — the install card exists; the connected/streaming-data state when the agent is active is sketched but not built as its own surface.

— Chronoscope design partner, 2026-05-23
