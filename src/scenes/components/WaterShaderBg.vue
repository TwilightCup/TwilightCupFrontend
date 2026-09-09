<script setup lang="ts">
/**
 * synthwave2「水面浪潮2」全屏 WebGL 背景。
 *
 * 上半屏（天空 / 远山 / 太阳）由 Canvas2D 按原版 SVG/CSS 精确绘制成纹理；
 * WebGL fragment shader 负责天空显示、程序化闪烁星星、水面波纹 / 平面反射 /
 * 折射网格 / 高光与暗角。这样天空轮廓和颜色能最大程度还原原版，水面则保留
 * 完整的实时着色器效果。
 *
 * 兼容性策略：
 *  - 只申请 WebGL1，使用 GLSL ES 1.00；
 *  - 初始化失败 / 着色器编译失败 / WebGL context lost 时向父组件 emit `failed`，
 *    父组件退回现有 CSS/SVG 水面，保证不黑屏；
 *  - 内部渲染分辨率按 DPR 上限 1.5 控制，避免同时编码时 GPU 压力过大。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { WATER_FRAGMENT_SHADER, WATER_VERTEX_SHADER } from "./waterShaderSources";
import { createWaterSkyCanvas } from "./waterSkyTexture";

const emit = defineEmits<{ (e: "failed"): void }>();

const canvasEl = ref<HTMLCanvasElement | null>(null);

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let buffer: WebGLBuffer | null = null;
let skyTexture: WebGLTexture | null = null;
let positionLocation = -1;
let timeLocation: WebGLUniformLocation | null = null;
let resolutionLocation: WebGLUniformLocation | null = null;
let skyTextureLocation: WebGLUniformLocation | null = null;
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
    console.warn("[WaterShaderBg] shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(): WebGLProgram | null {
  if (!gl) return null;
  const vertexShader = compileShader(gl.VERTEX_SHADER, WATER_VERTEX_SHADER);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, WATER_FRAGMENT_SHADER);
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
    console.warn("[WaterShaderBg] program link failed:", gl.getProgramInfoLog(linked));
    gl.deleteProgram(linked);
    return null;
  }
  return linked;
}

function setupGL(): boolean {
  const canvas = canvasEl.value;
  if (!canvas) return false;

  const context =
    canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    }) ??
    (canvas.getContext("experimental-webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    }) as WebGLRenderingContext | null);
  if (!context) return false;
  gl = context;

  program = createProgram();
  if (!program) return false;

  positionLocation = gl.getAttribLocation(program, "aPos");
  if (positionLocation < 0) {
    console.warn("[WaterShaderBg] attribute aPos not found");
    return false;
  }

  buffer = gl.createBuffer();
  if (!buffer) return false;

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  skyTexture = gl.createTexture();
  if (!skyTexture) return false;
  gl.bindTexture(gl.TEXTURE_2D, skyTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );

  timeLocation = gl.getUniformLocation(program, "uTime");
  resolutionLocation = gl.getUniformLocation(program, "uResolution");
  skyTextureLocation = gl.getUniformLocation(program, "uSkyTex");

  gl.useProgram(program);
  if (skyTextureLocation) gl.uniform1i(skyTextureLocation, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  return true;
}

function updateSkyTexture(): void {
  if (!gl || !skyTexture) return;
  const canvas = canvasEl.value;
  if (!canvas) return;
  const skyCanvas = createWaterSkyCanvas(canvas.width, canvas.height);
  gl.bindTexture(gl.TEXTURE_2D, skyTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, skyCanvas);
}

function cleanupGL(): void {
  if (!gl) return;
  if (skyTexture) {
    gl.deleteTexture(skyTexture);
    skyTexture = null;
  }
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
  skyTextureLocation = null;
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
  if (gl) {
    gl.viewport(0, 0, width, height);
    updateSkyTexture();
  }
}

function frame(now: number): void {
  if (!running) return;
  rafId = requestAnimationFrame(frame);

  const canvas = canvasEl.value;
  if (!gl || !program || !canvas) return;

  // 背景容器是 fixed inset:0，尺寸变化频率低；这里做一次低成本尺寸同步，
  // 避免 OBS 在浏览器源初始化阶段拿到 300×150 的默认 canvas 尺寸。
  resize();

  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, skyTexture);
  if (timeLocation) gl.uniform1f(timeLocation, (now - startTime) / 1000);
  if (resolutionLocation) gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function start(): void {
  if (running) return;
  running = true;
  startTime = performance.now();
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
  <canvas ref="canvasEl" class="water-shader" aria-hidden="true" />
</template>

<style scoped>
.water-shader {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
