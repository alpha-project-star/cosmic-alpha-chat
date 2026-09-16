// tests/auto-migration-trigger.test.tsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoMigration } from "../src/hooks/useAutoMigration";
import { useAuth } from "../src/lib/auth";
import { alphaStore } from "../src/lib/alpha-store";
import { MigrationOrchestrator } from "../src/lib/migration-orchestrator";

// Mock dependencies
vi.mock("../src/lib/auth", () => ({
  useAuth: vi.fn()
}));

vi.mock("../src/lib/alpha-store", () => ({
  alphaStore: {
    get: vi.fn()
  }
}));

const mockExecute = vi.fn().mockResolvedValue({});
const mockConstructor = vi.fn();
vi.mock("../src/lib/migration-orchestrator", () => {
  return {
    MigrationOrchestrator: class {
      executeMigration = mockExecute;
      constructor(userId: string) {
        mockConstructor(userId);
      }
    }
  };
});

describe("Auto-migration Trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers migration when authenticated and legacy data exists", () => {
    (useAuth as any).mockReturnValue({ status: 'authenticated', user: { uid: 'u1' } });
    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: 'r1' }] });

    renderHook(() => useAutoMigration());

    expect(mockConstructor).toHaveBeenCalledWith('u1');
    expect(mockExecute).toHaveBeenCalled();
  });

  it("does not trigger when unauthenticated", () => {
    (useAuth as any).mockReturnValue({ status: 'unauthenticated' });
    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: 'r1' }] });

    renderHook(() => useAutoMigration());

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("does not trigger when no legacy data exists", () => {
    (useAuth as any).mockReturnValue({ status: 'authenticated', user: { uid: 'u1' } });
    (alphaStore.get as any).mockReturnValue({ reminders: [] });

    renderHook(() => useAutoMigration());

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("prevents repeated triggers on re-renders", () => {
    (useAuth as any).mockReturnValue({ status: 'authenticated', user: { uid: 'u1' } });
    (alphaStore.get as any).mockReturnValue({ reminders: [{ id: 'r1' }] });

    const { rerender } = renderHook(() => useAutoMigration());
    rerender();

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
