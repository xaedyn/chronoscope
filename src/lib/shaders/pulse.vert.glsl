// Pulse point vertex — each station's pulses are a single THREE.Points mesh.
// Per-vertex aSize and aAge attributes drive size attenuation by depth and
// the "fresh pulse pops large then settles" behaviour. Subtle breathing on
// settled pulses keeps the field feeling alive.
attribute float aSize;
attribute float aAge;
varying vec3 vColor;
varying float vAge;
uniform float uTime;

void main() {
  vColor = color;
  vAge = aAge;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float breath = 1.0 + sin(uTime * 0.0015 + position.x * 4.7 + position.z * 3.1) * 0.06 * vAge;
  float fresh = pow(1.0 - vAge, 1.6);
  float sizeMul = (1.0 + fresh * 2.4) * breath;
  gl_PointSize = aSize * sizeMul * 3200.0 / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}
