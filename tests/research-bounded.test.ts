import { describe, expect, it } from "vitest";
import { extractRelevantEvidence } from "../src/lib/research-utils";

describe("Bounded Intelligent Evidence Extraction", () => {
  it("keeps content within budget", () => {
    const content = "a".repeat(10000);
    const result = extractRelevantEvidence(content, "test", 4000);
    expect(result.length).toBeLessThanOrEqual(4000);
  });

  it("extracts relevant content later in the page", () => {
    const content = "Intro text.\n\n" + "a".repeat(1000) + "\n\nRelevant info about test query.";
    const result = extractRelevantEvidence(content, "test query", 4000);
    expect(result).toContain("Relevant info about test query.");
  });

  it("handles headings and lists", () => {
    const content = "# Heading\n\n- List item 1\n- List item 2\n\nNormal paragraph.";
    const result = extractRelevantEvidence(content, "list", 4000);
    expect(result).toContain("# Heading");
    expect(result).toContain("- List item 1");
  });

  it("returns nothing relevant if no match", () => {
    const content = "Irrelevant intro.\n\nIrrelevant paragraph.";
    const result = extractRelevantEvidence(content, "relevant query", 4000);
    // Should contain at least the intro
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Irrelevant intro");
    expect(result).not.toContain("relevant query");
  });
});
