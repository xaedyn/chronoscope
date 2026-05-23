// Pulse fragment — the system's signature visual. Builds each point as:
//   - bright sharp core
//   - soft Gaussian halo
//   - faint Airy-disk outer ring
//   - 4-spike diffraction cross (h/v) + diagonal spikes, only on fresh pulses
// Fresh pulses hot-shift toward white before settling to station color.
varying vec3 vColor;
varying float vAge;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  float core = smoothstep(0.10, 0.0, d);
  float halo = exp(-d * 7.0) * 0.85;
  float ring = smoothstep(0.32, 0.27, d) * smoothstep(0.40, 0.34, d) * 0.35;

  float fresh = pow(1.0 - vAge, 2.0);
  float ah = smoothstep(0.012, 0.0, abs(c.y)) * smoothstep(0.5, 0.04, abs(c.x));
  float av = smoothstep(0.012, 0.0, abs(c.x)) * smoothstep(0.5, 0.04, abs(c.y));
  vec2 r45 = vec2((c.x + c.y) * 0.7071, (c.y - c.x) * 0.7071);
  float ad1 = smoothstep(0.008, 0.0, abs(r45.y)) * smoothstep(0.4, 0.05, abs(r45.x));
  float ad2 = smoothstep(0.008, 0.0, abs(r45.x)) * smoothstep(0.4, 0.05, abs(r45.y));
  float diffraction = (ah + av + (ad1 + ad2) * 0.4) * fresh * 0.85;

  float intensity = core * 1.4 + halo + ring + diffraction;
  vec3 col = mix(vColor, vec3(1.0), fresh * 0.45);
  gl_FragColor = vec4(col * (1.0 + fresh * 0.5), intensity);
}
