import { describe, expect, it } from "vitest";
import { BoundedResearchService } from "../src/lib/research";
import { SearchProvider, SearchResult } from "../src/lib/web-search";

class MockProvider implements SearchProvider {
  async search(query: string, limit = 5): Promise<SearchResult[]> {
    return [
      { title: "Landing Page", url: "https://site.com/", snippet: "Home", source: "D" },
    ];
  }
  async readPage(url: string): Promise<{ title: string; content: string; status: string }> {
    if (url === "https://site.com/") {
      return { title: "Home", content: "Go to [News 1](/news/art1), [News 2](/news/art2), [News 3](/news/art3), and [Home](https://site.com/)", status: "success" };
    }
    if (url.includes("/news/")) {
      return { title: "Article", content: "Valid article content", status: "success" };
    }
    return { title: "", content: "", status: "failed" };
  }
}

describe("Adaptive Traversal", () => {
  it("traverses articles and rejects homepages", async () => {
    const provider = new MockProvider();
    const service = new BoundedResearchService(provider);
    const research = await service.research("query");

    // Should fetch the article links and NOT the home link
    expect(research.evidence.length).toBe(3);
    expect(research.evidence[0].url).toContain("/news/");
    expect(research.evidence[1].url).toContain("/news/");
    expect(research.evidence[2].url).toContain("/news/");
    expect(research.evidence[0].url).not.toBe("https://site.com/");
  });
});
