import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { endpointStore, MAX_ENDPOINTS } from '../../src/lib/stores/endpoints';

describe('endpointStore — cap enforcement (AC4)', () => {
  beforeEach(() => {
    endpointStore.reset();
  });

  it('exports MAX_ENDPOINTS as 10 (AC4: hard cap constant)', () => {
    expect(MAX_ENDPOINTS).toBe(10);
  });

  it('allows adding endpoints up to the cap', () => {
    const initial = get(endpointStore).length;
    const slotsLeft = MAX_ENDPOINTS - initial;
    for (let i = 0; i < slotsLeft; i++) {
      endpointStore.addEndpoint(`https://ep-${i}.example.com`);
    }
    expect(get(endpointStore).length).toBe(MAX_ENDPOINTS);
  });

  it('rejects the 11th endpoint — store stays at 10 (AC4)', () => {
    const initial = get(endpointStore).length;
    const slotsLeft = MAX_ENDPOINTS - initial;
    for (let i = 0; i < slotsLeft; i++) {
      endpointStore.addEndpoint(`https://ep-${i}.example.com`);
    }
    const idForRejected = endpointStore.addEndpoint('https://rejected.example.com');
    expect(get(endpointStore).length).toBe(MAX_ENDPOINTS);
    expect(idForRejected).toBe('');
  });

  it('returns empty string when cap is reached (AC4)', () => {
    const initial = get(endpointStore).length;
    for (let i = 0; i < MAX_ENDPOINTS - initial; i++) {
      endpointStore.addEndpoint(`https://ep-${i}.example.com`);
    }
    const result = endpointStore.addEndpoint('https://overflow.example.com');
    expect(result).toBe('');
  });
});
