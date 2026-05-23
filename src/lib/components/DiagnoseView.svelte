<!-- src/lib/components/DiagnoseView.svelte -->
<!-- Vessel v4 Investigate surface — per-station signal analysis. Translates
     proposals/v4/proposal-investigate-v4.html into Svelte against existing
     chronoscope stores. Two surfaces share this file: when
     uiStore.focusedEndpointId is set, EndpointView renders the focused
     deep-dive; otherwise the v4 Investigate markup renders (Part I — what the
     carrier records — per-station rows with percentile ladder + polar
     distribution + Resource Timing phase decomposition; Part II — outside
     vantage + companion agent + epistemics). -->
<script lang="ts">
  import { measurementStore } from '$lib/stores/measurements';
  import { statisticsStore } from '$lib/stores/statistics';
  import { settingsStore } from '$lib/stores/settings';
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { uiStore } from '$lib/stores/ui';
  import { navigateTo } from '$lib/router';
  import { fmt } from '$lib/utils/format';
  import { tokens } from '$lib/tokens';
  import type { Endpoint, MeasurementSample } from '$lib/types';
  import EndpointView from './EndpointView.svelte';

  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const stats = $derived($statisticsStore);
  const threshold = $derived($settingsStore.healthThreshold);
  const focusedId = $derived($uiStore.focusedEndpointId);

  // ── Endpoint → station mapping (A/B/C/D) ────────────────────────────────
  const STATION_IDS = ['A', 'B', 'C', 'D'] as const;
  type StationId = typeof STATION_IDS[number];

  // ── Severity classification ─────────────────────────────────────────────
  // Mirrors LiveView's status vocabulary: stable / warn / bad / crit.
  type Severity = 'stable' | 'warn' | 'bad' | 'crit';
  function severityForLast(last: number | null, baselineP95: number | null): Severity {
    if (last === null) return 'stable';
    if (last > threshold * 1.5) return 'crit';
    if (last > threshold) return 'bad';
    if (baselineP95 !== null && baselineP95 > threshold * 0.7) return 'warn';
    return 'stable';
  }
  function severityCell(v: number): Severity | '' {
    if (v >= threshold) return 'crit';
    if (v > threshold * 0.75) return 'bad';
    if (v > threshold * 0.5) return 'warn';
    return '';
  }
  function statusText(sev: Severity): string {
    switch (sev) {
      case 'crit': return 'Carrier lost';
      case 'bad': return 'Doppler drift';
      case 'warn': return 'Carrier wobble';
      case 'stable': return 'Carrier acquired';
    }
  }

  // ── Host extractor ──────────────────────────────────────────────────────
  function hostnameOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  // ── Polar distribution geometry ─────────────────────────────────────────
  // Half-circle (top arc) from left to right. Bins of samples; bar radius =
  // count. Returns the SVG inner HTML as a string. Mirrors the prototype's
  // polarDistribution() function so the geometry is identical.
  const RI = 28; // inner radius
  const RO = 88; // outer radius

  interface PolarWedge {
    readonly d: string;
    readonly glowD: string;
    readonly fill: string;
    readonly opacity: number;
  }
  interface PolarTick {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly lx: number;
    readonly ly: number;
    readonly label: string;
  }
  interface PolarArc {
    readonly d: string;
    readonly stroke: string;
  }
  interface PolarMarker {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly lx: number;
    readonly ly: number;
    readonly stroke: string;
    readonly label: string;
  }
  interface PolarPlot {
    readonly arcs: readonly PolarArc[];
    readonly ticks: readonly PolarTick[];
    readonly wedges: readonly PolarWedge[];
    readonly markers: readonly PolarMarker[];
    readonly ceiling: number;
    readonly axisLabels: readonly string[];
    readonly distLabel: string;
  }

  function buildPolar(samples: readonly number[], color: string): PolarPlot | null {
    if (samples.length === 0) return null;

    const sorted = [...samples].sort((a, b) => a - b);
    const pickQ = (q: number): number => {
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
      return sorted[idx] ?? 0;
    };
    const p50 = pickQ(0.5);
    const p95 = pickQ(0.95);
    const p99 = pickQ(0.99);

    // Ceiling computed from p99 (rounded up to nearest 100, floored at 100).
    // This drives axis labels + bin sizing. Replaces the prior hard-coded
    // "bimodal tail" copy with data-driven range.
    const ceiling = Math.max(100, Math.ceil(p99 / 100) * 100);
    const binSize = ceiling > 150 ? 10 : 5;
    const nBins = Math.ceil(ceiling / binSize);
    const bins = new Array<number>(nBins).fill(0);
    for (const v of samples) {
      let i = Math.floor(v / binSize);
      if (i >= nBins) i = nBins - 1;
      if (i < 0) i = 0;
      bins[i]++;
    }
    const maxCount = Math.max(...bins, 1);

    const angleFor = (v: number): number => Math.PI * (1 - Math.min(v, ceiling) / ceiling);

    // Concentric guide arcs (rendered separately by template).
    const arcs: PolarArc[] = [0.25, 0.5, 0.75, 1.0].map((f) => {
      const r = RI + (RO - RI) * f;
      // SVG stroke can resolve var(--…) at paint time; tokens drive the
      // values so no raw alphas leak into the script.
      const stroke = f === 1 ? 'var(--rule-strong)' : 'var(--rule)';
      return {
        d: `M ${(-r).toFixed(2)} 0 A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${r.toFixed(2)} 0`,
        stroke,
      };
    });

    // Tick marks + numerals — 5 evenly-spaced values from 0 to ceiling.
    const tickStep = ceiling / 4;
    const tickValues = [0, tickStep, tickStep * 2, tickStep * 3, ceiling].map((t) => Math.round(t));
    const ticks: PolarTick[] = tickValues.map((t) => {
      const ang = angleFor(t);
      return {
        x1: RI * Math.cos(ang),
        y1: -RI * Math.sin(ang),
        x2: (RI - 4) * Math.cos(ang),
        y2: -(RI - 4) * Math.sin(ang),
        lx: (RI - 10) * Math.cos(ang),
        ly: -(RI - 10) * Math.sin(ang) + 3,
        label: String(t),
      };
    });

    // Bin wedges.
    const wedges: PolarWedge[] = [];
    for (let i = 0; i < nBins; i++) {
      if (bins[i] === 0) continue;
      const v0 = i * binSize;
      const v1 = (i + 1) * binSize;
      if (v0 >= ceiling) continue;
      const ang0 = angleFor(v0);
      const ang1 = angleFor(v1);
      const h = (bins[i] / maxCount) * (RO - RI);
      const rTop = RI + h;
      const vCenter = (v0 + v1) / 2;
      // Severity color override matches prototype.
      let fill = color;
      let opacity = 0.85;
      if (vCenter > threshold) {
        fill = 'var(--sev-bad)';
        opacity = 0.95;
      } else if (vCenter > threshold * 0.7) {
        fill = 'var(--sev-warn)';
        opacity = 0.9;
      }
      const sweep = ang0 > ang1 ? 1 : 0;
      const x1i = RI * Math.cos(ang0), y1i = -RI * Math.sin(ang0);
      const x2i = RI * Math.cos(ang1), y2i = -RI * Math.sin(ang1);
      const x1o = rTop * Math.cos(ang0), y1o = -rTop * Math.sin(ang0);
      const x2o = rTop * Math.cos(ang1), y2o = -rTop * Math.sin(ang1);
      const rGlow = rTop + 1;
      const x1og = rGlow * Math.cos(ang0), y1og = -rGlow * Math.sin(ang0);
      const x2og = rGlow * Math.cos(ang1), y2og = -rGlow * Math.sin(ang1);
      const d =
        `M ${x1i.toFixed(2)} ${y1i.toFixed(2)} ` +
        `L ${x1o.toFixed(2)} ${y1o.toFixed(2)} ` +
        `A ${rTop.toFixed(2)} ${rTop.toFixed(2)} 0 0 ${sweep} ${x2o.toFixed(2)} ${y2o.toFixed(2)} ` +
        `L ${x2i.toFixed(2)} ${y2i.toFixed(2)} ` +
        `A ${RI.toFixed(2)} ${RI.toFixed(2)} 0 0 ${1 - sweep} ${x1i.toFixed(2)} ${y1i.toFixed(2)} Z`;
      const glowD =
        `M ${x1i.toFixed(2)} ${y1i.toFixed(2)} ` +
        `L ${x1og.toFixed(2)} ${y1og.toFixed(2)} ` +
        `A ${rGlow.toFixed(2)} ${rGlow.toFixed(2)} 0 0 ${sweep} ${x2og.toFixed(2)} ${y2og.toFixed(2)} ` +
        `L ${x2i.toFixed(2)} ${y2i.toFixed(2)} ` +
        `A ${RI.toFixed(2)} ${RI.toFixed(2)} 0 0 ${1 - sweep} ${x1i.toFixed(2)} ${y1i.toFixed(2)} Z`;
      wedges.push({ d, glowD, fill, opacity });
    }

    // p50 / p95 markers — stack when their angular positions are close.
    const p50ang = angleFor(p50);
    const p95ang = angleFor(p95);
    const close = Math.abs(p50ang - p95ang) < 0.32;
    const markerFor = (v: number, stroke: string, label: string, labelR: number): PolarMarker => {
      const ang = angleFor(v);
      return {
        x1: RI * Math.cos(ang),
        y1: -RI * Math.sin(ang),
        x2: (RO + 6) * Math.cos(ang),
        y2: -(RO + 6) * Math.sin(ang),
        lx: labelR * Math.cos(ang),
        ly: -labelR * Math.sin(ang) + 3,
        stroke,
        label: `${label} ${Math.round(v)}`,
      };
    };
    const markers: PolarMarker[] = close
      ? [
          markerFor(p50, 'var(--fg)', 'p50', RO + 14),
          markerFor(p95, 'var(--sev-bad)', 'p95', RO + 26),
        ]
      : [
          markerFor(p50, 'var(--fg)', 'p50', RO + 14),
          markerFor(p95, 'var(--sev-bad)', 'p95', RO + 14),
        ];

    // Distribution label — data-driven range, no shape descriptor.
    const distLabel = `0 – ${ceiling} ms`;
    const axisLabels = tickValues.map((t, i) =>
      i === tickValues.length - 1 ? `${t} ms` : String(t),
    );

    return { arcs, ticks, wedges, markers, ceiling, axisLabels, distLabel };
  }

  // ── Phase breakdown from latest sample with .tier2 ──────────────────────
  // The v4 prototype renders one phase bar per station; we mirror that by
  // averaging .tier2 values across recent samples (the same logic used by
  // statisticsStore[ep.id].tier2Averages, but we lean on that field directly).
  interface PhaseValues {
    readonly dns: number;
    readonly tcp: number;
    readonly tls: number;
    readonly ttfb: number;
    readonly xfer: number;
  }

  // ── Per-station row data ────────────────────────────────────────────────
  interface StationRow {
    readonly endpointId: string;
    readonly stationId: StationId;
    readonly name: string;
    readonly host: string;
    readonly sampleCount: number;
    readonly status: Severity;
    readonly statusText: string;
    readonly p50: number | null;
    readonly p75: number | null;
    readonly p90: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
    readonly p50Sev: Severity | '';
    readonly p75Sev: Severity | '';
    readonly p90Sev: Severity | '';
    readonly p95Sev: Severity | '';
    readonly p99Sev: Severity | '';
    readonly polar: PolarPlot | null;
    readonly phases: PhaseValues | null;
    readonly phaseTotal: number;
    readonly visibility: 'full' | 'partial' | 'hidden';
    readonly visibilityText: string;
    readonly sampleMeta: string;
    readonly carrierLoss: number;
    readonly lastFailure: string;
  }

  function buildStationRow(ep: Endpoint, idx: number): StationRow {
    const stationId = STATION_IDS[idx] ?? 'A';
    const host = hostnameOf(ep.url);
    const m = measurements.endpoints[ep.id];
    const s = stats[ep.id];

    const samplesArr: readonly MeasurementSample[] = m ? m.samples.toArray() : [];
    const okSamples = samplesArr.filter((x) => x.status === 'ok');
    const okLatencies = okSamples.map((x) => x.latency);
    const sampleCount = samplesArr.length;

    // Severity classification for the row badge.
    const last = m?.lastLatency ?? null;
    const sev = severityForLast(last, s?.p95 ?? null);

    // Percentiles direct from statisticsStore (preferred — uses canonical
    // method). Fall back to null when stats aren't ready.
    const ready = s?.ready ?? false;
    const p50 = ready ? s.p50 : null;
    const p75 = ready ? s.p75 : null;
    const p90 = ready ? s.p90 : null;
    const p95 = ready ? s.p95 : null;
    const p99 = ready ? s.p99 : null;

    // Polar distribution — driven by raw ok-sample latencies.
    const polar = okLatencies.length >= 4 ? buildPolar(okLatencies, `var(--station-${stationId.toLowerCase()})`) : null;

    // Phase decomposition. The prototype shows either the resource-timing
    // phase bar (when .tier2 data is available on recent samples) or the
    // "Carrier opaque" caveat. We aggregate .tier2 from the recent ok
    // samples that exposed phase data, then collapse to a single PhaseValues.
    let phases: PhaseValues | null = null;
    if (s?.tier2Averages) {
      phases = {
        dns: s.tier2Averages.dnsLookup,
        tcp: s.tier2Averages.tcpConnect,
        tls: s.tier2Averages.tlsHandshake,
        ttfb: s.tier2Averages.ttfb,
        xfer: s.tier2Averages.contentTransfer,
      };
    }
    const phaseTotal = phases ? phases.dns + phases.tcp + phases.tls + phases.ttfb + phases.xfer : 0;

    // Visibility — full when we have non-zero phase data on recent samples;
    // hidden when every recent ok sample is total-only (no .tier2 or
    // timingFallback === true).
    let visibility: StationRow['visibility'] = 'hidden';
    let visibilityText = 'Phase visibility · opaque';
    if (phases && phaseTotal > 0) {
      const anyTier2 = okSamples.slice(-20).some((x) => x.tier2 && !x.timingFallback);
      const allTier2 = okSamples.slice(-20).every((x) => x.tier2 && !x.timingFallback);
      if (allTier2) {
        visibility = 'full';
        visibilityText = 'Phase visibility · full';
      } else if (anyTier2) {
        visibility = 'partial';
        visibilityText = 'Phase visibility · partial';
      }
    }

    // Sample meta — "N carrier loss · M rounds · last failure …".
    const failures = samplesArr.filter((x) => x.status !== 'ok');
    const carrierLoss = failures.length;
    const lastFail = failures[failures.length - 1];
    const lastFailure = lastFail ? `R${lastFail.round}` : 'never';
    const sampleMeta = `${carrierLoss} carrier loss · ${measurements.roundCounter} rounds · last failure ${lastFailure}`;

    return {
      endpointId: ep.id,
      stationId,
      name: ep.label,
      host,
      sampleCount,
      status: sev,
      statusText: statusText(sev),
      p50, p75, p90, p95, p99,
      p50Sev: p50 === null ? '' : severityCell(p50),
      p75Sev: p75 === null ? '' : severityCell(p75),
      p90Sev: p90 === null ? '' : severityCell(p90),
      p95Sev: p95 === null ? '' : severityCell(p95),
      p99Sev: p99 === null ? '' : severityCell(p99),
      polar,
      phases,
      phaseTotal,
      visibility,
      visibilityText,
      sampleMeta,
      carrierLoss,
      lastFailure,
    };
  }

  const stationRows = $derived<readonly StationRow[]>(
    monitored.slice(0, 4).map((ep, i) => buildStationRow(ep, i)),
  );

  // ── Compare-all overlay (4 stations layered on one polar) ───────────────
  // Renders all stations' latency distributions overlaid on a single polar
  // chart for direct comparison, plus per-station mini-summaries (p50/p95)
  // and a one-sentence narrative naming the tightest, slowest, and widest.
  // Fixed 0-200 ms ceiling with 10 ms bins so all stations share geometry.
  const COMPARE_CEIL = 200;
  const COMPARE_BIN = 10;
  const COMPARE_NBINS = COMPARE_CEIL / COMPARE_BIN;
  const COMPARE_MIN_SAMPLES = 4;

  let compareExpanded = $state(false);

  interface CompareStation {
    readonly endpointId: string;
    readonly stationId: StationId;
    readonly name: string;
    readonly host: string;
    readonly color: string;
    readonly p50: number;
    readonly p95: number;
    readonly p95Sev: '' | 'warn' | 'bad';
    readonly pathD: string;
  }
  interface CompareOverlay {
    readonly stations: readonly CompareStation[];
    readonly arcs: readonly PolarArc[];
    readonly ticks: readonly PolarTick[];
    readonly axisLabels: readonly string[];
    readonly narrative: {
      readonly tightest: { name: string; p50: number };
      readonly slowest: { name: string; p50: number };
      readonly widest: { name: string; spread: number };
    } | null;
  }

  function buildCompareOverlay(): CompareOverlay | null {
    const rows = monitored.slice(0, 4);
    if (rows.length === 0) return null;

    // Gather per-station bin counts + percentiles, gated on min samples.
    interface Gathered {
      endpointId: string;
      stationId: StationId;
      name: string;
      host: string;
      color: string;
      bins: number[];
      p50: number;
      p95: number;
    }
    const gathered: Gathered[] = [];
    for (let i = 0; i < rows.length; i++) {
      const ep = rows[i];
      const stationId = STATION_IDS[i] ?? 'A';
      const m = measurements.endpoints[ep.id];
      if (!m) return null;
      const okLatencies = m.samples
        .toArray()
        .filter((x) => x.status === 'ok')
        .map((x) => x.latency);
      if (okLatencies.length < COMPARE_MIN_SAMPLES) return null;
      const bins = new Array<number>(COMPARE_NBINS).fill(0);
      for (const v of okLatencies) {
        let bi = Math.floor(v / COMPARE_BIN);
        if (bi >= COMPARE_NBINS) bi = COMPARE_NBINS - 1;
        if (bi < 0) bi = 0;
        bins[bi]++;
      }
      const sorted = [...okLatencies].sort((a, b) => a - b);
      const pickQ = (q: number): number => {
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
        return sorted[idx] ?? 0;
      };
      gathered.push({
        endpointId: ep.id,
        stationId,
        name: ep.label,
        host: hostnameOf(ep.url),
        color: `var(--station-${stationId.toLowerCase()})`,
        bins,
        p50: pickQ(0.5),
        p95: pickQ(0.95),
      });
    }

    // Global max across all stations' bins for shared radial scale.
    let globalMax = 1;
    for (const g of gathered) {
      for (const c of g.bins) if (c > globalMax) globalMax = c;
    }

    const angleFor = (v: number): number =>
      Math.PI * (1 - Math.min(v, COMPARE_CEIL) / COMPARE_CEIL);

    // Concentric guide arcs (same geometry as per-station polars).
    const arcs: PolarArc[] = [0.25, 0.5, 0.75, 1.0].map((f) => {
      const r = RI + (RO - RI) * f;
      return {
        d: `M ${(-r).toFixed(2)} 0 A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${r.toFixed(2)} 0`,
        stroke: f === 1 ? 'var(--rule-strong)' : 'var(--rule)',
      };
    });

    // Ticks: 0, 50, 100, 150, 200.
    const tickValues = [0, 50, 100, 150, 200];
    const ticks: PolarTick[] = tickValues.map((t) => {
      const ang = angleFor(t);
      return {
        x1: RI * Math.cos(ang),
        y1: -RI * Math.sin(ang),
        x2: (RI - 4) * Math.cos(ang),
        y2: -(RI - 4) * Math.sin(ang),
        lx: (RI - 10) * Math.cos(ang),
        ly: -(RI - 10) * Math.sin(ang) + 3,
        label: String(t),
      };
    });
    const axisLabels = tickValues.map((t, i) =>
      i === tickValues.length - 1 ? `${t} ms` : String(t),
    );

    // Per-station path: connect bin-midpoint radial coordinates as a polyline.
    const stations: CompareStation[] = gathered.map((g) => {
      const pts: Array<readonly [number, number]> = [];
      for (let i = 0; i < COMPARE_NBINS; i++) {
        const v0 = i * COMPARE_BIN;
        const v1 = (i + 1) * COMPARE_BIN;
        if (v0 >= COMPARE_CEIL) continue;
        const angMid = angleFor((v0 + v1) / 2);
        const h = (g.bins[i] / globalMax) * (RO - RI);
        const r = RI + h;
        pts.push([r * Math.cos(angMid), -r * Math.sin(angMid)] as const);
      }
      const d =
        pts.length < 2
          ? ''
          : pts
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
              .join(' ');
      const p95Sev: '' | 'warn' | 'bad' =
        g.p95 > threshold ? 'bad' : g.p95 > threshold * 0.6 ? 'warn' : '';
      return {
        endpointId: g.endpointId,
        stationId: g.stationId,
        name: g.name,
        host: g.host,
        color: g.color,
        p50: g.p50,
        p95: g.p95,
        p95Sev,
        pathD: d,
      };
    });

    // Narrative: tightest (smallest p95 - p50), slowest (highest p50),
    // widest (largest p95 - p50 spread).
    let tightest = gathered[0];
    let tightestSpread = gathered[0].p95 - gathered[0].p50;
    let slowest = gathered[0];
    let widest = gathered[0];
    let widestSpread = tightestSpread;
    for (const g of gathered) {
      const spread = g.p95 - g.p50;
      if (spread < tightestSpread) {
        tightest = g;
        tightestSpread = spread;
      }
      if (g.p50 > slowest.p50) slowest = g;
      if (spread > widestSpread) {
        widest = g;
        widestSpread = spread;
      }
    }
    const narrative = {
      tightest: { name: tightest.name, p50: tightest.p50 },
      slowest: { name: slowest.name, p50: slowest.p50 },
      widest: { name: widest.name, spread: widestSpread },
    };

    return { stations, arcs, ticks, axisLabels, narrative };
  }

  const compareOverlay = $derived<CompareOverlay | null>(buildCompareOverlay());

  // ── Titlestrip coords ───────────────────────────────────────────────────
  const totalSamples = $derived.by<number>(() => {
    let n = 0;
    for (const ep of monitored) {
      const m = measurements.endpoints[ep.id];
      if (m) n += m.samples.length;
    }
    return n;
  });
  const windowSecondsLabel = $derived(`${tokens.lane.chartWindow} s`);

  // Pseudo-cert identifier — deterministic from session start. Matches the
  // CHR–YYMMDD–HHMM–Axx pattern used by OverviewView so artifacts cross-
  // reference cleanly. v4 footer renders this on the left.
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

  // ── Actions ─────────────────────────────────────────────────────────────
  function openTransit(): void {
    // /transit is the outside-vantage probe surface (Phase C). The probe
    // backend (Cloudflare Workers for IAD/LHR/NRT) is not yet wired, so the
    // view currently renders placeholder probe results. Wiring real probes
    // is Phase D.
    navigateTo({ name: 'transit', endpointId: null });
  }
  function focusEndpoint(endpointId: string): void {
    navigateTo({ name: 'endpoint', endpointId });
  }

  // Phase-bar width helper.
  function pctOf(value: number, total: number): string {
    if (total <= 0) return '0%';
    return `${((value / total) * 100).toFixed(2)}%`;
  }
