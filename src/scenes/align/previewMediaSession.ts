/** Private same-origin director -> preview control, never an authority message. */
export class PreviewMediaSession {
  active = false;
  constructor(private parent: unknown, private origin: string) {}
  receive(event: { source: unknown; origin: string; data: unknown }): boolean {
    if (event.source !== this.parent || event.origin !== this.origin) return false;
    const data = event.data as { type?: unknown; active?: unknown } | null;
    if (!data || data.type !== "director-preview-media" || typeof data.active !== "boolean") return false;
    this.active = data.active;
    return true;
  }
}
