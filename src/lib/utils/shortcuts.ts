// src/lib/utils/shortcuts.ts
// Global keyboard shortcut handling. Registered once at app boot.
// Ignored when focus is in text input or modifier keys are held.

import { endpointStore } from '../stores/endpoints';
import { uiStore } from '../stores/ui';
import { get } from 'svelte/store';

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

function hasModifier(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

function handleKeydown(e: KeyboardEvent): void {
  // Ignore when typing in text fields
  if (isTextInput(e.target)) return;

  // Ignore when modifier keys are held (except Shift for ? and Escape)
  if (hasModifier(e)) return;

  const key = e.key;

  switch (key) {
    case 'Escape': {
      const ui = get(uiStore);
      if (ui.showSettings) {
        uiStore.toggleSettings();
        e.preventDefault();
      } else if (ui.showShare) {
        uiStore.toggleShare();
        e.preventDefault();
      } else if (ui.selectedTarget !== null) {
        uiStore.setSelected(null);
        e.preventDefault();
      }
      break;
    }

    case '?': {
      // Toggle keyboard help overlay (flag in uiStore — overlay is Task 25)
      // uiStore.toggleHelp() would go here; for now just prevent default
      e.preventDefault();
      break;
    }

    default: {
      // Digits 1-9 and 0 toggle endpoint visibility (1-10)
      if (key >= '1' && key <= '9') {
        const index = parseInt(key, 10) - 1;
        toggleEndpointAtIndex(index);
        e.preventDefault();
      } else if (key === '0') {
        // '0' maps to 10th endpoint
        toggleEndpointAtIndex(9);
        e.preventDefault();
      }
      break;
    }
  }
}

function toggleEndpointAtIndex(index: number): void {
  const endpoints = get(endpointStore);
  const target = endpoints[index];
  if (!target) return;
  endpointStore.updateEndpoint(target.id, { enabled: !target.enabled });
}

let registered = false;

/**
 * Register global keyboard shortcuts. Idempotent — safe to call multiple times.
 * Returns a cleanup function that removes the listener.
 */
export function initShortcuts(): () => void {
  if (registered) return () => undefined;
  registered = true;

  document.addEventListener('keydown', handleKeydown);

  return () => {
    document.removeEventListener('keydown', handleKeydown);
    registered = false;
  };
}
