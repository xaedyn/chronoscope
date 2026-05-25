import { describe, expect, it } from 'vitest';
import {
  collectingLabel,
  evidenceMetricLabel,
  percentileMaturityHint,
} from '../../../src/lib/utils/data-maturity';

describe('data maturity labels', () => {
  it('labels empty and partial metric windows without placeholder dashes', () => {
    expect(evidenceMetricLabel(null, 0)).toBe('No samples');
    expect(evidenceMetricLabel(null, 14)).toBe('Collecting');
    expect(evidenceMetricLabel(42, 14)).toBe('42 ms');
    expect(evidenceMetricLabel(3, 60, '')).toBe('3');
  });

  it('explains how many samples are needed before percentile readouts mature', () => {
    expect(percentileMaturityHint(0)).toBe('Waiting for first pulse');
    expect(percentileMaturityHint(14)).toBe('Needs 16 more samples');
    expect(percentileMaturityHint(30)).toBe('Ready');
  });

  it('supports compact collecting copy for dense tables', () => {
    expect(collectingLabel(0)).toBe('No samples');
    expect(collectingLabel(1)).toBe('Collecting');
  });
});
