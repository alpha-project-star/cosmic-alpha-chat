import { normalizeForSpeech } from "./speech-text";
import { alphaStore } from "./alpha-store";

// ============================================================
// Speaking pub-sub (so UI can pulse orbs while Alpha talks)
// ============================================================
let _speaking = false;
const speakSubs = new Set<(v: boolean) => void>();
export const speakingState = {
  get: () => _speaking,
  sub: (fn: (v: boolean) => void): (() => void) => {
    speakSubs.add(fn); fn(_speaking);
    return () => { speakSubs.delete(fn); };
  },
};
function setSpeaking(v: boolean) { if (_speaking === v) return; _speaking = v; speakSubs.forEach(f => f(v)); }

// ============================================================
// TTS — Kokoro first (if configured), browser male voice fallback
// ============================================================
let cachedVoice: SpeechSynthesisVoice | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUtter: SpeechSynthesisUtterance | null = null;
let unlockUtter: SpeechSynthesisUtterance | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const pref = alphaStore.get().settings.preferredVoice;
  if (pref) { const v = voices.find(v => v.name === pref); if (v) return v; }
  // Prefer a SMOOTH MALE voice
  const enMale = voices.find(v => /^en/i.test(v.lang) && /(male|daniel|alex|fred|tom|guy|james|michael|david|ryan|aaron|arthur|google uk english male)/i.test(v.name));
  if (enMale) return enMale;
  const gb = voices.find(v => /en[-_]GB/i.test(v.lang));
  if (gb) return gb;
  return voices.find(v => /^en/i.test(v.lang)) ?? voices[0];
}

/** Call inside a user gesture (tap) to unlock both speech & audio on Android. */
export function prepareUtterance() {
  if (typeof window === "undefined") return;
  if ("speechSynthesis" in window) {
    if (!cachedVoice) cachedVoice = pickVoice();
    unlockUtter = new SpeechSynthesisUtterance("");
    if (cachedVoice) { unlockUtter.voice = cachedVoice; unlockUtter.lang = cachedVoice.lang; }
    try { window.speechSynthesis.cancel(); } catch {}
  }
}

async function tryKokoro(text: string): Promise<HTMLAudioElement | null> {
  const { kokoroEndpoint, kokoroVoice } = alphaStore.get().settings;
  if (!kokoroEndpoint || !kokoroEndpoint.trim()) return null;
  try {
    // OpenAI-compatible Kokoro-FastAPI shape: POST /v1/audio/speech { input, voice, model }
    const res = await fetch(kokoroEndpoint.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text, text, model: "kokoro",
        voice: kokoroVoice || "am_michael",
        response_format: "mp3", speed: alphaStore.get().settings.ttsRate || 1,
      }),
    });
    if (!res.ok) throw new Error(`Kokoro HTTP ${res.status} — ${(await res.text().catch(() => "")).slice(0, 120)}`);
    const blob = await res.blob();
    if (!blob.size) throw new Error("Kokoro returned empty audio");
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    return audio;
  } catch (e) {
    console.warn("[voice] Kokoro failed, falling back to browser TTS:", e);
    // Broadcast so the UI can surface why Kokoro isn't being used. Most common
    // cause is CORS — the server must send Access-Control-Allow-Origin for this site.
    try { window.dispatchEvent(new CustomEvent("kokoro-fail", { detail: String((e as any)?.message || e) })); } catch {}
    return null;
  }
}

function browserSpeak(text: string): Promise<void> {
  return new Promise(resolve => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { resolve(); return; }
    if (!cachedVoice) cachedVoice = pickVoice();
    const u = unlockUtter && !unlockUtter.text ? unlockUtter : new SpeechSynthesisUtterance("");
    u.text = text;
    if (cachedVoice) { u.voice = cachedVoice; u.lang = cachedVoice.lang; }
    u.rate = alphaStore.get().settings.ttsRate || 1;
    u.pitch = 0.95; u.volume = 1;
    currentUtter = u;
    u.onend = () => { currentUtter = null; resolve(); };
    u.onerror = () => { currentUtter = null; resolve(); };
    try { window.speechSynthesis.cancel(); } catch {}
    try { window.speechSynthesis.speak(u); } catch { resolve(); }
  });
}

/**
 * Speak text. Suspends STT for the duration so Alpha doesn't hear itself.
 * Falls back to browser male voice if Kokoro endpoint isn't set / fails.
 */
