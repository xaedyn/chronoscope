# Report Instrument Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Report replay behave like an inspectable instrument where one selected moment drives orbital highlights, peer comparison, evidence copy, and sample inspection.

**Architecture:** Keep interpretation in a pure utility, presentation in one focused Svelte component, and page orchestration in `ReportView.svelte`. Extend `OrbitalScene.svelte` with optional selection props so the WebGL scene participates in the instrument lens instead of leaving the analysis in DOM panels.

**Tech Stack:** Svelte 5, TypeScript, Vite, Vitest, Playwright, Three.js.

---

## File Structure

- Create `src/lib/utils/report-instrument-lens.ts`: pure derivation for selected moment, peer movement classes, proof copy, and orbital selection props.
- Create `tests/unit/utils/report-instrument-lens.test.ts`: unit coverage for replay, pinned, peer status, and proof-copy behavior.
- Create `src/lib/components/ReportInstrumentLens.svelte`: compact report lens panel with signal readouts, peer field, proof boundary, and return-to-replay action.
- Modify `src/lib/components/OrbitalScene.svelte`: add optional selected pulse marker, same-round peer markers, selected-angle guide, and focus-ring support.
- Modify `src/lib/components/ReportView.svelte`: own selection source, initialize completed reports on the significant pulse, route scrub/click/pin state into the lens, highlight station cards, and mount the new component.
- Modify `tests/visual/instrument-shell.spec.ts`: assert significant-moment startup, lens updates, selected orbital marker, peer emphasis, pinned priority, and mobile stability.

## Task 1: Report Lens Utility Tests

**Files:**
- Create: `tests/unit/utils/report-instrument-lens.test.ts`
- Read: `tests/unit/utils/report-replay.test.ts`
- Read: `tests/unit/utils/sample-inspector.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/utils/report-instrument-lens.test.ts` with this structure:

```ts
import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../../../src/lib/utils/ring-buffer';
import { buildReportInstrumentLens } from '../../../src/lib/utils/report-instrument-lens';
import type {
  Endpoint,
  EndpointMeasurementState,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
  StatisticsState,
} from '../../../src/lib/types';

function endpoint(id: string, label: string): Endpoint {
  return {
    id,
    label,
    url: `https://${id}.example.test/probe`,
    enabled: true,
    color: '#ffffff',
  };
}

function endpointState(endpointId: string, samples: readonly MeasurementSample[]): EndpointMeasurementState {
  const buffer = new RingBuffer<MeasurementSample>(5000);
  for (const sample of samples) buffer.push(sample);
  const last = samples.at(-1) ?? null;
  return {
    endpointId,
    samples: buffer,
    lastLatency: last?.status === 'ok' ? last.latency : null,
    lastStatus: last?.status ?? null,
    lastErrorMessage: null,
    tierLevel: 1,
  };
}

function measurements(states: Record<string, readonly MeasurementSample[]>): MeasurementState {
  return {
    lifecycle: 'stopped',
    epoch: 1,
    roundCounter: 12,
    startedAt: 1_700_000_000_000,
    stoppedAt: 1_700_000_012_000,
    freezeEvents: [],
    errorCount: 0,
    timeoutCount: 0,
    endpoints: Object.fromEntries(
      Object.entries(states).map(([id, samples]) => [id, endpointState(id, samples)]),
    ),
  };
}

function ok(round: number, latency: number): MeasurementSample {
  return {
    round,
    latency,
    status: 'ok',
    timestamp: 1_700_000_000_000 + round * 1000,
  };
}

function timeout(round: number): MeasurementSample {
  return {
    round,
    latency: 0,
    status: 'timeout',
    timestamp: 1_700_000_000_000 + round * 1000,
  };
}

function pulse(overrides: Partial<PulseInspection> = {}): PulseInspection {
  return {
    source: 'endpoint',
    stationId: 'A',
    endpointId: 'alpha',
    endpointLabel: 'Alpha',
    slot: 120,
    roundNumber: 10,
    latency: 180,
    drift: 70,
    thresholdMs: 120,
    thresholdDelta: 60,
    timeLabel: 'T+10s',
    capturedAt: 1_700_000_012_000,
    ...overrides,
  };
}

const endpoints = [
  endpoint('alpha', 'Alpha'),
  endpoint('bravo', 'Bravo'),
  endpoint('charlie', 'Charlie'),
  endpoint('delta', 'Delta'),
] as const;

