import { describe, expect, it } from "vitest";
import { scoreCandidateLink } from "../src/lib/research-ranking";

describe("Link Scoring", () => {
  const query = "AI trends 2026";

  it("scores article-like links positively", () => {
    const url = "https://example.com/article/ai-trends";
    const score = scoreCandidateLink(url, query);
    expect(score).toBeGreaterThan(0);
  });

  it("scores documentation links positively", () => {
    const url = "https://example.com/docs/api-reference";
    const score = scoreCandidateLink(url, query);
    expect(score).toBeGreaterThan(0);
  });

  it("scores homepages negatively", () => {
    const url = "https://example.com/";
    const score = scoreCandidateLink(url, query);
    expect(score).toBeLessThan(0);
  });

  it("scores login pages negatively", () => {
    const url = "https://example.com/login";
    const score = scoreCandidateLink(url, query);
    expect(score).toBeLessThan(0);
  });
});
