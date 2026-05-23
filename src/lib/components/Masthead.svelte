<!-- src/lib/components/Masthead.svelte -->
<!-- Vessel v4 masthead. 3-column grid (brand | nav | controls), sticky with
     blurred backdrop, replaces Topbar.svelte's floating-pill design from v2.
     Nav routes through navigateTo() so the URL stays in sync. -->
<script lang="ts">
  import { measurementStore } from '$lib/stores/measurements';
  import { uiStore } from '$lib/stores/ui';
  import { navigateTo } from '$lib/router';
  import type { ActiveView, TestLifecycleState } from '$lib/types';
  import { isStartLifecycle, startStopButtonLabel } from '$lib/utils/lifecycle-copy';

  let { onStart, onStop }: {
    onStart?: () => void;
    onStop?: () => void;
  } = $props();

  type NavRoute = 'overview' | 'live' | 'investigate' | 'report';
  interface NavDef {
    readonly id: ActiveView;
    readonly route: NavRoute;
    readonly label: string;
  }

  const NAV: readonly NavDef[] = [
    { id: 'overview', route: 'overview',    label: 'Overview' },
    { id: 'live',     route: 'live',        label: 'Live' },
    { id: 'diagnose', route: 'investigate', label: 'Investigate' },
    { id: 'report',   route: 'report',      label: 'Report' },
  ];

  const lifecycle: TestLifecycleState = $derived($measurementStore.lifecycle);
  const activeView: ActiveView = $derived($uiStore.activeView);
  const isSharedView: boolean = $derived($uiStore.isSharedView);

  const isRunning = $derived(lifecycle === 'running');
  const isTransitioning = $derived(lifecycle === 'starting' || lifecycle === 'stopping');
  const isStartButton = $derived(isStartLifecycle(lifecycle));
  const startStopLabel = $derived(startStopButtonLabel(lifecycle));

  // Carrier tag: acquired (running) or stopped (everything else). The alarm
  // state (carrier-lost / error) will wire in when the error-state surface
  // lands in Phase C — TestLifecycleState has no error member today.
  type CarrierState = 'acquired' | 'stopped';
  const carrierState: CarrierState = $derived(isRunning ? 'acquired' : 'stopped');
  const carrierLabel = $derived(
    carrierState === 'acquired' ? 'Carrier acquired' : 'Carrier idle'
  );

  const startStopText = $derived.by(() => {
    if (lifecycle === 'starting') return 'Starting…';
    if (lifecycle === 'stopping') return 'Stopping…';
    return isStartButton ? 'Begin' : 'End session';
  });

  function selectRoute(route: NavRoute): void {
    navigateTo({ name: route, endpointId: null });
  }
  function isActive(id: ActiveView): boolean {
    return activeView === id;
  }
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

