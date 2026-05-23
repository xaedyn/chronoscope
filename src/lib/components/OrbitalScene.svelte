<!-- src/lib/components/OrbitalScene.svelte -->
<!-- Vessel v4 OrbitalScene — the load-bearing 3D component. Three.js scene
     with star field, sweep-aware orbital rings, per-station pulse points
     with diffraction-spike shader, sweep beam, home halo, mouse parallax,
     camera drift. Reference: proposal-live-v4.html lines ~850–1500.

     Consumed by LiveView, OverviewView, EndpointView, TransitView, ErrorView
     in Phase C. Each consumer drives stationData via the measurementStore. -->
<script lang="ts" module>
  export interface OrbitalStation {
    readonly id: string;        // e.g. 'A' | 'B' | 'C' | 'D'
    readonly color: string;     // hex string from tokens.color.station.*
    readonly radius: number;    // orbit radius in scene units (~6–12)
    readonly baseline?: number; // expected baseline latency; if absent, median of data is used
  }

  // A gap arc to render in crimson on a station's orbit ring. Used by the
  // EndpointErrorView surface to highlight missed-pulse regions. Angles in
  // radians, range [-π, π]; if startAngle > endAngle, the gap wraps the seam.
  export interface OrbitalGap {
    readonly stationId: string;
    readonly startAngle: number;
    readonly endAngle: number;
  }

  // A pulse hovered by the cursor — used internally for the tooltip overlay.
  export interface PulseHover {
    readonly stationId: string;
    readonly stationLabel: string;
    readonly slot: number;
    readonly latency: number;
    readonly drift: number | null;
    readonly screenX: number;
    readonly screenY: number;
  }
