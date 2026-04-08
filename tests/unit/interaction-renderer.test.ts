import { describe, it, expect, beforeEach } from 'vitest';
import { InteractionRenderer } from '../../src/lib/renderers/interaction-renderer';
import type { HoverTarget } from '../../src/lib/types';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  return canvas;
}

function makeHoverTarget(overrides: Partial<HoverTarget> = {}): HoverTarget {
  return {
    endpointId: 'ep1',
    roundId: 5,
    x: 200,
    y: 150,
    latency: 80,
    status: 'ok',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('InteractionRenderer', () => {
  let canvas: HTMLCanvasElement;
  let renderer: InteractionRenderer;

  beforeEach(() => {
    canvas = makeCanvas();
    renderer = new InteractionRenderer(canvas);
  });

  it('constructs without throwing', () => {
    expect(() => new InteractionRenderer(canvas)).not.toThrow();
  });

  it('clear does not throw', () => {
    expect(() => renderer.clear()).not.toThrow();
  });

  it('drawHover does not throw', () => {
    expect(() => renderer.drawHover(makeHoverTarget())).not.toThrow();
  });

  it('drawHover with showCrosshairs=true does not throw', () => {
    expect(() => renderer.drawHover(makeHoverTarget(), true)).not.toThrow();
  });

  it('drawHover with showCrosshairs=false does not throw', () => {
    expect(() => renderer.drawHover(makeHoverTarget(), false)).not.toThrow();
  });

  it('drawSelection does not throw', () => {
    expect(() => renderer.drawSelection(makeHoverTarget())).not.toThrow();
  });

  it('drawHover handles timeout status without throwing', () => {
    expect(() => renderer.drawHover(makeHoverTarget({ status: 'timeout' }))).not.toThrow();
  });

  it('drawHover handles error status without throwing', () => {
    expect(() => renderer.drawHover(makeHoverTarget({ status: 'error' }))).not.toThrow();
  });

  it('clear after drawHover does not throw', () => {
    renderer.drawHover(makeHoverTarget());
    expect(() => renderer.clear()).not.toThrow();
  });
});
