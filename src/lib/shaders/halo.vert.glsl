// Home halo vertex — pass normal and eye direction for the rim-light fragment.
varying vec3 vN;
varying vec3 vEye;

void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vEye = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
