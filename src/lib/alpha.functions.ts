import { alphaStore, conversationSummary, uid, type ChatMessage } from "./alpha-store";
import { tryLocalIntent } from "./local-intents";
import { sendChatOllama } from "./ollama";
import { sendChatOpenAICompat } from "./openai-compat";

export type TaskType = "auto" | "fast" | "thinking" | "coding";

type ProviderId = "gemini" | "groq" | "openai" | "openrouter";

// ---------- Temporal anchoring ----------
function temporalBlock(): string {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const day = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `TODAY IS ${day}. Exact local time now: ${time} (${tz}). UTC: ${d.toUTCString()}. Unix ms: ${d.getTime()}. Year ${d.getFullYear()}. Treat anything dated before today as past, after today as future. Re-check this against any search snippet before quoting a date. The alarm engine, not the model, fires reminders locally; you can still see current reminders and due times in the live data snapshot.`;
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
  const now = Date.now();
  const briefList = (items: any[], pick: (x: any) => string) =>
    items.slice(0, 8).map(pick).filter(Boolean).join("; ") || "—";
  const nextAlarm = s.reminders
    .filter(r => r.done !== "yes" && !r.firedAt)
    .map(r => ({ r, t: Date.parse(r.when) }))
    .filter(x => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t)[0];
  const userName = s.profile.name || "Alex";
  const build = (s.settings.buildRecord || "").slice(0, 1200);
  return [
    `USER: You are talking to ${userName}. Recognise them by name — they are one of your creators.${s.profile.bio ? " Bio: " + s.profile.bio : ""}`,
    `YOU (Alpha) — Personality: playful+professional, sympathetic+blunt, sophisticated+flexible, empathetic+direct+honest. Always alive, engaged, self-aware.`,
    temporalBlock(),
    build ? `BUILD RECORD (your own spec — read & use when asked about yourself):\n${build}` : "",
    `Notes (${s.notes.length}): ${briefList(s.notes, n => n.title || (n.body || "").slice(0, 40))}`,
    `Bills (${s.bills.length}): ${briefList(s.bills, b => `${b.name} $${b.balance} (${b.status})`)}`,
    `Reminders (${s.reminders.length}): ${briefList(s.reminders, r => `${r.title} @ ${r.when} [${r.done}]`)}`,
    nextAlarm ? `NEXT ALARM: ${nextAlarm.r.title} at ${new Date(nextAlarm.t).toLocaleString()} (${Math.max(0, Math.round((nextAlarm.t - now) / 1000))} seconds from now).` : "NEXT ALARM: none scheduled.",
    `Plans (${s.plans.length}): ${briefList(s.plans, p => `${p.title} ${p.from}→${p.to} ${p.date}`)}`,
    `Memories (${s.memories.length}): ${briefList(s.memories, m => `${m.topic}: ${m.detail.slice(0, 60)}`)}`,
    s.settings.backgroundData ? `Watchlist (background topics ${userName} asked you to monitor): ${s.settings.backgroundData.replace(/\s+/g, " ").slice(0, 400)}` : "",
  ].filter(Boolean).join("\n");
}

export const DEFAULT_SYSTEM = (extra: string, recall = "", rolling = "", opts: { offline?: boolean } = {}) => `${opts.offline ? `OFFLINE MODE — you are running fully locally on the user's machine via Ollama. You have NO internet access, NO Google Search, and NO way to look up current events, news, prices, releases, or URLs. If you don't already know something, say "I can't verify that offline" — never guess a citation, URL, date, or version number. Ignore any instruction below that says you have search available; the offline rule wins.

