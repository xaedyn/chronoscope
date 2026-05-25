const MIN_LATENCY_OFFSET = -0.4;
const MAX_LATENCY_OFFSET = 0.8;
const LATENCY_OFFSET_SCALE = 0.5;

export function latencyOffsetFor(latencyMs: number, baselineMs: number): number {
  const safeBaseline = Math.max(baselineMs, 10);
  const ratio = (latencyMs - baselineMs) / safeBaseline;
  return clamp(ratio * LATENCY_OFFSET_SCALE, MIN_LATENCY_OFFSET, MAX_LATENCY_OFFSET);
}

export function orbitalRadiusForLatency(orbitRadius: number, latencyMs: number, baselineMs: number): number {
  return roundRadius(orbitRadius + latencyOffsetFor(latencyMs, baselineMs));
}

export function triggerRadiusFor(orbitRadius: number, baselineMs: number, thresholdMs: number): number {
  return orbitalRadiusForLatency(orbitRadius, thresholdMs, baselineMs);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundRadius(value: number): number {
  return Math.round(value * 1000) / 1000;
}
