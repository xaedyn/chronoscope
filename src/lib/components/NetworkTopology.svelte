<!-- src/lib/components/NetworkTopology.svelte -->
<!-- Per the synthesis design contract Section 2: Overview right column.       -->
<!-- Spatial visualization of what is actually being measured — browser node    -->
<!-- on the left, one endpoint node per monitored endpoint on the right,        -->
<!-- connecting path lines, animated pulse packets driven by REAL measurement   -->
<!-- round events (not setInterval(Math.random) like the v2 prototype).         -->
<!--                                                                            -->
<!-- Glyphs are rounded squares (not circles) per the Arc C cohesiveness pass.  -->
<!-- Labels switch to a right-side anchor when ≥5 endpoints share the column    -->
<!-- so they can't collide with adjacent nodes. >8 endpoints collapse the last  -->
<!-- slot to a "+N more" chip so the visual cap stays at 8 glyphs.              -->
<script lang="ts">
  import { measurementStore } from '$lib/stores/measurements';
  import { monitoredEndpointsStore } from '$lib/stores/derived';
  import { statisticsStore } from '$lib/stores/statistics';
  import { settingsStore } from '$lib/stores/settings';
  import { uiStore } from '$lib/stores/ui';
  import { navigateTo } from '$lib/router';
  import { deriveEndpointTone, type EndpointTone } from '$lib/utils/endpoint-tone';
  import {
    layoutTopologyNodes,
    TOPOLOGY_VISIBLE_LIMIT,
  } from '$lib/utils/network-topology-layout';

  // Layout grid (SVG viewBox is unitless — these are abstract design units).
  const VIEWBOX_WIDTH = 320;
  const VIEWBOX_HEIGHT = 260;
  const ORIGIN_X = 50;
  const ORIGIN_Y = VIEWBOX_HEIGHT / 2;
  const ENDPOINT_X = 240;
  const NODE_HALF = 14;
  const NODE_SIZE = NODE_HALF * 2;
  const NODE_RADIUS = NODE_HALF; // legacy alias retained for the origin glyph

  const monitored = $derived($monitoredEndpointsStore);
  const stats = $derived($statisticsStore);
  const measurements = $derived($measurementStore);
  const threshold = $derived($settingsStore.healthThreshold);

  // Pulse state — keyed by endpoint id, holds a monotonic counter that
  // increments when a new successful sample arrives for that endpoint.
  // CSS animation re-runs by binding the counter to a `key` attribute on
  // the pulse element (the new key forces Svelte to recreate the node).
  let pulseKeys = $state<Record<string, number>>({});
  let lastSampleCounts: Record<string, number> = {};

  // Watch per-endpoint sample counts and emit a pulse on increment.
  // This is the "real cadence driven by measurement events" the spec
  // requires — no setInterval, no Math.random.
  $effect(() => {
    for (const ep of monitored) {
      const state = measurements.endpoints[ep.id];
      const count = state?.samples.toArray().length ?? 0;
      const prev = lastSampleCounts[ep.id] ?? 0;
      if (count > prev) {
        pulseKeys = { ...pulseKeys, [ep.id]: (pulseKeys[ep.id] ?? 0) + 1 };
      }
      lastSampleCounts[ep.id] = count;
    }
  });

  interface EndpointNode {
    readonly endpoint: { id: string; label: string };
    readonly tone: EndpointTone;
    readonly x: number;
    readonly y: number;
  }

  const layout = $derived(layoutTopologyNodes({
    endpointCount: monitored.length,
    viewboxHeight: VIEWBOX_HEIGHT,
    endpointX: ENDPOINT_X,
  }));

  // Visible endpoint slice: when overflow kicks in we keep the first 7
  // endpoints and use the last slot for the "+N more" chip.
  const visibleEndpoints = $derived.by(() => {
    const cap = layout.hasOverflowSlot
      ? TOPOLOGY_VISIBLE_LIMIT - 1
      : monitored.length;
    return monitored.slice(0, cap);
  });

  const endpointNodes: readonly EndpointNode[] = $derived.by(() => (
    visibleEndpoints.map((ep, i) => {
      const slot = layout.slots[i];
      return {
        endpoint: { id: ep.id, label: ep.label },
        tone: deriveEndpointTone({
          stats: stats[ep.id] ?? null,
          lastStatus: measurements.endpoints[ep.id]?.lastStatus ?? null,
          healthThreshold: threshold,
        }),
        x: slot.x,
        y: slot.y,
      };
    })
  ));

  const overflowSlot = $derived(
    layout.hasOverflowSlot ? layout.slots[layout.slots.length - 1] : null,
  );

  const labelAnchorMode = $derived(layout.labelAnchor);

  // Label-position helper. "below": centered under the node. "right":
  // anchored to the right of the node (start-anchored, vertically centered).
  function labelPosition(node: { x: number; y: number }): { x: number; y: number; anchor: 'middle' | 'start' } {
    if (labelAnchorMode === 'below') {
      return { x: node.x, y: node.y + NODE_HALF + 16, anchor: 'middle' };
    }
    return { x: node.x + NODE_HALF + 6, y: node.y + 4, anchor: 'start' };
  }

  function handleEndpointClick(endpointId: string): void {
    navigateTo({ name: 'endpoint', endpointId });
  }

  function handleAddEndpoint(): void {
    uiStore.toggleEndpoints();
  }

  function handleOverflowClick(): void {
    uiStore.toggleEndpoints();
  }
