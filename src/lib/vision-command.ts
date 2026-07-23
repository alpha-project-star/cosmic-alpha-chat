/**
 * Detects "look at me / what do you see / read this" style commands and
 * captures a live camera frame to attach to the chat turn.
 */
import { captureFrame, isActive, startEye } from "./vision-stream";

const RE = /\b(what\s+(?:do\s+)?you\s+see|what\s+(?:can\s+)?you\s+see|look\s+at\s+(?:me|this|that)|see\s+me|are\s+you\s+seeing|describe\s+(?:what|the)\s+(?:you|is|in\s+front)|who\s+is\s+(?:this|in\s+front)|read\s+(?:this|that|the\s+screen)|check\s+my\s+(?:face|surroundings)|scan\s+(?:me|this|the\s+room))\b/i;

export function isVisionCommand(text: string): boolean {
  return !!text && RE.test(text);
}

/** Ensure the eye is on and capture a frame. Returns base64 data URL. */
export async function captureLiveFrame(): Promise<string | null> {
  if (!isActive()) {
    try { await startEye(); } catch { return null; }
    // Give the camera a moment to expose.
    await new Promise((r) => setTimeout(r, 350));
  }
  return captureFrame(640, 0.72);
}