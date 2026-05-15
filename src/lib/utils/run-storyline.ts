import type { Endpoint, MeasurementSample } from '../types';

const WINDOW_MS = 5 * 60 * 1000;
const CORRELATION_WINDOW_MS = 15_000;
const CORRELATION_HALF_WINDOW_MS = CORRELATION_WINDOW_MS / 2;
const MAX_RENDER_ROUNDS = 120;
const DEFAULT_MAX_ROWS = 4;
const MIN_RENDER_SAMPLES = 8;
const MEDIUM_CONFIDENCE_SAMPLES = 16;
const HIGH_CONFIDENCE_SAMPLES = 24;
const ELEVATED_MIN_DELTA_MS = 75;
const ELEVATED_FACTOR = 1.75;

export type RunStorylineConfidence = 'collecting' | 'low' | 'medium' | 'high';
export type StoryPhaseKind = 'collecting' | 'steady' | 'isolated-slow' | 'shared-slow' | 'failure' | 'recovered';
export type TimelinePointStatus = 'ok' | 'elevated' | 'slow' | 'failed' | 'unknown';
export type StoryMarkerKind = 'elevation' | 'slowdown' | 'failure' | 'recovery' | 'shared-change';
export type StoryBeatKind = StoryMarkerKind | 'shared-slowdown';
export type StoryBeatSeverity = 'info' | 'watch' | 'bad' | 'good';

export interface BuildRunStorylineInput {
  readonly endpoints: readonly Endpoint[];
  readonly samplesByEndpoint: Readonly<Record<string, readonly MeasurementSample[]>>;
  readonly threshold: number;
  readonly runStart?: number | null;
  readonly now?: number;
  readonly focusedEndpointId?: string | null;
  readonly maxVisibleRows?: number;
}

export interface RunStoryline {
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly phases: readonly StoryPhase[];
  readonly rows: readonly EndpointTimelineRow[];
  readonly overflow: EndpointTimelineOverflow | null;
  readonly markers: readonly StoryMarker[];
  readonly beats: readonly StoryBeat[];
  readonly summary: string;
  readonly confidence: RunStorylineConfidence;
  readonly sampleCount: number;
  readonly readyEndpointCount: number;
}

export interface StoryPhase {
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly kind: StoryPhaseKind;
}

export interface EndpointTimelineRow {
  readonly endpointId: string;
  readonly label: string;
  readonly color: string;
  readonly summary: string;
  readonly points: readonly TimelinePoint[];
}

export interface TimelinePoint {
  readonly t: number;
  readonly round: number;
  readonly latency: number | null;
  readonly normalizedLatency: number | null;
  readonly status: TimelinePointStatus;
  readonly threshold: number;
  readonly sampleCount: number;
}

export interface StoryMarker {
  readonly t: number;
  readonly round?: number;
  readonly endpointId?: string;
  readonly kind: StoryMarkerKind;
  readonly label: string;
  readonly evidence: string;
}

export interface StoryBeat {
  readonly id: string;
  readonly t: number;
  readonly kind: StoryBeatKind;
  readonly severity: StoryBeatSeverity;
  readonly label: string;
  readonly shortLabel: string;
  readonly endpointIds: readonly string[];
  readonly evidence: string;
  readonly markerCount: number;
}

export interface EndpointTimelineOverflow {
  readonly hiddenCount: number;
  readonly summary: string;
}

interface FullEndpointRow extends EndpointTimelineRow {
  readonly allPoints: readonly TimelinePoint[];
  readonly markers: readonly StoryMarker[];
  readonly eventScore: number;
  readonly lastEventAt: number;
}

interface PatternSelection {
  readonly kind: 'collecting' | 'steady' | 'isolated' | 'shared' | 'failure' | 'elevated';
  readonly primaryEndpointId?: string;
  readonly primaryLabel?: string;
  readonly eventAt?: number;
  readonly recoveryAt?: number;
}

