import type {
  Endpoint,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
  StatisticsState,
} from '$lib/types';
import { driftLabel, thresholdDeltaLabel } from './pulse-inspection';

export type ReportLensSource = 'significant' | 'scrub' | 'clicked' | 'pinned' | 'none';
export type ReportPeerMovement = 'selected' | 'co-elevated' | 'wobble' | 'steady' | 'missing';

export interface ReportLensPeer {
  readonly endpointId: string;
  readonly endpointLabel: string;
  readonly stationId: string | null;
  readonly latency: number | null;
  readonly status: MeasurementSample['status'] | 'missing';
  readonly thresholdDelta: number | null;
  readonly movement: ReportPeerMovement;
}

export interface ReportOrbitalSelection {
  readonly selected: {
    readonly stationId: string;
    readonly slot: number;
    readonly roundNumber: number | null;
  };
  readonly peerStations: readonly string[];
  readonly angle: number;
}

export interface ReportInstrumentLens {
  readonly selected: PulseInspection | null;
  readonly source: ReportLensSource;
  readonly selectionReason: string;
  readonly canReturnToReplay: boolean;
  readonly moment: {
    readonly roundLabel: string;
    readonly timeLabel: string;
    readonly endpointLabel: string;
    readonly thresholdLabel: string;
  };
  readonly signal: {
    readonly latencyLabel: string;
    readonly thresholdDeltaLabel: string;
    readonly driftLabel: string;
    readonly trendLabel: string;
  };
  readonly peers: readonly ReportLensPeer[];
  readonly proof: {
    readonly suggests: string;
    readonly cannotProve: string;
  };
  readonly orbitalSelection: ReportOrbitalSelection | null;
}

export interface BuildReportInstrumentLensInput {
  readonly endpoints: readonly Endpoint[];
  readonly measurements: MeasurementState;
  readonly stats: StatisticsState;
  readonly thresholdMs: number;
  readonly pinnedPulse: PulseInspection | null;
  readonly replayPulse: PulseInspection | null;
  readonly significantPulse: PulseInspection | null;
  readonly selectionSource: Exclude<ReportLensSource, 'pinned' | 'none'>;
  readonly windowSlots: number;
}

const STATION_IDS = ['A', 'B', 'C', 'D'] as const;
const SHARED_LIMITATION =
  'Browser evidence cannot separate local network, route, and endpoint cause by itself. An outside check can reduce that uncertainty.';

function sampleArray(state: MeasurementState['endpoints'][string] | undefined): readonly MeasurementSample[] {
  const samples = state?.samples;
  if (!samples) return [];
  return typeof samples.toArray === 'function'
    ? samples.toArray()
    : Array.from(samples as unknown as readonly MeasurementSample[]);
}

function sampleAtRound(
  measurements: MeasurementState,
  endpointId: string,
  round: number,
): MeasurementSample | null {
  return sampleArray(measurements.endpoints[endpointId]).find((sample) => sample.round === round) ?? null;
}

function previousOkSample(
  measurements: MeasurementState,
  endpointId: string,
  round: number,
): MeasurementSample | null {
  const samples = sampleArray(measurements.endpoints[endpointId]);
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const sample = samples[i];
    if (sample && sample.round < round && sample.status === 'ok' && Number.isFinite(sample.latency)) {
      return sample;
    }
  }
  return null;
}

function sameDirectionWobble(selectedDrift: number | null, peerDelta: number | null): boolean {
  if (selectedDrift === null || peerDelta === null) return false;
  if (Math.abs(peerDelta) < 10) return false;
  return Math.sign(selectedDrift) === Math.sign(peerDelta);
}

function sourceAndPulse(input: BuildReportInstrumentLensInput): {
  readonly source: ReportLensSource;
  readonly pulse: PulseInspection | null;
} {
  if (input.pinnedPulse) return { source: 'pinned', pulse: input.pinnedPulse };
  if (input.selectionSource === 'significant' && input.significantPulse) {
    return { source: 'significant', pulse: input.significantPulse };
  }
  if (input.replayPulse) return { source: input.selectionSource, pulse: input.replayPulse };
  if (input.significantPulse) return { source: 'significant', pulse: input.significantPulse };
  return { source: 'none', pulse: null };
}

function reasonFor(source: ReportLensSource): string {
  switch (source) {
    case 'pinned':
      return 'Pinned pulse carried into the report.';
    case 'significant':
      return 'Chronoscope opened on the most significant detected moment.';
    case 'clicked':
      return 'Pulse selected from the orbital signature.';
    case 'scrub':
      return 'Replay moment selected by the scrubber.';
    case 'none':
      return 'No replay sample is selected yet.';
  }
}

function emptyLens(source: ReportLensSource): ReportInstrumentLens {
  return {
    selected: null,
    source,
    selectionReason: reasonFor(source),
    canReturnToReplay: source === 'pinned',
    moment: {
      roundLabel: 'No round selected',
      timeLabel: 'Replay unavailable',
      endpointLabel: 'No station',
      thresholdLabel: 'No trigger',
    },
    signal: {
      latencyLabel: '-',
      thresholdDeltaLabel: 'no sample',
      driftLabel: 'no adjacent ok sample',
      trendLabel: 'No adjacent ok sample',
    },
    peers: [],
    proof: {
      suggests: 'Chronoscope needs a successful replay sample before it can compare the field.',
      cannotProve: SHARED_LIMITATION,
    },
    orbitalSelection: null,
  };
}

