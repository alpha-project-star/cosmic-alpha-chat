import { useSyncExternalStore } from "react";

export type ChatRole = "user" | "model" | "system";
export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  images?: string[]; // base64 data URLs
  ts: number;
  error?: boolean;
}

export interface Note { id: string; title: string; body: string; updatedAt: number }
export interface Bill { id: string; name: string; amount: number; dueDate: string; balance: number; status: "due" | "paid" | "overdue" }
export interface Profile { name: string; bio: string }

export interface Settings {
  geminiApiKey: string;
  chatModel: string;
  voiceEnabled: boolean;
  continuousListen: boolean;
  preferredVoice: string;
  personaExtra: string;
}

export interface AlphaState {
  chat: ChatMessage[];
  notes: Note[];
  bills: Bill[];
  profile: Profile;
  settings: Settings;
}

const CHAT_KEY = "alpha.chat.v1";
const NOTES_KEY = "alpha.notes.v1";
const BILLS_KEY = "alpha.bills.v1";
const PROFILE_KEY = "alpha.profile.v1";
const SETTINGS_KEY = "alpha.settings.v1";
export const CHAT_KEY_CONST = CHAT_KEY;

const DEFAULT_SETTINGS: Settings = {
  geminiApiKey: "",
  chatModel: "gemini-2.5-flash",
  voiceEnabled: true,
  continuousListen: true,
  preferredVoice: "",
  personaExtra: "",
};

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writeLS<T>(key: string, v: T) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

let state: AlphaState = {
  chat: readLS<ChatMessage[]>(CHAT_KEY, []),
  notes: readLS<Note[]>(NOTES_KEY, []),
  bills: readLS<Bill[]>(BILLS_KEY, []),
  profile: readLS<Profile>(PROFILE_KEY, { name: "", bio: "" }),
  settings: { ...DEFAULT_SETTINGS, ...readLS<Partial<Settings>>(SETTINGS_KEY, {}) },
};

const listeners = new Set<() => void>();
function emit() { listeners.forEach(l => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
function getSnapshot() { return state; }
const serverSnap: AlphaState = state;
function getServerSnapshot() { return serverSnap; }

export function useAlpha<T>(selector: (s: AlphaState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(serverSnap));
}

export const alphaStore = {
  get: () => state,
  setSettings(patch: Partial<Settings>) {
    state = { ...state, settings: { ...state.settings, ...patch } };
    writeLS(SETTINGS_KEY, state.settings); emit();
  },
  appendChat(msg: ChatMessage) {
    const next = [...state.chat, msg];
    state = { ...state, chat: next.slice(-100) };
    writeLS(CHAT_KEY, state.chat); emit();
  },
  updateLastChat(updater: (m: ChatMessage) => ChatMessage) {
    if (!state.chat.length) return;
    const next = [...state.chat];
    next[next.length - 1] = updater(next[next.length - 1]);
    state = { ...state, chat: next };
    writeLS(CHAT_KEY, state.chat); emit();
  },
  clearChat() { state = { ...state, chat: [] }; writeLS(CHAT_KEY, state.chat); emit(); },
  upsertNote(n: Note) {
    const i = state.notes.findIndex(x => x.id === n.id);
    const notes = i >= 0 ? state.notes.map(x => x.id === n.id ? n : x) : [n, ...state.notes];
    state = { ...state, notes }; writeLS(NOTES_KEY, notes); emit();
  },
  deleteNote(id: string) {
    state = { ...state, notes: state.notes.filter(n => n.id !== id) };
    writeLS(NOTES_KEY, state.notes); emit();
  },
  upsertBill(b: Bill) {
    const i = state.bills.findIndex(x => x.id === b.id);
    const bills = i >= 0 ? state.bills.map(x => x.id === b.id ? b : x) : [b, ...state.bills];
    state = { ...state, bills }; writeLS(BILLS_KEY, bills); emit();
  },
  deleteBill(id: string) {
    state = { ...state, bills: state.bills.filter(b => b.id !== id) };
    writeLS(BILLS_KEY, state.bills); emit();
  },
  setProfile(p: Profile) { state = { ...state, profile: p }; writeLS(PROFILE_KEY, p); emit(); },
};

export function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }