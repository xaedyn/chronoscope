import type {
  Endpoint,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
  PulseInspectionSource,
} from '$lib/types';

const STATION_IDS = ['A', 'B', 'C', 'D'] as const;

export interface BuildMostSignificantPulseInput {
  readonly endpoints: readonly Endpoint[];
  readonly measurements: MeasurementState;
  readonly thresholdMs: number;
  readonly windowSlots?: number;
  readonly source?: PulseInspectionSource;
  readonly capturedAt?: number;
}

interface Candidate {
  readonly pulse: PulseInspection;
  readonly thresholdDelta: number;
  readonly latency: number;
  readonly round: number;
  readonly driftMagnitude: number;
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

function visibleSampleIndexes(samples: readonly MeasurementSample[], windowSlots: number): readonly { sampleIndex: number; slot: number }[] {
  if (samples.length === 0) return [];
  if (samples.length <= windowSlots) {
    const offset = windowSlots - samples.length;
    return samples.map((_, index) => ({ sampleIndex: index, slot: offset + index }));
  }

  return Array.from({ length: windowSlots }, (_, slot) => ({
    sampleIndex: Math.min(
      samples.length - 1,
      Math.max(0, Math.floor(((slot + 1) * samples.length) / windowSlots) - 1),
    ),
    slot,
  }));
}

function previousOkLatency(
  samples: readonly MeasurementSample[],
  beforeIndex: number,
): number | null {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const sample = samples[i];
    if (sample?.status === 'ok' && Number.isFinite(sample.latency)) {
      return sample.latency;
    }
  }
  return null;
}

function isBetterCandidate(next: Candidate, current: Candidate | null): boolean {
  if (current === null) return true;
  if (next.thresholdDelta !== current.thresholdDelta) return next.thresholdDelta > current.thresholdDelta;
  if (next.latency !== current.latency) return next.latency > current.latency;
  if (next.driftMagnitude !== current.driftMagnitude) return next.driftMagnitude > current.driftMagnitude;
  return next.round > current.round;
}

export function buildMostSignificantPulseInspection(
  input: BuildMostSignificantPulseInput,
): PulseInspection | null {
  const windowSlots = Math.max(1, Math.round(input.windowSlots ?? 360));
  const thresholdMs = Math.round(input.thresholdMs);
  let best: Candidate | null = null;

  const visibleEndpoints = input.endpoints.slice(0, 4);
  for (let endpointIndex = 0; endpointIndex < visibleEndpoints.length; endpointIndex++) {
    const endpoint = visibleEndpoints[endpointIndex];
    if (!endpoint) continue;
    const stationId = STATION_IDS[endpointIndex];
    if (!stationId) continue;

    const samples = sampleArray(input.measurements.endpoints[endpoint.id]);
    for (const visible of visibleSampleIndexes(samples, windowSlots)) {
      const sample = samples[visible.sampleIndex];
      if (!sample || sample.status !== 'ok' || !Number.isFinite(sample.latency)) continue;

      const latency = Math.round(sample.latency);
      const previous = previousOkLatency(samples, visible.sampleIndex);
      const drift = previous === null ? null : latency - Math.round(previous);
      const thresholdDelta = latency - thresholdMs;
      const round = Number.isFinite(sample.round) ? Math.round(sample.round) : 0;
      const candidate: Candidate = {
        pulse: {
          source: input.source ?? 'endpoint',
          stationId,
          endpointId: endpoint.id,
          endpointLabel: endpoint.label,
          slot: visible.slot,
          roundNumber: Number.isFinite(sample.round) ? round : null,
          latency,
          drift,
          thresholdMs,
          thresholdDelta,
          timeLabel: null,
          capturedAt: input.capturedAt ?? Date.now(),
        },
        thresholdDelta,
        latency,
        round,
        driftMagnitude: Math.abs(drift ?? 0),
      };

      if (isBetterCandidate(candidate, best)) {
        best = candidate;
      }
    }
  }

  return best?.pulse ?? null;
}
