// src/lib/tokens.ts
// Design token system: primitive → semantic → component.
// This is the ONLY file permitted to contain raw hex/rgba/px/duration values
// as JavaScript literals. ESLint's no-raw-visual-values rule (eslint-rules/)
// enforces this for *.ts files. CSS inside Svelte <style> blocks is enforced
// separately by stylelint (see .stylelintrc.json + .stylelintignore) — that
// rule bans raw hex / rgb / rgba / hsl / hsla in CSS.
//
// Vessel v4 visual language — supersedes Glass Lanes (2026-04-09).
//
// History note: this file dropped a large set of v3-era identity tokens —
// bgBase, shellPanel/shellBorder/etc., t1..t5, cyan*/pink*/amber*/green* (and
// alpha/glow/tone variants), tier2*, nowDotCyan/Pink, thresholdStroke, ep0..ep9
// individual slots, orb*, bgAccent — replaced by the Vessel palette below
// (bg/bg-2..bg-4, fg/fg-2..fg-4, station-A..D, sev-warn/bad/crit, phase-*).
// See proposals/v4/HANDOFF.md and proposals/v4/DIRECTION-v4.md for the why.

// ── Primitive tokens ───────────────────────────────────────────────────────
const primitive = {
  // Backgrounds — warm-black canvas, four tiers (Vessel §01)
  bg:    '#03050A',  // page canvas; cool warm-black, deeper than v3's #04060B
  bg2:   '#080C14',  // card / panel surface; hover states; settings drawer body
  bg3:   '#11171F',  // inset / well surface; form-field backgrounds; scrub-rail
  bg4:   '#1A2230',  // settings drawer raised surface; lightest dark tier

  // Foregrounds — bone-white catalog ink
  fg:    '#F2EBDB',  // primary text + hero numerics — contrast 14.6:1 on bg
  fg2:   '#A39A87',  // secondary text — body copy, descriptions, tag values
  fg3:   '#5F594D',  // tertiary text — mono labels, kickers, axis ticks
  fg4:   '#36322B',  // decorative — section numerals, separator dots, ghosted

  // Rules — bone-white at fixed alphas
  rule:        'rgba(242, 235, 219, 0.06)',
  ruleStrong:  'rgba(242, 235, 219, 0.14)',
  ruleFaint:   'rgba(242, 235, 219, 0.03)',

  // Stations — calibrated to real stellar luminance bands
  stationA: '#B7D3EC',  // Sirius blue-white      — Google     (control reference)
  stationB: '#8CD4C9',  // Vega cyan              — Edge       (also "acquired"/"stable")
  stationC: '#E8D597',  // Sun yellow-white       — AWS        (regional cloud anchor)
  stationD: '#D78E68',  // Betelgeuse red-orange  — Fastly     (second-opinion station)

  // Severity — diagnostic overrides on threshold-cross
  sevWarn:  '#E8C36F',  // above 70% of trigger — watch but no action
  sevBad:   '#D27258',  // over trigger — spiking / dragging / doppler-positive
  sevCrit:  '#B14238',  // timeout / carrier-lost — alarm color across the system

  // Phase decomposition — Resource Timing breakdown (Investigate)
  phaseDns:  '#8CD4C9',  // DNS resolution        (matches stationB hue)
  phaseTcp:  '#B7D3EC',  // TCP handshake         (matches stationA hue)
  phaseTls:  '#A698D8',  // TLS handshake         (violet — new in v4)
  phaseTtfb: '#E8D597',  // Time to first byte    (matches stationC hue)
  phaseXfer: '#D78E68',  // Transfer (payload)    (matches stationD hue)

  // ── Functional infrastructure primitives ────────────────────────────────
  // These don't carry v3 brand identity. Values are updated from pure-white
  // alphas to bone-white alphas so they don't read as cold-white against the
  // warm-black canvas, but their semantic paths and roles are unchanged.
  // Consuming components will be redesigned in Phase B/C; tokens stay until then.

  // Glass surfaces (bone-white alphas — was pure white)
  glassBg:        'rgba(242, 235, 219, 0.03)',
  glassBorder:    'rgba(242, 235, 219, 0.07)',
  glassHighlight: 'rgba(242, 235, 219, 0.12)',

  // Topbar / Footer ambient surfaces
  topbarBg: 'rgba(242, 235, 219, 0.025)',
  footerBg: 'rgba(242, 235, 219, 0.02)',

  // Tooltip surfaces — repointed to bg2/bg3 family
  tooltipBg:     'rgba(8, 12, 20, 0.85)',
  tooltipBgDeep: 'rgba(8, 12, 20, 0.92)',
  tooltipBorder: 'rgba(242, 235, 219, 0.10)',
  tooltipText:   'rgba(242, 235, 219, 0.95)',
  tooltipTextDim:'rgba(242, 235, 219, 0.55)',

  // v2 chronograph dial face / scope canvas / overlay surfaces
  // (consumed by v2 components scheduled for redesign in Phase B/C)
  bgDialFace:    '#141021',
  overlayDeep:   'rgba(8, 12, 20, 0.85)',

  // Rail row surfaces
  glassBgRailHover:    'rgba(242, 235, 219, 0.06)',
  glassBgRailSelected: 'rgba(242, 235, 219, 0.10)',

  // SVG primitives (used by dial, orbit ring, scope grid — v2 components).
  // The "Cyan" suffix on svgGridCyan is preserved for callsite stability;
  // the value is stationB at 5% (was old cyan #67e8f9 at 5%).
  svgGridCyan:   'rgba(140, 212, 201, 0.05)',
  svgGridMajor:  'rgba(242, 235, 219, 0.06)',
  svgTickMinor:  'rgba(242, 235, 219, 0.18)',
  svgTickMajor:  'rgba(242, 235, 219, 0.50)',
  svgHandStroke: '#F2EBDB',
  svgDialRim:    'rgba(242, 235, 219, 0.14)',
  svgOrbitTrack: 'rgba(242, 235, 219, 0.06)',
  svgOrbitEdge:  'rgba(242, 235, 219, 0.10)',
} as const;

