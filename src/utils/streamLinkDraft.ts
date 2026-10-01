import type { StreamLinkValues } from "@/api/types";
/** Editor version belongs to the draft, not the latest incoming snapshot. */
export class StreamLinkDraft {
  values: StreamLinkValues = { hlsA: "", hlsB: "", embedA: "", embedB: "" };
  version = 0;
  dirty = false;
  load(values: StreamLinkValues, version: number, discard = false) {
    if (this.dirty && !discard) return;
    this.values = { ...values }; this.version = version; this.dirty = false;
  }
  edit(key: keyof StreamLinkValues, value: string) { this.values[key] = value; this.dirty = true; }
}
