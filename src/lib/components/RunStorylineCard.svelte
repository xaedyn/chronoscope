<!-- src/lib/components/RunStorylineCard.svelte -->
<!-- Compact recent-run storyline. Pure render: evidence derivation lives in -->
<!-- utils/run-storyline so this component cannot invent unsupported claims. -->
<script lang="ts">
  import type {
    EndpointTimelineRow,
    RunStoryline,
    StoryPhase,
    TimelinePoint,
    StoryMarker,
  } from '$lib/utils/run-storyline';

  interface Props {
    storyline: RunStoryline;
    onDrill: (endpointId: string) => void;
  }

  let { storyline, onDrill }: Props = $props();

  function pct(t: number): number {
    const span = Math.max(1, storyline.windowEnd - storyline.windowStart);
    return Math.max(0, Math.min(100, ((t - storyline.windowStart) / span) * 100));
  }

  function phaseBasis(phase: StoryPhase): number {
    const span = Math.max(1, storyline.windowEnd - storyline.windowStart);
    return Math.max(4, ((phase.end - phase.start) / span) * 100);
  }

  function pathFor(row: EndpointTimelineRow): string {
    if (row.points.length === 0) return '';
    let d = '';
    let prevWasGap = true;
    for (const point of row.points) {
      if (point.status === 'failed' || point.normalizedLatency == null) {
        prevWasGap = true;
        continue;
      }
      const x = pct(point.t);
      const y = 22 - Math.min(20, point.normalizedLatency * 20);
      d += `${prevWasGap ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
      prevWasGap = false;
    }
    return d.trim();
  }

  function failurePoints(row: EndpointTimelineRow): readonly TimelinePoint[] {
    return row.points.filter((point) => point.status === 'failed');
  }

  function elevatedPoints(row: EndpointTimelineRow): readonly TimelinePoint[] {
    return row.points.filter((point) => point.status === 'elevated');
  }

  function markerLabel(marker: StoryMarker): string {
    return `${marker.label}, ${marker.evidence}`;
  }

  function drillMarker(marker: StoryMarker): void {
    if (marker.endpointId) onDrill(marker.endpointId);
  }
</script>

<section class="storyline" aria-label="Recent run timeline" data-confidence={storyline.confidence}>
  <header class="storyline-header">
    <div>
      <h3 class="storyline-title">What happened</h3>
      <p class="storyline-sub">Recent run timeline</p>
    </div>
    <p class="storyline-hint">Click a moment -&gt; Diagnose</p>
  </header>

  <div class="story-rail">
    <div class="story-phases" aria-hidden="true">
      {#each storyline.phases as phase (`${phase.kind}-${phase.start}-${phase.end}`)}
        <span
          class="story-phase"
          data-kind={phase.kind}
          style:flex-basis="{phaseBasis(phase)}%"
        >
          <span>{phase.label}</span>
        </span>
      {/each}
    </div>
    {#each storyline.markers as marker (`${marker.kind}-${marker.endpointId ?? 'all'}-${marker.t}`)}
      {#if marker.endpointId}
        <button
          type="button"
          class="story-marker"
          data-kind={marker.kind}
          style:left="{pct(marker.t)}%"
          title={marker.evidence}
          aria-label={markerLabel(marker)}
          onclick={() => drillMarker(marker)}
        ></button>
      {:else}
        <span
          class="story-marker"
          data-kind={marker.kind}
          style:left="{pct(marker.t)}%"
          title={marker.evidence}
        ></span>
      {/if}
    {/each}
  </div>

  <div class="story-rows">
    {#each storyline.rows as row (row.endpointId)}
      <button
        type="button"
        class="story-row"
        style:--ep-color={row.color}
        data-endpoint-id={row.endpointId}
        aria-label="{row.label}, {row.summary}"
        onclick={() => onDrill(row.endpointId)}
      >
        <span class="story-label">
          <span class="story-dot" aria-hidden="true"></span>
          <span class="story-name">{row.label}</span>
        </span>
        <span class="story-track">
          <svg class="story-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
            <path d={pathFor(row)} fill="none" stroke="var(--ep-color)" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" />
          </svg>
          {#each failurePoints(row) as point (`${row.endpointId}-${point.round}-${point.t}`)}
            <span class="story-failure" style:left="{pct(point.t)}%" aria-hidden="true">!</span>
          {/each}
          {#each elevatedPoints(row) as point (`${row.endpointId}-elevated-${point.round}-${point.t}`)}
            <span
              class="story-elevated"
              style:left="{pct(point.t)}%"
              style:top="{22 - Math.min(20, (point.normalizedLatency ?? 0) * 20)}px"
              title="Elevated: higher than recent median but below the slow trigger"
              aria-hidden="true"
            ></span>
          {/each}
        </span>
      </button>
    {/each}
  </div>

  <footer class="story-footer">
    <p class="story-summary">{storyline.summary}</p>
    {#if storyline.overflow}
      <p class="story-overflow">{storyline.overflow.summary}</p>
    {/if}
  </footer>
</section>

<style>
  .storyline {
    background: var(--glass-bg-rail-hover);
    border: 1px solid var(--border-mid);
    border-radius: 14px;
    padding: 14px 16px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .storyline-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 12px;
  }
  .storyline-title {
    margin: 0;
    font-size: var(--ts-lg);
    font-weight: 500;
    color: var(--t1);
    letter-spacing: var(--tr-tight);
  }
  .storyline-sub {
    margin: 2px 0 0;
    font-family: var(--mono);
    font-size: var(--ts-xs);
    letter-spacing: var(--tr-kicker);
    color: var(--t3);
    text-transform: uppercase;
  }
  .storyline-hint {
    margin: 0;
    font-family: var(--mono);
    font-size: var(--ts-xs);
    color: var(--t2);
    white-space: nowrap;
  }

  .story-rail {
    position: relative;
    min-width: 0;
    padding-top: 3px;
  }
  .story-phases {
    display: flex;
    height: 22px;
    overflow: hidden;
    border-radius: 5px;
    background: rgba(255,255,255,.035);
    border: 1px solid var(--border-mid);
  }
  .story-phase {
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 7px;
    font-family: var(--mono);
    font-size: var(--ts-xs);
    color: var(--t2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-right: 1px solid rgba(255,255,255,.07);
  }
  .story-phase:last-child { border-right: none; }
  .story-phase[data-kind="steady"],
  .story-phase[data-kind="recovered"] {
    background: rgba(74, 222, 128, .08);
    color: var(--t2);
  }
  .story-phase[data-kind="isolated-slow"] {
    background: rgba(251, 191, 36, .13);
    color: var(--accent-amber);
  }
  .story-phase[data-kind="shared-slow"],
  .story-phase[data-kind="failure"] {
    background: rgba(249, 168, 212, .13);
    color: var(--accent-pink);
  }
  .story-phase[data-kind="collecting"] {
    background: rgba(148, 163, 184, .08);
    color: var(--t3);
  }
  .story-marker {
    position: absolute;
    top: 1px;
    bottom: -3px;
    width: 10px;
    padding: 0;
    border: none;
    background: transparent;
    transform: translateX(-50%);
    cursor: pointer;
  }
  .story-marker::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-.5px);
    background: rgba(255,255,255,.55);
  }
  .story-marker:focus-visible {
    outline: 1.5px solid var(--accent-cyan);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .story-marker[data-kind="failure"]::before { background: var(--accent-pink); }
  .story-marker[data-kind="slowdown"]::before,
  .story-marker[data-kind="shared-change"]::before { background: var(--accent-amber); }
  .story-marker[data-kind="recovery"]::before { background: var(--accent-green); }

  .story-rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .story-row {
    display: grid;
    grid-template-columns: 118px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .story-row:hover {
    background: rgba(255,255,255,.035);
    border-color: var(--border-mid);
  }
  .story-row:focus-visible {
    outline: 1.5px solid var(--accent-cyan);
    outline-offset: 2px;
  }
  .story-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .story-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ep-color);
    box-shadow: 0 0 6px var(--ep-color);
    flex: 0 0 auto;
  }
  .story-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: var(--ts-sm);
    color: var(--t1);
    letter-spacing: var(--tr-body);
  }
  .story-track {
    position: relative;
    height: 24px;
    min-width: 0;
    border-radius: 4px;
    background:
      linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0 / 25% 100%,
      linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.045));
    overflow: hidden;
  }
  .story-track::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 7px;
    height: 1px;
    background: rgba(255,255,255,.08);
  }
  .story-spark {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: .9;
  }
  .story-failure {
    position: absolute;
    top: 3px;
    width: 11px;
    height: 16px;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    border-radius: 3px;
    background: rgba(249, 168, 212, .16);
    color: var(--accent-pink);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }
  .story-elevated {
    position: absolute;
    width: 7px;
    height: 7px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 1px solid var(--accent-amber);
    background: rgba(251, 191, 36, .12);
    box-shadow: 0 0 5px rgba(251, 191, 36, .28);
  }

  .story-footer {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: baseline;
    min-width: 0;
  }
  .story-summary,
  .story-overflow {
    margin: 0;
    min-width: 0;
    font-family: var(--mono);
    font-size: var(--ts-sm);
    color: var(--t2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .story-summary { color: var(--t1); }
  .story-overflow {
    flex: 0 0 auto;
    color: var(--t3);
  }

  @media (max-width: 1023px) {
    .storyline {
      gap: 6px;
      padding: 10px 12px;
    }
    .storyline-hint { display: none; }
    .story-phases { height: 18px; }
    .story-row {
      grid-template-columns: 96px minmax(0, 1fr);
      height: 20px;
    }
    .story-track { height: 20px; }
    .story-footer { display: block; }
    .story-overflow { margin-top: 2px; }
  }

  @media (max-width: 767px) and (max-height: 760px) {
    .storyline {
      padding: 8px 10px;
      gap: 5px;
    }
    .storyline-title { font-size: var(--ts-base); }
    .storyline-sub { display: none; }
    .story-phases { height: 16px; }
    .story-phase { padding-inline: 5px; }
    .story-row { height: 18px; }
    .story-track { height: 18px; }
  }
</style>
