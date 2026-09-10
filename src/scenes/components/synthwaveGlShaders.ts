/**
 * synthwave_gl「水面浪潮GL」全屏 WebGL 背景的 GLSL 源码。
 *
 * 画面全部由 fragment shader 程序化生成：
 *  - 天空渐变 + 微闪星空 + 远山剪影；
 *  - 带下半镂空横纹的合成器太阳与霞光；
 *  - 透视霓虹网格持续向镜头滚动；
 *  - 水面波光、波纹扭曲、RGB 色散以及随波晃动的天空/太阳倒影。
 *
 * 只使用 WebGL1 / GLSL ES 1.00，保证 OBS Chromium 浏览器源的兼容性。
 * 不使用云朵、音符等额外装饰，保持纯 synthwave 几何与水面质感。
 */

export const SYNTHWAVE_GL_VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const SYNTHWAVE_GL_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;

#define PI 3.14159265359
#define HORIZON 0.455
#define SUN_POS vec2(0.0, 0.665)
#define SUN_RADIUS 0.152

/* ---------- 基础噪声 / 随机 ---------- */

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise11(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

float fbm11(float x) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * noise11(x);
    x *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

/* 山脊噪声：把 0..1 噪声折成尖峰，得到更有切割感的山脉轮廓。 */
float ridge11(float x, float seed, float frequency) {
  float n = fbm11(x * frequency + seed);
  float ridge = 1.0 - abs(2.0 * n - 1.0);
  return pow(ridge, 1.55);
}

/* ---------- 通用工具 ---------- */

float gridLine(float coord, float width) {
  float d = 0.5 - abs(fract(coord) - 0.5);
  return smoothstep(width, 0.0, d);
}

vec3 horizonGlow(vec2 p) {
  float band = exp(-pow(max(p.y - HORIZON, 0.0) / 0.075, 2.0));
  float center = 1.0 - 0.42 * clamp(abs(p.x) / 0.86, 0.0, 1.0);
  return vec3(1.0, 0.16, 0.56) * band * center * 0.62;
}

/* ---------- 星空 ---------- */

vec3 stars(vec2 p, float t) {
  vec3 color = vec3(0.0);

  for (int layer = 0; layer < 3; layer++) {
    float fi = float(layer);
    float scale = 29.0 + fi * 21.0;
    vec2 sp = p * scale;
    sp.x += fi * 13.7;
    sp.y += fi * 5.9;

    vec2 id = floor(sp);
    vec2 local = fract(sp) - 0.5;
    vec2 jitter = vec2(
      hash12(id + fi * 11.3 + 3.1),
      hash12(id + fi * 7.7 + 19.2)
    ) - 0.5;

    float dist = length(local - jitter * 0.52);
    float star = smoothstep(0.030 + fi * 0.005, 0.0, dist);
    float twinkle = 0.5 + 0.5 * sin(
      t * (0.55 + 1.7 * hash12(id + 5.9)) +
      6.2831 * hash12(id + 23.4)
    );
    float brightness = 0.30 + 0.70 * hash12(id + 31.0);

    color += vec3(0.70, 0.84, 1.0) * star * brightness * (0.30 + 0.70 * twinkle);
  }

  return color;
}

/* ---------- 太阳 ---------- */

vec3 applySun(vec3 sky, vec2 p, float t) {
  vec2 q = p - SUN_POS;
  float dist = length(q);
  float pixel = 1.0 / uResolution.y;
  float disk = smoothstep(SUN_RADIUS + pixel * 1.8, SUN_RADIUS - pixel * 1.8, dist);

  /* 下半圆做横向镂空条纹，越靠下条纹越宽。 */
  float down = clamp((-q.y) / SUN_RADIUS, 0.0, 1.0);
  float band = fract((-q.y) * 38.0);
  float stripeWidth = mix(0.12, 0.50, smoothstep(0.0, 0.96, down));
  float stripeMask = smoothstep(stripeWidth - pixel * 8.0, stripeWidth + pixel * 8.0, band);
  stripeMask = mix(1.0, stripeMask, smoothstep(0.0, 0.035, down));

  float gradient = clamp(down * 1.65, 0.0, 1.0);
  vec3 body = mix(
    vec3(1.0, 0.86, 0.08),
    vec3(1.0, 0.42, 0.10),
    smoothstep(0.0, 0.58, gradient)
  );
  body = mix(
    body,
    vec3(1.0, 0.05, 0.48),
    smoothstep(0.46, 1.0, gradient)
  );
  /* 极轻的呼吸感，避免太阳完全静止。 */
  body *= 0.985 + 0.015 * sin(t * 0.8);

  float glow = exp(-dist * dist * 14.0) * 0.42 + exp(-dist * dist * 60.0) * 0.16;
  float rim = smoothstep(pixel * 2.4, 0.0, abs(dist - SUN_RADIUS));
  float bodyMask = disk * stripeMask;
  float cutAmount = disk * (1.0 - stripeMask);
  float glowMask = 1.0 - disk * 0.86;

  /* 圆面内部用较暗的紫黑作为镂空条纹底色，避免条纹被亮天空冲淡。 */
  vec3 stripeBack = sky * 0.16 + vec3(0.045, 0.0, 0.085);
  vec3 base = mix(sky, stripeBack, disk);

  /* 用 mix 而不是加法：太阳圆面真正覆盖天空，颜色更饱满；
     镂空条纹处透出较暗的霞光，边缘保留辉光与描边。 */
  vec3 color = mix(base, body, bodyMask);
  color += vec3(1.0, 0.20, 0.56) * glow * glowMask * (1.0 - 0.70 * cutAmount);
  color += vec3(1.0, 0.80, 0.44) * rim * 0.20;

  return color;
}

/* ---------- 天空 / 远山 ---------- */

vec3 skyGradient(vec2 p) {
  float sky = clamp((p.y - HORIZON) / (1.0 - HORIZON), 0.0, 1.0);

  vec3 color = mix(
    vec3(1.0, 0.10, 0.52),
    vec3(0.48, 0.07, 0.70),
    smoothstep(0.0, 0.30, sky)
  );
  color = mix(
    color,
    vec3(0.055, 0.004, 0.16),
    smoothstep(0.25, 0.98, sky)
  );
  color += vec3(0.22, 0.025, 0.34) * exp(-pow((sky - 0.12) / 0.20, 2.0));
  color += vec3(0.95, 0.32, 0.10) * exp(-pow(max(p.y - HORIZON, 0.0) / 0.085, 2.0)) * 0.34;

  return max(color, 0.0);
}

vec3 skyColor(vec2 p, float t, float starStrength) {
  vec3 color = skyGradient(p);

  float starMask = smoothstep(HORIZON + 0.015, HORIZON + 0.20, p.y);
  color += stars(p, t) * starMask * starStrength;
  color += horizonGlow(p);

  /* 太阳在远山之前，远山可以压住太阳最底部。 */
  color = applySun(color, p, t);

  float pixel = 1.0 / uResolution.y;
  float aa = pixel * 3.2;

  /* 中间留出较低的谷地，让太阳下缘和镂空条纹完整露出；
     两侧山脉逐渐抬高，形成参考图里的远山围合感。 */
  float sideLift = smoothstep(0.0, 0.48, abs(p.x));
  float farHeight = HORIZON + 0.004 +
    0.190 * ridge11(p.x, 13.1, 2.45) * (0.18 + 0.82 * sideLift);
  float midHeight = HORIZON - 0.008 +
    0.118 * ridge11(p.x, 47.3, 5.60) * (0.30 + 0.70 * sideLift);
  float nearHeight = HORIZON - 0.020 +
    0.060 * ridge11(p.x, 91.7, 10.50) * (0.45 + 0.55 * sideLift);

  float farMask = smoothstep(farHeight + aa, farHeight - aa, p.y);
  float midMask = smoothstep(midHeight + aa, midHeight - aa, p.y);
  float nearMask = smoothstep(nearHeight + aa, nearHeight - aa, p.y);

  color = mix(color, vec3(0.44, 0.10, 0.58), farMask);
  color = mix(color, vec3(0.23, 0.030, 0.40), midMask);
  color = mix(color, vec3(0.095, 0.005, 0.19), nearMask);

  /* 山脚与地平线之间留一条暖色霞光。 */
  float baseGlow = exp(-abs(p.y - HORIZON) * 26.0) * 0.20;
  color += vec3(1.0, 0.32, 0.52) * baseGlow * (1.0 - 0.35 * clamp(abs(p.x), 0.0, 1.0));

  return color;
}

/* ---------- 水面 / 霓虹网格 ---------- */

vec3 water(vec2 p, float t) {
  float depth = max(HORIZON - p.y, 0.0005);

  /* 水面波动：低频大浪 + 高频细纹；越靠近镜头振幅越大。 */
  float waveA = sin(p.x * 8.3 + p.y * 17.0 + t * 1.55);
  float waveB = sin(p.x * 21.0 - p.y * 11.0 + t * 2.70);
  float waveC = cos(p.x * 12.5 - p.y * 23.0 + t * 2.05);
  float waveD = sin(p.x * 34.0 + p.y * 9.0 + t * 3.35);

  float rippleX = (waveA * 0.55 + waveB * 0.28 + waveD * 0.17) * 0.014 *
    (0.25 + 1.85 * sqrt(depth));
  float rippleY = (waveC * 0.62 + waveB * 0.22 - waveD * 0.16) * 0.010 *
    (0.22 + 1.70 * sqrt(depth));

  vec2 waterP = p + vec2(rippleX, rippleY);

  /* 透视网格：gx 控制竖线向灭点收敛，gz 控制横线滚动。
     时间项带来持续的“向摄像机方向滚动”效果。 */
  float persp = 1.0 / (depth + 0.035);
  float gridScale = 6.8;
  float gx = waterP.x * persp * gridScale;
  float gz = persp * 1.10 + t * 0.52;

  /* 色散：R/B 通道采样位置略微错开，网格边缘出现彩色分离。 */
  float chroma = 0.0020 + 0.0040 * smoothstep(0.0, 0.48, depth);
  vec2 chromaOffset = vec2(chroma, chroma * 0.34);

  float vertR = gridLine((waterP.x + chromaOffset.x) * persp * gridScale, 0.032);
  float vertG = gridLine(waterP.x * persp * gridScale, 0.032);
  float vertB = gridLine((waterP.x - chromaOffset.x) * persp * gridScale, 0.032);

  float horizR = gridLine(gz + chromaOffset.y, 0.024);
  float horizG = gridLine(gz, 0.024);
  float horizB = gridLine(gz - chromaOffset.y, 0.024);

  vec3 verticalNeon = vec3(vertR, vertG, vertB) * vec3(1.00, 0.08, 0.74);
  vec3 horizontalNeon = vec3(horizR, horizG, horizB) * vec3(0.28, 0.62, 1.00);

  /* 地平线附近淡出，避免网格采样过密产生闪烁。 */
  float gridFade = smoothstep(0.0, 0.045, depth) *
    (0.60 + 0.40 * smoothstep(0.0, 0.42, depth));
  vec3 grid = (verticalNeon * 1.35 + horizontalNeon * 0.86) * gridFade * 1.02;

  /* 宽而柔的辉光层：让霓虹线像参考图一样发光，而不是只有一根细线。 */
  grid += vec3(1.0, 0.08, 0.70) * gridLine(waterP.x * persp * gridScale, 0.095) *
    gridFade * 0.11;
  grid += vec3(0.32, 0.72, 1.0) * gridLine(gz, 0.075) * gridFade * 0.075;

  /* 网格中心轴线更亮，强化透视纵深。 */
  grid += vec3(1.0, 0.14, 0.80) * exp(-abs(p.x) * 76.0) * gridFade * 0.48;

  /* 波光粼粼：高频交叠波纹，形成细碎、不规则的亮点；
     另外用低频波缓慢调制倒影亮度。 */
  float reflShimmer = 0.5 + 0.5 *
    sin(p.x * 13.0 + p.y * 19.0 + t * 1.10) *
    sin(p.x * 7.0 - p.y * 23.0 - t * 1.70);

  float shimmer = pow(max(
    sin(p.x * 180.0 + p.y * 230.0 + t * 4.20) *
    sin(p.x * 130.0 - p.y * 190.0 - t * 3.10), 0.0), 4.0);

  /* 倒影：把画面按地平线镜像后，再叠加水面波动和色散偏移。
     反射整体压暗，并用 shimmer 打碎太阳倒影，避免水面过曝。 */
  float mirrorY = 2.0 * HORIZON - p.y;
  vec2 reflectP = vec2(
    p.x + rippleX * 2.35,
    mirrorY + rippleY * 2.15
  );
  vec3 reflection = skyColor(reflectP, t, 0.0);
  float reflectFade = 1.0 - smoothstep(0.0, 0.34, depth);
  reflection *= reflectFade * (0.42 + 0.18 * reflShimmer) * (0.90 + 0.10 * sin(t * 0.9));
  reflection = mix(reflection, reflection * vec3(0.55, 0.40, 1.0), 0.30);

  vec3 glints = vec3(1.0, 0.74, 0.96) * shimmer * 0.16 * reflectFade;

  /* 水面底色：地平线附近偏亮紫，越靠近镜头越深。 */
  vec3 base = mix(
    vec3(0.16, 0.012, 0.24),
    vec3(0.006, 0.0, 0.030),
    smoothstep(0.0, 0.46, depth)
  );
  base += vec3(1.0, 0.18, 0.52) * exp(-depth * 30.0) * 0.16;

  vec3 color = base + reflection * 0.58 + grid + glints;

  /* 太阳在水面的垂直光柱：随深度变宽、随波光轻微闪烁，强化“夕阳入水”的倒影。 */
  float sunColumn = exp(-abs(p.x) * (8.0 + 15.0 * depth)) *
    smoothstep(0.0, 0.055, depth) *
    (1.0 - smoothstep(0.08, 0.43, depth)) *
    (0.55 + 0.45 * reflShimmer);
  color += vec3(1.0, 0.40, 0.70) * sunColumn * 0.30;

  color += vec3(0.85, 0.22, 0.62) * exp(-depth * 30.0) * 0.18;

  return color;
}

/* ---------- 主入口 ---------- */

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  float t = uTime;

  vec3 color;
  if (uv.y >= HORIZON) {
    color = skyColor(p, t, 1.0);
  } else {
    color = water(p, t);
  }

  /* 最上、最下压深；中间保留明亮的地平线 / 水面。 */
  float centerLift = smoothstep(0.0, 0.30, uv.y) *
    (1.0 - smoothstep(0.72, 1.0, uv.y));
  float verticalShade = mix(0.25, 1.0, centerLift);
  color *= verticalShade;
  color = mix(vec3(0.010, 0.0, 0.032), color, 0.40 + 0.60 * centerLift);

  float nx = uv.x * 2.0 - 1.0;
  float sideShade = 1.0 - 0.20 * pow(clamp(abs(nx), 0.0, 1.0), 2.4);
  color *= sideShade;

  color = max(color, vec3(0.0));
  /* 指数色调映射：压住太阳 / 网格高光，保留更多中间调颜色。 */
  color *= 1.35;
  color = 1.0 - exp(-color * 1.55);
  color = pow(clamp(color, 0.0, 1.0), vec3(0.92));
  gl_FragColor = vec4(color, 1.0);
}
`;