export function buildRunStoryline(input: BuildRunStorylineInput): RunStoryline {
  const now = input.now ?? Date.now();
  const latestSampleAt = latestTimestamp(input.samplesByEndpoint);
  const windowEnd = latestSampleAt ?? now;
  const windowStart = Math.max(input.runStart ?? Number.NEGATIVE_INFINITY, windowEnd - WINDOW_MS);
  const maxVisibleRows = Math.max(1, input.maxVisibleRows ?? DEFAULT_MAX_ROWS);

  const fullRows = input.endpoints.map((endpoint) => buildEndpointRow({
    endpoint,
    samples: input.samplesByEndpoint[endpoint.id] ?? [],
    threshold: input.threshold,
    windowStart,
    windowEnd,
  }));

  const sampleCount = fullRows.reduce((sum, row) => sum + row.allPoints.length, 0);
  const readyRows = fullRows.filter((row) => row.allPoints.length >= MIN_RENDER_SAMPLES);
  const readyEndpointCount = readyRows.length;
  const allMarkers = fullRows.flatMap((row) => row.markers);
  const markers = allMarkers.sort((a, b) => a.t - b.t);
  const beats = beatsFor(markers, fullRows);
  const confidence = confidenceFor(readyRows, markers);
  const pattern = selectPattern({ rows: fullRows, markers, confidence });
  const summary = summaryFor({ pattern, rows: fullRows, markers, confidence });
  const phases = phasesFor({
    pattern,
    windowStart,
    windowEnd,
    markers,
  });
  const { rows, overflow } = visibleRows({
    rows: fullRows,
    markers,
    focusedEndpointId: input.focusedEndpointId ?? null,
    maxVisibleRows,
  });

  return {
    windowStart,
    windowEnd,
    phases,
    rows,
    overflow,
    markers,
    beats,
    summary,
    confidence,
    sampleCount,
    readyEndpointCount,
  };
}

function buildEndpointRow(input: {
  readonly endpoint: Endpoint;
  readonly samples: readonly MeasurementSample[];
  readonly threshold: number;
  readonly windowStart: number;
  readonly windowEnd: number;
}): FullEndpointRow {
  const windowSamples = input.samples
    .filter((sample) => sample.timestamp >= input.windowStart && sample.timestamp <= input.windowEnd)
    .sort((a, b) => a.timestamp - b.timestamp || a.round - b.round);
  const renderRounds = newestRounds(windowSamples, MAX_RENDER_ROUNDS);
  const allPoints = classifySamples(windowSamples, input.threshold);
  const renderPoints = allPoints.filter((point) => renderRounds.has(point.round));
  const normalizedPoints = normalizePoints(renderPoints, input.threshold);
  const rowMarkers = markersForPoints(input.endpoint.label, input.endpoint.id, allPoints, input.threshold);
  const summary = rowSummary(input.endpoint.label, normalizedPoints, rowMarkers);
  const eventScore = eventScoreFor(normalizedPoints, rowMarkers);
  const lastEventAt = rowMarkers.reduce((latest, marker) => Math.max(latest, marker.t), 0);

  return {
    endpointId: input.endpoint.id,
    label: input.endpoint.label,
    color: input.endpoint.color,
    summary,
    points: normalizedPoints,
    allPoints,
    markers: rowMarkers,
    eventScore,
    lastEventAt,
  };
}

function classifySamples(samples: readonly MeasurementSample[], threshold: number): TimelinePoint[] {
  const previousOkLatencies: number[] = [];
  const points: TimelinePoint[] = [];

  for (const sample of samples) {
    let latency: number | null = null;
    let status: TimelinePointStatus = 'unknown';

    if (sample.status === 'ok' && Number.isFinite(sample.latency)) {
      latency = sample.latency;
      if (sample.latency > threshold) {
        status = 'slow';
      } else if (previousOkLatencies.length >= 8 && isElevated(sample.latency, previousOkLatencies)) {
        status = 'elevated';
      } else {
        status = 'ok';
      }
      previousOkLatencies.push(sample.latency);
    } else {
      status = 'failed';
    }

    points.push({
      t: sample.timestamp,
      round: sample.round,
      latency,
      normalizedLatency: null,
      status,
      threshold,
      sampleCount: points.length + 1,
    });
  }

  return points;
}

function normalizePoints(points: readonly TimelinePoint[], threshold: number): TimelinePoint[] {
  const maxLatency = Math.max(
    threshold,
    ...points
      .map((point) => point.latency ?? 0)
      .filter((latency) => Number.isFinite(latency)),
  );
  const ceiling = Math.max(1, maxLatency * 1.1);
  return points.map((point) => ({
    ...point,
    normalizedLatency: point.latency == null ? null : Math.max(0, Math.min(1, point.latency / ceiling)),
  }));
}

