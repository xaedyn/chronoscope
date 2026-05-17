// src/lib/utils/network-topology-layout.ts
// Pure layout math for the NetworkTopology component. Extracted so the
// collision-avoidance and overflow-collapse rules can be exercised by unit
// tests without rendering an SVG.
//
// Layout rules (synthesis design contract Section 2):
//
// - Up to TOPOLOGY_VISIBLE_LIMIT (8) endpoint slots are visible at once.
// - When the monitored-endpoint count exceeds the limit, the last slot is
//   replaced with a "+N more" chip so the topology never renders more than
//   8 visible glyphs (the spec's "mobile chip cap of 8" rule).
// - Labels render below nodes when there's enough vertical room. Above a
//   density threshold the labels switch to a side anchor (right of the node)
//   to avoid colliding with the next node's glyph.

export const TOPOLOGY_VISIBLE_LIMIT = 8;

// At >= this many endpoints, labels can't fit below nodes without
// colliding with the next node's glyph — switch to right-anchored labels.
const SIDE_LABEL_THRESHOLD = 5;

export type TopologyLabelAnchor = 'below' | 'right';

export interface TopologyLayoutInput {
  readonly endpointCount: number;
  readonly viewboxHeight: number;
  readonly endpointX: number;
  readonly verticalPadding?: number;
}

export interface TopologySlot {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

export interface TopologyLayout {
  readonly slots: readonly TopologySlot[];
  readonly overflowCount: number;
  readonly hasOverflowSlot: boolean;
  readonly labelAnchor: TopologyLabelAnchor;
}

export function layoutTopologyNodes(input: TopologyLayoutInput): TopologyLayout {
  const { endpointCount, viewboxHeight, endpointX } = input;
  const verticalPadding = input.verticalPadding ?? 30;

  if (endpointCount <= 0) {
    return {
      slots: [],
      overflowCount: 0,
      hasOverflowSlot: false,
      labelAnchor: 'below',
    };
  }

  const overflows = endpointCount > TOPOLOGY_VISIBLE_LIMIT;
  const endpointSlots = overflows ? TOPOLOGY_VISIBLE_LIMIT - 1 : endpointCount;
  const totalSlots = overflows ? TOPOLOGY_VISIBLE_LIMIT : endpointCount;
  const overflowCount = overflows ? endpointCount - endpointSlots : 0;

  const usableHeight = Math.max(0, viewboxHeight - verticalPadding * 2);
  const slots: TopologySlot[] = [];

  for (let i = 0; i < totalSlots; i += 1) {
    let y: number;
    if (totalSlots === 1) {
      y = viewboxHeight / 2;
    } else {
      const step = usableHeight / (totalSlots - 1);
      y = verticalPadding + step * i;
    }
    slots.push({ index: i, x: endpointX, y });
  }

  return {
    slots,
    overflowCount,
    hasOverflowSlot: overflows,
    labelAnchor: totalSlots >= SIDE_LABEL_THRESHOLD ? 'right' : 'below',
  };
}
