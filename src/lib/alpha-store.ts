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
    // Free-tier stack (Gemini removed — all providers key-based & web-grounded):
    //  • fast     → Groq Llama 3.3 70B versatile (blazing chat)
    //  • thinking → OpenRouter DeepSeek R1 free (chain-of-thought reasoning)
    //  • coding   → OpenRouter Qwen3 Coder free (long-context coding)
    fast: "groq:llama-3.3-70b-versatile",
    thinking: "openrouter:deepseek/deepseek-r1:free",
    coding: "openrouter:qwen/qwen3-coder:free",
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