const stats: StatisticsState = {};

describe('buildReportInstrumentLens', () => {
  it('uses the replay pulse when there is no pinned pulse', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({
        alpha: [ok(9, 100), ok(10, 180)],
        bravo: [ok(9, 88), ok(10, 91)],
      }),
      stats,
      thresholdMs: 120,
      pinnedPulse: null,
      replayPulse: pulse(),
      significantPulse: null,
      selectionSource: 'scrub',
      windowSlots: 360,
    });

    expect(lens.selected?.endpointId).toBe('alpha');
    expect(lens.source).toBe('scrub');
    expect(lens.canReturnToReplay).toBe(false);
    expect(lens.peers.map((peer) => [peer.endpointId, peer.movement])).toEqual([
      ['alpha', 'selected'],
      ['bravo', 'steady'],
      ['charlie', 'missing'],
      ['delta', 'missing'],
    ]);
    expect(lens.proof.suggests).toContain('crossed the trigger');
    expect(lens.orbitalSelection?.selected.stationId).toBe('A');
  });

  it('lets a pinned pulse override replay evidence', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({
        alpha: [ok(9, 100), ok(10, 180)],
        bravo: [ok(9, 100), ok(10, 190)],
      }),
      stats,
      thresholdMs: 120,
      pinnedPulse: pulse({ stationId: 'B', endpointId: 'bravo', endpointLabel: 'Bravo', latency: 190, thresholdDelta: 70 }),
      replayPulse: pulse(),
      significantPulse: null,
      selectionSource: 'scrub',
      windowSlots: 360,
    });

    expect(lens.source).toBe('pinned');
    expect(lens.selected?.endpointId).toBe('bravo');
    expect(lens.canReturnToReplay).toBe(true);
    expect(lens.selectionReason).toContain('Pinned');
  });

  it('classifies same-round timeout and elevated peers as co-elevated', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({
        alpha: [ok(9, 100), ok(10, 180)],
        bravo: [ok(9, 100), ok(10, 160)],
        charlie: [ok(9, 90), timeout(10)],
        delta: [ok(9, 86), ok(10, 88)],
      }),
      stats,
      thresholdMs: 120,
      pinnedPulse: null,
      replayPulse: pulse(),
      significantPulse: null,
      selectionSource: 'scrub',
      windowSlots: 360,
    });

    expect(lens.peers.find((peer) => peer.endpointId === 'bravo')?.movement).toBe('co-elevated');
    expect(lens.peers.find((peer) => peer.endpointId === 'charlie')?.movement).toBe('co-elevated');
    expect(lens.proof.suggests).toContain('Multiple stations');
  });

  it('uses significant-pulse language before the user scrubs', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({ alpha: [ok(9, 100), ok(10, 180)] }),
      stats,
      thresholdMs: 120,
      pinnedPulse: null,
      replayPulse: pulse(),
      significantPulse: pulse(),
      selectionSource: 'significant',
      windowSlots: 360,
    });

    expect(lens.source).toBe('significant');
    expect(lens.selectionReason).toContain('most significant');
  });
});
```

- [ ] **Step 2: Run the new utility test to verify it fails**

Run:

```bash
npx vitest run tests/unit/utils/report-instrument-lens.test.ts
```

Expected: FAIL because `src/lib/utils/report-instrument-lens.ts` does not exist.

## Task 2: Report Lens Utility Implementation

**Files:**
- Create: `src/lib/utils/report-instrument-lens.ts`
- Test: `tests/unit/utils/report-instrument-lens.test.ts`

- [ ] **Step 1: Implement utility types and selection priority**

Create `src/lib/utils/report-instrument-lens.ts` with these exports and helpers:

```ts
import type {
  Endpoint,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
  StatisticsState,
} from '$lib/types';
import { driftLabel, thresholdDeltaLabel } from './pulse-inspection';

export type ReportLensSource = 'significant' | 'scrub' | 'clicked' | 'pinned' | 'none';
export type ReportPeerMovement = 'selected' | 'co-elevated' | 'wobble' | 'steady' | 'missing';

export interface ReportLensPeer {
  readonly endpointId: string;
  readonly endpointLabel: string;
  readonly stationId: string | null;
  readonly latency: number | null;
  readonly status: MeasurementSample['status'] | 'missing';
  readonly thresholdDelta: number | null;
  readonly movement: ReportPeerMovement;
}

