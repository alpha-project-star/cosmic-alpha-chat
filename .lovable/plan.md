## Give the Cyber-Eye real sight

Yes — we can wire the front camera into the orb so Alpha actually sees what's in front of the screen, not just uploaded photos. Here's the plan.

### What you'll get

- A new **"Eye" mode** you can toggle from the voice-first home (long-press or tap the orb, plus a small camera icon on the HUD).
- When active, the front camera streams into a hidden `<video>` element. The Cyber-Eye's pupil subtly reflects motion/brightness from the feed (living mirror effect), and a faint "REC" ring appears on the bezel so you always know it's watching.
- Alpha can then **look on demand** ("Alpha, what do you see?", "who's in front of me?", "read this label") — a frame is grabbed, sent to the vision model, and spoken back.
- Optional **ambient awareness**: every N seconds (default 20s, configurable, off by default), Alpha snapshots a low-res frame and only speaks if something meaningful changes (new face, new object, text appears). This is opt-in because it burns vision API calls.
- Full privacy controls: OFF by default, explicit permission prompt, visible indicator whenever the camera is live, one-tap kill switch, nothing stored to disk unless you ask Alpha to "remember this."

### How it works

1. **Camera service** — new `src/lib/vision-stream.ts`:
  - `startEye()` requests `getUserMedia({ video: { facingMode: 'user' } })`, keeps a singleton `MediaStream` + hidden `<video>`.
  - `captureFrame()` draws the current video frame to an offscreen canvas → base64 JPEG (downscaled, ~512px, quality 0.7 to keep payloads small).
  - `stopEye()` stops all tracks and clears the singleton.
  - Exposes a lightweight `subscribeBrightness(cb)` that samples average luma every ~200ms for the pupil-reactivity effect (no network, purely local).
2. **Cyber-Eye reactivity** — `src/components/CyberEye.tsx`:
  - When Eye mode is on, subscribe to `subscribeBrightness`. Map luma + motion delta to pupil scale/glow so the core visibly reacts to what's in front of the camera. Falls back to existing idle animation when off.
  - Add a small "LIVE" micro-indicator on the bezel while streaming.
3. **Voice/agent hooks** — `src/lib/alpha.functions.ts` + `src/lib/local-intents.ts`:
  - New intents: "what do you see", "look at me", "describe what's in front of you", "read this", "who is this". These call `captureFrame()` then route the base64 image through the existing `VISION_FALLBACKS` chain (Qwen 2.5 VL etc.), then TTS the reply.
  - Same pipeline chat already uses — no new API keys required.
4. **Ambient mode (opt-in)** — `src/lib/vision-ambient.ts`:
  - Setinterval loop, cheap local diff (compare downscaled luma histogram between frames). Only when diff crosses threshold does it call the vision model with the prompt "In one short sentence, what changed?" Debounced, capped to N calls/hour, silent if nothing notable.
5. **UI entry points**:
  - `AlphaOrb` / voice-first: tap-and-hold or a new small "eye" toggle to enter Eye mode.
  - `chat.tsx`: existing camera button stays for one-shot photos; a new "Live Eye" toggle mirrors the same stream.
  - `AlphaSettings` → new **Vision** group (under Online or its own section): master toggle, ambient on/off, ambient interval, capture resolution, "camera indicator always visible".
6. **Permissions & safety**:
  - First activation shows a clear consent sheet ("Alpha will use your front camera. Nothing is saved unless you ask.").
  - Persistent on-screen indicator (bezel LIVE dot) whenever the stream is open.
  - Auto-stop on route change away from home/chat, on tab hidden (`visibilitychange`), and on lock (`AlphaLock`).
  - No frames written to `localStorage` or IndexedDB by default; "remember this" explicitly stores a single base64 into Memories.

### Known limits

- Requires HTTPS (already satisfied on your Lovable domain and PWA install).
- On Android WebView inside some wrappers, `getUserMedia` needs the host app to grant camera permission — if you're running Alpha as an installed PWA via Chrome this works out of the box.
- Vision calls still cost OpenRouter credits; ambient mode is off by default for that reason.

### Files touched

- New: `src/lib/vision-stream.ts`, `src/lib/vision-ambient.ts`
- Edit: `src/components/CyberEye.tsx`, `src/components/AlphaOrb.tsx`, `src/routes/index.tsx` (voice-first), `src/routes/chat.tsx`, `src/lib/alpha.functions.ts`, `src/lib/local-intents.ts`, `src/components/AlphaSettings.tsx`, `src/lib/alpha-store.ts` (settings fields)

Want me to also make the pupil literally track your face position (left/right/up/down) using a tiny on-device face-detector, or keep it to brightness/motion only for now?(USER SAID YES)