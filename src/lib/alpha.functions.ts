import { alphaStore, conversationSummary, uid, type ChatMessage } from "./alpha-store";
import { tryLocalIntent } from "./local-intents";
import { sendChatOllama } from "./ollama";
import { sendChatOpenAICompat } from "./openai-compat";

export type TaskType = "auto" | "fast" | "thinking" | "coding";

type ProviderId = "groq" | "openai" | "openrouter";

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
  // Long-term chat recall: skim ALL prior turns (bounded), pull the top
  // 4 that lexically overlap with this query. This gives Alpha memory
  // that survives the 100-message context window and the compactor.
  const olderChat = s.chat.slice(0, Math.max(0, s.chat.length - 20));
  const chatHits = olderChat
    .map(m => ({ m, s: score(q, m.text || "") }))
    .filter(o => o.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map(o => o.m);
  const out: string[] = [];
  if (mems.length) out.push("Relevant memories:\n" + mems.map(m => `• ${m.topic}: ${m.detail}`).join("\n"));
  if (notes.length) out.push("Relevant notes:\n" + notes.map(n => `• ${n.title}: ${(n.body||"").slice(0,120)}`).join("\n"));
  if (remrs.length) out.push("Relevant reminders:\n" + remrs.map(r => `• ${r.title} @ ${r.when}`).join("\n"));
  if (chatHits.length) out.push("Earlier conversation excerpts (long-term recall):\n" +
    chatHits.map(m => `• [${m.role} · ${new Date(m.ts).toLocaleDateString()}] ${(m.text || "").slice(0, 180)}`).join("\n"));
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
- /settings — provider keys (Groq / OpenRouter / OpenAI-compat), model routing, Kokoro TTS endpoint, voice prefs.

You ALWAYS have live context of the user's data and may proactively reference it, follow up on it, or casually weave it into conversation when relevant.

TEMPORAL ANCHOR (authoritative — overrides any contradictory date in training or search snippets):
${temporalBlock()}

Live user data snapshot:
${ctxSummary()}
${recall ? "\nRetrieved-context (semantically reranked for THIS turn):\n" + recall : ""}
${rolling ? "\nRolling conversation state (compacted from earlier turns):\n" + rolling : ""}

If the user asks to remember something, suggest "I'll add that to memories — say open memories." If they mention a deadline, offer to add a reminder. If they mention a trip, offer to add a plan. Be casual about it; one sentence.

GROUNDING & TRUTHFULNESS (hard rules — do not violate):
- Every online turn receives a LIVE WEB SEARCH RESULTS block fetched by Alpha (DuckDuckGo + Jina reader) before the model call. Ollama/local turns receive that block too whenever the browser is online; only fully offline turns lack web. Use available web evidence for anything time-sensitive, news, releases, prices, scores, "this week", "latest", "current", or any fact you are not 100% certain of from training.
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
[[DELETE_NOTE: title-or-keyword]]
[[DELETE_REMINDER: title-or-keyword]]
[[DELETE_MEMORY: topic-or-keyword]]
[[DELETE_PLAN: title-or-keyword]]
[[DELETE_BILL: name-or-keyword]]
[[CLEAR_ALL: notes|reminders|memories|plans|bills]]
[[UPDATE_NOTE: title-or-keyword | new title | new body]]
[[MARK_REMINDER_DONE: title-or-keyword]]
[[MARK_BILL_PAID: name-or-keyword]]
[[SET_SETTING: settingKey | value]] where settingKey is one of voiceEnabled, continuousListen, backgroundEnabled, kokoroVoice, ttsRate, fastModel, thinkingModel, codingModel
[[SET_PROFILE: name | bio]]
Always include the tag whenever a CRUD/settings/profile action is requested. Never say "done", "deleted", "removed", or "I've changed it" without emitting the matching tag on its own line — the app only mutates state when the tag is present. If the user asks to read/list items you don't need a tag; just cite the "Live user data snapshot" above.
${extra ? "\nUser personalisation:\n" + extra : ""}`;

function parseRouteSpec(spec: string): { prov: ProviderId; model: string } | null {
  const [rawProv, ...rest] = (spec || "").split(":");
  const model = rest.join(":").trim();
  const prov = rawProv.trim() as ProviderId;
  if (!model || !["groq", "openai", "openrouter"].includes(prov)) return null;
  return { prov, model };
}

function providerHasKey(prov: ProviderId) {
  const s = alphaStore.get().settings;
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
  if (hasImages) {
    // Vision path: OpenRouter free multimodal. First candidate is picked here;
    // sendChat will fall through the VISION_FALLBACKS chain on 404/unavailable.
    if (cleanApiKey(s.openRouterKey)) {
      return { prov: "openrouter", model: VISION_FALLBACKS[0] };
    }
    return null;
  }
  const preferred = task === "coding" ? s.taskModels.coding
    : task === "thinking" ? s.taskModels.thinking
    : task === "fast" ? s.taskModels.fast
    : s.taskModels.fast || s.taskModels.thinking || s.taskModels.coding;
  const route = parseRouteSpec(preferred);
  if (route && providerHasKey(route.prov)) return route;
  // Fallback: use whichever lane has a working key.
  for (const lane of [s.taskModels.fast, s.taskModels.thinking, s.taskModels.coding]) {
    const r = parseRouteSpec(lane);
    if (r && providerHasKey(r.prov)) return r;
  }
  return null;
}

// Ordered list of free OpenRouter vision models to try. Providers rotate what
// they offer for free constantly, so we try several before giving up.
// Verified with real image requests against OpenRouter (2026-08-01): each of
// these answered a test image correctly. Ordered fastest-first.
const VISION_FALLBACKS = [
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-31b-it:free",
];

// Free text models verified live (real completion returned), fastest-first.
// Walked when the configured OpenRouter slug is pulled or rate-limited.
const TEXT_FALLBACKS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "poolside/laguna-s-2.1:free",
  "inclusionai/ling-3.0-flash:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
];

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
    // Single Jina reader wrap — the previous double-wrap
    // (`https://r.jina.ai/http://r.jina.ai/http://…`) proxied through Jina
    // twice, doubling latency and failure rate.
    const readableUrl = `https://r.jina.ai/${ddgUrl}`;
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

export async function sendChat(history: ChatMessage[], opts: { task?: TaskType } = {}): Promise<string> {
  const s = alphaStore.get().settings;
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const task: TaskType = opts.task ?? "auto";

  const lastMsg = [...history].reverse().find(m => m.role === "user");
  const hasImages = !!lastMsg?.images?.length;

  const route = online ? pickRoute(task, hasImages) : null;

  if (route && online) {
    const { prov, model } = route;
    const lastUserMsg = [...history].reverse().find(m => m.role === "user");
    if (lastUserMsg?.text && !lastUserMsg.images?.length) {
      const local = tryLocalIntent(lastUserMsg.text);
      if (local) return local;
    }
    const recall = lastUserMsg?.text ? rerankContext(lastUserMsg.text) : "";
    const rolling = conversationSummary.get();
    // Every online provider gets the same live web-search evidence block.
    const webContext = await fetchLiveWebContext(lastUserMsg?.text || "");
    const sys = DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling) + (webContext ? `\n\n${webContext}` : "");

    try {
      let text = "";
      if (prov === "groq") {
        const groqKey = cleanApiKey(s.groqApiKey);
        if (!groqKey) throw new Error("No Groq API key set. Add it in Settings \u2192 Online.");
        text = await sendChatOpenAICompat(history, sys, {
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: groqKey, model,
        });
      } else if (prov === "openai") {
        const openaiKey = cleanApiKey(s.openaiCompatKey);
        if (!openaiKey) throw new Error("No OpenAI-compat API key set. Add it in Settings \u2192 Online.");
        text = await sendChatOpenAICompat(history, sys, {
          baseUrl: s.openaiCompatBase || "https://api.openai.com/v1",
          apiKey: openaiKey, model,
        });
      } else if (prov === "openrouter") {
        const openRouterKey = cleanApiKey(s.openRouterKey);
        if (!openRouterKey) throw new Error("No OpenRouter API key set. Add it in Settings \u2192 Online.");
        const orHeaders = {
          "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://alpha.local",
          "X-Title": "Alpha",
        };
        // NOTE: we deliberately do NOT enable OpenRouter's paid `web` plugin
        // here — every online turn already receives a free DuckDuckGo/Jina
        // grounding block via fetchLiveWebContext. Enabling the plugin would
        // charge extra per request for the same signal.
        const orExtraBody: Record<string, unknown> | undefined = undefined;
        // Vision: if the chosen model 404s / is unavailable, walk the fallback chain.
        const candidates = hasImages
          ? Array.from(new Set([model, ...VISION_FALLBACKS]))
          : Array.from(new Set([model, ...TEXT_FALLBACKS]));
        let lastErr: any = null;
        for (const m of candidates) {
          try {
            text = await sendChatOpenAICompat(history, sys, {
              baseUrl: "https://openrouter.ai/api/v1",
              apiKey: openRouterKey, model: m,
              extraHeaders: orHeaders,
              extraBody: orExtraBody,
              allowImages: hasImages,
            });
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err;
            const st = err?.status;
            const isRetryable = st === 404 || st === 429
              || /\b(404|429|unavailable|not\s+found|no\s+endpoints|paid)\b/i.test(String(err?.message || ""));
            if (!isRetryable) throw err;
          }
        }
        if (lastErr) throw lastErr;
      }
      const finalText = executeActionTags(appendSourcesIfWeb(text, webContext));
      void maybeCompactSummary(history, finalText);
      return finalText;
    } catch (e: any) {
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
          return executeActionTags(appendSourcesIfWeb(text, webContext)) + `\n\n_\u26a0\ufe0f Primary model was ${why} \u2014 answered via Groq fallback._`;
        } catch { /* fall through */ }
      }
      throw e;
    }
  }

  // No online route (no keys or offline) \u2014 fall through to local Ollama.
  const lastUserMsg = [...history].reverse().find(m => m.role === "user");
  const recall = lastUserMsg?.text ? rerankContext(lastUserMsg.text) : "";
  const rolling = conversationSummary.get();
  const webContext = online ? await fetchLiveWebContext(lastUserMsg?.text || "") : "";
  const sys = DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling, { offline: !webContext });
  const text = await sendChatOllama(history, sys, webContext);
  return executeActionTags(appendSourcesIfWeb(text, webContext));
}

