import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import RunStorylineCard from '../../../src/lib/components/RunStorylineCard.svelte';
import type { RunStoryline } from '../../../src/lib/utils/run-storyline';

const BASE = 1_765_000_000_000;

function storyline(over: Partial<RunStoryline> = {}): RunStoryline {
  return {
    windowStart: BASE,
    windowEnd: BASE + 60_000,
    confidence: 'medium',
    sampleCount: 40,
    readyEndpointCount: 2,
    summary: 'AWS slowed briefly; the other paths stayed clean.',
    phases: [
      { start: BASE, end: BASE + 30_000, label: 'steady', kind: 'steady' },
      { start: BASE + 30_000, end: BASE + 45_000, label: 'AWS slow', kind: 'isolated-slow' },
      { start: BASE + 45_000, end: BASE + 60_000, label: 'recovered', kind: 'recovered' },
    ],
    rows: [
      {
        endpointId: 'google',
        label: 'Google',
        color: '#67e8f9',
        summary: 'Google stayed clean.',
        points: [
          { t: BASE, round: 1, latency: 40, normalizedLatency: 0.2, status: 'ok', threshold: 120, sampleCount: 1 },
          { t: BASE + 30_000, round: 2, latency: 42, normalizedLatency: 0.21, status: 'ok', threshold: 120, sampleCount: 2 },
          { t: BASE + 60_000, round: 3, latency: 41, normalizedLatency: 0.2, status: 'ok', threshold: 120, sampleCount: 3 },
        ],
      },
      {
        endpointId: 'aws',
        label: 'AWS',
        color: '#fbbf24',
        summary: 'AWS crossed the trigger.',
        points: [
          { t: BASE, round: 1, latency: 50, normalizedLatency: 0.2, status: 'ok', threshold: 120, sampleCount: 1 },
          { t: BASE + 30_000, round: 2, latency: 180, normalizedLatency: 0.88, status: 'slow', threshold: 120, sampleCount: 2 },
          { t: BASE + 60_000, round: 3, latency: 55, normalizedLatency: 0.24, status: 'ok', threshold: 120, sampleCount: 3 },
        ],
      },
    ],
    markers: [
      {
        t: BASE + 30_000,
        round: 2,
        endpointId: 'aws',
        kind: 'slowdown',
        label: 'AWS slow',
        evidence: 'AWS had 2 of the last 3 samples above 120 ms.',
      },
    ],
    overflow: null,
    ...over,
  };
}

describe('RunStorylineCard', () => {
  it('renders the native timeline heading and summary', () => {
    const { getByRole, getByText } = render(RunStorylineCard, {
      props: {
        storyline: storyline(),
        onDrill: vi.fn(),
      },
    });

    expect(getByRole('heading', { name: 'What happened' })).toBeTruthy();
    expect(getByText('Recent run timeline')).toBeTruthy();
    expect(getByText('AWS slowed briefly; the other paths stayed clean.')).toBeTruthy();
  });

  it('renders endpoint rows with accessible status labels', () => {
    const { getByRole } = render(RunStorylineCard, {
      props: {
        storyline: storyline(),
        onDrill: vi.fn(),
      },
    });

    expect(getByRole('button', { name: /Google, Google stayed clean/i })).toBeTruthy();
    expect(getByRole('button', { name: /AWS, AWS crossed the trigger/i })).toBeTruthy();
  });

  it('renders overflow text when extra endpoints are hidden', () => {
    const { getByText } = render(RunStorylineCard, {
      props: {
        storyline: storyline({
          overflow: {
            hiddenCount: 2,
            summary: '2 more paths steady.',
          },
        }),
        onDrill: vi.fn(),
      },
    });

    expect(getByText('2 more paths steady.')).toBeTruthy();
  });

  it('drills into the clicked endpoint', async () => {
    const onDrill = vi.fn();
    const { getByRole } = render(RunStorylineCard, {
      props: {
        storyline: storyline(),
        onDrill,
      },
    });

    await fireEvent.click(getByRole('button', { name: /AWS, AWS crossed the trigger/i }));

    expect(onDrill).toHaveBeenCalledWith('aws');
  });

  it('drills into the clicked event marker', async () => {
    const onDrill = vi.fn();
    const { getByRole } = render(RunStorylineCard, {
      props: {
        storyline: storyline(),
        onDrill,
      },
    });

    await fireEvent.click(getByRole('button', { name: /AWS slow, AWS had 2 of the last 3 samples/i }));

    expect(onDrill).toHaveBeenCalledWith('aws');
  });
});
