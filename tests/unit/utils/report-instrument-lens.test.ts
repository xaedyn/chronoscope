import { describe, expect, it } from 'vitest';
import { buildReportInstrumentLens } from '../../../src/lib/utils/report-instrument-lens';
import type {
  Endpoint,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
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

function measurements(states: Record<string, readonly MeasurementSample[]>): MeasurementState {
  return {
    lifecycle: 'completed',
    epoch: 1,
    roundCounter: 12,
    startedAt: 1_700_000_000_000,
    stoppedAt: 1_700_000_012_000,
    freezeEvents: [],
    errorCount: 0,
    timeoutCount: 0,
    endpoints: Object.fromEntries(
      Object.entries(states).map(([id, samples]) => {
        const last = samples.at(-1) ?? null;
        return [id, {
          endpointId: id,
          tierLevel: 1,
          lastLatency: last?.status === 'ok' ? last.latency : null,
          lastStatus: last?.status ?? null,
          lastErrorMessage: null,
          samples,
        }];
      }),
    ),
  } as unknown as MeasurementState;
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
    drift: 80,
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

describe('buildReportInstrumentLens', () => {
  it('uses the replay pulse when there is no pinned pulse', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({
        alpha: [ok(9, 100), ok(10, 180)],
        bravo: [ok(9, 88), ok(10, 91)],
      }),
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
    expect(lens.orbitalSelection?.peerPulses).toEqual([{ stationId: 'A', slot: 359 }]);
  });

  it('lets a pinned pulse override replay evidence', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({
        alpha: [ok(9, 100), ok(10, 180)],
        bravo: [ok(9, 100), ok(10, 190)],
      }),
      thresholdMs: 120,
      pinnedPulse: pulse({
        stationId: 'B',
        endpointId: 'bravo',
        endpointLabel: 'Bravo',
        latency: 190,
        thresholdDelta: 70,
      }),
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
      thresholdMs: 120,
      pinnedPulse: null,
      replayPulse: pulse({ slot: 359 }),
      significantPulse: pulse({ slot: 120 }),
      selectionSource: 'significant',
      windowSlots: 360,
    });

    expect(lens.source).toBe('significant');
    expect(lens.selectionReason).toContain('most significant');
    expect(lens.orbitalSelection?.selected.slot).toBe(359);
  });

  it('does not jump back to the significant pulse when the scrubbed round has no sample', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({ alpha: [ok(9, 100), ok(10, 180)] }),
      thresholdMs: 120,
      pinnedPulse: null,
      replayPulse: null,
      significantPulse: pulse({ slot: 120 }),
      selectionSource: 'scrub',
      windowSlots: 360,
    });

    expect(lens.source).toBe('none');
    expect(lens.selected).toBeNull();
    expect(lens.orbitalSelection).toBeNull();
    expect(lens.selectionReason).toContain('No replay sample');
  });

  it('computes exact peer marker slots from each endpoint sample buffer', () => {
    const lens = buildReportInstrumentLens({
      endpoints,
      measurements: measurements({
        alpha: [ok(9, 100), ok(10, 180)],
        bravo: [ok(8, 100), ok(9, 110), ok(10, 160)],
      }),
      thresholdMs: 120,
      pinnedPulse: null,
      replayPulse: pulse({ slot: 358 }),
      significantPulse: null,
      selectionSource: 'scrub',
      windowSlots: 360,
    });

    expect(lens.orbitalSelection?.selected.slot).toBe(359);
    expect(lens.orbitalSelection?.peerPulses).toEqual([
      { stationId: 'A', slot: 359 },
      { stationId: 'B', slot: 359 },
    ]);
  });
});
