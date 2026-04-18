# Type & store additions

New TypeScript types and store changes required. All additions go into `src/lib/types.ts` and `src/lib/stores/`.

## 1. `ActiveView` — extend the union

**File:** `src/lib/types.ts`

Current:
```ts
export type ActiveView = 'timeline' | 'heatmap' | 'split';
```

Replace with:
```ts
export type ActiveView =
  | 'overview'    // NEW — default
  | 'live'        // NEW
  | 'atlas'       // NEW
  | 'strata'     // NEW
  | 'terminal'   // NEW
  | 'lanes'      // NEW — alias for old 'split' layout
  | 'timeline'   // DEPRECATED — migrate on load
  | 'heatmap'    // DEPRECATED
  | 'split';     // DEPRECATED
```

## 2. `UIState` — new fields

**File:** `src/lib/types.ts`

Add to existing `UIState`:
```ts
export interface UIState {
  // ... existing fields ...

  /** Globally focused endpoint — drives rail selection and per-view focus. null = unfocused. */
  focusedEndpointId: string | null;   // NEW

  /** Live view layout options. */
  liveOptions: {                      // NEW
    split: boolean;                   // split scopes per endpoint vs unified overlay
    timeRange: LiveTimeRange;
  };

  /** Terminal view filters — which event types are visible. */
  terminalFilters: Set<TerminalEventType>;   // NEW
}

export type LiveTimeRange = '1m' | '5m' | '15m' | '1h' | '24h';

export type TerminalEventType =
  | 'timeout' | 'error' | 'threshold_up' | 'threshold_down'
  | 'freeze' | 'endpoint_added' | 'endpoint_removed' | 'reuse_change';
```

## 3. `uiStore` — new methods

**File:** `src/lib/stores/ui.ts`

Add to existing store:
```ts
setFocusedEndpoint(id: string | null): void {
  update(s => ({ ...s, focusedEndpointId: id }));
},
toggleFocusedEndpoint(id: string): void {
  update(s => ({ ...s, focusedEndpointId: s.focusedEndpointId === id ? null : id }));
},
setLiveSplit(split: boolean): void {
  update(s => ({ ...s, liveOptions: { ...s.liveOptions, split } }));
},
setLiveTimeRange(range: LiveTimeRange): void {
  update(s => ({ ...s, liveOptions: { ...s.liveOptions, timeRange: range } }));
},
toggleTerminalFilter(type: TerminalEventType): void {
  update(s => {
    const next = new Set(s.terminalFilters);
    next.has(type) ? next.delete(type) : next.add(type);
    return { ...s, terminalFilters: next };
  });
},
```

Update `initialState()`:
```ts
const initialState = (): UIState => ({
  activeView: 'overview',            // changed from 'split'
  expandedCards: new Set<string>(),
  // ... existing ...
  focusedEndpointId: null,           // NEW
  liveOptions: {                      // NEW
    split: false,
    timeRange: '5m',
  },
  terminalFilters: new Set(),        // NEW — empty = show all
});
```

## 4. `settingsStore` — threshold field

**File:** `src/lib/stores/settings.ts`

The prototype has both `timeout` (request abort time) and `threshold` (health alarm time). The existing store has `timeout` only. Add:

```ts
// in Settings type (src/lib/types.ts)
export interface Settings {
  // ... existing ...
  timeout: number;         // existing — hard abort in ms
  healthThreshold: number; // NEW — latency alarm threshold in ms (default 120)
}
```

Default: `healthThreshold: 120`. Must be `< timeout`; validate on set.

## 5. `EndpointStatistics` — tier2 p95 averages

**File:** `src/lib/types.ts`

AtlasView's P50/P95 toggle needs per-phase p95 values. Current `tier2Averages` are means only:

```ts
export interface EndpointStatistics {
  // ... existing ...
  tier2Averages: {
    dnsLookup: number;
    tcpConnect: number;
    tlsHandshake: number;
    ttfb: number;
    contentTransfer: number;
  };
  tier2P95: {                  // NEW — computed same cadence as averages
    dnsLookup: number;
    tcpConnect: number;
    tlsHandshake: number;
    ttfb: number;
    contentTransfer: number;
  };
}
```

This requires a matching change in `src/lib/utils/statistics.ts` — when computing `tier2Averages`, also compute `tier2P95` by running p95 over each phase across recent samples.

## 6. Derived store — `networkQualityStore`

**File:** `src/lib/stores/derived.ts` (new or add to existing derived module).

```ts
import { derived } from 'svelte/store';
import { endpointStore } from './endpoints';
import { statisticsStore } from './statistics';
import { settingsStore } from './settings';
import { networkQuality } from '../utils/classify';

export const networkQualityStore = derived(
  [endpointStore, statisticsStore, settingsStore],
  ([$endpoints, $stats, $settings]) => {
    const enabled = $endpoints.filter(e => e.enabled);
    const statsList = enabled.map(e => $stats[e.id]).filter(Boolean);
    return networkQuality(statsList, $settings.healthThreshold);
  }
);
```

OverviewView and Topbar status subscribe to this. Do not compute `networkQuality()` inline in components.

## 7. Derived store — `terminalEventsStore`

**File:** `src/lib/stores/terminal-events.ts` (new)

Incremental event buffer for TerminalView. Does **not** recompute from scratch on every sample — subscribes to `measurementStore` and pushes events as they arrive.

```ts
import { writable } from 'svelte/store';
import type { TerminalEvent } from '$lib/types';

function createTerminalEventsStore() {
  const { subscribe, update, set } = writable<TerminalEvent[]>([]);
  const MAX = 500;
  return {
    subscribe,
    push(event: TerminalEvent): void {
      update(list => {
        const next = [event, ...list];
        if (next.length > MAX) next.length = MAX;
        return next;
      });
    },
    clear(): void { set([]); },
  };
}
export const terminalEventsStore = createTerminalEventsStore();
```

The *production* of events is a listener wired up in `App.svelte` that subscribes to `measurementStore` and translates new samples into events. See `02-view-specs/terminal.md` for the event catalog.

## 8. Persistence migration

**File:** `src/lib/utils/apply-persisted-settings.ts`

Bump persisted `version` from 4 → 5. In the loader:

```ts
if (persisted.version < 5) {
  // Migrate old views to new defaults
  if (persisted.ui?.activeView === 'timeline' || persisted.ui?.activeView === 'heatmap' || persisted.ui?.activeView === 'split') {
    persisted.ui.activeView = 'lanes';
  }
  // Seed new settings fields with defaults if missing
  persisted.settings = {
    healthThreshold: 120,
    ...persisted.settings,
  };
  // Reset new UI fields
  persisted.ui = {
    focusedEndpointId: null,
    liveOptions: { split: false, timeRange: '5m' },
    terminalFilters: [],
    ...persisted.ui,
  };
}
```

Keep migration one-directional — never attempt to re-read v5 data in a v4 build.
