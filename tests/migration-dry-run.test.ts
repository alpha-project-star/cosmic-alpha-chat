// tests/migration-dry-run.test.ts
import { describe, expect, it, vi } from "vitest";
import { performDryRun } from "../src/lib/migration-dry-run";
import { AlphaState, Reminder } from "../src/lib/alpha-store";

describe("Migration Dry-Run", () => {
  const mockState: AlphaState = {
    chat: [], notes: [], bills: [], plans: [], memories: [], profile: { name: "", bio: "" },
    settings: {} as any,
    reminders: [
      { id: "r1", title: "Active", when: "2026-09-08T10:00:00Z", notes: "Note1", done: "no" },
      { id: "r2", title: "Completed", when: "2026-09-07T10:00:00Z", notes: "Note2", done: "yes" },
      { id: "r3", title: "No firedAt", when: "2026-09-09T10:00:00Z", notes: "", done: "no" },
      { id: "r4", title: "With firedAt", when: "2026-09-10T10:00:00Z", notes: "", done: "no", firedAt: 1725700000000 },
      { id: "r5", title: "Missing when", when: "", notes: "", done: "no" },
      { id: "r6", title: "Invalid when", when: "not-a-date", notes: "", done: "no" },
      { id: "r1", title: "Duplicate ID", when: "2026-09-11T10:00:00Z", notes: "", done: "no" },
    ]
  };

  it("produces correct dry-run report", () => {
    const authUid = "user-123";
    const timestamp = 1725700000000;
    const existingIds = new Set(["existing-in-fs"]);
    
    // Add existing record to mock state for dry-run test
    const stateWithConflict: AlphaState = {
      ...mockState,
      reminders: [
        ...mockState.reminders,
        { id: "existing-in-fs", title: "Conflict", when: "2026-09-12T10:00:00Z", notes: "", done: "no" }
      ]
    };
    
    const report = performDryRun(stateWithConflict, authUid, timestamp, existingIds);

    expect(report.total).toBe(8);
    expect(report.blocked).toBe(2); // r5, r6
    expect(report.conflicts).toBe(1); // r1 duplicate
    expect(report.alreadyMigrated).toBe(1); // existing-in-fs
    expect(report.report).toBeDefined();
    
    // Check mapping
    const r1 = report.reports.find(r => r.id === "r1" && r.classification === 'valid');
    expect(r1?.reminderState).toBe("active");
    expect(r1?.dueAt).toBe(Date.parse("2026-09-08T10:00:00Z"));
    expect(r1?.createdAt).toBe(timestamp);
    expect(r1?.updatedAt).toBe(timestamp);
    
    const conflict = report.reports.find(r => r.classification === 'conflict');
    expect(conflict?.error).toContain("Duplicate ID");
  });

  it("does not mutate original data", () => {
    const original = JSON.parse(JSON.stringify(mockState));
    performDryRun(mockState, "uid", Date.now());
    expect(mockState).toEqual(original);
  });
});
