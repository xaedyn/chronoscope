/* Live — Oscilloscope.
   Phosphor-glow traces with persistence, trigger line, cursor readout,
   split mode, time-range toggle (Strata folds in for long windows).
   Click a trace point → Diagnose for that endpoint. */

function LiveView({ state, dispatch }) {
  const { endpoints, statsMap, tick, running, focusedEpId, threshold, split, timeRange } = state;
  const activeEps = focusedEpId ? endpoints.filter(e => e.id === focusedEpId) : endpoints;

  // Strata fold-in for long windows
  const useStrata = timeRange === '1h' || timeRange === '24h';

  return (
    <div className="live-wrap">
      <LiveHeader state={state} dispatch={dispatch} />
      {useStrata ? (
        <StrataScope endpoints={activeEps} statsMap={statsMap} timeRange={timeRange}
                     threshold={threshold} onDrill={(id) => dispatch({ type: 'drillToDiagnose', value: id })} />
      ) : split ? (
        <div className="scope-stack">
          {activeEps.map(ep => (
            <ScopeCanvas key={ep.id} endpoints={[ep]} statsMap={statsMap}
                         threshold={threshold} onThresholdChange={(v) => dispatch({ type: 'setThreshold', value: v })}
                         onDrill={(id) => dispatch({ type: 'drillToDiagnose', value: id })}
                         height={220} solo />
          ))}
        </div>
      ) : (
        <ScopeCanvas endpoints={activeEps} statsMap={statsMap}
                     threshold={threshold} onThresholdChange={(v) => dispatch({ type: 'setThreshold', value: v })}
                     onDrill={(id) => dispatch({ type: 'drillToDiagnose', value: id })}
                     height={540} />
      )}
      <LiveFooter endpoints={endpoints} statsMap={statsMap} focusedEpId={focusedEpId}
                  onFocus={(id) => dispatch({ type: 'focusEndpoint', value: id })} />
    </div>
  );
}

function LiveHeader({ state, dispatch }) {
  const { threshold, split, timeRange, focusedEpId, endpoints } = state;
  const focused = focusedEpId && endpoints.find(e => e.id === focusedEpId);
  return (
    <div className="live-header">
      <div>
        <div className="live-kicker">LIVE · OSCILLOSCOPE</div>
        <div className="live-title">
          {focused
            ? <>Tracing <span style={{ color: focused.color }}>{focused.label}</span></>
            : <>All endpoints · unified scope</>}
        </div>
      </div>
      <div className="live-controls">
        {focused && (
          <button className="live-chip" onClick={() => dispatch({ type: 'focusEndpoint', value: null })}>
            ← All endpoints
          </button>
        )}
        <div className="live-control">
          <span className="live-control-label">TIME</span>
          <div className="mini-seg">
            {['1m','5m','15m','1h','24h'].map(t => (
              <button key={t} className={timeRange === t ? 'on' : ''}
                      onClick={() => dispatch({ type: 'setTimeRange', value: t })}>{t}</button>
            ))}
          </div>
        </div>
        <div className="live-control">
          <span className="live-control-label">MODE</span>
          <div className="mini-seg">
            <button className={!split ? 'on' : ''} onClick={() => dispatch({ type: 'setSplit', value: false })}>Unified</button>
            <button className={split ? 'on' : ''} onClick={() => dispatch({ type: 'setSplit', value: true })}>Split</button>
          </div>
        </div>
        <div className="live-control">
          <span className="live-control-label">TRIG</span>
          <div className="trig-display">{threshold}<span>ms</span></div>
        </div>
      </div>
    </div>
  );
}

