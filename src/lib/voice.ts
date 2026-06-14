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
  private silenceTimer: number | null = null;
  private interimBuf = "";
  private handlers: RecHandlers = {};
  // Web Audio for spectrum
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private micStream: MediaStream | null = null;

  get isActive() { return this.active; }
  get analyserNode() { return this.analyser; }

  setHandlers(h: RecHandlers) { this.handlers = h; }

  async start() {
    if (typeof window === "undefined") return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { this.handlers.onError?.("Speech recognition not supported in this browser"); return; }
    this.wantOn = true;
    if (this.active) return;
    // Build recognizer SYNCHRONOUSLY in the gesture — do NOT await before start().
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";
    rec.onstart = () => { this.active = true; this.handlers.onStart?.(); };
    rec.onend = () => {
      this.active = false;
      this.handlers.onStop?.();
      if (this.wantOn) { try { rec.start(); } catch {} }
    };
    rec.onerror = (e: any) => {
      const err = String(e?.error || "speech error");
      if (err === "no-speech" || err === "aborted") return; // benign, will auto-restart
      this.handlers.onError?.(err);
      if (err === "not-allowed" || err === "service-not-allowed") this.wantOn = false;
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
    // Set up analyser for the orb spectrum AFTER recognition has started.
    // Failure here is non-fatal — recognition still works without the visualiser.
    this.setupAnalyser().catch(() => {});
  }

  private async setupAnalyser() {
    if (this.audioCtx) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.micStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 128;
      src.connect(this.analyser);
    } catch {
      // mic blocked in iframe or denied — silent, recognition still runs
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
    try { this.rec?.stop(); } catch {}
    this.active = false;
  }

  dispose() {
    this.stop();
    try { this.micStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { this.audioCtx?.close(); } catch {}
    this.audioCtx = null; this.analyser = null; this.micStream = null;
  }
}

export const recognizer = new ContinuousRecognizer();