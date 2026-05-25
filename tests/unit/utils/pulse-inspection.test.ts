import { describe, expect, it } from 'vitest';
import { buildPulseInspection, pulseInspectionSummary } from '../../../src/lib/utils/pulse-inspection';

describe('pulse inspection', () => {
  it('turns a picked orbital pulse into reportable evidence', () => {
    const evidence = buildPulseInspection({
      source: 'live',
      pulse: {
        stationId: 'C',
        stationLabel: 'AWS',
        slot: 58,
        latency: 142,
        drift: 22,
        roundNumber: 72,
        timeLabel: 'T−2s',
      },
      endpointIdByStation: { C: 'aws' },
      thresholdMs: 120,
      capturedAt: 1_700_000_000_000,
    });

    expect(evidence).toEqual({
      source: 'live',
      stationId: 'C',
      endpointId: 'aws',
      endpointLabel: 'AWS',
      slot: 58,
      roundNumber: 72,
      latency: 142,
      drift: 22,
      thresholdMs: 120,
      thresholdDelta: 22,
      timeLabel: 'T−2s',
      capturedAt: 1_700_000_000_000,
    });
    expect(pulseInspectionSummary(evidence)).toBe('AWS · round #72 · 142 ms · +22 ms over trigger');
  });

  it('uses clear fallback labels when round or drift are unavailable', () => {
    const evidence = buildPulseInspection({
      source: 'endpoint',
      pulse: {
        stationId: 'A',
        stationLabel: 'Google',
        slot: 14,
        latency: 42.4,
        drift: null,
        roundNumber: null,
        timeLabel: null,
      },
      endpointIdByStation: {},
      thresholdMs: 120,
      capturedAt: 1_700_000_000_001,
    });

    expect(evidence.endpointId).toBeNull();
    expect(evidence.roundNumber).toBeNull();
    expect(evidence.latency).toBe(42);
    expect(evidence.thresholdDelta).toBe(-78);
    expect(pulseInspectionSummary(evidence)).toBe('Google · slot 14 · 42 ms · 78 ms under trigger');
  });
});
