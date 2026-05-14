# Run Storyline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Status `Recent events` card with a compact, evidence-bound `What happened` run storyline that shows recent changes over time without copying `s80`.

**Architecture:** Add a pure `buildRunStoryline` utility that turns endpoint samples into phases, endpoint micro-traces, markers, confidence, and summary copy. Render that model in a focused Svelte card, then wire it into `OverviewView` while preserving the fixed Status layout and short-height visibility.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library Svelte, Playwright visual tests.

---

### Task 1: Pure Run Storyline Derivation

**Files:**
- Create: `src/lib/utils/run-storyline.ts`
- Create: `tests/unit/utils/run-storyline.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/utils/run-storyline.test.ts` with tests for collecting state, clean state, isolated slowdown, shared slowdown, failure markers, recovery, below-threshold elevated samples, low-confidence copy, and endpoint overflow.

Run: `npx vitest run tests/unit/utils/run-storyline.test.ts`

Expected: FAIL because `src/lib/utils/run-storyline.ts` does not exist.

- [ ] **Step 2: Implement the pure utility**

Create `src/lib/utils/run-storyline.ts` exporting:

```ts
export function buildRunStoryline(input: BuildRunStorylineInput): RunStoryline
```

The utility must:

- Use only the current run window.
- Use the latest five minutes.
- Render at most 120 recent rounds.
- Classify `slow` only when latency exceeds threshold.
- Classify below-threshold `elevated` only after eight previous ok samples and both spike gates:
  - Absolute gate: the sample is at least 75 ms above that endpoint's median over the previous eight ok samples.
  - Relative gate: the sample is at least 1.75x that same median.
- Separate failures from slow samples.
- Require two of the last three slow samples for slowdown markers.
- Require three consecutive ok/elevated samples after a problem for recovery.
- Require a 15-second window for isolated/shared correlation.
- Use confidence to choose assertive vs cautious copy.
- Show at most four endpoint rows and summarize overflow without hiding eventful endpoints.

- [ ] **Step 3: Verify utility tests pass**

Run: `npx vitest run tests/unit/utils/run-storyline.test.ts`

Expected: PASS.

### Task 2: Run Storyline Card Component

**Files:**
- Create: `src/lib/components/RunStorylineCard.svelte`
- Create: `tests/unit/components/RunStorylineCard.test.ts`

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/components/RunStorylineCard.test.ts` that renders a supplied `RunStoryline` model and asserts:

- The card heading is `What happened`.
- The summary line is visible.
- Endpoint rows render with accessible button names.
- Overflow text renders when provided.
- Clicking an endpoint row calls `onDrill(endpointId)`.

Run: `npx vitest run tests/unit/components/RunStorylineCard.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the component**

Create `src/lib/components/RunStorylineCard.svelte` with:

- Current Chronoscope glass-card styling.
- Header `What happened`, subtitle `Recent run timeline`, and hint `Click a moment -> Diagnose`.
- Story rail phase segments.
- Up to four endpoint micro-trace rows with SVG sparklines and failure markers.
- Compact summary and overflow text.
- Accessible labels that do not depend on color alone.

- [ ] **Step 3: Verify component tests pass**

Run: `npx vitest run tests/unit/components/RunStorylineCard.test.ts`

Expected: PASS.

### Task 3: Status Integration And Layout Guardrails

**Files:**
- Modify: `src/lib/components/OverviewView.svelte`
- Modify: `src/lib/components/OverviewSubtabStrip.svelte`
- Modify: `tests/visual/overview-no-scroll.spec.ts`

- [ ] **Step 1: Write failing visual/layout assertions**

Update `tests/visual/overview-no-scroll.spec.ts` with a short desktop assertion that the Status timeline remains reachable at `1366x768` and that `What happened` is visible or available through the visible subtab path.

Run: `npx playwright test tests/visual/overview-no-scroll.spec.ts -g "recent timeline"`

Expected: FAIL before wiring because `What happened` is absent.

- [ ] **Step 2: Wire the new card**

Modify `OverviewView.svelte` to:

- Import `RunStorylineCard` and `buildRunStoryline`.
- Build a full sample map for storyline derivation without changing the existing RacingStrip tail behavior.
- Replace `EventFeed` with `RunStorylineCard`.
- Route row/marker clicks to Diagnose.
- Stop hiding the timeline card on short desktop heights; keep compact layout instead.

Modify `OverviewSubtabStrip.svelte` to label the second subtab `Timeline` while preserving the internal `events` id for compatibility.

- [ ] **Step 3: Verify integration**

Run:

```bash
npx vitest run tests/unit/utils/run-storyline.test.ts tests/unit/components/RunStorylineCard.test.ts
npm run typecheck
npm run lint
npx playwright test tests/visual/overview-no-scroll.spec.ts
```

Expected: all pass.

### Task 4: Final Verification

**Files:**
- All changed implementation and test files.

- [ ] **Step 1: Run focused and broad verification**

Run:

```bash
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 2: Review final diff**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no whitespace errors; diff only touches storyline, Status integration, tests, and plan/spec docs.

- [ ] **Step 3: Commit implementation**

Commit the implementation with a clear message after verification passes.
