<!-- src/lib/components/EndpointView.svelte -->
<!-- Vessel v4 Endpoint surface — single-station drill-down. Translates the
     markup of proposals/v4/proposal-endpoint-v4.html into Svelte, wired to
     existing chronoscope stores (measurements, statistics, monitored endpoints,
     run storyline). Mounted by Layout when activeView === 'diagnose', route
     name is 'endpoint', and focusedEndpointId !== null. -->
<script lang="ts">
  import { measurementStore } from '$lib/stores/measurements';
  import { statisticsStore } from '$lib/stores/statistics';
  import { settingsStore } from '$lib/stores/settings';
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { uiStore } from '$lib/stores/ui';
  import { tokens } from '$lib/tokens';
  import { navigateTo } from '$lib/router';
  import { buildRunStoryline, type StoryBeatSeverity } from '$lib/utils/run-storyline';
  import type { MeasurementSample } from '$lib/types';
  import OrbitalScene, { type OrbitalStation } from './OrbitalScene.svelte';
  import EndpointErrorView from './EndpointErrorView.svelte';

  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const stats = $derived($statisticsStore);
  const settings = $derived($settingsStore);
  const threshold = $derived(settings.healthThreshold);
  const focusedId = $derived($uiStore.focusedEndpointId);

  // ── Station mapping (A/B/C/D, first 4 monitored endpoints) ─────────────────
  const STATION_IDS = ['A', 'B', 'C', 'D'] as const;
  const STATION_COLORS = [
    tokens.color.station.A,
    tokens.color.station.B,
    tokens.color.station.C,
    tokens.color.station.D,
  ] as const;
  const STATION_VARS = ['--station-a', '--station-b', '--station-c', '--station-d'] as const;
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
  const stationLabelsForScene = $derived<Record<string, string>>(
    Object.fromEntries(monitored.slice(0, 4).map((ep, i) => [STATION_IDS[i], ep.label])),
  );

  // ── Sample windowing for OrbitalScene ──────────────────────────────────────
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

  const focusedStation = $derived<string | null>(
    focusedId === null ? null : (epToStation[focusedId] ?? null),
  );
  const focusedIndex = $derived<number>(
    focusedStation === null ? -1 : STATION_IDS.indexOf(focusedStation as typeof STATION_IDS[number]),
  );
  const focusedColorVar = $derived<string>(
    focusedIndex < 0 ? `var(${STATION_VARS[2]})` : `var(${STATION_VARS[focusedIndex]})`,
  );
  const focusedGlowExpr = $derived<string>(
    `color-mix(in srgb, ${focusedColorVar} 18%, transparent)`,
  );

  // ── Focused endpoint metadata ──────────────────────────────────────────────
  const focusedEndpoint = $derived(
    focusedId === null ? null : monitored.find((ep) => ep.id === focusedId) ?? null,
  );
  const focusedHost = $derived<string>((() => {
    if (!focusedEndpoint) return '';
    try {
      return new URL(focusedEndpoint.url).host;
    } catch {
      return focusedEndpoint.url;
    }
  })());
  const focusedStats = $derived(focusedEndpoint ? stats[focusedEndpoint.id] : undefined);
  const focusedMeas = $derived(focusedEndpoint ? measurements.endpoints[focusedEndpoint.id] : undefined);

  // ── Carrier-lost detection ─────────────────────────────────────────────────
  // Heuristic: 5+ non-ok samples in the last 10 AND the most recent sample is
  // also non-ok. The "5+ of last 10" threshold matches the sustained-outage
  // band described in proposal-error-v4.html ("five or more consecutive missed
  // pulses"); requiring lastStatus to be non-ok prevents flicker right after
  // an outage recovers. The error surface is suppressed until at least 5
  // samples exist for the focused endpoint, so transient cold-start state
  // doesn't trip it.
  const carrierLost = $derived<boolean>((() => {
    if (!focusedMeas) return false;
    if (focusedMeas.lastStatus === null || focusedMeas.lastStatus === 'ok') return false;
    const tail = focusedMeas.samples.toArray().slice(-10);
    if (tail.length < 5) return false;
    const missed = tail.filter((s) => s.status !== 'ok').length;
    return missed >= 5;
  })());

  // ── Hero readouts ──────────────────────────────────────────────────────────
  const heroP50 = $derived<number | null>(
    focusedStats?.ready ? Math.round(focusedStats.p50) : null,
  );
  const heroP95 = $derived<number | null>(
    focusedStats?.ready ? Math.round(focusedStats.p95) : null,
  );
  const heroDrift = $derived<number | null>((() => {
    if (!focusedStats?.ready) return null;
    return Math.round((focusedStats.p95 - focusedStats.p50) / 2);
  })());
  const heroLast = $derived<number | null>(focusedMeas?.lastLatency ?? null);

  // ── Verdict / kicker / status sigil ────────────────────────────────────────
  type Sigil = 'stable' | 'warn' | 'bad' | 'crit';
  const sigil = $derived<Sigil>((() => {
    if (!focusedStats?.ready) return 'stable';
    if (focusedStats.lossPercent >= 10) return 'crit';
    if (focusedStats.p95 > threshold) return 'bad';
    if (focusedStats.p95 > threshold * 0.7) return 'warn';
    return 'stable';
  })());
  const verdictTag = $derived<string>((() => {
    switch (sigil) {
      case 'crit': return 'Carrier lost';
      case 'bad':  return 'Doppler drift';
      case 'warn': return 'Carrier wobble';
      default:     return 'In tune';
    }
  })());

  // ── Field rank ─────────────────────────────────────────────────────────────
  interface RankCard {
    readonly endpointId: string;
    readonly stationId: string;
    readonly label: string;
    readonly p50: number | null;
    readonly fieldDelta: number | null;
    readonly rank: number;
    readonly rankAnnotation: string;
    readonly isFocused: boolean;
  }
  const fieldP50 = $derived<number | null>((() => {
    const vals: number[] = [];
    for (const ep of monitored.slice(0, 4)) {
      const v = stats[ep.id]?.p50;
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length === 0) return null;
    vals.sort((a, b) => a - b);
    return Math.round(vals[Math.floor(vals.length / 2)]);
  })());
  const rankCards = $derived<readonly RankCard[]>((() => {
    const rows = monitored.slice(0, 4).map((ep, i) => {
      const s = stats[ep.id];
      const p50 = s?.ready ? Math.round(s.p50) : null;
      return {
        endpointId: ep.id,
        stationId: STATION_IDS[i],
        label: ep.label,
        p50,
      };
    });
    // Rank by p50 ascending; nulls last
    const ranked = [...rows].sort((a, b) => {
      if (a.p50 === null && b.p50 === null) return 0;
      if (a.p50 === null) return 1;
      if (b.p50 === null) return -1;
      return a.p50 - b.p50;
    });
    const idToRank: Record<string, number> = {};
    ranked.forEach((r, idx) => { idToRank[r.endpointId] = idx + 1; });
    const totalRanked = ranked.length;
    return rows.map((r) => {
      const rank = idToRank[r.endpointId] ?? 0;
      let annotation = `#${rank}`;
      if (rank === 1) annotation = '#1 fastest';
      else if (rank === totalRanked && totalRanked > 1) annotation = `#${rank} slowest`;
      return {
        endpointId: r.endpointId,
        stationId: r.stationId,
        label: r.label,
        p50: r.p50,
        fieldDelta: (r.p50 !== null && fieldP50 !== null) ? r.p50 - fieldP50 : null,
        rank,
        rankAnnotation: annotation,
        isFocused: r.endpointId === focusedId,
      };
    });
  })());

  // ── Percentile ladder ──────────────────────────────────────────────────────
  interface LadderCell {
    readonly k: string;
    readonly v: number | null;
    readonly tone: '' | 'warn' | 'bad' | 'crit';
  }
  function tone(v: number | null): LadderCell['tone'] {
    if (v === null) return '';
    if (v >= threshold * 1.4) return 'crit';
    if (v > threshold) return 'bad';
    if (v > threshold * 0.7) return 'warn';
    return '';
  }
  const ladder = $derived<readonly LadderCell[]>((() => {
    const s = focusedStats;
    if (!s?.ready) {
      return [
        { k: 'p50', v: null, tone: '' as const },
        { k: 'p75', v: null, tone: '' as const },
        { k: 'p90', v: null, tone: '' as const },
        { k: 'p95', v: null, tone: '' as const },
        { k: 'p99', v: null, tone: '' as const },
      ];
    }
    const cells: LadderCell[] = [
      { k: 'p50', v: Math.round(s.p50), tone: tone(s.p50) },
      { k: 'p75', v: Math.round(s.p75), tone: tone(s.p75) },
      { k: 'p90', v: Math.round(s.p90), tone: tone(s.p90) },
      { k: 'p95', v: Math.round(s.p95), tone: tone(s.p95) },
      { k: 'p99', v: Math.round(s.p99), tone: tone(s.p99) },
    ];
    return cells;
  })());

  // ── Polar histogram ────────────────────────────────────────────────────────
  interface PolarPath {
    readonly d: string;
    readonly tone: 'base' | 'warn' | 'bad';
    readonly opacity: number;
  }
  interface PolarMarkerPos {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly lx: number;
    readonly ly: number;
    readonly v: number;
  }
  interface PolarLayout {
    readonly bars: readonly PolarPath[];
    readonly rings: readonly { readonly d: string; readonly strong: boolean }[];
    readonly ticks: readonly { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly lx: number; readonly ly: number; readonly label: number }[];
    readonly p50Marker: PolarMarkerPos | null;
    readonly p95Marker: PolarMarkerPos | null;
    readonly ceiling: number;
  }
  function buildPolar(samples: readonly number[]): PolarLayout {
    const ceiling = 200;
    const binSize = 10;
    const nBins = Math.ceil(ceiling / binSize);
    const bins = new Array(nBins).fill(0);
    for (const v of samples) {
      let i = Math.floor(v / binSize);
      if (i >= nBins) i = nBins - 1;
      if (i < 0) i = 0;
      bins[i]++;
    }
    const maxCount = Math.max(1, ...bins);
    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length * 0.95)];

    const angle = (v: number): number => Math.PI * (1 - Math.min(v, ceiling) / ceiling);
    const ri = 28;
    const ro = 88;

    const rings = [0.25, 0.5, 0.75, 1.0].map((f) => {
      const r = ri + (ro - ri) * f;
      return { d: `M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`, strong: f === 1 };
    });

    const ticks = [0, 50, 100, 150, 200].map((t) => {
      const ang = angle(t);
      return {
        x1: ri * Math.cos(ang),
        y1: -ri * Math.sin(ang),
        x2: (ri - 4) * Math.cos(ang),
        y2: -(ri - 4) * Math.sin(ang),
        lx: (ri - 10) * Math.cos(ang),
        ly: -(ri - 10) * Math.sin(ang) + 3,
        label: t,
      };
    });

    const bars: PolarPath[] = [];
    for (let i = 0; i < nBins; i++) {
      if (bins[i] === 0) continue;
      const v0 = i * binSize;
      const v1 = (i + 1) * binSize;
      if (v0 >= ceiling) continue;
      const ang0 = angle(v0);
      const ang1 = angle(v1);
      const h = (bins[i] / maxCount) * (ro - ri);
      const rTop = ri + h;
      const vCenter = (v0 + v1) / 2;
      let toneKind: PolarPath['tone'] = 'base';
      let opacity = 0.85;
      if (vCenter > threshold) { toneKind = 'bad'; opacity = 0.95; }
      else if (vCenter > threshold * 0.7) { toneKind = 'warn'; opacity = 0.9; }

      const x1i = ri * Math.cos(ang0);
      const y1i = -ri * Math.sin(ang0);
      const x2i = ri * Math.cos(ang1);
      const y2i = -ri * Math.sin(ang1);
      const x1o = rTop * Math.cos(ang0);
      const y1o = -rTop * Math.sin(ang0);
      const x2o = rTop * Math.cos(ang1);
      const y2o = -rTop * Math.sin(ang1);
      const sweep = ang0 > ang1 ? 1 : 0;
      const d = `M ${x1i.toFixed(2)} ${y1i.toFixed(2)} L ${x1o.toFixed(2)} ${y1o.toFixed(2)} A ${rTop} ${rTop} 0 0 ${sweep} ${x2o.toFixed(2)} ${y2o.toFixed(2)} L ${x2i.toFixed(2)} ${y2i.toFixed(2)} A ${ri} ${ri} 0 0 ${1 - sweep} ${x1i.toFixed(2)} ${y1i.toFixed(2)} Z`;
      bars.push({ d, tone: toneKind, opacity });
    }

    function markerPos(v: number): PolarMarkerPos {
      const ang = angle(v);
      return {
        x1: ri * Math.cos(ang),
        y1: -ri * Math.sin(ang),
        x2: (ro + 6) * Math.cos(ang),
        y2: -(ro + 6) * Math.sin(ang),
        lx: (ro + 14) * Math.cos(ang),
        ly: -(ro + 14) * Math.sin(ang) + 3,
        v: Math.round(v),
      };
    }

    return {
      bars,
      rings,
      ticks,
      p50Marker: sorted.length > 0 ? markerPos(p50) : null,
      p95Marker: sorted.length > 0 ? markerPos(p95) : null,
      ceiling,
    };
  }

  const focusedSamples = $derived<readonly number[]>((() => {
    if (!focusedMeas) return [];
    return focusedMeas.samples
      .toArray()
      .filter((s) => s.status === 'ok')
      .map((s) => s.latency);
  })());

  const polar = $derived(buildPolar(focusedSamples));

  // ── Carrier history timeline ───────────────────────────────────────────────
  interface HistoryDot {
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
    readonly tone: 'base' | 'warn' | 'bad';
    readonly opacity: number;
  }
  interface HistoryLayout {
    readonly path: string;
    readonly dots: readonly HistoryDot[];
    readonly triggerY: number;
    readonly refLines: readonly { readonly y: number; readonly v: number }[];
  }
  function buildHistory(samples: readonly number[]): HistoryLayout {
    const W = 1000;
    const H = 170;
    const padX = 14;
    const padY = 14;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;
    const maxV = 200;
    const triggerY = padY + innerH - (Math.min(threshold, maxV) / maxV) * innerH;
    const refLines = [25, 50, 75, 100].map((v) => ({
      y: padY + innerH - (v / maxV) * innerH,
      v,
    }));

    if (samples.length === 0) {
      return { path: '', dots: [], triggerY, refLines };
    }
    let path = '';
    samples.forEach((v, i) => {
      const x = padX + (i / Math.max(1, samples.length - 1)) * innerW;
      const y = padY + innerH - (Math.min(v, maxV) / maxV) * innerH;
      path += (i === 0 ? 'M ' : ' L ') + x.toFixed(2) + ' ' + y.toFixed(2);
    });

    const dots: HistoryDot[] = samples.map((v, i) => {
      const x = padX + (i / Math.max(1, samples.length - 1)) * innerW;
      const y = padY + innerH - (Math.min(v, maxV) / maxV) * innerH;
      let toneKind: HistoryDot['tone'] = 'base';
      if (v > threshold) toneKind = 'bad';
      else if (v > threshold * 0.7) toneKind = 'warn';
      const isSev = toneKind !== 'base';
      return {
        cx: x,
        cy: y,
        r: isSev ? 2.6 : 1.8,
        tone: toneKind,
        opacity: isSev ? 0.85 : 0.55,
      };
    });
    return { path, dots, triggerY, refLines };
  }

  const historySamples = $derived<readonly number[]>((() => {
    if (!focusedMeas) return [];
    return focusedMeas.samples
      .toArray()
      .filter((s) => s.status === 'ok')
      .map((s) => s.latency);
  })());

  const history = $derived(buildHistory(historySamples));

  // ── Station record (right column under analysis) ───────────────────────────
  interface StationRecord {
    readonly host: string;
    readonly method: string;
    readonly samples: string;
    readonly spikes: number;
    readonly carrierLoss: number;
    readonly worst: { readonly v: number; readonly round: number } | null;
    readonly stableSinceLabel: string;
  }
  const stationRecord = $derived<StationRecord>((() => {
    const samplesArr = focusedMeas?.samples.toArray() ?? [];
    let spikes = 0;
    let carrierLoss = 0;
    let worst: { v: number; round: number } | null = null;
    for (const s of samplesArr) {
      if (s.status !== 'ok') {
        carrierLoss++;
        continue;
      }
      if (s.latency > threshold * 0.5) spikes++;
      if (worst === null || s.latency > worst.v) {
        worst = { v: Math.round(s.latency), round: s.round };
      }
    }
    // "Stable since": walk samples in reverse to find the last over-threshold
    // sample. If found, stable-since is the elapsed time since that sample,
    // formatted as T+MM:SS. If never crossed (or no samples), show the
    // "— never this session —" placeholder used by the v4 prototype.
    let stableSinceLabel = '— never this session —';
    for (let i = samplesArr.length - 1; i >= 0; i--) {
      const s = samplesArr[i];
      if (s.status === 'ok' && s.latency > threshold) {
        stableSinceLabel = relTime(s.timestamp);
        break;
      }
    }
    return {
      host: focusedHost,
      method: settings.corsMode === 'cors' ? 'HEAD · CORS' : 'HEAD · no-cors',
      samples: `${focusedStats?.sampleCount ?? 0} / ${samplesArr.length}`,
      spikes,
      carrierLoss,
      worst,
      stableSinceLabel,
    };
  })());

  // ── Telemetry events (this station only) ───────────────────────────────────
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
  function severityToSigil(sev: StoryBeatSeverity): Sigil | '' {
    switch (sev) {
      case 'good':  return 'stable';
      case 'watch': return 'warn';
      case 'bad':   return 'bad';
      default:      return '';
    }
  }
  function relTime(at: number | null): string {
    if (at === null || !measurements.startedAt) return 'T+00:00';
    const total = Math.max(0, Math.floor((at - measurements.startedAt) / 1000));
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `T+${mm}:${ss}`;
  }
  const focusedTag = $derived<string>(focusedEndpoint?.label.toUpperCase() ?? 'STATION');
  const eventBeats = $derived(
    runStoryline.beats
      .filter((b) => focusedId !== null && b.endpointIds.includes(focusedId))
      .slice(-7),
  );

  // ── Coords (round/samples/window/trigger in breadcrumb) ────────────────────
  const elapsedMs = $derived<number>(
    measurements.startedAt ? Date.now() - measurements.startedAt : 0,
  );
  const windowLabel = $derived<string>((() => {
    const total = Math.floor(elapsedMs / 1000);
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  })());
  const totalSamples = $derived<number>(focusedMeas?.samples.length ?? 0);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function focusStation(epId: string): void {
    uiStore.setFocusedEndpoint(epId);
    navigateTo({ name: 'endpoint', endpointId: epId });
  }
  function backToLive(): void {
    navigateTo({ name: 'live', endpointId: null });
  }
  function openInvestigate(): void {
    navigateTo({ name: 'investigate', endpointId: null });
  }
  function runGlobalTransit(): void {
    navigateTo({ name: 'transit', endpointId: null });
  }
  function compareAgainstHistory(): void {
    // Placeholder — historic comparison view is a future surface.
  }
  function muteStation(): void {
    // Placeholder — mute-this-station UX is not yet implemented.
  }

  // ── Station tab data ───────────────────────────────────────────────────────
  interface TabRow {
    readonly endpointId: string;
    readonly stationId: string;
    readonly label: string;
    readonly latency: number | null;
    readonly active: boolean;
    readonly bad: boolean;
  }
  const tabs = $derived<readonly TabRow[]>(
    monitored.slice(0, 4).map((ep, i) => {
      const m = measurements.endpoints[ep.id];
      const last = m?.lastLatency ?? null;
      return {
        endpointId: ep.id,
        stationId: STATION_IDS[i],
        label: ep.label,
        latency: last,
        active: ep.id === focusedId,
        bad: last !== null && last > threshold,
      };
    }),
  );
