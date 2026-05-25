import type {
  Endpoint,
  MeasurementSample,
  MeasurementState,
  PulseInspection,
} from '$lib/types';
import type { DiagnosticReport } from './diagnostic-report';
import { displayRoundLabel } from './pulse-inspection';

export type DiagnosticEventTone = 'info' | 'watch' | 'degraded';
export type DiagnosticEventKind = 'threshold' | 'failure' | 'drift';

export interface DiagnosticNotableEvent {
  readonly kind: DiagnosticEventKind;
  readonly tone: DiagnosticEventTone;
  readonly endpointId: string;
  readonly endpointLabel: string;
  readonly roundNumber: number;
  readonly roundLabel: string;
  readonly latency: number | null;
  readonly thresholdDelta: number | null;
  readonly drift: number | null;
  readonly summary: string;
}

export interface DiagnosticEvidenceContract {
  readonly current: {
    readonly tone: DiagnosticEventTone;
    readonly headline: string;
    readonly detail: string;
  };
  readonly notableEvent: DiagnosticNotableEvent | null;
  readonly eventsByEndpoint: Readonly<Record<string, DiagnosticNotableEvent>>;
  readonly overview: {
    readonly headline: string;
    readonly notableLine: string;
    readonly nextLine: string;
  };
  readonly live: {
    readonly eventLine: string;
    readonly operationalLine: string;
  };
  readonly investigate: {
    readonly hypothesis: string;
    readonly detail: string;
    readonly evidence: readonly string[];
  };
  readonly report: {
    readonly headline: string;
    readonly lede: string;
  };
}

export interface BuildDiagnosticEvidenceContractInput {
  readonly report: DiagnosticReport;
  readonly endpoints: readonly Endpoint[];
  readonly measurements: MeasurementState;
  readonly thresholdMs: number;
  readonly significantPulse?: PulseInspection | null;
}

interface Candidate {
  readonly event: DiagnosticNotableEvent;
  readonly score: number;
}

function sampleArray(state: MeasurementState['endpoints'][string] | undefined): readonly MeasurementSample[] {
  const samples = state?.samples;
  if (!samples) return [];
  return typeof samples.toArray === 'function'
    ? samples.toArray()
    : Array.from(samples as unknown as readonly MeasurementSample[]);
}

function currentTone(report: DiagnosticReport): DiagnosticEventTone {
  switch (report.diagnosis.severity) {
    case 'degraded':
      return 'degraded';
    case 'watch':
      return 'watch';
    case 'healthy':
      return 'info';
  }
}

function currentStatusLabel(report: DiagnosticReport): string {
  if (report.diagnosis.kind === 'collecting') return 'collecting';
  if (report.diagnosis.severity === 'healthy') return 'healthy';
  if (report.diagnosis.severity === 'watch') return 'watch';
  return 'degraded';
}

function roundLabel(roundNumber: number): string {
  return displayRoundLabel(roundNumber);
}

function sentenceRoundReference(roundNumber: number): string {
  const label = roundLabel(roundNumber);
  return label === 'Initial sample' ? 'the initial sample' : label;
}

function overTriggerSummary(label: string, delta: number, roundNumber: number): string {
  return `${label} crossed the trigger by ${delta} ms at ${sentenceRoundReference(roundNumber)}.`;
}

function failureSummary(label: string, status: MeasurementSample['status'], roundNumber: number): string {
  return `${label} returned ${status} at ${sentenceRoundReference(roundNumber)}.`;
}

function driftSummary(label: string, drift: number, roundNumber: number): string {
  return `${label} moved ${Math.abs(drift)} ms from the previous ok sample at ${sentenceRoundReference(roundNumber)}.`;
}

function eventVerb(event: DiagnosticNotableEvent): string {
  switch (event.kind) {
    case 'threshold':
      return 'spiked';
    case 'failure':
      return 'failed';
    case 'drift':
      return 'wobbled';
  }
}