// ── Semantic tokens ────────────────────────────────────────────────────────
export const tokens = {
  color: {
    // Surface — page canvas + four bg tiers + border rules
    surface: {
      base:     primitive.bg,
      mid:      primitive.bg2,
      deep:     primitive.bg2,
      raised:   primitive.bg3,
      elevated: primitive.bg4,
      overlay:  'rgba(3, 5, 10, 0.78)',
      dialFace:    primitive.bgDialFace,
      overlayDeep: primitive.overlayDeep,
      border: {
        dim:    primitive.ruleFaint,
        mid:    primitive.rule,
        bright: primitive.ruleStrong,
      },
    },

    // Shell — masthead + panel surface family. Paths preserved for callsite
    // stability; values repointed to bg tiers and bone-white-alpha tints.
    shell: {
      base:           primitive.bg,
      panel:          primitive.bg2,
      panelRaised:    primitive.bg3,
      panelHover:     'rgba(242, 235, 219, 0.055)',
      panelActive:    'rgba(140, 212, 201, 0.095)',
      border:         primitive.rule,
      borderStrong:   primitive.ruleStrong,
      divider:        primitive.rule,
      backdrop:       'rgba(3, 5, 10, 0.92)',
      popover:        'rgba(8, 12, 20, 0.96)',
      bgCyan:         'rgba(140, 212, 201, 0.045)',
      bgAmber:        'rgba(232, 195, 111, 0.028)',
      successBg:      'rgba(140, 212, 201, 0.115)',
      successBorder:  'rgba(140, 212, 201, 0.32)',
      stopBg:         'rgba(215, 142, 104, 0.10)',
      stopBorder:     'rgba(215, 142, 104, 0.28)',
    },

    // Text — fg tiers. Canonical paths only; t1..t5 and primary/secondary/muted
    // aliases were removed in the v4 hard cut. Callsites use fg/fg2/fg3/fg4.
    text: {
      fg:  primitive.fg,
      fg2: primitive.fg2,
      fg3: primitive.fg3,
      fg4: primitive.fg4,
    },

    // Station palette — canonical endpoint identity (v4)
    station: {
      A: primitive.stationA,
      B: primitive.stationB,
      C: primitive.stationC,
      D: primitive.stationD,
    },

    // Severity palette — threshold-cross diagnostic overrides
    severity: {
      warn: primitive.sevWarn,
      bad:  primitive.sevBad,
      crit: primitive.sevCrit,
    },

    // Phase palette — Resource Timing breakdown (was tier2)
    phase: {
      dns:  primitive.phaseDns,
      tcp:  primitive.phaseTcp,
      tls:  primitive.phaseTls,
      ttfb: primitive.phaseTtfb,
      xfer: primitive.phaseXfer,
    },

    // Glass surfaces
    glass: {
      bg:          primitive.glassBg,
      bgStrong:    'rgba(242, 235, 219, 0.045)',
      bgHover:     'rgba(242, 235, 219, 0.07)',
      bgRailHover:    primitive.glassBgRailHover,
      bgRailSelected: primitive.glassBgRailSelected,
      border:      primitive.glassBorder,
      borderHover: primitive.glassHighlight,
      highlight:      primitive.glassHighlight,
      highlightStrong: 'rgba(242, 235, 219, 0.9)',
      shadow:         'rgba(0, 0, 0, 0.15)',
      shadowStrong:   'rgba(0, 0, 0, 0.5)',
      statsBorder:    'rgba(242, 235, 219, 0.04)',
    },

    topbar: { bg: primitive.topbarBg },
    footer: { bg: primitive.footerBg },

    tooltip: {
      bg:      primitive.tooltipBg,
      bgDeep:  primitive.tooltipBgDeep,
      border:  primitive.tooltipBorder,
      text:    primitive.tooltipText,
      textDim: primitive.tooltipTextDim,
    },

    // SVG primitives — chart/dial/scope. Paths preserved; values are
    // bone-white alphas (was pure white). nowDotCyan/nowDotPink/thresholdStroke
    // were retired with the v3 accent palette.
    svg: {
      gridLine:        'rgba(242, 235, 219, 0.03)',
      futureZone:      'rgba(242, 235, 219, 0.018)',
      gridLineCyan:    primitive.svgGridCyan,
      gridLineMajor:   primitive.svgGridMajor,
      tickMinor:       primitive.svgTickMinor,
      tickMajor:       primitive.svgTickMajor,
      handStroke:      primitive.svgHandStroke,
      dialRim:         primitive.svgDialRim,
      orbitTrack:      primitive.svgOrbitTrack,
      orbitEdge:       primitive.svgOrbitEdge,
    },

    // Heatmap ramp — repointed onto the v4 station/severity scale so no
    // anachronistic v3 yellow/orange leaks into screenshots before the
    // consuming component is rewritten in Phase B/C. The duplication on
    // elevated/slow is intentional: both live in the "bad" tier.
    heatmap: {
      fast:     'rgba(140, 212, 201, 0.6)',   // stationB at 60%
      normal:   'rgba(232, 195, 111, 0.5)',   // sevWarn at 50%
      elevated: 'rgba(210, 114, 88, 0.7)',    // sevBad at 70%
      slow:     'rgba(210, 114, 88, 0.85)',   // sevBad at 85% (deeper end of bad tier)
      timeout:  'rgba(177, 66, 56, 0.9)',     // sevCrit at 90%
    },

    // Endpoint palette — 10 cycling slots. First 4 are the canonical stations;
    // 5–10 are spectral extras via oklch(78% 0.13 H) varying hue (per DIRECTION).
    // Stored as oklch() strings — Chronoscope targets modern browsers
    // (oklch supported Chrome 111+, Safari 15.4+, FF 113+).
    endpoint: [
      primitive.stationA,                  // ep0 — Sirius blue-white
      primitive.stationB,                  // ep1 — Vega cyan
      primitive.stationC,                  // ep2 — Sun yellow-white
      primitive.stationD,                  // ep3 — Betelgeuse red-orange
      'oklch(78% 0.13 280)',               // ep4 — violet-purple
      'oklch(78% 0.13 320)',               // ep5 — magenta
      'oklch(78% 0.13 350)',               // ep6 — red-pink
      'oklch(78% 0.13 25)',                // ep7 — coral
      'oklch(78% 0.13 130)',               // ep8 — green
      'oklch(78% 0.13 215)',               // ep9 — blue-teal
    ] as readonly string[],

    // Legacy chrome group — referenced by Settings/Share drawers which are
    // redesigned in Phase C. Repointed to stationB (cyan's v3 "active/focus"
    // role → stationB in v4).
    chrome: {
      border:      primitive.rule,
      borderHover: primitive.ruleStrong,
      borderFocus: primitive.stationB,
      accent:      primitive.stationB,
      accentHover: primitive.fg,
    },

    // Engine state colors. status.timeout/error are rendered visibly in
    // EndpointRow + ScopeCanvas; status.offline/idle have no current consumers
    // but the file is the source of truth so all four are remapped to the v4
    // severity / foreground scale to avoid anachronistic v3 purples.
    status: {
      timeout: primitive.sevCrit,
      error:   primitive.sevBad,
      offline: primitive.fg3,
      success: primitive.stationB,
      idle:    primitive.fg4,
    },
  },

  typography: {
    sans: {
      fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
      weights: { thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 },
    },
    mono: {
      // Space Mono ships only weights 400 and 700. Callsites referencing the
      // dropped thin/light/medium weights will resolve to undefined; the TS
      // pass surfaces and migrates them as part of Phase A.
      fontFamily: "'Space Mono', ui-monospace, SFMono-Regular, monospace",
      weights: { regular: 400, bold: 700 },
    },
    // Scale — per-surface v4 doubling (hero 240–320px, etc.) belongs in
    // Phase C as each surface is composed against the v4 markup.
    heroSize:   54,
    heroWeight: 200,
    statSize:   14,
    statWeight: 300,
    labelSize:  9,
    labelWeight: 300,
    urlSize:    11,
    urlWeight:  300,
    bodySize:   14,
    bodyWeight: 400,
    caption: { size: 9,  weight: 400, opacity: 0.5,  letterSpacing: '0.04em' },
    label:   { size: 11, weight: 500, opacity: 0.58, letterSpacing: '0.06em' },
    body:    { size: 14, weight: 400, opacity: 0.94, letterSpacing: '0' },

    scale: {
      xs:   '10px',
      sm:   '11px',
      md:   '12px',
      base: '13px',
      lg:   '14px',
      xl:   '17px',
      xl2:  '20px',
      xl3:  '24px',
      xxl:  '32px',
    },
    tracking: {
      kicker:  '0.22em',
      label:   '0.14em',
      tight:   '-0.01em',
      display: '-0.03em',
      body:    '0',
    },
  },

  spacing: {
    xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, lg2: 20, xl: 24, xxl: 32, xxxl: 48,
  },

  radius: {
    xs:  4,
    sm:   8,
    md:  12,
    lg:  18,
    btn: 10,
  },

  timing: {
    bgShift:       20000,
    orbFloat:      15000,
    pulse:          2000,
    nowRing:        2000,
    hoverLine:        80,
    hoverTip:        100,
    tooltipDelay:     50,
    fadeIn:          200,
    btnHover:        200,
    domThrottle:     100,
    copiedFeedback: 2000,

    handLerp:        0.15,
    pulseRim:         400,
    pulseDialGlow:    900,
    orbitPulse:      1400,
    traceRepaint:      16,
  },

  easing: {
    decelerate:         'cubic-bezier(0.0, 0.0, 0.2, 1)',
    decelerateSlow:     'cubic-bezier(0.0, 0.0, 0.4, 1)',
    decelerateVerySlow: 'cubic-bezier(0.0, 0.0, 0.6, 1)',
    standard:           'cubic-bezier(0.4, 0.0, 0.2, 1)',
    spring:             'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },

  easingFn: {
    decelerate: (t: number): number => 1 - Math.pow(1 - t, 3),
    standard:   (t: number): number => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  },

  shadow: {
    low:  '0 2px 8px rgba(0, 0, 0, 0.4)',
    high: '0 8px 32px rgba(0, 0, 0, 0.6)',
    popover: '0 18px 60px rgba(0, 0, 0, 0.42)',
  },

  shell: {
    topbarHeight: 60,
    popoverWidth: 280,
    topbarBackdropFilter: 'blur(8px)',
    popoverBackdropFilter: 'blur(12px)',
    brandHighlightShadow: 'inset 0 1px 0 rgba(242, 235, 219, 0.12)',
    navHeight: 48,
    controlSize: 40,
    mobileControlSize: 38,
    contentMaxWidth: 2200,
  },

  lane: {
    chartWindow:    60,
    topbarHeight:   58,
    railWidth:     264,
    xAxisHeight:    30,
    footerHeight:   38,
  },

  breakpoints: { small: 480, mobile: 375, tablet: 768, desktop: 1024, wide: 1440 },
} as const;