function isElevated(latency: number, previousOkLatencies: readonly number[]): boolean {
  const previousEight = previousOkLatencies.slice(-8);
  if (previousEight.length < 8) return false;
  const baseline = median(previousEight);
  if (baseline <= 0) return false;
  return latency - baseline >= ELEVATED_MIN_DELTA_MS && latency >= baseline * ELEVATED_FACTOR;
}

function markersForPoints(label: string, endpointId: string, points: readonly TimelinePoint[], threshold: number): StoryMarker[] {
  const markers: StoryMarker[] = [];
  let inProblem = false;
  let normalAfterProblem = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const recent = points.slice(Math.max(0, i - 2), i + 1);
    const slowCount = recent.filter((candidate) => candidate.status === 'slow').length;

    if (point.status === 'failed') {
      markers.push({
        t: point.t,
        round: point.round,
        endpointId,
        kind: 'failure',
        label: `${label} failed`,
        evidence: `${label} returned a timeout or error sample.`,
      });
      inProblem = true;
      normalAfterProblem = 0;
      continue;
    }

    if (slowCount >= 2 && !inProblem) {
      markers.push({
        t: point.t,
        round: point.round,
        endpointId,
        kind: 'slowdown',
        label: `${label} slow`,
        evidence: `${label} had ${slowCount} of the last ${recent.length} samples above ${Math.round(threshold)} ms.`,
      });
      inProblem = true;
      normalAfterProblem = 0;
      continue;
    }

    if (point.status === 'slow') {
      normalAfterProblem = 0;
      continue;
    }

    if (point.status === 'ok' || point.status === 'elevated') {
      if (inProblem) {
        normalAfterProblem++;
        if (normalAfterProblem >= 3) {
          markers.push({
            t: point.t,
            round: point.round,
            endpointId,
            kind: 'recovery',
            label: `${label} recovered`,
            evidence: `${label} had three consecutive samples back at or below ${Math.round(threshold)} ms.`,
          });
          inProblem = false;
          normalAfterProblem = 0;
        }
      }
    } else {
      normalAfterProblem = 0;
    }
  }

  return markers;
}

function selectPattern(input: {
  readonly rows: readonly FullEndpointRow[];
  readonly markers: readonly StoryMarker[];
  readonly confidence: RunStorylineConfidence;
}): PatternSelection {
  if (input.confidence === 'collecting') return { kind: 'collecting' };

  const slowdownMarkers = input.markers.filter((marker) => marker.kind === 'slowdown');
  const shared = sharedSlowdown(slowdownMarkers);
  if (shared) {
    return {
      kind: 'shared',
      eventAt: shared.t,
      recoveryAt: recoveryAfter(input.markers, shared.t),
    };
  }

  const isolated = isolatedSlowdown(input.rows, slowdownMarkers);
  if (isolated) {
    const row = input.rows.find((candidate) => candidate.endpointId === isolated.endpointId);
    return {
      kind: 'isolated',
      primaryEndpointId: isolated.endpointId,
      primaryLabel: row?.label ?? isolated.endpointId,
      eventAt: isolated.t,
      recoveryAt: recoveryAfter(input.markers, isolated.t, isolated.endpointId),
    };
  }

  const failure = input.markers.find((marker) => marker.kind === 'failure');
  if (failure) {
    const row = input.rows.find((candidate) => candidate.endpointId === failure.endpointId);
    return {
      kind: 'failure',
      primaryEndpointId: failure.endpointId,
      primaryLabel: row?.label ?? failure.endpointId,
      eventAt: failure.t,
      recoveryAt: recoveryAfter(input.markers, failure.t, failure.endpointId),
    };
  }

  const elevatedRow = input.rows.find((row) => row.allPoints.some((point) => point.status === 'elevated'));
  if (elevatedRow) {
    return {
      kind: 'elevated',
      primaryEndpointId: elevatedRow.endpointId,
      primaryLabel: elevatedRow.label,
      eventAt: elevatedRow.allPoints.find((point) => point.status === 'elevated')?.t,
    };
  }

  return { kind: 'steady' };
}

