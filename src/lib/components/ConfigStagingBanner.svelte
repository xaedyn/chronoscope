<!-- src/lib/components/ConfigStagingBanner.svelte -->
<!-- Visible when a config-mode share payload has been staged (uiStore.pendingShare). -->
<!-- The user must explicitly Accept (move endpoints into the rail) or Dismiss        -->
<!-- (drop the staged payload). See issue #79: pre-fix, attacker URLs auto-loaded     -->
<!-- on page load and one Start click weaponized the browser as a small-scale flood.  -->
<!-- The banner gates that path by requiring explicit consent before any URL          -->
<!-- reaches endpointStore. Cadence settings are never touched, accepted or not.      -->
<script lang="ts">
  import { uiStore } from '$lib/stores/ui';
  import { measurementStore } from '$lib/stores/measurements';
  import { acceptPendingShare, dismissPendingShare } from '$lib/share/hash-router';
  import { displayLabel } from '$lib/endpoint/displayLabel';

  const pending = $derived($uiStore.pendingShare);
  const count = $derived(pending?.endpoints.length ?? 0);
  const acceptDisabled = $derived(
    $measurementStore.lifecycle === 'running' ||
    $measurementStore.lifecycle === 'starting' ||
    $measurementStore.lifecycle === 'stopping',
  );
</script>

{#if pending}
  <div class="staging-banner" role="alert" aria-live="polite">
    <div class="banner-header">
      <span class="banner-icon" aria-hidden="true">⚠</span>
      <span class="banner-text">
        Shared link with {count} endpoint{count === 1 ? '' : 's'}. Accepting replaces your current rail.
        {#if acceptDisabled} Stop measuring before accepting shared endpoints.{/if}
      </span>
      <div class="banner-actions">
        <button type="button" class="btn-dismiss" onclick={dismissPendingShare}>
          Dismiss
        </button>
        <button
          type="button"
          class="btn-accept"
          disabled={acceptDisabled}
          aria-disabled={acceptDisabled}
          title={acceptDisabled ? 'Stop measuring before accepting shared endpoints.' : undefined}
          onclick={acceptPendingShare}
        >
          Accept
        </button>
      </div>
    </div>
    <ul class="endpoint-list" aria-label="Endpoints proposed by the shared link">
      {#each pending.endpoints as ep (ep.url)}
        <li class="endpoint-item">
          <span class="endpoint-pip" aria-hidden="true" class:disabled={!ep.enabled}></span>
          <span class="endpoint-identity">
            <span class="endpoint-label">{displayLabel({ url: ep.url })}</span>
            <span class="endpoint-url">{ep.url}</span>
          </span>
          {#if !ep.enabled}
            <span class="endpoint-badge">disabled</span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .staging-banner {
    /* z-index lifts the banner above Layout's fixed .bg backdrop. Without
       this the banner paints correctly but its buttons are hit-tested
       behind the .bg layer and clicks are intercepted. */
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-md);
    background: rgba(12, 10, 20, 0.78);
    backdrop-filter: blur(24px) saturate(1.3);
    -webkit-backdrop-filter: blur(24px) saturate(1.3);
    border-bottom: 1px solid var(--rule-strong, rgba(242, 235, 219, 0.14));
    flex-shrink: 0;
  }

  .banner-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    min-width: 0;
  }

  .banner-icon {
    font-size: 14px;
    color: var(--station-d, #D78E68);
    flex-shrink: 0;
  }

  .banner-text {
    font-family: var(--sans);
    font-size: 13px;
    color: var(--fg, #F2EBDB);
    flex: 1;
    min-width: 0;
  }

  .banner-actions {
    display: flex;
    gap: var(--spacing-xs);
    flex-shrink: 0;
  }

  .btn-dismiss,
  .btn-accept {
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-family: var(--sans);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--timing-btn) ease, color var(--timing-btn) ease, border-color var(--timing-btn) ease;
    white-space: nowrap;
    min-height: 32px;
    display: flex;
    align-items: center;
  }

  .btn-dismiss {
    border: 1px solid var(--rule-strong, rgba(242, 235, 219, 0.14));
    background: transparent;
    color: var(--fg-2, #A39A87);
  }
  .btn-dismiss:hover {
    border-color: var(--rule-strong, rgba(242, 235, 219, 0.14));
    color: var(--fg, #F2EBDB);
  }

  .btn-accept {
    border: 1px solid var(--station-b, #8CD4C9);
    background: transparent;
    color: var(--station-b, #8CD4C9);
  }
  .btn-accept:hover {
    background: var(--station-b, #8CD4C9);
    color: var(--bg, #03050A);
  }
  .btn-accept:disabled {
    border-color: var(--rule-strong, rgba(242, 235, 219, 0.14));
    background: transparent;
    color: var(--fg-2, #A39A87);
    cursor: not-allowed;
    opacity: 0.72;
  }

  .endpoint-list {
    list-style: none;
    margin: 0;
    padding: 0 0 0 calc(var(--spacing-sm) + 14px);
    /* MAX_ENDPOINTS = 10 × ~17px row height = ~170px; 200px fits all 10
       comfortably without forcing the user to scroll past hidden URLs
       before clicking Accept. Scroll fallback retained for safety, but
       in practice it shouldn't trigger. */
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .endpoint-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--fg-2, #A39A87);
    min-width: 0;
  }

  .endpoint-pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--station-b, #8CD4C9);
    flex-shrink: 0;
  }
  .endpoint-pip.disabled {
    background: var(--fg-3, #5F594D);
  }

  .endpoint-identity {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .endpoint-label {
    font-family: var(--sans, sans-serif);
    font-size: 12px;
    font-weight: 500;
    color: var(--fg, #F2EBDB);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .endpoint-url {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--fg-3, #5F594D);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .endpoint-badge {
    font-family: var(--sans);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-3, #5F594D);
    flex-shrink: 0;
  }

  /* Mobile — stack actions under text. */
  @media (max-width: 767px) {
    .banner-header {
      flex-wrap: wrap;
    }
    .banner-text {
      flex-basis: 100%;
    }
  }
</style>
