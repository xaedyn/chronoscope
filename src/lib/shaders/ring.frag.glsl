// Sweep-aware orbital ring — fragment computes its own angular position via
// atan2 and brightens against the uSweep uniform with exponential falloff.
// This is what makes the orbit visibly "energize" when the sweep beam passes.
varying vec2 vPos;
uniform float uSweep;
uniform float uOpacity;
uniform vec3 uColor;

void main() {
  float a = atan(vPos.y, vPos.x);
  float diff = a - uSweep;
  // Wrap diff into [-pi, pi] so the falloff trails behind the sweep
  diff = mod(diff + 3.14159265, 6.2831853) - 3.14159265;
  float behind = clamp(-diff / 6.2831853 * 4.0, 0.0, 1.0);
  float hot = exp(-behind * 6.0);
  float base = 0.30;
  gl_FragColor = vec4(uColor, (base + hot * 1.6) * uOpacity);
}
