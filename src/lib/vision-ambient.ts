/**
 * Vision Ambient — opt-in loop that watches the camera and only calls the
 * vision model when the scene actually changes. Debounced + hard-capped.
 */
import { alphaStore, uid } from "./alpha-store";
import { captureFrame, isActive as eyeActive, subscribeBrightness } from "./vision-stream";
import { sendChat } from "./alpha.functions";
import { speakWith } from "./voice";

let running = false;
let unsub: (() => void) | null = null;
let lastFireAt = 0;
let hourlyCount = 0;
let hourlyResetAt = 0;
let momentum = 0;

const HARD_CAP_PER_HOUR = 12;

export function startVisionAmbient(): void {
  if (running || !eyeActive()) return;
  running = true;
  momentum = 0;
  unsub = subscribeBrightness((s) => {
    // Exponential momentum on motion so momentary spikes don't trigger.
    momentum = momentum * 0.7 + s.motion * 0.3;
    void maybeFire();
  });
}

export function stopVisionAmbient(): void {
  running = false;
  if (unsub) { unsub(); unsub = null; }
}

export function isVisionAmbient(): boolean { return running; }

async function maybeFire() {
  if (!running) return;
  const now = Date.now();
  const interval = Math.max(15, alphaStore.get().settings.visionAmbientIntervalSec || 30) * 1000;
  if (now - lastFireAt < interval) return;
  if (momentum < 0.18) return; // Not enough real change.
  // Hourly cap
  if (now - hourlyResetAt > 3_600_000) { hourlyResetAt = now; hourlyCount = 0; }
  if (hourlyCount >= HARD_CAP_PER_HOUR) return;
  lastFireAt = now;
  hourlyCount++;
  momentum = 0;
  const frame = captureFrame(512, 0.68);
  if (!frame) return;
  try {
    const reply = await sendChat([
      { id: uid(), role: "user", ts: now,
        text: "You are Alpha's ambient vision. In one short sentence (under 18 words) describe only what MEANINGFULLY changed in view. If nothing important changed, reply exactly: NOTHING.",
        images: [frame] },
    ]);
    const trimmed = (reply || "").trim();
    if (!trimmed || /^nothing\b/i.test(trimmed)) return;
    alphaStore.appendChat({ id: uid(), role: "model", text: `👁 ${trimmed}`, ts: Date.now() });
    void speakWith(trimmed);
  } catch { /* silent — ambient */ }
}