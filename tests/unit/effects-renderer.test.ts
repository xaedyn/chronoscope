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

  it('draws different tiers without throwing', () => {
    const tiers: SonarPing['tier'][] = ['fast', 'medium', 'slow', 'timeout'];
    for (const tier of tiers) {
      renderer.addPing(makePing({ tier, startTime: 500 }));
    }
    expect(() => renderer.draw([], 600)).not.toThrow();
  });
});
