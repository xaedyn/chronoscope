// Star field — additive point sprites at depth, sphere-shell distributed.
// Each star carries position + color (via vertexColors) + size attribute.
// Size attenuates by view-space depth so distant stars get smaller.
attribute float size;
varying vec3 vColor;
varying float vSize;
uniform float uTime;

void main() {
  vColor = color;
  vSize = size;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * 200.0 / -mv.z;
}
