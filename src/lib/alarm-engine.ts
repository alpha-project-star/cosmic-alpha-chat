import { alphaStore } from "./alpha-store";
import { speakWith, prepareUtterance } from "./voice";

/**
 * Real background alarm engine.
 * Ticks every 15s while the tab is open. When a reminder's `when` time
 * (parsed as Date) has passed and it hasn't fired yet, fires it:
 *   - plays a chime (WebAudio oscillator, no asset)
 *   - shows a system Notification (if permission granted)
 *   - speaks it via existing TTS
 *   - marks the reminder as fired so it doesn't repeat
 */

let started = false;
let intervalId: number | null = null;

function parseWhen(raw: string): number | null {
  if (!raw) return null;
  // ISO / RFC first
  const iso = Date.parse(raw);
  if (!isNaN(iso)) return iso;
  // Fallback: try `datetime-local` shape "2026-07-15T09:00"
  return null;
}

function playChime() {
  try {
    const Ctx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(ctx.destination);
    const tones = [880, 1320, 990];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      og.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.28);
      o.connect(og).connect(g);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.3);
    });
    g.gain.setValueAtTime(1, ctx.currentTime);
    setTimeout(() => { try { ctx.close(); } catch {} }, 1500);
  } catch {}
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(`⏰ ${title}`, { body, tag: `alpha-${title}` });
    }
  } catch {}
}

export async function requestAlarmPermission(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const p = await Notification.requestPermission();
    return p === "granted";
  } catch { return false; }
}

export function fireAlarm(title: string, notes = "") {
  playChime();
  notify(title, notes || "Reminder from Alpha");
  const line = notes
    ? `Excuse me — reminder: ${title}. ${notes}`
    : `Excuse me — reminder: ${title}.`;
  prepareUtterance();
  void speakWith(line);
}

function tick() {
  const s = alphaStore.get();
  const now = Date.now();
  for (const r of s.reminders) {
    if (r.done === "yes") continue;
    if (r.firedAt) continue;
    const t = parseWhen(r.when);
    if (t == null) continue;
    if (now >= t) {
      alphaStore.upsertReminder({ ...r, firedAt: now });
      fireAlarm(r.title || "Untitled reminder", r.notes || "");
    }
  }
}

export function startAlarmEngine() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;
  // Best-effort permission request (must be inside gesture on most browsers,
  // but this is idempotent so we retry on first user click too).
  void requestAlarmPermission();
  // First tick shortly after boot, then every 15s.
  window.setTimeout(tick, 2000);
  intervalId = window.setInterval(tick, 15000) as unknown as number;
  // Also re-check aggressively when tab becomes visible.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
}

export function stopAlarmEngine() {
  started = false;
  if (intervalId != null) { clearInterval(intervalId); intervalId = null; }
}

/** Fire a demo alarm right now — used by the Settings test button. */
export function testAlarmNow() {
  fireAlarm("Alpha alarm test", "If you're hearing this, the alarm engine is live.");
}