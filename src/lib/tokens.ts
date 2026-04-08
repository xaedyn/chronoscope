// src/lib/tokens.ts
// Design token system: primitive → semantic → component
// This is the ONLY file permitted to contain raw hex/px/duration values.
// ESLint enforces this via no-restricted-syntax.

// ── Primitive tokens ───────────────────────────────────────────────────────
const primitive = {
  // Blues (surface hierarchy)
  ink950: '#080c16',
  ink900: '#0a0e1a',
  ink850: '#0d1425',
  ink800: '#131b33',
  ink750: '#1a2340',
  ink700: '#1e2a4a',
  ink650: '#2d3f6e',

  // Accent
  blue500: '#4a90d9',
  blue400: '#5ba0e9',

  // Latency scale (Viridis-based, CVD-safe)
  cyan300: '#00b4d8',
  cyan400: '#0096c7',
  blue600: '#0077b6',
  lime400: '#90be6d',
  yellow300: '#f9c74f',
  orange400: '#f8961e',
  orange600: '#f3722c',
  red500: '#f94144',

  // Status
  purple500: '#9b5de5',
  purple400: '#c77dff',
  purple700: '#7b2cbf',
  teal400: '#06d6a0',
  slate600: '#4a5568',

  // Tier 2 waterfall
  teal300: '#4ecdc4',
  sky400: '#45b7d1',
  green300: '#96ceb4',
  yellow200: '#ffeaa7',
  slate200: '#dfe6e9',

  // Text
  slate100: '#e2e8f0',
  slate300: '#94a3b8',
  slate400: '#738496',
  ink800text: '#0a0e1a',
  white: '#f1f5f9',

  // Endpoint palette (10 CVD-safe, visually distinct)
  ep1: '#4a90d9',
  ep2: '#e06c75',
  ep3: '#98c379',
  ep4: '#e5c07b',
  ep5: '#c678dd',
  ep6: '#56b6c2',
  ep7: '#d19a66',
  ep8: '#61afef',
  ep9: '#be5046',
  ep10: '#7ec699',
} as const;

// ── Semantic tokens ────────────────────────────────────────────────────────
export const tokens = {
  color: {
    surface: {
      base: primitive.ink950,
      canvas: primitive.ink900,
      raised: primitive.ink850,
      overlay: primitive.ink800,
      elevated: primitive.ink750,
    },
    latency: {
      excellent: primitive.cyan300,
      fast: primitive.cyan400,
      good: primitive.blue600,
      moderate: primitive.lime400,
      elevated: primitive.yellow300,
      slow: primitive.orange400,
      critical: primitive.orange600,
      failing: primitive.red500,
    },
    status: {
      timeout: primitive.purple500,
      error: primitive.purple400,
      offline: primitive.purple700,
      success: primitive.teal400,
      idle: primitive.slate600,
    },
    chrome: {
      border: primitive.ink700,
      borderHover: primitive.ink650,
      borderFocus: primitive.blue500,
      accent: primitive.blue500,
      accentHover: primitive.blue400,
    },
    text: {
      primary: primitive.slate100,
      secondary: primitive.slate300,
      muted: primitive.slate400,
      inverse: primitive.ink800text,
      data: primitive.white,
    },
    tier2: {
      dns: primitive.teal300,
      tcp: primitive.sky400,
      tls: primitive.green300,
      ttfb: primitive.yellow200,
      transfer: primitive.slate200,
    },
    endpoint: [
      primitive.ep1, primitive.ep2, primitive.ep3, primitive.ep4, primitive.ep5,
      primitive.ep6, primitive.ep7, primitive.ep8, primitive.ep9, primitive.ep10,
    ] as readonly string[],
    util: {
      blackOverlay20: 'rgba(0,0,0,0.2)',
      blackOverlay30: 'rgba(0,0,0,0.3)',
      blackOverlay40: 'rgba(0,0,0,0.4)',
      whiteHighlight60: 'rgba(255,255,255,0.6)',
      whiteHighlight80: 'rgba(255,255,255,0.8)',
    },
  },

  spacing: {
    xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
  },

  typography: {
    data: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 500, lineHeight: 1.4 },
    label: { fontFamily: "'Inter', sans-serif", fontSize: 11, fontWeight: 500, lineHeight: 1.3 },
    body: { fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 400, lineHeight: 1.5 },
    heading: { fontFamily: "'Inter', sans-serif", fontSize: 18, fontWeight: 600, lineHeight: 1.3 },
    title: { fontFamily: "'Inter', sans-serif", fontSize: 24, fontWeight: 700, lineHeight: 1.2 },
    stat: { fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 600, lineHeight: 1.1 },
    caption: { fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 400, lineHeight: 1.4 },
  },

  timing: {
    sonarPingFast: 300, sonarPingMedium: 500, sonarPingSlow: 800, sonarPingTimeout: 1200,
    fadeIn: 200, progressiveDisclosure: 250, domThrottle: 100,
    loadingPulse: 2000, loadingRingDuration: 1500,
    dataPointEntry: 200, heatmapCellEntry: 100, copiedFeedback: 2000,
  },

  easing: {
    decelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    decelerateSlow: 'cubic-bezier(0.0, 0.0, 0.4, 1)',
    decelerateVerySlow: 'cubic-bezier(0.0, 0.0, 0.6, 1)',
    standard: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },

  easingFn: {
    decelerate: (t: number): number => 1 - Math.pow(1 - t, 3),
    standard: (t: number): number => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  },

  radius: { sm: 4, md: 8 },

  shadow: {
    low: '0 2px 8px rgba(0,0,0,0.4)',
    high: '0 8px 32px rgba(0,0,0,0.6)',
  },

  canvas: {
    pointRadius: 4,
    pointRadiusHover: 6,
    pointOutlineWidth: 1.5,
    gridLineDash: [4, 8] as readonly number[],
    gridLineOpacity: 0.3,
    axisLineOpacity: 0.6,
    sweepLineOpacity: 0.15,
    sweepLineGlowWidth: 4,
    heatmapCellSize: 8,
    haloRadius: 16,
    haloOpacity: 0.3,
    sonarPing: {
      fast:    { initialRadius: 3, finalRadius: 12, maxConcurrent: 5 },
      medium:  { initialRadius: 3, finalRadius: 20, maxConcurrent: 5 },
      slow:    { initialRadius: 3, finalRadius: 32, maxConcurrent: 3 },
      timeout: { initialRadius: 3, finalRadius: 48, maxConcurrent: 1 },
    },
  },

  breakpoints: { mobile: 375, tablet: 768, desktop: 1024, wide: 1440 },
} as const;

export type Tokens = typeof tokens;
