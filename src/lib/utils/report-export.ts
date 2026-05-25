import type {
  Endpoint,
  MeasurementState,
  MeasurementSample,
  PulseInspection,
  SampleStatus,
} from '$lib/types';
import { displayRoundLabel } from './pulse-inspection';

export interface BuildReportCsvInput {
  readonly endpoints: readonly Endpoint[];
  readonly measurements: MeasurementState;
  readonly healthThreshold: number;
  readonly sessionStart: number;
  readonly pinnedPulse?: PulseInspection | null;
}

function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  const safe = neutralizeSpreadsheetFormula(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const text = neutralizeSpreadsheetFormula(value);
  return /[",\n\r]/.test(text) ? quote(value) : text;
}

function severityName(latency: number, status: SampleStatus, threshold: number): string {
  if (status !== 'ok') return status;
  if (latency >= 4000) return 'crit';
  if (latency > threshold) return 'bad';
  if (latency > threshold * 0.7) return 'warn';
  return 'stable';
}

function endpointHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pinnedSampleLabel(pulse: PulseInspection): string {
  return displayRoundLabel(pulse.roundNumber, pulse.slot);
}

function pinnedPulseRows(pulse: PulseInspection): string {
  const row = [
    csvCell(pulse.source),
    csvCell(pulse.stationId),
    csvCell(pulse.endpointId ?? ''),
    quote(pulse.endpointLabel),
    csvCell(pinnedSampleLabel(pulse)),
    pulse.slot,
    pulse.roundNumber ?? '',
    pulse.latency,
    pulse.drift ?? '',
    pulse.thresholdMs,
    pulse.thresholdDelta,
    csvCell(pulse.timeLabel),
    new Date(pulse.capturedAt).toISOString(),
  ].join(',');

  return [
    '',
    '# pinned_pulse',
    'source,station_id,endpoint_id,endpoint_label,sample,slot,round,latency_ms,drift_ms,trigger_ms,threshold_delta_ms,time_label,captured_at_utc',
    row,
  ].join('\n');
}

function sampleArray(
  state: MeasurementState['endpoints'][string] | undefined,
): readonly MeasurementSample[] {
  const samples = state?.samples;
  if (!samples) return [];
  return typeof samples.toArray === 'function'
    ? samples.toArray()
    : Array.from(samples as unknown as readonly MeasurementSample[]);
}

export function buildReportCsv(input: BuildReportCsvInput): string {
  const lines = [
    'round,timestamp_utc,t_offset_s,endpoint_id,endpoint_label,host,latency_ms,severity',
  ];

  for (const ep of input.endpoints) {
    const host = endpointHost(ep.url);
    for (const sample of sampleArray(input.measurements.endpoints[ep.id])) {
      const offsetS = ((sample.timestamp - input.sessionStart) / 1000).toFixed(1);
      const iso = new Date(sample.timestamp).toISOString();
      lines.push([
        sample.round,
        iso,
        offsetS,
        csvCell(ep.id),
        quote(ep.label),
        csvCell(host),
        sample.latency.toFixed(2),
        severityName(sample.latency, sample.status, input.healthThreshold),
      ].join(','));
    }
  }

  const csv = lines.join('\n');
  if (!input.pinnedPulse) return `${csv}\n`;
  return `${csv}${pinnedPulseRows(input.pinnedPulse)}\n`;
}