function summaryFor(input: {
  readonly pattern: PatternSelection;
  readonly rows: readonly FullEndpointRow[];
  readonly markers: readonly StoryMarker[];
  readonly confidence: RunStorylineConfidence;
}): string {
  if (input.pattern.kind === 'collecting') return 'Collecting enough samples to show what changed.';
  if (input.pattern.kind === 'steady') return 'No meaningful changes in the current window.';

  const label = input.pattern.primaryLabel ?? 'One path';

  if (input.pattern.kind === 'elevated') {
    return `${label} had a possible brief rise below the trigger; more samples will improve confidence.`;
  }

  if (input.pattern.kind === 'failure') {
    return `${label} had a failed request; the other paths stayed reachable.`;
  }

  if (input.pattern.kind === 'shared') {
    if (input.pattern.recoveryAt != null) return 'Multiple paths slowed together, then recovered.';
    return 'Multiple paths slowed together, then stayed above the trigger.';
  }

  if (input.pattern.kind === 'isolated') {
    if (input.confidence === 'low') {
      return `${label} had an early signal above the trigger; more samples will improve confidence.`;
    }
    if (input.pattern.recoveryAt != null) return `${label} slowed briefly, then recovered.`;
    return `${label} slowed briefly; the other paths stayed clean.`;
  }

  return 'No meaningful changes in the current window.';
}

function phasesFor(input: {
  readonly pattern: PatternSelection;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly markers: readonly StoryMarker[];
}): StoryPhase[] {
  if (input.pattern.kind === 'collecting') {
    return [{ start: input.windowStart, end: input.windowEnd, label: 'collecting', kind: 'collecting' }];
  }
  if (input.pattern.kind === 'steady' || input.pattern.kind === 'elevated') {
    return [{ start: input.windowStart, end: input.windowEnd, label: 'steady', kind: 'steady' }];
  }

  const eventAt = clampTime(input.pattern.eventAt ?? input.windowStart, input.windowStart, input.windowEnd);
  const recoveryAt = input.pattern.recoveryAt == null
    ? null
    : clampTime(input.pattern.recoveryAt, input.windowStart, input.windowEnd);
  const recoveryStart = recoveryAt == null
    ? null
    : recoveryAt >= input.windowEnd
      ? Math.max(eventAt, input.windowEnd - 1_000)
      : recoveryAt;
  const problemEnd = recoveryStart ?? input.windowEnd;
  const phases: StoryPhase[] = [];

  addPhase(phases, input.windowStart, eventAt, 'steady', 'steady');
  if (input.pattern.kind === 'shared') {
    addPhase(phases, eventAt, problemEnd, 'paths slow', 'shared-slow');
  } else if (input.pattern.kind === 'isolated') {
    addPhase(phases, eventAt, problemEnd, `${input.pattern.primaryLabel ?? 'path'} slow`, 'isolated-slow');
  } else if (input.pattern.kind === 'failure') {
    addPhase(phases, eventAt, problemEnd, `${input.pattern.primaryLabel ?? 'path'} failed`, 'failure');
  }
  if (recoveryStart != null) addPhase(phases, recoveryStart, input.windowEnd, 'recovered', 'recovered');

  return phases.length > 0 ? phases : [{ start: input.windowStart, end: input.windowEnd, label: 'steady', kind: 'steady' }];
}

