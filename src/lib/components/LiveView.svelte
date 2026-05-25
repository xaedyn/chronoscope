<!-- src/lib/components/LiveView.svelte -->
<!-- Vessel v4 Live surface — 3D orbital tracker. Replaces the v2/v3 scope
     chart with the canonical OrbitalScene plus per-station chip rail,
     trigger slider, audio toggle. Reference: proposal-live-v4.html.
     Measurement engine drives stationData; OrbitalScene handles all
     WebGL rendering (sweep, pulses, shaders, parallax). -->
<script lang="ts">
  import { uiStore } from '$lib/stores/ui';
  import { measurementStore } from '$lib/stores/measurements';
  import { statisticsStore } from '$lib/stores/statistics';
  import { settingsStore } from '$lib/stores/settings';
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { fmt } from '$lib/utils/format';
  import { tokens } from '$lib/tokens';
  import { buildDiagnosticNarrative } from '$lib/utils/diagnostic-narrative';
  import { buildDiagnosticReport } from '$lib/utils/diagnostic-report';
  import { buildDiagnosticEvidenceContract } from '$lib/utils/diagnostic-evidence-contract';
  import { buildPulseInspection } from '$lib/utils/pulse-inspection';
  import type { MeasurementSample } from '$lib/types';
  import type { VerdictRow } from '$lib/utils/verdict';
  import OrbitalScene, { type OrbitalStation, type PulseHover } from './OrbitalScene.svelte';
  import InstrumentCalibration from './InstrumentCalibration.svelte';
  import PulseEvidence from './PulseEvidence.svelte';
  import { setEnabled, playSessionStart } from '$lib/audio';

  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const stats = $derived($statisticsStore);
  const settings = $derived($settingsStore);
  const threshold = $derived(settings.healthThreshold);
  const focusedId = $derived($uiStore.focusedEndpointId);

  // ── Endpoint → station mapping ─────────────────────────────────────────────
  // v4 ships with 4 canonical stations (A/B/C/D) at distinct stellar hues.
  // Chronoscope users configure their own endpoints; we map the first 4
  // monitored endpoints to A/B/C/D by index. The 4 default endpoints (Google,
  // Edge, AWS, Fastly) line up exactly with the v4 station semantics.
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

  // Map endpoint id → station letter, derived once per monitored set
  const epToStation = $derived<Record<string, string>>(
    Object.fromEntries(
      monitored.slice(0, 4).map((ep, i) => [ep.id, STATION_IDS[i]]),
    ),
  );
  // Map station letter → friendly endpoint label (for OrbitalScene tooltip).
  const stationLabelsForScene = $derived<Record<string, string>>(
    Object.fromEntries(
      monitored.slice(0, 4).map((ep, i) => [STATION_IDS[i], ep.label]),
    ),
  );
  const stationToEndpoint = $derived<Record<string, string>>(
    Object.fromEntries(
      monitored.slice(0, 4).map((ep, i) => [STATION_IDS[i], ep.id]),
    ),
  );
  const pinnedPulse = $derived($uiStore.pinnedPulse);

  // ── Sample → ring buffer per station ───────────────────────────────────────
  // OrbitalScene wants stationData[stationId] = (number | null)[60].
  // We pull the last 60 samples per endpoint and emit latency or null.
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
      // Pack the tail into the END of the buffer so older samples are at lower indices.
      const offset = WINDOW - tail.length;
      for (let i = 0; i < tail.length; i++) {
        const s = tail[i];
        buf[offset + i] = s.status === 'ok' ? s.latency : null;
      }
      out[id] = buf;
    }
    return out;
  });

  // Parallel array of per-slot sample timestamps. OrbitalScene uses these to
  // compute pulse "freshness" age. Without timestamps the scene falls back to
  // writeAt detection, which misfires on every buffer shift and makes every
  // pulse render fresh simultaneously — producing a dense bright necklace
  // instead of v4's "one fresh pulse + settled trail" look.
  const stationTimestamps = $derived.by<Record<string, readonly (number | null)[]>>(() => {
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
        buf[offset + i] = s.status === 'ok' ? s.timestamp : null;
      }
      out[id] = buf;
    }
    return out;
  });

  const focusedStation = $derived<string | null>(
    focusedId === null ? null : (epToStation[focusedId] ?? null),
  );

  // ── Hero readouts ──────────────────────────────────────────────────────────
  // Field p50 — median across the per-station p50 readings.
  const fieldP50 = $derived.by<number | null>(() => {
    const values: number[] = [];
    for (const ep of monitored.slice(0, 4)) {
      const s = stats[ep.id];
      if (s && Number.isFinite(s.p50)) values.push(s.p50);
    }
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);
    return Math.round(values[Math.floor(values.length / 2)]);
  });

  const cadenceMs = $derived(settings.monitorDelay);
  const cadenceLabel = $derived(`${(cadenceMs / 1000).toFixed(0)} s`);
  const roundCount = $derived(measurements.roundCounter);

  // ── R.A. / Dec coords (synced with OverviewView derivation) ───────────────
  const elapsedMs = $derived.by(() => {
    if (!measurements.startedAt) return 0;
    return Date.now() - measurements.startedAt;
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

  // ── Diagnostic narrative for the verdict-band ─────────────────────────────
  // Mirrors OverviewView's wiring so Live and Overview agree on the verdict.
  const samplesByEndpoint = $derived.by<Record<string, readonly MeasurementSample[]>>(() => {
    const out: Record<string, readonly MeasurementSample[]> = {};
    for (const ep of monitored) {
      const state = measurements.endpoints[ep.id];
      out[ep.id] = state ? state.samples.toArray().slice(-WINDOW) : [];
    }
    return out;
  });
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

  type Sigil = 'stable' | 'warn' | 'bad' | 'crit';
  const sigil = $derived<Sigil>((() => {
    const kind = diagnosticNarrative.kind;
    if (kind === 'collecting') return 'stable';
    if (kind === 'healthy') return 'stable';
    const sev = diagnosticNarrative.severity;
    if (sev === 'healthy') return 'stable';
    if (sev === 'degraded') {
      const anyCrit = verdictRows.some((r) => r.stats.lossPercent >= 10);
      return anyCrit ? 'crit' : 'bad';
    }
    return 'warn';
  })());

  const verdictKickerText = $derived<string>((() => {
    if (diagnosticNarrative.kind === 'collecting') return 'Acquiring · awaiting samples';
    if (sigil === 'stable') return 'In transit · all stations nominal';
    if (sigil === 'warn') return 'Carrier wobble · band widening';
    if (sigil === 'bad') {
      const ep = diagnosticNarrative.highlightedEndpoint;
      return ep ? `Doppler · ${ep.label}` : 'Doppler · isolated drift';
    }
    const ep = diagnosticNarrative.highlightedEndpoint;
    return ep ? `Carrier lost · ${ep.label}` : 'Carrier lost · alarm';
  })());

  const showVerdictBand = $derived(diagnosticNarrative.kind !== 'collecting' && verdictRows.length > 0);

  // ── Per-station chip row ───────────────────────────────────────────────────
  interface StationChip {
    readonly id: string;
    readonly label: string;
    readonly color: string;
    readonly latency: number | null;
    readonly drift: number | null;
    readonly severity: 'stable' | 'warn' | 'bad' | 'crit';
    readonly status: string;
    readonly endpointId: string;
  }
  const chips = $derived<readonly StationChip[]>(
    monitored.slice(0, 4).map((ep, i) => {
      const m = measurements.endpoints[ep.id];
      const s = stats[ep.id];
      const last = m?.lastLatency ?? null;
      const baseline = s?.p50 ?? null;
      const drift = (last !== null && baseline !== null) ? Math.round(last - baseline) : null;
      let severity: StationChip['severity'] = 'stable';
      let status = 'Carrier acquired';
      if (last !== null) {
        if (last > threshold * 1.5) { severity = 'crit'; status = 'Carrier lost'; }
        else if (last > threshold) { severity = 'bad'; status = 'Doppler drift'; }
        else if (drift !== null && Math.abs(drift) > 10) { severity = 'warn'; status = 'Carrier wobble'; }
      }
      return {
        id: STATION_IDS[i],
        label: ep.label,
        color: STATION_COLORS[i],
        latency: last,
        drift,
        severity,
        status,
        endpointId: ep.id,
      };
    }),
  );

  function focusStation(endpointId: string): void {
    uiStore.setFocusedEndpoint(focusedId === endpointId ? null : endpointId);
  }

  function inspectPulse(pulse: PulseHover): void {
    const evidence = buildPulseInspection({
      source: 'live',
      pulse,
      endpointIdByStation: stationToEndpoint,
      thresholdMs: threshold,
    });
    uiStore.setPinnedPulse(evidence);
    if (evidence.endpointId !== null) uiStore.setFocusedEndpoint(evidence.endpointId);
  }

  function clearPinnedPulse(): void {
    uiStore.clearPinnedPulse();
  }

  function updateTrigger(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isFinite(v)) {
      settingsStore.update((s) => ({ ...s, healthThreshold: v }));
    }
  }

  // ── Audio toggle ───────────────────────────────────────────────────────────
  // Wires through settingsStore.audioEnabled (persisted). The Web Audio engine
  // (tick / threshold-cross / carrier-lost / session-start) is driven from
  // App.svelte's bootstrap subscription; this toggle just flips the gate.
  const audioOn = $derived(settings.audioEnabled);
  function toggleAudio(): void {
    const next = !settings.audioEnabled;
    settingsStore.update((s) => ({ ...s, audioEnabled: next }));
    setEnabled(next);
    if (next) playSessionStart(); // confirmation chime when user enables
  }

  // ── First-visit onboarding callout ─────────────────────────────────────────
  // "How to read the orbital tracker" — three-item legend (orbit / pulse / sweep)
  // that auto-dismisses after 6s. Persists dismissal in localStorage so it only
  // appears on the user's first visit to the Live surface.
  // Re-summon via `?` is deferred to Phase D (KeyboardOverlay currently owns
  // that binding at src/lib/utils/shortcuts.ts; this callout is per-surface and
  // would conflict without a coordinated handler).
  const TOUR_STORAGE_KEY = 'chronoscope-orbital-tour-seen';
  const TOUR_AUTO_DISMISS_MS = 6000;

  function readTourSeen(): boolean {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(TOUR_STORAGE_KEY) === '1';
    } catch {
      // Privacy mode / disabled storage — treat as "already seen" so we
      // don't show a callout we can't persist a dismissal for.
      return true;
    }
  }

  let showTour = $state(!readTourSeen());
  let tourTimerId: ReturnType<typeof setTimeout> | null = null;

  function dismissTour(): void {
    showTour = false;
    if (tourTimerId !== null) {
      clearTimeout(tourTimerId);
      tourTimerId = null;
    }
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      // Storage unavailable — dismissal still removes the callout for this
      // session; it will reappear on reload but that's the best we can do.
    }
  }

  $effect(() => {
    if (!showTour) return;
    tourTimerId = setTimeout(() => {
      dismissTour();
    }, TOUR_AUTO_DISMISS_MS);
    return () => {
      if (tourTimerId !== null) {
        clearTimeout(tourTimerId);
        tourTimerId = null;
      }
    };
  });

  // Window event listener — shortcuts.ts dispatches `chronoscope:summon-tour`
  // when `?` is pressed on the Live surface, re-showing the hint with a
  // fresh 6 s auto-dismiss timer. The flag in localStorage is intentionally
  // NOT cleared — the hint should resurface for as long as the user keeps
  // pressing `?`, but next page load returns to "seen" if they ever dismissed.
  $effect(() => {
    const handler = (): void => {
      if (tourTimerId !== null) {
        clearTimeout(tourTimerId);
        tourTimerId = null;
      }
      showTour = true;
    };
    window.addEventListener('chronoscope:summon-tour', handler);
    return () => window.removeEventListener('chronoscope:summon-tour', handler);
  });
