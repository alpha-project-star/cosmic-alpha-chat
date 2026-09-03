import { describe, expect, it } from "vitest";
import { parseWhen, normalizeWhen, formatWhen } from "../src/lib/when";

const NOW = new Date("2026-09-01T10:00:00.000Z");

describe("parseWhen", () => {
  it("handles relative durations", () => {
    expect(parseWhen("in 20 minutes", NOW)).toBe(NOW.getTime() + 20 * 60_000);
    expect(parseWhen("in 2 hours", NOW)).toBe(NOW.getTime() + 2 * 3_600_000);
    expect(parseWhen("in an hour", NOW)).toBe(NOW.getTime() + 3_600_000);
  });

  it("rolls a passed clock time to tomorrow", () => {
    const t = parseWhen("at 9:30", NOW)!;
    expect(t).toBeGreaterThan(NOW.getTime());
  });

  it("parses tomorrow with a clock", () => {
    const t = parseWhen("tomorrow at 7:30am", NOW)!;
    const d = new Date(t);
    expect(d.getHours()).toBe(7);
    expect(d.getMinutes()).toBe(30);
  });

  it("parses weekdays into the future", () => {
    const t = parseWhen("friday at 6pm", NOW)!;
    expect(new Date(t).getDay()).toBe(5);
    expect(t).toBeGreaterThan(NOW.getTime());
  });

  it("parses ISO round-trip", () => {
    expect(parseWhen("2026-12-24T18:00:00.000Z", NOW)).toBe(Date.parse("2026-12-24T18:00:00.000Z"));
  });

  it("returns null instead of inventing a time", () => {
    expect(parseWhen("sometime soon", NOW)).toBeNull();
    expect(parseWhen("", NOW)).toBeNull();
    expect(parseWhen("when I feel like it", NOW)).toBeNull();
  });
});

describe("normalizeWhen", () => {
  it("keeps the raw phrase when unparseable", () => {
    const r = normalizeWhen("whenever", NOW);
    expect(r.parsed).toBe(false);
    expect(r.iso).toBe("whenever");
  });
  it("stores ISO when parseable", () => {
    const r = normalizeWhen("in 5 minutes", NOW);
    expect(r.parsed).toBe(true);
    expect(Date.parse(r.iso)).toBe(NOW.getTime() + 300_000);
  });
});

describe("formatWhen", () => {
  it("passes through unparseable phrases untouched", () => {
    expect(formatWhen("whenever")).toBe("whenever");
  });
  it("formats ISO values", () => {
    expect(formatWhen("2026-12-24T18:00:00.000Z")).not.toBe("2026-12-24T18:00:00.000Z");
  });
});
