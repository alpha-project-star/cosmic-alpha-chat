import { normalizeForSpeech } from "./speech-text";
import { alphaStore } from "./alpha-store";
import { WhisperRecognizer } from "./whisper";

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
let audioUnlocked = false;
// Tiny silent WAV (~0.05s) to unlock <audio> playback inside a user gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

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
  // Unlock <audio> playback for later Kokoro fetches (Android/iOS gesture rule)
  if (!audioUnlocked) {
    try {
      const a = new Audio(SILENT_WAV);
      a.volume = 0;
      const p = a.play();
      if (p && typeof p.then === "function") p.then(() => { audioUnlocked = true; }).catch(() => {});
      else audioUnlocked = true;
    } catch {}
  }
}

async function tryKokoro(text: string): Promise<HTMLAudioElement | null> {
  const { kokoroEndpoint, kokoroVoice } = alphaStore.get().settings;
  if (!kokoroEndpoint || !kokoroEndpoint.trim()) return null;
  const raw = kokoroEndpoint.trim();
  const voice = kokoroVoice || "am_michael";
  const speed = alphaStore.get().settings.ttsRate || 1;

  // Build the two candidate request shapes we know:
  //   1) OpenAI-compatible Kokoro-FastAPI   → POST {endpoint}              { input, voice, model, response_format }
  //   2) xxparthparekhxx Kokoro-TTS-FastAPI → POST {origin}/tts            { text, voice, output_format, speed }
  let origin = raw;
  try { origin = new URL(raw).origin; } catch {}
  const attempts: Array<{ url: string; body: any }> = [
    { url: raw, body: { input: text, model: "kokoro", voice, response_format: "mp3", speed } },
    { url: `${origin}/tts`, body: { text, voice, output_format: "mp3", speed } },
    { url: `${origin}/v1/audio/speech`, body: { input: text, model: "kokoro", voice, response_format: "mp3", speed } },
  ];
  // De-dupe
  const seen = new Set<string>();
  const tries = attempts.filter(a => (seen.has(a.url) ? false : (seen.add(a.url), true)));

  let lastErr = "";
  try {
    for (const a of tries) {
      try {
        const res = await fetch(a.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a.body),
        });
        if (!res.ok) { lastErr = `HTTP ${res.status} @ ${a.url}`; continue; }
        const ct = res.headers.get("content-type") || "";
        if (!/audio|octet-stream/i.test(ct)) { lastErr = `non-audio (${ct}) @ ${a.url}`; continue; }
        const blob = await res.blob();
        if (!blob.size) { lastErr = `empty audio @ ${a.url}`; continue; }
        return new Audio(URL.createObjectURL(blob));
      } catch (e: any) {
        lastErr = `${e?.message || e} @ ${a.url}`;
      }
    }
    throw new Error(lastErr || "All Kokoro attempts failed");
  } catch (e) {
    console.warn("[voice] Kokoro failed, falling back to browser TTS:", e);
    try { window.dispatchEvent(new CustomEvent("kokoro-fail", { detail: String((e as any)?.message || e) })); } catch {}
    return null;
  }
}

/** Split text into short chunks (≤220 chars) at sentence boundaries for low-latency streaming TTS. */
function chunkForTTS(text: string, maxLen = 220): string[] {
  const out: string[] = [];
  const sentences = text.match(/[^.!?\n]+[.!?]+|[^.!?\n]+$/g) ?? [text];
  let buf = "";
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    if (t.length > maxLen) {
      if (buf) { out.push(buf); buf = ""; }
      // hard-split very long sentences on commas/spaces
      const parts = t.match(new RegExp(`.{1,${maxLen}}(\\s|,|;|:|$)`, "g")) ?? [t];
      for (const p of parts) out.push(p.trim());
      continue;
    }
    if ((buf + " " + t).trim().length > maxLen) { out.push(buf); buf = t; }
    else { buf = buf ? buf + " " + t : t; }
  }
  if (buf) out.push(buf);
  return out.filter(Boolean);
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
let speakToken = 0;

function playAudio(audio: HTMLAudioElement): Promise<boolean> {
  return new Promise(resolve => {
    let played = false;
    audio.onended = () => resolve(played);
    audio.onerror = () => resolve(played);
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.then(() => { played = true; }).catch(() => resolve(false));
    } else { played = true; }
  });
}

