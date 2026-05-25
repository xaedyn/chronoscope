<script lang="ts">
  import type { ReportInstrumentLens } from '$lib/utils/report-instrument-lens';

  let {
    lens,
    onReturnToReplay,
  }: {
    lens: ReportInstrumentLens;
    onReturnToReplay?: () => void;
  } = $props();
</script>

<section class="report-instrument-lens" aria-label="Replay lens">
  <div class="lens-head">
    <div>
      <span class="eyebrow">Replay lens</span>
      <h2>{lens.moment.roundLabel}</h2>
    </div>
    <div class="source" data-source={lens.source}>{lens.source}</div>
  </div>

  <p class="reason">{lens.selectionReason}</p>

  <div class="signal-grid" aria-label="Selected signal readouts">
    <div>
      <span class="k">Station</span>
      <span class="v">{lens.moment.endpointLabel}</span>
    </div>
    <div>
      <span class="k">Latency</span>
      <span class="v">{lens.signal.latencyLabel}</span>
    </div>
    <div>
      <span class="k">Trigger delta</span>
      <span class="v">{lens.signal.thresholdDeltaLabel}</span>
    </div>
    <div>
      <span class="k">Trend</span>
      <span class="v">{lens.signal.trendLabel}</span>
    </div>
  </div>

  <div class="peer-field" aria-label="Same round peer comparison">
    <div class="section-label">Same-round field</div>
    {#if lens.peers.length === 0}
      <p class="empty">No peer samples captured for this round.</p>
    {:else}
      {#each lens.peers as peer (peer.endpointId)}
        <div class="peer-row" data-movement={peer.movement}>
          <span class="station">{peer.stationId ?? '-'}</span>
          <span class="name">{peer.endpointLabel}</span>
          <span class="value">
            {#if peer.latency === null}
              {peer.status}
            {:else}
              {peer.latency} ms
            {/if}
          </span>
          <span class="delta">{peer.thresholdDelta === null ? '-' : `${peer.thresholdDelta >= 0 ? '+' : ''}${peer.thresholdDelta} ms`}</span>
          <span class="movement">{peer.movement}</span>
        </div>
      {/each}
    {/if}
  </div>

  <div class="proof-grid">
    <div>
      <span class="k">What this suggests</span>
      <p>{lens.proof.suggests}</p>
    </div>
    <div>
      <span class="k">What this cannot prove</span>
      <p>{lens.proof.cannotProve}</p>
    </div>
  </div>

  {#if lens.canReturnToReplay && onReturnToReplay}
    <button type="button" class="return" onclick={onReturnToReplay}>Return to replay</button>
  {/if}
</section>

<style>
  .report-instrument-lens {
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 24px 0;
    color: var(--fg);
  }

  .lens-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 10px;
  }

  .eyebrow,
  .source,
  .k,
  .section-label,
  .peer-row {
    font-family: var(--mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .eyebrow,
  .k,
  .section-label {
    color: var(--fg-3);
    font-size: 9px;
    font-weight: 700;
  }

  h2 {
    margin: 4px 0 0;
    font-size: clamp(28px, 4vw, 48px);
    font-weight: 200;
    line-height: 1;
  }

  .source {
    color: var(--fg);
    font-size: 10px;
    font-weight: 700;
  }

  .reason {
    margin: 0 0 18px;
    color: var(--fg-2);
    font-size: 14px;
    line-height: 1.45;
  }

  .signal-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    border: 1px solid var(--rule);
    background: var(--rule);
  }

  .signal-grid > div {
    min-width: 0;
    padding: 13px 14px;
    background: var(--bg);
  }

  .v {
    display: block;
    margin-top: 5px;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }

  .peer-field {
    margin-top: 20px;
  }

  .peer-row {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 90px 88px 130px;
    gap: 12px;
    align-items: center;
    min-height: 42px;
    border-bottom: 1px solid var(--rule);
    font-size: 9px;
  }

  .peer-row[data-movement='selected'] {
    color: var(--station-b);
  }

  .peer-row[data-movement='co-elevated'] {
    color: var(--sev-bad);
  }

  .peer-row[data-movement='wobble'] {
    color: var(--sev-warn);
  }

  .name,
  .value,
  .delta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .proof-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 28px;
    margin-top: 22px;
  }

  .proof-grid p,
  .empty {
    margin: 6px 0 0;
    color: var(--fg-2);
    line-height: 1.45;
    font-size: 14px;
  }

  .return {
    margin-top: 18px;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--fg);
    padding: 10px 13px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .return:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }

  @media (max-width: 760px) {
    .lens-head,
    .proof-grid {
      display: grid;
      grid-template-columns: 1fr;
    }

    .signal-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .peer-row {
      grid-template-columns: 32px minmax(0, 1fr) 74px;
    }

    .peer-row .delta,
    .peer-row .movement {
      display: none;
    }
  }
</style>