</script>

{#if carrierLost}
  <EndpointErrorView />
{:else}
<section
  class="endpoint-surface"
  style:--focus={focusedColorVar}
  style:--focus-glow={focusedGlowExpr}
  aria-label="Focused station drill-down"
>
  <!-- HERO STAGE -->
  <div class="stage">
    <div class="stage-canvas">
      {#if stations.length > 0}
        <OrbitalScene
          {stations}
          {stationData}
          {focusedStation}
          triggerMs={threshold}
          windowSeconds={WINDOW}
          windowRounds={WINDOW}
          assemble={false}
          stationLabels={stationLabelsForScene}
        />
      {/if}
    </div>

    <div class="breadcrumb">
      <div class="crumb">
        <button type="button" class="crumb-link" onclick={backToLive}>← Live</button>
        <span class="sep">/</span>
        <span>Station</span>
        <span class="sep">/</span>
        <span class="current">{focusedEndpoint?.label ?? '—'}</span>
      </div>
      <div class="meta">
        <span>Round<span class="v">{measurements.roundCounter}</span></span>
        <span>Samples<span class="v">{totalSamples}</span></span>
        <span>Window<span class="v">{windowLabel}</span></span>
        <span>Trigger<span class="v">{threshold} ms</span></span>
      </div>
    </div>

    <div class="station-tabs">
      <div class="label">Switch station</div>
      {#each tabs as tab (tab.endpointId)}
        <button
          type="button"
          class="tab"
          class:active={tab.active}
          data-ep={tab.stationId}
          onclick={() => focusStation(tab.endpointId)}
          aria-pressed={tab.active}
        >
          <span class="mk"></span>
          <span class="nm">{tab.label}</span>
          <span class="v" class:bad={tab.bad}>
            {#if tab.latency === null}—{:else}{Math.round(tab.latency)} ms{/if}
          </span>
        </button>
      {/each}
    </div>

    <div class="hero-meta">
      <div class="kicker"><span class="pip"></span><span>Focused station · ground truth</span></div>
      <div class="station-name">{focusedEndpoint?.label ?? '—'}</div>
      <div class="station-host">{focusedHost || '—'}</div>
      <div class="verdict-tag" data-s={sigil}>
        <span class="pip"></span>
        <span>{verdictTag}</span>
      </div>
      <div class="verdict-text">
        {#if !focusedStats?.ready}
          <strong>Acquiring carrier.</strong> Samples are still arriving — verdict will sharpen as the window fills.
        {:else if sigil === 'stable'}
          <strong>This station is on transit.</strong> Pulses arrive on the beat. Drift band is tight at ±<em>{heroDrift ?? 0} ms</em>.
        {:else if sigil === 'warn'}
          <strong>This station is wobbling.</strong> p95 has elevated to <em>{heroP95} ms</em>; no carrier loss yet.
        {:else if sigil === 'bad'}
          <strong>This station is dragging the downbeat.</strong> p95 sits at <em>{heroP95} ms</em>, over the <em>{threshold} ms</em> trigger.
        {:else}
          <strong>Carrier lost.</strong> Packet loss has crossed 10%. This station is failing.
        {/if}
      </div>
      <div class="quick-stats">
        <div class="stat">
          <div class="k">p50</div>
          <div class="v">
            {#if heroP50 === null}—{:else}{heroP50}<span class="u">ms</span>{/if}
          </div>
        </div>
        <div class="stat">
          <div class="k">p95</div>
          <div class="v" class:bad={focusedStats?.ready && focusedStats.p95 > threshold}>
            {#if heroP95 === null}—{:else}{heroP95}<span class="u">ms</span>{/if}
          </div>
        </div>
        <div class="stat">
          <div class="k">Drift</div>
          <div class="v">
            {#if heroDrift === null}—{:else}±{heroDrift}<span class="u">ms</span>{/if}
          </div>
        </div>
      </div>
    </div>

    <div class="hero-left">
      <div class="label">Last pulse</div>
      <div class="field-num">
        {#if heroLast === null}—{:else}{Math.round(heroLast)}<span class="u">ms</span>{/if}
      </div>
      <div class="field-sub">
        Trigger<span class="v">{threshold} ms</span>
        {#if heroLast !== null && heroLast > threshold}
          · {Math.round(heroLast - threshold)} ms over baseline
        {/if}
      </div>
    </div>
  </div>

  <!-- BELOW HERO -->
  <div class="below">

    <!-- FIELD RANK -->
    <div class="rank-section">
      <div class="section-head">
        <span class="l">Where this station ranks</span>
        <span class="r">
          <span>vs. field<span class="v">p50</span></span>
          <span>Window<span class="v">{WINDOW} s</span></span>
        </span>
      </div>
      <div class="rank-row">
        {#each rankCards as card (card.endpointId)}
          <div class="rank-card" class:is-focused={card.isFocused} data-ep={card.stationId}>
            <div class="head">
              <span class="mk"></span>
              <span class="nm">{card.label}</span>
              <span class="rank-tag">
                {card.rankAnnotation}{card.isFocused ? ' · focused' : ''}
              </span>
            </div>
            <div class="val" class:bad={card.p50 !== null && card.p50 > threshold}>
              {#if card.p50 === null}—{:else}{card.p50}<span class="u">ms</span>{/if}
            </div>
            <div class="delta">
              vs field
              <span
                class="v"
                class:warn={card.fieldDelta !== null && card.fieldDelta > 0 && card.fieldDelta <= 10}
                class:bad={card.fieldDelta !== null && card.fieldDelta > 10}
              >
                {#if card.fieldDelta === null}—{:else}{card.fieldDelta >= 0 ? '+' : '−'}{Math.abs(card.fieldDelta)} ms{/if}
              </span>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- ANALYSIS GRID -->
    <div class="analysis">
      <div class="col polar-large">
        <h3><span class="l">Distribution</span><span class="r">0 – {polar.ceiling} ms</span></h3>
        <svg viewBox="-105 -110 210 125" preserveAspectRatio="xMidYMid meet" aria-label="Latency distribution polar histogram">
          {#each polar.rings as ring, i (i)}
            <path d={ring.d} fill="none" stroke="var(--fg)" stroke-opacity={ring.strong ? 0.14 : 0.06} stroke-width="0.6" />
          {/each}
          {#each polar.ticks as tick (tick.label)}
            <line x1={tick.x1.toFixed(2)} y1={tick.y1.toFixed(2)} x2={tick.x2.toFixed(2)} y2={tick.y2.toFixed(2)} stroke="var(--fg)" stroke-opacity="0.25" stroke-width="0.7" />
            <text x={tick.lx.toFixed(2)} y={tick.ly.toFixed(2)} class="polar-tick-text" text-anchor="middle">{tick.label}</text>
          {/each}
          {#each polar.bars as bar, i (i)}
            <path
              d={bar.d}
              fill={bar.tone === 'bad' ? 'var(--sev-bad)' : bar.tone === 'warn' ? 'var(--sev-warn)' : focusedColorVar}
              fill-opacity={bar.opacity}
            />
          {/each}
          {#if polar.p50Marker}
            <line
              x1={polar.p50Marker.x1.toFixed(2)}
              y1={polar.p50Marker.y1.toFixed(2)}
              x2={polar.p50Marker.x2.toFixed(2)}
              y2={polar.p50Marker.y2.toFixed(2)}
              stroke="var(--fg)"
              stroke-width="0.8"
              stroke-dasharray="1.5 2"
            />
            <text
              x={polar.p50Marker.lx.toFixed(2)}
              y={polar.p50Marker.ly.toFixed(2)}
              class="polar-marker-text"
              text-anchor="middle"
              fill="var(--fg)"
            >p50 {polar.p50Marker.v}</text>
          {/if}
          {#if polar.p95Marker}
            <line
              x1={polar.p95Marker.x1.toFixed(2)}
              y1={polar.p95Marker.y1.toFixed(2)}
              x2={polar.p95Marker.x2.toFixed(2)}
              y2={polar.p95Marker.y2.toFixed(2)}
              stroke="var(--sev-bad)"
              stroke-width="0.8"
              stroke-dasharray="1.5 2"
            />
            <text
              x={polar.p95Marker.lx.toFixed(2)}
              y={polar.p95Marker.ly.toFixed(2)}
              class="polar-marker-text"
              text-anchor="middle"
              fill="var(--sev-bad)"
            >p95 {polar.p95Marker.v}</text>
          {/if}
          <circle cx="0" cy="0" r="1.8" fill="var(--fg)" fill-opacity="0.7" />
        </svg>
        <div class="polar-axis">
          <span>0</span><span>50</span><span>100</span><span>150</span><span>200 ms</span>
        </div>

        <div class="ladder">
          {#each ladder as cell (cell.k)}
            <div class="cell">
              <div class="k">{cell.k}</div>
              <div
                class="v"
                class:warn={cell.tone === 'warn'}
                class:bad={cell.tone === 'bad'}
                class:crit={cell.tone === 'crit'}
              >
                {#if cell.v === null}—{:else}{cell.v}<span class="u">ms</span>{/if}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="col">
        <h3><span class="l">Resource timing</span><span class="r">phases</span></h3>
        <div class="opaque">
          <div class="ic">◌</div>
          <div class="copy">
            <strong>Carrier opaque</strong>
            {focusedEndpoint?.label ?? focusedHost ?? 'This station'} does not return <em>Timing-Allow-Origin</em>. We hear total
            {#if heroLast !== null}<em>{Math.round(heroLast)} ms</em>{:else}<em>—</em>{/if}
            but cannot tell whether the drift sits in DNS, the TLS handshake, or TTFB.
            <button type="button" class="link" onclick={openInvestigate}>Run the outside transit →</button>
          </div>
        </div>

        <h3 class="h3-spaced"><span class="l">Station record</span><span class="r">this session</span></h3>
        <div class="record">
          <span class="rk">Host</span><span class="rv">{stationRecord.host || '—'}</span>
          <span class="rk">Method</span><span class="rv">{stationRecord.method}</span>
          <span class="rk">Samples</span><span class="rv">{stationRecord.samples}</span>
          <span class="rk">Spikes &gt; {Math.round(threshold * 0.5)} ms</span>
          <span class="rv" class:bad={stationRecord.spikes > 0}>{stationRecord.spikes}</span>
          <span class="rk">Carrier loss</span>
          <span class="rv" class:bad={stationRecord.carrierLoss > 0}>{stationRecord.carrierLoss}</span>
          <span class="rk">Worst pulse</span>
          <span class="rv" class:crit={stationRecord.worst !== null && stationRecord.worst.v > threshold}>
            {#if stationRecord.worst === null}—{:else}{stationRecord.worst.v} ms · round {stationRecord.worst.round}{/if}
          </span>
          <span class="rk">Stable since</span>
          <span class="rv">{stationRecord.stableSinceLabel}</span>
        </div>
      </div>
    </div>

    <!-- HISTORY TIMELINE -->
    <div class="history-section">
      <div class="section-head">
        <span class="l">Carrier history · this station</span>
        <span class="r">
          <span>Window<span class="v">{windowLabel}</span></span>
          <span>Cadence<span class="v">{(settings.monitorDelay / 1000).toFixed(0)} s</span></span>
        </span>
      </div>
      <div class="history-chart">
        <svg viewBox="0 0 1000 170" preserveAspectRatio="none" aria-label="Carrier latency history">
          <line x1="14" y1={history.triggerY.toFixed(2)} x2="986" y2={history.triggerY.toFixed(2)} stroke="var(--sev-bad)" stroke-opacity="0.4" stroke-dasharray="3 4" stroke-width="0.8" />
          <text x="984" y={(history.triggerY - 4).toFixed(2)} class="history-trigger-text" text-anchor="end">TRIGGER {threshold} ms</text>
          {#each history.refLines as refLine (refLine.v)}
            <line x1="14" y1={refLine.y.toFixed(2)} x2="986" y2={refLine.y.toFixed(2)} stroke="var(--fg)" stroke-opacity="0.04" stroke-width="0.5" />
            <text x="18" y={(refLine.y - 2).toFixed(2)} class="history-ref-text">{refLine.v} ms</text>
          {/each}
          {#if history.path}
            <path d={history.path} stroke={focusedColorVar} stroke-width="3.5" stroke-opacity="0.18" fill="none" stroke-linejoin="round" stroke-linecap="round" />
            <path d={history.path} stroke={focusedColorVar} stroke-width="1.1" stroke-opacity="0.92" fill="none" stroke-linejoin="round" stroke-linecap="round" />
          {/if}
          {#each history.dots as dot, i (i)}
            <circle
              cx={dot.cx.toFixed(2)}
              cy={dot.cy.toFixed(2)}
              r={dot.r}
              fill={dot.tone === 'bad' ? 'var(--sev-bad)' : dot.tone === 'warn' ? 'var(--sev-warn)' : focusedColorVar}
              fill-opacity={dot.opacity}
            />
          {/each}
        </svg>
      </div>
      <div class="history-axis">
        <span>T+00:00</span>
        <span>{windowLabel} · NOW</span>
      </div>
    </div>

    <!-- EVENTS -->
    <div class="events-section">
      <div class="section-head">
        <span class="l">Telemetry log · this station only</span>
        <span class="r"><span>Entries<span class="v">{eventBeats.length}</span></span></span>
      </div>
      <div class="events">
        {#if eventBeats.length === 0}
          <div class="event">
            <span class="t">T+00:00</span>
            <span class="b">No station events yet. As samples arrive, drift and threshold-crossings will appear here.</span>
            <span class="tag">{focusedTag}</span>
          </div>
        {:else}
          {#each eventBeats as beat (beat.id)}
            <div class="event">
              <span class="t">{relTime(beat.t)}</span>
              <span class="b">{beat.label}</span>
              <span class="tag" data-s={severityToSigil(beat.severity)}>{focusedTag}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- ACTION -->
    <div class="action-card">
      <div class="kicker">Recommended next move</div>
      <h4>Run an outside transit check.</h4>
      <p>
        {#if sigil === 'stable'}
          This station is on transit. If you want to validate it from outside the browser, run a remote vantage check against the same URL.
        {:else}
          Latency widened on this station. If a remote vantage sees the same drift, the source is downstream; if not, it's local to this network.
        {/if}
      </p>
      <div class="row">
        <button type="button" class="primary" onclick={runGlobalTransit}>Run global transit →</button>
        <button type="button" class="ghost" onclick={compareAgainstHistory}>Compare against history</button>
        <button type="button" class="ghost" onclick={muteStation}>Mute this station</button>
      </div>
    </div>

  </div>
</section>
{/if}

<style>
  /* Component-scoped --focus / --focus-glow are inherited from the inline
     style on .endpoint-surface — set per focused station. */
  .endpoint-surface {
    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.55;
    display: block;
  }

  /* ── HERO STAGE ─────────────────────────────────────────────────────────── */
  .stage {
    position: relative;
    height: 100vh;
    min-height: 760px;
    background: var(--bg);
    overflow: hidden;
  }
  .stage-canvas {
    position: absolute;
    inset: 0;
  }

  /* ── BREADCRUMB ─────────────────────────────────────────────────────────── */
  .breadcrumb {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 4;
    padding: 12px clamp(20px, 3vw, 48px);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    background: color-mix(in srgb, var(--bg) 40%, transparent);
    border-bottom: 1px solid var(--rule);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .breadcrumb .crumb {
    display: inline-flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
    font-weight: 700;
  }
  .crumb-link {
    color: var(--fg-3);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    transition: color 120ms;
  }
  .crumb-link:hover { color: var(--fg); }
  .crumb-link:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .breadcrumb .crumb .sep { color: var(--fg-4); }
  .breadcrumb .crumb .current {
    color: var(--focus);
    text-shadow: 0 0 8px var(--focus-glow);
  }
  .breadcrumb .meta {
    display: inline-flex;
    gap: 22px;
    flex-wrap: wrap;
  }
  .breadcrumb .meta > span { white-space: nowrap; }
  .breadcrumb .meta .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }

  /* ── STATION TABS ───────────────────────────────────────────────────────── */
  .station-tabs {
    position: absolute;
    top: 70px;
    left: clamp(20px, 3vw, 48px);
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .station-tabs .label {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 8px;
  }
  .station-tabs .tab {
    display: grid;
    grid-template-columns: 8px 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--rule);
    width: 180px;
    transition: background 120ms, border-color 120ms;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
    position: relative;
  }
  .station-tabs .tab:hover {
    background: color-mix(in srgb, var(--bg-2) 70%, transparent);
    border-color: var(--rule-strong);
  }
  .station-tabs .tab.active {
    border-color: var(--focus);
    background: color-mix(in srgb, var(--bg-2) 70%, transparent);
  }
  .station-tabs .tab:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .station-tabs .tab .mk { width: 7px; height: 7px; }
  .station-tabs .tab[data-ep="A"] .mk { background: var(--station-a); box-shadow: 0 0 6px var(--station-a); }
  .station-tabs .tab[data-ep="B"] .mk { background: var(--station-b); box-shadow: 0 0 6px var(--station-b); }
  .station-tabs .tab[data-ep="C"] .mk { background: var(--station-c); box-shadow: 0 0 6px var(--station-c); }
  .station-tabs .tab[data-ep="D"] .mk { background: var(--station-d); box-shadow: 0 0 6px var(--station-d); }
  .station-tabs .tab .nm {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
  }
  .station-tabs .tab .v {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
  .station-tabs .tab.active .v { color: var(--focus); }
  .station-tabs .tab .v.bad { color: var(--sev-bad); }

  /* ── HERO META (right side) ─────────────────────────────────────────────── */
  .hero-meta {
    position: absolute;
    right: clamp(20px, 3vw, 48px);
    top: 50%;
    transform: translateY(-50%);
    z-index: 4;
    text-align: right;
    max-width: 480px;
    pointer-events: none;
  }
  .hero-meta .kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 24px;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-weight: 700;
  }
  .hero-meta .kicker .pip {
    width: 7px;
    height: 7px;
    background: var(--focus);
    box-shadow: 0 0 10px var(--focus);
  }
  .hero-meta .station-name {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(64px, 8vw, 128px);
    letter-spacing: -0.04em;
    line-height: 0.85;
    color: var(--fg);
    margin-bottom: 16px;
    text-shadow: 0 0 60px var(--focus-glow);
  }
  .hero-meta .station-host {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--fg-2);
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
    margin-bottom: 32px;
    font-weight: 400;
  }
  .hero-meta .verdict-tag {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--sev-bad);
    font-weight: 700;
    margin-bottom: 18px;
  }
  .hero-meta .verdict-tag .pip {
    width: 7px;
    height: 7px;
    background: var(--sev-bad);
    box-shadow: 0 0 8px var(--sev-bad);
  }
  .hero-meta .verdict-tag[data-s="stable"] { color: var(--station-b); }
  .hero-meta .verdict-tag[data-s="stable"] .pip {
    background: var(--station-b);
    box-shadow: 0 0 8px var(--station-b);
  }
  .hero-meta .verdict-tag[data-s="warn"] { color: var(--sev-warn); }
  .hero-meta .verdict-tag[data-s="warn"] .pip {
    background: var(--sev-warn);
    box-shadow: 0 0 8px var(--sev-warn);
  }
  .hero-meta .verdict-tag[data-s="crit"] { color: var(--sev-crit); }
  .hero-meta .verdict-tag[data-s="crit"] .pip {
    background: var(--sev-crit);
    box-shadow: 0 0 8px var(--sev-crit);
  }
  .hero-meta .verdict-text {
    font-family: var(--sans);
    font-weight: 300;
    font-size: clamp(22px, 2.4vw, 30px);
    letter-spacing: -0.015em;
    line-height: 1.25;
    color: var(--fg);
    max-width: 36ch;
    margin-left: auto;
    margin-bottom: 24px;
  }
  .hero-meta .verdict-text em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .hero-meta .quick-stats {
    display: grid;
    grid-template-columns: auto auto auto;
    gap: 18px 26px;
    justify-content: end;
    margin-bottom: 32px;
  }
  .hero-meta .quick-stats .stat { text-align: right; }
  .hero-meta .quick-stats .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 6px;
    font-weight: 700;
  }
  .hero-meta .quick-stats .v {
    font-family: var(--sans);
    font-weight: 200;
    font-size: 38px;
    color: var(--fg);
    letter-spacing: -0.025em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .hero-meta .quick-stats .v.bad { color: var(--sev-bad); }
  .hero-meta .quick-stats .v .u {
    font-family: var(--mono);
    font-size: 0.32em;
    color: var(--fg-3);
    margin-left: 3px;
    letter-spacing: 0.04em;
    vertical-align: 0.78em;
    display: inline-block;
  }

  /* ── HERO LEFT (last pulse) ─────────────────────────────────────────────── */
  .hero-left {
    position: absolute;
    left: clamp(20px, 3vw, 48px);
    bottom: 56px;
    z-index: 4;
    pointer-events: none;
  }
  .hero-left .label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 8px;
    font-weight: 700;
  }
  .hero-left .field-num {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(64px, 9vw, 140px);
    color: var(--focus);
    letter-spacing: -0.04em;
    line-height: 0.85;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 80px var(--focus-glow);
  }
  .hero-left .field-num .u {
    font-family: var(--mono);
    font-size: 0.22em;
    color: var(--fg-3);
    margin-left: 6px;
    letter-spacing: 0.04em;
    vertical-align: 0.78em;
    display: inline-block;
    text-shadow: none;
  }
  .hero-left .field-sub {
    margin-top: 14px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .hero-left .field-sub .v {
    color: var(--fg);
    font-variant-numeric: tabular-nums;
    margin-left: 6px;
  }

  /* ── BELOW HERO ─────────────────────────────────────────────────────────── */
  .below {
    padding: 80px clamp(20px, 3vw, 48px) 96px;
    border-top: 1px solid var(--rule);
    background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 94%, transparent) 0%, var(--bg) 24%);
    position: relative;
  }

  .rank-section { margin-bottom: 64px; }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 18px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .section-head .l { color: var(--fg); }
  .section-head .r {
    color: var(--fg-3);
    display: inline-flex;
    gap: 20px;
  }
  .section-head .r .v { color: var(--fg); margin-left: 6px; }

  .rank-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .rank-card {
    background: var(--bg);
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: relative;
  }
  .rank-card.is-focused { background: var(--bg-2); }
  .rank-card.is-focused::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--focus);
    box-shadow: 0 0 12px var(--focus);
  }
  .rank-card .head { display: flex; align-items: center; gap: 10px; }
  .rank-card .mk { width: 8px; height: 8px; }
  .rank-card[data-ep="A"] .mk { background: var(--station-a); box-shadow: 0 0 8px var(--station-a); }
  .rank-card[data-ep="B"] .mk { background: var(--station-b); box-shadow: 0 0 8px var(--station-b); }
  .rank-card[data-ep="C"] .mk { background: var(--station-c); box-shadow: 0 0 8px var(--station-c); }
  .rank-card[data-ep="D"] .mk { background: var(--station-d); box-shadow: 0 0 8px var(--station-d); }
  .rank-card .nm {
    font-family: var(--sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
  }
  .rank-card .rank-tag {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .rank-card.is-focused .rank-tag { color: var(--focus); }
  .rank-card .val {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 30px;
    font-weight: 300;
    color: var(--fg);
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .rank-card .val.bad { color: var(--sev-bad); }
  .rank-card .val .u { font-size: 11px; color: var(--fg-3); margin-left: 2px; }
  .rank-card .delta {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .rank-card .delta .v {
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    margin-left: 6px;
  }
  .rank-card .delta .v.warn { color: var(--sev-warn); }
  .rank-card .delta .v.bad { color: var(--sev-bad); }

  /* ── ANALYSIS ───────────────────────────────────────────────────────────── */
  .analysis {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 48px;
    margin-bottom: 64px;
  }
  .analysis .col h3 {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .analysis .col h3.h3-spaced { margin-top: 36px; }
  .analysis .col h3 .l { color: var(--fg); }
  .analysis .col h3 .r { color: var(--fg-3); }

  .polar-large svg {
    width: 100%;
    aspect-ratio: 2 / 1;
    display: block;
    overflow: visible;
  }
  .polar-tick-text {
    font-family: var(--mono);
    font-size: 6px;
    fill: var(--fg-3);
  }
  .polar-marker-text {
    font-family: var(--mono);
    font-size: 7px;
    font-weight: 700;
  }
  .polar-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-family: var(--mono);
    font-size: 9px;
    color: var(--fg-4);
    letter-spacing: 0.12em;
  }

  .ladder {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    margin-bottom: 18px;
    margin-top: 16px;
  }
  .ladder .cell {
    padding: 14px 16px;
    border-right: 1px solid var(--rule);
  }
  .ladder .cell:last-child { border-right: 0; }
  .ladder .cell .k {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 8px;
    font-weight: 700;
  }
  .ladder .cell .v {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 22px;
    font-weight: 400;
    color: var(--fg);
    letter-spacing: -0.01em;
    line-height: 1;
  }
  .ladder .cell .v .u { font-size: 10px; color: var(--fg-3); margin-left: 2px; }
  .ladder .cell .v.warn { color: var(--sev-warn); }
  .ladder .cell .v.bad  { color: var(--sev-bad); }
  .ladder .cell .v.crit { color: var(--sev-crit); }

  /* ── OPAQUE + STATION RECORD ────────────────────────────────────────────── */
  .opaque {
    display: flex;
    gap: 14px;
    align-items: center;
    min-height: 130px;
    padding: 18px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
  }
  .opaque .ic {
    flex: 0 0 42px;
    height: 42px;
    border: 1px solid var(--rule-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 18px;
  }
  .opaque .copy {
    font-size: 13px;
    line-height: 1.55;
    color: var(--fg-2);
    max-width: 42ch;
  }
  .opaque .copy strong {
    display: block;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg);
    font-weight: 700;
    margin-bottom: 5px;
  }
  .opaque .copy em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .opaque .copy .link {
    color: var(--focus);
    border: 0;
    border-bottom: 1px solid var(--focus);
    padding: 0 0 1px;
    background: none;
    font: inherit;
    cursor: pointer;
  }
  .opaque .copy .link:hover {
    color: var(--fg);
    border-bottom-color: var(--fg);
  }
  .opaque .copy .link:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  .record {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 22px;
    font-family: var(--mono);
    font-size: 12px;
  }
  .record .rk {
    color: var(--fg-3);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 10px;
    font-weight: 700;
  }
  .record .rv {
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .record .rv.bad { color: var(--sev-bad); }
  .record .rv.crit { color: var(--sev-crit); }

  /* ── HISTORY ────────────────────────────────────────────────────────────── */
  .history-section { margin-bottom: 64px; }
  .history-chart {
    position: relative;
    height: 200px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    padding: 14px;
  }
  .history-chart svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  .history-trigger-text {
    font-family: var(--mono);
    font-size: 9px;
    fill: var(--sev-bad);
    letter-spacing: 0.05em;
  }
  .history-ref-text {
    font-family: var(--mono);
    font-size: 8px;
    fill: var(--fg-3);
    letter-spacing: 0.05em;
  }
  .history-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.12em;
    font-weight: 700;
  }
  .history-axis > span { white-space: nowrap; }

  /* ── EVENTS ─────────────────────────────────────────────────────────────── */
  .events-section .events { border-top: 1px solid var(--rule); }
  .events-section .event {
    display: grid;
    grid-template-columns: 90px 1fr auto;
    gap: 18px;
    padding: 12px 0;
    align-items: baseline;
    border-bottom: 1px solid var(--rule-faint);
    font-size: 13px;
  }
  .events-section .event .t {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    white-space: nowrap;
    font-weight: 700;
  }
  .events-section .event .b { color: var(--fg-2); line-height: 1.45; }
  .events-section .event .tag {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    white-space: nowrap;
  }
  .events-section .event .tag[data-s="stable"] { color: var(--station-b); }
  .events-section .event .tag[data-s="warn"]   { color: var(--sev-warn); }
  .events-section .event .tag[data-s="bad"]    { color: var(--sev-bad); }
  .events-section .event .tag[data-s="crit"]   { color: var(--sev-crit); }

  /* ── ACTION ─────────────────────────────────────────────────────────────── */
  .action-card {
    padding: 32px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    position: relative;
    margin-top: 48px;
  }
  .action-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 24px;
    height: 1px;
    background: var(--focus);
    box-shadow: 0 0 10px var(--focus);
  }
  .action-card .kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 18px;
    font-weight: 700;
  }
  .action-card h4 {
    font-family: var(--sans);
    font-size: 28px;
    font-weight: 300;
    color: var(--fg);
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin-bottom: 14px;
    max-width: 32ch;
  }
  .action-card p {
    font-size: 14px;
    color: var(--fg-2);
    line-height: 1.55;
    margin-bottom: 22px;
    max-width: 50ch;
  }
  .action-card .row {
    display: flex;
    gap: 12px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .action-card .row .primary {
    border: 1px solid var(--fg);
    background: var(--fg);
    color: var(--bg);
    padding: 11px 18px;
    font-weight: 700;
    transition: background 120ms, border-color 120ms;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .action-card .row .primary:hover {
    background: var(--focus);
    border-color: var(--focus);
  }
  .action-card .row .ghost {
    border: 1px solid var(--rule-strong);
    color: var(--fg-2);
    padding: 11px 18px;
    font-weight: 700;
    transition: color 120ms, border-color 120ms;
    cursor: pointer;
    background: none;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .action-card .row .ghost:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }
  .action-card .row .primary:focus-visible,
  .action-card .row .ghost:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  /* ── RESPONSIVE ─────────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .hero-meta {
      position: static;
      transform: none;
      padding: 140px clamp(20px, 3vw, 48px) 24px;
      max-width: none;
      text-align: left;
    }
    .hero-meta .quick-stats { justify-content: start; }
    .hero-meta .quick-stats .stat,
    .hero-meta .verdict-text { text-align: left; margin-left: 0; }
    .station-tabs {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      padding: 140px clamp(20px, 3vw, 48px) 12px;
      gap: 8px;
    }
    .station-tabs .label { display: none; }
    .station-tabs .tab { width: auto; }
    .hero-left { position: static; padding: 24px clamp(20px, 3vw, 48px) 80px; }
    .analysis { grid-template-columns: 1fr; gap: 36px; }
    .rank-row { grid-template-columns: repeat(2, 1fr); }
    .stage { height: auto; min-height: 0; }
    .stage-canvas { position: relative; height: 60vh; min-height: 480px; }
  }
  @media (max-width: 720px) {
    .breadcrumb { font-size: 9px; }
    .ladder .cell { padding: 10px 8px; }
    .ladder .cell .v { font-size: 16px; }
    .rank-row { grid-template-columns: 1fr; }
  }
  @media (max-width: 480px) {
    .breadcrumb { padding: 10px 14px; font-size: 9px; letter-spacing: 0.14em; gap: 8px; }
    .breadcrumb .meta { gap: 12px; }
    .below { padding: 48px 14px 56px; }
    .ladder .cell { padding: 8px 6px; }
    .ladder .cell .v { font-size: 14px; }
    .ladder .cell .k { font-size: 9px; letter-spacing: 0.16em; }
    .station-tabs { padding: 130px 14px 8px; gap: 6px; }
    .station-tabs .tab { width: auto; min-width: 0; padding: 6px 10px; flex: 1; }
    .station-tabs .tab .nm { font-size: 11px; }
    .station-tabs .tab .v { font-size: 9px; }
  }
</style>
