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
  import OrbitalScene, { type OrbitalStation } from './OrbitalScene.svelte';

  const monitored = $derived($monitoredEndpointsStore);
  const measurements = $derived($measurementStore);
  const stats = $derived($statisticsStore);
  const threshold = $derived($settingsStore.healthThreshold);
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

  const cadenceMs = $derived($settingsStore.monitorDelay);
  const cadenceLabel = $derived(`${(cadenceMs / 1000).toFixed(0)} s`);
  const roundCount = $derived(measurements.roundCounter);

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

  function updateTrigger(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isFinite(v)) {
      settingsStore.update((s) => ({ ...s, healthThreshold: v }));
    }
  }

  // ── Audio toggle ───────────────────────────────────────────────────────────
  // Phase D will wire the full Web Audio engine (tick / threshold-cross /
  // carrier-lost / session-start). For Phase B this is a UI-only affordance
  // backed by component-local state. When the engine lands, this $state moves
  // into a persistence-backed store so the user's preference survives reloads.
  let audioOn = $state(false);
  function toggleAudio(): void {
    audioOn = !audioOn;
  }
</script>

<section class="live-surface" aria-label="Live orbital tracker">
  <div class="coords-bar">
    <span>Round<span class="v">{roundCount}</span></span>
    <span>Cadence<span class="v">{cadenceLabel}</span></span>
    <span>Window<span class="v">{WINDOW} s</span></span>
    <span>Stations<span class="v">{stations.length}</span></span>
  </div>

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
      {stations.length === 0 ? 'No stations on transit' : `${stations.length} ${stations.length === 1 ? 'station' : 'stations'} on transit`}
    </div>
  </div>

  <div class="stage">
    {#if stations.length > 0}
      <OrbitalScene
        {stations}
        {stationData}
        {focusedStation}
        triggerMs={threshold}
        windowSeconds={WINDOW}
        windowRounds={WINDOW}
      />
    {:else}
      <div class="stage-empty">
        <p>No endpoints configured.</p>
        <p class="hint">Add stations in Settings to begin observation.</p>
      </div>
    {/if}
  </div>

  <div class="stations" role="radiogroup" aria-label="Station focus">
    {#each chips as chip (chip.id)}
      <button
        type="button"
        class="station-row"
        data-station={chip.id}
        data-focused={focusedId === chip.endpointId ? 'true' : 'false'}
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

  <div class="bottom-controls">
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
  </div>
</section>

<style>
  .live-surface {
    display: grid;
    grid-template-rows: auto auto 1fr auto auto;
    height: 100%;
    overflow: hidden;
    color: var(--fg);
  }

  /* ── Coords bar ─────────────────────────────────────────────────────────── */
  .coords-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;
    padding: 12px clamp(20px, 3vw, 48px);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    border-bottom: 1px solid var(--rule);
  }
  .coords-bar .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Hero number ────────────────────────────────────────────────────────── */
  .hero-num {
    padding: 40px clamp(20px, 3vw, 48px) 24px;
    text-align: center;
  }
  .hero-num .kicker {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 12px;
  }
  .hero-num .number {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(96px, 14vw, 200px);
    letter-spacing: -0.045em;
    line-height: 0.85;
    color: var(--fg);
    text-shadow: 0 0 80px color-mix(in srgb, var(--fg) 12%, transparent);
    font-variant-numeric: tabular-nums;
  }
  .hero-num .number .u {
    font-family: var(--mono);
    font-size: 0.22em;
    color: var(--fg-3);
    margin-left: 8px;
    letter-spacing: 0.04em;
    vertical-align: 0.78em;
    text-shadow: none;
  }
  .hero-num .number .awaiting {
    color: var(--fg-3);
  }
  .hero-num .caption {
    margin-top: 12px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }

  /* ── Orbital stage ──────────────────────────────────────────────────────── */
  .stage {
    position: relative;
    min-height: 380px;
    overflow: hidden;
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

  /* ── Station chip rail ──────────────────────────────────────────────────── */
  .stations {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-top: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
  }
  .station-row {
    display: grid;
    grid-template-columns: 12px 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 16px clamp(14px, 2vw, 24px);
    background: transparent;
    border: 0;
    border-right: 1px solid var(--rule);
    color: var(--fg);
    cursor: pointer;
    text-align: left;
    font: inherit;
    transition: background 160ms;
  }
  .station-row:last-child { border-right: 0; }
  .station-row:hover { background: var(--bg-hover); }
  .station-row[data-focused="true"] {
    background: color-mix(in srgb, var(--station-b) 6%, transparent);
  }
  .station-row:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: -2px;
  }
  .mk {
    width: 10px;
    height: 10px;
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
    margin-bottom: 2px;
  }
  .ident .meta {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
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
  .telem .drift {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-top: 4px;
  }
  .telem .drift .v { color: var(--fg-2); margin-left: 4px; }

  /* ── Bottom controls (audio + trigger) ──────────────────────────────────── */
  .bottom-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px clamp(20px, 3vw, 48px);
    border-top: 1px solid var(--rule);
    flex-wrap: wrap;
  }
  .audio-toggle {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    border: 1px solid var(--rule-strong);
    background: transparent;
    padding: 7px 14px;
    cursor: pointer;
    transition: color 120ms, background 120ms, border-color 120ms;
  }
  .audio-toggle[data-on="true"] {
    color: var(--station-b);
    border-color: var(--station-b);
    background: color-mix(in srgb, var(--station-b) 8%, transparent);
  }
  .audio-toggle:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }
  .audio-toggle:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 12px;
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
    width: 160px;
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
  @media (max-width: 720px) {
    .coords-bar { gap: 14px; font-size: 9px; padding: 10px 14px; }
    .hero-num { padding: 24px 14px 16px; }
    .hero-num .number { font-size: clamp(72px, 18vw, 120px); }
    .stations { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .station-row:nth-child(2) { border-right: 0; }
    .station-row:nth-child(3),
    .station-row:nth-child(4) { border-top: 1px solid var(--rule); }
    .bottom-controls { flex-direction: column; align-items: stretch; padding: 12px 14px; }
    .trigger input[type="range"] { width: 100%; }
  }
</style>
