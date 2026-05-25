# Report Replay Instrument Lens Design

Status: approved direction from the user on 2026-05-24.

## Purpose

Chronoscope's Report page already has the ingredients of a real diagnostic instrument: an orbital session signature, replay scrubber, selected pulse evidence, sample inspector, station summaries, and observer notes. The next product move is to make those pieces behave as one analytical lens.

The selected replay moment becomes the center of the page. When a user scrubs the report or selects a pulse, Chronoscope should answer:

- What changed at this moment?
- Which station changed?
- Did other stations move with it?
- How far was it from baseline and trigger?
- What does this prove, and what remains outside browser evidence?

This makes the orbital visualization readable as evidence rather than decorative polish.

## Current Context

The implementation should build on the current code instead of replacing the report:

- `src/lib/components/ReportView.svelte` owns the report surface, replay scrubber, export actions, observer notes, station roll-call, and current evidence panels.
- `src/lib/utils/report-replay.ts` already derives a replay frame from session samples, scrub progress, threshold, capture time, and window slots.
- `src/lib/components/OrbitalScene.svelte` renders the orbital signature and can emit pulse inspection data on selectable pulses.
- `src/lib/components/PulseEvidence.svelte` displays pinned or replay-selected pulse evidence.
- `src/lib/components/SampleInspector.svelte` already compares previous, current, next, and same-round peer state.
- `tests/visual/instrument-shell.spec.ts` already covers report replay, sample inspector visibility, export image, pinned pulse carryover, and calibration key presence.

## Scope

This phase focuses on Report replay only.

In scope:

- Make the replay-selected moment a first-class report concept.
- Strengthen the relationship between scrub position, selected pulse, station roll-call, sample inspector, and observer notes.
- Add a compact peer-at-round comparison so the user can see whether the selected station was isolated or part of a shared change.
- Add claim-safe "What this suggests / What this cannot prove" copy near the selected evidence.
- Keep export/share behavior compatible with existing report payloads.
- Add focused unit and visual coverage for the new lens behavior.

Out of scope:

- Redesigning Live view HUD density.
- Adding global filters, anomaly workbench controls, or multi-select brushing.
- Changing the measurement engine or sample storage model.
- Claiming root cause from browser-only evidence.
- Replacing the existing orbital visual system.

## UX Design

### Report Layout

The report keeps the orbital signature as the visual centerpiece. A new "Replay lens" panel sits near the current evidence and inspector region. It reads as instrument chrome, not a generic card.

The panel has four parts:

1. Moment header
   - Round label, timestamp or relative position, selected station, and threshold.
   - Shows "Replay moment" for scrub-derived selection and "Pinned pulse" when the user carried a pulse from Live or Endpoint into the report.

2. Signal readout
   - Latency, threshold delta, drift from station baseline, and previous/current/next trend.
   - Uses the existing `PulseEvidence` summary where possible so share/export language stays consistent.

3. Peer field
   - Same-round comparison for monitored endpoints with samples at the selected round.
   - Shows each endpoint label, latency/status, threshold delta, and whether it moved with the selected station.
   - Sorts selected station first, then highest threshold delta, then label.
   - For more than four monitored endpoints, the first four still map to orbital stations, but the peer field may include all monitored endpoints that have a same-round sample.

4. Proof boundary
   - Two short statements:
     - "What this suggests" summarizes the observed pattern.
     - "What this cannot prove" states the browser limitation.
   - Copy must be evidence-gated and should reuse existing diagnostic language where practical.

### Interaction Model

- Scrubbing the report updates the replay frame, selected round, selected pulse evidence, sample inspector, peer field, and proof boundary together.
- A pinned pulse takes priority over scrub-derived evidence. The report should make that priority visible and offer a clear "Return to replay" control that clears the pinned pulse.
- Clicking or keyboard-selecting a pulse in the report orbital scene should select that pulse and update the lens.
- Station roll-call rows should indicate the station that owns the selected/pinned pulse.
- Observer notes should remain narrative, but the selected lens gives the precise evidence below them.

