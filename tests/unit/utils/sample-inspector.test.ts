import { describe, expect, it } from 'vitest';
import { buildSampleInspector } from '../../../src/lib/utils/sample-inspector';
import type { Endpoint, MeasurementState, PulseInspection } from '../../../src/lib/types';

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
  {
    id: 'edge',
    label: 'Edge',
    url: 'https://edge.example.com',
    enabled: true,
    color: '#f59e0b',
  },
];

const evidence: PulseInspection = {
  source: 'endpoint',
  stationId: 'A',
  endpointId: 'api',
  endpointLabel: 'API',
  slot: 5,
  roundNumber: 2,
  latency: 142,
  drift: 62,
  thresholdMs: 120,
  thresholdDelta: 22,
  timeLabel: 'T+00:02',
  capturedAt: 1778352005000,
};

const measurements = {
  lifecycle: 'completed',
  epoch: 1,
  roundCounter: 3,
  startedAt: 1778352000000,
  stoppedAt: 1778352003000,
  freezeEvents: [],
  errorCount: 0,
  timeoutCount: 0,
  endpoints: {
    api: {
      endpointId: 'api',
      tierLevel: 1,
      lastLatency: 91,
      lastStatus: 'ok',
      lastErrorMessage: null,
      samples: [
        { round: 1, latency: 80, status: 'ok', timestamp: 1778352001000 },
        { round: 2, latency: 142, status: 'ok', timestamp: 1778352002000 },
        { round: 3, latency: 91, status: 'ok', timestamp: 1778352003000 },
      ],
    },
    cdn: {
      endpointId: 'cdn',
      tierLevel: 1,
      lastLatency: 131,
      lastStatus: 'ok',
      lastErrorMessage: null,
      samples: [
        { round: 1, latency: 86, status: 'ok', timestamp: 1778352001000 },
        { round: 2, latency: 131, status: 'ok', timestamp: 1778352002000 },
        { round: 3, latency: 90, status: 'ok', timestamp: 1778352003000 },
      ],
    },
    edge: {
      endpointId: 'edge',
      tierLevel: 1,
      lastLatency: 77,
      lastStatus: 'ok',
      lastErrorMessage: null,
      samples: [
        { round: 1, latency: 72, status: 'ok', timestamp: 1778352001000 },
        { round: 2, latency: 77, status: 'ok', timestamp: 1778352002000 },
        { round: 3, latency: 78, status: 'ok', timestamp: 1778352003000 },
      ],
    },
  },
} as unknown as MeasurementState;

describe('sample inspector', () => {
  it('explains a selected sample with neighbor and peer-station context', () => {
    const inspector = buildSampleInspector({
      evidence,
      endpoints,
      measurements,
      thresholdMs: 120,
    });

    expect(inspector).toMatchObject({
      previousLatency: 80,
      nextLatency: 91,
      previousDelta: 62,
      nextDelta: -51,
      peerSampleCount: 3,
      peerOverThresholdCount: 2,
      peerSlowestLabel: 'CDN',
      peerSlowestLatency: 131,
    });
    expect(inspector?.why).toContain('crossed trigger by 22 ms');
    expect(inspector?.why).toContain('1 other station');
  });

  it('returns null when the selected sample cannot be found in the run', () => {
    const inspector = buildSampleInspector({
      evidence: { ...evidence, roundNumber: 99 },
      endpoints,
      measurements,
      thresholdMs: 120,
    });

    expect(inspector).toBeNull();
  });

  it('returns null when the selected sample has non-finite latency', () => {
    const corrupted = {
      ...measurements,
      endpoints: {
        ...measurements.endpoints,
        api: {
          ...measurements.endpoints.api,
          samples: [
            { round: 1, latency: 80, status: 'ok', timestamp: 1778352001000 },
            { round: 2, latency: Number.NaN, status: 'ok', timestamp: 1778352002000 },
          ],
        },
      },
    } as unknown as MeasurementState;

    const inspector = buildSampleInspector({
      evidence,
      endpoints,
      measurements: corrupted,
      thresholdMs: 120,
    });

    expect(inspector).toBeNull();
  });

  it('ignores peer samples with non-finite latency', () => {
    const corrupted = {
      ...measurements,
      endpoints: {
        ...measurements.endpoints,
        cdn: {
          ...measurements.endpoints.cdn,
          samples: [
            { round: 1, latency: 86, status: 'ok', timestamp: 1778352001000 },
            { round: 2, latency: Number.NaN, status: 'ok', timestamp: 1778352002000 },
          ],
        },
      },
    } as unknown as MeasurementState;

    const inspector = buildSampleInspector({
      evidence,
      endpoints,
      measurements: corrupted,
      thresholdMs: 120,
    });

    expect(inspector?.peerSampleCount).toBe(2);
    expect(inspector?.peerOverThresholdCount).toBe(1);
    expect(inspector?.peerSlowestLabel).toBe('Edge');
  });

  it('does not subtract the evidence station from peer counts when it is outside the visible peer set', () => {
    const inspector = buildSampleInspector({
      evidence,
      endpoints: endpoints.slice(1),
      measurements,
      thresholdMs: 120,
    });

    expect(inspector?.peerOverThresholdCount).toBe(1);
    expect(inspector?.why).toContain('1 other station');
  });
});
