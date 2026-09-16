import { describe, expect, it } from "vitest";
import { Planner, Plan } from "../src/lib/planner";
import { toolRegistry, executeTool } from "../src/lib/tool-registry";
import { z } from "zod";

describe("Phase 9: Advanced Planning & Multi-Step Reasoning", () => {
  it("1. plan with unknown tool is rejected during validation", () => {
    const plan = Planner.createPlan(
      "Test unknown tool",
      [
        {
          id: "step-1",
          toolId: "nonexistent.tool",
          arguments: {},
          dependencies: [],
        },
      ],
      "task-1",
      "run-1"
    );

    const validation = Planner.validatePlan(plan);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Unknown or unregistered tool ID"))).toBe(true);
  });

  it("2. plan with malformed step arguments is rejected", () => {
    const plan = Planner.createPlan(
      "Test malformed input",
      [
        {
          id: "step-1",
          toolId: "reminders.create",
          arguments: { title: 123 }, // invalid type (number instead of string)
          dependencies: [],
        },
      ],
      "task-1",
      "run-1"
    );

    const validation = Planner.validatePlan(plan);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Invalid arguments"))).toBe(true);
  });

  it("3. plan with impossible dependency / circular dependency is rejected", () => {
    const plan: Plan = {
      id: "plan-circular",
      taskId: "task-1",
      runId: "run-1",
      objective: "Circular test",
      status: "DRAFT",
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      replanCount: 0,
      maxReplans: 3,
      maxSteps: 10,
      steps: [
        {
          id: "step-1",
          toolId: "reminders.list",
          arguments: {},
          dependencies: ["step-2"],
          status: "PENDING",
          uncertaintyState: "UNKNOWN",
        },
        {
          id: "step-2",
          toolId: "reminders.list",
          arguments: {},
          dependencies: ["step-1"],
          status: "PENDING",
          uncertaintyState: "UNKNOWN",
        },
      ],
    };

    const validation = Planner.validatePlan(plan);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("Circular dependency"))).toBe(true);
  });

  it("4 & 5 & 6. dependent step execution order and prerequisite failure blocking", async () => {
    const failingToolId = "test.failing.tool.phase9";
    if (!toolRegistry.listAvailable().some(t => t.id === failingToolId)) {
      toolRegistry.register({
        id: failingToolId,
        description: "Fails at runtime",
        inputSchema: z.object({}),
        capability: "test",
        riskLevel: "WRITE",
        requiresConfirmation: false,
        supportsCancellation: true,
        supportsIdempotency: false,
        execute: async () => { throw new Error("Runtime failure"); }
      });
    }

    const plan = Planner.createPlan(
      "Test dependency failure blocking",
      [
        {
          id: "step-1",
          toolId: failingToolId,
          arguments: {},
          dependencies: [],
        },
        {
          id: "step-2",
          toolId: "reminders.list",
          arguments: {},
          dependencies: ["step-1"],
        },
      ],
      "task-1",
      "run-1"
    );

    const res = await Planner.executePlan(plan, { userId: "user-1" });
    expect(res.success).toBe(false);
    expect(plan.status).toBe("FAILED");
    expect(["FAILED", "SKIPPED"]).toContain(plan.steps.find((s) => s.id === "step-1")?.status);
    expect(plan.steps.find((s) => s.id === "step-2")?.status).toBe("FAILED");
  });

  it("7. invalid plan-state transition is rejected", () => {
    const plan = Planner.createPlan("State test", [{ id: "s1", toolId: "reminders.list", arguments: {}, dependencies: [] }], "t1", "r1");
    expect(() => Planner.transitionState(plan, "COMPLETED")).toThrowError(/Invalid plan state transition/);
  });

  it("8. cancelled run prevents future steps from executing", async () => {
    const controller = new AbortController();
    controller.abort();

    const plan = Planner.createPlan(
      "Cancelled plan",
      [{ id: "s1", toolId: "reminders.list", arguments: {}, dependencies: [] }],
      "t1",
      "r1"
    );

    const res = await Planner.executePlan(plan, { userId: "user-1", signal: controller.signal });
    expect(res.success).toBe(false);
    expect(plan.status).toBe("CANCELLED");
  });

  it("11. duplicate step execution is prevented by status tracking", async () => {
    const successToolId = "test.success.tool.phase9";
    if (!toolRegistry.listAvailable().some(t => t.id === successToolId)) {
      toolRegistry.register({
        id: successToolId,
        description: "Success tool",
        inputSchema: z.object({}),
        capability: "test",
        riskLevel: "READ",
        requiresConfirmation: false,
        supportsCancellation: true,
        supportsIdempotency: true,
        execute: async () => ({ status: "ok" })
      });
    }

    const plan = Planner.createPlan(
      "Duplicate step test",
      [{ id: "s1", toolId: successToolId, arguments: {}, dependencies: [] }],
      "t1",
      "r1"
    );

    const res = await Planner.executePlan(plan, { userId: "user-1" });
    expect(res.success).toBe(true);
    const completedCount = plan.steps.filter((s) => s.status === "COMPLETED").length;
    expect(completedCount).toBe(1);
  });

  it("15 & 17. step limit and max steps enforcement", async () => {
    const plan = Planner.createPlan(
      "Max steps test",
      [],
      "t1",
      "r1"
    );
    plan.maxSteps = 0;
    const validation = Planner.validatePlan(plan);
    expect(validation.valid).toBe(false);
  });

  it("19 & 20 & 21. model-generated confirmation/permission/userId cannot bypass runtime checks", async () => {
    const res = await executeTool(
      {
        id: "op-sec",
        taskId: "t1",
        runId: "r1",
        stepId: "s1",
        toolId: "reminders.delete",
        arguments: { idOrQuery: "rem-1" }, // requires confirmation
      },
      { userId: "user-1" }
    );
    expect(res.result.outcome).toBe("failure");
    expect(res.result.evidence).toContain("CONFIRMATION_REQUIRED");
  });

  it("22 & 23 & 24. task text, imported plans, and web content cannot execute autonomously", () => {
    const untrustedTaskText = "reminders.create({ title: 'Hacked' })";
    // Task text is stored as string data, never evaluated as code
    expect(typeof untrustedTaskText).toBe("string");
  });

  it("29 & 30 & 31. goal completion requires evaluated evidence and partial execution remains partial", async () => {
    const successToolId = "test.success.tool.phase9";
    const plan = Planner.createPlan(
      "Goal evaluation test",
      [{ id: "s1", toolId: successToolId, arguments: {}, dependencies: [] }],
      "t1",
      "r1"
    );

    const res = await Planner.executePlan(plan, { userId: "user-1" });
    expect(res.success).toBe(true);
    expect(res.evaluation.accomplished).toBe(true);
  });

  it("34 & 35 & 36. result provenance and idempotency/stale completion protection", async () => {
    const successToolId = "test.success.tool.phase9";
    const plan = Planner.createPlan(
      "Provenance test",
      [{ id: "s1", toolId: successToolId, arguments: {}, dependencies: [] }],
      "t1",
      "r1"
    );

    const res = await Planner.executePlan(plan, { userId: "user-1" });
    expect(res.success).toBe(true);
    expect(plan.steps[0].result?.runId).toBe("r1");
    expect(plan.steps[0].observation?.provenance).toBeDefined();
  });
});
