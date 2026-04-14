<!-- src/lib/components/SharedResultsBanner.svelte -->
<!-- Visible when viewing a shared results link. Informs the user they are       -->
<!-- seeing a read-only snapshot and offers a "Run Again" button to start fresh. -->
<script lang="ts">
  import { uiStore } from '$lib/stores/ui';
  import { measurementStore } from '$lib/stores/measurements';
  import { tokens } from '$lib/tokens';

  function handleRunAgain(): void {
    uiStore.clearSharedView();
    measurementStore.reset();
  }
</script>

<div
  class="shared-banner"
  role="alert"
  aria-live="polite"
  style:--surface-raised={tokens.color.surface.raised}
  style:--border={tokens.color.chrome.border}
  style:--accent={tokens.color.chrome.accent}
  style:--text-primary={tokens.color.text.primary}
  style:--text-secondary={tokens.color.text.secondary}
  style:--radius-sm="{tokens.radius.sm}px"
  style:--spacing-xs="{tokens.spacing.xs}px"
  style:--spacing-sm="{tokens.spacing.sm}px"
  style:--spacing-md="{tokens.spacing.md}px"
>
  <div class="banner-content">
    <span class="banner-icon" aria-hidden="true">↗</span>
    <span class="banner-text">Shared results — read only. Run your own test to measure from your location.</span>
  </div>
  <button
    type="button"
    class="btn-run-again"
    onclick={handleRunAgain}
  >
    Run Your Own Test
  </button>
</div>

<style>
  .shared-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    padding: var(--spacing-xs) var(--spacing-md);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .banner-content {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    min-width: 0;
  }

  .banner-icon {
    font-size: 14px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .banner-text {
    font-size: 13px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn-run-again {
    flex-shrink: 0;
    padding: var(--spacing-xs) var(--spacing-sm);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease;
    white-space: nowrap;
  }

  .btn-run-again:hover {
    background: var(--accent);
    color: #fff;
  }

  /* ── Mobile ────────────────────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .shared-banner {
      flex-direction: column;
      align-items: flex-start;
    }

    .banner-text {
      white-space: normal;
    }
  }
</style>