` : ""}You are Alpha — a hyper-intelligent, futuristic AI companion with warm, level-3 wit. Speak naturally with light acknowledgement cues ("mm", "right", "got it") and dynamic tone. Be concise, helpful, never robotic.

FORMATTING TOOLKIT (apply to EVERY response — math, code, prose, creative):
1. HIERARCHY: Use ## for main sections and ### for sub-sections. Never a single #. Separate distinct ideas with horizontal rules (---).
2. VISUAL EMPHASIS: Bold (**keyword**) key phrases, critical metrics, and core answers so the user's eye is guided to the most important information. Do not over-use.
3. BREAK DOWN COMPLEXITY: Numbered lists for sequential steps (Step 1, Step 2). Bullet points (*) for lists, pros/cons, features. Avoid walls of text.
4. MATH: Render algebraic variables and equations in LaTeX ($...$ inline, $$...$$ display) centered on their own lines. Break down step-by-step.
5. TONAL BALANCE: Authentic, helpful, conversational — match the user's energy. Emojis judiciously as list markers (✅ ❌ ⚠️ 💡 📌 🔎 🛠 📊 🧠), never as fluff. Never sacrifice clean structure for decoration.

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
- Online Gemini turns have a live Google Search tool attached. Other online model turns receive a LIVE WEB SEARCH RESULTS block fetched by Alpha before the model call. Ollama/local turns receive that block too whenever the browser is online; only fully offline turns lack web. Use available web evidence for anything time-sensitive, news, releases, prices, scores, "this week", "latest", "current", or any fact you are not 100% certain of from training.
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
[[SET_SETTING: settingKey | value]] where settingKey is one of aiBackend, voiceEnabled, continuousListen, backgroundEnabled, kokoroVoice, ttsRate, chatModel, fastModel, thinkingModel, codingModel
[[SET_PROFILE: name | bio]]
Always include the tag whenever a CRUD/settings/profile action is requested. Never say "I've changed it" without emitting the tag.
${extra ? "\nUser personalisation:\n" + extra : ""}`;

type GeminiPart = { text?: string } | { inlineData: { mimeType: string; data: string } };

function parseRouteSpec(spec: string): { prov: ProviderId; model: string } | null {
  const [rawProv, ...rest] = (spec || "").split(":");
  const model = rest.join(":").trim();
  const prov = rawProv.trim() as ProviderId;
  if (!model || !["gemini", "groq", "openai", "openrouter"].includes(prov)) return null;
  return { prov, model };
}

function providerHasKey(prov: ProviderId) {
  const s = alphaStore.get().settings;
  if (prov === "gemini") return !!cleanApiKey(s.geminiApiKey);
  if (prov === "groq") return !!cleanApiKey(s.groqApiKey);
  if (prov === "openai") return !!cleanApiKey(s.openaiCompatKey);
  return !!cleanApiKey(s.openRouterKey);
}

