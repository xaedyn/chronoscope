export type InstrumentMode = 'overview' | 'live' | 'endpoint' | 'report' | 'outage';

export interface InstrumentEncoding {
  readonly key: 'angle' | 'radius' | 'color' | 'pulse' | 'gap' | 'threshold' | 'drift';
  readonly label: string;
  readonly description: string;
}

export interface InstrumentReadout {
  readonly label: string;
  readonly value: string;
}

export interface InstrumentCalibrationInput {
  readonly mode: InstrumentMode;
  readonly thresholdMs: number;
  readonly windowSeconds: number;
  readonly baselineMs: number | null;
  readonly stationCount: number;
  readonly cadenceMs?: number | null;
  readonly sampleSlots?: number | null;
  readonly carrierLosses?: number;
  readonly isRecording?: boolean;
}

export interface InstrumentCalibration {
  readonly modeLabel: string;
  readonly ariaLabel: string;
  readonly summary: string;
  readonly readouts: readonly InstrumentReadout[];
}

export const INSTRUMENT_ENCODINGS: readonly InstrumentEncoding[] = Object.freeze([
  {
    key: 'angle',
    label: 'Angle',
    description: 'time through the active window',
  },
  {
    key: 'radius',
    label: 'Radius',
    description: 'latency above each station baseline',
  },
  {
    key: 'color',
    label: 'Color',
    description: 'station identity and severity',
  },
  {
    key: 'pulse',
    label: 'Pulse',
    description: 'one measurement round',
  },
  {
    key: 'gap',
    label: 'Gap',
    description: 'missing, failed, or opaque sample',
  },
  {
    key: 'threshold',
    label: 'Threshold',
    description: 'carrier-loss trigger',
  },
  {
    key: 'drift',
    label: 'Drift',
    description: 'delta from the field p50 baseline',
  },
]);

export function buildInstrumentCalibration(input: InstrumentCalibrationInput): InstrumentCalibration {
  const modeLabel = modeLabelFor(input.mode, input.isRecording === true);
  const threshold = Math.round(input.thresholdMs);
  const windowSeconds = Math.round(input.windowSeconds);
  const sampleSlots = sampleSlotsFor(input);
  const readouts: InstrumentReadout[] = [
    { label: 'Threshold', value: `${threshold} ms` },
    {
      label: 'Baseline',
      value: input.baselineMs === null ? 'Acquiring' : `${Math.round(input.baselineMs)} ms field p50`,
    },
    { label: 'Window', value: `${windowSeconds} s / ${Math.round(sampleSlots)} slots` },
    { label: 'Stations', value: `${Math.max(0, Math.round(input.stationCount))} active` },
  ];

  if (typeof input.cadenceMs === 'number' && Number.isFinite(input.cadenceMs) && input.cadenceMs > 0) {
    readouts.splice(3, 0, { label: 'Cadence', value: formatSeconds(input.cadenceMs / 1000) });
  }

  if ((input.carrierLosses ?? 0) > 0) {
    readouts.push({ label: 'Losses', value: `${Math.round(input.carrierLosses ?? 0)}` });
  }

  return {
    modeLabel,
    ariaLabel: `Instrument calibration for ${modeLabel}`,
    summary: 'Angle maps time. Radius maps latency. Color maps station and severity.',
    readouts,
  };
}

function sampleSlotsFor(input: InstrumentCalibrationInput): number {
  if (typeof input.sampleSlots === 'number' && Number.isFinite(input.sampleSlots)) {
    return Math.max(0, Math.round(input.sampleSlots));
  }
  if (typeof input.cadenceMs === 'number' && Number.isFinite(input.cadenceMs) && input.cadenceMs > 0) {
    return Math.max(0, Math.round(input.windowSeconds * (1000 / input.cadenceMs)));
  }
  return Math.max(0, Math.round(input.windowSeconds));
}

function modeLabelFor(mode: InstrumentMode, isRecording: boolean): string {
  switch (mode) {
    case 'overview':
      return 'Overview field';
    case 'live':
      return 'Live tracker';
    case 'endpoint':
      return 'Station drill-down';
    case 'report':
      return isRecording ? 'Live report draft' : 'Session signature';
    case 'outage':
      return 'Carrier-loss field';
  }
}

function formatSeconds(seconds: number): string {
  if (Number.isInteger(seconds)) return `${seconds} s`;
  return `${seconds.toFixed(1)} s`;
}
