/**
 * Permission-based web search.
 *
 * Alpha does NOT search during ordinary conversation. A search only runs when
 * the user explicitly asks for one, or when they grant permission after Alpha
 * offered. Anything else answers from knowledge with honest uncertainty.
 */

/** Explicit "go online" phrasing. */
const EXPLICIT = /\b(search|google|bing|duckduckgo|look\s+(?:it\s+)?up|browse|surf)\b[^.?!]*\b(web|online|internet|net|for me|this|that|it)?\b|\bweb\s?search\b|\bsearch\s+(?:the\s+)?(?:web|internet|online)\b|\blook\s+(?:this|that|it)?\s*up\s+(?:online|on the web)\b|\bcheck\s+(?:online|the web|the internet)\b|\bверify\s+online\b/i;

/** Verbs that only count as a search request when paired with online wording. */
const VERBS = /\b(check|verify|confirm|find|research|look\s+up|fact.?check)\b/i;
const ONLINE_WORDS = /\b(online|web|internet|net|sources?|citation|latest|live)\b/i;

/** Short affirmatives that grant a pending offer. */
const AFFIRM = /^(?:\s*(?:yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|search|go on|affirmative|do|please do)\b[\s.!,]*)+$/i;

export type SearchDecision =
  | { search: true; query: string; reason: "explicit" | "granted" }
  | { search: false; offer: boolean };

let pendingOffer: { query: string; at: number } | null = null;

/** Alpha may offer once; the offer expires after 10 minutes. */
export function setPendingSearchOffer(query: string) {
  pendingOffer = { query, at: Date.now() };
}
export function clearPendingSearchOffer() {
  pendingOffer = null;
}
export function getPendingSearchOffer(): string | null {
  if (!pendingOffer) return null;
  if (Date.now() - pendingOffer.at > 10 * 60 * 1000) { pendingOffer = null; return null; }
  return pendingOffer.query;
}

/** Did the user explicitly ask Alpha to go online? */
export function isExplicitSearchRequest(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (/\b(search|google)\b/i.test(t) && !/\bsearch\s+(?:my|the)\s+(?:notes|memories|reminders|plans|bills|chat)\b/i.test(t)) return true;
  if (EXPLICIT.test(t)) return true;
  if (VERBS.test(t) && ONLINE_WORDS.test(t)) return true;
  return false;
}

/**
 * Would current information materially help? Used ONLY to decide whether Alpha
 * offers to search — never to search on its own.
 */
export function mayBenefitFromSearch(text: string): boolean {
  return /\b(latest|current|today|yesterday|right now|this week|this month|news|headlines?|price|stock|score|released?|release date|version|weather|who won|202\d|203\d)\b/i.test(text || "");
}

/**
 * Decide what to do with this user turn.
 * `search: true` means the app is allowed to run exactly one focused search.
 */
export function decideSearch(text: string): SearchDecision {
  const t = (text || "").trim();
  if (!t) return { search: false, offer: false };

  const pending = getPendingSearchOffer();
  if (pending && AFFIRM.test(t)) {
    clearPendingSearchOffer();
    return { search: true, query: pending, reason: "granted" };
  }

  if (isExplicitSearchRequest(t)) {
    clearPendingSearchOffer();
    return { search: true, query: stripSearchPreamble(t), reason: "explicit" };
  }

  if (mayBenefitFromSearch(t)) {
    setPendingSearchOffer(t);
    return { search: false, offer: true };
  }
  return { search: false, offer: false };
}

/** Turn "can you search the web for X please" into "X". */
export function stripSearchPreamble(text: string): string {
  let q = text
    .replace(/^\s*(?:hey\s+)?alpha[,\s]+/i, "")
    .replace(/\b(?:please|can you|could you|would you|i want you to|i need you to)\b/gi, " ")
    .replace(/\b(?:do a |run a |perform a )?(?:web\s?)?search(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+for)?\b/gi, " ")
    .replace(/\b(?:google|bing|duckduckgo)\b/gi, " ")
    .replace(/\blook\s+(?:this|that|it)?\s*up\b(?:\s+(?:online|on the web|on the internet))?/gi, " ")
    .replace(/\b(?:check|verify|confirm|research|fact.?check)\b(?:\s+(?:online|on the web|on the internet))?/gi, " ")
    .replace(/\bfor me\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,:;-]+|[?!.]+$/g, "")
    .trim();
  if (q.length < 3) q = text.trim();
  return q;
}

/** Sentence Alpha uses when it wants permission. Never searches by itself. */
export const SEARCH_OFFER_HINT =
  `SEARCH PERMISSION: no search ran and none is allowed this turn. Answer from your own knowledge. ` +
  `If the answer is time-sensitive or may have changed since your training, say so plainly and end by asking: ` +
  `"This may have changed since my knowledge cutoff. Would you like me to search the web?" Then stop — do not pretend to search.`;

export const SEARCH_FORBIDDEN_HINT =
  `SEARCH PERMISSION: no search ran this turn and none was requested. Answer from your own knowledge, flag anything uncertain, and do not imply you looked anything up.`;
