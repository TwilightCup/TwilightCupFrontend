<script setup lang="ts">
/**
 * 多关偏差条：以游标为界，左侧填 A 主题色、右侧填 B 主题色；白色竖向游标
 * （直角、不出条体）+ 游标正下方（条外）跟随移动的偏差值（纯白绝对值，
 * 不足 1 分钟显示 S.cc（秒不补零），达到 1 分钟后进位为 M:SS.cc（秒固定两位）。
 *
 * 数据源：subsegment 实时时间差（subsegment_gap 广播，最近一条直接覆盖；
 * 机制见 ignored/需求-subsegment实时时间差追踪与前端接入.md）。回合结束 /
 * 新回合由外层清空（diffMs 归 0）。
 *
 * 条体直角无描边、满宽，上缘由外层贴紧选手画面下缘。偏差值随游标移动，
 * 但水平位置经 clamp 限制在画面内（触边时向内收，不再溢出屏幕）。
 *
 * diffMs 有符号：正 = B 落后（游标向 B/右侧），负 = A 落后（向左侧）。
 * 游标随偏差线性移动，|diff| = gapMs（默认 60s）时触边钉住；偏差值无上限继续增长。
 * 触边钉住后：游标在边缘持续轻微抖动（transform，~9Hz，基幅 ±3px、每次抖动
 * 叠加微小随机偏移，避开 left 的 0.3s 过渡），并按钉住侧持续喷射尾焰（见 frame 内触边分支）。
 *
 * 游标喷射粒子：移动时留下"尾焰"——向 B 侧推进（A 方领地扩张）在游标左侧
 * 向左喷 A 色三角形线框颗粒，向 A 侧推进在右侧向右喷 B 色（canvas 层，见下）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  /** 有符号偏差（毫秒）：正 = B 落后，负 = A 落后 */
  diffMs: number;
  /** 满偏对应的偏差绝对值（毫秒） */
  gapMs: number;
}>();

/** 游标偏移百分比：±50 = 触边 */
const offsetPct = computed(() => {
  const ratio = Math.max(-1, Math.min(1, props.diffMs / props.gapMs));
  return ratio * 50;
});

/** 偏差值文本：绝对值，不足 1 分钟 S.cc（秒不补零）；≥1 分钟 M:SS.cc（秒固定两位，如 1:01.11） */
const diffText = computed(() => {
  const cs = Math.max(0, Math.round(Math.abs(props.diffMs) / 10));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const tail = `${m > 0 ? String(s).padStart(2, "0") : s}.${String(c).padStart(2, "0")}`;
  return m > 0 ? `${m}:${tail}` : tail;
});

// ---- 偏差值水平限位：量取自身半宽，clamp 在 [半宽, 100%−半宽] 内 ----
const valueEl = ref<HTMLElement | null>(null);
const valueHalfW = ref(0);
let ro: ResizeObserver | null = null;

const valueLeft = computed(
  () =>
    `clamp(${valueHalfW.value}px, calc(50% + ${offsetPct.value}%), calc(100% - ${valueHalfW.value}px))`,
);

// ---- 游标喷射粒子 ----
// 逐帧采样游标实际渲染位置（getComputedStyle 可读到 0.3s 过渡的逐帧插值），
// 与上一帧之差即移动方向与速度：向 B（右）→ 在游标左侧向左喷 A 色粒子，
// 向 A（左）→ 右侧向右喷 B 色。粒子为三角形线框颗粒（canvas 覆盖条体，
// 宽窄双遍描边成辉光，普通 alpha 混合）：初始大小 / 透明度 / 朝向小幅随机，
// 飞行中自转，随剩余寿命等比缩小并淡出，喷出后 0.5–1s 内完全消失并即刻
// 从数组移除；游标静止时不喷射、空闲时不清屏。
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 初始外接圆半径（px），绘制时随剩余寿命等比缩小 */
  size: number;
  /** 剩余 / 总寿命（秒），总寿命 0.5–1s；寿命比例同时驱动缩小与淡出 */
  life: number;
  ttl: number;
  /** 朝向（弧度）与自转角速度（rad/s） */
  angle: number;
  spin: number;
  /** 初始透明度，随剩余寿命线性衰减到 0 */
  alpha0: number;
  /** 主题色侧：a = 蓝（--syn-a）、b = 红（--syn-b） */
  side: "a" | "b";
}

const cursorEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

let ctx: CanvasRenderingContext2D | null = null;
let cw = 0;
let ch = 0;
// 主题色从场景 :root 继承读取，读不到时按 scene-theme.css 约定常量兜底
let colorA = "#3d8bff";
let colorB = "#ff6b4a";
// 粒子线框与辉光均用向白提亮的主题色：本色线框叠在同色填色上不够明显
let coreA = "#3d8bff";
let coreB = "#ff6b4a";
let particles: Particle[] = [];
let rafId = 0;
let lastFrame = 0;
let lastCursorX: number | null = null;
/** 上一帧是否画过粒子：空闲时只在画过后的第一帧 clear 一次 */
let painted = false;
/** 触边抖动是否激活（用于退出抖动时复位 transform） */
let shakeOn = false;
/** 当前抖动的幅度（px）：基幅 3px + 每次抖动（半个正弦周期）重掷的 ±0.8px 随机偏移 */
let shakeAmp = 3;
/** 当前抖动半周期序号（phase / π 向下取整），变化时重掷幅度偏移 */
let lastShakeCycle = -1;

