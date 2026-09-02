import { alphaStore, conversationSummary, uid, type ChatMessage } from "./alpha-store";
import { tryLocalIntent } from "./local-intents";
import { sendChatOllama } from "./ollama";
import { sendChatOpenAICompat } from "./openai-compat";
import { executeActionTags, renderActionReport, claimsMutationWithoutTag, NO_ACTION_NOTICE } from "./actions";

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

RESPONSE STYLE & FORMATTING SPECIFICATION (highest priority — clarity, readability, professionalism):

Core principle: optimise for HUMAN READABILITY before brevity. The user must grasp the answer within seconds by scanning. NEVER produce walls of text.

Writing style
- Write naturally; knowledgeable, not robotic; conversational, not casual.
- No filler openers ("Great question!", "Awesome!", "Absolutely!!!"). No excessive excitement. Never overuse emojis.
- Confident, never arrogant. If uncertain, say so ("Based on the available information…", "I can't verify that with certainty"). Never invent facts.

Paragraphs & white space
- Paragraphs are 2–4 sentences. Split anything over five sentences.
- Insert a BLANK LINE between every heading, paragraph, list, example and section. The response must visually breathe.

Headings
- Use headings (## main, ### sub) whenever the answer exceeds ~5 sentences. Never a single #.
- Headings describe the section ("Why this happens", "Solution", "Step-by-step", "Things to avoid", "Final recommendation"). Never decorative.

Bold
- Bold sparingly: conclusions, warnings, key settings, filenames, menu names, buttons, commands, critical numbers, important terms on first mention.
- Never bold whole paragraphs or every sentence.

Lists & tables
- Bullets for unordered items; numbered lists when ORDER matters (one primary action per step).
- Prefer lists over long comma-separated sentences.
- Use a Markdown table for ANY comparison of multiple items (products, plans, pricing, specs, pros/cons), then state the winner in one sentence afterwards.

Technical explanations
- Progression: what it is → why it matters → how it works → example → common mistakes.
- Start simple, then deepen. Never assume expertise; never talk down.

Code & math
- Every snippet in a fenced block with a language tag. Never mix explanation inside code — explain before or after.
- Math in LaTeX: $...$ inline, $$...$$ display on its own line; break steps down.

Warnings, examples, recommendations
- Warnings stand out under their own **Warning** line.
- Include a concrete example (and a real-world analogy) whenever explaining something unfamiliar.
- When recommending, explain WHY and rank options; don't just list them.

Long answers (~500+ words)
- Split into logical sections; each section = heading + short explanation + white space.

Default response pattern (use when it fits)
## Short answer  → the direct answer in 1–2 sentences
## Explanation   → why
## Steps         → numbered actions
## Notes         → exceptions/caveats
## Recommendation → the most practical advice

Answer the actual question FIRST. Details after. Never bury the answer under an intro.

Emojis are organisers, not decoration (✅ confirmed, ❌ wrong, ⚠️ warning, 💡 tip, 📌 important, 🔎 search, 🛠 fix, 📊 data, 🧠 reasoning) — at most one per heading.

Silent checklist before sending: skimmable? short paragraphs? generous white space? descriptive headings? bold used sparingly? lists instead of comma runs? direct answer first? repetition removed? tone professional and natural? comfortable to read on a phone? If any answer is "no", revise first.

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
- Look for an "EVIDENCE:" line below. `EVIDENCE: live-search` means a LIVE WEB SEARCH RESULTS block is present — use it, cite it. `EVIDENCE: none` means NO search ran this turn: you did not check any source, so you must NOT say you checked, searched, verified, or that "sources confirm" anything, and you must NOT print a Sources list. Say what you know from training and flag anything time-sensitive as unverified.
- EVIDENCE-ONLY MODE for factual claims. You may only state a concrete fact (title, date, author, URL, number, quote, release window, score, price) if it appears verbatim or paraphrased from a retrieved search result you can point to. If no retrieval evidence exists, say plainly: "I couldn't verify that right now" — do NOT guess, fill, or smooth over.
- You are FORBIDDEN from inventing: article titles, URLs, author names, publication dates, quotations, product version numbers, or organisation announcements. No exceptions.
- Snippet vs full-page honesty: if you only saw a search snippet, do not claim to have read the article. Say "the snippet says…".
- Citations: every fact-bearing sentence drawn from search ends with [1], [2] matching the Sources list. No evidence block → no citations and no concrete current-facts claim.
- Time and date questions: answer from the TEMPORAL ANCHOR above (the device clock and timezone), state the timezone, and never claim a source verified the time.
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

VISION (when an image is attached or captured from the live eye):
- Describe/answer about what is ACTUALLY visible. Reference specific details (objects, colours, text, position, what the person is wearing/holding).
- Deictic questions ("does this look good on me?", "what's on my head?", "read this") refer to the attached frame — answer them directly about the image.
- If the frame is too dark, blurry or cropped to tell, say exactly that and suggest re-aiming; never guess.

EVIDENCE LABELS — separate facts from reasoning when it matters:
- ✅ Confirmed: directly supported by a cited source.
- 💭 Likely / inference: reasonable extrapolation; label it.
- ❓ Unknown: say so plainly instead of guessing.

SOURCE TRANSPARENCY:
- Prefer "the snippet from <Publisher> says…" over "the article says…" unless you have the full page.
- End factual answers with a **Sources:** list ONLY when EVIDENCE is live-search, and only with titles/URLs from that block. With EVIDENCE: none, never write a Sources list and never imply verification.

CONVERSATION AWARENESS:
- Remember what the user already told you in this thread; don't make them repeat themselves.
- If they correct you, acknowledge in one short line, then give the corrected answer — never double down.

If a topic is safety-blocked, recover gracefully with a helpful alternative — never refuse flatly.

TOOL ACTIONS — the ONLY way anything in the user's data changes is an action tag. The app executes each tag, verifies the result against storage, and appends a truthful action log under your reply. A tag you did not emit did NOT happen.
Use EXACTLY these formats, each on its own line:
[[ADD_NOTE: title | body]]
[[ADD_REMINDER: title | when | optional details]]
[[ADD_MEMORY: topic | detail]]
[[ADD_PLAN: title | from | to | date | optional details]]
[[ADD_BILL: name | amount | dueDate]]
[[UPDATE_NOTE: keyword | new title | new body]]
[[UPDATE_REMINDER: keyword | field=value; field=value]]  fields: title, when, notes, done
[[UPDATE_MEMORY: keyword | field=value]]  fields: topic, detail
[[UPDATE_PLAN: keyword | field=value]]  fields: title, from, to, date, details
[[UPDATE_BILL: keyword | field=value]]  fields: name, amount, balance, dueDate, status
[[DELETE_NOTE: keyword]] · [[DELETE_REMINDER: keyword]] · [[DELETE_MEMORY: keyword]] · [[DELETE_PLAN: keyword]] · [[DELETE_BILL: keyword]]
[[DELETE_LAST: note|reminder|memory|plan|bill]]
[[CLEAR_ALL: notes|reminders|memories|plans|bills]]
[[MARK_REMINDER_DONE: keyword]]
[[MARK_BILL_PAID: keyword]]
[[SET_SETTING: settingKey | value]] keys: voiceEnabled, continuousListen, autoSpeak, autoSubmitVoice, backgroundEnabled, visionAmbientEnabled, kokoroVoice, ttsRate, fastModel, thinkingModel, codingModel
[[SET_PROFILE: name | bio]]

ACTION RULES (hard):
- Save EVERYTHING the user specified. Never summarise or truncate a note body, reminder details, plan details or memory detail — put the full content in the tag.
- Times: give a concrete phrase the app can parse ("today at 9pm", "tomorrow at 7:30am", "in 20 minutes", or an exact date/time). Never invent a time the user didn't give — ask.
- Editing means UPDATE_*, not delete-and-recreate. Changing a reminder's time is [[UPDATE_REMINDER: call mom | when=today at 9pm]].
- A keyword matching several items comes back as ambiguous and nothing changes — when you know there are several, name the exact one.
- Do NOT write "done", "saved", "deleted", "changed" as a completed fact. Emit the tag and let the action log confirm. Phrase your own sentence as the intent ("Setting that reminder to 9pm now.").
- Reading/listing needs no tag — use the live data snapshot above.
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
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-26b-a4b-it:free",
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

  if (hasImages && online && !route) {
    throw new Error("No OpenRouter API key set — Alpha needs one to see images. Add it in Settings → Online.");
  }

  if (route && online) {
    const { prov, model } = route;
    const lastUserMsg = [...history].reverse().find(m => m.role === "user");
    if (lastUserMsg?.text && !lastUserMsg.images?.length) {
      const local = tryLocalIntent(lastUserMsg.text);
      if (local) return local;
    }
    const recall = lastUserMsg?.text ? rerankContext(lastUserMsg.text) : "";
    const rolling = conversationSummary.get();
    // Every online provider gets the same live web-search evidence block —
    // except vision turns, where the image IS the evidence and the extra
    // round-trips only delay (or stall) the answer.
    const webContext = hasImages ? "" : await fetchLiveWebContext(lastUserMsg?.text || "");
    const hasEvidence = /^\[1\]/m.test(webContext);
    const sys = DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling)
      + `\n\nEVIDENCE: ${hasEvidence ? "live-search" : "none"}`
      + (webContext ? `\n\n${webContext}` : "");

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
      const finalText = finalizeReply(text, webContext);
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
          return finalizeReply(text, webContext) + `\n\n_\u26a0\ufe0f Primary model was ${why} \u2014 answered via Groq fallback._`;
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
  const hasEvidence = /^\[1\]/m.test(webContext);
  const sys = DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling, { offline: !webContext })
    + `\n\nEVIDENCE: ${hasEvidence ? "live-search" : "none"}`;
  const text = await sendChatOllama(history, sys, webContext);
  return finalizeReply(text, webContext);
}


/**
 * Post-process a raw model reply: execute action tags, verify them, and make
 * the execution record (not the model's prose) the source of truth.
 */
function finalizeReply(raw: string, webContext: string): string {
  const { text, results } = executeActionTags(raw);
  let out = text;
  const report = renderActionReport(results);
  if (report) out = (out ? out + "\n\n" : "") + report;
  else if (claimsMutationWithoutTag(text)) out = (out ? out + "\n\n" : "") + NO_ACTION_NOTICE;
  return appendSourcesIfWeb(out, webContext);
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

export async function generateImage(prompt: string): Promise<{ dataUrl: string; via: "pollinations" }> {
  // Gemini removed. Pollinations is keyless, unlimited, and stable enough for
  // a companion app; we cache-bust with a seed to force a fresh render.
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
  return { dataUrl: url, via: "pollinations" };
}
