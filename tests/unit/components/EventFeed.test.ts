import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import EventFeed, { type FeedEvent } from '../../../src/lib/components/EventFeed.svelte';
import type { Endpoint } from '../../../src/lib/types';

const NOW = 1_765_000_060_000;

const endpoints: Endpoint[] = [
  {
    id: 'edge',
    url: 'https://chronoscope.dev/probe',
    label: 'Edge',
    enabled: true,
    color: '#f9a8d4',
  },
];

function renderFeed(events: readonly FeedEvent[]) {
  return render(EventFeed, {
    props: {
      events,
      endpoints,
      now: NOW,
      onDrill: vi.fn(),
    },
  });
}

describe('EventFeed', () => {
  it('uses run-relative time labels and plain threshold language', async () => {
    const onDrill = vi.fn();
    const event: FeedEvent = {
      t: NOW - 30_000,
      epId: 'edge',
      kind: 'cross-up',
      value: 181,
      threshold: 120,
    };
    const { getByRole, getByText, queryByText } = render(EventFeed, {
      props: {
        events: [event],
        endpoints,
        now: NOW,
        onDrill,
      },
    });

    expect(getByText('-30s')).toBeTruthy();
    expect(queryByText('30s ago')).toBeNull();
    expect(getByText(/crossed trigger/i)).toBeTruthy();

    await fireEvent.click(getByRole('button', { name: /-30s Edge crossed trigger 181ms/i }));

    expect(onDrill).toHaveBeenCalledWith('edge');
  });

  it('keeps the empty state compact and time-neutral', () => {
    const { getByText } = renderFeed([]);

    expect(getByText('No threshold events in this window.')).toBeTruthy();
  });
});