/** #rrggbb 向白混合（t ∈ [0,1]）；非 6 位 hex 原样返回，提亮失败时退回本色 */
function brighten(hex: string, t: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const mix = (ch: number) => Math.round(ch + (255 - ch) * t);
  return `rgb(${mix(parseInt(m[1].slice(0, 2), 16))}, ${mix(parseInt(m[1].slice(2, 4), 16))}, ${mix(parseInt(m[1].slice(4, 6), 16))})`;
}

function resizeCanvas(): void {
  const cvs = canvasEl.value;
  if (!cvs) return;
  const rect = cvs.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cw = rect.width;
  ch = rect.height;
  cvs.width = Math.max(1, Math.round(rect.width * dpr));
  cvs.height = Math.max(1, Math.round(rect.height * dpr));
  ctx = cvs.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** 在游标行进方向的反侧喷出尾焰；speed = 本帧位移 px。数量按概率随速度增减
 *  （慢速间歇喷射、大跳时至多每帧一颗，避免爆量），取向在喷射轴 ±0.35 rad（约 ±20°）散射锥内随机 */
function spawn(cursorX: number, side: "a" | "b", speed: number): void {
  if (Math.random() > Math.min(1, speed * 1.5)) return;
  const dir = side === "a" ? -1 : 1; // a 向左喷、b 向右喷
  const v0 = 40 + Math.random() * 120 + Math.min(140, speed * 3);
  const va = (dir > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.7;
  const ttl = 0.5 + Math.random() * 0.5; // 寿命 0.5–1s：到时完全透明并移除
  particles.push({
    x: cursorX + dir * 3,
    y: ch * (0.2 + Math.random() * 0.6),
    vx: Math.cos(va) * v0,
    vy: Math.sin(va) * v0,
    size: 3 + Math.random() * 3.5,
    life: ttl,
    ttl,
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 8,
    alpha0: 0.8 + Math.random() * 0.2,
    side,
  });
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0.016);
  lastFrame = now;
  const cur = cursorEl.value;
  if (!ctx || !cur || !cw) return;

  // ---- 触边钉住（|偏差| ≥ gapMs）：游标边缘持续抖动 + 按钉住侧持续喷射 ----
  const ratio = props.gapMs > 0 ? props.diffMs / props.gapMs : 0;
  const shaking = Math.abs(ratio) >= 1;
  if (shaking) {
    // 抖动走 transform（无过渡，不与 left 的 0.3s linear 打架）；每进入一个
    // 半周期（每摆一下）就在 ±3px 基幅上重掷 ±0.8px 偏移，避免等幅正弦过于机械
    const phase = (now / 1000) * Math.PI * 18; // ~9Hz
    const cycle = Math.floor(phase / Math.PI);
    if (cycle !== lastShakeCycle) {
      lastShakeCycle = cycle;
      shakeAmp = 3 + (Math.random() - 0.5) * 1.6;
    }
    const j = Math.sin(phase) * shakeAmp;
    cur.style.transform = `translateX(calc(-50% + ${j.toFixed(2)}px))`;
    shakeOn = true;
  } else if (shakeOn) {
    cur.style.transform = ""; // 复位回 CSS 的居中 transform
    shakeOn = false;
  }

  // 游标 left 为插值后的 px（transform 不影响 left，恰为游标中心）
  const x = parseFloat(getComputedStyle(cur).left);
  if (Number.isFinite(x)) {
    if (shaking) {
      // 钉住后 left 不变（dx 恒 0 且抖动会污染方向），改按钉住侧定喷射色向：
      // 钉 B 侧（ratio > 0）= A 方领地扩张，向左喷 A 色
      spawn(x, ratio > 0 ? "a" : "b", 0.45); // 伪速度 ≈ 40 颗/s 持续喷流
    } else if (lastCursorX !== null) {
      const dx = x - lastCursorX;
      if (dx > 0.1) spawn(x, "a", dx); // 向 B 侧推进：左侧喷 A 色
      else if (dx < -0.1) spawn(x, "b", -dx); // 向 A 侧推进：右侧喷 B 色
    }
    lastCursorX = x;
  }
  if (!particles.length) {
    if (painted) {
      ctx.clearRect(0, 0, cw, ch);
      painted = false;
    }
    return;
  }
  painted = true;
  ctx.clearRect(0, 0, cw, ch);
  // 普通 alpha 混合：不用 lighter——密集粒子/双遍描边叠加会把同色通道累加到
  // 饱和发白，飞行中看不出色相、散开淡出时才显色（形似"变色"）
  const alive: Particle[] = [];
  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-2.2 * dt); // 轻微拖尾减速
    p.angle += p.spin * dt;
    // 剩余寿命比例：等比驱动缩小与淡出；寿命耗尽或出界即弃（不进 alive，随即释放）
    const k = p.life / p.ttl;
    if (k <= 0 || p.x < -10 || p.x > cw + 10) continue;
    const r = p.size * k;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = p.angle + (i * Math.PI * 2) / 3;
      const px = p.x + Math.cos(a) * r;
      const py = p.y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    // 轻微发光：同一路径描两遍（均用提亮色）——宽线低透明度辉光层 + 1px 线框本体
    ctx.strokeStyle = p.side === "a" ? coreA : coreB;
    ctx.globalAlpha = p.alpha0 * k * 0.3;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = p.alpha0 * k;
    ctx.lineWidth = 1;
    ctx.stroke();
    alive.push(p);
  }
  ctx.globalAlpha = 1;
  particles = alive;
}

