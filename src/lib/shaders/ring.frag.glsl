// Sweep-aware orbital ring — fragment computes its own angular position via
// atan2 and brightens against the uSweep uniform with exponential falloff.
// This is what makes the orbit visibly "energize" when the sweep beam passes.
//
// uGapStarts / uGapEnds / uGapCount: arcs where pulses are missing (carrier
// lost). In each gap arc, the ring renders crimson (uGapColor) at full
// intensity, signalling the absence to the operator. Used by the
// EndpointErrorView surface to highlight missed-pulse regions.
#define MAX_GAPS 8

varying vec2 vPos;
uniform float uSweep;
uniform float uOpacity;
uniform vec3 uColor;
uniform float uGapStarts[MAX_GAPS];
uniform float uGapEnds[MAX_GAPS];
uniform int uGapCount;
uniform vec3 uGapColor;

bool inGap(float a) {
  for (int i = 0; i < MAX_GAPS; i++) {
    if (i >= uGapCount) break;
    float s = uGapStarts[i];
    float e = uGapEnds[i];
    if (s <= e) {
      if (a >= s && a <= e) return true;
    } else {
      // Wraps around -pi/+pi boundary
      if (a >= s || a <= e) return true;
    }
  }
  return false;
}

void main() {
  float a = atan(vPos.y, vPos.x);
  float diff = a - uSweep;
  diff = mod(diff + 3.14159265, 6.2831853) - 3.14159265;
  float behind = clamp(-diff / 6.2831853 * 4.0, 0.0, 1.0);
  float hot = exp(-behind * 6.0);
  float base = 0.30;

  if (uGapCount > 0 && inGap(a)) {
    // Crimson alarm fill — full opacity, slightly brightened by sweep
    gl_FragColor = vec4(uGapColor, (0.85 + hot * 0.4) * uOpacity);
  } else {
    gl_FragColor = vec4(uColor, (base + hot * 1.6) * uOpacity);
  }
}
