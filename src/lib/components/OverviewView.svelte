<!-- src/lib/components/OverviewView.svelte -->
<!-- Vessel v4 Overview surface — command center. Translates live measurement
     evidence into the shared diagnostic instrument shell. -->
<script lang="ts">
  import { measurementStore } from '$lib/stores/measurements';
  import { statisticsStore } from '$lib/stores/statistics';
  import { settingsStore } from '$lib/stores/settings';
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { tokens } from '$lib/tokens';
  import { navigateTo } from '$lib/router';
  import { buildDiagnosticNarrative } from '$lib/utils/diagnostic-narrative';
  import { buildDiagnosticReport } from '$lib/utils/diagnostic-report';
  import { buildDiagnosticEvidenceContract } from '$lib/utils/diagnostic-evidence-contract';
  import { buildRunStoryline, type StoryBeatSeverity } from '$lib/utils/run-storyline';
  import { deriveEndpointTone, type EndpointTone } from '$lib/utils/endpoint-tone';
  import { REGION_SHORT_CODES } from '$lib/regional-defaults';
  import type { MeasurementSample } from '$lib/types';
  import type { VerdictRow } from '$lib/utils/verdict';
  import OrbitalScene, { type OrbitalStation } from './OrbitalScene.svelte';
  import InstrumentCalibration from './InstrumentCalibration.svelte';

  const monitored = $derived($monitoredEndpointsStore);
  const stats = $derived($statisticsStore);
  const settings = $derived($settingsStore);
  const measurements = $derived($measurementStore);
  const threshold = $derived(settings.healthThreshold);

  // ── Station mapping ────────────────────────────────────────────────────────
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
  const epToStation = $derived<Record<string, string>>(
    Object.fromEntries(monitored.slice(0, 4).map((ep, i) => [ep.id, STATION_IDS[i]])),
  );

  // ── Sample windowing for OrbitalScene ──────────────────────────────────────
  const WINDOW = tokens.lane.chartWindow;
  const samplesByEndpoint = $derived.by<Record<string, readonly MeasurementSample[]>>(() => {
    const out: Record<string, readonly MeasurementSample[]> = {};
    for (const ep of monitored) {
      const state = measurements.endpoints[ep.id];
      out[ep.id] = state ? state.samples.toArray().slice(-WINDOW) : [];
    }
    return out;
  });
  const stationData = $derived.by<Record<string, readonly (number | null)[]>>(() => {
    const out: Record<string, (number | null)[]> = {};
    for (const ep of monitored.slice(0, 4)) {
      const id = epToStation[ep.id];
      const tail = samplesByEndpoint[ep.id] ?? [];
      const buf: (number | null)[] = new Array(WINDOW).fill(null);
      const offset = WINDOW - tail.length;
      for (let i = 0; i < tail.length; i++) {
        const s = tail[i];
        buf[offset + i] = s.status === 'ok' ? s.latency : null;
      }
      out[id] = buf;
    }
    return out;
  });

  // ── Diagnostic narrative + storyline ───────────────────────────────────────
  const verdictRows: readonly VerdictRow[] = $derived.by(() => {
    const rows: VerdictRow[] = [];
    for (const ep of monitored) {
      const rowStats = stats[ep.id];
      if (rowStats?.ready) rows.push({ ep, stats: rowStats });
    }
    return rows;
  });
  const diagnosticNarrative = $derived(buildDiagnosticNarrative({
    rows: verdictRows,
    threshold,
    corsMode: settings.corsMode,
    samplesByEndpoint,
    monitoredEndpointCount: monitored.length,
  }));
  const diagnosticReport = $derived(buildDiagnosticReport({
    endpoints: monitored,
    stats,
    measurements,
    settings,
    context: null,
  }));
  const evidenceContract = $derived(buildDiagnosticEvidenceContract({
    report: diagnosticReport,
    endpoints: monitored,
    measurements,
    thresholdMs: diagnosticReport.threshold,
  }));
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
    threshold,
    runStart: measurements.startedAt,
    maxVisibleRows: Math.max(monitored.length, 4),
  }));

  // ── v4 sigil mapping (stable / warn / bad / crit) ──────────────────────────
  // Diagnostic narrative's severity → v4 verdict sigil. The "kind" field
  // gives finer-grained info; we use it for the body text but the visual
  // sigil collapses to four states.
  type Sigil = 'stable' | 'warn' | 'bad' | 'crit';
  const sigil = $derived<Sigil>((() => {
    const kind = diagnosticNarrative.kind;
    if (kind === 'collecting') return 'stable';
    if (kind === 'healthy') return 'stable';
    const sev = diagnosticNarrative.severity;
    if (sev === 'healthy') return 'stable';
    if (sev === 'degraded') {
      // Surface 'crit' if any endpoint is timing out
      const anyCrit = verdictRows.some((r) => r.stats.lossPercent >= 10);
      return anyCrit ? 'crit' : 'bad';
    }
    return 'warn';
  })());

  const verdictHeadline = $derived(evidenceContract.overview.headline);
  const verdictBody = $derived(diagnosticNarrative.supportingSummary);
  // Second observer's-notes paragraph — distinct from the headline by design.
  // Each diagnostic kind gets a sentence that says what the headline implies
  // *for the user*, not a restated version of it. Mirrors the interpretation
  // copy shipped in PR #190 to v2 and preserved through v4.
  // Observer's-notes second paragraph. The first paragraph (verdictBodySegments)
  // now carries the measured-fact narrative across all states (see
  // supportingSummaryFor in $lib/utils/diagnostic-narrative.ts). This second
  // paragraph is the next-step / what-to-watch-for follow-on so the notes
  // panel adds value beyond the body rather than restating it.
  const interpretation = $derived.by<string>(() => {
    switch (diagnosticNarrative.kind) {
      case 'collecting':
        return 'The diagnosis becomes actionable once each site has a few mature samples — usually within the next minute as the cadence holds at 1 round per second.';
      case 'healthy':
        return 'If anything changes — drift, jitter, packet loss, or a single-site spike — the live tracker surfaces it within one round. Until then, treat this window as a clean baseline.';
      case 'isolated-endpoint':
        return "Next move: run an outside transit check. If a Cloudflare edge sees the same slowness, the source is the endpoint itself. If the edge sees clean responses, the path from your browser is suspect.";
      case 'shared-network':
        return 'Check your local network first — Wi-Fi quality, VPN, or upstream ISP saturation are the common causes. An outside transit check from a Cloudflare edge confirms whether the slowness is local to you or shared more broadly.';
      case 'multiple-slow':
        return 'Run an outside transit check from a Cloudflare edge. If the same sites slow there too, the cause is genuinely shared. If only your browser sees them slow, the issue is local to this network.';
      case 'packet-loss':
        return 'Run an outside transit check. If failures appear from a Cloudflare edge too, the endpoint or path is suspect. If the edge succeeds, the issue is local to this network or your browser configuration.';
      case 'jitter':
        return "Watch whether the swings settle or escalate. Congestion that resolves on its own is common; sustained jitter usually means a path is overloaded or there's contention upstream.";
    }
  });

  // Per-endpoint tone lookup used by highlightEndpoints to colour inline chips.
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
          healthThreshold: threshold,
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

  const verdictBodySegments = $derived(highlightEndpoints(verdictBody));
  const interpretationSegments = $derived(highlightEndpoints(interpretation));

  const verdictKickerText = $derived<string>((() => {
    if (diagnosticNarrative.kind === 'collecting') return 'Acquiring · awaiting samples';
    if (sigil === 'stable') return 'In transit · all stations nominal';
    if (sigil === 'warn') return 'Carrier wobble · band widening';
    if (sigil === 'bad') return 'Doppler · isolated drift';
    return 'Carrier lost · alarm';
  })());

  // ── Coords + flight card derived data ──────────────────────────────────────
  const elapsedMs = $derived.by(() => {
    if (!measurements.startedAt) return 0;
    return Date.now() - measurements.startedAt;
  });
  const elapsedLabel = $derived.by(() => {
    const total = Math.floor(elapsedMs / 1000);
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  });
  const raCoord = $derived.by(() => {
    const m = Math.floor(elapsedMs / 60000) % 24;
    return `06h ${m.toString().padStart(2, '0')}m`;
  });
  const decCoord = $derived.by(() => {
    const m = Math.floor(elapsedMs / 60000) % 90;
    const s = Math.floor((elapsedMs % 60000) / 1000);
    return `+${m.toString().padStart(2, '0')}°${s.toString().padStart(2, '0')}′`;
  });

  // Pseudo-cert identifier — deterministic from session start. CHR-YYMMDD-HHMM-Axx.
  const flightCert = $derived.by(() => {
    if (!measurements.startedAt) return 'CHR–pending';
    const d = new Date(measurements.startedAt);
    const yy = d.getUTCFullYear().toString().slice(-2);
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    const HH = d.getUTCHours().toString().padStart(2, '0');
    const MM = d.getUTCMinutes().toString().padStart(2, '0');
    const seedStr = (d.getTime() % 4096).toString(16).toUpperCase().padStart(3, '0');
    return `CHR–${yy}${mm}${dd}–${HH}${MM}–${seedStr}`;
  });
  const startedLabel = $derived.by(() => {
    if (!measurements.startedAt) return '—';
    return new Date(measurements.startedAt).toISOString().slice(11, 19) + ' UTC';
  });
  const roundsLabel = $derived(`${measurements.roundCounter} / ${settings.cap}`);
  const cadenceLabel = $derived(`${(settings.monitorDelay / 1000).toFixed(0)} s · synchronized`);
  const vantageLabel = $derived.by(() => {
    if (typeof navigator === 'undefined') return 'Browser · — · —';
    const ua = navigator.userAgent;
    const ch = ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : ua.includes('Firefox') ? 'Firefox' : 'Browser';
    const os = ua.includes('Mac') ? 'macOS' : ua.includes('Win') ? 'Windows' : ua.includes('Linux') ? 'Linux' : 'OS';
    // Append the user's regional default as a short code (e.g. "US-W") to
    // match the v4 prototype's terse vantage row. Long-form names live in
    // REGION_DISPLAY_NAMES for body copy / settings; the FlightCard chrome
    // wants the compact form. Region is optional; omit gracefully when unset.
    const regionLabel = settings.region ? REGION_SHORT_CODES[settings.region] : '';
    return regionLabel ? `${ch} · ${os} · ${regionLabel}` : `${ch} · ${os}`;
  });

  // ── Station rows for the card ──────────────────────────────────────────────
  interface StationCardRow {
    readonly id: string;
    readonly stationId: string;
    readonly name: string;
    readonly host: string;
    readonly latency: number | null;
    readonly drift: number | null;
    readonly sigil: 'stable' | 'warn' | 'bad' | 'crit';
    readonly stateText: string;
    readonly endpointId: string;
  }
  const stationRows = $derived<readonly StationCardRow[]>(
    monitored.slice(0, 4).map((ep, i) => {
      const m = measurements.endpoints[ep.id];
      const s = stats[ep.id];
      const last = m?.lastLatency ?? null;
      const baseline = s?.p50 ?? null;
      const drift = (last !== null && baseline !== null) ? Math.round(last - baseline) : null;
      let sig: StationCardRow['sigil'] = 'stable';
      let stateText = 'Carrier acquired';
      if (last !== null) {
        if (last > threshold * 1.5) { sig = 'crit'; stateText = 'Carrier lost'; }
        else if (last > threshold) { sig = 'bad'; stateText = 'Doppler drift'; }
        else if (s?.ready && s.p95 > threshold * 0.85) { sig = 'warn'; stateText = 'Carrier wobble'; }
      } else if (s === undefined || !s.ready) {
        stateText = 'Acquiring';
      }
      const host = (() => {
        try {
          return new URL(ep.url).host;
        } catch {
          return ep.url;
        }
      })();
      return {
        id: STATION_IDS[i],
        stationId: STATION_IDS[i],
        name: ep.label,
        host,
        latency: last,
        drift,
        sigil: sig,
        stateText,
        endpointId: ep.id,
      };
    }),
  );

  // ── Field-level p50/p95 ────────────────────────────────────────────────────
  function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
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

  // ── Event log ──────────────────────────────────────────────────────────────
  function severityToSigil(sev: StoryBeatSeverity): Sigil | '' {
    switch (sev) {
      case 'good':  return 'stable';
      case 'watch': return 'warn';
      case 'bad':   return 'bad';
      default:      return '';
    }
  }
  function relTime(at: number | null): string {
    if (at === null || !measurements.startedAt) return '—';
    const total = Math.max(0, Math.floor((at - measurements.startedAt) / 1000));
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `T+${mm}:${ss}`;
  }
  function beatTag(beat: { endpointIds: readonly string[] }): string {
    if (beat.endpointIds.length === 0) return 'FIELD';
    const ep = monitored.find((e) => e.id === beat.endpointIds[0]);
    return ep ? ep.label.toUpperCase() : 'FIELD';
  }
  const eventBeats = $derived(runStoryline.beats.slice(-7));

  // ── Command-center evidence model ─────────────────────────────────────────
  function sampleAtRound(endpointId: string, roundNumber: number): MeasurementSample | null {
    const samples = measurements.endpoints[endpointId]?.samples.toArray() ?? [];
    return samples.find((sample) => Math.round(sample.round) === roundNumber) ?? null;
  }
  const peerBehaviorLine = $derived.by<string>(() => {
    const event = evidenceContract.notableEvent;
    if (event === null) return 'No standout event to compare against peers.';
    const peers = monitored.filter((ep) => ep.enabled && ep.id !== event.endpointId).slice(0, 3);
    let movedPeers = 0;
    let cleanPeers = 0;
    for (const peer of peers) {
      const sample = sampleAtRound(peer.id, event.roundNumber);
      if (!sample) continue;
      if (sample.status !== 'ok' || sample.latency > threshold) movedPeers++;
      else cleanPeers++;
    }
    if (movedPeers === 0 && cleanPeers > 0) return `Peers stayed clean at ${event.roundLabel}; this reads as endpoint-local evidence.`;
    if (movedPeers > 0) return `${movedPeers} peer${movedPeers === 1 ? '' : 's'} moved in the same round; validate shared path before blaming one endpoint.`;
    return `No same-round peer samples were available for ${event.roundLabel}.`;
  });
  const limitationLine = $derived(
    diagnosticNarrative.limitations[0]?.headline ?? diagnosticNarrative.timingVisibility.headline,
  );

  type CommandActionKind = 'live' | 'investigate' | 'endpoint' | 'report' | 'transit';
  interface CommandAction {
    readonly kind: CommandActionKind;
    readonly label: string;
    readonly detail: string;
    readonly endpointId?: string;
    readonly primary?: boolean;
  }
  const commandActions = $derived.by<readonly CommandAction[]>(() => {
    const event = evidenceContract.notableEvent;
    const firstTriage = diagnosticNarrative.triageActions[0];
    if (event) {
      return [
        {
          kind: 'endpoint',
          endpointId: event.endpointId,
          label: `Inspect ${event.endpointLabel}`,
          detail: `${event.roundLabel} is the strongest event in this window.`,
          primary: true,
        },
        {
          kind: 'live',
          label: 'Watch recurrence',
          detail: 'Open the live instrument and pin the next matching pulse.',
        },
        {
          kind: 'report',
          label: 'Share proof',
          detail: 'Open the recorded artifact with the event separated from current health.',
        },
      ];
    }
    return [
      {
        kind: firstTriage?.id === 'share-snapshot' ? 'report' : 'live',
        label: firstTriage?.label ?? 'Keep watching',
        detail: firstTriage?.action ?? 'Continue the run until a decision point appears.',
        primary: true,
      },
      {
        kind: 'investigate',
        label: 'Compare stations',
        detail: 'Open the forensic view if the field starts to drift.',
      },
      {
        kind: 'report',
        label: 'Capture baseline',
        detail: 'Save this clean window as proof for later comparison.',
      },
    ];
  });

  // ── Actions ────────────────────────────────────────────────────────────────
  function openLive(): void {
    navigateTo({ name: 'live', endpointId: null });
  }
  function openInvestigate(): void {
    navigateTo({ name: 'investigate', endpointId: null });
  }
  function openReport(): void {
    navigateTo({ name: 'report', endpointId: null });
  }
  function runCommandAction(action: CommandAction): void {
    switch (action.kind) {
      case 'live':
        openLive();
        break;
      case 'investigate':
        openInvestigate();
        break;
      case 'endpoint':
        if (action.endpointId) navigateTo({ name: 'endpoint', endpointId: action.endpointId });
        else openInvestigate();
        break;
      case 'report':
        openReport();
        break;
      case 'transit':
        navigateTo({ name: 'transit', endpointId: null });
        break;
    }
  }
