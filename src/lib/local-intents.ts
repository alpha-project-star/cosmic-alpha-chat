import { alphaStore, uid } from "./alpha-store";
import { trySettingsIntent } from "./settings-intents";
import { playMusicByName, stopMusic } from "./music";

/**
 * Lightweight on-device intent parser for CRUD commands so Alpha can actually
 * perform operations (add reminder, add note, save memory, delete X) without
 * hitting the LLM. Returns a spoken confirmation string, or null if no match.
 */
export function tryLocalIntent(raw: string): string | null {
  const t = raw.trim();
  const lower = t.toLowerCase();

  // Settings / backend / voice flip commands first.
  const settingsHit = trySettingsIntent(t);
  if (settingsHit) return settingsHit;

  // ---- MUSIC -------------------------------------------------------------
  if (/^(?:stop|pause)\s+(?:the\s+)?music\b/.test(lower)) {
    stopMusic();
    return "Music stopped.";
  }
  let music = lower.match(/^(?:play|start)\s+(?:my\s+|the\s+)?(?:music|song|track)(?:\s+(.+))?$/);
  if (!music) music = lower.match(/^(?:play|start)\s+(.+)$/);
  if (
    music &&
    !/^(?:open|delete|remove|clear|add|set|switch|change|use|remind|remember|note|plan|mark)\b/.test(
      lower,
    )
  ) {
    const q = trim(music[1] || "");
    void playMusicByName(q).catch(() => {});
    return q ? `Playing ${q}.` : "Playing your latest saved track.";
  }

  // ---- READ / LIST ------------------------------------------------------
  let mm = lower.match(
    /^(?:what|which|list|show|read)\s+(?:are\s+)?(?:my\s+|the\s+)?(reminders|notes|memories|memorys|memory|plans|bills)/,
  );
  if (mm) {
    const kind = mm[1].replace(/s$/, "");
    return listItems(kind);
  }
  if (/^(?:what|which)\s+do\s+you\s+remember/.test(lower)) return listItems("memory");

  // ---- BULK CLEAR -------------------------------------------------------
  mm = lower.match(
    /^(?:delete|remove|clear)\s+all\s+(notes|reminders|memories|memory|plans|bills)/,
  );
  if (mm) {
    const kind = mm[1].replace(/s$/, "");
    return bulkClear(kind);
  }
  if (/^(?:clear|delete|remove)\s+(?:all\s+)?done\s+reminders/.test(lower)) {
    const s = alphaStore.get();
    let n = 0;
    for (const r of s.reminders)
      if (r.done === "yes") {
        alphaStore.deleteReminder(r.id);
        n++;
      }
    return `Cleared ${n} completed reminder${n === 1 ? "" : "s"}.`;
  }

  // ---- DELETE BY NAME (fuzzy) ------------------------------------------
  mm = lower.match(
    /^(?:delete|remove|forget)\s+(?:the\s+)?(note|reminder|memory|plan|bill)\s+(?:about\s+|called\s+|named\s+|to\s+)?(.+)$/,
  );
  if (mm) return deleteFuzzy(mm[1], trim(mm[2]));
  mm = lower.match(/^forget\s+(?:that|about)\s+(.+)$/);
  if (mm) return deleteFuzzy("memory", trim(mm[1]));

  // ---- UPDATE ----------------------------------------------------------
  mm = lower.match(
    /^(?:rename|change)\s+(?:the\s+)?note\s+(?:called\s+|named\s+)?(.+?)\s+to\s+(.+)$/,
  );
  if (mm) {
    const q = trim(mm[1]);
    const to = trim(mm[2]);
    const n = alphaStore
      .get()
      .notes.find(
        (x) =>
          (x.title || "").toLowerCase().includes(q) || (x.body || "").toLowerCase().includes(q),
      );
    if (!n) return `I couldn't find a note matching "${q}".`;
    alphaStore.upsertNote({ ...n, title: to, updatedAt: Date.now() });
    return `Renamed note to "${to}".`;
  }
  mm = lower.match(/^mark\s+(?:the\s+)?bill\s+(.+?)\s+(?:as\s+)?paid/);
  if (mm) {
    const q = trim(mm[1]);
    const b = alphaStore.get().bills.find((x) => x.name.toLowerCase().includes(q));
    if (!b) return `I couldn't find a bill matching "${q}".`;
    alphaStore.upsertBill({ ...b, status: "paid", balance: 0 });
    return `Marked bill "${b.name}" as paid.`;
  }

  // Add reminder: "remind me to X at|on|by Y"  /  "set a reminder to X for Y"
  let m = lower.match(
    /(?:remind me to|set (?:a )?reminder(?: to)?|add (?:a )?reminder(?: to)?)\s+(.+?)(?:\s+(?:at|on|by|for)\s+(.+))?$/,
  );
  if (m) {
    const title = trim(m[1]);
    const when = trim(m[2] || "");
    const iso = when ? parseNaturalWhen(when) : "";
    alphaStore.upsertReminder({ id: uid(), title, when: iso || when, notes: "", done: "no" });
    return `Done — reminder added: "${title}"${when ? " at " + when : ""}.`;
  }

  // Add note — broad: "take a note: X", "note that X", "add a note X",
  // "add to (my) notes X", "save (this) to (my) notes X", "save a note X",
  // "jot down X", "write down X", "make a note X", "new note X"
  m = lower.match(
    /(?:take a note(?:[:,])?|note that|add (?:a )?note(?:[:,])?|add (?:this )?to (?:my )?notes(?:[:,])?|save (?:this )?(?:to (?:my )?notes|a note)(?:[:,])?|save note(?:[:,])?|jot (?:this )?down(?:[:,])?|write (?:this )?down(?:[:,])?|make (?:a )?note(?:[:,])?|new note(?:[:,])?)\s+(.+)$/,
  );
  if (m) {
    const body = trim(m[m.length - 1]);
    alphaStore.upsertNote({ id: uid(), title: body.slice(0, 40), body, updatedAt: Date.now() });
    return `Got it — note saved: "${body.slice(0, 60)}".`;
  }

  // Memory: "remember that X" / "save a memory about X" / "store in memory X" / "keep in mind X"
  m = lower.match(
    /(?:remember(?: that)?|save (?:a )?memory(?: about)?|store (?:this )?(?:in (?:my )?memory|to memory)|keep (?:this )?in mind(?:[:,])?|add (?:this )?to (?:my )?memor(?:y|ies)(?:[:,])?)\s+(.+)$/,
  );
  if (m) {
    const detail = trim(m[m.length - 1]);
    alphaStore.upsertMemory({
      id: uid(),
      topic: detail.slice(0, 40),
      detail,
      updatedAt: Date.now(),
    });
    return `Stored to memory: "${detail.slice(0, 60)}".`;
  }

  // Plan: "plan a trip from X to Y on Z" / "add a plan X"
  m = lower.match(
    /(?:plan (?:a )?(?:trip|route|journey)\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+on\s+(.+))?)$/,
  );
  if (m) {
    const from = trim(m[1]);
    const to = trim(m[2]);
    const date = trim(m[3] || "");
    alphaStore.upsertPlan({ id: uid(), title: `${from} → ${to}`, from, to, date, details: "" });
    return `Plan added: ${from} to ${to}${date ? " on " + date : ""}.`;
  }

  // Bill: "add a bill X for $N due Y"
  m = lower.match(/add (?:a )?bill\s+(.+?)\s+(?:for\s+\$?(\d+(?:\.\d+)?))?(?:\s+due\s+(.+))?$/);
  if (m) {
    const name = trim(m[1]);
    const amount = Number(m[2] || 0);
    const dueDate = trim(m[3] || "");
    alphaStore.upsertBill({ id: uid(), name, amount, balance: amount, dueDate, status: "due" });
    return `Bill added: ${name}${amount ? " for $" + amount : ""}.`;
  }

  // Delete latest of a kind: "delete the last note" / "remove last reminder"
  m = lower.match(
    /(?:delete|remove|clear)\s+(?:the\s+)?(?:last|latest|recent)\s+(note|reminder|memory|plan|bill)/,
  );
  if (m) {
    const kind = m[1];
    const s = alphaStore.get();
    const map: Record<string, { list: any[]; del: (id: string) => void }> = {
      note: { list: s.notes, del: alphaStore.deleteNote },
      reminder: { list: s.reminders, del: alphaStore.deleteReminder },
      memory: { list: s.memories, del: alphaStore.deleteMemory },
      plan: { list: s.plans, del: alphaStore.deletePlan },
      bill: { list: s.bills, del: alphaStore.deleteBill },
    };
    const e = map[kind];
    if (e?.list[0]) {
      e.del(e.list[0].id);
      return `Deleted the last ${kind}.`;
    }
    return `No ${kind}s to delete.`;
  }

  // Mark reminder done
  m = lower.match(/(?:mark|set)\s+(?:reminder\s+)?(.+?)\s+(?:as\s+)?done/);
  if (m) {
    const q = trim(m[1]);
    const r = alphaStore.get().reminders.find((x) => x.title.toLowerCase().includes(q));
    if (r) {
      alphaStore.upsertReminder({ ...r, done: "yes" });
      return `Marked "${r.title}" as done.`;
    }
    return `I couldn't find that reminder.`;
  }

  return null;
}

