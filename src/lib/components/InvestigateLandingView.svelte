<!-- src/lib/components/InvestigateLandingView.svelte -->
<!-- Two-column Investigate landing surface extracted from DiagnoseView as     -->
<!-- part of the Arc C cohesiveness pass (cohesiveness gap B3). The landing    -->
<!-- view is conceptually distinct from the focused-endpoint detail surface    -->
<!-- (which still lives in DiagnoseView), so it earns its own component file   -->
<!-- to keep both surfaces independently auditable.                            -->
<!--                                                                            -->
<!-- This component pulls every input it needs directly from the project       -->
<!-- stores so DiagnoseView's existing template can swap a single `<...>` mount -->
<!-- in for the prior ~110-line inline markup. No props.                       -->
<script lang="ts">
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { statisticsStore } from '$lib/stores/statistics';
  import { measurementStore } from '$lib/stores/measurements';
  import { settingsStore } from '$lib/stores/settings';
  import { remoteVantageStore } from '$lib/stores/remote-vantage';
  import { companionStore } from '$lib/stores/companion';
  import { uiStore } from '$lib/stores/ui';
  import { navigateTo } from '$lib/router';
  import { deriveEndpointTone, ENDPOINT_TONE_PILL_LABEL, type EndpointTone } from '$lib/utils/endpoint-tone';
  import { describeTimingVisibility, type TimingVisibility } from '$lib/utils/diagnostic-narrative';
  import type { Endpoint } from '$lib/types';

  interface LandingCard {
    readonly endpoint: Endpoint;
    readonly tone: EndpointTone;
    readonly pillLabel: string;
    readonly latencyMs: string;
    readonly jitterMs: string;
    readonly failPct: string;
    readonly visibilityLevel: TimingVisibility['level'];
  }

  const monitored = $derived($monitoredEndpointsStore);
  const stats = $derived($statisticsStore);
  const measurements = $derived($measurementStore);
  const settings = $derived($settingsStore);
  const remoteVantage = $derived($remoteVantageStore);
  const companionInstalled = $derived($companionStore.hasSecret === true);

  function fmt(value: number): string {
    return Math.round(value).toString();
  }

  const landingCards: readonly LandingCard[] = $derived.by(() => (
    monitored.map((ep): LandingCard => {
      const epStats = stats[ep.id] ?? null;
      const epState = measurements.endpoints[ep.id];
      const lastStatus = epState?.lastStatus ?? null;
      const tone = deriveEndpointTone({
        stats: epStats,
        lastStatus,
        healthThreshold: settings.healthThreshold,
      });
      const allSamples = epState?.samples.toArray() ?? [];
      const vis = describeTimingVisibility(allSamples, settings.corsMode);
      return {
        endpoint: ep,
        tone,
        pillLabel: ENDPOINT_TONE_PILL_LABEL[tone],
        latencyMs: epStats?.ready ? `${fmt(epStats.p50)} ms` : '—',
        jitterMs: epStats?.ready ? `${fmt(epStats.stddev)} ms` : '—',
        failPct: epStats?.ready ? `${epStats.lossPercent.toFixed(1)}%` : '—',
        visibilityLevel: vis.level,
      };
    })
  ));

  const remoteVantageStatus = $derived(remoteVantage.status);

  function handleEndpointCardClick(endpointId: string): void {
    navigateTo({ name: 'endpoint', endpointId });
  }

  function handleRunOutsideCheck(): void {
    // Defer to the existing remote-vantage flow — the spec wires this card
    // to the same probe the focused-detail Outside Check button uses.
    // The landing button runs the probe across ALL monitored endpoints
    // (the underlying API accepts a list), so the user gets a global check
    // rather than committing to one endpoint first.
    if (monitored.length > 0) {
      void remoteVantageStore.runProbe(monitored);
    }
  }

  function handleOpenEndpoints(): void {
    uiStore.toggleEndpoints();
  }
</script>

