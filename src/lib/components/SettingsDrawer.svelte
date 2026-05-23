<!-- src/lib/components/SettingsDrawer.svelte -->
<!-- Vessel v4 Settings drawer — slides in from the right when showSettings is
     true. Translates proposal-settings-v4.html into Svelte 5 runes, wiring all
     controls to chronoscope stores (settingsStore, endpointStore). Endpoint add
     uses isSafeProbeUrl validation + URL-based dedup against the current list.
     The companion-agent card is the v4 static install placeholder; the live
     companion integration (CompanionPanel) is not wired in this surface. -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { uiStore } from '$lib/stores/ui';
  import { settingsStore } from '$lib/stores/settings';
  import { historyStore } from '$lib/stores/history';
  import { measurementStore } from '$lib/stores/measurements';
  import { endpointStore, MAX_ENDPOINTS } from '$lib/stores/endpoints';
  import { clearPersistedSettings } from '$lib/utils/persistence';
  import { DEFAULT_SETTINGS, type Settings, type Endpoint } from '$lib/types';
  import { clampCap, MAX_CAP } from '$lib/limits';
  import { REGIONS, detectRegion } from '$lib/regional-defaults';
  import type { Region } from '$lib/regional-defaults';
  import { isSafeProbeUrl } from '$lib/utils/url-safety';
  import { displayHostname } from '$lib/endpoint/displayLabel';
  import { setEnabled as setAudioEnabled, playSessionStart } from '$lib/audio';

  // ── Dialog plumbing ────────────────────────────────────────────────────────
  let dialogEl: HTMLDialogElement;
  let isClosing = $state(false);
  let closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const settings = $derived($settingsStore);
  const endpoints = $derived($endpointStore);
  const measurements = $derived($measurementStore);
  const isRunning = $derived(
    measurements.lifecycle === 'running' || measurements.lifecycle === 'starting',
  );
  const historyCount = $derived($historyStore.sessions.length);
  const currentRegion = $derived<Region>(settings.region ?? detectRegion());

  // Deterministic flight cert — CHR–YYMMDD–HHMM–XXX. Mirrors the
  // OverviewView / ReportView derivation so the About row matches the
  // header chips. "CHR–pending" until the first session starts.
  const flightCert = $derived.by<string>(() => {
    const startedAt = measurements.startedAt;
    if (!startedAt) return 'CHR–pending';
    const d = new Date(startedAt);
    const yy = d.getUTCFullYear().toString().slice(-2);
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = d.getUTCDate().toString().padStart(2, '0');
    const HH = d.getUTCHours().toString().padStart(2, '0');
    const MM = d.getUTCMinutes().toString().padStart(2, '0');
    const seedStr = (d.getTime() % 4096).toString(16).toUpperCase().padStart(3, '0');
    return `CHR–${yy}${mm}${dd}–${HH}${MM}–${seedStr}`;
  });

  // ── Snapshot for Cancel (revert) ───────────────────────────────────────────
  // Snapshot the live settings + endpoint list at the moment the drawer
  // opens. Cancel restores from this snapshot before closing; Done just
  // closes (all changes are already applied live). Snapshot is null while
  // the drawer is closed.
  let openSnapshot: { settings: Settings; endpoints: Endpoint[] } | null = null;

  function takeSnapshot(): void {
    openSnapshot = {
      settings: { ...get(settingsStore) },
      endpoints: get(endpointStore).map((ep) => ({ ...ep })),
    };
  }

  function restoreSnapshot(): void {
    if (openSnapshot === null) return;
    settingsStore.set({ ...openSnapshot.settings });
    endpointStore.setEndpoints(openSnapshot.endpoints.map((ep) => ({ ...ep })));
  }

  // Manage dialog open/close + snapshot lifecycle
  $effect(() => {
    if (dialogEl) {
      if ($uiStore.showSettings && !dialogEl.open) {
        takeSnapshot();
        dialogEl.showModal();
      } else if (!$uiStore.showSettings && dialogEl.open && !isClosing) {
        dialogEl.close();
      }
    }
  });

  function handleDialogClose(): void {
    if ($uiStore.showSettings) uiStore.toggleSettings();
  }

  onMount(() => {
    if (!dialogEl.open) {
      takeSnapshot();
      dialogEl.showModal();
    }
    dialogEl.addEventListener('close', handleDialogClose);
    dialogEl.addEventListener('cancel', (e) => {
      e.preventDefault();
      // Esc / system-cancel → treat as Cancel: revert before closing.
      cancel();
    });
  });

  onDestroy(() => {
    if (closeTimeoutId !== null) clearTimeout(closeTimeoutId);
    dialogEl?.removeEventListener('close', handleDialogClose);
  });

  function close(): void {
    if (isClosing) return;
    // Done — keep current state; drop the snapshot so a future open
    // re-snapshots from whatever's live.
    openSnapshot = null;
    isClosing = true;
    closeTimeoutId = setTimeout(() => {
      isClosing = false;
      closeTimeoutId = null;
      if ($uiStore.showSettings) uiStore.toggleSettings();
    }, 200);
  }

  function cancel(): void {
    // Cancel — revert to the snapshot before closing. Backdrop click and
    // Esc both route here so they don't silently commit edits.
    restoreSnapshot();
    close();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) cancel();
  }

  // ── Settings field handlers ────────────────────────────────────────────────
  function applyCadence(e: Event): void {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(raw)) return;
    const val = Math.max(0, Math.min(60000, raw));
    settingsStore.update((s) => ({ ...s, monitorDelay: val }));
  }

  function applyTrigger(e: Event): void {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(raw)) return;
    // Trigger must stay strictly below the hard timeout — clamp to [40, timeout-1].
    const upper = Math.max(40, settings.timeout - 1);
    const val = Math.max(40, Math.min(upper, raw));
    settingsStore.update((s) => ({ ...s, healthThreshold: val }));
  }

  function applyAutoEnd(e: Event): void {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(raw)) return;
    settingsStore.update((s) => ({ ...s, cap: clampCap(raw) }));
  }

  function applyTimeout(e: Event): void {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(raw)) return;
    const val = Math.max(200, Math.min(15000, raw));
    settingsStore.update((s) => ({ ...s, timeout: val }));
  }

  function applyBurstRounds(e: Event): void {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(raw)) return;
    const val = Math.max(0, Math.min(500, raw));
    settingsStore.update((s) => ({ ...s, burstRounds: val }));
  }

  function applyCorsMode(mode: 'no-cors' | 'cors'): void {
    if (isRunning) return;
    settingsStore.update((s) => ({ ...s, corsMode: mode }));
  }

  function applyRegion(region: Region): void {
    settingsStore.update((s) => ({ ...s, region }));
  }

  // ── Endpoint management ────────────────────────────────────────────────────
  let newHostInput = $state('');
  let addError = $state<string | null>(null);

  function normalizeForCompare(url: string): string {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return `${parsed.protocol}//${host}${parsed.pathname}${parsed.search}`;
    } catch {
      return url.toLowerCase().trim();
    }
  }

  function resolveHostToUrl(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // Allow either full URL or bare hostname (v4 prototype shows "hostname.example.com").
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return isSafeProbeUrl(candidate) ? candidate : null;
  }

  function addEndpoint(): void {
    addError = null;
    if (isRunning) {
      addError = 'Stop test to add stations.';
      return;
    }
    if (endpoints.length >= MAX_ENDPOINTS) {
      addError = `Maximum ${MAX_ENDPOINTS} stations reached.`;
      return;
    }
    const url = resolveHostToUrl(newHostInput);
    if (!url) {
      addError = 'Enter a valid http(s) URL or hostname.';
      return;
    }
    // Dedup against the existing list by normalized URL.
    const norm = normalizeForCompare(url);
    const duplicate = endpoints.some((ep) => normalizeForCompare(ep.url) === norm);
    if (duplicate) {
      addError = 'That station is already in the list.';
      return;
    }
    endpointStore.addEndpoint(url);
    newHostInput = '';
  }

  function handleAddKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEndpoint();
    }
  }

  function toggleEndpoint(id: string, enabled: boolean): void {
    if (isRunning) return;
    endpointStore.updateEndpoint(id, { enabled: !enabled });
  }

  function removeEndpoint(id: string): void {
    if (isRunning) return;
    // Refuse to remove the last endpoint to keep the engine drivable.
    if (endpoints.length <= 1) return;
    endpointStore.removeEndpoint(id);
  }

  // Map endpoints to v4 station letters A..D, then fall through to X (extras).
  const STATION_LETTERS = ['A', 'B', 'C', 'D'] as const;
  function stationKey(index: number): string {
    return STATION_LETTERS[index] ?? 'X';
  }

  // ── Cosmetic toggles (audio / motion / sharing) ────────────────────────────
  // The v4 prototype shows these as visual surface controls; chronoscope has no
  // backing setting for them yet. Tracked locally so the UI feels live; not
  // persisted. Wiring is deferred — see report.
  // (audio tick IS now wired through settings.audioEnabled; see toggleAudioTick)
  const audioTick = $derived(settings.audioEnabled);
  function toggleAudioTick(): void {
    const next = !settings.audioEnabled;
    settingsStore.update((s) => ({ ...s, audioEnabled: next }));
    setAudioEnabled(next);
    if (next) playSessionStart();
  }
  let reducedMotion = $state(false);
  let mouseParallax = $state(true);
  let starField = $state(true);
  let publishHosted = $state(false);
  let saveLocally = $state(true);

  // ── UI-only Window slider (v4 § 02) ────────────────────────────────────────
  // The rolling chart window is currently a constant (tokens.lane.chartWindow
  // = 60). The v4 prototype exposes it as a tunable so users feel it's an
  // honest control. Until a windowSeconds Settings field exists, this is a
  // visual-only slider — drag changes the displayed value but does not
  // persist or affect the engine. Default mirrors the constant.
  let windowSeconds = $state(60);
  function applyWindow(e: Event): void {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(raw)) return;
    windowSeconds = Math.max(30, Math.min(300, raw));
  }

  // ── UI-only Method radiogroup (v4 § 03) ────────────────────────────────────
  // Chronoscope's engine picks HEAD vs GET per target (favicon.ico GET in
  // most cases, HEAD where the upstream allows it). The control is
  // informational — disabled with a tooltip — until a per-session override
  // exists at the Settings level.
  let requestMethod = $state<'head' | 'get'>('head');

  // ── Danger-zone confirms (preserved from previous SettingsDrawer) ──────────
  let showClearConfirm = $state(false);
  let showClearHistoryConfirm = $state(false);
  let showResetConfirm = $state(false);
  let showResetRegionalConfirm = $state(false);

  function requestResetRegional(): void {
    showResetRegionalConfirm = true;
  }
  function confirmResetRegional(): void {
    if (isRunning) return;
    showResetRegionalConfirm = false;
    endpointStore.reset(currentRegion);
    if (!settings.region) {
      settingsStore.update((s) => ({ ...s, region: currentRegion }));
    }
  }
  function cancelResetRegional(): void {
    showResetRegionalConfirm = false;
  }

  function requestClear(): void {
    showClearConfirm = true;
  }
  function confirmClear(): void {
    if (isRunning) return;
    showClearConfirm = false;
    measurementStore.reset();
    for (const ep of get(endpointStore)) {
      measurementStore.initEndpoint(ep.id);
    }
  }
  function cancelClear(): void {
    showClearConfirm = false;
  }

  function requestClearHistory(): void {
    showClearHistoryConfirm = true;
  }
  function confirmClearHistory(): void {
    if (isRunning) return;
    showClearHistoryConfirm = false;
    void historyStore.clear();
  }
  function cancelClearHistory(): void {
    showClearHistoryConfirm = false;
  }

  function requestReset(): void {
    showResetConfirm = true;
  }
  function confirmReset(): void {
    if (isRunning) return;
    showResetConfirm = false;
    // Preserve region across reset to defaults.
    clearPersistedSettings();
    endpointStore.reset(currentRegion);
    settingsStore.set({ ...DEFAULT_SETTINGS, region: currentRegion });
    measurementStore.reset();
    for (const ep of get(endpointStore)) {
      measurementStore.initEndpoint(ep.id);
    }
  }
  function cancelReset(): void {
    showResetConfirm = false;
  }

  // ── Display helpers ────────────────────────────────────────────────────────
  function formatSeconds(ms: number): string {
    return (ms / 1000).toFixed(1);
  }

  const REGION_SHORT: Readonly<Record<Region, string>> = {
    'north-america': 'NA',
    'europe': 'EU',
    'east-asia': 'E-AS',
    'south-southeast-asia': 'S-AS',
    'latam': 'LATAM',
    'mea': 'MEA',
    'oceania': 'OCE',
  };