function visibleRows(input: {
  readonly rows: readonly FullEndpointRow[];
  readonly markers: readonly StoryMarker[];
  readonly focusedEndpointId: string | null;
  readonly maxVisibleRows: number;
}): { readonly rows: readonly EndpointTimelineRow[]; readonly overflow: EndpointTimelineOverflow | null } {
  const order = new Map(input.rows.map((row, index) => [row.endpointId, index]));
  const sorted = [...input.rows].sort((a, b) => {
    if (b.eventScore !== a.eventScore) return b.eventScore - a.eventScore;
    if (b.lastEventAt !== a.lastEventAt) return b.lastEventAt - a.lastEventAt;
    if (input.focusedEndpointId != null) {
      if (a.endpointId === input.focusedEndpointId) return -1;
      if (b.endpointId === input.focusedEndpointId) return 1;
    }
    return (order.get(a.endpointId) ?? 0) - (order.get(b.endpointId) ?? 0);
  });
  const visible = sorted.slice(0, input.maxVisibleRows);
  const hidden = sorted.slice(input.maxVisibleRows);
  const visibleRowsOnly = visible.map(stripInternalRow);
  if (hidden.length === 0) return { rows: visibleRowsOnly, overflow: null };

  const hiddenEventful = hidden.filter((row) => row.eventScore >= 2).length;
  const hiddenCount = hidden.length;
  const hiddenFailureCount = hidden.filter((row) => row.markers.some((marker) => marker.kind === 'failure')).length;
  const hiddenSlowCount = hidden.filter((row) => row.markers.some((marker) => marker.kind === 'slowdown')).length;
  const hiddenElevatedCount = hidden.filter((row) => (
    !row.markers.some((marker) => marker.kind === 'failure' || marker.kind === 'slowdown') &&
    row.allPoints.some((point) => point.status === 'elevated')
  )).length;
  const summary = hiddenFailureCount > 0 || hiddenSlowCount > 0 || hiddenElevatedCount > 0
    ? overflowEventSummary({ failed: hiddenFailureCount, slowed: hiddenSlowCount, elevated: hiddenElevatedCount })
    : hiddenEventful > 0
      ? `${hiddenEventful} more ${pathWord(hiddenEventful)} also changed.`
    : `${hiddenCount} more ${pathWord(hiddenCount)} steady.`;

  return {
    rows: visibleRowsOnly,
    overflow: { hiddenCount, summary },
  };
}

function stripInternalRow(row: FullEndpointRow): EndpointTimelineRow {
  return {
    endpointId: row.endpointId,
    label: row.label,
    color: row.color,
    summary: row.summary,
    points: row.points,
  };
}

function confidenceFor(rows: readonly FullEndpointRow[], markers: readonly StoryMarker[]): RunStorylineConfidence {
  if (rows.length === 0) return 'collecting';
  if (rows.length < 2 || rows.some((row) => row.allPoints.length < MEDIUM_CONFIDENCE_SAMPLES)) return 'low';
  if (
    rows.length >= 3 &&
    rows.every((row) => row.allPoints.length >= HIGH_CONFIDENCE_SAMPLES) &&
    hasRepeatedSharedPattern(markers)
  ) {
    return 'high';
  }
  return 'medium';
}

function sharedSlowdown(markers: readonly StoryMarker[]): StoryMarker | null {
  for (const marker of markers) {
    const endpointIds = new Set(
      markers
        .filter((candidate) => Math.abs(candidate.t - marker.t) <= CORRELATION_WINDOW_MS)
        .map((candidate) => candidate.endpointId)
        .filter((endpointId): endpointId is string => endpointId != null),
    );
    if (endpointIds.size >= 2) return marker;
  }
  return null;
}

function isolatedSlowdown(
  rows: readonly FullEndpointRow[],
  markers: readonly StoryMarker[],
): StoryMarker | null {
  const readyRows = rows.filter((row) => row.allPoints.length >= MIN_RENDER_SAMPLES);
  if (readyRows.length < 2) return null;

  for (const marker of markers) {
    const nearby = markers.filter((candidate) => Math.abs(candidate.t - marker.t) <= CORRELATION_WINDOW_MS);
    const nearbyEndpointIds = new Set(nearby.map((candidate) => candidate.endpointId));
    if (nearbyEndpointIds.size !== 1) continue;
    const otherRows = readyRows.filter((row) => row.endpointId !== marker.endpointId);
    const normalRows = otherRows.filter((row) => hasNormalSampleNear(row, marker.t));
    if (normalRows.length >= Math.ceil(otherRows.length / 2)) return marker;
  }
  return null;
}

function hasNormalSampleNear(row: FullEndpointRow, t: number): boolean {
  return row.allPoints.some((point) => (
    Math.abs(point.t - t) <= CORRELATION_HALF_WINDOW_MS &&
    (point.status === 'ok' || point.status === 'elevated') &&
    point.latency != null &&
    point.latency <= point.threshold
  ));
}

function recoveryAfter(markers: readonly StoryMarker[], t: number, endpointId?: string): number | undefined {
  return markers.find((marker) => (
    marker.kind === 'recovery' &&
    marker.t > t &&
    (endpointId == null || marker.endpointId === endpointId)
  ))?.t;
}