// ---------------------------------------------------------------------------

function listItems(kind: string): string {
  const s = alphaStore.get();
  if (kind === "reminder") {
    if (!s.reminders.length) return "You have no reminders.";
    return (
      "**Reminders:**\n" +
      s.reminders
        .slice(0, 20)
        .map((r) => `• ${r.title}${r.when ? " @ " + r.when : ""}${r.done === "yes" ? " ✅" : ""}`)
        .join("\n")
    );
  }
  if (kind === "note") {
    if (!s.notes.length) return "You have no notes.";
    return (
      "**Notes:**\n" +
      s.notes
        .slice(0, 20)
        .map((n) => `• ${n.title || "(untitled)"}: ${(n.body || "").slice(0, 80)}`)
        .join("\n")
    );
  }
  if (kind === "memory") {
    if (!s.memories.length) return "No memories stored yet.";
    return (
      "**Memories:**\n" +
      s.memories
        .slice(0, 20)
        .map((m) => `• ${m.topic}: ${m.detail}`)
        .join("\n")
    );
  }
  if (kind === "plan") {
    if (!s.plans.length) return "You have no plans.";
    return (
      "**Plans:**\n" +
      s.plans
        .slice(0, 20)
        .map((p) => `• ${p.title} (${p.from} → ${p.to})${p.date ? " on " + p.date : ""}`)
        .join("\n")
    );
  }
  if (kind === "bill") {
    if (!s.bills.length) return "You have no bills.";
    return (
      "**Bills:**\n" +
      s.bills
        .slice(0, 20)
        .map(
          (b) => `• ${b.name}: $${b.balance} (${b.status})${b.dueDate ? " due " + b.dueDate : ""}`,
        )
        .join("\n")
    );
  }
  return `I don't know how to list "${kind}".`;
}

