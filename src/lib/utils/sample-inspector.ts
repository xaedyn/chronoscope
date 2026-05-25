import type {
  Endpoint,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
} from '$lib/types';
import { driftLabel, thresholdDeltaLabel } from './pulse-inspection';

export interface SampleInspector {
  readonly evidence: PulseInspection;
  readonly previousLatency: number | null;
  readonly nextLatency: number | null;
  readonly previousDelta: number | null;
  readonly nextDelta: number | null;
  readonly peerSampleCount: number;
  readonly peerOverThresholdCount: number;
  readonly peerSlowestLabel: string | null;
  readonly peerSlowestLatency: number | null;
  readonly why: string;
}

export interface BuildSampleInspectorInput {
  readonly evidence: PulseInspection;
  readonly endpoints: readonly Endpoint[];
  readonly measurements: MeasurementState;
  readonly thresholdMs: number;
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

function okNeighbor(
  samples: readonly MeasurementSample[],
  startIndex: number,
  direction: -1 | 1,
): MeasurementSample | null {
  for (let i = startIndex + direction; i >= 0 && i < samples.length; i += direction) {
    const sample = samples[i];
    if (sample?.status === 'ok' && Number.isFinite(sample.latency)) return sample;
  }
  return null;
}

function roundDeltaLabel(delta: number | null): string {
  if (delta === null) return 'no adjacent ok sample';
  if (delta === 0) return 'unchanged from adjacent sample';
  return `${driftLabel(delta)} from adjacent sample`;
}

function whyFor(input: {
  evidence: PulseInspection;
  previousDelta: number | null;
  peerOverThresholdCount: number;
  evidenceIncludedInPeers: boolean;
}): string {
  const delta = input.evidence.thresholdDelta;
  const otherPeersOver = Math.max(
    0,
    input.peerOverThresholdCount - (input.evidenceIncludedInPeers && delta > 0 ? 1 : 0),
  );
  if (delta > 0 && otherPeersOver > 0) {
    return `${input.evidence.endpointLabel} crossed trigger by ${delta} ms with ${otherPeersOver} other station${otherPeersOver === 1 ? '' : 's'} elevated in the same round.`;
  }
  if (delta > 0) {
    return `${input.evidence.endpointLabel} crossed trigger by ${delta} ms while peer stations stayed below trigger.`;
  }
  if (input.previousDelta !== null && Math.abs(input.previousDelta) >= 25) {
    return `${input.evidence.endpointLabel} stayed ${thresholdDeltaLabel(delta)} but moved ${driftLabel(input.previousDelta)} from the previous ok sample.`;
  }
  return `${input.evidence.endpointLabel} is a stable reference sample ${thresholdDeltaLabel(delta)}.`;
}

export function buildSampleInspector(input: BuildSampleInspectorInput): SampleInspector | null {
  const endpointId = input.evidence.endpointId;
  const round = input.evidence.roundNumber;
  if (!endpointId || round === null) return null;

  const targetSamples = sampleArray(input.measurements.endpoints[endpointId]);
  const targetIndex = targetSamples.findIndex((sample) => sample.round === round);
  const target = targetSamples[targetIndex];
  if (!target || target.status !== 'ok' || !Number.isFinite(target.latency)) return null;

  const previous = okNeighbor(targetSamples, targetIndex, -1);
  const next = okNeighbor(targetSamples, targetIndex, 1);
  const previousLatency = previous ? Math.round(previous.latency) : null;
  const nextLatency = next ? Math.round(next.latency) : null;
  const currentLatency = Math.round(target.latency);
  const previousDelta = previousLatency === null ? null : currentLatency - previousLatency;
  const nextDelta = nextLatency === null ? null : nextLatency - currentLatency;

  const peerSamples = input.endpoints
    .slice(0, 4)
    .map((endpoint) => ({
      endpoint,
      sample: sampleArray(input.measurements.endpoints[endpoint.id]).find((sample) =>
        sample.round === round && sample.status === 'ok' && Number.isFinite(sample.latency),
      ) ?? null,
    }))
    .filter((entry): entry is { endpoint: Endpoint; sample: MeasurementSample } => entry.sample !== null);
  const peerOverThresholdCount = peerSamples.filter((entry) => entry.sample.latency > input.thresholdMs).length;
  const evidenceIncludedInPeers = peerSamples.some((entry) => entry.endpoint.id === endpointId);
  const slowestPeer = peerSamples
    .filter((entry) => entry.endpoint.id !== endpointId)
    .sort((a, b) => b.sample.latency - a.sample.latency)[0] ?? null;

  return {
    evidence: input.evidence,
    previousLatency,
    nextLatency,
    previousDelta,
    nextDelta,
    peerSampleCount: peerSamples.length,
    peerOverThresholdCount,
    peerSlowestLabel: slowestPeer?.endpoint.label ?? null,
    peerSlowestLatency: slowestPeer ? Math.round(slowestPeer.sample.latency) : null,
    why: whyFor({
      evidence: input.evidence,
      previousDelta,
      peerOverThresholdCount,
      evidenceIncludedInPeers,
    }),
  };
}

export function inspectorDeltaLabel(delta: number | null): string {
  return roundDeltaLabel(delta);
}
