import { describe, expect, it, vi } from "vitest";
import { BoundedResearchService } from "../src/lib/research";
import { SearchProvider } from "../src/lib/web-search";

describe("BoundedResearchService Integration", () => {
  it("extracts relevant content located after 500 characters", async () => {
    // 1. Setup Fixture
    const intro = "a".repeat(1200);
    const criticalStatement = "The application deadline is 30 November 2026. Applications are currently open.";
    const unrelated = "b".repeat(500);
    const fixtureContent = `# Official Page\n\n${intro}\n\n${criticalStatement}\n\n${unrelated}\n\n- List Item 1\n- List Item 2`;
    
    // 2. Mock Provider
    const mockProvider: SearchProvider = {
      search: vi.fn().mockResolvedValue([{ title: "Harare Page", url: "http://example.com", snippet: "snippet", source: "DuckDuckGo" }]),
      readPage: vi.fn().mockResolvedValue({ title: "Harare Page", content: fixtureContent, status: "success" })
    };

    // 3. Execution
    const service = new BoundedResearchService(mockProvider);
    const result = await service.research("application status");

    // 4. Assertions
    expect(result.evidence.length).toBe(1);
    expect(result.evidence[0].excerpt).toContain(criticalStatement);
    // Should be longer than the old 500-char limit
    expect(result.evidence[0].excerpt.length).toBeGreaterThan(500);
    expect(result.evidence[0].excerpt.length).toBeLessThan(4000);
  });
});
