import { describe, expect, it } from "vitest";
import { extractArticleLinks } from "../src/lib/research-utils";

describe("Link Extraction", () => {
  const baseUrl = "https://example.com";

  it("extracts Markdown links", () => {
    const content = "Check this [News Article](/news/1) out.";
    const links = extractArticleLinks(content, baseUrl);
    expect(links).toContain("https://example.com/news/1");
  });

  it("extracts HTML <a href> links", () => {
    const content = 'Check this <a href="/news/2">News Article</a> out.';
    const links = extractArticleLinks(content, baseUrl);
    expect(links).toContain("https://example.com/news/2");
  });

  it("handles relative article URLs and converts to absolute", () => {
    const content = '<a href="/news/art1">News 1</a> and [News 2](/news/art2)';
    const links = extractArticleLinks(content, baseUrl);
    expect(links).toContain("https://example.com/news/art1");
    expect(links).toContain("https://example.com/news/art2");
  });

  it("deduplicates links", () => {
    const content = '<a href="/news/art1">News 1</a> and [News 1](/news/art1)';
    const links = extractArticleLinks(content, baseUrl);
    expect(links.filter(l => l.endsWith('/news/art1')).length).toBe(1);
  });
});
