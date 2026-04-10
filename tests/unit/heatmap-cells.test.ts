import { describe, it, expect } from 'vitest';
import { computeHeatmapCells } from '../../src/lib/renderers/timeline-data-pipeline';
import type { MeasurementSample, EndpointStatistics } from '../../src/lib/types';

function makeSamples(count: number, latency = 50, status: 'ok' | 'timeout' | 'error' = 'ok'): MeasurementSample[] {
  return Array.from({ length: count }, (_, i) => ({
    round: i + 1, latency, status, timestamp: 1000 + i * 1000,
  }));
}

function makeStats(overrides: Partial<EndpointStatistics> = {}): EndpointStatistics {
  return {
    endpointId: 'ep1', sampleCount: 10, p25: 30, p50: 50, p75: 80, p90: 100,
    p95: 120, p99: 200, min: 10, max: 500, stddev: 20,
    ci95: { lower: 40, upper: 60, margin: 10 }, connectionReuseDelta: null, ready: true,
    ...overrides,
  };
}

describe('computeHeatmapCells (AC2, AC4)', () => {
  it('returns empty array when samples is empty', () => {
    expect(computeHeatmapCells([], makeStats(), null, '#67e8f9')).toHaveLength(0);
  });
  it('returns one cell per round when totalRounds <= 200', () => {
    expect(computeHeatmapCells(makeSamples(100), makeStats(), null, '#67e8f9')).toHaveLength(100);
  });
  it('caps to 200 cells for 201+ rounds', () => {
    expect(computeHeatmapCells(makeSamples(300), makeStats(), null, '#67e8f9').length).toBeLessThanOrEqual(200);
  });
  it('caps to 200 cells for 1001+ rounds', () => {
    expect(computeHeatmapCells(makeSamples(1001), makeStats(), null, '#67e8f9').length).toBeLessThanOrEqual(200);
  });
  it('worst-value-wins: timeout in bucket', () => {
    const samples = makeSamples(5, 50, 'ok');
    const withTimeout: MeasurementSample[] = [
      ...samples.slice(0, 2),
      { round: 3, latency: 5000, status: 'timeout', timestamp: 3000 },
      ...samples.slice(3),
    ];
    const cells = computeHeatmapCells(withTimeout, makeStats(), null, '#67e8f9');
    expect(cells.find(c => c.startRound === 3)?.worstStatus).toBe('timeout');
  });
  it('cell round numbers are correct', () => {
    const cells = computeHeatmapCells(makeSamples(5), makeStats(), null, '#67e8f9');
    expect(cells[0]?.startRound).toBe(1);
    expect(cells[4]?.endRound).toBe(5);
  });
  it('elapsed times computed from startedAt', () => {
    const cells = computeHeatmapCells(makeSamples(3), makeStats(), 1000, '#67e8f9');
    expect(cells[0]?.startElapsed).toBe(0);
    expect(cells[2]?.endElapsed).toBe(2000);
  });
  it('elapsed is 0 when startedAt is null', () => {
    const cells = computeHeatmapCells(makeSamples(3), makeStats(), null, '#67e8f9');
    expect(cells[0]?.startElapsed).toBe(0);
  });
  it('color is a non-empty string', () => {
    const cells = computeHeatmapCells(
      [{ round: 1, latency: 10, status: 'ok', timestamp: 1000 }],
      makeStats({ p25: 30 }), null, '#67e8f9'
    );
    expect(typeof cells[0]?.color).toBe('string');
    expect(cells[0]?.color.length).toBeGreaterThan(0);
  });
  it('aggregated bucket uses worst (max) latency', () => {
    const samples: MeasurementSample[] = Array.from({ length: 500 }, (_, i) => ({
      round: i + 1, latency: i === 4 ? 999 : 50, status: 'ok', timestamp: 1000 + i * 1000,
    }));
    const cells = computeHeatmapCells(samples, makeStats({ p95: 200 }), null, '#67e8f9');
    expect(cells[0]?.worstLatency).toBe(999);
  });
});
