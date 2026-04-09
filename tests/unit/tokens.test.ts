import { describe, it, expect } from 'vitest';
import { tokens } from '../../src/lib/tokens';

describe('tokens', () => {
  it('exposes all required surface tokens', () => {
    expect(tokens.color.surface.base).toBe('#080c16');
    expect(tokens.color.surface.raised).toBe('#0d1425');
    expect(tokens.color.surface.overlay).toBe('#131b33');
    expect(tokens.color.surface.elevated).toBe('#1a2340');
    expect(tokens.color.surface.canvas).toBe('#0a0e1a');
  });

  it('exposes all latency tokens', () => {
    const latency = tokens.color.latency;
    expect(latency.excellent).toBe('#00b4d8');
    expect(latency.fast).toBe('#0096c7');
    expect(latency.good).toBe('#0077b6');
    expect(latency.moderate).toBe('#90be6d');
    expect(latency.elevated).toBe('#f9c74f');
    expect(latency.slow).toBe('#f8961e');
    expect(latency.critical).toBe('#f3722c');
    expect(latency.failing).toBe('#f94144');
  });

  it('exposes all spacing tokens as numbers (px)', () => {
    expect(tokens.spacing.xxs).toBe(2);
    expect(tokens.spacing.xs).toBe(4);
    expect(tokens.spacing.sm).toBe(8);
    expect(tokens.spacing.md).toBe(12);
    expect(tokens.spacing.lg).toBe(16);
    expect(tokens.spacing.xl).toBe(24);
    expect(tokens.spacing.xxl).toBe(32);
    expect(tokens.spacing.xxxl).toBe(48);
  });

  it('exposes all timing tokens as numbers (ms)', () => {
    expect(tokens.timing.sonarPingFast).toBe(300);
    expect(tokens.timing.sonarPingMedium).toBe(500);
    expect(tokens.timing.sonarPingSlow).toBe(800);
    expect(tokens.timing.sonarPingTimeout).toBe(1200);
    expect(tokens.timing.fadeIn).toBe(200);
    expect(tokens.timing.progressiveDisclosure).toBe(250);
    expect(tokens.timing.domThrottle).toBe(100);
  });

  it('exposes endpoint palette with exactly 10 colors', () => {
    expect(tokens.color.endpoint).toHaveLength(10);
  });

  it('exposes typography tokens', () => {
    expect(tokens.typography.data.fontFamily).toContain('JetBrains Mono');
    expect(tokens.typography.data.fontSize).toBe(13);
    expect(tokens.typography.label.fontSize).toBe(11);
    expect(tokens.typography.stat.fontSize).toBe(28);
  });

  it('exposes utility rgba tokens for canvas rendering', () => {
    expect(tokens.color.util.blackOverlay40).toBe('rgba(0,0,0,0.4)');
    expect(tokens.color.util.whiteHighlight80).toBe('rgba(255,255,255,0.8)');
  });

  it('exposes easing function tokens', () => {
    expect(typeof tokens.easingFn.decelerate).toBe('function');
    expect(tokens.easingFn.decelerate(0)).toBe(0);
    expect(tokens.easingFn.decelerate(1)).toBe(1);
  });

  it('exposes canvas config tokens', () => {
    expect(tokens.canvas.pointRadius).toBe(4);
    expect(tokens.canvas.heatmapCellSize).toBe(8);
    expect(tokens.canvas.sonarPing.fast.finalRadius).toBe(12);
    expect(tokens.canvas.sonarPing.timeout.finalRadius).toBe(48);
  });
});

describe('new pipeline tokens', () => {
  it('exposes canvas.ribbon tokens', () => {
    expect(tokens.canvas.ribbon.fillOpacity).toBe(0.15);
    expect(tokens.canvas.ribbon.medianOpacity).toBe(0.6);
    expect(tokens.canvas.ribbon.medianLineWidth).toBe(1.5);
    expect(Array.isArray(tokens.canvas.ribbon.medianLineDash)).toBe(true);
  });

  it('exposes canvas.emptyState tokens', () => {
    expect(tokens.canvas.emptyState.sweepPeriod).toBe(4000);
    expect(tokens.canvas.emptyState.sweepLineOpacity).toBe(0.25);
    expect(tokens.canvas.emptyState.ringOpacity).toBe(0.08);
    expect(tokens.canvas.emptyState.textOpacity).toBe(0.5);
  });

  it('exposes canvas.xAxis tokens', () => {
    expect(tokens.canvas.xAxis.minLabelSpacing).toBe(60);
    expect(tokens.canvas.xAxis.labelOffsetY).toBe(4);
    expect(tokens.canvas.xAxis.paddingBottom).toBe(32);
  });

  it('exposes canvas.yAxis tokens', () => {
    expect(tokens.canvas.yAxis.rollingWindowSize).toBe(20);
    expect(tokens.canvas.yAxis.percentileClampLow).toBe(2);
    expect(tokens.canvas.yAxis.percentileClampHigh).toBe(98);
    expect(tokens.canvas.yAxis.logScaleThreshold).toBe(50);
  });
});
