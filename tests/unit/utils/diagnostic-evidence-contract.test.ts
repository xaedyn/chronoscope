import { describe, expect, it } from 'vitest';
import { buildDiagnosticReport } from '../../../src/lib/utils/diagnostic-report';
import {
  buildDiagnosticEvidenceContract,
  type DiagnosticEvidenceContract,
} from '../../../src/lib/utils/diagnostic-evidence-contract';
import type {
  Endpoint,
  EndpointStatistics,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
  SampleBuffer,
} from '../../../src/lib/types';
import { DEFAULT_SETTINGS } from '../../../src/lib/types';

function endpoint(id: string, label: string): Endpoint {
  return {
    id,
    label,
    url: `https://${id}.example.test`,
    enabled: true,
    color: '#67e8f9',
  };
}

function stats(endpointId: string, p50 = 40, p95 = 80): EndpointStatistics {
  return {
    endpointId,
    sampleCount: 60,
    p50,
    p95,
    p99: p95,
    p25: Math.max(0, p50 - 8),
    p75: p50 + 8,
    p90: p95,
    min: Math.max(0, p50 - 12),
    max: p95,
    stddev: Math.max(1, (p95 - p50) / 2),
    ci95: { lower: p50 - 3, upper: p50 + 3, margin: 3 },
    connectionReuseDelta: null,
    lossPercent: 0,
    ready: true,
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

function buffer(samples: readonly MeasurementSample[]): SampleBuffer {
  return {
    length: samples.length,
    tailIndex: samples.length,
    at: (index: number) => samples[index],
    filter: samples.filter.bind(samples),
    map: samples.map.bind(samples),
    find: samples.find.bind(samples),
    reduce: samples.reduce.bind(samples) as SampleBuffer['reduce'],
    slice: samples.slice.bind(samples),
    forEach: samples.forEach.bind(samples),
    toArray: () => [...samples],
    [Symbol.iterator]: samples[Symbol.iterator].bind(samples),
  } as SampleBuffer;
}

function measurementState(samplesByEndpoint: Record<string, readonly MeasurementSample[]>): MeasurementState {
  return {
    lifecycle: 'completed',
    epoch: 1,
    roundCounter: 60,
    startedAt: 1_700_000_000_000,
    stoppedAt: 1_700_000_060_000,
    freezeEvents: [],
    errorCount: 0,
    timeoutCount: 0,
    endpoints: Object.fromEntries(
      Object.entries(samplesByEndpoint).map(([endpointId, samples]) => {
        const last = samples.at(-1) ?? null;
        return [endpointId, {
          endpointId,
          samples: buffer(samples),
          lastLatency: last?.status === 'ok' ? last.latency : null,
          lastStatus: last?.status ?? null,
          lastErrorMessage: null,
          tierLevel: 1,
        }];
      }),
    ),
  };
}

function pulse(overrides: Partial<PulseInspection> = {}): PulseInspection {
  return {
    source: 'endpoint',
    stationId: 'C',
    endpointId: 'aws',
    endpointLabel: 'AWS',
    slot: 300,
    roundNumber: 54,
    latency: 205,
    drift: 167,
    thresholdMs: 120,
    thresholdDelta: 85,
    timeLabel: 'T+53s',
    capturedAt: 1_700_000_060_000,
    ...overrides,
  };
}

function contractFor(
  samplesByEndpoint: Record<string, readonly MeasurementSample[]>,
  significantPulse: PulseInspection | null = null,
): DiagnosticEvidenceContract {
  const endpoints = [
    endpoint('google', 'Google'),
    endpoint('edge', 'Edge'),
    endpoint('aws', 'AWS'),
  ];
  const measurements = measurementState(samplesByEndpoint);
  const report = buildDiagnosticReport({
    endpoints,
    stats: {
      google: stats('google', 35, 75),
      edge: stats('edge', 40, 82),
      aws: stats('aws', 45, 108),
    },
    measurements,
    settings: { ...DEFAULT_SETTINGS, healthThreshold: 120 },
    context: null,
  });

  return buildDiagnosticEvidenceContract({
    report,
    endpoints,
    measurements,
    thresholdMs: 120,
    significantPulse,
  });
}

describe('buildDiagnosticEvidenceContract', () => {
  it('splits current health from a historical threshold spike', () => {
    const contract = contractFor({
      google: [ok(53, 36), ok(54, 38), ok(60, 35)],
      edge: [ok(53, 42), ok(54, 44), ok(60, 40)],
      aws: [ok(53, 38), ok(54, 205), ok(60, 45)],
    }, pulse());

    expect(contract.current.headline).toBe('Current status: healthy');
    expect(contract.notableEvent?.roundLabel).toBe('Round #54');
    expect(contract.notableEvent?.kind).toBe('threshold');
    expect(contract.overview.notableLine).toContain('AWS crossed the trigger by 85 ms');
    expect(contract.report.headline).toContain('currently healthy');
    expect(contract.report.headline).toContain('AWS spiked');
  });

  it('can promote timeout samples to the notable event', () => {
    const contract = contractFor({
      google: [ok(1, 35), ok(2, 36), ok(3, 35)],
      edge: [ok(1, 40), timeout(2), ok(3, 40)],
      aws: [ok(1, 45), ok(2, 46), ok(3, 45)],
    });

    expect(contract.notableEvent?.kind).toBe('failure');
    expect(contract.notableEvent?.endpointLabel).toBe('Edge');
    expect(contract.live.eventLine).toContain('Edge returned timeout');
  });

  it('uses large below-threshold drift as a watch event', () => {
    const contract = contractFor({
      google: [ok(1, 35), ok(2, 36), ok(3, 35)],
      edge: [ok(1, 40), ok(2, 82), ok(3, 42)],
      aws: [ok(1, 45), ok(2, 46), ok(3, 45)],
    });

    expect(contract.notableEvent?.kind).toBe('drift');
    expect(contract.notableEvent?.tone).toBe('watch');
    expect(contract.investigate.hypothesis).toContain('jitter');
  });

  it('falls back to current-only copy when there is no notable event', () => {
    const contract = contractFor({
      google: [ok(1, 35), ok(2, 36), ok(3, 35)],
      edge: [ok(1, 40), ok(2, 41), ok(3, 40)],
      aws: [ok(1, 45), ok(2, 46), ok(3, 45)],
    });

    expect(contract.notableEvent).toBeNull();
    expect(contract.overview.notableLine).toBe('No notable threshold event detected in this window.');
    expect(contract.report.headline).toBe(contract.current.detail);
  });
});