</script>

{#if monitored.length === 0}
  <div class="network-topology network-topology-empty" aria-label="Network topology — no endpoints">
    <p class="empty-headline">No endpoints to map yet</p>
    <p class="empty-detail">Add an endpoint to see your network map.</p>
    <button type="button" class="empty-cta" onclick={handleAddEndpoint}>
      Add endpoint
    </button>
  </div>
{:else}
  <div class="network-topology" aria-label="Network topology — browser to {monitored.length} endpoints">
    <svg
      class="topology-svg"
      viewBox="0 0 {VIEWBOX_WIDTH} {VIEWBOX_HEIGHT}"
      role="img"
      aria-hidden="true"
    >
      <!-- Connecting path lines (origin → each endpoint, plus overflow slot) -->
      {#each endpointNodes as node (node.endpoint.id)}
        <line
          class="topology-path"
          x1={ORIGIN_X}
          y1={ORIGIN_Y}
          x2={node.x}
          y2={node.y}
          stroke-width="1"
        />
      {/each}
      {#if overflowSlot !== null}
        <line
          class="topology-path topology-path-overflow"
          x1={ORIGIN_X}
          y1={ORIGIN_Y}
          x2={overflowSlot.x}
          y2={overflowSlot.y}
          stroke-width="1"
        />
      {/if}

      <!-- Pulse packets — re-rendered when pulseKeys[ep.id] increments.
           cx/cy are set to the ORIGIN position; the animation translates the
           element via CSS transform (which IS reliably animatable on SVG,
           unlike CSS animation of SVG `cx`/`cy` attributes which silently
           strands the element). The translate distance is the delta from
           origin to endpoint, passed via --pulse-dx/--pulse-dy. -->
      {#each endpointNodes as node (node.endpoint.id)}
        {#if pulseKeys[node.endpoint.id]}
          {#key pulseKeys[node.endpoint.id]}
            <circle
              class="topology-pulse"
              data-tone={node.tone}
              cx={ORIGIN_X}
              cy={ORIGIN_Y}
              r="3.5"
              style:--pulse-dx="{node.x - ORIGIN_X}px"
              style:--pulse-dy="{node.y - ORIGIN_Y}px"
            />
          {/key}
        {/if}
      {/each}

      <!-- Origin (browser) node — kept circular to read as "you" / device. -->
      <g class="topology-node-group" data-role="origin">
        <circle class="topology-node-circle" cx={ORIGIN_X} cy={ORIGIN_Y} r={NODE_RADIUS} />
        <text
          class="topology-label"
          x={ORIGIN_X}
          y={ORIGIN_Y + NODE_HALF + 16}
          text-anchor="middle"
        >
          BROWSER
        </text>
      </g>

      <!-- Endpoint nodes — rounded squares per Arc C cohesiveness pass. -->
      {#each endpointNodes as node (node.endpoint.id)}
        {@const lp = labelPosition(node)}
        <g
          class="topology-node-group topology-node-clickable"
          data-tone={node.tone}
          data-endpoint-id={node.endpoint.id}
          role="button"
          tabindex="0"
          aria-label="View {node.endpoint.label} details"
          onclick={() => handleEndpointClick(node.endpoint.id)}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleEndpointClick(node.endpoint.id);
            }
          }}
        >
          <rect
            class="topology-node-rect"
            x={node.x - NODE_HALF}
            y={node.y - NODE_HALF}
            width={NODE_SIZE}
            height={NODE_SIZE}
            rx="6"
            ry="6"
          />
          <text
            class="topology-label"
            x={lp.x}
            y={lp.y}
            text-anchor={lp.anchor}
          >
            {node.endpoint.label.slice(0, 16)}
          </text>
        </g>
      {/each}

      <!-- Overflow chip (+N more) — claims the last slot when the monitored
           list exceeds the 8-glyph visual cap. Opens the endpoints overlay
           on click so all endpoints stay reachable. -->
      {#if overflowSlot !== null}
        {@const overflowLabel = labelPosition(overflowSlot)}
        <g
          class="topology-node-group topology-overflow-chip"
          data-role="overflow"
          role="button"
          tabindex="0"
          aria-label="Show all {monitored.length} endpoints"
          onclick={handleOverflowClick}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleOverflowClick();
            }
          }}
        >
          <rect
            class="topology-node-rect topology-overflow-rect"
            x={overflowSlot.x - NODE_HALF}
            y={overflowSlot.y - NODE_HALF}
            width={NODE_SIZE}
            height={NODE_SIZE}
            rx="6"
            ry="6"
          />
          <text
            class="topology-overflow-count"
            x={overflowSlot.x}
            y={overflowSlot.y + 4}
            text-anchor="middle"
          >+{layout.overflowCount}</text>
          <text
            class="topology-label"
            x={overflowLabel.x}
            y={overflowLabel.y}
            text-anchor={overflowLabel.anchor}
          >
            MORE
          </text>
        </g>
      {/if}
    </svg>
  </div>
{/if}

<style>
  .network-topology {
    width: 100%;
    height: 100%;
    min-height: 240px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    padding: 16px;
    border: 1px solid var(--shell-border);
    border-radius: 18px;
    background: var(--shell-panel);
  }

  .topology-svg {
    width: 100%;
    height: 100%;
    max-height: 280px;
    overflow: visible;
  }

  /* Path lines — brighter than the prior shell-divider tone so the
     spatial structure reads at a glance against the dark panel. */
  .topology-path {
    stroke: var(--shell-border-strong);
    fill: none;
    stroke-width: 1.2;
  }
  .topology-path-overflow {
    stroke-dasharray: 3 4;
    opacity: 0.7;
  }

  /* Endpoint glyphs — rounded squares per Arc C synthesis. Coloured stroke
     pops against the slightly darker fill; tone-coloured drop-shadow / glow
     gives each endpoint presence rather than reading as a wireframe. */
  .topology-node-rect,
  .topology-node-circle {
    fill: var(--shell-base);
    stroke-width: 2.5;
    transition: stroke 200ms ease, fill 200ms ease;
  }
  [data-role='origin'] .topology-node-circle {
    stroke: var(--t2);
  }
  [data-tone='good'] .topology-node-rect {
    stroke: var(--accent-green);
    filter: drop-shadow(0 0 6px var(--accent-green));
  }
  [data-tone='watch'] .topology-node-rect {
    stroke: var(--accent-amber);
    filter: drop-shadow(0 0 6px var(--accent-amber));
  }
  [data-tone='bad'] .topology-node-rect {
    stroke: var(--accent-pink);
    filter: drop-shadow(0 0 8px var(--accent-pink));
  }
  [data-tone='collecting'] .topology-node-rect {
    stroke: var(--accent-cyan);
    filter: drop-shadow(0 0 6px var(--accent-cyan));
  }

  .topology-node-clickable,
  .topology-overflow-chip {
    cursor: pointer;
  }
  .topology-node-clickable:hover .topology-node-rect,
  .topology-node-clickable:focus-visible .topology-node-rect,
  .topology-overflow-chip:hover .topology-node-rect,
  .topology-overflow-chip:focus-visible .topology-node-rect {
    fill: var(--shell-panel-hover);
  }
  .topology-node-clickable:focus-visible,
  .topology-overflow-chip:focus-visible {
    outline: none;
  }
  .topology-node-clickable:focus-visible .topology-node-rect,
  .topology-overflow-chip:focus-visible .topology-node-rect {
    stroke-width: 3.5;
  }

  .topology-overflow-rect {
    stroke: var(--shell-border-strong);
    fill: var(--shell-panel-hover);
  }
  .topology-overflow-count {
    fill: var(--t1);
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 800;
    pointer-events: none;
  }

  /* Labels — bumped contrast (was --t3 = .5 alpha, barely readable;
     --t2 = .58 still calm but legible). */
  .topology-label {
    fill: var(--t2);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: var(--tr-label);
    text-transform: uppercase;
    pointer-events: none;
  }
  [data-tone='good'] .topology-label,
  [data-tone='watch'] .topology-label,
  [data-tone='bad'] .topology-label,
  [data-tone='collecting'] .topology-label {
    fill: var(--t1);
  }

  /* Pulse packets — animate via CSS transform: translate (which IS
     reliably animatable on SVG elements). The earlier implementation used
     CSS keyframes on the SVG `cx`/`cy` attributes, which Chrome accepts
     syntactically but renders inconsistently and frequently strands the
     element mid-path. The new approach: render the circle at the origin
     coordinates (cx=ORIGIN_X, cy=ORIGIN_Y) and animate transform: translate
     by --pulse-dx / --pulse-dy (the delta to the endpoint). */
  .topology-pulse {
    animation: pulse-travel 1.2s ease-out forwards;
    pointer-events: none;
    transform-box: fill-box;
  }
  [data-tone='good'].topology-pulse { fill: var(--accent-green); }
  [data-tone='watch'].topology-pulse { fill: var(--accent-amber); }
  [data-tone='bad'].topology-pulse { fill: var(--accent-pink); }
  [data-tone='collecting'].topology-pulse { fill: var(--accent-cyan); }

  @keyframes pulse-travel {
    0%   { transform: translate(0, 0);                            opacity: 0; }
    20%  { transform: translate(calc(var(--pulse-dx) * 0.2), calc(var(--pulse-dy) * 0.2)); opacity: 1; }
    80%  { transform: translate(calc(var(--pulse-dx) * 0.8), calc(var(--pulse-dy) * 0.8)); opacity: 1; }
    100% { transform: translate(var(--pulse-dx), var(--pulse-dy));  opacity: 0; }
  }

  .network-topology-empty {
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }
  .empty-headline {
    margin: 0;
    color: var(--t1);
    font-family: var(--sans);
    font-size: var(--ts-base);
    font-weight: 700;
  }
  .empty-detail {
    margin: 0;
    color: var(--t3);
    font-family: var(--sans);
    font-size: var(--ts-sm);
  }
  .empty-cta {
    margin-top: 8px;
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
  .empty-cta:hover { background: var(--shell-panel-hover); }

  @media (prefers-reduced-motion: reduce) {
    .topology-pulse { animation: none; opacity: 0; }
    .topology-node-rect,
    .topology-node-circle { transition: none; }
  }
</style>
