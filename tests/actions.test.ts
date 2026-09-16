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
const { executeActionTags, executeActionTagsAsync, renderActionReport, claimsMutationWithoutTag } = await import("../src/lib/actions");
const { InMemoryReminderRepository } = await import("../src/lib/reminder-repo");

function reset() {
  for (const n of alphaStore.get().notes) alphaStore.deleteNote(n.id);
}

beforeEach(reset);

describe("executeActionTags and executeActionTagsAsync", () => {
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
    expect(results[0].status).not.toBe("success");
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

  it("adds and updates a reminder through canonical InMemoryReminderRepository without mutating localStorage", async () => {
    const repo = new InMemoryReminderRepository();
    const userId = "user-1";

    const { results: r1 } = await executeActionTagsAsync(
      "[[ADD_REMINDER: call mom | tomorrow at 9am | ring twice]]",
      { userId, repo }
    );
    expect(r1[0].status).toBe("success");
    const list1 = await repo.listReminders(userId);
    expect(list1).toHaveLength(1);
    expect(list1[0].title).toBe("call mom");
    expect(list1[0].notes).toBe("ring twice");
    expect(alphaStore.get().reminders).toHaveLength(0); // No dual authority in localStorage

    const { results: r2 } = await executeActionTagsAsync(
      "[[UPDATE_REMINDER: call mom | when=in 30 minutes]]",
      { userId, repo }
    );
    expect(r2[0].status).toBe("success");
    const list2 = await repo.listReminders(userId);
    expect(list2[0].id).toBe(list1[0].id);
    expect(list2[0].dueAt).toBeGreaterThan(Date.now());
  });

  it("keeps an unparseable reminder time as text and says it isn't scheduled", async () => {
    const repo = new InMemoryReminderRepository();
    const userId = "user-1";
    const { results } = await executeActionTagsAsync(
      "[[ADD_REMINDER: someday thing | whenever I get round to it]]",
      { userId, repo }
    );
    expect(results[0].status).toBe("success");
    expect(renderActionReport(results).toLowerCase()).toContain("no alarm is scheduled");
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

vi.restoreAllMocks();
