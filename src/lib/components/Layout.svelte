<!-- src/lib/components/Layout.svelte -->
<!-- App shell. Vessel v4 masthead + top-level nav + active content.            -->
<!-- Routes activeView to Overview / Live / Investigate / Report. The legacy   -->
<!-- Lanes family was retired in Phase 7 — the v6→v7 migration rewrites         -->
<!-- 'lanes' / 'timeline' / 'heatmap' / 'split' to 'overview' so nothing        -->
<!-- reaches here.                                                              -->
<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { measurementStore } from '$lib/stores/measurements';
  import { endpointStore } from '$lib/stores/endpoints';
  import { uiStore } from '$lib/stores/ui';
  import { currentRoute, subscribeRoute, type RouteState } from '$lib/router';
  import Masthead from './Masthead.svelte';

  type RouteSurface = 'overview' | 'live' | 'diagnose' | 'endpoint' | 'report' | 'transit';
  type RouteComponent = Component<Record<string, never>>;
  type RouteModule = { default: RouteComponent };

  const routeLoaders: Record<RouteSurface, () => Promise<RouteModule>> = {
    overview: () => import('./OverviewView.svelte'),
    live: () => import('./LiveView.svelte'),
    diagnose: () => import('./DiagnoseView.svelte'),
    endpoint: () => import('./EndpointView.svelte'),
    report: () => import('./ReportView.svelte'),
    transit: () => import('./TransitView.svelte'),
  };

  let { onStart, onStop }: {
    onStart?: () => void;
    onStop?: () => void;
  } = $props();

  let announcerText = $state('');
  let prevLifecycle = get(measurementStore).lifecycle;
  let unsubLifecycle: (() => void) | null = null;

  function announce(msg: string): void {
    announcerText = '';
    setTimeout(() => { announcerText = msg; }, 50);
  }

  const activeView = $derived($uiStore.activeView);
  const sharedReportMode = $derived($uiStore.isSharedView && $uiStore.sharedReportMode);
  const focusedEndpointId = $derived($uiStore.focusedEndpointId);

  // Track router state so we can render the v4 EndpointView surface for the
  // /endpoint/:id route — distinct from the /investigate landing surface that
  // DiagnoseView serves. Both routes resolve activeView === 'diagnose'.
  let route = $state<RouteState>(currentRoute());
  $effect(() => {
    const off = subscribeRoute((next) => { route = next; });
    return off;
  });
  const isEndpointRoute = $derived(route.name === 'endpoint');
  const showEndpointSurface = $derived(
    activeView === 'diagnose' && focusedEndpointId !== null && isEndpointRoute,
  );
  const activeSurface = $derived.by<RouteSurface>(() => {
    if (sharedReportMode) return 'report';
    if (activeView === 'live') return 'live';
    if (showEndpointSurface) return 'endpoint';
    if (activeView === 'diagnose') return 'diagnose';
    if (activeView === 'report') return 'report';
    if (activeView === 'transit') return 'transit';
    return 'overview';
  });
  let LoadedSurface = $state<RouteComponent | null>(null);
  let loadedSurfaceName = $state<RouteSurface | null>(null);
  let surfaceLoadError = $state<string | null>(null);
  let surfaceLoadRetry = $state(0);

  function retrySurfaceLoad(): void {
    surfaceLoadError = null;
    surfaceLoadRetry += 1;
  }

  $effect(() => {
    const surface = activeSurface;
    const loadAttempt = surfaceLoadRetry;
    let cancelled = false;
    LoadedSurface = null;
    loadedSurfaceName = null;
    surfaceLoadError = null;

    routeLoaders[surface]().then((mod) => {
      if (cancelled) return;
      LoadedSurface = mod.default;
      loadedSurfaceName = surface;
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.warn(`[Chronoscope] Failed to load route surface (${surface}:${loadAttempt}):`, error);
        LoadedSurface = null;
        loadedSurfaceName = null;
        surfaceLoadError = 'Instrument surface failed to load.';
      }
    });

    return () => { cancelled = true; };
  });

  onMount(() => {
    unsubLifecycle = measurementStore.subscribe((state) => {
      const cur = state.lifecycle;
      const prev = prevLifecycle;
      if (prev !== 'running' && cur === 'running') {
        const n = get(endpointStore).filter(ep => ep.enabled).length;
        announce(`Test started with ${n} endpoint${n === 1 ? '' : 's'}`);
      } else if (prev === 'running' && cur === 'stopping') {
        announce(`Test stopped after ${state.roundCounter} ${state.roundCounter === 1 ? 'round' : 'rounds'}`);
      } else if (prev !== 'completed' && cur === 'completed') {
        announce(`Test completed after ${state.roundCounter} ${state.roundCounter === 1 ? 'round' : 'rounds'}`);
      }
      prevLifecycle = cur;
    });
  });

  onDestroy(() => { unsubLifecycle?.(); });
