// tests/migration-orchestrator.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MigrationOrchestrator } from "../src/lib/migration-orchestrator";
import { alphaStore } from "../src/lib/alpha-store";

// Mock firebase/firestore
const mockTransaction = {
  get: vi.fn(),
    clearReminders: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
};

vi.mock("firebase/firestore", () => {
  return {
    doc: vi.fn(() => ({ id: "mock-doc-id" })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    runTransaction: vi.fn((db, cb) => cb(mockTransaction)),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
    getFirestore: vi.fn(),
  };
});

// Mock alpha-store
vi.mock("../src/lib/alpha-store", () => ({
  alphaStore: {
    get: vi.fn(),
    clearReminders: vi.fn()
  }
}));

// Mock dependency classes
const mockRepo = {
  listReminders: vi.fn().mockResolvedValue([]),
  createReminder: vi.fn().mockResolvedValue(undefined)
};

const mockWriter = {
  migrate: vi.fn()
};

vi.mock("../src/lib/migration-writer", () => ({
  MigrationWriter: vi.fn(() => mockWriter)
}));

vi.mock("../src/lib/reminder-repo", () => ({
  FirestoreReminderRepository: vi.fn(() => mockRepo)
}));

describe("Migration Orchestrator", () => {
  const userId = "user-123";
  let orchestrator: MigrationOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new MigrationOrchestrator(userId, mockRepo as any, mockWriter as any);
    // @ts-expect-error - access private static for test cleanup
    MigrationOrchestrator.inProgressLock.clear();

    // Default mock behavior
    mockTransaction.get.mockResolvedValue({ exists: () => false });
  });

  it("identifies as eligible if legacy data exists and no status doc", async () => {
    const { getDoc } = await import("firebase/firestore");
    (getDoc as any).mockResolvedValue({ exists: () => false });
    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: '1' }] });

    const state = await orchestrator.getState();
    expect(state.status).toBe('eligible');
  });

  it("identifies as not_started if no legacy data and no status doc", async () => {
    const { getDoc } = await import("firebase/firestore");
    (getDoc as any).mockResolvedValue({ exists: () => false });
    (alphaStore.get as any).mockReturnValue({ reminders: [] });

    const state = await orchestrator.getState();
    expect(state.status).toBe('not_started');
  });

  it("returns completed status if stored in Firestore", async () => {
    const { getDoc } = await import("firebase/firestore");
    (getDoc as any).mockResolvedValue({ 
      exists: () => true, 
      data: () => ({ status: 'completed' }) 
    });

    const state = await orchestrator.getState();
    expect(state.status).toBe('completed');
  });

  it("prevents concurrent migrations (in-memory lock)", async () => {
    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: '1', when: '2026-09-08', done: 'no' }] });
    
    // Slow down the first migration
    mockWriter.migrate.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([]), 50)));

    const p1 = orchestrator.executeMigration(Date.now());
    await expect(orchestrator.executeMigration(Date.now())).rejects.toThrow("Migration already in progress");
    
    await p1;
  });

  it("prevents concurrent migrations (Firestore status)", async () => {
    mockTransaction.get.mockResolvedValue({ 
      exists: () => true, 
      data: () => ({ status: 'in_progress' }) 
    });

    await expect(orchestrator.executeMigration(Date.now())).rejects.toThrow("Migration already in progress (another session)");
  });

  it("fails completion if verification detects missing records", async () => {
    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: 'r1', title: 'T', when: '2026-09-08', done: 'no' }] });
    mockRepo.listReminders.mockResolvedValue([]); // Empty after migration!
    mockWriter.migrate.mockResolvedValue([{ id: 'r1', status: 'created' }]);

    const state = await orchestrator.executeMigration(Date.now());
    expect(state.status).toBe('failed');
    expect(state.verified).toBe(false);
    expect(state.error).toContain("missing after write");
  });

  it("succeeds completion and verification when all records are present", async () => {
    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: 'r1', title: 'T', when: '2026-09-08', done: 'no' }] });
    mockRepo.listReminders.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'r1' }]); 
    mockWriter.migrate.mockResolvedValue([{ id: 'r1', status: 'created' }]);

    const state = await orchestrator.executeMigration(Date.now());
    expect(state.status).toBe('completed');
    expect(state.verified).toBe(true);
    expect(state.summary?.created).toBe(1);
  });

  it("ensures all records share the same timestamp", async () => {
    (alphaStore.get as any).mockReturnValue({ 
      reminders: [
        { id: 'r1', title: 'T1', when: '2026-09-08', done: 'no' },
        { id: 'r2', title: 'T2', when: '2026-09-09', done: 'no' }
      ] 
    });
    
    // Success verification
    mockRepo.listReminders.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    
    const timestamp = 999999;
    await orchestrator.executeMigration(timestamp);

    expect(mockWriter.migrate).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: expect.arrayContaining([
          expect.objectContaining({ id: 'r1', createdAt: timestamp }),
          expect.objectContaining({ id: 'r2', createdAt: timestamp })
        ])
      }),
      userId
    );
  });

  it("recovers from partial failure (retry skips successes)", async () => {
    const { setDoc } = await import("firebase/firestore");
    
    // 1. First run: partial success
    (alphaStore.get as any).mockReturnValue({ 
      reminders: [
        { id: 'r1', title: 'T1', when: '2026-09-08', done: 'no' },
        { id: 'r2', title: 'T2', when: '2026-09-09', done: 'no' }
      ] 
    });
    
    mockWriter.migrate.mockResolvedValue([
      { id: 'r1', status: 'created' },
      { id: 'r2', status: 'failed', reason: 'Network error' }
    ]);
    
    mockRepo.listReminders.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'r1' }]);

    await orchestrator.executeMigration(Date.now());
    expect(setDoc).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: 'failed' }));

    // 2. Retry: r1 is now existing in Firestore
    mockTransaction.get.mockResolvedValue({ 
      exists: () => true, 
      data: () => ({ status: 'failed' }) 
    });
    
    mockWriter.migrate.mockResolvedValue([
      { id: 'r1', status: 'skipped', reason: 'Already migrated' },
      { id: 'r2', status: 'created' }
    ]);
    
    mockRepo.listReminders.mockResolvedValueOnce([{ id: 'r1' }]).mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    const finalState = await orchestrator.executeMigration(Date.now());
    expect(finalState.status).toBe('completed');
    expect(mockWriter.migrate).toHaveBeenCalledTimes(2);
  });

  it("rejects migration if already completed", async () => {
    mockTransaction.get.mockResolvedValue({ 
      exists: () => true, 
      data: () => ({ status: 'completed' }) 
    });

    const state = await orchestrator.executeMigration(Date.now());
    expect(state.status).toBe('completed');
    expect(mockWriter.migrate).not.toHaveBeenCalled();
  });

  it("preserves results and detailed summary in the state doc", async () => {
    const { setDoc } = await import("firebase/firestore");

    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: 'r1', title: 'T', when: '2026-09-08', done: 'no' }] });
    mockRepo.listReminders.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'r1' }]);
    
    mockWriter.migrate.mockResolvedValue([
      { id: 'r1', status: 'created' }
    ]);

    await orchestrator.executeMigration(Date.now());
    
    expect(setDoc).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      status: 'completed',
      summary: expect.objectContaining({
        total: 1,
        created: 1,
        failed: 0
      }),
      results: [{ id: 'r1', status: 'created' }]
    }));
  });

  it("does not migrate when no legacy data exists", async () => {
    const { getDoc } = await import("firebase/firestore");
    (getDoc as any).mockResolvedValue({ exists: () => false });
    (alphaStore.get as any).mockReturnValue({ reminders: [] });

    const state = await orchestrator.getState();
    expect(state.status).toBe('not_started');
  });
});