</script>

{#if focusedId !== null}
  <EndpointView />
{:else}
  <div class="investigate-surface">
    <div class="titlestrip">
      <h2>Investigate<span class="sub">Per-station signal analysis</span></h2>
      <div class="coords">
        <span>Round<span class="v">{measurements.roundCounter}</span></span>
        <span>Window<span class="v">{windowSecondsLabel}</span></span>
        <span>Stations<span class="v">{stationRows.length}</span></span>
        <span>Samples<span class="v">{totalSamples}</span></span>
      </div>
    </div>

    <main class="investigate-main">

      <!-- ============ COMPARE ALL STATIONS OVERLAY ============ -->
      <!-- Spans both columns of the main grid so the side-by-side overlay sits
           above the per-station rows and the outside-vantage column. -->
      <section class="compare-section" class:expanded={compareExpanded}>
        <div class="compare-head">
          <div class="l"><em>Compare</em> all four stations</div>
          <div class="toggle" role="group" aria-label="Toggle comparison overlay">
            <button
              type="button"
              data-mode="expand"
              aria-pressed={compareExpanded ? 'false' : 'true'}
              onclick={() => (compareExpanded = true)}
            >Show overlay</button>
            <button
              type="button"
              data-mode="collapse"
              aria-pressed={compareExpanded ? 'true' : 'false'}
              onclick={() => (compareExpanded = false)}
            >Hide overlay</button>
          </div>
        </div>

        {#if compareExpanded}
          {#if compareOverlay}
            <div class="compare-content">
              <div class="compare-plot">
                <svg
                  class="compare-svg"
                  viewBox="-105 -110 210 125"
                  preserveAspectRatio="xMidYMid meet"
                  aria-label="Latency distributions for all stations overlaid"
                >
                  {#each compareOverlay.arcs as arc, i (i)}
                    <path d={arc.d} fill="none" stroke={arc.stroke} stroke-width="0.6"></path>
                  {/each}
                  {#each compareOverlay.ticks as tick, i (i)}
                    <line
                      x1={tick.x1.toFixed(2)} y1={tick.y1.toFixed(2)}
                      x2={tick.x2.toFixed(2)} y2={tick.y2.toFixed(2)}
                      stroke="rgba(242,235,219,0.25)" stroke-width="0.7"
                    ></line>
                    <text
                      x={tick.lx.toFixed(2)} y={tick.ly.toFixed(2)}
                      font-family="Space Mono" font-size="6" fill="var(--fg-3)"
                      text-anchor="middle" letter-spacing="0.5"
                    >{tick.label}</text>
                  {/each}
                  {#each compareOverlay.stations as s (s.endpointId)}
                    {#if s.pathD}
                      <!-- Glow (wide, low-opacity) underlay -->
                      <path
                        d={s.pathD}
                        stroke={s.color}
                        stroke-opacity="0.22"
                        stroke-width="3.5"
                        fill="none"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                      ></path>
                      <!-- Filament -->
                      <path
                        d={s.pathD}
                        stroke={s.color}
                        stroke-opacity="0.92"
                        stroke-width="1.2"
                        fill="none"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                      ></path>
                    {/if}
                  {/each}
                  <circle cx="0" cy="0" r="1.8" fill="var(--fg)" fill-opacity="0.7"></circle>
                </svg>
                <div class="compare-axis">
                  {#each compareOverlay.axisLabels as label, i (i)}
                    <span>{label}</span>
                  {/each}
                </div>
              </div>

              <div class="compare-legend">
                <div class="legend-head">Side-by-side</div>
                {#each compareOverlay.stations as s (s.endpointId)}
                  <div class="legend-row" data-ep={s.stationId}>
                    <span class="mk" aria-hidden="true"></span>
                    <div class="nm">
                      {s.name}
                      <span class="host">{s.host}</span>
                    </div>
                    <div class="p50"><span class="k">p50</span>{fmt(s.p50)}</div>
                    <div class="p95" data-sev={s.p95Sev}><span class="k">p95</span>{fmt(s.p95)}</div>
                  </div>
                {/each}
                {#if compareOverlay.narrative}
                  <div class="summary">
                    <strong>{compareOverlay.narrative.tightest.name}</strong>
                    holds the tightest band (p50 <em>{fmt(compareOverlay.narrative.tightest.p50)} ms</em>).
                    <strong>{compareOverlay.narrative.slowest.name}</strong>
                    sits slowest by baseline.
                    <strong>{compareOverlay.narrative.widest.name}</strong>
                    shows the widest distribution — its p95-minus-p50 spread is
                    <em>{fmt(compareOverlay.narrative.widest.spread)} ms</em>, indicating jitter.
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="compare-empty">
              <p>Collecting comparison data. Each station needs at least four successful samples before the overlay can render.</p>
            </div>
          {/if}
        {/if}
      </section>

      <!-- ============ PART I — What the carrier records ============ -->
      <section>
        <div class="part-head">
          <div class="kicker"><span class="roman">I</span><span>·</span><span>What the carrier records</span></div>
          <h3>Evidence we measured from this browser.</h3>
          <p class="lede">
            Every value below was recorded by this browser, in this window, on this network. No interpretation, no averaging across sessions, no synthetic claims. <em>If it's printed here, we heard it.</em>
          </p>
        </div>

        <div class="stations">
          {#if stationRows.length === 0}
            <div class="stations-empty">
              <p>No monitored stations. Enable an endpoint in Settings to begin.</p>
            </div>
          {:else}
            {#each stationRows as row (row.endpointId)}
              <div class="station-row">
                <button
                  type="button"
                  class="sr-head"
                  data-ep={row.stationId}
                  onclick={() => focusEndpoint(row.endpointId)}
                  aria-label="Open focused view for {row.name}"
                >
                  <span class="mk" aria-hidden="true"></span>
                  <div class="info">
                    <div class="nm">{row.name}</div>
                    <div class="host">{row.host} · {row.sampleCount} samples</div>
                  </div>
                  <span class="status" data-s={row.status}>{row.statusText}</span>
                </button>

                <div class="ladder">
                  <div class="cell">
                    <div class="k">p50</div>
                    <div class="v" data-sev={row.p50Sev}>
                      {#if row.p50 === null}—{:else}{fmt(row.p50)}<span class="u">ms</span>{/if}
                    </div>
                  </div>
                  <div class="cell">
                    <div class="k">p75</div>
                    <div class="v" data-sev={row.p75Sev}>
                      {#if row.p75 === null}—{:else}{fmt(row.p75)}<span class="u">ms</span>{/if}
                    </div>
                  </div>
                  <div class="cell">
                    <div class="k">p90</div>
                    <div class="v" data-sev={row.p90Sev}>
                      {#if row.p90 === null}—{:else}{fmt(row.p90)}<span class="u">ms</span>{/if}
                    </div>
                  </div>
                  <div class="cell">
                    <div class="k">p95</div>
                    <div class="v" data-sev={row.p95Sev}>
                      {#if row.p95 === null}—{:else}{fmt(row.p95)}<span class="u">ms</span>{/if}
                    </div>
                  </div>
                  <div class="cell">
                    <div class="k">p99</div>
                    <div class="v" data-sev={row.p99Sev}>
                      {#if row.p99 === null}—{:else}{fmt(row.p99)}<span class="u">ms</span>{/if}
                    </div>
                  </div>
                </div>

                <div class="analysis">
                  <div class="polar">
                    <div class="panel-head">
                      <span class="ti">Distribution</span>
                      <span>{row.polar?.distLabel ?? 'Collecting samples'}</span>
                    </div>
                    {#if row.polar}
                      <svg class="polar-svg" viewBox="-105 -110 210 125" preserveAspectRatio="xMidYMid meet" aria-label="Latency distribution for {row.name}">
                        {#each row.polar.arcs as arc, i (i)}
                          <path d={arc.d} fill="none" stroke={arc.stroke} stroke-width="0.6"></path>
                        {/each}
                        {#each row.polar.ticks as tick, i (i)}
                          <line
                            x1={tick.x1.toFixed(2)} y1={tick.y1.toFixed(2)}
                            x2={tick.x2.toFixed(2)} y2={tick.y2.toFixed(2)}
                            stroke="rgba(242,235,219,0.25)" stroke-width="0.7"
                          ></line>
                          <text
                            x={tick.lx.toFixed(2)} y={tick.ly.toFixed(2)}
                            font-family="Space Mono" font-size="6" fill="var(--fg-3)"
                            text-anchor="middle" letter-spacing="0.5"
                          >{tick.label}</text>
                        {/each}
                        {#each row.polar.wedges as wedge, i (i)}
                          <path d={wedge.glowD} fill={wedge.fill} fill-opacity={(wedge.opacity * 0.22).toFixed(3)}></path>
                          <path d={wedge.d} fill={wedge.fill} fill-opacity={wedge.opacity.toFixed(2)}></path>
                        {/each}
                        {#each row.polar.markers as marker, i (i)}
                          <line
                            x1={marker.x1.toFixed(2)} y1={marker.y1.toFixed(2)}
                            x2={marker.x2.toFixed(2)} y2={marker.y2.toFixed(2)}
                            stroke={marker.stroke} stroke-width="0.8" stroke-dasharray="1.5 2"
                          ></line>
                          <text
                            x={marker.lx.toFixed(2)} y={marker.ly.toFixed(2)}
                            font-family="Space Mono" font-size="7" fill={marker.stroke}
                            text-anchor="middle" font-weight="700" letter-spacing="0.5"
                          >{marker.label}</text>
                        {/each}
                        <circle cx="0" cy="0" r="1.8" fill="var(--fg)" fill-opacity="0.7"></circle>
                      </svg>
                      <div class="polar-axis">
                        {#each row.polar.axisLabels as label, i (i)}
                          <span>{label}</span>
                        {/each}
                      </div>
                    {:else}
                      <div class="polar-empty">
                        <p>Collecting samples. The distribution diagram needs at least four successful samples.</p>
                      </div>
                    {/if}
                  </div>

                  {#if row.phases && row.phaseTotal > 0}
                    <div class="phase">
                      <div class="panel-head">
                        <span class="ti">Resource timing</span>
                        <span>p50 phases · {Math.round(row.phaseTotal)} ms total</span>
                      </div>
                      <div class="phase-stack" aria-label="Phase decomposition">
                        <div style:width={pctOf(row.phases.dns, row.phaseTotal)} style:background="var(--phase-dns)"></div>
                        <div style:width={pctOf(row.phases.tcp, row.phaseTotal)} style:background="var(--phase-tcp)"></div>
                        <div style:width={pctOf(row.phases.tls, row.phaseTotal)} style:background="var(--phase-tls)"></div>
                        <div style:width={pctOf(row.phases.ttfb, row.phaseTotal)} style:background="var(--phase-ttfb)"></div>
                        <div style:width={pctOf(row.phases.xfer, row.phaseTotal)} style:background="var(--phase-xfer)"></div>
                      </div>
                      <div class="phase-legend">
                        <div class="it"><div class="sw" style:background="var(--phase-dns)"></div><span class="l">DNS</span><span class="v">{fmt(row.phases.dns)}</span></div>
                        <div class="it"><div class="sw" style:background="var(--phase-tcp)"></div><span class="l">TCP</span><span class="v">{fmt(row.phases.tcp)}</span></div>
                        <div class="it"><div class="sw" style:background="var(--phase-tls)"></div><span class="l">TLS</span><span class="v">{fmt(row.phases.tls)}</span></div>
                        <div class="it"><div class="sw" style:background="var(--phase-ttfb)"></div><span class="l">TTFB</span><span class="v">{fmt(row.phases.ttfb)}</span></div>
                        <div class="it"><div class="sw" style:background="var(--phase-xfer)"></div><span class="l">Xfer</span><span class="v">{fmt(row.phases.xfer)}</span></div>
                      </div>
                    </div>
                  {:else}
                    <div class="opaque">
                      <div class="ic" aria-hidden="true">◌</div>
                      <div class="copy">
                        <strong>Carrier opaque</strong>
                        {row.name} does not return <em>Timing-Allow-Origin</em>; only the total request time is visible. DNS, TCP, TLS, and TTFB are opaque to this browser.
                      </div>
                    </div>
                  {/if}
                </div>

                <div class="sr-foot">
                  <span class="vis" data-v={row.visibility}>{row.visibilityText}</span>
                  <span class="samples">
                    <span class="v">{row.carrierLoss}</span> carrier loss ·
                    <span class="v">{measurements.roundCounter}</span> rounds ·
                    last failure <span class="v">{row.lastFailure}</span>
                  </span>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </section>

      <!-- ============ PART II — What we can't hear from here ============ -->
      <aside class="outside">
        <div class="part-head">
          <div class="kicker"><span class="roman">II</span><span>·</span><span>What we can't hear from here</span></div>
          <h3>Evidence we can't gather alone.</h3>
          <p class="lede">
            Some questions can't be answered from one browser, one network. These probes ask a different vantage so the diagnosis can be <em>your network</em> or <em>their server</em> — not both.
          </p>
        </div>

        <div class="card">
          <div class="card-head">
            <h4>Probe from outside vantages</h4>
            <span class="tag" data-s="ready">Ready</span>
          </div>
          <p>Probe each station from a Cloudflare edge in three regions simultaneously. If they hear what your browser hears, the source is upstream. If they don't, it's local to this network.</p>
          <button type="button" class="action" onclick={openTransit}>Run global transit →</button>
          <div class="detail">
            <span class="k">Regions</span><span class="v">IAD · LHR · NRT</span>
            <span class="k">Last run</span><span class="v">— never this session —</span>
            <span class="k">Latency</span><span class="v">~3 s round-trip</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h4>Companion agent</h4>
            <span class="tag" data-s="absent">Not installed</span>
          </div>
          <p>A desktop companion can bypass browser security limits to expose precise TCP / TLS times, DNS resolver behavior, and Wi-Fi RSSI from <em>your</em> machine — the data the browser refuses to surface.</p>
          <button type="button" class="action disabled" aria-disabled="true">Connect agent →</button>
          <div class="detail">
            <span class="k">Platform</span><span class="v">macOS · Linux · Win</span>
            <span class="k">Install</span><span class="v">~12 MB · signed</span>
            <span class="k">Telemetry</span><span class="v">none · local only</span>
          </div>
        </div>

        <div class="epistemics">
          <h4>Why we separate hearing from diagnosis.</h4>
          <p>Chronoscope measures latency. <strong>It does not guess at root cause without proof.</strong> Most network tools collapse these two — a single number with a one-line guess attached.</p>
          <p>That collapse is the most common way users get misled — a tool sees a slow round and announces "your ISP is degraded," when the upstream CDN is throttling cross-region traffic. We'd rather show you the evidence and let the diagnosis follow the data.</p>
          <div class="signoff">Chronoscope · evidence before diagnosis</div>
        </div>
      </aside>
    </main>

    <footer class="foot">
      <div>Cert<span class="v">{flightCert}</span></div>
      <div class="center">Browser-resident observatory · evidence report · no telemetry leaves this device</div>
      <div class="right">Sampling window<span class="v">{tokens.lane.chartWindow} s</span> · <span class="v">{totalSamples}</span> samples</div>
    </footer>
  </div>
{/if}

<style>
  .investigate-surface {
    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.55;
    overflow-y: auto;
    height: 100%;
  }

  /* ── Titlestrip ─────────────────────────────────────────────────────────── */
  .titlestrip {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 32px;
    padding: 28px clamp(20px, 3vw, 48px) 22px;
    border-bottom: 1px solid var(--rule);
  }
  .titlestrip h2 {
    font-size: 34px;
    font-weight: 200;
    letter-spacing: -0.025em;
    color: var(--fg);
    line-height: 1;
    margin: 0;
  }
  .titlestrip h2 .sub { margin-left: 20px; color: var(--fg-3); font-size: 18px; font-weight: 300; }
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

  /* ── Main layout ────────────────────────────────────────────────────────── */
  .investigate-main {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
    gap: 64px;
    padding: 48px clamp(20px, 3vw, 48px) 64px;
  }

  /* ── Compare-all overlay ────────────────────────────────────────────────── */
  /* Spans both columns of the investigate-main grid (Part I + Part II share
     the top of this section). Mirrors the .compare-section block from
     proposals/v4/proposal-investigate-v4.html, with tokens substituted for
     the prototype's hard-coded colors. */
  .compare-section {
    grid-column: 1 / -1;
    margin-bottom: 24px;
    padding: 32px 36px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    position: relative;
  }
  .compare-section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 32px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
  }
  .compare-section .compare-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 14px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--rule);
  }
  .compare-section.expanded .compare-head { margin-bottom: 24px; }
  .compare-section:not(.expanded) .compare-head { border-bottom: 0; padding-bottom: 0; }
  .compare-section .compare-head .l {
    font-family: var(--sans);
    font-weight: 200;
    font-size: 26px;
    letter-spacing: -0.025em;
    color: var(--fg);
    line-height: 1.05;
  }
  .compare-section .compare-head .l em {
    font-style: italic;
    color: var(--station-b);
    font-weight: 300;
  }
  .compare-section .toggle {
    display: flex;
    border: 1px solid var(--rule-strong);
  }
  .compare-section .toggle button {
    padding: 7px 14px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    background: transparent;
    border: 0;
    border-right: 1px solid var(--rule-strong);
    cursor: pointer;
    transition: background 120ms, color 120ms;
  }
  .compare-section .toggle button:last-child { border-right: 0; }
  .compare-section .toggle button[aria-pressed="true"] {
    background: var(--fg);
    color: var(--bg);
  }
  .compare-section .toggle button:hover:not([aria-pressed="true"]) { color: var(--fg); }

  .compare-content {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }
  .compare-plot { position: relative; }
  .compare-svg {
    width: 100%;
    aspect-ratio: 2 / 1;
    display: block;
    overflow: visible;
    /* Cap polar height to per-station polar size — don't dominate the view. */
    max-height: 240px;
  }
  .compare-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-family: var(--mono);
    font-size: 9px;
    color: var(--fg-4);
    letter-spacing: 0.12em;
    font-weight: 700;
  }

  .compare-legend {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .compare-legend .legend-head {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .compare-legend .legend-row {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr) auto auto;
    gap: 14px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid var(--rule-faint);
  }
  .compare-legend .legend-row:last-of-type { border-bottom: 0; }
  .compare-legend .legend-row .mk { width: 8px; height: 8px; display: block; }
  .compare-legend .legend-row[data-ep="A"] .mk { background: var(--station-a); box-shadow: 0 0 8px var(--station-a); }
  .compare-legend .legend-row[data-ep="B"] .mk { background: var(--station-b); box-shadow: 0 0 8px var(--station-b); }
  .compare-legend .legend-row[data-ep="C"] .mk { background: var(--station-c); box-shadow: 0 0 8px var(--station-c); }
  .compare-legend .legend-row[data-ep="D"] .mk { background: var(--station-d); box-shadow: 0 0 8px var(--station-d); }
  .compare-legend .nm {
    font-family: var(--sans);
    font-size: 14px;
    font-weight: 500;
    color: var(--fg);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compare-legend .nm .host {
    display: block;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.04em;
    color: var(--fg-3);
    font-weight: 700;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compare-legend .p50,
  .compare-legend .p95 {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    color: var(--fg);
    font-weight: 400;
    letter-spacing: -0.005em;
    min-width: 54px;
    text-align: right;
  }
  .compare-legend .p50 .k,
  .compare-legend .p95 .k {
    font-size: 9px;
    color: var(--fg-3);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
    margin-right: 4px;
  }
  .compare-legend .p95[data-sev="warn"] { color: var(--sev-warn); }
  .compare-legend .p95[data-sev="bad"]  { color: var(--sev-bad); }
  .compare-legend .summary {
    margin-top: 18px;
    padding: 16px 18px;
    border: 1px solid var(--rule);
    background: var(--bg-3);
    font-size: 13px;
    line-height: 1.5;
    color: var(--fg-2);
  }
  .compare-legend .summary strong { color: var(--fg); font-weight: 500; }
  .compare-legend .summary em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }

  .compare-empty {
    margin-top: 24px;
    padding: 24px;
    border: 1px solid var(--rule);
    background: var(--bg-3);
    color: var(--fg-3);
    font-size: 13px;
    line-height: 1.5;
  }
  .compare-empty p { margin: 0; max-width: 56ch; }

  /* ── Part header ────────────────────────────────────────────────────────── */
  .part-head { margin-bottom: 32px; }
  .part-head .kicker {
    display: inline-flex;
    align-items: baseline;
    gap: 12px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 18px;
  }
  .part-head .kicker .roman { color: var(--fg); font-weight: 700; }
  .part-head h3 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(36px, 4.6vw, 56px);
    letter-spacing: -0.025em;
    line-height: 1.05;
    color: var(--fg);
    margin: 0 0 16px;
    text-shadow: 0 0 60px rgba(242, 235, 219, 0.08);
  }
  .part-head .lede {
    font-size: 15px;
    color: var(--fg-2);
    line-height: 1.55;
    max-width: 56ch;
    margin: 0;
  }
  .part-head .lede em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }

  /* ── Station rows ───────────────────────────────────────────────────────── */
  .stations {
    border-top: 1px solid var(--rule);
  }
  .stations-empty {
    padding: 36px 0;
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.08em;
  }
  .station-row {
    padding: 36px 0 40px;
    border-bottom: 1px solid var(--rule);
  }
  .station-row:last-child { border-bottom: 0; }

  .sr-head {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    align-items: center;
    gap: 18px;
    margin-bottom: 24px;
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .sr-head:hover .nm { color: var(--station-b); }
  .sr-head:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 4px;
  }
  .sr-head .mk { width: 12px; height: 12px; display: block; }
  .sr-head[data-ep="A"] .mk { background: var(--station-a); box-shadow: 0 0 12px var(--station-a); }
  .sr-head[data-ep="B"] .mk { background: var(--station-b); box-shadow: 0 0 12px var(--station-b); }
  .sr-head[data-ep="C"] .mk { background: var(--station-c); box-shadow: 0 0 12px var(--station-c); }
  .sr-head[data-ep="D"] .mk { background: var(--station-d); box-shadow: 0 0 12px var(--station-d); }
  .sr-head .info .nm {
    font-family: var(--sans);
    font-size: 24px;
    font-weight: 400;
    color: var(--fg);
    letter-spacing: -0.01em;
    line-height: 1;
    margin-bottom: 4px;
    transition: color 120ms;
  }
  .sr-head .info .host {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-3);
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
  .sr-head .status {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 5px 10px;
    border: 1px solid var(--rule-strong);
    color: var(--fg-3);
    font-weight: 700;
    white-space: nowrap;
  }
  .sr-head .status[data-s="stable"] { color: var(--station-b); border-color: var(--station-b); }
  .sr-head .status[data-s="warn"]   { color: var(--sev-warn); border-color: var(--sev-warn); }
  .sr-head .status[data-s="bad"]    { color: var(--sev-bad);  border-color: var(--sev-bad); }
  .sr-head .status[data-s="crit"]   { color: var(--bg); background: var(--sev-crit); border-color: var(--sev-crit); }

  /* ── Percentile ladder ──────────────────────────────────────────────────── */
  .ladder {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    margin-bottom: 24px;
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
  }
  .ladder .cell .v {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 24px;
    font-weight: 400;
    color: var(--fg);
    letter-spacing: -0.01em;
    line-height: 1;
  }
  .ladder .cell .v .u { font-size: 11px; color: var(--fg-3); margin-left: 2px; }
  .ladder .cell .v[data-sev="warn"] { color: var(--sev-warn); }
  .ladder .cell .v[data-sev="bad"]  { color: var(--sev-bad); }
  .ladder .cell .v[data-sev="crit"] { color: var(--sev-crit); }

  /* ── Analysis grid: polar + phase ───────────────────────────────────────── */
  .analysis {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 36px;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 14px;
  }
  .panel-head .ti { color: var(--fg); font-weight: 700; }

  /* ── Polar distribution ─────────────────────────────────────────────────── */
  .polar { padding-top: 12px; border-top: 1px solid var(--rule); }
  .polar-svg {
    width: 100%;
    aspect-ratio: 2 / 1;
    display: block;
    overflow: visible;
  }
  .polar-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-family: var(--mono);
    font-size: 9px;
    color: var(--fg-4);
    letter-spacing: 0.12em;
  }
  .polar-empty {
    padding: 24px 8px;
    color: var(--fg-3);
    font-size: 12px;
    line-height: 1.5;
  }
  .polar-empty p { margin: 0; }

  /* ── Phase decomposition ────────────────────────────────────────────────── */
  .phase { padding-top: 12px; border-top: 1px solid var(--rule); }
  .phase-stack {
    display: flex;
    width: 100%;
    height: 32px;
    border: 1px solid var(--rule-strong);
    overflow: hidden;
    background: var(--bg-2);
  }
  .phase-stack > div { height: 100%; position: relative; }
  .phase-stack > div::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, transparent 50%);
  }
  .phase-legend {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    margin-top: 14px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-2);
  }
  .phase-legend .it { display: flex; flex-direction: column; gap: 4px; }
  .phase-legend .sw { width: 100%; height: 2px; margin-bottom: 4px; }
  .phase-legend .l {
    color: var(--fg-3);
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  .phase-legend .v {
    color: var(--fg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* ── Carrier opaque ─────────────────────────────────────────────────────── */
  .opaque {
    padding-top: 12px;
    border-top: 1px solid var(--rule);
    display: flex;
    gap: 14px;
    align-items: center;
    min-height: 130px;
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

  /* ── Station foot ───────────────────────────────────────────────────────── */
  .sr-foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 22px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-2);
    flex-wrap: wrap;
    gap: 10px;
  }
  .sr-foot .vis {
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-size: 10px;
    font-weight: 700;
  }
  .sr-foot .vis[data-v="full"]    { color: var(--station-b); }
  .sr-foot .vis[data-v="hidden"]  { color: var(--sev-bad); }
  .sr-foot .vis[data-v="partial"] { color: var(--sev-warn); }
  .sr-foot .samples {
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .sr-foot .samples .v {
    color: var(--fg);
    font-weight: 700;
    margin: 0 4px;
  }

  /* ── Outside column (Part II) ───────────────────────────────────────────── */
  aside.outside { position: relative; }
  aside.outside .card {
    padding: 26px 0 28px;
    border-bottom: 1px solid var(--rule);
  }
  aside.outside .card:last-of-type { border-bottom: 0; }
  aside.outside .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 12px;
  }
  aside.outside .card h4 {
    font-family: var(--sans);
    font-size: 22px;
    font-weight: 300;
    color: var(--fg);
    letter-spacing: -0.01em;
    line-height: 1.15;
    max-width: 22ch;
    margin: 0;
  }
  aside.outside .card .tag {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 5px 10px;
    border: 1px solid var(--rule-strong);
    color: var(--fg-3);
    font-weight: 700;
    flex-shrink: 0;
    white-space: nowrap;
  }
  aside.outside .card .tag[data-s="ready"]   { color: var(--station-b); border-color: var(--station-b); }
  aside.outside .card .tag[data-s="absent"]  { color: var(--fg-3); }
  aside.outside .card p {
    font-size: 14px;
    color: var(--fg-2);
    line-height: 1.55;
    margin: 0 0 18px;
    max-width: 46ch;
  }
  aside.outside .card p em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  aside.outside .card .action {
    border: 1px solid var(--fg);
    padding: 9px 16px;
    color: var(--fg);
    background: transparent;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    transition: background 100ms, color 100ms;
    cursor: pointer;
  }
  aside.outside .card .action:hover { background: var(--fg); color: var(--bg); }
  aside.outside .card .action.disabled {
    color: var(--fg-3);
    border-color: var(--rule-strong);
    cursor: not-allowed;
  }
  aside.outside .card .action.disabled:hover {
    background: transparent;
    color: var(--fg-3);
  }
  aside.outside .card .detail {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 18px;
    margin-top: 16px;
    font-family: var(--mono);
    font-size: 11px;
  }
  aside.outside .card .detail .k {
    color: var(--fg-3);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 10px;
    font-weight: 700;
  }
  aside.outside .card .detail .v {
    color: var(--fg-2);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .epistemics {
    margin-top: 36px;
    padding: 26px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    position: relative;
  }
  .epistemics::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 24px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 10px var(--station-b);
  }
  .epistemics h4 {
    font-family: var(--sans);
    font-size: 22px;
    font-weight: 300;
    color: var(--fg);
    letter-spacing: -0.01em;
    line-height: 1.2;
    margin: 0 0 14px;
  }
  .epistemics p {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.6;
    max-width: 50ch;
    margin: 0;
  }
  .epistemics p + p { margin-top: 12px; }
  .epistemics strong { color: var(--fg); font-weight: 500; }
  .epistemics .signoff {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  /* ── Footer ─────────────────────────────────────────────────────────────── */
  .foot {
    padding: 18px clamp(20px, 3vw, 48px);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    border-top: 1px solid var(--rule);
  }
  .foot .v {
    color: var(--fg);
    margin-left: 6px;
    font-weight: 700;
  }
  .foot .center { text-align: center; }
  .foot .right { text-align: right; }

  /* ── Responsive ─────────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .investigate-main {
      grid-template-columns: 1fr;
      gap: 48px;
    }
    .analysis {
      grid-template-columns: 1fr;
      gap: 28px;
    }
    .compare-content {
      grid-template-columns: 1fr;
      gap: 28px;
    }
  }
  @media (max-width: 720px) {
    .titlestrip h2 { font-size: 26px; }
    .titlestrip h2 .sub {
      display: block;
      font-size: 14px;
      margin-left: 0;
      margin-top: 4px;
    }
    .ladder .cell { padding: 10px 8px; }
    .ladder .cell .v { font-size: 17px; }
    .phase-legend { font-size: 9px; }
    .foot { grid-template-columns: 1fr; gap: 4px; text-align: left; }
    .foot .center, .foot .right { text-align: left; }
  }
  @media (max-width: 480px) {
    .titlestrip { padding: 16px clamp(20px, 3vw, 48px) 14px; gap: 12px; }
    .titlestrip h2 { font-size: 22px; }
    .titlestrip h2 .sub { font-size: 12px; }
    .titlestrip .coords { font-size: 9px; letter-spacing: 0.12em; gap: 12px; }
    .ladder .cell { padding: 8px 6px; }
    .ladder .cell .v { font-size: 14px; }
    .ladder .cell .k { font-size: 9px; letter-spacing: 0.16em; }
    .phase-legend { grid-template-columns: repeat(5, 1fr); gap: 4px; font-size: 8px; }
    .phase-legend .it .l { letter-spacing: 0.08em; }
    .sr-head .info .nm { font-size: 18px; }
    .investigate-main { padding: 28px clamp(14px, 3vw, 48px) 40px; gap: 28px; }
    .compare-section { padding: 22px 18px; }
    .compare-section .compare-head .l { font-size: 20px; }
    .compare-section .toggle button { padding: 6px 10px; font-size: 9px; letter-spacing: 0.12em; }
    .compare-legend .legend-row {
      grid-template-columns: 12px minmax(0, 1fr) auto auto;
      gap: 8px;
    }
    .compare-legend .p50, .compare-legend .p95 { font-size: 11px; min-width: 44px; }
    .compare-legend .nm { font-size: 13px; }
  }
</style>
