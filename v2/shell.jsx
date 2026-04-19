/* Chronoscope v2 — unified shell.
   Shared across Overview / Live / Diagnose. */

const VIEWS = [
  { id: 'overview', key: '1', label: 'Overview', sub: 'Chronograph',   hint: 'Is everything okay?' },
  { id: 'live',     key: '2', label: 'Live',     sub: 'Oscilloscope',  hint: "What's happening right now?" },
  { id: 'diagnose', key: '3', label: 'Diagnose', sub: 'Atlas',         hint: 'Why is it slow?' },
];

function Shell({ state, dispatch, children }) {
  const { view, running, tick, endpoints, focusedEpId, dataState } = state;
  return (
    <div className="shell">
      <TopBar state={state} dispatch={dispatch} />
      <div className="shell-body">
        <EndpointRail state={state} dispatch={dispatch} />
        <div className="shell-main-wrap">
          <ViewSwitcher view={view} dispatch={dispatch} />
          <main className="shell-main" key={view}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function TopBar({ state, dispatch }) {
  const { running, tick, dataState, threshold } = state;
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" />
            <line x1="12" y1="12" x2="12" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="12" y1="12" x2="17" y2="15" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity=".7" />
          </svg>
        </div>
        <div>
          <div className="brand-name">Chronoscope</div>
          <div className="brand-sub">HTTP latency diagnostic · v2</div>
        </div>
      </div>

      <div className="topbar-divider" />

      <div className="run-status">
        <span className={`run-dot ${running ? 'on' : ''}`} />
        <span className="run-label">{running ? 'Measuring' : 'Halted'}</span>
        <span className="run-tick">T+{String(tick).padStart(4, '0')}</span>
      </div>

      <div className="spacer" />

      <div className="mini-seg" title="Simulate network condition">
        {['healthy','mixed','degraded'].map(s => (
          <button key={s} className={dataState === s ? 'on' : ''}
                  onClick={() => dispatch({ type: 'setDataState', value: s })}>
            {s[0].toUpperCase()}
          </button>
        ))}
      </div>

      <button className="icon-btn" onClick={() => dispatch({ type: 'reset' })} title="Reset samples">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 4v6h6" />
          <path d="M20 20v-6h-6" />
          <path d="M4 10a8 8 0 0 1 14-3" />
          <path d="M20 14a8 8 0 0 1-14 3" />
        </svg>
      </button>

      <button className="icon-btn" onClick={() => dispatch({ type: 'toggleTweaks' })} title="Tweaks">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <button className={`run-btn ${running ? 'stop' : 'start'}`}
              onClick={() => dispatch({ type: 'toggleRunning' })}>
        {running ? (
          <><span className="run-btn-icon">■</span> Halt</>
        ) : (
          <><span className="run-btn-icon">▶</span> Start</>
        )}
      </button>
    </header>
  );
}

function ViewSwitcher({ view, dispatch }) {
  return (
    <nav className="view-switcher">
      {VIEWS.map(v => (
        <button key={v.id}
                className={`view-tab ${view === v.id ? 'active' : ''}`}
                onClick={() => dispatch({ type: 'setView', value: v.id })}>
          <span className="view-tab-key">{v.key}</span>
          <span className="view-tab-body">
            <span className="view-tab-label">{v.label}</span>
            <span className="view-tab-sub">{v.hint}</span>
          </span>
        </button>
      ))}
      <div className="view-switcher-trailing">
        <span className="kbd">⌨ 1·2·3</span>
      </div>
    </nav>
  );
}

function EndpointRail({ state, dispatch }) {
  const { endpoints, statsMap, focusedEpId, view } = state;
  return (
    <aside className="endpoint-rail">
      <div className="rail-header">
        <span className="rail-title">Endpoints</span>
        <span className="rail-count">{endpoints.length}</span>
      </div>
      <div className="rail-list">
        {endpoints.map(ep => {
          const s = statsMap[ep.id]?.stats;
          const last = statsMap[ep.id]?.last;
          const health = window.classify(s);
          const hs = window.HEALTH_STYLE[health];
          const focused = focusedEpId === ep.id;
          return (
            <button key={ep.id}
                    className={`rail-row ${focused ? 'focused' : ''}`}
                    onClick={() => dispatch({ type: 'focusEndpoint', value: ep.id })}
                    onDoubleClick={() => dispatch({ type: 'drillToLive', value: ep.id })}>
              <span className="rail-pip" style={{ background: hs.color, boxShadow: `0 0 8px ${hs.color}88` }} />
              <span className="rail-row-body">
                <span className="rail-row-label">{ep.label}</span>
                <span className="rail-row-url">{ep.url}</span>
              </span>
              <span className="rail-row-metric">
                {(() => {
                  const p = s ? fmtParts(s.p50) : { num: '—', unit: 'ms' };
                  return <>
                    <span className="rail-row-p50" style={{ color: ep.color }}>{p.num}</span>
                    <span className="rail-row-unit">{p.unit || 'ms'}</span>
                  </>;
                })()}
              </span>
            </button>
          );
        })}
      </div>
      <div className="rail-footer">
        <button className="rail-add" onClick={() => dispatch({ type: 'noop' })}>+ Add endpoint</button>
      </div>
    </aside>
  );
}

Object.assign(window, { Shell, VIEWS });