export interface ReportInstrumentLens {
  readonly selected: PulseInspection | null;
  readonly source: ReportLensSource;
  readonly selectionReason: string;
  readonly canReturnToReplay: boolean;
  readonly moment: {
    readonly roundLabel: string;
    readonly timeLabel: string;
    readonly endpointLabel: string;
    readonly thresholdLabel: string;
  };
  readonly signal: {
    readonly latencyLabel: string;
    readonly thresholdDeltaLabel: string;
    readonly driftLabel: string;
    readonly trendLabel: string;
  };
  readonly peers: readonly ReportLensPeer[];
  readonly proof: {
    readonly suggests: string;
    readonly cannotProve: string;
  };
  readonly orbitalSelection: {
    readonly selected: { readonly stationId: string; readonly slot: number; readonly roundNumber: number | null };
    readonly peerPulses: readonly { readonly stationId: string; readonly slot: number }[];
    readonly angle: number;
  } | null;
}

export interface BuildReportInstrumentLensInput {
  readonly endpoints: readonly Endpoint[];
  readonly measurements: MeasurementState;
  readonly stats: StatisticsState;
  readonly thresholdMs: number;
  readonly pinnedPulse: PulseInspection | null;
  readonly replayPulse: PulseInspection | null;
  readonly significantPulse: PulseInspection | null;
  readonly selectionSource: Exclude<ReportLensSource, 'pinned' | 'none'>;
  readonly windowSlots: number;
}
```

- [ ] **Step 2: Add sample lookup and peer classification**

Implement:

```ts
const STATION_IDS = ['A', 'B', 'C', 'D'] as const;

function sampleArray(state: MeasurementState['endpoints'][string] | undefined): readonly MeasurementSample[] {
  const samples = state?.samples;
  if (!samples) return [];
  return typeof samples.toArray === 'function'
    ? samples.toArray()
    : Array.from(samples as unknown as readonly MeasurementSample[]);
}

function sampleAtRound(measurements: MeasurementState, endpointId: string, round: number): MeasurementSample | null {
  return sampleArray(measurements.endpoints[endpointId]).find((sample) => sample.round === round) ?? null;
}

function previousOkSample(measurements: MeasurementState, endpointId: string, round: number): MeasurementSample | null {
  const samples = sampleArray(measurements.endpoints[endpointId]);
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const sample = samples[i];
    if (sample && sample.round < round && sample.status === 'ok' && Number.isFinite(sample.latency)) return sample;
  }
  return null;
}

function sameDirectionWobble(selectedDrift: number | null, peerDelta: number | null): boolean {
  if (selectedDrift === null || peerDelta === null) return false;
  if (Math.abs(peerDelta) < 10) return false;
  return Math.sign(selectedDrift) === Math.sign(peerDelta);
}
```

- [ ] **Step 3: Add builder and proof copy**

Implement `buildReportInstrumentLens(input)`:

```ts
export function buildReportInstrumentLens(input: BuildReportInstrumentLensInput): ReportInstrumentLens {
  const selected = input.pinnedPulse ?? input.replayPulse ?? input.significantPulse;
  const source: ReportLensSource = input.pinnedPulse
    ? 'pinned'
    : selected === input.significantPulse && input.selectionSource === 'significant'
      ? 'significant'
      : selected
        ? input.selectionSource
        : 'none';

  if (!selected || selected.roundNumber === null) return emptyLens(source);

  const peers = buildPeers(input, selected);
  const coElevated = peers.filter((peer) => peer.movement === 'co-elevated').length;
  const selectedPeer = peers.find((peer) => peer.movement === 'selected') ?? null;
  const roundLabel = `Round #${selected.roundNumber}`;

  return {
    selected,
    source,
    selectionReason: reasonFor(source),
    canReturnToReplay: source === 'pinned',
    moment: {
      roundLabel,
      timeLabel: selected.timeLabel ?? 'Replay position',
      endpointLabel: selected.endpointLabel,
      thresholdLabel: `${Math.round(input.thresholdMs)} ms trigger`,
    },
    signal: {
      latencyLabel: `${selected.latency} ms`,
      thresholdDeltaLabel: thresholdDeltaLabel(selected.thresholdDelta),
      driftLabel: driftLabel(selected.drift),
      trendLabel: selected.drift === null ? 'No adjacent ok sample' : `${driftLabel(selected.drift)} from previous ok sample`,
    },
    peers,
    proof: proofFor(selected, coElevated, selectedPeer),
    orbitalSelection: orbitalSelectionFor(selected, peers, input.measurements, input.windowSlots),
  };
}
```

Add helper functions in the same file:

```ts
function emptyLens(source: ReportLensSource): ReportInstrumentLens {
  return {
    selected: null,
    source,
    selectionReason: 'No replay sample is selected yet.',
    canReturnToReplay: source === 'pinned',
    moment: {
      roundLabel: 'No round selected',
      timeLabel: 'Replay unavailable',
      endpointLabel: 'No station',
      thresholdLabel: 'No trigger',
    },
    signal: {
      latencyLabel: '-',
      thresholdDeltaLabel: 'no sample',
      driftLabel: 'no adjacent ok sample',
      trendLabel: 'No adjacent ok sample',
    },
    peers: [],
    proof: {
      suggests: 'Chronoscope needs a successful replay sample before it can compare the field.',
      cannotProve: 'Browser evidence cannot separate local network, route, and endpoint cause by itself.',
    },
    orbitalSelection: null,
  };
}

