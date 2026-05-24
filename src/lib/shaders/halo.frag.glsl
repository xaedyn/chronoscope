// Home halo fragment — fresnel rim-light with slow sine breathing.
// The home station gets a soft warm-bone glow.
varying vec3 vN;
varying vec3 vEye;
uniform float uTime;

void main() {
  float rim = 1.0 - max(dot(vN, vEye), 0.0);
  rim = pow(rim, 2.2);
  float pulse = 0.85 + 0.15 * sin(uTime * 0.003);
  gl_FragColor = vec4(0.95, 0.92, 0.85, rim * 0.55 * pulse);
}
