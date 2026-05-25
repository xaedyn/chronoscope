import { describe, expect, it } from 'vitest';
import {
  latencyOffsetFor,
  orbitalRadiusForLatency,
  triggerRadiusFor,
} from '../../../src/lib/utils/orbital-encoding';

describe('orbital encoding', () => {
  it('maps latency deltas to the same bounded radius offset the scene renders', () => {
    expect(latencyOffsetFor(42, 42)).toBe(0);
    expect(latencyOffsetFor(84, 42)).toBe(0.5);
    expect(latencyOffsetFor(126, 42)).toBe(0.8);
    expect(latencyOffsetFor(4, 42)).toBe(-0.4);
  });

  it('uses the latency radius scale for the trigger boundary', () => {
    expect(orbitalRadiusForLatency(8, 90, 60)).toBe(8.25);
    expect(triggerRadiusFor(8, 60, 120)).toBe(8.5);
    expect(triggerRadiusFor(8, 30, 120)).toBe(8.8);
    expect(triggerRadiusFor(8, 60, 30)).toBe(7.75);
  });
});
