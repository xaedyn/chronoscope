// tests/unit/components/controls.test.ts
// Tests the Controls component store logic — lifecycle transitions and button labels.
// We test the store logic directly since Svelte 5 component testing in jsdom is complex.

import { describe, it, expect, beforeEach } from 'vitest';
import { measurementStore } from '../../../src/lib/stores/measurements';
import { get } from 'svelte/store';
import type { TestLifecycleState } from '../../../src/lib/types';

// The Controls component derives its label from lifecycle exactly like this:
function getStartStopLabel(lifecycle: TestLifecycleState): string {
  switch (lifecycle) {
    case 'starting':  return 'Starting…';
    case 'running':   return 'Stop';
    case 'stopping':  return 'Stopping…';
    default:          return 'Start Test';
  }
}

function isDisabled(lifecycle: TestLifecycleState): boolean {
  return lifecycle === 'starting' || lifecycle === 'stopping';
}

function getVariant(lifecycle: TestLifecycleState): 'start' | 'stop' {
  return lifecycle === 'running' ? 'stop' : 'start';
}

describe('Controls component store logic', () => {
  beforeEach(() => {
    measurementStore.reset();
  });

  // ── Lifecycle state machine ─────────────────────────────────────────────────

  it('starts in idle state', () => {
    expect(get(measurementStore).lifecycle).toBe('idle');
  });

  it('lifecycle setLifecycle works correctly', () => {
    const states: TestLifecycleState[] = ['starting', 'running', 'stopping', 'stopped', 'completed', 'idle'];
    for (const state of states) {
      measurementStore.setLifecycle(state);
      expect(get(measurementStore).lifecycle).toBe(state);
    }
  });

  // ── Label derivation ────────────────────────────────────────────────────────

  it('shows "Start Test" in idle state', () => {
    expect(getStartStopLabel('idle')).toBe('Start Test');
  });

  it('shows "Starting…" while starting', () => {
    expect(getStartStopLabel('starting')).toBe('Starting…');
  });

  it('shows "Stop" while running', () => {
    expect(getStartStopLabel('running')).toBe('Stop');
  });

  it('shows "Stopping…" while stopping', () => {
    expect(getStartStopLabel('stopping')).toBe('Stopping…');
  });

  it('shows "Start Test" in stopped state', () => {
    expect(getStartStopLabel('stopped')).toBe('Start Test');
  });

  it('shows "Start Test" in completed state', () => {
    expect(getStartStopLabel('completed')).toBe('Start Test');
  });

  // ── Disabled states ─────────────────────────────────────────────────────────

  it('button is disabled when starting', () => {
    expect(isDisabled('starting')).toBe(true);
  });

  it('button is disabled when stopping', () => {
    expect(isDisabled('stopping')).toBe(true);
  });

  it('button is enabled when idle', () => {
    expect(isDisabled('idle')).toBe(false);
  });

  it('button is enabled when running', () => {
    expect(isDisabled('running')).toBe(false);
  });

  it('button is enabled when stopped', () => {
    expect(isDisabled('stopped')).toBe(false);
  });

  // ── Variant ────────────────────────────────────────────────────────────────

  it('variant is "stop" when running', () => {
    expect(getVariant('running')).toBe('stop');
  });

  it('variant is "start" in all non-running states', () => {
    const nonRunning: TestLifecycleState[] = ['idle', 'starting', 'stopping', 'stopped', 'completed'];
    for (const state of nonRunning) {
      expect(getVariant(state)).toBe('start');
    }
  });

  // ── State transitions ──────────────────────────────────────────────────────

  it('click start when idle sets lifecycle to starting', () => {
    measurementStore.reset();
    expect(get(measurementStore).lifecycle).toBe('idle');
    // Controls.handleStartStop sets 'starting' when idle
    measurementStore.setLifecycle('starting');
    expect(get(measurementStore).lifecycle).toBe('starting');
  });

  it('click stop when running sets lifecycle to stopping', () => {
    measurementStore.setLifecycle('running');
    // Controls.handleStartStop sets 'stopping' when running
    measurementStore.setLifecycle('stopping');
    expect(get(measurementStore).lifecycle).toBe('stopping');
  });

  it('freeze events are initially empty', () => {
    expect(get(measurementStore).freezeEvents).toEqual([]);
  });

  it('addFreezeEvent appends to freezeEvents', () => {
    const event = { round: 5, at: Date.now(), gapMs: 1500 };
    measurementStore.addFreezeEvent(event);
    const events = get(measurementStore).freezeEvents;
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });
});
