// tests/migration-contract.test.ts
import { describe, expect, it } from "vitest";
import { MigrationValidator } from "../src/lib/migration-contract";
import { Reminder } from "../src/lib/alpha-store";

describe("Migration Contract", () => {
  const validator = new MigrationValidator(new Set(["existing-id-in-firestore"]));

  it("validates and maps reminders according to contract", () => {
    const mockReminders: Reminder[] = [
      { id: "r1", title: "Active", when: "2026-09-08T10:00:00Z", notes: "Note1", done: "no" },
      { id: "r2", title: "Completed", when: "2026-09-07T10:00:00Z", notes: "Note2", done: "yes" },
      { id: "r3", title: "Invalid Date", when: "not-a-date", notes: "", done: "no" },
      { id: "r4", title: "Missing Date", when: "", notes: "", done: "no" },
      { id: "r5", title: "Unknown State", when: "2026-09-09T10:00:00Z", notes: "", done: "maybe" as any },
      { id: "r1", title: "Duplicate Source ID", when: "2026-09-11T10:00:00Z", notes: "", done: "no" },
      { id: "existing-id-in-firestore", title: "Already Migrated", when: "2026-09-12T10:00:00Z", notes: "", done: "no" },
      { id: "", title: "Missing ID", when: "2026-09-13T10:00:00Z", notes: "", done: "no" },
    ];

    const userId = "auth-uid-123";
    const timestamp = 1725700000000;
    const report = validator.validate(mockReminders, userId, timestamp);

    expect(report.valid.length).toBe(2); // r1, r2
    expect(report.blocked.length).toBe(4); // r3, r4, r5, r8 (missing ID)
    expect(report.conflicts.length).toBe(1); // r6 (duplicate source ID)
    expect(report.alreadyMigrated.length).toBe(1); // r7 (already in firestore)
    
    // Verify mapped data
    expect(report.valid[0].userId).toBe(userId);
    expect(report.valid[0].reminderState).toBe("active");
    expect(report.valid[0].createdAt).toBe(timestamp);
    expect(report.valid[0].updatedAt).toBe(timestamp);
    expect(report.valid[1].reminderState).toBe("completed");
    
    // Test Immutability
    expect(mockReminders[0].id).toBe("r1");
  });

  it("handles empty source list correctly", () => {
    const report = validator.validate([], "uid", Date.now());
    expect(report.valid).toEqual([]);
    expect(report.blocked).toEqual([]);
  });

  it("rejects migration if userId is missing", () => {
    const mock: Reminder[] = [{ id: "r1", title: "T", when: "2026-09-08T10:00:00Z", notes: "", done: "no" }];
    const report = validator.validate(mock, "", Date.now());
    expect(report.valid.length).toBe(0);
    expect(report.blocked[0].reason).toContain("authenticated user ID");
  });

  it("is deterministic (idempotency test)", () => {
    const mock: Reminder[] = [{ id: "r1", title: "T", when: "2026-09-08T10:00:00Z", notes: "", done: "no" }];
    const ts = 1000;
    const report1 = validator.validate(mock, "u1", ts);
    const report2 = validator.validate(mock, "u1", ts);
    expect(report1.valid[0]).toEqual(report2.valid[0]);
  });
});
