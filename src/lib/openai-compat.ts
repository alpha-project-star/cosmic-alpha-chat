import type { ChatMessage } from "./alpha-store";

/**
 * Minimal OpenAI-compatible /chat/completions caller. Works for Groq
 * (https://api.groq.com/openai/v1) and OpenAI itself.
 */
export async function sendChatOpenAICompat(
  history: ChatMessage[],
  systemPrompt: string,
  opts: { baseUrl: string; apiKey: string; model: string; extraHeaders?: Record<string, string>; extraBody?: Record<string, unknown> },
): Promise<string> {
  const apiKey = (opts.apiKey || "").replace(/[\s\r\n\t]+/g, "").replace(/^Bearer/i, "");
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${opts.baseUrl}. Open Settings → Online and paste a valid key for this provider.`,
    );
  }
  const url = opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  // Multimodal-aware: if a user turn has base64 images, emit an OpenAI-style
  // content array (text + image_url data URLs). OpenRouter vision models and
  // OpenAI vision endpoints both accept this shape; text-only providers
  // (Groq Llama text lanes) will simply see the array and ignore images if
  // they don't support vision — callers should route image turns to a
  // vision-capable model.
  const messages: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of history.filter(m => m.role !== "system").slice(-40)) {
    const role = m.role === "user" ? "user" : "assistant";
    if (role === "user" && m.images?.length) {
      const parts: any[] = [];
      if (m.text) parts.push({ type: "text", text: m.text });
      for (const img of m.images) parts.push({ type: "image_url", image_url: { url: img } });
      messages.push({ role, content: parts });
    } else {
      messages.push({ role, content: m.text || "" });
    }
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(opts.extraHeaders || {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: 0.8,
      stream: false,
      ...(opts.extraBody || {}),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    let hint = "";
    if (res.status === 401) {
      hint = ` — the provider rejected the Authorization header. Re-paste the API key in Settings → Online (no "Bearer" prefix, no quotes, no line breaks).`;
    } else if (res.status === 404) {
      hint = ` — model "${opts.model}" was not found on this provider. Pick a different model in Settings → Online → Task-based models.`;
    }
    const err: any = new Error(`${opts.model} ${res.status}${hint}: ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const j: any = await res.json();
  const text = j?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("Empty response from model.");
  return text;
}