function classifyPeer(input: {
  readonly endpoint: Endpoint;
  readonly endpointIndex: number;
  readonly selected: PulseInspection;
  readonly sample: MeasurementSample | null;
  readonly previous: MeasurementSample | null;
  readonly thresholdMs: number;
}): ReportLensPeer {
  const stationId = input.endpointIndex < STATION_IDS.length ? STATION_IDS[input.endpointIndex] : null;
  if (input.sample === null) {
    return {
      endpointId: input.endpoint.id,
      endpointLabel: input.endpoint.label,
      stationId,
      latency: null,
      status: 'missing',
      thresholdDelta: null,
      movement: 'missing',
    };
  }

  const okLatency = input.sample.status === 'ok' && Number.isFinite(input.sample.latency)
    ? Math.round(input.sample.latency)
    : null;
  const thresholdDelta = okLatency === null ? null : okLatency - Math.round(input.thresholdMs);
  const previousLatency = input.previous && Number.isFinite(input.previous.latency)
    ? Math.round(input.previous.latency)
    : null;
  const peerDelta = okLatency === null || previousLatency === null ? null : okLatency - previousLatency;
  let movement: ReportPeerMovement;
  if (input.endpoint.id === input.selected.endpointId) {
    movement = 'selected';
  } else if (input.sample.status !== 'ok' || okLatency === null || okLatency > input.thresholdMs) {
    movement = 'co-elevated';
  } else if (sameDirectionWobble(input.selected.drift, peerDelta)) {
    movement = 'wobble';
  } else {
    movement = 'steady';
  }

  return {
    endpointId: input.endpoint.id,
    endpointLabel: input.endpoint.label,
    stationId,
    latency: okLatency,
    status: input.sample.status,
    thresholdDelta,
    movement,
  };
}

function buildPeers(
  input: BuildReportInstrumentLensInput,
  selected: PulseInspection,
): readonly ReportLensPeer[] {
  const round = selected.roundNumber;
  if (round === null) return [];
  return input.endpoints
    .map((endpoint, endpointIndex) => classifyPeer({
      endpoint,
      endpointIndex,
      selected,
      sample: sampleAtRound(input.measurements, endpoint.id, round),
      previous: previousOkSample(input.measurements, endpoint.id, round),
      thresholdMs: input.thresholdMs,
    }))
    .sort((a, b) => {
      if (a.movement === 'selected') return -1;
      if (b.movement === 'selected') return 1;
      const aDelta = a.thresholdDelta ?? Number.NEGATIVE_INFINITY;
      const bDelta = b.thresholdDelta ?? Number.NEGATIVE_INFINITY;
      if (aDelta !== bDelta) return bDelta - aDelta;
      return a.endpointLabel.localeCompare(b.endpointLabel);
    });
}

function proofFor(
  selected: PulseInspection,
  peers: readonly ReportLensPeer[],
): ReportInstrumentLens['proof'] {
  const coElevatedCount = peers.filter((peer) => peer.movement === 'co-elevated').length;
  const selectedRound = selected.roundNumber === null ? 'this round' : `round #${selected.roundNumber}`;
  let suggests: string;
  if (coElevatedCount > 0) {
    suggests = `Multiple stations were elevated in ${selectedRound}, so this looks like shared field movement in browser evidence.`;
  } else if (selected.thresholdDelta > 0) {
    suggests = `${selected.endpointLabel} crossed the trigger while peers stayed below it in the same round.`;
  } else {
    suggests = `${selected.endpointLabel} stayed ${thresholdDeltaLabel(selected.thresholdDelta)} and serves as the selected reference sample.`;
  }
  return {
    suggests,
    cannotProve: SHARED_LIMITATION,
  };
}

function trendLabel(selected: PulseInspection): string {
  if (selected.drift === null) return 'No adjacent ok sample';
  return `${driftLabel(selected.drift)} from previous ok sample`;
}

function orbitalSelectionFor(
  selected: PulseInspection,
  peers: readonly ReportLensPeer[],
  windowSlots: number,
): ReportOrbitalSelection {
  return {
    selected: {
      stationId: selected.stationId,
      slot: selected.slot,
      roundNumber: selected.roundNumber,
    },
    peerStations: peers
      .filter((peer) =>
        peer.stationId !== null &&
        (peer.movement === 'selected' || peer.movement === 'co-elevated'),
      )
      .map((peer) => peer.stationId as string),
    angle: (selected.slot / Math.max(1, Math.round(windowSlots) - 1)) * Math.PI * 2 - Math.PI,
  };
}

export function buildReportInstrumentLens(input: BuildReportInstrumentLensInput): ReportInstrumentLens {
  void input.stats;
  const thresholdMs = Math.round(input.thresholdMs);
  const { source, pulse: selected } = sourceAndPulse(input);
  if (!selected || selected.roundNumber === null) return emptyLens(source);

  const peers = buildPeers(input, selected);
  return {
    selected,
    source,
    selectionReason: reasonFor(source),
    canReturnToReplay: source === 'pinned',
    moment: {
      roundLabel: `Round #${selected.roundNumber}`,
      timeLabel: selected.timeLabel ?? 'Replay position',
      endpointLabel: selected.endpointLabel,
      thresholdLabel: `${thresholdMs} ms trigger`,
    },
    signal: {
      latencyLabel: `${selected.latency} ms`,
      thresholdDeltaLabel: thresholdDeltaLabel(selected.thresholdDelta),
      driftLabel: driftLabel(selected.drift),
      trendLabel: trendLabel(selected),
    },
    peers,
    proof: proofFor(selected, peers),
    orbitalSelection: orbitalSelectionFor(selected, peers, input.windowSlots),
  };
}
