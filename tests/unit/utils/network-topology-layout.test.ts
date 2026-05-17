import { describe, it, expect } from 'vitest';
import {
  layoutTopologyNodes,
  TOPOLOGY_VISIBLE_LIMIT,
} from '../../../src/lib/utils/network-topology-layout';

const VIEWBOX_HEIGHT = 260;
const ENDPOINT_X = 240;

describe('layoutTopologyNodes', () => {
  it('returns no slots for zero endpoints', () => {
    const result = layoutTopologyNodes({
      endpointCount: 0,
      viewboxHeight: VIEWBOX_HEIGHT,
      endpointX: ENDPOINT_X,
    });
    expect(result.slots).toEqual([]);
    expect(result.overflowCount).toBe(0);
    expect(result.hasOverflowSlot).toBe(false);
  });

  it('centers a single endpoint vertically', () => {
    const result = layoutTopologyNodes({
      endpointCount: 1,
      viewboxHeight: VIEWBOX_HEIGHT,
      endpointX: ENDPOINT_X,
    });
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]).toEqual({ index: 0, x: ENDPOINT_X, y: VIEWBOX_HEIGHT / 2 });
    expect(result.labelAnchor).toBe('below');
  });

  it('uses below-anchor labels for 2-4 endpoints (no crowding)', () => {
    for (const n of [2, 3, 4]) {
      const result = layoutTopologyNodes({
        endpointCount: n,
        viewboxHeight: VIEWBOX_HEIGHT,
        endpointX: ENDPOINT_X,
      });
      expect(result.labelAnchor, `n=${n}`).toBe('below');
      expect(result.slots, `n=${n}`).toHaveLength(n);
    }
  });

  it('switches to right-anchor labels when endpoints crowd the column', () => {
    // The vertical spacing at n=5 is tight enough that a below-anchor label
    // for one node would collide with the next node's glyph. The layout
    // helper must switch to a right-anchor at that density to honour the
    // spec's "labels never overlap nodes" rule.
    for (const n of [5, 6, 7, 8]) {
      const result = layoutTopologyNodes({
        endpointCount: n,
        viewboxHeight: VIEWBOX_HEIGHT,
        endpointX: ENDPOINT_X,
      });
      expect(result.labelAnchor, `n=${n}`).toBe('right');
    }
  });

  it('distributes slots evenly between the vertical padding bounds', () => {
    const result = layoutTopologyNodes({
      endpointCount: 4,
      viewboxHeight: VIEWBOX_HEIGHT,
      endpointX: ENDPOINT_X,
    });
    expect(result.slots[0].y).toBe(30);
    expect(result.slots[result.slots.length - 1].y).toBe(VIEWBOX_HEIGHT - 30);
    // Each step should be equal.
    const gaps = result.slots
      .slice(1)
      .map((slot, i) => slot.y - result.slots[i].y);
    const first = gaps[0];
    for (const gap of gaps) {
      expect(Math.abs(gap - first)).toBeLessThan(0.001);
    }
  });

  it('caps the visible glyphs at the visible limit', () => {
    const result = layoutTopologyNodes({
      endpointCount: TOPOLOGY_VISIBLE_LIMIT,
      viewboxHeight: VIEWBOX_HEIGHT,
      endpointX: ENDPOINT_X,
    });
    expect(result.slots).toHaveLength(TOPOLOGY_VISIBLE_LIMIT);
    expect(result.hasOverflowSlot).toBe(false);
    expect(result.overflowCount).toBe(0);
  });

  it('reserves the last slot for the +N more chip when endpoints exceed the visible limit', () => {
    // 12 endpoints: 7 endpoint slots + 1 overflow chip slot, overflowCount=5.
    // Total visible glyphs still equals the visible limit so the mobile cap
    // of 8 is preserved.
    const result = layoutTopologyNodes({
      endpointCount: 12,
      viewboxHeight: VIEWBOX_HEIGHT,
      endpointX: ENDPOINT_X,
    });
    expect(result.slots).toHaveLength(TOPOLOGY_VISIBLE_LIMIT);
    expect(result.hasOverflowSlot).toBe(true);
    expect(result.overflowCount).toBe(12 - (TOPOLOGY_VISIBLE_LIMIT - 1));
  });

  it('reports zero overflow when endpointCount equals exactly the visible limit', () => {
    const result = layoutTopologyNodes({
      endpointCount: TOPOLOGY_VISIBLE_LIMIT,
      viewboxHeight: VIEWBOX_HEIGHT,
      endpointX: ENDPOINT_X,
    });
    expect(result.hasOverflowSlot).toBe(false);
    expect(result.overflowCount).toBe(0);
  });

  it('keeps slot x equal to endpointX for every slot', () => {
    const result = layoutTopologyNodes({
      endpointCount: 6,
      viewboxHeight: VIEWBOX_HEIGHT,
      endpointX: ENDPOINT_X,
    });
    for (const slot of result.slots) {
      expect(slot.x).toBe(ENDPOINT_X);
    }
  });
});
