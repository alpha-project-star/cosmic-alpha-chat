import { alphaStore, uid } from "./alpha-store";

/**
 * Lightweight on-device intent parser for CRUD commands so Alpha can actually
 * perform operations (add reminder, add note, save memory, delete X) without
 * hitting the LLM. Returns a spoken confirmation string, or null if no match.
 */
export function tryLocalIntent(raw: string): string | null {
  const t = raw.trim();
  const lower = t.toLowerCase();

  // Add reminder: "remind me to X at|on|by Y"  /  "set a reminder to X for Y"
  let m = lower.match(/(?:remind me to|set (?:a )?reminder(?: to)?|add (?:a )?reminder(?: to)?)\s+(.+?)(?:\s+(?:at|on|by|for)\s+(.+))?$/);
  if (m) {
    const title = trim(m[1]); const when = trim(m[2] || "");
    alphaStore.upsertReminder({ id: uid(), title, when, notes: "", done: "no" });
    return `Done — reminder added: "${title}"${when ? " at " + when : ""}.`;
  }

  // Add note — broad: "take a note: X", "note that X", "add a note X",
  // "add to (my) notes X", "save (this) to (my) notes X", "save a note X",
  // "jot down X", "write down X", "make a note X", "new note X"
  m = lower.match(/(?:take a note(?:[:,])?|note that|add (?:a )?note(?:[:,])?|add (?:this )?to (?:my )?notes(?:[:,])?|save (?:this )?(?:to (?:my )?notes|a note)(?:[:,])?|save note(?:[:,])?|jot (?:this )?down(?:[:,])?|write (?:this )?down(?:[:,])?|make (?:a )?note(?:[:,])?|new note(?:[:,])?)\s+(.+)$/);
  if (m) {
    const body = trim(m[m.length - 1]);
    alphaStore.upsertNote({ id: uid(), title: body.slice(0, 40), body, updatedAt: Date.now() });
    return `Got it — note saved: "${body.slice(0, 60)}".`;
  }

  // Memory: "remember that X" / "save a memory about X" / "store in memory X" / "keep in mind X"
  m = lower.match(/(?:remember(?: that)?|save (?:a )?memory(?: about)?|store (?:this )?(?:in (?:my )?memory|to memory)|keep (?:this )?in mind(?:[:,])?|add (?:this )?to (?:my )?memor(?:y|ies)(?:[:,])?)\s+(.+)$/);
  if (m) {
    const detail = trim(m[m.length - 1]);
    alphaStore.upsertMemory({ id: uid(), topic: detail.slice(0, 40), detail, updatedAt: Date.now() });
    return `Stored to memory: "${detail.slice(0, 60)}".`;
  }

  // Plan: "plan a trip from X to Y on Z" / "add a plan X"
  m = lower.match(/(?:plan (?:a )?(?:trip|route|journey)\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+on\s+(.+))?)$/);
  if (m) {
    const from = trim(m[1]); const to = trim(m[2]); const date = trim(m[3] || "");
    alphaStore.upsertPlan({ id: uid(), title: `${from} → ${to}`, from, to, date, details: "" });
    return `Plan added: ${from} to ${to}${date ? " on " + date : ""}.`;
  }

  // Bill: "add a bill X for $N due Y"
  m = lower.match(/add (?:a )?bill\s+(.+?)\s+(?:for\s+\$?(\d+(?:\.\d+)?))?(?:\s+due\s+(.+))?$/);
  if (m) {
    const name = trim(m[1]); const amount = Number(m[2] || 0); const dueDate = trim(m[3] || "");
    alphaStore.upsertBill({ id: uid(), name, amount, balance: amount, dueDate, status: "due" });
    return `Bill added: ${name}${amount ? " for $" + amount : ""}.`;
  }

  // Delete latest of a kind: "delete the last note" / "remove last reminder"
  m = lower.match(/(?:delete|remove|clear)\s+(?:the\s+)?(?:last|latest|recent)\s+(note|reminder|memory|plan|bill)/);
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
    const e = map[kind]; if (e?.list[0]) { e.del(e.list[0].id); return `Deleted the last ${kind}.`; }
    return `No ${kind}s to delete.`;
  }

  // Mark reminder done
  m = lower.match(/(?:mark|set)\s+(?:reminder\s+)?(.+?)\s+(?:as\s+)?done/);
  if (m) {
    const q = trim(m[1]);
    const r = alphaStore.get().reminders.find(x => x.title.toLowerCase().includes(q));
    if (r) { alphaStore.upsertReminder({ ...r, done: "yes" }); return `Marked "${r.title}" as done.`; }
    return `I couldn't find that reminder.`;
  }

  return null;
}

function trim(s: string) {
  return s.replace(/[.!?]+$/, "").trim();
}