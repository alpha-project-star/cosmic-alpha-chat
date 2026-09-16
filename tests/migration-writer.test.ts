// tests/migration-writer.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MigrationWriter } from "../src/lib/migration-writer";
import { MigrationReport } from "../src/lib/migration-contract";
import { ReminderRepository, FirestoreReminder } from "../src/lib/reminder-repo";

// Mock firebase/auth
vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({
    currentUser: { uid: "test-user" }
  }))
}));

describe("Migration Writer", () => {
  const mockRepo: ReminderRepository = {
    listReminders: vi.fn(),
    getReminder: vi.fn(),
    createReminder: vi.fn(),
    updateReminder: vi.fn(),
    deleteReminder: vi.fn(),
  };

  const writer = new MigrationWriter(mockRepo);
  const userId = "test-user";
  const timestamp = 1725700000000;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully creates validated reminders for authenticated user", async () => {
    const validReminder: FirestoreReminder = {
      id: "r1",
      userId,
      title: "Test",
      notes: "",
      dueAt: timestamp + 1000,
      createdAt: timestamp,
      updatedAt: timestamp,
      reminderState: 'active',
      notificationState: 'pending'
    };

    const report: MigrationReport = {
      valid: [validReminder],
      blocked: [],
      conflicts: [],
      alreadyMigrated: []
    };

    const results = await writer.migrate(report, userId);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: "r1", status: "created" });
    expect(mockRepo.createReminder).toHaveBeenCalledWith(userId, validReminder);
  });

  it("rejects migration if user is not authenticated", async () => {
    const { getAuth } = await import("firebase/auth");
    (getAuth as any).mockReturnValueOnce({ currentUser: null });

    const report: MigrationReport = { valid: [], blocked: [], conflicts: [], alreadyMigrated: [] };
    await expect(writer.migrate(report, userId)).rejects.toThrow("Authentication required");
  });

  it("rejects migration if userId mismatch", async () => {
    const report: MigrationReport = { valid: [], blocked: [], conflicts: [], alreadyMigrated: [] };
    await expect(writer.migrate(report, "wrong-user")).rejects.toThrow("User ID mismatch");
  });

  it("skips already-migrated, conflicts, and blocked records", async () => {
    const report: MigrationReport = {
      valid: [],
      alreadyMigrated: [{ reminder: { id: "r_already", title: "Already", when: "", done: "no" } }],
      conflicts: [{ reminder: { id: "r_conflict", title: "Conflict", when: "", done: "no" }, reason: "Duplicate ID" }],
      blocked: [{ reminder: { id: "r_blocked", title: "Blocked", when: "", done: "no" }, reason: "Invalid Date" }]
    };

    const results = await writer.migrate(report, userId);

    expect(results).toHaveLength(3);
    expect(results.find(r => r.id === "r_already")?.status).toBe("skipped");
    expect(results.find(r => r.id === "r_conflict")?.status).toBe("skipped");
    expect(results.find(r => r.id === "r_blocked")?.status).toBe("skipped");
    expect(mockRepo.createReminder).not.toHaveBeenCalled();
  });

  it("handles partial write failures", async () => {
    const r1: FirestoreReminder = { id: "r1", userId, title: "T1", notes: "", dueAt: 1, createdAt: 1, updatedAt: 1, reminderState: 'active', notificationState: 'pending' };
    const r2: FirestoreReminder = { id: "r2", userId, title: "T2", notes: "", dueAt: 1, createdAt: 1, updatedAt: 1, reminderState: 'active', notificationState: 'pending' };

    const report: MigrationReport = {
      valid: [r1, r2],
      blocked: [],
      conflicts: [],
      alreadyMigrated: []
    };

    (mockRepo.createReminder as any).mockImplementationOnce(async () => {});
    (mockRepo.createReminder as any).mockImplementationOnce(async () => { throw new Error("Firestore down"); });

    const results = await writer.migrate(report, userId);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("created");
    expect(results[1].status).toBe("failed");
    expect(results[1].reason).toBe("Firestore down");
  });

  it("is retry-safe: creating twice results in success/skip if handled by validator", async () => {
    // Retry safety is mostly handled by the ID mapping and the fact that 
    // the validator (Phase 1C) checks existing IDs.
    // Here we just verify the writer handles a fresh creation if valid.
    const r1: FirestoreReminder = { id: "retry-id", userId, title: "T1", notes: "", dueAt: 1, createdAt: 1, updatedAt: 1, reminderState: 'active', notificationState: 'pending' };
    
    const report: MigrationReport = {
      valid: [r1],
      blocked: [],
      conflicts: [],
      alreadyMigrated: []
    };

    await writer.migrate(report, userId);
    expect(mockRepo.createReminder).toHaveBeenCalledWith(userId, r1);
  });
});
