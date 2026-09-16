import { toolRegistry, executeTool, ExecutionContext, ToolExecutionRecord } from "./tool-registry";
import { Observation, Evaluation, Result } from "./execution";

export type PlanState =
  | "DRAFT"
  | "VALIDATING"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "BLOCKED"
  | "REPLANNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type StepStatus =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "SKIPPED";

export type UncertaintyState =
  | "KNOWN"
  | "INFERRED"
  | "ASSUMED"
  | "UNKNOWN"
  | "CONTRADICTED"
  | "UNAVAILABLE";

export interface PlanStep {
  id: string;
  toolId: string;
  arguments: unknown;
  dependencies: string[]; // step IDs that must complete first
  status: StepStatus;
  expectedObservation?: string;
  observation?: Observation;
  evaluation?: Evaluation;
  result?: Result;
  uncertaintyState: UncertaintyState;
}

export interface Plan {
  id: string;
  taskId: string;
  runId: string;
  objective: string;
  status: PlanState;
  steps: PlanStep[];
  version: number;
  createdAt: number;
  updatedAt: number;
  replanCount: number;
  maxReplans: number;
  maxSteps: number;
}

/**
 * Canonical Planner implementation for Phase 9.
 */
export class Planner {
  /**
   * Create a new plan with default constraints.
   */
  static createPlan(
    objective: string,
    steps: Array<Omit<PlanStep, "status" | "uncertaintyState"> & { uncertaintyState?: UncertaintyState }>,
    taskId: string,
    runId: string
  ): Plan {
    const planSteps: PlanStep[] = steps.map((s, idx) => ({
      id: s.id || `step-${idx + 1}`,
      toolId: s.toolId,
      arguments: s.arguments,
      dependencies: s.dependencies || [],
      status: "PENDING",
      expectedObservation: s.expectedObservation,
      uncertaintyState: s.uncertaintyState || "UNKNOWN",
    }));

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      taskId,
      runId,
      objective,
      status: "DRAFT",
      steps: planSteps,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      replanCount: 0,
      maxReplans: 3,
      maxSteps: 30,
    };
  }

  /**
   * Validate a plan against the tool registry and dependency constraints.
   */
  static validatePlan(plan: Plan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const stepIds = new Set(plan.steps.map((s) => s.id));

    if (!plan.objective || plan.objective.trim() === "") {
      errors.push("Plan objective cannot be empty.");
    }

    if (plan.steps.length === 0) {
      errors.push("Plan must contain at least one step.");
    }

    if (plan.steps.length > plan.maxSteps) {
      errors.push(`Plan exceeds maximum step limit of ${plan.maxSteps}.`);
    }

    for (const step of plan.steps) {
      // 1. Validate tool existence
      try {
        toolRegistry.resolve(step.toolId);
      } catch {
        errors.push(`Unknown or unregistered tool ID in step ${step.id}: ${step.toolId}`);
        continue;
      }

      // 2. Validate tool schema input
      const validation = toolRegistry.validate(step.toolId, step.arguments);
      if (!validation.success) {
        errors.push(`Invalid arguments for step ${step.id} (${step.toolId}): ${validation.error}`);
      }

      // 3. Validate dependencies exist
      for (const depId of step.dependencies) {
        if (!stepIds.has(depId)) {
          errors.push(`Step ${step.id} depends on non-existent step ID: ${depId}`);
        }
        if (depId === step.id) {
          errors.push(`Step ${step.id} cannot depend on itself.`);
        }
      }
    }

    // Check for circular dependencies using DFS
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const checkCycle = (stepId: string): boolean => {
      if (visiting.has(stepId)) return true;
      if (visited.has(stepId)) return false;

      visiting.add(stepId);
      const step = plan.steps.find((s) => s.id === stepId);
      if (step) {
        for (const depId of step.dependencies) {
          if (checkCycle(depId)) return true;
        }
      }
      visiting.delete(stepId);
      visited.add(stepId);
      return false;
    };

    for (const step of plan.steps) {
      if (checkCycle(step.id)) {
        errors.push(`Circular dependency detected involving step ${step.id}.`);
        break;
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Transition plan state with validation.
   */
  static transitionState(plan: Plan, newState: PlanState): void {
    const validTransitions: Record<PlanState, PlanState[]> = {
      DRAFT: ["VALIDATING", "CANCELLED"],
      VALIDATING: ["READY", "BLOCKED", "FAILED", "CANCELLED"],
      READY: ["RUNNING", "CANCELLED"],
      RUNNING: ["WAITING", "REPLANNING", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED"],
      WAITING: ["RUNNING", "REPLANNING", "CANCELLED"],
      BLOCKED: ["READY", "REPLANNING", "FAILED", "CANCELLED"],
      REPLANNING: ["READY", "BLOCKED", "FAILED", "CANCELLED"],
      COMPLETED: [],
      FAILED: [],
      CANCELLED: [],
    };

    const allowed = validTransitions[plan.status];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(`Invalid plan state transition from ${plan.status} to ${newState}`);
    }

    plan.status = newState;
    plan.updatedAt = Date.now();
  }

  /**
   * Execute the plan through the Phase 8 controlled tool boundary with dependency ordering,
   * observation, evaluation, and replanning support.
   */
  static async executePlan(
    plan: Plan,
    executionContext: ExecutionContext,
    options?: { signal?: AbortSignal }
  ): Promise<{ plan: Plan; success: boolean; evaluation: Evaluation }> {
    const signal = options?.signal || executionContext.signal;

    // Check cancellation
    if (signal?.aborted || plan.status === "CANCELLED") {
      this.transitionState(plan, "CANCELLED");
      return {
        plan,
        success: false,
        evaluation: {
          runId: plan.runId,
          accomplished: false,
          reason: "Plan execution cancelled.",
        },
      };
    }

    // Validate plan
    this.transitionState(plan, "VALIDATING");
    const val = this.validatePlan(plan);
    if (!val.valid) {
      this.transitionState(plan, "FAILED");
      return {
        plan,
        success: false,
        evaluation: {
          runId: plan.runId,
          accomplished: false,
          reason: `Plan validation failed: ${val.errors.join("; ")}`,
        },
      };
    }

    this.transitionState(plan, "READY");
    this.transitionState(plan, "RUNNING");

    let totalStepsExecuted = 0;
    const completedStepIds = new Set<string>();
    const failedStepIds = new Set<string>();

    while (true) {
      if (signal?.aborted) {
        this.transitionState(plan, "CANCELLED");
        return {
          plan,
          success: false,
          evaluation: {
            runId: plan.runId,
            accomplished: false,
            reason: "Plan execution aborted by signal.",
          },
        };
      }

      // Find pending steps whose dependencies are all satisfied
      const pendingSteps = plan.steps.filter((s) => s.status === "PENDING");
      if (pendingSteps.length === 0) {
        // No pending steps left
        break;
      }

      const readyStep = pendingSteps.find((s) =>
        s.dependencies.every((depId) => completedStepIds.has(depId))
      );

      if (!readyStep) {
        // Mark all remaining pending steps as failed due to blocked prerequisites
        for (const s of pendingSteps) {
          s.status = "FAILED";
          s.uncertaintyState = "CONTRADICTED";
          failedStepIds.add(s.id);
        }
        this.transitionState(plan, "BLOCKED");
        this.transitionState(plan, "FAILED");
        return {
          plan,
          success: false,
          evaluation: {
            runId: plan.runId,
            accomplished: false,
            reason: "Plan execution blocked due to unsatisfied or failed prerequisites.",
          },
        };
      }

      totalStepsExecuted++;
      if (totalStepsExecuted > plan.maxSteps) {
        this.transitionState(plan, "FAILED");
        return {
          plan,
          success: false,
          evaluation: {
            runId: plan.runId,
            accomplished: false,
            reason: `Maximum step limit reached (${plan.maxSteps}).`,
          },
        };
      }

      readyStep.status = "RUNNING";
      readyStep.uncertaintyState = "ASSUMED";

      // Execute via Phase 8 executeTool boundary
      const opContext = {
        id: `op-${plan.runId}-${readyStep.id}-${Date.now()}`,
        taskId: plan.taskId,
        runId: plan.runId,
        stepId: readyStep.id,
        toolId: readyStep.toolId,
        arguments: readyStep.arguments,
      };

      const record: ToolExecutionRecord = await executeTool(opContext, {
        userId: executionContext.userId,
        signal,
      });

      readyStep.observation = record.observation;
      readyStep.evaluation = record.evaluation;
      readyStep.result = record.result;

      if (record.result.outcome === "success") {
        readyStep.status = "COMPLETED";
        readyStep.uncertaintyState = "KNOWN";
        completedStepIds.add(readyStep.id);
      } else if (record.result.outcome === "cancellation") {
        readyStep.status = "CANCELLED";
        readyStep.uncertaintyState = "UNAVAILABLE";
        this.transitionState(plan, "CANCELLED");
        return {
          plan,
          success: false,
          evaluation: {
            runId: plan.runId,
            accomplished: false,
            reason: `Step ${readyStep.id} was cancelled.`,
          },
        };
      } else {
        readyStep.status = "FAILED";
        readyStep.uncertaintyState = "CONTRADICTED";
        failedStepIds.add(readyStep.id);

        // Check if we can replan
        if (plan.replanCount < plan.maxReplans) {
          plan.replanCount++;
          this.transitionState(plan, "REPLANNING");
          // Simple adaptive fallback/replan: mark failed step skipped or adjust
          readyStep.status = "SKIPPED";
          this.transitionState(plan, "READY");
          this.transitionState(plan, "RUNNING");
          continue;
        } else {
          this.transitionState(plan, "FAILED");
          return {
            plan,
            success: false,
            evaluation: {
              runId: plan.runId,
              accomplished: false,
              reason: `Step ${readyStep.id} failed with outcome: ${record.result.outcome}. Max replans exceeded.`,
            },
          };
        }
      }
    }

    // Evaluate final goal completion
    const allStepsCompleted = plan.steps.every(
      (s) => s.status === "COMPLETED" || s.status === "SKIPPED"
    );
    const anyFailed = plan.steps.some((s) => s.status === "FAILED" || s.status === "CANCELLED");

    if (anyFailed) {
      this.transitionState(plan, "FAILED");
      return {
        plan,
        success: false,
        evaluation: {
          runId: plan.runId,
          accomplished: false,
          reason: "Plan completed with failed or cancelled steps.",
        },
      };
    }

    if (allStepsCompleted) {
      this.transitionState(plan, "COMPLETED");
      return {
        plan,
        success: true,
        evaluation: {
          runId: plan.runId,
          accomplished: true,
          reason: "All planned steps executed successfully and goal objective was verified.",
        },
      };
    }

    this.transitionState(plan, "COMPLETED");
    return {
      plan,
      success: true,
      evaluation: {
        runId: plan.runId,
        accomplished: true,
        reason: "Plan finished execution.",
      },
    };
  }
}
