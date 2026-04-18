/* Overview — Chronograph.
   Grand central dial with live latency hand, quality score hero,
   and endpoint sub-dials. Click a sub-dial → Live. */

const overviewStyles = {
  wrap: { padding: '18px 28px 40px', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 28, alignItems: 'start' },
};

function OverviewView({ state, dispatch }) {
  const { endpoints, statsMap, tick, running, threshold, focusedEpId } = state;
  const statsList = endpoints.map(e => statsMap[e.id]?.stats).filter(Boolean);
  const score = window.networkQuality(statsList);
  const liveVals = endpoints.map(e => statsMap[e.id]?.last?.latency).filter(v => v != null);
  const liveMedian = liveVals.length ? liveVals.reduce((a,b)=>a+b,0)/liveVals.length : 0;
  const worstEp = endpoints.reduce((w, e) => {
    const s = statsMap[e.id]?.stats; if (!s) return w;
    if (!w) return { ep: e, stats: s };
    return s.p95 > w.stats.p95 ? { ep: e, stats: s } : w;
  }, null);

  return (
    <div style={overviewStyles.wrap}>
      <div>
        <MainDial score={score} liveMedian={liveMedian} threshold={threshold}
                  endpoints={endpoints} statsMap={statsMap} tick={tick} running={running} />
        <DiagnosisStrip endpoints={endpoints} statsMap={statsMap} worstEp={worstEp}
                        threshold={threshold} onDrill={(id) => dispatch({ type: 'drillToDiagnose', value: id })} />
      </div>
      <div>
        <SectionHeader kicker="Sub-dials" title="Per-endpoint"
                       hint="Click a dial for live trace · ⇧-click to diagnose" />
        <div className="subdials">
          {endpoints.map(ep => (
            <SubDial key={ep.id} ep={ep} data={statsMap[ep.id]}
                     tick={tick} running={running} threshold={threshold}
                     focused={focusedEpId === ep.id}
                     onClick={(e) => {
                       if (e.shiftKey) dispatch({ type: 'drillToDiagnose', value: ep.id });
                       else dispatch({ type: 'drillToLive', value: ep.id });
                     }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MainDial({ score, liveMedian, threshold, endpoints, statsMap, tick, running }) {
  const size = 520;
  const cx = size / 2, cy = size / 2;
  const outerR = 240, innerR = 186;

  // Angle: 0ms at -135deg, 300ms at +135deg (270deg arc)
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

  // Threshold pulse
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

  const healthTone = score == null ? '#6b7280'
    : score >= 85 ? '#86efac'
    : score >= 65 ? '#67e8f9'
    : score >= 40 ? '#fbbf24'
    :               '#f9a8d4';

  // Sub-seconds ring at 9 o'clock — live tick indicator
  const subR = 32;
  const subCx = cx - 92, subCy = cy + 6;
  const subHandAng = ((tick % 60) / 60) * 360 - 90;
  const subHandR = (subHandAng) * Math.PI / 180;

  // Jewel screw positions (four corners)
  const screws = [[0.14, 0.14],[0.86, 0.14],[0.14, 0.86],[0.86, 0.86]];

  return (
    <div className={`main-dial ${pulsing ? 'pulsing' : ''}`} style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 560, display: 'block' }}>
        <defs>
          <radialGradient id="dial-bg" cx="50%" cy="40%">
            <stop offset="0%" stopColor="#1a1528" />
            <stop offset="60%" stopColor="#0c0a14" />
            <stop offset="100%" stopColor="#030207" />
          </radialGradient>
          <radialGradient id="bezel-grad" cx="50%" cy="35%">
            <stop offset="0%" stopColor="#2a2438" />
            <stop offset="50%" stopColor="#141021" />
            <stop offset="100%" stopColor="#08060e" />
          </radialGradient>
          <linearGradient id="screw-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3a3448" />
            <stop offset="100%" stopColor="#0a0812" />
          </linearGradient>
          <pattern id="brushed" patternUnits="userSpaceOnUse" width="400" height="2">
            <rect width="400" height="2" fill="transparent" />
            <line x1="0" y1="1" x2="400" y2="1" stroke="rgba(255,255,255,.04)" />
          </pattern>
          <filter id="dial-glow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="emboss" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" result="blur" />
            <feSpecularLighting in="blur" surfaceScale="2" specularConstant=".6" specularExponent="20"
                                lightingColor="#ffffff" result="spec">
              <feDistantLight azimuth="225" elevation="60" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specCut" />
            <feComposite in="SourceGraphic" in2="specCut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
          </filter>
        </defs>

        <circle cx={cx} cy={cy} r={outerR + 8} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />

        {false && [{a:-90, txt:''},{a:90, txt:''}].map((m, i) => {
          const rad = outerR + 15;
          return (
            <text key={i}
                  x={cx} y={cy}
                  fontSize="7.5" fontFamily="var(--mono)" fill="rgba(255,255,255,.3)"
                  letterSpacing=".3em" textAnchor="middle"
                  transform={`rotate(${m.a} ${cx} ${cy}) translate(0 ${-rad + (i?6:-2)})${m.a === 90 ? ` rotate(180 ${cx} ${cy})` : ''}`}>
              {m.txt}
            </text>
          );
        })}

        {false && screws.map(([fx, fy], i) => {
          const x = fx * size, y = fy * size;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="6" fill="url(#screw-grad)" stroke="rgba(0,0,0,.6)" strokeWidth=".5" />
              <line x1={x - 3.5} y1={y} x2={x + 3.5} y2={y} stroke="rgba(0,0,0,.7)" strokeWidth=".8"
                    transform={`rotate(${i * 37} ${x} ${y})`} />
            </g>
          );
        })}

        <circle cx={cx} cy={cy} r={outerR} fill="url(#dial-bg)" stroke="rgba(255,255,255,.14)" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={outerR - 4} fill="none" stroke={pulsing ? healthTone : 'rgba(255,255,255,.06)'}
                strokeWidth={pulsing ? 2 : 1} style={{ transition: 'stroke 400ms' }} />

        {/* Hairline concentric rings */}
        <circle cx={cx} cy={cy} r={outerR - 36} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth=".5" />
        <circle cx={cx} cy={cy} r={60} fill="none" stroke="rgba(255,255,255,.04)" strokeWidth=".5" />

        {/* threshold arc (over-threshold zone) */}
        <path d={threshPath} fill="none" stroke="rgba(249,168,212,.35)" strokeWidth="2" strokeLinecap="round" />

        {/* tick marks */}
        {ticks.map(t => (
          <line key={t.ms}
                x1={cx + Math.cos(t.a) * t.r1} y1={cy + Math.sin(t.a) * t.r1}
                x2={cx + Math.cos(t.a) * t.r2} y2={cy + Math.sin(t.a) * t.r2}
                stroke={t.major ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.18)'}
                strokeWidth={t.major ? 1.3 : 0.8} />
        ))}
        {labels.map(ms => {
          const ang = latToAng(ms) * Math.PI / 180;
          const r = outerR - 30;
          return (
            <text key={ms} x={cx + Math.cos(ang) * r} y={cy + Math.sin(ang) * r + 3}
                  textAnchor="middle" fontSize="10" fontFamily="var(--mono)"
                  fill="rgba(255,255,255,.45)" letterSpacing=".1em">{ms}</text>
          );
        })}

        <text x={cx} y={cy - 94} textAnchor="middle" fontSize="9"
              fontFamily="var(--mono)" fill="rgba(255,255,255,.35)" letterSpacing=".3em">QUALITY</text>
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="120" fontWeight="200" fill="#fff"
              fontFamily="'Sora', sans-serif"
              style={{ letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums' }}>
          {score ?? '—'}
        </text>
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize="11"
              fontFamily="var(--mono)" fill={healthTone} letterSpacing=".28em">
          {score == null ? '···' : score >= 85 ? 'EXCELLENT' : score >= 65 ? 'HEALTHY' : score >= 40 ? 'DEGRADED' : 'CRITICAL'}
        </text>
        <text x={cx} y={cy + 46} textAnchor="middle" fontSize="10"
              fontFamily="var(--mono)" fill="rgba(255,255,255,.4)" letterSpacing=".18em">
          LIVE {fmt(liveMedian).toUpperCase()} · {endpoints.length} LINKS
        </text>

        {/* Endpoint orbit ring — dedicated track outside the scale.
            Dial face stays clean; endpoints ride the orbit at their live latency angle.
            Each endpoint gets a small bar with a colored pip; orbit has a hairline track. */}
        {(() => {
          const orbitR = outerR + 4;            // ring radius — just outside scale
          const barInner = orbitR - 3;
          const barOuter = orbitR + 3;
          return (
            <g className="endpoint-orbit">
              {/* Track */}
              <circle cx={cx} cy={cy} r={orbitR} fill="none"
                      stroke="rgba(255,255,255,.06)" strokeWidth="6" />
              <circle cx={cx} cy={cy} r={orbitR} fill="none"
                      stroke="rgba(255,255,255,.1)" strokeWidth=".8" />
              {/* Endpoint markers on the orbit */}
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
                    {/* Short radial bar riding the orbit */}
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                          stroke={ep.color} strokeWidth="2.5" strokeLinecap="round"
                          opacity={over ? 1 : .9} />
                    {/* Pip floating just outside — pulsing when over threshold */}
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

        {/* Hand */}
        {(() => {
          const a = displayHand * Math.PI / 180;
          const tipR = outerR - 10;
          const tailR = 24;
          return (
            <g>
              <line x1={cx - Math.cos(a) * tailR} y1={cy - Math.sin(a) * tailR}
                    x2={cx + Math.cos(a) * tipR} y2={cy + Math.sin(a) * tipR}
                    stroke="#fff" strokeWidth="2.2" strokeLinecap="round" filter="url(#dial-glow)" />
              <circle cx={cx + Math.cos(a) * tipR} cy={cy + Math.sin(a) * tipR} r="4" fill={healthTone} />
            </g>
          );
        })()}
        {/* Central hub */}
        <circle cx={cx} cy={cy} r="8" fill="#0a0812" stroke="rgba(255,255,255,.4)" />
        <circle cx={cx} cy={cy} r="2.5" fill="#fff" />

        {false && <g>
          <circle cx={subCx} cy={subCy} r={subR + 2} fill="none" stroke="rgba(255,255,255,.08)" />
          <circle cx={subCx} cy={subCy} r={subR} fill="#06050c" stroke="rgba(255,255,255,.12)" />
          {Array.from({length: 12}).map((_, i) => {
            const a = (i * 30 - 90) * Math.PI / 180;
            const r1 = subR - (i % 3 === 0 ? 6 : 3), r2 = subR - 1;
            return <line key={i}
              x1={subCx + Math.cos(a)*r1} y1={subCy + Math.sin(a)*r1}
              x2={subCx + Math.cos(a)*r2} y2={subCy + Math.sin(a)*r2}
              stroke={i % 3 === 0 ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.15)'} strokeWidth=".8" />;
          })}
          <text x={subCx} y={subCy - 10} textAnchor="middle" fontSize="7.5"
                fontFamily="var(--mono)" fill="rgba(255,255,255,.35)" letterSpacing=".24em">SAMPLES</text>
          <text x={subCx} y={subCy + 16} textAnchor="middle" fontSize="10"
                fontFamily="var(--mono)" fill="rgba(255,255,255,.5)"
                style={{ fontVariantNumeric: 'tabular-nums' }}>{tick}</text>
          <line x1={subCx} y1={subCy}
                x2={subCx + Math.cos(subHandR) * (subR - 5)}
                y2={subCy + Math.sin(subHandR) * (subR - 5)}
                stroke={running ? '#67e8f9' : 'rgba(255,255,255,.3)'} strokeWidth="1"
                style={{ transition: 'all 400ms cubic-bezier(.2,.9,.3,1.4)' }} />
          <circle cx={subCx} cy={subCy} r="1.5" fill="#fff" />
        </g>}


      </svg>
    </div>
  );
}

function arcPath(cx, cy, r, a0, a1) {
  const a0r = a0 * Math.PI / 180, a1r = a1 * Math.PI / 180;
  const x0 = cx + Math.cos(a0r) * r, y0 = cy + Math.sin(a0r) * r;
  const x1 = cx + Math.cos(a1r) * r, y1 = cy + Math.sin(a1r) * r;
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
}

function SubDial({ ep, data, tick, running, threshold, focused, onClick }) {
  const s = data?.stats;
  const last = data?.last;
  const samples = data?.samples || [];
  const size = 168, cx = size / 2, cy = size / 2, r = 68;

  const latToAng = (ms) => -135 + Math.min(1, Math.max(0, ms / 300)) * 270;
  const [displayAng, setDisplayAng] = React.useState(latToAng(last?.latency ?? 0));
  React.useEffect(() => {
    if (last?.latency == null) return;
    let raf; const target = latToAng(last.latency);
    const step = () => {
      setDisplayAng(prev => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.2) return target;
        return prev + diff * 0.22;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [last?.latency]);

  const health = window.classify(s);
  const hs = window.HEALTH_STYLE[health];

  // tick marks
  const marks = [];
  for (let ms = 0; ms <= 300; ms += 30) {
    const a = latToAng(ms) * Math.PI / 180;
    marks.push({ ms, a, major: ms % 60 === 0 });
  }

  const a = displayAng * Math.PI / 180;

  return (
    <button className={`subdial ${focused ? 'focused' : ''}`} onClick={onClick}
            title={`${ep.label} — click for Live, ⇧-click for Diagnose`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="rgba(255,255,255,.08)" />
        <circle cx={cx} cy={cy} r={r} fill="#0a0812" stroke="rgba(255,255,255,.12)" />
        {marks.map(m => (
          <line key={m.ms}
                x1={cx + Math.cos(m.a) * (r - (m.major ? 7 : 4))} y1={cy + Math.sin(m.a) * (r - (m.major ? 7 : 4))}
                x2={cx + Math.cos(m.a) * (r - 1)} y2={cy + Math.sin(m.a) * (r - 1)}
                stroke={m.major ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.15)'}
                strokeWidth={m.major ? 1 : 0.7} />
        ))}
        {/* health arc */}
        <path d={arcPath(cx, cy, r - 12, -135, -135 + 270 * Math.min(1, (s?.p50 ?? 0) / 300))}
              fill="none" stroke={ep.color} strokeWidth="2" strokeLinecap="round" opacity=".5" />
        {last?.latency != null && (
          <g>
            <line x1={cx} y1={cy} x2={cx + Math.cos(a) * (r - 6)} y2={cy + Math.sin(a) * (r - 6)}
                  stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx={cx + Math.cos(a) * (r - 6)} cy={cy + Math.sin(a) * (r - 6)} r="2.5" fill={ep.color} />
          </g>
        )}
        <circle cx={cx} cy={cy} r="3" fill="#0a0812" stroke="rgba(255,255,255,.35)" />
        <text x={cx} y={cy + 28} textAnchor="middle" fontSize="22" fontWeight="300" fill="#fff"
              fontFamily="'Sora', sans-serif" style={{ letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>
          {s ? fmt(s.p50, { unit: false }) : '—'}
        </text>
        <text x={cx} y={cy + 42} textAnchor="middle" fontSize="10"
              fontFamily="var(--mono)" fill="rgba(255,255,255,.45)" letterSpacing=".2em">P50 · MS</text>
      </svg>
      <div className="subdial-foot">
        <div className="subdial-name" style={{ color: ep.color }}>{ep.label}</div>
        <div className="subdial-url">{ep.url}</div>
        <div className="subdial-stats">
          <span>p95 {s ? fmt(s.p95, { unit: false }) + 'ms' : '—'}</span>
          <span>·</span>
          <span>σ {s ? s.stddev.toFixed(1) : '—'}</span>
          <span>·</span>
          <span style={{ color: hs.color }}>{hs.label}</span>
        </div>
      </div>
    </button>
  );
}

function SectionHeader({ kicker, title, hint }) {
  return (
    <div className="section-header">
      <div>
        <div className="section-kicker">{kicker}</div>
        <div className="section-title">{title}</div>
      </div>
      {hint && <div className="section-hint">{hint}</div>}
    </div>
  );
}

function DiagnosisStrip({ endpoints, statsMap, worstEp, threshold, onDrill }) {
  const statsList = endpoints.map(e => statsMap[e.id]?.stats).filter(Boolean);
  if (!statsList.length) return null;
  const avgP50 = statsList.reduce((a,s)=>a+s.p50,0) / statsList.length;
  const avgLoss = statsList.reduce((a,s)=>a+s.lossPercent,0) / statsList.length;
  const avgJit = statsList.reduce((a,s)=>a+s.stddev,0) / statsList.length;
  const overCount = endpoints.filter(e => (statsMap[e.id]?.stats?.p50 ?? 0) > threshold).length;

  const verdict = (() => {
    if (overCount > 0) return { tone: 'warn', text: `${overCount} endpoint${overCount > 1 ? 's' : ''} above ${fmt(threshold)} threshold` };
    if (avgLoss > 1) return { tone: 'warn', text: `Packet loss elevated (${fmtPct(avgLoss)})` };
    if (avgJit > 25) return { tone: 'warn', text: `Jitter elevated (σ=${avgJit.toFixed(1)}ms)` };
    return { tone: 'good', text: 'All links within tolerance' };
  })();

  return (
    <div className="diagnosis-strip">
      <div className={`diag-verdict diag-${verdict.tone}`}>
        <span className="diag-dot" />
        <span>{verdict.text}</span>
      </div>
      <div className="diag-metrics">
        <DiagMetric label="MEDIAN" value={fmt(avgP50, { unit: false })} unit="ms" />
        <DiagMetric label="JITTER" value={avgJit.toFixed(1)} unit="σ" />
        <DiagMetric label="LOSS" value={avgLoss.toFixed(1)} unit="%" />
        <DiagMetric label="LINKS" value={endpoints.length} unit="active" />
      </div>
      {worstEp && (
        <button className="diag-drill" onClick={() => onDrill(worstEp.ep.id)}>
          <span>Investigate worst link</span>
          <span className="diag-drill-ep" style={{ color: worstEp.ep.color }}>{worstEp.ep.label}</span>
          <span className="diag-drill-arrow">→</span>
        </button>
      )}
    </div>
  );
}

function DiagMetric({ label, value, unit }) {
  return (
    <div className="diag-metric">
      <div className="diag-metric-label">{label}</div>
      <div className="diag-metric-value">
        <span className="diag-metric-num">{value}</span>
        <span className="diag-metric-unit">{unit}</span>
      </div>
    </div>
  );
}

window.OverviewView = OverviewView;
