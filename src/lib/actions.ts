/**
 * Action-tag executor with an explicit result contract.
 *
 * Every state-changing tag the model emits produces exactly one
 * ActionResult. A tag being parsed is NOT success — success means the store
 * was mutated AND a re-read of the store confirms the mutation.
 */
import { alphaStore, uid, type Bill, type Memory, type Note, type Plan, type Reminder } from "./alpha-store";
import { normalizeWhen, formatWhen } from "./when";

export type ActionStatus = "success" | "failed" | "ambiguous" | "not_found" | "invalid";

export interface ActionResult {
  tag: string;
  status: ActionStatus;
  message: string;
}

type Kind = "note" | "reminder" | "memory" | "plan" | "bill";

const KIND_PLURAL: Record<Kind, string> = {
  note: "notes", reminder: "reminders", memory: "memories", plan: "plans", bill: "bills",
};

function searchText(kind: Kind, x: any): string {
  switch (kind) {
    case "note": return `${x.title} ${x.body}`;
    case "reminder": return `${x.title} ${x.notes}`;
    case "memory": return `${x.topic} ${x.detail}`;
    case "plan": return `${x.title} ${x.from} ${x.to} ${x.details || ""}`;
    case "bill": return `${x.name}`;
  }
}

function label(kind: Kind, x: any): string {
  return kind === "memory" ? x.topic : kind === "bill" ? x.name : x.title;
}

function listOf(kind: Kind): any[] {
  const s = alphaStore.get();
  return kind === "note" ? s.notes
    : kind === "reminder" ? s.reminders
    : kind === "memory" ? s.memories
    : kind === "plan" ? s.plans
    : s.bills;
}

function deleteById(kind: Kind, id: string) {
  if (kind === "note") alphaStore.deleteNote(id);
  else if (kind === "reminder") alphaStore.deleteReminder(id);
  else if (kind === "memory") alphaStore.deleteMemory(id);
  else if (kind === "plan") alphaStore.deletePlan(id);
  else alphaStore.deleteBill(id);
}

function upsert(kind: Kind, item: any) {
  if (kind === "note") alphaStore.upsertNote(item as Note);
  else if (kind === "reminder") alphaStore.upsertReminder(item as Reminder);
  else if (kind === "memory") alphaStore.upsertMemory(item as Memory);
  else if (kind === "plan") alphaStore.upsertPlan(item as Plan);
  else alphaStore.upsertBill(item as Bill);
}

/** Find items matching a keyword. Exact-ish title matches win over substring. */
function findMatches(kind: Kind, query: string): any[] {
  const q = (query || "").toLowerCase().trim().replace(/^all\s+/, "");
  if (!q) return [];
  const list = listOf(kind);
  const exact = list.filter(x => String(label(kind, x) || "").toLowerCase().trim() === q);
  if (exact.length) return exact;
  const titleHits = list.filter(x => String(label(kind, x) || "").toLowerCase().includes(q));
  if (titleHits.length) return titleHits;
  return list.filter(x => searchText(kind, x).toLowerCase().includes(q));
}

function ambiguous(tag: string, kind: Kind, hits: any[], query: string): ActionResult {
  return {
    tag,
    status: "ambiguous",
    message: `${hits.length} ${KIND_PLURAL[kind]} match "${query}" (${hits.map(h => `"${label(kind, h)}"`).join(", ")}). Nothing was changed — say exactly which one, or say "all ${query}".`,
  };
}

/** Parse `field=value; other=value` patch syntax used by UPDATE_* tags. */
function parseFields(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw || "").split(/\s*;\s*/)) {
    const m = part.match(/^([a-zA-Z]+)\s*=\s*([\s\S]*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Verify a mutation actually landed by re-reading the store. */
function verify(kind: Kind, id: string, check?: (x: any) => boolean): boolean {
  const found = listOf(kind).find(x => x.id === id);
  if (!found) return false;
  return check ? check(found) : true;
}

// ---------------------------------------------------------------- executor
export function executeActionTags(input: string): { text: string; results: ActionResult[] } {
  let text = input;
  const results: ActionResult[] = [];

  const apply = (re: RegExp, fn: (m: string[]) => ActionResult) => {
    text = text.replace(re, (...args) => {
      const groups = args.slice(0, -2).map(x => (typeof x === "string" ? x : ""));
      results.push(fn(groups as string[]));
      return "";
    });
  };

  // ---------------- CREATE
  apply(/\[\[ADD_NOTE:\s*([^|\]]+?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, (m) => {
    const title = m[1].trim();
    const body = m[2].trim();
    if (!title && !body) return { tag: "ADD_NOTE", status: "invalid", message: "A note needs a title or body — nothing was saved." };
    const id = uid();
    upsert("note", { id, title, body, updatedAt: Date.now() } satisfies Note);
    return verify("note", id, x => x.body === body && x.title === title)
      ? { tag: "ADD_NOTE", status: "success", message: `Note saved: "${title}"` }
      : { tag: "ADD_NOTE", status: "failed", message: `Note "${title}" could not be saved.` };
  });

  apply(/\[\[ADD_REMINDER:\s*([^|\]]+?)\s*\|\s*([^|\]]+?)\s*(?:\|\s*([\s\S]*?)\s*)?\]\]/gi, (m) => {
    const title = m[1].trim();
    const w = normalizeWhen(m[2].trim());
    const notes = (m[3] || "").trim();
    if (!title) return { tag: "ADD_REMINDER", status: "invalid", message: "A reminder needs a title — nothing was saved." };
    const id = uid();
    upsert("reminder", { id, title, when: w.iso, notes, done: "no" } satisfies Reminder);
    if (!verify("reminder", id, x => x.when === w.iso && x.notes === notes)) {
      return { tag: "ADD_REMINDER", status: "failed", message: `Reminder "${title}" could not be saved.` };
    }
    return w.parsed
      ? { tag: "ADD_REMINDER", status: "success", message: `Reminder saved: "${title}" — ${formatWhen(w.iso)}` }
      : { tag: "ADD_REMINDER", status: "success", message: `Reminder saved: "${title}" — but I could not turn "${w.phrase}" into a real time, so no alarm is scheduled. Give me a clear time (e.g. "today at 9pm").` };
  });

  apply(/\[\[ADD_MEMORY:\s*([^|\]]+?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, (m) => {
    const topic = m[1].trim();
    const detail = m[2].trim();
    if (!topic) return { tag: "ADD_MEMORY", status: "invalid", message: "A memory needs a topic — nothing was saved." };
    const id = uid();
    upsert("memory", { id, topic, detail, updatedAt: Date.now() } satisfies Memory);
    return verify("memory", id, x => x.detail === detail)
      ? { tag: "ADD_MEMORY", status: "success", message: `Memory saved: "${topic}"` }
      : { tag: "ADD_MEMORY", status: "failed", message: `Memory "${topic}" could not be saved.` };
  });

  apply(/\[\[ADD_PLAN:\s*([^|\]]+?)\s*\|\s*([^|\]]*?)\s*\|\s*([^|\]]*?)\s*\|\s*([^|\]]*?)\s*(?:\|\s*([\s\S]*?)\s*)?\]\]/gi, (m) => {
    const title = m[1].trim();
    if (!title) return { tag: "ADD_PLAN", status: "invalid", message: "A plan needs a title — nothing was saved." };
    const id = uid();
    const details = (m[5] || "").trim();
    upsert("plan", { id, title, from: m[2].trim(), to: m[3].trim(), date: m[4].trim(), details } satisfies Plan);
    return verify("plan", id, x => x.details === details)
      ? { tag: "ADD_PLAN", status: "success", message: `Plan saved: "${title}"` }
      : { tag: "ADD_PLAN", status: "failed", message: `Plan "${title}" could not be saved.` };
  });

  apply(/\[\[ADD_BILL:\s*([^|\]]+?)\s*\|\s*([^|\]]*?)\s*\|\s*([^|\]]*?)\s*\]\]/gi, (m) => {
    const name = m[1].trim();
    if (!name) return { tag: "ADD_BILL", status: "invalid", message: "A bill needs a name — nothing was saved." };
    const amount = Number(m[2].trim().replace(/[^\d.]/g, "")) || 0;
    const id = uid();
    upsert("bill", { id, name, amount, balance: amount, dueDate: m[3].trim(), status: "due" } satisfies Bill);
    return verify("bill", id, x => x.amount === amount)
      ? { tag: "ADD_BILL", status: "success", message: `Bill saved: "${name}"${amount ? ` — ${amount}` : ""}` }
      : { tag: "ADD_BILL", status: "failed", message: `Bill "${name}" could not be saved.` };
  });

  // ---------------- UPDATE
  const updateTag = (kind: Kind, tag: string, allowed: string[]) =>
    (m: string[]): ActionResult => {
      const query = m[1].trim();
      const hits = findMatches(kind, query);
      if (!hits.length) return { tag, status: "not_found", message: `No ${kind} matching "${query}" — nothing was changed.` };
      if (hits.length > 1) return ambiguous(tag, kind, hits, query);
      const fields = parseFields(m[2] || "");
      const keys = Object.keys(fields).filter(k => allowed.includes(k));
      if (!keys.length) {
        return { tag, status: "invalid", message: `I need fields to change (${allowed.join(", ")}) — nothing was changed on "${label(kind, hits[0])}".` };
      }
      const target = hits[0];
      const patch: Record<string, any> = {};
      for (const k of keys) {
        if (kind === "reminder" && k === "when") {
          const w = normalizeWhen(fields[k]);
          patch.when = w.iso;
          if (!w.parsed) patch.__unparsed = w.phrase;
        } else if (kind === "bill" && (k === "amount" || k === "balance")) {
          patch[k] = Number(fields[k].replace(/[^\d.]/g, "")) || 0;
        } else {
          patch[k] = fields[k];
        }
      }
      const unparsed = patch.__unparsed;
      delete patch.__unparsed;
      const next = { ...target, ...patch };
      if (kind === "note" || kind === "memory") next.updatedAt = Date.now();
      upsert(kind, next);
      const ok = verify(kind, target.id, x => keys.every(k => {
        if (k === "when" || k === "amount" || k === "balance") return String(x[k]) === String(next[k]);
        return x[k] === next[k];
      }));
      if (!ok) return { tag, status: "failed", message: `Could not update ${kind} "${label(kind, target)}".` };
      const what = keys.map(k => `${k} → ${k === "when" ? formatWhen(next.when) : next[k]}`).join(", ");
      return {
        tag, status: "success",
        message: `Updated ${kind} "${label(kind, next)}": ${what}` +
          (unparsed ? ` — but "${unparsed}" is not a time I can schedule, so no alarm is set.` : ""),
      };
    };

  apply(/\[\[UPDATE_NOTE:\s*([^|\]]+?)\s*\|\s*([^|\]]*?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, (m) => {
    // Legacy 3-part form: keyword | new title | new body
    const query = m[1].trim();
    const hits = findMatches("note", query);
    if (!hits.length) return { tag: "UPDATE_NOTE", status: "not_found", message: `No note matching "${query}" — nothing was changed.` };
    if (hits.length > 1) return ambiguous("UPDATE_NOTE", "note", hits, query);
    const n = hits[0] as Note;
    const title = m[2].trim() || n.title;
    const body = m[3].trim() || n.body;
    upsert("note", { ...n, title, body, updatedAt: Date.now() });
    return verify("note", n.id, x => x.title === title && x.body === body)
      ? { tag: "UPDATE_NOTE", status: "success", message: `Updated note "${title}".` }
      : { tag: "UPDATE_NOTE", status: "failed", message: `Could not update note "${n.title}".` };
  });

  apply(/\[\[UPDATE_REMINDER:\s*([^|\]]+?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, updateTag("reminder", "UPDATE_REMINDER", ["title", "when", "notes", "done"]));
  apply(/\[\[UPDATE_MEMORY:\s*([^|\]]+?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, updateTag("memory", "UPDATE_MEMORY", ["topic", "detail"]));
  apply(/\[\[UPDATE_PLAN:\s*([^|\]]+?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, updateTag("plan", "UPDATE_PLAN", ["title", "from", "to", "date", "details"]));
  apply(/\[\[UPDATE_BILL:\s*([^|\]]+?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, updateTag("bill", "UPDATE_BILL", ["name", "amount", "balance", "duedate", "status"]));

  // ---------------- DELETE
  apply(/\[\[DELETE_LAST:\s*(note|reminder|memory|plan|bill)\s*\]\]/gi, (m) => {
    const kind = m[1].toLowerCase() as Kind;
    const list = listOf(kind);
    if (!list.length) return { tag: "DELETE_LAST", status: "not_found", message: `There are no ${KIND_PLURAL[kind]} to delete.` };
    const victim = list[0];
    deleteById(kind, victim.id);
    return listOf(kind).some(x => x.id === victim.id)
      ? { tag: "DELETE_LAST", status: "failed", message: `Could not delete ${kind} "${label(kind, victim)}".` }
      : { tag: "DELETE_LAST", status: "success", message: `Deleted ${kind} "${label(kind, victim)}".` };
  });

  const deleteTag = (kind: Kind, tag: string) => (m: string[]): ActionResult => {
    const query = m[1].trim();
    const all = /^all\s+/i.test(query);
    const hits = findMatches(kind, query);
    if (!hits.length) return { tag, status: "not_found", message: `No ${kind} matching "${query}" — nothing was deleted.` };
    if (hits.length > 1 && !all) return ambiguous(tag, kind, hits, query);
    hits.forEach(h => deleteById(kind, h.id));
    const remaining = listOf(kind);
    const stuck = hits.filter(h => remaining.some(x => x.id === h.id));
    if (stuck.length) return { tag, status: "failed", message: `Could not delete ${stuck.length} ${KIND_PLURAL[kind]}.` };
    return { tag, status: "success", message: `Deleted ${hits.length} ${hits.length === 1 ? kind : KIND_PLURAL[kind]}: ${hits.map(h => `"${label(kind, h)}"`).join(", ")}.` };
  };

  apply(/\[\[DELETE_NOTE:\s*([^\]]+?)\s*\]\]/gi, deleteTag("note", "DELETE_NOTE"));
  apply(/\[\[DELETE_REMINDER:\s*([^\]]+?)\s*\]\]/gi, deleteTag("reminder", "DELETE_REMINDER"));
  apply(/\[\[DELETE_MEMORY:\s*([^\]]+?)\s*\]\]/gi, deleteTag("memory", "DELETE_MEMORY"));
  apply(/\[\[DELETE_PLAN:\s*([^\]]+?)\s*\]\]/gi, deleteTag("plan", "DELETE_PLAN"));
  apply(/\[\[DELETE_BILL:\s*([^\]]+?)\s*\]\]/gi, deleteTag("bill", "DELETE_BILL"));

  apply(/\[\[CLEAR_ALL:\s*(notes|reminders|memories|plans|bills)\s*\]\]/gi, (m) => {
    const plural = m[1].toLowerCase();
    const kind = (Object.keys(KIND_PLURAL) as Kind[]).find(k => KIND_PLURAL[k] === plural)!;
    const list = [...listOf(kind)];
    if (!list.length) return { tag: "CLEAR_ALL", status: "not_found", message: `There are no ${plural} to clear.` };
    list.forEach(x => deleteById(kind, x.id));
    return listOf(kind).length
      ? { tag: "CLEAR_ALL", status: "failed", message: `Could not clear all ${plural} — ${listOf(kind).length} remain.` }
      : { tag: "CLEAR_ALL", status: "success", message: `Cleared all ${list.length} ${plural}.` };
  });

  // ---------------- COMPLETE
  apply(/\[\[MARK_REMINDER_DONE:\s*([^\]]+?)\s*\]\]/gi, (m) => {
    const query = m[1].trim();
    const hits = findMatches("reminder", query);
    if (!hits.length) return { tag: "MARK_REMINDER_DONE", status: "not_found", message: `No reminder matching "${query}" — nothing was changed.` };
    if (hits.length > 1) return ambiguous("MARK_REMINDER_DONE", "reminder", hits, query);
    const r = hits[0] as Reminder;
    upsert("reminder", { ...r, done: "yes" });
    return verify("reminder", r.id, x => x.done === "yes")
      ? { tag: "MARK_REMINDER_DONE", status: "success", message: `Marked reminder "${r.title}" done.` }
      : { tag: "MARK_REMINDER_DONE", status: "failed", message: `Could not complete reminder "${r.title}".` };
  });

  apply(/\[\[MARK_BILL_PAID:\s*([^\]]+?)\s*\]\]/gi, (m) => {
    const query = m[1].trim();
    const hits = findMatches("bill", query);
    if (!hits.length) return { tag: "MARK_BILL_PAID", status: "not_found", message: `No bill matching "${query}" — nothing was changed.` };
    if (hits.length > 1) return ambiguous("MARK_BILL_PAID", "bill", hits, query);
    const b = hits[0] as Bill;
    upsert("bill", { ...b, status: "paid", balance: 0 });
    return verify("bill", b.id, x => x.status === "paid" && x.balance === 0)
      ? { tag: "MARK_BILL_PAID", status: "success", message: `Marked bill "${b.name}" paid.` }
      : { tag: "MARK_BILL_PAID", status: "failed", message: `Could not mark bill "${b.name}" paid.` };
  });

  // ---------------- SETTINGS / PROFILE
  apply(/\[\[SET_SETTING:\s*([^|\]]+?)\s*\|\s*([^\]]*?)\s*\]\]/gi, (m) => {
    const tag = "SET_SETTING";
    const key = m[1].trim();
    const raw = m[2].trim();
    const cur = alphaStore.get().settings;
    const boolVal = /^(true|on|yes|enabled?|1)$/i.test(raw);
    const boolKeys = ["voiceEnabled", "continuousListen", "backgroundEnabled", "autoSpeak", "autoSubmitVoice", "visionAmbientEnabled"] as const;
    const ok = (msg: string, check: () => boolean): ActionResult =>
      check() ? { tag, status: "success", message: msg } : { tag, status: "failed", message: `Could not change ${key}.` };

    if ((boolKeys as readonly string[]).includes(key)) {
      alphaStore.setSettings({ [key]: boolVal } as any);
      return ok(`${key} ${boolVal ? "enabled" : "disabled"}.`, () => (alphaStore.get().settings as any)[key] === boolVal);
    }
    if (key === "kokoroVoice") {
      alphaStore.setSettings({ kokoroVoice: raw });
      return ok(`Kokoro voice set to ${raw}.`, () => alphaStore.get().settings.kokoroVoice === raw);
    }
    if (key === "ttsRate") {
      const rate = Math.max(0.7, Math.min(1.4, Number(raw) || cur.ttsRate));
      alphaStore.setSettings({ ttsRate: rate });
      return ok(`Speech rate set to ${rate.toFixed(2)}x.`, () => alphaStore.get().settings.ttsRate === rate);
    }
    if (key === "fastModel" || key === "thinkingModel" || key === "codingModel") {
      const lane = key.replace("Model", "") as "fast" | "thinking" | "coding";
      alphaStore.setSettings({ taskModels: { ...cur.taskModels, [lane]: raw } });
      return ok(`${lane} model set to ${raw}.`, () => alphaStore.get().settings.taskModels[lane] === raw);
    }
    return { tag, status: "invalid", message: `"${key}" is not a setting I can change — nothing was changed.` };
  });

  apply(/\[\[SET_PROFILE:\s*([^|\]]*?)\s*\|\s*([\s\S]*?)\s*\]\]/gi, (m) => {
    const p = alphaStore.get().profile;
    const name = m[1].trim() || p.name;
    const bio = m[2].trim() || p.bio;
    alphaStore.setProfile({ name, bio });
    const after = alphaStore.get().profile;
    return after.name === name && after.bio === bio
      ? { tag: "SET_PROFILE", status: "success", message: `Profile updated${name ? ` for ${name}` : ""}.` }
      : { tag: "SET_PROFILE", status: "failed", message: "Could not update your profile." };
  });

  // Any leftover unknown tag must not be silently swallowed as success.
  apply(/\[\[([A-Z_]+)(?::[^\]]*)?\]\]/g, (m) => ({
    tag: m[1],
    status: "invalid",
    message: `I tried to use an action I don't support ("${m[1]}") — nothing was changed.`,
  }));

  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), results };
}