function reasonFor(source: ReportLensSource): string {
  switch (source) {
    case 'pinned':
      return 'Pinned pulse carried into the report.';
    case 'significant':
      return 'Chronoscope opened on the most significant detected moment.';
    case 'clicked':
      return 'Pulse selected from the orbital signature.';
    case 'scrub':
      return 'Replay moment selected by the scrubber.';
    case 'none':
      return 'No replay sample is selected yet.';
  }
}

function proofFor(
  selected: PulseInspection,
  coElevatedCount: number,
  selectedPeer: ReportLensPeer | null,
): ReportInstrumentLens['proof'] {
  const suggests = coElevatedCount > 1
    ? `Multiple stations were elevated in ${selected.roundNumber === null ? 'this round' : `round #${selected.roundNumber}`}, so this looks like shared field movement in browser evidence.`
    : selected.thresholdDelta > 0
      ? `${selected.endpointLabel} crossed the trigger while peers stayed below it in the same round.`
      : selectedPeer?.movement === 'selected'
        ? `${selected.endpointLabel} stayed ${thresholdDeltaLabel(selected.thresholdDelta)} and serves as the selected reference sample.`
        : 'This replay moment has partial browser evidence.';
  return {
    suggests,
    cannotProve: 'Browser evidence cannot separate local network, route, and endpoint cause by itself. An outside check can reduce that uncertainty.',
  };
}
```

- [ ] **Step 4: Run utility tests**

Run:

```bash
npx vitest run tests/unit/utils/report-instrument-lens.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit utility slice**

Run:

```bash
git add src/lib/utils/report-instrument-lens.ts tests/unit/utils/report-instrument-lens.test.ts
git commit -m "feat(report): derive instrument lens evidence"
```

## Task 3: Report Lens Component

**Files:**
- Create: `src/lib/components/ReportInstrumentLens.svelte`
- Test indirectly: `tests/visual/instrument-shell.spec.ts`

- [ ] **Step 1: Create component**

Create `src/lib/components/ReportInstrumentLens.svelte`:

```svelte
<script lang="ts">
  import type { ReportInstrumentLens } from '$lib/utils/report-instrument-lens';

  let {
    lens,
    onReturnToReplay,
  }: {
    lens: ReportInstrumentLens;
    onReturnToReplay?: () => void;
  } = $props();
</script>

<section class="report-instrument-lens" aria-label="Replay lens">
  <div class="lens-head">
    <div>
      <span class="eyebrow">Replay lens</span>
      <h2>{lens.moment.roundLabel}</h2>
    </div>
    <div class="source" data-source={lens.source}>{lens.source}</div>
  </div>

  <p class="reason">{lens.selectionReason}</p>

  <div class="signal-grid" aria-label="Selected signal readouts">
    <div><span class="k">Station</span><span class="v">{lens.moment.endpointLabel}</span></div>
    <div><span class="k">Latency</span><span class="v">{lens.signal.latencyLabel}</span></div>
    <div><span class="k">Trigger delta</span><span class="v">{lens.signal.thresholdDeltaLabel}</span></div>
    <div><span class="k">Trend</span><span class="v">{lens.signal.trendLabel}</span></div>
  </div>

  <div class="peer-field" aria-label="Same round peer comparison">
    <div class="section-label">Same-round field</div>
    {#if lens.peers.length === 0}
      <p class="empty">No peer samples captured for this round.</p>
    {:else}
      {#each lens.peers as peer (peer.endpointId)}
        <div class="peer-row" data-movement={peer.movement}>
          <span class="station">{peer.stationId ?? '-'}</span>
          <span class="name">{peer.endpointLabel}</span>
          <span class="value">
            {#if peer.latency === null}
              {peer.status}
            {:else}
              {peer.latency} ms
            {/if}
          </span>
          <span class="delta">{peer.thresholdDelta === null ? '-' : `${peer.thresholdDelta >= 0 ? '+' : ''}${peer.thresholdDelta} ms`}</span>
          <span class="movement">{peer.movement}</span>
        </div>
      {/each}
    {/if}
  </div>

  <div class="proof-grid">
    <div>
      <span class="k">What this suggests</span>
      <p>{lens.proof.suggests}</p>
    </div>
    <div>
      <span class="k">What this cannot prove</span>
      <p>{lens.proof.cannotProve}</p>
    </div>
  </div>

  {#if lens.canReturnToReplay && onReturnToReplay}
    <button type="button" class="return" onclick={onReturnToReplay}>Return to replay</button>
  {/if}
</section>
```

