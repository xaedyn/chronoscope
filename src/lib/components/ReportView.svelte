<!-- src/lib/components/ReportView.svelte -->
<!-- Vessel v4 Report surface — completed-session signature. Translates the
     markup of proposals/v4/proposal-report-v4.html (the cinematic field
     recording: orbital signature, hero readout, per-station roll-call,
     observer's notes, scrub rail). Wires through chronoscope stores
     (measurements / statistics / monitored endpoints / settings) and
     preserves chronoscope-specific integrations: PNG export (canvas
     toDataURL), CSV export, hosted-report sharing via remoteVantageStore.
     Masthead is rendered by Layout.svelte — not duplicated here. -->
<script lang="ts">
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { endpointStore, buildDefaultEndpoints } from '$lib/stores/endpoints';
  import { measurementStore } from '$lib/stores/measurements';
  import { settingsStore } from '$lib/stores/settings';
  import { statisticsStore } from '$lib/stores/statistics';
  import { uiStore } from '$lib/stores/ui';
  import { companionStore } from '$lib/stores/companion';
  import { remoteVantageStore } from '$lib/stores/remote-vantage';
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { sanitizeCompanionProbeForReport } from '$lib/companion/sanitize';
  import { buildShareURL } from '$lib/share/share-manager';
  import {
    buildResultsSharePayload,
    MAX_SHARE_URL_CHARS,
  } from '$lib/share/share-payload-builder';
  import { buildDiagnosticReport } from '$lib/utils/diagnostic-report';
  import { buildDiagnosticEvidenceContract } from '$lib/utils/diagnostic-evidence-contract';
  import { buildGuidedProofFlow, type GuidedProofPrimaryAction } from '$lib/utils/proof-flow';
  import { buildReportCsv } from '$lib/utils/report-export';
  import { buildReportReplayFrame } from '$lib/utils/report-replay';
  import { buildSampleInspector } from '$lib/utils/sample-inspector';
  import { buildRunStoryline } from '$lib/utils/run-storyline';
  import { buildMostSignificantPulseInspection } from '$lib/utils/significant-pulse';
  import { buildPulseInspection, driftLabel, pulseInspectionSummary, thresholdDeltaLabel } from '$lib/utils/pulse-inspection';
  import {
    buildReportInstrumentLens,
    type ReportLensSource,
  } from '$lib/utils/report-instrument-lens';
  import { deriveEndpointTone, type EndpointTone } from '$lib/utils/endpoint-tone';
  import { tokens } from '$lib/tokens';
  import type { MeasurementSample, PulseInspection } from '$lib/types';
  import OrbitalScene, { type OrbitalStation, type PulseHover } from './OrbitalScene.svelte';
  import InstrumentCalibration from './InstrumentCalibration.svelte';
  import PulseEvidence from './PulseEvidence.svelte';
  import GuidedProofFlow from './GuidedProofFlow.svelte';
  import ReportInstrumentLens from './ReportInstrumentLens.svelte';
  import SampleInspector from './SampleInspector.svelte';
  import { REGION_SHORT_CODES } from '$lib/regional-defaults';

  // ── Store reads ────────────────────────────────────────────────────────────
  const endpoints = $derived($endpointStore);
  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const settings = $derived($settingsStore);
  const stats = $derived($statisticsStore);
  const remoteVantage = $derived($remoteVantageStore);
  const companion = $derived($companionStore);
  const context = $derived($uiStore.sharedReportContext);
  const pinnedPulse = $derived($uiStore.pinnedPulse);
  const sharedReportMode = $derived($uiStore.isSharedView && $uiStore.sharedReportMode);
  const isRecording = $derived(
    measurements.lifecycle === 'starting'
      || measurements.lifecycle === 'running'
      || measurements.lifecycle === 'stopping',
  );

  // The diagnostic report bundles primary answer + endpoint rows + threshold +
  // sample counts. Used for the verdict band and per-station summary.
  const report = $derived(buildDiagnosticReport({
    endpoints,
    stats,
    measurements,
    settings,
    context,
  }));
  const guidedProofFlow = $derived(buildGuidedProofFlow({
    report,
    remoteVantage,
    companion,
  }));

  // Storyline beats (event narrative) for the observer's-notes column.
  const storylineSamplesByEndpoint = $derived.by<Record<string, readonly MeasurementSample[]>>(() => {
    const out: Record<string, readonly MeasurementSample[]> = {};
    for (const ep of monitored) {
      const state = measurements.endpoints[ep.id];
      out[ep.id] = state ? state.samples.slice(-5_000) : [];
    }
    return out;
  });
  const runStoryline = $derived(buildRunStoryline({
    endpoints: monitored,
    samplesByEndpoint: storylineSamplesByEndpoint,
    threshold: settings.healthThreshold,
    runStart: measurements.startedAt,
    maxVisibleRows: Math.max(monitored.length, 4),
  }));

  // ── Orbital signature data ────────────────────────────────────────────────
  // Map up to 4 monitored endpoints → A/B/C/D station slots, replay the
  // entire session (rounded to the chart window) as the recorded signature.
  const STATION_IDS = ['A', 'B', 'C', 'D'] as const;
  const STATION_COLORS = [
    tokens.color.station.A,
    tokens.color.station.B,
    tokens.color.station.C,
    tokens.color.station.D,
  ] as const;
  const STATION_RADII = [6, 8, 10, 12] as const;

  const stations = $derived<readonly OrbitalStation[]>(
    monitored.slice(0, 4).map((ep, i) => ({
      id: STATION_IDS[i],
      color: STATION_COLORS[i],
      radius: STATION_RADII[i],
    })),
  );
  const endpointIdByStation = $derived<Record<string, string>>(
    Object.fromEntries(
      monitored.slice(0, 4).map((ep, i) => [STATION_IDS[i], ep.id]),
    ),
  );
  const stationLabelsForScene = $derived<Record<string, string>>(
    Object.fromEntries(
      monitored.slice(0, 4).map((ep, i) => [STATION_IDS[i], ep.label]),
    ),
  );
  // Report is a session-signature plot, not a rolling-window live view. WINDOW
  // here is the number of pulse slots allocated per station, sized for typical
  // session lengths (1-6 minutes at 1Hz typically resolves to <360 rounds).
  // For longer sessions, samples are downsampled uniformly so the recording
  // stays renderable without overlapping pulses. v4's prototype uses a
  // hard-coded 247-round demo; this is the same anatomy generalised.
  const WINDOW = 360;
  let scrubT = $state(1);
  let selectionSource = $state<Exclude<ReportLensSource, 'pinned' | 'none'>>('scrub');
  let clickedPulse = $state<PulseInspection | null>(null);
  let didSeedSignificant = $state(false);
  let seededSessionStart = $state<number | null | undefined>(undefined);
  const replayFrame = $derived(buildReportReplayFrame({
    endpoints: monitored,
    measurements,
    thresholdMs: settings.healthThreshold,
    progress: scrubT,
    windowSlots: WINDOW,
    capturedAt: report.createdAt ?? measurements.stoppedAt ?? Date.now(),
  }));
  const stationData = $derived(replayFrame.stationData);
  const stationTimestamps = $derived(replayFrame.stationTimestamps);

  const significantPulse = $derived(buildMostSignificantPulseInspection({
    endpoints: monitored,
    measurements,
    thresholdMs: settings.healthThreshold,
    windowSlots: WINDOW,
    capturedAt: report.createdAt ?? measurements.stoppedAt ?? Date.now(),
  }));
  const evidenceContract = $derived(buildDiagnosticEvidenceContract({
    report,
    endpoints: monitored,
    measurements,
    thresholdMs: report.threshold,
    significantPulse: isRecording ? null : significantPulse,
  }));
  $effect(() => {
    if (seededSessionStart === measurements.startedAt) return;
    seededSessionStart = measurements.startedAt;
    didSeedSignificant = false;
    clickedPulse = null;
    selectionSource = isRecording ? 'scrub' : 'significant';
  });
  $effect(() => {
    if (isRecording && selectionSource === 'significant') {
      selectionSource = 'scrub';
      return;
    }
    if (didSeedSignificant || isRecording || pinnedPulse || !significantPulse?.roundNumber) return;
    const maxRound = Math.max(1, measurements.roundCounter);
    scrubT = Math.max(0, Math.min(1, significantPulse.roundNumber / maxRound));
    selectionSource = 'significant';
    didSeedSignificant = true;
  });
  const replaySelectedPulse = $derived(clickedPulse ?? replayFrame.pulse ?? (isRecording ? null : significantPulse));
  const significantPulseForLens = $derived(isRecording ? null : significantPulse);
  const reportLens = $derived(buildReportInstrumentLens({
    endpoints: monitored,
    measurements,
    thresholdMs: settings.healthThreshold,
    pinnedPulse,
    replayPulse: replaySelectedPulse,
    significantPulse: significantPulseForLens,
    selectionSource,
    windowSlots: WINDOW,
  }));
  const reportPulse = $derived(reportLens.selected);
  const reportPulseTitle = $derived(
    pinnedPulse
      ? 'Pinned pulse evidence'
      : reportLens.source === 'significant'
        ? 'Significant sample'
      : reportLens.source === 'clicked'
        ? 'Selected replay sample'
        : reportLens.source === 'scrub'
          ? 'Replay sample'
          : 'Significant sample',
  );
  const sampleInspector = $derived.by(() => {
    if (!reportPulse) return null;
    return buildSampleInspector({
      evidence: reportPulse,
      endpoints: monitored,
      measurements,
      thresholdMs: settings.healthThreshold,
    });
  });

  // ── Session identity / coords ─────────────────────────────────────────────
  const sessionStart = $derived(measurements.startedAt);
  const sessionEnd = $derived(measurements.stoppedAt ?? Date.now());
  const durationMs = $derived(sessionStart === null ? 0 : Math.max(0, sessionEnd - sessionStart));
  const durationLabel = $derived(formatDuration(durationMs));
  const durationLong = $derived(formatDurationLong(durationMs));
  const reportModeLabel = $derived(
    isRecording
      ? 'Live session draft'
      : sharedReportMode
        ? 'Shared proof artifact'
        : 'Completed local proof',
  );
  const proofState = $derived.by(() => {
    if (isRecording) {
      return {
        tone: 'draft',
        label: 'Provisional draft',
        detail: 'This report is still recording; links and exports may change as new samples arrive.',
        action: 'Copy draft link',
      };
    }
    if (sharedReportMode) {
      return {
        tone: 'shared',
        label: 'Shared artifact',
        detail: 'This is a shared report snapshot. It reflects the captured evidence, not a live session.',
        action: 'Copy shared link',
      };
    }
    return {
      tone: 'complete',
      label: 'Completed proof',
      detail: 'This local report is final for the recorded session and ready to export or share.',
      action: 'Copy proof link',
    };
  });
  const reportGuidedProofFlow = $derived({
    ...guidedProofFlow,
    primaryAction: guidedProofFlow.primaryAction.id === 'open-report'
      ? {
          ...guidedProofFlow.primaryAction,
          label: proofState.action,
          detail: isRecording
            ? 'Copy the current draft with provisional proof status visible.'
            : 'Copy the report link with the attached evidence state.',
        }
      : guidedProofFlow.primaryAction,
  });
  const reportAriaLabel = $derived(
    isRecording
      ? 'Diagnostic report — live session draft'
      : 'Diagnostic report — completed session signature',
  );
  const endedLabel = $derived(isRecording ? 'In progress' : utcTimeLabel(measurements.stoppedAt));
  const footerStateText = $derived(
    isRecording
      ? 'Browser-resident observatory · recording in progress · no telemetry leaves this device'
      : 'Browser-resident observatory · session complete · no telemetry leaves this device',
  );
  const footerRightText = $derived(
    isRecording
      ? `Recording in progress since ${utcTimeLabel(sessionStart)}`
      : `Recording stopped at ${utcTimeLabel(measurements.stoppedAt)}`,
  );

  function formatDuration(ms: number): string {
    const total = Math.floor(ms / 1000);
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }
  function formatDurationLong(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m === 0) return `${s} s`;
    return `${m} min ${s} s`;
  }
  function utcTimeLabel(ts: number | null): string {
    if (ts === null) return '—';
    const d = new Date(ts);
    return `${d.toISOString().slice(11, 19)} UTC`;
  }
  function utcDateLabel(ts: number | null): string {
    if (ts === null) return '—';
    return new Date(ts).toUTCString().replace(/^[A-Za-z]+, /, '').slice(0, 11);
  }

  // Deterministic session cert — CHR-YYMMDD-HHMM-XXX. Survives reruns of the
  // same session ID. Falls back to a "pending" sigil before startedAt is set.
  const flightCert = $derived.by(() => {
    if (sessionStart === null) return 'CHR–pending';
    const d = new Date(sessionStart);
    const yy = d.getUTCFullYear().toString().slice(-2);
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    const HH = d.getUTCHours().toString().padStart(2, '0');
    const MM = d.getUTCMinutes().toString().padStart(2, '0');
    const seed = (d.getTime() % 4096).toString(16).toUpperCase().padStart(3, '0');
    return `CHR–${yy}${mm}${dd}–${HH}${MM}–${seed}`;
  });

  // R.A. / Dec coords — decorative; derived from elapsed time, same convention
  // as Overview so the two surfaces feel like one instrument.
  const raCoord = $derived.by(() => {
    const m = Math.floor(durationMs / 60000) % 24;
    return `06h ${m.toString().padStart(2, '0')}m`;
  });
  const decCoord = $derived.by(() => {
    const m = Math.floor(durationMs / 60000) % 90;
    const s = Math.floor((durationMs % 60000) / 1000);
    return `+${m.toString().padStart(2, '0')}°${s.toString().padStart(2, '0')}′`;
  });

  // ── Field-level p50/p95 (median across stations) ──────────────────────────
  function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
  const fieldP50 = $derived.by<number | null>(() => {
    const vals: number[] = [];
    for (const ep of monitored.slice(0, 4)) {
      const v = stats[ep.id]?.p50;
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    }
    const m = median(vals);
    return m === null ? null : Math.round(m);
  });
  const fieldP95 = $derived.by<number | null>(() => {
    const vals: number[] = [];
    for (const ep of monitored.slice(0, 4)) {
      const v = stats[ep.id]?.p95;
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    }
    const m = median(vals);
    return m === null ? null : Math.round(m);
  });

  // ── Per-station summary cards (4 slots, mapped to A/B/C/D) ────────────────
  interface StationSummary {
    readonly id: 'A' | 'B' | 'C' | 'D';
    readonly endpointId: string;
    readonly name: string;
    readonly p50: number | null;
    readonly p95: number | null;
    readonly drift: number | null;
    readonly sigil: 'stable' | 'warn' | 'bad' | 'crit';
    readonly stateText: string;
  }
  const stationSummaries = $derived<readonly StationSummary[]>(
    monitored.slice(0, 4).map((ep, i) => {
      const s = stats[ep.id];
      const m = measurements.endpoints[ep.id];
      const samples = m?.samples.toArray() ?? [];
      const ok = samples.filter((sample) => sample.status === 'ok').map((sample) => sample.latency);
      const drift = ok.length > 1 && s?.ready
        ? Math.round((Math.max(...ok) - Math.min(...ok)) / 2)
        : null;
      const threshold = settings.healthThreshold;
      let sigil: StationSummary['sigil'] = 'stable';
      let stateText = 'In transit';
      if (s?.ready) {
        if (s.p50 > threshold * 1.5) { sigil = 'crit'; stateText = 'Carrier lost'; }
        else if (s.p50 > threshold) { sigil = 'bad'; stateText = 'Doppler'; }
        else if (s.p95 > threshold) { sigil = 'warn'; stateText = 'Wobble'; }
      } else {
        stateText = 'Acquiring';
      }
      return {
        id: STATION_IDS[i],
        endpointId: ep.id,
        name: ep.label,
        p50: s?.ready ? Math.round(s.p50) : null,
        p95: s?.ready ? Math.round(s.p95) : null,
        drift,
        sigil,
        stateText,
      };
    }),
  );

  // ── Observer's notes — narrative beats from runStoryline ──────────────────
  // The narrative reuses the diagnostic primary answer + supporting summary
  // (already wired in OverviewView). Beats provide a per-event paragraph.
  const verdictHeadline = $derived(evidenceContract.report.headline);
  const verdictBody = $derived(evidenceContract.report.lede);

  // Diagnostic interpretation — second-paragraph context. Mirrors the
  // OverviewView interpretation copy so the two surfaces speak with one
  // voice. Each diagnostic kind gets a sentence that says what the headline
  // means *for the user*, not a restated version of it.
  const interpretation = $derived.by<string>(() => {
    switch (report.diagnosis.kind) {
      case 'collecting':
        return 'Chronoscope needs a few successful checks before it can compare endpoints responsibly.';
      case 'healthy':
        return 'Chronoscope has not seen a meaningful slowdown or failure in this window.';
      case 'isolated-endpoint':
        return "That points to either your browser's route to that one endpoint, or the endpoint itself. An outside check can confirm whether the slowness follows the endpoint from other networks.";
      case 'shared-network':
        return 'Multiple endpoints slowing in the same window typically points to a shared link between your browser and them — most often local network or upstream ISP.';
      case 'multiple-slow':
        return 'Several endpoints over the threshold without a shared slow phase — likely either a shared upstream issue or coincident endpoint-side slowness. An outside check helps separate the two.';
      case 'packet-loss':
        return 'Failed requests in the browser can come from the endpoint, the route to it, or a CORS block. An outside check separates these without changing your local network.';
      case 'jitter':
        return "Bouncing latency without a clear failure pattern usually points to congestion somewhere on the path. The path's not down — it's noisy.";
    }
  });

  // Per-endpoint tone lookup so we can render endpoint names as coloured
  // chips inside the narrative. The same logic OverviewView ships.
  interface EndpointToneEntry {
    readonly label: string;
    readonly tone: EndpointTone;
  }
  const endpointToneEntries = $derived<readonly EndpointToneEntry[]>(
    monitored.map((ep) => {
      const state = measurements.endpoints[ep.id];
      const lastStatus = state?.lastStatus ?? null;
      return {
        label: ep.label,
        tone: deriveEndpointTone({
          stats: stats[ep.id] ?? null,
          lastStatus,
          healthThreshold: settings.healthThreshold,
        }),
      };
    }),
  );

  // v4-style inline endpoint highlight. Splits prose on monitored endpoint
  // labels (longest-first to avoid partial-overlap matches) and emits
  // segments the template renders as styled chips. Returns a single
  // tone-null segment for empty or label-free text.
  type LedeSegment = { readonly text: string; readonly tone: EndpointTone | null };
  function highlightEndpoints(text: string): readonly LedeSegment[] {
    if (text.length === 0) return [{ text: '', tone: null }];
    const matchable = endpointToneEntries
      .filter(({ label }) => label.length >= 2)
      .slice()
      .sort((a, b) => b.label.length - a.label.length);
    if (matchable.length === 0) return [{ text, tone: null }];

    const segments: LedeSegment[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      let best: { label: string; tone: EndpointTone; index: number } | null = null;
      for (const candidate of matchable) {
        const index = text.indexOf(candidate.label, cursor);
        if (index < 0) continue;
        if (best === null || index < best.index) {
          best = { label: candidate.label, tone: candidate.tone, index };
        }
      }
      if (best === null) {
        segments.push({ text: text.slice(cursor), tone: null });
        break;
      }
      if (best.index > cursor) segments.push({ text: text.slice(cursor, best.index), tone: null });
      segments.push({ text: best.label, tone: best.tone });
      cursor = best.index + best.label.length;
    }
    return segments;
  }

  // Compose the three observer's-notes paragraphs:
  //   ¶1 around-when / what happened — strong opening + most-significant beat
  //   ¶2 what other stations did — supporting context (interpretation)
  //   ¶3 what it means / what to do next — close-out + next-step prompt
  // Falls back to supportingSummary + interpretation + a generic close when
  // beats are sparse (e.g. healthy run with nothing to highlight).
  interface NotesParagraph {
    readonly opening?: string;     // bold lead-in (¶1 only)
    readonly text: string;          // remainder of paragraph (run through highlightEndpoints)
  }
  const observerParagraphs = $derived.by<readonly NotesParagraph[]>(() => {
    // Pick the most-significant beat — prefer worst-severity, then most-recent.
    const severityRank: Record<string, number> = { bad: 3, watch: 2, info: 1, good: 0 };
    const sortedBeats = [...runStoryline.beats].sort((a, b) => {
      const rankDiff = (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return b.t - a.t;
    });
    const topBeat = sortedBeats[0] ?? null;

    const stationCount = monitored.length;
    const acquiredText = isRecording
      ? (stationCount === 1
        ? 'Recording in progress with 1 station acquired.'
        : `Recording in progress with ${stationCount} stations acquired.`)
      : (stationCount === 1
        ? 'Session complete with 1 station acquired.'
        : `Session complete with ${stationCount} stations acquired.`);
    const nextStepText = ' If issues recur, run an outside transit check to separate your network from the endpoint.';

    // Rich path — we have a beat to lead with.
    if (topBeat !== null && verdictHeadline.length > 0) {
      return [
        { opening: verdictHeadline, text: ` ${topBeat.label}${topBeat.evidence ? ` ${topBeat.evidence}` : ''}` },
        { text: verdictBody },
        { text: `${interpretation} ${acquiredText}${nextStepText}` },
      ];
    }
    // Fallback path — no beats worth surfacing.
    return [
      { text: verdictBody.length > 0 ? verdictBody : verdictHeadline },
      { text: interpretation },
      { text: `${acquiredText}${nextStepText}` },
    ];
  });

  // ── Vantage + cadence (record column) ─────────────────────────────────────
  const cadenceLabel = $derived(`${(settings.monitorDelay / 1000).toFixed(0)} s · synchronized`);
  const roundsLabel = $derived(`${measurements.roundCounter} / ${settings.cap} cap`);
  const triggerLabel = $derived(`${settings.healthThreshold} ms`);
  const carrierLosses = $derived(measurements.errorCount + measurements.timeoutCount);

  // Stations annotation: "N (default set)" when the user hasn't customized
  // the endpoint set for the current region, otherwise "N (N configured)".
  // Comparison is set-based on URL + enabled flag — order doesn't matter
  // because the user can rearrange defaults without "customizing" them.
  const stationsAnnotation = $derived.by(() => {
    const monitoredCount = monitored.length;
    const defaults = buildDefaultEndpoints(settings.region);
    if (defaults.length !== endpoints.length) {
      return `${monitoredCount} (${endpoints.length} configured)`;
    }
    const defaultKeys = new Set(defaults.map((d) => `${d.url}|${d.enabled}`));
    const currentKeys = new Set(endpoints.map((e) => `${e.url}|${e.enabled}`));
    if (defaultKeys.size !== currentKeys.size) {
      return `${monitoredCount} (${endpoints.length} configured)`;
    }
    for (const k of defaultKeys) {
      if (!currentKeys.has(k)) return `${monitoredCount} (${endpoints.length} configured)`;
    }
    return `${monitoredCount} (default set)`;
  });

  // Region short codes for the Vantage line come from regional-defaults
  // (REGION_SHORT_CODES). Single source of truth shared with OverviewView so
  // the v4 prototype's "US-W"/"EU" labelling stays consistent across surfaces.

  const vantageLabel = $derived.by(() => {
    if (typeof navigator === 'undefined') return 'Browser · — · —';
    const ua = navigator.userAgent;
    // Browser name + version. Firefox precedes "Chrome"/"Safari" because its
    // UA can include "like Gecko" but never the literal Chrome token; Edge
    // (Chromium) reports both Chrome and Edg/ — we report it as Chrome to
    // match the v4 prototype's labelling.
    let browser = 'Browser';
    if (/Firefox\/(\d+)/.test(ua)) {
      const v = ua.match(/Firefox\/(\d+)/)?.[1];
      browser = v ? `Firefox ${v}` : 'Firefox';
    } else if (/Chrome\/(\d+)/.test(ua)) {
      const v = ua.match(/Chrome\/(\d+)/)?.[1];
      browser = v ? `Chrome ${v}` : 'Chrome';
    } else if (/Version\/(\d+(?:\.\d+)?).*Safari/.test(ua)) {
      const v = ua.match(/Version\/(\d+(?:\.\d+)?)/)?.[1];
      browser = v ? `Safari ${v}` : 'Safari';
    }
    // OS + version. macOS reports as "Mac OS X 14_5_0" → "macOS 14.5";
    // Windows reports "Windows NT 10.0" → "Windows 10"; Linux has no
    // reliable version in the UA so we keep it bare.
    let os = 'OS';
    const macMatch = ua.match(/Mac OS X (\d+(?:[._]\d+)?)/);
    if (macMatch) {
      os = `macOS ${macMatch[1].replace(/_/g, '.')}`;
    } else {
      const winMatch = ua.match(/Windows NT (\d+(?:\.\d+)?)/);
      if (winMatch) {
        // Translate NT version to marketing name where unambiguous.
        const nt = winMatch[1];
        os = nt === '10.0' ? 'Windows 10' : `Windows NT ${nt}`;
      } else if (ua.includes('Linux')) {
        os = 'Linux';
      }
    }
    const region = settings.region ? (REGION_SHORT_CODES[settings.region] ?? settings.region.toUpperCase()) : 'US-W';
    return `${browser} · ${os} · ${region}`;
  });

  // ── Scrub rail ───────────────────────────────────────────────────────────
  // The scrubber now drives the report frame itself: orbital pulses, current
  // evidence, and the sample inspector all follow this replay position.
  const scrubRoundLabel = $derived(replayFrame.roundLabel);
  function setReplayProgress(next: number, source: 'scrub' | 'clicked' = 'scrub'): void {
    scrubT = Math.max(0, Math.min(1, next));
    if (source === 'scrub') clickedPulse = null;
    selectionSource = source;
  }

  function onRailClick(e: MouseEvent | TouchEvent): void {
    const rail = e.currentTarget as HTMLDivElement;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    setReplayProgress((x - rect.left) / rect.width);
  }
  const railMarks = Array.from({ length: 60 }, (_, i) => i);

  function inspectReportPulse(pulse: PulseHover): void {
    const evidence = buildPulseInspection({
      source: 'endpoint',
      pulse,
      endpointIdByStation,
      thresholdMs: settings.healthThreshold,
    });
    clickedPulse = evidence;
    if (evidence.roundNumber !== null) {
      setReplayProgress(evidence.roundNumber / Math.max(1, measurements.roundCounter), 'clicked');
    } else {
      selectionSource = 'clicked';
    }
  }

  function returnToReplay(): void {
    uiStore.clearPinnedPulse();
    clickedPulse = null;
    didSeedSignificant = true;
    selectionSource = 'scrub';
  }

  // ── Sharing / export hooks (preserved chronoscope behavior) ───────────────
  // PNG export: composite the WebGL signature with report text and evidence.
  // A raw canvas export would omit DOM overlays, so the saved artifact draws
  // the most important readouts into a dedicated report plate.
  let stageEl: HTMLElement | null = null;
  let copiedLink = $state(false);
  let copyError = $state<'link' | null>(null);

  function drawWrappedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
  ): number {
    const words = text.split(/\s+/).filter(Boolean);
    let line = '';
    let lines = 0;
    for (const word of words) {
      const next = line.length === 0 ? word : `${line} ${word}`;
      if (ctx.measureText(next).width > maxWidth && line.length > 0) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        lines += 1;
        line = word;
        if (lines >= maxLines - 1) break;
      } else {
        line = next;
      }
    }
    if (line.length > 0 && lines < maxLines) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    return y;
  }

  function drawMetric(
    ctx: CanvasRenderingContext2D,
    label: string,
    value: string,
    x: number,
    y: number,
  ): void {
    ctx.fillStyle = tokens.color.text.fg2;
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.fillStyle = tokens.color.text.fg;
    ctx.font = '700 30px Inter, system-ui, sans-serif';
    ctx.fillText(value, x, y + 38);
  }

  function drawEvidencePlate(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
  ): void {
    if (!reportPulse) return;
    ctx.fillStyle = tokens.color.tooltip.bgDeep;
    ctx.strokeStyle = tokens.color.glass.borderHover;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, width, 218, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = tokens.color.station.A;
    ctx.font = '700 18px Inter, system-ui, sans-serif';
    ctx.fillText(reportPulseTitle.toUpperCase(), x + 24, y + 34);

    ctx.fillStyle = tokens.color.text.fg;
    ctx.font = '700 24px Inter, system-ui, sans-serif';
    drawWrappedText(ctx, pulseInspectionSummary(reportPulse), x + 24, y + 74, width - 48, 30, 2);

    const left = x + 24;
    const right = x + width / 2 + 12;
    drawMetric(ctx, 'Latency', `${reportPulse.latency} ms`, left, y + 130);
    drawMetric(ctx, 'Trigger delta', thresholdDeltaLabel(reportPulse.thresholdDelta), right, y + 130);

    ctx.fillStyle = tokens.color.tooltip.text;
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.fillText(`Drift ${driftLabel(reportPulse.drift)} · Station ${reportPulse.stationId}`, left, y + 198);
  }

  function saveImage(): void {
    if (!stageEl) return;
    const sceneCanvas = stageEl.querySelector<HTMLCanvasElement>('canvas');
    if (!sceneCanvas) return;
    try {
      const out = document.createElement('canvas');
      out.width = 1600;
      out.height = 1000;
      const ctx = out.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = tokens.color.surface.base;
      ctx.fillRect(0, 0, out.width, out.height);

      const gradient = ctx.createRadialGradient(500, 500, 80, 500, 500, 620);
      gradient.addColorStop(0, tokens.color.glass.bgHover);
      gradient.addColorStop(1, tokens.color.glass.bg);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, out.width, out.height);

      ctx.drawImage(sceneCanvas, 56, 92, 820, 820);
      ctx.strokeStyle = tokens.color.glass.borderHover;
      ctx.lineWidth = 1;
      ctx.strokeRect(56, 92, 820, 820);

      const x = 940;
      ctx.fillStyle = tokens.color.station.A;
      ctx.font = '700 22px Inter, system-ui, sans-serif';
      ctx.fillText(`${reportModeLabel.toUpperCase()} · ${flightCert}`, x, 118);

      ctx.fillStyle = tokens.color.text.fg;
      ctx.font = '800 54px Inter, system-ui, sans-serif';
      let y = drawWrappedText(ctx, verdictHeadline, x, 190, 560, 62, 3);

      ctx.fillStyle = tokens.color.tooltip.text;
      ctx.font = '500 24px Inter, system-ui, sans-serif';
      y = drawWrappedText(ctx, verdictBody, x, y + 18, 560, 34, 4);

      const metricY = Math.max(420, y + 42);
      drawMetric(ctx, 'Field p50', fieldP50 === null ? '-' : `${fieldP50} ms`, x, metricY);
      drawMetric(ctx, 'Field p95', fieldP95 === null ? '-' : `${fieldP95} ms`, x + 220, metricY);
      drawMetric(ctx, 'Trigger', triggerLabel, x + 440, metricY);

      drawEvidencePlate(ctx, x, metricY + 96, 560);

      ctx.fillStyle = tokens.color.text.fg2;
      ctx.font = '600 18px Inter, system-ui, sans-serif';
      ctx.fillText(`${durationLong} · ${measurements.roundCounter} rounds · ${footerStateText}`, 56, 962);

      const dataUrl = out.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `chronoscope-signature-${flightCert.replace(/[^A-Za-z0-9-]/g, '-')}.png`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 0);
    } catch {
      // toDataURL throws if the WebGL context was lost or tainted; the
      // OrbitalScene shaders are all local so taint shouldn't apply, but a
      // belt-and-braces catch keeps the report surface from crashing.
    }
  }

  function saveCsv(): void {
    const csv = buildReportCsv({
      endpoints: monitored,
      measurements,
      healthThreshold: settings.healthThreshold,
      sessionStart: sessionStart ?? Date.now(),
      pinnedPulse,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronoscope-session-${flightCert.replace(/[^A-Za-z0-9-]/g, '-')}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // Hosted-report link: re-uses the existing share/hash-router integration.
  // remoteVantageStore.createHostedReport posts to the Pages Function and
  // returns a short URL; if that fails (offline / disabled), we fall back to
  // the long hash URL that hash-router decodes on the receiver side.
  async function copyLink(): Promise<void> {
    const settingsForReport = {
      ...get(settingsStore),
      healthThreshold: report.threshold,
      corsMode: report.corsMode,
    };
    const metadata = {
      createdAt: report.createdAt ?? Date.now(),
      healthThreshold: report.threshold,
      corsMode: report.corsMode,
      roundCount: report.roundCount,
      totalSampleCount: report.totalSampleCount,
      truncated: report.truncated,
      ...(pinnedPulse ? { pinnedPulse } : {}),
    };
    const liveCompanion = get(companionStore);
    const localCompanion = liveCompanion.lastProbe
      ? sanitizeCompanionProbeForReport(liveCompanion.lastProbe, { includePrivateWifi: false })
      : null;
    const built = buildResultsSharePayload(
      get(endpointStore),
      settingsForReport,
      get(measurementStore),
      100_000,
      Date.now(),
      metadata,
      get(remoteVantageStore).lastProbe,
      localCompanion,
    );
    const hosted = await remoteVantageStore.createHostedReport(built.payload);
    const fallback = hosted === null
      ? buildResultsSharePayload(
          get(endpointStore),
          settingsForReport,
          get(measurementStore),
          MAX_SHARE_URL_CHARS,
          Date.now(),
          metadata,
          get(remoteVantageStore).lastProbe,
          localCompanion,
        ).payload
      : null;
    const finalUrl = hosted ?? buildShareURL(fallback ?? built.payload);
    if (!navigator.clipboard) {
      copyError = 'link';
      window.setTimeout(() => { copyError = null; }, 1800);
      return;
    }
    try {
      await navigator.clipboard.writeText(finalUrl);
      copiedLink = true;
      copyError = null;
      window.setTimeout(() => { copiedLink = false; }, 1800);
    } catch {
      copyError = 'link';
      window.setTimeout(() => { copyError = null; }, 1800);
    }
  }

  function guidedProofEndpoints(action: GuidedProofPrimaryAction) {
    const endpoint = action.endpointId
      ? monitored.find((candidate) => candidate.id === action.endpointId)
      : null;
    return endpoint ? [endpoint] : monitored;
  }

  async function runGuidedProofAction(action: GuidedProofPrimaryAction): Promise<void> {
    switch (action.id) {
      case 'run-outside':
        await remoteVantageStore.runProbe(guidedProofEndpoints(action));
        break;
      case 'open-report':
        await copyLink();
        break;
      case 'keep-collecting':
      case 'wait-outside':
        break;
    }
  }

  // ── Keyboard scrubbing (←/→ + Home/End) ───────────────────────────────────
  function onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const rounds = Math.max(measurements.roundCounter, 1);
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setReplayProgress(scrubT - (e.shiftKey ? 10 : 1) / rounds);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setReplayProgress(scrubT + (e.shiftKey ? 10 : 1) / rounds);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setReplayProgress(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setReplayProgress(1);
    } else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      saveImage();
    } else if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      saveCsv();
    }
  }
  onMount(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
</script>

<section class="report-surface" aria-label={reportAriaLabel}>
  <!-- HERO STAGE — orbital signature + HUD readouts + scrub rail -->
  <section class="stage" bind:this={stageEl}>
    <div class="stage-scene" aria-hidden={stations.length === 0 ? 'true' : null}>
      {#if stations.length > 0}
        <OrbitalScene
          {stations}
          {stationData}
          {stationTimestamps}
          triggerMs={settings.healthThreshold}
          windowSeconds={WINDOW}
          windowRounds={WINDOW}
          assemble={true}
          revealProgress={1}
          stationLabels={stationLabelsForScene}
          currentRound={replayFrame.targetRound}
          cadenceMs={settings.monitorDelay}
          showTooltip={false}
          onPulseInspect={inspectReportPulse}
          selectedPulse={reportLens.orbitalSelection?.selected ?? null}
          peerPulses={reportLens.orbitalSelection?.peerPulses ?? []}
          selectedAngle={reportLens.orbitalSelection?.angle ?? null}
        />
      {/if}
    </div>
    <div class="vignette" aria-hidden="true"></div>

    <div class="hud-top">
      <div class="coords">
        <span>Session<span class="v">{flightCert}</span></span>
        <span>Duration<span class="v">{durationLabel}</span></span>
        <span>Rounds<span class="v">{measurements.roundCounter}</span></span>
        <span>R.A.<span class="v">{raCoord}</span></span>
        <span>Dec<span class="v">{decCoord}</span></span>
      </div>
    </div>

    <div class="hud-title">
      <div class="kicker">{reportModeLabel} &nbsp;·&nbsp; <span class="v">{flightCert}</span></div>
      <h1>{verdictHeadline}</h1>
      <p class="body">{verdictBody}</p>
      <div class="hero-metrics" aria-label="Report field metrics">
        <div class="hero-metric">
          <span class="metric-label">Field p50</span>
          <span class="metric-value">
            {#if fieldP50 === null}<span class="awaiting">—</span>{:else}{fieldP50}<span class="u">ms</span>{/if}
          </span>
        </div>
        <div class="hero-metric">
          <span class="metric-label">Field p95</span>
          <span class="metric-value">
            {fieldP95 === null ? '—' : `${fieldP95} ms`}
          </span>
        </div>
        <div class="hero-metric">
          <span class="metric-label">Trigger</span>
          <span class="metric-value">{triggerLabel}</span>
        </div>
      </div>
      <div class="proof-state" data-tone={proofState.tone}>
        <span class="state-label">{proofState.label}</span>
        <span class="state-detail">{proofState.detail}</span>
      </div>
      <div class="actions">
        <button type="button" class="ctl-btn ctl-btn--primary" onclick={copyLink}>
          {copyError === 'link' ? 'Copy failed' : copiedLink ? 'Link copied' : proofState.action}
        </button>
        <button type="button" class="ctl-btn" onclick={saveImage}>Save as image</button>
      </div>
    </div>

    <div class="report-side-stack" aria-label="Report instrument detail rail">
      <div class="report-calibration">
        <InstrumentCalibration
          mode="report"
          thresholdMs={settings.healthThreshold}
          windowSeconds={WINDOW}
          sampleSlots={WINDOW}
          baselineMs={fieldP50}
          stationCount={stations.length}
          cadenceMs={settings.monitorDelay}
          carrierLosses={carrierLosses}
          isRecording={isRecording}
          compact={true}
        />
      </div>

      {#if reportPulse}
        <div class="report-evidence">
          <PulseEvidence evidence={reportPulse} title={reportPulseTitle} />
        </div>
      {/if}
    </div>

    <div
      class="scrub"
      role="slider"
      aria-label="Scrub through session"
      aria-valuemin="0"
      aria-valuemax={measurements.roundCounter}
      aria-valuenow={replayFrame.targetRound}
      tabindex="0"
    >
      <span class="lbl">Replay</span>
      <div
        class="rail"
        onmousedown={onRailClick}
        ontouchstart={onRailClick}
        role="presentation"
      >
        <div class="rail-bg"></div>
        <div class="rail-fill" style:width="{scrubT * 100}%"></div>
        <div class="marks">
          {#each railMarks as i (i)}
            <span class="m"></span>
          {/each}
        </div>
        <div class="handle" style:left="{scrubT * 100}%"></div>
      </div>
      <span class="scrub-read">Round<span class="v">{scrubRoundLabel}</span></span>
    </div>
  </section>

  <section class="report-guided-proof" aria-label="Report proof flow">
    <GuidedProofFlow
      flow={reportGuidedProofFlow}
      title="Report proof flow"
      onAction={runGuidedProofAction}
    />
  </section>

  <!-- BELOW — per-station summary + session record + observer's notes -->
  <section class="below">
    <div class="summary-head">
      <span class="l">Per-station summary</span>
      <span class="r">
        <span>Window<span class="v">{durationLabel}</span></span>
        <span>Cadence<span class="v">{(settings.monitorDelay / 1000).toFixed(0)} s</span></span>
      </span>
    </div>

    <div class="stations-grid">
      {#each stationSummaries as row (row.endpointId)}
        <div
          class="station-card"
          data-ep={row.id}
          data-selected={reportLens.selected?.endpointId === row.endpointId ? 'true' : 'false'}
        >
          <div class="vh">
            <span class="mk"></span>
            <span class="name">{row.name}</span>
            <span class="state" data-s={row.sigil}>{row.stateText}</span>
          </div>
          <div class="stats">
            <div class="stat">
              <div class="k">p50</div>
              <div class="v">
                {#if row.p50 === null}—{:else}{row.p50}<span class="u">ms</span>{/if}
              </div>
            </div>
            <div class="stat">
              <div class="k">p95</div>
              <div class="v">
                {#if row.p95 === null}—{:else}{row.p95}<span class="u">ms</span>{/if}
              </div>
            </div>
            <div class="stat">
              <div class="k">drift</div>
              <div class="v">
                {#if row.drift === null}—{:else}±{row.drift}<span class="u">ms</span>{/if}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>

    <ReportInstrumentLens lens={reportLens} onReturnToReplay={returnToReplay} />

    {#if sampleInspector}
      <div class="sample-inspector-wrap">
        <SampleInspector inspector={sampleInspector} />
      </div>
    {/if}

    <div class="record-row">
      <div>
        <h3>Session record</h3>
        <div class="row"><span class="k">Session ID</span><span class="v">{flightCert}</span></div>
        <div class="row"><span class="k">Started</span><span class="v">{utcTimeLabel(sessionStart)} · {utcDateLabel(sessionStart)}</span></div>
        <div class="row"><span class="k">{isRecording ? 'Status' : 'Ended'}</span><span class="v">{endedLabel}</span></div>
        <div class="row"><span class="k">Duration</span><span class="v">{durationLong}</span></div>
        <div class="row"><span class="k">Rounds</span><span class="v">{roundsLabel}</span></div>
        <div class="row"><span class="k">Cadence</span><span class="v">{cadenceLabel}</span></div>
        <div class="row"><span class="k">Vantage</span><span class="v">{vantageLabel}</span></div>
        <div class="row"><span class="k">Stations</span><span class="v">{stationsAnnotation}</span></div>
        <div class="row"><span class="k">Trigger</span><span class="v">{triggerLabel}</span></div>
        <div class="row"><span class="k">Carrier losses</span><span class="v">{carrierLosses}</span></div>
        <div class="row"><span class="k">Recorded by</span><span class="v">Chronoscope · browser-resident</span></div>
      </div>

      <div>
        <h3>Observer's notes</h3>
        {#each observerParagraphs as para, i (i)}
          <p class="narrative">
            {#if para.opening}<strong>{para.opening}</strong>{/if}
            {#each highlightEndpoints(para.text) as segment, j (j)}{#if segment.tone}<span class="ep-chip" data-tone={segment.tone}>{segment.text}</span>{:else}{segment.text}{/if}{/each}
          </p>
        {/each}
      </div>
    </div>
  </section>

  <footer class="foot">
    <div>Cert<span class="v">{flightCert}</span></div>
    <div class="center">{footerStateText}</div>
    <div class="right">{footerRightText}</div>
  </footer>
</section>

<style>
  /* ── Surface ───────────────────────────────────────────────────────────── */
  .report-surface {
    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.55;
  }

  /* ── Stage (orbital signature canvas) ──────────────────────────────────── */
  /* Stage spans the viewport area below the masthead. min-height: 600px
     gives a floor for very-short viewports without overshooting the bottom
     of the visible area at typical desktop heights (~700-720px). v4 uses
     min-height: 720px because its masthead is position: sticky and floats
     over the stage from y=0; dev's masthead is a normal-flow Layout sibling
     so the stage starts at y=61, and 720px would push the bottom HUD chrome
     (replay scrub rail) 74px below the fold at 707px viewport. */
  .stage {
    position: relative;
    height: calc(100vh - var(--topbar-height, 60px));
    min-height: 600px;
    background: var(--bg);
    overflow: hidden;
  }
  .stage-scene {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .vignette {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: radial-gradient(
      ellipse at center,
      transparent 30%,
      color-mix(in srgb, var(--bg) 55%, transparent) 70%,
      color-mix(in srgb, var(--bg) 95%, transparent) 100%
    );
  }

  /* HUD coords pill — top of hero */
  .hud-top {
    position: absolute;
    top: 18px;
    left: 0;
    right: 0;
    z-index: 4;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .hud-top .coords {
    display: inline-flex;
    gap: 26px;
    flex-wrap: wrap;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    padding: 8px 18px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .hud-top .coords > span { white-space: nowrap; }
  .hud-top .coords .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 8px;
    font-variant-numeric: tabular-nums;
  }

  /* HUD title — left side, vertically centered */
  .hud-title {
    position: absolute;
    left: clamp(20px, 3vw, 48px);
    top: 50%;
    transform: translateY(-50%);
    z-index: 4;
    max-width: min(580px, 45vw);
    pointer-events: none;
    isolation: isolate;
  }
  .hud-title::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: -30px -36px -28px -38px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--bg) 96%, transparent) 0%,
      color-mix(in srgb, var(--bg) 84%, transparent) 64%,
      transparent 100%
    );
    pointer-events: none;
  }
  .hud-title .kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 20px;
  }
  .hud-title .kicker .v { color: var(--fg); font-weight: 700; }
  .hud-title h1 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(40px, 4.8vw, 72px);
    letter-spacing: -0.025em;
    line-height: 1;
    color: var(--fg);
    margin: 0 0 22px;
    text-shadow: 0 0 50px color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .hud-title .body {
    font-size: 15px;
    color: var(--fg-2);
    line-height: 1.5;
    margin: 0 0 16px;
    max-width: 42ch;
  }
  .hero-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    max-width: min(520px, 100%);
    margin: 0 0 16px;
    border: 1px solid var(--rule);
    background: var(--rule);
    font-family: var(--mono);
    pointer-events: none;
  }
  .hero-metric {
    min-width: 0;
    padding: 9px 11px;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
  }
  .metric-label {
    display: block;
    margin-bottom: 5px;
    color: var(--fg-3);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .metric-value {
    display: block;
    color: var(--fg);
    font-size: 14px;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .metric-value .u {
    margin-left: 2px;
    color: var(--fg-3);
    font-size: 10px;
  }
  .metric-value .awaiting {
    color: var(--fg-3);
  }
  .proof-state {
    display: grid;
    gap: 5px;
    max-width: 44ch;
    margin: 0 0 22px;
    padding: 11px 13px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 68%, transparent);
    font-family: var(--mono);
  }
  .proof-state .state-label {
    color: var(--fg);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .proof-state .state-detail {
    color: var(--fg-2);
    font-size: 11px;
    line-height: 1.35;
  }
  .proof-state[data-tone="draft"] {
    border-color: color-mix(in srgb, var(--sev-warn) 65%, var(--rule));
  }
  .proof-state[data-tone="draft"] .state-label { color: var(--sev-warn); }
  .proof-state[data-tone="complete"] {
    border-color: color-mix(in srgb, var(--station-b) 60%, var(--rule));
  }
  .proof-state[data-tone="complete"] .state-label,
  .proof-state[data-tone="shared"] .state-label { color: var(--station-b); }
  .hud-title .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    pointer-events: auto;
  }

  .report-side-stack {
    position: absolute;
    right: clamp(20px, 3vw, 48px);
    top: 88px;
    bottom: 86px;
    z-index: 4;
    width: min(400px, calc(100vw - 40px));
    display: grid;
    align-content: start;
    gap: 12px;
    pointer-events: none;
  }
  .report-calibration,
  .report-evidence {
    min-width: 0;
  }
  .report-calibration :global(.instrument-calibration),
  .report-evidence :global(.pulse-evidence) {
    max-width: none;
  }
  .report-calibration :global(.encoding-grid) {
    display: none;
  }

  .report-guided-proof {
    padding: 22px clamp(20px, 3vw, 48px) 26px;
    border-bottom: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 94%, black 6%);
  }

  .report-guided-proof :global(.guided-proof-flow) {
    max-width: 1180px;
    margin: 0 auto;
  }

  /* Buttons */
  .ctl-btn {
    border: 1px solid var(--rule-strong);
    padding: 7px 12px;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    transition: background 120ms, border-color 120ms;
    cursor: pointer;
    background: transparent;
  }
  .ctl-btn:hover {
    background: var(--bg-2);
    border-color: var(--fg-3);
  }
  .ctl-btn:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .ctl-btn--primary {
    color: var(--bg);
    background: var(--fg);
    border-color: var(--fg);
  }
  .ctl-btn--primary:hover {
    background: var(--station-a);
    border-color: var(--station-a);
  }

  /* Scrub rail — bottom edge */
  .scrub {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    padding: 14px clamp(20px, 3vw, 48px) 16px;
    display: flex;
    align-items: center;
    gap: 18px;
    border-top: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .scrub:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: -2px;
  }
  .scrub .lbl {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    min-width: 90px;
  }
  .scrub .rail {
    flex: 1;
    position: relative;
    height: 28px;
    cursor: ew-resize;
  }
  .scrub .rail-bg {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--rule-strong);
    transform: translateY(-0.5px);
  }
  .scrub .rail-fill {
    position: absolute;
    left: 0;
    top: 50%;
    height: 1px;
    background: var(--fg);
    box-shadow: 0 0 10px var(--fg);
    transform: translateY(-0.5px);
  }
  .scrub .marks {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    pointer-events: none;
  }
  .scrub .marks .m {
    width: 1px;
    height: 6px;
    background: var(--rule-strong);
  }
  .scrub .marks .m:nth-child(8n + 1) {
    height: 10px;
    background: var(--fg-3);
  }
  .scrub .handle {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 18px;
    background: var(--fg);
    box-shadow: 0 0 12px var(--fg);
    pointer-events: none;
  }
  .scrub .scrub-read {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    min-width: 90px;
    text-align: right;
  }
  .scrub .scrub-read .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }

  /* ── BELOW: per-station summary + record + notes ───────────────────────── */
  .below {
    padding: 80px clamp(20px, 3vw, 48px) 96px;
    border-top: 1px solid var(--rule);
    background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 92%, transparent) 0%, var(--bg) 24%);
    position: relative;
  }

  .summary-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 24px;
    padding-bottom: 18px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    flex-wrap: wrap;
  }
  .summary-head .l { color: var(--fg); font-weight: 700; }
  .summary-head .r {
    display: inline-flex;
    gap: 22px;
    flex-wrap: wrap;
  }
  .summary-head .r .v {
    color: var(--fg);
    margin-left: 6px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .stations-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .station-card {
    background: var(--bg);
    padding: 22px 24px 24px;
    border: 1px solid transparent;
  }
  .station-card[data-selected="true"] {
    border-color: var(--fg);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--fg) 24%, transparent);
  }
  .station-card .vh {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .station-card .mk {
    width: 8px;
    height: 8px;
  }
  .station-card[data-ep="A"] .mk { background: var(--station-a); box-shadow: 0 0 10px var(--station-a); }
  .station-card[data-ep="B"] .mk { background: var(--station-b); box-shadow: 0 0 10px var(--station-b); }
  .station-card[data-ep="C"] .mk { background: var(--station-c); box-shadow: 0 0 10px var(--station-c); }
  .station-card[data-ep="D"] .mk { background: var(--station-d); box-shadow: 0 0 10px var(--station-d); }
  .station-card .name {
    font-family: var(--sans);
    font-size: 17px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
  }
  .station-card .state {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--fg-3);
  }
  .station-card .state[data-s="stable"] { color: var(--station-b); }
  .station-card .state[data-s="warn"]   { color: var(--sev-warn); }
  .station-card .state[data-s="bad"]    { color: var(--sev-bad); }
  .station-card .state[data-s="crit"]   { color: var(--sev-crit); }
  .station-card .stats {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
  }
  .station-card .stat + .stat {
    border-left: 1px solid var(--rule);
    padding-left: 14px;
    margin-left: 14px;
  }
  .station-card .stat .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 6px;
  }
  .station-card .stat .v {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 20px;
    font-weight: 400;
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .station-card .stat .v .u {
    font-size: 11px;
    color: var(--fg-3);
    margin-left: 2px;
  }

  .sample-inspector-wrap {
    margin-top: 36px;
  }

  /* Record + narrative columns */
  .record-row {
    margin-top: 64px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    gap: 64px;
  }
  .record-row h3 {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin: 0 0 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--rule);
  }
  .record-row .row {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 6px 18px;
    padding: 9px 0;
    border-bottom: 1px solid var(--rule-faint);
    font-family: var(--mono);
    font-size: 11px;
  }
  .record-row .row:last-child { border-bottom: 0; }
  .record-row .row .k {
    color: var(--fg-3);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 10px;
    white-space: nowrap;
    font-weight: 700;
  }
  .record-row .row .v {
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .record-row .narrative {
    font-family: var(--sans);
    font-size: 16px;
    color: var(--fg-2);
    line-height: 1.55;
    margin: 0 0 16px;
  }
  .record-row .narrative:last-child { margin-bottom: 0; }
  .record-row .narrative strong {
    color: var(--fg);
    font-weight: 500;
  }
  /* Inline endpoint chip — mono pill carrying the endpoint's tone colour.
     Same shape OverviewView uses so the two surfaces feel like one
     instrument. Per-tone colour is set via [data-tone]. */
  .record-row .narrative .ep-chip {
    display: inline-block;
    font-family: var(--mono);
    font-size: 0.85em;
    font-weight: 700;
    letter-spacing: 0.02em;
    padding: 1px 6px;
    margin: 0 1px;
    border: 1px solid var(--rule-strong);
    border-radius: 2px;
    color: var(--fg);
    vertical-align: baseline;
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
  }
  .record-row .narrative .ep-chip[data-tone="good"]       { border-color: var(--station-b); color: var(--station-b); }
  .record-row .narrative .ep-chip[data-tone="watch"]      { border-color: var(--sev-warn);  color: var(--sev-warn); }
  .record-row .narrative .ep-chip[data-tone="bad"]        { border-color: var(--sev-bad);   color: var(--sev-bad); }
  .record-row .narrative .ep-chip[data-tone="collecting"] { border-color: var(--rule-strong); color: var(--fg-3); }

  /* Footer */
  .foot {
    border-top: 1px solid var(--rule);
    padding: 22px clamp(20px, 3vw, 48px);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    gap: 16px;
  }
  .foot .v {
    color: var(--fg);
    margin-left: 6px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .foot .center { text-align: center; }
  .foot .right { text-align: right; }

  /* ── Reduced motion ────────────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .ctl-btn { transition: none; }
  }

  /* ── Mobile ────────────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .hud-title { max-width: min(420px, 60vw); }
    .report-side-stack {
      width: min(340px, calc(100vw - 40px));
    }
    .stations-grid { grid-template-columns: repeat(2, 1fr); }
    .record-row { grid-template-columns: 1fr; gap: 40px; }
  }
  @media (max-width: 720px) {
    .stage {
      height: auto;
      min-height: 0;
      display: grid;
      gap: 18px;
      padding: 18px 16px 0;
      overflow: hidden;
    }
    .stage-scene,
    .vignette {
      position: absolute;
      inset: 0;
    }
    .stage-scene {
      min-height: 100%;
    }
    .hud-top {
      position: relative;
      top: auto;
      left: auto;
      right: auto;
      z-index: 5;
      justify-content: flex-start;
    }
    .hud-top .coords {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 12px;
      padding: 10px 12px;
      font-size: 9px;
      letter-spacing: 0.12em;
    }
    .hud-top .coords > span {
      min-width: 0;
      white-space: normal;
    }
    .hud-top .coords > span:first-child {
      grid-column: 1 / -1;
      white-space: nowrap;
    }
    .hud-title {
      position: relative;
      left: auto;
      right: auto;
      top: auto;
      transform: none;
      z-index: 5;
      max-width: none;
      margin: 176px 0 0;
      pointer-events: none;
    }
    .hud-title::before {
      content: '';
      position: absolute;
      z-index: -1;
      inset: -18px -16px -14px;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--bg) 94%, transparent) 0%,
        color-mix(in srgb, var(--bg) 76%, transparent) 72%,
        transparent 100%
      );
    }
    .hud-title .kicker {
      margin-bottom: 12px;
      letter-spacing: 0.22em;
    }
    .hud-title h1 {
      margin-bottom: 16px;
    }
    .hud-title .body {
      max-width: none;
      margin-bottom: 20px;
    }
    .hero-metrics {
      max-width: none;
    }
    .report-side-stack {
      position: relative;
      left: auto;
      right: auto;
      top: auto;
      bottom: auto;
      z-index: 5;
      width: auto;
    }
    .report-calibration {
      position: relative;
      width: auto;
    }
    .report-calibration :global(.summary),
    .report-calibration :global(.encoding-grid) {
      display: none;
    }
    .report-evidence {
      position: relative;
      width: auto;
    }
    .report-evidence :global(.summary) {
      display: none;
    }
    .scrub {
      position: relative;
      left: auto;
      right: auto;
      bottom: auto;
      z-index: 5;
      margin: 6px -16px 0;
      padding: 12px 12px 14px;
      gap: 12px;
    }
    .scrub .lbl { display: none; }
    .stations-grid { grid-template-columns: 1fr; }
    .foot {
      grid-template-columns: 1fr;
      gap: 4px;
      text-align: left;
    }
    .foot .center, .foot .right { text-align: left; }
  }
  @media (max-width: 480px) {
    .stage {
      min-height: 0;
      padding-inline: 14px;
    }
    .scrub { margin-inline: -14px; }
    .hud-title { margin-top: 156px; }
    .hud-title h1 { font-size: clamp(28px, 9vw, 48px); }
    .hero-metric { padding: 8px 9px; }
    .metric-label { letter-spacing: 0.11em; }
    .metric-value { font-size: 12px; }
    .below { padding: 48px clamp(14px, 3vw, 24px) 56px; }
    .scrub .scrub-read { font-size: 9px; min-width: auto; }
    .station-card { padding: 18px 18px 20px; }
  }

  /* ── Print stylesheet ──────────────────────────────────────────────────── */
  /* Publication layout: grayscale-friendly, no canvas, footnote-style record.
     Triggered by Cmd-P / browser "Save as PDF". The signature canvas is
     replaced with the title block + per-station summary as a printed page;
     the masthead (rendered by Layout) hides itself for print under the same
     rule that hides every chrome surface. */
  @media print {
    @page { size: A4 portrait; margin: 12mm; }
    .report-surface {
      color: black;
      background: white;
    }
    .stage {
      position: static;
      height: auto;
      min-height: 0;
      background: white;
    }
    .stage-scene,
    .vignette,
    .scrub,
    .hud-top {
      display: none;
    }
    .hud-title {
      position: static;
      transform: none;
      max-width: none;
      pointer-events: auto;
    }
    .hud-title h1,
    .hud-title .body {
      color: black;
      text-shadow: none;
    }
    .hud-title .kicker,
    .hud-title .kicker .v {
      color: black;
    }
    .hud-title::before {
      display: none;
    }
    .hud-title .actions { display: none; }
    .hero-metrics {
      border-color: #ccc;
      background: #ccc;
    }
    .hero-metric {
      background: white;
    }
    .metric-label {
      color: #444;
    }
    .metric-value,
    .metric-value .u {
      color: black;
    }
    .report-side-stack {
      position: static;
      margin-top: 16px;
      pointer-events: auto;
      width: auto;
    }
    .report-side-stack :global(.instrument-calibration),
    .report-side-stack :global(.pulse-evidence) {
      color: black;
      background: white;
      border-color: #ccc;
      box-shadow: none;
    }
    .report-side-stack :global(.title),
    .report-side-stack :global(.mode),
    .report-side-stack :global(.readout .v),
    .report-side-stack :global(.cell .v) {
      color: black;
    }
    .report-side-stack :global(.summary),
    .report-side-stack :global(.readout .k),
    .report-side-stack :global(.cell .k),
    .report-side-stack :global(.source) {
      color: #444;
    }
    .below {
      padding: 16mm 0 0;
      background: white;
      page-break-before: always;
    }
    .summary-head,
    .summary-head .l,
    .record-row h3 {
      color: black;
      border-color: #ccc;
    }
    .stations-grid {
      background: white;
      border-color: #ccc;
      gap: 0;
      border-collapse: collapse;
    }
    .station-card {
      background: white;
      border: 1px solid #ccc;
    }
    .station-card .name,
    .station-card .stat .v,
    .summary-head .r .v {
      color: black;
    }
    .station-card .stat .k,
    .summary-head,
    .record-row .row .k {
      color: #555;
    }
    .record-row .row .v,
    .record-row .narrative,
    .record-row .narrative strong {
      color: black;
    }
    .record-row .narrative .ep-chip {
      color: black;
      border-color: #999;
    }
    .foot {
      color: #444;
      border-color: #ccc;
    }
    .foot .v { color: black; }
  }
</style>
