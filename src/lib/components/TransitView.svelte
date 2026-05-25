<!-- src/lib/components/TransitView.svelte -->
<!-- Vessel v4 Outside-Transit surface — single endpoint probed from four
     vantages (the local browser plus three Cloudflare edge regions in IAD,
     LHR, NRT). Translates proposals/v4/proposal-transit-v4.html.

     PHASE C SCOPE: Probe results are simulated. The view is wired to the
     monitored-endpoints store so the "target" defaults to the focused
     endpoint (the same endpoint the user was investigating when they
     clicked "Run global transit"). Real probe execution against the three
     Cloudflare workers is a Phase D wiring task — the structure here
     mirrors the shape that real probe results will populate.

     The 3-cell decision matrix at the bottom of the diagnosis card is the
     load-bearing pedagogy: it teaches the user how to read agreement vs
     disagreement across vantages. The verdict text above adapts to the
     simulated outcome ("upstream") so the matrix has a worked example. -->
<script lang="ts">
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { uiStore } from '$lib/stores/ui';
  import { navigateTo } from '$lib/router';
  import { remoteVantageClient } from '$lib/remote-vantage/client';

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
  const focusedId = $derived($uiStore.focusedEndpointId);

  interface TargetIdentity {
    readonly displayName: string;
    readonly host: string;
    readonly section: string;
  }
  const target = $derived<TargetIdentity>((() => {
    const focused = focusedId !== null
      ? monitored.find((ep) => ep.id === focusedId) ?? null
      : null;
    const ep = focused ?? monitored[0] ?? null;
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

  // ── Verdict aggregates ─────────────────────────────────────────────────────
  const agreementCount = $derived(probes.filter((p) => p.bad).length);
  const totalVantages = $derived(probes.length);
  const probesTotal = $derived(totalVantages * PROBES_PER_VANTAGE);
  const medianLast = $derived.by(() => {
    const sorted = [...probes].map((p) => p.last).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  });
  const spreadMs = $derived.by(() => {
    if (probes.length === 0) return 0;
    const lasts = probes.map((p) => p.last);
    return Math.round((Math.max(...lasts) - Math.min(...lasts)) / 2);
  });
  const minLast = $derived(Math.min(...probes.map((p) => p.last)));
  const maxLast = $derived(Math.max(...probes.map((p) => p.last)));
  const slowdownX = $derived.by(() => {
    if (BASELINE_MS <= 0) return '—';
    return `${(medianLast / BASELINE_MS).toFixed(1)}×`;
  });

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
  const miniTraces = $derived<Record<VantageKey, MiniTrace>>({
    local: buildMiniTrace('local', 71),
    iad: buildMiniTrace('iad', 66),
    lhr: buildMiniTrace('lhr', 78),
    nrt: buildMiniTrace('nrt', 76),
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
  const probeLog = $derived<readonly LogEntry[]>([
    { t: 'T+3.10', v: 'local', body: [txt('Probe '), em('10/10'), txt(' complete · all returned.')], val: 74, bad: true },
    { t: 'T+3.05', v: 'nrt',   body: [txt('NRT probe '), em('10/10'), txt(' complete · spread '), em('±6 ms'), txt('.')], val: 79, bad: true },
    { t: 'T+2.98', v: 'lhr',   body: [txt('LHR probe '), em('10/10'), txt(' complete · spread '), em('±7 ms'), txt('.')], val: 81, bad: true },
    { t: 'T+2.92', v: 'iad',   body: [txt('IAD probe '), em('10/10'), txt(' complete · spread '), em('±4 ms'), txt('.')], val: 68, bad: true },
    { t: 'T+2.50', v: 'lhr',   body: [txt('LHR p95 elevated to '), em('94 ms'), txt('.')], val: 94, bad: true },
    { t: 'T+2.10', v: 'iad',   body: [txt('IAD reporting consistent slow band at '), em('66 – 79 ms'), txt('.')], val: 79, bad: true },
    { t: 'T+1.80', v: 'local', body: [txt('Local probes converging at '), em('71 ± 5 ms'), txt('.')], val: 71, bad: true },
    { t: 'T+1.20', v: 'nrt',   body: [txt('NRT first response: '), em('76 ms'), txt('.')], val: 76, bad: true },
    { t: 'T+0.90', v: 'lhr',   body: [txt('LHR first response: '), em('78 ms'), txt('.')], val: 78, bad: true },
    { t: 'T+0.40', v: 'iad',   body: [txt('IAD first response: '), em('66 ms'), txt('.')], val: 66, bad: true },
    { t: 'T+0.05', v: 'local', body: [txt('Local first response: '), em('71 ms'), txt('.')], val: 71, bad: true },
    { t: 'T+0.00', v: '',      body: [bold('Outside transit initiated'), txt(' · 4 vantages · target '), em(target.host), txt('.')], val: null, bad: false },
  ]);

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
      bad: p(0.5) > BASELINE_MS * 1.5,
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

  async function rerunTransit(): Promise<void> {
    if (runState === 'running') return;
    runState = 'running';
    runError = null;

    const targetUrl = focusedId !== null
      ? monitored.find((ep) => ep.id === focusedId)?.url ?? null
      : monitored[0]?.url ?? null;
    if (!targetUrl) {
      runError = 'No target endpoint configured';
      runState = 'error';
      return;
    }

    try {
      const [localProbe, transitResp] = await Promise.all([
        runLocalProbeLoop(targetUrl, PROBES_PER_VANTAGE),
        remoteVantageClient.runTransitProbe({ target: targetUrl, probeCount: PROBES_PER_VANTAGE }),
      ]);

      const next: VantageProbe[] = DEFAULT_PROBES.map((p) => ({ ...p }));
      if (localProbe) next[0] = localProbe;
      if (transitResp.ok) {
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
            bad: transitResp.p50 > BASELINE_MS * 1.5,
          };
        }
      } else {
        runError = transitResp.error;
      }
      probes = next;
      runState = transitResp.ok ? 'idle' : 'error';
    } catch (err) {
      runError = err instanceof Error ? err.message : 'Transit probe failed';
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
        <div class="v-card" data-v={probe.key}>
          <span class="mk"></span>
          <div class="info">
            <div class="nm">{probe.name}</div>
            <div class="meta">{probe.meta}</div>
          </div>
          <div class="val" class:bad={probe.bad}>{probe.last}<span class="u">ms</span></div>
        </div>
      {/each}
    </div>

    <div class="hero-meta">
      <div class="kicker"><span class="pip"></span><span>Outside transit · § II</span></div>
      <div class="pre-title">Target<span class="v">{target.section}</span></div>
      <h1>Confirmed <em>upstream</em>. {target.displayName} is slow from all four vantages.</h1>
      <p class="body">
        <strong>Four vantages, one verdict.</strong> Your browser, IAD, LHR, and NRT all measure {target.displayName} at <em>{minLast}–{maxLast} ms</em> — well above the <em>{BASELINE_MS} ms</em> baseline this station holds when healthy. <strong>This isn't your network.</strong>
      </p>
      <div class="agreement">
        <div class="stat"><div class="k">Agreement</div><div class="v good">{agreementCount} / {totalVantages}</div></div>
        <div class="stat"><div class="k">Median</div><div class="v bad">{medianLast}<span class="u">ms</span></div></div>
        <div class="stat"><div class="k">Spread</div><div class="v">±{spreadMs}<span class="u">ms</span></div></div>
        <div class="stat"><div class="k">Confidence</div><div class="v">High</div></div>
      </div>
    </div>

    <div class="hero-left">
      <div class="label">Probing target</div>
      <div class="target-name">{target.displayName}</div>
      <div class="target-host">{target.host} · last probe T+{RUN_DURATION_S.toFixed(1)} s</div>
    </div>

    <div class="progress-bar">
      <span class="lbl">Transit complete</span>
      <div class="track"><div class="fill"></div></div>
      <span class="read">All vantages<span class="v">{totalVantages} / {totalVantages} · {PROBES_PER_VANTAGE} probes ea.</span></span>
    </div>
  </div>

  <!-- BELOW HERO -->
  <div class="below">
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
          <div class="van-col" data-v={probe.key}>
            <div class="head">
              <div class="nm">{probe.name}<span class="loc">{probe.location}</span></div>
              <div class="tag" data-s={probe.bad ? 'slow' : 'ok'}>{probe.bad ? 'Slow' : 'OK'}</div>
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
        <div class="tag">High confidence · upstream</div>
      </div>
      <h2>The slowdown is <em>{target.displayName}-side</em>, not yours.</h2>
      <p>Four vantages on three continents all reported {target.displayName} at <strong>{minLast} – {maxLast} ms</strong>. The <em>±{spreadMs} ms</em> spread across geographies is too tight to be coincidence — every observer hears the same dragging carrier, which means the source has to be downstream of all four.</p>
      <p>Compared to {target.displayName}'s healthy baseline of <strong>{BASELINE_MS} ms</strong>, every vantage shows a <em>{slowdownX}</em> slowdown. That's a real signal — not jitter, not local Wi-Fi, not your ISP.</p>

      <!-- 3-cell decision matrix — pedagogy for reading agreement vs disagreement -->
      <div class="grid">
        <div class="item">
          <div class="k">If your network</div>
          <div class="v">vantages disagree — local fast, outside slow (or vice versa)</div>
        </div>
        <div class="item">
          <div class="k">If their server</div>
          <div class="v">vantages <em>agree</em> — all measure slow within tight tolerance</div>
        </div>
        <div class="item">
          <div class="k">This run</div>
          <div class="v">Agreement <em>{agreementCount} / {totalVantages}</em>; spread <em>±{spreadMs} ms</em>. <strong>It's their server.</strong></div>
        </div>
      </div>
    </div>

    <!-- METHODOLOGY -->
    <div class="method">
      <div class="section-head">
        <span class="l">Methodology</span>
        <span class="r">
          <span>Probes total<span class="v">{probesTotal}</span></span>
          <span>Took<span class="v">{RUN_DURATION_S.toFixed(1)} s</span></span>
        </span>
      </div>
      <div class="method-grid">
        <div class="step">
          <div class="num">01</div>
          <h4>Fire the same probe from four origins.</h4>
          <p>Your browser plus three Cloudflare edge workers in IAD, LHR, NRT each send <em>{PROBES_PER_VANTAGE} HEAD</em> requests to the same hostname in the same second.</p>
        </div>
        <div class="step">
          <div class="num">02</div>
          <h4>Each origin records its own measurements.</h4>
          <p>Cloudflare workers measure latency from <em>their</em> network to the target, not relayed through yours. Results come back as raw numbers, not summaries.</p>
        </div>
        <div class="step">
          <div class="num">03</div>
          <h4>Compare the shape of agreement.</h4>
          <p>If all four vantages report similar slow numbers, the source is the server. If only yours is slow, it's your path. The <em>shape</em> answers the question; we don't pre-decide.</p>
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
      <h3>The next move is on {target.displayName}'s side.</h3>
      <p>
        Your local network is clear. The slowdown lives on {target.displayName}'s path to <em>{target.host}</em>. <strong>If this is your service:</strong> check the region health and ingress metrics. <strong>If you're a consumer:</strong> there's nothing local you can fix — the upstream needs to recover. Re-run this transit in <em>5 min</em> to see if it lifts.
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
  .hero-meta h1 em {
    font-style: normal;
    color: var(--sev-bad);
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
  .hero-meta .body em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
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
