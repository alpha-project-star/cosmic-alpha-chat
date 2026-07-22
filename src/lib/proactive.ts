import { alphaStore, uid } from "./alpha-store";
import { speakWith, prepareUtterance } from "./voice";

/**
 * Proactive daemon — Alpha initiates.
 *
 *  • Daily morning brief (5am–11am local) — weather-agnostic summary of
 *    today's plans, unfired reminders, and overdue bills.
 *  • Overdue-bill nudge — first tick after boot if any bills are past due
 *    and haven't been nudged today.
 *  • Today's plans nudge — when a plan's date is today and hasn't been
 *    mentioned yet.
 *
 * Runs entirely client-side. Speaks via the existing TTS pipeline and
 * drops a `model` message into chat so the interaction is visible.
 */

const LS_LAST_BRIEF = "alpha.proactive.lastBrief";
const LS_LAST_BILLS = "alpha.proactive.lastBillsNudge";
const LS_LAST_PLANS = "alpha.proactive.lastPlansNudge";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function readOnce(key: string): boolean {
  try {
    if (localStorage.getItem(key) === todayKey()) return false;
    localStorage.setItem(key, todayKey());
    return true;
  } catch { return false; }
}

function speakAndLog(line: string) {
  if (!line.trim()) return;
  prepareUtterance();
  alphaStore.appendChat({ id: uid(), role: "model", text: line, ts: Date.now() });
  void speakWith(line);
}

function buildMorningBrief(): string {
  const s = alphaStore.get();
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const name = s.profile.name || "Alex";

  const dueToday = s.reminders.filter(r => {
    if (r.done === "yes" || r.firedAt) return false;
    const t = Date.parse(r.when);
    return !Number.isNaN(t) && t >= startOfDay.getTime() && t <= endOfDay.getTime();
  });
  const overdueBills = s.bills.filter(b => {
    if (b.status === "paid") return false;
    const t = Date.parse(b.dueDate);
    return !Number.isNaN(t) && t < startOfDay.getTime();
  });
  const plansToday = s.plans.filter(p => {
    const t = Date.parse(p.date);
    return !Number.isNaN(t) && t >= startOfDay.getTime() && t <= endOfDay.getTime();
  });

  if (!dueToday.length && !overdueBills.length && !plansToday.length) return "";

  const parts: string[] = [`Morning, ${name}.`];
  if (plansToday.length) {
    const first = plansToday[0];
    parts.push(`You've got ${plansToday.length === 1 ? "a plan" : `${plansToday.length} plans`} today — starting with ${first.title}${first.from ? ` from ${first.from}` : ""}${first.to ? ` to ${first.to}` : ""}.`);
  }
  if (dueToday.length) {
    parts.push(`${dueToday.length} reminder${dueToday.length === 1 ? "" : "s"} due today: ${dueToday.slice(0, 3).map(r => r.title).join(", ")}.`);
  }
  if (overdueBills.length) {
    const total = overdueBills.reduce((a, b) => a + Number(b.balance || 0), 0);
    parts.push(`Heads up — ${overdueBills.length} bill${overdueBills.length === 1 ? "" : "s"} overdue${total ? `, totalling ${total.toFixed(2)}` : ""}: ${overdueBills.slice(0, 3).map(b => b.name).join(", ")}.`);
  }
  return parts.join(" ");
}

function tick(force = false) {
  if (typeof document === "undefined") return;
  if (document.hidden && !force) return;
  const s = alphaStore.get();
  if (!s.settings.backgroundEnabled) return;

  const hour = new Date().getHours();

  // Morning brief window 5am–11am local, once per day.
  if (hour >= 5 && hour <= 11) {
    const brief = buildMorningBrief();
    if (brief && readOnce(LS_LAST_BRIEF)) speakAndLog(brief);
  }

  // Overdue-bill standalone nudge (any time of day, once).
  const overdue = s.bills.filter(b => b.status !== "paid" && Date.parse(b.dueDate) < Date.now() - 86400000);
  if (overdue.length && readOnce(LS_LAST_BILLS)) {
    const total = overdue.reduce((a, b) => a + Number(b.balance || 0), 0);
    speakAndLog(`Quick reminder — ${overdue.length} bill${overdue.length === 1 ? " is" : "s are"} overdue${total ? `, totalling ${total.toFixed(2)}` : ""}. Want me to open the bills view?`);
  }

  // Plans-today nudge (once per day) — outside the morning window.
  if (hour > 11) {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    const plansToday = s.plans.filter(p => {
      const t = Date.parse(p.date);
      return !Number.isNaN(t) && t >= startOfDay.getTime() && t <= endOfDay.getTime();
    });
    if (plansToday.length && readOnce(LS_LAST_PLANS)) {
      const first = plansToday[0];
      speakAndLog(`Reminder — you still have ${plansToday.length === 1 ? "a plan" : `${plansToday.length} plans`} today, starting with ${first.title}.`);
    }
  }
}

let started = false;
let intervalId: number | null = null;
export function startProactive() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Small delay after boot so chat store is warm and audio is unlockable.
  window.setTimeout(() => tick(), 8000);
  intervalId = window.setInterval(() => tick(), 5 * 60 * 1000) as unknown as number;
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

export function stopProactive() {
  started = false;
  if (intervalId != null) { clearInterval(intervalId); intervalId = null; }
}