</script>
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { tokens } from '$lib/tokens';
  import starVert from '$lib/shaders/star.vert.glsl?raw';
  import starFrag from '$lib/shaders/star.frag.glsl?raw';
  import ringVert from '$lib/shaders/ring.vert.glsl?raw';
  import ringFrag from '$lib/shaders/ring.frag.glsl?raw';
  import pulseVert from '$lib/shaders/pulse.vert.glsl?raw';
  import pulseFrag from '$lib/shaders/pulse.frag.glsl?raw';
  import haloVert from '$lib/shaders/halo.vert.glsl?raw';
  import haloFrag from '$lib/shaders/halo.frag.glsl?raw';

  let {
    stations,
    stationData,
    focusedStation = null,
    triggerMs = 120,
    windowSeconds = 60,
    windowRounds = 60,
    assemble = true,
    revealProgress = 1,
    gapRegions = [],
    stationLabels = {},
    showTooltip = true,
  }: {
    stations: readonly OrbitalStation[];
    stationData: Readonly<Record<string, readonly (number | null)[]>>;
    focusedStation?: string | null;
    triggerMs?: number;
    windowSeconds?: number;
    windowRounds?: number;
    assemble?: boolean;
    // 0..1; pulses with slot index > revealProgress * windowRounds are hidden.
    // Default 1 = all pulses visible. Drives Report scrub-driven playback.
    revealProgress?: number;
    // Crimson arcs in station orbit rings where pulses are missing.
    gapRegions?: readonly OrbitalGap[];
    // Optional friendly labels for stations (used in the hover tooltip).
    // Keyed by station id; falls back to id if absent.
    stationLabels?: Readonly<Record<string, string>>;
    // Set false to disable the hover tooltip entirely (e.g. Report scrub mode).
    showTooltip?: boolean;
  } = $props();

  // Element refs (Svelte 5: bind:this fills these at mount)
  let canvas: HTMLCanvasElement | undefined;
  let container: HTMLDivElement | undefined;

  // Three.js objects, populated on mount
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let rafId: number | null = null;
  let resizeObs: ResizeObserver | null = null;

  interface OrbitObjects {
    readonly ring: THREE.Mesh;
    readonly triggerRing: THREE.Mesh;
    readonly r: number;
  }
  interface PulseBuffer {
    readonly points: THREE.Points;
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly sizes: Float32Array;
    readonly ages: Float32Array;
    readonly reveals: Float32Array;
    readonly writeAt: number[];
    readonly prevValues: (number | null)[];
  }

  const orbits: Record<string, OrbitObjects> = {};
  const pulses: Record<string, PulseBuffer> = {};

  // ── Hover tooltip state ────────────────────────────────────────────────────
  let hover = $state<PulseHover | null>(null);
  let stars: THREE.Points | null = null;
  let home: THREE.Mesh | null = null;
  let homeHalo: THREE.Mesh | null = null;
  let sweepGroup: THREE.Group | null = null;

  // Animation state
  let cameraAngle = 0;
  let mouseTargetX = 0;
  let mouseTargetY = 0;
  let mouseX = 0;
  let mouseY = 0;
  let assembleStartAt = 0;
  let assembleProgress = 0;
  let reducedMotion = false;

  const ASSEMBLE_DURATION_MS = 1800;
  const PULSE_DECAY_MS = 2000;
  const STAR_COUNT = 2400;
  const STAR_R_MIN = 60;
  const STAR_R_RANGE = 60;
  const STAR_Y_OFFSET = -8;
  const STAR_BIG_PROB = 0.04;
  const SWEEP_BEAM_LENGTH = 14;
  const SWEEP_ANGULAR_WIDTH = Math.PI / 36;
  const CAMERA_DRIFT_RATE = 0.00005;
  const CAMERA_R = 22;
  const CAMERA_Y = 14;
  const MOUSE_LERP = 0.045;

  function buildScene(): void {
    if (!canvas || !container) return;

    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    assembleProgress = (assemble && !reducedMotion) ? 0 : 1;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    scene = new THREE.Scene();
    scene.background = null;

    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    camera.position.set(0, CAMERA_Y, CAMERA_R);
    camera.lookAt(0, 0, 0);

    buildStars();
    buildOrbits();
    buildHome();
    buildPulses();
    buildSweep();
    applyAssembly(assembleProgress);

    handleResize();

    if (assemble && !reducedMotion) {
      assembleStartAt = performance.now();
    }

    resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(container);
    window.addEventListener('mousemove', handleMouseMove);

    rafId = requestAnimationFrame(frame);
  }

  function handleResize(): void {
    if (!renderer || !camera || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function handleMouseMove(e: MouseEvent): void {
    mouseTargetX = ((e.clientX / window.innerWidth) - 0.5) * 2;
    mouseTargetY = ((e.clientY / window.innerHeight) - 0.5) * 2;
  }

  // Hover picking: project every visible pulse to NDC each mousemove, find
  // the closest within a threshold. Threshold tightens with screen DPR so
  // it feels like a ~12 px target regardless of viewport. Mirrors the
  // proposal-live-v4.html pickPulse() approach (manual projection, not
  // THREE.Raycaster — raycaster doesn't pick custom-shader Points reliably).
  const tmpVec3 = new THREE.Vector3();
  const NDC_PICK_RADIUS = 0.03;

  function handleCanvasMouseMove(e: MouseEvent): void {
    if (!showTooltip || !camera || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    let bestD2 = NDC_PICK_RADIUS * NDC_PICK_RADIUS;
    let bestStationId: string | null = null;
    let bestSlot = -1;

    for (const station of stations) {
      const buf = pulses[station.id];
      if (!buf) continue;
      for (let i = 0; i < windowRounds; i++) {
        if (buf.positions[i * 3] >= 9000) continue; // hidden slot
        if (buf.reveals[i] > revealProgress) continue; // gated by scrub
        tmpVec3.set(
          buf.positions[i * 3],
          buf.positions[i * 3 + 1],
          buf.positions[i * 3 + 2],
        );
        tmpVec3.project(camera);
        if (tmpVec3.z < -1 || tmpVec3.z > 1) continue;
        const dx = tmpVec3.x - ndcX;
        const dy = tmpVec3.y - ndcY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestStationId = station.id;
          bestSlot = i;
        }
      }
    }

    if (bestStationId === null || bestSlot < 0) {
      if (hover !== null) hover = null;
      return;
    }

    const stationObj = stations.find((s) => s.id === bestStationId);
    if (!stationObj) return;
    const data = stationData[bestStationId] ?? [];
    const latency = data[bestSlot];
    if (typeof latency !== 'number') return;

    const filtered = data.filter((v): v is number => v !== null && v !== undefined);
    let baseline = stationObj.baseline;
    if (baseline === undefined && filtered.length > 0) {
      const sorted = [...filtered].sort((a, b) => a - b);
      baseline = sorted[Math.floor(sorted.length / 2)];
    }
    const drift = baseline === undefined ? null : Math.round(latency - baseline);
    const stationLabel = stationLabels[bestStationId] ?? bestStationId;

    hover = {
      stationId: bestStationId,
      stationLabel,
      slot: bestSlot,
      latency,
      drift,
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
    };
  }

  function handleCanvasMouseLeave(): void {
    if (hover !== null) hover = null;
  }

  function buildStars(): void {
    if (!scene) return;
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = STAR_R_MIN + Math.random() * STAR_R_RANGE;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) + STAR_Y_OFFSET;
      positions[i * 3 + 2] = r * Math.cos(phi);
      const w = 0.7 + Math.random() * 0.3;
      colors[i * 3]     = w * (0.92 + Math.random() * 0.08);
      colors[i * 3 + 1] = w * (0.88 + Math.random() * 0.08);
      colors[i * 3 + 2] = w * (0.80 + Math.random() * 0.08);
      sizes[i] = Math.random() < STAR_BIG_PROB ? 1.6 + Math.random() * 1.2 : 0.3 + Math.random() * 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: starVert,
      fragmentShader: starFrag,
      vertexColors: true,
    });
    stars = new THREE.Points(g, m);
    scene.add(stars);
  }

  const MAX_GAPS = 8;

  function buildOrbits(): void {
    if (!scene) return;
    const fgColor = new THREE.Color(tokens.color.text.fg);
    const sevBadColor = new THREE.Color(tokens.color.severity.bad);
    const sevCritColor = new THREE.Color(tokens.color.severity.crit);

    for (const station of stations) {
      const r = station.radius;
      const ringG = new THREE.RingGeometry(r - 0.05, r + 0.05, 256);
      const ringM = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uSweep: { value: 0 },
          uOpacity: { value: assembleProgress },
          uColor: { value: fgColor.clone() },
          uGapStarts: { value: new Float32Array(MAX_GAPS) },
          uGapEnds:   { value: new Float32Array(MAX_GAPS) },
          uGapCount:  { value: 0 },
          uGapColor:  { value: sevCritColor.clone() },
        },
        vertexShader: ringVert,
        fragmentShader: ringFrag,
      });
      const ring = new THREE.Mesh(ringG, ringM);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);

      const triggerG = new THREE.RingGeometry(r + 0.55, r + 0.62, 128, 1, 0, Math.PI * 2);
      const triggerM = new THREE.MeshBasicMaterial({
        color: sevBadColor.clone(),
        transparent: true,
        opacity: 0.32 * assembleProgress,
        side: THREE.DoubleSide,
      });
      const triggerRing = new THREE.Mesh(triggerG, triggerM);
      triggerRing.rotation.x = -Math.PI / 2;
      scene.add(triggerRing);

      orbits[station.id] = { ring, triggerRing, r };
    }
  }

  function buildHome(): void {
    if (!scene) return;
    const fgColor = new THREE.Color(tokens.color.text.fg);

    const homeG = new THREE.SphereGeometry(0.16, 24, 24);
    const homeM = new THREE.MeshBasicMaterial({ color: fgColor.clone(), transparent: true, opacity: 0.95 });
    home = new THREE.Mesh(homeG, homeM);
    scene.add(home);

    const haloG = new THREE.SphereGeometry(0.6, 24, 24);
    const haloM = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: haloVert,
      fragmentShader: haloFrag,
    });
    homeHalo = new THREE.Mesh(haloG, haloM);
    scene.add(homeHalo);
  }

  function buildPulses(): void {
    if (!scene) return;
    for (const station of stations) {
      const positions = new Float32Array(windowRounds * 3);
      const colors = new Float32Array(windowRounds * 3);
      const sizes = new Float32Array(windowRounds);
      const ages = new Float32Array(windowRounds);
      // Per-slot reveal index ∈ [0, 1] — index N maps to N/windowRounds.
      // Pulse fragment shader discards when aReveal > uReveal.
      const reveals = new Float32Array(windowRounds);
      const writeAt: number[] = new Array(windowRounds).fill(-Infinity);
      const prevValues: (number | null)[] = new Array(windowRounds).fill(null);

      const c = new THREE.Color(station.color);
      for (let i = 0; i < windowRounds; i++) {
        positions[i * 3] = 9999;
        positions[i * 3 + 1] = 9999;
        positions[i * 3 + 2] = 9999;
        colors[i * 3]     = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        sizes[i] = 0.075;
        ages[i] = 1;
        reveals[i] = i / Math.max(1, windowRounds - 1);
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color',    new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aAge',     new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aReveal',  new THREE.BufferAttribute(reveals, 1));

      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: {
          uTime: { value: 0 },
          uReveal: { value: revealProgress },
        },
        vertexShader: pulseVert,
        fragmentShader: pulseFrag,
      });

      const points = new THREE.Points(g, m);
      points.frustumCulled = false;
      scene.add(points);

      pulses[station.id] = { points, positions, colors, sizes, ages, reveals, writeAt, prevValues };
    }
  }

  function buildSweep(): void {
    if (!scene) return;
    const fgColor = new THREE.Color(tokens.color.text.fg);
    sweepGroup = new THREE.Group();
    scene.add(sweepGroup);

    const length = SWEEP_BEAM_LENGTH;
    const beamShape = new THREE.Shape();
    beamShape.moveTo(0, 0);
    beamShape.lineTo(length, length * Math.tan(SWEEP_ANGULAR_WIDTH) * 0.5);
    beamShape.lineTo(length, -length * Math.tan(SWEEP_ANGULAR_WIDTH) * 0.5);
    beamShape.lineTo(0, 0);
    const beamG = new THREE.ShapeGeometry(beamShape);
    beamG.rotateY(Math.PI / 2);
    const beamM = new THREE.MeshBasicMaterial({
      color: fgColor.clone(),
      transparent: true,
      opacity: 0.10 * assembleProgress,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(beamG, beamM);
    beam.rotation.x = -Math.PI / 2;
    sweepGroup.add(beam);

    const lineG = new THREE.PlaneGeometry(length, 0.02);
    const lineM = new THREE.MeshBasicMaterial({
      color: fgColor.clone(),
      transparent: true,
      opacity: 0.6 * assembleProgress,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Mesh(lineG, lineM);
    line.position.set(length / 2, 0, 0);
    line.rotation.x = -Math.PI / 2;
    sweepGroup.add(line);

    const tipG = new THREE.SphereGeometry(0.12, 12, 12);
    const tipM = new THREE.MeshBasicMaterial({ color: fgColor.clone(), transparent: true, opacity: assembleProgress });
    const tip = new THREE.Mesh(tipG, tipM);
    tip.position.set(length, 0, 0);
    sweepGroup.add(tip);
  }

  function applyAssembly(p: number): void {
    const orbitList = Object.values(orbits);
    for (let i = 0; i < orbitList.length; i++) {
      const orbit = orbitList[i];
      const start = i * 0.18;
      const end = start + 0.32;
      const local = Math.max(0, Math.min(1, (p - start) / (end - start)));
      const eased = local * local * (3 - 2 * local);
      (orbit.ring.material as THREE.ShaderMaterial).uniforms.uOpacity.value = eased;
      (orbit.triggerRing.material as THREE.MeshBasicMaterial).opacity = 0.28 * eased;
    }
    const sweepLocal = Math.max(0, Math.min(1, (p - 0.8) / 0.2));
    if (sweepGroup) {
      const [beam, line, tip] = sweepGroup.children as THREE.Mesh[];
      if (beam) (beam.material as THREE.MeshBasicMaterial).opacity = 0.10 * sweepLocal;
      if (line) (line.material as THREE.MeshBasicMaterial).opacity = 0.6 * sweepLocal;
      if (tip) (tip.material as THREE.MeshBasicMaterial).opacity = sweepLocal;
    }
  }

  function severityColor(latency: number, defaultHex: string): THREE.Color {
    if (latency >= 4000) return new THREE.Color(tokens.color.severity.crit);
    if (latency > triggerMs) return new THREE.Color(tokens.color.severity.bad);
    if (latency > triggerMs * 0.7) return new THREE.Color(tokens.color.severity.warn);
    return new THREE.Color(defaultHex);
  }

  function refreshPulses(): void {
    if (!scene) return;
    const now = performance.now();
    for (const station of stations) {
      const buf = pulses[station.id];
      const data = stationData[station.id] ?? [];
      if (!buf) continue;

      const filtered = data.filter((v): v is number => v !== null && v !== undefined);
      let baseline = station.baseline ?? 30;
      if (filtered.length > 0) {
        const sorted = [...filtered].sort((a, b) => a - b);
        baseline = sorted[Math.floor(sorted.length / 2)];
      }

      for (let i = 0; i < windowRounds; i++) {
        const latency = data[i] ?? null;

        // Detect freshness: a slot is "new" when its value changed from prev
        const changed = latency !== buf.prevValues[i];
        if (changed && latency !== null) {
          buf.writeAt[i] = now;
        }
        buf.prevValues[i] = latency;

        if (latency === null) {
          buf.positions[i * 3] = 9999;
          buf.positions[i * 3 + 1] = 9999;
          buf.positions[i * 3 + 2] = 9999;
          buf.sizes[i] = 0;
          continue;
        }

        const angle = -Math.PI / 2 + (i / windowRounds) * Math.PI * 2;
        const ratio = (latency - baseline) / Math.max(baseline, 10);
        const offset = Math.max(-0.4, Math.min(0.8, ratio * 0.5));
        const rr = station.radius + offset;
        buf.positions[i * 3]     = rr * Math.cos(angle);
        buf.positions[i * 3 + 1] = 0;
        buf.positions[i * 3 + 2] = rr * Math.sin(angle);

        const isCrit = latency > triggerMs;
        const isSev = latency > triggerMs * 0.7;
        const isFocused = station.id === focusedStation;
        buf.sizes[i] = isCrit ? 0.14 : isSev ? 0.11 : (isFocused ? 0.09 : 0.075);

        const c = severityColor(latency, station.color);
        buf.colors[i * 3]     = c.r;
        buf.colors[i * 3 + 1] = c.g;
        buf.colors[i * 3 + 2] = c.b;
      }

      const g = buf.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    }
  }

  function frame(now: number): void {
    if (!renderer || !scene || !camera) {
      rafId = null;
      return;
    }

    if (assembleProgress < 1 && assemble && !reducedMotion) {
      assembleProgress = Math.min(1, (now - assembleStartAt) / ASSEMBLE_DURATION_MS);
      applyAssembly(assembleProgress);
    }

    const sweepCycleMs = windowSeconds * 1000;
    const sweepAngle = ((now / sweepCycleMs) % 1) * Math.PI * 2;
    if (sweepGroup) sweepGroup.rotation.y = -sweepAngle;

    const sweepLocal = sweepAngle - Math.PI / 2;
    for (const orbit of Object.values(orbits)) {
      (orbit.ring.material as THREE.ShaderMaterial).uniforms.uSweep.value = sweepLocal;
    }

    if (!reducedMotion) {
      cameraAngle += CAMERA_DRIFT_RATE;
      mouseX += (mouseTargetX - mouseX) * MOUSE_LERP;
      mouseY += (mouseTargetY - mouseY) * MOUSE_LERP;
      camera.position.x = Math.sin(cameraAngle) * 4 + mouseX * 1.8;
      camera.position.y = CAMERA_Y - mouseY * 0.9;
      camera.position.z = CAMERA_R + Math.cos(cameraAngle) * 2;
      camera.lookAt(0, 0, 0);
    }

    if (stars) (stars.material as THREE.ShaderMaterial).uniforms.uTime.value = now;
    if (homeHalo) (homeHalo.material as THREE.ShaderMaterial).uniforms.uTime.value = now;

    for (const buf of Object.values(pulses)) {
      let changed = false;
      for (let i = 0; i < windowRounds; i++) {
        const wa = buf.writeAt[i];
        if (!Number.isFinite(wa)) continue;
        const newAge = Math.min(1, (now - wa) / PULSE_DECAY_MS);
        if (buf.ages[i] !== newAge) {
          buf.ages[i] = newAge;
          changed = true;
        }
      }
      if (changed) buf.points.geometry.attributes.aAge.needsUpdate = true;
      (buf.points.material as THREE.ShaderMaterial).uniforms.uTime.value = now;
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  function teardown(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener('mousemove', handleMouseMove);
    resizeObs?.disconnect();
    resizeObs = null;

    if (scene) {
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose());
          } else {
            mat.dispose();
          }
        }
      });
    }
    renderer?.dispose();

    renderer = null;
    scene = null;
    camera = null;
    sweepGroup = null;
    home = null;
    homeHalo = null;
    stars = null;
    // orbits + pulses are component-local; GC reclaims them when the
    // component instance is destroyed. Three.js objects already disposed above.
  }

  // Refresh pulses whenever stationData / focusedStation / triggerMs change.
  $effect(() => {
    void stationData;
    void focusedStation;
    void triggerMs;
    if (scene) refreshPulses();
  });

  // Sync revealProgress prop to the per-station pulse uReveal uniform.
  $effect(() => {
    if (!scene) return;
    for (const buf of Object.values(pulses)) {
      const mat = buf.points.material as THREE.ShaderMaterial;
      if (mat.uniforms.uReveal) mat.uniforms.uReveal.value = revealProgress;
    }
  });

  // Sync gapRegions prop to per-station ring uGapStarts/uGapEnds uniforms.
  // Gaps are bucketed by stationId; each ring gets up to MAX_GAPS arcs.
  $effect(() => {
    if (!scene) return;
    const bucketed: Record<string, OrbitalGap[]> = {};
    for (const g of gapRegions) {
      (bucketed[g.stationId] ??= []).push(g);
    }
    for (const stationId of Object.keys(orbits)) {
      const orbit = orbits[stationId];
      const mat = orbit.ring.material as THREE.ShaderMaterial;
      const list = (bucketed[stationId] ?? []).slice(0, MAX_GAPS);
      const starts = mat.uniforms.uGapStarts.value as Float32Array;
      const ends = mat.uniforms.uGapEnds.value as Float32Array;
      for (let i = 0; i < MAX_GAPS; i++) {
        starts[i] = list[i]?.startAngle ?? 0;
        ends[i]   = list[i]?.endAngle ?? 0;
      }
      mat.uniforms.uGapCount.value = list.length;
    }
  });

  onMount(() => {
    buildScene();
    refreshPulses();
  });

  onDestroy(() => {
    teardown();
  });
</script>

<div
  bind:this={container}
  class="orbital-scene"
  role="img"
  aria-label="Orbital tracker"
  onmousemove={handleCanvasMouseMove}
  onmouseleave={handleCanvasMouseLeave}
>
  <canvas bind:this={canvas} class="orbital-canvas"></canvas>
  <div class="orbital-vignette" aria-hidden="true"></div>
  {#if showTooltip && hover}
    {@const h = hover}
    <div
      class="orbital-tooltip"
      role="tooltip"
      style:left="{h.screenX}px"
      style:top="{h.screenY}px"
      style:--tip-color={stations.find((s) => s.id === h.stationId)?.color ?? 'var(--fg)'}
    >
      <div class="t-station">
        <span class="t-mk" aria-hidden="true"></span>
        <span class="t-name">{h.stationLabel}</span>
      </div>
      <div class="t-row"><span class="t-k">Latency</span><span class="t-v">{Math.round(h.latency)} ms</span></div>
      {#if h.drift !== null}
        <div class="t-row"><span class="t-k">Drift</span><span class="t-v">{h.drift >= 0 ? '+' : ''}{h.drift} ms</span></div>
      {/if}
      <div class="t-row"><span class="t-k">Slot</span><span class="t-v">#{h.slot}</span></div>
    </div>
  {/if}
</div>

<style>
  .orbital-scene {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .orbital-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* Radial vignette darkening at the edges — layered over the WebGL canvas. */
  .orbital-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      ellipse at center,
      transparent 30%,
      color-mix(in srgb, var(--bg) 55%, transparent) 70%,
      color-mix(in srgb, var(--bg) 96%, transparent) 100%
    );
  }
  /* Pulse hover tooltip — offset from cursor, station-colored accent line. */
  .orbital-tooltip {
    position: absolute;
    z-index: 10;
    pointer-events: none;
    transform: translate(12px, -50%);
    background: var(--bg-2);
    border: 1px solid var(--rule-strong);
    padding: 8px 12px;
    min-width: 140px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--fg);
    box-shadow: 0 8px 24px color-mix(in srgb, black 50%, transparent);
  }
  .orbital-tooltip::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 24px;
    height: 1px;
    background: var(--tip-color);
    box-shadow: 0 0 8px var(--tip-color);
  }
  .orbital-tooltip .t-station {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--rule);
    text-transform: uppercase;
    font-weight: 700;
  }
  .orbital-tooltip .t-mk {
    width: 6px;
    height: 6px;
    background: var(--tip-color);
    box-shadow: 0 0 6px var(--tip-color);
  }
  .orbital-tooltip .t-name { color: var(--fg); }
  .orbital-tooltip .t-row {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 2px 0;
    font-variant-numeric: tabular-nums;
  }
  .orbital-tooltip .t-k { color: var(--fg-3); text-transform: uppercase; font-weight: 700; }
  .orbital-tooltip .t-v { color: var(--fg); font-weight: 700; }
</style>
