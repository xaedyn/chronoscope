<!-- src/lib/components/TransitView.svelte -->
<!-- Vessel v4 Outside-Transit surface — single endpoint probed from four
     vantages (the local browser plus three Cloudflare edge regions in IAD,
     LHR, NRT). Translates proposals/v4/proposal-transit-v4.html.

     The default values are explicitly labeled as an example pattern until
     the user runs a fresh outside probe. Re-run dispatches the production
     remote-vantage client plus a local browser probe loop.

     The 3-cell decision matrix at the bottom of the diagnosis card is the
     load-bearing pedagogy: it teaches the user how to read agreement vs
     disagreement across vantages. The verdict text above adapts to the
     simulated outcome ("upstream") so the matrix has a worked example. -->
<script lang="ts">
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { measurementStore } from '$lib/stores/measurements';
  import { statisticsStore } from '$lib/stores/statistics';
  import { settingsStore } from '$lib/stores/settings';
  import { uiStore } from '$lib/stores/ui';
  import { companionStore } from '$lib/stores/companion';
  import { remoteVantageStore } from '$lib/stores/remote-vantage';
  import { navigateTo } from '$lib/router';
  import { remoteVantageClient } from '$lib/remote-vantage/client';
  import { buildDiagnosticReport } from '$lib/utils/diagnostic-report';
  import { buildGuidedProofFlow, type GuidedProofPrimaryAction } from '$lib/utils/proof-flow';
  import type { Endpoint } from '$lib/types';
  import GuidedProofFlow from './GuidedProofFlow.svelte';

  type VantageKey = 'local' | 'iad' | 'lhr' | 'nrt';

  interface VantageProbe {
    readonly key: VantageKey;
    readonly name: string;
    readonly meta: string;
    readonly location: string;
    readonly last: number;
    readonly p50: number;
    readonly p95: number;
    readonly sigma: number;
    readonly bad: boolean;
  }

  // ── Target resolution ──────────────────────────────────────────────────────
  // Prefer the focused endpoint (typical entry path: Investigate → "Run
  // global transit"). Fall back to the first monitored endpoint, then to
  // the AWS example from the prototype so the surface never renders blank.
  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const stats = $derived($statisticsStore);
  const settings = $derived($settingsStore);
  const companion = $derived($companionStore);
  const remoteVantage = $derived($remoteVantageStore);
  const focusedId = $derived($uiStore.focusedEndpointId);
  const targetEndpoint = $derived.by(() => {
    if (focusedId !== null) {
      return monitored.find((ep) => ep.id === focusedId) ?? monitored[0] ?? null;
    }
    return monitored[0] ?? null;
  });
  const diagnosticReport = $derived(buildDiagnosticReport({
    endpoints: monitored,
    stats,
    measurements,
    settings,
    context: null,
  }));
  const guidedProofFlow = $derived(buildGuidedProofFlow({
    report: diagnosticReport,
    remoteVantage,
    companion,
  }));

  interface TargetIdentity {
    readonly displayName: string;
    readonly host: string;
    readonly section: string;
  }
  const target = $derived<TargetIdentity>((() => {
    const ep = targetEndpoint;
    if (ep === null) {
      return {
        displayName: 'AWS',
        host: 's3.us-west-2.amazonaws.com',
        section: 'AWS · s3.us-west-2',
      };
    }
    let host = ep.url;
    try { host = new URL(ep.url).host; } catch { /* leave as raw url */ }
    return {
      displayName: ep.label,
      host,
      section: `${ep.label} · ${host}`,
    };
  })());

  // ── Probe state ────────────────────────────────────────────────────────────
  // Initial state mirrors the v4 prototype's "upstream slow" worked example
  // so the surface renders meaningfully before any backend call. Re-run
  // dispatches the real /api/transit-probe endpoint + a local browser probe
  // loop and replaces these values with measured data.
  const PROBES_PER_VANTAGE = 10;
  const BASELINE_MS = 30;
  const SLOW_THRESHOLD_MS = BASELINE_MS * 1.5;
  const RUN_DURATION_S = 3.1;

  const DEFAULT_PROBES: readonly VantageProbe[] = [
    {
      key: 'local', name: 'Your browser', meta: 'Chrome · macOS · US-W',
      location: 'Local · US-W',
      last: 74, p50: 71, p95: 86, sigma: 5, bad: true,
    },
    {
      key: 'iad', name: 'Cloudflare IAD', meta: 'Ashburn · Virginia',
      location: 'Ashburn · Virginia',
      last: 68, p50: 66, p95: 79, sigma: 4, bad: true,
    },
    {
      key: 'lhr', name: 'Cloudflare LHR', meta: 'London · United Kingdom',
      location: 'London · UK',
      last: 81, p50: 78, p95: 94, sigma: 7, bad: true,
    },
    {
      key: 'nrt', name: 'Cloudflare NRT', meta: 'Tokyo · Japan',
      location: 'Tokyo · Japan',
      last: 79, p50: 76, p95: 91, sigma: 6, bad: true,
    },
  ];
  let probes = $state<readonly VantageProbe[]>(DEFAULT_PROBES);
  let runState = $state<'idle' | 'running' | 'error'>('idle');
  let runError = $state<string | null>(null);
  let dataSource = $state<'example' | 'measured' | 'partial'>('example');
  let measuredKeys = $state<readonly VantageKey[]>([]);
  const transitGuidedProofFlow = $derived({
    ...guidedProofFlow,
    primaryAction: runState === 'running'
      ? {
          ...guidedProofFlow.primaryAction,
          id: 'wait-outside' as const,
          label: 'Outside check running',
          detail: 'Transit is measuring the outside comparison now.',
          disabled: true,
        }
      : guidedProofFlow.primaryAction,
  });

  // ── Verdict aggregates ─────────────────────────────────────────────────────
  const agreementCount = $derived(probes.filter((p) => p.bad).length);
  const totalVantages = $derived(probes.length);
  const measuredKeySet = $derived(new Set(measuredKeys));
  const measuredProbes = $derived(probes.filter((p) => measuredKeySet.has(p.key)));
  const measuredVantageCount = $derived(measuredProbes.length);
  const measuredAgreementCount = $derived(measuredProbes.filter((p) => p.bad).length);
  const hasMeasuredTransit = $derived(dataSource !== 'example' && measuredVantageCount > 0);
  const hasExampleRows = $derived(dataSource !== 'example' && measuredVantageCount < totalVantages);
  const displayAgreementCount = $derived(dataSource === 'example' ? agreementCount : measuredAgreementCount);
  const displayAgreementTotal = $derived(dataSource === 'example' ? totalVantages : measuredVantageCount);
  const displayAgreementLabel = $derived(dataSource === 'example' ? 'Agreement' : 'Measured agreement');
  const probesTotal = $derived(totalVantages * PROBES_PER_VANTAGE);
  const displayedProbeCount = $derived(dataSource === 'example' ? probesTotal : measuredVantageCount * PROBES_PER_VANTAGE);
  const visibleProbesForVerdict = $derived(dataSource === 'example' ? probes : measuredProbes);
  const medianLast = $derived.by(() => {
    const sorted = [...visibleProbesForVerdict].map((p) => p.last).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  });
  const spreadMs = $derived.by(() => {
    if (visibleProbesForVerdict.length === 0) return 0;
    const lasts = visibleProbesForVerdict.map((p) => p.last);
    return Math.round((Math.max(...lasts) - Math.min(...lasts)) / 2);
  });
  const minLast = $derived.by(() => {
    if (visibleProbesForVerdict.length === 0) return 0;
    return Math.min(...visibleProbesForVerdict.map((p) => p.last));
  });
  const maxLast = $derived.by(() => {
    if (visibleProbesForVerdict.length === 0) return 0;
    return Math.max(...visibleProbesForVerdict.map((p) => p.last));
  });
  const slowdownX = $derived.by(() => {
    if (BASELINE_MS <= 0) return '—';
    return `${(medianLast / BASELINE_MS).toFixed(1)}×`;
  });
  const proofSourceLabel = $derived<string>((() => {
    if (runState === 'running') return 'Running live probe';
    if (dataSource === 'measured') return 'Measured run';
    if (dataSource === 'partial') return 'Partial measured run';
    return 'Example pattern';
  })());
  const progressLabel = $derived<string>(
    runState === 'running'
      ? 'Transit running'
      : dataSource === 'example'
        ? 'Example data'
        : dataSource === 'partial'
          ? 'Partial transit'
          : 'Transit measured',
  );
  const heroHeadline = $derived<string>((() => {
    if (dataSource === 'example') return `Example upstream pattern for ${target.displayName}.`;
    if (hasMeasuredTransit && measuredAgreementCount === measuredVantageCount) {
      return `Measured transit lanes see ${target.displayName} slow.`;
    }
    if (hasMeasuredTransit && measuredAgreementCount === 1) {
      return `One measured transit lane is slow for ${target.displayName}.`;
    }
    return `Mixed measured transit evidence for ${target.displayName}.`;
  })());
  const heroLead = $derived<string>((() => {
    if (dataSource === 'example') {
      return `These are default demonstration values. Re-run transit to replace them with fresh local and outside-vantage measurements for ${target.host}.`;
    }
    if (!hasMeasuredTransit) {
      return `Transit did not capture a fresh comparison yet. Keep the report bounded until measured lanes are available.`;
    }
    if (hasExampleRows) {
      return `${measuredVantageCount} fresh lane${measuredVantageCount === 1 ? '' : 's'} measured ${target.displayName} at ${minLast}–${maxLast} ms against the ${SLOW_THRESHOLD_MS} ms slow threshold; unmeasured rows remain examples.`;
    }
    if (measuredAgreementCount === measuredVantageCount) {
      return `Every measured lane reports ${target.displayName} at ${minLast}–${maxLast} ms, above the ${SLOW_THRESHOLD_MS} ms slow threshold.`;
    }
    return `${measuredAgreementCount} of ${measuredVantageCount} measured lanes are above the slow threshold. Use the spread and lane shape to decide whether this is local, regional, or upstream.`;
  })());

  function latencyPercent(value: number): number {
    const ceiling = Math.max(120, maxLast + 20);
    return Math.max(0, Math.min(100, Math.round((value / ceiling) * 100)));
  }

  // ── Mini-trace SVG paths ───────────────────────────────────────────────────
  interface MiniTraceSample {
    readonly cx: number;
    readonly cy: number;
    readonly hot: boolean;
  }
  interface MiniTrace {
    readonly path: string;
    readonly samples: readonly MiniTraceSample[];
  }
  function seededRng(seed: number): () => number {
    let x = seed >>> 0;
    return () => {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }
  function buildMiniTrace(key: VantageKey, baseline: number): MiniTrace {
    const W = 200;
    const H = 50;
    const padX = 4;
    const padY = 6;
    const rng = seededRng(key.charCodeAt(0) * 1009 + 31);
    const maxV = 120;
    const minV = 40;
    const samples: MiniTraceSample[] = [];
    let path = '';
    for (let i = 0; i < 10; i++) {
      const v = baseline + (rng() - 0.5) * 14;
      const x = padX + (i / 9) * (W - padX * 2);
      const y = padY + (H - padY * 2) - ((v - minV) / (maxV - minV)) * (H - padY * 2);
      path += (i === 0 ? 'M ' : ' L ') + x.toFixed(2) + ' ' + y.toFixed(2);
      samples.push({ cx: x, cy: y, hot: v > 60 });
    }
    return { path, samples };
  }
  const miniTraces = $derived.by<Record<VantageKey, MiniTrace>>(() => {
    return Object.fromEntries(
      probes.map((probe) => [probe.key, buildMiniTrace(probe.key, probe.p50)]),
    ) as Record<VantageKey, MiniTrace>;
  });

  // ── Probe log entries (simulated reverse-chronological feed) ───────────────
  // Each body is an ordered run of text + inline emphasis segments so we can
  // render the same typographic detail as the prototype (mono-emphasis on
  // numbers, semibold on the lede) without resorting to `{@html}`.
  type BodySegmentKind = 'text' | 'em' | 'strong';
  interface BodySegment {
    readonly kind: BodySegmentKind;
    readonly text: string;
  }
  interface LogEntry {
    readonly t: string;
    readonly v: '' | VantageKey;
    readonly body: readonly BodySegment[];
    readonly val: number | null;
    readonly bad: boolean;
  }
  function txt(text: string): BodySegment { return { kind: 'text', text }; }
  function em(text: string): BodySegment { return { kind: 'em', text }; }
  function bold(text: string): BodySegment { return { kind: 'strong', text }; }

  // Reactive so the final "initiated" row updates if the target changes
  // (e.g. user navigates here without a focused endpoint, then focus
  // settles via persistence rehydration).
  const probeLog = $derived.by<readonly LogEntry[]>(() => {
    if (dataSource === 'example') {
      return [
        { t: 'Example', v: 'nrt',   body: [txt('Example NRT row · '), em('10 synthetic samples'), txt(' · spread '), em('±6 ms'), txt('.')], val: 79, bad: true },
        { t: 'Example', v: 'lhr',   body: [txt('Example LHR row · '), em('10 synthetic samples'), txt(' · spread '), em('±7 ms'), txt('.')], val: 81, bad: true },
        { t: 'Example', v: 'iad',   body: [txt('Example IAD row · '), em('10 synthetic samples'), txt(' · spread '), em('±4 ms'), txt('.')], val: 68, bad: true },
        { t: 'Example', v: 'local', body: [txt('Example browser row · '), em('10 synthetic samples'), txt(' for layout calibration.')], val: 74, bad: true },
        { t: 'T+0.00', v: '',      body: [bold('Default transit pattern loaded'), txt(' · re-run to measure '), em(target.host), txt('.')], val: null, bad: false },
      ];
    }

    const measuredRows = probes.filter((probe) => measuredKeySet.has(probe.key));
    const rows: LogEntry[] = measuredRows
      .slice()
      .reverse()
      .map((probe, index) => ({
        t: `T+${Math.max(0.1, RUN_DURATION_S - index * 0.18).toFixed(2)}`,
        v: probe.key,
        body: [
          txt(`${probe.name} measured `),
          em(`${PROBES_PER_VANTAGE}/${PROBES_PER_VANTAGE}`),
          txt(' samples · p50 '),
          em(`${probe.p50} ms`),
          txt(' · spread '),
          em(`±${probe.sigma} ms`),
          txt('.'),
        ],
        val: probe.last,
        bad: probe.bad,
      }));

    if (hasExampleRows) {
      rows.push({
        t: 'Bounded',
        v: '',
        body: [bold('Unmeasured regional rows remain examples'), txt(' · excluded from measured agreement.')],
        val: null,
        bad: false,
      });
    } else if (measuredRows.length === 0) {
      rows.push({
        t: 'Error',
        v: '',
        body: [bold('No fresh transit lanes captured'), txt(' · keep the report bounded and retry.')],
        val: null,
        bad: false,
      });
    }

    rows.push({
      t: 'T+0.00',
      v: '',
      body: [bold('Outside transit initiated'), txt(` · ${measuredRows.length}/${totalVantages} measured lanes · target `), em(target.host), txt('.')],
      val: null,
      bad: false,
    });
    return rows;
  });

  // ── Actions ────────────────────────────────────────────────────────────────
  function backToInvestigate(): void {
    if (focusedId !== null) {
      navigateTo({ name: 'endpoint', endpointId: focusedId });
    } else {
      navigateTo({ name: 'investigate', endpointId: null });
    }
  }
  // ── Real probe execution ──────────────────────────────────────────────────
  // Runs PROBES_PER_VANTAGE HEAD requests against the target URL from the
  // browser. Returns stats matching the VantageProbe shape; on errors,
  // returns null so the caller can surface a fallback.
  async function runLocalProbeLoop(targetUrl: string, count: number): Promise<VantageProbe | null> {
    const latencies: number[] = [];
    for (let i = 0; i < count; i++) {
      const t0 = performance.now();
      try {
        await fetch(targetUrl, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
        latencies.push(performance.now() - t0);
      } catch {
        // Probe-loop failures are counted implicitly via missing latencies;
        // p50/p95/sigma are computed over what arrived.
      }
    }
    if (latencies.length === 0) return null;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
    return {
      key: 'local',
      name: 'Your browser',
      meta: 'Local',
      location: 'Local · this browser',
      last: Math.round(latencies[latencies.length - 1]),
      p50: Math.round(p(0.5)),
      p95: Math.round(p(0.95)),
      sigma: Math.round(Math.sqrt(variance)),
      bad: p(0.5) > SLOW_THRESHOLD_MS,
    };
  }

  // Map a Cloudflare colo code to one of our four canonical vantage slots
  // when it matches; otherwise return 'iad' as a stand-in (the response
  // populates whichever slot best represents where the probe ran).
  function coloToKey(colo: string | undefined): VantageKey {
    const c = (colo ?? '').toUpperCase();
    if (['IAD', 'DCA', 'BOS', 'EWR', 'ATL', 'ORD'].includes(c)) return 'iad';
    if (['LHR', 'CDG', 'AMS', 'FRA', 'DUB'].includes(c)) return 'lhr';
    if (['NRT', 'KIX', 'HND', 'ICN', 'HKG', 'SIN'].includes(c)) return 'nrt';
    return 'iad';
  }

  function setRemoteProbeFromTransit(
    endpoint: Endpoint,
    transitResp: Awaited<ReturnType<typeof remoteVantageClient.runTransitProbe>>,
  ): void {
    if (!transitResp.ok) return;
    const hasFailures = transitResp.failures > 0;
    const isSlow = !hasFailures && transitResp.p50 > SLOW_THRESHOLD_MS;
    remoteVantageStore.setProbe({
      ok: true,
      generatedAt: transitResp.checkedAt,
      edge: transitResp.edge,
      results: [{
        endpointId: endpoint.id,
        label: endpoint.label,
        url: endpoint.url,
        ok: !hasFailures,
        status: hasFailures ? 0 : 200,
        statusText: hasFailures
          ? 'Probe failures'
          : isSlow
            ? `Slow above ${SLOW_THRESHOLD_MS} ms threshold`
            : 'OK',
        durationMs: Math.round(transitResp.p50),
        checkedAt: transitResp.checkedAt,
        verdict: hasFailures
          ? 'unreachable'
          : isSlow
            ? 'slow'
            : 'reachable',
        headers: {},
      }],
    });
  }

  async function runGuidedProofAction(action: GuidedProofPrimaryAction): Promise<void> {
    switch (action.id) {
      case 'run-outside':
        await rerunTransit();
        break;
      case 'open-report':
        navigateTo({ name: 'report', endpointId: null });
        break;
      case 'keep-collecting':
      case 'wait-outside':
        break;
    }
  }

  async function rerunTransit(): Promise<void> {
    if (runState === 'running') return;
    runState = 'running';
    runError = null;

    const endpoint = targetEndpoint;
    const targetUrl = endpoint?.url ?? null;
    if (!targetUrl || !endpoint) {
      runError = 'No target endpoint configured';
      runState = 'error';
      measuredKeys = [];
      return;
    }

    try {
      const [localProbe, transitResp] = await Promise.all([
        runLocalProbeLoop(targetUrl, PROBES_PER_VANTAGE),
        remoteVantageClient.runTransitProbe({ target: targetUrl, probeCount: PROBES_PER_VANTAGE }),
      ]);

      const next: VantageProbe[] = DEFAULT_PROBES.map((p) => ({ ...p }));
      const nextMeasuredKeys: VantageKey[] = [];
      if (localProbe) next[0] = localProbe;
      if (localProbe) nextMeasuredKeys.push('local');
      if (transitResp.ok) {
        setRemoteProbeFromTransit(endpoint, transitResp);
        const key = coloToKey(transitResp.region);
        const slot = next.findIndex((p) => p.key === key);
        if (slot >= 0) {
          next[slot] = {
            key,
            name: `Cloudflare ${transitResp.region}`,
            meta: `${transitResp.edge.city ?? '—'} · ${transitResp.edge.country ?? '—'}`,
            location: `${transitResp.edge.city ?? '—'} · ${transitResp.edge.country ?? '—'}`,
            last: Math.round(transitResp.last),
            p50: Math.round(transitResp.p50),
            p95: Math.round(transitResp.p95),
            sigma: Math.round(transitResp.sigma),
            bad: transitResp.p50 > SLOW_THRESHOLD_MS,
          };
          nextMeasuredKeys.push(key);
        }
      } else {
        runError = transitResp.error;
      }
      probes = next;
      measuredKeys = nextMeasuredKeys;
      dataSource = transitResp.ok && nextMeasuredKeys.length === next.length ? 'measured' : 'partial';
      runState = transitResp.ok ? 'idle' : 'error';
    } catch (err) {
      runError = err instanceof Error ? err.message : 'Transit probe failed';
      dataSource = 'partial';
      measuredKeys = [];
      runState = 'error';
    }
  }
  function backCrumbLabel(): string {
    if (focusedId !== null) {
      const ep = monitored.find((m) => m.id === focusedId);
      if (ep) return `← Station / ${ep.label}`;
    }
    return '← Investigate';
  }
</script>

<section class="transit-surface" aria-label="Outside transit probe results">
  <!-- HERO STAGE -->
  <div class="stage">
    <div class="breadcrumb">
      <div class="crumb">
        <button type="button" class="crumb-link" onclick={backToInvestigate}>{backCrumbLabel()}</button>
        <span class="sep">/</span>
        <span class="current">Outside transit</span>
      </div>
      <div class="meta">
        <span>Probes<span class="v">{PROBES_PER_VANTAGE}</span> per vantage</span>
        <span>Method<span class="v">HEAD · CORS</span></span>
        <span>Duration<span class="v">{RUN_DURATION_S.toFixed(1)} s</span></span>
      </div>
    </div>

    <div class="vantages">
      <div class="v-head">Probing from</div>
      {#each probes as probe (probe.key)}
        {@const isMeasuredRow = dataSource === 'example' || measuredKeySet.has(probe.key)}
        <div class="v-card" data-v={probe.key} data-source={isMeasuredRow ? 'measured' : 'example'}>
          <span class="mk"></span>
          <div class="info">
            <div class="nm">{probe.name}</div>
            <div class="meta">{probe.meta}</div>
            {#if dataSource !== 'example'}
              <div class="src">{isMeasuredRow ? 'Measured this run' : 'Example row'}</div>
            {/if}
          </div>
          <div class="val" class:bad={probe.bad}>{probe.last}<span class="u">ms</span></div>
        </div>
      {/each}
    </div>

    <div class="transit-proof-map" data-source={dataSource}>
      <div class="map-head">
        <div>
          <span class="k">Global proof map</span>
          <strong>{proofSourceLabel}</strong>
        </div>
        <div class="source-note">
          {#if dataSource === 'example'}
            Re-run to measure this target.
          {:else if hasExampleRows}
            {measuredVantageCount} / {totalVantages} lanes measured; others are examples.
          {:else if dataSource === 'partial'}
            No fresh lanes captured.
          {:else}
            Fresh all-vantage evidence.
          {/if}
        </div>
      </div>
      <div class="map-scale" aria-hidden="true">
        <span>0</span>
        <span>{BASELINE_MS} ms baseline</span>
        <span>{Math.max(120, maxLast + 20)} ms</span>
      </div>
      <div class="map-lanes">
        {#each probes as probe (probe.key)}
          {@const isMeasuredRow = dataSource === 'example' || measuredKeySet.has(probe.key)}
          <div class="proof-lane" data-v={probe.key} data-bad={probe.bad ? 'true' : 'false'} data-source={isMeasuredRow ? 'measured' : 'example'}>
            <span class="lane-name">{probe.key.toUpperCase()}</span>
            <span class="lane-track">
              <span class="baseline" style:left="{latencyPercent(BASELINE_MS)}%"></span>
              <span class="bar" style:width="{latencyPercent(probe.last)}%"></span>
              <span class="dot" style:left="{latencyPercent(probe.last)}%"></span>
            </span>
            <span class="lane-value">{probe.last}<em>ms</em></span>
          </div>
        {/each}
      </div>
      <div class="map-readouts">
        <span>{displayAgreementLabel}<strong>{displayAgreementCount} / {displayAgreementTotal}</strong></span>
        <span>Spread<strong>±{spreadMs} ms</strong></span>
        <span>Slowdown<strong>{slowdownX}</strong></span>
      </div>
    </div>

    <div class="hero-meta">
      <div class="kicker"><span class="pip"></span><span>Outside transit · § II</span></div>
      <div class="pre-title">Target<span class="v">{target.section}</span></div>
      <h1>{heroHeadline}</h1>
      <p class="body">
        <strong>{proofSourceLabel}.</strong> {heroLead}
      </p>
      <div class="agreement">
        <div class="stat"><div class="k">{displayAgreementLabel}</div><div class="v good">{displayAgreementCount} / {displayAgreementTotal}</div></div>
        <div class="stat"><div class="k">Median</div><div class="v bad">{medianLast}<span class="u">ms</span></div></div>
        <div class="stat"><div class="k">Spread</div><div class="v">±{spreadMs}<span class="u">ms</span></div></div>
        <div class="stat"><div class="k">Confidence</div><div class="v">{dataSource === 'example' ? 'Example' : hasExampleRows ? 'Bounded' : hasMeasuredTransit ? 'High' : 'Low'}</div></div>
      </div>
    </div>

    <div class="hero-left">
      <div class="label">Probing target</div>
      <div class="target-name">{target.displayName}</div>
      <div class="target-host">{target.host} · last probe T+{RUN_DURATION_S.toFixed(1)} s</div>
    </div>

    <div class="progress-bar">
      <span class="lbl">{progressLabel}</span>
      <div class="track"><div class="fill"></div></div>
      <span class="read">{dataSource === 'example' ? 'Default values' : 'Measured lanes'}<span class="v">{dataSource === 'example' ? totalVantages : measuredVantageCount} / {totalVantages} · {PROBES_PER_VANTAGE} probes ea.</span></span>
    </div>
  </div>

  <!-- BELOW HERO -->
  <div class="below">
    <div class="transit-guided-proof">
      <GuidedProofFlow
        flow={transitGuidedProofFlow}
        compact={true}
        title="Outside proof loop"
        onAction={runGuidedProofAction}
      />
    </div>

    <!-- COMPARISON -->
    <div class="comparison">
      <div class="section-head">
        <span class="l">Per-vantage comparison</span>
        <span class="r">
          <span>Probes<span class="v">{PROBES_PER_VANTAGE}</span></span>
          <span>Target<span class="v">{target.displayName}</span></span>
        </span>
      </div>
      <div class="comparison-grid">
        {#each probes as probe (probe.key)}
          {@const trace = miniTraces[probe.key]}
          {@const isMeasuredRow = dataSource === 'example' || measuredKeySet.has(probe.key)}
          <div class="van-col" data-v={probe.key}>
            <div class="head">
              <div class="nm">{probe.name}<span class="loc">{probe.location}</span></div>
              <div class="tag" data-s={isMeasuredRow ? (probe.bad ? 'slow' : 'ok') : 'example'}>{isMeasuredRow ? (probe.bad ? 'Slow' : 'OK') : 'Example'}</div>
            </div>
            <div class="read-row">
              <span class="label">Last</span>
              <span class="v" class:bad={probe.bad}>{probe.last}<span class="u">ms</span></span>
            </div>
            <div class="stats-row">
              <div class="s">
                <div class="k">p50</div>
                <div class="v" class:bad={probe.bad}>{probe.p50}<span class="u">ms</span></div>
              </div>
              <div class="s">
                <div class="k">p95</div>
                <div class="v" class:bad={probe.bad}>{probe.p95}<span class="u">ms</span></div>
              </div>
              <div class="s">
                <div class="k">σ</div>
                <div class="v">±{probe.sigma}<span class="u">ms</span></div>
              </div>
            </div>
            <div class="mini-trace">
              <svg viewBox="0 0 200 50" data-trace={probe.key} aria-hidden="true">
                <line
                  x1="4" y1="7" x2="196" y2="7"
                  stroke="var(--sev-bad)" stroke-opacity="0.3"
                  stroke-dasharray="2 3" stroke-width="0.5"
                />
                <path
                  d={trace.path}
                  stroke={`var(--van-${probe.key})`}
                  stroke-width="3" stroke-opacity="0.2"
                  fill="none" stroke-linejoin="round" stroke-linecap="round"
                />
                <path
                  d={trace.path}
                  stroke={`var(--van-${probe.key})`}
                  stroke-width="1" stroke-opacity="0.9"
                  fill="none" stroke-linejoin="round" stroke-linecap="round"
                />
                {#each trace.samples as sample, i (i)}
                  <circle
                    cx={sample.cx.toFixed(2)}
                    cy={sample.cy.toFixed(2)}
                    r="2.2"
                    fill={sample.hot ? 'var(--sev-bad)' : `var(--van-${probe.key})`}
                    fill-opacity="0.32"
                  />
                  <circle
                    cx={sample.cx.toFixed(2)}
                    cy={sample.cy.toFixed(2)}
                    r="1"
                    fill={sample.hot ? 'var(--sev-bad)' : `var(--van-${probe.key})`}
                  />
                {/each}
              </svg>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- DIAGNOSIS -->
    <div class="diagnosis">
      <div class="head">
        <div class="k">Diagnosis · § III</div>
        <div class="tag">{displayAgreementCount} / {displayAgreementTotal} slow {hasMeasuredTransit ? 'measured lanes' : 'vantages'}</div>
      </div>
      <h2>
        {#if dataSource === 'example' && agreementCount === totalVantages}
          Example vantages show <em>{target.displayName}</em> slow.
        {:else if dataSource !== 'example' && !hasMeasuredTransit}
          Transit has no fresh measured lanes for <em>{target.displayName}</em> yet.
        {:else if hasMeasuredTransit && measuredAgreementCount === measuredVantageCount}
          Fresh measured lanes see <em>{target.displayName}</em> slow.
        {:else if displayAgreementCount === 1}
          Only one {hasMeasuredTransit ? 'measured lane' : 'vantage'} sees <em>{target.displayName}</em> slow.
        {:else}
          Transit evidence is mixed for <em>{target.displayName}</em>.
        {/if}
      </h2>
      {#if dataSource === 'example'}
        <p>The default rows put {target.displayName} at <strong>{minLast} – {maxLast} ms</strong>. Treat this as a worked example until a fresh transit run replaces the rows.</p>
        <p>Re-run transit to capture measured local and Cloudflare evidence before attaching this page to a report.</p>
      {:else if !hasMeasuredTransit}
        <p>No fresh measured lanes are available for {target.displayName}. The regional rows remain examples and are excluded from measured agreement.</p>
        <p>Re-run transit before attaching this page to a report, or keep the report bounded to the browser evidence already captured.</p>
      {:else if hasMeasuredTransit && measuredAgreementCount === measuredVantageCount}
        <p>Every fresh measured lane reported {target.displayName} at <strong>{minLast} – {maxLast} ms</strong>. The <em>±{spreadMs} ms</em> spread strengthens the browser finding, within the lanes actually measured.</p>
        <p>Compared to the <strong>{SLOW_THRESHOLD_MS} ms</strong> slow threshold, the median measured shape shows a <em>{slowdownX}</em> slowdown. {hasExampleRows ? 'Rows marked as examples are not part of that proof.' : 'That supports endpoint or upstream investigation without claiming private routing, DNS, Wi-Fi, or server internals.'}</p>
      {:else}
        <p>{displayAgreementCount} of {displayAgreementTotal} measured lanes are above the <strong>{SLOW_THRESHOLD_MS} ms</strong> slow threshold for {target.displayName}. The <em>±{spreadMs} ms</em> spread matters more than any single number.</p>
        <p>Use this as bounded comparison evidence: mixed measured lanes narrow the investigation, but they do not name a final cause on their own.</p>
      {/if}

      <!-- 3-cell decision matrix — pedagogy for reading agreement vs disagreement -->
      <div class="grid">
        <div class="item">
          <div class="k">If local path</div>
          <div class="v">browser and outside vantages disagree in a repeatable shape</div>
        </div>
        <div class="item">
          <div class="k">If endpoint-side</div>
          <div class="v">measured browser and outside lanes <em>agree</em> within tight tolerance</div>
        </div>
        <div class="item">
          <div class="k">This run</div>
          <div class="v">{displayAgreementLabel} <em>{displayAgreementCount} / {displayAgreementTotal}</em>; spread <em>±{spreadMs} ms</em>. <strong>{!hasMeasuredTransit && dataSource !== 'example' ? 'No fresh evidence.' : hasExampleRows ? 'Partial evidence.' : displayAgreementCount === displayAgreementTotal ? 'Measured agreement.' : 'Mixed evidence.'}</strong></div>
        </div>
      </div>
    </div>

    <!-- METHODOLOGY -->
    <div class="method">
      <div class="section-head">
        <span class="l">Methodology</span>
        <span class="r">
          <span>{hasMeasuredTransit ? 'Measured probes' : 'Example probes'}<span class="v">{displayedProbeCount}</span></span>
          <span>Took<span class="v">{RUN_DURATION_S.toFixed(1)} s</span></span>
        </span>
      </div>
      <div class="method-grid">
        <div class="step">
          <div class="num">01</div>
          <h4>Fire the same probe from measured origins.</h4>
          <p>The current production run measures your browser plus the Cloudflare edge that answers this request. Other regional rows stay marked as examples until multi-region fanout is available.</p>
        </div>
        <div class="step">
          <div class="num">02</div>
          <h4>Each origin records its own measurements.</h4>
          <p>Measured origins record latency from <em>their</em> network to the target, not relayed through yours. Results come back as raw numbers, not summaries.</p>
        </div>
        <div class="step">
          <div class="num">03</div>
          <h4>Compare the shape of agreement.</h4>
          <p>If vantages report similar slow numbers, endpoint-side investigation gets stronger. If only one path is slow, keep the scope narrower. The <em>shape</em> guides the next proof step; we don't pre-decide.</p>
        </div>
      </div>
    </div>

    <!-- PROBE LOG -->
    <div class="log-section">
      <div class="section-head">
        <span class="l">Probe log · ordered by completion</span>
        <span class="r"><span>Entries<span class="v">{probeLog.length}</span></span></span>
      </div>
      <div class="log-list">
        {#each probeLog as entry, i (i)}
          <div class="log-row">
            <span class="t">{entry.t}</span>
            <span class="v-tag" data-v={entry.v}>{entry.v.toUpperCase()}</span>
            <span class="body">
              {#each entry.body as seg, j (j)}
                {#if seg.kind === 'em'}
                  <em>{seg.text}</em>
                {:else if seg.kind === 'strong'}
                  <strong>{seg.text}</strong>
                {:else}
                  {seg.text}
                {/if}
              {/each}
            </span>
            {#if entry.val !== null}
              <span class="val" class:bad={entry.bad}>{entry.val}<span class="u">ms</span></span>
            {:else}
              <span class="val-spacer" aria-hidden="true"></span>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <!-- NEXT STEP -->
    <div class="next-step">
      <div class="kicker">Where to go from here</div>
      <h3>{hasMeasuredTransit && measuredAgreementCount === measuredVantageCount ? `Attach this bounded outside check to ${target.displayName}.` : `Keep comparing ${target.displayName}.`}</h3>
      <p>
        {#if hasMeasuredTransit && measuredAgreementCount === measuredVantageCount}
          The measured transit lanes strengthen the browser report for <em>{target.host}</em>. Use the report as the handoff, then check service health, ingress metrics, or provider status if you own the endpoint. Re-run this transit in <em>5 min</em> to see if the measured agreement changes.
        {:else}
          The measured outside check is not unanimous, or some rows are still examples. Keep the report bounded to measured agreement, then re-run from the same target or add local-agent evidence if the browser path needs deeper inspection.
        {/if}
      </p>
      <div class="row">
        <button type="button" class="primary" onclick={rerunTransit} disabled={runState === 'running'}>
          {runState === 'running' ? 'Running probe…' : 'Re-run transit →'}
        </button>
        <button type="button" class="ghost" onclick={() => {}}>Schedule monitor</button>
        <button type="button" class="ghost" onclick={() => {}}>Share this verdict</button>
      </div>
      {#if runError}
        <p class="run-error" role="alert">Probe error: {runError}</p>
      {/if}
    </div>
  </div>
</section>

<style>
  /* ── Vantage palette ────────────────────────────────────────────────────────
     The prototype defines its own --van-* tokens. We reuse the v4 design
     tokens that already carry these hues:
       --van-local  → --fg          (bone-white)
       --van-iad    → --phase-tls   (violet)
       --van-lhr    → --station-b   (Vega cyan)
       --van-nrt    → --station-d   (Betelgeuse red-orange)
       --target     → --station-c   (Sun yellow-white) */
  .transit-surface {
    --van-local: var(--fg);
    --van-iad: var(--phase-tls);
    --van-lhr: var(--station-b);
    --van-nrt: var(--station-d);
    --target: var(--station-c);
    --target-glow: color-mix(in srgb, var(--station-c) 18%, transparent);
    --pad-x: clamp(20px, 3vw, 48px);

    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.55;
    display: block;
  }

  /* ── HERO STAGE ─────────────────────────────────────────────────────────── */
  .stage {
    position: relative;
    min-height: 780px;
    background: var(--bg);
    overflow: hidden;
    padding-top: 48px;
  }

  /* ── BREADCRUMB ─────────────────────────────────────────────────────────── */
  .breadcrumb {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 4;
    padding: 12px var(--pad-x);
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
    background: color-mix(in srgb, var(--bg) 45%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border-bottom: 1px solid var(--rule);
  }
  .crumb {
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
  .crumb .sep { color: var(--fg-4); }
  .crumb .current {
    color: var(--target);
    text-shadow: 0 0 8px var(--target-glow);
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

  /* ── VANTAGE PANEL (top-left) ───────────────────────────────────────────── */
  .vantages {
    position: absolute;
    top: 80px;
    left: var(--pad-x);
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 280px;
  }
  .v-head {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 6px;
  }
  .v-card {
    display: grid;
    grid-template-columns: 8px 1fr auto;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--rule);
    position: relative;
  }
  .v-card[data-source="example"] {
    opacity: 0.66;
    border-style: dashed;
  }
  .v-card[data-v="local"] .mk { background: var(--van-local); box-shadow: 0 0 8px var(--van-local); }
  .v-card[data-v="iad"] .mk   { background: var(--van-iad);   box-shadow: 0 0 8px var(--van-iad); }
  .v-card[data-v="lhr"] .mk   { background: var(--van-lhr);   box-shadow: 0 0 8px var(--van-lhr); }
  .v-card[data-v="nrt"] .mk   { background: var(--van-nrt);   box-shadow: 0 0 8px var(--van-nrt); }
  .v-card .mk { width: 7px; height: 7px; }
  .v-card .info { min-width: 0; }
  .v-card .nm {
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
    margin-bottom: 3px;
  }
  .v-card .meta {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .v-card .src {
    margin-top: 4px;
    font-family: var(--mono);
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-4);
    font-weight: 700;
  }
  .v-card .val {
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 400;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    text-align: right;
    line-height: 1;
  }
  .v-card .val.bad { color: var(--sev-bad); }
  .v-card .val .u {
    font-size: 9px;
    color: var(--fg-3);
    margin-left: 2px;
  }

  /* ── FIRST-VIEWPORT GLOBAL PROOF MAP ───────────────────────────────────── */
  .transit-proof-map {
    position: absolute;
    top: 80px;
    left: calc(var(--pad-x) + 304px);
    z-index: 4;
    width: min(460px, calc(100vw - 920px));
    min-width: 340px;
    padding: 16px 18px 18px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .transit-proof-map::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    width: 34px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
  }
  .map-head {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    align-items: flex-start;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .map-head .k,
  .map-head strong,
  .source-note,
  .map-scale,
  .lane-name,
  .map-readouts {
    font-family: var(--mono);
    text-transform: uppercase;
    font-weight: 700;
  }
  .map-head .k {
    display: block;
    margin-bottom: 5px;
    color: var(--fg-3);
    font-size: 9px;
    letter-spacing: 0.22em;
  }
  .map-head strong {
    color: var(--fg);
    font-size: 11px;
    letter-spacing: 0.16em;
  }
  .source-note {
    max-width: 24ch;
    color: var(--fg-3);
    font-size: 9px;
    letter-spacing: 0.12em;
    line-height: 1.35;
    text-align: right;
  }
  .transit-proof-map[data-source="example"] .source-note {
    color: var(--sev-warn);
  }
  .map-scale {
    display: grid;
    grid-template-columns: 42px 1fr 48px;
    gap: 10px;
    margin: 13px 0 9px;
    color: var(--fg-4);
    font-size: 8px;
    letter-spacing: 0.12em;
  }
  .map-scale span:nth-child(2) { color: var(--fg-3); }
  .map-scale span:last-child { text-align: right; }
  .map-lanes {
    display: grid;
    gap: 9px;
  }
  .proof-lane {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 52px;
    align-items: center;
    gap: 10px;
  }
  .proof-lane[data-source="example"] {
    opacity: 0.5;
  }
  .lane-name {
    color: var(--fg-3);
    font-size: 9px;
    letter-spacing: 0.18em;
  }
  .lane-track {
    position: relative;
    height: 7px;
    background: color-mix(in srgb, var(--fg) 10%, transparent);
    overflow: visible;
  }
  .lane-track .baseline {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 1px;
    background: var(--fg-3);
    opacity: 0.75;
  }
  .lane-track .bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--fg-2);
  }
  .lane-track .dot {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    transform: translate(-50%, -50%);
    background: var(--fg);
    box-shadow: 0 0 10px var(--fg);
  }
  .proof-lane[data-v="local"] .bar,
  .proof-lane[data-v="local"] .dot { background: var(--van-local); box-shadow: 0 0 10px var(--van-local); }
  .proof-lane[data-v="iad"] .bar,
  .proof-lane[data-v="iad"] .dot { background: var(--van-iad); box-shadow: 0 0 10px var(--van-iad); }
  .proof-lane[data-v="lhr"] .bar,
  .proof-lane[data-v="lhr"] .dot { background: var(--van-lhr); box-shadow: 0 0 10px var(--van-lhr); }
  .proof-lane[data-v="nrt"] .bar,
  .proof-lane[data-v="nrt"] .dot { background: var(--van-nrt); box-shadow: 0 0 10px var(--van-nrt); }
  .proof-lane[data-bad="true"] .lane-value {
    color: var(--sev-bad);
  }
  .lane-value {
    color: var(--fg);
    font-family: var(--mono);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .lane-value em {
    margin-left: 2px;
    color: var(--fg-3);
    font-size: 9px;
    font-style: normal;
  }
  .map-readouts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    margin-top: 14px;
    border: 1px solid var(--rule);
    background: var(--rule);
    color: var(--fg-3);
    font-size: 8px;
    letter-spacing: 0.12em;
  }
  .map-readouts span {
    min-width: 0;
    padding: 8px 9px;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
  }
  .map-readouts strong {
    display: block;
    margin-top: 4px;
    color: var(--fg);
    font-size: 11px;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }

  /* ── HERO META (right side — verdict block) ─────────────────────────────── */
  .hero-meta {
    position: absolute;
    right: var(--pad-x);
    top: 50%;
    transform: translateY(-50%);
    z-index: 4;
    text-align: right;
    max-width: 520px;
    pointer-events: none;
  }
  .hero-meta .kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 22px;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-weight: 700;
  }
  .hero-meta .kicker .pip {
    width: 7px;
    height: 7px;
    background: var(--sev-bad);
    box-shadow: 0 0 10px var(--sev-bad);
  }
  .hero-meta .pre-title {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-2);
    margin-bottom: 16px;
    font-weight: 700;
  }
  .hero-meta .pre-title .v {
    color: var(--target);
    margin-left: 6px;
  }
  .hero-meta h1 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(40px, 5vw, 72px);
    letter-spacing: -0.03em;
    line-height: 1.02;
    color: var(--fg);
    margin-bottom: 20px;
    max-width: 18ch;
    margin-left: auto;
    text-shadow: 0 0 60px color-mix(in srgb, var(--fg) 10%, transparent);
  }
  .hero-meta .body {
    font-size: 16px;
    color: var(--fg-2);
    line-height: 1.5;
    max-width: 48ch;
    margin-left: auto;
    margin-bottom: 32px;
  }
  .hero-meta .body strong {
    color: var(--fg);
    font-weight: 500;
  }
  .hero-meta .agreement {
    display: grid;
    grid-template-columns: auto auto auto auto;
    gap: 18px 24px;
    justify-content: end;
    margin-bottom: 24px;
  }
  .hero-meta .agreement .stat { text-align: right; }
  .hero-meta .agreement .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 6px;
    font-weight: 700;
  }
  .hero-meta .agreement .v {
    font-family: var(--sans);
    font-weight: 200;
    font-size: 32px;
    color: var(--fg);
    letter-spacing: -0.025em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .hero-meta .agreement .v .u {
    font-family: var(--mono);
    font-size: 0.36em;
    color: var(--fg-3);
    margin-left: 3px;
    letter-spacing: 0.04em;
    vertical-align: 0.78em;
    display: inline-block;
  }
  .hero-meta .agreement .v.bad { color: var(--sev-bad); }
  .hero-meta .agreement .v.good { color: var(--station-b); }

  /* ── HERO LEFT (target identification) ──────────────────────────────────── */
  .hero-left {
    position: absolute;
    left: var(--pad-x);
    bottom: 120px;
    z-index: 4;
    pointer-events: none;
  }
  .hero-left .label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 10px;
    font-weight: 700;
  }
  .hero-left .target-name {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(48px, 7vw, 108px);
    color: var(--target);
    letter-spacing: -0.04em;
    line-height: 0.85;
    text-shadow: 0 0 80px var(--target-glow);
    margin-bottom: 10px;
  }
  .hero-left .target-host {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--fg-2);
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }

  /* ── PROGRESS BAR (bottom of hero) ──────────────────────────────────────── */
  .progress-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    padding: 14px var(--pad-x) 16px;
    display: flex;
    align-items: center;
    gap: 18px;
    border-top: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .progress-bar .lbl {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    min-width: 130px;
  }
  .progress-bar .track {
    flex: 1;
    height: 1px;
    background: var(--rule-strong);
    position: relative;
  }
  .progress-bar .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 100%;
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
  }
  .progress-bar .read {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    min-width: 130px;
    text-align: right;
    font-weight: 700;
  }
  .progress-bar .read .v {
    color: var(--fg);
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }

  /* ── BELOW HERO ─────────────────────────────────────────────────────────── */
  .below {
    padding: 80px var(--pad-x) 96px;
    border-top: 1px solid var(--rule);
    background: var(--bg);
  }

  .transit-guided-proof {
    max-width: 1180px;
    margin: 0 auto 42px;
  }

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
  .section-head .r .v {
    color: var(--fg);
    margin-left: 6px;
  }

  /* ── COMPARISON ROW ─────────────────────────────────────────────────────── */
  .comparison { margin-bottom: 64px; }
  .comparison-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .van-col {
    background: var(--bg);
    padding: 24px 22px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
  }
  .van-col::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 20px;
    height: 1px;
  }
  .van-col[data-v="local"]::before { background: var(--van-local); box-shadow: 0 0 8px var(--van-local); }
  .van-col[data-v="iad"]::before   { background: var(--van-iad);   box-shadow: 0 0 8px var(--van-iad); }
  .van-col[data-v="lhr"]::before   { background: var(--van-lhr);   box-shadow: 0 0 8px var(--van-lhr); }
  .van-col[data-v="nrt"]::before   { background: var(--van-nrt);   box-shadow: 0 0 8px var(--van-nrt); }
  .van-col .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .van-col .head .nm {
    font-family: var(--sans);
    font-size: 17px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
    line-height: 1;
  }
  .van-col .head .nm .loc {
    display: block;
    margin-top: 4px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .van-col .head .tag {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    padding: 3px 8px;
    border: 1px solid var(--rule-strong);
  }
  .van-col .head .tag[data-s="slow"] {
    color: var(--sev-bad);
    border-color: var(--sev-bad);
  }
  .van-col .head .tag[data-s="ok"] {
    color: var(--station-b);
    border-color: var(--station-b);
  }
  .van-col .head .tag[data-s="example"] {
    color: var(--fg-4);
    border-color: var(--rule);
  }
  .van-col .read-row {
    display: flex;
    align-items: baseline;
    gap: 18px;
    border-top: 1px solid var(--rule);
    padding-top: 14px;
  }
  .van-col .read-row .v {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 28px;
    font-weight: 300;
    color: var(--fg);
    letter-spacing: -0.025em;
    line-height: 1;
  }
  .van-col .read-row .v .u {
    font-size: 11px;
    color: var(--fg-3);
    margin-left: 2px;
  }
  .van-col .read-row .v.bad { color: var(--sev-bad); }
  .van-col .read-row .label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .van-col .stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    border-top: 1px solid var(--rule);
    padding-top: 14px;
  }
  .van-col .stats-row .s { padding: 0; }
  .van-col .stats-row .s + .s {
    border-left: 1px solid var(--rule);
    padding-left: 12px;
    margin-left: 12px;
  }
  .van-col .stats-row .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 4px;
    font-weight: 700;
  }
  .van-col .stats-row .v {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    color: var(--fg);
    font-weight: 400;
  }
  .van-col .stats-row .v .u {
    font-size: 9px;
    color: var(--fg-3);
    margin-left: 1px;
  }
  .van-col .stats-row .v.bad { color: var(--sev-bad); }
  .van-col .mini-trace {
    border-top: 1px solid var(--rule);
    padding-top: 14px;
    height: 60px;
  }
  .van-col .mini-trace svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }

  /* ── DIAGNOSIS CARD ─────────────────────────────────────────────────────── */
  .diagnosis {
    margin-bottom: 56px;
    padding: 32px 36px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    position: relative;
  }
  .diagnosis::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 28px;
    height: 1px;
    background: var(--sev-bad);
    box-shadow: 0 0 12px var(--sev-bad);
  }
  .diagnosis .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .diagnosis .head .k {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .diagnosis .head .tag {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--sev-bad);
    font-weight: 700;
    padding: 5px 10px;
    border: 1px solid var(--sev-bad);
  }
  .diagnosis h2 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(32px, 4vw, 52px);
    letter-spacing: -0.025em;
    line-height: 1.05;
    color: var(--fg);
    margin-bottom: 18px;
    max-width: 24ch;
  }
  .diagnosis h2 em {
    font-style: normal;
    color: var(--sev-bad);
    font-weight: 200;
  }
  .diagnosis p {
    font-size: 15px;
    color: var(--fg-2);
    line-height: 1.55;
    margin-bottom: 14px;
    max-width: 64ch;
  }
  .diagnosis p em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .diagnosis p strong {
    color: var(--fg);
    font-weight: 500;
  }
  .diagnosis .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
    margin-top: 24px;
  }
  .diagnosis .grid .item {
    background: var(--bg);
    padding: 16px 18px;
  }
  .diagnosis .grid .item .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 8px;
    font-weight: 700;
  }
  .diagnosis .grid .item .v {
    font-family: var(--sans);
    font-size: 15px;
    color: var(--fg);
    font-weight: 400;
    line-height: 1.4;
  }
  .diagnosis .grid .item .v em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }

  /* ── METHODOLOGY ────────────────────────────────────────────────────────── */
  .method { margin-bottom: 56px; }
  .method-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .method-grid .step {
    background: var(--bg);
    padding: 28px 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .method-grid .step .num {
    font-family: var(--sans);
    font-weight: 200;
    font-size: 56px;
    line-height: 1;
    color: var(--fg-4);
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }
  .method-grid .step h4 {
    font-family: var(--sans);
    font-weight: 300;
    font-size: 20px;
    letter-spacing: -0.015em;
    line-height: 1.2;
    color: var(--fg);
    max-width: 24ch;
  }
  .method-grid .step p {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.55;
  }
  .method-grid .step p em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }

  /* ── PROBE LOG ──────────────────────────────────────────────────────────── */
  .log-section { margin-bottom: 48px; }
  .log-list { border-top: 1px solid var(--rule); }
  .log-row {
    display: grid;
    grid-template-columns: 80px 60px 1fr auto;
    gap: 18px;
    padding: 12px 0;
    align-items: baseline;
    border-bottom: 1px solid var(--rule-faint);
    font-size: 13px;
  }
  .log-row .t {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    white-space: nowrap;
    font-weight: 700;
  }
  .log-row .v-tag {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .log-row .v-tag[data-v="local"] { color: var(--van-local); }
  .log-row .v-tag[data-v="iad"]   { color: var(--van-iad); }
  .log-row .v-tag[data-v="lhr"]   { color: var(--van-lhr); }
  .log-row .v-tag[data-v="nrt"]   { color: var(--van-nrt); }
  .log-row .body {
    color: var(--fg-2);
    line-height: 1.45;
  }
  .log-row .body strong {
    color: var(--fg);
    font-weight: 500;
  }
  .log-row .body em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .log-row .val {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 14px;
    color: var(--fg);
    font-weight: 400;
    white-space: nowrap;
  }
  .log-row .val .u {
    font-size: 10px;
    color: var(--fg-3);
    margin-left: 2px;
  }
  .log-row .val.bad { color: var(--sev-bad); }
  .log-row .val-spacer { display: inline-block; min-width: 0; }

  /* ── CONCLUSION ACTION ──────────────────────────────────────────────────── */
  .next-step {
    padding: 32px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    position: relative;
  }
  .next-step::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 24px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 10px var(--station-b);
  }
  .next-step .kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 16px;
    font-weight: 700;
  }
  .next-step h3 {
    font-family: var(--sans);
    font-size: 28px;
    font-weight: 300;
    color: var(--fg);
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin-bottom: 14px;
    max-width: 36ch;
  }
  .next-step p {
    font-size: 14px;
    color: var(--fg-2);
    line-height: 1.55;
    margin-bottom: 22px;
    max-width: 54ch;
  }
  .next-step p em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .next-step .row {
    display: flex;
    gap: 12px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    flex-wrap: wrap;
  }
  .next-step .primary {
    border: 1px solid var(--fg);
    background: var(--fg);
    color: var(--bg);
    padding: 11px 18px;
    font-weight: 700;
    transition: background 120ms, border-color 120ms;
    cursor: pointer;
  }
  .next-step .primary:hover {
    background: var(--station-b);
    border-color: var(--station-b);
  }
  .next-step .ghost {
    border: 1px solid var(--rule-strong);
    color: var(--fg-2);
    padding: 11px 18px;
    font-weight: 700;
    cursor: pointer;
    transition: color 120ms, border-color 120ms;
    background: transparent;
  }
  .next-step .ghost:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }
  .next-step .primary:focus-visible,
  .next-step .ghost:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .next-step .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .run-error {
    margin-top: 12px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--sev-bad);
    letter-spacing: 0.04em;
  }

  /* ── RESPONSIVE ─────────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .vantages {
      position: static;
      width: auto;
      padding: 104px var(--pad-x) 12px;
    }
    .transit-proof-map {
      position: static;
      width: auto;
      min-width: 0;
      margin: 0 var(--pad-x) 18px;
    }
    .hero-meta {
      position: static;
      transform: none;
      padding: 24px var(--pad-x);
      max-width: none;
      text-align: left;
    }
    .hero-meta h1,
    .hero-meta .body { margin-left: 0; }
    .hero-meta .agreement { justify-content: start; }
    .hero-meta .agreement .stat { text-align: left; }
    .hero-left {
      position: static;
      padding: 24px var(--pad-x) 80px;
    }
    .progress-bar { position: static; }
    .stage { min-height: 0; padding-top: 48px; }
    .comparison-grid { grid-template-columns: repeat(2, 1fr); }
    .diagnosis .grid { grid-template-columns: 1fr; }
    .method-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 720px) {
    .breadcrumb { font-size: 9px; }
    .comparison-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 480px) {
    .transit-surface { --pad-x: 14px; }
    .breadcrumb {
      padding: 10px var(--pad-x);
      font-size: 9px;
      letter-spacing: 0.14em;
      gap: 8px;
    }
    .breadcrumb .meta { gap: 12px; }
    .vantages { padding-top: 92px; }
    .hero-meta h1 { font-size: clamp(28px, 9vw, 48px); }
    .hero-left .target-name { font-size: clamp(56px, 18vw, 120px); letter-spacing: -0.04em; }
    .stage { min-height: 0; }
    .below { padding: 48px var(--pad-x) 56px; }
    .progress-bar {
      padding: 10px var(--pad-x) 12px;
      gap: 10px;
    }
    .progress-bar .lbl,
    .progress-bar .read {
      font-size: 9px;
      min-width: auto;
    }
    .progress-bar .lbl { display: none; }
    .next-step { padding: 24px; }
    .next-step h3 { font-size: 22px; }
  }
</style>