### Empty and Partial States

- If the replay frame has no selected sample, the lens explains that more successful samples are needed.
- If the selected round has no peer samples, the peer field says "No peer samples captured for this round."
- If a peer sample is timeout/error, the row displays the status as evidence instead of dropping the row.
- If the sample has no adjacent previous or next successful sample, the trend copy says that directly.

## Data Design

Create a focused report-lens utility rather than growing `ReportView.svelte` with more inline derivations.

Recommended module:

- `src/lib/utils/report-instrument-lens.ts`

Primary output shape:

- `selected`: current `PulseInspection | null`
- `source`: `pinned | replay | none`
- `moment`: round label, timestamp label, threshold, selected endpoint label
- `signal`: latency, drift, threshold delta, previous/current/next summary
- `peers`: same-round endpoint rows with latency/status/delta/moved-with-selected flags
- `proof`: claim-safe suggest/cannot-prove strings

Inputs:

- monitored endpoints
- measurement state
- threshold
- current report pulse
- pinned pulse
- replay frame pulse

This utility should call or compose existing helpers when possible:

- `buildSampleInspector` for adjacent and peer counts.
- `thresholdDeltaLabel`, `driftLabel`, and `pulseInspectionSummary` for consistent labels.
- Existing diagnostic report/narrative helpers for claim-safe language where useful.

## Component Design

Add one small component for the new panel:

- `src/lib/components/ReportInstrumentLens.svelte`

Responsibilities:

- Render the moment header, signal readout, peer field, and proof boundary.
- Expose a "Return to replay" action only when a pinned pulse is active.
- Use stable CSS dimensions and existing token conventions.
- Avoid nested-card styling. The panel should fit the current report instrument aesthetic: bordered rows, mono labels, restrained high-contrast text, and no decorative filler.

Keep existing components:

- `PulseEvidence` remains the compact evidence citation.
- `SampleInspector` remains the adjacent-sample inspector.
- `InstrumentCalibration` remains the encoding key.

`ReportView.svelte` should compose these pieces and own only page-level state.

## Error Handling and Trust

The lens must never turn browser-only evidence into root-cause certainty.

Allowed language:

- "This round shows..."
- "The selected station crossed the trigger while peers stayed below it."
- "Multiple stations were elevated in the same round."
- "Browser evidence cannot separate local network, route, and endpoint cause by itself."
- "An outside check can reduce that uncertainty."

Avoid language:

- "Your ISP caused this."
- "The endpoint caused this."
- "This proves the server was slow."
- "This will fix the issue."

## Testing

Unit tests:

- `report-instrument-lens` builds a selected replay lens from a replay pulse.
- Pinned pulse overrides replay pulse and exposes return-to-replay state.
- Same-round peers include timeout/error samples and sort selected station first.
- Proof copy differs for isolated selected-station movement versus shared peer movement.

Visual/browser tests:

- Report replay scrub updates the lens, evidence panel, and sample inspector together.
- Pinned pulse shows as pinned, highlights the station row, and "Return to replay" restores scrub-derived evidence.
- Mobile report layout keeps the lens readable without overlapping export/scrub controls.
- Existing image export still downloads a composed artifact.

Verification commands:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npx playwright test tests/visual/instrument-shell.spec.ts`

## Acceptance Criteria

- A user can scrub a completed report and understand the selected round without reading the raw table or guessing at the orbital encoding.
- The selected moment visibly drives the report evidence, peer comparison, and inspector.
- The report distinguishes "selected replay moment" from "pinned pulse evidence."
- The peer comparison makes isolated versus shared movement obvious.
- The proof copy is useful but does not overclaim root cause.
- Desktop and mobile report layouts remain stable and readable.
- Existing share/export behavior continues to work.