/** 从 :root 重读主题色并刷新 canvas 粒子缓存（场景配置实时变更时触发） */
function readThemeColors(): void {
  const cs = getComputedStyle(canvasEl.value ?? document.documentElement);
  colorA = cs.getPropertyValue("--syn-a").trim() || colorA;
  colorB = cs.getPropertyValue("--syn-b").trim() || colorB;
  coreA = brighten(colorA, 0.55);
  coreB = brighten(colorB, 0.55);
}

onMounted(() => {
  readThemeColors();
  resizeCanvas();
  ro = new ResizeObserver((entries) => {
    for (const ent of entries) {
      if (ent.target === valueEl.value) {
        if (valueEl.value) valueHalfW.value = valueEl.value.offsetWidth / 2;
      } else {
        resizeCanvas();
      }
    }
  });
  if (valueEl.value) ro.observe(valueEl.value);
  if (canvasEl.value) ro.observe(canvasEl.value);
  rafId = requestAnimationFrame(frame);
  window.addEventListener("scene-appearance-change", readThemeColors);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  ro?.disconnect();
  window.removeEventListener("scene-appearance-change", readThemeColors);
});
</script>

<template>
  <div class="diff">
    <!-- track overflow:hidden 掩盖游标辉光超出条体的部分 -->
    <div class="track">
      <div class="fill a" :style="{ width: `calc(50% + ${offsetPct}%)` }" />
      <div class="fill b" :style="{ width: `calc(50% - ${offsetPct}%)` }" />
      <div
        ref="cursorEl"
        class="cursor"
        :style="{ left: `calc(50% + ${offsetPct}%)` }"
      />
      <!-- 游标喷射粒子层：覆盖条体，越界即被自身边界裁剪（与游标辉光同口径） -->
      <canvas ref="canvasEl" class="spray" />
    </div>
    <div ref="valueEl" class="value" :style="{ left: valueLeft }">{{ diffText }}</div>
  </div>
</template>

<style scoped>
.diff {
  position: relative;
  width: 100%;
}
.track {
  position: relative;
  height: 1.2vh;
  min-height: 10px;
  overflow: hidden; /* 游标辉光限制在条体内 */
  background: rgba(8, 0, 20, 0.7);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.5);
}
/* 游标为界：左 A 右 B（越向落后方移动，领先方的领地越大） */
.fill {
  position: absolute;
  top: 0;
  bottom: 0;
  transition: width 0.3s linear;
}
.fill.a {
  left: 0;
  background: var(--syn-a);
}
.fill.b {
  right: 0;
  background: var(--syn-b);
}
/* 白色游标：直角、与条体等高；置于 track 内，辉光经 overflow:hidden 只在条内显示 */
.cursor {
  position: absolute;
  top: 0;
  height: 100%;
  width: 5px;
  background: #fff;
  transform: translateX(-50%);
  box-shadow: 0 0 10px 2px rgba(255, 255, 255, 0.8);
  transition: left 0.3s linear;
  z-index: 1;
}
/* 粒子层：等尺寸覆盖条体，逻辑尺寸（cw/ch）由 ResizeObserver 同步，不随 DPR 拉伸 */
.spray {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
}
/* 偏差值：顶部贴紧游标底部（仅留小空隙），随游标同步移动（水平 clamp 在画面内）。
   行高定值 1.1（不随字体度量漂移）：MatchScene 按此精确预算计时区顶部给偏差值
   留出的条带高度（偏差值底部贴主计时顶） */
.value {
  position: absolute;
  top: calc(1.2vh + 0.2vh);
  transform: translateX(-50%);
  font-size: clamp(16px, 2.6vh, 30px);
  font-weight: 800;
  line-height: 1.1;
  color: #fff;
  /* 数字等宽，避免跳动刷新时文本抖动 */
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85);
  transition: left 0.3s linear;
}
</style>
