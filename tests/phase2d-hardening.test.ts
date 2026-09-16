import { describe, expect, it, vi, beforeEach } from "vitest";
import { interpretReminderDate, formatReminderDate } from "../src/lib/reminder-date-utils";
import { ReminderTool } from "../src/lib/reminder-tool";
import { ReminderRepository } from "../src/lib/reminder-repo";
import { temporal } from "../src/lib/temporal";

describe("Phase 2D: Reminder Hardening", () => {
  const refDate = new Date("2026-09-08T10:00:00Z"); // Tuesday 10 AM

  describe("Date/Time Interpretation", () => {
    it("interprets 'tomorrow'", () => {
      const result = interpretReminderDate("tomorrow", refDate);
      const expected = new Date("2026-09-09T00:00:00Z").getTime();
      expect(result).toBe(expected);
    });

    it("interprets 'in 2 hours'", () => {
      const result = interpretReminderDate("in 2 hours", refDate);
      const expected = new Date("2026-09-08T12:00:00Z").getTime();
      expect(result).toBe(expected);
    });

    it("interprets '3 PM' as today if in future", () => {
      const result = interpretReminderDate("3 PM", refDate);
      const expected = new Date("2026-09-08T15:00:00Z").getTime();
      expect(result).toBe(expected);
    });

    it("interprets '9 AM' as tomorrow if currently 10 AM", () => {
      const result = interpretReminderDate("9 AM", refDate);
      const expected = new Date("2026-09-09T09:00:00Z").getTime();
      expect(result).toBe(expected);
    });

    it("interprets explicit dates", () => {
      const result = interpretReminderDate("2026-09-15T14:30:00Z", refDate);
      expect(result).toBe(new Date("2026-09-15T14:30:00Z").getTime());
    });

    it("returns null for gibberish", () => {
      expect(interpretReminderDate("some point in time", refDate)).toBeNull();
    });
  });

  describe("Formatting", () => {
    it("formats today friendly", () => {
      // We need to mock 'now' for isSameDay to work reliably
      const now = new Date("2026-09-08T10:00:00Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);
      
      const ts = new Date("2026-09-08T15:00:00Z").getTime();
      expect(formatReminderDate(ts)).toContain("Today at 3:00 PM");
      
      vi.useRealTimers();
    });

    it("formats tomorrow friendly", () => {
      const now = new Date("2026-09-08T10:00:00Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);
      
      const ts = new Date("2026-09-09T09:00:00Z").getTime();
      expect(formatReminderDate(ts)).toContain("Tomorrow at 9:00 AM");
      
      vi.useRealTimers();
    });
  });

  describe("Ambiguity Handling in ReminderTool", () => {
    const userId = "user-123";
    let mockRepo: ReminderRepository;
    let tool: ReminderTool;

    beforeEach(() => {
      mockRepo = {
        listReminders: vi.fn(),
        getReminder: vi.fn(),
        createReminder: vi.fn(),
        updateReminder: vi.fn(),
        deleteReminder: vi.fn(),
      } as any;
      tool = new ReminderTool(userId, mockRepo);
      temporal.setMockDate(refDate);
    });

    it("handles multiple matches by returning AMBIGUOUS", async () => {
      const mockList = [
        { id: "r1", title: "Study Math" },
        { id: "r2", title: "Study History" }
      ] as any;
      (mockRepo.listReminders as any).mockResolvedValue(mockList);
      
      const result = await tool.getReminder("Study");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AMBIGUOUS');
      expect(result.error?.candidates).toHaveLength(2);
    });

    it("proceeds if exactly one match is found by title", async () => {
      const mockList = [
        { id: "r1", title: "Study Math", dueAt: Date.now() }
      ] as any;
      (mockRepo.listReminders as any).mockResolvedValue(mockList);
      (mockRepo.getReminder as any).mockResolvedValue(null); // Not found by ID
      
      const result = await tool.getReminder("Math");
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("r1");
    });
  });
});
