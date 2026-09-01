import { useSyncExternalStore } from "react";

export type ChatRole = "user" | "model" | "system";
export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  images?: string[];
  ts: number;
  error?: boolean;
}

export interface Note { id: string; title: string; body: string; updatedAt: number }
export interface Bill { id: string; name: string; amount: number; dueDate: string; balance: number; status: "due" | "paid" | "overdue" }
export interface Reminder { id: string; title: string; when: string; notes: string; done: "no" | "yes"; firedAt?: number }
export interface Plan { id: string; title: string; from: string; to: string; date: string; details: string }
export interface Memory { id: string; topic: string; detail: string; updatedAt: number }
export interface Profile { name: string; bio: string }

export interface Settings {
  voiceEnabled: boolean;
  continuousListen: boolean;
  preferredVoice: string;
  personaExtra: string;
  kokoroEndpoint: string;
  kokoroVoice: string;
  ttsRate: number;
  // ---- Local / offline backends ----
  ollamaEndpoint: string;                        // e.g. http://localhost:11434
  ollamaModel: string;                           // active local model tag
  ollamaModels: string[];                        // custom list the user typed in Settings
  sttBackend: "browser" | "whisper" | "auto";    // "auto" → whisper when offline
  whisperEndpoint: string;                       // e.g. http://localhost:8001  (OpenAI-compat)
  whisperModel: string;                          // model name for the whisper server
  // ---- Multi-provider model routing ----
  groqApiKey: string;
  openaiCompatKey: string;
  openaiCompatBase: string;                      // e.g. https://api.openai.com/v1
  openRouterKey: string;                         // OpenRouter API key
  // Free-form "watchlist" — comma or newline separated topics Alpha
  // proactively surfaces via the alert bus when a hit lands.
  backgroundData: string;
  // Toggle for background scanners (lights out on scanner when false).
  backgroundEnabled: boolean;
  // Persistent build/spec record — Alpha reads this so he knows himself.
  buildRecord: string;
  // ---- Vision (Cyber-Eye camera) ----
  visionAmbientEnabled: boolean;
  visionAmbientIntervalSec: number;
  // Task -> "provider:model" e.g. "groq:llama-3.1-8b-instant" | "gemini:gemini-2.5-pro" | "openai:gpt-4o-mini"
  taskModels: { fast: string; thinking: string; coding: string };
}

export interface AlphaState {
  chat: ChatMessage[];
  notes: Note[];
  bills: Bill[];
  reminders: Reminder[];
  plans: Plan[];
  memories: Memory[];
  profile: Profile;
  settings: Settings;
}

const K = {
  chat: "alpha.chat.v1",
  notes: "alpha.notes.v1",
  bills: "alpha.bills.v1",
  reminders: "alpha.reminders.v1",
  plans: "alpha.plans.v1",
  memories: "alpha.memories.v1",
  profile: "alpha.profile.v1",
  settings: "alpha.settings.v1",
  summary: "alpha.summary.v1",
};