- [ ] **Step 2: Add component styles**

In the same file, add CSS with stable grids, no nested cards, and mobile wrapping:

```css
<style>
  .report-instrument-lens {
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 24px 0;
    color: var(--fg);
  }
  .lens-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 10px;
  }
  .eyebrow,
  .source,
  .k,
  .section-label,
  .peer-row {
    font-family: var(--mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .eyebrow,
  .k,
  .section-label {
    color: var(--fg-3);
    font-size: 9px;
    font-weight: 700;
  }
  h2 {
    margin: 4px 0 0;
    font-size: clamp(28px, 4vw, 48px);
    font-weight: 200;
    line-height: 1;
  }
  .source {
    color: var(--fg);
    font-size: 10px;
    font-weight: 700;
  }
  .reason {
    margin: 0 0 18px;
    color: var(--fg-2);
    font-size: 14px;
    line-height: 1.45;
  }
  .signal-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    border: 1px solid var(--rule);
    background: var(--rule);
  }
  .signal-grid > div {
    min-width: 0;
    padding: 13px 14px;
    background: var(--bg);
  }
  .v {
    display: block;
    margin-top: 5px;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .peer-field {
    margin-top: 20px;
  }
  .peer-row {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 90px 88px 130px;
    gap: 12px;
    align-items: center;
    min-height: 42px;
    border-bottom: 1px solid var(--rule);
    font-size: 9px;
  }
  .peer-row[data-movement='selected'] { color: var(--station-b); }
  .peer-row[data-movement='co-elevated'] { color: var(--sev-bad); }
  .peer-row[data-movement='wobble'] { color: var(--sev-warn); }
  .name,
  .value,
  .delta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .proof-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px;
    margin-top: 22px;
  }
  .proof-grid p,
  .empty {
    margin: 6px 0 0;
    color: var(--fg-2);
    line-height: 1.45;
    font-size: 14px;
  }
  .return {
    margin-top: 18px;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--fg);
    padding: 10px 13px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }
  @media (max-width: 760px) {
    .lens-head,
    .proof-grid {
      grid-template-columns: 1fr;
      display: grid;
    }
    .signal-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .peer-row {
      grid-template-columns: 32px minmax(0, 1fr) 74px;
    }
    .peer-row .delta,
    .peer-row .movement {
      display: none;
    }
  }
</style>
```

## Task 4: Orbital Scene Selection Markers

**Files:**
- Modify: `src/lib/components/OrbitalScene.svelte`

- [ ] **Step 1: Add exported marker types and props**

In the module script add:

```ts
export interface OrbitalSelectedPulse {
  readonly stationId: string;
  readonly slot: number;
  readonly roundNumber: number | null;
}

export interface OrbitalPeerPulse {
  readonly stationId: string;
  readonly slot: number;
}
```

Add component props:

```ts
selectedPulse?: OrbitalSelectedPulse | null;
peerPulses?: readonly OrbitalPeerPulse[];
selectedAngle?: number | null;
```

- [ ] **Step 2: Render DOM overlays above the canvas**

Use projected screen positions from `screenPositionForPulse` and add an overlay block in the component markup:

