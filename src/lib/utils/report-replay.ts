import type {
  Endpoint,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
} from '$lib/types';

const STATION_IDS = ['A', 'B', 'C', 'D'] as const;

export interface ReportReplayFrame {
  readonly progress: number;
  readonly targetRound: number;
  readonly roundLabel: string;
  readonly stationData: Record<string, readonly (number | null)[]>;
  readonly stationTimestamps: Record<string, readonly (number | null)[]>;
  readonly pulse: PulseInspection | null;
}

export interface BuildReportReplayFrameInput {
  readonly endpoints: readonly Endpoint[];
  readonly measurements: MeasurementState;
  readonly thresholdMs: number;
  readonly progress: number;
  readonly windowSlots?: number;
  readonly capturedAt?: number;
}

interface Candidate {
  readonly pulse: PulseInspection;
  readonly thresholdDelta: number;
  readonly latency: number;
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

function maxRecordedRound(measurements: MeasurementState): number {
  let maxRound = 0;
  for (const state of Object.values(measurements.endpoints)) {
    for (const sample of sampleArray(state)) {
      if (Number.isFinite(sample.round)) maxRound = Math.max(maxRound, sample.round);
    }
  }
  if (maxRound > 0) return Math.max(0, Math.round(maxRound));
  return Math.max(0, Math.round(measurements.roundCounter));
}

function packedSlotFor(index: number, sampleCount: number, windowSlots: number): number {
  if (sampleCount <= windowSlots) return windowSlots - sampleCount + index;
  const stride = sampleCount / windowSlots;
  return Math.min(windowSlots - 1, Math.max(0, Math.floor(index / stride)));
}

function packSamples<V>(
  samples: readonly MeasurementSample[],
  windowSlots: number,
  project: (sample: MeasurementSample) => V,
): (V | null)[] {
  const buf: (V | null)[] = new Array(windowSlots).fill(null);
  if (samples.length === 0) return buf;
  if (samples.length <= windowSlots) {
    const offset = windowSlots - samples.length;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      if (sample) buf[offset + i] = project(sample);
    }
    return buf;
  }

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample) buf[packedSlotFor(i, samples.length, windowSlots)] = project(sample);
  }
  return buf;
}

function previousOkLatency(samples: readonly MeasurementSample[], beforeIndex: number): number | null {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const sample = samples[i];
    if (sample?.status === 'ok' && Number.isFinite(sample.latency)) return Math.round(sample.latency);
  }
  return null;
}

function betterCandidate(next: Candidate, current: Candidate | null): boolean {
  if (current === null) return true;
  if (next.thresholdDelta !== current.thresholdDelta) return next.thresholdDelta > current.thresholdDelta;
  if (next.latency !== current.latency) return next.latency > current.latency;
  return next.driftMagnitude > current.driftMagnitude;
}

export function buildReportReplayFrame(input: BuildReportReplayFrameInput): ReportReplayFrame {
  const windowSlots = Math.max(1, Math.round(input.windowSlots ?? 360));
  const progress = Math.max(0, Math.min(1, input.progress));
  const maxRound = maxRecordedRound(input.measurements);
  const targetRound = Math.min(maxRound, Math.max(0, Math.round(progress * maxRound)));
  const thresholdMs = Math.round(input.thresholdMs);

  const stationData: Record<string, readonly (number | null)[]> = {};
  const stationTimestamps: Record<string, readonly (number | null)[]> = {};
  let best: Candidate | null = null;

  const visibleEndpoints = input.endpoints.slice(0, 4);
  for (let endpointIndex = 0; endpointIndex < visibleEndpoints.length; endpointIndex++) {
    const endpoint = visibleEndpoints[endpointIndex];
    if (!endpoint) continue;
    const stationId = STATION_IDS[endpointIndex];
    if (!stationId) continue;

    const visibleSamples = sampleArray(input.measurements.endpoints[endpoint.id])
      .filter((sample) => sample.round <= targetRound);
    stationData[stationId] = packSamples(visibleSamples, windowSlots, (sample) =>
      sample.status === 'ok' ? sample.latency : null,
    );
    stationTimestamps[stationId] = packSamples(visibleSamples, windowSlots, (sample) =>
      sample.status === 'ok' ? sample.timestamp : null,
    );

    const currentIndex = visibleSamples.findIndex((sample) => sample.round === targetRound && sample.status === 'ok');
    const sample = currentIndex >= 0 ? visibleSamples[currentIndex] : null;
    if (!sample) continue;

    const latency = Math.round(sample.latency);
    const roundNumber = Number.isFinite(sample.round) ? Math.round(sample.round) : null;
    const previousLatency = previousOkLatency(visibleSamples, currentIndex);
    const drift = previousLatency === null ? null : latency - previousLatency;
    const thresholdDelta = latency - thresholdMs;
    const candidate: Candidate = {
      pulse: {
        source: 'endpoint',
        stationId,
        endpointId: endpoint.id,
        endpointLabel: endpoint.label,
        slot: packedSlotFor(currentIndex, visibleSamples.length, windowSlots),
        roundNumber,
        latency,
        drift,
        thresholdMs,
        thresholdDelta,
        timeLabel: input.measurements.startedAt === null
          ? null
          : `T+${Math.max(0, Math.round((sample.timestamp - input.measurements.startedAt) / 1000)).toString()}s`,
        capturedAt: input.capturedAt ?? Date.now(),
      },
      thresholdDelta,
      latency,
      driftMagnitude: Math.abs(drift ?? 0),
    };

    if (betterCandidate(candidate, best)) best = candidate;
  }

  return {
    progress,
    targetRound,
    roundLabel: `${targetRound} / ${maxRound}`,
    stationData,
    stationTimestamps,
    pulse: best?.pulse ?? null,
  };
}
