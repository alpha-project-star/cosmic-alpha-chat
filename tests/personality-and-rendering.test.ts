import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_SYSTEM, appendSourcesIfWeb } from "../src/lib/alpha.functions";
import { claimsMutationWithoutTag, executeActionTags, NO_ACTION_NOTICE } from "../src/lib/actions";
import { alphaStore, uid } from "../src/lib/alpha-store";
import { normalizeForSpeech } from "../src/lib/speech-text";

describe("Alpha Core Personality & Prompt Standards", () => {
  const prompt = DEFAULT_SYSTEM("", "", "", { offline: false });

  it("contains strict professional personality directives", () => {
    expect(prompt).toContain("Calm, composed, intelligent, and professional");
    expect(prompt).toContain("Warm and human-readable without pretending to be human");
    expect(prompt).toContain("comfortable saying \"I don't know\", \"I'm not certain\", or \"I need to verify that\"");
    expect(prompt).toContain("Never repeat the user's entire question before answering");
    expect(prompt).toContain("Never add generic disclaimers to ordinary responses");
  });

  it("enforces advanced reasoning and structured troubleshooting", () => {
    expect(prompt).toContain("ADVANCED-REASONING BEHAVIOUR");
    expect(prompt).toContain("The key issue is…");
    expect(prompt).toContain("RESPONSE STRATEGY");
    expect(prompt).toContain("For troubleshooting:");
    expect(prompt).toContain("1. What is probably happening");
    expect(prompt).toContain("6. What to do if it fails");
  });

  it("mandates truthfulness and distinguishes evidence classes", () => {
    expect(prompt).toContain("TRUTHFULNESS & EVIDENCE DISCIPLINE");
    expect(prompt).toContain("EVIDENCE: live-search");
    expect(prompt).toContain("EVIDENCE: none");
    expect(prompt).toContain("existing model knowledge");
    expect(prompt).toContain("retrieved live information");
    expect(prompt).toContain("Never present an inference or guess as a verified fact");
  });

  it("defines strict markdown table and typography constraints", () => {
    expect(prompt).toContain("Use a Markdown table ONLY for structured comparisons");
    expect(prompt).toContain("Keep cells concise so tables remain readable on mobile");
    expect(prompt).toContain("State the conclusion in one sentence after the table");
  });
});

describe("Evidence Discipline & Source Isolation", () => {
  it("scrubs hallucinated Sources section when no live evidence exists", () => {
    const fakeModelReply =
      "Quantum computing uses qubits.\n\n**Sources:**\n[1] [Fake Quantum Article](https://fakequantum.org)\n[2] [Imaginary Tech](https://example.com/fake)";
    const cleaned = appendSourcesIfWeb(fakeModelReply, "");
    expect(cleaned).not.toContain("**Sources:**");
    expect(cleaned).not.toContain("https://fakequantum.org");
    expect(cleaned).toBe("Quantum computing uses qubits.");
  });

  it("attaches real verified Sources section when live search evidence exists", () => {
    const rawReply = "NASA announced a new Artemis milestone today [1].";
    const liveEvidence =
      "LIVE WEB SEARCH RESULTS — fetched today for query: 'artemis news'\n[1] Artemis Updates\nURL: https://nasa.gov/artemis\nSource: NASA\nSnippet: Launch date confirmed.";

    const result = appendSourcesIfWeb(rawReply, liveEvidence);
    expect(result).toContain("**Sources:**");
    expect(result).toContain("[1] [Artemis Updates](https://nasa.gov/artemis)");
  });
});

describe("Action Honesty & State Verification", () => {
  beforeEach(() => {
    alphaStore.replaceAll({
      notes: [],
      reminders: [],
      bills: [],
      plans: [],
      memories: [],
      chat: [],
      profile: { name: "Alex", bio: "" },
    });
  });

  it("catches optimistic prose without an action tag", () => {
    expect(claimsMutationWithoutTag("I have added the note to your ledger.")).toBe(true);
    expect(claimsMutationWithoutTag("I've saved that reminder for tomorrow.")).toBe(true);
    expect(claimsMutationWithoutTag("Here is what you need to know about Mars.")).toBe(false);
  });

  it("verifies note addition and confirms storage mutation", () => {
    const raw = "I'll create that note for you.\n[[ADD_NOTE: Project Specs | Review system architecture]]";
    const { text, results } = executeActionTags(raw);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("success");
    expect(results[0].tag).toBe("ADD_NOTE");
    expect(text).toBe("I'll create that note for you.");

    const notes = alphaStore.get().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Project Specs");
    expect(notes[0].body).toBe("Review system architecture");
  });

  it("returns ambiguous when updating with non-unique keyword", () => {
    alphaStore.upsertNote({ id: uid(), title: "Meeting Alice", body: "1", updatedAt: Date.now() });
    alphaStore.upsertNote({ id: uid(), title: "Meeting Bob", body: "2", updatedAt: Date.now() });

    const raw = "Updating note.\n[[UPDATE_NOTE: Meeting | Team sync | All]]";
    const { results } = executeActionTags(raw);

    expect(results[0].status).toBe("ambiguous");
    expect(results[0].message).toContain("match");
  });

  it("reports not_found when target does not exist", () => {
    const raw = "Deleting.\n[[DELETE_NOTE: Nonexistent Topic]]";
    const { results } = executeActionTags(raw);

    expect(results[0].status).toBe("not_found");
  });

  it("rejects unknown action tags as invalid", () => {
    const raw = "Doing something.\n[[DESTROY_DATABASE: all]]";
    const { results } = executeActionTags(raw);

    expect(results[0].status).toBe("invalid");
  });
});

describe("Speech Synthesis Voice Naturalization", () => {
  it("converts tables into natural conversational sentences", () => {
    const tableMd = `
| Processor | Cores | Frequency |
| :--- | :--- | :--- |
| M3 Max | 16 | 4.05 GHz |
| Ultra | 24 | 3.8 GHz |
`;
    const spoken = normalizeForSpeech(tableMd);
    expect(spoken).not.toContain("|");
    expect(spoken).toContain("Processor: M3 Max");
    expect(spoken).toContain("Cores: 16");
    expect(spoken).toContain("Processor: Ultra");
  });

  it("handles tables with dashes, symbols, and empty cells", () => {
    const tableMd = `
| Metric | Q1 | Q2 |
| --- | --- | --- |
| Revenue | $500 | - |
| Growth | 15% | 20% |
`;
    const spoken = normalizeForSpeech(tableMd);
    expect(spoken).not.toContain("|");
    expect(spoken).toContain("Metric: Revenue, Q1: 500 dollars");
    expect(spoken).toContain("15 percent");
  });

  it("converts complex LaTeX to spoken english", () => {
    const math = "The formula is $$\\sqrt{a^2 + b^2}$$ and $$\\frac{\\alpha}{\\beta}$$.";
    const spoken = normalizeForSpeech(math);
    expect(spoken).toContain("square root of");
    expect(spoken).toContain("alpha");
    expect(spoken).toContain("over");
    expect(spoken).toContain("beta");
    expect(spoken).not.toContain("\\sqrt");
    expect(spoken).not.toContain("\\frac");
  });

  it("summarizes multi-row tables for natural speech length", () => {
    const longTable = `
| A | B |
|---|---|
| 1 | One |
| 2 | Two |
| 3 | Three |
| 4 | Four |
| 5 | Five |
| 6 | Six |
| 7 | Seven |
`;
    const spoken = normalizeForSpeech(longTable);
    expect(spoken).toContain("more rows in the table");
  });
});