<header class="masthead">
  <div class="brand">
    <span class="crest" aria-hidden="true"></span>
    <span class="brand-name">Chronoscope</span>
    <span class="brand-tag">Synchronized HTTP latency observation</span>
  </div>

  <nav class="nav" aria-label="Primary">
    {#each NAV as item (item.id)}
      {@const active = isActive(item.id)}
      <button
        type="button"
        class="nav-link"
        class:active
        aria-current={active ? 'page' : undefined}
        onclick={() => selectRoute(item.route)}
      >
        {item.label}
      </button>
    {/each}
  </nav>

  <div class="controls">
    <span class="carrier-tag" data-state={carrierState} role="status" aria-live="polite">
      <span class="carrier-dot" aria-hidden="true"></span>
      <span class="carrier-label">{carrierLabel}</span>
    </span>

    <button
      type="button" class="ctl-icon"
      aria-label="Open settings"
      aria-expanded={$uiStore.showSettings}
      aria-controls="settings-drawer"
      onclick={handleSettings}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
        <circle cx="7" cy="7" r="2"/>
        <path d="M7 1.5 V3 M7 11 V12.5 M1.5 7 H3 M11 7 H12.5 M3.1 3.1 L4.1 4.1 M9.9 9.9 L10.9 10.9 M3.1 10.9 L4.1 9.9 M9.9 4.1 L10.9 3.1"/>
      </svg>
    </button>

    {#if isSharedView}
      <button
        type="button" class="ctl-btn"
        aria-label="Share results"
        aria-expanded={$uiStore.showShare}
        aria-controls="share-popover"
        onclick={handleShare}
      >
        Share
      </button>
      <button type="button" class="ctl-btn ctl-btn--primary" onclick={handleRunOwn}>
        Run your own test
      </button>
    {:else}
      <button
        type="button"
        class="ctl-btn"
        class:ctl-btn--stop={isRunning}
        class:ctl-btn--primary={isStartButton}
        disabled={isTransitioning}
        aria-disabled={isTransitioning}
        aria-label={startStopLabel}
        onclick={handleStartStop}
      >
        {startStopText}
      </button>
      <button
        type="button" class="ctl-btn"
        aria-label="Share results"
        aria-expanded={$uiStore.showShare}
        aria-controls="share-popover"
        onclick={handleShare}
      >
        Share
      </button>
    {/if}
  </div>
</header>

<style>
  .masthead {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
    padding: 14px clamp(20px, 3vw, 48px);
    background: var(--bg-backdrop);
    backdrop-filter: var(--shell-topbar-backdrop);
    -webkit-backdrop-filter: var(--shell-topbar-backdrop);
    border-bottom: 1px solid var(--rule);
    position: sticky;
    top: 0;
    z-index: 50;
    color: var(--fg);
  }

  /* Brand cluster — crest + name + tag. Tag hides on narrow viewports. */
  .brand {
    display: flex;
    align-items: baseline;
    gap: 12px;
    font-family: var(--mono);
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    min-width: 0;
  }
  .crest {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 1.2px solid var(--fg);
    border-radius: 50%;
    position: relative;
    transform: translateY(1px);
    flex-shrink: 0;
  }
  .crest::after {
    content: '';
    position: absolute;
    width: 1.2px;
    height: 5px;
    background: var(--fg);
    top: 1.5px;
    left: calc(50% - 0.6px);
    transform-origin: 50% 100%;
    transform: rotate(42deg);
  }
  .brand-name {
    color: var(--fg);
  }
  .brand-tag {
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.02em;
    text-transform: none;
    color: var(--fg-2);
    margin-left: 14px;
    padding-left: 14px;
    border-left: 1px solid var(--rule);
  }

  /* Primary nav — text links, no boxes. Active link has a 1px underline. */
  .nav {
    display: flex;
    gap: 26px;
    justify-content: center;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .nav-link {
    background: none;
    border: 0;
    color: var(--fg-3);
    padding: 4px 0;
    border-bottom: 1px solid transparent;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    transition: color 120ms, border-color 120ms;
  }
  .nav-link:hover {
    color: var(--fg);
    border-bottom-color: var(--rule-strong);
  }
  .nav-link.active {
    color: var(--fg);
    border-bottom-color: var(--fg);
  }
  .nav-link:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  /* Right cluster — carrier tag + icon + action buttons. */
  .controls {
    display: flex;
    align-items: center;
    gap: 14px;
    justify-self: end;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }

  /* Carrier-tag: status dot + label. Three states encode lifecycle. */
  .carrier-tag {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .carrier-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .carrier-tag[data-state="acquired"] {
    color: var(--station-b);
  }
  .carrier-tag[data-state="acquired"] .carrier-dot {
    background: var(--station-b);
    box-shadow: 0 0 10px var(--station-b);
    animation: carrier-pulse 2400ms ease-in-out infinite;
  }
  .carrier-tag[data-state="stopped"] {
    color: var(--fg-3);
  }
  .carrier-tag[data-state="stopped"] .carrier-dot {
    background: var(--fg-3);
    border-radius: 0;
    width: 7px;
    height: 7px;
  }
  @keyframes carrier-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
  }
  @media (prefers-reduced-motion: reduce) {
    .carrier-dot { animation: none !important; }
  }

  /* Icon button — small square with hover lift on color. */
  .ctl-icon {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms, color 120ms, border-color 120ms;
  }
  .ctl-icon:hover {
    background: var(--bg-2);
    border-color: var(--fg-3);
    color: var(--fg);
  }
  .ctl-icon:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  /* Action button — bordered text rectangle. Three variants: default (ghost),
     primary (solid bone-white fill), stop (orange outline + tinted bg). */
  .ctl-btn {
    border: 1px solid var(--rule-strong);
    padding: 7px 14px;
    color: var(--fg);
    background: transparent;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
    font-weight: 700;
    transition: background 120ms, border-color 120ms, color 120ms;
  }
  .ctl-btn:hover {
    background: var(--bg-2);
    border-color: var(--fg-3);
  }
  .ctl-btn:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .ctl-btn--primary {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }
  .ctl-btn--primary:hover {
    background: var(--station-b);
    border-color: var(--station-b);
    color: var(--bg);
  }
  .ctl-btn--stop {
    color: var(--sev-bad);
    border-color: color-mix(in srgb, var(--sev-bad) 50%, transparent);
  }
  .ctl-btn--stop:hover {
    background: color-mix(in srgb, var(--sev-bad) 10%, transparent);
    border-color: var(--sev-bad);
  }
  .ctl-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* ===== MOBILE / TABLET FALLBACKS ===== */
  @media (max-width: 720px) {
    .masthead {
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding: 10px clamp(14px, 3vw, 20px);
    }
    .brand-tag,
    .nav,
    .carrier-tag .carrier-label {
      display: none;
    }
  }
</style>
