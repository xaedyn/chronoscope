import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { endpointStore } from '../../../src/lib/stores/endpoints';

describe('endpointStore.reorderEndpoint', () => {
  beforeEach(() => {
    endpointStore.reset();
  });

  it('moves an endpoint forward (0 → 1)', () => {
    const before = get(endpointStore);
    const idA = before[0]!.id;
    const idB = before[1]!.id;

    endpointStore.reorderEndpoint(0, 1);

    const after = get(endpointStore);
    expect(after[0]!.id).toBe(idB);
    expect(after[1]!.id).toBe(idA);
  });

  it('moves an endpoint backward (1 → 0)', () => {
    const before = get(endpointStore);
    const idA = before[0]!.id;
    const idB = before[1]!.id;

    endpointStore.reorderEndpoint(1, 0);

    const after = get(endpointStore);
    expect(after[0]!.id).toBe(idB);
    expect(after[1]!.id).toBe(idA);
  });

  it('no-ops when fromIndex === toIndex', () => {
    const before = get(endpointStore);
    const idsBefore = before.map(ep => ep.id);

    endpointStore.reorderEndpoint(0, 0);

    const after = get(endpointStore);
    expect(after.map(ep => ep.id)).toEqual(idsBefore);
  });

  it('no-ops when fromIndex is out of bounds', () => {
    const before = get(endpointStore);
    const idsBefore = before.map(ep => ep.id);

    endpointStore.reorderEndpoint(99, 0);

    const after = get(endpointStore);
    expect(after.map(ep => ep.id)).toEqual(idsBefore);
  });

  it('no-ops when toIndex is out of bounds', () => {
    const before = get(endpointStore);
    const idsBefore = before.map(ep => ep.id);

    endpointStore.reorderEndpoint(0, 99);

    const after = get(endpointStore);
    expect(after.map(ep => ep.id)).toEqual(idsBefore);
  });

  it('preserves all endpoint data after reorder', () => {
    const before = get(endpointStore);
    const epA = before[0]!;

    endpointStore.reorderEndpoint(0, 1);

    const after = get(endpointStore);
    expect(after[1]).toEqual(epA);
  });

  it('works with 3+ endpoints: moves middle to front', () => {
    endpointStore.addEndpoint('https://extra.example.com', 'Extra');
    const before = get(endpointStore);
    const idA = before[0]!.id;
    const idB = before[1]!.id;
    const idC = before[2]!.id;

    endpointStore.reorderEndpoint(1, 0);

    const after = get(endpointStore);
    expect(after[0]!.id).toBe(idB);
    expect(after[1]!.id).toBe(idA);
    expect(after[2]!.id).toBe(idC);
  });

  it('works with 3+ endpoints: moves first to last', () => {
    endpointStore.addEndpoint('https://extra.example.com', 'Extra');
    const before = get(endpointStore);
    const idA = before[0]!.id;
    const idB = before[1]!.id;
    const idC = before[2]!.id;

    endpointStore.reorderEndpoint(0, 2);

    const after = get(endpointStore);
    expect(after[0]!.id).toBe(idB);
    expect(after[1]!.id).toBe(idC);
    expect(after[2]!.id).toBe(idA);
  });
});
