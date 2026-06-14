import { normalizeForSpeech } from "./speech-text";
import { alphaStore } from "./alpha-store";

// ===== TTS (British female priority) =====
let slot: SpeechSynthesisUtterance | null = null;
let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferredName = alphaStore.get().settings.preferredVoice;
  if (preferredName) {
    const v = voices.find(v => v.name === preferredName);
    if (v) return v;
  }
  const gbFemale = voices.find(v => /en[-_]GB/i.test(v.lang) &&
    /(female|libby|sonia|hazel|amy|google uk english female|martha|emma|kate)/i.test(v.name));
  if (gbFemale) return gbFemale;
  const gb = voices.find(v => /en[-_]GB/i.test(v.lang));
  if (gb) return gb;
  const enFemale = voices.find(v => /^en/i.test(v.lang) && /female|samantha|karen|moira|tessa/i.test(v.name));
  if (enFemale) return enFemale;
  return voices.find(v => /^en/i.test(v.lang)) ?? voices[0];
}

/**
 * CRITICAL Android fix: instantiate SpeechSynthesisUtterance synchronously
 * inside a user gesture handler. Later, after fetch resolves, mutate .text and
 * call speak() — Chrome on Android refuses to start speech created after async.
 */
export function prepareUtterance() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!cachedVoice) cachedVoice = pickVoice();
  slot = new SpeechSynthesisUtterance("");
  if (cachedVoice) { slot.voice = cachedVoice; slot.lang = cachedVoice.lang; }
  slot.rate = 1.02; slot.pitch = 1.05; slot.volume = 1;
  // Unlock on iOS/Android by feeding an empty speak inside the gesture.
  try { window.speechSynthesis.cancel(); } catch {}
}

export function speakWith(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!alphaStore.get().settings.voiceEnabled) return;
  const clean = normalizeForSpeech(text);
  if (!clean) return;
  if (!slot) { slot = new SpeechSynthesisUtterance(""); if (!cachedVoice) cachedVoice = pickVoice(); if (cachedVoice) { slot.voice = cachedVoice; slot.lang = cachedVoice.lang; } slot.rate = 1.02; slot.pitch = 1.05; }
  slot.text = clean;
  try { window.speechSynthesis.cancel(); } catch {}
  try { window.speechSynthesis.speak(slot); } catch (e) { console.warn("[voice] speak failed", e); }
}

export function stopSpeaking() { try { window.speechSynthesis.cancel(); } catch {} }

export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => { cachedVoice = pickVoice(); };
}

// ===== STT continuous =====
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
  private restartTimer: number | null = null;
  private silenceTimer: number | null = null;
  private interimBuf = "";
  private handlers: RecHandlers = {};

  get isActive() { return this.active; }
  get analyserNode() { return null; }

  setHandlers(h: RecHandlers) { this.handlers = h; }

  private getRecognitionLang() {
    if (typeof navigator === "undefined") return "en-US";
    const lang = navigator.language?.trim();
    return lang || "en-US";
  }

  start() {
    if (typeof window === "undefined") return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { this.handlers.onError?.("Speech recognition not supported in this browser"); return; }
    this.wantOn = true;
    if (this.active) return;
    const isAndroid = /android/i.test(navigator.userAgent);
    const restartDelay = isAndroid ? 250 : 0;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Build recognizer SYNCHRONOUSLY in the gesture — do NOT await before start().
    const rec = new SR();
    rec.continuous = !isAndroid;
    rec.interimResults = true;
    rec.lang = this.getRecognitionLang();
    rec.onstart = () => { this.active = true; this.handlers.onStart?.(); };
    rec.onend = () => {
      this.active = false;
      if (!this.wantOn) {
        this.handlers.onStop?.();
        return;
      }
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        if (!this.wantOn) {
          this.handlers.onStop?.();
          return;
        }
        try {
          rec.start();
        } catch (err: any) {
          this.wantOn = false;
          this.handlers.onError?.(err?.message || "Could not restart recognition");
          this.handlers.onStop?.();
        }
      }, restartDelay);
    };
    rec.onerror = (e: any) => {
      const err = String(e?.error || "speech error");
      if (err === "no-speech" || err === "aborted") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        this.wantOn = false;
        this.handlers.onError?.("Speech recognition is blocked in this browser context");
        return;
      }
      if (err === "audio-capture") {
        this.wantOn = false;
        this.handlers.onError?.("No usable microphone audio was captured");
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
    this.rec = rec;
    try { rec.start(); } catch (err: any) {
      this.handlers.onError?.(err?.message || "Could not start recognition");
      return;
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
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.interimBuf = "";
    try { this.rec?.abort?.(); } catch {}
    try { this.rec?.stop?.(); } catch {}
    this.active = false;
  }

  dispose() {
    this.stop();
    this.rec = null;
  }
}

export const recognizer = new ContinuousRecognizer();