const DEFAULT_SETTINGS: Settings = {
  voiceEnabled: true,
  continuousListen: true,
  preferredVoice: "",
  personaExtra: "",
  kokoroEndpoint: "",
  kokoroVoice: "am_michael",
  ttsRate: 1.0,
  ollamaEndpoint: "http://localhost:11434",
  ollamaModel: "llama3.2:3b",
  ollamaModels: [],
  sttBackend: "auto",
  whisperEndpoint: "http://localhost:8001",
  whisperModel: "Systran/faster-whisper-small",
  groqApiKey: "",
  openaiCompatKey: "",
  openaiCompatBase: "https://api.openai.com/v1",
  openRouterKey: "",
  backgroundData: "",
  backgroundEnabled: true,
  buildRecord: `# Alpha — Build Record

Alpha is a voice-first, futuristic AI companion built with Alex as one of its
creators. Core layout: cosmic Orb home, split-column desktop HUD, chat with
MiniOrb sticky header, and dedicated Notes / Bills / Reminders / Plans /
Memories / Image tools. State lives in localStorage. Chat routes across
Groq (fast Llama), OpenRouter DeepSeek R1 (deep thinking), OpenRouter Qwen /
Poolside (coding) — every online turn is grounded with a live DuckDuckGo/Jina
web-search block before the model call. Images use Pollinations (no key).
STT: browser Web Speech or local Whisper. TTS: Kokoro or browser. Alarms
fire from an on-device engine with WebAudio chime, system notification, and
voice announcement. Alpha recognises the user as Alex.`,
  visionAmbientEnabled: false,
  visionAmbientIntervalSec: 30,
  taskModels: {
    // Free-tier stack, each verified with a real live completion (2026-08-01):
    //  • fast     → Groq Llama 3.3 70B versatile (~0.1s)
    //  • thinking → OpenRouter Nemotron 3 Super 120B free (~0.7s)
    //  • coding   → OpenRouter Poolside Laguna S 2.1 free (~0.7s, 262k ctx)
    fast: "groq:llama-3.3-70b-versatile",
    thinking: "openrouter:nvidia/nemotron-3-super-120b-a12b:free",
    coding: "openrouter:poolside/laguna-s-2.1:free",
  },
};

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writeLS<T>(key: string, v: T) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}
function notifyReminderChange() {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new CustomEvent("alpha:reminders-changed")); } catch {}
}

let state: AlphaState = {
  chat: readLS<ChatMessage[]>(K.chat, []),
  notes: readLS<Note[]>(K.notes, []),
  bills: readLS<Bill[]>(K.bills, []),
  reminders: readLS<Reminder[]>(K.reminders, []),
  plans: readLS<Plan[]>(K.plans, []),
  memories: readLS<Memory[]>(K.memories, []),
  profile: readLS<Profile>(K.profile, { name: "", bio: "" }),
  settings: { ...DEFAULT_SETTINGS, ...readLS<Partial<Settings>>(K.settings, {}) },
};

// One-shot migration: users still on the old task-model defaults get moved to
// the new free-tier stack (Groq 70B / DeepSeek R1 / Poolside Laguna).
(function migrateTaskModels() {
  const legacy = new Set([
    "groq:llama-3.1-8b-instant",
    "gemini:gemini-2.5-pro",
    "openrouter:poolside/laguna-m.1:free",
    // Slugs OpenRouter has since pulled from the free tier (404 / "paid only"):
    "openrouter:deepseek/deepseek-r1:free",
    "openrouter:deepseek/deepseek-chat-v3.1:free",
    "openrouter:qwen/qwen3-coder:free",
    "openrouter:qwen/qwq-32b:free",
    "openrouter:qwen/qwen2.5-vl-72b-instruct:free",
    "openrouter:mistralai/mistral-small-3.2-24b-instruct:free",
    "openrouter:meta-llama/llama-3.3-70b-instruct:free",
    "openrouter:google/gemini-2.0-flash-exp:free",
    // Verified dead / answer-less on 2026-08-01:
    "openrouter:openai/gpt-oss-20b:free",
    "openrouter:poolside/laguna-xs-2.1:free",
    "openrouter:nvidia/nemotron-nano-9b-v2:free",
    "openrouter:cohere/north-mini-code:free",
  ]);
  const t = state.settings.taskModels;
  const migrated = {
    // Any route pointing at a gemini:… model must be moved off — Gemini is gone.
    fast: legacy.has(t.fast) || /^gemini:/i.test(t.fast) ? DEFAULT_SETTINGS.taskModels.fast : t.fast,
    thinking: legacy.has(t.thinking) || /^gemini:/i.test(t.thinking) ? DEFAULT_SETTINGS.taskModels.thinking : t.thinking,
    coding: legacy.has(t.coding) || /^gemini:/i.test(t.coding) ? DEFAULT_SETTINGS.taskModels.coding : t.coding,
  };
  if (migrated.fast !== t.fast || migrated.thinking !== t.thinking || migrated.coding !== t.coding) {
    state = { ...state, settings: { ...state.settings, taskModels: migrated } };
    writeLS(K.settings, state.settings);
  }
})();

const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
const serverSnap: AlphaState = state;

