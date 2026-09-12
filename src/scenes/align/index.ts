/**
 * 帧级对齐库出口 src/scenes/align/ —— 解析基元（M1）：
 *   SeiParser / fMP4 demux / HLS 增量拉取，均镜像冒烟工具与 SEIInjector C 实现。
 *   （解码排程 / 速率控制 / useFrameAlign 权威在 M2 加入。）
 */
export * from "./types";
export * from "./sei";
export * from "./fmp4";
export * from "./hlsPoller";