import { describe, expect, it } from "vitest";
import { rankResults } from "../src/lib/research-ranking";

describe("Web Search Result Ranking", () => {
  it("ranks news articles higher than index pages", () => {
    const results = [
      { title: "Dashboard", url: "http://site.com/dashboard", source: "Site" },
      { title: "Breaking News: Harare Poly", url: "http://site.com/news/breaking", source: "Site" },
      { title: "Category Index", url: "http://site.com/category/index", source: "Site" },
    ];
    
    const ranked = rankResults(results, "Harare Poly");
    
    // Breaking News should be first
    expect(ranked[0].url).toContain("/news/");
    // Dashboard and Category should be last
    expect(ranked[ranked.length - 1].url).not.toContain("/news/");
  });
});
