// Pulse point vertex — each station's pulses are a single THREE.Points mesh.
// Per-vertex aSize and aAge attributes drive size attenuation by depth and
// the "fresh pulse pops large then settles" behaviour. Subtle breathing on
// settled pulses keeps the field feeling alive. aReveal + uReveal gate
// whether a pulse renders at all — used by the Report scrub rail to play
// the session back stop-motion-style.
attribute float aSize;
attribute float aAge;
attribute float aReveal;
varying vec3 vColor;
varying float vAge;
varying float vReveal;
uniform float uTime;
uniform float uReveal;

void main() {
  vColor = color;
  vAge = aAge;
  // Slot is hidden when its reveal index is above the current reveal threshold.
  // We pass the comparison result to the fragment shader as a 0/1 flag so the
  // frag can discard early.
  vReveal = step(aReveal, uReveal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float breath = 1.0 + sin(uTime * 0.0015 + position.x * 4.7 + position.z * 3.1) * 0.06 * vAge;
  float fresh = pow(1.0 - vAge, 1.6);
  float sizeMul = (1.0 + fresh * 2.4) * breath;
  gl_PointSize = aSize * sizeMul * 3200.0 / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
