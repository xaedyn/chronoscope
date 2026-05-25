import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildResultsSharePayload } from '../../../src/lib/share/share-payload-builder';
import {
  decodeSharePayload,
  encodeSharePayload,
} from '../../../src/lib/share/share-manager';
import { applySharePayload } from '../../../src/lib/share/hash-router';
import { endpointStore } from '../../../src/lib/stores/endpoints';
import { measurementStore } from '../../../src/lib/stores/measurements';
import { settingsStore } from '../../../src/lib/stores/settings';
import { uiStore } from '../../../src/lib/stores/ui';
import { MAX_CAP } from '../../../src/lib/limits';
import type {
  Endpoint,
  MeasurementState,
  PulseInspection,
  Settings,
  SharePayload,
} from '../../../src/lib/types';

const pinnedPulse: PulseInspection = {
  source: 'live',
  stationId: 'A',
  endpointId: 'ep-1',
  endpointLabel: 'API',
  slot: 42,
  roundNumber: 72,
  latency: 142,
  drift: 22,
  thresholdMs: 120,
  thresholdDelta: 22,
  timeLabel: 'T-2s',
  capturedAt: 1778352000600,
};

const endpoint: Endpoint = {
  id: 'ep-1',
  label: 'API',
  url: 'https://api.example.com',
  enabled: true,
  color: '#67e8f9',
};

const settings: Settings = {
  timeout: 5000,
  delay: 0,
  burstRounds: 10,
  monitorDelay: 1000,
  cap: MAX_CAP,
  corsMode: 'no-cors',
  healthThreshold: 120,
  audioEnabled: false,
};

const measurements = {
  lifecycle: 'completed',
  epoch: 1,
  roundCounter: 72,
  endpoints: {
    'ep-1': {
      endpointId: 'ep-1',
      samples: [{ round: 72, latency: 142, status: 'ok', timestamp: 1778352000600 }],
      lastLatency: 142,
      lastStatus: 'ok',
      lastErrorMessage: null,
      tierLevel: 1,
    },
  },
  startedAt: 1778351999000,
  stoppedAt: 1778352001000,
  freezeEvents: [],
  errorCount: 0,
  timeoutCount: 0,
} as unknown as MeasurementState;

function reportPayload(overrides: Partial<SharePayload['report']> = {}): SharePayload {
  return {
    v: 2,
    mode: 'results',
    endpoints: [{ url: 'https://api.example.com', enabled: true }],
    settings: { timeout: 5000, delay: 0, cap: MAX_CAP, corsMode: 'no-cors' },
    report: {
      reportKind: 'support',
      createdAt: 1778352000000,
      healthThreshold: 120,
      corsMode: 'no-cors',
      roundCount: 72,
      totalSampleCount: 1,
      keptSampleCount: 1,
      truncated: false,
      ...overrides,
    },
    results: [{ samples: [{ round: 72, latency: 142, status: 'ok' }] }],
  };
}

beforeEach(() => {
  endpointStore.setEndpoints([]);
  settingsStore.reset();
  measurementStore.reset();
  uiStore.reset();
});

describe('share payload pinned evidence', () => {
  it('embeds a selected pulse in v2 report metadata', () => {
    const built = buildResultsSharePayload(
      [endpoint],
      settings,
      measurements,
      8000,
      1778352000000,
      { pinnedPulse },
    );

    expect(built.payload.report?.pinnedPulse).toEqual(pinnedPulse);
  });

  it('round-trips bounded pinned evidence through share encoding', () => {
    const decoded = decodeSharePayload(encodeSharePayload(reportPayload({ pinnedPulse })));

    expect(decoded?.report?.pinnedPulse).toEqual(pinnedPulse);
  });

  it('rejects pinned evidence with unknown nested keys', () => {
    const payload = reportPayload({
      pinnedPulse: {
        ...pinnedPulse,
        privateRawTiming: 'leak',
      } as never,
    });

    expect(decodeSharePayload(encodeSharePayload(payload as never))).toBeNull();
  });

  it('hydrates pinned evidence from shared reports and remaps it to the materialized endpoint id', () => {
    applySharePayload(reportPayload({ pinnedPulse }));

    const endpoints = get(endpointStore);
    const ui = get(uiStore);

    expect(ui.sharedReportContext?.pinnedPulse?.roundNumber).toBe(72);
    expect(ui.pinnedPulse?.roundNumber).toBe(72);
    expect(ui.pinnedPulse?.endpointId).toBe(endpoints[0]?.id);
    expect(ui.pinnedPulse?.endpointId).not.toBe('ep-1');
  });
});
