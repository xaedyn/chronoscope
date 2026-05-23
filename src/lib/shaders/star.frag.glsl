// Star fragment — Gaussian core + soft halo for the larger ~4% of stars.
varying vec3 vColor;
varying float vSize;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float alpha = smoothstep(0.5, 0.0, d);
  float halo = smoothstep(0.5, 0.15, d) * 0.35;
  gl_FragColor = vec4(vColor, alpha * 0.95 + halo);
}