function candidateFromPulse(pulse: PulseInspection | null | undefined): Candidate | null {
  if (!pulse || pulse.endpointId === null || pulse.roundNumber === null) return null;
  if (pulse.thresholdDelta <= 0 && Math.abs(pulse.drift ?? 0) < 25) return null;
  const kind: DiagnosticEventKind = pulse.thresholdDelta > 0 ? 'threshold' : 'drift';
  const event: DiagnosticNotableEvent = {
    kind,
    tone: kind === 'threshold' ? 'degraded' : 'watch',
    endpointId: pulse.endpointId,
    endpointLabel: pulse.endpointLabel,
    roundNumber: pulse.roundNumber,
    roundLabel: roundLabel(pulse.roundNumber),
    latency: pulse.latency,
    thresholdDelta: pulse.thresholdDelta,
    drift: pulse.drift,
    summary: kind === 'threshold'
      ? overTriggerSummary(pulse.endpointLabel, pulse.thresholdDelta, pulse.roundNumber)
      : driftSummary(pulse.endpointLabel, pulse.drift ?? 0, pulse.roundNumber),
  };
  return {
    event,
    score: kind === 'threshold'
      ? 3_000 + pulse.thresholdDelta
      : 1_000 + Math.abs(pulse.drift ?? 0),
  };
}

function betterCandidate(next: Candidate | null, current: Candidate | null): Candidate | null {
  if (next === null) return current;
  if (current === null) return next;
  if (next.score !== current.score) return next.score > current.score ? next : current;
  return next.event.roundNumber > current.event.roundNumber ? next : current;
}

function candidatesForEndpoint(
  endpoint: Endpoint,
  samples: readonly MeasurementSample[],
  thresholdMs: number,
): Candidate | null {
  let best: Candidate | null = null;
  let previousOk: MeasurementSample | null = null;
  const roundedThreshold = Math.round(thresholdMs);

  for (const sample of samples) {
    if (!Number.isFinite(sample.round)) continue;
    const roundNumber = Math.round(sample.round);
    let candidate: Candidate | null = null;

    if (sample.status !== 'ok') {
      const event: DiagnosticNotableEvent = {
        kind: 'failure',
        tone: 'degraded',
        endpointId: endpoint.id,
        endpointLabel: endpoint.label,
        roundNumber,
        roundLabel: roundLabel(roundNumber),
        latency: null,
        thresholdDelta: null,
        drift: null,
        summary: failureSummary(endpoint.label, sample.status, roundNumber),
      };
      candidate = { event, score: 2_800 + roundNumber / 1_000 };
    } else if (Number.isFinite(sample.latency)) {
      const latency = Math.round(sample.latency);
      const thresholdDelta = latency - roundedThreshold;
      const drift = previousOk && Number.isFinite(previousOk.latency)
        ? latency - Math.round(previousOk.latency)
        : null;

      if (thresholdDelta > 0) {
        const event: DiagnosticNotableEvent = {
          kind: 'threshold',
          tone: 'degraded',
          endpointId: endpoint.id,
          endpointLabel: endpoint.label,
          roundNumber,
          roundLabel: roundLabel(roundNumber),
          latency,
          thresholdDelta,
          drift,
          summary: overTriggerSummary(endpoint.label, thresholdDelta, roundNumber),
        };
        candidate = { event, score: 3_000 + thresholdDelta + Math.abs(drift ?? 0) / 10 };
      } else if (drift !== null && Math.abs(drift) >= 25) {
        const event: DiagnosticNotableEvent = {
          kind: 'drift',
          tone: 'watch',
          endpointId: endpoint.id,
          endpointLabel: endpoint.label,
          roundNumber,
          roundLabel: roundLabel(roundNumber),
          latency,
          thresholdDelta,
          drift,
          summary: driftSummary(endpoint.label, drift, roundNumber),
        };
        candidate = { event, score: 1_000 + Math.abs(drift) + roundNumber / 1_000 };
      }

      previousOk = sample;
    }

    best = betterCandidate(candidate, best);
  }

  return best;
}

function buildEvents(input: BuildDiagnosticEvidenceContractInput): {
  readonly notableEvent: DiagnosticNotableEvent | null;
  readonly eventsByEndpoint: Readonly<Record<string, DiagnosticNotableEvent>>;
} {
  let best = candidateFromPulse(input.significantPulse);
  const byEndpoint: Record<string, DiagnosticNotableEvent> = {};
  for (const endpoint of input.endpoints.filter((candidate) => candidate.enabled).slice(0, 4)) {
    const candidate = candidatesForEndpoint(
      endpoint,
      sampleArray(input.measurements.endpoints[endpoint.id]),
      input.thresholdMs,
    );
    if (candidate) byEndpoint[endpoint.id] = candidate.event;
    best = betterCandidate(candidate, best);
  }
  return {
    notableEvent: best?.event ?? null,
    eventsByEndpoint: byEndpoint,
  };
}

