import { alphaStore, uid, type ChatMessage } from "./alpha-store";
import { tryLocalIntent } from "./local-intents";

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

GROUNDING & TRUTHFULNESS (hard rules — do not violate):
- You DO have a live Google Search tool attached. Use it for anything time-sensitive, news, releases, prices, scores, "this week", "latest", "current", or any fact you are not 100% certain of from training.
- EVIDENCE-ONLY MODE for factual claims. You may only state a concrete fact (title, date, author, URL, number, quote, release window, score, price) if it appears verbatim or paraphrased from a retrieved search result you can point to. If no retrieval evidence exists, say plainly: "I couldn't verify that right now" — do NOT guess, fill, or smooth over.
- You are FORBIDDEN from inventing: article titles, URLs, author names, publication dates, quotations, product version numbers, or organisation announcements. No exceptions.
- Snippet vs full-page honesty: if you only saw a search snippet, do not claim to have read the article. Say "the snippet says…".
- Citations: every fact-bearing sentence drawn from search must end with a bracketed source like [1], [2] matching the Sources list. No citation → no claim.
- Contradiction check: before answering, compare claims to the current date (${new Date().toUTCString()}). If a release/event date is in the past relative to "today" but you're treating it as future (or vice versa), STOP and re-search.
- Confidence: if independent sources disagree or only one source supports a claim, label it "unverified — single source" or "sources disagree".
- If the user contradicts your facts, acknowledge immediately, run a fresh search, and update — never double down.

Formatting:
- Clean Markdown.
- Math in LaTeX: $...$ inline, $$...$$ display. Verify each step.
- Code in fenced blocks.

PROACTIVE INTELLIGENCE — answer the question AND the obvious follow-ups in one pass:
- Predict what the user will need next (who / what / when / where / why / source / link / why-it-matters / caveats) and include it up front.
- Before sending, run an internal completeness check: did I fully answer? what would they ask next? anything missing or unclear? every claim supported? If gaps remain, fix them silently before replying.
- One well-structured reply beats five thin ones. Reduce back-and-forth.

FORMATTING (apply automatically based on content type):
- Use Markdown headings (## / ###) for any answer longer than ~4 short paragraphs. Common sections: Summary, Details, Important Notes, Sources.
- **Bold** only genuinely important phrases (warnings, key terms, the answer itself). Never bold every sentence.
- Bullet lists for groups; numbered lists for ordered steps.
- Tables for any comparison of 2+ items across 2+ attributes (GitHub-flavoured Markdown tables).
- Fence all code in triple backticks with a language tag. Never inline multi-line code in prose.
- Math: $...$ inline, $$...$$ display. Show formula, then a one-line explanation.
- Emojis are visual organisers, not decoration: ✅ confirmed, ❌ wrong, ⚠️ warning, 💡 tip, 📌 important, 🔎 search, 🛠 fix, 📊 data, 🧠 reasoning. At most one per heading; never spam.
- Short paragraphs (≤3 sentences). Prefer link text over raw URLs.

EVIDENCE LABELS — separate facts from reasoning when it matters:
- ✅ Confirmed: directly supported by a cited source.
- 💭 Likely / inference: reasonable extrapolation; label it.
- ❓ Unknown: say so plainly instead of guessing.

SOURCE TRANSPARENCY:
- Prefer "the snippet from <Publisher> says…" over "the article says…" unless you have the full page.
- End factual answers with a **Sources:** list of real titles + URLs from grounding. No source → no concrete claim.

CONVERSATION AWARENESS:
- Remember what the user already told you in this thread; don't make them repeat themselves.
- If they correct you, acknowledge in one short line, then give the corrected answer — never double down.

If a topic is safety-blocked, recover gracefully with a helpful alternative — never refuse flatly.

TOOL ACTIONS — when the user asks you to add / save / store / remove anything in their data, you MUST emit one or more action tags inline in your reply. The app will execute them and confirm to the user.
Use EXACTLY these formats, each on its own line:
[[ADD_NOTE: title | body]]
[[ADD_REMINDER: title | when]]
[[ADD_MEMORY: topic | detail]]
[[ADD_PLAN: title | from | to | date]]
[[ADD_BILL: name | amount | dueDate]]
[[DELETE_LAST: note|reminder|memory|plan|bill]]
Always include the tag whenever a CRUD action is requested. Never say "I've added it" without emitting the tag.
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
  // Local intent shortcut so simple CRUD commands don't burn API credit
  const lastUserMsg = [...history].reverse().find(m => m.role === "user");
  if (lastUserMsg?.text && !lastUserMsg.images?.length) {
    const local = tryLocalIntent(lastUserMsg.text);
    if (local) return local;
  }
  const model = alphaStore.get().settings.chatModel || "gemini-2.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { role: "system", parts: [{ text: DEFAULT_SYSTEM(alphaStore.get().settings.personaExtra || "") }] },
    contents: toGeminiContents(history),
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.85, topP: 0.95 },
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j: any = await res.json();
  const cand = j?.candidates?.[0];
  if (cand?.finishReason === "SAFETY") {
    return "Mm — that one tripped a safety filter. Let's reframe: tell me the underlying goal in plain terms and I'll route around it.";
  }
  let text = cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";

  // ----- Structured evidence extraction from grounding metadata -----
  const chunks: any[] = cand?.groundingMetadata?.groundingChunks ?? [];
  const supports: any[] = cand?.groundingMetadata?.groundingSupports ?? [];
  const evidence = chunks.map((c, i) => ({
    n: i + 1,
    title: c?.web?.title || "",
    url: c?.web?.uri || "",
  })).filter(e => e.url);

  // NOTE: removed the second "fact-checker" pass — it doubled the API cost per
  // user message. The system prompt already enforces evidence-only mode.
  const lastUser = lastUserMsg?.text || "";
  const looksFactual = /\b(who|what|when|where|how many|release|price|score|news|latest|today|yesterday|this week|version|date)\b/i.test(lastUser);

  if (evidence.length) {
    text += "\n\n**Sources:**\n" + evidence.slice(0, 6).map(e => `- [${e.n}] [${e.title || e.url}](${e.url})`).join("\n");
  } else if (looksFactual) {
    text += "\n\n_No web sources were returned for this answer — treat any specifics as uncertain._";
  }

  if (!text) throw new Error("Empty response from Gemini.");
  return executeActionTags(text);
}

function executeActionTags(text: string): string {
  const actions: string[] = [];
  const apply = (re: RegExp, fn: (m: RegExpExecArray) => string | null) => {
    text = text.replace(re, (_full, ...args) => {
      const m = [_full, ...args] as unknown as RegExpExecArray;
      const note = fn(m);
      if (note) actions.push(note);
      return "";
    });
  };
  apply(/\[\[ADD_NOTE:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi, (m) => {
    alphaStore.upsertNote({ id: uid(), title: m[1].trim().slice(0, 60), body: m[2].trim(), updatedAt: Date.now() });
    return `📝 Note added: "${m[1].trim()}"`;
  });
  apply(/\[\[ADD_REMINDER:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi, (m) => {
    alphaStore.upsertReminder({ id: uid(), title: m[1].trim(), when: m[2].trim(), notes: "", done: "no" });
    return `⏰ Reminder added: "${m[1].trim()}" — ${m[2].trim()}`;
  });
  apply(/\[\[ADD_MEMORY:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi, (m) => {
    alphaStore.upsertMemory({ id: uid(), topic: m[1].trim().slice(0, 60), detail: m[2].trim(), updatedAt: Date.now() });
    return `🧠 Memory saved: "${m[1].trim()}"`;
  });
  apply(/\[\[ADD_PLAN:\s*([^|\]]+?)\s*\|\s*([^|\]]*?)\s*\|\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]\]/gi, (m) => {
    alphaStore.upsertPlan({ id: uid(), title: m[1].trim(), from: m[2].trim(), to: m[3].trim(), date: m[4].trim(), details: "" });
    return `🗺 Plan added: "${m[1].trim()}"`;
  });
  apply(/\[\[ADD_BILL:\s*([^|\]]+?)\s*\|\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]\]/gi, (m) => {
    const amt = Number(m[2].trim().replace(/[^\d.]/g, "")) || 0;
    alphaStore.upsertBill({ id: uid(), name: m[1].trim(), amount: amt, balance: amt, dueDate: m[3].trim(), status: "due" });
    return `💳 Bill added: "${m[1].trim()}"${amt ? ` — $${amt}` : ""}`;
  });
  apply(/\[\[DELETE_LAST:\s*(note|reminder|memory|plan|bill)\s*\]\]/gi, (m) => {
    const kind = m[1].toLowerCase();
    const s = alphaStore.get();
    const map: Record<string, { list: any[]; del: (id: string) => void }> = {
      note: { list: s.notes, del: alphaStore.deleteNote },
      reminder: { list: s.reminders, del: alphaStore.deleteReminder },
      memory: { list: s.memories, del: alphaStore.deleteMemory },
      plan: { list: s.plans, del: alphaStore.deletePlan },
      bill: { list: s.bills, del: alphaStore.deleteBill },
    };
    const e = map[kind]; if (e?.list[0]) { e.del(e.list[0].id); return `🗑 Deleted last ${kind}.`; }
    return `No ${kind}s to delete.`;
  });
  if (actions.length) {
    text = text.trim() + (text.trim() ? "\n\n" : "") + actions.join("\n");
  }
  return text.trim();
}

export async function generateImage(prompt: string): Promise<{ dataUrl: string; via: "gemini" }> {
  const key = getKey();
  if (!key) throw new Error("No Gemini API key set. Open Settings to paste your key.");
  // Try current model names in order — Google has renamed this several times.
  const models = [
    "gemini-2.5-flash-image",
    "gemini-2.5-flash-image-preview",
    "gemini-2.0-flash-preview-image-generation",
    "imagen-3.0-generate-002",
  ];
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };
  let lastErr = "";
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { lastErr = `${model}: ${res.status} ${(await res.text()).slice(0,200)}`; continue; }
      const j: any = await res.json();
      const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find(p => p.inlineData?.data);
      if (!inline) { lastErr = `${model}: no image in response`; continue; }
      return { dataUrl: `data:${inline.inlineData.mimeType || "image/png"};base64,${inline.inlineData.data}`, via: "gemini" };
    } catch (e: any) {
      lastErr = `${model}: ${e?.message || e}`;
    }
  }
  throw new Error(`Image generation failed. Your API key may not have access to image models on AI Studio. Last error: ${lastErr}`);
}