function bulkClear(kind: string): string {
  const s = alphaStore.get();
  let list: { id: string }[] = [];
  let del: (id: string) => void = () => {};
  if (kind === "note") {
    list = s.notes;
    del = alphaStore.deleteNote;
  } else if (kind === "reminder") {
    list = s.reminders;
    del = alphaStore.deleteReminder;
  } else if (kind === "memory") {
    list = s.memories;
    del = alphaStore.deleteMemory;
  } else if (kind === "plan") {
    list = s.plans;
    del = alphaStore.deletePlan;
  } else if (kind === "bill") {
    list = s.bills;
    del = alphaStore.deleteBill;
  } else return `I don't know how to clear "${kind}".`;
  const n = list.length;
  for (const item of [...list]) del(item.id);
  return `Cleared all ${n} ${kind}${n === 1 ? "" : "s"}.`;
}

function deleteFuzzy(kind: string, q: string): string {
  const s = alphaStore.get();
  const lc = q.toLowerCase();
  if (kind === "note") {
    const matches = s.notes.filter(
      (n) =>
        (n.title || "").toLowerCase().includes(lc) || (n.body || "").toLowerCase().includes(lc),
    );
    if (!matches.length) return `No note matching "${q}".`;
    if (matches.length > 1)
      return `Multiple notes match "${q}" — which one? (${matches.map((m) => m.title || m.body.slice(0, 20)).join(", ")})`;
    alphaStore.deleteNote(matches[0].id);
    return `Deleted note "${matches[0].title || matches[0].body.slice(0, 30)}".`;
  }
  if (kind === "reminder") {
    const matches = s.reminders.filter((r) => r.title.toLowerCase().includes(lc));
    if (!matches.length) return `No reminder matching "${q}".`;
    if (matches.length > 1)
      return `Multiple reminders match "${q}" — which? (${matches.map((m) => m.title).join(", ")})`;
    alphaStore.deleteReminder(matches[0].id);
    return `Deleted reminder "${matches[0].title}".`;
  }
  if (kind === "memory") {
    const matches = s.memories.filter(
      (m) => m.topic.toLowerCase().includes(lc) || m.detail.toLowerCase().includes(lc),
    );
    if (!matches.length) return `No memory matching "${q}".`;
    if (matches.length > 1)
      return `Multiple memories match "${q}" — which? (${matches.map((m) => m.topic).join(", ")})`;
    alphaStore.deleteMemory(matches[0].id);
    return `Forgot memory "${matches[0].topic}".`;
  }
  if (kind === "plan") {
    const matches = s.plans.filter((p) => p.title.toLowerCase().includes(lc));
    if (!matches.length) return `No plan matching "${q}".`;
    alphaStore.deletePlan(matches[0].id);
    return `Deleted plan "${matches[0].title}".`;
  }
  if (kind === "bill") {
    const matches = s.bills.filter((b) => b.name.toLowerCase().includes(lc));
    if (!matches.length) return `No bill matching "${q}".`;
    alphaStore.deleteBill(matches[0].id);
    return `Deleted bill "${matches[0].name}".`;
  }
  return `I don't know how to delete "${kind}".`;
}