export async function speakWith(text: string): Promise<void> {
  if (!alphaStore.get().settings.voiceEnabled) return;
  const clean = normalizeForSpeech(text);
  if (!clean) return;
  stopSpeaking();
  setSpeaking(true);
  const wasListening = recognizer.isWanted;
  if (wasListening) recognizer.suspend();

  try {
    const audio = await tryKokoro(clean);
    if (audio) {
      currentAudio = audio;
      await new Promise<void>(resolve => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      currentAudio = null;
    } else {
      await browserSpeak(clean);
    }
  } finally {
    setSpeaking(false);
    // small grace gap so STT doesn't pick up echo tail
    if (wasListening) {
      setTimeout(() => { if (recognizer.isWanted) recognizer.resume(); }, 350);
    }
  }
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch {}
  if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }
  currentUtter = null;
  setSpeaking(false);
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => { cachedVoice = pickVoice(); };
}

// ============================================================
// STT — half-duplex aware
// ============================================================
type RecHandlers = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onStart?: () => void;
  onStop?: () => void;
  onError?: (err: string) => void;
};

export class ContinuousRecognizer {
  private rec: any = null;
  private active = false;
  private wantOn = false;
  private paused = false; // suspended while Alpha speaks
  private restartTimer: number | null = null;
  private silenceTimer: number | null = null;
  private interimBuf = "";
  private handlers: RecHandlers = {};

  get isActive() { return this.active; }
  get isWanted() { return this.wantOn; }
  get analyserNode(): AnalyserNode | null { return null; }

  setHandlers(h: RecHandlers) { this.handlers = h; }

  private lang() {
    if (typeof navigator === "undefined") return "en-US";
    return navigator.language?.trim() || "en-US";
  }

  private build() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const isAndroid = /android/i.test(navigator.userAgent);
    const rec = new SR();
    rec.continuous = !isAndroid;
    rec.interimResults = true;
    rec.lang = this.lang();
    rec.onstart = () => { this.active = true; this.handlers.onStart?.(); };
    rec.onend = () => {
      this.active = false;
      if (!this.wantOn || this.paused) {
        if (!this.wantOn) this.handlers.onStop?.();
        return;
      }
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        if (!this.wantOn || this.paused) return;
        try { rec.start(); } catch (err: any) {
          // try with a fresh instance
          this.rec = this.build();
          try { this.rec?.start(); } catch (e: any) {
            this.wantOn = false;
            this.handlers.onError?.(e?.message || err?.message || "Could not restart recognition");
            this.handlers.onStop?.();
          }
        }
      }, isAndroid ? 250 : 50);
    };
    rec.onerror = (e: any) => {
      const err = String(e?.error || "speech error");
      if (err === "no-speech" || err === "aborted") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        this.wantOn = false;
        this.handlers.onError?.("Microphone permission denied or blocked");
        return;
      }
      if (err === "audio-capture") {
        this.wantOn = false;
        this.handlers.onError?.("No microphone audio captured");
        return;
      }
      this.handlers.onError?.(err);
    };
    rec.onresult = (e: any) => {
      let interim = ""; let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) {
        this.interimBuf = interim;
        this.handlers.onInterim?.(interim);
        this.armSilence();
      }
      if (finalText.trim()) {
        const t = finalText.trim();
        this.interimBuf = "";
        if (this.silenceTimer) { window.clearTimeout(this.silenceTimer); this.silenceTimer = null; }
        this.handlers.onFinal?.(t);
      }
    };
    return rec;
  }

  start() {
    if (typeof window === "undefined") return;
    this.wantOn = true;
    this.paused = false;
    if (this.active) return;
    if (!this.rec) this.rec = this.build();
    if (!this.rec) { this.handlers.onError?.("Speech recognition not supported"); return; }
    try { this.rec.start(); } catch (err: any) {
      this.handlers.onError?.(err?.message || "Could not start recognition");
    }
  }

  /** Pause without forgetting we want to be on — used while Alpha speaks. */
  suspend() {
    this.paused = true;
    if (this.restartTimer) { window.clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.silenceTimer) { window.clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    this.interimBuf = "";
    try { this.rec?.abort?.(); } catch {}
    this.active = false;
  }

  resume() {
    if (!this.wantOn) return;
    this.paused = false;
    if (this.active) return;
    if (!this.rec) this.rec = this.build();
    try { this.rec?.start(); } catch {
      this.rec = this.build();
      try { this.rec?.start(); } catch (e: any) {
        this.handlers.onError?.(e?.message || "Could not resume");
      }
    }
  }

  private armSilence() {
    if (this.silenceTimer) window.clearTimeout(this.silenceTimer);
    this.silenceTimer = window.setTimeout(() => {
      const t = this.interimBuf.trim();
      this.interimBuf = "";
      if (t) this.handlers.onFinal?.(t);
    }, 1300);
  }

  stop() {
    this.wantOn = false;
    this.paused = false;
    if (this.restartTimer) { window.clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.silenceTimer) { window.clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    this.interimBuf = "";
    try { this.rec?.abort?.(); } catch {}
    try { this.rec?.stop?.(); } catch {}
    this.active = false;
  }

  dispose() { this.stop(); this.rec = null; }
}

export const recognizer = new ContinuousRecognizer();