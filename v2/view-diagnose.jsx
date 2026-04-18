/* Diagnose — Atlas.
   Waterfall hero showing per-phase breakdown. P50 vs P95 toggle.
   Anomaly callouts when a phase is disproportionate. Endpoint picker left rail. */

function DiagnoseView({ state, dispatch }) {
  const { endpoints, statsMap, focusedEpId, tick } = state;
  const [mode, setMode] = React.useState('p95');
  const ep = focusedEpId ? endpoints.find(e => e.id === focusedEpId) : endpoints[0];
  const data = statsMap[ep?.id];

  return (
    <div className="diagnose-wrap">
      <div className="diagnose-main">
        <div className="diagnose-header">
          <div>
            <div className="diagnose-kicker">DIAGNOSE · ATLAS · REQUEST WATERFALL</div>
            <div className="diagnose-title">
              <span style={{ color: ep?.color }}>{ep?.label || '—'}</span>
              <span className="diagnose-title-url">{ep?.url}</span>
            </div>
            {!focusedEpId && (
              <div className="diagnose-hint">
                Select an endpoint from the left rail to diagnose a specific link.
              </div>
            )}
          </div>
          <div className="diagnose-actions">
            <div className="mini-seg">
              <button className={mode === 'p50' ? 'on' : ''} onClick={() => setMode('p50')}>P50 · typical</button>
              <button className={mode === 'p95' ? 'on' : ''} onClick={() => setMode('p95')}>P95 · worst</button>
            </div>
            <button className="live-chip" onClick={() => dispatch({ type: 'setView', value: 'live' })}>
              ← Back to Live
            </button>
          </div>
        </div>

        {ep && data ? (
          <Waterfall ep={ep} data={data} mode={mode} tick={tick} />
        ) : (
          <div className="diagnose-empty">Select an endpoint to diagnose.</div>
        )}
      </div>
    </div>
  );
}

function Waterfall({ ep, data, mode, tick }) {
  const samples = data.samples || [];
  const withTier2 = samples.filter(s => s.tier2).slice(-24);

  if (!withTier2.length) {
    return (
      <div className="diagnose-empty">
        No tier-2 breakdown available for this endpoint.
        <div style={{ fontSize: 11, opacity: .6, marginTop: 6 }}>
          Legacy endpoints only report aggregate latency.
        </div>
      </div>
    );
  }

  // Compute reference waterfall
  const refSample = mode === 'p50'
    ? medianTier2(withTier2)
    : p95Tier2(withTier2);

  const total = refSample.dns + refSample.tcp + refSample.tls + refSample.ttfb + refSample.transfer;
  const phases = [
    { key: 'dns',      label: 'DNS',      color: '#86efac', ms: refSample.dns },
    { key: 'tcp',      label: 'TCP',      color: '#67e8f9', ms: refSample.tcp },
    { key: 'tls',      label: 'TLS',      color: '#c4b5fd', ms: refSample.tls },
    { key: 'ttfb',     label: 'TTFB',     color: '#fbbf24', ms: refSample.ttfb },
    { key: 'transfer', label: 'Transfer', color: '#f9a8d4', ms: refSample.transfer },
  ];

  // Anomaly detection: any phase that's > 2x its typical share
  const baseline = medianTier2(withTier2);
  const baselineTotal = baseline.dns + baseline.tcp + baseline.tls + baseline.ttfb + baseline.transfer;
  const anomalies = phases.map(p => {
    const expectedShare = baseline[p.key] / baselineTotal;
    const actualShare = p.ms / total;
    return {
      key: p.key,
      ratio: actualShare / Math.max(0.01, expectedShare),
      delta: p.ms - baseline[p.key],
    };
  });
  const worstAnomaly = anomalies.filter(a => a.ratio > 1.5).sort((x, y) => y.ratio - x.ratio)[0];

  return (
    <div className="waterfall-hero">
      <HeroWaterfall phases={phases} total={total} mode={mode} worstAnomaly={worstAnomaly} />
      <VerdictCard ep={ep} total={total} mode={mode} phases={phases} worstAnomaly={worstAnomaly} baseline={baseline} />
      <SampleStrip samples={withTier2} />
    </div>
  );
}

