// src/lib/utils/incremental-loss-counter.ts
// Lifetime O(1) loss counters per endpoint.
// Counts are never decremented — they accumulate monotonically.

import type { SampleStatus, MeasurementSample } from '../types';

export interface LossCounts {
  readonly totalSamples: number;
  readonly errorCount: number;
  readonly timeoutCount: number;
  readonly lossPercent: number;
}

interface MutableCounts {
  totalSamples: number;
  errorCount: number;
  timeoutCount: number;
}

const ZERO_COUNTS: LossCounts = {
  totalSamples: 0,
  errorCount: 0,
  timeoutCount: 0,
  lossPercent: 0,
};

export class IncrementalLossCounter {
  private readonly _counts: Map<string, MutableCounts> = new Map();

  /**
   * Increment counters for each sample entry. O(k) where k = entries.length.
   */
  addSamples(entries: ReadonlyArray<{ endpointId: string; status: SampleStatus }>): void {
    for (const { endpointId, status } of entries) {
      let bucket = this._counts.get(endpointId);
      if (!bucket) {
        bucket = { totalSamples: 0, errorCount: 0, timeoutCount: 0 };
        this._counts.set(endpointId, bucket);
      }
      bucket.totalSamples++;
      if (status === 'error') bucket.errorCount++;
      else if (status === 'timeout') bucket.timeoutCount++;
    }
  }

  /**
   * O(1) lookup. Returns zero counts for unknown endpoints.
   */
  getCounts(endpointId: string): LossCounts {
    const bucket = this._counts.get(endpointId);
    if (!bucket) return ZERO_COUNTS;

    const { totalSamples, errorCount, timeoutCount } = bucket;
    const lossPercent =
      totalSamples === 0
        ? 0
        : ((errorCount + timeoutCount) / totalSamples) * 100;

    return { totalSamples, errorCount, timeoutCount, lossPercent };
  }

  /** Remove a single endpoint's counters. */
  removeEndpoint(id: string): void {
    this._counts.delete(id);
  }

  /** Clear all counters. */
  reset(): void {
    this._counts.clear();
  }

  /**
   * Clear and repopulate from a full endpoint state snapshot.
   * Iterates all samples to rebuild counters from scratch.
   */
  loadFrom(endpoints: Record<string, { samples: MeasurementSample[] }>): void {
    this._counts.clear();
    for (const [endpointId, state] of Object.entries(endpoints)) {
      const bucket: MutableCounts = { totalSamples: 0, errorCount: 0, timeoutCount: 0 };
      for (const sample of state.samples) {
        bucket.totalSamples++;
        if (sample.status === 'error') bucket.errorCount++;
        else if (sample.status === 'timeout') bucket.timeoutCount++;
      }
      this._counts.set(endpointId, bucket);
    }
  }
}
