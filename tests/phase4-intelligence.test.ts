import { describe, it, expect, beforeEach } from "vitest";
import { rerankContext, sendChat } from "../src/lib/alpha.functions";
import { tryLocalIntent } from "../src/lib/local-intents";
import { alphaStore, conversationSummary } from "../src/lib/alpha-store";

const storage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  };
}

describe("Phase 4 Intelligence Core Forensic Verification", () => {
  beforeEach(() => {
    alphaStore.clearChat();
    alphaStore.replaceAll({
      notes: [],
      bills: [],
      tasks: [],
      memories: [],
      reminders: [],
    });
  });

  describe("M-01/M-05: Exact token relevance & non-contamination", () => {
    it("does not match substring coincidences like 'car' in 'particular'", () => {
      alphaStore.upsertMemory({
        id: "m1",
        topic: "particulars",
        detail: "This is a particular item",
        updatedAt: Date.now(),
      });
      const res = rerankContext("car");
      expect(res).not.toContain("particulars");
    });

    it("matches exact token 'car'", () => {
      alphaStore.upsertMemory({
        id: "m2",
        topic: "car",
        detail: "Alex owns a blue car",
        updatedAt: Date.now(),
      });
      const res = rerankContext("car");
      expect(res).toContain("Alex owns a blue car");
    });
  });

  describe("I-03: Ambiguity handling in local intents", () => {
    it("returns an ambiguity prompt when multiple tasks match", async () => {
      alphaStore.upsertTask({
        id: "p1",
        title: "Vacation Paris",
        from: "NYC",
        to: "Paris",
        date: "2026-06-01",
        details: "",
      });
      alphaStore.upsertTask({
        id: "p2",
        title: "Vacation Tokyo",
        from: "NYC",
        to: "Tokyo",
        date: "2026-07-01",
        details: "",
      });

      const res = await tryLocalIntent("delete task Vacation");
      expect(res).toContain("Multiple tasks match");
      expect(res).toContain("Vacation Paris");
      expect(res).toContain("Vacation Tokyo");
      expect(alphaStore.get().tasks.length).toBe(2);
    });

    it("returns an ambiguity prompt when multiple bills match", async () => {
      alphaStore.upsertBill({
        id: "b1",
        name: "Electric Bill House",
        amount: 100,
        balance: 100,
        dueDate: "2026-04-01",
        status: "due",
      });
      alphaStore.upsertBill({
        id: "b2",
        name: "Electric Bill Cabin",
        amount: 50,
        balance: 50,
        dueDate: "2026-04-05",
        status: "due",
      });

      const res = await tryLocalIntent("delete bill Electric");
      expect(res).toContain("Multiple bills match");
      expect(res).toContain("Electric Bill House");
      expect(res).toContain("Electric Bill Cabin");
      expect(alphaStore.get().bills.length).toBe(2);
    });
  });

  describe("C-02/C-03: Summary & Chat Reset", () => {
    it("clears summary on clearChat", () => {
      conversationSummary.set("Summary test");
      expect(conversationSummary.get()).toBe("Summary test");

      alphaStore.clearChat();
      expect(conversationSummary.get()).toBe("");
    });
  });

  describe("R-04: Cancellation Signal Propagation", () => {
    it("propagates cancellation immediately without retrying or fallback", async () => {
      const controller = new AbortController();
      controller.abort();

      const history = [
        { id: "1", role: "user" as const, text: "Hello", ts: Date.now() },
      ];

      await expect(sendChat(history, { signal: controller.signal })).rejects.toThrow();
    });
  });
});
