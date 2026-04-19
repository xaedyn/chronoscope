/* Overview — Signature variants.
   Three directions:
     - instrument: scientific instrument (Braun / Rams / calm authority)
     - tool:       expressive tool (Arc / Linear / personality)
     - product:    premium product (Stripe / Apple / shareable minimalism)

   Shared: simulated data, endpoint math, "breathing" response to quality.
   Per-variant: typography, chrome, background atmosphere, signature detail.
*/

function OverviewSignature({ state, dispatch, variant = 'instrument' }) {
  const { endpoints, statsMap, tick, running, threshold } = state;
  const statsList = endpoints.map(e => statsMap[e.id]?.stats).filter(Boolean);
  const score = window.networkQuality(statsList);
  const liveVals = endpoints.map(e => statsMap[e.id]?.last?.latency).filter(v => v != null);
  const liveMedian = liveVals.length ? liveVals.reduce((a, b) => a + b, 0) / liveVals.length : 0;

  // Quality history
  const history = React.useRef([]);
  const lastTickRef = React.useRef(-1);
  if (tick !== lastTickRef.current && score != null) {
    history.current = [...history.current, { tick, score }].slice(-60);
    lastTickRef.current = tick;
  }

  // Causal verdict (one sentence)
  const verdict = React.useMemo(() => oneSentenceVerdict(endpoints, statsMap, threshold), [endpoints, statsMap, threshold, tick]);

  // Ephemeral event ticker — appears for 8s when something crosses, fades out
  const [event, setEvent] = React.useState(null);
  const prevOverRef = React.useRef({});
  React.useEffect(() => {
    const prev = prevOverRef.current;
    const next = {};
    let newEvent = null;
    for (const ep of endpoints) {
      const lat = statsMap[ep.id]?.last?.latency;
      if (lat == null) { next[ep.id] = prev[ep.id] || false; continue; }
      const overNow = lat > threshold;
      next[ep.id] = overNow;
      if (overNow && !prev[ep.id]) newEvent = { ep, kind: 'up', lat, t: Date.now() };
      else if (!overNow && prev[ep.id]) newEvent = { ep, kind: 'down', lat, t: Date.now() };
    }
    prevOverRef.current = next;
    if (newEvent) setEvent(newEvent);
  }, [tick, endpoints, statsMap, threshold]);

  React.useEffect(() => {
    if (!event) return;
    const t = setTimeout(() => setEvent(null), 8000);
    return () => clearTimeout(t);
  }, [event]);

  // Worst endpoint (for hover-to-reveal diagnose)
  const worstEp = React.useMemo(() => {
    return endpoints.reduce((w, e) => {
      const s = statsMap[e.id]?.stats; if (!s) return w;
      if (!w) return { ep: e, stats: s };
      return s.p95 > w.stats.p95 ? { ep: e, stats: s } : w;
    }, null);
  }, [endpoints, statsMap]);

  return (
    <div className={`sig sig-${variant}`}>
      <div className="sig-atmosphere" />
      <div className="sig-stage">
        <SignatureDial
          variant={variant}
          score={score}
          scoreHistory={history.current}
          liveMedian={liveMedian}
          threshold={threshold}
          endpoints={endpoints}
          statsMap={statsMap}
        />
        <div className="sig-below">
          <div className={`sig-verdict sig-verdict-${verdict.tone}`}>
            {verdict.text}
          </div>
          <div className={`sig-event ${event ? 'on' : ''}`}>
            {event && (
              <>
                <span className="sig-event-time">just now</span>
                <span className="sig-event-dot" style={{ background: event.ep.color }} />
                <span className="sig-event-name">{event.ep.label}</span>
                <span className="sig-event-action">
                  {event.kind === 'up' ? <>crossed up · <em>{Math.round(event.lat)}ms</em></>
                                       : <>recovered · <em>{Math.round(event.lat)}ms</em></>}
                </span>
              </>
            )}
          </div>
          {worstEp && verdict.tone !== 'good' && (
            <button className="sig-drill" onClick={() => dispatch({ type: 'drillToDiagnose', value: worstEp.ep.id })}>
              <span className="sig-drill-label">Diagnose</span>
              <span className="sig-drill-ep" style={{ color: worstEp.ep.color }}>{worstEp.ep.label}</span>
              <span className="sig-drill-arrow">→</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SIGNATURE DIAL — responds to quality with visual weight shift
   ============================================================ */
function SignatureDial({ variant, score, scoreHistory, liveMedian, threshold, endpoints, statsMap }) {
  const size = 640;
  const cx = size / 2, cy = size / 2;
  const outerR = 290;
  const startAng = -135, endAng = 135;
  const latToAng = (ms) => startAng + Math.min(1, Math.max(0, ms / 300)) * (endAng - startAng);

  // "Breathing" — visual weight responds to score (low score = heavier chrome)
  const heaviness = score == null ? 0.3 : (1 - Math.min(100, score) / 100); // 0..1
  const dialStroke = 1 + heaviness * 2.5;           // 1..3.5
  const tickOpacity = 0.2 + heaviness * 0.5;        // 0.2..0.7
  const scoreWeight = variant === 'tool' ? 300 + heaviness * 100 : 200 + heaviness * 200;

  // Smooth live hand
  const [handAng, setHandAng] = React.useState(latToAng(liveMedian));
  React.useEffect(() => {
    let raf; const target = latToAng(liveMedian);
    const step = () => {
      setHandAng(prev => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.08) return target;
        return prev + diff * 0.16;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [liveMedian]);

  // Baseline band
  const agg = React.useMemo(() => {
    const xs = endpoints.map(e => statsMap[e.id]?.stats).filter(Boolean);
    if (!xs.length) return null;
    const meanP50 = xs.reduce((a, s) => a + s.p50, 0) / xs.length;
    const meanSigma = xs.reduce((a, s) => a + s.stddev, 0) / xs.length;
    return { mean: meanP50, sigma: meanSigma };
  }, [endpoints, statsMap]);

  const ticks = [];
  for (let ms = 0; ms <= 300; ms += 15) {
    const major = ms % 60 === 0;
    const ang = latToAng(ms);
    const a = ang * Math.PI / 180;
    ticks.push({ ms, major, a });
  }
  const labels = variant === 'product' ? [0, 150, 300] : [0, 60, 120, 180, 240, 300];

  const threshAng = latToAng(threshold);
  const threshPath = arcPath(cx, cy, outerR - 4, threshAng, endAng);
  const baselinePath = agg
    ? arcPath(cx, cy, outerR - 22,
              latToAng(Math.max(0, agg.mean - agg.sigma)),
              latToAng(Math.min(300, agg.mean + agg.sigma)))
    : null;

  // Tone by variant
  const scoreTone = variant === 'tool'
    ? (score == null ? '#6b7280' : score >= 85 ? '#86efac' : score >= 65 ? '#c4b5fd' : score >= 40 ? '#fbbf24' : '#f9a8d4')
    : '#ffffff';

  const statusLabel = score == null ? '' : score >= 85 ? 'NOMINAL' : score >= 65 ? 'STEADY' : score >= 40 ? 'DEGRADED' : 'CRITICAL';

  return (
    <div className="sig-dial-wrap" style={{ filter: score != null && score < 40 ? 'drop-shadow(0 0 40px rgba(249,168,212,.08))' : 'none' }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="sig-dial-svg">
        <defs>
          <filter id="sig-glow"><feGaussianBlur stdDeviation="1.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id="sig-core" cx="50%" cy="45%">
            <stop offset="0%" stopColor={variant === 'tool' ? '#1a1228' : '#0b0b12'} />
            <stop offset="70%" stopColor="#05050a" />
            <stop offset="100%" stopColor="#020206" />
          </radialGradient>
          {variant === 'product' && (
            <radialGradient id="sig-halo" cx="50%" cy="50%">
              <stop offset="0%" stopColor="rgba(255,255,255,.035)" />
              <stop offset="60%" stopColor="rgba(255,255,255,.01)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          )}
        </defs>

        {/* product: soft halo behind the dial */}
        {variant === 'product' && <circle cx={cx} cy={cy} r={outerR + 80} fill="url(#sig-halo)" />}

        {/* Outer face */}
        <circle cx={cx} cy={cy} r={outerR} fill="url(#sig-core)"
                stroke={variant === 'instrument' ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.08)'}
                strokeWidth={dialStroke}
                style={{ transition: 'stroke-width 900ms cubic-bezier(.4,0,.2,1)' }} />

        {/* instrument: a precise inner hairline ring */}
        {variant === 'instrument' && (
          <circle cx={cx} cy={cy} r={outerR - 6} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="0.5" />
        )}

        {/* Baseline band (subtle) */}
        {baselinePath && (
          <g opacity={variant === 'product' ? 0.4 : 0.65}>
            <path d={baselinePath} fill="none" stroke="rgba(103,232,249,.35)" strokeWidth="14" strokeLinecap="round" />
            <path d={baselinePath} fill="none" stroke="#67e8f9" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
          </g>
        )}

        {/* Threshold arc — only shown when hand is near/over it, or always in instrument mode */}
        {(variant === 'instrument' || liveMedian > threshold * 0.7) && (
          <path d={threshPath} fill="none" stroke="rgba(249,168,212,.3)" strokeWidth="1.5" strokeLinecap="round" />
        )}

        {/* Tick marks */}
        {ticks.map(t => {
          const r1 = outerR - (t.major ? 14 : 7);
          const r2 = outerR - 2;
          return (
            <line key={t.ms}
                  x1={cx + Math.cos(t.a) * r1} y1={cy + Math.sin(t.a) * r1}
                  x2={cx + Math.cos(t.a) * r2} y2={cy + Math.sin(t.a) * r2}
                  stroke={t.major ? `rgba(255,255,255,${tickOpacity})` : `rgba(255,255,255,${tickOpacity * 0.4})`}
                  strokeWidth={t.major ? 1.2 : 0.7}
                  style={{ transition: 'stroke 900ms' }} />
          );
        })}

        {/* Labels */}
        {labels.map(ms => {
          const ang = latToAng(ms) * Math.PI / 180;
          const r = outerR - 30;
          return (
            <text key={ms} x={cx + Math.cos(ang) * r} y={cy + Math.sin(ang) * r + 3}
                  textAnchor="middle"
                  fontSize={variant === 'product' ? 9 : 10}
                  fontFamily="var(--mono)"
                  fill={`rgba(255,255,255,${0.3 + heaviness * 0.3})`}
                  letterSpacing=".12em">{ms}</text>
          );
        })}

        {/* Endpoint orbit — points of light */}
        <EndpointOrbit variant={variant} cx={cx} cy={cy} outerR={outerR}
                       latToAng={latToAng} endpoints={endpoints} statsMap={statsMap} threshold={threshold} />

        {/* Quality trace — variant-specific placement */}
        {variant === 'tool' && scoreHistory.length > 1 && (
          <QualityTraceUnder cx={cx} cy={cy + 86} width={190} height={26}
                             history={scoreHistory} tone={scoreTone} />
        )}
        {variant === 'product' && scoreHistory.length > 1 && (
          <QualityTraceUnder cx={cx} cy={cy + 88} width={150} height={16}
                             history={scoreHistory} tone="rgba(255,255,255,.5)" />
        )}
        {variant === 'instrument' && scoreHistory.length > 1 && (
          <QualityTraceUnder cx={cx} cy={cy + 90} width={170} height={12}
                             history={scoreHistory} tone="rgba(103,232,249,.65)" asTicks />
        )}

        {/* Score — variant-specific type treatment */}
        {variant === 'instrument' && (
          <>
            <text x={cx} y={cy - 80} textAnchor="middle" fontSize="9"
                  fontFamily="var(--mono)" fill="rgba(255,255,255,.35)" letterSpacing=".36em">QUALITY INDEX</text>
            <text x={cx} y={cy + 14} textAnchor="middle"
                  fontSize="160" fontWeight={scoreWeight} fill="#fff"
                  fontFamily="'Sora', sans-serif"
                  style={{ letterSpacing: '-0.055em', fontVariantNumeric: 'tabular-nums', transition: 'font-weight 900ms' }}>
              {score ?? '—'}
            </text>
            <text x={cx} y={cy + 40} textAnchor="middle" fontSize="9"
                  fontFamily="var(--mono)" fill="rgba(255,255,255,.5)" letterSpacing=".36em">{statusLabel}</text>
          </>
        )}
        {variant === 'tool' && (
          <>
            <text x={cx} y={cy - 82} textAnchor="middle" fontSize="10"
                  fontFamily="var(--mono)" fill={scoreTone} letterSpacing=".28em" opacity="0.7">NETWORK</text>
            <text x={cx} y={cy + 18} textAnchor="middle"
                  fontSize="180" fontWeight={scoreWeight} fill={scoreTone}
                  fontFamily="'Sora', sans-serif"
                  style={{ letterSpacing: '-0.06em', fontVariantNumeric: 'tabular-nums', transition: 'font-weight 900ms, fill 600ms' }}>
              {score ?? '—'}
            </text>
            <text x={cx} y={cy + 46} textAnchor="middle" fontSize="10"
                  fontFamily="var(--mono)" fill={scoreTone} letterSpacing=".26em" opacity="0.8">{statusLabel}</text>
          </>
        )}
        {variant === 'product' && (
          <>
            <text x={cx} y={cy + 22} textAnchor="middle"
                  fontSize="220" fontWeight="200" fill="#fff"
                  fontFamily="'Sora', sans-serif"
                  style={{ letterSpacing: '-0.065em', fontVariantNumeric: 'tabular-nums' }}>
              {score ?? '—'}
            </text>
            <text x={cx} y={cy + 52} textAnchor="middle" fontSize="9.5"
                  fontFamily="var(--mono)" fill="rgba(255,255,255,.4)" letterSpacing=".32em">{statusLabel}</text>
          </>
        )}

        {/* Live hand */}
        {(() => {
          const a = handAng * Math.PI / 180;
          const tipR = outerR - 12;
          const tailR = variant === 'product' ? 12 : 28;
          return (
            <g>
              <line x1={cx - Math.cos(a) * tailR} y1={cy - Math.sin(a) * tailR}
                    x2={cx + Math.cos(a) * tipR} y2={cy + Math.sin(a) * tipR}
                    stroke="#fff" strokeWidth={variant === 'product' ? 1.2 : 1.8}
                    strokeLinecap="round" filter="url(#sig-glow)" />
              <circle cx={cx + Math.cos(a) * tipR} cy={cy + Math.sin(a) * tipR} r={variant === 'product' ? 2.5 : 3.5}
                      fill={variant === 'tool' ? scoreTone : '#fff'} />
            </g>
          );
        })()}
        {/* Central hub */}
        <circle cx={cx} cy={cy} r={variant === 'product' ? 3 : 6} fill="#020206"
                stroke="rgba(255,255,255,.5)" strokeWidth="0.8" />
      </svg>
    </div>
  );
}

/* ============================================================
   ENDPOINT ORBIT — shared primitive
   ============================================================ */
function EndpointOrbit({ variant, cx, cy, outerR, latToAng, endpoints, statsMap, threshold }) {
  const orbitR = outerR + (variant === 'product' ? 14 : 8);
  return (
    <g>
      {/* Track */}
      <circle cx={cx} cy={cy} r={orbitR} fill="none"
              stroke={variant === 'product' ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.06)'}
              strokeWidth={variant === 'product' ? 0.5 : 1} />
      {endpoints.map(ep => {
        const d = statsMap[ep.id];
        const lat = d?.last?.latency;
        const samples = d?.samples || [];
        if (lat == null) return null;
        const ang = latToAng(lat);
        const a = ang * Math.PI / 180;
        const over = lat > threshold;

        // Short comet tail: last 8 samples as a faint arc
        const tail = samples.slice(-8).filter(s => s.latency != null);
        const tailPath = tail.length > 1
          ? tail.map((s, i) => {
              const ta = latToAng(s.latency) * Math.PI / 180;
              const x = cx + Math.cos(ta) * orbitR;
              const y = cy + Math.sin(ta) * orbitR;
              return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
            }).join(' ')
          : '';

        const pipX = cx + Math.cos(a) * orbitR;
        const pipY = cy + Math.sin(a) * orbitR;
        const pipSize = variant === 'product' ? (over ? 2.8 : 2.2) : (over ? 3.5 : 2.6);

        return (
          <g key={ep.id}>
            {tailPath && variant !== 'product' && (
              <path d={tailPath} fill="none" stroke={ep.color} strokeWidth="1.2" opacity="0.35" strokeLinecap="round" />
            )}
            <circle cx={pipX} cy={pipY} r={pipSize} fill={ep.color}
                    stroke={over ? 'rgba(249,168,212,.3)' : 'rgba(0,0,0,.4)'}
                    strokeWidth={over ? 2 : 0.5}>
              {over && <animate attributeName="r" values={`${pipSize};${pipSize + 1.8};${pipSize}`}
                                dur="1.6s" repeatCount="indefinite" />}
            </circle>
          </g>
        );
      })}
    </g>
  );
}

/* ============================================================
   QUALITY TRACE
   ============================================================ */
function QualityTraceUnder({ cx, cy, width, height, history, tone, asTicks = false }) {
  if (!history || history.length < 2) return null;
  const N = history.length;
  const x0 = cx - width / 2;
  const y0 = cy - height;
  if (asTicks) {
    return (
      <g>
        {history.map((h, i) => {
          const x = x0 + (i / Math.max(1, N - 1)) * width;
          const h01 = Math.max(0.05, Math.min(1, h.score / 100));
          const barH = h01 * height;
          return (
            <line key={i} x1={x} y1={y0 + height - barH} x2={x} y2={y0 + height}
                  stroke={tone} strokeWidth="1" opacity={0.3 + h01 * 0.4} />
          );
        })}
      </g>
    );
  }
  const toXY = (i, score) => {
    const x = x0 + (i / Math.max(1, N - 1)) * width;
    const y = y0 + height - (Math.max(0, Math.min(100, score)) / 100) * height;
    return [x, y];
  };
  const pts = history.map((h, i) => toXY(i, h.score));
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const lastPt = pts[pts.length - 1];
  return (
    <g>
      <path d={d} fill="none" stroke={tone} strokeWidth="1.2" opacity="0.85" filter="url(#sig-glow)" />
      {lastPt && <circle cx={lastPt[0]} cy={lastPt[1]} r="2" fill={tone} opacity="0.95" />}
    </g>
  );
}

/* ============================================================
   helpers
   ============================================================ */
function arcPath(cx, cy, r, a0, a1) {
  const a0r = a0 * Math.PI / 180, a1r = a1 * Math.PI / 180;
  const x0 = cx + Math.cos(a0r) * r, y0 = cy + Math.sin(a0r) * r;
  const x1 = cx + Math.cos(a1r) * r, y1 = cy + Math.sin(a1r) * r;
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
}

function oneSentenceVerdict(endpoints, statsMap, threshold) {
  const rows = endpoints.map(e => ({ ep: e, stats: statsMap[e.id]?.stats, tier2: statsMap[e.id]?.tier2 })).filter(r => r.stats);
  if (!rows.length) return { tone: 'good', text: 'Calibrating…' };

  const overCount = rows.filter(r => r.stats.p50 > threshold).length;
  const avgLoss = rows.reduce((a, r) => a + r.stats.lossPercent, 0) / rows.length;
  const avgJit  = rows.reduce((a, r) => a + r.stats.stddev, 0) / rows.length;

  if (overCount === 0 && avgLoss < 1 && avgJit < 25) {
    return { tone: 'good', text: 'All links within tolerance.' };
  }

  const tierRows = rows.filter(r => r.tier2);
  const phases = ['dns','tcp','tls','ttfb','transfer'];
  const phaseLabels = { dns: 'DNS', tcp: 'TCP handshake', tls: 'TLS handshake', ttfb: 'TTFB', transfer: 'Transfer' };
  const dominance = tierRows.map(r => {
    const t = r.tier2;
    const total = phases.reduce((a,p) => a + t[p], 0) || 1;
    let dom = 'ttfb', domPct = 0;
    for (const p of phases) { const pct = t[p] / total; if (pct > domPct) { domPct = pct; dom = p; } }
    return { ep: r.ep, stats: r.stats, dom };
  });
  const unhealthyCounts = {};
  for (const d of dominance) if (d.stats.p50 > threshold * 0.7) unhealthyCounts[d.dom] = (unhealthyCounts[d.dom] || 0) + 1;
  const topPhase = Object.entries(unhealthyCounts).sort((a, b) => b[1] - a[1])[0];

  if (overCount >= 2 && topPhase && topPhase[1] >= 2) {
    return { tone: 'warn', text: `${phaseLabels[topPhase[0]]} slow on ${topPhase[1]} endpoints — likely upstream.` };
  }
  if (overCount === 1) {
    const bad = rows.find(r => r.stats.p50 > threshold);
    return { tone: 'warn', text: `${bad.ep.label} degraded alone — endpoint-specific.` };
  }
  if (avgLoss > 1) return { tone: 'warn', text: `Packet loss elevated (${avgLoss.toFixed(1)}%).` };
  if (avgJit > 25) return { tone: 'warn', text: `Jitter elevated (σ=${avgJit.toFixed(1)}ms).` };
  return { tone: 'warn', text: `${overCount} endpoint${overCount > 1 ? 's' : ''} above threshold.` };
}

window.OverviewSignature = OverviewSignature;
