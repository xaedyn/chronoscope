<script lang="ts">
  import type {
    GuidedProofFlow,
    GuidedProofPrimaryAction,
    GuidedProofStepStatus,
  } from '$lib/utils/proof-flow';

  interface Props {
    flow: GuidedProofFlow;
    compact?: boolean;
    title?: string;
    onAction?: (action: GuidedProofPrimaryAction) => void;
  }

  let {
    flow,
    compact = false,
    title = 'Guided proof',
    onAction = undefined,
  }: Props = $props();

  const action = $derived(flow.primaryAction);

  function statusLabel(status: GuidedProofStepStatus): string {
    switch (status) {
      case 'captured':
        return 'Captured';
      case 'recommended':
        return 'Recommended';
      case 'running':
        return 'Running';
      case 'failed':
        return 'Failed';
      case 'stale':
        return 'Stale';
      case 'optional':
        return 'Optional';
      case 'ready':
        return 'Ready';
      case 'draft':
        return 'Draft';
      case 'blocked':
        return 'Blocked';
    }
  }

  function handlePrimaryAction(): void {
    if (action.disabled) return;
    onAction?.(action);
  }
</script>

<section class="guided-proof-flow" class:compact aria-label={title}>
  <div class="proof-head">
    <div>
      <span class="proof-kicker">{title}</span>
      <h3>{flow.targetEndpointLabel}</h3>
    </div>
    <button
      type="button"
      class="proof-action"
      disabled={action.disabled}
      data-action={action.id}
      onclick={handlePrimaryAction}
    >
      <span>{action.label}</span>
      <small>{action.detail}</small>
    </button>
  </div>

  <div class="proof-answers">
    <div>
      <span class="k">Measured</span>
      <p>{flow.measured}</p>
    </div>
    <div>
      <span class="k">Suggests</span>
      <p>{flow.suggests}</p>
    </div>
    <div>
      <span class="k">Cannot prove</span>
      <p>{flow.cannotProve}</p>
    </div>
    <div>
      <span class="k">Next</span>
      <p>{flow.next}</p>
    </div>
  </div>

  <div class="proof-steps" aria-label="Proof steps">
    {#each flow.steps as step (step.id)}
      <div class="proof-step" data-status={step.status} data-tone={step.tone}>
        <span class="dot"></span>
        <div class="step-copy">
          <div class="step-line">
            <strong>{step.label}</strong>
            <span>{statusLabel(step.status)}</span>
          </div>
          <p>{step.summary}</p>
          {#if !compact}
            <small>{step.detail}</small>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .guided-proof-flow {
    --proof-accent: var(--station-c);
    width: 100%;
    min-width: 0;
    border: 1px solid var(--rule);
    border-top-color: var(--rule-strong);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--bg-2) 80%, transparent), color-mix(in srgb, var(--bg) 88%, transparent));
    color: var(--fg);
    font-family: var(--sans);
    overflow: hidden;
  }

  .proof-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, 0.36fr);
    gap: 16px;
    align-items: stretch;
    padding: 14px;
    border-bottom: 1px solid var(--rule);
  }

  .proof-kicker,
  .k,
  .step-line span,
  .proof-action small {
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .proof-kicker {
    color: var(--fg-3);
  }

  .proof-head h3 {
    margin: 5px 0 0;
    font-size: 21px;
    font-weight: 300;
    line-height: 1.05;
    color: var(--fg);
  }

  .proof-action {
    min-width: 0;
    border: 1px solid var(--rule-strong);
    border-radius: 0;
    background: color-mix(in srgb, var(--station-c) 9%, transparent);
    color: var(--fg);
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    display: grid;
    gap: 5px;
  }

  .proof-action span {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .proof-action small {
    color: var(--fg-3);
    line-height: 1.35;
    letter-spacing: 0.08em;
  }

  .proof-action:hover:not(:disabled) {
    border-color: var(--station-c);
    color: var(--station-c);
  }

  .proof-action:focus-visible {
    outline: 2px solid var(--station-c);
    outline-offset: 2px;
  }

  .proof-action:disabled {
    cursor: wait;
    opacity: 0.68;
  }

  .proof-answers {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border-bottom: 1px solid var(--rule);
  }

  .proof-answers > div {
    min-width: 0;
    background: color-mix(in srgb, var(--bg-2) 74%, var(--bg));
    padding: 11px 12px 13px;
  }

  .k {
    color: var(--fg-3);
  }

  .proof-answers p {
    margin: 6px 0 0;
    color: var(--fg-2);
    font-size: 12px;
    line-height: 1.42;
  }

  .proof-steps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
  }

  .proof-step {
    min-width: 0;
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr);
    gap: 10px;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    padding: 12px;
  }

  .dot {
    width: 8px;
    height: 8px;
    margin-top: 5px;
    background: var(--fg-3);
    box-shadow: 0 0 10px color-mix(in srgb, var(--fg-3) 40%, transparent);
  }

  .proof-step[data-tone="good"] .dot,
  .proof-step[data-status="ready"] .dot,
  .proof-step[data-status="captured"] .dot {
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
  }

  .proof-step[data-tone="watch"] .dot,
  .proof-step[data-status="recommended"] .dot,
  .proof-step[data-status="running"] .dot,
  .proof-step[data-status="stale"] .dot,
  .proof-step[data-status="draft"] .dot {
    background: var(--sev-warn);
    box-shadow: 0 0 12px var(--sev-warn);
  }

  .proof-step[data-tone="bad"] .dot,
  .proof-step[data-status="failed"] .dot,
  .proof-step[data-status="blocked"] .dot {
    background: var(--sev-bad);
    box-shadow: 0 0 12px var(--sev-bad);
  }

  .step-copy {
    min-width: 0;
  }

  .step-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .step-line strong {
    min-width: 0;
    color: var(--fg);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .step-line span {
    color: var(--fg-3);
    letter-spacing: 0.1em;
    white-space: nowrap;
  }

  .proof-step p,
  .proof-step small {
    display: block;
    margin: 6px 0 0;
    color: var(--fg-2);
    font-size: 11px;
    line-height: 1.35;
  }

  .proof-step small {
    color: var(--fg-3);
  }

  .compact .proof-answers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .compact .proof-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (max-width: 920px) {
    .proof-head,
    .proof-answers,
    .proof-steps,
    .compact .proof-answers,
    .compact .proof-steps {
      grid-template-columns: 1fr;
    }
  }
</style>
