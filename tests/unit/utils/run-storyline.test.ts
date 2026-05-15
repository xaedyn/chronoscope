import { describe, expect, it } from 'vitest';
import { buildRunStoryline } from '../../../src/lib/utils/run-storyline';
import type { Endpoint, MeasurementSample, SampleStatus } from '../../../src/lib/types';

const BASE = 1_765_000_000_000;

function endpoint(id: string, label = id): Endpoint {
  return {
    id,
    label,
    url: `https://${id}.example.com/health`,
    enabled: true,
    color: '#67e8f9',
  };
}

function sample(round: number, latency: number, over: Partial<MeasurementSample> = {}): MeasurementSample {
  return {
    round,
    latency,
    status: 'ok',
    timestamp: BASE + round * 1000,
    ...over,
  };
}

function series(
  latencies: readonly number[],
  statusFor: (index: number) => SampleStatus = (_index: number) => 'ok',
): MeasurementSample[] {
  return latencies.map((latency, index) => sample(index + 1, latency, { status: statusFor(index) }));
}

describe('run storyline derivation', () => {
  it('stays in collecting state until at least one endpoint has eight samples', () => {
    const result = buildRunStoryline({
      endpoints: [endpoint('google', 'Google')],
      samplesByEndpoint: { google: series([40, 41, 42, 40, 41, 42, 40]) },
      threshold: 120,
      runStart: BASE,
    });

    expect(result.confidence).toBe('collecting');
    expect(result.summary).toContain('Collecting enough samples');
    expect(result.markers).toEqual([]);
  });

  it('summarizes a clean multi-endpoint run as steady', () => {
    const result = buildRunStoryline({
      endpoints: [endpoint('google', 'Google'), endpoint('aws', 'AWS')],
      samplesByEndpoint: {
        google: series(Array.from({ length: 16 }, () => 42)),
        aws: series(Array.from({ length: 16 }, () => 55)),
      },
      threshold: 120,
      runStart: BASE,
    });

    expect(result.confidence).toBe('medium');
    expect(result.summary).toBe('No meaningful changes in the current window.');
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]?.kind).toBe('steady');
    expect(result.markers).toEqual([]);
  });

  it('detects an isolated slowdown only when other ready endpoints stayed normal in the same window', () => {
    const result = buildRunStoryline({
      endpoints: [endpoint('google', 'Google'), endpoint('aws', 'AWS')],
      samplesByEndpoint: {
        google: series(Array.from({ length: 20 }, () => 45)),
        aws: series([
          ...Array.from({ length: 16 }, () => 50),
          180,
          185,
          190,
          188,
        ]),
      },
      threshold: 120,
      runStart: BASE,
    });

    expect(result.summary).toBe('AWS slowed briefly; the other paths stayed clean.');
    expect(result.markers.some((marker) => marker.kind === 'slowdown' && marker.endpointId === 'aws')).toBe(true);
    expect(result.phases.some((phase) => phase.kind === 'isolated-slow')).toBe(true);
  });

  it('detects shared slowdown when multiple endpoints cross threshold in the same 15-second window', () => {
    const slowTail = [
      ...Array.from({ length: 16 }, () => 48),
      170,
      172,
      169,
      171,
    ];
    const result = buildRunStoryline({
      endpoints: [endpoint('google', 'Google'), endpoint('cloudflare', 'Cloudflare'), endpoint('aws', 'AWS')],
      samplesByEndpoint: {
        google: series(slowTail),
        cloudflare: series(slowTail.map((latency) => latency + 8)),
        aws: series(Array.from({ length: 20 }, () => 54)),
      },
      threshold: 120,
      runStart: BASE,
    });

    expect(result.summary).toBe('Multiple paths slowed together, then stayed above the trigger.');
    expect(result.markers.filter((marker) => marker.kind === 'slowdown')).toHaveLength(2);
    expect(result.phases.some((phase) => phase.kind === 'shared-slow')).toBe(true);
    expect(result.beats).toEqual([
      expect.objectContaining({
        kind: 'shared-slowdown',
        severity: 'bad',
        label: '2 paths slowed together',
        shortLabel: '2 paths slow',
        endpointIds: ['google', 'cloudflare'],
        markerCount: 2,
      }),
    ]);
  });

  it('uses high confidence only when shared patterns repeat in adjacent 15-second buckets', () => {
    const repeatedShared = [
      ...Array.from({ length: 14 }, () => 48),
      170,
      172,
      169,
      50,
      49,
      48,
      ...Array.from({ length: 8 }, () => 47),
      171,
      173,
      172,
    ];
    const result = buildRunStoryline({
      endpoints: [endpoint('google', 'Google'), endpoint('cloudflare', 'Cloudflare'), endpoint('aws', 'AWS')],
      samplesByEndpoint: {
        google: series(repeatedShared),
        cloudflare: series(repeatedShared.map((latency) => latency + 4)),
        aws: series(repeatedShared.map((latency) => latency + 8)),
      },
      threshold: 120,
      runStart: BASE,
    });

    expect(result.confidence).toBe('high');
  });

  it('treats failed samples as failure evidence, not latency spikes', () => {
    const result = buildRunStoryline({
      endpoints: [endpoint('fastly', 'Fastly'), endpoint('google', 'Google')],
      samplesByEndpoint: {
        fastly: series(Array.from({ length: 16 }, (_, index) => (index === 12 ? 0 : 45)), (index) => (
          index === 12 ? 'timeout' : 'ok'
        )),
        google: series(Array.from({ length: 16 }, () => 44)),
      },
      threshold: 120,
      runStart: BASE,
    });

    expect(result.summary).toBe('Fastly had a failed request; the other paths stayed reachable.');
    expect(result.markers.some((marker) => marker.kind === 'failure' && marker.endpointId === 'fastly')).toBe(true);
    expect(result.markers.some((marker) => marker.kind === 'slowdown')).toBe(false);
    expect(result.beats[0]).toEqual(expect.objectContaining({
      kind: 'failure',
      severity: 'bad',
      label: 'Fastly failed',
      shortLabel: 'Fastly failed',
      endpointIds: ['fastly'],
      evidence: 'Fastly returned a timeout or error sample.',
    }));
  });

  it('adds recovery after a marked problem has three normal samples', () => {
    const result = buildRunStoryline({
      endpoints: [endpoint('aws', 'AWS'), endpoint('google', 'Google')],
      samplesByEndpoint: {
        aws: series([
          ...Array.from({ length: 12 }, () => 50),
          180,
          182,
          181,
          52,
          51,
          50,
        ]),
        google: series(Array.from({ length: 18 }, () => 44)),
      },
      threshold: 120,
      runStart: BASE,
    });

    expect(result.markers.some((marker) => marker.kind === 'recovery' && marker.endpointId === 'aws')).toBe(true);
    expect(result.phases.some((phase) => phase.kind === 'recovered')).toBe(true);
    expect(result.summary).toBe('AWS slowed briefly, then recovered.');
    expect(result.beats.map((beat) => beat.shortLabel)).toEqual(['AWS slow', 'AWS recovered']);
  });

  it('does not promote below-threshold elevated latency to slow wording', () => {
    const result = buildRunStoryline({
      endpoints: [endpoint('aws', 'AWS')],
      samplesByEndpoint: {
        aws: series([
          ...Array.from({ length: 8 }, () => 40),
          120,
          118,
          119,
        ]),
      },
      threshold: 150,
      runStart: BASE,
    });

    expect(result.confidence).toBe('low');
    expect(result.rows[0]?.points.some((point) => point.status === 'elevated')).toBe(true);
    expect(result.markers.some((marker) => marker.kind === 'slowdown')).toBe(false);
    expect(result.summary).toContain('possible brief rise');
    expect(result.summary).not.toMatch(/slowed/i);
  });

  it('prioritizes eventful endpoints before overflow rows', () => {
    const endpoints = [
      endpoint('a', 'A'),
      endpoint('b', 'B'),
      endpoint('c', 'C'),
      endpoint('d', 'D'),
      endpoint('e', 'E'),
      endpoint('f', 'F'),
    ];
    const samplesByEndpoint = Object.fromEntries(endpoints.map((ep) => [
      ep.id,
      series(Array.from({ length: 18 }, () => 40)),
    ]));
    samplesByEndpoint.f = series([
      ...Array.from({ length: 14 }, () => 40),
      180,
      181,
      182,
      183,
    ]);

    const result = buildRunStoryline({
      endpoints,
      samplesByEndpoint,
      threshold: 120,
      runStart: BASE,
      maxVisibleRows: 4,
    });

    expect(result.rows.map((row) => row.endpointId)).toContain('f');
    expect(result.rows).toHaveLength(4);
    expect(result.overflow?.hiddenCount).toBe(2);
    expect(result.overflow?.summary).toContain('more paths');
  });

  it('summarizes hidden slow and failed endpoints by event type', () => {
    const endpoints = [
      endpoint('a', 'A'),
      endpoint('b', 'B'),
      endpoint('c', 'C'),
      endpoint('d', 'D'),
      endpoint('e', 'E'),
      endpoint('f', 'F'),
    ];
    const slow = [
      ...Array.from({ length: 14 }, () => 40),
      180,
      181,
      182,
      183,
    ];
    const samplesByEndpoint = {
      a: series(Array.from({ length: 18 }, (_, index) => (index === 14 ? 0 : 40)), (index) => (
        index === 14 ? 'timeout' : 'ok'
      )),
      b: series(Array.from({ length: 18 }, (_, index) => (index === 14 ? 0 : 40)), (index) => (
        index === 14 ? 'error' : 'ok'
      )),
      c: series(Array.from({ length: 18 }, (_, index) => (index === 14 ? 0 : 40)), (index) => (
        index === 14 ? 'timeout' : 'ok'
      )),
      d: series(Array.from({ length: 18 }, (_, index) => (index === 14 ? 0 : 40)), (index) => (
        index === 14 ? 'error' : 'ok'
      )),
      e: series(Array.from({ length: 18 }, (_, index) => (index === 14 ? 0 : 40)), (index) => (
        index === 14 ? 'timeout' : 'ok'
      )),
      f: series(slow),
    };

    const result = buildRunStoryline({
      endpoints,
      samplesByEndpoint,
      threshold: 120,
      runStart: BASE,
      maxVisibleRows: 4,
    });

    expect(result.rows).toHaveLength(4);
    expect(result.overflow?.summary).toBe('1 more path failed, 1 more path slowed.');
  });
});
