import { describe, expect, it } from 'vitest';
import { buildReportReplayFrame } from '../../../src/lib/utils/report-replay';
import type { Endpoint, MeasurementState } from '../../../src/lib/types';

const endpoints: Endpoint[] = [
  {
    id: 'api',
    label: 'API',
    url: 'https://api.example.com',
    enabled: true,
    color: '#67e8f9',
  },
  {
    id: 'cdn',
    label: 'CDN',
    url: 'https://cdn.example.com',
    enabled: true,
    color: '#a78bfa',
  },
];

function state(): MeasurementState {
  return {
    lifecycle: 'completed',
    epoch: 1,
    roundCounter: 4,
    startedAt: 1778352000000,
    stoppedAt: 1778352004000,
    freezeEvents: [],
    errorCount: 0,
    timeoutCount: 0,
    endpoints: {
      api: {
        endpointId: 'api',
        tierLevel: 1,
        lastLatency: 88,
        lastStatus: 'ok',
        lastErrorMessage: null,
        samples: [
          { round: 1, latency: 80, status: 'ok', timestamp: 1778352001000 },
          { round: 2, latency: 142, status: 'ok', timestamp: 1778352002000 },
          { round: 3, latency: 90, status: 'ok', timestamp: 1778352003000 },
          { round: 4, latency: 88, status: 'ok', timestamp: 1778352004000 },
        ],
      },
      cdn: {
        endpointId: 'cdn',
        tierLevel: 1,
        lastLatency: 180,
        lastStatus: 'ok',
        lastErrorMessage: null,
        samples: [
          { round: 1, latency: 84, status: 'ok', timestamp: 1778352001000 },
          { round: 2, latency: 92, status: 'ok', timestamp: 1778352002000 },
          { round: 3, latency: 96, status: 'ok', timestamp: 1778352003000 },
          { round: 4, latency: 180, status: 'ok', timestamp: 1778352004000 },
        ],
      },
    },
  } as unknown as MeasurementState;
}

describe('report replay frame', () => {
  it('maps scrub progress to a real round and packs only samples through that round', () => {
    const frame = buildReportReplayFrame({
      endpoints,
      measurements: state(),
      thresholdMs: 120,
      progress: 0.5,
      windowSlots: 6,
      capturedAt: 1778352005000,
    });

    expect(frame.targetRound).toBe(2);
    expect(frame.roundLabel).toBe('2 / 4');
    expect(frame.stationData.A).toEqual([null, null, null, null, 80, 142]);
    expect(frame.stationData.B).toEqual([null, null, null, null, 84, 92]);
    expect(frame.pulse).toMatchObject({
      source: 'endpoint',
      stationId: 'A',
      endpointId: 'api',
      endpointLabel: 'API',
      slot: 5,
      roundNumber: 2,
      latency: 142,
      drift: 62,
      thresholdDelta: 22,
    });
  });

  it('selects the current round sample instead of keeping an earlier spike pinned to replay', () => {
    const frame = buildReportReplayFrame({
      endpoints,
      measurements: state(),
      thresholdMs: 120,
      progress: 1,
      windowSlots: 6,
    });

    expect(frame.targetRound).toBe(4);
    expect(frame.pulse).toMatchObject({
      stationId: 'B',
      endpointId: 'cdn',
      roundNumber: 4,
      latency: 180,
      thresholdDelta: 60,
    });
  });

  it('uses the latest recorded sample when live roundCounter has advanced ahead of samples', () => {
    const live = state();
    live.lifecycle = 'running';
    live.roundCounter = 9;
    live.stoppedAt = null;

    const frame = buildReportReplayFrame({
      endpoints,
      measurements: live,
      thresholdMs: 120,
      progress: 1,
      windowSlots: 6,
    });

    expect(frame.targetRound).toBe(4);
    expect(frame.roundLabel).toBe('4 / 4');
    expect(frame.pulse).toMatchObject({
      stationId: 'B',
      endpointId: 'cdn',
      roundNumber: 4,
      latency: 180,
    });
  });

  it('packs dense buffers with the same slot mapping used by selected pulses', () => {
    const dense = state();
    dense.roundCounter = 8;
    const api = dense.endpoints.api;
    if (api) {
      api.samples = Array.from({ length: 8 }, (_, index) => ({
        round: index + 1,
        latency: (index + 1) * 10,
        status: 'ok',
        timestamp: 1778352000000 + (index + 1) * 1000,
      })) as never;
      api.lastLatency = 80;
    }

    const frame = buildReportReplayFrame({
      endpoints: endpoints.slice(0, 1),
      measurements: dense,
      thresholdMs: 50,
      progress: 1,
      windowSlots: 4,
    });

    expect(frame.stationData.A).toEqual([20, 40, 60, 80]);
    expect(frame.pulse).toMatchObject({
      slot: 3,
      roundNumber: 8,
      latency: 80,
    });
  });

  it('ignores non-finite sample rounds when sizing replay progress', () => {
    const corrupted = state();
    const api = corrupted.endpoints.api;
    if (api) {
      api.samples = [
        { round: Number.NaN, latency: 999, status: 'ok', timestamp: 1778352000000 },
        ...api.samples,
      ] as never;
    }

    const frame = buildReportReplayFrame({
      endpoints,
      measurements: corrupted,
      thresholdMs: 120,
      progress: 1,
      windowSlots: 6,
    });

    expect(frame.targetRound).toBe(4);
    expect(frame.roundLabel).toBe('4 / 4');
  });
});
