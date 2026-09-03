import { describe, expect, it } from "vitest";
import { normalizeForSpeech } from "../src/lib/speech-text";

describe("normalizeForSpeech", () => {
  it("strips markdown syntax but keeps words", () => {
    const out = normalizeForSpeech("## Plan\n\n- **Buy milk**\n- *call mom*");
    expect(out).not.toMatch(/[#*]/);
    expect(out).toContain("Buy milk");
    expect(out).toContain("call mom");
  });

  it("never speaks action tags", () => {
    expect(normalizeForSpeech("Saved. [[ADD_NOTE: a | b]]")).not.toContain("ADD_NOTE");
  });

  it("never reads URLs aloud", () => {
    const out = normalizeForSpeech("See https://example.com/x?y=1 for more");
    expect(out).not.toContain("http");
    expect(out).toContain("for more");
  });

  it("drops the Sources footer", () => {
    const out = normalizeForSpeech("Answer.\n\n**Sources:**\n1. Thing — https://a.com");
    expect(out.toLowerCase()).not.toContain("sources");
  });

  it("speaks math instead of symbols", () => {
    const out = normalizeForSpeech("The area is $$\\frac{1}{2}bh$$.");
    expect(out).toContain("over");
    expect(out).not.toContain("\\frac");
  });

  it("keeps money readable and preserves negatives", () => {
    expect(normalizeForSpeech("It costs $20.")).toContain("20 dollars");
    expect(normalizeForSpeech("Down -5 today")).toContain("minus 5");
  });

  it("speaks percentages and multiplication signs", () => {
    expect(normalizeForSpeech("Up 12% and 3 × 4")).toContain("12 percent");
    expect(normalizeForSpeech("3 × 4")).toContain("times");
  });

  it("reads tables row by row", () => {
    const out = normalizeForSpeech("| Item | Cost |\n| --- | --- |\n| Milk | 20 |");
    expect(out).toContain("Item: Milk");
    expect(out).toContain("Cost: 20");
    expect(out).not.toContain("|");
  });

  it("summarises code blocks rather than spelling them", () => {
    const out = normalizeForSpeech("Try:\n```js\nconst a = 1;\n```");
    expect(out).toContain("code block");
    expect(out).not.toContain("const a");
  });

  it("removes emoji", () => {
    expect(normalizeForSpeech("Done ✅ 🎉")).toBe("Done");
  });
});
