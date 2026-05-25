const DEFAULT_READY_SAMPLE_COUNT = 30;

export function collectingLabel(sampleCount: number): string {
  return sampleCount > 0 ? 'Collecting' : 'No samples';
}

export function evidenceMetricLabel(
  value: number | null,
  sampleCount: number,
  unit = 'ms',
): string {
  if (value === null) return collectingLabel(sampleCount);
  return unit ? `${value} ${unit}` : String(value);
}

export function percentileMaturityHint(
  sampleCount: number,
  readySampleCount = DEFAULT_READY_SAMPLE_COUNT,
): string {
  const count = Math.max(0, Math.round(sampleCount));
  const readyAt = Math.max(1, Math.round(readySampleCount));
  if (count <= 0) return 'Waiting for first pulse';
  if (count < readyAt) return `Needs ${readyAt - count} more samples`;
  return 'Ready';
}