function overviewHeadline(currentLabel: string, event: DiagnosticNotableEvent | null): string {
  if (event && currentLabel === 'healthy') {
    return `Currently healthy; notable ${event.endpointLabel} ${eventVerb(event)}.`;
  }
  if (event && currentLabel === 'degraded') {
    return `Degraded now; ${event.endpointLabel} ${eventVerb(event)} in the evidence.`;
  }
  if (event && currentLabel === 'watch') {
    return `Watch state; ${event.endpointLabel} ${eventVerb(event)} in the window.`;
  }
  if (currentLabel === 'healthy') return 'This test looks healthy.';
  if (currentLabel === 'collecting') return 'Collecting enough data to call this test.';
  return `Current status: ${currentLabel}.`;
}

function nextLine(report: DiagnosticReport): string {
  const validation = report.diagnosis.primaryValidation;
  return `Next validation: ${validation.label}. ${validation.reason}`;
}

function investigateFor(
  report: DiagnosticReport,
  event: DiagnosticNotableEvent | null,
): DiagnosticEvidenceContract['investigate'] {
  if (!event) {
    return {
      hypothesis: 'Working hypothesis: field is stable',
      detail: 'No threshold crossing, failed request, or large drift stands out in the current evidence window.',
      evidence: [
        report.diagnosis.supportingSummary,
        report.diagnosis.timingVisibility.headline,
      ],
    };
  }

  if (event.kind === 'threshold') {
    return {
      hypothesis: 'Working hypothesis: endpoint spike needs validation',
      detail: `${event.endpointLabel} crossed the configured trigger while the current status may already have recovered.`,
      evidence: [
        event.summary,
        `Current verdict: ${report.diagnosis.primaryAnswer.text}`,
        report.diagnosis.timingVisibility.headline,
      ],
    };
  }

  if (event.kind === 'failure') {
    return {
      hypothesis: 'Working hypothesis: request failure needs route validation',
      detail: `${event.endpointLabel} failed in-browser; an outside vantage can separate endpoint, path, and browser limits.`,
      evidence: [
        event.summary,
        report.diagnosis.timingVisibility.headline,
        report.diagnosis.limitations[0]?.headline ?? 'Browser evidence is limited',
      ],
    };
  }

  return {
    hypothesis: 'Working hypothesis: jitter watch',
    detail: `${event.endpointLabel} moved sharply without crossing the trigger, so the next question is whether the wobble repeats.`,
    evidence: [
      event.summary,
      `Current verdict: ${report.diagnosis.primaryAnswer.text}`,
      'Repeat or outside-vantage evidence will decide whether this is local noise or endpoint-side variance.',
    ],
  };
}

export function buildDiagnosticEvidenceContract(
  input: BuildDiagnosticEvidenceContractInput,
): DiagnosticEvidenceContract {
  const currentLabel = currentStatusLabel(input.report);
  const current = {
    tone: currentTone(input.report),
    headline: `Current status: ${currentLabel}`,
    detail: input.report.diagnosis.primaryAnswer.text,
  } as const;
  const { notableEvent, eventsByEndpoint } = buildEvents(input);
  const notableLine = notableEvent
    ? `Notable event: ${notableEvent.summary}`
    : 'No notable threshold event detected in this window.';
  const liveEventLine = notableEvent
    ? `Notable event: ${notableEvent.summary}`
    : 'No notable event in the active window.';
  const reportHeadline = notableEvent
    ? `${currentLabel === 'healthy' ? 'Currently healthy' : currentLabel}; ${notableEvent.endpointLabel} ${eventVerb(notableEvent)} during the recording.`
    : current.detail;

  return {
    current,
    notableEvent,
    eventsByEndpoint,
    overview: {
      headline: overviewHeadline(currentLabel, notableEvent),
      notableLine,
      nextLine: nextLine(input.report),
    },
    live: {
      eventLine: liveEventLine,
      operationalLine: notableEvent
        ? 'Live stays anchored to the current round; use Investigate or Report to compare the event against peers.'
        : 'Live is anchored to the current round; pin a pulse to carry evidence into station detail and Report.',
    },
    investigate: investigateFor(input.report, notableEvent),
    report: {
      headline: reportHeadline,
      lede: notableEvent
        ? `The report separates the current verdict from the strongest recorded event: ${notableEvent.summary}`
        : 'The report found no separate notable event beyond the current verdict.',
    },
  };
}