function HeroWaterfall({ phases, total, mode, worstAnomaly }) {
  let acc = 0;
  const W = 1100;
  const barH = 48;
  return (
    <div className="hero-wf">
      <div className="hero-wf-kicker">
        {mode === 'p50' ? 'TYPICAL REQUEST (p50)' : 'WORST 5% OF REQUESTS (p95)'} · TOTAL {fmt(total)}
      </div>
      <div className="hero-wf-scale">
        <span>0</span><span>{fmt(total * 0.25, { unit: false })}</span><span>{fmt(total * 0.5, { unit: false })}</span>
        <span>{fmt(total * 0.75, { unit: false })}</span><span>{fmt(total)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${barH + 60}`} className="hero-wf-svg">
        {phases.map(p => {
          const x = (acc / total) * W;
          const w = (p.ms / total) * W;
          acc += p.ms;
          const isAnomaly = worstAnomaly?.key === p.key;
          return (
            <g key={p.key}>
              <rect x={x} y={20} width={Math.max(2, w - 2)} height={barH}
                    fill={p.color} opacity={isAnomaly ? 1 : .78} rx="2" />
              {isAnomaly && (
                <rect x={x - 1} y={19} width={Math.max(2, w - 2) + 2} height={barH + 2}
                      fill="none" stroke="#fbbf24" strokeWidth="1.5" rx="3" />
              )}
              {w > 36 && (
                <>
                  <text x={x + 8} y={40} fontSize="11" fontFamily="var(--mono)"
                        fill="#0a0812" fontWeight="600" letterSpacing=".08em">{p.label}</text>
                  <text x={x + 8} y={58} fontSize="11" fontFamily="var(--mono)"
                        fill="#0a0812" opacity=".85" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(p.ms)}
                  </text>
                </>
              )}
              {w <= 36 && (
                <text x={x + w / 2} y={barH + 36} textAnchor="middle" fontSize="10"
                      fontFamily="var(--mono)" fill={p.color} letterSpacing=".14em">
                  {p.label} {fmt(p.ms, { unit: false })}
                </text>
              )}
            </g>
          );
        })}
        {/* tick marks */}
        {[0, .25, .5, .75, 1].map(f => (
          <line key={f} x1={f * W} y1={14} x2={f * W} y2={20}
                stroke="rgba(255,255,255,.3)" strokeWidth=".8" />
        ))}
      </svg>
    </div>
  );
}

function VerdictCard({ ep, total, mode, phases, worstAnomaly, baseline }) {
  let verdict;
  if (worstAnomaly && worstAnomaly.ratio > 2) {
    const phase = phases.find(p => p.key === worstAnomaly.key);
    verdict = {
      tone: 'warn',
      title: `${phase.label} phase is ${worstAnomaly.ratio.toFixed(1)}× typical`,
      body: `In the ${mode === 'p95' ? 'slowest 5%' : 'typical'} requests, ${phase.label.toLowerCase()} consumes ${fmt(phase.ms)} vs. the usual ${fmt(baseline[worstAnomaly.key])}. This localizes the problem to the ${explainPhase(worstAnomaly.key)}.`,
      advice: adviceFor(worstAnomaly.key),
    };
  } else {
    verdict = {
      tone: 'good',
      title: 'No phase dominates',
      body: `The ${mode === 'p95' ? 'worst-case' : 'typical'} waterfall is proportionally balanced. Total budget ${fmt(total)} is distributed across phases as expected.`,
      advice: 'If total latency is above target, consider CDN edge closer to user or connection reuse (keep-alive).',
    };
  }

  return (
    <div className={`verdict verdict-${verdict.tone}`}>
      <div className="verdict-head">
        <span className="verdict-dot" />
        <span className="verdict-kicker">DIAGNOSIS</span>
      </div>
      <div className="verdict-title">{verdict.title}</div>
      <div className="verdict-body">{verdict.body}</div>
      <div className="verdict-advice">
        <span className="verdict-advice-kicker">SUGGESTED</span>
        <span>{verdict.advice}</span>
      </div>
    </div>
  );
}

function SampleStrip({ samples }) {
  return (
    <div className="sample-strip">
      <div className="sample-strip-head">
        <span>RECENT REQUESTS · {samples.length}</span>
        <span className="sample-strip-legend">
          <span><span className="strata-sw" style={{background:'#86efac'}}/>DNS</span>
          <span><span className="strata-sw" style={{background:'#67e8f9'}}/>TCP</span>
          <span><span className="strata-sw" style={{background:'#c4b5fd'}}/>TLS</span>
          <span><span className="strata-sw" style={{background:'#fbbf24'}}/>TTFB</span>
          <span><span className="strata-sw" style={{background:'#f9a8d4'}}/>XFER</span>
        </span>
      </div>
      <div className="sample-strip-rows">
        {samples.slice(-16).reverse().map((s, i) => {
          const total = s.tier2.dns + s.tier2.tcp + s.tier2.tls + s.tier2.ttfb + s.tier2.transfer;
          const parts = [
            { val: s.tier2.dns, c: '#86efac' },
            { val: s.tier2.tcp, c: '#67e8f9' },
            { val: s.tier2.tls, c: '#c4b5fd' },
            { val: s.tier2.ttfb, c: '#fbbf24' },
            { val: s.tier2.transfer, c: '#f9a8d4' },
          ];
          return (
            <div key={s.round} className="sample-strip-row">
              <span className="sample-strip-round">#{String(s.round).padStart(4,'0')}</span>
              <div className="sample-strip-bar">
                {parts.map((p, pi) => (
                  <div key={pi} style={{
                    width: `${(p.val / total) * 100}%`,
                    background: p.c,
                    minWidth: 1,
                  }} />
                ))}
              </div>
              <span className="sample-strip-total">{fmtParts(total).num}<span>{fmtParts(total).unit}</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// helpers
function medianTier2(samples) {
  const keys = ['dns','tcp','tls','ttfb','transfer'];
  const out = {};
  for (const k of keys) {
    const sorted = samples.map(s => s.tier2[k]).sort((a,b)=>a-b);
    out[k] = sorted[Math.floor(sorted.length / 2)];
  }
  return out;
}
function p95Tier2(samples) {
  const keys = ['dns','tcp','tls','ttfb','transfer'];
  const out = {};
  for (const k of keys) {
    const sorted = samples.map(s => s.tier2[k]).sort((a,b)=>a-b);
    out[k] = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
  }
  return out;
}
function explainPhase(k) {
  return {
    dns: 'DNS resolver or nameserver chain',
    tcp: 'TCP handshake / network path RTT',
    tls: 'TLS negotiation (certificate chain / cipher)',
    ttfb: 'server-side processing (time-to-first-byte)',
    transfer: 'payload transfer (bandwidth or body size)',
  }[k] || k;
}
function adviceFor(k) {
  return {
    dns: 'Consider DNS caching, a faster resolver (e.g. 1.1.1.1), or DoH.',
    tcp: 'Route or transit issue — trace the path. Consider connection pooling.',
    tls: 'TLS 1.3 + session resumption + smaller cert chain.',
    ttfb: 'Server-side bottleneck. Profile the handler or add caching.',
    transfer: 'Compress payload, paginate, or move closer to the user (CDN).',
  }[k] || 'Investigate.';
}

window.DiagnoseView = DiagnoseView;
