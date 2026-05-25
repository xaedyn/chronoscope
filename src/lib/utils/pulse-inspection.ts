import type { PulseInspection, PulseInspectionSource } from '$lib/types';

export interface PulseInspectionSourcePulse {
  readonly stationId: string;
  readonly stationLabel: string;
  readonly slot: number;
  readonly latency: number;
  readonly drift: number | null;
  readonly roundNumber: number | null;
  readonly timeLabel: string | null;
}

export interface BuildPulseInspectionInput {
  readonly source: PulseInspectionSource;
  readonly pulse: PulseInspectionSourcePulse;
  readonly endpointIdByStation: Readonly<Record<string, string>>;
  readonly thresholdMs: number;
  readonly capturedAt?: number;
}

export function buildPulseInspection(input: BuildPulseInspectionInput): PulseInspection {
  const latency = Math.round(input.pulse.latency);
  const thresholdMs = Math.round(input.thresholdMs);
  return {
    source: input.source,
    stationId: input.pulse.stationId,
    endpointId: input.endpointIdByStation[input.pulse.stationId] ?? null,
    endpointLabel: input.pulse.stationLabel,
    slot: input.pulse.slot,
    roundNumber: input.pulse.roundNumber,
    latency,
    drift: input.pulse.drift,
    thresholdMs,
    thresholdDelta: latency - thresholdMs,
    timeLabel: input.pulse.timeLabel,
    capturedAt: input.capturedAt ?? Date.now(),
  };
}

export function pulseInspectionSummary(evidence: PulseInspection): string {
  const sampleLabel = evidence.roundNumber === null
    ? `slot ${evidence.slot}`
    : `round #${evidence.roundNumber}`;
  return `${evidence.endpointLabel} · ${sampleLabel} · ${evidence.latency} ms · ${thresholdDeltaLabel(evidence.thresholdDelta)}`;
}

export function thresholdDeltaLabel(delta: number): string {
  if (delta === 0) return 'at trigger';
  return delta > 0 ? `+${delta} ms over trigger` : `${Math.abs(delta)} ms under trigger`;
}

export function driftLabel(drift: number | null): string {
  if (drift === null) return '—';
  if (drift === 0) return '0 ms';
  return drift > 0 ? `+${drift} ms` : `${drift} ms`;
}
