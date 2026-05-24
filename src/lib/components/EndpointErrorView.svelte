<!-- src/lib/components/EndpointErrorView.svelte -->
<!-- Vessel v4 Endpoint *carrier-lost* surface — translates the markup of
     proposals/v4/proposal-error-v4.html into Svelte. Rendered conditionally
     from EndpointView when the focused endpoint trips the carrier-lost
     heuristic: 5+ non-ok samples in the last 10 AND lastStatus is non-ok.

     Sections (in markup order):
       • Hero stage (orbital + danger tint + breadcrumb + alarm banner)
       • Hero meta (right) — title, body, missed/last-seen/field-intact stats
       • Hero left — station identification with strike-through animation
       • Outage bar — active outage timeline, primary actions
       • Below: pattern classification (transient/intermittent/sustained — the
         third is highlighted as "this run")
       • Carrier history (this session) — outage log
       • Recovery guidance — checklist + actions

     OrbitalScene runs with null-padded stationData for the focused station,
     so missed pulses naturally don't render (per HANDOFF: shader-rendered
     gap regions are a future enhancement; we approximate by absence). -->
<script lang="ts">
  import { measurementStore } from '$lib/stores/measurements';
  import { statisticsStore } from '$lib/stores/statistics';
  import { settingsStore } from '$lib/stores/settings';
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { uiStore } from '$lib/stores/ui';
  import { tokens } from '$lib/tokens';
  import { navigateTo } from '$lib/router';
  import type { MeasurementSample } from '$lib/types';
  import OrbitalScene, { type OrbitalStation, type OrbitalGap, type LastGoodMarker } from './OrbitalScene.svelte';

  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const stats = $derived($statisticsStore);
  const settings = $derived($settingsStore);
  const threshold = $derived(settings.healthThreshold);
  const focusedId = $derived($uiStore.focusedEndpointId);

  // ── Station mapping ───────────────────────────────────────────────────────
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
        // For the failed station, leave failed slots as null so OrbitalScene
        // naturally produces visual "gaps" where pulses should have been.
        buf[offset + i] = s.status === 'ok' ? s.latency : null;
      }
      out[id] = buf;
    }
    return out;
  });

  const focusedStation = $derived<string | null>(
    focusedId === null ? null : (epToStation[focusedId] ?? null),
  );

  // Walk the focused station's windowed buffer for contiguous runs of null
  // slots, emit each as a gap arc. The arc spans the angular range covered
  // by the slot indices; OrbitalScene's ring shader renders these as
  // crimson arcs over the orbit.
  function slotAngle(slot: number, total: number): number {
    return -Math.PI / 2 + (slot / total) * Math.PI * 2;
  }
  const focusedGapRegions = $derived<readonly OrbitalGap[]>((() => {
    const fs = focusedStation;
    if (fs === null) return [];
    const data = stationData[fs];
    if (!data) return [];
    const halfSlot = (Math.PI * 2) / WINDOW / 2;
    const out: OrbitalGap[] = [];
    let runStart = -1;
    for (let i = 0; i <= WINDOW; i++) {
      const missed = i < WINDOW && data[i] === null;
      if (missed && runStart < 0) {
        runStart = i;
      } else if (!missed && runStart >= 0) {
        const startAngle = slotAngle(runStart, WINDOW) - halfSlot;
        const endAngle   = slotAngle(i - 1, WINDOW) + halfSlot;
        out.push({ stationId: fs, startAngle, endAngle });
        runStart = -1;
        if (out.length >= 8) break; // shader uniform cap
      }
    }
    return out;
  })());


  // ── Focused endpoint metadata ─────────────────────────────────────────────
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
  const focusedMeas = $derived(focusedEndpoint ? measurements.endpoints[focusedEndpoint.id] : undefined);
  const focusedStats = $derived(focusedEndpoint ? stats[focusedEndpoint.id] : undefined);

  // ── Carrier-lost outage analysis ──────────────────────────────────────────
  const focusedSamples = $derived<readonly MeasurementSample[]>(focusedMeas?.samples.toArray() ?? []);
  const lastTen = $derived<readonly MeasurementSample[]>(focusedSamples.slice(-10));
  const missedInLastTen = $derived<number>(lastTen.filter((s) => s.status !== 'ok').length);
  const lastTenTotal = $derived<number>(lastTen.length);
  const fieldIntact = $derived<number>((() => {
    // Count of stations (out of 4) whose lastStatus is 'ok'.
    let n = 0;
    for (const ep of monitored.slice(0, 4)) {
      const m = measurements.endpoints[ep.id];
      if (m && m.lastStatus === 'ok') n++;
    }
    return n;
  })());
  const fieldTotal = $derived<number>(Math.min(4, monitored.length));

  // Find the round of the last successful sample before the current outage.
  // We walk backwards from the most recent sample, skipping the contiguous
  // tail of non-ok samples; the next 'ok' encountered is the last good pulse.
  interface LastGood {
    readonly round: number;
    readonly latency: number;
    readonly at: number;
  }
  const lastGood = $derived<LastGood | null>((() => {
    let sawFailureTail = false;
    for (let i = focusedSamples.length - 1; i >= 0; i--) {
      const s = focusedSamples[i];
      if (s.status !== 'ok') {
        sawFailureTail = true;
        continue;
      }
      if (sawFailureTail) {
        return { round: s.round, latency: s.latency, at: s.timestamp };
      }
      // First sample we saw was ok — no outage tail; bail.
      return null;
    }
    return null;
  })());

  // Last-known-good marker — green sphere on the focused station's orbit at
  // the angular slot of the last successful round. Requires lastGood to be
  // within the current 60-round window; if older, no marker is shown.
  const focusedLastGoodMarker = $derived<LastGoodMarker | null>((() => {
    const fs = focusedStation;
    if (fs === null || !lastGood || focusedSamples.length === 0) return null;
    const mostRecent = focusedSamples[focusedSamples.length - 1];
    const roundsAgo = mostRecent.round - lastGood.round;
    if (roundsAgo < 0 || roundsAgo >= WINDOW) return null;
    const slotIdx = WINDOW - 1 - roundsAgo;
    return { stationId: fs, angle: slotAngle(slotIdx, WINDOW) };
  })());

  // Outage duration — time since the FIRST contiguous non-ok sample in the tail.
  const outageStart = $derived<number | null>((() => {
    let start: number | null = null;
    for (let i = focusedSamples.length - 1; i >= 0; i--) {
      const s = focusedSamples[i];
      if (s.status !== 'ok') {
        start = s.timestamp;
      } else {
        break;
      }
    }
    return start;
  })());
  const outageDurationMs = $derived<number>(outageStart === null ? 0 : Math.max(0, Date.now() - outageStart));

  function fmtRelTime(at: number | null): string {
    if (at === null || !measurements.startedAt) return 'T+00:00';
    const total = Math.max(0, Math.floor((at - measurements.startedAt) / 1000));
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `T+${mm}:${ss}`;
  }
  function fmtDuration(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return `${mm}:${ss} s`;
  }
  function fmtSecondsAgo(ms: number): number {
    return Math.max(0, Math.floor(ms / 1000));
  }

  const lastSeenAgoMs = $derived<number>(
    lastGood === null ? 0 : Math.max(0, Date.now() - lastGood.at),
  );

  const lastAttempt = $derived<MeasurementSample | null>(
    focusedSamples.length === 0 ? null : focusedSamples[focusedSamples.length - 1],
  );

  // ── Outage timeline · last 60 s ───────────────────────────────────────────
  // Renders a 60-round latency curve with carrier-lost bands and a LAST GOOD
  // marker. Segments break across missing samples so the curve doesn't span
  // outage gaps. Geometry mirrors the v4 prototype (proposal-error-v4.html).
  const TIMELINE_WINDOW = 60;
  interface TimelineSegment {
    readonly d: string;
  }
  interface TimelineDot {
    readonly cx: number;
    readonly cy: number;
    readonly missed: boolean;
  }
  interface TimelineBand {
    readonly x: number;
    readonly w: number;
  }
  interface TimelineLayout {
    readonly W: number;
    readonly H: number;
    readonly padX: number;
    readonly padY: number;
    readonly innerW: number;
    readonly innerH: number;
    readonly slot: number;
    readonly maxV: number;
    readonly triggerY: number;
    readonly refLines: readonly { readonly y: number; readonly v: number }[];
    readonly bands: readonly TimelineBand[];
    readonly segments: readonly TimelineSegment[];
    readonly dots: readonly TimelineDot[];
    readonly lastGoodX: number | null;
  }
  const timeline = $derived<TimelineLayout>((() => {
    const W = 1000;
    const H = 170;
    const padX = 14;
    const padY = 14;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;
    const N = TIMELINE_WINDOW;
    const slot = innerW / N;
    const maxV = 200;
    const triggerY = padY + innerH - (Math.min(threshold, maxV) / maxV) * innerH;
    const refLines = [25, 50, 75, 100].map((v) => ({
      y: padY + innerH - (v / maxV) * innerH,
      v,
    }));

    // Right-align the window — most recent sample sits at slot N-1.
    const tail = focusedSamples.slice(-N);
    const offset = N - tail.length;
    const slots: (MeasurementSample | null)[] = new Array(N).fill(null);
    for (let i = 0; i < tail.length; i++) slots[offset + i] = tail[i];

    // CARRIER LOST bands — contiguous runs of missing slots (within data range).
    const bands: TimelineBand[] = [];
    let runStart = -1;
    for (let i = 0; i <= N; i++) {
      const s = i < N ? slots[i] : null;
      const missed = i < N && i >= offset && (s === null || s.status !== 'ok');
      if (missed && runStart < 0) runStart = i;
      else if (!missed && runStart >= 0) {
        const x = padX + runStart * slot;
        const w = (i - runStart) * slot;
        bands.push({ x, w });
        runStart = -1;
      }
    }

    // Curve segments — break across missing samples.
    const segments: TimelineSegment[] = [];
    const dots: TimelineDot[] = [];
    let current = '';
    let started = false;
    for (let i = 0; i < N; i++) {
      const s = slots[i];
      const x = padX + i * slot + slot / 2;
      if (s === null || s.status !== 'ok') {
        if (started && current) segments.push({ d: current });
        current = '';
        started = false;
        if (s !== null) {
          // Within data range — render a gap-marker dot at baseline.
          const y = padY + innerH - 8;
          dots.push({ cx: x, cy: y, missed: true });
        }
        continue;
      }
      const y = padY + innerH - (Math.min(s.latency, maxV) / maxV) * innerH;
      current += (started ? ' L ' : 'M ') + x.toFixed(2) + ' ' + y.toFixed(2);
      started = true;
      dots.push({ cx: x, cy: y, missed: false });
    }
    if (started && current) segments.push({ d: current });

    // LAST GOOD marker — position from lastGood.round relative to most recent.
    let lastGoodX: number | null = null;
    if (lastGood !== null && focusedSamples.length > 0) {
      const mostRecentRound = focusedSamples[focusedSamples.length - 1].round;
      const slotIdx = N - 1 - (mostRecentRound - lastGood.round);
      if (slotIdx >= 0 && slotIdx < N) {
        lastGoodX = padX + (slotIdx + 1) * slot;
      }
    }

    return {
      W, H, padX, padY, innerW, innerH, slot, maxV,
      triggerY, refLines, bands, segments, dots, lastGoodX,
    };
  })());

  // ── Outage history (this session, this station) ───────────────────────────
  // Walks the sample buffer and groups contiguous runs of non-ok samples
  // into outage entries: { startAt, endAt|null, missed, type }
  interface OutageEntry {
    readonly id: string;
    readonly startAt: number;
    readonly endAt: number | null;       // null = still active
    readonly missed: number;
    readonly type: 'transient' | 'intermittent' | 'sustained';
    readonly endRound: number | null;     // recovered-at round (if any)
    readonly recoveredLatency: number | null;
  }
  const history = $derived<readonly OutageEntry[]>((() => {
    const out: OutageEntry[] = [];
    const arr = focusedSamples;
    let i = 0;
    while (i < arr.length) {
      if (arr[i].status === 'ok') { i++; continue; }
      const startAt = arr[i].timestamp;
      let missed = 0;
      while (i < arr.length && arr[i].status !== 'ok') {
        missed++;
        i++;
      }
      const recovered: MeasurementSample | null = i < arr.length ? arr[i] : null;
      const type: OutageEntry['type'] =
        missed >= 5 ? 'sustained' : missed >= 2 ? 'intermittent' : 'transient';
      out.push({
        id: `${startAt}-${missed}`,
        startAt,
        endAt: recovered === null ? null : recovered.timestamp,
        missed,
        type,
        endRound: recovered?.round ?? null,
        recoveredLatency: recovered?.latency ?? null,
      });
    }
    // Most recent first
    return out.slice().reverse();
  })());

  const totalOutages = $derived<number>(history.length);
  const recoveriesCount = $derived<number>(history.filter((h) => h.endAt !== null).length);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function backToLive(): void {
    navigateTo({ name: 'live', endpointId: null });
  }
  function openInvestigate(): void {
    navigateTo({ name: 'investigate', endpointId: null });
  }