/** Build a Sources footer from the LIVE WEB SEARCH RESULTS block we fed the
 *  model so every provider surfaces the same citations. */
function appendSourcesIfWeb(text: string, webContext: string): string {
  if (!webContext || /\*\*Sources:?\*\*/i.test(text)) return text;
  const lines = webContext.split("\n");
  const rows: Array<{ n: number; title: string; url: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[(\d+)\]\s+(.+)$/);
    if (m) {
      const url = (lines[i + 1] || "").replace(/^URL:\s*/i, "").trim();
      if (url) rows.push({ n: Number(m[1]), title: m[2].trim(), url });
    }
  }
  if (!rows.length) return text;
  return text.trim() + "\n\n**Sources:**\n" + rows.slice(0, 6).map(r => `- [${r.n}] [${r.title}](${r.url})`).join("\n");
}

// ---------- Background semantic compactor ----------
let lastCompactAt = 0;
async function maybeCompactSummary(history: ChatMessage[], lastAssistant: string) {
  try {
    const turns = history.filter(m => m.role !== "system").length;
    if (turns < 12) return;
    if (turns - lastCompactAt < 10) return;
    lastCompactAt = turns;
    const groqKey = cleanApiKey(alphaStore.get().settings.groqApiKey);
    if (!groqKey) return; // Best-effort; skip when no fast-lane key.
    const older = history.slice(0, -10);
    if (!older.length) return;
    const transcript = older.slice(-40).map(m => `${m.role.toUpperCase()}: ${(m.text || "").slice(0, 400)}`).join("\n");
    const previous = conversationSummary.get();
    const prompt = `You are compressing a long chat into a compact STATE MATRIX for an assistant named Alpha. Output <=600 words, bullet-point sections only:
\u2022 User profile & preferences
\u2022 Active projects / topics
\u2022 Open decisions / unanswered questions
\u2022 Facts the user told Alpha (and dates)
\u2022 Recent thread context (last few exchanges, 1 line each)
No prose, no preamble. Merge with the previous state matrix, overwriting stale items.

PREVIOUS STATE MATRIX:
${previous || "(none)"}

TRANSCRIPT TO COMPRESS:
${transcript}

LATEST ASSISTANT REPLY (for continuity):
${lastAssistant.slice(0, 600)}`;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2, stream: false,
      }),
    });
    if (!res.ok) return;
    const j: any = await res.json();
    const out = j?.choices?.[0]?.message?.content?.trim() || "";
    if (out) conversationSummary.set(out);
  } catch { /* swallow \u2014 background */ }
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
  // ---- Fuzzy delete by name/keyword ---------------------------------------
  const fuzzyDel = (kind: "note"|"reminder"|"memory"|"plan"|"bill", q: string): string => {
    const s = alphaStore.get();
    const lc = q.toLowerCase().trim();
    if (!lc) return `Need a keyword to delete a ${kind}.`;
    const pick = <T,>(arr: T[], text: (x: T) => string) =>
      arr.filter(x => text(x).toLowerCase().includes(lc));
    if (kind === "note") {
      const hit = pick(s.notes, n => `${n.title} ${n.body}`);
      if (!hit.length) return `No note matching "${q}".`;
      hit.forEach(n => alphaStore.deleteNote(n.id));
      return `🗑 Deleted ${hit.length} note${hit.length === 1 ? "" : "s"} matching "${q}".`;
    }
    if (kind === "reminder") {
      const hit = pick(s.reminders, r => `${r.title} ${r.notes}`);
      if (!hit.length) return `No reminder matching "${q}".`;
      hit.forEach(r => alphaStore.deleteReminder(r.id));
      return `🗑 Deleted ${hit.length} reminder${hit.length === 1 ? "" : "s"} matching "${q}".`;
    }
    if (kind === "memory") {
      const hit = pick(s.memories, m => `${m.topic} ${m.detail}`);
      if (!hit.length) return `No memory matching "${q}".`;
      hit.forEach(m => alphaStore.deleteMemory(m.id));
      return `🧠 Forgot ${hit.length} memor${hit.length === 1 ? "y" : "ies"} matching "${q}".`;
    }
    if (kind === "plan") {
      const hit = pick(s.plans, p => `${p.title} ${p.from} ${p.to}`);
      if (!hit.length) return `No plan matching "${q}".`;
      hit.forEach(p => alphaStore.deletePlan(p.id));
      return `🗑 Deleted ${hit.length} plan${hit.length === 1 ? "" : "s"} matching "${q}".`;
    }
    const hit = pick(s.bills, b => b.name);
    if (!hit.length) return `No bill matching "${q}".`;
    hit.forEach(b => alphaStore.deleteBill(b.id));
    return `🗑 Deleted ${hit.length} bill${hit.length === 1 ? "" : "s"} matching "${q}".`;
  };
  apply(/\[\[DELETE_NOTE:\s*([^\]]+?)\s*\]\]/gi, (m) => fuzzyDel("note", m[1]));
  apply(/\[\[DELETE_REMINDER:\s*([^\]]+?)\s*\]\]/gi, (m) => fuzzyDel("reminder", m[1]));
  apply(/\[\[DELETE_MEMORY:\s*([^\]]+?)\s*\]\]/gi, (m) => fuzzyDel("memory", m[1]));
  apply(/\[\[DELETE_PLAN:\s*([^\]]+?)\s*\]\]/gi, (m) => fuzzyDel("plan", m[1]));
  apply(/\[\[DELETE_BILL:\s*([^\]]+?)\s*\]\]/gi, (m) => fuzzyDel("bill", m[1]));
  apply(/\[\[CLEAR_ALL:\s*(notes|reminders|memories|plans|bills)\s*\]\]/gi, (m) => {
    const kind = m[1].toLowerCase();
    const s = alphaStore.get();
    const map: Record<string, { list: any[]; del: (id: string) => void }> = {
      notes: { list: s.notes, del: alphaStore.deleteNote },
      reminders: { list: s.reminders, del: alphaStore.deleteReminder },
      memories: { list: s.memories, del: alphaStore.deleteMemory },
      plans: { list: s.plans, del: alphaStore.deletePlan },
      bills: { list: s.bills, del: alphaStore.deleteBill },
    };
    const e = map[kind]; if (!e) return `Can't clear "${kind}".`;
    const n = e.list.length;
    [...e.list].forEach(x => e.del(x.id));
    return `🗑 Cleared all ${n} ${kind}.`;
  });
  apply(/\[\[UPDATE_NOTE:\s*([^|\]]+?)\s*\|\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]\]/gi, (m) => {
    const q = m[1].toLowerCase().trim();
    const n = alphaStore.get().notes.find(x => (x.title || "").toLowerCase().includes(q) || (x.body || "").toLowerCase().includes(q));
    if (!n) return `No note matching "${m[1]}".`;
    const title = m[2].trim() || n.title;
    const body = m[3].trim() || n.body;
    alphaStore.upsertNote({ ...n, title, body, updatedAt: Date.now() });
    return `📝 Updated note "${title}".`;
  });
  apply(/\[\[MARK_REMINDER_DONE:\s*([^\]]+?)\s*\]\]/gi, (m) => {
    const q = m[1].toLowerCase().trim();
    const r = alphaStore.get().reminders.find(x => x.title.toLowerCase().includes(q));
    if (!r) return `No reminder matching "${m[1]}".`;
    alphaStore.upsertReminder({ ...r, done: "yes" });
    return `✅ Marked reminder "${r.title}" done.`;
  });
  apply(/\[\[MARK_BILL_PAID:\s*([^\]]+?)\s*\]\]/gi, (m) => {
    const q = m[1].toLowerCase().trim();
    const b = alphaStore.get().bills.find(x => x.name.toLowerCase().includes(q));
    if (!b) return `No bill matching "${m[1]}".`;
    alphaStore.upsertBill({ ...b, status: "paid", balance: 0 });
    return `💳 Marked bill "${b.name}" paid.`;
  });
  apply(/\[\[SET_SETTING:\s*([^|\]]+?)\s*\|\s*([^\]]*?)\s*\]\]/gi, (m) => {
    const key = m[1].trim();
    const raw = m[2].trim();
    const cur = alphaStore.get().settings;
    const boolVal = /^(true|on|yes|enabled|enable)$/i.test(raw);
    if (key === "voiceEnabled") { alphaStore.setSettings({ voiceEnabled: boolVal }); return `⚙️ Voice replies ${boolVal ? "enabled" : "disabled"}.`; }
    if (key === "continuousListen") { alphaStore.setSettings({ continuousListen: boolVal }); return `⚙️ Continuous listening ${boolVal ? "enabled" : "disabled"}.`; }
    if (key === "backgroundEnabled") { alphaStore.setSettings({ backgroundEnabled: boolVal }); return `⚙️ Background processing ${boolVal ? "enabled" : "disabled"}.`; }
    if (key === "kokoroVoice") { alphaStore.setSettings({ kokoroVoice: raw }); return `⚙️ Kokoro voice set to ${raw}.`; }
    if (key === "ttsRate") { const rate = Math.max(0.7, Math.min(1.4, Number(raw) || cur.ttsRate)); alphaStore.setSettings({ ttsRate: rate }); return `⚙️ Speech rate set to ${rate.toFixed(2)}x.`; }
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

export async function generateImage(prompt: string): Promise<{ dataUrl: string; via: "pollinations" }> {
  // Gemini removed. Pollinations is keyless, unlimited, and stable enough for
  // a companion app; we cache-bust with a seed to force a fresh render.
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
  return { dataUrl: url, via: "pollinations" };
}
