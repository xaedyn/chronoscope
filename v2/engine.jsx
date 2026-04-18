/* Simulated measurement engine — produces realistic HTTP latency samples per endpoint.
   Shared by all directions. Uses requestAnimationFrame-throttled ticks at ~1/sec. */

const DEFAULT_ENDPOINTS = [
  { id: 'ep-cloudflare',  url: '1.1.1.1',                label: 'cloudflare-dns', role: 'DNS',   color: '#67e8f9', base: 12,  jitter: 3,  lossRate: 0.000, tier: 2 },
  { id: 'ep-google',      url: '8.8.8.8',                label: 'google-dns',     role: 'DNS',   color: '#f9a8d4', base: 18,  jitter: 4,  lossRate: 0.001, tier: 2 },
  { id: 'ep-github',      url: 'api.github.com',         label: 'github-api',     role: 'API',   color: '#86efac', base: 42,  jitter: 6,  lossRate: 0.002, tier: 2 },
  { id: 'ep-npm',         url: 'registry.npmjs.org',     label: 'npm-registry',   role: 'CDN',   color: '#fcd34d', base: 58,  jitter: 9,  lossRate: 0.005, tier: 2 },
  { id: 'ep-upstream',    url: 'upstream.internal',      label: 'upstream-api',   role: 'EDGE',  color: '#c4b5fd', base: 94,  jitter: 22, lossRate: 0.015, tier: 2 },
  { id: 'ep-legacy',      url: 'legacy.ops.internal',    label: 'legacy-ops',     role: 'CORE',  color: '#7dd3fc', base: 145, jitter: 48, lossRate: 0.04,  tier: 1 },
];

const DATA_PRESETS = {
  healthy:   { bumpBase: 1.00, bumpJitter: 1.00, lossMul: 0.4 },
  mixed:     { bumpBase: 1.15, bumpJitter: 1.8,  lossMul: 2.0 },
  degraded:  { bumpBase: 1.8,  bumpJitter: 3.2,  lossMul: 8.0 },
};

function gaussian() {
  // Box–Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleLatency(ep, preset, tick) {
  const base = ep.base * preset.bumpBase;
  const jitter = ep.jitter * preset.bumpJitter;

  // Slow oscillation to simulate diurnal / route shifts
  const drift = Math.sin(tick / 40 + ep.base) * jitter * 0.3;

  // Occasional spikes on degraded links
  const spike = Math.random() < (preset.lossMul * 0.01) ? jitter * 6 * Math.random() : 0;
  const n = gaussian() * jitter * 0.6;

  const val = Math.max(1, base + drift + n + spike);

  const lost = Math.random() < ep.lossRate * preset.lossMul;
  if (lost) return { latency: null, lost: true, tier2: null };

  // Tier2 waterfall breakdown — only for tier2 endpoints
  let tier2 = null;
  if (ep.tier === 2) {
    const dns =      Math.max(0.5, val * 0.04 + gaussian() * 1.2);
    const tcp =      Math.max(1,   val * 0.18 + gaussian() * 2);
    const tls =      Math.max(1,   val * 0.22 + gaussian() * 2.5);
    const ttfb =     Math.max(2,   val * 0.42 + gaussian() * 4);
    const transfer = Math.max(val - dns - tcp - tls - ttfb, 1);
    tier2 = { dns, tcp, tls, ttfb, transfer };
  }

  return { latency: val, lost: false, tier2 };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeStats(samples) {
  const lat = samples.filter(s => s.latency !== null).map(s => s.latency);
  const sorted = [...lat].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  const mean = lat.reduce((a, b) => a + b, 0) / n;
  const variance = lat.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  return {
    n,
    totalSamples: samples.length,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.50),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.90),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    stddev,
    lossPercent: (samples.length - n) / samples.length * 100,
    ci95Margin: 1.96 * stddev / Math.sqrt(n),
  };
}

function avgTier2(samples) {
  const ok = samples.filter(s => s.tier2);
  if (!ok.length) return null;
  const init = { dns: 0, tcp: 0, tls: 0, ttfb: 0, transfer: 0 };
  const sum = ok.reduce((acc, s) => ({
    dns: acc.dns + s.tier2.dns,
    tcp: acc.tcp + s.tier2.tcp,
    tls: acc.tls + s.tier2.tls,
    ttfb: acc.ttfb + s.tier2.ttfb,
    transfer: acc.transfer + s.tier2.transfer,
  }), init);
  return {
    dns: sum.dns / ok.length,
    tcp: sum.tcp / ok.length,
    tls: sum.tls / ok.length,
    ttfb: sum.ttfb / ok.length,
    transfer: sum.transfer / ok.length,
  };
}

function useEngine({ dataState = 'mixed', running = true, sampleIntervalMs = 900, maxSamples = 180, seed = 0 } = {}) {
  const [endpoints] = React.useState(() => DEFAULT_ENDPOINTS.map(e => ({ ...e })));
  const [tick, setTick] = React.useState(0);
  const [samplesMap, setSamplesMap] = React.useState(() =>
    Object.fromEntries(endpoints.map(e => [e.id, []]))
  );

  const runningRef = React.useRef(running);
  runningRef.current = running;
  const presetRef = React.useRef(DATA_PRESETS[dataState] || DATA_PRESETS.mixed);
  presetRef.current = DATA_PRESETS[dataState] || DATA_PRESETS.mixed;

  // Seed with a realistic history so charts are non-empty at mount
  React.useEffect(() => {
    const initial = {};
    for (const ep of endpoints) {
      const arr = [];
      for (let i = 0; i < 60; i++) {
        arr.push({ ...sampleLatency(ep, presetRef.current, i), t: Date.now() - (60 - i) * sampleIntervalMs, round: i });
      }
      initial[ep.id] = arr;
    }
    setSamplesMap(initial);
    setTick(60);
  }, [seed]);

  React.useEffect(() => {
    if (!running) return;
    let cancel = false;
    let timer = null;
    const loop = () => {
      if (cancel || !runningRef.current) return;
      setTick(t => {
        const next = t + 1;
        setSamplesMap(prev => {
          const out = {};
          for (const ep of endpoints) {
            const existing = prev[ep.id] || [];
            const s = { ...sampleLatency(ep, presetRef.current, next), t: Date.now(), round: next };
            const nextArr = [...existing, s];
            if (nextArr.length > maxSamples) nextArr.shift();
            out[ep.id] = nextArr;
          }
          return out;
        });
        return next;
      });
      timer = setTimeout(loop, sampleIntervalMs);
    };
    timer = setTimeout(loop, sampleIntervalMs);
    return () => { cancel = true; if (timer) clearTimeout(timer); };
  }, [running, sampleIntervalMs, maxSamples]);

  const statsMap = React.useMemo(() => {
    const out = {};
    for (const ep of endpoints) {
      const s = samplesMap[ep.id] || [];
      out[ep.id] = {
        stats: computeStats(s),
        tier2: avgTier2(s),
        samples: s,
        last: s[s.length - 1] || null,
      };
    }
    return out;
  }, [samplesMap, endpoints]);

  return { endpoints, tick, statsMap, running };
}

window.useEngine = useEngine;
window.DEFAULT_ENDPOINTS = DEFAULT_ENDPOINTS;
window.DATA_PRESETS = DATA_PRESETS;
