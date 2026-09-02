import { alphaStore } from "./alpha-store";
import { speakWith, prepareUtterance } from "./voice";
import { alertBus } from "./alerts";
import { parseWhen } from "./when";

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
let audioCtx: AudioContext | null = null;
const scheduled = new Map<string, { due: number; timer: number }>();

function ensureAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctx =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

function unlockAlarmAudio() {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    void ctx.resume?.();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.02);
  } catch {}
}

function playChime() {
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    void ctx.resume?.();
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
  prepareUtterance();
  playChime();
  notify(title, notes || "Reminder from Alpha");
  try { alertBus.pulse(); } catch {}
  const line = notes
    ? `Excuse me — reminder: ${title}. ${notes}`
    : `Excuse me — reminder: ${title}.`;
  void speakWith(line);
}

function clearScheduled() {
  for (const entry of scheduled.values()) window.clearTimeout(entry.timer);
  scheduled.clear();
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
    } else if (t - now < 60_000 && (!scheduled.has(r.id) || scheduled.get(r.id)?.due !== t)) {
      // Precise near-term scheduling so sub-minute alarms don't drift with the 15s tick.
      const existing = scheduled.get(r.id);
      if (existing) window.clearTimeout(existing.timer);
      const timer = window.setTimeout(() => {
        scheduled.delete(r.id);
        const cur = alphaStore.get().reminders.find(x => x.id === r.id);
        if (!cur || cur.done === "yes" || cur.firedAt) return;
        alphaStore.upsertReminder({ ...cur, firedAt: Date.now() });
        fireAlarm(cur.title || "Untitled reminder", cur.notes || "");
      }, Math.max(0, t - now));
      scheduled.set(r.id, { due: t, timer });
    }
  }
}

export function startAlarmEngine() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;
  window.addEventListener("pointerdown", unlockAlarmAudio, { passive: true });
  window.addEventListener("keydown", unlockAlarmAudio);
  // First tick shortly after boot, then every 15s.
  window.setTimeout(tick, 250);
  window.setTimeout(tick, 2000);
  intervalId = window.setInterval(tick, 15000) as unknown as number;
  window.addEventListener("alpha:reminders-changed", () => { clearScheduled(); tick(); });
  // Any store mutation (including reminders edited from another surface) re-syncs scheduling.
  alphaStore.sub(() => { clearScheduled(); tick(); });
  window.addEventListener("focus", tick);
  // Also re-check aggressively when tab becomes visible.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
}

export function stopAlarmEngine() {
  started = false;
  if (intervalId != null) { clearInterval(intervalId); intervalId = null; }
  clearScheduled();
}

/** Fire a demo alarm right now — used by the Settings test button. */
export function testAlarmNow() {
  fireAlarm("Alpha alarm test", "If you're hearing this, the alarm engine is live.");
}