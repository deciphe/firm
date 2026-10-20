
/**
 * The world behind the table: slow swirling ink smoke rendered as a stipple halftone, with a
 * stippled moon. Every pixel is a dot; dot size follows brightness. Money moments tint it.
 */
/**
 * The world behind the table: Balatro-style flowing paint. A slow polar swirl warped through a few sine
 * passes, banded into three colours (ink, deep felt green, Claude clay), rendered in chunky pixels.
 * Money moments tint and speed it; Heat drags it toward red.
 */
export const BG_FRAG = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float uPix;
uniform vec4 uPulse;
uniform float uHeat;
uniform float uSpin;
varying vec2 fragCoord;

void main() {
  vec2 px = floor(fragCoord / uPix) * uPix + 0.5 * uPix;
  vec2 uv = (px - 0.5 * resolution) / length(resolution) * 1.6;
  float t = time * 0.18 + uSpin;
  float r = length(uv);
  float a = atan(uv.y, uv.x) - t * 0.35 + 3.0 * r * (0.55 + 0.1 * sin(t * 0.3));
  uv = vec2(cos(a), sin(a)) * r;
  uv *= 30.0;
  vec2 u2 = uv;
  float speed = t * 2.0;
  for (int i = 0; i < 5; i++) {
    u2 += sin(max(u2.x, u2.y)) + uv;
    uv += 0.5 * vec2(cos(5.1123314 + 0.353 * u2.y + speed * 0.131121), sin(u2.x - 0.113 * speed));
    uv -= 1.0 * cos(uv.x + uv.y) - 1.0 * sin(uv.x * 0.711 - uv.y);
  }
  float paint = min(2.0, max(0.0, length(uv) * 0.035 * 0.75));
  float c1p = max(0.0, 1.0 - 2.0 * abs(1.0 - paint));
  float c2p = max(0.0, 1.0 - 2.0 * paint);
  float c3p = 1.0 - min(1.0, c1p + c2p);

  vec3 ink = vec3(0.035, 0.04, 0.045);
  vec3 felt = mix(vec3(0.07, 0.24, 0.20), vec3(0.42, 0.10, 0.09), uHeat);
  vec3 clay = vec3(0.85, 0.47, 0.34);
  vec3 col = 0.30 * clay * c1p + 0.92 * felt * c2p + ink * c3p * 1.2;
  col = mix(col, uPulse.rgb, uPulse.a * 0.22 * (c1p + 0.4 * c2p));
  // gentle vignette so the table reads
  vec2 d = fragCoord / resolution - 0.5;
  col *= 1.0 - dot(d, d) * 1.1;
  gl_FragColor = vec4(col, 1.0);
}`;

/** CRT finish over the whole game: faint scanlines, slight curvature, colour fringe, vignette, grain. */
const CRT_FRAG = `
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDpr;
uniform float uShake;
varying vec2 outTexCoord;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 o = abs(uv.yx) / vec2(14.0, 11.0);
  uv = uv + uv * o * o;
  return uv * 0.5 + 0.5;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = curve(outTexCoord);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float ca = (0.00045 + uShake * 0.003);
  vec2 dir = uv - 0.5;
  float r = texture2D(uMainSampler, uv + dir * ca).r;
  float g = texture2D(uMainSampler, uv).g;
  float b = texture2D(uMainSampler, uv - dir * ca).b;
  vec3 col = vec3(r, g, b);
  float line = 0.5 + 0.5 * sin(uv.y * uResolution.y * 3.14159 / (1.5 * uDpr));
  col *= 1.0 - 0.055 * line;
  float v = 1.0 - dot(dir, dir) * 0.55;
  col *= v;
  col += (hash(uv * uResolution + uTime) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`;

export class CrtPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  dpr = 1;
  shake = 0;
  constructor(game: Phaser.Game) {
    super({ game, name: 'CrtPipeline', fragShader: CRT_FRAG });
  }
  onPreRender(): void {
    this.set1f('uTime', this.game.loop.time / 1000);
    this.set2f('uResolution', this.renderer.width, this.renderer.height);
    this.set1f('uDpr', this.dpr);
    this.set1f('uShake', this.shake);
  }
}
