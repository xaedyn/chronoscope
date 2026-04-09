// tests/unit/components/summary-card.test.ts
// Tests the statistics/ready gate logic that SummaryCard relies on.
// Tests computeEndpointStatistics integration — ready flag, connection reuse delta.

import { describe, it, expect } from 'vitest';
import { computeEndpointStatistics } from '../../../src/lib/utils/statistics';
import type { MeasurementSample, TimingPayload } from '../../../src/lib/types';

function makeSamples(latencies: number[]): MeasurementSample[] {
  return latencies.map((latency, i) => ({
    round: i + 1,
    latency,
    status: 'ok' as const,
    timestamp: Date.now() + i * 1000,
  }));
}

function makeTier2Sample(
  round: number,
  latency: number,
  tier2: Partial<TimingPayload>
): MeasurementSample {
  const fullTier2: TimingPayload = {
    total: latency,
    dnsLookup: 0,
    tcpConnect: 0,
    tlsHandshake: 0,
    ttfb: latency,
    contentTransfer: 0,
    ...tier2,
  };
  return {
    round,
    latency,
    status: 'ok',
    timestamp: Date.now() + round * 1000,
    tier2: fullTier2,
  };
}

describe('SummaryCard statistics / ready gate', () => {

  // ── ready flag ─────────────────────────────────────────────────────────────

  it('ready is false with 0 samples', () => {
    const stats = computeEndpointStatistics('ep1', []);
    expect(stats.ready).toBe(false);
  });

  it('ready is false with 29 samples', () => {
    const stats = computeEndpointStatistics('ep1', makeSamples(Array(29).fill(100)));
    expect(stats.ready).toBe(false);
  });

  it('ready is true with exactly 30 samples', () => {
    const stats = computeEndpointStatistics('ep1', makeSamples(Array(30).fill(100)));
    expect(stats.ready).toBe(true);
  });

  it('ready is true with more than 30 samples', () => {
    const stats = computeEndpointStatistics('ep1', makeSamples(Array(50).fill(100)));
    expect(stats.ready).toBe(true);
  });

  // ── p-value correctness ────────────────────────────────────────────────────

  it('p50 is median of sample latencies', () => {
    const latencies = Array.from({ length: 30 }, (_, i) => i + 1);
    const stats = computeEndpointStatistics('ep1', makeSamples(latencies));
    // p50 of [1..30] = ceiling(0.5 * 30) = 15th element = 15
    expect(stats.p50).toBe(15);
  });

  it('p95 is near the high end', () => {
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = computeEndpointStatistics('ep1', makeSamples(latencies));
    expect(stats.p95).toBeGreaterThanOrEqual(94);
    expect(stats.p95).toBeLessThanOrEqual(100);
  });

  it('min and max are correct', () => {
    const stats = computeEndpointStatistics('ep1', makeSamples([10, 50, 200, 5, 100]));
    expect(stats.min).toBe(5);
    expect(stats.max).toBe(200);
  });

  // ── connection reuse delta ─────────────────────────────────────────────────

  it('connectionReuseDelta is null when no tier2 data', () => {
    const stats = computeEndpointStatistics('ep1', makeSamples([100, 80, 90]));
    expect(stats.connectionReuseDelta).toBeNull();
  });

  it('connectionReuseDelta is null with only one tier2 sample', () => {
    const samples = [makeTier2Sample(1, 150, { tcpConnect: 30, tlsHandshake: 20 })];
    const stats = computeEndpointStatistics('ep1', samples);
    expect(stats.connectionReuseDelta).toBeNull();
  });

  it('connectionReuseDelta computes cold minus warm average', () => {
    // Cold sample: high latency with TCP + TLS overhead
    // Warm samples: lower latency, no TCP/TLS
    const samples: MeasurementSample[] = [
      makeTier2Sample(1, 200, { tcpConnect: 50, tlsHandshake: 30, ttfb: 120 }),
      makeTier2Sample(2, 80, { tcpConnect: 0, tlsHandshake: 0, ttfb: 80 }),
      makeTier2Sample(3, 90, { tcpConnect: 0, tlsHandshake: 0, ttfb: 90 }),
    ];
    const stats = computeEndpointStatistics('ep1', samples);
    // warmAvg = (80 + 90) / 2 = 85; delta = 200 - 85 = 115
    expect(stats.connectionReuseDelta).toBe(115);
  });

  it('connectionReuseDelta is null when first sample has no cold overhead', () => {
    // First sample has no TCP/TLS = already a warm connection
    const samples: MeasurementSample[] = [
      makeTier2Sample(1, 80, { tcpConnect: 0, tlsHandshake: 0 }),
      makeTier2Sample(2, 80, { tcpConnect: 0, tlsHandshake: 0 }),
    ];
    const stats = computeEndpointStatistics('ep1', samples);
    expect(stats.connectionReuseDelta).toBeNull();
  });

  // ── tier2Averages ──────────────────────────────────────────────────────────

  it('tier2Averages is undefined when no tier2 samples', () => {
    const stats = computeEndpointStatistics('ep1', makeSamples([100, 100]));
    expect(stats.tier2Averages).toBeUndefined();
  });

  it('tier2Averages computes correct field averages', () => {
    const samples: MeasurementSample[] = [
      makeTier2Sample(1, 100, { dnsLookup: 10, tcpConnect: 20 }),
      makeTier2Sample(2, 100, { dnsLookup: 30, tcpConnect: 40 }),
    ];
    const stats = computeEndpointStatistics('ep1', samples);
    expect(stats.tier2Averages?.dnsLookup).toBe(20);
    expect(stats.tier2Averages?.tcpConnect).toBe(30);
  });

  // ── error/timeout samples don't count toward latencies ────────────────────

  it('excludes timeout samples from latency calculations', () => {
    const samples: MeasurementSample[] = [
      ...makeSamples([100]),
      { round: 2, latency: 5000, status: 'timeout', timestamp: Date.now() },
    ];
    const stats = computeEndpointStatistics('ep1', samples);
    // Only the ok sample should factor into p50
    expect(stats.p50).toBe(100);
  });

  it('sampleCount includes all samples (ok + timeout + error)', () => {
    const samples: MeasurementSample[] = [
      ...makeSamples([100]),
      { round: 2, latency: 5000, status: 'timeout', timestamp: Date.now() },
      { round: 3, latency: 0, status: 'error', timestamp: Date.now() },
    ];
    const stats = computeEndpointStatistics('ep1', samples);
    expect(stats.sampleCount).toBe(3);
  });
});