</script>

<dialog
  bind:this={dialogEl}
  id="settings-drawer"
  class="settings-dialog"
  aria-label="Settings"
  aria-modal="true"
  onclick={handleBackdropClick}
>
  <aside class="drawer" class:closing={isClosing} role="document">
    <!-- ── Head ─────────────────────────────────────────────────────────── -->
    <div class="drawer-head">
      <div class="l">
        <div class="title">Settings</div>
        <div class="sub">v4 · Vessel</div>
      </div>
      <button
        type="button"
        class="drawer-close"
        aria-label="Close settings"
        onclick={cancel}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M2 2 L12 12 M12 2 L2 12"/>
        </svg>
      </button>
    </div>

    <!-- ── Body ─────────────────────────────────────────────────────────── -->
    <div class="drawer-body">
      <!-- §01 STATIONS -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 01 ·</span> <span class="t">Stations</span></span>
          <span class="right">
            <span>Active<span class="v">{endpoints.filter((e) => e.enabled).length}</span></span>
          </span>
        </div>

        <ul class="endpoint-list">
          {#each endpoints as endpoint, i (endpoint.id)}
            <li class="endpoint-row" data-ep={stationKey(i)}>
              <span class="mk" style:background={endpoint.color} style:box-shadow="0 0 8px {endpoint.color}"></span>
              <div class="info">
                <div class="nm">{endpoint.label}</div>
                <div class="host">{displayHostname(endpoint.url)}</div>
              </div>
              <button
                type="button"
                class="small-toggle"
                aria-pressed={endpoint.enabled}
                aria-label="Probe {endpoint.label}"
                disabled={isRunning}
                onclick={() => toggleEndpoint(endpoint.id, endpoint.enabled)}
              ></button>
              <button
                type="button"
                class="remove"
                aria-label="Remove {endpoint.label}"
                disabled={isRunning || endpoints.length <= 1}
                onclick={() => removeEndpoint(endpoint.id)}
              >×</button>
            </li>
          {/each}
        </ul>

        <div class="endpoint-add">
          <input
            type="text"
            placeholder="hostname.example.com"
            autocomplete="off"
            spellcheck="false"
            disabled={isRunning || endpoints.length >= MAX_ENDPOINTS}
            bind:value={newHostInput}
            onkeydown={handleAddKeydown}
            aria-label="New station URL"
          />
          <button
            type="button"
            disabled={isRunning || endpoints.length >= MAX_ENDPOINTS}
            onclick={addEndpoint}
          >Add station</button>
        </div>
        {#if addError}
          <p class="add-error" role="alert">{addError}</p>
        {/if}

        <div class="field region-field">
          <div class="label">Regional default
            <span class="help">Region the default station set is biased toward.</span>
          </div>
          <div class="ctl">
            <div class="seg seg-region" role="radiogroup" aria-label="Regional default">
              {#each REGIONS as region (region)}
                <button
                  type="button"
                  aria-pressed={currentRegion === region}
                  onclick={() => applyRegion(region)}
                >{REGION_SHORT[region]}</button>
              {/each}
            </div>
          </div>
        </div>
      </section>

      <!-- §02 TIMING -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 02 ·</span> <span class="t">Timing</span></span>
        </div>

        <div class="field">
          <div class="label">Cadence
            <span class="help">Delay between rounds after the burst.</span>
          </div>
          <div class="ctl">
            <div class="slider">
              <input
                type="range"
                min="0"
                max="5000"
                step="100"
                value={settings.monitorDelay}
                oninput={applyCadence}
                aria-label="Cadence in milliseconds"
              />
              <span class="val"><span class="v">{formatSeconds(settings.monitorDelay)}</span><span class="u">s</span></span>
            </div>
          </div>
        </div>

        <div class="field">
          <div class="label">Window
            <span class="help">Rolling window kept in memory.</span>
          </div>
          <div class="ctl">
            <div class="slider">
              <input
                type="range"
                min="30"
                max="300"
                step="10"
                value={windowSeconds}
                oninput={applyWindow}
                aria-label="Rolling window in seconds"
              />
              <span class="val"><span class="v">{windowSeconds}</span><span class="u">s</span></span>
            </div>
          </div>
        </div>

        <div class="field">
          <div class="label">Burst rounds
            <span class="help">Initial fast rounds before monitor cadence begins.</span>
          </div>
          <div class="ctl">
            <div class="slider">
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={settings.burstRounds}
                oninput={applyBurstRounds}
                aria-label="Burst rounds"
              />
              <span class="val"><span class="v">{settings.burstRounds}</span><span class="u">rounds</span></span>
            </div>
          </div>
        </div>

        <div class="field" data-accent="trigger">
          <div class="label">Trigger
            <span class="help">Threshold above which a round is marked degraded.</span>
          </div>
          <div class="ctl">
            <div class="slider">
              <input
                type="range"
                min="40"
                max="500"
                step="5"
                value={settings.healthThreshold}
                oninput={applyTrigger}
                aria-label="Health threshold in milliseconds"
              />
              <span class="val"><span class="v">{settings.healthThreshold}</span><span class="u">ms</span></span>
            </div>
          </div>
        </div>

        <div class="field">
          <div class="label">Auto end
            <span class="help">Stop recording after this many rounds.</span>
          </div>
          <div class="ctl">
            <div class="slider">
              <input
                type="range"
                min="60"
                max={MAX_CAP}
                step="60"
                value={settings.cap}
                oninput={applyAutoEnd}
                aria-label="Auto-end after rounds"
              />
              <span class="val"><span class="v">{settings.cap}</span><span class="u">rounds</span></span>
            </div>
          </div>
        </div>
      </section>

      <!-- §03 NETWORK -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 03 ·</span> <span class="t">Network</span></span>
          {#if isRunning}
            <span class="right running-note">Stop test to edit</span>
          {/if}
        </div>

        <div class="field">
          <div class="label">Request mode
            <span class="help">How probes are dispatched. <em>CORS</em> exposes phase timing when servers allow it; <em>no-CORS</em> is broadest but blinder.</span>
          </div>
          <div class="ctl">
            <div class="seg" role="radiogroup" aria-label="Request mode">
              <button
                type="button"
                aria-pressed={settings.corsMode === 'cors'}
                disabled={isRunning}
                onclick={() => applyCorsMode('cors')}
              >CORS</button>
              <button
                type="button"
                aria-pressed={settings.corsMode === 'no-cors'}
                disabled={isRunning}
                onclick={() => applyCorsMode('no-cors')}
              >no-CORS</button>
            </div>
          </div>
        </div>

        <div class="field">
          <div class="label">Method
            <span class="help">Set by engine per target — HEAD where supported, GET (favicon) otherwise.</span>
          </div>
          <div class="ctl">
            <div
              class="seg"
              role="radiogroup"
              aria-label="Request method"
              title="Set by engine per target"
            >
              <button
                type="button"
                aria-pressed={requestMethod === 'head'}
                disabled
                aria-disabled="true"
                title="Set by engine per target"
                onclick={() => (requestMethod = 'head')}
              >HEAD</button>
              <button
                type="button"
                aria-pressed={requestMethod === 'get'}
                disabled
                aria-disabled="true"
                title="Set by engine per target"
                onclick={() => (requestMethod = 'get')}
              >GET</button>
            </div>
          </div>
        </div>

        <div class="field">
          <div class="label">Timeout
            <span class="help">Rounds past this duration are recorded as carrier-lost.</span>
          </div>
          <div class="ctl">
            <div class="slider">
              <input
                type="range"
                min="500"
                max="15000"
                step="100"
                value={settings.timeout}
                oninput={applyTimeout}
                aria-label="Request timeout in milliseconds"
              />
              <span class="val"><span class="v">{formatSeconds(settings.timeout)}</span><span class="u">s</span></span>
            </div>
          </div>
        </div>
      </section>

      <!-- §04 COMPANION AGENT -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 04 ·</span> <span class="t">Companion agent</span></span>
          <span class="right warn-note">Not installed</span>
        </div>

        <div class="agent-card">
          <div class="agent-head">
            <div class="agent-name">Chronoscope local agent</div>
            <div class="agent-status">Optional</div>
          </div>
          <div class="agent-body">
            A desktop companion exposes precise TCP / TLS times, DNS resolver behavior, and Wi-Fi RSSI from <em>your</em> machine — data the browser refuses to surface.
          </div>
          <div class="agent-detail">
            <span class="k">Platform</span><span class="v">macOS · Linux · Windows</span>
            <span class="k">Install</span><span class="v">~12 MB · code-signed</span>
            <span class="k">Telemetry</span><span class="v">none · local only</span>
            <span class="k">Latency</span><span class="v">localhost · ~0.1 ms</span>
          </div>
          <button type="button" class="agent-action" disabled aria-disabled="true">Download agent →</button>
        </div>
      </section>

      <!-- §05 AUDIO & MOTION -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 05 ·</span> <span class="t">Audio &amp; motion</span></span>
        </div>

        <div class="toggle-row">
          <div class="nm">Audio tick
            <span class="help">Soft 880 Hz tone on each round arrival, at −32 dB.</span>
          </div>
          <button
            type="button"
            class="toggle"
            aria-pressed={audioTick}
            aria-label="Audio tick"
            onclick={toggleAudioTick}
          ></button>
        </div>

        <div class="toggle-row">
          <div class="nm">Reduced motion
            <span class="help">Honors <em>prefers-reduced-motion</em>. Sweep stops; pulses stamp without slide.</span>
          </div>
          <button
            type="button"
            class="toggle"
            aria-pressed={reducedMotion}
            aria-label="Reduced motion"
            onclick={() => (reducedMotion = !reducedMotion)}
          ></button>
        </div>

        <div class="toggle-row">
          <div class="nm">Mouse parallax
            <span class="help">Camera shifts slightly with cursor for spatial depth.</span>
          </div>
          <button
            type="button"
            class="toggle"
            aria-pressed={mouseParallax}
            aria-label="Mouse parallax"
            onclick={() => (mouseParallax = !mouseParallax)}
          ></button>
        </div>

        <div class="toggle-row">
          <div class="nm">Star field
            <span class="help">Background of distant stars. Disable for slower devices.</span>
          </div>
          <button
            type="button"
            class="toggle"
            aria-pressed={starField}
            aria-label="Star field"
            onclick={() => (starField = !starField)}
          ></button>
        </div>
      </section>

      <!-- §06 SHARING & STORAGE -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 06 ·</span> <span class="t">Sharing &amp; storage</span></span>
        </div>

        <div class="toggle-row">
          <div class="nm">Publish hosted report
            <span class="help">When you press <em>Share</em>, store a snapshot on the host. Off = link contains everything inline.</span>
          </div>
          <button
            type="button"
            class="toggle"
            aria-pressed={publishHosted}
            aria-label="Publish hosted report"
            onclick={() => (publishHosted = !publishHosted)}
          ></button>
        </div>

        <div class="toggle-row">
          <div class="nm">Save session locally
            <span class="help">Keep this session's signature in <em>localStorage</em> after the tab closes.</span>
          </div>
          <button
            type="button"
            class="toggle"
            aria-pressed={saveLocally}
            aria-label="Save locally"
            onclick={() => (saveLocally = !saveLocally)}
          ></button>
        </div>

        <div class="section-note">
          <strong>No telemetry leaves this browser.</strong> Settings are stored in <em>localStorage</em>. Shared reports are encoded into the URL by default; only the <em>Publish hosted report</em> toggle uploads anything.
        </div>
      </section>

      <!-- §07 DANGER ZONE -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 07 ·</span> <span class="t">Reset &amp; clear</span></span>
        </div>

        {#if isRunning}
          <p class="danger-note" aria-live="polite">Stop test to use reset, history, and clear actions.</p>
        {/if}

        <div class="danger-stack">
          {#if !showResetRegionalConfirm}
            <button
              type="button"
              class="btn-danger"
              disabled={isRunning}
              aria-disabled={isRunning}
              onclick={requestResetRegional}
            >Reset to regional defaults</button>
          {:else}
            <div class="confirm-group" role="alert" aria-live="assertive">
              <p class="confirm-text">Replaces current endpoints with regional defaults. Continue?</p>
              <div class="confirm-actions">
                <button type="button" class="btn-danger" disabled={isRunning} onclick={confirmResetRegional}>Yes, reset</button>
                <button type="button" class="btn-secondary" onclick={cancelResetRegional}>Cancel</button>
              </div>
            </div>
          {/if}

          {#if !showResetConfirm}
            <button
              type="button"
              class="btn-danger"
              disabled={isRunning}
              aria-disabled={isRunning}
              onclick={requestReset}
            >Reset to defaults</button>
          {:else}
            <div class="confirm-group" role="alert" aria-live="assertive">
              <p class="confirm-text">Restores default endpoints and settings. Continue?</p>
              <div class="confirm-actions">
                <button type="button" class="btn-danger" disabled={isRunning} onclick={confirmReset}>Yes, reset</button>
                <button type="button" class="btn-secondary" onclick={cancelReset}>Cancel</button>
              </div>
            </div>
          {/if}

          {#if !showClearHistoryConfirm}
            <button
              type="button"
              class="btn-danger"
              disabled={isRunning || historyCount === 0}
              aria-disabled={isRunning || historyCount === 0}
              onclick={requestClearHistory}
            >Clear local history</button>
          {:else}
            <div class="confirm-group" role="alert" aria-live="assertive">
              <p class="confirm-text">Deletes {historyCount} saved baseline {historyCount === 1 ? 'run' : 'runs'} from this browser. Continue?</p>
              <div class="confirm-actions">
                <button type="button" class="btn-danger" disabled={isRunning} onclick={confirmClearHistory}>Yes, clear</button>
                <button type="button" class="btn-secondary" onclick={cancelClearHistory}>Cancel</button>
              </div>
            </div>
          {/if}

          {#if !showClearConfirm}
            <button
              type="button"
              class="btn-danger"
              disabled={isRunning}
              aria-disabled={isRunning}
              onclick={requestClear}
            >Clear all results</button>
          {:else}
            <div class="confirm-group" role="alert" aria-live="assertive">
              <p class="confirm-text">This cannot be undone. Continue?</p>
              <div class="confirm-actions">
                <button type="button" class="btn-danger" disabled={isRunning} onclick={confirmClear}>Yes, clear</button>
                <button type="button" class="btn-secondary" onclick={cancelClear}>Cancel</button>
              </div>
            </div>
          {/if}
        </div>
      </section>

      <!-- §08 ABOUT -->
      <section class="section">
        <div class="section-head">
          <span><span class="num">§ 08 ·</span> <span class="t">About</span></span>
        </div>
        <div class="about">
          <span class="k">Build</span><span class="v">v4 · Vessel</span>
          <span class="k">Cert</span><span class="v">{flightCert}</span>
          <span class="k">Vantage</span><span class="v">{REGION_SHORT[currentRegion]}</span>
          <span class="k">Browser</span><span class="v">Resident · no install</span>
          <span class="k">License</span><span class="v">MIT</span>
          <span class="k">Source</span><span class="v">github.com/chronoscope</span>
        </div>
      </section>
    </div>

    <!-- ── Foot ─────────────────────────────────────────────────────────── -->
    <div class="drawer-foot">
      <div class="meta">Changes apply on <span class="v">Done</span></div>
      <div class="actions">
        <button type="button" class="btn" onclick={cancel}>Cancel</button>
        <button type="button" class="btn btn--primary" onclick={close}>Done</button>
      </div>
    </div>
  </aside>
</dialog>

<style>
  /* ── Dialog wrapper ─────────────────────────────────────────────────────── */
  .settings-dialog {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    overflow: hidden;
    color: var(--fg);
    font-family: var(--sans);
    font-size: 13px;
  }

  /* Scrim — v4 pattern: warm-black canvas at 78% with blur */
  .settings-dialog::backdrop {
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: scrimIn 320ms cubic-bezier(0.16, 0.84, 0.42, 1);
  }
  @keyframes scrimIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* ── Drawer panel ───────────────────────────────────────────────────────── */
  .drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(520px, 92vw);
    background: var(--bg);
    border-left: 1px solid var(--rule-strong);
    box-shadow: -24px 0 80px color-mix(in srgb, var(--bg) 60%, transparent);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: drawerSlideIn 380ms cubic-bezier(0.16, 0.84, 0.42, 1) forwards;
  }
  .drawer.closing {
    animation: drawerSlideOut 200ms cubic-bezier(0.4, 0, 1, 1) forwards;
  }
  @keyframes drawerSlideIn {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }
  @keyframes drawerSlideOut {
    from { transform: translateX(0); }
    to   { transform: translateX(100%); }
  }

  /* Left-edge light leak (station-B accent) */
  .drawer::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: linear-gradient(180deg, transparent 0%, var(--station-b) 30%, var(--station-b) 70%, transparent 100%);
    opacity: 0.35;
    box-shadow: 0 0 14px var(--station-b);
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .drawer,
    .drawer.closing,
    .settings-dialog::backdrop {
      animation: none;
      transform: none;
      opacity: 1;
    }
  }

  /* ── Head ──────────────────────────────────────────────────────────────── */
  .drawer-head {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    padding: 18px 24px;
    border-bottom: 1px solid var(--rule);
    flex-shrink: 0;
  }
  .drawer-head .l {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .drawer-head .title {
    font-family: var(--sans);
    font-weight: 300;
    font-size: 22px;
    letter-spacing: -0.015em;
    color: var(--fg);
    line-height: 1;
  }
  .drawer-head .sub {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .drawer-close {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
    transition: color 120ms, border-color 120ms, background 120ms;
  }
  .drawer-close:hover,
  .drawer-close:focus-visible {
    color: var(--fg);
    border-color: var(--fg-3);
    background: var(--bg-2);
    outline: none;
  }

  /* ── Body / scroll ─────────────────────────────────────────────────────── */
  .drawer-body {
    flex-grow: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0;
  }
  .drawer-body::-webkit-scrollbar {
    width: 6px;
    background: var(--bg);
  }
  .drawer-body::-webkit-scrollbar-thumb {
    background: var(--rule-strong);
  }
  .drawer-body::-webkit-scrollbar-thumb:hover {
    background: var(--fg-3);
  }

  /* ── Section ───────────────────────────────────────────────────────────── */
  .section {
    border-bottom: 1px solid var(--rule);
    padding: 24px;
  }
  .section:last-child {
    border-bottom: 0;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 18px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .section-head .num {
    color: var(--fg-3);
  }
  .section-head .t {
    color: var(--fg);
  }
  .section-head .right {
    display: inline-flex;
    gap: 14px;
    align-items: baseline;
  }
  .section-head .right .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 6px;
  }
  .section-head .warn-note {
    color: var(--sev-warn);
  }
  .section-head .running-note {
    color: var(--sev-warn);
  }

  /* ── Field row ─────────────────────────────────────────────────────────── */
  .field {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 14px;
    align-items: start;
    padding: 14px 0;
    border-top: 1px dashed var(--rule);
  }
  .field:first-of-type {
    border-top: 0;
    padding-top: 8px;
  }
  .field .label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    padding-top: 6px;
  }
  .field .label .help {
    display: block;
    margin-top: 4px;
    font-family: var(--sans);
    font-weight: 400;
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0;
    color: var(--fg-4);
    line-height: 1.4;
  }
  .field .label .help em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg-2);
  }
  .field .ctl {
    min-width: 0;
  }
  .field.region-field {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
  }

  /* ── Slider ────────────────────────────────────────────────────────────── */
  .slider {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 14px;
    align-items: center;
  }
  .slider input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 16px;
    cursor: pointer;
    background: transparent;
  }
  .slider input[type="range"]::-webkit-slider-runnable-track {
    height: 1px;
    background: var(--rule-strong);
  }
  .slider input[type="range"]::-moz-range-track {
    height: 1px;
    background: var(--rule-strong);
  }
  .slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 2px;
    height: 16px;
    background: var(--fg);
    margin-top: -7px;
    box-shadow: 0 0 8px var(--fg);
  }
  .slider input[type="range"]::-moz-range-thumb {
    width: 2px;
    height: 16px;
    background: var(--fg);
    border: 0;
  }
  .slider input[type="range"]:focus-visible {
    outline: none;
  }
  .slider input[type="range"]:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 12px var(--station-b);
  }
  .slider input[type="range"]:focus-visible::-moz-range-thumb {
    box-shadow: 0 0 12px var(--station-b);
  }
  .slider .val {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    font-size: 16px;
    font-weight: 400;
    color: var(--fg);
    letter-spacing: -0.01em;
    min-width: 92px;
    text-align: right;
  }
  .slider .val .u {
    font-size: 10px;
    color: var(--fg-3);
    margin-left: 4px;
    letter-spacing: 0;
  }

  /* Trigger slider — sev-bad accent */
  .field[data-accent="trigger"] .slider input[type="range"]::-webkit-slider-thumb {
    background: var(--sev-bad);
    box-shadow: 0 0 10px var(--sev-bad);
  }
  .field[data-accent="trigger"] .slider input[type="range"]::-moz-range-thumb {
    background: var(--sev-bad);
  }
  .field[data-accent="trigger"] .slider .val .v {
    color: var(--sev-bad);
  }

  /* ── Toggle ────────────────────────────────────────────────────────────── */
  .toggle {
    width: 42px;
    height: 22px;
    position: relative;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: transparent;
    transition: border-color 120ms, background 120ms;
    flex-shrink: 0;
    padding: 0;
  }
  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: var(--fg-3);
    transition: transform 200ms cubic-bezier(0.16, 0.84, 0.42, 1), background 120ms, box-shadow 120ms;
  }
  .toggle[aria-pressed="true"] {
    border-color: var(--station-b);
    background: color-mix(in srgb, var(--station-b) 8%, transparent);
  }
  .toggle[aria-pressed="true"]::after {
    transform: translateX(20px);
    background: var(--station-b);
    box-shadow: 0 0 10px var(--station-b);
  }
  .toggle:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    padding: 14px 0;
    border-top: 1px dashed var(--rule);
  }
  .toggle-row:first-of-type {
    border-top: 0;
    padding-top: 8px;
  }
  .toggle-row .nm {
    font-family: var(--sans);
    font-size: 14px;
    color: var(--fg);
    font-weight: 400;
    letter-spacing: -0.005em;
  }
  .toggle-row .nm .help {
    display: block;
    margin-top: 2px;
    font-family: var(--sans);
    font-size: 11px;
    color: var(--fg-3);
    font-weight: 400;
    letter-spacing: 0;
    line-height: 1.4;
    max-width: 38ch;
  }
  .toggle-row .nm .help em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg-2);
  }

  /* ── Segmented control ─────────────────────────────────────────────────── */
  .seg {
    display: flex;
    border: 1px solid var(--rule-strong);
    width: 100%;
  }
  .seg button {
    flex: 1;
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg-3);
    background: transparent;
    border: 0;
    border-right: 1px solid var(--rule-strong);
    font-weight: 700;
    cursor: pointer;
    transition: color 120ms, background 120ms, border-color 120ms;
  }
  .seg button:last-child {
    border-right: 0;
  }
  .seg button[aria-pressed="true"] {
    background: var(--fg);
    color: var(--bg);
  }
  .seg button:hover:not([aria-pressed="true"]):not(:disabled) {
    color: var(--fg);
    background: var(--bg-2);
  }
  .seg button:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: -2px;
  }
  .seg button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .seg-region button {
    font-size: 9px;
    letter-spacing: 0.1em;
    padding: 8px 4px;
  }

  /* ── Endpoint list ─────────────────────────────────────────────────────── */
  .endpoint-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule-strong);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .endpoint-row {
    background: var(--bg);
    display: grid;
    grid-template-columns: 14px 1fr auto auto;
    gap: 14px;
    align-items: center;
    padding: 14px 16px;
    transition: background 120ms;
  }
  .endpoint-row:hover {
    background: var(--bg-2);
  }
  .endpoint-row .mk {
    width: 8px;
    height: 8px;
  }
  .endpoint-row .info {
    min-width: 0;
  }
  .endpoint-row .info .nm {
    font-family: var(--sans);
    font-size: 14px;
    font-weight: 500;
    color: var(--fg);
    letter-spacing: -0.005em;
    margin-bottom: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .endpoint-row .info .host {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--fg-3);
    letter-spacing: 0.02em;
    word-break: break-all;
    font-variant-numeric: tabular-nums;
  }
  .endpoint-row .small-toggle {
    width: 32px;
    height: 18px;
    position: relative;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: transparent;
    flex-shrink: 0;
    padding: 0;
  }
  .endpoint-row .small-toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    background: var(--fg-3);
    transition: transform 200ms cubic-bezier(0.16, 0.84, 0.42, 1), background 120ms, box-shadow 120ms;
  }
  .endpoint-row .small-toggle[aria-pressed="true"] {
    border-color: var(--station-b);
  }
  .endpoint-row .small-toggle[aria-pressed="true"]::after {
    transform: translateX(14px);
    background: var(--station-b);
    box-shadow: 0 0 6px var(--station-b);
  }
  .endpoint-row .small-toggle:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .endpoint-row .small-toggle:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .endpoint-row .remove {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 700;
    background: transparent;
    border: 0;
    cursor: pointer;
    transition: color 120ms;
  }
  .endpoint-row .remove:hover:not(:disabled) {
    color: var(--sev-bad);
  }
  .endpoint-row .remove:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .endpoint-row .remove:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .endpoint-add {
    margin-top: 14px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  .endpoint-add input {
    background: var(--bg-2);
    border: 1px solid var(--rule-strong);
    padding: 10px 12px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--fg);
    letter-spacing: 0.02em;
    outline: none;
    transition: border-color 120ms;
  }
  .endpoint-add input::placeholder {
    color: var(--fg-3);
  }
  .endpoint-add input:focus {
    border-color: var(--fg-3);
  }
  .endpoint-add input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .endpoint-add button {
    border: 1px solid var(--rule-strong);
    background: transparent;
    padding: 10px 14px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg);
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  .endpoint-add button:hover:not(:disabled) {
    background: var(--bg-2);
    border-color: var(--fg-3);
  }
  .endpoint-add button:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .endpoint-add button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .add-error {
    margin-top: 8px;
    font-family: var(--sans);
    font-size: 11px;
    color: var(--sev-bad);
    line-height: 1.4;
  }

  /* ── Companion agent card ──────────────────────────────────────────────── */
  .agent-card {
    background: var(--bg-2);
    border: 1px solid var(--rule-strong);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    position: relative;
  }
  .agent-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 18px;
    height: 1px;
    background: var(--sev-warn);
    box-shadow: 0 0 8px var(--sev-warn);
  }
  .agent-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .agent-name {
    font-family: var(--sans);
    font-size: 15px;
    font-weight: 500;
    color: var(--fg);
  }
  .agent-status {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    padding: 4px 8px;
    border: 1px solid var(--rule-strong);
  }
  .agent-body {
    font-family: var(--sans);
    font-size: 12.5px;
    color: var(--fg-2);
    line-height: 1.55;
  }
  .agent-body em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .agent-detail {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 5px 14px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .agent-detail .k {
    color: var(--fg-3);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 9px;
    font-weight: 700;
    white-space: nowrap;
  }
  .agent-detail .v {
    color: var(--fg-2);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .agent-action {
    border: 1px solid var(--fg);
    background: transparent;
    padding: 8px 14px;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
    font-weight: 700;
    transition: background 120ms, color 120ms, opacity 120ms;
    align-self: flex-start;
  }
  .agent-action:hover:not(:disabled) {
    background: var(--fg);
    color: var(--bg);
  }
  .agent-action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Section note ──────────────────────────────────────────────────────── */
  .section-note {
    font-family: var(--sans);
    font-size: 12px;
    color: var(--fg-3);
    line-height: 1.5;
    padding: 14px;
    border: 1px solid var(--rule);
    background: var(--bg-2);
    margin-top: 14px;
  }
  .section-note em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .section-note strong {
    color: var(--fg);
    font-weight: 500;
  }

  /* ── About grid ────────────────────────────────────────────────────────── */
  .about {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 18px;
    font-family: var(--mono);
    font-size: 11px;
  }
  .about .k {
    color: var(--fg-3);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  .about .v {
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }

  /* ── Danger zone ───────────────────────────────────────────────────────── */
  .danger-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .danger-note {
    margin: 0 0 12px;
    color: var(--sev-warn);
    font-family: var(--sans);
    font-size: 12px;
    line-height: 1.4;
  }
  .btn-danger {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 10px 14px;
    color: var(--sev-bad);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms, border-color 120ms, color 120ms;
    text-align: left;
  }
  .btn-danger:hover:not(:disabled) {
    background: var(--bg-2);
    border-color: var(--sev-bad);
  }
  .btn-danger:focus-visible {
    outline: 2px solid var(--sev-bad);
    outline-offset: 2px;
  }
  .btn-danger:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 10px 14px;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  .btn-secondary:hover {
    background: var(--bg-2);
    border-color: var(--fg-3);
  }
  .btn-secondary:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .confirm-group {
    border: 1px solid var(--rule-strong);
    background: var(--bg-2);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .confirm-text {
    font-family: var(--sans);
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.4;
    margin: 0;
  }
  .confirm-actions {
    display: flex;
    gap: 8px;
  }

  /* ── Foot ──────────────────────────────────────────────────────────────── */
  .drawer-foot {
    flex-shrink: 0;
    padding: 18px 24px;
    border-top: 1px solid var(--rule);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
  }
  .drawer-foot .meta {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .drawer-foot .meta .v {
    color: var(--fg);
    margin-left: 6px;
  }
  .drawer-foot .actions {
    display: flex;
    gap: 10px;
  }
  .drawer-foot .btn {
    border: 1px solid var(--rule-strong);
    background: transparent;
    padding: 9px 16px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--fg);
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms, color 120ms, border-color 120ms;
  }
  .drawer-foot .btn:hover {
    background: var(--bg-2);
    border-color: var(--fg-3);
  }
  .drawer-foot .btn:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .drawer-foot .btn--primary {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }
  .drawer-foot .btn--primary:hover {
    background: var(--station-a);
    border-color: var(--station-a);
  }

  /* ── Mobile / narrow ───────────────────────────────────────────────────── */
  @media (max-width: 720px) {
    .field {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .field .label {
      padding-top: 0;
    }
    .endpoint-row {
      grid-template-columns: 14px 1fr auto;
      gap: 10px;
    }
    .endpoint-row .small-toggle {
      display: none;
    }
    .drawer-head {
      padding: 14px 18px;
    }
    .section {
      padding: 20px 18px;
    }
    .drawer-foot {
      padding: 14px 18px;
    }
  }
</style>
