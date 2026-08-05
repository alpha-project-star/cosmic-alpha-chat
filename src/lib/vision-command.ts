/**
 * Detects "look at me / what do you see / read this" style commands and
 * captures a live camera frame to attach to the chat turn.
 */
import { captureFrame, isActive, startEye } from "./vision-stream";

/** Explicit "look now" phrasing — captures even when the eye is off. */
const RE = /\b(what\s+(?:do\s+)?you\s+see|what\s+(?:can\s+)?you\s+see|look\s+at\s+(?:me|this|that|my)|see\s+me|are\s+you\s+seeing|describe\s+(?:what|the|this|that)|who\s+is\s+(?:this|in\s+front)|read\s+(?:this|that|the\s+screen)|check\s+(?:my|this|that)|scan\s+(?:me|this|the\s+room)|take\s+a\s+look)\b/i;

/**
 * Deictic / self-referential phrasing — "does this necklace look good on me?",
 * "what's on my head?", "how do I look?". These only mean "use the camera"
 * when the live eye is already on, so they are gated separately.
 */
const DEICTIC = /(\bthis\b|\bthese\b|\bthat\b|\bhere\b|\bmy\b|\bme\b|\bi\s+look\b|\bi'm\s+wearing\b|\bam\s+i\b|\bhow\s+do\s+i\b|\bwhat'?s?\s+on\b|\bwhat\s+is\s+on\b|\bwhat\s+colou?r\b|\bdoes\s+it\b|\bdo\s+they\b|\bwearing\b|\bholding\b|\bpointing\b)/i;

/** Questions/requests only — don't hijack plain statements. */
const ASKING = /(\?|^\s*(what|who|which|where|how|does|do|is|are|can|could|should|read|describe|tell|check|look|scan|rate|compare|find)\b)/i;

export function isVisionCommand(text: string): boolean {
  return !!text && RE.test(text);
}

/**
 * Should this turn attach a live camera frame?
 * - explicit "what do you see" → always
 * - eye already live + a deictic question → yes (point-and-ask mode)
 */
export function shouldCaptureFrame(text: string, eyeLive: boolean): boolean {
  if (!text) return false;
  if (RE.test(text)) return true;
  if (!eyeLive) return false;
  return ASKING.test(text) && DEICTIC.test(text);
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