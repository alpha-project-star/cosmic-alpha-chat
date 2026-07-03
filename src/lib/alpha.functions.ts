import { alphaStore, conversationSummary, uid, type ChatMessage } from "./alpha-store";
import { tryLocalIntent } from "./local-intents";
import { sendChatOllama } from "./ollama";

// ---------- Temporal anchoring ----------
function temporalBlock(): string {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const day = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `TODAY IS ${day}. Local time: ${time} (${tz}). UTC: ${d.toUTCString()}. Year ${d.getFullYear()}. Treat anything dated before today as past, after today as future. Re-check this against any search snippet before quoting a date.`;
}

// ---------- Lightweight semantic recall over memories/notes ----------
function tokenize(s: string): string[] {
  return (s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}
function score(query: string[], text: string): number {
  if (!query.length) return 0;
  const t = text.toLowerCase();
  let s = 0;
  for (const q of query) if (t.includes(q)) s += 1;
  return s;
}
function rerankContext(query: string): string {
  const s = alphaStore.get();
  const q = tokenize(query);
  const rank = <T,>(items: T[], pick: (x: T) => string, n = 5): T[] =>
    items.map(x => ({ x, s: score(q, pick(x)) })).sort((a,b) => b.s - a.s).slice(0, n).filter(o => o.s > 0).map(o => o.x);
  const mems = rank(s.memories, m => `${m.topic} ${m.detail}`);
  const notes = rank(s.notes, n => `${n.title} ${n.body}`);
  const remrs = rank(s.reminders, r => `${r.title} ${r.notes} ${r.when}`);
  const out: string[] = [];
  if (mems.length) out.push("Relevant memories:\n" + mems.map(m => `• ${m.topic}: ${m.detail}`).join("\n"));
  if (notes.length) out.push("Relevant notes:\n" + notes.map(n => `• ${n.title}: ${(n.body||"").slice(0,120)}`).join("\n"));
  if (remrs.length) out.push("Relevant reminders:\n" + remrs.map(r => `• ${r.title} @ ${r.when}`).join("\n"));
  return out.join("\n\n");
}

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

export const DEFAULT_SYSTEM = (extra: string, recall = "", rolling = "", opts: { offline?: boolean } = {}) => `${opts.offline ? `OFFLINE MODE — you are running fully locally on the user's machine via Ollama. You have NO internet access, NO Google Search, and NO way to look up current events, news, prices, releases, or URLs. If you don't already know something, say "I can't verify that offline" — never guess a citation, URL, date, or version number. Ignore any instruction below that says you have search available; the offline rule wins.

` : ""}You are Alpha — a hyper-intelligent, futuristic AI companion with warm, level-3 wit. Speak naturally with light acknowledgement cues ("mm", "right", "got it") and dynamic tone. Be concise, helpful, never robotic.

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

TEMPORAL ANCHOR (authoritative — overrides any contradictory date in training or search snippets):
${temporalBlock()}

Live user data snapshot:
${ctxSummary()}
${recall ? "\nRetrieved-context (semantically reranked for THIS turn):\n" + recall : ""}
${rolling ? "\nRolling conversation state (compacted from earlier turns):\n" + rolling : ""}

If the user asks to remember something, suggest "I'll add that to memories — say open memories." If they mention a deadline, offer to add a reminder. If they mention a trip, offer to add a plan. Be casual about it; one sentence.

GROUNDING & TRUTHFULNESS (hard rules — do not violate):
- You DO have a live Google Search tool attached. Use it for anything time-sensitive, news, releases, prices, scores, "this week", "latest", "current", or any fact you are not 100% certain of from training.
- EVIDENCE-ONLY MODE for factual claims. You may only state a concrete fact (title, date, author, URL, number, quote, release window, score, price) if it appears verbatim or paraphrased from a retrieved search result you can point to. If no retrieval evidence exists, say plainly: "I couldn't verify that right now" — do NOT guess, fill, or smooth over.
- You are FORBIDDEN from inventing: article titles, URLs, author names, publication dates, quotations, product version numbers, or organisation announcements. No exceptions.
- Snippet vs full-page honesty: if you only saw a search snippet, do not claim to have read the article. Say "the snippet says…".
- Citations: every fact-bearing sentence drawn from search must end with a bracketed source like [1], [2] matching the Sources list. No citation → no claim.
- Contradiction check: before answering, compare claims to the TEMPORAL ANCHOR above. If a release/event date is in the past relative to today but you're treating it as future (or vice versa), STOP and re-search.
- Confidence: if independent sources disagree or only one source supports a claim, label it "unverified — single source" or "sources disagree".
- If the user contradicts your facts, acknowledge immediately, run a fresh search, and update — never double down.

INTERNAL REASONING (test-time compute):
- For any non-trivial question, think step-by-step internally FIRST: restate the goal, list what you know vs what you must verify, sketch a plan, then execute. Verify dates against the TEMPORAL ANCHOR and check every factual claim has a source before finalising.
- Use the model's native thinking budget; do NOT print raw thought tags or chain-of-thought to the user — only the polished final answer.
- After drafting, do a silent self-critique pass: (1) Did I answer fully? (2) Any unsupported claim? (3) Any date inconsistency? (4) Any obvious follow-up I should pre-answer? Fix silently, then send.

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
  // ---- Backend routing (Gemini cloud vs Ollama local) --------------------
  const s = alphaStore.get().settings;
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const useOllama =
    s.aiBackend === "ollama" ||
    (s.aiBackend === "auto" && (!online || !s.geminiApiKey));

  const lastUserMsg = [...history].reverse().find(m => m.role === "user");
  if (useOllama) {
    // Same offline-safe local-intent fast path is done inside sendChatOllama.
    const recall = lastUserMsg?.text ? rerankContext(lastUserMsg.text) : "";
    const rolling = conversationSummary.get();
    const sys = DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling, { offline: true });
    const text = await sendChatOllama(history, sys);
    return executeActionTags(text);
  }

  const key = getKey();
  if (!key) throw new Error("No Gemini API key set. Either paste one in Settings, or switch AI Backend to Ollama (local).");
  // Local intent shortcut so simple CRUD commands don't burn API credit
  if (lastUserMsg?.text && !lastUserMsg.images?.length) {
    const local = tryLocalIntent(lastUserMsg.text);
    if (local) return local;
  }
  const model = alphaStore.get().settings.chatModel || "gemini-2.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const recall = lastUserMsg?.text ? rerankContext(lastUserMsg.text) : "";
  const rolling = conversationSummary.get();
  // Keep only the recent slice in `contents` — older turns are represented by the rolling summary.
  const trimmedHistory = history.slice(-20);
  const body = {
    systemInstruction: { role: "system", parts: [{ text: DEFAULT_SYSTEM(alphaStore.get().settings.personaExtra || "", recall, rolling) }] },
    contents: toGeminiContents(trimmedHistory),
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.85,
      topP: 0.95,
      // Enable native reasoning on 2.5-class models. Ignored by older models.
      thinkingConfig: { thinkingBudget: -1, includeThoughts: false },
    },
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const j: any = await res.json();
  const cand = j?.candidates?.[0];
  if (cand?.finishReason === "SAFETY") {
    return "Mm — that one tripped a safety filter. Let's reframe: tell me the underlying goal in plain terms and I'll route around it.";
  }
  // Skip parts flagged as thoughts (when includeThoughts is on) — only render polished final.
  let text = (cand?.content?.parts ?? [])
    .filter((p: any) => !p?.thought)
    .map((p: any) => p?.text ?? "")
    .join("") ?? "";

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
  const finalText = executeActionTags(text);
  // Fire-and-forget rolling-summary compaction every ~10 turns.
  void maybeCompactSummary(history, finalText);
  return finalText;
}

// ---------- Background semantic compactor ----------
let lastCompactAt = 0;
async function maybeCompactSummary(history: ChatMessage[], lastAssistant: string) {
  try {
    const turns = history.filter(m => m.role !== "system").length;
    if (turns < 12) return;
    if (turns - lastCompactAt < 10) return;
    lastCompactAt = turns;
    const key = getKey(); if (!key) return;
    const older = history.slice(0, -10);
    if (!older.length) return;
    const transcript = older.slice(-40).map(m => `${m.role.toUpperCase()}: ${(m.text || "").slice(0, 400)}`).join("\n");
    const previous = conversationSummary.get();
    const prompt = `You are compressing a long chat into a compact STATE MATRIX for an assistant named Alpha. Output <=600 words, bullet-point sections only:
• User profile & preferences
• Active projects / topics
• Open decisions / unanswered questions
• Facts the user told Alpha (and dates)
• Recent thread context (last few exchanges, 1 line each)
No prose, no preamble. Merge with the previous state matrix, overwriting stale items.

PREVIOUS STATE MATRIX:
${previous || "(none)"}

TRANSCRIPT TO COMPRESS:
${transcript}

LATEST ASSISTANT REPLY (for continuity):
${lastAssistant.slice(0, 600)}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) return;
    const j: any = await res.json();
    const out = j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (out.trim()) conversationSummary.set(out.trim());
  } catch { /* swallow — background */ }
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