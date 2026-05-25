# Diagnostic Evidence Contract Design

## Goal

Make every Chronoscope page answer a different diagnostic question from the same evidence hierarchy, so the product feels like a trustworthy instrument instead of several beautiful views repeating the same signal.

## Problem

The current UI is visually cohesive, but the pages still overlap too much:

- Overview, Live, and Report all lean heavily on the orbital field and broad verdict copy.
- Report can highlight a real historical spike while the page headline still says the session looks healthy.
- Investigate has strong raw comparison surfaces, but it does not yet state a clear working hypothesis in the first viewport.
- Endpoint detail is useful but still visually led by the same orbital instrument that Live owns.

The product needs one shared contract that separates current status from past notable evidence, selected sample evidence, confidence, limitation, and next validation.

## Page Contracts

- Overview answers: "Am I okay right now, and what changed?"
- Live answers: "What is the instrument sensing right now?"
- Investigate answers: "Why does the signal look this way?"
- Endpoint answers: "What is this one station doing?"
- Report answers: "What happened, what proves it, and what can I share?"
- Transit answers: "Does another vantage hear the same thing?"

## Evidence Hierarchy

The shared contract exposes:

- Current status: the present diagnostic verdict from the mature sample window.
- Notable event: the strongest threshold crossing, failure, or large drift in the recorded session.
- Selected sample: a clicked, scrubbed, pinned, or report-selected sample.
- Peer behavior: same-round comparison around selected evidence.
- Confidence and limitation: what the browser can prove and what it cannot.
- Next validation: the most useful next action.

Surfaces must not collapse these into one headline. A healthy current status can coexist with a notable historical event; Report and Overview should say that explicitly.

## First Implementation Slice

Create a pure utility, `src/lib/utils/diagnostic-evidence-contract.ts`, that builds a compact cross-page model from the existing report, endpoints, measurements, threshold, and significant pulse.

The first slice should:

- Detect the strongest notable event across successful over-threshold samples, timeout/error samples, and large drift.
- Compose current-vs-notable headline text.
- Produce per-page labels:
  - Overview: concise current status plus notable-event line.
  - Live: last/strongest event tape entry and operational copy.
  - Investigate: first-pass hypothesis and evidence bullets.
  - Endpoint: station-specific event copy where possible.
  - Report: reconciled session headline and evidence lede.
- Keep Transit unchanged except for future compatibility.

## Visual Direction

Do not redesign the whole app in this slice. Preserve the instrument system and add clearer data ownership:

- Overview gets a smaller, more explicit "Current / Notable / Next" readout.
- Live gets an operational event strip.
- Investigate gets a hypothesis panel.
- Report gets a reconciled headline and notable evidence line.
- Endpoint gets station-specific status language without changing its full layout.

## Testing

Add unit tests for the evidence contract:

- Healthy current status with a historical spike produces a split headline.
- Timeout/error samples can become the notable event.
- Large drift below threshold is a watch-level notable event.
- No notable event falls back to current-only copy.

Add visual tests that assert:

- Report no longer says only "This test looks healthy" when a significant event is selected.
- Overview shows both current status and notable event when a completed session has a spike.
- Investigate exposes the hypothesis panel.
- Live exposes the event strip.

## Non-Goals

- Full page redesign.
- New charting systems.
- Rewriting the diagnostic narrative engine.
- Changing Transit's outside-vantage mock/probe flow.
- Solving every mobile layout issue in this slice.
