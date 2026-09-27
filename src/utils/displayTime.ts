import { ref } from 'vue';
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
function validZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}
function initialZone(): string {
  try { const z = localStorage.getItem('twc:display-time-zone'); return z && validZone(z) ? z : DEFAULT_TIME_ZONE; }
  catch { return DEFAULT_TIME_ZONE; }
}
export const displayTimeZone = ref(initialZone());
export function setDisplayTimeZone(zone: string): void {
  if (!validZone(zone)) return;
  displayTimeZone.value = zone;
  try { localStorage.setItem('twc:display-time-zone', zone); } catch { /* storage is optional */ }
}
export function formatEpoch(ms: number, options: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
}, locale = 'zh-CN', zone = displayTimeZone.value): string {
  if (!Number.isFinite(ms) || Number.isNaN(new Date(ms).getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { ...options, hourCycle: 'h23', timeZone: validZone(zone) ? zone : DEFAULT_TIME_ZONE }).format(ms);
}
