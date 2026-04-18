/* Overview v2 — Enriched Chronograph.

   Five upgrades over the classic version:
   1. Baseline arc behind the hand → shows "normal" range, so position is relative not absolute
   2. Quality sparkline inside the dial → trend, not snapshot
   3. Racing strip → endpoints compared on a shared axis (replaces subdial grid)
   4. Event feed → cycling pulse of recent threshold crossings & regime changes
   5. Causal verdict → "TTFB rising on N endpoints — upstream" vs. "TLS slow on X only"
*/

const overviewV2Styles = {
  wrap: { padding: '18px 28px 40px', display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' },
  rightCol: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 },
};

function OverviewViewV2({ state, dispatch }) {
  const { endpoints, statsMap, tick, running, threshold, focusedEpId } = state;
  const statsList = endpoints.map(e => statsMap[e.id]?.stats).filter(Boolean);
  const score = window.networkQuality(statsList);
  const liveVals = endpoints.map(e => statsMap[e.id]?.last?.latency).filter(v => v != null);
  const liveMedian = liveVals.length ? liveVals.reduce((a, b) => a + b, 0) / liveVals.length : 0;

  // --- Quality history buffer (60 samples, one per tick) ---
  const qualityHistory = React.useRef([]);
  const lastTickRef = React.useRef(-1);
  if (tick !== lastTickRef.current && score != null) {
    qualityHistory.current = [...qualityHistory.current, { tick, score }].slice(-60);
    lastTickRef.current = tick;
  }

  // --- Event feed: detect threshold crossings per endpoint ---
  const events = React.useRef([]);
  const lastStateRef = React.useRef({}); // { [epId]: { overThresh: bool, lastP95: number } }
  React.useEffect(() => {
    const now = Date.now();
    const prev = lastStateRef.current;
    const next = { ...prev };
    for (const ep of endpoints) {
      const s = statsMap[ep.id]?.stats;
      const last = statsMap[ep.id]?.last;
      if (!s || !last) continue;
      const lastLat = last.latency;
      if (lastLat == null) continue;

      const prevEnt = prev[ep.id] || { overThresh: false, lastP95: s.p95 };
      const overNow = lastLat > threshold;

      // Threshold crossing
      if (overNow && !prevEnt.overThresh) {
        events.current = [{ t: now, epId: ep.id, kind: 'cross-up', value: lastLat, threshold }, ...events.current].slice(0, 12);
      } else if (!overNow && prevEnt.overThresh) {
        events.current = [{ t: now, epId: ep.id, kind: 'cross-down', value: lastLat, threshold }, ...events.current].slice(0, 12);
      }

      // Large p95 shift (>35% change, sampled rarely)
      if (Math.abs(s.p95 - prevEnt.lastP95) / Math.max(1, prevEnt.lastP95) > 0.35 && tick % 8 === 0) {
        events.current = [{ t: now, epId: ep.id, kind: 'shift', from: prevEnt.lastP95, to: s.p95 }, ...events.current].slice(0, 12);
      }

      next[ep.id] = { overThresh: overNow, lastP95: tick % 8 === 0 ? s.p95 : prevEnt.lastP95 };
    }
    lastStateRef.current = next;
  }, [tick, endpoints, statsMap, threshold]);

  // --- Causal verdict: use tier2 phase data ---
  const verdict = React.useMemo(() => computeCausalVerdict(endpoints, statsMap, threshold), [endpoints, statsMap, threshold, tick]);

  return (
    <div style={overviewV2Styles.wrap}>
      <div>
        <MainDialV2 score={score} scoreHistory={qualityHistory.current}
                    liveMedian={liveMedian} threshold={threshold}
                    endpoints={endpoints} statsMap={statsMap}
                    tick={tick} running={running} />
        <CausalVerdictStrip verdict={verdict} endpoints={endpoints} statsMap={statsMap}
                            onDrill={(id) => dispatch({ type: 'drillToDiagnose', value: id })} />
      </div>
      <div style={overviewV2Styles.rightCol}>
        <RacingStrip endpoints={endpoints} statsMap={statsMap}
                     threshold={threshold} focusedEpId={focusedEpId}
                     onClick={(e, ep) => {
                       if (e.shiftKey) dispatch({ type: 'drillToDiagnose', value: ep.id });
                       else dispatch({ type: 'drillToLive', value: ep.id });
                     }} />
        <EventFeed events={events.current} endpoints={endpoints}
                   onDrill={(id) => dispatch({ type: 'drillToLive', value: id })} />
      </div>
    </div>
  );
}

