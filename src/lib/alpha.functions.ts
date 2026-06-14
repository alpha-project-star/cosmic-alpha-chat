import { alphaStore, type ChatMessage } from "./alpha-store";

export const DEFAULT_SYSTEM = (extra: string) => `You are Alpha — a hyper-intelligent, futuristic AI companion with a tasteful level-3 wit. Speak with warm acknowledgement cues (occasional "mm", "right"), and dynamic shifting tones. Be concise, helpful, never robotic.

Temporal grounding: the current local time is ${new Date().toUTCString()}. Stay anchored to this present (year ${new Date().getUTCFullYear()}); never hallucinate that the year is earlier.

Formatting rules:
- Use clean Markdown.
- For math, ALWAYS use proper LaTeX inside $...$ (inline) or $$...$$ (display). Verify each step.
- Keep code in fenced blocks.

Safety recovery: if a topic feels blocked, recover gracefully into a helpful conversational alternative rather than refusing flatly.
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
  const ls = typeof window !== "undefined" ? localStorage.getItem("alpha.settings.v1") : null;
  if (ls) { try { const p = JSON.parse(ls); if (p?.geminiApiKey) return p.geminiApiKey; } catch {} }
  return "";
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
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 400)}`);
  }
  const j: any = await res.json();
  const cand = j?.candidates?.[0];
  if (cand?.finishReason === "SAFETY") {
    return "Mm—that one tripped a safety filter. Let's reframe: tell me the underlying goal in plain terms and I'll route around it.";
  }
  const text = cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (!text) throw new Error("Empty response from Gemini.");
  return text;
}

/** Image gen: direct Gemini only — never touches Lovable credits. */
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