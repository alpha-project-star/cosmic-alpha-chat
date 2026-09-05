import { describe, expect, it } from "vitest";
import {
  decideSearch,
  isCapabilityInquiry,
  isExplicitSearchRequest,
  mayBenefitFromSearch,
  stripSearchPreamble,
  SEARCH_CAPABILITY_HINT,
} from "../src/lib/web-search";
import { DEFAULT_SYSTEM, fetchLiveWebContext } from "../src/lib/alpha.functions";

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
});