```svelte
{#if selectedPulse && selectedPulsePosition}
  <span
    class="selected-pulse-marker"
    style:left="{selectedPulsePosition.x}px"
    style:top="{selectedPulsePosition.y}px"
    aria-hidden="true"
  ></span>
{/if}

{#each peerPulsePositions as peer (`${peer.stationId}-${peer.slot}`)}
  <span
    class="peer-pulse-marker"
    style:left="{peer.x}px"
    style:top="{peer.y}px"
    aria-hidden="true"
  ></span>
{/each}

{#if selectedAngle !== null}
  <span class="selected-angle-guide" style:--selected-angle="{selectedAngle}rad" aria-hidden="true"></span>
{/if}
```

- [ ] **Step 3: Add marker CSS**

Add:

```css
.selected-pulse-marker,
.peer-pulse-marker {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}
.selected-pulse-marker {
  width: 22px;
  height: 22px;
  border: 1px solid var(--fg);
  box-shadow: 0 0 18px color-mix(in srgb, var(--fg) 55%, transparent);
}
.peer-pulse-marker {
  width: 13px;
  height: 13px;
  border: 1px solid var(--station-b);
  opacity: 0.72;
}
.selected-angle-guide {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46%;
  height: 1px;
  z-index: 3;
  transform-origin: left center;
  transform: rotate(var(--selected-angle));
  background: linear-gradient(90deg, color-mix(in srgb, var(--fg) 50%, transparent), transparent);
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .selected-pulse-marker,
  .peer-pulse-marker {
    transition: none;
  }
}
```

- [ ] **Step 4: Run typecheck for orbital prop shape**

Run:

```bash
npm run typecheck
```

Expected: PASS or unrelated existing failures only. Fix any prop/type failures in touched files before continuing.

## Task 5: ReportView Integration

**Files:**
- Modify: `src/lib/components/ReportView.svelte`
- Create/modify indirectly: imports from `ReportInstrumentLens.svelte` and `report-instrument-lens.ts`

- [ ] **Step 1: Import new component and utility**

Add imports:

```ts
import ReportInstrumentLens from './ReportInstrumentLens.svelte';
import {
  buildReportInstrumentLens,
  type ReportLensSource,
} from '$lib/utils/report-instrument-lens';
import type { PulseHover } from './OrbitalScene.svelte';
```

- [ ] **Step 2: Add report selection state**

Add state near `scrubT`:

```ts
let selectionSource = $state<Exclude<ReportLensSource, 'pinned' | 'none'>>('significant');
let clickedPulse = $state<PulseInspection | null>(null);
let didSeedSignificant = $state(false);
```

Add an effect:

```ts
$effect(() => {
  if (didSeedSignificant || isRecording || pinnedPulse || !significantPulse?.roundNumber) return;
  const maxRound = Math.max(1, measurements.roundCounter);
  scrubT = Math.max(0, Math.min(1, significantPulse.roundNumber / maxRound));
  selectionSource = 'significant';
  didSeedSignificant = true;
});
```

- [ ] **Step 3: Build lens derivation**

Add:

```ts
const replaySelectedPulse = $derived(clickedPulse ?? replayFrame.pulse ?? significantPulse);
const reportLens = $derived(buildReportInstrumentLens({
  endpoints: monitored,
  measurements,
  stats,
  thresholdMs: settings.healthThreshold,
  pinnedPulse,
  replayPulse: replaySelectedPulse,
  significantPulse,
  selectionSource,
  windowSlots: WINDOW,
}));
```

Then update existing `reportPulse` and `sampleInspector` to use `reportLens.selected`.

- [ ] **Step 4: Wire scrub and orbital clicks**

In `onRailClick`, after setting `scrubT`, clear clicked state and mark source:

```ts
clickedPulse = null;
selectionSource = 'scrub';
```

Add:

```ts
function inspectReportPulse(pulse: PulseHover): void {
  const evidence = buildPulseInspection({
    source: 'endpoint',
    pulse,
    endpointIdByStation: Object.fromEntries(monitored.slice(0, 4).map((ep, i) => [STATION_IDS[i], ep.id])),
    thresholdMs: settings.healthThreshold,
  });
  clickedPulse = evidence;
  selectionSource = 'clicked';
  if (evidence.roundNumber !== null) {
    scrubT = Math.max(0, Math.min(1, evidence.roundNumber / Math.max(1, measurements.roundCounter)));
  }
}

function returnToReplay(): void {
  uiStore.clearPinnedPulse();
  clickedPulse = null;
  selectionSource = 'scrub';
}
```

