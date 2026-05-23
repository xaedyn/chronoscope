<!-- src/lib/components/LandingView.svelte -->
<!-- Vessel v4 LANDING surface. Marketing/onboarding entrypoint shown only on    -->
<!-- truly first visit (no chronoscope-onboarded flag in localStorage, engine    -->
<!-- still in 'idle' lifecycle, roundCounter 0). Once the user clicks Begin     -->
<!-- (which calls onStart) or Explore (which calls navigateTo+onStart), the    -->
<!-- onboarded flag is set and they never see this surface again on this device. -->
<!--                                                                              -->
<!-- Source of truth: proposals/v4/index.html (1461 lines). Markup and CSS are   -->
<!-- copied verbatim where possible; raw hex/rgba in the prototype are replaced  -->
<!-- with the v4 CSS vars already bridged from tokens by App.svelte.             -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { tokens } from '$lib/tokens';
  import { navigateTo } from '$lib/router';

  let { onStart, onExplore }: { onStart?: () => void; onExplore?: () => void } = $props();

  // ── Onboarding gate (write side) ────────────────────────────────────────────
  // The READ side of this gate lives in App.svelte's $derived showLanding flag.
  // Both Begin and Explore mark the user as onboarded so they never see Landing
  // again on this device.
  function markOnboarded(): void {
    try {
      localStorage.setItem('chronoscope-onboarded', 'true');
    } catch {
      // localStorage may be unavailable (private mode, quota). The landing
      // simply re-shows on the next visit; not catastrophic.
    }
  }

  function handleBegin(event: MouseEvent): void {
    event.preventDefault();
    markOnboarded();
    onStart?.();
  }

  function handleExplore(event: MouseEvent): void {
    event.preventDefault();
    markOnboarded();
    // Navigate into the app shell without starting measurements. The cold-visit
    // surface (built by a separate agent) covers the empty-overview state.
    navigateTo({ name: 'overview', endpointId: null });
    onExplore?.();
  }

  function handleNav(event: MouseEvent, route: 'overview' | 'live' | 'investigate' | 'report'): void {
    event.preventDefault();
    markOnboarded();
    navigateTo({ name: route, endpointId: null });
    onExplore?.();
  }

  // ── Hero Three.js scene ────────────────────────────────────────────────────
  // Decorative-only; no measurement data. Reproduces the prototype's hero
  // composition: starfield + 4 concentric orbital rings + home halo + drifting
  // pulses on each ring + camera parallax. Mirrors lines ~996–1175 of the v4
  // prototype.
  const STATION_COLORS = [
    tokens.color.station.A,
    tokens.color.station.B,
    tokens.color.station.C,
    tokens.color.station.D,
  ];
  const PULSES_PER_STATION = 24;
  const RADII = [7, 9.5, 12, 14.5];

  // ── Static iteration constants for SVG previews (typed indices) ─────────────
  // The v4 preview SVGs iterate 8 / 10 / 6 / 12 / 5 times. Pre-built arrays
  // [0,1,...,n-1] give each {#each} a stable index-as-key and dodge the
  // "Each block should have a key" lint without manufacturing wrapper objects.
  const RANGE_6 = [0, 1, 2, 3, 4, 5] as const;
  const RANGE_8 = [0, 1, 2, 3, 4, 5, 6, 7] as const;
  const RANGE_10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  const RANGE_12 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
  const OVERVIEW_RADII = [60, 80, 100, 120] as const;
  const LIVE_RADII = [40, 60, 85, 110] as const;
  const REPORT_RADII = [50, 75, 100, 125] as const;
  const STEP_RADII = [10, 18, 26, 32] as const;
  const PROBE_YS = [10, 25, 45, 60] as const;
  const STEPS = [0, 1, 2, 3] as const;
  const PULSE_YS = [12, 22, 32, 42, 52] as const;
  const POLAR_FRACTIONS = [0.33, 0.66, 1.0] as const;
  type PercentileRow = readonly [label: string, value: string, severity: '' | 'warn' | 'bad' | 'crit'];
  const PERCENTILES: readonly PercentileRow[] = [
    ['p50', '34', ''],
    ['p75', '52', 'warn'],
    ['p90', '74', 'bad'],
    ['p95', '92', 'bad'],
    ['p99', '142', 'crit'],
  ];

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let stageEl = $state<HTMLElement | null>(null);

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let rafId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mouseHandler: ((e: MouseEvent) => void) | null = null;
  const pulseGroups: Array<{
    points: THREE.Points;
    positions: Float32Array;
    phases: Float32Array;
    r: number;
    speed: number;
  }> = [];
  let homeHalo: THREE.Mesh | null = null;

  function resizeScene(): void {
    if (!renderer || !camera || !stageEl) return;
    const w = stageEl.clientWidth;
    const h = stageEl.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function buildStars(): THREE.Points {
    const N = 3000;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = 60 + Math.random() * 80;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) - 10;
      positions[i * 3 + 2] = r * Math.cos(phi);
      const w = 0.7 + Math.random() * 0.3;
      colors[i * 3] = w * 0.95;
      colors[i * 3 + 1] = w * 0.92;
      colors[i * 3 + 2] = w * 0.85;
      sizes[i] = Math.random() < 0.04 ? 2.0 + Math.random() * 1.4 : 0.3 + Math.random() * 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * 240.0 / -mv.z;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          float h = smoothstep(0.5, 0.15, d) * 0.35;
          gl_FragColor = vec4(vColor, a * 0.95 + h);
        }
      `,
    });
    return new THREE.Points(g, m);
  }

  function buildScene(): void {
    if (!canvasEl) return;

    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    const localScene = new THREE.Scene();
    scene = localScene;
    camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    camera.position.set(0, 18, 30);
    camera.lookAt(0, 0, 0);

    localScene.add(buildStars());

    // Orbital rings
    RADII.forEach((r) => {
      const ringG = new THREE.RingGeometry(r - 0.04, r + 0.04, 256);
      const ringM = new THREE.MeshBasicMaterial({
        color: 0xf2ebdb,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringG, ringM);
      ring.rotation.x = -Math.PI / 2;
      localScene.add(ring);
    });

    // Home station + halo
    const homeG = new THREE.SphereGeometry(0.22, 24, 24);
    const homeM = new THREE.MeshBasicMaterial({ color: 0xf2ebdb });
    scene.add(new THREE.Mesh(homeG, homeM));

    const homeHaloG = new THREE.SphereGeometry(0.9, 24, 24);
    const homeHaloM = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vEye;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vEye = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vEye;
        uniform float uTime;
        void main() {
          float rim = 1.0 - max(dot(vN, vEye), 0.0);
          rim = pow(rim, 1.8);
          float p = 0.85 + 0.15 * sin(uTime * 0.0015);
          gl_FragColor = vec4(0.95, 0.92, 0.85, rim * 0.75 * p);
        }
      `,
    });
    homeHalo = new THREE.Mesh(homeHaloG, homeHaloM);
    localScene.add(homeHalo);

    // Pulse groups (4 stations × 24 each)
    RADII.forEach((r, idx) => {
      const positions = new Float32Array(PULSES_PER_STATION * 3);
      const colors = new Float32Array(PULSES_PER_STATION * 3);
      const sizes = new Float32Array(PULSES_PER_STATION);
      const phases = new Float32Array(PULSES_PER_STATION);
      const c = new THREE.Color(STATION_COLORS[idx]);
      for (let i = 0; i < PULSES_PER_STATION; i++) {
        phases[i] = (i / PULSES_PER_STATION) * Math.PI * 2;
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        sizes[i] = 0.085;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float aSize;
          varying vec3 vColor;
          uniform float uTime;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * 3400.0 / max(0.1, -mv.z);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            float core = smoothstep(0.10, 0.0, d) * 1.6;
            float halo = exp(-d * 5.0) * 1.05;
            float ring = smoothstep(0.34, 0.28, d) * smoothstep(0.44, 0.36, d) * 0.45;
            gl_FragColor = vec4(vColor, core + halo + ring);
          }
        `,
      });
      const points = new THREE.Points(g, m);
      points.frustumCulled = false;
      localScene.add(points);
      pulseGroups.push({ points, positions, phases, r, speed: 0.00015 * (1 + idx * 0.08) });
    });
  }

  let cameraAngle = 0;
  let mTX = 0;
  let mTY = 0;
  let mX = 0;
  let mY = 0;
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(now: number): void {
    if (!renderer || !scene || !camera) return;
    if (!reducedMotion) {
      cameraAngle += 0.00004;
      mX += (mTX - mX) * 0.045;
      mY += (mTY - mY) * 0.045;
      camera.position.x = Math.sin(cameraAngle) * 4 + mX * 2.5;
      camera.position.y = 18 - mY * 1.2;
      camera.position.z = 30 + Math.cos(cameraAngle) * 3;
      camera.lookAt(0, 0, 0);
    }

    for (const g of pulseGroups) {
      const p = g.positions;
      for (let i = 0; i < PULSES_PER_STATION; i++) {
        const angle = g.phases[i] + now * g.speed;
        p[i * 3] = g.r * Math.cos(angle);
        p[i * 3 + 1] = 0;
        p[i * 3 + 2] = g.r * Math.sin(angle);
      }
      g.points.geometry.attributes.position.needsUpdate = true;
    }

    if (homeHalo) {
      const mat = homeHalo.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = now;
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  onMount(() => {
    buildScene();
    resizeScene();
    rafId = requestAnimationFrame(frame);

    if (typeof ResizeObserver !== 'undefined' && stageEl) {
      resizeObserver = new ResizeObserver(() => resizeScene());
      resizeObserver.observe(stageEl);
    } else {
      window.addEventListener('resize', resizeScene);
    }

    mouseHandler = (e: MouseEvent): void => {
      mTX = (e.clientX / window.innerWidth - 0.5) * 2;
      mTY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('mousemove', mouseHandler);
  });

  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    if (mouseHandler) window.removeEventListener('mousemove', mouseHandler);
    window.removeEventListener('resize', resizeScene);
    for (const g of pulseGroups) {
      g.points.geometry.dispose();
      (g.points.material as THREE.Material).dispose();
    }
    pulseGroups.length = 0;
    if (homeHalo) {
      homeHalo.geometry.dispose();
      (homeHalo.material as THREE.Material).dispose();
    }
    renderer?.dispose();
    renderer = null;
    scene = null;
    camera = null;
    homeHalo = null;
  });
</script>

<div class="landing">
  <!-- MASTHEAD (landing variant — no app session controls) -->
  <header class="masthead">
    <div class="brand">
      <span class="crest" aria-hidden="true"></span>
      <span>Chronoscope</span>
      <span class="tag">Synchronized HTTP latency observation</span>
    </div>
    <nav class="nav" aria-label="Primary">
      <a href="/" onclick={(e) => handleNav(e, 'overview')}>Overview</a>
      <a href="/live" onclick={(e) => handleNav(e, 'live')}>Live</a>
      <a href="/investigate" onclick={(e) => handleNav(e, 'investigate')}>Investigate</a>
      <a href="/report" onclick={(e) => handleNav(e, 'report')}>Report</a>
    </nav>
    <div class="controls">
      <button type="button" class="ctl-btn ctl-btn--primary" onclick={handleBegin}>
        Open observatory
      </button>
    </div>
  </header>

  <!-- HERO STAGE -->
  <section class="stage" bind:this={stageEl}>
    <canvas bind:this={canvasEl}></canvas>
    <div class="vignette" aria-hidden="true"></div>

    <div class="hero-comp">
      <div class="stack">
        <div class="pre-kicker">
          <span class="pip"></span>
          <span>Browser-resident observatory</span>
          <span class="dot">·</span>
          <span>v4.0 · Vessel</span>
        </div>
        <h1>Chronoscope</h1>
        <div class="tagline">
          Synchronized HTTP latency observation, plotted in real time.
          <em>Your browser is a small observatory; the network is the sky it watches.</em>
        </div>
        <div class="cta-row">
          <button type="button" class="ctl-btn ctl-btn--primary" onclick={handleBegin}>
            Begin session →
          </button>
          <a href="#surfaces" class="ctl-btn">Tour the surfaces</a>
        </div>
      </div>
    </div>

    <div class="scroll-hint" aria-hidden="true">
      <span>Scroll</span>
      <div class="arrow"></div>
    </div>

    <div class="hero-rail">
      <div class="grp">
        <span>Cadence<span class="v">1 s · synchronized</span></span>
        <span>Window<span class="v">60 s</span></span>
        <span>Trigger<span class="v">120 ms</span></span>
      </div>
      <div class="grp">
        <span>Vantage<span class="v">This browser</span></span>
      </div>
    </div>
  </section>

  <!-- LEDE -->
  <section class="lede">
    <div class="grid">
      <div>
        <div class="kicker"><span class="roman">§ 01</span><span>·</span><span>What it is</span></div>
        <h2>One question, asked of <em>many endpoints at once</em>.</h2>
        <div class="body">
          <p>
            <strong>Is your network slow, or is theirs?</strong>
            Chronoscope answers the only question that matters when latency goes wrong, by probing several endpoints in
            <em>perfectly synchronized rounds</em>
            and plotting the responses as concentric orbits around your browser.
          </p>
          <p>
            When pulses arrive on the beat, the field is healthy. When one station drifts while the others hold tempo,
            the source is upstream of you — not local. The shape of the signature tells the diagnosis.
          </p>
        </div>
      </div>
      <aside class="pull">
        <div class="label">Operating principle</div>
        <div class="quote">Evidence before diagnosis.</div>
        <div class="cite">Chronoscope · § II</div>
      </aside>
    </div>
  </section>

  <!-- SURFACES GRID -->
  <section class="surfaces" id="surfaces">
    <div class="head">
      <div class="l">Four <em>surfaces</em>, one instrument.</div>
      <div class="r">§ 02<span class="v">Tour</span></div>
    </div>

    <div class="surface-grid">
      <a class="surface" href="/" onclick={(e) => handleNav(e, 'overview')}>
        <div class="num">SURF · 01 <span class="v">/ Overview</span></div>
        <h3>Overview<span class="sub">Mission status</span></h3>
        <div class="preview">
          <svg viewBox="0 0 500 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {#each OVERVIEW_RADII as r (r)}
              <circle cx="350" cy="150" {r} fill="none" stroke="var(--rule-strong)" stroke-width="0.6" />
            {/each}
            {#each STATION_COLORS as c, idx (idx)}
              {@const r = OVERVIEW_RADII[idx]}
              {#each RANGE_8 as i (i)}
                {@const a = -Math.PI / 2 + (i / 8) * Math.PI * 2}
                {@const x = 350 + r * Math.cos(a)}
                {@const y = 150 + r * Math.sin(a)}
                {@const sev = idx === 2 && (i === 3 || i === 5) ? 'var(--sev-bad)' : c}
                <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" fill={sev} fill-opacity="0.25" />
                <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.2" fill={sev} />
              {/each}
            {/each}
            <circle cx="350" cy="150" r="3" fill="var(--fg)" fill-opacity="0.9" />
            <text x="40" y="50" font-family="var(--mono)" font-size="9" fill="var(--fg-3)" letter-spacing="2">DOPPLER · AWS</text>
            <text x="40" y="100" font-family="var(--sans)" font-weight="300" font-size="32" fill="var(--fg)" letter-spacing="-1">AWS is drifting.</text>
            <text x="40" y="135" font-family="var(--sans)" font-weight="400" font-size="12" fill="var(--fg-2)">Three stations on transit.</text>
            <rect x="40" y="170" width="100" height="1" fill="var(--fg-2)" fill-opacity="0.3" />
            <text x="40" y="195" font-family="var(--mono)" font-size="10" fill="var(--fg-3)" letter-spacing="1">FIELD P50</text>
            <text x="40" y="240" font-family="var(--sans)" font-weight="200" font-size="48" fill="var(--fg)" letter-spacing="-2">31<tspan font-family="var(--mono)" font-size="14" fill="var(--fg-3)"> ms</tspan></text>
          </svg>
        </div>
        <p class="desc">
          The verdict at hero scale, a compact orbital diagram of the current window, and a conducting-voice telemetry log.
          <em>The marketing surface and the operator's first read, in the same view.</em>
        </p>
        <div class="open">Open Overview <span class="arrow">→</span></div>
      </a>

      <a class="surface" href="/live" onclick={(e) => handleNav(e, 'live')}>
        <div class="num">SURF · 02 <span class="v">/ Live</span></div>
        <h3>Live<span class="sub">Orbital tracking</span></h3>
        <div class="preview">
          <svg viewBox="0 0 500 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {#each LIVE_RADII as r (r)}
              <ellipse cx="250" cy="160" rx={r * 1.6} ry={r * 0.5} fill="none" stroke="var(--rule-strong)" stroke-width="0.7" />
            {/each}
            {#each STATION_COLORS as c, idx (idx)}
              {@const r = LIVE_RADII[idx]}
              {#each RANGE_10 as i (i)}
                {@const a = -Math.PI / 2 + (i / 10) * Math.PI * 2}
                {@const x = 250 + r * 1.6 * Math.cos(a)}
                {@const y = 160 + r * 0.5 * Math.sin(a)}
                {@const sev = idx === 2 && i === 4 ? 'var(--sev-bad)' : c}
                <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.5" fill={sev} fill-opacity="0.22" />
                <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.3" fill={sev} />
              {/each}
            {/each}
            <path d="M 250 160 L 446 160" stroke="var(--fg)" stroke-width="1.5" stroke-opacity="0.55" stroke-linecap="round" />
            <path d="M 250 160 L 446 160" stroke="var(--fg)" stroke-width="6" stroke-opacity="0.10" stroke-linecap="round" />
            <circle cx="446" cy="160" r="3" fill="var(--fg)" />
            <circle cx="250" cy="160" r="3.5" fill="var(--fg)" fill-opacity="0.9" />
            <text x="20" y="32" font-family="var(--mono)" font-size="9" fill="var(--fg-2)" letter-spacing="1" font-weight="700">ROUND</text>
            <text x="80" y="32" font-family="var(--mono)" font-size="9" fill="var(--fg)" font-weight="700">247</text>
            <text x="20" y="50" font-family="var(--mono)" font-size="9" fill="var(--fg-2)" letter-spacing="1" font-weight="700">T+</text>
            <text x="80" y="50" font-family="var(--mono)" font-size="9" fill="var(--fg)" font-weight="700">04:09</text>
          </svg>
        </div>
        <p class="desc">
          A real 3D scene. Four concentric orbits, a sweep that rotates once per window, pulses arriving in cadence.
          <em>Click any station to focus its carrier readout; drag the trigger to move the threshold.</em>
        </p>
        <div class="open">Open Live <span class="arrow">→</span></div>
      </a>

      <a class="surface" href="/investigate" onclick={(e) => handleNav(e, 'investigate')}>
        <div class="num">SURF · 03 <span class="v">/ Investigate</span></div>
        <h3>Investigate<span class="sub">Signal analysis</span></h3>
        <div class="preview">
          <svg viewBox="0 0 500 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <text x="30" y="40" font-family="var(--mono)" font-size="9" fill="var(--fg-3)" letter-spacing="2">DISTRIBUTION</text>
            {#each PERCENTILES as pct, i (pct[0])}
              {@const y = 80 + i * 36}
              {@const col = pct[2] === 'crit' ? 'var(--sev-crit)' : pct[2] === 'bad' ? 'var(--sev-bad)' : pct[2] === 'warn' ? 'var(--sev-warn)' : 'var(--fg)'}
              <text x="30" {y} font-family="var(--mono)" font-size="9" fill="var(--fg-3)" letter-spacing="1">{pct[0]}</text>
              <text x="62" {y} font-family="var(--mono)" font-weight="700" font-size="18" fill={col} letter-spacing="-0.5">{pct[1]}<tspan font-size="9" fill="var(--fg-3)"> ms</tspan></text>
            {/each}
            <!-- Polar half-circle distribution markers -->
            {#each POLAR_FRACTIONS as f (f)}
              {@const r = 50 + (130 - 50) * f}
              <path d="M {360 - r} 180 A {r} {r} 0 0 1 {360 + r} 180" fill="none" stroke="var(--rule-strong)" stroke-width="0.6" />
            {/each}
          </svg>
        </div>
        <p class="desc">
          Per-station polar distributions, percentile ladders, Resource Timing phase decomposition.
          <em>And the honest "Carrier opaque" state for endpoints that refuse to disclose phase telemetry.</em>
        </p>
        <div class="open">Open Investigate <span class="arrow">→</span></div>
      </a>

      <a class="surface" href="/report" onclick={(e) => handleNav(e, 'report')}>
        <div class="num">SURF · 04 <span class="v">/ Report</span></div>
        <h3>Report<span class="sub">Session signature</span></h3>
        <div class="preview">
          <svg viewBox="0 0 500 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {#each REPORT_RADII as r (r)}
              <circle cx="250" cy="150" {r} fill="none" stroke="var(--rule)" stroke-width="0.5" />
            {/each}
            <circle cx="250" cy="150" r="22" fill="none" stroke="var(--fg)" stroke-opacity="0.4" stroke-width="0.8" />
            {#each RANGE_12 as i (i)}
              {@const a = -Math.PI / 2 + (i / 12) * Math.PI * 2}
              {@const r1 = 16}
              {@const r2 = i % 3 === 0 ? 22 : 19}
              {@const x1 = 250 + r1 * Math.cos(a)}
              {@const y1 = 150 + r1 * Math.sin(a)}
              {@const x2 = 250 + r2 * Math.cos(a)}
              {@const y2 = 150 + r2 * Math.sin(a)}
              <line x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke="var(--fg)" stroke-opacity={i % 3 === 0 ? 0.5 : 0.25} stroke-width={i % 3 === 0 ? 1 : 0.6} />
            {/each}
            <circle cx="250" cy="150" r="2" fill="var(--fg)" fill-opacity="0.85" />
          </svg>
        </div>
        <p class="desc">
          A completed session's frozen orbital plot, shareable.
          <em>Downloadable as a star-catalog page; unique to every recording. The artifact someone pastes into the channel.</em>
        </p>
        <div class="open">Open Report <span class="arrow">→</span></div>
      </a>
    </div>
  </section>

  <!-- HOW IT WORKS -->
  <section class="how">
    <div class="head">
      <div class="l">Three <em>moves</em>, every second.</div>
      <div class="r">§ 03 · How it works</div>
    </div>

    <div class="steps">
      <div class="step">
        <div class="num">01</div>
        <h4>The browser fires probes at four endpoints.</h4>
        <p>
          Every <em>1 s</em>, Chronoscope dispatches an HTTP request to each station — Google, Edge, AWS, Fastly — in
          perfectly synchronized rounds. Each request is a small <em>HEAD</em> with no payload.
        </p>
        <div class="diagram">
          <svg viewBox="0 0 240 70" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <circle cx="20" cy="35" r="3" fill="var(--fg)" />
            <rect x="14" y="29" width="12" height="12" fill="none" stroke="var(--fg)" stroke-opacity="0.4" stroke-width="0.6" />
            <text x="20" y="58" font-family="var(--mono)" font-size="6" fill="var(--fg-3)" text-anchor="middle" letter-spacing="0.5">YOU</text>
            {#each PROBE_YS as y, i (i)}
              <line x1="34" y1="35" x2="220" y2={y} stroke={STATION_COLORS[i]} stroke-opacity="0.45" stroke-width="0.8" stroke-dasharray="3 3" />
              <circle cx="220" cy={y} r="3" fill={STATION_COLORS[i]} />
            {/each}
          </svg>
        </div>
      </div>

      <div class="step">
        <div class="num">02</div>
        <h4>The responses arrive on their orbits.</h4>
        <p>
          The browser measures when each response returns and plots it at the angular position of its round on that station's
          orbital ring. Radial offset from the path encodes <em>drift from baseline median</em>.
        </p>
        <div class="diagram">
          <svg viewBox="0 0 240 70" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {#each STEP_RADII as r, idx (idx)}
              <ellipse cx="120" cy="35" rx={r * 2.2} ry={r * 0.7} fill="none" stroke="var(--fg)" stroke-opacity="0.18" stroke-width="0.5" />
              {#each RANGE_6 as i (i)}
                {@const a = -Math.PI / 2 + (i / 6) * Math.PI * 2}
                {@const x = 120 + r * 2.2 * Math.cos(a)}
                {@const y = 35 + r * 0.7 * Math.sin(a)}
                <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.2" fill={STATION_COLORS[idx]} />
              {/each}
            {/each}
            <circle cx="120" cy="35" r="2" fill="var(--fg)" />
          </svg>
        </div>
      </div>

      <div class="step">
        <div class="num">03</div>
        <h4>The shape tells the diagnosis.</h4>
        <p>
          Coordinated pulses on a column = healthy field. Ragged columns = drift. One station consistently late while three hold
          tempo = <em>isolated upstream slowdown.</em> No interpretation we can't show you.
        </p>
        <div class="diagram">
          <svg viewBox="0 0 240 70" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {#each STEPS as i (i)}
              {@const x = 60 + i * 32}
              {@const c = STATION_COLORS[i]}
              {@const drift = i === 2 ? 10 : 0}
              {@const sev = i === 2 ? 'var(--sev-bad)' : c}
              <line x1={x} y1="10" x2={x} y2="60" stroke="var(--fg)" stroke-opacity="0.10" stroke-width="0.5" stroke-dasharray="2 2" />
              {#each PULSE_YS as y, j (j)}
                {@const dx = j === 4 ? drift : 0}
                <circle cx={x + dx} cy={y} r="1.8" fill={sev} fill-opacity="0.4" />
                <circle cx={x + dx} cy={y} r="0.9" fill={sev} />
              {/each}
            {/each}
            <line x1="50" y1="52" x2="200" y2="52" stroke="var(--fg)" stroke-opacity="0.25" stroke-width="0.5" />
            <text x="44" y="55" font-family="var(--mono)" font-size="5" fill="var(--fg-3)" text-anchor="end" letter-spacing="0.5">NOW</text>
          </svg>
        </div>
      </div>
    </div>
  </section>

  <!-- STATIONS PALETTE -->
  <section class="stations-strip">
    <div class="head">
      <div class="l">Default set · <span class="v">4 stations</span></div>
      <div class="r">
        Each spectral hue is calibrated to a real star's luminance band — <em>Sirius, Vega, Sun, Betelgeuse</em>.
      </div>
    </div>

    <div class="palette">
      <div class="swatch" data-ep="A">
        <div class="chip"></div>
        <div class="name">Google</div>
        <div class="meta">Sirius B/W<span class="v">{tokens.color.station.A}</span></div>
        <div class="role">CDN edge · the high-volume control reference.</div>
      </div>
      <div class="swatch" data-ep="B">
        <div class="chip"></div>
        <div class="name">Edge</div>
        <div class="meta">Vega cyan<span class="v">{tokens.color.station.B}</span></div>
        <div class="role">Cache PoP · usually closer than the origin.</div>
      </div>
      <div class="swatch" data-ep="C">
        <div class="chip"></div>
        <div class="name">AWS</div>
        <div class="meta">Sun Y/W<span class="v">{tokens.color.station.C}</span></div>
        <div class="role">Cloud object store · the regional anchor.</div>
      </div>
      <div class="swatch" data-ep="D">
        <div class="chip"></div>
        <div class="name">Fastly</div>
        <div class="meta">Betelgeuse R/O<span class="v">{tokens.color.station.D}</span></div>
        <div class="role">Modern CDN · the second-opinion station.</div>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="cta">
    <div class="inner">
      <div class="kicker">Browser-resident · no account · no install</div>
      <h2>Open the sky.</h2>
      <div class="sub">
        A single click acquires the carrier and begins recording your local field.
        <em>Nothing leaves your browser.</em>
      </div>
      <div class="row">
        <button type="button" class="primary" onclick={handleBegin}>Begin session →</button>
        <button type="button" class="ghost" onclick={handleExplore}>Explore without starting</button>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="foot">
    <div class="col">
      <h5>Chronoscope</h5>
      <p>
        <strong>A browser-resident observatory for HTTP latency.</strong>
        Built for SREs who need to know whether the slowdown is upstream or local.
      </p>
    </div>
    <div class="col">
      <h5>Surfaces</h5>
      <ul>
        <li><a href="/" onclick={(e) => handleNav(e, 'overview')}>Overview · Mission status</a></li>
        <li><a href="/live" onclick={(e) => handleNav(e, 'live')}>Live · Orbital tracking</a></li>
        <li><a href="/investigate" onclick={(e) => handleNav(e, 'investigate')}>Investigate · Signal analysis</a></li>
        <li><a href="/report" onclick={(e) => handleNav(e, 'report')}>Report · Session signature</a></li>
      </ul>
    </div>
    <div class="col">
      <h5>Principle</h5>
      <p>Evidence before diagnosis. Nothing leaves your browser.</p>
    </div>
    <div class="col">
      <h5>Cert</h5>
      <p class="mono-small">Session 4 · Vessel<br />Supersedes v3 / Orrery</p>
    </div>
  </footer>

  <div class="foot-bar">
    <div>Cert<span class="v">CHR-DSN-V4</span></div>
    <div class="center">Browser-resident · no telemetry leaves this device</div>
    <div class="right">Calibrated to <span class="v">UTC</span></div>
  </div>
</div>

<style>
  /* Local --pad-x for the landing surface. Mirrors the v4 prototype. */
  .landing {
    --pad-x: clamp(20px, 4vw, 72px);
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--sans);
    font-size: 14px;
    font-weight: 400;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  /* ===== MASTHEAD ===== */
  .masthead {
    position: sticky;
    top: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 14px var(--pad-x);
    border-bottom: 1px solid var(--rule);
    background: var(--bg-backdrop);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 12px;
    font-family: var(--mono);
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .brand .crest {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 1.2px solid var(--fg);
    border-radius: 50%;
    position: relative;
    transform: translateY(1px);
    flex-shrink: 0;
  }
  .brand .crest::after {
    content: '';
    position: absolute;
    width: 1.2px;
    height: 5px;
    background: var(--fg);
    top: 1.5px;
    left: calc(50% - 0.6px);
    transform-origin: 50% 100%;
    transform: rotate(42deg);
  }
  .brand .tag {
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.02em;
    text-transform: none;
    color: var(--fg-2);
    margin-left: 14px;
    padding-left: 14px;
    border-left: 1px solid var(--rule);
  }
  .nav {
    display: flex;
    gap: 26px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 700;
  }
  .nav a {
    color: var(--fg-3);
    padding: 4px 0;
    border-bottom: 1px solid transparent;
    transition: color 120ms, border-color 120ms;
    text-decoration: none;
  }
  .nav a:hover {
    color: var(--fg);
    border-bottom-color: var(--rule-strong);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 14px;
    justify-self: end;
  }
  .ctl-btn {
    border: 1px solid var(--rule-strong);
    padding: 7px 12px;
    color: var(--fg);
    background: transparent;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-decoration: none;
    transition: background 120ms, border-color 120ms;
    cursor: pointer;
  }
  .ctl-btn:hover {
    background: var(--bg-2);
    border-color: var(--fg-3);
  }
  .ctl-btn--primary {
    color: var(--bg);
    background: var(--fg);
    border-color: var(--fg);
  }
  .ctl-btn--primary:hover {
    background: var(--station-a);
    border-color: var(--station-a);
  }

  /* ===== HERO STAGE ===== */
  .stage {
    position: relative;
    height: calc(100svh - 50px);
    min-height: 720px;
    background: var(--bg);
    overflow: hidden;
  }
  .stage canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .stage .vignette {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    background: radial-gradient(
      ellipse at center,
      transparent 25%,
      var(--bg-backdrop) 65%,
      var(--bg) 100%
    );
  }

  /* HERO COMPOSITION */
  .hero-comp {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .hero-comp .stack {
    text-align: center;
    pointer-events: none;
    user-select: none;
  }
  .hero-comp .pre-kicker {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 36px;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    opacity: 0;
    animation: fadeIn 600ms 200ms ease-out forwards;
  }
  .hero-comp .pre-kicker .dot {
    color: var(--fg-4);
  }
  .hero-comp .pre-kicker .pip {
    width: 7px;
    height: 7px;
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
    animation: carrierpulse 2000ms ease-in-out infinite;
  }
  @keyframes carrierpulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .hero-comp h1 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(72px, 16vw, 260px);
    letter-spacing: -0.05em;
    line-height: 0.82;
    color: var(--fg);
    margin-bottom: 32px;
    opacity: 0;
    animation: nameRise 1600ms 400ms cubic-bezier(0.16, 0.84, 0.42, 1) forwards;
  }
  @keyframes nameRise {
    from {
      opacity: 0;
      transform: translateY(28px);
      letter-spacing: -0.025em;
      filter: blur(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
      letter-spacing: -0.05em;
      filter: blur(0);
    }
  }

  .hero-comp .tagline {
    font-family: var(--sans);
    font-weight: 300;
    font-size: clamp(17px, 1.6vw, 22px);
    color: var(--fg-2);
    letter-spacing: -0.01em;
    line-height: 1.4;
    max-width: 48ch;
    margin: 0 auto 40px;
    opacity: 0;
    animation: fadeIn 700ms 800ms ease-out forwards;
  }
  .hero-comp .tagline em {
    font-style: normal;
    color: var(--fg);
  }

  .hero-comp .cta-row {
    display: flex;
    gap: 16px;
    justify-content: center;
    pointer-events: auto;
    opacity: 0;
    animation: fadeIn 700ms 1100ms ease-out forwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Hero bottom rail */
  .hero-rail {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 4;
    padding: 16px var(--pad-x);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    border-top: 1px solid var(--rule);
    background: var(--bg-backdrop);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    opacity: 0;
    animation: fadeIn 700ms 1300ms ease-out forwards;
  }
  .hero-rail .grp {
    display: inline-flex;
    gap: 22px;
    flex-wrap: wrap;
  }
  .hero-rail .grp > span {
    white-space: nowrap;
  }
  .hero-rail .v {
    color: var(--fg);
    font-weight: 700;
    margin-left: 6px;
    font-variant-numeric: tabular-nums;
  }

  /* Scroll-down indicator */
  .scroll-hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 80px;
    z-index: 4;
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    opacity: 0;
    animation: fadeIn 700ms 1500ms ease-out forwards;
  }
  .scroll-hint .arrow {
    width: 1px;
    height: 24px;
    background: var(--fg-3);
    animation: scrollHint 2400ms ease-in-out infinite;
  }
  @keyframes scrollHint {
    0%, 100% { transform: scaleY(0.4); transform-origin: top; }
    50% { transform: scaleY(1); transform-origin: top; }
  }

  /* ===== LEDE ===== */
  .lede {
    padding: 120px var(--pad-x) 100px;
    border-bottom: 1px solid var(--rule);
    background: var(--bg);
    position: relative;
  }
  .lede::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 60px;
    height: 1px;
    background: var(--station-b);
    box-shadow: 0 0 12px var(--station-b);
  }
  .lede .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 80px;
    align-items: start;
  }
  .lede .kicker {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 28px;
  }
  .lede .kicker .roman {
    color: var(--fg);
    font-weight: 700;
  }
  .lede h2 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(44px, 5.8vw, 84px);
    letter-spacing: -0.028em;
    line-height: 1.04;
    color: var(--fg);
    max-width: 18ch;
    margin-bottom: 28px;
  }
  .lede h2 em {
    font-style: italic;
    font-weight: 300;
    color: var(--station-b);
  }
  .lede .body {
    font-size: 17px;
    color: var(--fg-2);
    line-height: 1.55;
    max-width: 62ch;
  }
  .lede .body p + p {
    margin-top: 14px;
  }
  .lede .body strong {
    color: var(--fg);
    font-weight: 500;
  }
  .lede .body em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .lede .pull {
    border-left: 1px solid var(--rule-strong);
    padding-left: 32px;
    padding-top: 8px;
  }
  .lede .pull .label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--fg-3);
    margin-bottom: 18px;
    font-weight: 700;
  }
  .lede .pull .quote {
    font-family: var(--sans);
    font-weight: 300;
    font-size: clamp(22px, 2.4vw, 32px);
    letter-spacing: -0.015em;
    line-height: 1.25;
    color: var(--fg);
    margin-bottom: 22px;
  }
  .lede .pull .quote::before {
    content: '"';
    margin-right: 0.08em;
    color: var(--station-b);
  }
  .lede .pull .quote::after {
    content: '"';
    margin-left: 0.08em;
    color: var(--station-b);
  }
  .lede .pull .cite {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }

  /* ===== SURFACES ===== */
  .surfaces {
    padding: 100px var(--pad-x) 100px;
    border-bottom: 1px solid var(--rule);
  }
  .surfaces .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 64px;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 24px;
    flex-wrap: wrap;
    gap: 14px;
  }
  .surfaces .head .l {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(32px, 3.6vw, 52px);
    letter-spacing: -0.025em;
    color: var(--fg);
  }
  .surfaces .head .l em {
    font-style: italic;
    font-weight: 300;
    color: var(--station-b);
  }
  .surfaces .head .r {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .surfaces .head .r .v {
    color: var(--fg);
    margin-left: 6px;
  }

  .surface-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .surface {
    background: var(--bg);
    padding: 40px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    position: relative;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: background 200ms;
  }
  .surface:hover {
    background: var(--bg-2);
  }
  .surface:hover .arrow {
    transform: translateX(6px);
  }
  .surface .num {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .surface .num .v {
    color: var(--fg);
  }
  .surface h3 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(36px, 3.4vw, 48px);
    letter-spacing: -0.025em;
    line-height: 1;
    color: var(--fg);
  }
  .surface h3 .sub {
    display: block;
    margin-top: 8px;
    font-size: 14px;
    font-weight: 400;
    color: var(--fg-2);
    letter-spacing: -0.005em;
  }
  .surface .preview {
    aspect-ratio: 5 / 3;
    background: var(--bg-2);
    border: 1px solid var(--rule);
    position: relative;
    overflow: hidden;
  }
  .surface .preview svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  .surface .desc {
    font-size: 14px;
    color: var(--fg-2);
    line-height: 1.55;
    flex-grow: 1;
  }
  .surface .desc em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .surface .open {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--fg);
    font-weight: 700;
    padding-top: 8px;
    border-top: 1px solid var(--rule);
  }
  .surface .arrow {
    display: inline-block;
    transition: transform 200ms;
  }

  /* ===== HOW IT WORKS ===== */
  .how {
    padding: 100px var(--pad-x);
    border-bottom: 1px solid var(--rule);
    background: var(--bg);
    position: relative;
  }
  .how .head {
    margin-bottom: 64px;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 14px;
  }
  .how .head .l {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(32px, 3.6vw, 52px);
    letter-spacing: -0.025em;
    color: var(--fg);
  }
  .how .head .l em {
    font-style: italic;
    font-weight: 300;
    color: var(--station-b);
  }
  .how .head .r {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .how .steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }
  .how .step {
    background: var(--bg);
    padding: 36px 32px 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .how .step .num {
    font-family: var(--sans);
    font-weight: 200;
    font-size: 64px;
    line-height: 1;
    color: var(--fg-4);
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }
  .how .step h4 {
    font-family: var(--sans);
    font-weight: 300;
    font-size: 24px;
    letter-spacing: -0.015em;
    line-height: 1.15;
    color: var(--fg);
    max-width: 18ch;
  }
  .how .step p {
    font-size: 14px;
    color: var(--fg-2);
    line-height: 1.55;
    flex-grow: 1;
  }
  .how .step p em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .how .step .diagram {
    margin-top: 8px;
    height: 84px;
    border-top: 1px solid var(--rule);
    padding-top: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .how .step .diagram svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* ===== STATIONS PALETTE ===== */
  .stations-strip {
    padding: 80px var(--pad-x);
    border-bottom: 1px solid var(--rule);
    background: var(--bg-2);
  }
  .stations-strip .head {
    margin-bottom: 42px;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 14px;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 22px;
  }
  .stations-strip .head .l {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .stations-strip .head .l .v {
    color: var(--fg);
  }
  .stations-strip .head .r {
    font-family: var(--sans);
    font-weight: 300;
    font-size: 17px;
    color: var(--fg-2);
    max-width: 40ch;
    letter-spacing: -0.005em;
  }
  .stations-strip .head .r em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .stations-strip .palette {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 40px;
  }
  .stations-strip .swatch {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .stations-strip .swatch .chip {
    width: 100%;
    height: 88px;
    position: relative;
    overflow: hidden;
  }
  .stations-strip .swatch[data-ep='A'] .chip {
    background: var(--station-a);
    box-shadow: 0 0 24px var(--station-a) inset, 0 0 12px var(--station-a);
  }
  .stations-strip .swatch[data-ep='B'] .chip {
    background: var(--station-b);
    box-shadow: 0 0 24px var(--station-b) inset, 0 0 12px var(--station-b);
  }
  .stations-strip .swatch[data-ep='C'] .chip {
    background: var(--station-c);
    box-shadow: 0 0 24px var(--station-c) inset, 0 0 12px var(--station-c);
  }
  .stations-strip .swatch[data-ep='D'] .chip {
    background: var(--station-d);
    box-shadow: 0 0 24px var(--station-d) inset, 0 0 12px var(--station-d);
  }
  .stations-strip .swatch .name {
    font-family: var(--sans);
    font-weight: 400;
    font-size: 18px;
    color: var(--fg);
    letter-spacing: -0.005em;
  }
  .stations-strip .swatch .meta {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .stations-strip .swatch .meta .v {
    color: var(--fg-2);
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }
  .stations-strip .swatch .role {
    font-family: var(--sans);
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.5;
  }

  /* ===== CTA ===== */
  .cta {
    padding: 140px var(--pad-x);
    text-align: center;
    border-bottom: 1px solid var(--rule);
    position: relative;
    overflow: hidden;
  }
  .cta::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 560px;
    height: 560px;
    transform: translate(-50%, -50%);
    border: 1px solid var(--rule);
    border-radius: 50%;
    pointer-events: none;
  }
  .cta::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 380px;
    height: 380px;
    transform: translate(-50%, -50%);
    border: 1px solid var(--rule-strong);
    border-radius: 50%;
    pointer-events: none;
  }
  .cta .inner {
    position: relative;
    z-index: 1;
  }
  .cta .kicker {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 32px;
  }
  .cta h2 {
    font-family: var(--sans);
    font-weight: 200;
    font-size: clamp(48px, 7vw, 108px);
    letter-spacing: -0.035em;
    line-height: 1;
    color: var(--fg);
    margin: 0 auto 30px;
    max-width: 16ch;
  }
  .cta .sub {
    font-family: var(--sans);
    font-weight: 300;
    font-size: 18px;
    color: var(--fg-2);
    max-width: 48ch;
    margin: 0 auto 44px;
    line-height: 1.5;
  }
  .cta .sub em {
    font-style: normal;
    font-family: var(--mono);
    color: var(--fg);
  }
  .cta .row {
    display: inline-flex;
    gap: 18px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .cta .row .primary {
    color: var(--bg);
    background: var(--fg);
    border: 1px solid var(--fg);
    padding: 14px 22px;
    transition: background 120ms, border-color 120ms;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .cta .row .primary:hover {
    background: var(--station-a);
    border-color: var(--station-a);
  }
  .cta .row .ghost {
    color: var(--fg-2);
    padding: 14px 22px;
    border: 1px solid var(--rule-strong);
    background: transparent;
    transition: color 120ms, border-color 120ms;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }
  .cta .row .ghost:hover {
    color: var(--fg);
    border-color: var(--fg-3);
  }

  /* ===== FOOTER ===== */
  .foot {
    padding: 48px var(--pad-x) 36px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 48px;
    border-bottom: 1px solid var(--rule);
  }
  .foot .col h5 {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
    margin-bottom: 18px;
  }
  .foot .col ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .foot .col ul li {
    padding: 4px 0;
  }
  .foot .col ul li a {
    font-family: var(--sans);
    color: var(--fg-2);
    font-size: 14px;
    text-decoration: none;
    transition: color 120ms;
  }
  .foot .col ul li a:hover {
    color: var(--fg);
  }
  .foot .col p {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.55;
  }
  .foot .col p strong {
    color: var(--fg);
    font-weight: 500;
  }
  .foot .col .mono-small {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.04em;
  }

  .foot-bar {
    padding: 18px var(--pad-x);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--fg-3);
    font-weight: 700;
  }
  .foot-bar .v {
    color: var(--fg);
    margin-left: 6px;
  }
  .foot-bar .center {
    text-align: center;
  }
  .foot-bar .right {
    text-align: right;
  }

  /* ===== REDUCED MOTION ===== */
  @media (prefers-reduced-motion: reduce) {
    .hero-comp .pre-kicker,
    .hero-comp h1,
    .hero-comp .tagline,
    .hero-comp .cta-row,
    .hero-rail,
    .scroll-hint {
      animation: none;
      opacity: 1;
    }
    .hero-comp .pre-kicker .pip {
      animation: none;
    }
    .scroll-hint .arrow {
      animation: none;
    }
  }

  /* ===== RESPONSIVE ===== */
  @media (max-width: 1100px) {
    .lede .grid {
      grid-template-columns: 1fr;
      gap: 40px;
    }
    .lede .pull {
      border-left: 0;
      padding-left: 0;
      border-top: 1px solid var(--rule-strong);
      padding-top: 32px;
    }
    .surface-grid {
      grid-template-columns: 1fr;
    }
    .how .steps {
      grid-template-columns: 1fr;
    }
    .stations-strip .palette {
      grid-template-columns: repeat(2, 1fr);
      gap: 32px;
    }
    .foot {
      grid-template-columns: repeat(2, 1fr);
      gap: 32px;
    }
  }
  @media (max-width: 720px) {
    .nav,
    .brand .tag {
      display: none;
    }
    .hero-comp .pre-kicker {
      font-size: 9px;
    }
    .hero-rail {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      font-size: 9px;
      padding-bottom: 96px;
    }
    .scroll-hint {
      display: none;
    }
    .foot {
      grid-template-columns: 1fr;
      gap: 24px;
    }
    .foot-bar {
      grid-template-columns: 1fr;
      gap: 4px;
      text-align: left;
    }
    .foot-bar .center,
    .foot-bar .right {
      text-align: left;
    }
  }

  /* ===== MOBILE FLOOR (375–480 px) ===== */
  @media (max-width: 480px) {
    .landing {
      --pad-x: 14px;
    }
    .masthead {
      padding: 10px var(--pad-x);
    }
    .brand {
      font-size: 11px;
      gap: 8px;
    }
    .controls {
      gap: 8px;
    }
    .controls .ctl-btn {
      padding: 6px 8px;
      font-size: 9px;
      letter-spacing: 0.12em;
    }
    .hero-comp h1 {
      font-size: clamp(56px, 18vw, 120px);
      letter-spacing: -0.04em;
    }
    .stage {
      min-height: 600px;
    }
    .surface {
      padding: 24px;
    }
  }
</style>