export function useAlpha<T>(selector: (s: AlphaState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(serverSnap));
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex(x => x.id === item.id);
  return i >= 0 ? list.map(x => x.id === item.id ? item : x) : [item, ...list];
}

export const alphaStore = {
  get: () => state,
  setSettings(patch: Partial<Settings>) {
    state = { ...state, settings: { ...state.settings, ...patch } };
    writeLS(K.settings, state.settings); emit();
  },
  appendChat(msg: ChatMessage) {
    state = { ...state, chat: [...state.chat, msg].slice(-200) };
    writeLS(K.chat, state.chat); emit();
  },
  clearChat() {
    state = { ...state, chat: [] }; writeLS(K.chat, state.chat);
    try { localStorage.removeItem(K.summary); } catch {}
    emit();
  },
  upsertNote(n: Note) { state = { ...state, notes: upsert(state.notes, n) }; writeLS(K.notes, state.notes); emit(); },
  deleteNote(id: string) { state = { ...state, notes: state.notes.filter(x => x.id !== id) }; writeLS(K.notes, state.notes); emit(); },
  upsertBill(b: Bill) { state = { ...state, bills: upsert(state.bills, b) }; writeLS(K.bills, state.bills); emit(); },
  deleteBill(id: string) { state = { ...state, bills: state.bills.filter(x => x.id !== id) }; writeLS(K.bills, state.bills); emit(); },
  upsertReminder(r: Reminder) { state = { ...state, reminders: upsert(state.reminders, r) }; writeLS(K.reminders, state.reminders); emit(); notifyReminderChange(); },
  deleteReminder(id: string) { state = { ...state, reminders: state.reminders.filter(x => x.id !== id) }; writeLS(K.reminders, state.reminders); emit(); notifyReminderChange(); },
  upsertPlan(p: Plan) { state = { ...state, plans: upsert(state.plans, p) }; writeLS(K.plans, state.plans); emit(); },
  deletePlan(id: string) { state = { ...state, plans: state.plans.filter(x => x.id !== id) }; writeLS(K.plans, state.plans); emit(); },
  upsertMemory(m: Memory) { state = { ...state, memories: upsert(state.memories, m) }; writeLS(K.memories, state.memories); emit(); },
  deleteMemory(id: string) { state = { ...state, memories: state.memories.filter(x => x.id !== id) }; writeLS(K.memories, state.memories); emit(); },
  setProfile(p: Profile) { state = { ...state, profile: p }; writeLS(K.profile, p); emit(); },
  /** Remove one message from persistent chat state. Returns true when it existed. */
  deleteChatMessage(id: string): boolean {
    const exists = state.chat.some(m => m.id === id);
    if (!exists) return false;
    state = { ...state, chat: state.chat.filter(m => m.id !== id) };
    writeLS(K.chat, state.chat); emit();
    return true;
  },
  /**
   * Drop the assistant/system reply that follows a user turn so it can be
   * regenerated. Returns the user message text, or null when not retryable.
   */
  prepareRetry(assistantId: string): { userText: string } | null {
    const idx = state.chat.findIndex(m => m.id === assistantId);
    if (idx < 0) return null;
    // Walk back to the nearest user turn.
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i--) if (state.chat[i].role === "user") { userIdx = i; break; }
    if (userIdx < 0) return null;
    // Remove everything after that user turn (the stale reply, and any trailing error).
    const next = state.chat.slice(0, userIdx + 1);
    state = { ...state, chat: next };
    writeLS(K.chat, state.chat); emit();
    return { userText: state.chat[userIdx].text || "" };
  },
};

// ----- Rolling conversation summary (semantic compactor) -----
export const conversationSummary = {
  get(): string {
    if (typeof window === "undefined") return "";
    try { return localStorage.getItem(K.summary) || ""; } catch { return ""; }
  },
  set(s: string) {
    if (typeof window === "undefined") return;
    try { localStorage.setItem(K.summary, s.slice(0, 4000)); } catch {}
  },
  clear() {
    if (typeof window === "undefined") return;
    try { localStorage.removeItem(K.summary); } catch {}
  },
};

export function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }