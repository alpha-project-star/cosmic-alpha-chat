import { alphaStore, type ChatMessage } from "./alpha-store";

function ctxSummary() {
  const s = alphaStore.get();
  const briefList = (items: any[], pick: (x: any) => string) =>
    items.slice(0, 8).map(pick).filter(Boolean).join("; ") || "—";
  return [
    `Notes (${s.notes.length}): ${briefList(s.notes, n => n.title || (n.body || "").slice(0, 40))}`,
    `Bills (${s.bills.length}): ${briefList(s.bills, b => `${b.name} $${b.balance} (${b.status})`)}`,
    `Reminders (${s.reminders.length}): ${briefList(s.reminders, r => `${r.title} @ ${r.when} [${r.done}]`)}`,
    `Plans (${s.plans.length}): ${briefList(s.plans, p => `${p.title} ${p.from}→${p.to} ${p.date}`)}`,
    `Memories (${s.memories.length}): ${briefList(s.memories, m => `${m.topic}: ${m.detail.slice(0, 60)}`)}`,
    `Profile: ${s.profile.name || "(unset)"} — ${s.profile.bio || ""}`,
  ].join("\n");
}

export const DEFAULT_SYSTEM = (extra: string) => `You are Alpha — a hyper-intelligent, futuristic AI companion with warm, level-3 wit. Speak naturally with light acknowledgement cues ("mm", "right", "got it") and dynamic tone. Be concise, helpful, never robotic.

You are fully aware of your own toolkit inside this app:
- /chat — text + voice chat with you (this surface).
- /  (the Orb) — voice-first hands-free mode. User can say "open chat / notes / bills / image / reminders / plans / memories / settings" to navigate.
- /notes — quick notes (title + body).
- /bills — bill ledger (name, amount, balance, due date, status).
- /reminders — alarms / reminders (title, when, notes, done).
- /plans — plans & routes (title, from, to, date, details).
- /memories — long-term memory the user wants you to keep (topic, detail).
- /image — image generation dashboard.
- /settings — Gemini key, model, Kokoro TTS endpoint, voice prefs.

You ALWAYS have live context of the user's data and may proactively reference it, follow up on it, or casually weave it into conversation when relevant.

Current local time: ${new Date().toUTCString()}. Year: ${new Date().getUTCFullYear()}. Never claim it's earlier.

Live user data snapshot:
${ctxSummary()}

If the user asks to remember something, suggest "I'll add that to memories — say open memories." If they mention a deadline, offer to add a reminder. If they mention a trip, offer to add a plan. Be casual about it; one sentence.

Formatting:
- Clean Markdown.
- Math in LaTeX: $...$ inline, $$...$$ display. Verify each step.
- Code in fenced blocks.

If a topic is safety-blocked, recover gracefully with a helpful alternative — never refuse flatly.
${extra ? "\nUser personalisation:\n" + extra : ""}`;

type GeminiPart = { text?: string } | { inlineData: { mimeType: string; data: string } };

function toGeminiContents(history: ChatMessage[]) {
  return history.filter(m => m.role !== "system").slice(-100).map(m => {
    const parts: GeminiPart[] = [];
    if (m.text) parts.push({ text: m.text });
    if (m.images?.length) {
      for (const img of m.images) {
        const match = img.match(/^data:(.+?);base64,(.+)$/);
        if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
    return { role: m.role === "user" ? "user" : "model", parts };
  });
}

function getKey(): string {
  return alphaStore.get().settings.geminiApiKey || "";
}

export async function sendChat(history: ChatMessage[]): Promise<string> {
  const key = getKey();
  if (!key) throw new Error("No Gemini API key set. Open Settings to paste your key.");
  const model = alphaStore.get().settings.chatModel || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { role: "system", parts: [{ text: DEFAULT_SYSTEM(alphaStore.get().settings.personaExtra || "") }] },
    contents: toGeminiContents(history),
    generationConfig: { temperature: 0.85, topP: 0.95 },
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j: any = await res.json();
  const cand = j?.candidates?.[0];
  if (cand?.finishReason === "SAFETY") {
    return "Mm — that one tripped a safety filter. Let's reframe: tell me the underlying goal in plain terms and I'll route around it.";
  }
  const text = cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (!text) throw new Error("Empty response from Gemini.");
  return text;
}

export async function generateImage(prompt: string): Promise<{ dataUrl: string; via: "gemini" }> {
  const key = getKey();
  if (!key) throw new Error("No Gemini API key set. Open Settings to paste your key.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini image ${res.status}: ${(await res.text()).slice(0,300)}`);
  const j: any = await res.json();
  const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find(p => p.inlineData?.data);
  if (!inline) throw new Error("No image returned by Gemini.");
  return { dataUrl: `data:${inline.inlineData.mimeType || "image/png"};base64,${inline.inlineData.data}`, via: "gemini" };
}