/**
 * Very small natural-language date parser for reminder shortcuts.
 * Supports: "in 5 minutes", "in 2 hours", "tomorrow 8am", "8pm", "at 15:30".
 * Returns an ISO string or empty on failure.
 */
function parseNaturalWhen(raw: string): string {
  const s = raw.trim().toLowerCase();
  const now = new Date();

  let m = s.match(/^in\s+(\d+)\s*(second|minute|min|hour|hr|day)s?$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = /second/.test(unit)
      ? n * 1000
      : /min/.test(unit)
        ? n * 60000
        : /hour|hr/.test(unit)
          ? n * 3600000
          : n * 86400000;
    return new Date(now.getTime() + ms).toISOString();
  }

  // "8pm", "8:30 am"
  m = s.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (m) {
    let h = Number(m[1]);
    const mm = Number(m[2] || 0);
    const ampm = m[3];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, mm, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  // "tomorrow 8am"
  m = s.match(/^tomorrow(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (m) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    let h = m[1] ? Number(m[1]) : 9;
    const mm = Number(m[2] || 0);
    const ampm = m[3];
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    d.setHours(h, mm, 0, 0);
    return d.toISOString();
  }

  // Try native Date.parse as a fallback
  const t = Date.parse(raw);
  if (!isNaN(t)) return new Date(t).toISOString();

  return "";
}

function trim(s: string) {
  return s.replace(/[.!?]+$/, "").trim();
}
