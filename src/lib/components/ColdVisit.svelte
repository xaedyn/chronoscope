<!-- src/lib/components/ColdVisit.svelte -->
<!-- Vessel v4 Cold-visit surface — the first-visit empty state that replaces
     auto-start. Translates proposals/v4/proposal-cold-v4.html into Svelte:
     hero composition with kicker / verdict h1 / supporting copy / Begin
     button, footnote, bottom coordinate rail. The orbital field renders in
     a dormant state (no pulses, low-opacity orbits) via OrbitalScene's
     assemble prop set to false (kept ghostly until the user starts).
     Begin calls the onStart callback wired to engine.start(). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { endpointStore } from '$lib/stores/endpoints';
  import { settingsStore } from '$lib/stores/settings';
  import { tokens } from '$lib/tokens';
  import { navigateTo } from '$lib/router';
  import OrbitalScene, { type OrbitalStation } from './OrbitalScene.svelte';

  let { onStart }: { onStart?: () => void } = $props();

  const endpoints = $derived($endpointStore);
  const settings = $derived($settingsStore);

  // ── Station mapping (mirrors OverviewView) ───────────────────────────────
  const STATION_IDS = ['A', 'B', 'C', 'D'] as const;
  const STATION_COLORS = [
    tokens.color.station.A,
    tokens.color.station.B,
    tokens.color.station.C,
    tokens.color.station.D,
  ] as const;
  const STATION_RADII = [6, 8, 10, 12] as const;

  const stations = $derived<readonly OrbitalStation[]>(
    endpoints
      .filter((ep) => ep.enabled)
      .slice(0, 4)
      .map((_, i) => ({
        id: STATION_IDS[i],
        color: STATION_COLORS[i],
        radius: STATION_RADII[i],
      })),
  );

  // No measurements yet — pass empty station-data so the dormant scene renders
  // orbits + home + stars only (no pulses).
  const WINDOW = tokens.lane.chartWindow;
  const stationData = $derived.by<Record<string, readonly (number | null)[]>>(() => {
    const out: Record<string, (number | null)[]> = {};
    for (const id of STATION_IDS) {
      out[id] = new Array(WINDOW).fill(null);
    }
    return out;
  });

  const enabledCount = $derived(endpoints.filter((ep) => ep.enabled).length);
  const cadenceSec = $derived(Math.round(settings.monitorDelay / 1000));

  // ── Coords for bottom rail (decorative — match prototype format) ─────────
  let nowMs = $state(Date.now());
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    tickInterval = setInterval(() => { nowMs = Date.now(); }, 1000);
    return () => {
      if (tickInterval !== null) clearInterval(tickInterval);
    };
  });
  const raCoord = $derived.by(() => {
    const m = Math.floor(nowMs / 60000) % 60;
    return `06h ${m.toString().padStart(2, '0')}m`;
  });
  const decCoord = $derived.by(() => {
    const m = Math.floor(nowMs / 60000) % 90;
    const s = Math.floor((nowMs % 60000) / 1000);
    return `+${m.toString().padStart(2, '0')}°${s.toString().padStart(2, '0')}′`;
  });

  function detectVantage(): string {
    if (typeof navigator === 'undefined') return 'Browser · — · —';
    const ua = navigator.userAgent;
    const ch = ua.includes('Chrome') ? 'Chrome' : ua.includes('Safari') ? 'Safari' : ua.includes('Firefox') ? 'Firefox' : 'Browser';
    const os = ua.includes('Mac') ? 'macOS' : ua.includes('Win') ? 'Windows' : ua.includes('Linux') ? 'Linux' : 'OS';
    return `${ch} · ${os}`;
  }
  const vantageLabel = $derived(detectVantage());

  function handleBegin(): void {
    onStart?.();
  }

  function openLive(): void {
    navigateTo({ name: 'live', endpointId: null });
  }

  function openOverview(): void {
    navigateTo({ name: 'overview', endpointId: null });
  }
</script>

