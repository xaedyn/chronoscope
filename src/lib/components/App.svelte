<!-- src/lib/components/App.svelte -->
<!-- Root application component. Bootstraps tokens, persistence, engine, and    -->
<!-- wires all child components together.                                         -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { tokens } from '$lib/tokens';
  import { settingsStore } from '$lib/stores/settings';
  import { endpointStore, buildDefaultEndpoints } from '$lib/stores/endpoints';
  import { historyStore } from '$lib/stores/history';
  import { measurementStore } from '$lib/stores/measurements';
  import { statisticsStore } from '$lib/stores/statistics';
  import { uiStore } from '$lib/stores/ui';
  import { MeasurementEngine } from '$lib/engine/measurement-engine';
  import { detectRegion } from '$lib/regional-defaults';
  import { applyPersistedSettings } from '$lib/utils/apply-persisted-settings';
  import { loadPersistedSettings, saveSettings, CURRENT_VERSION } from '$lib/utils/persistence';
  import { initHashRouter, initHostedReportRouter } from '$lib/share/hash-router';
  import { initRouter } from '$lib/router';
  import { initShortcuts } from '$lib/utils/shortcuts';
  import { autoStartDecision } from '$lib/utils/status-intent';
  import type { PersistedSettings } from '$lib/types';
  import Layout from './Layout.svelte';
  import LandingView from './LandingView.svelte';
  import SettingsDrawer from './SettingsDrawer.svelte';
  import SharePopover from './SharePopover.svelte';
  import SharedResultsBanner from './SharedResultsBanner.svelte';
  import ConfigStagingBanner from './ConfigStagingBanner.svelte';
  import EndpointDrawer from './EndpointDrawer.svelte';
  import KeyboardOverlay from './KeyboardOverlay.svelte';

  let engine: MeasurementEngine | null = null;

  // ── Landing gate ────────────────────────────────────────────────────────────
  // Show the marketing/onboarding LandingView on true first visit only. The
  // gate clears once the user clicks Begin (which writes the localStorage flag
  // and starts the engine) or Explore (which writes the flag and navigates).
  // After that, Layout takes over forever on this device. Cold-visit / empty
  // states are handled inside OverviewView by a separate agent.
  //
  // We read the flag synchronously at $state declaration so the FIRST render
  // already mounts the right surface (no Landing → Layout swap on mount, which
  // would create + destroy a WebGL context unnecessarily for returning
  // visitors, and would break tests that don't expect LandingView to mount).
  function readOnboardedFlag(): boolean {
    if (typeof localStorage === 'undefined') return true;
    try {
      return localStorage.getItem('chronoscope-onboarded') === 'true';
    } catch {
      return true;
    }
  }

  let onboardedFlag = $state(readOnboardedFlag());

  const showLanding = $derived(
    !onboardedFlag
      && !$uiStore.isSharedView
      && $uiStore.pendingShare === null
      && $measurementStore.lifecycle === 'idle'
      && $measurementStore.roundCounter === 0,
  );

  function handleLandingStart(): void {
    // Mirror handleStart but also clear the gate so Layout takes over.
    onboardedFlag = true;
    handleStart();
  }

  function handleLandingExplore(): void {
    // Explore path: localStorage already written by LandingView. Flip the
    // in-memory gate so showLanding becomes false this tick.
    onboardedFlag = true;
  }

  // ── Bridge tokens to CSS custom properties (Vessel v4) ─────────────────────
  // Emits v4 canonical CSS variable names only. No bridge aliases — every var
  // here has exactly one name. v3 emissions (--accent-*, --t1..--t5, --shell-*,
  // --bg-base, --border-mid, --status-timeout, --svg-threshold) were dropped
  // when their tokens were retired; callsites migrated in the Phase A sweep.
  function bridgeTokensToCss(): void {
    const root = document.documentElement;

    // Background tiers
    root.style.setProperty('--bg',   tokens.color.surface.base);
    root.style.setProperty('--bg-2', tokens.color.surface.mid);
    root.style.setProperty('--bg-3', tokens.color.surface.raised);
    root.style.setProperty('--bg-4', tokens.color.surface.elevated);

    // Foreground tiers
    root.style.setProperty('--fg',   tokens.color.text.fg);
    root.style.setProperty('--fg-2', tokens.color.text.fg2);
    root.style.setProperty('--fg-3', tokens.color.text.fg3);
    root.style.setProperty('--fg-4', tokens.color.text.fg4);

    // Rules
    root.style.setProperty('--rule',        tokens.color.surface.border.mid);
    root.style.setProperty('--rule-strong', tokens.color.surface.border.bright);
    root.style.setProperty('--rule-faint',  tokens.color.surface.border.dim);

    // Stations
    root.style.setProperty('--station-a', tokens.color.station.A);
    root.style.setProperty('--station-b', tokens.color.station.B);
    root.style.setProperty('--station-c', tokens.color.station.C);
    root.style.setProperty('--station-d', tokens.color.station.D);

    // Severity
    root.style.setProperty('--sev-warn', tokens.color.severity.warn);
    root.style.setProperty('--sev-bad',  tokens.color.severity.bad);
    root.style.setProperty('--sev-crit', tokens.color.severity.crit);

    // Phase decomposition
    root.style.setProperty('--phase-dns',  tokens.color.phase.dns);
    root.style.setProperty('--phase-tcp',  tokens.color.phase.tcp);
    root.style.setProperty('--phase-tls',  tokens.color.phase.tls);
    root.style.setProperty('--phase-ttfb', tokens.color.phase.ttfb);
    root.style.setProperty('--phase-xfer', tokens.color.phase.xfer);

    // Bg variants (interaction states + modal backdrops)
    root.style.setProperty('--bg-hover',    tokens.color.shell.panelHover);
    root.style.setProperty('--bg-active',   tokens.color.shell.panelActive);
    root.style.setProperty('--bg-backdrop', tokens.color.shell.backdrop);
    root.style.setProperty('--bg-overlay',  tokens.color.surface.overlay);
    root.style.setProperty('--bg-popover',  tokens.color.shell.popover);

    // Tinted backgrounds (station-B and sev-warn at low alpha)
    root.style.setProperty('--station-b-bg', tokens.color.shell.bgCyan);
    root.style.setProperty('--sev-warn-bg',  tokens.color.shell.bgAmber);

    // Banner surfaces
    root.style.setProperty('--success-bg',     tokens.color.shell.successBg);
    root.style.setProperty('--success-border', tokens.color.shell.successBorder);
    root.style.setProperty('--stop-bg',        tokens.color.shell.stopBg);
    root.style.setProperty('--stop-border',    tokens.color.shell.stopBorder);

    // Glass surfaces (kept from infrastructure; values updated to bone-white)
    root.style.setProperty('--glass-bg',               tokens.color.glass.bg);
    root.style.setProperty('--glass-border',           tokens.color.glass.border);
    root.style.setProperty('--glass-highlight',        tokens.color.glass.highlight);
    root.style.setProperty('--glass-bg-rail-hover',    tokens.color.glass.bgRailHover);
    root.style.setProperty('--glass-bg-rail-selected', tokens.color.glass.bgRailSelected);

    // Fonts
    root.style.setProperty('--sans', tokens.typography.sans.fontFamily);
    root.style.setProperty('--mono', tokens.typography.mono.fontFamily);

    // Spacing
    root.style.setProperty('--spacing-xs', `${tokens.spacing.xs}px`);
    root.style.setProperty('--spacing-sm', `${tokens.spacing.sm}px`);
    root.style.setProperty('--spacing-md', `${tokens.spacing.md}px`);
    root.style.setProperty('--spacing-lg', `${tokens.spacing.lg}px`);
    root.style.setProperty('--spacing-xl', `${tokens.spacing.xl}px`);

    // Radius
    root.style.setProperty('--radius-xs', `${tokens.radius.xs}px`);
    root.style.setProperty('--radius-sm', `${tokens.radius.sm}px`);
    root.style.setProperty('--radius-md', `${tokens.radius.md}px`);
    root.style.setProperty('--radius-lg', `${tokens.radius.lg}px`);

    // Typography scale + tracking
    root.style.setProperty('--ts-xs',   tokens.typography.scale.xs);
    root.style.setProperty('--ts-sm',   tokens.typography.scale.sm);
    root.style.setProperty('--ts-md',   tokens.typography.scale.md);
    root.style.setProperty('--ts-base', tokens.typography.scale.base);
    root.style.setProperty('--ts-lg',   tokens.typography.scale.lg);
    root.style.setProperty('--ts-xl',   tokens.typography.scale.xl);
    root.style.setProperty('--ts-2xl',  tokens.typography.scale.xl2);
    root.style.setProperty('--tr-kicker', tokens.typography.tracking.kicker);
    root.style.setProperty('--tr-label',  tokens.typography.tracking.label);
    root.style.setProperty('--tr-tight',  tokens.typography.tracking.tight);
    root.style.setProperty('--tr-body',   tokens.typography.tracking.body);

    // Shell structural chrome (dimensions, filters, shadows — non-color)
    root.style.setProperty('--topbar-height',                `${tokens.lane.topbarHeight}px`);
    root.style.setProperty('--rail-width',                   `${tokens.lane.railWidth}px`);
    root.style.setProperty('--shell-topbar-height',          `${tokens.shell.topbarHeight}px`);
    root.style.setProperty('--shell-popover-width',          `${tokens.shell.popoverWidth}px`);
    root.style.setProperty('--shell-topbar-backdrop',         tokens.shell.topbarBackdropFilter);
    root.style.setProperty('--shell-popover-backdrop',        tokens.shell.popoverBackdropFilter);
    root.style.setProperty('--shell-brand-highlight-shadow',  tokens.shell.brandHighlightShadow);
    root.style.setProperty('--shell-nav-height',             `${tokens.shell.navHeight}px`);
    root.style.setProperty('--shell-control-size',           `${tokens.shell.controlSize}px`);
    root.style.setProperty('--shell-mobile-control-size',    `${tokens.shell.mobileControlSize}px`);
    root.style.setProperty('--content-max-w',                `${tokens.shell.contentMaxWidth}px`);

    // Tooltip surfaces (kept from v2; values updated to bone-white)
    root.style.setProperty('--tooltip-bg-deep', tokens.color.tooltip.bgDeep);
    root.style.setProperty('--tooltip-border',  tokens.color.tooltip.border);
    root.style.setProperty('--tooltip-text',    tokens.color.tooltip.text);

    // SVG primitives (kept from v2; values updated to bone-white)
    root.style.setProperty('--svg-grid-line',   tokens.color.svg.gridLine);
    root.style.setProperty('--svg-grid-cyan',   tokens.color.svg.gridLineCyan);
    root.style.setProperty('--svg-grid-major',  tokens.color.svg.gridLineMajor);
    root.style.setProperty('--svg-tick-minor',  tokens.color.svg.tickMinor);
    root.style.setProperty('--svg-tick-major',  tokens.color.svg.tickMajor);
    root.style.setProperty('--svg-hand-stroke', tokens.color.svg.handStroke);
    root.style.setProperty('--svg-dial-rim',    tokens.color.svg.dialRim);
    root.style.setProperty('--svg-orbit-track', tokens.color.svg.orbitTrack);
    root.style.setProperty('--svg-orbit-edge',  tokens.color.svg.orbitEdge);

    // Motion timings + shadows
    root.style.setProperty('--timing-pulse-rim',       `${tokens.timing.pulseRim}ms`);
    root.style.setProperty('--timing-pulse-dial-glow', `${tokens.timing.pulseDialGlow}ms`);
    root.style.setProperty('--timing-btn',             `${tokens.timing.btnHover}ms`);
    root.style.setProperty('--shadow-popover',          tokens.shadow.popover);
  }

  // ── Persistence save subscription ───────────────────────────────────────────
  let unsubSettings: (() => void) | null = null;
  let unsubEndpoints: (() => void) | null = null;
  let unsubUi: (() => void) | null = null;
  let unsubHistoryLifecycle: (() => void) | null = null;
  let destroyShortcuts: (() => void) | null = null;

  let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function setupPersistenceSync(): void {
    function persist(): void {
      // Skip saves when in shared view — don't overwrite user's settings with shared config
      const ui = get(uiStore);
      if (ui.isSharedView) return;

      const settings = get(settingsStore);
      const endpoints = get(endpointStore);

      const payload: PersistedSettings = {
        version: CURRENT_VERSION,
        endpoints: endpoints.map(ep => ({ url: ep.url, enabled: ep.enabled })),
        settings,
        ui: {
          expandedCards: [...ui.expandedCards],
          activeView: ui.activeView,
          focusedEndpointId: ui.focusedEndpointId,
          liveOptions: ui.liveOptions,
          terminalFilters: [...ui.terminalFilters],
        },
      };
      saveSettings(payload);
    }

    function debouncedPersist(): void {
      if (persistDebounceTimer !== null) clearTimeout(persistDebounceTimer);
      persistDebounceTimer = setTimeout(persist, 500);
    }

    unsubSettings = settingsStore.subscribe(debouncedPersist);
    unsubEndpoints = endpointStore.subscribe(debouncedPersist);
    unsubUi = uiStore.subscribe(debouncedPersist);
  }

  // ── Engine lifecycle wiring ──────────────────────────────────────────────────
  // Controls.svelte transitions lifecycle to 'starting'/'stopping'.
  // We watch those transitions and drive the engine accordingly.
  // Note: engine.start() expects 'idle'|'stopped'; when Controls sets 'starting',
  // we call engine.start() from the previous tick, so we track prior lifecycle.
  function handleStart(): void {
    if (!engine) return;
    uiStore.setAutoStartSuppressionReason(null);
    engine.start();
  }

  function handleStop(): void {
    if (!engine) return;
    engine.stop();
  }

  function setupHistorySync(): void {
    void historyStore.hydrate();

    let prevLifecycle = get(measurementStore).lifecycle;
    unsubHistoryLifecycle = measurementStore.subscribe((state) => {
      const cur = state.lifecycle;
      const prev = prevLifecycle;
      prevLifecycle = cur;

      const endedLocalRun = (cur === 'stopped' || cur === 'completed')
        && (prev === 'running' || prev === 'stopping');
      if (!endedLocalRun || get(uiStore).isSharedView) return;

      void historyStore.recordSession({
        endpoints: get(endpointStore),
        measurements: state,
        stats: get(statisticsStore),
        settings: get(settingsStore),
      });
    });
  }

  // ── Mount ────────────────────────────────────────────────────────────────────
  async function bootstrap(): Promise<void> {
    // 1. Bridge tokens to CSS custom properties
    bridgeTokensToCss();

    // 2. Check for share URL — takes priority over persisted settings
    let shareMode = initHashRouter();
    if (shareMode === null) {
      shareMode = await initHostedReportRouter();
    }

    // 3. Load persisted settings. Skip ONLY for results-mode shares — those
    //    mutate the stores (endpoints + measurement snapshot) for read-only
    //    display, and re-applying persistence on top would clobber the
    //    snapshot. Config-mode shares stage in uiStore.pendingShare without
    //    touching the stores, so the user's saved endpoints / settings still
    //    need to load and render behind the staging banner.
    if (shareMode !== 'results') {
      const persisted = loadPersistedSettings();

      if (persisted) {
        // 3a. Apply persisted state
        applyPersistedSettings(persisted);
      } else {
        // First install: seed region-aware defaults (AC1)
        const detected = detectRegion();
        endpointStore.setEndpoints(buildDefaultEndpoints(detected));
        settingsStore.update(s => ({ ...s, region: detected }));
      }
    }

    // 4. URL routing — the URL is authoritative for activeView from here
    //    on. Runs AFTER persistence so it can override any persisted
    //    activeView; runs BEFORE engine creation so views mount with the
    //    correct route already wired. focusedEndpointId is preserved across
    //    non-endpoint navigations (LiveView solo-mode, Report highlighting,
    //    persisted-focus rehydration all continue to own that field for
    //    their own in-page focus needs). See src/lib/router.ts for the
    //    full contract.
    initRouter();

    // 5. Create engine
    engine = new MeasurementEngine();

    // 6. Setup persistence sync
    setupPersistenceSync();

    // 7. Local-only history baselines
    setupHistorySync();

    // 8. Register keyboard shortcuts
    destroyShortcuts = initShortcuts();

    // 9. Safe auto-start for ordinary public sessions only — but suppress
    //    when the user hasn't onboarded yet (we want them to see ColdVisit /
    //    LandingView and click Begin themselves). Returning visitors with the
    //    onboarded flag set still auto-start as before.
    const ui = get(uiStore);
    const decision = autoStartDecision({
      endpoints: get(endpointStore),
      isSharedView: ui.isSharedView,
      sharedReportMode: ui.sharedReportMode,
      hasPendingShare: ui.pendingShare !== null,
    });
    uiStore.setAutoStartSuppressionReason(decision.reason);

    // Also suppress auto-start when the localStorage onboarded flag is absent:
    // first-time visitors should see LandingView (or ColdVisit) and click Begin
    // explicitly. The onStart handler fires engine.start() and writes the flag,
    // so subsequent visits auto-start.
    const onboarded = (() => {
      try {
        return localStorage.getItem('chronoscope-onboarded') === 'true';
      } catch {
        return true; // SSR / no-localStorage safety: don't trap users
      }
    })();

    if (decision.shouldStart && onboarded) {
      engine.start();
    }
  }

  onMount(() => {
    void bootstrap().catch((error) => {
      console.warn('[Chronoscope] App bootstrap failed:', error);
    });
  });

  onDestroy(() => {
    engine?.stop();
    unsubSettings?.();
    unsubEndpoints?.();
    unsubUi?.();
    unsubHistoryLifecycle?.();
    destroyShortcuts?.();
    if (persistDebounceTimer !== null) clearTimeout(persistDebounceTimer);
  });
</script>

<div id="chronoscope-root">
  {#if showLanding}
    <!-- First-visit marketing/onboarding surface. Replaces the app shell
         entirely (no banner / drawer / popover mounts) until the user clicks
         Begin or Explore. -->
    <LandingView onStart={handleLandingStart} onExplore={handleLandingExplore} />
  {:else}
    {#if $uiStore.pendingShare}
      <ConfigStagingBanner />
    {:else if $uiStore.isSharedView && !$uiStore.sharedReportMode}
      <SharedResultsBanner />
    {/if}
    <Layout onStart={handleStart} onStop={handleStop} />
    {#if $uiStore.showSettings}
      <SettingsDrawer />
    {/if}
    {#if $uiStore.showEndpoints}
      <EndpointDrawer />
    {/if}
    {#if $uiStore.showShare}
      <SharePopover />
    {/if}
    {#if $uiStore.showKeyboardHelp}
      <KeyboardOverlay />
    {/if}
  {/if}
</div>

<style>
  #chronoscope-root {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
