/* Shared primitives used across all directions.
   Keeps per-direction files focused on their own visuals. */

const cls = (...xs) => xs.filter(Boolean).join(' ');

/* === Number formatting — canonical helpers ===
   Rules:
   - Latency < 1000ms: integer ms ("142ms"). ≥ 1000ms: "1.24s" (2 decimals).
   - Percentages: 0 → "0%"; <0.1 → "<0.1%"; otherwise 1 decimal ("2.3%").
   - Counts: thousands separator ("1,284").
   - All numeric UI should use font-variant-numeric: tabular-nums.
*/
function fmt(ms, { decimals = 0, unit = true } = {}) {
  if (ms === null || ms === undefined || isNaN(ms)) return '—';
  if (ms >= 1000) {
    const s = (ms / 1000).toFixed(2);
    return unit ? `${s}s` : s;
  }
  const n = decimals === 0 ? Math.round(ms) : ms.toFixed(decimals);
  return unit ? `${n}ms` : String(n);
}

function fmtPct(p, decimals = 1) {
  if (p === null || p === undefined || isNaN(p)) return '—';
  if (p === 0) return '0%';
  if (p > 0 && p < 0.1) return '<0.1%';
  return `${p.toFixed(decimals)}%`;
}

function fmtCount(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/* Split a latency value into {num, unit} for UI that styles the unit separately. */
function fmtParts(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return { num: '—', unit: '' };
  if (ms >= 1000) return { num: (ms / 1000).toFixed(2), unit: 's' };
  return { num: String(Math.round(ms)), unit: 'ms' };
}

// Health classification — used as a common grammar across all directions
function classify(stats) {
  if (!stats) return 'idle';
  const { p50, lossPercent, stddev } = stats;
  if (lossPercent > 2 || p50 > 200) return 'bad';
  if (lossPercent > 0.5 || p50 > 120 || stddev > 40) return 'warn';
  if (p50 > 60 || stddev > 15) return 'ok';
  return 'good';
}

const HEALTH_STYLE = {
  good: { label: 'Healthy',   color: '#86efac' },
  ok:   { label: 'Nominal',   color: '#67e8f9' },
  warn: { label: 'Degraded',  color: '#fbbf24' },
  bad:  { label: 'Critical',  color: '#f9a8d4' },
  idle: { label: 'Idle',      color: '#6b7280' },
};

// Composite network quality 0–100 — per the vision doc.
function networkQuality(statsList) {
  const xs = statsList.filter(Boolean);
  if (!xs.length) return null;
  let score = 100;
  const avgP50   = xs.reduce((a, s) => a + s.p50, 0)     / xs.length;
  const avgJit   = xs.reduce((a, s) => a + s.stddev, 0)  / xs.length;
  const avgLoss  = xs.reduce((a, s) => a + s.lossPercent, 0) / xs.length;

  score -= Math.min(30, avgP50 / 4);     // latency cost
  score -= Math.min(25, avgJit * 0.8);   // jitter cost
  score -= Math.min(35, avgLoss * 12);   // loss cost

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Tiny inline sparkline — SVG path from samples.
function Sparkline({ samples, color = '#67e8f9', width = 120, height = 24, maxPoints = 60, showArea = true, lineWidth = 1 }) {
  const slice = React.useMemo(() => samples.slice(-maxPoints), [samples, maxPoints]);
  if (!slice.length) return <svg width={width} height={height} />;
  const vals = slice.map(s => s.latency).filter(v => v !== null);
  if (!vals.length) return <svg width={width} height={height} />;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1, max - min);
  const stepX = width / Math.max(1, slice.length - 1);
  const pts = slice.map((s, i) => {
    const x = i * stepX;
    const y = s.latency === null ? height : height - ((s.latency - min) / range) * (height - 2) - 1;
    return [x, y, s.latency === null];
  });
  const d = pts.map(([x, y, lost], i) => (i === 0 ? 'M' : (lost ? 'M' : 'L')) + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  const dArea = d + ` L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {showArea && <path d={dArea} fill={color} opacity={0.12} />}
      <path d={d} fill="none" stroke={color} strokeWidth={lineWidth} />
    </svg>
  );
}

// Little tier2 waterfall bar
function Tier2Bar({ tier2, height = 6, showLabels = false }) {
  if (!tier2) return null;
  const total = tier2.dns + tier2.tcp + tier2.tls + tier2.ttfb + tier2.transfer;
  if (total <= 0) return null;
  const parts = [
    { label: 'DNS',  val: tier2.dns,      color: 'rgba(134,239,172,.75)' },
    { label: 'TCP',  val: tier2.tcp,      color: 'rgba(103,232,249,.75)' },
    { label: 'TLS',  val: tier2.tls,      color: 'rgba(196,181,253,.75)' },
    { label: 'TTFB', val: tier2.ttfb,     color: 'rgba(251,191,36,.75)'  },
    { label: 'XFER', val: tier2.transfer, color: 'rgba(249,168,212,.75)' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', height, borderRadius: 2, overflow: 'hidden', gap: 1 }}>
        {parts.map(p => (
          <div key={p.label} title={`${p.label}: ${Math.round(p.val)}ms`}
               style={{ width: `${(p.val / total) * 100}%`, background: p.color, minWidth: 1 }} />
        ))}
      </div>
      {showLabels && (
        <div style={{ display: 'flex', gap: 10, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.14em',
                      color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', fontVariantNumeric: 'tabular-nums' }}>
          {parts.map(p => (
            <span key={p.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 5, height: 5, background: p.color, borderRadius: 1 }} />
              {p.label} {Math.round(p.val)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// A monospace ticker that doesn't cause layout jitter: tabular-nums
const tabularMono = {
  fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  fontVariantNumeric: 'tabular-nums',
};

Object.assign(window, { cls, fmt, fmtPct, fmtCount, fmtParts, classify, HEALTH_STYLE, networkQuality, Sparkline, Tier2Bar, tabularMono });
