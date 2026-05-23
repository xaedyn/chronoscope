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
  import { endpointStore } from '$lib/stores/endpoints';
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
  import { buildRunStoryline } from '$lib/utils/run-storyline';
  import { tokens } from '$lib/tokens';
  import type { MeasurementSample } from '$lib/types';
  import OrbitalScene, { type OrbitalStation } from './OrbitalScene.svelte';

  // ── Store reads ────────────────────────────────────────────────────────────
  const endpoints = $derived($endpointStore);
  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const settings = $derived($settingsStore);
  const stats = $derived($statisticsStore);
  const context = $derived($uiStore.sharedReportContext);

  // The diagnostic report bundles primary answer + endpoint rows + threshold +
  // sample counts. Used for the verdict band and per-station summary.
  const report = $derived(buildDiagnosticReport({
    endpoints,
    stats,
    measurements,
    settings,
    context,
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
  const epToStation = $derived<Record<string, string>>(
    Object.fromEntries(monitored.slice(0, 4).map((ep, i) => [ep.id, STATION_IDS[i]])),
  );

  const WINDOW = tokens.lane.chartWindow;
  const stationData = $derived.by<Record<string, readonly (number | null)[]>>(() => {
    const out: Record<string, (number | null)[]> = {};
    for (const ep of monitored.slice(0, 4)) {
      const id = epToStation[ep.id];
      const m = measurements.endpoints[ep.id];
      if (!m) {
        out[id] = new Array(WINDOW).fill(null);
        continue;
      }
      const all = m.samples.toArray();
      const tail = all.slice(-WINDOW);
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

  // ── Session identity / coords ─────────────────────────────────────────────
  const sessionStart = $derived(measurements.startedAt);
  const sessionEnd = $derived(measurements.stoppedAt ?? Date.now());
  const durationMs = $derived(sessionStart === null ? 0 : Math.max(0, sessionEnd - sessionStart));
  const durationLabel = $derived(formatDuration(durationMs));
  const durationLong = $derived(formatDurationLong(durationMs));

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
  const verdictHeadline = $derived(report.diagnosis.primaryAnswer.text);
  const verdictBody = $derived(report.diagnosis.supportingSummary);
  const observerBeats = $derived(runStoryline.beats.slice(-3));

  // ── Vantage + cadence (record column) ─────────────────────────────────────
  const cadenceLabel = $derived(`${(settings.monitorDelay / 1000).toFixed(0)} s · synchronized`);
  const roundsLabel = $derived(`${measurements.roundCounter} / ${settings.cap} cap`);
  const triggerLabel = $derived(`${settings.healthThreshold} ms`);
  const carrierLosses = $derived(measurements.errorCount + measurements.timeoutCount);

  const vantageLabel = $derived.by(() => {
    if (typeof navigator === 'undefined') return 'Browser · — · —';
    const ua = navigator.userAgent;
    const ch = ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari'
      : ua.includes('Firefox') ? 'Firefox' : 'Browser';
    const os = ua.includes('Mac') ? 'macOS' : ua.includes('Win') ? 'Windows'
      : ua.includes('Linux') ? 'Linux' : 'OS';
    return `${ch} · ${os}`;
  });

  // ── Scrub rail (purely visual progress indicator for the saved signature) ─
  // The orbital signature is a static plot of the full session; the scrub
  // rail communicates "you are looking at the whole recording, end-to-end".
  // Interactive replay is a Phase D enhancement (see DIRECTION-v4.md); for
  // now the handle parks at 100% (end of session).
  let scrubT = $state(1);
  const scrubRoundLabel = $derived(
    `${Math.round(scrubT * measurements.roundCounter)} / ${measurements.roundCounter}`,
  );
  function onRailClick(e: MouseEvent | TouchEvent): void {
    const rail = e.currentTarget as HTMLDivElement;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    scrubT = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  }
  const railMarks = Array.from({ length: 60 }, (_, i) => i);

  // ── Sharing / export hooks (preserved chronoscope behavior) ───────────────
  // PNG export: capture the OrbitalScene canvas via toDataURL. The scene's
  // canvas is a child of the .stage container; we query for it on click.
  // The button is no-op when no scene has mounted (e.g. zero endpoints).
  let stageEl: HTMLElement | null = null;
  let copiedLink = $state(false);
  let copyError = $state<'link' | null>(null);

  function saveImage(): void {
    if (!stageEl) return;
    const canvas = stageEl.querySelector<HTMLCanvasElement>('canvas');
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `chronoscope-signature-${flightCert.replace(/[^A-Za-z0-9-]/g, '-')}.png`;
      a.click();
    } catch {
      // toDataURL throws if the WebGL context was lost or tainted; the
      // OrbitalScene shaders are all local so taint shouldn't apply, but a
      // belt-and-braces catch keeps the report surface from crashing.
    }
  }

  function saveCsv(): void {
    // Header + one row per (round × monitored endpoint). Matches the v4
    // prototype's CSV layout — round, ISO timestamp, t-offset, endpoint id,
    // endpoint label, host, latency_ms, severity.
    const threshold = settings.healthThreshold;
    const startMs = sessionStart ?? Date.now();
    const sevName = (v: number, status: string): string => {
      if (status !== 'ok') return status;
      if (v >= 4000) return 'crit';
      if (v > threshold) return 'bad';
      if (v > threshold * 0.7) return 'warn';
      return 'stable';
    };
    let csv = 'round,timestamp_utc,t_offset_s,endpoint_id,endpoint_label,host,latency_ms,severity\n';
    for (const ep of monitored) {
      const host = (() => {
        try { return new URL(ep.url).host; } catch { return ep.url; }
      })();
      const samples = measurements.endpoints[ep.id]?.samples.toArray() ?? [];
      for (const s of samples) {
        const offsetS = ((s.timestamp - startMs) / 1000).toFixed(1);
        const iso = new Date(s.timestamp).toISOString();
        csv += `${s.round},${iso},${offsetS},${ep.id},"${ep.label.replace(/"/g, '""')}",${host},${s.latency.toFixed(2)},${sevName(s.latency, s.status)}\n`;
      }
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronoscope-session-${flightCert.replace(/[^A-Za-z0-9-]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  // ── Keyboard scrubbing (←/→ + Home/End) ───────────────────────────────────
  function onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const rounds = Math.max(measurements.roundCounter, 1);
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      scrubT = Math.max(0, scrubT - (e.shiftKey ? 10 : 1) / rounds);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      scrubT = Math.min(1, scrubT + (e.shiftKey ? 10 : 1) / rounds);
    } else if (e.key === 'Home') {
      e.preventDefault();
      scrubT = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      scrubT = 1;
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

<section class="report-surface" aria-label="Diagnostic report — completed session signature">
  <!-- HERO STAGE — orbital signature + HUD readouts + scrub rail -->
  <section class="stage" bind:this={stageEl}>
    <div class="stage-scene" aria-hidden={stations.length === 0 ? 'true' : null}>
      {#if stations.length > 0}
        <OrbitalScene
          {stations}
          {stationData}
          triggerMs={settings.healthThreshold}
          windowSeconds={WINDOW}
          windowRounds={WINDOW}
          assemble={true}
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
      <div class="kicker">Field recording &nbsp;·&nbsp; <span class="v">{flightCert}</span></div>
      <h1>{verdictHeadline}</h1>
      <p class="body">{verdictBody}</p>
      <div class="actions">
        <button type="button" class="ctl-btn ctl-btn--primary" onclick={copyLink}>
          {copyError === 'link' ? 'Copy failed' : copiedLink ? 'Link copied' : 'Copy link'}
        </button>
        <button type="button" class="ctl-btn" onclick={saveImage}>Save as image</button>
        <button type="button" class="ctl-btn" onclick={saveCsv}>Export CSV</button>
      </div>
    </div>

    <div class="hud-stats">
      <div class="label">Field p50</div>
      <div class="num">
        {#if fieldP50 === null}<span class="awaiting">—</span>{:else}{fieldP50}<span class="u">ms</span>{/if}
      </div>
      <div class="row">
        <span>p95<span class="v">{fieldP95 === null ? '—' : `${fieldP95} ms`}</span></span>
        <span>Trigger<span class="v">{triggerLabel}</span></span>
      </div>
    </div>

    <div
      class="scrub"
      role="slider"
      aria-label="Scrub through session"
      aria-valuemin="0"
      aria-valuemax={measurements.roundCounter}
      aria-valuenow={Math.round(scrubT * measurements.roundCounter)}
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
        <div class="station-card" data-ep={row.id}>
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

    <div class="record-row">
      <div>
        <h3>Session record</h3>
        <div class="row"><span class="k">Session ID</span><span class="v">{flightCert}</span></div>
        <div class="row"><span class="k">Started</span><span class="v">{utcTimeLabel(sessionStart)} · {utcDateLabel(sessionStart)}</span></div>
        <div class="row"><span class="k">Ended</span><span class="v">{utcTimeLabel(measurements.stoppedAt)}</span></div>
        <div class="row"><span class="k">Duration</span><span class="v">{durationLong}</span></div>
        <div class="row"><span class="k">Rounds</span><span class="v">{roundsLabel}</span></div>
        <div class="row"><span class="k">Cadence</span><span class="v">{cadenceLabel}</span></div>
        <div class="row"><span class="k">Vantage</span><span class="v">{vantageLabel}</span></div>
        <div class="row"><span class="k">Stations</span><span class="v">{monitored.length} ({endpoints.length} configured)</span></div>
        <div class="row"><span class="k">Trigger</span><span class="v">{triggerLabel}</span></div>
        <div class="row"><span class="k">Carrier losses</span><span class="v">{carrierLosses}</span></div>
        <div class="row"><span class="k">Recorded by</span><span class="v">Chronoscope · browser-resident</span></div>
      </div>

      <div>
        <h3>Observer's notes</h3>
        <p class="narrative"><strong>{verdictHeadline}</strong></p>
        <p class="narrative">{verdictBody}</p>
        {#if observerBeats.length > 0}
          {#each observerBeats as beat (beat.id)}
            <p class="narrative">{beat.label}<span class="evidence"> {beat.evidence}</span></p>
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <footer class="foot">
    <div>Cert<span class="v">{flightCert}</span></div>
    <div class="center">Browser-resident observatory · session ended · no telemetry leaves this device</div>
    <div class="right">Recording paused at <span class="v">{utcTimeLabel(measurements.stoppedAt)}</span></div>
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
  .stage {
    position: relative;
    height: calc(100vh - var(--topbar-height, 60px));
    min-height: 720px;
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
    max-width: min(720px, 50vw);
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
    margin: 0 0 28px;
    max-width: 42ch;
  }
  .hud-title .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    pointer-events: auto;
  }

  /* HUD stats — right side, bottom-anchored */
  .hud-stats {
    position: absolute;
    right: clamp(20px, 3vw, 48px);
    bottom: 88px;
    z-index: 4;
    text-align: right;
    pointer-events: none;
  }
  .hud-stats .label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 6px;
  }
  .hud-stats .num {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(48px, 6vw, 84px);
    letter-spacing: -0.04em;
    color: var(--fg);
    line-height: 0.85;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 30px color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .hud-stats .num .u {
    font-family: var(--mono);
    font-size: 0.32em;
    color: var(--fg-3);
    margin-left: 6px;
    letter-spacing: 0.05em;
    vertical-align: 0.8em;
    text-shadow: none;
  }
  .hud-stats .num .awaiting { color: var(--fg-3); }
  .hud-stats .row {
    margin-top: 14px;
    display: flex;
    gap: 24px;
    justify-content: flex-end;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-3);
  }
  .hud-stats .row .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
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
  .record-row .narrative .evidence {
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 12px;
    margin-left: 4px;
  }

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
    .stations-grid { grid-template-columns: repeat(2, 1fr); }
    .record-row { grid-template-columns: 1fr; gap: 40px; }
  }
  @media (max-width: 720px) {
    .hud-title {
      left: 16px;
      right: 16px;
      max-width: none;
    }
    .hud-stats {
      left: 16px;
      right: 16px;
      bottom: 100px;
      text-align: left;
    }
    .hud-stats .row { justify-content: flex-start; }
    .scrub { padding: 12px 12px 14px; gap: 12px; }
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
    .stage { min-height: 600px; }
    .hud-title h1 { font-size: clamp(28px, 9vw, 48px); }
    .hud-stats .num { font-size: clamp(32px, 11vw, 56px); }
    .hud-stats .num .u { font-size: 12px; }
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
    .hud-title .actions { display: none; }
    .hud-stats {
      position: static;
      text-align: left;
      margin-top: 16px;
      pointer-events: auto;
    }
    .hud-stats .num,
    .hud-stats .row .v {
      color: black;
      text-shadow: none;
    }
    .hud-stats .label,
    .hud-stats .row {
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
    .record-row .narrative .evidence { color: #444; }
    .foot {
      color: #444;
      border-color: #ccc;
    }
    .foot .v { color: black; }
  }
</style>