- [ ] **Step 5: Mount component and orbital props**

Pass to `OrbitalScene`:

```svelte
onPulseInspect={inspectReportPulse}
selectedPulse={reportLens.orbitalSelection?.selected ?? null}
peerPulses={reportLens.orbitalSelection?.peerPulses ?? []}
selectedAngle={reportLens.orbitalSelection?.angle ?? null}
```

Below station cards and before `SampleInspector`, mount:

```svelte
<ReportInstrumentLens lens={reportLens} onReturnToReplay={returnToReplay} />
```

On station cards add:

```svelte
data-selected={reportLens.selected?.endpointId === row.endpointId ? 'true' : 'false'}
```

Add CSS for selected station card:

```css
.station-card[data-selected='true'] {
  border-color: var(--fg);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--fg) 24%, transparent);
}
```

## Task 6: Visual Tests and Verification

**Files:**
- Modify: `tests/visual/instrument-shell.spec.ts`

- [ ] **Step 1: Update existing report replay test**

Extend `report replay scrub updates the evidence sample and inspector`:

```ts
await expect(page.locator('.report-instrument-lens')).toBeVisible();
await expect(page.locator('.report-instrument-lens')).toContainText('Replay lens');
await expect(page.locator('.report-instrument-lens')).toContainText('Round #36');
await expect(page.locator('.selected-pulse-marker')).toBeVisible();
await expect(page.locator('.selected-angle-guide')).toBeVisible();
```

- [ ] **Step 2: Add pinned return test**

Add:

```ts
test('report lens distinguishes pinned pulse and can return to replay', async ({ page }) => {
  await openInstrument(page, '/report');
  await seedRunningSession(page, { roundCount: 72, stopped: true });
  await pinPulseEvidence(page);

  const lens = page.locator('.report-instrument-lens');
  await expect(lens).toContainText('pinned');
  await expect(lens).toContainText('Pinned pulse carried into the report.');
  await expect(page.locator('.station-card[data-selected="true"]')).toBeVisible();

  await page.getByRole('button', { name: 'Return to replay' }).click();
  await expect(lens).not.toContainText('Pinned pulse carried into the report.');
  await expect(lens).toContainText(/Replay moment|most significant/i);
});
```

- [ ] **Step 3: Add mobile stability assertion**

Extend mobile report coverage or add:

```ts
test('mobile report keeps replay lens readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInstrument(page, '/report');
  await seedRunningSession(page, { roundCount: 72, stopped: true });

  await expect(page.locator('.report-instrument-lens')).toBeVisible();
  await expect(page.locator('.report-instrument-lens .peer-row').first()).toBeVisible();
  expect(await boxesOverlap(page, '.report-instrument-lens', '.scrub')).toBe(false);
});
```

- [ ] **Step 4: Run targeted visual test**

Run:

```bash
npx playwright test tests/visual/instrument-shell.spec.ts
```

Expected: PASS.

## Task 7: Full Verification and Final Commit

**Files:**
- All touched source/test files.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm run lint
npm run test
npx playwright test tests/visual/instrument-shell.spec.ts
```

Expected: all PASS.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff --stat
git diff -- src/lib/utils/report-instrument-lens.ts src/lib/components/ReportInstrumentLens.svelte src/lib/components/OrbitalScene.svelte src/lib/components/ReportView.svelte tests/unit/utils/report-instrument-lens.test.ts tests/visual/instrument-shell.spec.ts
```

Expected: diff only contains report instrument lens changes.

- [ ] **Step 3: Commit remaining implementation**

Run:

```bash
git add src/lib/utils/report-instrument-lens.ts \
  src/lib/components/ReportInstrumentLens.svelte \
  src/lib/components/OrbitalScene.svelte \
  src/lib/components/ReportView.svelte \
  tests/unit/utils/report-instrument-lens.test.ts \
  tests/visual/instrument-shell.spec.ts
git commit -m "feat(report): make replay an inspectable instrument"
```

## Self-Review Checklist

- Spec coverage: utility, component, orbital binding, significant startup, scrub/click/pin state, peer movement classes, proof copy, mobile and visual tests all map to tasks above.
- Placeholder scan: no task uses a placeholder token or incomplete instruction.
- Type consistency: `ReportLensSource`, `ReportPeerMovement`, `ReportInstrumentLens`, `selectedPulse`, `peerPulses`, and `selectedAngle` names are consistent across tasks.