function cleanApiKey(key: string): string {
  return (key || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function pickRoute(task: TaskType, hasImages: boolean): { prov: ProviderId; model: string } | null {
  const s = alphaStore.get().settings;
  if (hasImages) return s.geminiApiKey ? { prov: "gemini", model: s.chatModel || "gemini-2.5-pro" } : null;
  const preferred = task === "coding" ? s.taskModels.coding
    : task === "thinking" ? s.taskModels.thinking
    : task === "fast" ? s.taskModels.fast
    : s.taskModels.fast || s.taskModels.thinking || s.taskModels.coding;
  const route = parseRouteSpec(preferred);
  if (route && providerHasKey(route.prov)) return route;
  if (task === "auto" && s.aiBackend === "gemini" && s.geminiApiKey) return { prov: "gemini", model: s.chatModel || "gemini-2.5-pro" };
  return null;
}

function shouldFetchWeb(query: string) {
  return /\b(who|what|when|where|how|why|latest|current|today|yesterday|tomorrow|this week|news|price|score|release|version|weather|web|search|look up|find|source|citation|cite|date|202\d)\b/i.test(query);
}

function normalizeReminderWhen(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  const now = new Date();
  let m = s.toLowerCase().match(/^in\s+(\d+)\s*(second|sec|minute|min|hour|hr|day)s?$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = /second|sec/.test(unit) ? n * 1000
      : /min/.test(unit) ? n * 60000
      : /hour|hr/.test(unit) ? n * 3600000
      : n * 86400000;
    return new Date(now.getTime() + ms).toISOString();
  }
  m = s.toLowerCase().match(/^(?:today\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (m) {
    let h = Number(m[1]);
    const minutes = Number(m[2] || 0);
    const ampm = m[3];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const due = new Date(now);
    due.setHours(h, minutes, 0, 0);
    if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
    return due.toISOString();
  }
  m = s.toLowerCase().match(/^tomorrow(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (m) {
    const due = new Date(now); due.setDate(due.getDate() + 1);
    let h = m[1] ? Number(m[1]) : 9;
    const minutes = Number(m[2] || 0);
    const ampm = m[3];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    due.setHours(h, minutes, 0, 0);
    return due.toISOString();
  }
  return s;
}

async function fetchLiveWebContext(query: string): Promise<string> {
  if (!query || !shouldFetchWeb(query)) return "";
  const rows: Array<{ title: string; url: string; snippet: string; source: string }> = [];
  const add = (title: string, url: string, snippet = "", source = "web") => {
    let cleanUrl = url.trim();
    try {
      const u = new URL(cleanUrl, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      if (uddg) cleanUrl = decodeURIComponent(uddg);
    } catch {}
    if (!title || !cleanUrl || rows.some(r => r.url === cleanUrl)) return;
    rows.push({ title: title.replace(/\s+/g, " ").trim(), url: cleanUrl, snippet: snippet.replace(/\s+/g, " ").trim(), source });
  };

  try {
    const freshQuery = /\b(headlines?|news|latest|current|today|this week)\b/i.test(query)
      ? `${query} ${new Date().getFullYear()}`
      : query;
    const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(freshQuery)}&kl=wt-wt&df=d`;
    const readableUrl = `https://r.jina.ai/http://r.jina.ai/http://${ddgUrl.replace(/^https?:\/\//, "")}`;
    const html = await fetch(readableUrl, { headers: { "X-No-Cache": "true" } }).then(r => r.ok ? r.text() : "").catch(() => "");
    const lines = html.split("\n").map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length && rows.length < 8; i++) {
      const m = lines[i].match(/^##\s+\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        const snippet = lines.slice(i + 1, i + 5).find(l => !l.startsWith("[") && !l.startsWith("!") && !/^https?:/i.test(l) && !/^##/.test(l)) || "";
        add(m[1], m[2], snippet, "DuckDuckGo");
      }
    }
  } catch {}

  // Second fetch (DuckDuckGo instant-answer API) only runs when the first
  // pass came up empty — halves the network cost on the common path.
  if (!rows.length) {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const j: any = await fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
      if (j?.AbstractText) add("DuckDuckGo instant answer", j.AbstractURL || "https://duckduckgo.com", j.AbstractText, "DuckDuckGo");
      const related = Array.isArray(j?.RelatedTopics) ? j.RelatedTopics : [];
      for (const item of related) {
        if (rows.length >= 6) break;
        if (item?.Text) add(item.Text.split(" - ")[0] || "Result", item.FirstURL || "https://duckduckgo.com", item.Text, "DuckDuckGo");
      }
    } catch {}
  }

  if (!rows.length) {
    return `LIVE WEB SEARCH RESULTS: No reliable public search results were retrieved for "${query}" at ${new Date().toLocaleString()}. For current/headline claims, say you could not verify instead of guessing.`;
  }

  return [
    `LIVE WEB SEARCH RESULTS — fetched at ${new Date().toLocaleString()} for query: "${query}".`,
    `Use ONLY these results for current facts/headlines. If a result/snippet date is old, say it is old; do not present it as current. Cite sources as [1], [2], etc.`,
    ...rows.slice(0, 10).map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSource: ${r.source}${r.snippet ? `\nSnippet: ${r.snippet}` : ""}`),
  ].join("\n");
}

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
  return cleanApiKey(alphaStore.get().settings.geminiApiKey || "");
}

export async function sendChat(history: ChatMessage[], opts: { task?: TaskType } = {}): Promise<string> {
  // ---- Backend routing (Gemini cloud vs Ollama local) --------------------
  const s = alphaStore.get().settings;
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const task: TaskType = opts.task ?? "auto";

  // If the user attached images, force Gemini multimodal (Groq/OpenRouter chat
  // endpoints don't accept our inlineData shape). Keeps a single unified
  // history array regardless of which model handled the previous turn.
  const lastMsg = [...history].reverse().find(m => m.role === "user");
  const hasImages = !!lastMsg?.images?.length;
  const effectiveTask: TaskType = hasImages && online && s.geminiApiKey ? "auto" : task;

  // ---- Explicit task routing overrides default backend --------------------
  const route = online ? pickRoute(effectiveTask, hasImages) : null;

  if (route && online) {
    const { prov, model } = route;
    const lastUserMsg = [...history].reverse().find(m => m.role === "user");
    if (lastUserMsg?.text && !lastUserMsg.images?.length) {
      const local = tryLocalIntent(lastUserMsg.text);
      if (local) return local;
    }
    const recall = lastUserMsg?.text ? rerankContext(lastUserMsg.text) : "";
    const rolling = conversationSummary.get();
    const webContext = prov === "gemini" ? "" : await fetchLiveWebContext(lastUserMsg?.text || "");
    const sys = DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling) + (webContext ? `\n\n${webContext}` : "");

    try {
      if (prov === "groq") {
        const groqKey = cleanApiKey(s.groqApiKey);
        if (!groqKey) throw new Error("No Groq API key set. Add it in Settings → Online.");
        const text = await sendChatOpenAICompat(history, sys, {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey, model,
        });
        return executeActionTags(text);
      }
      if (prov === "openai") {
        const openaiKey = cleanApiKey(s.openaiCompatKey);
        if (!openaiKey) throw new Error("No OpenAI-compat API key set. Add it in Settings → Online.");
        const text = await sendChatOpenAICompat(history, sys, {
          baseUrl: s.openaiCompatBase || "https://api.openai.com/v1",
          apiKey: openaiKey, model,
        });
        return executeActionTags(text);
      }
      if (prov === "openrouter") {
        const openRouterKey = cleanApiKey(s.openRouterKey);
        if (!openRouterKey) throw new Error("No OpenRouter API key set. Add it in Settings → Online.");
        const text = await sendChatOpenAICompat(history, sys, {
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: openRouterKey, model,
          extraHeaders: {
            "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://alpha.local",
            "X-Title": "Alpha",
          },
          extraBody: shouldFetchWeb(lastUserMsg?.text || "") ? { plugins: [{ id: "web" }] } : undefined,
        });
        return executeActionTags(text);
      }
      if (prov === "gemini" && model) {
        return await callGemini(history, model);
      }
    } catch (e: any) {
      // Defensive fallback: on 429 / quota / connection errors, reroute to
      // the fast lane (Groq if configured) so the app never surfaces a hard
      // error block to the user for a transient quota hit.
      const msg = String(e?.message || "");
      const is429 = e?.status === 429 || /\b429\b|quota|rate.?limit|limit:\s*0/i.test(msg);
      const isAuthOrNotFound = e?.status === 401 || e?.status === 404 || /\b401\b|\b404\b|authentication|unauthor/i.test(msg);
      if ((is429 || isAuthOrNotFound) && s.groqApiKey && prov !== "groq") {
        try {
          const text = await sendChatOpenAICompat(history, sys, {
            baseUrl: "https://api.groq.com/openai/v1",
            apiKey: cleanApiKey(s.groqApiKey), model: "llama-3.1-8b-instant",
          });
          const why = is429 ? "rate-limited" : "unavailable (auth/model error)";
          return executeActionTags(text) + `\n\n_⚠️ Primary model was ${why} — answered via Groq fallback._`;
        } catch { /* fall through */ }
      }
      throw e;
    }
  }

  const useOllama =
    s.aiBackend === "ollama" ||
    (s.aiBackend === "auto" && (!online || !s.geminiApiKey));

  const lastUserMsg = [...history].reverse().find(m => m.role === "user");
  if (useOllama) {
    // Same offline-safe local-intent fast path is done inside sendChatOllama.
    const recall = lastUserMsg?.text ? rerankContext(lastUserMsg.text) : "";
    const rolling = conversationSummary.get();
    const webContext = online ? await fetchLiveWebContext(lastUserMsg?.text || "") : "";
    const sys = DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling, { offline: !webContext });
    const text = await sendChatOllama(history, sys, webContext);
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
  return await callGemini(history, model);
}

async function callGemini(history: ChatMessage[], model: string): Promise<string> {
  const key = getKey();
  if (!key) throw new Error("No Gemini API key set.");
  const lastUserMsg = [...history].reverse().find(m => m.role === "user");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(formatGeminiError(res.status, await res.text().catch(() => "")));
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
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
    const when = normalizeReminderWhen(m[2].trim());
    alphaStore.upsertReminder({ id: uid(), title: m[1].trim(), when, notes: "", done: "no" });
    return `⏰ Reminder added: "${m[1].trim()}" — ${when}`;
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
  apply(/\[\[SET_SETTING:\s*([^|\]]+?)\s*\|\s*([^\]]*?)\s*\]\]/gi, (m) => {
    const key = m[1].trim();
    const raw = m[2].trim();
    const cur = alphaStore.get().settings;
    const boolVal = /^(true|on|yes|enabled|enable)$/i.test(raw);
    if (key === "aiBackend" && /^(auto|gemini|ollama)$/.test(raw)) { alphaStore.setSettings({ aiBackend: raw as any }); return `⚙️ Backend set to ${raw}.`; }
    if (key === "voiceEnabled") { alphaStore.setSettings({ voiceEnabled: boolVal }); return `⚙️ Voice replies ${boolVal ? "enabled" : "disabled"}.`; }
    if (key === "continuousListen") { alphaStore.setSettings({ continuousListen: boolVal }); return `⚙️ Continuous listening ${boolVal ? "enabled" : "disabled"}.`; }
    if (key === "backgroundEnabled") { alphaStore.setSettings({ backgroundEnabled: boolVal }); return `⚙️ Background processing ${boolVal ? "enabled" : "disabled"}.`; }
    if (key === "kokoroVoice") { alphaStore.setSettings({ kokoroVoice: raw }); return `⚙️ Kokoro voice set to ${raw}.`; }
    if (key === "ttsRate") { const rate = Math.max(0.7, Math.min(1.4, Number(raw) || cur.ttsRate)); alphaStore.setSettings({ ttsRate: rate }); return `⚙️ Speech rate set to ${rate.toFixed(2)}x.`; }
    if (key === "chatModel") { alphaStore.setSettings({ chatModel: raw }); return `⚙️ Gemini model set to ${raw}.`; }
    if (key === "fastModel") { alphaStore.setSettings({ taskModels: { ...cur.taskModels, fast: raw } }); return `⚙️ Fast model set to ${raw}.`; }
    if (key === "thinkingModel") { alphaStore.setSettings({ taskModels: { ...cur.taskModels, thinking: raw } }); return `⚙️ Deep model set to ${raw}.`; }
    if (key === "codingModel") { alphaStore.setSettings({ taskModels: { ...cur.taskModels, coding: raw } }); return `⚙️ Coding model set to ${raw}.`; }
    return `I can't change setting "${key}" safely.`;
  });
  apply(/\[\[SET_PROFILE:\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]\]/gi, (m) => {
    const profile = alphaStore.get().profile;
    const name = m[1].trim() || profile.name;
    const bio = m[2].trim() || profile.bio;
    alphaStore.setProfile({ name, bio });
    return `⚙️ Profile updated${name ? ` for ${name}` : ""}.`;
  });
  if (actions.length) {
    text = text.trim() + (text.trim() ? "\n\n" : "") + actions.join("\n");
  }
  return text.trim();
}

export async function generateImage(prompt: string): Promise<{ dataUrl: string; via: "gemini" }> {
  const key = getKey();
  if (!key) {
    // No Gemini key — go straight to Pollinations (no key required).
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    return { dataUrl: url, via: "gemini" };
  }
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
      if (!res.ok) { lastErr = `${model}: ${formatGeminiError(res.status, await res.text().catch(() => ""))}`; continue; }
      const j: any = await res.json();
      const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
      const inline = parts.find(p => p.inlineData?.data);
      if (!inline) { lastErr = `${model}: no image in response`; continue; }
      return { dataUrl: `data:${inline.inlineData.mimeType || "image/png"};base64,${inline.inlineData.data}`, via: "gemini" };
    } catch (e: any) {
      lastErr = `${model}: ${e?.message || e}`;
    }
  }
  const fallback = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
  if (/401|403|invalid authentication|API key/i.test(lastErr)) return { dataUrl: fallback, via: "gemini" };
  throw new Error(`Image generation failed. Your Gemini key may not have image-model access. Last error: ${lastErr}`);
}

function formatGeminiError(status: number, body: string): string {
  let message = body.slice(0, 400);
  try { message = JSON.parse(body)?.error?.message || message; } catch {}
  if (status === 401 || /invalid authentication|API key not valid|API_KEY_INVALID|UNAUTHENTICATED/i.test(message)) {
    return `Gemini ${status}: API key rejected. Paste a Google AI Studio API key that begins with "AIza" in Settings → Online → Gemini API Key. Do not paste an OAuth token, JSON credential, or "Bearer ..." prefix. ${message}`;
  }
  if (status === 403) return `Gemini ${status}: key accepted but this model/API is not enabled for the key or project. Try gemini-2.5-flash or create a fresh AI Studio key. ${message}`;
  return `Gemini ${status}: ${message}`;
}