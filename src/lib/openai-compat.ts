import type { ChatMessage } from "./alpha-store";

/**
 * Minimal OpenAI-compatible /chat/completions caller. Works for Groq
 * (https://api.groq.com/openai/v1) and OpenAI itself.
 */
export async function sendChatOpenAICompat(
  history: ChatMessage[],
  systemPrompt: string,
  opts: { baseUrl: string; apiKey: string; model: string; extraHeaders?: Record<string, string> },
): Promise<string> {
  const url = opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.filter(m => m.role !== "system").slice(-40).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text || "",
    })),
  ];
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      ...(opts.extraHeaders || {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: 0.8,
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const err: any = new Error(`${opts.model} ${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const j: any = await res.json();
  const text = j?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("Empty response from model.");
  return text;
}