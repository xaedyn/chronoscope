# v2 Aesthetic Arc — Handoff

Status: 7/7 PRs merged. The Chronoscope visual system now sits in v2's
calm-product posture across every route.

## What shipped

| PR | Surface | Visible change |
|----|---------|----------------|
| 1  | Overview verdict card | Score ring dropped, MF/I labels dropped, two-paragraph body, white-on-black primary, quieter pills, pinging-dot live indicator, inline endpoint name highlight |
| 2  | NetworkTopology      | Rounded-square glyphs in same family across origin + endpoints, tinted fill instead of glow halos, nearly-invisible path lines, softer pulse animation |
| 3  | Background palette   | Pure-black page bg + `#1C1C1E`/`#2C2C2E` panels (replaces blue-tinted near-black); drops Layout.svelte gradient + corner orbs |
| 4  | Shell + Topbar       | Centred floating pill at desktop, v2 segmented control nav inside the pill, white-on-black Start button, rose-tinted Stop, quiet settings cog, mobile-only separate nav row |
| 5  | Endpoint rows + event log | Stacked rounded-cards instead of border-bottom rows; tinted status circle; sans-serif body; quieter sparkline |
| 6  | Live + Investigate + Report | Every panel surface aligns to flat shell-panel + 16/24 px radius + soft shadow family; drops the cyan radial gradients on hero surfaces |
| 7  | Baselines + tokenisation | Two more files removed from `.stylelintignore` (SharedResultsBanner, KeyboardOverlay); this document |

## Remaining work for you to do

### 1. Regenerate Playwright visual baselines

Every surface changed visually. The PNG baselines under
`tests/visual/**/*.png` are stale. Regenerate them locally:

```bash
npx playwright test --update-snapshots
git status                          # review which baselines moved
git add tests/visual                # stage the new baselines
git commit -m "test(visual): regenerate baselines for v2 aesthetic arc"
```

Run on the same machine + browser that produces the CI baselines —
otherwise the next CI run will fail with anti-aliasing diffs. Default
is Chromium on Darwin per the existing `.spec.ts-snapshots/` naming.

### 2. Finish the tokenisation sweep (optional)

Eleven files remain in `.stylelintignore` with raw rgba / hex
violations. These don't block the v2 aesthetic shift, but the longer
they stay ignored the more drift accumulates. Suggested order
(smallest-first to build momentum):

```
src/lib/components/ConfigStagingBanner.svelte   (~21 raw values)
src/lib/components/IntelligencePanel.svelte
src/lib/components/EndpointDrawer.svelte
src/lib/components/CompanionPanel.svelte
src/lib/components/SharePopover.svelte
src/lib/components/SettingsDrawer.svelte
src/lib/components/EndpointRow.svelte
src/lib/components/ScopeCanvas.svelte
src/lib/components/LiveView.svelte              (deeper rewrite)
src/lib/components/LocalProofPanel.svelte
src/app.css                                     (global)
```

The pattern: replace `rgba(8, 14, 24, 0.62)` with
`color-mix(in srgb, black 40%, transparent)` (or
`color-mix(in srgb, var(--shell-panel) 75%, transparent)` when the
intent is "tinted panel surface, not blacker than the page"). The
existing `Topbar.svelte`, `OverviewView.svelte`, and
`NetworkTopology.svelte` are good references for which patterns to
use where.

### 3. Things worth re-introducing later

The v2 aesthetic arc dropped a few Chronoscope-specific moats. Bring
them back in v2's aesthetic language when you're ready:

- **Score numeral.** Dropped from the verdict card. If you want it
  back, render it as a small monospace number in the verdict-kickers
  row next to the severity pill — *not* as a ring.
- **T+MM:SS elapsed counter.** Dropped from the topbar. If you want it
  back, render it adjacent to the Live indicator in zinc-500 mono.
- **Measured Fact / Interpretation labels.** Dropped. The two
  paragraphs survive as typography. If you want the labels back for
  screen-reader clarity, add them as `.sr-only` headings rather than
  visible bold prefixes.

### 4. Live testing reminder

Per saved memory: any browser-based review of the deployed app must
**click Stop** on the running measurement before closing the session.
Persistent pinging against shared infrastructure (google.com,
cloudflare.com) is the failure mode this rule prevents.
