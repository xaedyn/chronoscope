import { describe, it, expect, vi, afterEach } from 'vitest';
import { migrateSettings } from '../../../src/lib/utils/persistence';

vi.mock('../../../src/lib/regional-defaults', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/lib/regional-defaults')>();
  return {
    ...original,
    detectRegion: vi.fn(() => 'europe' as const),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('migrateSettings v3 → v4', () => {
  it('v3 payload with no region → v4 with region = detectRegion()', () => {
    const v3 = {
      version: 3,
      endpoints: [{ url: 'https://example.com', enabled: true }],
      settings: { timeout: 5000, delay: 0, burstRounds: 50, monitorDelay: 1000, cap: 0, corsMode: 'no-cors' },
      ui: { expandedCards: [], activeView: 'timeline' },
    };
    const result = migrateSettings(v3);
    expect(result?.version).toBe(4);
    expect(result?.settings.region).toBe('europe');
    expect(result?.endpoints[0]?.url).toBe('https://example.com');
  });

  it('v4 payload with valid region passes through unchanged', () => {
    const v4 = {
      version: 4,
      endpoints: [{ url: 'https://example.com', enabled: true }],
      settings: { timeout: 5000, delay: 0, burstRounds: 50, monitorDelay: 1000, cap: 0, corsMode: 'no-cors', region: 'east-asia' },
      ui: { expandedCards: [], activeView: 'split' },
    };
    const result = migrateSettings(v4);
    expect(result?.version).toBe(4);
    expect(result?.settings.region).toBe('east-asia');
  });

  it('v4 payload with invalid region string strips the field', () => {
    const v4 = {
      version: 4,
      endpoints: [],
      settings: { timeout: 5000, delay: 0, burstRounds: 50, monitorDelay: 1000, cap: 0, corsMode: 'no-cors', region: 'fakeland' },
      ui: { expandedCards: [], activeView: 'split' },
    };
    const result = migrateSettings(v4);
    expect(result?.version).toBe(4);
    expect(result?.settings.region).toBeUndefined();
  });

  it('v4 payload with null region strips the field', () => {
    const v4 = {
      version: 4,
      endpoints: [],
      settings: { timeout: 5000, delay: 0, burstRounds: 50, monitorDelay: 1000, cap: 0, corsMode: 'no-cors', region: null },
      ui: { expandedCards: [], activeView: 'split' },
    };
    const result = migrateSettings(v4);
    expect(result?.settings.region).toBeUndefined();
  });

  it('v2 payload migrates through to v4 (chain migration)', () => {
    const v2 = {
      version: 2,
      endpoints: [{ url: 'https://example.com', enabled: true }],
      settings: { timeout: 5000, delay: 500, cap: 0, corsMode: 'no-cors' },
      ui: { expandedCards: [], activeView: 'split' },
    };
    const result = migrateSettings(v2);
    expect(result?.version).toBe(4);
    expect(result?.settings.burstRounds).toBe(50);
    expect(result?.settings.region).toBe('europe');
  });

  it('v1 payload migrates through to v4', () => {
    const v1 = {
      version: 1,
      endpoints: [{ url: 'https://example.com' }],
    };
    const result = migrateSettings(v1);
    expect(result?.version).toBe(4);
  });

  it('version 99 (future unknown): returns null — no forward-compat coercion', () => {
    // Spec §5: migrateSettings returns null for unknown versions.
    const future = {
      version: 99,
      endpoints: [{ url: 'https://example.com', enabled: true }],
      settings: { timeout: 5000, delay: 0, burstRounds: 50, monitorDelay: 1000, cap: 0, corsMode: 'no-cors', region: 'europe' },
      ui: { expandedCards: [], activeView: 'split' },
      unknownFutureField: 'ignored',
    };
    const result = migrateSettings(future);
    expect(result).toBeNull();
  });
});
