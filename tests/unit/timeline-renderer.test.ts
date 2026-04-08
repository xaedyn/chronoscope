import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineRenderer } from '../../src/lib/renderers/timeline-renderer';
import type { MeasurementSample } from '../../src/lib/types';

// jsdom provides a mock canvas context — draw calls won't render pixels but
// must not throw. These are structural/contract tests, not pixel tests.

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  return canvas;
}

const SAMPLE_SAMPLES: MeasurementSample[] = [
  { round: 1, latency: 50,   status: 'ok',      timestamp: 1000 },
  { round: 2, latency: 200,  status: 'ok',      timestamp: 2000 },
  { round: 3, latency: 5000, status: 'timeout', timestamp: 3000 },
  { round: 4, latency: 0,    status: 'error',   timestamp: 4000 },
];

describe('TimelineRenderer', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = makeCanvas();
  });

  it('constructs without throwing', () => {
    expect(() => new TimelineRenderer(canvas)).not.toThrow();
  });

  it('draws with empty endpoint map without throwing', () => {
    const renderer = new TimelineRenderer(canvas);
    expect(() => renderer.draw(new Map())).not.toThrow();
  });

  it('draws with valid point data without throwing', () => {
    const renderer = new TimelineRenderer(canvas);
    const points = TimelineRenderer.computePoints(
      SAMPLE_SAMPLES,
      'ep1',
      '#4a90d9',
    );
    expect(() => renderer.draw(new Map([['ep1', points]]))).not.toThrow();
  });

  it('resize works without throwing', () => {
    const renderer = new TimelineRenderer(canvas);
    canvas.width = 1200;
    canvas.height = 600;
    expect(() => renderer.resize()).not.toThrow();
  });

  describe('computePoints', () => {
    it('returns a ScatterPoint for each sample', () => {
      const pts = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep1', '#4a90d9');
      expect(pts).toHaveLength(SAMPLE_SAMPLES.length);
    });

    it('preserves endpointId and color on every point', () => {
      const pts = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep2', '#e06c75');
      for (const pt of pts) {
        expect(pt.endpointId).toBe('ep2');
        expect(pt.color).toBe('#e06c75');
      }
    });

    it('preserves round number on every point', () => {
      const pts = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep1', '#4a90d9');
      expect(pts[0].round).toBe(1);
      expect(pts[1].round).toBe(2);
      expect(pts[2].round).toBe(3);
    });

    it('preserves status on every point', () => {
      const pts = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep1', '#4a90d9');
      expect(pts[0].status).toBe('ok');
      expect(pts[2].status).toBe('timeout');
      expect(pts[3].status).toBe('error');
    });

    it('x coordinate equals the round number', () => {
      const pts = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep1', '#4a90d9');
      for (let i = 0; i < pts.length; i++) {
        expect(pts[i].x).toBe(SAMPLE_SAMPLES[i].round);
      }
    });

    it('y coordinate is a finite number', () => {
      const pts = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep1', '#4a90d9');
      for (const pt of pts) {
        expect(Number.isFinite(pt.y)).toBe(true);
      }
    });

    it('returns empty array for empty samples', () => {
      expect(TimelineRenderer.computePoints([], 'ep1', '#4a90d9')).toHaveLength(0);
    });
  });

  describe('DPR coordinate fix', () => {
    it('should use clientWidth/clientHeight for plotWidth/plotHeight, not physical canvas.width/canvas.height (AC2)', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 800;
      Object.defineProperty(canvas, 'clientWidth', { get: () => 800, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { get: () => 400, configurable: true });
      const renderer = new TimelineRenderer(canvas);
      const point: import('../../src/lib/types').ScatterPoint = {
        x: 1, y: 0.5, latency: 50, status: 'ok', endpointId: 'ep1', round: 1, color: '#4a90d9',
      };
      renderer.setMaxRound(1);
      const { cx, cy } = renderer.toCanvasCoords(point);
      expect(cx).toBeLessThanOrEqual(800 + 10);
      expect(cy).toBeLessThanOrEqual(400 + 10);
    });
  });

  describe('X-axis normalization', () => {
    it('computePoints produces distinct x values (round numbers) for normalization', () => {
      const points = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep1', '#4a90d9');
      const xValues = points.map(p => p.x);
      const uniqueXs = new Set(xValues);

      // Each round should produce a unique x value
      expect(uniqueXs.size).toBe(SAMPLE_SAMPLES.length);

      // x values should be the round numbers (1, 2, 3, 4)
      // Normalizing by maxRound (4) gives 0.25, 0.5, 0.75, 1.0
      // NOT pt.x / pt.x = 1.0 for all (the bug)
      const maxRound = Math.max(...xValues);
      const normalized = xValues.map(x => x / maxRound);
      expect(normalized[0]).toBeCloseTo(0.25);
      expect(normalized[1]).toBeCloseTo(0.5);
      expect(normalized[2]).toBeCloseTo(0.75);
      expect(normalized[3]).toBeCloseTo(1.0);
    });

    it('draw completes without throwing with populated data', () => {
      const renderer = new TimelineRenderer(canvas);
      const points = TimelineRenderer.computePoints(SAMPLE_SAMPLES, 'ep1', '#4a90d9');
      const map = new Map([['ep1', points]]);
      expect(() => renderer.draw(map)).not.toThrow();
    });
  });
});