</script>

<a href="#main-content" class="skip-link">Skip to main content</a>

<div class="bg" aria-hidden="true"></div>

<div class="app">
  <Masthead {onStart} {onStop} />

  {#if sharedReportMode}
    <main id="main-content" class="shell-main report-main" tabindex="-1">
      {#if LoadedSurface && loadedSurfaceName === activeSurface}
        <LoadedSurface />
      {:else if surfaceLoadError}
        <div class="route-loading route-error" role="alert">
          <span>{surfaceLoadError}</span>
          <button type="button" onclick={retrySurfaceLoad}>Retry</button>
        </div>
      {:else}
        <div class="route-loading" role="status">Loading instrument surface...</div>
      {/if}
    </main>
  {:else}
    <div class="shell-body">
      <div class="shell-main-wrap">
        <main id="main-content" class="shell-main" tabindex="-1">
          {#if LoadedSurface && loadedSurfaceName === activeSurface}
            <LoadedSurface />
          {:else if surfaceLoadError}
            <div class="route-loading route-error" role="alert">
              <span>{surfaceLoadError}</span>
              <button type="button" onclick={retrySurfaceLoad}>Retry</button>
            </div>
          {:else}
            <div class="route-loading" role="status">Loading instrument surface...</div>
          {/if}
        </main>
      </div>
    </div>
  {/if}
</div>

<div
  id="chronoscope-announcer"
  role="status"
  aria-live="polite"
  aria-atomic="true"
  class="sr-only"
>{announcerText}</div>

<style>
  .skip-link {
    position: absolute; top: -40px; left: 0; z-index: 9999;
    padding: 8px 16px; background: var(--station-b); color: var(--bg);
    font-weight: 600; text-decoration: none;
    border-radius: 0 0 4px 0; transition: top 100ms ease;
  }
  .skip-link:focus { top: 0; }

  /* v2 aesthetic arc PR 3: page bg is solid black. The prior linear
     gradient and corner radial-gradient orbs both banded on dark per
     [[feedback_dark_backgrounds]]; v2 simply uses a flat bg-black body.
     Solid colour is the only banding-safe option without a pre-dithered
     raster, which is overkill for this surface. */
  .bg {
    position: fixed; inset: 0; z-index: 0;
    background: var(--bg);
  }

  .app {
    position: relative; z-index: 1;
    /* 100svh is the "small" viewport height — worst-case browser chrome shown.
       Using svh (not dvh) keeps the shell static during scroll-driven URL-bar
       animations on iOS Safari, which would otherwise re-flow text every
       frame. 100vh was wrong on iOS (calculated against URL-bar-hidden
       viewport, so shells clipped on first paint). */
    height: 100svh;
    display: flex; flex-direction: column;
    overflow: hidden;
    color: var(--fg);
  }

  .shell-body {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
  }

  .shell-main-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .shell-main {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .shell-main:focus { outline: none; }
  .report-main {
    flex: 1;
    min-height: 0;
  }
  .route-loading {
    flex: 1;
    display: grid;
    place-items: center;
    gap: 14px;
    min-height: 320px;
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .route-error {
    color: var(--fg-2);
  }
  .route-error button {
    border: 1px solid var(--rule-strong);
    background: var(--fg);
    color: var(--bg);
    padding: 9px 14px;
    font: inherit;
    font-size: 9px;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  .route-error button:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  .sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap; border: 0;
  }
</style>
