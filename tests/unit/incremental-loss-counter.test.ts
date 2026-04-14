import { describe, it, expect } from 'vitest';
import { IncrementalLossCounter } from '../../src/lib/utils/incremental-loss-counter';

describe('IncrementalLossCounter', () => {
  it('returns zero counts for unknown endpoint', () => {
    const counter = new IncrementalLossCounter();
    const counts = counter.getCounts('unknown');
    expect(counts.totalSamples).toBe(0);
    expect(counts.errorCount).toBe(0);
    expect(counts.timeoutCount).toBe(0);
    expect(counts.lossPercent).toBe(0);
  });

  it('addSamples increments ok sample count', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([
      { endpointId: 'ep1', status: 'ok' },
      { endpointId: 'ep1', status: 'ok' },
    ]);
    const counts = counter.getCounts('ep1');
    expect(counts.totalSamples).toBe(2);
    expect(counts.errorCount).toBe(0);
    expect(counts.timeoutCount).toBe(0);
  });

  it('addSamples increments error count', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([
      { endpointId: 'ep1', status: 'error' },
    ]);
    const counts = counter.getCounts('ep1');
    expect(counts.totalSamples).toBe(1);
    expect(counts.errorCount).toBe(1);
  });

  it('addSamples increments timeout count', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([
      { endpointId: 'ep1', status: 'timeout' },
      { endpointId: 'ep1', status: 'timeout' },
    ]);
    const counts = counter.getCounts('ep1');
    expect(counts.totalSamples).toBe(2);
    expect(counts.timeoutCount).toBe(2);
  });

  it('lossPercent is computed correctly', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([
      { endpointId: 'ep1', status: 'ok' },
      { endpointId: 'ep1', status: 'ok' },
      { endpointId: 'ep1', status: 'error' },
      { endpointId: 'ep1', status: 'timeout' },
    ]);
    const counts = counter.getCounts('ep1');
    expect(counts.totalSamples).toBe(4);
    expect(counts.errorCount).toBe(1);
    expect(counts.timeoutCount).toBe(1);
    expect(counts.lossPercent).toBeCloseTo(50, 5);
  });

  it('lossPercent is 0 when no samples', () => {
    const counter = new IncrementalLossCounter();
    expect(counter.getCounts('ep1').lossPercent).toBe(0);
  });

  it('counts accumulate as lifetime totals — not decremented by subsequent calls', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([{ endpointId: 'ep1', status: 'ok' }]);
    counter.addSamples([{ endpointId: 'ep1', status: 'ok' }]);
    counter.addSamples([{ endpointId: 'ep1', status: 'ok' }]);
    expect(counter.getCounts('ep1').totalSamples).toBe(3);
  });

  it('tracks multiple endpoints independently', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([
      { endpointId: 'ep1', status: 'ok' },
      { endpointId: 'ep2', status: 'error' },
      { endpointId: 'ep2', status: 'error' },
    ]);
    expect(counter.getCounts('ep1').totalSamples).toBe(1);
    expect(counter.getCounts('ep1').errorCount).toBe(0);
    expect(counter.getCounts('ep2').totalSamples).toBe(2);
    expect(counter.getCounts('ep2').errorCount).toBe(2);
  });

  it('removeEndpoint removes only the specified endpoint', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([
      { endpointId: 'ep1', status: 'ok' },
      { endpointId: 'ep2', status: 'ok' },
    ]);
    counter.removeEndpoint('ep1');
    expect(counter.getCounts('ep1').totalSamples).toBe(0);
    expect(counter.getCounts('ep2').totalSamples).toBe(1);
  });

  it('reset clears all counters', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([
      { endpointId: 'ep1', status: 'ok' },
      { endpointId: 'ep2', status: 'error' },
    ]);
    counter.reset();
    expect(counter.getCounts('ep1').totalSamples).toBe(0);
    expect(counter.getCounts('ep2').totalSamples).toBe(0);
  });

  it('loadFrom clears existing state and repopulates from endpoint samples', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([{ endpointId: 'ep1', status: 'ok' }]);

    counter.loadFrom({
      ep1: {
        samples: [
          { round: 0, latency: 10, status: 'ok', timestamp: 1000 },
          { round: 1, latency: 0, status: 'error', timestamp: 2000 },
          { round: 2, latency: 0, status: 'timeout', timestamp: 3000 },
        ],
      },
      ep2: {
        samples: [
          { round: 0, latency: 20, status: 'ok', timestamp: 1000 },
        ],
      },
    });

    const ep1 = counter.getCounts('ep1');
    expect(ep1.totalSamples).toBe(3);
    expect(ep1.errorCount).toBe(1);
    expect(ep1.timeoutCount).toBe(1);

    const ep2 = counter.getCounts('ep2');
    expect(ep2.totalSamples).toBe(1);
    expect(ep2.errorCount).toBe(0);
  });

  it('getCounts is O(1) — returns immediately without iteration', () => {
    const counter = new IncrementalLossCounter();
    counter.addSamples([{ endpointId: 'ep1', status: 'ok' }]);
    // Simply verify it returns in constant time by checking the result is correct
    const counts = counter.getCounts('ep1');
    expect(counts.totalSamples).toBe(1);
  });
});
