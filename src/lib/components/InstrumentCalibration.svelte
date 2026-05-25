<script lang="ts">
  import {
    buildInstrumentCalibration,
    INSTRUMENT_ENCODINGS,
    type InstrumentMode,
  } from '$lib/utils/instrument-calibration';

  let {
    mode,
    thresholdMs,
    windowSeconds,
    baselineMs,
    stationCount,
    cadenceMs = null,
    sampleSlots = null,
    carrierLosses = 0,
    isRecording = false,
    compact = false,
  }: {
    mode: InstrumentMode;
    thresholdMs: number;
    windowSeconds: number;
    baselineMs: number | null;
    stationCount: number;
    cadenceMs?: number | null;
    sampleSlots?: number | null;
    carrierLosses?: number;
    isRecording?: boolean;
    compact?: boolean;
  } = $props();

  const calibration = $derived(buildInstrumentCalibration({
    mode,
    thresholdMs,
    windowSeconds,
    baselineMs,
    stationCount,
    cadenceMs,
    sampleSlots,
    carrierLosses,
    isRecording,
  }));
</script>

<aside
  class="instrument-calibration"
  data-mode={mode}
  data-compact={compact ? 'true' : 'false'}
  aria-label={calibration.ariaLabel}
>
  <div class="calibration-head">
    <span class="title">Instrument key</span>
    <span class="mode">{calibration.modeLabel}</span>
  </div>
  <p class="summary">{calibration.summary}</p>

  <div class="readouts" aria-label="Calibration readouts">
    {#each calibration.readouts as readout (readout.label)}
      <div class="readout">
        <span class="k">{readout.label}</span>
        <span class="v">{readout.value}</span>
      </div>
    {/each}
  </div>

  <div class="encoding-grid" aria-label="Visual encoding key">
    {#each INSTRUMENT_ENCODINGS as encoding (encoding.key)}
      <div class="encoding-row" data-key={encoding.key}>
        <span class="mark" aria-hidden="true"></span>
        <span class="label">{encoding.label}</span>
        <span class="desc">{encoding.description}</span>
      </div>
    {/each}
  </div>
</aside>

<style>
  .instrument-calibration {
    position: relative;
    width: 100%;
    max-width: 380px;
    padding: 12px 14px 14px;
    border: 1px solid var(--rule);
    background: color-mix(in srgb, var(--bg) 68%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: var(--fg);
    font-family: var(--mono);
    box-shadow: 0 14px 42px color-mix(in srgb, black 24%, transparent);
  }
  .instrument-calibration::before {
    content: '';
    position: absolute;
    top: -1px;
    left: -1px;
    width: 34px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
  }

  .calibration-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--rule);
  }
  .title,
  .mode,
  .readout .k,
  .encoding-row .label {
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .title {
    color: var(--fg);
  }
  .mode {
    color: var(--fg-3);
    text-align: right;
  }
  .summary {
    margin: 10px 0 11px;
    font-family: var(--sans);
    font-size: 12px;
    line-height: 1.35;
    color: var(--fg-2);
  }

  .readouts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .readout {
    min-width: 0;
    padding: 8px 9px;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
  }
  .readout:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
  .readout .k {
    display: block;
    color: var(--fg-3);
    margin-bottom: 4px;
  }
  .readout .v {
    display: block;
    color: var(--fg);
    font-size: 11px;
    line-height: 1.25;
    font-variant-numeric: tabular-nums;
    white-space: normal;
  }

  .encoding-grid {
    display: grid;
    gap: 7px;
    margin-top: 12px;
  }
  .encoding-row {
    display: grid;
    grid-template-columns: 13px 82px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .encoding-row .label {
    color: var(--fg);
  }
  .encoding-row .desc {
    color: var(--fg-3);
    font-size: 10px;
    line-height: 1.3;
  }
  .mark {
    display: inline-block;
    width: 12px;
    height: 12px;
    position: relative;
  }
  .encoding-row[data-key="angle"] .mark::before {
    content: '';
    position: absolute;
    inset: 2px;
    border: 1px solid var(--fg-3);
    border-radius: 50%;
    border-right-color: var(--station-b);
  }
  .encoding-row[data-key="radius"] .mark::before {
    content: '';
    position: absolute;
    left: 1px;
    right: 1px;
    top: 5px;
    height: 1px;
    background: var(--station-a);
    box-shadow: 0 0 8px var(--station-a);
  }
  .encoding-row[data-key="color"] .mark::before {
    content: '';
    position: absolute;
    inset: 2px;
    background: linear-gradient(90deg, var(--station-a), var(--station-b), var(--station-c), var(--sev-bad));
  }
  .encoding-row[data-key="pulse"] .mark::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 4px;
    width: 4px;
    height: 4px;
    background: var(--station-c);
    border-radius: 50%;
    box-shadow: 0 0 10px var(--station-c);
  }
  .encoding-row[data-key="gap"] .mark::before {
    content: '';
    position: absolute;
    left: 1px;
    right: 1px;
    top: 5px;
    height: 2px;
    background: repeating-linear-gradient(90deg, var(--sev-crit) 0 3px, transparent 3px 5px);
  }
  .encoding-row[data-key="threshold"] .mark::before {
    content: '';
    position: absolute;
    left: 5px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--sev-bad);
    box-shadow: 0 0 8px var(--sev-bad);
  }
  .encoding-row[data-key="drift"] .mark::before,
  .encoding-row[data-key="drift"] .mark::after {
    content: '';
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 1px;
    background: var(--fg-3);
  }
  .encoding-row[data-key="drift"] .mark::before { left: 3px; }
  .encoding-row[data-key="drift"] .mark::after {
    right: 3px;
    background: var(--station-b);
    box-shadow: 0 0 8px var(--station-b);
  }

  .instrument-calibration[data-compact="true"] {
    max-width: 640px;
  }
  .instrument-calibration[data-compact="true"] .summary {
    margin-bottom: 10px;
  }
  .instrument-calibration[data-compact="true"] .encoding-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px 12px;
  }
  .instrument-calibration[data-compact="true"] .encoding-row {
    display: inline-flex;
    gap: 8px;
    min-width: 0;
  }
  .instrument-calibration[data-compact="true"] .encoding-row .label {
    min-width: 0;
    white-space: nowrap;
  }
  .instrument-calibration[data-compact="true"] .encoding-row .desc {
    display: none;
  }

  @media (max-width: 720px) {
    .instrument-calibration {
      max-width: none;
      padding: 10px 12px 12px;
    }
    .summary {
      font-size: 11px;
    }
    .readouts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .encoding-grid,
    .instrument-calibration[data-compact="true"] .encoding-grid {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .encoding-row,
    .instrument-calibration[data-compact="true"] .encoding-row {
      grid-template-columns: 13px 72px minmax(0, 1fr);
    }
    .instrument-calibration[data-compact="true"] .encoding-row {
      display: grid;
    }
    .encoding-row .desc {
      font-size: 9px;
    }
  }
</style>
