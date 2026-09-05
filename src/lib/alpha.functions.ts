import { alphaStore, conversationSummary, type ChatMessage } from "./alpha-store";
import { tryLocalIntent } from "./local-intents";
import { sendChatOllama } from "./ollama";
import { sendChatOpenAICompat } from "./openai-compat";
import { executeActionTags, renderActionReport, claimsMutationWithoutTag, NO_ACTION_NOTICE } from "./actions";
import { activity } from "./activity";
import {
  MODEL_TRIO, TEXT_FALLBACKS, VISION_FALLBACKS, GROQ_EMERGENCY_MODEL,
  MAX_OUTPUT_TOKENS, HISTORY_TURNS, parseRouteSpec, routeLabel, type ProviderId,
} from "./models";
import { decideSearch, SEARCH_OFFER_HINT, SEARCH_FORBIDDEN_HINT } from "./web-search";

export type TaskType = "auto" | "fast" | "thinking" | "coding";

// ---------- Temporal anchoring ----------
function temporalBlock(): string {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const day = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `TODAY IS ${day}. Exact local time now: ${time} (${tz}). UTC: ${d.toUTCString()}. Unix ms: ${d.getTime()}. Year ${d.getFullYear()}. Treat anything dated before today as past, after today as future. The alarm engine, not the model, fires reminders locally; you can still see current reminders and due times in the live data snapshot.`;
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
    items.map(x => ({ x, s: score(q, pick(x)) })).sort((a, b) => b.s - a.s).slice(0, n).filter(o => o.s > 0).map(o => o.x);
  const mems = rank(s.memories, m => `${m.topic} ${m.detail}`);
  const notes = rank(s.notes, n => `${n.title} ${n.body}`);
  const remrs = rank(s.reminders, r => `${r.title} ${r.notes} ${r.when}`);
  // Long-term chat recall: skim prior turns, pull the top lexical matches so
  // Alpha remembers past the live context window.
  const olderChat = s.chat.slice(0, Math.max(0, s.chat.length - 20));
  const chatHits = olderChat
    .map(m => ({ m, s: score(q, m.text || "") }))
    .filter(o => o.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map(o => o.m);
  const out: string[] = [];
  if (mems.length) out.push("Relevant memories:\n" + mems.map(m => `• ${m.topic}: ${m.detail}`).join("\n"));
  if (notes.length) out.push("Relevant notes:\n" + notes.map(n => `• ${n.title}: ${(n.body || "").slice(0, 200)}`).join("\n"));
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

export const DEFAULT_SYSTEM = (extra: string, recall = "", rolling = "", opts: { offline?: boolean } = {}) => `${opts.offline ? `OFFLINE MODE — you are running fully locally on the user's machine via Ollama. You have NO internet access and NO way to look up current events, news, prices, releases or URLs. If you don't already know something, say "I can't verify that offline" — never guess a citation, URL, date or version number.

` : ""}You are Alpha — a hyper-intelligent, futuristic AI companion with warm, level-3 wit. Speak naturally with light acknowledgement cues ("mm", "right", "got it") and dynamic tone. Be concise, helpful, never robotic.

HOW YOU WRITE (highest priority)

You choose the STRUCTURE; the app controls the exact spacing, sizes and layout. So pick the right structure and never try to fake layout with extra symbols, dividers or padding.

Default shape
- Normal explanations are PARAGRAPHS of 2–4 sentences, separated by a blank line. This is your default — most answers are prose, not bullets.
- A short conversational question gets a short conversational answer: one or two paragraphs, no headings, no lists, no table.
- Only long or multi-part answers get headings. Never head a two-sentence reply.
- Never produce a single uninterrupted wall of text, and never split a flowing explanation into a series of one-sentence bullets.

Headings
- Use "##" for main sections and "###" for sub-sections. Never a single "#".
- Only when the answer genuinely has several sections (roughly 6+ sentences of substance). Headings describe the section ("Why this happens", "Steps", "Trade-offs"), never decorate.

Lists
- Use a list for several separate items: requirements, options, pros and cons, checklists, ordered steps, independent points.
- Use a paragraph when it is one continuous idea, a short answer, or when bullets would sound unnatural or fragmented.
- Bullets ("- ") for unordered items, numbers ("1.") when order or ranking matters — one action per step.
- Nest only when the hierarchy is real, and at most one level deep.

Emphasis
- Bold ("**like this**") for important terms, short labels, key conclusions, action or setting names, and warnings. A handful per answer at most.
- Never bold a whole paragraph, every bullet, or every heading. Never stack bold + italic + caps for emphasis.

Tables
- A Markdown table only for a genuine structured comparison: several items across the same categories, specs, prices, schedules.
- Never for one or two values, never for prose, never with long paragraphs inside cells. Keep cells short so the table stays readable on a phone. Say the conclusion in one sentence after the table.

Maths
- Inline "$…$" when the expression sits inside a sentence, display "$$…$$" on its own line when it deserves its own line.
- Plain text for simple quantities ("about 15%", "roughly 3 hours"). Never turn basic arithmetic into a display equation.

Code
- Fenced blocks with a language tag for real code, commands, configuration, JSON, SQL or regex. Inline backticks for a variable, filename or single command inside a sentence.
- Explain before or after the block, never inside it.

Quotes, links, sources
- Block quotes are rare — only for genuinely quoted material.
- Write links as "[label](url)", never a bare URL in the middle of a sentence.
- A "**Sources:**" section appears only when a real search happened this turn.

Tone discipline
- No filler openers ("Great question!", "Absolutely!"), no repeated intro-and-conclusion scaffolding, no emoji decoration (an occasional ✅/⚠️ where it carries meaning is fine — never one per line).
- Answer the actual question first, details after.
- Keep simple answers short; expand only when the user asks for depth or the subject needs it.
- Match the user's tone without losing clarity. Say plainly when you are uncertain.
- Never expose raw Markdown markers, raw LaTeX commands, action tags, JSON, tool names, model or provider names, or internal errors.

You are fully aware of your own toolkit inside this app:
- /chat — text + voice chat with you (this surface).
- /  (the Orb) — voice-first hands-free mode. User can say "open chat / notes / bills / image / reminders / plans / memories / settings" to navigate.
- /notes — notes (title + body, formatted).
- /bills — bill ledger (name, amount, balance, due date, status).
- /reminders — alarms / reminders (title, when, notes, done).
- /plans — plans & routes (title, from, to, date, details).
- /memories — long-term memory the user wants you to keep (topic, detail).
- /image — image generation dashboard.
- /settings — provider keys, model routing, voice prefs, Alpha data.

You ALWAYS have live context of the user's data and may proactively reference it when relevant.

TEMPORAL ANCHOR (authoritative — overrides any contradictory date in training or search snippets):
${temporalBlock()}

Live user data snapshot:
${ctxSummary()}
${recall ? "\nRetrieved-context (semantically reranked for THIS turn):\n" + recall : ""}
${rolling ? "\nRolling conversation state (compacted from earlier turns):\n" + rolling : ""}

TRUTHFULNESS (hard rules — do not violate):
- Read the "EVIDENCE:" line below. "EVIDENCE: live-search" means a LIVE WEB SEARCH RESULTS block is present: use it and cite it. "EVIDENCE: none" means NO search ran this turn — you did not check anything, so you must NOT say you searched, checked, verified or that "sources confirm", and you must NOT print a Sources list.
- With EVIDENCE: none, answer from your own knowledge and flag time-sensitive facts as unverified. Never invent article titles, URLs, authors, dates, quotations, version numbers or announcements.
- Never claim to have read an image unless an image was actually attached to this turn.
- Never state that a note, reminder, bill, memory, plan or setting changed. Only the app's verified action log may confirm that.
- Snippet honesty: if you only saw a search snippet, say "the snippet from <Publisher> says…" — don't claim you read the page.
- Citations "[1]", "[2]" only when an evidence block exists; end such answers with a "**Sources:**" list built from that block.
- Time and date questions: answer from the TEMPORAL ANCHOR above and name the timezone. Never claim a source verified the time.
- If the user corrects you, accept it in one line and give the corrected answer.

VISION (when an image is attached or captured from the live eye):
- Answer about what is ACTUALLY visible — objects, colours, text, position, what the person is wearing or holding.
- Deictic questions ("does this look good on me?", "what's on my head?", "read this") refer to the attached frame.
- If the frame is too dark, blurry or cropped to tell, say exactly that and suggest re-aiming. Never guess.

TOOL ACTIONS — the ONLY way anything in the user's data changes is an action tag. The app executes each tag, re-reads storage to verify it, and appends a truthful action log under your reply. A tag you did not emit did NOT happen.
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
- Save EVERYTHING the user specified. Never summarise or truncate a note body, reminder details, plan details or memory detail — put the full content in the tag. Markdown inside a note body is fine and is rendered properly.
- Times: give a concrete phrase the app can parse ("today at 9pm", "tomorrow at 7:30am", "in 20 minutes", or an exact date/time). Never invent a time the user didn't give — ask.
- Editing means UPDATE_*, not delete-and-recreate.
- A keyword matching several items comes back as ambiguous and nothing changes — when several exist, name the exact one.
- Never write "done", "saved", "deleted" or "changed" as completed fact. Emit the tag and phrase your own sentence as intent ("Setting that reminder to 9pm now.").
- Reading or listing needs no tag — use the live data snapshot above.
${extra ? "\nUser personalisation:\n" + extra : ""}`;

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function cleanApiKey(key: string): string {
  return (key || "").trim().replace(/^Bearer\s+/i, "").replace(/^['"]|['"]$/g, "").trim();
}

function providerHasKey(prov: ProviderId) {
  const s = alphaStore.get().settings;
  if (prov === "groq") return !!cleanApiKey(s.groqApiKey);
  if (prov === "openai") return !!cleanApiKey(s.openaiCompatKey);
  return !!cleanApiKey(s.openRouterKey);
}

/** Ordered candidate routes for this turn: preferred first, fallbacks after. */
function planRoutes(task: TaskType, hasImages: boolean): Array<{ prov: ProviderId; model: string }> {
  const s = alphaStore.get().settings;
  const out: Array<{ prov: ProviderId; model: string }> = [];
  const push = (spec: string | null | undefined) => {
    const r = spec ? parseRouteSpec(spec) : null;
    if (r && providerHasKey(r.prov) && !out.some(o => o.prov === r.prov && o.model === r.model)) out.push(r);
  };

  if (hasImages) {
    if (providerHasKey("openrouter")) for (const m of VISION_FALLBACKS) push(`openrouter:${m}`);
    return out;
  }

  // 1. The lane the user chose (or configured in Settings).
  if (task === "coding") push(s.taskModels.coding || MODEL_TRIO.coding);
  else if (task === "thinking") push(s.taskModels.thinking || MODEL_TRIO.capable);
  else if (task === "fast") push(s.taskModels.fast || MODEL_TRIO.fast);
  else { push(MODEL_TRIO.primary); push(s.taskModels.fast); }

  // 2. The rest of the centrally configured trio.
  push(MODEL_TRIO.primary); push(MODEL_TRIO.fast); push(MODEL_TRIO.capable); push(MODEL_TRIO.coding);
  // 3. Verified fallback chain.
  if (providerHasKey("openrouter")) for (const m of TEXT_FALLBACKS) push(`openrouter:${m}`);
  // 4. Whatever other lanes the user configured.
  push(s.taskModels.thinking); push(s.taskModels.coding);
  // 5. Emergency Groq lane.
  if (providerHasKey("groq")) push(`groq:${GROQ_EMERGENCY_MODEL}`);
  return out;
}

// ---------------------------------------------------------------------------
// Web search (permission-gated — see web-search.ts)
// ---------------------------------------------------------------------------

async function fetchLiveWebContext(query: string): Promise<string> {
  if (!query) return "";
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

  // ONE focused search. No overlapping queries.
  try {
    const freshQuery = /\b(headlines?|news|latest|current|today|this week)\b/i.test(query)
      ? `${query} ${new Date().getFullYear()}`
      : query;
    const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(freshQuery)}&kl=wt-wt&df=d`;
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

  // Second request only when the first came back empty.
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
    return `LIVE WEB SEARCH RESULTS: the search ran but returned no usable public results for "${query}" at ${new Date().toLocaleString()}. Tell the user the search came back empty; do not guess.`;
  }

  return [
    `LIVE WEB SEARCH RESULTS — fetched at ${new Date().toLocaleString()} for query: "${query}".`,
    `Use ONLY these results for current facts. If a snippet looks old, say so. Cite as [1], [2].`,
    ...rows.slice(0, 10).map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSource: ${r.source}${r.snippet ? `\nSnippet: ${r.snippet}` : ""}`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Request discipline: one user message → one model request
// ---------------------------------------------------------------------------

let inFlight: { key: string; promise: Promise<string> } | null = null;

/** Which model actually produced the last reply (developer record). */
export let lastAnsweredBy = "";

function requestKey(history: ChatMessage[], task: TaskType): string {
  const last = [...history].reverse().find(m => m.role === "user");
  return `${task}|${last?.id || ""}|${(last?.text || "").slice(0, 200)}|${last?.images?.length || 0}`;
}

export async function sendChat(history: ChatMessage[], opts: { task?: TaskType } = {}): Promise<string> {
  const task: TaskType = opts.task ?? "auto";
  const key = requestKey(history, task);
  // Duplicate submissions (double tap, re-render, voice + button) share one request.
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = runChat(history, task).finally(() => {
    if (inFlight?.key === key) inFlight = null;
  });
  inFlight = { key, promise };
  return promise;
}

async function runChat(history: ChatMessage[], task: TaskType): Promise<string> {
  const s = alphaStore.get().settings;
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  const lastUserMsg = [...history].reverse().find(m => m.role === "user");
  const hasImages = !!lastUserMsg?.images?.length;
  const userText = lastUserMsg?.text || "";

  // Local intents answer instantly with no model request at all.
  if (userText && !hasImages) {
    const local = tryLocalIntent(userText);
    if (local) { activity.clear(); return local; }
  }

  const routes = online ? planRoutes(task, hasImages) : [];

  if (hasImages && online && !routes.length) {
    activity.set("error");
    throw new Error("No OpenRouter API key set — Alpha needs one to see images. Add it in Settings → Online.");
  }

  activity.set(hasImages ? "reading_image" : "thinking");

  const recall = userText ? rerankContext(userText) : "";
  const rolling = conversationSummary.get();

  // ---- Permission-gated search: never automatic ----
  let webContext = "";
  let searchHint = SEARCH_FORBIDDEN_HINT;
  if (online && !hasImages) {
    const decision = decideSearch(userText);
    if (decision.search) {
      activity.set("searching");
      webContext = await fetchLiveWebContext(decision.query);
      activity.set("preparing");
    } else if (decision.offer) {
      searchHint = SEARCH_OFFER_HINT;
    }
  } else if (hasImages) {
    searchHint = SEARCH_FORBIDDEN_HINT;
  }

  const hasEvidence = /^\[1\]/m.test(webContext);
  const buildSys = (offline: boolean) =>
    DEFAULT_SYSTEM(s.personaExtra || "", recall, rolling, { offline })
    + `\n\nEVIDENCE: ${hasEvidence ? "live-search" : "none"}\n${searchHint}`
    + (webContext ? `\n\n${webContext}` : "");

  if (routes.length) {
    const sys = buildSys(false);
    const budget = hasImages ? "vision" : task;
    const maxTokens = MAX_OUTPUT_TOKENS[budget as keyof typeof MAX_OUTPUT_TOKENS] ?? MAX_OUTPUT_TOKENS.auto;
    const historyTurns = HISTORY_TURNS[budget as keyof typeof HISTORY_TURNS] ?? HISTORY_TURNS.auto;

    let lastErr: any = null;
    for (let i = 0; i < routes.length; i++) {
      const { prov, model } = routes[i];
      if (i > 0) activity.set("switching_model");
      else activity.set(hasImages ? "reading_image" : "thinking");
      try {
        const text = await callProvider(prov, model, history, sys, {
          allowImages: hasImages, maxTokens, historyTurns,
        });
        lastAnsweredBy = routeLabel(prov, model);
        activity.set("preparing");
        const finalText = finalizeReply(text, webContext);
        void maybeCompactSummary(history, finalText);
        activity.clear();
        return finalText;
      } catch (err: any) {
        lastErr = err;
        // Developer-only detail; users never see provider bodies.
        if (typeof console !== "undefined") console.warn(`[alpha] ${prov}:${model} failed`, err?.status, err?.message);
        const st = err?.status;
        const retryableElsewhere = st === 429 || st === 404 || st === 402 || st === 403 || st === 502 || st === 504 || (st >= 500 && st < 600)
          || /unavailable|no endpoints|rate.?limit|quota|empty response|timed out/i.test(String(err?.message || ""));
        if (!retryableElsewhere) break;
      }
    }
    activity.set("error");
    // One user-facing sentence — never the raw provider body.
    const st = lastErr?.status;
    const friendly = st === 429
      ? "Every model I can reach is rate-limited right now. Give it a minute and try again."
      : st === 401 || st === 403
        ? "My model provider rejected the API key. Re-paste it in Settings → Online."
        : "I couldn't get a reply from any model just now. Try again in a moment.";
    const e: any = new Error(friendly);
    e.status = st;
    throw e;
  }

  // No online route (no keys or offline) — fall through to local Ollama.
  activity.set("thinking");
  try {
    const text = await sendChatOllama(history, buildSys(!webContext), webContext);
    lastAnsweredBy = "local model (Ollama)";
    activity.set("preparing");
    const out = finalizeReply(text, webContext);
    activity.clear();
    return out;
  } catch (e) {
    activity.set("error");
    throw e;
  }
}

async function callProvider(
  prov: ProviderId,
  model: string,
  history: ChatMessage[],
  sys: string,
  o: { allowImages: boolean; maxTokens: number; historyTurns: number },
): Promise<string> {
  const s = alphaStore.get().settings;
  const shared = {
    model,
    maxTokens: o.maxTokens,
    historyTurns: o.historyTurns,
    allowImages: o.allowImages,
    retries: 1,
    onStatus: (st: "waiting" | "retrying") => activity.set(st === "retrying" ? "retrying" : "waiting_provider"),
  };
  if (prov === "groq") {
    return sendChatOpenAICompat(history, sys, {
      ...shared, baseUrl: "https://api.groq.com/openai/v1", apiKey: cleanApiKey(s.groqApiKey),
    });
  }
  if (prov === "openai") {
    return sendChatOpenAICompat(history, sys, {
      ...shared, baseUrl: s.openaiCompatBase || "https://api.openai.com/v1", apiKey: cleanApiKey(s.openaiCompatKey),
    });
  }
  return sendChatOpenAICompat(history, sys, {
    ...shared,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: cleanApiKey(s.openRouterKey),
    extraHeaders: {
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://alpha.local",
      "X-Title": "Alpha",
    },
  });
}

/**
 * Post-process a raw model reply: execute action tags, verify them, and make
 * the execution record (not the model's prose) the source of truth.
 */
function finalizeReply(raw: string, webContext: string): string {
  const hasTags = /\[\[[A-Z_]+:/.test(raw);
  if (hasTags) activity.set("executing_action");
  const { text, results } = executeActionTags(raw);
  let out = text;
  const report = renderActionReport(results);
  if (report) {
    if (results.some(r => r.status !== "success")) activity.set("action_failed");
    out = (out ? out + "\n\n" : "") + report;
  } else if (claimsMutationWithoutTag(text)) {
    out = (out ? out + "\n\n" : "") + NO_ACTION_NOTICE;
  }
  return appendSourcesIfWeb(out, webContext);
}

/** Build a Sources footer from the evidence block we actually fed the model. */
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
    // Deliberately rare: a compaction is an extra request, so it only runs
    // every 10+ turns on long threads.
    if (turns < 16) return;
    if (turns - lastCompactAt < 12) return;
    lastCompactAt = turns;
    const groqKey = cleanApiKey(alphaStore.get().settings.groqApiKey);
    if (!groqKey) return; // Best-effort only; never worth an extra paid/limited call.
    const older = history.slice(0, -10);
    if (!older.length) return;
    const transcript = older.slice(-30).map(m => `${m.role.toUpperCase()}: ${(m.text || "").slice(0, 300)}`).join("\n");
    const previous = conversationSummary.get();
    const prompt = `Compress this chat into a compact STATE MATRIX for an assistant named Alpha. <=500 words, bullet sections only:
• User profile & preferences
• Active projects / topics
• Open decisions / unanswered questions
• Facts the user told Alpha (and dates)
• Recent thread context (1 line each)
No prose, no preamble. Merge with the previous matrix, overwriting stale items.

PREVIOUS STATE MATRIX:
${previous || "(none)"}

TRANSCRIPT:
${transcript}

LATEST REPLY:
${lastAssistant.slice(0, 500)}`;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: GROQ_EMERGENCY_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2, stream: false, max_tokens: 800,
      }),
    });
    if (!res.ok) return;
    const j: any = await res.json();
    const out = j?.choices?.[0]?.message?.content?.trim() || "";
    if (out) conversationSummary.set(out);
  } catch { /* swallow — background */ }
}

export async function generateImage(prompt: string): Promise<{ dataUrl: string; via: "pollinations" }> {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
  return { dataUrl: url, via: "pollinations" };
}
