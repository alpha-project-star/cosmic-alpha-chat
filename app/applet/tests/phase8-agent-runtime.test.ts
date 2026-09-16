import { describe, expect, it } from "vitest";
import { toolRegistry, executeTool } from "../src/lib/tool-registry";
import { z } from "zod";

describe("Phase 8: Agent Runtime, Tool Registry & Controlled Execution", () => {
  it("1. unknown tool is rejected with appropriate error", () => {
    expect(() => toolRegistry.resolve("nonexistent.tool")).toThrowError(/Unknown tool ID/);
  });

  it("2. duplicate tool registration is rejected", () => {
    const customToolId = "test.custom.unique.tool";
    const customTool = {
      id: customToolId,
      description: "Custom test tool",
      inputSchema: z.object({ value: z.string() }),
      capability: "test",
      riskLevel: "READ" as const,
      requiresConfirmation: false,
      supportsCancellation: true,
      supportsIdempotency: true,
      execute: async (input: { value: string }) => ({ echoed: input.value })
    };

    // Register once
    toolRegistry.register(customTool);

    // Registering again should throw duplicate error
    expect(() => toolRegistry.register(customTool)).toThrowError(/Duplicate tool registration rejected/);
  });

  it("3 & 4. malformed arguments / invalid schema are rejected with structured failure", async () => {
    const res = await executeTool(
      {
        id: "op-test-1",
        taskId: "task-1",
        runId: "run-1",
        stepId: "step-1",
        toolId: "reminders.create",
        arguments: { title: 123 }, // invalid type (number instead of string)
      },
      { userId: "user-1" }
    );

    expect(res.result.outcome).toBe("failure");
    expect(res.result.evidence).toContain("INVALID_INPUT");
    expect(res.observation.type).toBe("provider_failure");
    expect(res.evaluation.accomplished).toBe(false);
  });

  it("5. unauthorized capability (unauthenticated write) is rejected", async () => {
    const res = await executeTool(
      {
        id: "op-test-2",
        taskId: "task-1",
        runId: "run-1",
        stepId: "step-1",
        toolId: "reminders.create",
        arguments: { title: "Test Reminder", dueAt: Date.now() + 3600000 },
      },
      { userId: null } // Unauthenticated
    );

    expect(res.result.outcome).toBe("failure");
    expect(res.result.evidence).toContain("PERMISSION_DENIED");
    expect(res.evaluation.accomplished).toBe(false);
  });

  it("6 & 7. confirmation-required operation blocked without valid operation-specific confirmation", async () => {
    const resWithoutConf = await executeTool(
      {
        id: "op-test-3",
        taskId: "task-1",
        runId: "run-1",
        stepId: "step-1",
        toolId: "reminders.delete",
        arguments: { idOrQuery: "rem-abc" },
      },
      { userId: "user-1" } // Authenticated, but missing confirmation for DESTRUCTIVE tool
    );

    expect(resWithoutConf.result.outcome).toBe("failure");
    expect(resWithoutConf.result.evidence).toContain("CONFIRMATION_REQUIRED");
  });

  it("8 & 9. cancellation propagates and prevents execution", async () => {
    const controller = new AbortController();
    controller.abort(); // Pre-cancelled

    const res = await executeTool(
      {
        id: "op-test-4",
        taskId: "task-1",
        runId: "run-1",
        stepId: "step-1",
        toolId: "reminders.list",
        arguments: {},
      },
      { userId: "user-1", signal: controller.signal }
    );

    expect(res.result.outcome).toBe("cancellation");
    expect(res.evaluation.accomplished).toBe(false);
  });

  it("10. successful execution produces valid observation, evaluation, and result contract", async () => {
    const res = await executeTool(
      {
        id: "op-test-5",
        taskId: "task-1",
        runId: "run-1",
        stepId: "step-1",
        toolId: "reminders.list",
        arguments: {},
      },
      { userId: "user-1" }
    );

    expect(res.observation).toBeDefined();
    expect(res.evaluation).toBeDefined();
    expect(res.result).toBeDefined();
    expect(typeof res.evaluation.accomplished).toBe("boolean");
    expect(res.result.runId).toBe("run-1");
    expect(res.result.stepId).toBe("step-1");
  });
});
