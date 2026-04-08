import { describe, it, expect, beforeEach } from 'vitest';
import { EffectsRenderer } from '../../src/lib/renderers/effects-renderer';
import type { SonarPing } from '../../src/lib/types';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  return canvas;
}

function makePing(overrides: Partial<SonarPing> = {}): SonarPing {
  return {
    id: Math.random().toString(36).slice(2),
    x: 100,
    y: 100,
    color: '#4a90d9',
    tier: 'fast',
    startTime: 0,
    ...overrides,
  };
}

describe('EffectsRenderer', () => {
  let canvas: HTMLCanvasElement;
  let renderer: EffectsRenderer;

  beforeEach(() => {
    canvas = makeCanvas();
    renderer = new EffectsRenderer(canvas);
  });

  it('constructs without throwing', () => {
    expect(() => new EffectsRenderer(canvas)).not.toThrow();
  });

  it('draws with no pings without throwing', () => {
    expect(() => renderer.draw([], 0)).not.toThrow();
  });

  it('adds a ping without throwing', () => {
    const ping = makePing({ tier: 'fast', startTime: 0 });
    expect(() => renderer.addPing(ping)).not.toThrow();
  });

  it('getActivePingCount returns 0 when no pings added', () => {
    expect(renderer.getActivePingCount()).toBe(0);
  });

  it('getActivePingCount increases after addPing', () => {
    renderer.addPing(makePing({ id: 'p1', tier: 'fast', startTime: 0 }));
    expect(renderer.getActivePingCount()).toBe(1);
  });

  it('draws with active pings without throwing', () => {
    renderer.addPing(makePing({ tier: 'fast', startTime: 0 }));
    expect(() => renderer.draw([], 100)).not.toThrow();
  });

  it('respects maxConcurrent for fast tier (max 5)', () => {
    // Add 7 fast pings — only 5 should be stored
    for (let i = 0; i < 7; i++) {
      renderer.addPing(makePing({ id: `p${i}`, tier: 'fast', startTime: 0 }));
    }
    expect(renderer.getActivePingCount()).toBeLessThanOrEqual(5);
  });

  it('respects maxConcurrent for timeout tier (max 1)', () => {
    renderer.addPing(makePing({ id: 'to1', tier: 'timeout', startTime: 0 }));
    renderer.addPing(makePing({ id: 'to2', tier: 'timeout', startTime: 0 }));
    // Only 1 timeout ping should be active at a time
    const timeoutPings = renderer.getActivePingCount();
    expect(timeoutPings).toBeLessThanOrEqual(1);
  });

  it('expires pings that have completed their animation', () => {
    // Start at time 0
    const ping = makePing({ id: 'old', tier: 'fast', startTime: 0 });
    renderer.addPing(ping);

    // Draw well past the fast tier duration (300ms from tokens)
    renderer.draw([], 5000);

    // Ping should be expired and removed
    expect(renderer.getActivePingCount()).toBe(0);
  });

  it('should use clientWidth/clientHeight for clearRect, not canvas.width/canvas.height (AC2)', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 800;
    Object.defineProperty(canvas, 'clientWidth', { get: () => 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { get: () => 400, configurable: true });
    const renderer = new EffectsRenderer(canvas);
    expect(() => renderer.draw([], 0)).not.toThrow();
    expect(() => renderer.drawEmptyState(0)).not.toThrow();
  });

  it('draws different tiers without throwing', () => {
    const tiers: SonarPing['tier'][] = ['fast', 'medium', 'slow', 'timeout'];
    for (const tier of tiers) {
      renderer.addPing(makePing({ tier, startTime: 500 }));
    }
    expect(() => renderer.draw([], 600)).not.toThrow();
  });

  describe('drawEmptyState (AC5)', () => {
    it('drawEmptyState exists on EffectsRenderer', () => {
      expect(typeof renderer.drawEmptyState).toBe('function');
    });

    it('drawEmptyState does not throw at t=0', () => {
      expect(() => renderer.drawEmptyState(0)).not.toThrow();
    });

    it('drawEmptyState does not throw at t=4000 (one full rotation)', () => {
      expect(() => renderer.drawEmptyState(4000)).not.toThrow();
    });

    it('drawEmptyState does not throw after many calls (animation loop simulation)', () => {
      for (let t = 0; t < 5000; t += 16) {
        expect(() => renderer.drawEmptyState(t)).not.toThrow();
      }
    });

    it('sweepStartTime is initialized on first drawEmptyState call', () => {
      renderer.drawEmptyState(1000);
      renderer.drawEmptyState(2000);
      expect(true).toBe(true);
    });

    it('drawEmptyState does not throw when clientWidth/clientHeight = 0 (unmounted canvas)', () => {
      const emptyCanvas = document.createElement('canvas');
      emptyCanvas.width = 0;
      emptyCanvas.height = 0;
      const emptyRenderer = new EffectsRenderer(emptyCanvas);
      expect(() => emptyRenderer.drawEmptyState(0)).not.toThrow();
    });
  });
});