</script>

<section class="error-surface" aria-label="Carrier lost — focused station outage">
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
          gapRegions={focusedGapRegions}
          stationLabels={stationLabelsForScene}
          lastGoodMarker={focusedLastGoodMarker}
          currentRound={measurements.roundCounter}
          cadenceMs={settings.monitorDelay}
        />
      {/if}
    </div>
    <div class="danger-tint" aria-hidden="true"></div>

    <div class="breadcrumb">
      <div class="crumb">
        <button type="button" class="crumb-link" onclick={backToLive}>← Station / {focusedEndpoint?.label ?? '—'}</button>
        <span class="sep">/</span>
        <span class="current">Carrier lost</span>
      </div>
      <div class="meta">
        <span>Status<span class="v">Outage active</span></span>
        <span>Missed<span class="v">{missedInLastTen} / {lastTenTotal}</span></span>
        <span>Duration<span class="v">{fmtDuration(outageDurationMs)}</span></span>
      </div>
    </div>

    <div class="alarm-banner" role="status" aria-live="polite">
      <span class="pip"></span>
      <span>Carrier lost · sustained outage detected</span>
    </div>

    <div class="hero-meta">
      <div class="kicker"><span class="pip"></span><span>Carrier-lost · § alarm</span></div>
      <div class="pre-title">Station<span class="v">{focusedEndpoint?.label ?? '—'} · {focusedHost || '—'}</span></div>
      <h1>The carrier went <em>dark</em>.</h1>
      <p class="body">
        <strong>{focusedEndpoint?.label ?? 'This station'} has missed <em>{missedInLastTen} of the last {lastTenTotal}</em> rounds.</strong>
        {#if fieldIntact > 0}
          {#if fieldIntact === fieldTotal - 1}
            The other {fieldTotal - 1} stations held tempo without interruption — so the silence isn't local.
          {:else if fieldIntact > 0}
            {fieldIntact} of {fieldTotal} stations are still on transit — so the silence isn't local.
          {/if}
        {/if}
        The path between this browser and {focusedHost || 'this endpoint'} has stopped responding for <em>{fmtSecondsAgo(outageDurationMs)} seconds</em>.
      </p>
      <div class="stats">
        <div class="stat">
          <div class="k">Missed</div>
          <div class="v crit">{missedInLastTen} / {lastTenTotal}</div>
        </div>
        <div class="stat">
          <div class="k">Last seen</div>
          <div class="v">
            {#if lastGood === null}—{:else}{fmtSecondsAgo(lastSeenAgoMs)}<span class="u">s ago</span>{/if}
          </div>
        </div>
        <div class="stat">
          <div class="k">Field intact</div>
          <div class="v">{fieldIntact} / {fieldTotal}</div>
        </div>
      </div>
    </div>

    <div class="hero-left">
      <div class="label">Station identification</div>
      <div class="station-name">{focusedEndpoint?.label ?? '—'}</div>
      <div class="station-host">
        {focusedHost || '—'}
        {#if lastGood !== null} · last good pulse round {lastGood.round}{/if}
      </div>
      <div class="last-good">
        Last good<span class="v">
          {#if lastGood === null}—{:else}{Math.round(lastGood.latency)} ms · {fmtRelTime(lastGood.at)}{/if}
        </span>
      </div>
    </div>

    <div class="outage-bar">
      <span class="lbl"><span class="pip"></span>Outage active</span>
      <div class="meta">
        <span>Started<span class="v">{fmtRelTime(outageStart)}</span></span>
        <span>Duration<span class="v">{fmtDuration(outageDurationMs)}</span></span>
        <span>Last attempt<span class="v">
          {#if lastAttempt === null}—
          {:else if lastAttempt.status === 'timeout'}timeout · {settings.timeout} ms
          {:else if lastAttempt.status === 'error'}error{#if lastAttempt.errorMessage} · {lastAttempt.errorMessage}{/if}
          {:else}{Math.round(lastAttempt.latency)} ms
          {/if}
        </span></span>
      </div>
      <div class="actions">
        <button type="button" class="primary" onclick={backToLive}>Re-establish probe</button>
        <button type="button" onclick={openInvestigate}>Run outside transit</button>
      </div>
    </div>
  </div>

  <!-- BELOW HERO -->
  <div class="below">

    <!-- OUTAGE TIMELINE -->
    <div class="timeline-section">
      <div class="section-head">
        <span class="l">Outage timeline · last 60 s</span>
        <span class="r">
          <span>Cadence<span class="v">{(settings.monitorDelay / 1000).toFixed(0)} s</span></span>
          <span>Window<span class="v">{TIMELINE_WINDOW} rounds</span></span>
        </span>
      </div>
      <div class="timeline-chart">
        <svg viewBox="0 0 {timeline.W} {timeline.H}" preserveAspectRatio="none" aria-label="Carrier latency timeline · last 60 rounds">
          <!-- Reference grid lines + labels -->
          {#each timeline.refLines as ref (ref.v)}
            <line
              x1={timeline.padX}
              y1={ref.y.toFixed(2)}
              x2={timeline.W - timeline.padX}
              y2={ref.y.toFixed(2)}
              stroke="var(--fg)"
              stroke-opacity="0.04"
              stroke-width="0.5"
            />
            <text x={timeline.padX + 4} y={(ref.y - 2).toFixed(2)} class="timeline-ref-text">{ref.v} ms</text>
          {/each}

          <!-- TRIGGER threshold line -->
          <line
            x1={timeline.padX}
            y1={timeline.triggerY.toFixed(2)}
            x2={timeline.W - timeline.padX}
            y2={timeline.triggerY.toFixed(2)}
            stroke="var(--sev-bad)"
            stroke-opacity="0.4"
            stroke-dasharray="3 4"
            stroke-width="0.8"
          />
          <text
            x={timeline.W - timeline.padX - 2}
            y={(timeline.triggerY - 4).toFixed(2)}
            class="timeline-trigger-text"
            text-anchor="end"
          >TRIGGER {threshold} ms</text>

          <!-- CARRIER LOST bands -->
          {#each timeline.bands as band, i (i)}
            <rect
              x={band.x.toFixed(2)}
              y={timeline.padY}
              width={band.w.toFixed(2)}
              height={timeline.innerH}
              fill="var(--sev-crit)"
              fill-opacity="0.05"
              stroke="var(--sev-crit)"
              stroke-opacity="0.4"
              stroke-width="0.5"
              stroke-dasharray="2 3"
            />
            {#if i === 0}
              <text
                x={(band.x + 6).toFixed(2)}
                y={(timeline.padY + 12).toFixed(2)}
                class="timeline-band-text"
              >CARRIER LOST</text>
            {/if}
          {/each}

          <!-- Latency curve (glow + crisp pass, segmented across gaps) -->
          {#each timeline.segments as seg, i (i)}
            <path d={seg.d} stroke="var(--station-d)" stroke-width="3.5" stroke-opacity="0.18" fill="none" stroke-linejoin="round" stroke-linecap="round" />
            <path d={seg.d} stroke="var(--station-d)" stroke-width="1.1" stroke-opacity="0.92" fill="none" stroke-linejoin="round" stroke-linecap="round" />
          {/each}

          <!-- Sample dots + gap markers -->
          {#each timeline.dots as dot, i (i)}
            {#if dot.missed}
              <line x1={(dot.cx - 2.5).toFixed(2)} y1={(dot.cy - 2.5).toFixed(2)} x2={(dot.cx + 2.5).toFixed(2)} y2={(dot.cy + 2.5).toFixed(2)} stroke="var(--sev-crit)" stroke-width="1" stroke-opacity="0.85" />
              <line x1={(dot.cx + 2.5).toFixed(2)} y1={(dot.cy - 2.5).toFixed(2)} x2={(dot.cx - 2.5).toFixed(2)} y2={(dot.cy + 2.5).toFixed(2)} stroke="var(--sev-crit)" stroke-width="1" stroke-opacity="0.85" />
            {:else}
              <circle cx={dot.cx.toFixed(2)} cy={dot.cy.toFixed(2)} r="2.2" fill="var(--station-d)" fill-opacity="0.32" />
              <circle cx={dot.cx.toFixed(2)} cy={dot.cy.toFixed(2)} r="1" fill="var(--station-d)" />
            {/if}
          {/each}

          <!-- LAST GOOD marker -->
          {#if timeline.lastGoodX !== null}
            <line
              x1={timeline.lastGoodX.toFixed(2)}
              y1={timeline.padY}
              x2={timeline.lastGoodX.toFixed(2)}
              y2={(timeline.padY + timeline.innerH).toFixed(2)}
              stroke="var(--station-b)"
              stroke-width="1"
              stroke-opacity="0.7"
            />
            <text
              x={(timeline.lastGoodX - 4).toFixed(2)}
              y={(timeline.padY + timeline.innerH - 8).toFixed(2)}
              class="timeline-lastgood-text"
              text-anchor="end"
            >LAST GOOD ↓</text>
          {/if}
        </svg>
      </div>
      <div class="timeline-axis">
        <span>T−60 s</span>
        <span>T−45 s</span>
        <span>T−30 s</span>
        <span class="crit">T−15 s ↓ carrier lost</span>
        <span>NOW · T+00</span>
      </div>
    </div>

    <!-- PATTERN CLASSIFICATION -->
    <div class="classification">
      <div class="section-head">
        <span class="l">Pattern classification</span>
        <span class="r"><span>Threshold<span class="v">5 / 10 missed</span></span></span>
      </div>
      <div class="class-grid">
        <div class="class-card">
          <span class="tag">If transient</span>
          <h4>One missed beat, recovers on the next round.</h4>
          <div class="pattern" aria-label="Transient pattern">
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="gap-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
          </div>
          <p class="desc">A single dropped pulse with the carrier resumed immediately. Common during <em>BGP convergence</em> or <em>TCP retransmits</em>. Logged for context; no action required.</p>
        </div>

        <div class="class-card">
          <span class="tag">If intermittent</span>
          <h4>Dropouts every few rounds, with partial recovery.</h4>
          <div class="pattern" aria-label="Intermittent pattern">
            <span class="pulse-mark"></span>
            <span class="gap-mark"></span>
            <span class="pulse-mark"></span>
            <span class="gap-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="gap-mark"></span>
            <span class="pulse-mark"></span>
            <span class="gap-mark"></span>
            <span class="pulse-mark"></span>
          </div>
          <p class="desc">Several missed pulses interleaved with successes. Often indicates <em>congested upstream</em> or <em>load-balancer flapping</em>. Worth watching; may resolve in one window.</p>
        </div>

        <div class="class-card is-this">
          <span class="tag">This run · sustained</span>
          <h4>Carrier gone dark and not returning.</h4>
          <div class="pattern" aria-label="Sustained pattern">
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="pulse-mark"></span>
            <span class="gap-mark"></span>
            <span class="gap-mark"></span>
            <span class="gap-mark"></span>
            <span class="gap-mark"></span>
            <span class="gap-mark"></span>
            <span class="gap-mark"></span>
            <span class="gap-mark"></span>
          </div>
          <p class="desc"><strong>Five or more consecutive missed pulses.</strong> Strong signal of a real outage — DNS, routing, or upstream service down. Worth escalating; will not self-resolve.</p>
        </div>
      </div>
    </div>

    <!-- HISTORICAL OUTAGES (this session) -->
    <div class="history-section">
      <div class="section-head">
        <span class="l">Carrier history · this session</span>
        <span class="r">
          <span>Outages<span class="v">{totalOutages}</span></span>
          <span>Recoveries<span class="v">{recoveriesCount}</span></span>
        </span>
      </div>
      <div class="history-list">
        {#if history.length === 0}
          <div class="history-row">
            <span class="t">—</span>
            <span class="type" data-t="recovered">No outages yet</span>
            <span class="b">No carrier loss has been recorded for this station in the current session.</span>
            <span class="dur"></span>
            <span class="verdict"></span>
          </div>
        {:else}
          {#each history as entry (entry.id)}
            <div class="history-row">
              <span class="t">{fmtRelTime(entry.startAt)}</span>
              <span class="type" data-t={entry.type}>
                {#if entry.type === 'sustained'}Sustained
                {:else if entry.type === 'intermittent'}Intermittent
                {:else}Transient
                {/if}
              </span>
              <span class="b">
                {#if entry.endAt === null}
                  <strong>Current outage.</strong> Carrier dropped after round
                  {#if lastGood !== null}<em>{lastGood.round}</em>{:else}<em>—</em>{/if};
                  <em>{missedInLastTen} of {lastTenTotal}</em> recent rounds missed.
                {:else if entry.missed === 1}
                  Single missed pulse;
                  {#if entry.recoveredLatency !== null}recovered at <em>{Math.round(entry.recoveredLatency)} ms</em>{:else}recovered{/if}{#if entry.endRound !== null} on round {entry.endRound}{/if}.
                {:else}
                  {entry.missed} missed pulses;
                  {#if entry.recoveredLatency !== null}recovered to <em>{Math.round(entry.recoveredLatency)} ms</em>{:else}recovered{/if}{#if entry.endRound !== null} on round {entry.endRound}{/if}.
                {/if}
              </span>
              <span class="dur">
                <span class="k">For</span>
                {#if entry.endAt === null}
                  {fmtDuration(Math.max(0, Date.now() - entry.startAt))}
                {:else}
                  {fmtDuration(entry.endAt - entry.startAt)}
                {/if}
              </span>
              <span class="verdict">
                {#if entry.endAt === null}Active{:else}Recovered{/if}
              </span>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- RECOVERY GUIDANCE -->
    <div class="recovery">
      <div class="head">
        <span class="k">Recovery guidance · § action</span>
        <span class="tag">Sustained · escalate likely</span>
      </div>
      <h3>This won't <em>self-resolve</em>. The next move is escalation.</h3>
      <p>
        Five consecutive missed pulses puts this in the sustained-outage band — historical recovery probability drops below <em>15%</em> without external action.
        {#if fieldIntact === fieldTotal - 1}
          The other {fieldTotal - 1} stations are healthy, so the diagnosis is endpoint-isolated to <em>{focusedHost || (focusedEndpoint?.label ?? 'this endpoint')}</em>.
        {:else if fieldIntact > 0}
          {fieldIntact} of {fieldTotal} carriers are still up, so the silence is endpoint-isolated to <em>{focusedHost || (focusedEndpoint?.label ?? 'this endpoint')}</em>.
        {:else}
          No other station has reported a successful pulse in this window — the failure may be field-wide.
        {/if}
      </p>
      <p>
        Recommended sequence: <strong>(1) run an outside transit</strong> to confirm the outage is global, not local; <strong>(2) check the upstream provider's status page</strong> for an acknowledged incident; <strong>(3) if both confirm</strong>, mute this station to clear the alarm and switch the diagnostic focus to the remaining {Math.max(0, fieldTotal - 1)}.
      </p>

      <div class="checklist">
        <div class="item">
          <div class="k">Estimated recovery</div>
          <div class="v">No prediction — sustained pattern with no upstream signal of imminent recovery.</div>
        </div>
        <div class="item">
          <div class="k">Likely root cause</div>
          <div class="v">DNS misconfiguration · upstream routing failure · or service-side incident on <em>{focusedHost || '—'}</em>.</div>
        </div>
        <div class="item">
          <div class="k">What this rules out</div>
          <div class="v">
            {#if fieldIntact >= fieldTotal - 1}
              <em>Your network</em> — the other carriers held throughout. <em>Local DNS</em> — peer stations resolved fine.
            {:else if fieldIntact > 0}
              <em>Total network loss</em> — {fieldIntact} carriers are still passing pulses.
            {:else}
              Inconclusive — no peer station has a recent successful pulse to compare against.
            {/if}
          </div>
        </div>
        <div class="item">
          <div class="k">What this might be</div>
          <div class="v">A regional POP outage · a routing change at the carrier · a service-wide incident at <em>{focusedHost || '—'}</em>.</div>
        </div>
      </div>

      <div class="row">
        <button type="button" class="primary" onclick={openInvestigate}>Run outside transit →</button>
        <button type="button" class="ghost" onclick={backToLive}>Back to Live tracker</button>
      </div>
    </div>

  </div>

  <!-- Sample-count fallback footer — keeps the count honest when buffers are short -->
  {#if focusedStats && !focusedStats.ready}
    <div class="below-foot" aria-hidden="true"></div>
  {/if}
</section>

<style>
  /* ── Surface root ─────────────────────────────────────────────────────────── */
  .error-surface {
    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.55;
    display: block;
  }

  /* ── HERO STAGE ───────────────────────────────────────────────────────────── */
  .stage {
    position: relative;
    height: 100vh;
    min-height: 780px;
    background: var(--bg);
    overflow: hidden;
  }
  .stage-canvas {
    position: absolute;
    inset: 0;
  }
  /* Subtle oxblood tint on edges to signal danger */
  .danger-tint {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    background: radial-gradient(
      ellipse at center,
      transparent 60%,
      color-mix(in srgb, var(--sev-crit) 12%, transparent) 100%
    );
    mix-blend-mode: screen;
  }

  /* ── BREADCRUMB ───────────────────────────────────────────────────────────── */
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
    background: color-mix(in srgb, var(--bg) 45%, transparent);
    border-bottom: 1px solid var(--rule);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    font-weight: 700;
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
    color: var(--sev-crit);
    text-shadow: 0 0 8px color-mix(in srgb, var(--sev-crit) 60%, transparent);
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

  /* ── ALARM BANNER (center top) ────────────────────────────────────────────── */
  .alarm-banner {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    padding: 10px 20px;
    border: 1px solid var(--sev-crit);
    background: color-mix(in srgb, var(--sev-crit) 8%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--sev-crit);
    font-weight: 700;
    box-shadow: 0 0 24px color-mix(in srgb, var(--sev-crit) 18%, transparent);
  }
  .alarm-banner .pip {
    width: 7px;
    height: 7px;
    background: var(--sev-crit);
    box-shadow: 0 0 10px var(--sev-crit);
    animation: alarmpulse 800ms ease-in-out infinite;
  }
  @keyframes alarmpulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.55; transform: scale(0.7); }
  }

  /* ── HERO META (right side) ───────────────────────────────────────────────── */
  .hero-meta {
    position: absolute;
    right: clamp(20px, 3vw, 48px);
    top: 52%;
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
    background: var(--sev-crit);
    box-shadow: 0 0 10px var(--sev-crit);
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
    color: var(--station-d);
    margin-left: 6px;
  }
  .hero-meta h1 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(48px, 5.6vw, 84px);
    letter-spacing: -0.03em;
    line-height: 1.0;
    color: var(--fg);
    margin: 0 0 24px auto;
    max-width: 14ch;
    text-shadow: 0 0 60px color-mix(in srgb, var(--sev-crit) 18%, transparent);
  }
  .hero-meta h1 em {
    font-style: normal;
    color: var(--sev-crit);
    font-weight: 200;
  }
  .hero-meta .body {
    font-size: 16px;
    color: var(--fg-2);
    line-height: 1.5;
    max-width: 48ch;
    margin: 0 0 32px auto;
  }
  .hero-meta .body strong { color: var(--fg); font-weight: 500; }
  .hero-meta .body em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .hero-meta .stats {
    display: grid;
    grid-template-columns: auto auto auto;
    gap: 18px 28px;
    justify-content: end;
  }
  .hero-meta .stats .stat { text-align: right; }
  .hero-meta .stats .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 6px;
    font-weight: 700;
  }
  .hero-meta .stats .v {
    font-family: var(--sans);
    font-weight: 200;
    font-size: 36px;
    color: var(--fg);
    letter-spacing: -0.025em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .hero-meta .stats .v.crit { color: var(--sev-crit); }
  .hero-meta .stats .v .u {
    font-family: var(--mono);
    font-size: 0.32em;
    color: var(--fg-3);
    margin-left: 3px;
    letter-spacing: 0.04em;
    vertical-align: 0.78em;
    display: inline-block;
  }

  /* ── HERO LEFT (station identification + strike-through animation) ────────── */
  .hero-left {
    position: absolute;
    left: clamp(20px, 3vw, 48px);
    bottom: 110px;
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
  .hero-left .station-name {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(48px, 7vw, 108px);
    color: var(--station-d);
    letter-spacing: -0.04em;
    line-height: 0.85;
    text-shadow: 0 0 80px color-mix(in srgb, var(--station-d) 18%, transparent);
    margin-bottom: 10px;
    position: relative;
  }
  /* The strike — 1px crimson line animates across the station name */
  .hero-left .station-name::after {
    content: '';
    position: absolute;
    top: 55%;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--sev-crit);
    box-shadow: 0 0 8px var(--sev-crit);
    transform: scaleX(0);
    transform-origin: left;
    animation: strikeIn 800ms 600ms cubic-bezier(0.16, 0.84, 0.42, 1) forwards;
  }
  @keyframes strikeIn {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  .hero-left .station-host {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--fg-2);
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
  .hero-left .last-good {
    margin-top: 14px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .hero-left .last-good .v {
    color: var(--fg);
    margin-left: 6px;
  }

  /* ── OUTAGE BAR (bottom of hero) ──────────────────────────────────────────── */
  .outage-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    padding: 14px clamp(20px, 3vw, 48px) 16px;
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
    border-top: 1px solid var(--sev-crit);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .outage-bar .lbl {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--sev-crit);
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .outage-bar .lbl .pip {
    width: 6px;
    height: 6px;
    background: var(--sev-crit);
    box-shadow: 0 0 8px var(--sev-crit);
    animation: alarmpulse 800ms ease-in-out infinite;
  }
  .outage-bar .meta {
    display: inline-flex;
    gap: 22px;
    flex-wrap: wrap;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .outage-bar .meta > span { white-space: nowrap; }
  .outage-bar .meta .v {
    color: var(--fg);
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }
  .outage-bar .actions {
    display: inline-flex;
    gap: 10px;
    margin-left: auto;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .outage-bar .actions button {
    border: 1px solid var(--rule-strong);
    padding: 7px 12px;
    color: var(--fg);
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
    background: none;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .outage-bar .actions button:hover {
    background: var(--bg-2);
    border-color: var(--fg-3);
  }
  .outage-bar .actions button:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .outage-bar .actions button.primary {
    background: var(--sev-bad);
    border-color: var(--sev-bad);
    color: var(--bg);
  }
  .outage-bar .actions button.primary:hover {
    background: var(--sev-warn);
    border-color: var(--sev-warn);
  }

  /* ── BELOW HERO ───────────────────────────────────────────────────────────── */
  .below {
    padding: 80px clamp(20px, 3vw, 48px) 96px;
    border-top: 1px solid var(--rule);
    background: linear-gradient(180deg, color-mix(in srgb, var(--bg) 94%, transparent) 0%, var(--bg) 24%);
  }
  .below-foot {
    height: 1px;
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

  /* ── OUTAGE TIMELINE ──────────────────────────────────────────────────────── */
  .timeline-section { margin-bottom: 56px; }
  .timeline-chart {
    position: relative;
    height: 200px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    padding: 14px;
  }
  .timeline-chart svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  .timeline-ref-text {
    font-family: var(--mono);
    font-size: 8px;
    fill: var(--fg-3);
    letter-spacing: 0.05em;
  }
  .timeline-trigger-text {
    font-family: var(--mono);
    font-size: 9px;
    fill: var(--sev-bad);
    letter-spacing: 0.05em;
  }
  .timeline-band-text {
    font-family: var(--mono);
    font-size: 9px;
    fill: var(--sev-crit);
    letter-spacing: 0.12em;
    font-weight: 700;
  }
  .timeline-lastgood-text {
    font-family: var(--mono);
    font-size: 9px;
    fill: var(--station-b);
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .timeline-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.12em;
    font-weight: 700;
  }
  .timeline-axis > span { white-space: nowrap; }
  .timeline-axis .crit { color: var(--sev-crit); }

  /* ── PATTERN CLASSIFICATION ───────────────────────────────────────────────── */
  .classification { margin-bottom: 56px; }
  .class-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .class-card {
    background: var(--bg);
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: relative;
  }
  .class-card.is-this::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--sev-crit);
    box-shadow: 0 0 12px var(--sev-crit);
  }
  .class-card .tag {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .class-card.is-this .tag { color: var(--sev-crit); }
  .class-card h4 {
    font-family: var(--sans);
    font-weight: 300;
    font-size: 22px;
    letter-spacing: -0.015em;
    line-height: 1.15;
    color: var(--fg);
    max-width: 22ch;
  }
  .class-card .pattern {
    height: 48px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 0;
  }
  .class-card .pattern .pulse-mark {
    width: 6px;
    height: 32px;
    flex: 0 0 6px;
    background: var(--station-d);
    box-shadow: 0 0 8px var(--station-d);
    border-radius: 1px;
  }
  .class-card .pattern .gap-mark {
    width: 6px;
    height: 8px;
    flex: 0 0 6px;
    background: var(--sev-crit);
    box-shadow: 0 0 8px var(--sev-crit);
    border-radius: 1px;
    align-self: center;
    opacity: 0.5;
  }
  .class-card .desc {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.55;
    flex-grow: 1;
  }
  .class-card .desc em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .class-card .desc strong {
    color: var(--fg);
    font-weight: 500;
  }

  /* ── HISTORICAL OUTAGES ───────────────────────────────────────────────────── */
  .history-section { margin-bottom: 56px; }
  .history-list { border-top: 1px solid var(--rule); }
  .history-row {
    display: grid;
    grid-template-columns: 90px auto 1fr auto auto;
    gap: 18px;
    padding: 14px 0;
    align-items: baseline;
    border-bottom: 1px solid var(--rule-faint);
    font-size: 13px;
  }
  .history-row .t {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    white-space: nowrap;
    font-weight: 700;
  }
  .history-row .type {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    padding: 3px 8px;
    border: 1px solid var(--rule-strong);
    color: var(--fg-3);
    font-weight: 700;
    white-space: nowrap;
  }
  .history-row .type[data-t="sustained"] {
    color: var(--sev-crit);
    border-color: var(--sev-crit);
  }
  .history-row .type[data-t="intermittent"] {
    color: var(--sev-warn);
    border-color: var(--sev-warn);
  }
  .history-row .type[data-t="transient"] {
    color: var(--sev-warn);
    border-color: var(--sev-warn);
  }
  .history-row .type[data-t="recovered"] {
    color: var(--station-b);
    border-color: var(--station-b);
  }
  .history-row .b {
    color: var(--fg-2);
    line-height: 1.45;
  }
  .history-row .b strong { color: var(--fg); font-weight: 500; }
  .history-row .b em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .history-row .dur {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    font-weight: 700;
  }
  .history-row .dur .k {
    color: var(--fg-3);
    margin-right: 4px;
  }
  .history-row .verdict {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    white-space: nowrap;
    font-weight: 700;
  }

  /* ── RECOVERY GUIDANCE ────────────────────────────────────────────────────── */
  .recovery {
    padding: 36px;
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    position: relative;
  }
  .recovery::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 32px;
    height: 1px;
    background: var(--sev-crit);
    box-shadow: 0 0 12px var(--sev-crit);
  }
  .recovery .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 20px;
    margin-bottom: 22px;
    flex-wrap: wrap;
  }
  .recovery .head .k {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .recovery .head .tag {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--sev-crit);
    padding: 5px 10px;
    border: 1px solid var(--sev-crit);
    font-weight: 700;
  }
  .recovery h3 {
    font-family: var(--sans);
    font-size: 32px;
    font-weight: 300;
    color: var(--fg);
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin-bottom: 18px;
    max-width: 30ch;
  }
  .recovery h3 em {
    font-style: normal;
    color: var(--sev-crit);
    font-weight: 300;
  }
  .recovery p {
    font-size: 15px;
    color: var(--fg-2);
    line-height: 1.55;
    margin-bottom: 14px;
    max-width: 58ch;
  }
  .recovery p em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .recovery p strong { color: var(--fg); font-weight: 500; }
  .recovery .checklist {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
    margin-top: 24px;
    margin-bottom: 24px;
  }
  .recovery .checklist .item {
    background: var(--bg);
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .recovery .checklist .k {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .recovery .checklist .v {
    font-family: var(--sans);
    font-size: 15px;
    color: var(--fg);
    font-weight: 400;
    line-height: 1.4;
  }
  .recovery .checklist .v em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .recovery .row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .recovery .row .primary {
    border: 1px solid var(--sev-bad);
    background: var(--sev-bad);
    color: var(--bg);
    padding: 11px 18px;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .recovery .row .primary:hover {
    background: var(--sev-crit);
    border-color: var(--sev-crit);
  }
  .recovery .row .ghost {
    border: 1px solid var(--rule-strong);
    color: var(--fg-2);
    padding: 11px 18px;
    font-weight: 700;
    cursor: pointer;
    transition: color 120ms, border-color 120ms;
    background: none;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .recovery .row .ghost:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }
  .recovery .row .primary:focus-visible,
  .recovery .row .ghost:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  /* ── RESPONSIVE ───────────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    .hero-meta {
      position: static;
      transform: none;
      padding: 200px clamp(20px, 3vw, 48px) 24px;
      max-width: none;
      text-align: left;
    }
    .hero-meta h1,
    .hero-meta .body { margin-left: 0; }
    .hero-meta .stats { justify-content: start; }
    .hero-meta .stats .stat { text-align: left; }
    .hero-left {
      position: static;
      padding: 24px clamp(20px, 3vw, 48px) 100px;
    }
    .class-grid { grid-template-columns: 1fr; }
    .recovery .checklist { grid-template-columns: 1fr; }
    .stage { height: auto; min-height: 0; }
    .stage-canvas { position: relative; height: 60vh; min-height: 480px; }
    .outage-bar { position: static; }
  }
  @media (max-width: 720px) {
    .alarm-banner { font-size: 9px; padding: 8px 14px; }
    .breadcrumb { font-size: 9px; }
    .outage-bar { padding: 10px clamp(20px, 3vw, 48px); }
    .outage-bar .actions { margin-left: 0; width: 100%; }
    .history-row { grid-template-columns: 1fr; gap: 6px; }
  }
  @media (max-width: 480px) {
    .breadcrumb { padding: 10px 14px; font-size: 9px; letter-spacing: 0.14em; gap: 8px; }
    .breadcrumb .meta { gap: 12px; }
    .below { padding: 48px 14px 56px; }
    .recovery { padding: 24px 16px; }
    .class-card { padding: 20px; }
  }
</style>
