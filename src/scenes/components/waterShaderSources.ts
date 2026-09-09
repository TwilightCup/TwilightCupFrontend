/**
 * synthwave2「水面浪潮2」全屏 WebGL 背景的 GLSL 源码。
 *
 * 天空/远山/太阳由 Canvas2D 生成纹理（见 waterSkyTexture.ts），fragment shader
 * 只负责：
 *  - 采样天空纹理 + 程序化闪烁星星；
 *  - 水面波纹法线、平面反射、折射网格、Fresnel/高光/波光合成；
 *  - 原版暗角。
 *
 * 这样天空部分能最大程度还原原版 SVG/CSS 的轮廓和颜色，同时水面保留完整的
 * 实时着色器效果。反射采用屏幕空间平面反射：按地平线镜像采样同一张天空纹理，
 * 再用波面法线扰动采样坐标。
 */
export const WATER_VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const WATER_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;

uniform float uTime;
uniform vec2 uResolution;
uniform sampler2D uSkyTex;

const float HORIZON = 0.502;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float starLayer(vec2 uv, float scale, float density, float seed, float aspect) {
  vec2 p = uv * vec2(scale * aspect, scale);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float rnd = hash21(cell + seed);
  if (rnd < density) return 0.0;
  vec2 starPos = vec2(0.2 + 0.6 * hash21(cell + seed + 11.0), 0.2 + 0.6 * hash21(cell + seed + 23.0));
  float d = length(f - starPos);
  float size = 0.03 + 0.035 * hash21(cell + seed + 31.0);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + rnd * 2.0) + rnd * 40.0);
  return (1.0 - smoothstep(0.0, size, d)) * twinkle;
}

float starField(vec2 uv, float aspect) {
  float s = starLayer(uv, 28.0, 0.974, 1.0, aspect);
  s += starLayer(uv, 46.0, 0.986, 7.0, aspect) * 0.70;
  return s * (1.0 - smoothstep(0.22, 0.36, uv.y));
}

vec3 sampleSky(vec2 uv, float blur) {
  vec2 texel = 1.0 / uResolution;
  vec3 c = texture2D(uSkyTex, uv).rgb * 0.40;
  c += texture2D(uSkyTex, uv + vec2(texel.x * 1.4, 0.0) * blur).rgb * 0.15;
  c += texture2D(uSkyTex, uv - vec2(texel.x * 1.4, 0.0) * blur).rgb * 0.15;
  c += texture2D(uSkyTex, uv + vec2(0.0, texel.y * 1.4) * blur).rgb * 0.15;
  c += texture2D(uSkyTex, uv - vec2(0.0, texel.y * 1.4) * blur).rgb * 0.15;
  return c;
}

vec3 sceneColor(vec2 uv, float aspect, float blur) {
  vec3 col = sampleSky(uv, blur);
  col += vec3(0.90, 0.94, 1.0) * starField(uv, aspect) * 0.75;
  return col;
}

vec3 waterBase(float d) {
  vec3 c = mix(vec3(0.251, 0.063, 0.227), vec3(0.161, 0.031, 0.184), smoothstep(0.0, 0.09, d));
  c = mix(c, vec3(0.082, 0.024, 0.165), smoothstep(0.09, 0.32, d));
  c = mix(c, vec3(0.063, 0.012, 0.173), smoothstep(0.32, 0.62, d));
  c = mix(c, vec3(0.039, 0.004, 0.125), smoothstep(0.62, 1.0, d));
  return c;
}

vec3 gridColor(vec2 uv, float time) {
  if (uv.y <= HORIZON) return vec3(0.0);

  float depth = 1.0 / max(uv.y - HORIZON, 0.001);
  depth = min(depth, 48.0);

  float wx = (uv.x - 0.5) * depth * 2.2;
  // 正值让水平网格线朝镜头（画面下方）滚动，与原版 background-position 增大方向一致。
  float wz = depth * 0.22 + time * 0.28;

  float px = abs(fract(wx) - 0.5);
  float pz = abs(fract(wz) - 0.5);

  float lineX = 1.0 - smoothstep(0.0, 0.030, px);
  float lineZ = 1.0 - smoothstep(0.0, 0.038, pz);
  float glowX = 1.0 - smoothstep(0.0, 0.120, px);
  float glowZ = 1.0 - smoothstep(0.0, 0.150, pz);

  float d = clamp((uv.y - HORIZON) / (1.0 - HORIZON), 0.0, 1.0);
  float fade = smoothstep(0.0, 0.10, d) * (1.0 - 0.15 * d);

  vec3 col = vec3(0.0);
  col += vec3(1.0, 0.42, 0.78) * glowX * fade * 0.28;
  col += vec3(1.0, 0.42, 0.78) * glowZ * fade * 0.20;
  col += vec3(1.0, 0.95, 0.98) * lineX * fade * 1.05;
  col += vec3(1.0, 0.76, 0.92) * lineZ * fade * 0.85;
  col += vec3(1.0, 1.0, 1.0) * lineX * lineZ * fade * 0.55;
  return col;
}