const ICON: Record<ActionStatus, string> = {
  success: "✅", failed: "❌", ambiguous: "⚠️", not_found: "❌", invalid: "⚠️",
};

/** Render the execution record appended under Alpha's reply. */
export function renderActionReport(results: ActionResult[]): string {
  if (!results.length) return "";
  const lines = results.map(r => `${ICON[r.status]} ${r.message}`);
  const anyBad = results.some(r => r.status !== "success");
  return (anyBad ? "**Action log — read this over anything I said above:**\n" : "") + lines.join("\n");
}

const MUTATION_CLAIM =
  /\b(?:i(?:'ve| have)?\s+(?:just\s+)?(?:saved|added|created|deleted|removed|updated|changed|set|scheduled|cleared|marked)|(?:done|saved|added|deleted|removed|updated)\s*[.!]|it'?s\s+(?:saved|added|deleted|done|set))\b/i;

/**
 * The model sometimes claims a mutation without emitting a tag. Nothing was
 * executed in that case, so say so instead of letting the claim stand.
 */
export function claimsMutationWithoutTag(text: string): boolean {
  return MUTATION_CLAIM.test(text);
}

export const NO_ACTION_NOTICE =
  "⚠️ I described a change but did not actually perform one — nothing in your data was modified. Ask me again and I'll run the real action.";
