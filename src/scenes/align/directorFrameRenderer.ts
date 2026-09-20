/** Opt-in director surfaces only. No ownership of VideoFrames: the decode queue
 * still closes them. Canvas pixels remain valid after those frames are closed. */
export interface DirectorSurfaceOptions {
  maxWidth?: number;
  maxHeight?: number;
  visible(): boolean;
}
interface Identity { frame: VideoFrame; generation: number; width: number; height: number }
interface Surface { canvas: HTMLCanvasElement; options: DirectorSurfaceOptions }
function dimensions(frame: VideoFrame, options: DirectorSurfaceOptions): [number, number] {
  if (!frame.displayWidth || !frame.displayHeight) throw new Error("Invalid presentation surface");
  const scale = Math.min(1, (options.maxWidth ?? frame.displayWidth) / frame.displayWidth,
    (options.maxHeight ?? frame.displayHeight) / frame.displayHeight);
  return [Math.max(1, Math.round(frame.displayWidth * scale)), Math.max(1, Math.round(frame.displayHeight * scale))];
}
export class DirectorFrameRenderer {
  private converted = new Map<string, Identity & { canvas: HTMLCanvasElement }>();
  private painted = new WeakMap<HTMLCanvasElement, Identity>();
  constructor(private create: () => HTMLCanvasElement = () => document.createElement("canvas")) {}
  forget(canvas: HTMLCanvasElement): void { this.painted.delete(canvas); }
  release(side: string): void { this.converted.delete(side); }
  clear(): void { this.converted.clear(); this.painted = new WeakMap(); }
  /** Conversion happens during preparation; callers prepare BOTH sides before
   * committing any output. The same frame is converted once per side/budget. */
  prepare(side: string, frame: VideoFrame, generation: number, surfaces: Surface[]): () => HTMLCanvasElement[] {
    const pending: { canvas: HTMLCanvasElement; buffer: HTMLCanvasElement; identity: Identity }[] = [];
    const visible = surfaces.filter(s => s.options.visible());
    if (!visible.length) return () => [];
    const sizes = visible.map(s => dimensions(frame, s.options));
    // Largest requested surface is the single conversion source for this side.
    const width = Math.max(...sizes.map(s => s[0])), height = Math.max(...sizes.map(s => s[1]));
    const dirty = visible.map((surface, i) => ({ ...surface, width: sizes[i]![0], height: sizes[i]![1] }))
      .filter(s => {
        const last = this.painted.get(s.canvas);
        return !last || last.frame !== frame || last.generation !== generation ||
          last.width !== s.width || last.height !== s.height || s.canvas.width !== s.width || s.canvas.height !== s.height;
      });
    if (!dirty.length) return () => [];
    let buffer = this.converted.get(side);
    if (!buffer || buffer.frame !== frame || buffer.generation !== generation || buffer.width < width || buffer.height < height) {
      const canvas = buffer?.canvas ?? this.create();
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(frame, 0, 0, width, height);
      buffer = { canvas, frame, generation, width, height };
      this.converted.set(side, buffer);
    }
    for (const s of dirty) {
      if (!s.canvas.getContext("2d")) throw new Error("Canvas unavailable");
      pending.push({ canvas: s.canvas, buffer: buffer.canvas,
        identity: { frame, generation, width: s.width, height: s.height } });
    }
    return () => {
      for (const { canvas, buffer: source, identity } of pending) {
        if (canvas.width !== identity.width) canvas.width = identity.width;
        if (canvas.height !== identity.height) canvas.height = identity.height;
        canvas.getContext("2d")!.drawImage(source, 0, 0, identity.width, identity.height);
        this.painted.set(canvas, identity);
      }
      return pending.map(p => p.canvas);
    };
  }
}
