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
export interface Reminder { id: string; title: string; when: string; notes: string; done: "no" | "yes" }
export interface Plan { id: string; title: string; from: string; to: string; date: string; details: string }
export interface Memory { id: string; topic: string; detail: string; updatedAt: number }
export interface Profile { name: string; bio: string }

export interface Settings {
  geminiApiKey: string;
  chatModel: string;
  voiceEnabled: boolean;
  continuousListen: boolean;
  preferredVoice: string;
  personaExtra: string;
  kokoroEndpoint: string;
  kokoroVoice: string;
  ttsRate: number;
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
  geminiApiKey: "",
  chatModel: "gemini-2.5-pro",
  voiceEnabled: true,
  continuousListen: true,
  preferredVoice: "",
  personaExtra: "",
  kokoroEndpoint: "",
  kokoroVoice: "am_michael",
  ttsRate: 1.0,
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
  chat: readLS<ChatMessage[]>(K.chat, []),
  notes: readLS<Note[]>(K.notes, []),
  bills: readLS<Bill[]>(K.bills, []),
  reminders: readLS<Reminder[]>(K.reminders, []),
  plans: readLS<Plan[]>(K.plans, []),
  memories: readLS<Memory[]>(K.memories, []),
  profile: readLS<Profile>(K.profile, { name: "", bio: "" }),
  settings: { ...DEFAULT_SETTINGS, ...readLS<Partial<Settings>>(K.settings, {}) },
};

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
  clearChat() { state = { ...state, chat: [] }; writeLS(K.chat, state.chat); emit(); },
  upsertNote(n: Note) { state = { ...state, notes: upsert(state.notes, n) }; writeLS(K.notes, state.notes); emit(); },
  deleteNote(id: string) { state = { ...state, notes: state.notes.filter(x => x.id !== id) }; writeLS(K.notes, state.notes); emit(); },
  upsertBill(b: Bill) { state = { ...state, bills: upsert(state.bills, b) }; writeLS(K.bills, state.bills); emit(); },
  deleteBill(id: string) { state = { ...state, bills: state.bills.filter(x => x.id !== id) }; writeLS(K.bills, state.bills); emit(); },
  upsertReminder(r: Reminder) { state = { ...state, reminders: upsert(state.reminders, r) }; writeLS(K.reminders, state.reminders); emit(); },
  deleteReminder(id: string) { state = { ...state, reminders: state.reminders.filter(x => x.id !== id) }; writeLS(K.reminders, state.reminders); emit(); },
  upsertPlan(p: Plan) { state = { ...state, plans: upsert(state.plans, p) }; writeLS(K.plans, state.plans); emit(); },
  deletePlan(id: string) { state = { ...state, plans: state.plans.filter(x => x.id !== id) }; writeLS(K.plans, state.plans); emit(); },
  upsertMemory(m: Memory) { state = { ...state, memories: upsert(state.memories, m) }; writeLS(K.memories, state.memories); emit(); },
  deleteMemory(id: string) { state = { ...state, memories: state.memories.filter(x => x.id !== id) }; writeLS(K.memories, state.memories); emit(); },
  setProfile(p: Profile) { state = { ...state, profile: p }; writeLS(K.profile, p); emit(); },
};

export function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }