# Token additions — `src/lib/tokens.ts`

The existing `tokens.ts` is the authoritative source of visual values. **No other file in the codebase may declare raw colors, durations, radii, or spacing.** Every new view must pull through tokens.

This doc lists only the **new or modified** tokens. Existing ones (tier2 palette, endpoint palette, spacing, timing) are reused as-is.

## 1. Color — new accents

The prototype introduces amber as a "degraded" tone. Existing tokens have cyan (healthy) and pink (unhealthy) but no mid tone.

```ts
// Extend tokens.color.accent
accent: {
  cyan:       '#67e8f9',
  cyanGlow:   '#67e8f955',
  cyanTone:   '#3aa7b8',

  amber:      '#fbbf24',     // NEW
  amberGlow:  '#fbbf2455',   // NEW
  amberTone:  '#b38410',     // NEW

  pink:       '#f9a8d4',
  pinkGlow:   '#f9a8d455',
  pinkTone:   '#b0628a',

  green:      '#4ade80',
  greenGlow:  '#4ade8055',
  // ... existing
},
```

## 2. Color — surface depth

The prototype uses a deeper "dial face" background. Add:

```ts
surface: {
  base:      '#0b0814',
  raised:    '#1a1528',
  elevated:  '#241e36',
  overlay:   'rgba(11, 8, 20, 0.85)',
  deep:      '#141021',   // NEW — used inside dial face & scope canvas background
  border: {
    dim:     'rgba(255, 255, 255, 0.08)',
    bright:  'rgba(255, 255, 255, 0.14)',   // NEW — selected states
  },
},
```

## 3. Color — glass variants

The rail focus state needs a stronger glass:

```ts
glass: {
  bg:          'rgba(255, 255, 255, 0.04)',
  bgHover:     'rgba(255, 255, 255, 0.06)',   // NEW
  bgStrong:    'rgba(255, 255, 255, 0.10)',   // NEW — selected row
  border:      'rgba(255, 255, 255, 0.08)',
  highlight:   'rgba(255, 255, 255, 0.14)',
},
```

## 4. Color — SVG primitives

Hairline strokes used by the dial and scope. Already scattered through the prototype; centralize:

```ts
svg: {
  gridLine:          'rgba(103, 232, 249, 0.05)',
  gridLineMajor:     'rgba(255, 255, 255, 0.06)',
  tickMinor:         'rgba(255, 255, 255, 0.18)',
  tickMajor:         'rgba(255, 255, 255, 0.50)',
  thresholdStroke:   '#f9a8d4',
  handStroke:        '#ffffff',
  dialRim:           'rgba(255, 255, 255, 0.14)',
  orbitTrack:        'rgba(255, 255, 255, 0.06)',
  orbitEdge:         'rgba(255, 255, 249, 0.10)',
},
```

## 5. Color — tooltip surface

The scope tooltip stacks above everything; treat it as its own surface:

```ts
tooltip: {
  bg:       'rgba(10, 9, 18, 0.92)',
  border:   'rgba(255, 255, 255, 0.10)',
  text:     'rgba(255, 255, 255, 0.95)',
  textDim:  'rgba(255, 255, 255, 0.55)',
},
```

## 6. Color — tier2 (reuse existing, add labelText)

Existing palette keeps its values. Add:

```ts
tier2: {
  dns:        '#67e8f9',    // existing
  tcp:        '#a5b4fc',    // existing
  tls:        '#f9a8d4',    // existing
  ttfb:       '#fbbf24',    // existing
  transfer:   '#4ade80',    // existing
  labelText:  'rgba(0, 0, 0, 0.75)',  // NEW — for labels inside light phase segments
},
```

## 7. Typography — scale token

The prototype uses explicit sizes per element. Consolidate into a scale so the new views can refer to named sizes instead of px literals:

```ts
typography: {
  sans:  { fontFamily: "'Geist', system-ui, -apple-system, sans-serif" },
  mono:  { fontFamily: "'Geist Mono', 'JetBrains Mono', monospace" },
  scale: {   // NEW
    xs:  '9px',   // chip labels, metadata kickers
    sm:  '10px',  // rail url, axis labels, severity chips
    md:  '11.5px', // rail label, segment labels
    lg:  '14px',  // rail metric, sub-metric numbers
    xl:  '18px',  // verdict title
    xxl: '32px',  // overview triptych values
  },
  tracking: {  // NEW — letter-spacing defaults
    kicker: '0.18em',
    label:  '0.08em',
    body:   '0',
  },
},
```

Also expose these as CSS custom properties in `App.svelte`'s `bridgeTokensToCss`:

```ts
root.style.setProperty('--ts-xs',  tokens.typography.scale.xs);
root.style.setProperty('--ts-sm',  tokens.typography.scale.sm);
root.style.setProperty('--ts-md',  tokens.typography.scale.md);
root.style.setProperty('--ts-lg',  tokens.typography.scale.lg);
root.style.setProperty('--ts-xl',  tokens.typography.scale.xl);
root.style.setProperty('--ts-xxl', tokens.typography.scale.xxl);
root.style.setProperty('--tr-kicker', tokens.typography.tracking.kicker);
root.style.setProperty('--tr-label',  tokens.typography.tracking.label);
```

## 8. Timing — new motion primitives

```ts
timing: {
  fadeIn:        150,   // existing
  loadingPulse: 1800,   // existing
  btnHover:      120,   // existing

  handLerp:        0.15, // NEW — dial hand smoothing factor (per-frame)
  pulseRim:        400,  // NEW — dial rim pulse on threshold cross
  orbitPulse:     1400,  // NEW — orbit pip pulse when over threshold
  traceRepaint:    16,   // NEW — scope canvas repaint throttle (ms)
},
```

## 9. Lane constants — reuse

`tokens.lane.chartWindow`, `chartPaddingX`, `chartPaddingY` already exist for the lane chart. ScopeCanvas reuses them unchanged — do not add new "scope window" tokens.