function ScopeCanvas({ endpoints, statsMap, threshold, onThresholdChange, onDrill, height = 540, solo = false }) {
  const W = 1440, H = height * (1440 / 1440); // preserve ratio via viewBox
  const vbH = 640;
  const pad = { t: 24, r: 24, b: 40, l: 56 };
  const plotW = W - pad.l - pad.r;
  const plotH = vbH - pad.t - pad.b;

  const [cursor, setCursor] = React.useState(null); // {x, y}
  const svgRef = React.useRef(null);
  const [drag, setDrag] = React.useState(false);

  // Y scale
  const allMax = Math.max(80, ...endpoints.map(e => (statsMap[e.id]?.stats?.p95 ?? 0) * 1.6));
  const yMax = Math.min(500, Math.max(120, allMax));

  const sampleCount = 120;
  const stepX = plotW / (sampleCount - 1);

  const yToMs = (y) => yMax - ((y - pad.t) / plotH) * yMax;
  const msToY = (ms) => pad.t + (1 - Math.min(ms, yMax) / yMax) * plotH;

  const getPt = (evt) => {
    const svg = svgRef.current; if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * W;
    const y = ((evt.clientY - rect.top) / rect.height) * vbH;
    return { x, y };
  };

  // Y gridlines
  const yTicks = [];
  const step = yMax > 300 ? 100 : yMax > 150 ? 50 : 25;
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  // Build trace per endpoint (with phosphor persistence by fading older segments)
  const traces = endpoints.map(ep => {
    const samples = (statsMap[ep.id]?.samples || []).slice(-sampleCount);
    const pts = samples.map((s, i) => ({
      x: pad.l + (sampleCount - samples.length + i) * stepX,
      y: s.latency == null ? null : msToY(s.latency),
      latency: s.latency,
      lost: s.latency == null,
      round: s.round,
    }));
    return { ep, pts, samples, last: samples[samples.length - 1] };
  });

  // Cursor readout
  let readout = null;
  if (cursor) {
    const idx = Math.round((cursor.x - pad.l) / stepX);
    const ms = yToMs(cursor.y);
    const perEp = traces.map(tr => {
      const p = tr.pts.find(pt => Math.abs(pt.x - (pad.l + idx * stepX)) < stepX / 2);
      return { ep: tr.ep, pt: p };
    });
    readout = { x: pad.l + idx * stepX, ms, perEp, idx };
  }

  return (
    <div className="scope-canvas clean" style={{ height }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${vbH}`} preserveAspectRatio="none"
           onMouseMove={(e) => {
             const pt = getPt(e); if (!pt) return;
             if (drag && onThresholdChange) {
               const ms = Math.max(10, Math.min(yMax, Math.round(yToMs(pt.y) / 5) * 5));
               onThresholdChange(ms);
             }
             setCursor(pt);
           }}
           onMouseLeave={() => { setCursor(null); setDrag(false); }}
           onMouseUp={() => setDrag(false)}>
        <defs>
          <pattern id="scope-grid" width="48" height="40" patternUnits="userSpaceOnUse">
            <path d="M48 0 L0 0 0 40" fill="none" stroke="rgba(103,232,249,.06)" strokeWidth="0.5" />
          </pattern>
          <pattern id="scope-grid-fine" width="12" height="10" patternUnits="userSpaceOnUse">
            <path d="M12 0 L0 0 0 10" fill="none" stroke="rgba(103,232,249,.025)" strokeWidth="0.3" />
          </pattern>
          <filter id="phosphor">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* plot area */}
        <rect x={pad.l} y={pad.t} width={plotW} height={plotH} fill="#05070a" />
        <rect x={pad.l} y={pad.t} width={plotW} height={plotH} fill="url(#scope-grid-fine)" />
        <rect x={pad.l} y={pad.t} width={plotW} height={plotH} fill="url(#scope-grid)" />
        <rect x={pad.l} y={pad.t} width={plotW} height={plotH} fill="none" stroke="rgba(103,232,249,.18)" strokeWidth="1" />

        {/* Y labels & gridlines */}
        {yTicks.map(v => {
          const y = msToY(v);
          return (
            <g key={v}>
              <line x1={pad.l} y1={y} x2={pad.l + plotW} y2={y}
                    stroke="rgba(103,232,249,.08)" strokeDasharray="2 4" />
              <text x={pad.l - 10} y={y + 3} textAnchor="end" fontSize="10"
                    fontFamily="var(--mono)" fill="rgba(103,232,249,.55)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</text>
            </g>
          );
        })}
        <text x={pad.l - 44} y={pad.t + plotH / 2} fontSize="9"
              fontFamily="var(--mono)" fill="rgba(103,232,249,.5)"
              transform={`rotate(-90 ${pad.l - 44} ${pad.t + plotH / 2})`}
              textAnchor="middle" letterSpacing=".24em">LATENCY · MS</text>

        {/* Trigger line (draggable) */}
        {onThresholdChange && (
          <g onMouseDown={() => setDrag(true)} style={{ cursor: 'ns-resize' }}>
            <rect x={pad.l} y={msToY(threshold) - 10} width={plotW} height={20} fill="transparent" />
            <line x1={pad.l} y1={msToY(threshold)} x2={pad.l + plotW} y2={msToY(threshold)}
                  stroke="#fbbf24" strokeWidth="1" strokeDasharray="6 4" opacity=".7" />
            <g transform={`translate(${pad.l + plotW - 60}, ${msToY(threshold) - 10})`}>
              <rect x="0" y="0" width="56" height="20" rx="3" fill="#fbbf24" opacity=".9" />
              <text x="28" y="14" textAnchor="middle" fontSize="10" fontWeight="600"
                    fontFamily="var(--mono)" fill="#1a1406"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>TRIG {threshold}</text>
            </g>
          </g>
        )}

        {/* Phosphor persistence: draw 3 layers - old faded, recent normal, glow tip */}
        {traces.map(tr => {
          if (!tr.pts.length) return null;
          // Split into segments where lost
          const segs = [];
          let cur = [];
          for (const p of tr.pts) {
            if (p.lost) { if (cur.length) { segs.push(cur); cur = []; } }
            else cur.push(p);
          }
          if (cur.length) segs.push(cur);
          const trigViolations = tr.pts.filter(p => !p.lost && p.latency > threshold);
          return (
            <g key={tr.ep.id}>
              {/* area fill (subtle) */}
              {segs.map((seg, si) => {
                if (seg.length < 2) return null;
                const d = `M${seg[0].x},${pad.t + plotH} ` +
                          seg.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
                          ` L${seg[seg.length - 1].x},${pad.t + plotH} Z`;
                return <path key={si} d={d} fill={tr.ep.color} opacity=".06" />;
              })}
              {/* old segment (tail) - faded */}
              {segs.map((seg, si) => {
                if (seg.length < 2) return null;
                const tail = seg.slice(0, Math.floor(seg.length * 0.5));
                if (tail.length < 2) return null;
                const d = tail.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
                return <path key={`tail-${si}`} d={d} fill="none" stroke={tr.ep.color} strokeWidth="1" opacity=".35" />;
              })}
              {/* main trace */}
              {segs.map((seg, si) => {
                if (seg.length < 2) return null;
                const d = seg.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
                return <path key={`main-${si}`} d={d} fill="none" stroke={tr.ep.color} strokeWidth="1.6"
                              filter="url(#phosphor)" opacity=".95" />;
              })}
              {/* loss markers */}
              {tr.pts.filter(p => p.lost).map((p, i) => (
                <line key={i} x1={p.x} y1={pad.t} x2={p.x} y2={pad.t + plotH}
                      stroke="#f9a8d4" strokeWidth="1" strokeDasharray="2 3" opacity=".5" />
              ))}
              {/* trigger violations */}
              {trigViolations.map((p, i) => (
                <circle key={`v${i}`} cx={p.x} cy={p.y} r="2.5" fill="#fbbf24" opacity=".9" />
              ))}
              {/* leading-edge glow */}
              {tr.last && tr.last.latency != null && (() => {
                const lastPt = tr.pts[tr.pts.length - 1];
                return (
                  <g>
                    <circle cx={lastPt.x} cy={lastPt.y} r="6" fill={tr.ep.color} opacity=".25" />
                    <circle cx={lastPt.x} cy={lastPt.y} r="3" fill={tr.ep.color} filter="url(#phosphor)" />
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Cursor crosshair */}
        {cursor && cursor.x > pad.l && cursor.x < pad.l + plotW && cursor.y > pad.t && cursor.y < pad.t + plotH && (
          <g pointerEvents="none">
            <line x1={cursor.x} y1={pad.t} x2={cursor.x} y2={pad.t + plotH}
                  stroke="rgba(255,255,255,.3)" strokeDasharray="3 3" />
            <line x1={pad.l} y1={cursor.y} x2={pad.l + plotW} y2={cursor.y}
                  stroke="rgba(255,255,255,.3)" strokeDasharray="3 3" />
          </g>
        )}

        {/* X axis — time labels */}
        {[0, 30, 60, 90, 119].map(i => {
          const x = pad.l + i * stepX;
          const ago = (sampleCount - 1 - i) * 0.9;
          return (
            <g key={i}>
              <line x1={x} y1={pad.t + plotH} x2={x} y2={pad.t + plotH + 4} stroke="rgba(103,232,249,.3)" />
              <text x={x} y={pad.t + plotH + 16} textAnchor="middle" fontSize="9"
                    fontFamily="var(--mono)" fill="rgba(103,232,249,.5)">
                {i === sampleCount - 1 ? 'NOW' : `-${ago.toFixed(0)}s`}
              </text>
            </g>
          );
        })}

        {solo && endpoints[0] && (
          <text x={pad.l + 10} y={pad.t + 18} fontSize="11"
                fontFamily="var(--mono)" fill={endpoints[0].color} letterSpacing=".2em">
            {endpoints[0].label.toUpperCase()}
          </text>
        )}
      </svg>

      {/* Cursor readout HUD */}
      {readout && (
        <div className="scope-readout" style={{
          left: `calc(${(readout.x / W) * 100}% + 8px)`,
          top: 16,
        }}>
          <div className="scope-readout-time">T{readout.idx < 119 ? `-${((119 - readout.idx) * 0.9).toFixed(1)}s` : ' NOW'}</div>
          <div className="scope-readout-ms">{fmtParts(readout.ms).num}<span>{fmtParts(readout.ms).unit}</span></div>
          <div className="scope-readout-list">
            {readout.perEp.filter(r => r.pt).map(r => (
              <div key={r.ep.id} className="scope-readout-row">
                <span className="scope-readout-pip" style={{ background: r.ep.color }} />
                <span className="scope-readout-name">{r.ep.label}</span>
                <span className="scope-readout-val">
                  {r.pt.lost ? '·lost·' : fmt(r.pt.latency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StrataScope({ endpoints, statsMap, timeRange, threshold, onDrill }) {
  // Long-range: stratified percentile bands per endpoint, stacked
  return (
    <div className="strata-scope">
      <div className="strata-header">
        <span className="strata-kicker">STRATA · Percentile bands over {timeRange}</span>
        <span className="strata-legend">
          <span><span className="strata-sw strata-sw-min" /> min–p50</span>
          <span><span className="strata-sw strata-sw-mid" /> p50–p95</span>
          <span><span className="strata-sw strata-sw-max" /> p95–max</span>
        </span>
      </div>
      <div className="strata-list">
        {endpoints.map(ep => {
          const data = statsMap[ep.id];
          if (!data?.samples?.length) return null;
          return <StrataRow key={ep.id} ep={ep} samples={data.samples}
                            stats={data.stats} threshold={threshold} onDrill={() => onDrill(ep.id)} />;
        })}
      </div>
    </div>
  );
}

function StrataRow({ ep, samples, stats, threshold, onDrill }) {
  const W = 1000, H = 86, pad = 8;
  const plotW = W - pad * 2, plotH = H - pad * 2;
  // bucketize samples into 40 buckets
  const buckets = 40;
  const bucketSize = Math.max(1, Math.floor(samples.length / buckets));
  const rows = [];
  for (let b = 0; b < buckets; b++) {
    const slice = samples.slice(b * bucketSize, (b + 1) * bucketSize).filter(s => s.latency != null).map(s => s.latency);
    if (!slice.length) { rows.push(null); continue; }
    const sorted = [...slice].sort((a,b)=>a-b);
    const min = sorted[0], max = sorted[sorted.length-1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    rows.push({ min, p50, p95, max });
  }
  const yMax = Math.max(80, ...rows.filter(Boolean).map(r => r.max)) * 1.1;
  const stepX = plotW / buckets;
  const msToY = (ms) => pad + (1 - ms / yMax) * plotH;

  // build band polygons
  const pathPair = (key1, key2) => {
    const top = [], bot = [];
    rows.forEach((r, i) => {
      if (!r) return;
      const x = pad + i * stepX + stepX / 2;
      top.push([x, msToY(r[key1])]);
      bot.push([x, msToY(r[key2])]);
    });
    if (!top.length) return '';
    return `M${top.map(p => p.join(',')).join(' L')} L${bot.reverse().map(p => p.join(',')).join(' L')} Z`;
  };

  return (
    <button className="strata-row" onClick={onDrill}>
      <div className="strata-row-label">
        <span className="strata-row-dot" style={{ background: ep.color }} />
        <span className="strata-row-name">{ep.label}</span>
        <span className="strata-row-p">p50 <b>{stats ? fmt(stats.p50, { unit: false }) : '—'}</b>ms</span>
        <span className="strata-row-p">p95 <b>{stats ? fmt(stats.p95, { unit: false }) : '—'}</b>ms</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="strata-row-svg">
        <path d={pathPair('p95', 'max')} fill={ep.color} opacity=".12" />
        <path d={pathPair('p50', 'p95')} fill={ep.color} opacity=".28" />
        <path d={pathPair('min', 'p50')} fill={ep.color} opacity=".55" />
        <line x1={pad} y1={msToY(threshold)} x2={pad + plotW} y2={msToY(threshold)}
              stroke="#fbbf24" strokeWidth=".8" strokeDasharray="4 3" opacity=".7" />
      </svg>
      <span className="strata-row-arrow">→</span>
    </button>
  );
}

function LiveFooter({ endpoints, statsMap, focusedEpId, onFocus }) {
  return (
    <div className="live-footer">
      <div className="live-footer-kicker">FOCUS</div>
      <button className={`live-footer-chip ${!focusedEpId ? 'on' : ''}`}
              onClick={() => onFocus(null)}>All</button>
      {endpoints.map(ep => {
        const s = statsMap[ep.id]?.stats;
        return (
          <button key={ep.id}
                  className={`live-footer-chip ${focusedEpId === ep.id ? 'on' : ''}`}
                  style={focusedEpId === ep.id ? { borderColor: ep.color, color: ep.color } : {}}
                  onClick={() => onFocus(ep.id)}>
            <span className="live-footer-pip" style={{ background: ep.color }} />
            {ep.label}
            <span className="live-footer-val">{s ? fmt(s.p50, { unit: false }) : '—'}</span>
          </button>
        );
      })}
    </div>
  );
}

window.LiveView = LiveView;
