/**
 * 用 Canvas2D 精确复刻原版 synthwave 预设的上半屏（天空渐变 / 远山 / 太阳），
 * 作为 WebGL 天空与水面反射的纹理源。
 *
 * 之所以不继续在 GLSL 里程序化画山和太阳，是因为原版是 SVG 路径 + CSS 渐变；
 * 用 Canvas2D 直接复用同一组 path 数据，可以最大程度保证「WebGL 版看起来和原版
 * 完全一致」，而 WebGL 只负责水面的波纹 / 反射 / 折射。
 *
 * 星星不画进纹理，而是由 fragment shader 程序化闪烁；这样天空和倒影里的星星
 * 都能保持动态。
 */

const SKY_HEIGHT_RATIO = 0.55;
/** 原版 .mountains：bottom:49.8%; height:13%（bottom 从视口底部算起）。 */
const MOUNTAIN_BOTTOM_FROM_BOTTOM = 0.498;
const MOUNTAIN_HEIGHT = 0.13;
/** 原版 .sun-svg：bottom:45%; width/height:36vmin（16:9 下 vmin=height） */
const SUN_CENTER_X = 0.5;
const SUN_CENTER_Y = 0.37;
const SUN_RADIUS = 0.18;

const MOUNTAIN_PATHS = [
  {
    fill: "#5a1773",
    d: "M0 190 L70 132 L118 170 L190 90 L248 150 L330 120 L400 178 L470 102 L560 162 L650 96 L720 158 L800 128 L880 178 L960 90 L1040 162 L1120 122 L1200 182 L1290 104 L1380 160 L1460 120 L1540 180 L1640 100 L1730 160 L1810 124 L1920 184 L1920 260 L0 260 Z",
  },
  {
    fill: "#380b5c",
    d: "M0 210 L100 158 L190 206 L280 142 L360 202 L470 150 L560 210 L660 154 L760 208 L860 148 L960 204 L1080 152 L1180 214 L1280 158 L1380 210 L1480 146 L1580 214 L1690 160 L1780 208 L1920 176 L1920 260 L0 260 Z",
  },
  {
    fill: "#23083d",
    d: "M0 238 L120 190 L240 236 L360 186 L480 238 L600 194 L720 240 L840 188 L960 236 L1080 192 L1200 240 L1320 190 L1440 238 L1560 194 L1680 240 L1800 194 L1920 228 L1920 260 L0 260 Z",
  },
];

/** 原版 sun SVG mask 里的横条（viewBox 200×200，圆心 100,100，半径 98）。 */
const SUN_STRIPES = [
  { y: 112, h: 3 },
  { y: 122, h: 3 },
  { y: 132, h: 3 },
  { y: 142, h: 4 },
  { y: 153, h: 4 },
  { y: 164, h: 4 },
  { y: 176, h: 5 },
  { y: 188, h: 6 },
];

function fillSkyGradient(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const skyHeight = height * SKY_HEIGHT_RATIO;
  const gradient = ctx.createLinearGradient(0, 0, 0, skyHeight);
  gradient.addColorStop(0, "#08010f");
  gradient.addColorStop(0.24, "#100224");
  gradient.addColorStop(0.44, "#2a0a4c");
  gradient.addColorStop(0.56, "#6b1565");
  gradient.addColorStop(0.66, "#c32280");
  gradient.addColorStop(0.76, "#ff4d9b");
  gradient.addColorStop(1, "#ff2e88");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawMountains(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const top = height * (1 - MOUNTAIN_BOTTOM_FROM_BOTTOM - MOUNTAIN_HEIGHT);
  const scaleY = (height * MOUNTAIN_HEIGHT) / 260;
  const scaleX = width / 1920;

  for (const layer of MOUNTAIN_PATHS) {
    ctx.save();
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, top);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = layer.fill;
    ctx.shadowColor = "rgba(255, 46, 136, 0.18)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = -2;
    ctx.fill(new Path2D(layer.d));
    ctx.restore();
  }
}

function drawSun(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const cx = width * SUN_CENTER_X;
  const cy = height * SUN_CENTER_Y;
  const radius = height * SUN_RADIUS;

  // 太阳外圈辉光：对应原版 SVG 的 drop-shadow 暖色光晕（比之前更紧、更淡）。
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.92, cx, cy, radius * 1.55);
  glow.addColorStop(0, "rgba(255, 46, 136, 0.18)");
  glow.addColorStop(0.55, "rgba(255, 138, 61, 0.07)");
  glow.addColorStop(1, "rgba(255, 46, 136, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.55, 0, Math.PI * 2);
  ctx.fill();

  // 太阳本体：线性渐变 + 下半部分横条切割。
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  const sunGradient = ctx.createLinearGradient(cx, cy - radius, cx, cy + radius);
  sunGradient.addColorStop(0, "#fff3af");
  sunGradient.addColorStop(0.42, "#ffd166");
  sunGradient.addColorStop(0.72, "#ff8a3d");
  sunGradient.addColorStop(1, "#ff2e88");
  ctx.fillStyle = sunGradient;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  // viewBox 200 → 实际半径 radius：scale = radius / 100。
  // 用 destination-out 把横条位置“挖空”，让后面的天空/远山透出来；
  // 原版 SVG mask 里的黑条也是透明孔洞，而不是黑色线条。
  const stripeScale = radius / 100;
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000000";
  for (const stripe of SUN_STRIPES) {
    const y = cy + (stripe.y - 100) * stripeScale;
    ctx.fillRect(cx - radius, y, radius * 2, stripe.h * stripeScale);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

/**
 * 生成一张和当前 WebGL 画布同尺寸的天空纹理。
 * 调用方只在初始化/尺寸变化时调用，不需要每帧重绘。
 */
export function createWaterSkyCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  fillSkyGradient(ctx, canvas.width, canvas.height);
  drawMountains(ctx, canvas.width, canvas.height);
  drawSun(ctx, canvas.width, canvas.height);

  // 太阳横条是用 destination-out 挖出的透明孔；Canvas 上传到 WebGL 后透明像素
  // 的 RGB 为 0（会显示成黑线）。这里用 destination-over 把天空/远山重新画到
  // 这些透明孔里，效果等价于原版 SVG mask 的“镂空后透出背景”。
  ctx.globalCompositeOperation = "destination-over";
  fillSkyGradient(ctx, canvas.width, canvas.height);
  drawMountains(ctx, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}
