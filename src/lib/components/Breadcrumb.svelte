<!-- src/lib/components/Breadcrumb.svelte -->
<!-- Vessel v4 breadcrumb / coordinate strip. Used on detail pages (endpoint,
     transit, error). Left side is the crumb trail; right side is context meta
     (round, samples, window, trigger, …). Sticky-blurred band below masthead.

     Crumbs without onClick render as static text; crumbs with onClick render
     as links. Current page is auto-highlighted with the focus glow. -->
<script lang="ts">
  interface Crumb {
    readonly label: string;
    readonly onClick?: () => void;
  }
  interface MetaItem {
    readonly label: string;
    readonly value: string;
  }

  let { crumbs, meta = [], current }: {
    crumbs: readonly Crumb[];
    meta?: readonly MetaItem[];
    current: string;
  } = $props();
</script>

<div class="breadcrumb">
  <div class="crumb">
    {#each crumbs as item, i (item.label + i)}
      {#if item.onClick}
        <button type="button" class="crumb-link" onclick={item.onClick}>{item.label}</button>
      {:else}
        <span>{item.label}</span>
      {/if}
      <span class="sep" aria-hidden="true">/</span>
    {/each}
    <span class="current" aria-current="page">{current}</span>
  </div>

  {#if meta.length > 0}
    <div class="meta">
      {#each meta as item (item.label)}
        <span>{item.label}<span class="v">{item.value}</span></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .breadcrumb {
    /* --focus and --focus-glow are scoped to this component so the current-
       page highlight uses station-B without polluting :root. */
    --focus: var(--station-b);
    --focus-glow: color-mix(in srgb, var(--station-b) 50%, transparent);

    padding: 12px clamp(20px, 3vw, 48px);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border-bottom: 1px solid var(--rule);
  }

  .crumb {
    display: inline-flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
    font-weight: 700;
  }
  .crumb-link {
    color: var(--fg-3);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    transition: color 120ms;
  }
  .crumb-link:hover {
    color: var(--fg);
  }
  .crumb-link:focus-visible {
    outline: 2px solid var(--station-b);
    outline-offset: 2px;
  }
  .sep {
    color: var(--fg-4);
  }
  .current {
    color: var(--focus);
    text-shadow: 0 0 8px var(--focus-glow);
  }

  .meta {
    display: inline-flex;
    gap: 22px;
    flex-wrap: wrap;
  }
  .meta > span {
    white-space: nowrap;
  }
  .meta .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 720px) {
    .breadcrumb {
      font-size: 9px;
      gap: 8px;
    }
    .meta {
      gap: 14px;
    }
  }
</style>
