import { describe, expect, it } from "vitest";
import {
  decideSearch,
  isCapabilityInquiry,
  isExplicitSearchRequest,
  mayBenefitFromSearch,
  stripSearchPreamble,
  SEARCH_CAPABILITY_HINT,
  SearchProvider,
} from "../src/lib/web-search";
import {
  appendSourcesIfWeb,
  DEFAULT_SYSTEM,
  fetchLiveWebContext,
} from "../src/lib/alpha.functions";
import { BoundedResearchService } from "../src/lib/research";

describe("Web Search Routing & Capability Awareness", () => {
  it("detects user questions inquiring about search capability", () => {
    expect(isCapabilityInquiry("hey, does alpha have a real accurate web searching ability and tool")).toBe(true);
    expect(isCapabilityInquiry("do you have a web search tool?")).toBe(true);
    expect(isCapabilityInquiry("can you search the web?")).toBe(true);
    expect(isCapabilityInquiry("does alpha have internet access?")).toBe(true);
    expect(isCapabilityInquiry("are you able to search online?")).toBe(true);
  });

  it("distinguishes capability questions from actual searches with a topic", () => {
    expect(isCapabilityInquiry("can you search the web for quantum computers?")).toBe(false);
    expect(isCapabilityInquiry("search for SpaceX latest news")).toBe(false);
    expect(isCapabilityInquiry("look up weather in Paris online")).toBe(false);
  });

  it("routes capability questions to capabilityInquiry decision", () => {
    const decision = decideSearch("hey, does alpha have a real accurate web searching ability and tool");
    expect(decision.search).toBe(false);
    expect("capabilityInquiry" in decision && decision.capabilityInquiry).toBe(true);
  });

  it("routes explicit search commands to search: true with cleaned query", () => {
    const d1 = decideSearch("can you search the web for SpaceX starship news?");
    expect(d1.search).toBe(true);
    if (d1.search) {
      expect(d1.reason).toBe("explicit");
      expect(d1.query.toLowerCase()).toContain("spacex");
    }

    const d2 = decideSearch("search for the latest James Webb discoveries");
    expect(d2.search).toBe(true);
    if (d2.search) {
      expect(d2.reason).toBe("explicit");
      expect(d2.query.toLowerCase()).toContain("james webb");
    }

    const d3 = decideSearch("look up current price of gold online");
    expect(d3.search).toBe(true);
    if (d3.search) {
      expect(d3.reason).toBe("explicit");
      expect(d3.query.toLowerCase()).toContain("gold");
    }
  });

  it("automatically routes time-sensitive / live factual queries to search: true", () => {
    const d1 = decideSearch("what is the latest news today?");
    expect(d1.search).toBe(true);
    if (d1.search) {
      expect(d1.reason).toBe("auto");
    }

    const d2 = decideSearch("current stock price of Nvidia");
    expect(d2.search).toBe(true);
    if (d2.search) {
      expect(d2.reason).toBe("auto");
    }
  });

  it("leaves standard conversational and coding prompts unsearched", () => {
    const d1 = decideSearch("How do I implement binary search in TypeScript?");
    expect(d1.search).toBe(false);

    const d2 = decideSearch("Good morning Alpha, how are you today?");
    expect(d2.search).toBe(false);
  });

  it("correctly strips conversational preambles into clean search queries", () => {
    expect(stripSearchPreamble("hey alpha, can you please search the web for SpaceX flight 6?"))
      .toBe("SpaceX flight 6");
    expect(stripSearchPreamble("google current price of Bitcoin for me"))
      .toBe("current price of Bitcoin");
    expect(stripSearchPreamble("look up weather in Rome online"))
      .toBe("weather in Rome");
  });
});

class MockProvider implements SearchProvider {
  async search(query: string) {
    return [{ title: "Mock", url: "https://mock.com", snippet: "Snippet", source: "Mock" }];
  }
  async readPage(url: string) {
    return { title: "Mock Page", content: "Content", status: "success" };
  }
}

describe("WebToolReceipt and BoundedResearchService", () => {
  it("returns a structured WebToolReceipt with search metadata", async () => {
    const service = new BoundedResearchService(new MockProvider());
    const result = await service.research("test query");
    
    expect(result.receipt).toBeDefined();
    expect(result.receipt.toolSelected).toBe(true);
    expect(result.receipt.querySent).toBe("test query");
    expect(result.receipt.status).toBe("usable");
    expect(result.receipt.resultCount).toBeGreaterThan(0);
  });
});

