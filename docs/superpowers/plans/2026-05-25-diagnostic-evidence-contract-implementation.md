# Diagnostic Evidence Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared evidence contract that separates current status, notable historical events, selected evidence, limitations, and next validation across the main Chronoscope pages.

**Architecture:** Add a pure utility that derives cross-page diagnostic copy and notable-event metadata from the existing diagnostic report, measurements, endpoints, and significant pulse. Wire the utility into Overview, Live, Investigate, Endpoint, and Report with small surface-level additions rather than a full redesign.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest, Playwright visual tests, existing Chronoscope diagnostic utilities.

---

### Task 1: Add Pure Diagnostic Evidence Contract

**Files:**
- Create: `src/lib/utils/diagnostic-evidence-contract.ts`
- Test: `tests/unit/utils/diagnostic-evidence-contract.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create tests that build small measurement states and assert:

```ts
expect(contract.current.headline).toBe('Current status: healthy');
expect(contract.notableEvent?.roundLabel).toBe('Round #54');
expect(contract.overview.notableLine).toContain('AWS crossed the trigger by 85 ms');
expect(contract.report.headline).toContain('currently healthy');
expect(contract.report.headline).toContain('AWS spiked');
```

Also test timeout/error notable events, drift-only watch events, and no-event fallback.

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/utils/diagnostic-evidence-contract.test.ts
```

Expected: fail because `diagnostic-evidence-contract.ts` does not exist.

- [ ] **Step 3: Implement the utility**

Create:

```ts
export type DiagnosticEventTone = 'info' | 'watch' | 'degraded';
export type DiagnosticEventKind = 'threshold' | 'failure' | 'drift';

export interface DiagnosticNotableEvent {
  readonly kind: DiagnosticEventKind;
  readonly tone: DiagnosticEventTone;
  readonly endpointId: string;
  readonly endpointLabel: string;
  readonly roundNumber: number;
  readonly roundLabel: string;
  readonly latency: number | null;
  readonly thresholdDelta: number | null;
  readonly drift: number | null;
  readonly summary: string;
}

export interface DiagnosticEvidenceContract {
  readonly current: { readonly tone: DiagnosticEventTone; readonly headline: string; readonly detail: string };
  readonly notableEvent: DiagnosticNotableEvent | null;
  readonly overview: { readonly headline: string; readonly notableLine: string; readonly nextLine: string };
  readonly live: { readonly eventLine: string; readonly operationalLine: string };
  readonly investigate: { readonly hypothesis: string; readonly detail: string; readonly evidence: readonly string[] };
  readonly report: { readonly headline: string; readonly lede: string };
}
```

The implementation scans every enabled endpoint sample, scores threshold crossings, failures, and drift, and chooses the strongest event. It treats report `diagnosis.severity === 'healthy'` as current health, but does not hide past degraded events.

- [ ] **Step 4: Verify unit tests pass**

Run:

```bash
npx vitest run tests/unit/utils/diagnostic-evidence-contract.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/diagnostic-evidence-contract.ts tests/unit/utils/diagnostic-evidence-contract.test.ts
git commit -m "feat: derive diagnostic evidence contract"
```

### Task 2: Wire Contract Into Main Surfaces

**Files:**
- Modify: `src/lib/components/OverviewView.svelte`
- Modify: `src/lib/components/LiveView.svelte`
- Modify: `src/lib/components/DiagnoseView.svelte`
- Modify: `src/lib/components/EndpointView.svelte`
- Modify: `src/lib/components/ReportView.svelte`

- [ ] **Step 1: Import and derive the contract per page**

Use `buildDiagnosticEvidenceContract({ report, endpoints: monitored, measurements, thresholdMs: settings.healthThreshold, significantPulse })` where a report already exists. On pages without a report model, build or reuse `buildDiagnosticReport`.

- [ ] **Step 2: Overview copy**

Replace the headline source with `contract.overview.headline`, keep the existing supporting summary, and add a compact current/notable/next strip below the primary paragraph.

- [ ] **Step 3: Live event strip**

Add a small `live-contract-strip` near the bottom operational controls that renders `contract.live.eventLine` and `contract.live.operationalLine`.

- [ ] **Step 4: Investigate hypothesis panel**

Add a compact panel above the comparison chart that renders `contract.investigate.hypothesis`, `contract.investigate.detail`, and its evidence bullets.

- [ ] **Step 5: Endpoint station-specific copy**

On Endpoint, when the notable event belongs to the focused endpoint, render that event summary in the right-side station copy; otherwise keep existing station status copy.

- [ ] **Step 6: Report reconciled headline**

Use `contract.report.headline` for the report H1 and `contract.report.lede` near the primary report copy so the selected significant sample never contradicts the session headline.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/OverviewView.svelte src/lib/components/LiveView.svelte src/lib/components/DiagnoseView.svelte src/lib/components/EndpointView.svelte src/lib/components/ReportView.svelte
git commit -m "feat: differentiate pages with evidence contract"
```

### Task 3: Add Visual Regression Coverage

**Files:**
- Modify: `tests/visual/instrument-shell.spec.ts`

- [ ] **Step 1: Extend seeded incident assertions**

Use the existing `spikeRound` fixture path to assert:

```ts
await expect(page.locator('.report-surface h1')).toContainText('AWS');
await expect(page.locator('.diagnostic-contract-strip')).toContainText('Notable');
await expect(page.locator('.investigate-hypothesis')).toContainText('Working hypothesis');
await expect(page.locator('.live-contract-strip')).toContainText('Notable event');
```

- [ ] **Step 2: Run the targeted visual suite**

Run:

```bash
npx playwright test tests/visual/instrument-shell.spec.ts
```

Expected: 30+ tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/visual/instrument-shell.spec.ts
git commit -m "test: cover diagnostic page contracts"
```

### Task 4: Final Verification

**Files:** no source changes expected.

- [ ] **Step 1: Run static checks**

```bash
npm run typecheck
npm run lint
npm run lint:css
git diff --check
```

- [ ] **Step 2: Run full tests**

```bash
npm run test
npx playwright test tests/visual/instrument-shell.spec.ts
```

- [ ] **Step 3: Browser smoke**

Open `http://127.0.0.1:5173/`, verify Overview, Live, Investigate, Report render with the new contract copy and no framework overlay or console errors.

- [ ] **Step 4: Commit any final fixes**

If final verification requires fixes, commit them with a focused message.

## Self-Review

- Spec coverage: the plan implements the shared contract, wires it into the major pages, and adds unit plus visual coverage.
- Placeholder scan: no placeholder implementation steps remain.
- Type consistency: the plan uses one utility name, `buildDiagnosticEvidenceContract`, and one shared contract interface throughout.
