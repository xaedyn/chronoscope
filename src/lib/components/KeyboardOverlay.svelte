<!-- src/lib/components/KeyboardOverlay.svelte -->
<!-- Vessel v4 keyboard help overlay. Triggered by '?' key, dismissed by Escape
     or backdrop click. Two-column grid (key chip | label), station-B accent
     line at top-left, ESC chip in the header. Replaces the table layout
     from the v2 design with the v4 .keyboard-help pattern. -->
<script lang="ts">
  import { uiStore } from '$lib/stores/ui';

  const shortcuts: readonly { keys: string; description: string }[] = [
    { keys: '1 / 2 / 3 / 4', description: 'Switch Overview / Live / Investigate / Report' },
    { keys: 'Alt + 1 – 9',   description: 'Toggle endpoint 1–9 visibility' },
    { keys: 'Alt + 0',       description: 'Toggle endpoint 10 visibility' },
    { keys: '?',             description: 'Show / hide this overlay' },
    { keys: 'Escape',        description: 'Close open panel or clear endpoint focus' },
  ];

  let dialogEl: HTMLDivElement | undefined = $state();
  let previouslyFocused: HTMLElement | null = null;

  const FOCUSABLE_SELECTORS =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function getFocusableElements(): HTMLElement[] {
    if (!dialogEl) return [];
    return Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
  }

  function trapFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const focusable = getFocusableElements();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  $effect(() => {
    if (!dialogEl) return;
    previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = getFocusableElements();
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      dialogEl.focus();
    }
  });

  function close(): void {
    const toRestore = previouslyFocused;
    uiStore.toggleKeyboardHelp();
    requestAnimationFrame(() => {
      toRestore?.focus();
    });
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
    } else {
      trapFocus(e);
    }
  }

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="keyboard-help visible"
  role="presentation"
  onclick={handleBackdropClick}
>
  <div
    bind:this={dialogEl}
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    tabindex="-1"
  >
    <header class="head">
      <h3>Keyboard shortcuts</h3>
      <span class="esc" aria-hidden="true">ESC to close</span>
    </header>

    <div class="grid">
      {#each shortcuts as { keys, description } (keys)}
        <kbd class="key">{keys}</kbd>
        <div class="label">{description}</div>
      {/each}
    </div>
  </div>
</div>

<style>
  /* Full-viewport scrim with backdrop blur. */
  .keyboard-help {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    padding: var(--spacing-md);
  }

  /* Panel — bg-2 surface, rule-strong border, station-B accent line. */
  .panel {
    background: var(--bg-2);
    border: 1px solid var(--rule-strong);
    max-width: 520px;
    width: 90vw;
    padding: 32px 36px;
    position: relative;
    box-shadow: 0 24px 72px color-mix(in srgb, black 60%, transparent);
    outline: none;
  }
  .panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 36px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 24px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--rule);
  }
  .head h3 {
    font-family: var(--sans);
    font-weight: 300;
    font-size: 24px;
    letter-spacing: -0.015em;
    color: var(--fg);
    margin: 0;
  }
  .esc {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    padding: 4px 8px;
    border: 1px solid var(--rule-strong);
  }

  .grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 14px 22px;
  }

  .key {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 700;
    color: var(--fg);
    background: var(--bg-3);
    border: 1px solid var(--rule-strong);
    padding: 4px 10px;
    min-width: 36px;
    text-align: center;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .label {
    font-family: var(--sans);
    font-size: 13px;
    color: var(--fg-2);
    align-self: center;
    line-height: 1.4;
  }

  @media (max-width: 480px) {
    .panel {
      padding: 24px 22px;
      width: calc(100vw - 28px);
    }
    .head h3 {
      font-size: 20px;
    }
    .grid {
      grid-template-columns: 1fr;
      gap: 6px 0;
    }
    .key {
      justify-self: start;
    }
  }
</style>
