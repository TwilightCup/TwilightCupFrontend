<script setup lang="ts">
/**
 * synthwave_gl「水面浪潮GL」全屏 WebGL 背景。
 *
 * 与旧版 CSS/SVG 水面不同，这一版由 GPU 一次性绘制天空、星空、远山、
 * 镂空条纹太阳、滚动的透视霓虹网格、水面波光与波动倒影；网格和水面倒影
 * 都做了 RGB 色散与波纹扭曲，因此更适合作为 OBS 浏览器源的大屏背景。
 *
 * 兼容性策略：
 *  - 只申请 WebGL1，使用 GLSL ES 1.00；
 *  - 初始化 / 编译 / 上下文丢失时向父组件 emit failed，由 SynthwaveBg 回退到
 *    现有的 CSS/SVG「水面浪潮」预设，保证场景不黑屏；
 *  - 渲染分辨率 DPR 上限 1.5，避免在 OBS 内同时编码时 GPU 压力过大。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  SYNTHWAVE_GL_FRAGMENT_SHADER,
  SYNTHWAVE_GL_VERTEX_SHADER,
} from "./synthwaveGlShaders";

const emit = defineEmits<{ (e: "failed"): void }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let buffer: WebGLBuffer | null = null;
let positionLocation = -1;
let timeLocation: WebGLUniformLocation | null = null;
let resolutionLocation: WebGLUniformLocation | null = null;
let resizeObserver: ResizeObserver | null = null;
let rafId = 0;
let running = false;
let failed = false;
let startTime = 0;

function emitFailed(): void {
  if (failed) return;
  failed = true;
  emit("failed");
}

function compileShader(type: number, source: string): WebGLShader | null {
  if (!gl) return null;
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[SynthwaveGlBg] shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(): WebGLProgram | null {
  if (!gl) return null;
  const vertexShader = compileShader(gl.VERTEX_SHADER, SYNTHWAVE_GL_VERTEX_SHADER);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, SYNTHWAVE_GL_FRAGMENT_SHADER);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const linked = gl.createProgram();
  if (!linked) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(linked, vertexShader);
  gl.attachShader(linked, fragmentShader);
  gl.linkProgram(linked);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
    console.warn("[SynthwaveGlBg] program link failed:", gl.getProgramInfoLog(linked));
    gl.deleteProgram(linked);
    return null;
  }
  return linked;
}

function setupGL(): boolean {
  const canvas = canvasEl.value;
  if (!canvas) return false;

  const attributes: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  };
  const context =
    (canvas.getContext("webgl", attributes) as WebGLRenderingContext | null) ??
    (canvas.getContext("experimental-webgl", attributes) as WebGLRenderingContext | null);
  if (!context) return false;
  gl = context;

  program = createProgram();
  if (!program) return false;

  positionLocation = gl.getAttribLocation(program, "aPos");
  if (positionLocation < 0) {
    console.warn("[SynthwaveGlBg] attribute aPos not found");
    return false;
  }

  buffer = gl.createBuffer();
  if (!buffer) return false;

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  timeLocation = gl.getUniformLocation(program, "uTime");
  resolutionLocation = gl.getUniformLocation(program, "uResolution");

  gl.useProgram(program);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(0.015, 0.0, 0.035, 1.0);
  return true;
}

function cleanupGL(): void {
  if (!gl) return;
  if (buffer) {
    gl.deleteBuffer(buffer);
    buffer = null;
  }
  if (program) {
    gl.deleteProgram(program);
    program = null;
  }
  positionLocation = -1;
  timeLocation = null;
  resolutionLocation = null;
  gl = null;
}

function resize(): void {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (width === canvas.width && height === canvas.height) return;
  canvas.width = width;
  canvas.height = height;
  if (gl) gl.viewport(0, 0, width, height);
  render(performance.now());
}

function render(now: number): void {
  const canvas = canvasEl.value;
  if (!gl || !program || !canvas) return;

  gl.useProgram(program);
  if (timeLocation) gl.uniform1f(timeLocation, Math.max(0, (now - startTime) / 1000));
  if (resolutionLocation) gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function frame(now: number): void {
  if (!running) return;
  rafId = requestAnimationFrame(frame);
  render(now);
}

function start(): void {
  if (running) return;
  running = true;
  startTime = performance.now();
  render(startTime);
  rafId = requestAnimationFrame(frame);
}

function stop(): void {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function onContextLost(event: Event): void {
  event.preventDefault();
  stop();
  emitFailed();
}

onMounted(() => {
  const canvas = canvasEl.value;
  if (!canvas) {
    emitFailed();
    return;
  }

  canvas.addEventListener("webglcontextlost", onContextLost, false);

  if (!setupGL()) {
    cleanupGL();
    emitFailed();
    return;
  }

  resize();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas);
  }
  window.addEventListener("resize", resize);
  start();
});

onBeforeUnmount(() => {
  stop();
  window.removeEventListener("resize", resize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  canvasEl.value?.removeEventListener("webglcontextlost", onContextLost);
  cleanupGL();
});
</script>

<template>
  <canvas ref="canvasEl" class="synthwave-gl" aria-hidden="true" />
</template>

<style scoped>
.synthwave-gl {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
