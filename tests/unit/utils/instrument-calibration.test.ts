import { describe, expect, it } from 'vitest';
import {
  buildInstrumentCalibration,
  INSTRUMENT_ENCODINGS,
} from '../../../src/lib/utils/instrument-calibration';

describe('instrument calibration', () => {
  it('describes the orbital tracker as measurable visual encodings', () => {
    const calibration = buildInstrumentCalibration({
      mode: 'live',
      thresholdMs: 120,
      windowSeconds: 60,
      baselineMs: 42,
      stationCount: 4,
      cadenceMs: 1000,
      sampleSlots: 60,
      carrierLosses: 0,
    });

    expect(calibration.modeLabel).toBe('Live tracker');
    expect(calibration.summary).toBe('Angle maps time. Radius maps latency. Color maps station and severity.');
    expect(calibration.readouts).toContainEqual({ label: 'Threshold', value: '120 ms' });
    expect(calibration.readouts).toContainEqual({ label: 'Baseline', value: '42 ms field p50' });
    expect(calibration.readouts).toContainEqual({ label: 'Window', value: '60 s / 60 slots' });
    expect(calibration.readouts).toContainEqual({ label: 'Cadence', value: '1 s' });
    expect(calibration.readouts).toContainEqual({ label: 'Stations', value: '4 active' });

    expect(INSTRUMENT_ENCODINGS.map((encoding) => encoding.label)).toEqual([
      'Angle',
      'Radius',
      'Color',
      'Pulse',
      'Gap',
      'Threshold',
      'Drift',
    ]);
    expect(INSTRUMENT_ENCODINGS.find((encoding) => encoding.label === 'Gap')?.description)
      .toContain('failed');
  });

  it('marks recording and report contexts distinctly', () => {
    const liveDraft = buildInstrumentCalibration({
      mode: 'report',
      thresholdMs: 95,
      windowSeconds: 360,
      baselineMs: null,
      stationCount: 1,
      sampleSlots: 360,
      carrierLosses: 3,
      isRecording: true,
    });

    expect(liveDraft.modeLabel).toBe('Live report draft');
    expect(liveDraft.readouts).toContainEqual({ label: 'Baseline', value: 'Acquiring' });
    expect(liveDraft.readouts).toContainEqual({ label: 'Losses', value: '3' });
    expect(liveDraft.readouts).toContainEqual({ label: 'Stations', value: '1 active' });
    expect(liveDraft.ariaLabel).toBe('Instrument calibration for Live report draft');
  });

  it('derives fallback sample slots from cadence when explicit slots are missing', () => {
    const calibration = buildInstrumentCalibration({
      mode: 'overview',
      thresholdMs: 120,
      windowSeconds: 60,
      baselineMs: 32,
      stationCount: 4,
      cadenceMs: 500,
    });

    expect(calibration.readouts).toContainEqual({ label: 'Window', value: '60 s / 120 slots' });
  });
});
