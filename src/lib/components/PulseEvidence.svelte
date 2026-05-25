<script lang="ts">
  import type { PulseInspection } from '$lib/types';
  import { driftLabel, pulseInspectionSummary, thresholdDeltaLabel } from '$lib/utils/pulse-inspection';

  let {
    evidence,
    title = 'Pinned pulse',
    onClear = undefined,
  }: {
    evidence: PulseInspection;
    title?: string;
    onClear?: (() => void) | undefined;
  } = $props();

  const sampleLabel = $derived(
    evidence.roundNumber === null ? `Slot ${evidence.slot}` : `Round #${evidence.roundNumber}`,
  );
  const sourceLabel = $derived(evidence.source === 'endpoint' ? 'Station drill-down' : 'Live tracker');
  const summary = $derived(pulseInspectionSummary(evidence));
</script>

<aside class="pulse-evidence" aria-label={title}>
  <div class="evidence-head">
    <span class="title">{title}</span>
    <span class="source">{sourceLabel}</span>
    {#if onClear}
      <button type="button" class="clear" aria-label="Clear pinned pulse" onclick={onClear}>Clear</button>
    {/if}
  </div>
  <div class="summary">{summary}</div>
  <div class="evidence-grid">
    <div class="cell">
      <span class="k">Station</span>
      <span class="v">{evidence.endpointLabel}</span>
    </div>
    <div class="cell">
      <span class="k">Sample</span>
      <span class="v">{sampleLabel}</span>
    </div>
    <div class="cell">
      <span class="k">Latency</span>
      <span class="v">{evidence.latency} ms</span>
    </div>
    <div class="cell">
      <span class="k">Drift</span>
      <span class="v">{driftLabel(evidence.drift)}</span>
    </div>
    <div class="cell">
      <span class="k">Trigger</span>
      <span class="v">{thresholdDeltaLabel(evidence.thresholdDelta)}</span>
    </div>
    <div class="cell">
      <span class="k">Time</span>
      <span class="v">{evidence.timeLabel ?? '—'}</span>
    </div>
  </div>
</aside>

<style>
  .pulse-evidence {
    position: relative;
    width: 100%;
    max-width: 380px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: var(--fg);
    font-family: var(--mono);
    box-shadow: 0 14px 42px color-mix(in srgb, black 24%, transparent);
  }
  .pulse-evidence::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    width: 34px;
    height: 1px;
    background: var(--station-c);
    box-shadow: 0 0 12px var(--station-c);
  }
  .evidence-head {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 12px;
    padding: 11px 14px 9px;
    border-bottom: 1px solid var(--rule);
  }
  .title,
  .source,
  .clear,
  .cell .k {
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .title {
    color: var(--fg);
  }
  .source {
    color: var(--fg-3);
    white-space: nowrap;
  }
  .clear {
    border: 1px solid var(--rule);
    background: transparent;
    color: var(--fg-3);
    padding: 4px 7px;
    cursor: pointer;
  }
  .clear:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }
  .clear:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .summary {
    padding: 10px 14px;
    border-bottom: 1px solid var(--rule);
    color: var(--fg-2);
    font-family: var(--sans);
    font-size: 12px;
    line-height: 1.35;
  }
  .evidence-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
  }
  .cell {
    min-width: 0;
    padding: 8px 9px;
    background: color-mix(in srgb, var(--bg) 84%, transparent);
  }
  .cell .k {
    display: block;
    color: var(--fg-3);
    margin-bottom: 4px;
  }
  .cell .v {
    color: var(--fg);
    font-size: 11px;
    line-height: 1.25;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 720px) {
    .pulse-evidence {
      max-width: none;
    }
    .evidence-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
