import { z } from "zod";
import { ReminderTool, CreateReminderSchema, UpdateReminderSchema } from "@/lib/reminder-tool";
import { FirestoreReminderRepository } from "@/lib/reminder-repo";
import { Observation, Result, Evaluation } from "@/lib/execution";

export type ToolErrorCategory =
  | "INVALID_INPUT"
  | "UNKNOWN_TOOL"
  | "UNSUPPORTED_CAPABILITY"
  | "PERMISSION_DENIED"
  | "CONFIRMATION_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CANCELLED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "DEPENDENCY_FAILURE"
  | "EXECUTION_FAILED"
  | "INTERNAL_ERROR";

export type RiskLevel = "READ" | "WRITE" | "DESTRUCTIVE" | "EXTERNAL_SIDE_EFFECT" | "SENSITIVE";

export interface ToolContext {
  userId: string | null;
  signal?: AbortSignal;
  idempotencyKey?: string;
  confirmation?: {
    confirmationId: string;
    operationId: string;
    toolId: string;
    argumentsHash: string;
    timestamp: number;
  };
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  id: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  capability: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  supportsCancellation: boolean;
  supportsIdempotency: boolean;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

export interface OperationContext {
  id: string;
  taskId: string;
  runId: string;
  stepId: string;
  toolId: string;
  arguments: unknown;
  idempotencyKey?: string;
  confirmation?: {
    confirmationId: string;
    operationId: string;
    toolId: string;
    argumentsHash: string;
    timestamp: number;
  };
}

export interface ExecutionContext {
  userId: string | null;
  signal?: AbortSignal;
}

export interface ToolExecutionRecord {
  observation: Observation;
  evaluation: Evaluation;
  result: Result;
}

/**
 * Authoritative Tool Registry implementing Phase 8 specs.
 */
class ToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>();