<div class="investigate-landing" role="region" aria-label="Investigate landing">
  <section class="measured-column" aria-label="Measured from your browser">
    <header class="landing-col-header">
      <p class="landing-kicker">MEASURED FROM YOUR BROWSER</p>
      <p class="landing-subtitle">What we can definitively see from your current environment.</p>
    </header>
    {#if landingCards.length === 0}
      <!-- Arc C C8: empty-state for the measured column when no endpoints
           are monitored. Slots into the column with the same border family
           as the cards so the visual rhythm holds. -->
      <div class="landing-empty" role="note">
        <p class="landing-empty-headline">No endpoints to investigate yet.</p>
        <p class="landing-empty-detail">Add an endpoint from the settings cog to start collecting browser-side facts.</p>
        <button type="button" class="landing-empty-cta" onclick={handleOpenEndpoints}>
          Add endpoint
        </button>
      </div>
    {:else}
      <ul class="endpoint-cards">
        {#each landingCards as card (card.endpoint.id)}
          <li>
            <button
              type="button"
              class="endpoint-card"
              data-endpoint-id={card.endpoint.id}
              data-tone={card.tone}
              aria-label="View {card.endpoint.label} details"
              onclick={() => handleEndpointCardClick(card.endpoint.id)}
            >
              <div class="endpoint-card-row">
                <span class="endpoint-card-name">{card.endpoint.label}</span>
                <span class="endpoint-card-pill">{card.pillLabel}</span>
              </div>
              <div class="endpoint-card-metrics">
                <div class="endpoint-card-metric">
                  <span class="endpoint-card-metric-label">LATENCY</span>
                  <span class="endpoint-card-metric-value">{card.latencyMs}</span>
                </div>
                <div class="endpoint-card-metric">
                  <span class="endpoint-card-metric-label">JITTER</span>
                  <span class="endpoint-card-metric-value">{card.jitterMs}</span>
                </div>
                <div class="endpoint-card-metric">
                  <span class="endpoint-card-metric-label">FAILURES</span>
                  <span class="endpoint-card-metric-value">{card.failPct}</span>
                </div>
              </div>
              <div class="endpoint-card-visibility" data-visibility-level={card.visibilityLevel}>
                {#if card.visibilityLevel === 'none'}
                  COLLECTING
                {:else if card.visibilityLevel === 'total-only'}
                  HIDDEN BY SERVER
                {:else if card.visibilityLevel === 'mixed'}
                  PARTIAL VISIBILITY
                {:else}
                  FULL VISIBILITY
                {/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="validation-column" aria-label="Needs outside validation">
    <header class="landing-col-header">
      <p class="landing-kicker">NEEDS OUTSIDE VALIDATION</p>
      <p class="landing-subtitle">Data required to prove whether the issue is local to you.</p>
    </header>
    <div class="validation-card">
      <h3 class="validation-card-title">Check from Outside Vantage Points</h3>
      <p class="validation-card-detail">
        Right now we only know what your specific browser is experiencing.
        An outside check will prove if this slowness happens to everyone
        globally, or just your local connection.
      </p>
      <button
        type="button"
        class="validation-card-cta"
        disabled={monitored.length === 0 || remoteVantageStatus === 'probing' || remoteVantageStatus === 'checking'}
        onclick={handleRunOutsideCheck}
      >
        {remoteVantageStatus === 'probing' ? 'Running…' : 'Run global test'}
      </button>
    </div>

    <div class="validation-card" data-state={companionInstalled ? 'installed' : 'not-installed'}>
      <h3 class="validation-card-title">
        Check with Local Agent
        {#if !companionInstalled}
          <span class="validation-card-flag">NOT INSTALLED</span>
        {/if}
      </h3>
      <p class="validation-card-detail">
        A desktop agent can bypass browser security limits to measure precise
        TCP / TLS times and network routing directly from your machine.
      </p>
    </div>

    <aside class="why-separate-callout" aria-label="Why we separate facts from interpretation">
      <p>
        <strong>Why do we separate this?</strong> We measure latency, but we
        never guess the root cause without proof. Separating facts from
        interpretation prevents falsely blaming your ISP or a specific server.
      </p>
    </aside>
  </section>
</div>

<style>
  .investigate-landing {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
    gap: 32px;
    align-items: start;
  }
  .landing-col-header {
    margin-bottom: 16px;
  }
  .landing-kicker {
    margin: 0;
    color: var(--t3);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
  }
  .landing-subtitle {
    margin: 6px 0 0;
    color: var(--t2);
    font-family: var(--sans);
    font-size: var(--ts-sm);
    line-height: 1.5;
  }
  .endpoint-cards {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .landing-empty {
    padding: 18px;
    border: 1px dashed var(--shell-border);
    border-radius: 14px;
    background: var(--shell-panel);
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .landing-empty-headline {
    margin: 0;
    color: var(--t1);
    font-family: var(--sans);
    font-size: var(--ts-sm);
    font-weight: 700;
  }
  .landing-empty-detail {
    margin: 0;
    color: var(--t3);
    font-family: var(--sans);
    font-size: var(--ts-xs);
    line-height: 1.45;
  }
  .landing-empty-cta {
    margin-top: 8px;
    align-self: flex-start;
    min-height: 36px;
    padding: 0 16px;
    border: 1px solid var(--shell-border-strong);
    background: var(--shell-bg-cyan);
    color: var(--accent-cyan);
    font-family: var(--sans);
    font-size: var(--ts-sm);
    font-weight: 700;
    cursor: pointer;
    border-radius: 8px;
  }
  .landing-empty-cta:hover { background: var(--shell-panel-hover); }
  .endpoint-card {
    width: 100%;
    padding: 18px;
    border: 1px solid var(--shell-border);
    border-radius: 14px;
    background: var(--shell-panel);
    color: var(--t1);
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 14px;
    transition: background 160ms ease, border-color 160ms ease;
  }
  .endpoint-card:hover { background: var(--shell-panel-hover); }
  .endpoint-card:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 2px;
  }
  .endpoint-card-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .endpoint-card-name {
    font-family: var(--mono);
    font-size: var(--ts-md);
    font-weight: 700;
    color: var(--t1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .endpoint-card-pill {
    padding: 4px 10px;
    border-radius: 999px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
    border: 1px solid var(--shell-border-strong);
    background: var(--shell-bg-cyan);
    color: var(--accent-cyan);
  }
  .endpoint-card[data-tone='good'] .endpoint-card-pill {
    color: var(--accent-green);
    background: var(--shell-success-bg);
    border-color: var(--shell-success-border);
  }
  .endpoint-card[data-tone='watch'] .endpoint-card-pill {
    color: var(--accent-amber);
    background: var(--shell-bg-amber);
    border-color: var(--shell-stop-border);
  }
  .endpoint-card[data-tone='bad'] .endpoint-card-pill {
    color: var(--accent-pink);
    background: var(--shell-stop-bg);
    border-color: var(--shell-stop-border);
  }
  .endpoint-card-metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .endpoint-card-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--shell-base) 54%, transparent);
  }
  .endpoint-card-metric-label {
    color: var(--t4);
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
  }
  .endpoint-card-metric-value {
    color: var(--t1);
    font-family: var(--mono);
    font-size: var(--ts-sm);
    font-weight: 700;
  }
  .endpoint-card-visibility {
    padding: 6px 10px;
    border-radius: 6px;
    align-self: flex-start;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
  }
  .endpoint-card-visibility[data-visibility-level='none'] {
    color: var(--accent-cyan);
    background: var(--shell-bg-cyan);
  }
  .endpoint-card-visibility[data-visibility-level='total-only'],
  .endpoint-card-visibility[data-visibility-level='mixed'] {
    color: var(--accent-amber);
    background: var(--shell-bg-amber);
  }
  .endpoint-card-visibility[data-visibility-level='phase'] {
    color: var(--accent-green);
    background: var(--shell-success-bg);
  }

  .validation-card {
    padding: 18px;
    margin-bottom: 14px;
    border: 1px solid var(--shell-border);
    border-radius: 14px;
    background: var(--shell-panel);
  }
  .validation-card-title {
    margin: 0 0 8px;
    color: var(--t1);
    font-family: var(--sans);
    font-size: var(--ts-base);
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .validation-card-flag {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--shell-panel-hover);
    color: var(--t3);
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
  }
  .validation-card-detail {
    margin: 0 0 12px;
    color: var(--t2);
    font-family: var(--sans);
    font-size: var(--ts-sm);
    line-height: 1.55;
  }
  .validation-card-cta {
    min-height: 36px;
    padding: 0 16px;
    border-radius: 8px;
    border: 0;
    background: var(--shell-bg-cyan);
    color: var(--accent-cyan);
    font-family: var(--sans);
    font-size: var(--ts-sm);
    font-weight: 700;
    cursor: pointer;
  }
  .validation-card-cta:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .validation-card[data-state='not-installed'] {
    opacity: 0.7;
  }

  .why-separate-callout {
    margin-top: 16px;
    padding: 16px;
    border: 1px solid var(--shell-border-strong);
    border-radius: 14px;
    background: var(--shell-bg-cyan);
  }
  .why-separate-callout p {
    margin: 0;
    color: var(--t1);
    font-family: var(--sans);
    font-size: var(--ts-sm);
    line-height: 1.6;
  }
  .why-separate-callout strong {
    color: var(--accent-cyan);
  }

  @media (max-width: 1023px) {
    .investigate-landing {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .endpoint-card { transition: none; }
  }
</style>