<div class="cold-visit" data-phase="cold">
  <!-- Dormant orbital field — fills the surface, behind the hero content. -->
  <div class="stage" aria-hidden="true">
    {#if stations.length > 0}
      <OrbitalScene
        {stations}
        {stationData}
        triggerMs={settings.healthThreshold}
        windowSeconds={WINDOW}
        windowRounds={WINDOW}
        assemble={false}
      />
    {/if}
    <div class="stage-vignette" aria-hidden="true"></div>
  </div>

  <!-- Status stub top-left -->
  <div class="status-stub">
    <span class="status-label">Status</span>
    <span class="status-value">Idle · awaiting begin</span>
  </div>

  <!-- Hero composition -->
  <div class="hero">
    <div class="stack">
      <div class="pre-state">
        <span class="pip" aria-hidden="true"></span>
        <span>The observatory is ready</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>v4.0 · Vessel</span>
      </div>
      <h1>Open the sky.</h1>
      <p class="tagline">
        Your browser is a small observatory. Press <em>Begin</em> and Chronoscope will acquire carrier on
        {enabledCount} endpoint{enabledCount === 1 ? '' : 's'}, plotting the network as a synchronized orbital trace.
      </p>

      <div class="cta-stack">
        <button type="button" class="begin-btn" onclick={handleBegin} aria-label="Begin session">
          <span>Begin session</span>
          <span class="arrow" aria-hidden="true">→</span>
        </button>

        <div class="ghost-links">
          <button type="button" class="ghost" onclick={openLive}>Open the observatory →</button>
          <button type="button" class="ghost" onclick={openOverview}>View mission status</button>
        </div>

        <div class="meta">
          Default set<span class="v">{enabledCount} station{enabledCount === 1 ? '' : 's'}</span>
          <span class="dot" aria-hidden="true">·</span>
          Cadence<span class="v">{cadenceSec} s</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Footnote — bottom right -->
  <aside class="footnote">
    <div class="k">No account · no install</div>
    <p>Chronoscope runs entirely in this browser. Nothing leaves your device unless you choose to <em>Share</em> a session.</p>
  </aside>

  <!-- Bottom rail — coordinate strip -->
  <footer class="rail">
    <div class="grp">
      <span class="station-set">
        {#each stations as st (st.id)}
          <span class="swatch" data-ep={st.id} aria-hidden="true"></span>
        {/each}
        <span class="default-set">
          Default set<span class="v">{enabledCount}</span>
        </span>
      </span>
      <span>Trigger<span class="v">{settings.healthThreshold} ms</span></span>
      <span>Window<span class="v">{WINDOW} s</span></span>
    </div>
    <div class="grp">
      <span>R.A.<span class="v">{raCoord}</span></span>
      <span>Dec<span class="v">{decCoord}</span></span>
      <span>Vantage<span class="v">{vantageLabel}</span></span>
    </div>
  </footer>
</div>

<style>
  /* The cold-visit surface fills the .shell-main viewport. The stage layer
     sits behind everything; hero, status-stub, footnote, and rail layer on top.
     Each layered piece is absolutely positioned within .cold-visit. */
  .cold-visit {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.55;
    overflow: hidden;
  }

  /* Dormant orbital field — covers the whole surface, behind everything. */
  .stage {
    position: absolute;
    inset: 0;
    z-index: 0;
  }
  .stage-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      ellipse at center,
      transparent 30%,
      color-mix(in srgb, var(--bg) 55%, transparent) 70%,
      color-mix(in srgb, var(--bg) 96%, transparent) 100%
    );
    z-index: 1;
  }

  /* Status stub — top-left badge */
  .status-stub {
    position: absolute;
    top: 14px;
    left: clamp(20px, 3vw, 48px);
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border: 1px solid var(--rule);
    background: var(--bg-backdrop);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    opacity: 0;
    animation: fadeUp 700ms 200ms ease-out forwards;
  }
  .status-stub .status-label { color: var(--fg-3); }
  .status-stub .status-value { color: var(--fg); }

  /* Hero composition — centered stack */
  .hero {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-items: center;
    pointer-events: none;
    padding: 0 clamp(20px, 3vw, 48px);
  }
  .stack {
    text-align: center;
    max-width: 90vw;
    pointer-events: none;
    user-select: none;
  }

  .pre-state {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 36px;
    opacity: 0;
    animation: fadeUp 700ms 300ms ease-out forwards;
  }
  .pre-state .pip {
    width: 7px;
    height: 7px;
    background: var(--fg-3);
    border-radius: 50%;
  }
  .pre-state .sep { color: var(--fg-4); }

  .hero h1 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(80px, 15vw, 240px);
    letter-spacing: -0.05em;
    line-height: 0.85;
    color: var(--fg);
    text-shadow:
      0 0 80px color-mix(in srgb, var(--fg) 10%, transparent),
      0 0 160px color-mix(in srgb, var(--station-b) 4%, transparent);
    margin-bottom: 36px;
    opacity: 0;
    animation: nameRise 1600ms 700ms cubic-bezier(0.16, 0.84, 0.42, 1) forwards;
  }

  .tagline {
    font-family: var(--sans);
    font-weight: 300;
    font-size: clamp(17px, 1.8vw, 24px);
    color: var(--fg-2);
    letter-spacing: -0.01em;
    line-height: 1.4;
    max-width: 48ch;
    margin: 0 auto 44px;
    opacity: 0;
    animation: fadeUp 700ms 1200ms ease-out forwards;
  }
  .tagline em {
    font-style: normal;
    color: var(--fg);
  }

  .cta-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    pointer-events: auto;
    opacity: 0;
    animation: fadeUp 700ms 1600ms ease-out forwards;
  }

  /* BEGIN — large, centered, hero-grade button */
  .begin-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 24px;
    padding: 22px 36px;
    background: var(--fg);
    color: var(--bg);
    border: 1px solid var(--fg);
    font-family: var(--mono);
    font-size: 13px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    font-weight: 700;
    cursor: pointer;
    transition: background 200ms, border-color 200ms;
    box-shadow:
      0 0 60px color-mix(in srgb, var(--fg) 18%, transparent),
      0 0 120px color-mix(in srgb, var(--station-b) 8%, transparent);
  }
  .begin-btn:hover {
    background: var(--station-b);
    border-color: var(--station-b);
  }
  .begin-btn:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 4px;
  }
  .begin-btn .arrow {
    font-family: var(--sans);
    font-weight: 200;
    font-size: 24px;
    letter-spacing: 0;
    line-height: 0.5;
    display: inline-block;
    transition: transform 200ms;
  }
  .begin-btn:hover .arrow { transform: translateX(6px); }

  /* Ghost links — secondary nav below the Begin button */
  .ghost-links {
    display: inline-flex;
    align-items: center;
    gap: 22px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .ghost {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--fg-2);
    background: none;
    border: 0;
    padding: 6px 4px;
    cursor: pointer;
    transition: color 120ms;
  }
  .ghost:hover { color: var(--fg); }
  .ghost:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 4px;
  }

  .meta {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .meta .v {
    color: var(--fg);
    margin-left: 8px;
  }
  .meta .dot {
    margin: 0 8px;
  }

  /* Footnote — bottom right */
  .footnote {
    position: absolute;
    right: clamp(20px, 3vw, 48px);
    bottom: 90px;
    z-index: 5;
    text-align: right;
    max-width: 34ch;
    opacity: 0;
    animation: fadeUp 700ms 1800ms ease-out forwards;
  }
  .footnote .k {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 10px;
  }
  .footnote p {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.5;
    margin: 0;
  }
  .footnote p em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }

  /* Bottom rail */
  .rail {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    padding: 16px clamp(20px, 3vw, 48px);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    border-top: 1px solid var(--rule);
    background: var(--bg-backdrop);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    opacity: 0;
    animation: fadeUp 700ms 2000ms ease-out forwards;
  }
  .rail .grp {
    display: inline-flex;
    gap: 22px;
    flex-wrap: wrap;
  }
  .rail .grp > span {
    white-space: nowrap;
  }
  .rail .v {
    color: var(--fg);
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }
  .rail .station-set {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .rail .station-set .default-set {
    margin-left: 8px;
    color: var(--fg-3);
  }
  .rail .station-set .swatch {
    width: 6px;
    height: 6px;
  }
  .rail .station-set .swatch[data-ep="A"] { background: var(--station-a); box-shadow: 0 0 6px var(--station-a); }
  .rail .station-set .swatch[data-ep="B"] { background: var(--station-b); box-shadow: 0 0 6px var(--station-b); }
  .rail .station-set .swatch[data-ep="C"] { background: var(--station-c); box-shadow: 0 0 6px var(--station-c); }
  .rail .station-set .swatch[data-ep="D"] { background: var(--station-d); box-shadow: 0 0 6px var(--station-d); }

  /* Animations */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes nameRise {
    from {
      opacity: 0;
      transform: translateY(28px);
      letter-spacing: -0.025em;
      filter: blur(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
      letter-spacing: -0.05em;
      filter: blur(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status-stub,
    .pre-state,
    .hero h1,
    .tagline,
    .cta-stack,
    .footnote,
    .rail {
      animation: none;
      opacity: 1;
    }
  }

  /* Mobile */
  @media (max-width: 1100px) {
    .footnote {
      position: static;
      text-align: left;
      padding: 0 clamp(20px, 3vw, 48px) 24px;
      max-width: none;
    }
  }
  @media (max-width: 720px) {
    .hero h1 { font-size: clamp(56px, 18vw, 140px); }
    .pre-state { font-size: 9px; letter-spacing: 0.32em; gap: 10px; }
    .footnote { display: none; }
    .rail {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      font-size: 9px;
    }
    .status-stub { font-size: 9px; top: 10px; }
  }
  @media (max-width: 480px) {
    .begin-btn {
      padding: 18px 24px;
      font-size: 11px;
      letter-spacing: 0.24em;
      gap: 16px;
    }
    .begin-btn .arrow { font-size: 20px; }
  }
</style>
