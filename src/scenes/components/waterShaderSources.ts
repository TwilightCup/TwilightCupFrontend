/**
 * synthwave2「水面浪潮2」全屏 WebGL 背景的 GLSL 源码。
 *
 * 全部为程序化绘制，不依赖外部贴图/字体/网络资源，OBS 浏览器源可离线运行。
 * 场景分三层：
 *  - 上半屏 sceneColor()：天空渐变、星星、远山、太阳；
 *  - 下半屏 waterColor()：程序化波面法线 + 平面反射 + 折射网格 + Fresnel 合成；
 *  - gridColor()：水下霓虹网格，随波面法线发生折射偏移。
 *
 * 反射采用屏幕空间平面反射：把水面像素按地平线镜像到上半屏，再用波面法线
 * 扰动采样坐标。它等价于一次平面镜反射采样，不是逐波面光追；对 1080p 实时
 * 背景来说这是性能/效果最平衡的做法。
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

const float HORIZON = 0.502;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise21(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 skyColor(float t) {
  vec3 c = mix(vec3(0.031, 0.004, 0.059), vec3(0.063, 0.008, 0.141), clamp(t / 0.24, 0.0, 1.0));
  c = mix(c, vec3(0.165, 0.039, 0.298), clamp((t - 0.24) / 0.20, 0.0, 1.0));
  c = mix(c, vec3(0.420, 0.082, 0.396), clamp((t - 0.44) / 0.12, 0.0, 1.0));
  c = mix(c, vec3(0.765, 0.133, 0.502), clamp((t - 0.56) / 0.10, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.302, 0.608), clamp((t - 0.66) / 0.10, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.180, 0.533), clamp((t - 0.76) / 0.24, 0.0, 1.0));
  return c;
}

float ridge(float x, float seed) {
  float v = 0.5 + 0.5 * sin(x * 1.7 + seed * 2.1);
  v += 0.22 * sin(x * 4.3 + seed * 3.7);
  v += 0.12 * sin(x * 9.1 + seed * 5.3);
  v += (noise21(vec2(x * 3.0, seed * 7.0)) - 0.5) * 0.45;
  return clamp(v, 0.0, 1.0);
}

vec4 mountains(vec2 uv) {
  vec4 result = vec4(0.0);
  if (uv.y < HORIZON) {
    float backTop = mix(HORIZON, 0.382, ridge(uv.x * 3.1, 1.0));
    if (uv.y > backTop) {
      result = vec4(0.353, 0.090, 0.451, 1.0);
    }
    float midTop = mix(HORIZON, 0.402, ridge(uv.x * 4.3, 2.0));
    if (uv.y > midTop) {
      result = vec4(0.220, 0.043, 0.361, 1.0);
    }
    float frontTop = mix(HORIZON, 0.422, ridge(uv.x * 5.7, 3.0));
    if (uv.y > frontTop) {
      result = vec4(0.137, 0.031, 0.239, 1.0);
    }
  }
  return result;
}

vec3 sunColor(vec2 uv, float aspect) {
  vec2 center = vec2(0.5, 0.37);
  float radius = 0.18;
  vec2 p = (uv - center) * vec2(aspect, 1.0);
  float d = length(p);
  float inside = 1.0 - smoothstep(radius - 0.003, radius, d);
  float t = clamp((uv.y - (center.y - radius)) / (2.0 * radius), 0.0, 1.0);

  vec3 col = mix(vec3(1.0, 0.953, 0.686), vec3(1.0, 0.820, 0.400), smoothstep(0.0, 0.42, t));
  col = mix(col, vec3(1.0, 0.541, 0.239), smoothstep(0.42, 0.72, t));
  col = mix(col, vec3(1.0, 0.180, 0.533), smoothstep(0.72, 1.0, t));

  float stripePhase = fract((uv.y - (center.y - radius)) * 52.0);
  float stripe = smoothstep(0.02, 0.06, abs(stripePhase - 0.5));
  float stripeMask = smoothstep(0.47, 0.56, t);
  col *= mix(1.0, 0.0, stripe * stripeMask);

  float glow = exp(-max(d - radius, 0.0) * 7.0) * 0.32;
  glow += exp(-max(d - radius, 0.0) * 2.0) * 0.10;
  return col * inside + vec3(1.0, 0.45, 0.60) * glow;
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
  float s = starLayer(uv, 24.0, 0.970, 1.0, aspect);
  s += starLayer(uv, 42.0, 0.985, 7.0, aspect) * 0.70;
  return s * (1.0 - smoothstep(0.34, 0.48, uv.y));
}

vec3 sceneColor(vec2 uv, float aspect) {
  vec3 col = skyColor(clamp(uv.y / 0.55, 0.0, 1.0));
  col += vec3(0.90, 0.94, 1.0) * starField(uv, aspect) * 0.85;

  vec4 m = mountains(uv);
  col = mix(col, m.rgb, m.a);

  col += sunColor(uv, aspect);

  float horizonGlow = exp(-abs(uv.y - HORIZON) * 90.0);
  col += vec3(1.0, 0.25, 0.58) * horizonGlow * 0.16;
  return col;
}

vec3 gridColor(vec2 uv, float time) {
  if (uv.y <= HORIZON) return vec3(0.0);

  float depth = 1.0 / max(uv.y - HORIZON, 0.001);
  depth = min(depth, 60.0);

  float wx = (uv.x - 0.5) * depth * 0.55;
  float wz = depth * 0.80 - time * 0.90;

  float lineX = 1.0 - smoothstep(0.0, 0.060, abs(fract(wx) - 0.5));
  float lineZ = 1.0 - smoothstep(0.0, 0.060, abs(fract(wz) - 0.5));

  float d = clamp((uv.y - HORIZON) / (1.0 - HORIZON), 0.0, 1.0);
  float fade = exp(-depth * 0.12) * (0.55 + 0.45 * (1.0 - d));

  vec3 col = vec3(0.0);
  col += vec3(0.13, 0.89, 1.0) * lineX * fade * 1.15;
  col += vec3(1.0, 0.37, 0.78) * lineZ * fade * 0.95;
  col += vec3(1.0, 1.0, 1.0) * lineX * lineZ * fade * 0.75;
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

  vec3 N = normalize(vec3(-grad.x * 3.2, -grad.y * 3.2, 1.0));
  vec3 V = normalize(vec3((uv - vec2(0.5, HORIZON)) * vec2(aspect, 1.0) * 0.90, 0.12 + d * 1.25));
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fresnel = mix(0.18, 0.94, fresnel);

  vec2 reflUv = vec2(uv.x, 2.0 * HORIZON - uv.y) + grad * (0.07 + 0.25 * d);
  reflUv.x = clamp(reflUv.x, 0.0, 1.0);
  reflUv.y = clamp(reflUv.y, 0.0, HORIZON);
  vec3 refl = sceneColor(reflUv, aspect);

  vec2 refrUv = uv + grad * (0.045 + 0.15 * d);
  refrUv.y = max(refrUv.y, HORIZON + 0.0005);
  vec3 refr = gridColor(refrUv, time);

  vec3 water = mix(refr, refl, fresnel);

  vec3 deep = vec3(0.035, 0.008, 0.095);
  water = mix(water, deep, smoothstep(0.18, 1.0, d) * 0.45);

  vec3 L = normalize(vec3((0.5 - uv.x) * aspect * 1.4, (0.37 - uv.y) * 1.4, 0.75));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 120.0);
  water += vec3(1.0, 0.86, 0.62) * spec * 1.8;

  float glintNoise = fbm(uv * vec2(aspect, 1.0) * 16.0 + vec2(time * 0.12, -time * 0.09));
  float glint = pow(glintNoise, 3.0) * (0.25 + 0.75 * d);
  water += vec3(0.82, 0.95, 1.0) * glint * 0.12;

  float horizonGlow = exp(-abs(uv.y - HORIZON) * 90.0);
  water += vec3(1.0, 0.35, 0.62) * horizonGlow * 0.45;
  return water;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec3 col;
  if (uv.y <= HORIZON) {
    col = sceneColor(uv, aspect);
  } else {
    col = waterColor(uv, uTime, aspect);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
