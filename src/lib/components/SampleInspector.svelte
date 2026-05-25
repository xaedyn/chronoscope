<script lang="ts">
  import type { SampleInspector } from '$lib/utils/sample-inspector';
  import { inspectorDeltaLabel } from '$lib/utils/sample-inspector';

  let { inspector }: { inspector: SampleInspector } = $props();

  const sampleLabel = $derived(
    inspector.evidence.roundNumber === null
      ? `Slot ${inspector.evidence.slot}`
      : `Round #${inspector.evidence.roundNumber}`,
  );
  const peerLabel = $derived(
    inspector.peerSlowestLabel === null || inspector.peerSlowestLatency === null
      ? 'No peer sample'
      : `${inspector.peerSlowestLabel} · ${inspector.peerSlowestLatency} ms`,
  );
</script>

<section class="sample-inspector" aria-label="Sample inspector">
  <div class="inspector-head">
    <span>Sample inspector</span>
    <strong>{sampleLabel}</strong>
  </div>
  <p>{inspector.why}</p>
  <div class="inspector-grid">
    <div>
      <span class="k">Previous</span>
      <span class="v">{inspector.previousLatency === null ? '—' : `${inspector.previousLatency} ms`}</span>
      <span class="d">{inspectorDeltaLabel(inspector.previousDelta)}</span>
    </div>
    <div>
      <span class="k">Current</span>
      <span class="v">{inspector.evidence.latency} ms</span>
      <span class="d">{inspector.evidence.endpointLabel}</span>
    </div>
    <div>
      <span class="k">Next</span>
      <span class="v">{inspector.nextLatency === null ? '—' : `${inspector.nextLatency} ms`}</span>
      <span class="d">{inspectorDeltaLabel(inspector.nextDelta)}</span>
    </div>
    <div>
      <span class="k">Peers over trigger</span>
      <span class="v">{inspector.peerOverThresholdCount} / {inspector.peerSampleCount}</span>
      <span class="d">{peerLabel}</span>
    </div>
  </div>
</section>

<style>
  .sample-inspector {
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 22px 0 24px;
    color: var(--fg);
  }
  .inspector-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .inspector-head strong {
    color: var(--fg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  p {
    margin: 0 0 18px;
    max-width: 82ch;
    color: var(--fg-2);
    font-size: 15px;
    line-height: 1.45;
  }
  .inspector-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .inspector-grid > div {
    min-width: 0;
    background: var(--bg);
    padding: 14px 16px;
  }
  .k,
  .d {
    display: block;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .v {
    display: block;
    margin: 6px 0 4px;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 720px) {
    .sample-inspector {
      padding: 18px 0 20px;
    }
    .inspector-head {
      align-items: flex-start;
      flex-direction: column;
      gap: 6px;
    }
    .inspector-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
