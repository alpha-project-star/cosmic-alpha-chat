import { describe, expect, it, vi, beforeEach } from "vitest";
import { finalizeReply, NativeToolExecutionSummary, DEFAULT_SYSTEM } from "../src/lib/alpha.functions";
import { stripLeakedThinking } from "../src/lib/openai-compat";
import { REMINDER_TOOLS } from "../src/lib/reminder-tool-definitions";
import { CreateReminderSchema, UpdateReminderSchema } from "../src/lib/reminder-tool";
import { interpretReminderDate } from "../src/lib/reminder-date-utils";
import { NO_ACTION_NOTICE } from "../src/lib/actions";
import { alphaStore } from "../src/lib/alpha-store";

describe("ALPHA — DEF-01 / DEF-02 / DEF-03 Forensic Repair Verification", () => {
  // =========================================================================
  // DEF-01: False NO_ACTION_NOTICE after successful native tool execution
  // =========================================================================
  describe("DEF-01: Native Tool Execution Parity & Mutation Truth", () => {
    it("Test A: When a native tool executes successfully, finalizeReply does NOT append NO_ACTION_NOTICE", async () => {
      const modelProse = "I've created your reminder for tomorrow at 9 AM.";
      const summary: NativeToolExecutionSummary = {
        executedCount: 1,
        hasMutation: true,
        allMutationsSucceeded: true,
        hasFailedMutation: false,
        results: [{ name: "createReminder", success: true, isMutation: true }],
      };

      const result = await finalizeReply(modelProse, "", summary);
      expect(result).not.toContain(NO_ACTION_NOTICE);
      expect(result).toBe(modelProse);
    });

    it("Test B: When a native tool fails, finalizeReply still prevents false success claims", async () => {
      const modelProse = "I've created your reminder for tomorrow at 9 AM.";
      const summary: NativeToolExecutionSummary = {
        executedCount: 1,
        hasMutation: true,
        allMutationsSucceeded: false,
        hasFailedMutation: true,
        results: [
          {
            name: "createReminder",
            success: false,
            isMutation: true,
            error: { message: "The due time must be in the future." },
          },
        ],
      };

      const result = await finalizeReply(modelProse, "", summary);
      // Must flag that no mutation took place and report the failure
      expect(result).toContain(NO_ACTION_NOTICE);
      expect(result).toContain("❌ The due time must be in the future.");
    });

    it("Test C: Legacy action tags still work without regression", async () => {
      const rawWithTag = "Here is the note you requested.\n[[ADD_NOTE: Groceries | Buy milk and eggs]]";
      const result = await finalizeReply(rawWithTag, "");

      expect(result).not.toContain(NO_ACTION_NOTICE);
      expect(result).toContain("Note saved");
      expect(result).toContain("Groceries");
    });

    it("Test D: Mixed turns (legacy tags + native tools) behave correctly", async () => {
      const raw = "I updated both.\n[[ADD_NOTE: Meeting | Notes from 2pm]]";
      const summary: NativeToolExecutionSummary = {
        executedCount: 1,
        hasMutation: true,
        allMutationsSucceeded: true,
        hasFailedMutation: false,
        results: [{ name: "createReminder", success: true, isMutation: true }],
      };

      const result = await finalizeReply(raw, "", summary);
      expect(result).not.toContain(NO_ACTION_NOTICE);
      expect(result).toContain("Note saved");
      expect(result).toContain("Meeting");
    });

    it("Test E: Conversational turns without tools or tags continue behaving correctly", async () => {
      const conversational = "Hello Alex! I am here to help. What would you like to work on today?";
      const result = await finalizeReply(conversational, "");

      expect(result).toBe(conversational);
      expect(result).not.toContain(NO_ACTION_NOTICE);
      expect(result).not.toContain("Action log");
    });
  });

  // =========================================================================
  // DEF-02: Standalone <think> reasoning leakage
  // =========================================================================
  describe("DEF-02: Standalone and Embedded Thinking Strip Discipline", () => {
    it("Test A: A response consisting ONLY of a <think>...</think> block is completely stripped to empty string", () => {
      const rawOnlyThink = "<think>\nLet me analyze what the user wants.\nStep 1: Check context.\nStep 2: Respond.\n</think>";
      const cleaned = stripLeakedThinking(rawOnlyThink);
      expect(cleaned).toBe("");

      const rawOnlyReasoning = "<reasoning>Internal thought process</reasoning>";
      expect(stripLeakedThinking(rawOnlyReasoning)).toBe("");
    });

    it("Test B: A response with thinking followed by actual answer preserves the answer and strips thinking", () => {
      const raw = "<think>Alex is asking about the weather.</think>The forecast shows sunny skies with a high of 72°F.";
      const cleaned = stripLeakedThinking(raw);
      expect(cleaned).toBe("The forecast shows sunny skies with a high of 72°F.");
    });

    it("Test C: Malformed / unclosed <think> blocks are stripped safely", () => {
      const unclosed = "<think>This thinking block never closed and ran off the end";
      const cleaned = stripLeakedThinking(unclosed);
      expect(cleaned).toBe("");
    });

    it("Test D: Thinking process headers are stripped cleanly", () => {
      const rawWithHeader =
        "Thinking Process:\n1. Understand user intent\n2. Formulate response\n\nFinal Answer: Good afternoon! How can I assist you?";
      const cleaned = stripLeakedThinking(rawWithHeader);
      expect(cleaned).toBe("Good afternoon! How can I assist you?");
    });

    it("Test E: Thinking blocks never leak to chat history, TTS, or UI (returns empty string for 502 rejection)", () => {
      const leakedCandidate = "<think>Confidential planning scratchpad</think>";
      const normalized = stripLeakedThinking(leakedCandidate);
      // Must be empty string so sendChatOpenAICompat throws and triggers next provider fallback
      expect(normalized).toBe("");
      expect(normalized).not.toContain("Confidential planning");
    });
  });

  // =========================================================================
  // DEF-03: Contradictory dueAt contract alignment
  // =========================================================================
  describe("DEF-03: dueAt Contract & Temporal Parsing Alignment", () => {
    it("Test A: System prompt and reminder tool schema no longer contradict each other", () => {
      const promptText = DEFAULT_SYSTEM();
      // System prompt must NOT mandate unix timestamp only
      expect(promptText).not.toContain("ALWAYS provide a clear title and a unix timestamp in ms for `dueAt`");
      expect(promptText).toContain("natural-language date/time string like \"tomorrow at 9am\" or a unix timestamp");

      // Tool definition must explicitly describe both natural language and timestamp
      const createReminderTool = REMINDER_TOOLS.find((t) => t.function.name === "createReminder");
      expect(createReminderTool).toBeDefined();
      const dueAtDesc = createReminderTool?.function.parameters.properties.dueAt.description;
      expect(dueAtDesc).toContain("natural-language");
      expect(dueAtDesc).toContain("unix timestamp");
    });

    it("Test B: Natural-language dueAt still validates and parses correctly", () => {
      const parsed = CreateReminderSchema.safeParse({
        title: "Dentist appointment",
        dueAt: "tomorrow at 9 AM",
      });
      expect(parsed.success).toBe(true);

      const refDate = new Date("2026-09-11T12:00:00Z");
      const resolvedTimestamp = interpretReminderDate("tomorrow at 9 AM", refDate);
      expect(resolvedTimestamp).toBeTypeOf("number");
      expect(resolvedTimestamp).toBeGreaterThan(refDate.getTime());
    });

    it("Test C: Unix-millisecond dueAt still validates and parses correctly", () => {
      const futureMs = Date.now() + 3600 * 1000;
      const parsed = CreateReminderSchema.safeParse({
        title: "Quick sync",
        dueAt: futureMs,
      });
      expect(parsed.success).toBe(true);

      const resolvedTimestamp = interpretReminderDate(futureMs, new Date());
      expect(resolvedTimestamp).toBe(futureMs);
    });

    it("Test D: Existing deterministic temporal normalization remains unchanged", () => {
      const refDate = new Date("2026-09-11T10:00:00.000Z");
      const in2Hours = interpretReminderDate("in 2 hours", refDate);
      expect(in2Hours).toBe(refDate.getTime() + 2 * 3600 * 1000);

      const in30Mins = interpretReminderDate("in 30 minutes", refDate);
      expect(in30Mins).toBe(refDate.getTime() + 30 * 60 * 1000);
    });

    it("Test E: Ambiguous dates continue using existing Alpha temporal handling rather than model guesswork", () => {
      const refDate = new Date("2026-09-11T10:00:00.000Z");
      // Ambiguous/unparseable natural language returns null (no model guessing)
      const invalidResult = interpretReminderDate("sometime later maybe when I'm free", refDate);
      expect(invalidResult).toBeNull();
    });
  });
});