vec2 waveGradient(vec2 uv, float time, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0) * 3.0;
  vec2 grad = vec2(0.0);
  float ph;

  ph = dot(vec2(0.90, 0.42), p) * 1.70 + time * 0.85;
  grad += cos(ph) * vec2(0.90, 0.42) * 0.0260;

  ph = dot(vec2(-0.52, 0.84), p) * 2.40 + time * 1.25;
  grad += cos(ph) * vec2(-0.52, 0.84) * 0.0160;

  ph = dot(vec2(0.34, -0.94), p) * 3.60 + time * 1.75;
  grad += cos(ph) * vec2(0.34, -0.94) * 0.0100;

  ph = dot(vec2(1.00, 0.16), p) * 5.70 + time * 2.40;
  grad += cos(ph) * vec2(1.00, 0.16) * 0.0060;

  return grad;
}

vec3 waterColor(vec2 uv, float time, float aspect) {
  float d = clamp((uv.y - HORIZON) / (1.0 - HORIZON), 0.0, 1.0);
  vec2 grad = waveGradient(uv, time, aspect);

  // 平面反射：镜像采样天空纹理，强度按原版 .water-surface mask 衰减。
  vec2 reflUv = vec2(uv.x, 2.0 * HORIZON - uv.y) + grad * (0.045 + 0.12 * d);
  reflUv.x = clamp(reflUv.x, 0.0, 1.0);
  reflUv.y = clamp(reflUv.y, 0.0, HORIZON);
  vec3 refl = sceneColor(reflUv, aspect, 2.0);
  float reflMask = clamp(1.0 - d * 1.15, 0.0, 1.0) * 0.38;

  // 折射：水下网格按波面法线偏移采样。
  vec2 refrUv = uv + grad * (0.035 + 0.10 * d);
  refrUv.y = max(refrUv.y, HORIZON + 0.0005);
  vec3 grid = gridColor(refrUv, time);

  vec3 col = waterBase(d);
  // 网格尽量保持不透明：只让反射层轻微压暗，避免线条被水色/倒影洗掉。
  col += grid * (1.0 - reflMask * 0.30);
  col = mix(col, refl, reflMask);

  // 太阳高光：细碎、随波纹变化，补足反射层之外的金属感。
  vec3 N = normalize(vec3(-grad.x * 3.0, -grad.y * 3.0, 1.0));
  vec3 V = normalize(vec3((uv - vec2(0.5, HORIZON)) * vec2(aspect, 1.0) * 0.85, 0.10 + d * 1.30));
  vec3 L = normalize(vec3((0.5 - uv.x) * aspect * 1.2, (0.37 - uv.y) * 1.2, 0.55));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 110.0);
  col += vec3(1.0, 0.82, 0.55) * spec * 0.55 * (0.25 + 0.75 * d);

  // 波光：低透明度斜向细纹，避免盖住反射和网格。
  vec2 gp = vec2(uv.x * aspect, uv.y);
  float glint1 = sin((gp.x * 7.0 + gp.y * 18.0) + time * 0.9);
  float glint2 = sin((gp.x * 13.0 - gp.y * 9.0) - time * 1.2);
  float glint = pow(max(0.0, 0.5 + 0.5 * glint1 * glint2), 8.0);
  col += vec3(0.82, 0.95, 1.0) * glint * 0.10 * (0.30 + 0.70 * d);

  // 原版 water-shade：越靠近镜头越深。
  col *= mix(1.0, 0.60, smoothstep(0.15, 1.0, d));
  return col;
}

vec3 applyVignette(vec2 uv, vec3 col) {
  vec2 p = uv - 0.5;
  float r = length(p * vec2(1.0 / 1.20, 1.0 / 0.80));
  float radial = smoothstep(0.46, 1.0, r) * 0.45;
  float top = (1.0 - smoothstep(0.0, 0.18, uv.y)) * 0.16;
  float bottom = smoothstep(0.78, 1.0, uv.y) * 0.10;
  float dark = clamp(radial + top + bottom, 0.0, 0.72);
  return col * (1.0 - dark);
}

void main() {
  // vUv 原点在左下；这里翻成与 CSS 一致的“从上到下”坐标系。
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uResolution.x / max(uResolution.y, 1.0);

  vec3 col;
  if (uv.y <= HORIZON) {
    col = sceneColor(uv, aspect, 0.0);
  } else {
    col = waterColor(uv, uTime, aspect);
  }

  gl_FragColor = vec4(applyVignette(uv, col), 1.0);
}
`;
