import { describe, expect, it } from 'vitest';
import { buildMostSignificantPulseInspection } from '../../../src/lib/utils/significant-pulse';
import type { Endpoint, MeasurementSample, MeasurementState, SampleBuffer } from '../../../src/lib/types';

const endpoints: Endpoint[] = [
  {
    id: 'ep-1',
    label: 'API',
    url: 'https://api.example.com',
    enabled: true,
    color: '#67e8f9',
  },
  {
    id: 'ep-2',
    label: 'CDN',
    url: 'https://cdn.example.com',
    enabled: true,
    color: '#a78bfa',
  },
];

function sampleBuffer(samples: MeasurementSample[]): SampleBuffer {
  return Object.assign(samples, {
    tailIndex: Math.max(0, samples.length - 1),
    toArray: () => samples,
  }) as SampleBuffer;
}

function measurements(samplesByEndpoint: Record<string, readonly { round: number; latency: number; status: 'ok' | 'error' | 'timeout' }[]>): MeasurementState {
  return {
    lifecycle: 'completed',
    epoch: 1,
    roundCounter: 4,
    endpoints: Object.fromEntries(Object.entries(samplesByEndpoint).map(([endpointId, samples]) => [
      endpointId,
      {
        endpointId,
        samples: sampleBuffer(samples.map((sample) => ({ ...sample, timestamp: 1778352000000 + sample.round * 1000 }))),
        lastLatency: samples.at(-1)?.latency ?? null,
        lastStatus: samples.at(-1)?.status ?? null,
        lastErrorMessage: null,
        tierLevel: 1,
      },
    ])),
    startedAt: 1778352000000,
    stoppedAt: 1778352005000,
    freezeEvents: [],
    errorCount: 0,
    timeoutCount: 0,
  };
}

describe('significant pulse selection', () => {
  it('selects the visible sample with the largest threshold breach', () => {
    const pulse = buildMostSignificantPulseInspection({
      endpoints,
      measurements: measurements({
        'ep-1': [
          { round: 1, latency: 80, status: 'ok' },
          { round: 2, latency: 142, status: 'ok' },
        ],
        'ep-2': [
          { round: 1, latency: 118, status: 'ok' },
          { round: 2, latency: 119, status: 'ok' },
        ],
      }),
      thresholdMs: 120,
      windowSlots: 8,
      capturedAt: 1778352009000,
    });

    expect(pulse).toMatchObject({
      source: 'endpoint',
      stationId: 'A',
      endpointId: 'ep-1',
      endpointLabel: 'API',
      slot: 7,
      roundNumber: 2,
      latency: 142,
      drift: 62,
      thresholdMs: 120,
      thresholdDelta: 22,
      capturedAt: 1778352009000,
    });
  });

  it('falls back to the slowest visible sample when nothing crosses the trigger', () => {
    const pulse = buildMostSignificantPulseInspection({
      endpoints,
      measurements: measurements({
        'ep-1': [{ round: 1, latency: 84, status: 'ok' }],
        'ep-2': [{ round: 2, latency: 101, status: 'ok' }],
      }),
      thresholdMs: 120,
      windowSlots: 8,
    });

    expect(pulse?.endpointLabel).toBe('CDN');
    expect(pulse?.thresholdDelta).toBe(-19);
  });

  it('returns null when no visible ok samples exist', () => {
    const pulse = buildMostSignificantPulseInspection({
      endpoints,
      measurements: measurements({
        'ep-1': [{ round: 1, latency: 5000, status: 'timeout' }],
      }),
      thresholdMs: 120,
      windowSlots: 8,
    });

    expect(pulse).toBeNull();
  });

  it('includes the newest sample when downsampling a dense window', () => {
    const samples = Array.from({ length: 720 }, (_, index) => ({
      round: index + 1,
      latency: index === 719 ? 240 : 80,
      status: 'ok' as const,
    }));

    const pulse = buildMostSignificantPulseInspection({
      endpoints: endpoints.slice(0, 1),
      measurements: measurements({ 'ep-1': samples }),
      thresholdMs: 120,
      windowSlots: 360,
    });

    expect(pulse).toMatchObject({
      endpointId: 'ep-1',
      slot: 359,
      roundNumber: 720,
      latency: 240,
      thresholdDelta: 120,
    });
  });

  it('keeps candidate ordering stable when a corrupt sample has a non-finite round', () => {
    const corrupted = measurements({
      'ep-1': [
        { round: Number.NaN, latency: 160, status: 'ok' },
      ],
    });

    const pulse = buildMostSignificantPulseInspection({
      endpoints,
      measurements: corrupted,
      thresholdMs: 120,
      windowSlots: 8,
    });

    expect(pulse).toMatchObject({
      endpointId: 'ep-1',
      roundNumber: null,
      thresholdDelta: 40,
    });
  });
});
