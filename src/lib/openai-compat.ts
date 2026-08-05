import type { ChatMessage } from "./alpha-store";

/**
 * Minimal OpenAI-compatible /chat/completions caller. Works for Groq
 * (https://api.groq.com/openai/v1) and OpenAI itself.
 */
export async function sendChatOpenAICompat(
  history: ChatMessage[],
  systemPrompt: string,
  opts: {
    baseUrl: string;
    apiKey: string;
    model: string;
    extraHeaders?: Record<string, string>;
    extraBody?: Record<string, unknown>;
    /** Only true for vision-capable lanes. Text-only providers (Groq Llama)
     * hard-400 with `messages[n].content must be a string` when handed an
     * OpenAI content array, so images are flattened to text by default. */
    allowImages?: boolean;
  },
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
  const turns = history.filter(m => m.role !== "system").slice(-40);
  // Only the newest user turn keeps its images. Re-sending every historical
  // base64 image balloons the payload into megabytes and makes vision
  // providers stall out mid-request.
  const lastImageIdx = (() => {
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "user" && turns[i].images?.length) return i;
    return -1;
  })();
  for (let idx = 0; idx < turns.length; idx++) {
    const m = turns[idx];
    const role = m.role === "user" ? "user" : "assistant";
    const keepImages = idx === lastImageIdx;
    if (role === "user" && m.images?.length && opts.allowImages && keepImages) {
      const parts: any[] = [];
      if (m.text) parts.push({ type: "text", text: m.text });
      for (const img of m.images) parts.push({ type: "image_url", image_url: { url: img } });
      messages.push({ role, content: parts });
    } else if (role === "user" && m.images?.length && keepImages) {
      const note = `[user attached ${m.images.length} image${m.images.length > 1 ? "s" : ""} — not visible to this text-only model]`;
      messages.push({ role, content: m.text ? `${m.text}\n\n${note}` : note });
    } else if (role === "user" && m.images?.length) {
      messages.push({ role, content: m.text || "[image]" });
    } else {
      messages.push({ role, content: m.text || "" });
    }
  }
  // Hard timeout so a stalled provider surfaces an error instead of leaving
  // the UI stuck on "Alpha is thinking…".
  const ctrl = new AbortController();
  const timeoutMs = opts.allowImages ? 90_000 : 60_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
    method: "POST",
    signal: ctrl.signal,
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
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`${opts.model} timed out after ${Math.round(timeoutMs / 1000)}s. Try a smaller image or another model.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  const msg = j?.choices?.[0]?.message;
  let text = (typeof msg?.content === "string" ? msg.content : "").trim();
  // Some reasoning models (Nemotron Nano, Poolside Laguna XS on OpenRouter)
  // return their answer in `reasoning` / `reasoning_content` and leave
  // `content` empty. Use it rather than failing the whole turn.
  if (!text) {
    const reasoning = (typeof msg?.reasoning === "string" ? msg.reasoning : "")
      || (typeof msg?.reasoning_content === "string" ? msg.reasoning_content : "");
    text = reasoning.trim();
  }
  if (!text) throw new Error("Empty response from model.");
  return text;
}