<!-- src/lib/components/Topbar.svelte -->
<!-- Single sticky shell pill. Brand row + nav row share a background and
     border so they read as one floating element rather than two stacked
     bars. Three icon ovals (endpoints/share/run-details) collapsed to a
     single settings cog per synthesis design contract Section 1. Measuring
     pulse + T+MM:SS elapsed counter integrated near the Stop button. -->
<script lang="ts">
  import { measurementStore } from '$lib/stores/measurements';
  import { endpointStore } from '$lib/stores/endpoints';
  import { settingsStore } from '$lib/stores/settings';
  import { uiStore } from '$lib/stores/ui';
  import type { TestLifecycleState } from '$lib/types';
  import { isStartLifecycle, runStatusText, startStopButtonLabel } from '$lib/utils/lifecycle-copy';
  import ViewSwitcher from './ViewSwitcher.svelte';

  let { onStart, onStop }: {
    onStart?: () => void;
    onStop?: () => void;
  } = $props();

  const lifecycle: TestLifecycleState = $derived($measurementStore.lifecycle);
  const isSharedView: boolean = $derived($uiStore.isSharedView);
  const enabledEndpointCount = $derived($endpointStore.filter((ep) => ep.enabled).length);
  const cap = $derived($settingsStore.cap);
  const timeout = $derived($settingsStore.timeout);
  const startedAt = $derived($measurementStore.startedAt);

  let now = $state(Date.now());

  const isRunning = $derived(lifecycle === 'running');
  const isTransitioning = $derived(lifecycle === 'starting' || lifecycle === 'stopping');
  const isMeasuring = $derived(isRunning || lifecycle === 'starting');

  const runText = $derived(runStatusText(lifecycle));
  const endpointText = $derived(`${enabledEndpointCount} endpoint${enabledEndpointCount === 1 ? '' : 's'}`);
  const timeoutText = $derived(`${Math.round(timeout / 1000)}s timeout`);
  const runSummaryText = $derived(`${endpointText} · ${timeoutText} · cap ${cap}`);

  // T+MM:SS elapsed counter per the synthesis design contract Section 1.
  // Format mm:ss when under an hour, hh:mm:ss otherwise. Shows "T+00:00"
  // during the brief "starting" lifecycle before the first round lands so
  // the live affordance never blinks out.
  const elapsedTickText = $derived.by(() => {
    if (startedAt === null) return 'T+00:00';
    const ms = Math.max(0, now - startedAt);
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      const m = minutes % 60;
      return `T+${String(hours).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `T+${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  // Single Stop/Start label per spec — drops the "Test" suffix.
  const startStopLabel = $derived(startStopButtonLabel(lifecycle));
  const isStartButton = $derived(isStartLifecycle(lifecycle));
  const startStopText = $derived.by(() => {
    if (lifecycle === 'starting') return 'Starting…';
    if (lifecycle === 'stopping') return 'Stopping…';
    return isStartButton ? 'Start' : 'Stop';
  });

  $effect(() => {
    if (lifecycle !== 'running' && lifecycle !== 'starting') return;
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });

  function handleStartStop(): void {
    if (lifecycle === 'running') onStop?.();
    else if (isStartButton) onStart?.();
  }
  function handleRunOwn(): void {
    uiStore.clearSharedView();
    uiStore.setAutoStartSuppressionReason(null);
    measurementStore.reset();
  }
  function handleSettings(): void { uiStore.toggleSettings(); }
  function handleShare(): void { uiStore.toggleShare(); }
</script>

<header class="shell-pill">
  <!-- Brand + run-state + actions row -->
  <div class="shell-row pill-row">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.2" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <line x1="12" y1="12" x2="12" y2="4.5"  stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          <line x1="12" y1="12" x2="17" y2="15"   stroke="currentColor" stroke-width="1"   stroke-linecap="round" opacity="0.7" />
        </svg>
      </div>
      <div class="brand-name">Chronoscope</div>
    </div>

    <!-- Measuring affordance integrated into the pill: cyan pulsing dot +
         T+MM:SS elapsed counter near the Stop button. Renders only while
         a run is active. -->
    {#if isMeasuring}
      <div class="run-status" role="status" aria-live="polite" aria-label={runText}>
        <span class="measuring-dot" aria-hidden="true"></span>
        <span class="measuring-label">Measuring</span>
        <span class="measuring-tick" aria-hidden="true">{elapsedTickText}</span>
      </div>
    {/if}

    <span class="spacer"></span>

    <span class="run-summary" aria-hidden="true">{runSummaryText}</span>

    <nav class="actions" aria-label="Test controls">
      {#if isSharedView}
        <button
          type="button" class="icon-btn"
          aria-label="Share results" aria-expanded={$uiStore.showShare} aria-controls="share-popover"
          onclick={handleShare}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 10V12.5C4 13.052 4.448 13.5 5 13.5H11C11.552 13.5 12 13.052 12 12.5V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 2.5V10M8 2.5L5.5 5M8 2.5L10.5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button type="button" class="run-btn start run-own" aria-label="Run your own test" onclick={handleRunOwn}>
          Run your own test
        </button>
      {:else}
        <!-- Single settings cog replaces the prior three icon ovals
             (endpoints / settings / share / run-details). SettingsDrawer
             provides the consolidated overlay sheet with Quick actions
             section linking to endpoint management, share, and run
             details — see synthesis design contract Section 1. -->
        <button
          type="button" class="icon-btn"
          aria-label="Open settings" aria-expanded={$uiStore.showSettings} aria-controls="settings-drawer"
          onclick={handleSettings}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.3"/>
            <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button
          type="button"
          class="run-btn"
          class:start={isStartButton}
          class:stop={isRunning}
          disabled={isTransitioning}
          aria-disabled={isTransitioning}
          aria-label={startStopLabel}
          onclick={handleStartStop}
        >
          <span class="run-btn-icon" aria-hidden="true">{isRunning ? '■' : '▶'}</span>
          <span>{startStopText}</span>
        </button>
      {/if}
    </nav>
  </div>

  <!-- ViewSwitcher renders as the second row of the same pill. Shared
       background + no internal divider so the two rows read as one
       floating element. The pill itself sits sticky-top via .shell-pill. -->
  <ViewSwitcher />
</header>

<style>
  .shell-pill {
    position: relative;
    z-index: 50;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: var(--shell-backdrop);
    backdrop-filter: var(--shell-topbar-backdrop);
    -webkit-backdrop-filter: var(--shell-topbar-backdrop);
    border-bottom: 1px solid var(--shell-border);
    color: var(--t1);
  }

  .pill-row {
    min-height: var(--shell-topbar-height, 60px);
    padding: 0 18px;
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-mark {
    width: 36px; height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan), black 40%));
    border: 0;
    display: grid; place-items: center;
    color: var(--shell-bg);
    flex-shrink: 0;
    box-shadow: 0 0 24px color-mix(in srgb, var(--accent-cyan) 22%, transparent);
  }
  .brand-mark svg circle { display: none; }
  .brand-name {
    font-family: var(--sans);
    font-weight: 800;
    font-size: 17px;
    letter-spacing: var(--tr-tight);
    color: var(--t1);
    text-transform: none;
  }

  /* Measuring affordance — cyan pulsing dot + T+MM:SS counter. Integrated
     into the pill row near the Stop button per synthesis design contract. */
  .run-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--shell-bg-cyan);
    border: 1px solid var(--shell-border-strong);
    color: var(--accent-cyan);
    font-family: var(--mono);
    font-size: var(--ts-xs);
    font-weight: 700;
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
    line-height: 1;
  }
  .measuring-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-cyan);
    box-shadow: 0 0 12px var(--accent-cyan);
    animation: measuring-pulse 1.4s ease-in-out infinite;
  }
  @keyframes measuring-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  .measuring-label { color: var(--accent-cyan); }
  .measuring-tick {
    margin-left: 4px;
    padding-left: 10px;
    border-left: 1px solid var(--shell-border-strong);
    color: var(--t1);
    font-variant-numeric: tabular-nums;
  }

  .spacer { flex: 1; }

  .run-summary {
    font-family: var(--mono);
    font-size: var(--ts-xs);
    color: var(--t4);
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--shell-border);
    background: transparent;
    color: var(--t2);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
  }
  .icon-btn:hover {
    background: var(--shell-panel-hover);
    color: var(--t1);
    border-color: var(--shell-border-strong);
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 2px;
  }

  .run-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid transparent;
    font-family: var(--sans);
    font-weight: 700;
    font-size: var(--ts-sm);
    cursor: pointer;
    transition: background 160ms ease, color 160ms ease;
    line-height: 1;
  }
  .run-btn.start {
    background: var(--t1);
    color: var(--shell-bg);
  }
  .run-btn.start:hover {
    background: color-mix(in srgb, var(--t1) 92%, transparent);
  }
  .run-btn.stop {
    background: var(--shell-stop-bg);
    color: var(--accent-pink);
    border-color: var(--shell-stop-border);
  }
  .run-btn.stop:hover {
    background: color-mix(in srgb, var(--accent-pink) 18%, transparent);
  }
  .run-btn.run-own {
    background: var(--t1);
    color: var(--shell-bg);
  }
  .run-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .run-btn-icon {
    font-size: 11px;
    line-height: 1;
  }
  .run-btn:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .measuring-dot { animation: none; }
    .icon-btn, .run-btn { transition: none; }
  }

  @media (max-width: 767px) {
    .pill-row { padding: 0 12px; gap: 10px; min-height: 54px; }
    .brand-name { font-size: 15px; }
    .brand-mark { width: 32px; height: 32px; border-radius: 8px; }
    .run-summary { display: none; }
    .measuring-label { display: none; }
  }
</style>
