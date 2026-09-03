import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal browser shims so the localStorage-backed store can load in Node.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};
(globalThis as any).window = globalThis;
(globalThis as any).window.dispatchEvent = () => true;
(globalThis as any).window.addEventListener = () => {};

const { alphaStore } = await import("../src/lib/alpha-store");
const { executeActionTags, renderActionReport, claimsMutationWithoutTag } = await import("../src/lib/actions");

function reset() {
  for (const n of alphaStore.get().notes) alphaStore.deleteNote(n.id);
  for (const r of alphaStore.get().reminders) alphaStore.deleteReminder(r.id);
}

beforeEach(reset);

describe("executeActionTags", () => {
  it("adds a note with the full body preserved and verifies it", () => {
    const long = "x".repeat(400);
    const { text, results } = executeActionTags(`Saving now. [[ADD_NOTE: Shopping list | ${long}]]`);
    expect(text).not.toContain("ADD_NOTE");
    expect(results[0].status).toBe("success");
    const note = alphaStore.get().notes.find(n => n.title === "Shopping list");
    expect(note?.body).toBe(long);
  });

  it("reports not_found instead of claiming a delete happened", () => {
    const { results } = executeActionTags("[[DELETE_NOTE: nonexistent thing]]");
    expect(results[0].status).toBe("not_found");
    expect(renderActionReport(results)).toMatch(/couldn't|not/i);
  });

  it("refuses ambiguous deletes and changes nothing", () => {
    executeActionTags("[[ADD_NOTE: gym plan | a]]");
    executeActionTags("[[ADD_NOTE: gym gear | b]]");
    const before = alphaStore.get().notes.length;
    const { results } = executeActionTags("[[DELETE_NOTE: gym]]");
    expect(results[0].status).toBe("ambiguous");
    expect(alphaStore.get().notes.length).toBe(before);
  });

  it("updates a reminder time without recreating it", () => {
    executeActionTags("[[ADD_REMINDER: call mom | tomorrow at 9am | ring twice]]");
    const created = alphaStore.get().reminders.find(r => r.title === "call mom")!;
    const { results } = executeActionTags("[[UPDATE_REMINDER: call mom | when=in 30 minutes]]");
    expect(results[0].status).toBe("success");
    const after = alphaStore.get().reminders.find(r => r.title === "call mom")!;
    expect(after.id).toBe(created.id);
    expect(after.notes).toBe("ring twice");
    expect(Date.parse(after.when)).toBeGreaterThan(Date.now());
  });

  it("keeps an unparseable reminder time as text and says it isn't scheduled", () => {
    const { results } = executeActionTags("[[ADD_REMINDER: someday thing | whenever I get round to it]]");
    expect(results[0].status).toBe("success");
    expect(renderActionReport(results).toLowerCase()).toContain("not scheduled");
  });

  it("flags unknown tags as invalid rather than succeeding silently", () => {
    const { results } = executeActionTags("[[TELEPORT_ME: mars]]");
    expect(results[0].status).toBe("invalid");
  });
});

describe("claimsMutationWithoutTag", () => {
  it("catches prose that claims a save with no tag", () => {
    expect(claimsMutationWithoutTag("Done — I've saved that note for you.")).toBe(true);
  });
  it("ignores ordinary prose", () => {
    expect(claimsMutationWithoutTag("Here's how photosynthesis works.")).toBe(false);
  });
});

describe("store chat mutations", () => {
  it("deletes a message and reports whether it existed", () => {
    alphaStore.appendChat({ id: "m1", role: "user", text: "hi", ts: Date.now() });
    expect(alphaStore.deleteChatMessage("m1")).toBe(true);
    expect(alphaStore.deleteChatMessage("m1")).toBe(false);
  });

  it("prepareRetry truncates back to the user turn", () => {
    alphaStore.clearChat();
    alphaStore.appendChat({ id: "u1", role: "user", text: "question", ts: Date.now() });
    alphaStore.appendChat({ id: "a1", role: "model", text: "bad answer", ts: Date.now() });
    const r = alphaStore.prepareRetry("a1");
    expect(r?.userText).toBe("question");
    expect(alphaStore.get().chat.map(m => m.id)).toEqual(["u1"]);
  });
});

vi.restoreAllMocks();