describe("System Prompt Self-Awareness of Search Engine", () => {
  const prompt = DEFAULT_SYSTEM("", "", "", { offline: false });

  it("explicitly includes the Live Web Search Tool in Alpha's declared toolkit", () => {
    expect(prompt).toContain("Live Web Search Tool");
    expect(prompt).toContain("DuckDuckGo");
    expect(prompt).toContain("real live web search tool wired into your");
  });

  it("clarifies that EVIDENCE: none does not mean lacking search capability", () => {
    expect(prompt).toContain("EVIDENCE: none");
    expect(prompt).toContain("It does NOT mean you lack the web search tool");
    expect(prompt).toContain("DO have an active live web search tool");
  });

  it("contains strict citation traceability and support verification rules", () => {
    expect(prompt).toContain("CITATION TRACEABILITY");
    expect(prompt).toContain("VERIFY SUPPORT BEFORE CITING");
    expect(prompt).toContain("BAN IRRELEVANT / GENERAL LINKS AS SUPPORTING SOURCES");
    expect(prompt).toContain("INSUFFICIENT EVIDENCE DISCIPLINE");
    expect(prompt).toContain("STRICT SOURCES SECTION RULE");
    expect(prompt).toContain("NO \"**Sources:**\" section should appear unless there are actual retrieved sources directly supporting specific claims");
  });
});

describe("Citation Traceability & Source Discipline Post-Processing", () => {

  const mockWebContext = [
    "[1] US strikes Iranian oil tankers - Reuters",
    "URL: https://reuters.com/news/article1",
    "Publisher/Source: Reuters",
    "[2] Global News Homepage",
    "URL: https://cnn.com/",
    "Publisher/Source: CNN",
    "[3] Envoys in Moscow for Ukraine talks - BBC",
    "URL: https://bbc.com/news/article3",
    "Publisher/Source: BBC",
  ].join("\n");

  it("omits Sources section completely when no claims are cited in text", () => {
    const text = "I checked the web, but I am summarizing from memory.";
    const result = appendSourcesIfWeb(text, mockWebContext);
    expect(result).not.toContain("**Sources:**");
    expect(result).toBe(text);
  });

  it("strips hallucinated Sources section when no claims were cited in body", () => {
    const text = "Here is some general talk.\n\n**Sources:**\n- [1] [CNN](https://cnn.com)\n- [2] [BBC](https://bbc.com)";
    const result = appendSourcesIfWeb(text, mockWebContext);
    expect(result).not.toContain("**Sources:**");
    expect(result).toBe("Here is some general talk.");
  });

  it("omits Sources section when assistant acknowledges insufficient evidence", () => {
    const text =
      "I attempted a live search, but the results mostly returned general news pages rather than usable headline content. " +
      "Evidence: live-search — the search tool ran, but the returned evidence was insufficient to verify specific headlines. " +
      "I can't responsibly list today's headlines from those results without risking another fabricated answer. I can try a more targeted search for Zimbabwe, Africa, or global news.\n\n" +
      "**Sources:**\n- [1] [CNN](https://cnn.com)";
    const result = appendSourcesIfWeb(text, mockWebContext);
    expect(result).not.toContain("**Sources:**");
    expect(result).not.toContain("https://cnn.com");
  });

  it("includes ONLY legitimately cited sources traceable to retrieved results", () => {
    const text = "Reuters reported strikes on tankers [1], while BBC reported talks in Moscow [3].";
    const result = appendSourcesIfWeb(text, mockWebContext);
    expect(result).toContain("**Sources:**");
    expect(result).toContain("- [1] [US strikes Iranian oil tankers - Reuters](https://reuters.com/news/article1)");
    expect(result).toContain("- [3] [Envoys in Moscow for Ukraine talks - BBC](https://bbc.com/news/article3)");
    // [2] was an irrelevant uncited link and must NOT be in Sources
    expect(result).not.toContain("[2]");
    expect(result).not.toContain("https://cnn.com/");
  });

  it("does not include citation numbers that do not exist in retrieved evidence", () => {
    const text = "Something happened according to an unverified report [99].";
    const result = appendSourcesIfWeb(text, mockWebContext);
    expect(result).not.toContain("**Sources:**");
  });
});