  register<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(definition.id)) {
      throw new Error(`Duplicate tool registration rejected: ${definition.id}`);
    }
    this.tools.set(definition.id, definition);
  }

  resolve(toolId: string): ToolDefinition {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Unknown tool ID: ${toolId}`);
    }
    return tool;
  }

  listAvailable(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  validate(toolId: string, args: unknown): { success: boolean; data?: any; error?: string } {
    try {
      const tool = this.resolve(toolId);
      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: parsed.error.errors.map(e => e.message).join(", ") };
      }
      return { success: true, data: parsed.data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

export const toolRegistry = new ToolRegistryImpl();

// In-memory idempotency cache
const idempotencyCache = new Map<string, { result: Result; observation: Observation; evaluation: Evaluation }>();

/**
 * Compute simple hash of arguments for confirmation/idempotency binding.
 */
function hashArguments(args: unknown): string {
  try {
    return JSON.stringify(args) || "";
  } catch {
    return String(args);
  }
}

/**
 * Canonical Tool Execution Boundary (executeTool)
 */
export async function executeTool(
  operation: OperationContext,
  executionContext: ExecutionContext
): Promise<ToolExecutionRecord> {
  const timestamp = Date.now();
  const baseObsId = `obs-${operation.id}`;
  const baseResultId = `res-${operation.id}`;

  // 1. Verify operation identity
  if (!operation.id || !operation.runId || !operation.stepId || !operation.taskId || !operation.toolId) {
    const observation: Observation = {
      id: baseObsId,
      runId: operation.runId || "unknown-run",
      stepId: operation.stepId,
      type: "provider_failure",
      content: "Execution request missing valid operation identity (taskId, runId, stepId, operationId, toolId).",
      provenance: "tool-runtime",
      timestamp,
    };
    const evaluation: Evaluation = {
      runId: operation.runId || "unknown-run",
      accomplished: false,
      reason: "Missing operation identity.",
    };
    const result: Result = {
      id: baseResultId,
      runId: operation.runId || "unknown-run",
      stepId: operation.stepId,
      outcome: "failure",
      evidence: "Missing operation identity.",
      timestamp,
    };
    return { observation, evaluation, result };
  }

  // 2. Check cancellation
  if (executionContext.signal?.aborted) {
    const observation: Observation = {
      id: baseObsId,
      runId: operation.runId,
      stepId: operation.stepId,
      type: "action_result",
      content: `Operation ${operation.id} cancelled before execution.`,
      provenance: "tool-runtime",
      timestamp,
    };
    const evaluation: Evaluation = {
      runId: operation.runId,
      accomplished: false,
      reason: "Operation cancelled.",
    };
    const result: Result = {
      id: baseResultId,
      runId: operation.runId,
      stepId: operation.stepId,
      outcome: "cancellation",
      evidence: "Operation cancelled by signal.",
      timestamp,
    };
    return { observation, evaluation, result };
  }

  // 3. Resolve tool
  let tool: ToolDefinition;
  try {
    tool = toolRegistry.resolve(operation.toolId);
  } catch (err: any) {
    const observation: Observation = {
      id: baseObsId,
      runId: operation.runId,
      stepId: operation.stepId,
      type: "provider_failure",
      content: `Unknown tool ID: ${operation.toolId}`,
      provenance: "tool-registry",
      timestamp,
    };
    const evaluation: Evaluation = {
      runId: operation.runId,
      accomplished: false,
      reason: `Unknown tool ID: ${operation.toolId}`,
    };
    const result: Result = {
      id: baseResultId,
      runId: operation.runId,
      stepId: operation.stepId,
      outcome: "failure",
      evidence: `UNKNOWN_TOOL: ${operation.toolId}`,
      timestamp,
    };
    return { observation, evaluation, result };
  }

  // 4. Validate input
  const validation = toolRegistry.validate(operation.toolId, operation.arguments);
  if (!validation.success) {
    const observation: Observation = {
      id: baseObsId,
      runId: operation.runId,
      stepId: operation.stepId,
      type: "provider_failure",
      content: `Invalid input for tool ${tool.id}: ${validation.error}`,
      provenance: "tool-validator",
      timestamp,
    };
    const evaluation: Evaluation = {
      runId: operation.runId,
      accomplished: false,
      reason: `INVALID_INPUT: ${validation.error}`,
    };
    const result: Result = {
      id: baseResultId,
      runId: operation.runId,
      stepId: operation.stepId,
      outcome: "failure",
      evidence: `INVALID_INPUT: ${validation.error}`,
      timestamp,
    };
    return { observation, evaluation, result };
  }

  // 5. Permission / Authentication check
  if (!executionContext.userId && tool.riskLevel !== "READ") {
    const observation: Observation = {
      id: baseObsId,
      runId: operation.runId,
      stepId: operation.stepId,
      type: "provider_failure",
      content: `Permission denied: User must be authenticated to execute ${tool.riskLevel} operation on ${tool.id}`,
      provenance: "permission-engine",
      timestamp,
    };
    const evaluation: Evaluation = {
      runId: operation.runId,
      accomplished: false,
      reason: "PERMISSION_DENIED: Unauthenticated user.",
    };
    const result: Result = {
      id: baseResultId,
      runId: operation.runId,
      stepId: operation.stepId,
      outcome: "failure",
      evidence: "PERMISSION_DENIED",
      timestamp,
    };
    return { observation, evaluation, result };
  }

  // 6. Confirmation check
  if (tool.requiresConfirmation) {
    const conf = operation.confirmation;
    const argsHash = hashArguments(validation.data);
    if (!conf || conf.operationId !== operation.id || conf.toolId !== tool.id || conf.argumentsHash !== argsHash) {
      const observation: Observation = {
        id: baseObsId,
        runId: operation.runId,
        stepId: operation.stepId,
        type: "provider_failure",
        content: `Confirmation required for tool ${tool.id}. Missing or invalid operation-specific confirmation binding.`,
        provenance: "confirmation-engine",
        timestamp,
      };
      const evaluation: Evaluation = {
        runId: operation.runId,
        accomplished: false,
        reason: "CONFIRMATION_REQUIRED",
      };
      const result: Result = {
        id: baseResultId,
        runId: operation.runId,
        stepId: operation.stepId,
        outcome: "failure",
        evidence: "CONFIRMATION_REQUIRED",
        timestamp,
      };
      return { observation, evaluation, result };
    }
  }

  // 7. Idempotency check
  const idempotencyKey = operation.idempotencyKey;
  if (tool.supportsIdempotency && idempotencyKey) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) {
      return cached;
    }
  }

  // 8. Execute tool
  try {
    const toolOutput = await tool.execute(validation.data, {
      userId: executionContext.userId,
      signal: executionContext.signal,
      idempotencyKey: operation.idempotencyKey,
      confirmation: operation.confirmation,
    });

    if (executionContext.signal?.aborted) {
      const observation: Observation = {
        id: baseObsId,
        runId: operation.runId,
        stepId: operation.stepId,
        type: "action_result",
        content: `Operation ${operation.id} was cancelled during execution.`,
        provenance: "tool-runtime",
        timestamp: Date.now(),
      };
      const evaluation: Evaluation = {
        runId: operation.runId,
        accomplished: false,
        reason: "Operation cancelled during execution.",
      };
      const result: Result = {
        id: baseResultId,
        runId: operation.runId,
        stepId: operation.stepId,
        outcome: "cancellation",
        evidence: "Cancelled during execution.",
        timestamp: Date.now(),
      };
      return { observation, evaluation, result };
    }

    const observation: Observation = {
      id: baseObsId,
      runId: operation.runId,
      stepId: operation.stepId,
      type: "tool_result",
      content: JSON.stringify(toolOutput),
      provenance: tool.id,
      timestamp: Date.now(),
    };

    const evaluation: Evaluation = {
      runId: operation.runId,
      accomplished: true,
      reason: `Tool ${tool.id} executed successfully and returned structured data.`,
    };

    const result: Result = {
      id: baseResultId,
      runId: operation.runId,
      stepId: operation.stepId,
      outcome: "success",
      evidence: JSON.stringify(toolOutput),
      timestamp: Date.now(),
    };

    const record: ToolExecutionRecord = { observation, evaluation, result };
    if (tool.supportsIdempotency && idempotencyKey) {
      idempotencyCache.set(idempotencyKey, record);
    }
    return record;
  } catch (err: any) {
    const isCancelled = executionContext.signal?.aborted || err.message === "CANCELLED";
    const outcome = isCancelled ? "cancellation" : "failure";
    const observation: Observation = {
      id: baseObsId,
      runId: operation.runId,
      stepId: operation.stepId,
      type: "provider_failure",
      content: err.message || "Tool execution failed",
      provenance: tool.id,
      timestamp: Date.now(),
    };
    const evaluation: Evaluation = {
      runId: operation.runId,
      accomplished: false,
      reason: err.message || "Tool execution failed",
    };
    const result: Result = {
      id: baseResultId,
      runId: operation.runId,
      stepId: operation.stepId,
      outcome,
      evidence: err.message || "Tool execution failed",
      timestamp: Date.now(),
    };
    return { observation, evaluation, result };
  }
}

// Register core safe tools
toolRegistry.register({
  id: "reminders.create",
  description: "Create a new reminder",
  inputSchema: CreateReminderSchema,
  capability: "reminders",
  riskLevel: "WRITE",
  requiresConfirmation: false,
  supportsCancellation: true,
  supportsIdempotency: true,
  execute: async (input, ctx) => {
    const reminderTool = new ReminderTool(ctx.userId, new FirestoreReminderRepository());
    const res = await reminderTool.createReminder(input);
    if (!res.success) throw new Error(res.error?.message || "Failed to create reminder");
    return res.data;
  },
});

toolRegistry.register({
  id: "reminders.list",
  description: "List all active reminders",
  inputSchema: z.object({}),
  capability: "reminders",
  riskLevel: "READ",
  requiresConfirmation: false,
  supportsCancellation: true,
  supportsIdempotency: true,
  execute: async (_, ctx) => {
    const reminderTool = new ReminderTool(ctx.userId, new FirestoreReminderRepository());
    const res = await reminderTool.listReminders();
    if (!res.success) throw new Error(res.error?.message || "Failed to list reminders");
    return res.data;
  },
});

toolRegistry.register({
  id: "reminders.delete",
  description: "Delete a reminder by ID or query",
  inputSchema: UpdateReminderSchema.pick({ idOrQuery: true }).extend({
    idOrQuery: z.string().min(1),
  }),
  capability: "reminders",
  riskLevel: "DESTRUCTIVE",
  requiresConfirmation: true,
  supportsCancellation: true,
  supportsIdempotency: false,
  execute: async (input, ctx) => {
    const reminderTool = new ReminderTool(ctx.userId, new FirestoreReminderRepository());
    const res = await reminderTool.deleteReminder(input.idOrQuery);
    if (!res.success) throw new Error(res.error?.message || "Failed to delete reminder");
    return res.data;
  },
});

export function getReminderTool(userId: string | null) {
  return {
    createReminder: (input: any) => executeTool({
      id: `op-create-${Date.now()}`,
      taskId: 'default-task',
      runId: 'default-run',
      stepId: 'default-step',
      toolId: 'reminders.create',
      arguments: input
    }, { userId }),
    listReminders: () => executeTool({
      id: `op-list-${Date.now()}`,
      taskId: 'default-task',
      runId: 'default-run',
      stepId: 'default-step',
      toolId: 'reminders.list',
      arguments: {}
    }, { userId }),
    deleteReminder: (idOrQuery: string, conf?: any) => executeTool({
      id: `op-delete-${Date.now()}`,
      taskId: 'default-task',
      runId: 'default-run',
      stepId: 'default-step',
      toolId: 'reminders.delete',
      arguments: { idOrQuery },
      confirmation: conf
    }, { userId })
  };
}