</script>

<div class="overview-surface">
  <div class="titlestrip">
    <h2>Overview<span class="sub">Command center</span></h2>
    <div class="coords">
      <span>Round<span class="v">{measurements.roundCounter}</span></span>
      <span>T+<span class="v">{elapsedLabel}</span></span>
      <span>Window<span class="v">{WINDOW} s</span></span>
      <span>R.A.<span class="v">{raCoord}</span></span>
      <span>Dec<span class="v">{decCoord}</span></span>
    </div>
  </div>

  <section class="command-center" data-sigil={sigil}>
    <div class="verdict-console">
      <div class="console-topline">
        <span class="signal" data-s={sigil}></span>
        <span>{verdictKickerText}</span>
        <span class="confidence">{diagnosticNarrative.confidenceLabel}</span>
      </div>
      <h1>{verdictHeadline}</h1>
      <p class="lede">
        {#each verdictBodySegments as segment, i (i)}
          {#if segment.tone}<span class="ep-chip" data-tone={segment.tone}>{segment.text}</span>{:else}{segment.text}{/if}
        {/each}
      </p>
      <div class="diagnostic-contract-strip command-evidence" aria-label="Diagnostic evidence summary">
        <div class="contract-item current primary">
          <span class="k">Current</span>
          <span class="v">{evidenceContract.current.headline}</span>
        </div>
        <div class="contract-item notable primary" data-tone={evidenceContract.notableEvent?.tone ?? 'info'}>
          <span class="k">Notable</span>
          <span class="v">{evidenceContract.overview.notableLine}</span>
        </div>
        <div class="contract-item next primary">
          <span class="k">Next</span>
          <span class="v">{evidenceContract.overview.nextLine}</span>
        </div>
        <div class="contract-item">
          <span class="k">Peer behavior</span>
          <span class="v">{peerBehaviorLine}</span>
        </div>
        <div class="contract-item">
          <span class="k">Confidence</span>
          <span class="v">{diagnosticNarrative.confidenceReason}</span>
        </div>
        <div class="contract-item">
          <span class="k">Limit</span>
          <span class="v">{limitationLine}</span>
        </div>
      </div>
      <div class="action-rail" aria-label="Recommended actions">
        {#each commandActions as action (action.label)}
          <button
            type="button"
            class:primary={action.primary}
            onclick={() => runCommandAction(action)}
          >
            <span class="label">{action.label}</span>
            <span class="detail">{action.detail}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="field-console">
      <div class="field-head">
        <span>Field map</span>
        <strong>{stationRows.length} stations</strong>
      </div>
      <div class="orbit-stage">
        {#if stations.length > 0}
          <OrbitalScene
            {stations}
            {stationData}
            triggerMs={threshold}
            windowSeconds={WINDOW}
            windowRounds={WINDOW}
          />
        {/if}
        <div class="label">
          <div>
            <div class="k">Field p50</div>
            <div class="v">
              {#if fieldP50 === null}<span class="awaiting">—</span>{:else}{fieldP50}<span class="u">ms</span>{/if}
            </div>
          </div>
        </div>
      </div>
      <div class="field-readouts">
        <div>
          <span class="k">p95</span>
          <span class="v">{#if fieldP95 === null}—{:else}{fieldP95}<em>ms</em>{/if}</span>
        </div>
        <div>
          <span class="k">Trigger</span>
          <span class="v">{threshold}<em>ms</em></span>
        </div>
        <div>
          <span class="k">Window</span>
          <span class="v">{WINDOW}<em>s</em></span>
        </div>
      </div>
      <div class="field-legend" aria-label="Field map encoding summary">
        <span><i class="angle"></i>Angle time</span>
        <span><i class="radius"></i>Radius latency</span>
        <span><i class="pulse"></i>Pulse severity</span>
      </div>
    </div>
  </section>

  <section class="station-command">
    <div class="section-head">
      <h3>Station board</h3>
      <span>{evidenceContract.current.headline}</span>
    </div>
    <div class="stations">
      {#each stationRows as row (row.endpointId)}
        <div class="srow" data-ep={row.stationId}>
          <span class="mk"></span>
          <div class="nm">
            {row.name}
            <span class="host">{row.host}</span>
          </div>
          <div class="state" data-s={row.sigil}>{row.stateText}</div>
          <div class="val" class:bad={row.sigil === 'bad'} class:crit={row.sigil === 'crit'}>
            {#if row.latency === null}—{:else}{Math.round(row.latency)}<span class="u">ms</span>{/if}
          </div>
          <div class="drift">
            <span class="k">drift</span>
            {#if row.drift === null}—{:else}{row.drift >= 0 ? '+' : ''}{row.drift} ms{/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="calibration-band">
    <InstrumentCalibration
      mode="overview"
      thresholdMs={threshold}
      windowSeconds={WINDOW}
      sampleSlots={WINDOW}
      baselineMs={fieldP50}
      stationCount={stations.length}
      cadenceMs={settings.monitorDelay}
      compact={true}
    />
  </section>

  <section class="record-command">
    <div class="flight">
      <h3>Flight card · <span class="v">{flightCert}</span></h3>
      <div class="frow"><span class="k">Started</span><span class="v">{startedLabel}</span></div>
      <div class="frow"><span class="k">Rounds</span><span class="v">{roundsLabel}</span></div>
      <div class="frow"><span class="k">Cadence</span><span class="v">{cadenceLabel}</span></div>
      <div class="frow"><span class="k">Vantage</span><span class="v">{vantageLabel}</span></div>
      <div class="frow"><span class="k">Trigger</span><span class="v">{threshold} ms</span></div>
      <div class="frow"><span class="k">R.A. / Dec</span><span class="v">{raCoord} / {decCoord}</span></div>
      <div class="marks">
        {#each stationRows as row (row.endpointId)}
          <span class="m" data-ep={row.stationId} data-s={row.sigil}></span>
        {/each}
      </div>
    </div>

  </section>

  <section class="log-section">
    <div>
      <h3>Telemetry log · <span class="v">current window</span></h3>
      <div class="events">
        {#if eventBeats.length === 0}
          <div class="event">
            <span class="t">T+00:00</span>
            <span class="b">No notable events in the current window yet.</span>
            <span class="tag">ACQ</span>
          </div>
        {:else}
          {#each eventBeats as beat (beat.id)}
            <div class="event">
              <span class="t">{relTime(beat.t)}</span>
              <span class="b">{beat.label}</span>
              <span class="tag" data-s={severityToSigil(beat.severity)}>{beatTag(beat)}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
    <div class="notes">
      <h3>Observer's notes</h3>
      <p>
        {#each verdictBodySegments as segment, i (i)}
          {#if segment.tone}<span class="ep-chip" data-tone={segment.tone}>{segment.text}</span>{:else}{segment.text}{/if}
        {/each}
      </p>
      <p>
        {#each interpretationSegments as segment, i (i)}
          {#if segment.tone}<span class="ep-chip" data-tone={segment.tone}>{segment.text}</span>{:else}{segment.text}{/if}
        {/each}
      </p>
      <div class="field-stats">
        <div class="s">
          <div class="k">Field p50</div>
          <div class="v">{#if fieldP50 === null}—{:else}{fieldP50}<span class="u">ms</span>{/if}</div>
        </div>
        <div class="s">
          <div class="k">Field p95</div>
          <div class="v">{#if fieldP95 === null}—{:else}{fieldP95}<span class="u">ms</span>{/if}</div>
        </div>
      </div>
    </div>
  </section>

  <footer class="foot">
    <div>Cert<span class="v">{flightCert}</span></div>
    <div class="center">Browser-resident observatory · no telemetry leaves this device</div>
    <div class="right">Auto end at round <span class="v">{settings.cap}</span></div>
  </footer>
</div>

<style>
  .overview-surface {
    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.55;
  }

  /* ── Titlestrip ─────────────────────────────────────────────────────────── */
  .titlestrip {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 32px;
    padding: 22px clamp(20px, 3vw, 48px) 18px;
    border-bottom: 1px solid var(--rule);
  }
  .titlestrip h2 {
    font-size: 28px;
    font-weight: 300;
    letter-spacing: -0.02em;
    color: var(--fg);
    line-height: 1;
    margin: 0;
  }
  .titlestrip h2 .sub { margin-left: 18px; color: var(--fg-3); font-size: 16px; }
  .titlestrip .coords {
    display: inline-flex;
    gap: 22px;
    flex-wrap: wrap;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .titlestrip .coords > span { white-space: nowrap; }
  .titlestrip .coords .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 8px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Command center ─────────────────────────────────────────────────────── */
  .command-center {
    display: grid;
    grid-template-columns: minmax(0, 1.16fr) minmax(330px, 0.84fr);
    gap: 28px;
    padding: 24px clamp(20px, 3vw, 48px) 28px;
    align-items: start;
    min-height: auto;
    position: relative;
    border-bottom: 1px solid var(--rule);
  }
  .verdict-console {
    min-width: 0;
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: start;
    border-top: 1px solid var(--rule-strong);
    border-bottom: 1px solid var(--rule);
    padding: 22px 0;
  }
  .console-topline {
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 16px;
    font-weight: 700;
  }
  .console-topline .signal {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
  }
  .console-topline .signal[data-s="stable"] { background: var(--station-b); box-shadow: 0 0 10px var(--station-b); }
  .console-topline .signal[data-s="warn"]   { background: var(--sev-warn);  box-shadow: 0 0 10px var(--sev-warn); }
  .console-topline .signal[data-s="bad"]    { background: var(--sev-bad);   box-shadow: 0 0 10px var(--sev-bad); }
  .console-topline .signal[data-s="crit"]   { background: var(--sev-crit);  box-shadow: 0 0 10px var(--sev-crit); }
  .console-topline .confidence {
    color: var(--fg);
    margin-left: auto;
    letter-spacing: 0.16em;
  }
  .verdict-console h1 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(36px, 4.5vw, 64px);
    letter-spacing: -0.024em;
    line-height: 1.02;
    color: var(--fg);
    margin: 0 0 18px;
    text-shadow: 0 0 60px color-mix(in srgb, var(--fg) 10%, transparent),
                 0 0 120px color-mix(in srgb, var(--station-b) 6%, transparent);
    max-width: 17ch;
  }
  .verdict-console .lede {
    font-size: 15px;
    color: var(--fg-2);
    line-height: 1.45;
    margin: 0 0 16px;
    max-width: 68ch;
  }
  /* Inline endpoint-name chip — small monospace pill with a station-coloured
     border. Per-tone colour is set via [data-tone] so each chip carries the
     endpoint's current health colour. Used in both the verdict lede and the
     observer's-notes paragraphs. */
  .ep-chip {
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
  .ep-chip[data-tone="good"]       { border-color: var(--station-b); color: var(--station-b); }
  .ep-chip[data-tone="watch"]      { border-color: var(--sev-warn);  color: var(--sev-warn); }
  .ep-chip[data-tone="bad"]        { border-color: var(--sev-bad);   color: var(--sev-bad); }
  .ep-chip[data-tone="collecting"] { border-color: var(--rule-strong); color: var(--fg-3); }
  .diagnostic-contract-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
    margin: 0 0 12px;
  }
  .contract-item {
    min-width: 0;
    background: color-mix(in srgb, var(--bg-2) 72%, var(--bg));
    padding: 10px 12px 12px;
  }
  .contract-item.current { background: var(--bg); }
  .contract-item.primary {
    background: color-mix(in srgb, var(--bg) 86%, var(--fg) 2%);
  }
  .contract-item .k {
    display: block;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 6px;
  }
  .contract-item .v {
    display: block;
    color: var(--fg-2);
    font-size: 11.5px;
    line-height: 1.36;
  }
  .contract-item.primary .v { color: var(--fg); }
  .contract-item[data-tone="watch"] .v { color: var(--sev-warn); }
  .contract-item[data-tone="degraded"] .v { color: var(--sev-bad); }

  .action-rail {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .action-rail button {
    text-align: left;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--rule);
    padding: 10px 12px;
    cursor: pointer;
    transition: background 80ms, border-color 80ms, color 80ms;
  }
  .action-rail button:hover {
    border-color: var(--rule-strong);
    background: var(--bg-2);
    color: var(--fg);
  }
  .action-rail button.primary {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }
  .action-rail button:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .action-rail .label {
    display: block;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .action-rail .detail {
    display: block;
    font-size: 12px;
    line-height: 1.32;
    color: inherit;
    opacity: 0.78;
  }

  /* Field map */
  .field-console {
    position: relative;
    display: grid;
    grid-template-rows: auto auto auto auto;
    gap: 10px;
    width: 100%;
    min-width: 0;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg-2) 58%, var(--bg));
    padding: 14px;
  }
  .field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 12px;
  }
  .field-head strong {
    color: var(--fg);
    font-weight: 700;
  }
  .orbit-stage {
    position: relative;
    aspect-ratio: 1 / 1;
    width: 100%;
    max-width: 360px;
    margin: 0 auto;
  }
  .orbit-stage .label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    text-align: center;
  }
  .orbit-stage .label .k {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 4px;
  }
  .orbit-stage .label .v {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(40px, 5vw, 72px);
    letter-spacing: -0.025em;
    line-height: 1;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 30px color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .orbit-stage .label .v .u {
    font-family: var(--mono);
    font-size: 0.32em;
    color: var(--fg-3);
    margin-left: 4px;
    letter-spacing: 0.05em;
    vertical-align: 0.8em;
    text-shadow: none;
  }
  .orbit-stage .label .v .awaiting { color: var(--fg-3); }
  .field-readouts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }
  .field-readouts > div {
    padding: 9px 10px;
    border-left: 1px solid var(--rule);
  }
  .field-readouts > div:first-child { border-left: 0; }
  .field-readouts .k,
  .field-readouts .v {
    display: block;
  }
  .field-readouts .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 5px;
  }
  .field-readouts .v {
    font-family: var(--mono);
    font-size: 16px;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .field-readouts .v em {
    font-style: normal;
    color: var(--fg-3);
    font-size: 10px;
    margin-left: 2px;
  }
  .field-legend {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .field-legend span {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 700;
    white-space: nowrap;
  }
  .field-legend i {
    display: inline-block;
    width: 11px;
    height: 11px;
    position: relative;
    flex: 0 0 auto;
  }
  .field-legend i.angle::before {
    content: '';
    position: absolute;
    inset: 2px;
    border: 1px solid var(--fg-3);
    border-right-color: var(--station-b);
    border-radius: 50%;
  }
  .field-legend i.radius::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 5px;
    height: 1px;
    background: var(--station-a);
  }
  .field-legend i.pulse::before {
    content: '';
    position: absolute;
    inset: 3px;
    background: var(--sev-warn);
    border-radius: 50%;
    box-shadow: 0 0 8px var(--sev-warn);
  }

  .calibration-band {
    padding: 20px clamp(20px, 3vw, 48px) 0;
  }
  .calibration-band :global(.instrument-calibration) {
    max-width: none;
    box-shadow: none;
    background: color-mix(in srgb, var(--bg-2) 48%, var(--bg));
  }

  /* ── Station board + record row ─────────────────────────────────────────── */
  .station-command {
    padding: 30px clamp(20px, 3vw, 48px) 0;
  }
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 14px;
  }
  .section-head h3 {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin: 0;
  }
  .section-head span {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--fg-3);
    text-align: right;
  }
  .record-command {
    padding: 30px clamp(20px, 3vw, 48px) 36px;
    display: flex;
    justify-content: flex-start;
    border-bottom: 1px solid var(--rule);
  }
  .stations {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .srow {
    background: var(--bg);
    padding: 18px 22px;
    display: grid;
    grid-template-columns: 14px 1fr auto auto auto;
    gap: 22px;
    align-items: center;
  }
  .srow .mk { width: 8px; height: 8px; }
  .srow[data-ep="A"] .mk { background: var(--station-a); box-shadow: 0 0 10px var(--station-a); }
  .srow[data-ep="B"] .mk { background: var(--station-b); box-shadow: 0 0 10px var(--station-b); }
  .srow[data-ep="C"] .mk { background: var(--station-c); box-shadow: 0 0 10px var(--station-c); }
  .srow[data-ep="D"] .mk { background: var(--station-d); box-shadow: 0 0 10px var(--station-d); }
  .srow .nm {
    font-size: 16px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
  }
  .srow .nm .host {
    display: block;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.02em;
    margin-top: 3px;
    font-variant-numeric: tabular-nums;
  }
  .srow .state {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--fg-3);
    min-width: 130px;
    text-align: right;
  }
  .srow .state[data-s="stable"] { color: var(--station-b); }
  .srow .state[data-s="warn"]   { color: var(--sev-warn); }
  .srow .state[data-s="bad"]    { color: var(--sev-bad); }
  .srow .state[data-s="crit"]   { color: var(--sev-crit); }
  .srow .val {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 22px;
    font-weight: 400;
    color: var(--fg);
    letter-spacing: -0.01em;
    min-width: 80px;
    text-align: right;
  }
  .srow .val.bad  { color: var(--sev-bad); }
  .srow .val.crit { color: var(--sev-crit); }
  .srow .val .u { font-size: 11px; color: var(--fg-3); margin-left: 2px; }
  .srow .drift {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    color: var(--fg-2);
    min-width: 80px;
    text-align: right;
  }
  .srow .drift .k { color: var(--fg-3); margin-right: 4px; }

  /* Flight card */
  .flight {
    box-sizing: border-box;
    width: min(100%, 620px);
    padding: 18px 20px 16px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg-2) 44%, var(--bg));
    font-family: var(--mono);
  }
  .flight h3 {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin: 0 0 18px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .flight h3 .v { color: var(--fg); font-weight: 700; }
  .flight .frow {
    display: grid;
    grid-template-columns: minmax(96px, 118px) minmax(0, 1fr);
    gap: 6px 18px;
    padding: 9px 0;
    border-bottom: 1px solid var(--rule-faint);
    font-size: 11px;
  }
  .flight .frow:last-of-type { border-bottom: 0; }
  .flight .frow .k {
    color: var(--fg-3);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-size: 10px;
    white-space: nowrap;
    font-weight: 700;
  }
  .flight .frow .v {
    min-width: 0;
    justify-self: end;
    text-align: right;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .flight .marks {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
  }
  .flight .marks .m { width: 10px; height: 10px; }
  .flight .marks .m[data-ep="A"][data-s="stable"] { background: var(--station-a); box-shadow: 0 0 6px var(--station-a); }
  .flight .marks .m[data-ep="B"][data-s="stable"] { background: var(--station-b); box-shadow: 0 0 6px var(--station-b); }
  .flight .marks .m[data-ep="C"][data-s="stable"] { background: var(--station-c); box-shadow: 0 0 6px var(--station-c); }
  .flight .marks .m[data-ep="D"][data-s="stable"] { background: var(--station-d); box-shadow: 0 0 6px var(--station-d); }
  .flight .marks .m[data-s="warn"] { background: var(--sev-warn); box-shadow: 0 0 6px var(--sev-warn); }
  .flight .marks .m[data-s="bad"]  { background: var(--sev-bad);  box-shadow: 0 0 6px var(--sev-bad); }
  .flight .marks .m[data-s="crit"] { background: var(--sev-crit); box-shadow: 0 0 6px var(--sev-crit); }
  /* ── Log section ────────────────────────────────────────────────────────── */
  .log-section {
    padding: 40px clamp(20px, 3vw, 48px) 48px;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 56px;
    border-bottom: 1px solid var(--rule);
  }
  .log-section h3 {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin: 0 0 18px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .log-section h3 .v { color: var(--fg); font-weight: 700; }
  .events .event {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 18px;
    padding: 12px 0;
    border-bottom: 1px solid var(--rule-faint);
    align-items: baseline;
    font-size: 13px;
  }
  .events .event .t {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .events .event .b { color: var(--fg-2); line-height: 1.45; }
  .events .event .tag {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    white-space: nowrap;
  }
  .events .event .tag[data-s="stable"] { color: var(--station-b); }
  .events .event .tag[data-s="warn"]   { color: var(--sev-warn); }
  .events .event .tag[data-s="bad"]    { color: var(--sev-bad); }
  .events .event .tag[data-s="crit"]   { color: var(--sev-crit); }

  .notes p {
    font-size: 14px;
    color: var(--fg-2);
    line-height: 1.55;
    margin-bottom: 14px;
  }
  .notes .field-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
  }
  .notes .field-stats .s { padding: 0 18px; }
  .notes .field-stats .s:first-child {
    padding-left: 0;
    border-right: 1px solid var(--rule);
  }
  .notes .field-stats .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 8px;
  }
  .notes .field-stats .v {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 24px;
    font-weight: 400;
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .notes .field-stats .v .u { font-size: 11px; color: var(--fg-3); margin-left: 2px; }

  /* ── Footer ─────────────────────────────────────────────────────────────── */
  .foot {
    padding: 16px clamp(20px, 3vw, 48px);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .foot .v { color: var(--fg); margin-left: 6px; font-weight: 700; }
  .foot .center { text-align: center; }
  .foot .right { text-align: right; }

  /* ── Mobile ─────────────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .command-center {
      grid-template-columns: 1fr;
      gap: 24px;
      min-height: auto;
      padding: 24px clamp(20px, 3vw, 48px) 30px;
    }
    .verdict-console {
      padding: 20px 0;
    }
    .verdict-console h1 {
      max-width: min(720px, 90vw);
      font-size: clamp(34px, 8vw, 58px);
    }
    .field-console { grid-template-columns: minmax(0, 1fr); }
    .orbit-stage { max-width: 380px; }
    .log-section { grid-template-columns: 1fr; gap: 36px; }
  }
  @media (max-width: 720px) {
    .titlestrip {
      grid-template-columns: 1fr;
      align-items: start;
      gap: 14px;
    }
    .titlestrip .coords {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px 14px;
    }
    .srow { grid-template-columns: 14px 1fr auto; gap: 12px; }
    .srow .val, .srow .drift { display: none; }
    .console-topline {
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }
    .console-topline .confidence {
      margin-left: 0;
      width: 100%;
    }
    .action-rail {
      order: 1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .action-rail button.primary {
      grid-column: 1 / -1;
    }
    .diagnostic-contract-strip {
      order: 2;
    }
    .verdict-console .lede {
      order: 3;
    }
    .diagnostic-contract-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
    }
    .field-console {
      padding: 12px;
    }
    .field-legend {
      grid-template-columns: 1fr;
    }
    .orbit-stage {
      max-width: min(320px, 82vw);
    }
    .section-head {
      display: grid;
      gap: 6px;
    }
    .section-head span { text-align: left; }
    .foot { grid-template-columns: 1fr; gap: 4px; text-align: left; }
    .foot .center, .foot .right { text-align: left; }
  }
  @media (max-width: 480px) {
    .titlestrip { padding: 16px clamp(20px, 3vw, 48px) 14px; gap: 12px; }
    .titlestrip h2 { font-size: 22px; }
    .titlestrip h2 .sub { font-size: 12px; margin-left: 0; display: block; margin-top: 3px; }
    .titlestrip .coords { font-size: 9px; letter-spacing: 0.12em; gap: 12px; }
    .command-center {
      gap: 16px;
      padding-top: 18px;
      padding-bottom: 24px;
    }
    .verdict-console {
      padding: 16px 0;
    }
    .verdict-console h1 {
      font-size: clamp(30px, 10vw, 40px);
      line-height: 1.04;
      margin-bottom: 12px;
    }
    .verdict-console .lede {
      font-size: 13px;
      line-height: 1.42;
      margin-bottom: 12px;
    }
    .contract-item {
      padding: 9px 10px 10px;
    }
    .contract-item .v {
      font-size: 10.5px;
      line-height: 1.34;
    }
    .action-rail button {
      padding: 9px 10px;
    }
    .action-rail .detail {
      font-size: 11px;
    }
    .action-rail button:not(.primary) .detail {
      display: none;
    }
    .action-rail button:not(.primary) {
      background: color-mix(in srgb, var(--bg-2) 52%, transparent);
    }
    .action-rail button:not(.primary) .label {
      margin-bottom: 0;
    }
    .calibration-band {
      padding-top: 14px;
    }
    .record-command {
      padding-top: 22px;
      padding-bottom: 28px;
    }
    .flight {
      padding: 14px;
    }
    .flight h3 {
      margin-bottom: 14px;
    }
    .flight .frow {
      grid-template-columns: minmax(88px, 104px) minmax(0, 1fr);
      gap: 6px 12px;
    }
  }
</style>