function beatsFor(markers: readonly StoryMarker[], rows: readonly FullEndpointRow[]): StoryBeat[] {
  const sorted = [...markers].sort((a, b) => a.t - b.t);
  const clusters: StoryMarker[][] = [];

  for (const marker of sorted) {
    if (marker.kind === 'recovery') {
      clusters.push([marker]);
      continue;
    }

    const last = clusters[clusters.length - 1];
    const canJoinLast = last !== undefined &&
      last.every((candidate) => candidate.kind !== 'recovery') &&
      marker.t - last[0].t <= CORRELATION_WINDOW_MS;
    if (canJoinLast) {
      last.push(marker);
    } else {
      clusters.push([marker]);
    }
  }

  return clusters.map((cluster) => beatForCluster(cluster, rows));
}

function beatForCluster(cluster: readonly StoryMarker[], rows: readonly FullEndpointRow[]): StoryBeat {
  const endpointIds = uniqueEndpointIds(cluster);
  const endpointLabel = labelForEndpoint(endpointIds[0], rows);
  const failureMarkers = cluster.filter((marker) => marker.kind === 'failure');
  const slowdownMarkers = cluster.filter((marker) => marker.kind === 'slowdown');
  const recoveryMarkers = cluster.filter((marker) => marker.kind === 'recovery');
  const elevationMarkers = cluster.filter((marker) => marker.kind === 'elevation');
  const sharedChangeMarkers = cluster.filter((marker) => marker.kind === 'shared-change');
  const t = cluster[0]?.t ?? 0;

  if (failureMarkers.length > 0) {
    const count = endpointIds.length;
    const label = count > 1 ? `${count} paths failed` : `${endpointLabel} failed`;
    return {
      id: beatId('failure', endpointIds, t),
      t,
      kind: 'failure',
      severity: 'bad',
      label,
      shortLabel: label,
      endpointIds,
      evidence: count > 1
        ? `${count} endpoints returned timeout or error samples within 15 seconds.`
        : failureMarkers[0]?.evidence ?? 'A path returned a timeout or error sample.',
      markerCount: cluster.length,
    };
  }

  if (slowdownMarkers.length > 1 && endpointIds.length > 1) {
    const count = endpointIds.length;
    return {
      id: beatId('shared-slowdown', endpointIds, t),
      t,
      kind: 'shared-slowdown',
      severity: 'bad',
      label: `${count} paths slowed together`,
      shortLabel: `${count} paths slow`,
      endpointIds,
      evidence: `${count} endpoints crossed the trigger within 15 seconds.`,
      markerCount: cluster.length,
    };
  }

  if (slowdownMarkers.length > 0) {
    const label = `${endpointLabel} slow`;
    return {
      id: beatId('slowdown', endpointIds, t),
      t,
      kind: 'slowdown',
      severity: 'bad',
      label,
      shortLabel: label,
      endpointIds,
      evidence: slowdownMarkers[0]?.evidence ?? `${endpointLabel} crossed the trigger.`,
      markerCount: cluster.length,
    };
  }

  if (recoveryMarkers.length > 0) {
    const count = endpointIds.length;
    const label = count > 1 ? `${count} paths recovered` : `${endpointLabel} recovered`;
    return {
      id: beatId('recovery', endpointIds, t),
      t,
      kind: 'recovery',
      severity: 'good',
      label,
      shortLabel: label,
      endpointIds,
      evidence: count > 1
        ? `${count} endpoints returned to the configured threshold.`
        : recoveryMarkers[0]?.evidence ?? `${endpointLabel} returned to the configured threshold.`,
      markerCount: cluster.length,
    };
  }

  if (elevationMarkers.length > 0) {
    const label = `${endpointLabel} rose`;
    return {
      id: beatId('elevation', endpointIds, t),
      t,
      kind: 'elevation',
      severity: 'watch',
      label,
      shortLabel: label,
      endpointIds,
      evidence: elevationMarkers[0]?.evidence ?? `${endpointLabel} rose below the trigger.`,
      markerCount: cluster.length,
    };
  }

  const label = endpointIds.length > 1 ? `${endpointIds.length} paths changed` : `${endpointLabel} changed`;
  return {
    id: beatId('shared-change', endpointIds, t),
    t,
    kind: sharedChangeMarkers[0]?.kind ?? 'shared-change',
    severity: 'info',
    label,
    shortLabel: label,
    endpointIds,
    evidence: sharedChangeMarkers[0]?.evidence ?? 'A browser-visible event changed in the current window.',
    markerCount: cluster.length,
  };
}

