import { describe, expect, it } from 'vitest';
import { buildReportCsv } from '../../../src/lib/utils/report-export';
import type { Endpoint, MeasurementState, PulseInspection } from '../../../src/lib/types';

const endpoint: Endpoint = {
  id: 'ep-1',
  label: 'API',
  url: 'https://api.example.com/v1',
  enabled: true,
  color: '#67e8f9',
};

const measurements = {
  lifecycle: 'completed',
  epoch: 1,
  roundCounter: 72,
  endpoints: {
    'ep-1': {
      endpointId: 'ep-1',
      samples: [{ round: 72, latency: 142.4, status: 'ok', timestamp: 1778352000600 }],
      lastLatency: 142.4,
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

describe('report export', () => {
  it('adds selected pulse evidence to the session csv', () => {
    const csv = buildReportCsv({
      endpoints: [endpoint],
      measurements,
      healthThreshold: 120,
      sessionStart: 1778351999000,
      pinnedPulse,
    });

    expect(csv).toContain('round,timestamp_utc,t_offset_s,endpoint_id,endpoint_label,host,latency_ms,severity');
    expect(csv).toContain('72,2026-05-09T18:40:00.600Z,1.6,ep-1,"API",api.example.com,142.40,bad');
    expect(csv).toContain('# pinned_pulse');
    expect(csv).toContain('source,station_id,endpoint_id,endpoint_label,sample,slot,round,latency_ms,drift_ms,trigger_ms,threshold_delta_ms,time_label,captured_at_utc');
    expect(csv).toContain('live,A,ep-1,"API",round #72,42,72,142,22,120,22,T-2s,2026-05-09T18:40:00.600Z');
  });

  it('neutralizes formula-like text cells before spreadsheet export', () => {
    const riskyEndpoint: Endpoint = {
      ...endpoint,
      id: '=ep-1',
      label: '+API',
      url: '@api.example.com',
    };
    const riskyMeasurements = {
      ...measurements,
      endpoints: {
        '=ep-1': measurements.endpoints['ep-1'],
      },
    } as unknown as MeasurementState;

    const csv = buildReportCsv({
      endpoints: [riskyEndpoint],
      measurements: riskyMeasurements,
      healthThreshold: 120,
      sessionStart: 1778351999000,
      pinnedPulse: {
        ...pinnedPulse,
        endpointId: '=ep-1',
        endpointLabel: '-API',
        timeLabel: '@now',
      },
    });

    expect(csv).toContain(",'=ep-1,\"'+API\",'@api.example.com,");
    expect(csv).toContain("live,A,'=ep-1,\"'-API\",round #72");
    expect(csv).toContain(",22,'@now,2026-05-09T18:40:00.600Z");
  });
});