export async function speakWith(text: string): Promise<void> {
  if (!alphaStore.get().settings.voiceEnabled) return;
  const clean = normalizeForSpeech(text);
  if (!clean) return;
  stopSpeaking();
  const myToken = ++speakToken;
  setSpeaking(true);
  const wasListening = recognizer.isWanted;
  if (wasListening) recognizer.suspend();

  try {
    const { kokoroEndpoint } = alphaStore.get().settings;
    if (!kokoroEndpoint || !kokoroEndpoint.trim()) {
      await browserSpeak(clean);
      return;
    }

    // Pipeline: split into chunks, fetch next while playing current.
    const chunks = chunkForTTS(clean);
    let nextFetch: Promise<HTMLAudioElement | null> = tryKokoro(chunks[0]);
    let kokoroBroken = false;

    for (let i = 0; i < chunks.length; i++) {
      if (myToken !== speakToken) return; // cancelled by a newer speakWith / stopSpeaking
      const audioP = nextFetch;
      // pre-fetch the next chunk in parallel
      nextFetch = i + 1 < chunks.length && !kokoroBroken
        ? tryKokoro(chunks[i + 1])
        : Promise.resolve(null);

      const audio = await audioP;
      if (myToken !== speakToken) return;
      if (!audio) {
        kokoroBroken = true;
        await browserSpeak(chunks[i]);
        continue;
      }
      currentAudio = audio;
      const played = await playAudio(audio);
      currentAudio = null;
      if (myToken !== speakToken) return;
      if (!played) {
        // autoplay blocked — fall back for remaining chunks
        kokoroBroken = true;
        await browserSpeak(chunks[i]);
      }
    }
  } finally {
    if (myToken === speakToken) {
      setSpeaking(false);
      if (wasListening) {
        setTimeout(() => { if (recognizer.isWanted) recognizer.resume(); }, 350);
      }
    }
  }
}

export function stopSpeaking() {
  speakToken++;
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

// ============================================================
// Backend-aware recognizer facade
// ============================================================
// The rest of the app imports `recognizer` and expects a single object with
// setHandlers/start/stop/suspend/resume/isWanted/isActive/analyserNode.
// We add a thin wrapper that routes calls to either the browser recognizer
// above (Web Speech API — needs internet on Chrome/Android) or the local
// Whisper recognizer when the user picked "whisper" (or "auto" while offline).
// ============================================================

type AnyRec = {
  setHandlers: (h: any) => void;
  start: () => void | Promise<void>;
  stop: () => void;
  suspend: () => void;
  resume: () => void;
  isWanted: boolean;
  isActive: boolean;
  analyserNode: AnalyserNode | null;
};

let _whisper: WhisperRecognizer | null = null;
let _handlers: any = {};
let _current: AnyRec | null = null;

function browserSttSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

function pickBackend(): "browser" | "whisper" {
  const pref = alphaStore.get().settings.sttBackend;
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  if (pref === "whisper") return "whisper";
  if (pref === "browser") return browserSttSupported() ? "browser" : "whisper";
  // auto: prefer browser when online (near-zero latency); Whisper when offline
  return online && browserSttSupported() ? "browser" : "whisper";
}

function build(kind: "browser" | "whisper"): AnyRec {
  if (kind === "whisper") {
    if (!_whisper) _whisper = new WhisperRecognizer();
    _whisper.setHandlers(_handlers);
    return _whisper as unknown as AnyRec;
  }
  recognizer.setHandlers(_handlers);
  return recognizer as unknown as AnyRec;
}

export const alphaRecognizer = {
  setHandlers(h: any) {
    _handlers = h;
    if (_current) _current.setHandlers(h);
  },
  start() {
    const kind = pickBackend();
    if (_current && ((kind === "whisper" && _current !== (_whisper as any)) || (kind === "browser" && _current !== (recognizer as any)))) {
      try { _current.stop(); } catch {}
      _current = null;
    }
    if (!_current) _current = build(kind);
    void _current.start();
  },
  stop() { try { _current?.stop(); } catch {} },
  suspend() { try { _current?.suspend(); } catch {} },
  resume() { try { _current?.resume(); } catch {} },
  get isWanted() { return !!_current?.isWanted; },
  get isActive() { return !!_current?.isActive; },
  get analyserNode() { return _current?.analyserNode ?? null; },
};