function beatId(kind: StoryBeatKind, endpointIds: readonly string[], t: number): string {
  return `${kind}-${endpointIds.length > 0 ? endpointIds.join('-') : 'all'}-${t}`;
}

function uniqueEndpointIds(markers: readonly StoryMarker[]): string[] {
  const out: string[] = [];
  for (const marker of markers) {
    if (marker.endpointId == null || out.includes(marker.endpointId)) continue;
    out.push(marker.endpointId);
  }
  return out;
}

function labelForEndpoint(endpointId: string | undefined, rows: readonly FullEndpointRow[]): string {
  if (endpointId === undefined) return 'One path';
  return rows.find((row) => row.endpointId === endpointId)?.label ?? endpointId;
}

function hasRepeatedSharedPattern(markers: readonly StoryMarker[]): boolean {
  const slowdownMarkers = markers.filter((marker) => marker.kind === 'slowdown');
  const buckets = new Map<number, Set<string>>();
  for (const marker of slowdownMarkers) {
    if (marker.endpointId == null) continue;
    const bucket = Math.floor(marker.t / CORRELATION_WINDOW_MS);
    const set = buckets.get(bucket) ?? new Set<string>();
    set.add(marker.endpointId);
    buckets.set(bucket, set);
  }
  const sharedBuckets = [...buckets.entries()]
    .filter(([, set]) => set.size >= 2)
    .map(([bucket]) => bucket)
    .sort((a, b) => a - b);
  for (let i = 1; i < sharedBuckets.length; i++) {
    if (sharedBuckets[i] === sharedBuckets[i - 1] + 1) return true;
  }
  return false;
}

function rowSummary(label: string, points: readonly TimelinePoint[], markers: readonly StoryMarker[]): string {
  if (markers.some((marker) => marker.kind === 'failure')) return `${label} had a failed request.`;
  if (markers.some((marker) => marker.kind === 'slowdown')) return `${label} crossed the trigger.`;
  if (points.some((point) => point.status === 'elevated')) return `${label} rose below the trigger.`;
  if (points.length === 0) return `${label} has no recent samples.`;
  return `${label} stayed clean.`;
}

function eventScoreFor(points: readonly TimelinePoint[], markers: readonly StoryMarker[]): number {
  if (markers.some((marker) => marker.kind === 'failure')) return 4;
  if (markers.some((marker) => marker.kind === 'slowdown')) return 3;
  if (markers.some((marker) => marker.kind === 'recovery')) return 2;
  if (points.some((point) => point.status === 'elevated')) return 1;
  return 0;
}

function newestRounds(samples: readonly MeasurementSample[], maxRounds: number): Set<number> {
  const rounds = [...new Set(samples.map((sample) => sample.round))].sort((a, b) => a - b);
  return new Set(rounds.slice(-maxRounds));
}

function latestTimestamp(samplesByEndpoint: Readonly<Record<string, readonly MeasurementSample[]>>): number | null {
  let latest: number | null = null;
  for (const samples of Object.values(samplesByEndpoint)) {
    for (const sample of samples) {
      if (latest === null || sample.timestamp > latest) latest = sample.timestamp;
    }
  }
  return latest;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function addPhase(phases: StoryPhase[], start: number, end: number, label: string, kind: StoryPhaseKind): void {
  if (end <= start) return;
  phases.push({ start, end, label, kind });
}

function clampTime(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pathWord(count: number): string {
  return count === 1 ? 'path' : 'paths';
}

function overflowEventSummary(counts: { readonly failed: number; readonly slowed: number; readonly elevated: number }): string {
  const parts: string[] = [];
  if (counts.failed > 0) parts.push(`${counts.failed} more ${pathWord(counts.failed)} failed`);
  if (counts.slowed > 0) parts.push(`${counts.slowed} more ${pathWord(counts.slowed)} slowed`);
  if (counts.elevated > 0) parts.push(`${counts.elevated} more ${pathWord(counts.elevated)} rose below trigger`);
  return `${parts.join(', ')}.`;
}