/* ============================================================
   MAIN DIAL V2 — adds baseline arc + quality sparkline center
   ============================================================ */
function MainDialV2({ score, scoreHistory, liveMedian, threshold, endpoints, statsMap, tick, running }) {
  const size = 520;
  const cx = size / 2, cy = size / 2;
  const outerR = 240;

  const startAng = -135, endAng = 135;
  const latToAng = (ms) => startAng + Math.min(1, Math.max(0, ms / 300)) * (endAng - startAng);

  // Smoothly-animated live hand
  const [displayHand, setDisplayHand] = React.useState(latToAng(liveMedian));
  React.useEffect(() => {
    let raf; const target = latToAng(liveMedian);
    const step = () => {
      setDisplayHand(prev => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.1) return target;
        return prev + diff * 0.18;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [liveMedian]);

  // Pulse on threshold breach
  const [pulsing, setPulsing] = React.useState(false);
  const prevOverRef = React.useRef(false);
  React.useEffect(() => {
    const over = liveMedian > threshold;
    if (over && !prevOverRef.current) {
      setPulsing(true);
      const t = setTimeout(() => setPulsing(false), 900);
      return () => clearTimeout(t);
    }
    prevOverRef.current = over;
  }, [liveMedian, threshold]);

  // Compute aggregate baseline (mean p50 ± mean stddev)
  const agg = React.useMemo(() => {
    const xs = endpoints.map(e => statsMap[e.id]?.stats).filter(Boolean);
    if (!xs.length) return null;
    const meanP50 = xs.reduce((a, s) => a + s.p50, 0) / xs.length;
    const meanSigma = xs.reduce((a, s) => a + s.stddev, 0) / xs.length;
    return { mean: meanP50, sigma: meanSigma };
  }, [endpoints, statsMap]);

  // Tick marks
  const ticks = [];
  for (let ms = 0; ms <= 300; ms += 15) {
    const major = ms % 60 === 0;
    const ang = latToAng(ms);
    const a = ang * Math.PI / 180;
    const r1 = outerR - (major ? 16 : 8);
    const r2 = outerR - 2;
    ticks.push({ ms, major, a, r1, r2 });
  }
  const labels = [0, 60, 120, 180, 240, 300];

  const threshAng = latToAng(threshold);
  const threshPath = arcPath(cx, cy, outerR - 4, threshAng, endAng);

  // Baseline arc: [mean - sigma, mean + sigma], clamped
  const baselinePath = agg
    ? arcPath(cx, cy, outerR - 22,
              latToAng(Math.max(0, agg.mean - agg.sigma)),
              latToAng(Math.min(300, agg.mean + agg.sigma)))
    : null;
  const baselineMeanAng = agg ? latToAng(agg.mean) : null;

  const healthTone = score == null ? '#6b7280'
    : score >= 85 ? '#86efac'
    : score >= 65 ? '#67e8f9'
    : score >= 40 ? '#fbbf24'
    :               '#f9a8d4';

  // Is live hand inside or outside baseline?
  const insideBaseline = agg && liveMedian >= (agg.mean - agg.sigma) && liveMedian <= (agg.mean + agg.sigma);

  // --- BREATHING: visual weight responds to score ---
  // heaviness 0 (healthy) → 1 (critical)
  const heaviness = score == null ? 0.25 : (1 - Math.min(100, score) / 100);
  const faceStroke = 1 + heaviness * 2.2;            // 1 → 3.2
  const majorTickOpacity = 0.4 + heaviness * 0.45;   // 0.4 → 0.85
  const minorTickOpacity = 0.14 + heaviness * 0.24;  // 0.14 → 0.38
  const labelOpacity = 0.35 + heaviness * 0.35;      // 0.35 → 0.7
  const scoreWeight = 200 + Math.round(heaviness * 200); // 200 → 400
  const ringOpacity = 0.06 + heaviness * 0.18;       // 0.06 → 0.24

  return (
    <div className={`main-dial ${pulsing ? 'pulsing' : ''}`} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 560, display: 'block' }}>
        <defs>
          <radialGradient id="dial-bg-v2" cx="50%" cy="40%">
            <stop offset="0%" stopColor="#1a1528" />
            <stop offset="60%" stopColor="#0c0a14" />
            <stop offset="100%" stopColor="#030207" />
          </radialGradient>
          <filter id="dial-glow-v2">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="spark-glow-v2">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <circle cx={cx} cy={cy} r={outerR + 8} fill="none" stroke={`rgba(255,255,255,${ringOpacity})`} strokeWidth="1"
                style={{ transition: 'stroke 900ms ease' }} />
        <circle cx={cx} cy={cy} r={outerR} fill="url(#dial-bg-v2)" stroke="rgba(255,255,255,.14)" strokeWidth={faceStroke}
                style={{ transition: 'stroke-width 900ms ease' }} />
        <circle cx={cx} cy={cy} r={outerR - 4} fill="none" stroke={pulsing ? healthTone : 'rgba(255,255,255,.06)'}
                strokeWidth={pulsing ? 2 : 1} style={{ transition: 'stroke 400ms' }} />

        {/* --- UPGRADE #1: BASELINE ARC --- */}
        {baselinePath && (
          <g opacity="0.85">
            <path d={baselinePath} fill="none" stroke="rgba(103,232,249,.55)" strokeWidth="16"
                  strokeLinecap="round" />
            <path d={baselinePath} fill="none" stroke="rgba(103,232,249,.2)" strokeWidth="22"
                  strokeLinecap="round" />
            <path d={baselinePath} fill="none" stroke="#67e8f9" strokeWidth="1.2"
                  strokeLinecap="round" />
            {/* mean tick on the band */}
            {baselineMeanAng != null && (() => {
              const a = baselineMeanAng * Math.PI / 180;
              return (
                <line
                  x1={cx + Math.cos(a) * (outerR - 32)} y1={cy + Math.sin(a) * (outerR - 32)}
                  x2={cx + Math.cos(a) * (outerR - 12)} y2={cy + Math.sin(a) * (outerR - 12)}
                  stroke="#67e8f9" strokeWidth="1.5" opacity="1" />
              );
            })()}
          </g>
        )}
        {/* Baseline label */}
        {agg && (() => {
          const a = latToAng(agg.mean + agg.sigma) * Math.PI / 180;
          const lr = outerR - 48;
          return (
            <text x={cx + Math.cos(a) * lr} y={cy + Math.sin(a) * lr}
                  textAnchor="middle" fontSize="8.5" fontFamily="var(--mono)"
                  fill="rgba(103,232,249,.55)" letterSpacing=".2em">
              NORMAL
            </text>
          );
        })()}

        {/* Hairline concentric rings */}
        <circle cx={cx} cy={cy} r={outerR - 36} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth=".5" />
        <circle cx={cx} cy={cy} r={96} fill="none" stroke="rgba(255,255,255,.04)" strokeWidth=".5" />

        {/* threshold arc */}
        <path d={threshPath} fill="none" stroke="rgba(249,168,212,.35)" strokeWidth="2" strokeLinecap="round" />

        {/* tick marks */}
        {ticks.map(t => (
          <line key={t.ms}
                x1={cx + Math.cos(t.a) * t.r1} y1={cy + Math.sin(t.a) * t.r1}
                x2={cx + Math.cos(t.a) * t.r2} y2={cy + Math.sin(t.a) * t.r2}
                stroke={t.major ? `rgba(255,255,255,${majorTickOpacity})` : `rgba(255,255,255,${minorTickOpacity})`}
                strokeWidth={t.major ? 1.3 : 0.8}
                style={{ transition: 'stroke 900ms ease' }} />
        ))}
        {labels.map(ms => {
          const ang = latToAng(ms) * Math.PI / 180;
          const r = outerR - 30;
          return (
            <text key={ms} x={cx + Math.cos(ang) * r} y={cy + Math.sin(ang) * r + 3}
                  textAnchor="middle" fontSize="10" fontFamily="var(--mono)"
                  fill={`rgba(255,255,255,${labelOpacity})`} letterSpacing=".1em"
                  style={{ transition: 'fill 900ms ease' }}>{ms}</text>
          );
        })}

        {/* --- UPGRADE #2: QUALITY SPARKLINE (60s trace, below score) --- */}
        <QualityTraceMini cx={cx} cy={cy + 74} width={160} height={22}
                          history={scoreHistory} tone={healthTone} />

        {/* Quality label + score */}
        <text x={cx} y={cy - 72} textAnchor="middle" fontSize="9"
              fontFamily="var(--mono)" fill="rgba(255,255,255,.35)" letterSpacing=".3em">QUALITY</text>
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="100" fontWeight={scoreWeight} fill="#fff"
              fontFamily="'Sora', sans-serif"
              style={{ letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums', transition: 'font-weight 900ms ease' }}>
          {score ?? '—'}
        </text>
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize="10"
              fontFamily="var(--mono)" fill={healthTone} letterSpacing=".28em">
          {score == null ? '···' : score >= 85 ? 'EXCELLENT' : score >= 65 ? 'HEALTHY' : score >= 40 ? 'DEGRADED' : 'CRITICAL'}
        </text>
        <text x={cx} y={cy + 108} textAnchor="middle" fontSize="9.5"
              fontFamily="var(--mono)"
              fill={insideBaseline ? 'rgba(255,255,255,.35)' : 'rgba(251,191,36,.8)'}
              letterSpacing=".18em">
          LIVE {fmt(liveMedian).toUpperCase()} · {insideBaseline ? 'WITHIN BAND' : 'OUTSIDE BAND'}
        </text>

        {/* Endpoint orbit ring */}
        {(() => {
          const orbitR = outerR + 4;
          const barInner = orbitR - 3;
          const barOuter = orbitR + 3;
          return (
            <g className="endpoint-orbit">
              <circle cx={cx} cy={cy} r={orbitR} fill="none"
                      stroke="rgba(255,255,255,.06)" strokeWidth="6" />
              <circle cx={cx} cy={cy} r={orbitR} fill="none"
                      stroke="rgba(255,255,255,.1)" strokeWidth=".8" />
              {endpoints.map(ep => {
                const d = statsMap[ep.id];
                const lat = d?.last?.latency;
                if (lat == null) return null;
                const ang = latToAng(lat) * Math.PI / 180;
                const over = lat > threshold;
                const x1 = cx + Math.cos(ang) * barInner;
                const y1 = cy + Math.sin(ang) * barInner;
                const x2 = cx + Math.cos(ang) * barOuter;
                const y2 = cy + Math.sin(ang) * barOuter;
                const pipX = cx + Math.cos(ang) * (barOuter + 4);
                const pipY = cy + Math.sin(ang) * (barOuter + 4);
                return (
                  <g key={ep.id}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                          stroke={ep.color} strokeWidth="2.5" strokeLinecap="round"
                          opacity={over ? 1 : .9} />
                    <circle cx={pipX} cy={pipY} r={over ? 3 : 2.2}
                            fill={ep.color}
                            stroke={over ? 'rgba(249,168,212,.4)' : 'rgba(0,0,0,.4)'}
                            strokeWidth={over ? 2 : .5}>
                      {over && <animate attributeName="r" values="2.2;4;2.2" dur="1.4s" repeatCount="indefinite" />}
                    </circle>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* Main hand */}
        {(() => {
          const a = displayHand * Math.PI / 180;
          const tipR = outerR - 10;
          const tailR = 24;
          return (
            <g>
              <line x1={cx - Math.cos(a) * tailR} y1={cy - Math.sin(a) * tailR}
                    x2={cx + Math.cos(a) * tipR} y2={cy + Math.sin(a) * tipR}
                    stroke="#fff" strokeWidth="2.2" strokeLinecap="round" filter="url(#dial-glow-v2)" />
              <circle cx={cx + Math.cos(a) * tipR} cy={cy + Math.sin(a) * tipR} r="4" fill={healthTone} />
            </g>
          );
        })()}
        {/* Central hub */}
        <circle cx={cx} cy={cy} r="8" fill="#0a0812" stroke="rgba(255,255,255,.4)" />
        <circle cx={cx} cy={cy} r="2.5" fill="#fff" />
      </svg>
    </div>
  );
}

/* Quality trace — small 60s sparkline under the quality score */
function QualityTraceMini({ cx, cy, width, height, history, tone }) {
  if (!history || history.length < 2) return null;
  const N = history.length;
  const x0 = cx - width / 2;
  const y0 = cy - height;
  const toXY = (i, score) => {
    const x = x0 + (i / Math.max(1, N - 1)) * width;
    const y = y0 + height - (Math.max(0, Math.min(100, score)) / 100) * height;
    return [x, y];
  };
  const pts = history.map((h, i) => toXY(i, h.score));
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const dArea = d + ` L${(x0 + width).toFixed(1)},${(y0 + height).toFixed(1)} L${x0.toFixed(1)},${(y0 + height).toFixed(1)} Z`;
  const lastPt = pts[pts.length - 1];
  return (
    <g>
      {/* faint baseline */}
      <line x1={x0} y1={y0 + height} x2={x0 + width} y2={y0 + height}
            stroke="rgba(255,255,255,.06)" strokeWidth=".5" />
      <path d={dArea} fill={tone} opacity="0.08" />
      <path d={d} fill="none" stroke={tone} strokeWidth="1.2" opacity="0.85" filter="url(#spark-glow-v2)" />
      {lastPt && <circle cx={lastPt[0]} cy={lastPt[1]} r="2.2" fill={tone} opacity="0.95" />}
    </g>
  );
}

/* Legacy inner arc sparkline — kept in case we toggle back */
function QualityInnerSparkline({ cx, cy, rInner, rOuter, history, tone }) {
  if (!history || history.length < 2) return null;
  // Map score 0–100 to radius rInner (low) → rOuter (high)
  // Map tick index 0..N to angle in [-135° .. +135°]
  const N = history.length;
  const startAng = -135, endAng = 135;
  const toXY = (i, score) => {
    const ang = (startAng + (i / Math.max(1, N - 1)) * (endAng - startAng)) * Math.PI / 180;
    const r = rInner + (Math.max(0, Math.min(100, score)) / 100) * (rOuter - rInner);
    return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
  };
  const pts = history.map((h, i) => toXY(i, h.score));
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  // Guide rings for min/max of the band
  const guideInner = arcPath(cx, cy, rInner, startAng, endAng);
  const guideOuter = arcPath(cx, cy, rOuter, startAng, endAng);
  const lastPt = pts[pts.length - 1];
  return (
    <g>
      <path d={guideInner} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth=".5" strokeDasharray="2 3" />
      <path d={guideOuter} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth=".5" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke={tone} strokeWidth="1.2" opacity="0.85" filter="url(#spark-glow-v2)" />
      {lastPt && <circle cx={lastPt[0]} cy={lastPt[1]} r="2.5" fill={tone} opacity="0.95" />}
    </g>
  );
}

function arcPath(cx, cy, r, a0, a1) {
  const a0r = a0 * Math.PI / 180, a1r = a1 * Math.PI / 180;
  const x0 = cx + Math.cos(a0r) * r, y0 = cy + Math.sin(a0r) * r;
  const x1 = cx + Math.cos(a1r) * r, y1 = cy + Math.sin(a1r) * r;
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
}

/* ============================================================
   UPGRADE #3: RACING STRIP — endpoints compared on shared axis
   ============================================================ */
function RacingStrip({ endpoints, statsMap, threshold, focusedEpId, onClick }) {
  // Shared axis 0..axisMax ms (dynamic based on slowest p95, clamped to 300)
  const maxSeen = React.useMemo(() => {
    const xs = endpoints.map(e => statsMap[e.id]?.stats?.p95 || 0);
    return Math.max(150, Math.min(300, Math.ceil((Math.max(...xs, 0) * 1.2) / 30) * 30));
  }, [endpoints, statsMap]);

  return (
    <div className="v2-racing">
      <div className="v2-section-header">
        <div>
          <div className="v2-kicker">Per-endpoint comparison</div>
          <div className="v2-title">Live latencies on shared axis</div>
        </div>
        <div className="v2-hint">Click → Live · ⇧-click → Diagnose</div>
      </div>
      <div className="v2-racing-axis">
        <span>0</span>
        <span>{Math.round(maxSeen / 3)}</span>
        <span className="v2-racing-thresh" style={{ left: `${(threshold / maxSeen) * 100}%` }}>
          {Math.round(threshold)} trigger
        </span>
        <span>{Math.round((maxSeen / 3) * 2)}</span>
        <span>{maxSeen}</span>
      </div>
      <div className="v2-racing-rows">
        {endpoints.map(ep => {
          const d = statsMap[ep.id];
          const s = d?.stats;
          const last = d?.last;
          const samples = d?.samples || [];
          const lat = last?.latency;
          const over = lat != null && lat > threshold;
          const pctLat = lat != null ? Math.min(100, (lat / maxSeen) * 100) : 0;
          const pctP50 = s ? Math.min(100, (s.p50 / maxSeen) * 100) : 0;
          const pctP95 = s ? Math.min(100, (s.p95 / maxSeen) * 100) : 0;
          return (
            <button key={ep.id}
                    className={`v2-racing-row ${focusedEpId === ep.id ? 'focused' : ''} ${over ? 'over' : ''}`}
                    onClick={(e) => onClick(e, ep)}
                    style={{ '--ep-color': ep.color }}>
              <div className="v2-racing-label">
                <span className="v2-racing-dot" style={{ background: ep.color }} />
                <span className="v2-racing-name">{ep.label}</span>
              </div>
              <div className="v2-racing-track" style={{
                background: `linear-gradient(to right,
                  rgba(255,255,255,.04) 0%,
                  rgba(255,255,255,.04) ${(threshold / maxSeen) * 100}%,
                  rgba(249,168,212,.06) ${(threshold / maxSeen) * 100}%,
                  rgba(249,168,212,.06) 100%)`
              }}>
                {/* Threshold tick */}
                <div className="v2-racing-threshtick"
                     style={{ left: `${(threshold / maxSeen) * 100}%` }} />
                {/* p50 → p95 band */}
                {s && (
                  <div className="v2-racing-band"
                       style={{
                         left: `${pctP50}%`,
                         width: `${Math.max(0.5, pctP95 - pctP50)}%`,
                         background: ep.color,
                       }} />
                )}
                {/* Trailing sparkline */}
                <svg className="v2-racing-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
                  {(() => {
                    const slice = samples.slice(-40);
                    if (slice.length < 2) return null;
                    const vals = slice.map(s => s.latency).filter(v => v != null);
                    if (!vals.length) return null;
                    const min = 0, max = maxSeen;
                    const pts = slice.map((s, i) => {
                      const x = (i / (slice.length - 1)) * 100;
                      const y = s.latency == null ? 28 : 28 - ((s.latency - min) / (max - min)) * 26 - 1;
                      return [x, y, s.latency == null];
                    });
                    const d = pts.map(([x, y, lost], i) =>
                      (i === 0 || lost ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
                    return <path d={d} fill="none" stroke={ep.color} strokeWidth="1" opacity="0.55" />;
                  })()}
                </svg>
                {/* Live dot */}
                {lat != null && (
                  <div className={`v2-racing-livedot ${over ? 'over' : ''}`}
                       style={{ left: `${pctLat}%`, background: ep.color,
                                boxShadow: over ? `0 0 10px ${ep.color}` : `0 0 4px ${ep.color}` }} />
                )}
              </div>
              <div className="v2-racing-stats">
                <span className="v2-racing-live">{lat != null ? Math.round(lat) : '—'}<em>ms</em></span>
                <span className="v2-racing-p95">p95 {s ? Math.round(s.p95) : '—'}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   UPGRADE #4: EVENT FEED — recent threshold crossings
   ============================================================ */
function EventFeed({ events, endpoints, onDrill }) {
  const epById = React.useMemo(() => Object.fromEntries(endpoints.map(e => [e.id, e])), [endpoints]);
  const now = Date.now();
  const shown = events.slice(0, 5);
  // Track the most recent event's id so we can briefly highlight it on entry
  const latestKey = shown[0] ? `${shown[0].t}-${shown[0].epId}-${shown[0].kind}` : null;
  const prevLatestRef = React.useRef(latestKey);
  const [justArrived, setJustArrived] = React.useState(false);
  React.useEffect(() => {
    if (latestKey && latestKey !== prevLatestRef.current) {
      prevLatestRef.current = latestKey;
      setJustArrived(true);
      const t = setTimeout(() => setJustArrived(false), 1200);
      return () => clearTimeout(t);
    }
  }, [latestKey]);

  return (
    <div className="v2-feed">
      <div className="v2-section-header">
        <div>
          <div className="v2-kicker">Recent events</div>
          <div className="v2-title">Threshold activity</div>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="v2-feed-empty">No crossings in window. Network steady.</div>
      ) : (
        <ul className="v2-feed-list">
          {shown.map((ev, i) => {
            const ep = epById[ev.epId];
            if (!ep) return null;
            const secs = Math.max(0, Math.round((now - ev.t) / 1000));
            const timeLabel = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
            const isLatest = i === 0;
            return (
              <li key={`${ev.t}-${ev.epId}-${ev.kind}`}
                  className={`v2-feed-row v2-feed-${ev.kind} ${isLatest ? 'latest' : ''} ${isLatest && justArrived ? 'arrived' : ''}`}
                  style={{ '--rank': i }}
                  onClick={() => onDrill(ev.epId)}>
                <span className="v2-feed-time">{timeLabel}</span>
                <span className="v2-feed-dot" style={{ background: ep.color }} />
                <span className="v2-feed-name">{ep.label}</span>
                <span className="v2-feed-action">
                  {ev.kind === 'cross-up' && <>crossed up · <em>{Math.round(ev.value)}ms</em></>}
                  {ev.kind === 'cross-down' && <>recovered · <em>{Math.round(ev.value)}ms</em></>}
                  {ev.kind === 'shift' && <>p95 shift · <em>{Math.round(ev.from)}→{Math.round(ev.to)}ms</em></>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   UPGRADE #5: CAUSAL VERDICT STRIP
   ============================================================ */
function computeCausalVerdict(endpoints, statsMap, threshold) {
  const rows = endpoints.map(e => ({ ep: e, stats: statsMap[e.id]?.stats, tier2: statsMap[e.id]?.tier2 })).filter(r => r.stats);
  if (!rows.length) return { tone: 'good', headline: 'Calibrating…' };

  const overCount = rows.filter(r => r.stats.p50 > threshold).length;
  const avgLoss = rows.reduce((a, r) => a + r.stats.lossPercent, 0) / rows.length;
  const avgJit  = rows.reduce((a, r) => a + r.stats.stddev, 0) / rows.length;

  if (overCount === 0 && avgLoss < 1 && avgJit < 25) {
    return { tone: 'good', headline: 'All links within tolerance.' };
  }

  // Compute phase dominance for endpoints with tier2 data
  const tierRows = rows.filter(r => r.tier2);
  const phases = ['dns','tcp','tls','ttfb','transfer'];
  const dominance = tierRows.map(r => {
    const t = r.tier2;
    const total = phases.reduce((a,p) => a + t[p], 0) || 1;
    let dom = 'ttfb', domPct = 0;
    for (const p of phases) { const pct = t[p] / total; if (pct > domPct) { domPct = pct; dom = p; } }
    return { ep: r.ep, stats: r.stats, dom, domPct, tier2: t };
  });

  const unhealthyCounts = {};
  for (const d of dominance) {
    if (d.stats.p50 > threshold * 0.7) {
      unhealthyCounts[d.dom] = (unhealthyCounts[d.dom] || 0) + 1;
    }
  }
  const topPhase = Object.entries(unhealthyCounts).sort((a, b) => b[1] - a[1])[0];
  const phaseLabels = { dns: 'DNS', tcp: 'TCP handshake', tls: 'TLS handshake', ttfb: 'TTFB', transfer: 'Transfer' };

  if (overCount >= 2 && topPhase && topPhase[1] >= 2) {
    const [phase, count] = topPhase;
    return { tone: 'warn', headline: `${phaseLabels[phase]} slow on ${count} endpoints — likely upstream.`, phase };
  }

  if (overCount === 1) {
    const bad = rows.find(r => r.stats.p50 > threshold);
    return { tone: 'warn', headline: `${bad.ep.label} degraded alone — endpoint-specific.`, worstEpId: bad.ep.id };
  }

  if (avgLoss > 1) return { tone: 'warn', headline: `Packet loss elevated to ${avgLoss.toFixed(1)}%.` };
  if (avgJit > 25) return { tone: 'warn', headline: `Jitter elevated — σ ${avgJit.toFixed(1)}ms.` };

  return { tone: 'warn', headline: `${overCount} endpoint${overCount > 1 ? 's' : ''} above threshold.` };
}

function CausalVerdictStrip({ verdict, endpoints, statsMap, onDrill }) {
  const worstEp = React.useMemo(() => {
    return endpoints.reduce((w, e) => {
      const s = statsMap[e.id]?.stats; if (!s) return w;
      if (!w) return { ep: e, stats: s };
      return s.p95 > w.stats.p95 ? { ep: e, stats: s } : w;
    }, null);
  }, [endpoints, statsMap]);

  const drillId = verdict.worstEpId || worstEp?.ep?.id;
  const drillEp = drillId ? endpoints.find(e => e.id === drillId) : null;

  const statsList = endpoints.map(e => statsMap[e.id]?.stats).filter(Boolean);
  const avgP50 = statsList.length ? statsList.reduce((a, s) => a + s.p50, 0) / statsList.length : 0;
  const avgJit = statsList.length ? statsList.reduce((a, s) => a + s.stddev, 0) / statsList.length : 0;
  const avgLoss = statsList.length ? statsList.reduce((a, s) => a + s.lossPercent, 0) / statsList.length : 0;

  return (
    <div className={`v2-verdict v2-verdict-${verdict.tone}`}>
      <div className="v2-verdict-main">
        <div className="v2-verdict-line">
          <span className="v2-verdict-dot" />
          <span className="v2-verdict-headline">{verdict.headline}</span>
        </div>
      </div>
      <div className="v2-verdict-metrics">
        <div className="v2-vmet">
          <div className="v2-vmet-label">MEDIAN</div>
          <div className="v2-vmet-val">{Math.round(avgP50)}<em>ms</em></div>
        </div>
        <div className="v2-vmet">
          <div className="v2-vmet-label">JITTER</div>
          <div className="v2-vmet-val">{avgJit.toFixed(1)}<em>σ</em></div>
        </div>
        <div className="v2-vmet">
          <div className="v2-vmet-label">LOSS</div>
          <div className="v2-vmet-val">{avgLoss.toFixed(1)}<em>%</em></div>
        </div>
      </div>
      {drillEp && (
        <button className="v2-verdict-drill" onClick={() => onDrill(drillEp.id)}>
          <span>Diagnose</span>
          <span className="v2-verdict-drill-ep" style={{ color: drillEp.color }}>{drillEp.label}</span>
          <span className="v2-verdict-drill-arrow">→</span>
        </button>
      )}
    </div>
  );
}

window.OverviewViewV2 = OverviewViewV2;