</script>

<section class="live-stage" aria-label="Live orbital tracker">
  <!-- Full-bleed orbital scene as background — fills the entire surface
       below the masthead. All HUD chrome floats over it via .chrome. -->
  <div class="stage-bg">
    {#if stations.length > 0}
      <OrbitalScene
        {stations}
        {stationData}
        {stationTimestamps}
        {focusedStation}
        triggerMs={threshold}
        windowSeconds={WINDOW}
        windowRounds={WINDOW}
        stationLabels={stationLabelsForScene}
        currentRound={roundCount}
        cadenceMs={cadenceMs}
        onPulseInspect={inspectPulse}
      />
    {:else}
      <div class="stage-empty">
        <p>No endpoints configured.</p>
        <p class="hint">Add stations in Settings to begin observation.</p>
      </div>
    {/if}
  </div>

  <div class="vignette" aria-hidden="true"></div>

  <!-- HUD chrome layer — pointer-events:none on the container, auto on each
       child so the canvas stays interactive in the gaps between overlays. -->
  <div class="chrome">
    <div class="coords-bar">
      <span>Round<span class="v">{roundCount}</span></span>
      <span>Cadence<span class="v">{cadenceLabel}</span></span>
      <span>Window<span class="v">{WINDOW} s</span></span>
      <span>R.A.<span class="v">{raCoord}</span></span>
      <span>Dec<span class="v">{decCoord}</span></span>
    </div>

    <div class="live-calibration">
      <InstrumentCalibration
        mode="live"
        thresholdMs={threshold}
        windowSeconds={WINDOW}
        sampleSlots={WINDOW}
        baselineMs={fieldP50}
        stationCount={stations.length}
        cadenceMs={cadenceMs}
      />
    </div>

    {#if pinnedPulse}
      <div class="live-evidence">
        <PulseEvidence evidence={pinnedPulse} title="Pinned pulse" onClear={clearPinnedPulse} />
      </div>
    {/if}

    <div class="hero-num" aria-live="polite">
      <div class="kicker">Field carrier · p50</div>
      <div class="number">
        {#if fieldP50 === null}
          <span class="awaiting">—</span>
        {:else}
          {fieldP50}<span class="u">ms</span>
        {/if}
      </div>
      <div class="caption">
        {#if stations.length === 0}
          — No stations on transit —
        {:else}
          — {stations.length} {stations.length === 1 ? 'station' : 'stations'} on transit —
        {/if}
      </div>
    </div>

    {#if showVerdictBand}
      <div class="verdict-band live-contract-strip" data-sigil={sigil}>
        <div class="tag"><span class="pip"></span>{verdictKickerText}</div>
        <div class="title">{evidenceContract.current.headline}</div>
        <div class="body">
          <span class="event-line">{evidenceContract.live.eventLine}</span>
          <span class="operational-line">{evidenceContract.live.operationalLine}</span>
        </div>
      </div>
    {/if}

    <div class="stations" role="radiogroup" aria-label="Station focus">
      {#each chips as chip (chip.id)}
        <button
          type="button"
          class="station-row"
          data-station={chip.id}
          data-endpoint-id={chip.endpointId}
          data-focused={focusedId === chip.endpointId ? 'true' : 'false'}
          data-inspected={pinnedPulse?.endpointId === chip.endpointId ? 'true' : 'false'}
          data-severity={chip.severity}
          onclick={() => focusStation(chip.endpointId)}
          aria-pressed={focusedId === chip.endpointId}
        >
          <span class="mk" style:background={chip.color} style:box-shadow="0 0 8px {chip.color}"></span>
          <div class="ident">
            <div class="name">{chip.label}</div>
            <div class="meta">{chip.status}</div>
          </div>
          <div class="telem">
            <div class="lat">
              {#if chip.latency === null}
                <span class="awaiting">—</span>
              {:else}
                {fmt(chip.latency)}<span class="u">ms</span>
              {/if}
            </div>
            <div class="drift">
              drift
              <span class="v">
                {#if chip.drift === null}
                  —
                {:else}
                  {chip.drift >= 0 ? '+' : ''}{chip.drift} ms
                {/if}
              </span>
            </div>
          </div>
        </button>
      {/each}
    </div>

    <button
      type="button"
      class="audio-toggle"
      data-on={audioOn ? 'true' : 'false'}
      aria-pressed={audioOn}
      onclick={toggleAudio}
    >
      Audio · {audioOn ? 'on' : 'off'}
    </button>

    <label class="trigger">
      <span class="trigger-label">Trigger</span>
      <input
        type="range"
        min="40"
        max="240"
        step="5"
        value={threshold}
        oninput={updateTrigger}
        aria-label="Carrier loss threshold in milliseconds"
      />
      <span class="trigger-val"><span class="v">{threshold}</span> ms</span>
    </label>

    {#if showTour}
      <div
        class="tour-hint"
        role="status"
        aria-live="polite"
        aria-label="How to read the orbital tracker"
      >
        <div class="head">
          <span class="kicker"><span class="pip"></span>How to read the orbital tracker</span>
          <button type="button" class="dismiss" onclick={dismissTour}>Got it</button>
        </div>
        <div class="body">
          <div class="item">
            <div class="visual"><div class="ring-demo"></div></div>
            <div class="label">Orbit</div>
            <div class="desc">= endpoint</div>
          </div>
          <div class="item">
            <div class="visual"><div class="pulse-demo"></div></div>
            <div class="label">Pulse</div>
            <div class="desc">= round</div>
          </div>
          <div class="item">
            <div class="visual"><div class="sweep-demo"></div></div>
            <div class="label">Sweep</div>
            <div class="desc">= now</div>
          </div>
        </div>
        <div class="progress-track">
          <span>Auto-dismiss</span>
          <div class="bar"><div class="bar-fill"></div></div>
          <span>6 s</span>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  /* ── Full-bleed stage architecture (v4 cinematic layout) ─────────────────
     The orbital scene is the WHOLE viewport background. HUD chrome floats
     over it via .chrome, each overlay absolutely positioned to a corner or
     edge. Pointer-events on .chrome are 'none' so the canvas stays
     interactive in the gaps between overlays. */
  .live-stage {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 600px;
    overflow: hidden;
    color: var(--fg);
  }

  /* The 3D scene fills the entire viewport (including behind the masthead),
     matching the v4 prototype's full-viewport stage. The masthead floats over
     it via backdrop-blur. Without this the canvas aspect would be ~2.23
     (below-masthead only), which widens the horizontal FOV and makes the
     orbits feel smaller; v4 uses the full ~2.04 aspect so orbits dominate. */
  .stage-bg {
    position: fixed;
    inset: 0;
    z-index: 0;
  }
  .stage-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--fg-2);
    font-family: var(--sans);
  }
  .stage-empty .hint {
    margin-top: 8px;
    color: var(--fg-3);
    font-size: 13px;
  }

  /* Cinematic vignette over the scene. */
  .vignette {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: radial-gradient(
      ellipse at center,
      transparent 35%,
      color-mix(in srgb, var(--bg) 45%, transparent) 70%,
      color-mix(in srgb, var(--bg) 85%, transparent) 100%
    );
  }

  /* HUD chrome layer — all overlays live here. Pointer-events:none means
     clicks pass through to the canvas; each overlay re-enables pointer
     events for itself. */
  .chrome {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }
  .chrome > * { pointer-events: auto; }

  /* ── Coords bar — top-center pill ───────────────────────────────────────── */
  .coords-bar {
    position: absolute;
    top: 78px;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    gap: 26px;
    flex-wrap: wrap;
    padding: 8px 18px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    white-space: nowrap;
  }
  .coords-bar > span { white-space: nowrap; }
  .coords-bar .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 8px;
    font-variant-numeric: tabular-nums;
  }

  .live-calibration {
    position: absolute;
    top: 126px;
    left: clamp(20px, 3vw, 48px);
    z-index: 4;
    width: min(380px, calc(100vw - 40px));
  }
  .live-evidence {
    position: absolute;
    top: 502px;
    left: clamp(20px, 3vw, 48px);
    z-index: 4;
    width: min(380px, calc(100vw - 40px));
  }

  /* ── Hero number — centered cinematic readout ───────────────────────────── */
  .hero-num {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    pointer-events: none;
    user-select: none;
    max-width: 90vw;
  }
  .hero-num .kicker {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 22px;
  }
  .hero-num .number {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(140px, 24vw, 320px);
    letter-spacing: -0.045em;
    line-height: 0.82;
    color: var(--fg);
    text-shadow:
      0 0 60px color-mix(in srgb, var(--fg) 10%, transparent),
      0 0 120px color-mix(in srgb, var(--station-b) 6%, transparent);
    font-variant-numeric: tabular-nums;
  }
  .hero-num .number .u {
    font-family: var(--mono);
    font-weight: 400;
    font-size: clamp(18px, 2.4vw, 30px);
    color: var(--fg-3);
    margin-left: 8px;
    letter-spacing: 0.04em;
    vertical-align: 0.78em;
    display: inline-block;
    text-shadow: none;
  }
  .hero-num .number .awaiting {
    color: var(--fg-3);
  }
  .hero-num .caption {
    margin-top: 18px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }

  /* ── Verdict band — bottom-left overlay ─────────────────────────────────── */
  .verdict-band {
    position: absolute;
    bottom: 88px;
    left: clamp(20px, 3vw, 48px);
    max-width: 56ch;
  }
  .verdict-band .tag {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 14px;
  }
  .verdict-band .tag .pip {
    width: 7px;
    height: 7px;
    background: var(--station-b);
    box-shadow: 0 0 10px var(--station-b);
    flex-shrink: 0;
  }
  .verdict-band[data-sigil="warn"] .tag,
  .verdict-band[data-sigil="bad"] .tag,
  .verdict-band[data-sigil="crit"] .tag {
    color: var(--sev-bad);
  }
  .verdict-band[data-sigil="warn"] .tag .pip {
    background: var(--sev-warn);
    box-shadow: 0 0 10px var(--sev-warn);
  }
  .verdict-band[data-sigil="bad"] .tag .pip {
    background: var(--sev-bad);
    box-shadow: 0 0 10px var(--sev-bad);
  }
  .verdict-band[data-sigil="crit"] .tag .pip {
    background: var(--sev-crit);
    box-shadow: 0 0 10px var(--sev-crit);
  }
  .verdict-band .title {
    font-family: var(--sans);
    font-size: 28px;
    font-weight: 300;
    letter-spacing: -0.02em;
    line-height: 1.1;
    color: var(--fg);
    margin: 0 0 12px;
    max-width: 22ch;
  }
  .verdict-band .body {
    font-family: var(--sans);
    font-size: 14px;
    color: var(--fg-2);
    line-height: 1.5;
    max-width: 52ch;
    margin: 0;
  }
  .verdict-band .event-line,
  .verdict-band .operational-line {
    display: block;
  }
  .verdict-band .event-line {
    color: var(--fg);
    margin-bottom: 6px;
  }
  .verdict-band .body :global(em) {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .verdict-band .body :global(strong) {
    color: var(--fg);
    font-weight: 500;
  }

  /* ── First-visit onboarding callout ─────────────────────────────────────── */
  /* Mirrors proposal-live-v4.html's .onboarding-callout. Positioned absolutely
     inside .stage so it overlays the orbital scene without disrupting layout.
     Anchored bottom-center; falls back to bottom-right on narrow viewports. */
  .tour-hint {
    position: absolute;
    z-index: 9;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 18px 22px 20px;
    border: 1px solid var(--rule-strong);
    background: color-mix(in srgb, var(--bg-2) 92%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    min-width: 380px;
    max-width: 520px;
    box-shadow: 0 12px 48px color-mix(in srgb, var(--bg) 50%, transparent);
    animation: tourHintEnter 600ms cubic-bezier(0.16, 0.84, 0.42, 1);
  }
  .tour-hint::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 36px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 14px var(--station-b);
  }
  @keyframes tourHintEnter {
    from { opacity: 0; transform: translateX(-50%) translateY(40px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .tour-hint .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .tour-hint .head .kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .tour-hint .head .pip {
    width: 7px;
    height: 7px;
    background: var(--station-b);
    box-shadow: 0 0 10px var(--station-b);
    animation: tourPipPulse 2000ms ease-in-out infinite;
  }
  @keyframes tourPipPulse {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }
  .tour-hint .head .dismiss {
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
    padding: 4px 8px;
    border: 1px solid var(--rule);
    background: transparent;
    cursor: pointer;
    transition: color 120ms, border-color 120ms;
  }
  .tour-hint .head .dismiss:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }
  .tour-hint .head .dismiss:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .tour-hint .body {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  .tour-hint .item {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tour-hint .visual {
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .tour-hint .ring-demo {
    width: 28px;
    height: 28px;
    border: 1px solid var(--station-a);
    border-radius: 50%;
    box-shadow: 0 0 12px var(--station-a);
    position: relative;
  }
  .tour-hint .ring-demo::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 4px;
    height: 4px;
    background: var(--station-a);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 8px var(--station-a);
  }
  .tour-hint .pulse-demo {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--station-c);
    box-shadow: 0 0 12px var(--station-c);
    animation: tourPulseDemo 1600ms ease-in-out infinite;
  }
  @keyframes tourPulseDemo {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50%      { transform: scale(2.4); opacity: 1; }
  }
  .tour-hint .sweep-demo {
    width: 36px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--fg) 50%, var(--fg));
    box-shadow: 0 0 8px var(--fg);
    transform-origin: left;
    animation: tourSweepDemo 2400ms linear infinite alternate;
  }
  @keyframes tourSweepDemo {
    from { transform: rotate(-20deg); }
    to   { transform: rotate(20deg); }
  }
  .tour-hint .label {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
    text-align: center;
  }
  .tour-hint .desc {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    text-align: center;
    font-weight: 700;
  }
  .tour-hint .progress-track {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--rule);
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .tour-hint .progress-track .bar {
    flex: 1;
    height: 1px;
    background: var(--rule-strong);
    position: relative;
    overflow: hidden;
  }
  .tour-hint .progress-track .bar-fill {
    position: absolute;
    inset: 0;
    background: var(--station-b);
    box-shadow: 0 0 8px var(--station-b);
    transform-origin: left;
    transform: scaleX(0);
    animation: tourProgressFill 6000ms linear forwards;
  }
  @keyframes tourProgressFill {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }

  /* ── Stations panel — right-center vertical list overlay ────────────────── */
  /* v4 anchors the panel's TOP edge at 50% (its CSS specifies translateY(-50%)
     but the kickerFade entrance animation overrides the transform back to
     identity); the panel hangs from mid-stage downward. Match that exactly. */
  .stations {
    position: absolute;
    right: clamp(20px, 3vw, 48px);
    top: 50%;
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 320px;
    max-width: 320px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .station-row {
    display: grid;
    grid-template-columns: 10px 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    font: inherit;
    transition: background 160ms;
    position: relative;
    width: 100%;
  }
  .station-row:last-child { border-bottom: 0; }
  .station-row:hover {
    background: color-mix(in srgb, var(--fg) 2%, transparent);
  }
  .station-row[data-focused="true"] {
    background: color-mix(in srgb, var(--fg) 4%, transparent);
  }
  .station-row[data-focused="true"]::before {
    content: '';
    position: absolute;
    left: 0;
    top: 14%;
    bottom: 14%;
    width: 2px;
    background: var(--station-b);
    box-shadow: 0 0 10px var(--station-b);
  }
  .station-row[data-inspected="true"] {
    border-color: color-mix(in srgb, var(--station-c) 70%, var(--rule));
    background: color-mix(in srgb, var(--station-c) 10%, transparent);
  }
  .station-row[data-inspected="true"]::after {
    content: 'Pinned';
    position: absolute;
    top: 7px;
    right: 10px;
    font-family: var(--mono);
    font-size: 8px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--station-c);
  }
  .station-row:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: -2px;
  }
  .mk {
    width: 8px;
    height: 8px;
    border-radius: 0;
    align-self: center;
    justify-self: start;
  }
  .ident .name {
    font-family: var(--sans);
    font-weight: 500;
    font-size: 14px;
    color: var(--fg);
    letter-spacing: -0.005em;
    margin-bottom: 4px;
  }
  .ident .meta {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .station-row[data-severity="warn"] .ident .meta { color: var(--sev-warn); }
  .station-row[data-severity="bad"]  .ident .meta { color: var(--sev-bad); }
  .station-row[data-severity="crit"] .ident .meta { color: var(--sev-crit); }
  .telem {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .telem .lat {
    font-family: var(--mono);
    font-size: 18px;
    color: var(--fg);
    letter-spacing: -0.01em;
    line-height: 1;
  }
  .telem .lat .u {
    font-size: 0.55em;
    color: var(--fg-3);
    margin-left: 3px;
  }
  .telem .lat .awaiting { color: var(--fg-3); }
  .station-row[data-severity="bad"] .telem .lat,
  .station-row[data-severity="crit"] .telem .lat { color: var(--sev-bad); }
  /* v4 renders the drift label as lowercase "drift" with tight tracking;
     the value is bolded in mono. Matches proposals/v4/proposal-live-v4.html
     .stations .row .telem .drift. */
  .telem .drift {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.04em;
    color: var(--fg-3);
    margin-top: 4px;
  }
  .telem .drift .v {
    color: var(--fg-2);
    font-weight: 700;
    font-size: 9px;
    margin-left: 4px;
  }

  /* ── Audio toggle — bottom-right (left of trigger) ──────────────────────── */
  .audio-toggle {
    position: absolute;
    bottom: 22px;
    right: calc(clamp(20px, 3vw, 48px) + 280px);
    padding: 10px 14px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    cursor: pointer;
    transition: color 120ms, border-color 120ms;
  }
  .audio-toggle[data-on="true"] {
    color: var(--station-b);
    border-color: var(--station-b);
  }
  .audio-toggle:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }
  .audio-toggle:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  /* ── Trigger slider — bottom-right ──────────────────────────────────────── */
  .trigger {
    position: absolute;
    bottom: 22px;
    right: clamp(20px, 3vw, 48px);
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .trigger input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100px;
    height: 14px;
    cursor: pointer;
    background: transparent;
  }
  .trigger input[type="range"]::-webkit-slider-runnable-track {
    height: 1px;
    background: var(--rule-strong);
  }
  .trigger input[type="range"]::-moz-range-track {
    height: 1px;
    background: var(--rule-strong);
  }
  .trigger input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 2px;
    height: 14px;
    background: var(--sev-bad);
    margin-top: -6px;
    box-shadow: 0 0 8px var(--sev-bad);
  }
  .trigger input[type="range"]::-moz-range-thumb {
    width: 2px;
    height: 14px;
    background: var(--sev-bad);
    border: 0;
  }
  .trigger input[type="range"]:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 4px;
  }
  .trigger-val {
    color: var(--sev-bad);
    font-variant-numeric: tabular-nums;
  }
  .trigger-val .v { color: var(--sev-bad); }

  /* ── Mobile ─────────────────────────────────────────────────────────────── */
  @media (max-width: 1100px) {
    /* Compact the stations panel + give the verdict / trigger more room */
    .stations { width: 280px; max-width: 280px; right: 12px; }
    .verdict-band { bottom: 32px; max-width: 48ch; }
    .live-calibration { width: min(330px, calc(100vw - 40px)); }
    .live-evidence {
      top: 428px;
      width: min(330px, calc(100vw - 40px));
    }
  }
  @media (max-width: 720px) {
    .coords-bar { gap: 14px; font-size: 9px; padding: 6px 14px; }
    .live-calibration {
      top: 122px;
      left: 16px;
      right: 16px;
      width: auto;
    }
    .live-calibration :global(.summary),
    .live-calibration :global(.readouts),
    .live-calibration :global(.encoding-grid) {
      display: none;
    }
    .live-evidence {
      display: block;
      top: 188px;
      left: 16px;
      right: 16px;
      width: auto;
      z-index: 6;
    }
    .live-evidence :global(.pulse-evidence) {
      max-width: none;
    }
    .live-evidence :global(.evidence-head) {
      grid-template-columns: 1fr auto;
      padding: 9px 12px 8px;
    }
    .live-evidence :global(.source) {
      display: none;
    }
    .live-evidence :global(.summary) {
      padding: 9px 12px;
      font-size: 11px;
      line-height: 1.25;
    }
    .live-evidence :global(.evidence-grid) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .live-evidence :global(.cell) {
      padding: 7px 8px;
    }
    .live-evidence :global(.cell:nth-child(1)),
    .live-evidence :global(.cell:nth-child(4)),
    .live-evidence :global(.cell:nth-child(6)) {
      display: none;
    }
    .hero-num { top: 42%; }
    .hero-num .number { font-size: clamp(72px, 18vw, 120px); }
    .hero-num .caption { display: none; }
    .verdict-band {
      bottom: 168px;
      left: 16px;
      right: 16px;
      max-width: none;
    }
    .verdict-band .title { font-size: 22px; }
    .verdict-band .body {
      font-size: 13px;
      max-height: 6.2em;
      overflow: hidden;
    }
    /* On narrow viewports the stations panel sits below the hero number
       instead of overlaying it. */
    .stations {
      position: static;
      transform: none;
      width: 100%;
      max-width: 100%;
      margin: 100vh auto 24px;
    }
    .audio-toggle {
      right: 16px;
      bottom: 88px;
    }
    .trigger {
      left: 16px;
      right: 16px;
      bottom: 24px;
      justify-content: space-between;
    }
    .trigger input[type="range"] {
      flex: 1;
      width: auto;
      min-width: 70px;
    }
    .tour-hint {
      min-width: 0;
      max-width: none;
      left: 12px;
      right: 12px;
      transform: none;
      bottom: 16px;
      padding: 14px 16px 16px;
    }
    @keyframes tourHintEnter {
      from { opacity: 0; transform: translateY(40px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  }
</style>
