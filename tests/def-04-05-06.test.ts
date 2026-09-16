import { describe, expect, it, vi, beforeEach } from "vitest";
import { alphaStore, conversationSummary } from "../src/lib/alpha-store";
import * as openaiCompat from "../src/lib/openai-compat";
import * as auth from "firebase/auth";
import * as toolRegistry from "../src/lib/tool-registry";
import { tryLocalIntent } from "../src/lib/local-intents";
import {
  ctxSummary,
  rerankContext,
  sendChat,
  finalizeReply,
  type NativeToolExecutionSummary,
} from "../src/lib/alpha.functions";
import type { FirestoreReminder } from "../src/lib/reminder-repo";
import { NO_ACTION_NOTICE } from "../src/lib/actions";

// Mock dependencies for testing sendChat and local intents
vi.mock("../src/lib/alpha-store", () => ({
  alphaStore: {
    get: vi.fn(() => ({
      settings: {
        openRouterKey: "sk-ant-test-key-123",
        groqApiKey: "sk-ant-test-key-123",
        openaiCompatKey: "sk-ant-test-key-123",
        taskModels: {},
        ollamaEndpoint: "",
      },
      profile: { name: "Alex" },
      chat: [],
      notes: [],
      bills: [],
      reminders: [],
      plans: [],
      memories: [],
    })),
    sub: vi.fn(),
    appendChat: vi.fn(),
    
    
  },
  conversationSummary: { get: vi.fn(), set: vi.fn() },
  uid: vi.fn(() => "msg-123"),
}));

vi.mock("../src/lib/openai-compat", () => ({
  sendChatOpenAICompat: vi.fn(),
  stripLeakedThinking: vi.fn((t) => t),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({ currentUser: { uid: "user-123" } })),
}));

vi.mock("../src/lib/tool-registry", () => ({
  getReminderTool: vi.fn(),
}));

vi.mock("../src/lib/activity", () => ({
  activity: { set: vi.fn(), clear: vi.fn() },
}));

vi.mock("../src/lib/web-search", () => ({
  decideSearch: vi.fn(() => ({ search: false })),
  SEARCH_FORBIDDEN_HINT: "HINT_FORBIDDEN",
  SEARCH_OFFER_HINT: "HINT_OFFER",
  SEARCH_CAPABILITY_HINT: "HINT_CAPABILITY",
}));

vi.mock("../src/lib/models", () => ({
  MODEL_TRIO: {
    primary: "openrouter:primary-model",
    fast: "groq:fast-model",
    capable: "openai:capable-model",
    coding: "openrouter:coding-model",
  },
  TEXT_FALLBACKS: [
    { prov: "openrouter", model: "primary-model" },
    { prov: "groq", model: "fast-model" },
  ],
  VISION_FALLBACKS: [],
  GROQ_EMERGENCY_MODEL: "fast-model",
  MAX_OUTPUT_TOKENS: { fast: 100, auto: 100, thinking: 100, coding: 100, vision: 100 },
  HISTORY_TURNS: { fast: 5, auto: 5, thinking: 5, coding: 5, vision: 5 },
  parseRouteSpec: (s: string) => {
    const [p, m] = (s || "").split(":");
    return { prov: p as any, model: m || "" };
  },
  routeLabel: (p: string, m: string) => `${m} (${p})`,
}));

vi.mock("../src/lib/ollama", () => ({
  sendChatOllama: vi.fn().mockResolvedValue("Ollama response"),
}));

vi.mock("../src/lib/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/actions")>();
  return {
    ...actual,
    executeActionTags: vi.fn((t) => ({ text: t, results: [] })),
    renderActionReport: vi.fn(() => ""),
  };
});

describe("ALPHA — DEF-04 / DEF-05 / DEF-06 Surgical Repair Verification Matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    (auth.getAuth as any).mockReturnValue({ currentUser: { uid: "user-123" } });
    (alphaStore.get as any).mockReturnValue({
      settings: {
        openRouterKey: "sk-ant-test-key-123",
        groqApiKey: "sk-ant-test-key-123",
        openaiCompatKey: "sk-ant-test-key-123",
        taskModels: {},
        ollamaEndpoint: "",
      },
      profile: { name: "Alex" },
      chat: [],
      notes: [],
      bills: [],
      reminders: [],
      plans: [],
      memories: [],
    });
  });

  // =========================================================================
  // DEF-04: Provider fallback must not re-execute completed mutations
  // =========================================================================
  describe("DEF-04: Mutation Idempotence and Provider Fallback State Preservation", () => {
    it("Test A: Provider fallback after createReminder does not invoke createReminder again", async () => {
      const mockTool = {
        createReminder: vi.fn().mockResolvedValue({
          success: true,
          operation: "createReminder",
          data: { id: "rem-1", title: "Team standup", reminderState: "active" },
        }),
        listReminders: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      // Provider 1 (openrouter):
      // Turn 1: requests createReminder
      // Turn 2: throws 429 Rate Limit
      const rateLimitError = new Error("Rate limit exceeded");
      (rateLimitError as any).status = 429;

      (openaiCompat.sendChatOpenAICompat as any)
        .mockResolvedValueOnce({
          content: "Creating your reminder...",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "createReminder",
                arguments: JSON.stringify({ title: "Team standup", dueAt: "tomorrow 9am" }),
              },
            },
          ],
        })
        .mockRejectedValueOnce(rateLimitError)
        // Provider 2 (groq) fallback:
        // receives history with completed tool execution and generates final prose
        .mockResolvedValueOnce({
          content: "I have set your reminder for Team standup tomorrow at 9 AM.",
          tool_calls: [],
        });

      const history = [{ id: "h1", role: "user", text: "Remind me for team standup tomorrow at 9am", ts: Date.now() }] as any;
      const result = await sendChat(history);

      expect(result).toBe("I have set your reminder for Team standup tomorrow at 9 AM.");
      // MUST only execute createReminder once!
      expect(mockTool.createReminder).toHaveBeenCalledTimes(1);
      expect(result).not.toContain(NO_ACTION_NOTICE);
    });

    it("Test B: Provider fallback after deleteReminder does not invoke deleteReminder again", async () => {
      const mockTool = {
        deleteReminder: vi.fn().mockResolvedValue({
          success: true,
          operation: "deleteReminder",
          data: { id: "rem-del-1", title: "Dentist" },
        }),
        listReminders: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      const gatewayError = new Error("Bad Gateway");
      (gatewayError as any).status = 502;

      (openaiCompat.sendChatOpenAICompat as any)
        .mockResolvedValueOnce({
          content: "Deleting reminder...",
          tool_calls: [
            {
              id: "call-del-1",
              type: "function",
              function: {
                name: "deleteReminder",
                arguments: JSON.stringify({ idOrQuery: "Dentist" }),
              },
            },
          ],
        })
        .mockRejectedValueOnce(gatewayError)
        // Provider 2 fallback:
        .mockResolvedValueOnce({
          content: "I have deleted your dentist appointment reminder.",
          tool_calls: [],
        });

      const history = [{ id: "h2", role: "user", text: "Delete dentist reminder", ts: Date.now() }] as any;
      const result = await sendChat(history);

      expect(result).toBe("I have deleted your dentist appointment reminder.");
      expect(mockTool.deleteReminder).toHaveBeenCalledTimes(1);
      expect(result).not.toContain(NO_ACTION_NOTICE);
    });

    it("Test C: Provider fallback after completeReminder does not invoke completeReminder again", async () => {
      const mockTool = {
        completeReminder: vi.fn().mockResolvedValue({
          success: true,
          operation: "completeReminder",
          data: { id: "rem-done-1", title: "Submit taxes", reminderState: "completed" },
        }),
        listReminders: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      const timeoutError = new Error("Gateway Timeout");
      (timeoutError as any).status = 504;

      (openaiCompat.sendChatOpenAICompat as any)
        .mockResolvedValueOnce({
          content: "Marking as completed...",
          tool_calls: [
            {
              id: "call-done-1",
              type: "function",
              function: {
                name: "completeReminder",
                arguments: JSON.stringify({ idOrQuery: "Submit taxes" }),
              },
            },
          ],
        })
        .mockRejectedValueOnce(timeoutError)
        // Provider 2 fallback:
        .mockResolvedValueOnce({
          content: "Marked your Submit taxes reminder as done.",
          tool_calls: [],
        });

      const history = [{ id: "h3", role: "user", text: "Please use your tools to complete the reminder for Submit taxes", ts: Date.now() }] as any;
      const result = await sendChat(history);

      expect(result).toBe("Marked your Submit taxes reminder as done.");
      expect(mockTool.completeReminder).toHaveBeenCalledTimes(1);
      expect(result).not.toContain(NO_ACTION_NOTICE);
    });

    it("Test D: Failed mutation on Provider A is NOT marked succeeded on fallback", async () => {
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
            error: { message: "Validation error: due date must be in future" },
          },
        ],
      };

      const result = await finalizeReply("I've added that reminder for you.", "", summary);
      // Because allMutationsSucceeded is false, NO_ACTION_NOTICE must be present
      expect(result).toContain(NO_ACTION_NOTICE);
      expect(result).toContain("Validation error");
    });

    it("Test E: Multiple mutations in turn — all completed before fallback are preserved, unexecuted ones execute once", async () => {
      const mockTool = {
        createReminder: vi.fn().mockResolvedValue({
          success: true,
          operation: "createReminder",
          data: { id: "rem-e1", title: "Review PR" },
        }),
        completeReminder: vi.fn().mockResolvedValue({
          success: true,
          operation: "completeReminder",
          data: { id: "rem-e2", title: "Write tests" },
        }),
        listReminders: vi.fn().mockResolvedValue({ success: true, data: [] }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      const rateLimitError = new Error("Rate limit exceeded");
      (rateLimitError as any).status = 429;

      // Provider 1 issues two tool calls in the same turn:
      (openaiCompat.sendChatOpenAICompat as any)
        .mockResolvedValueOnce({
          content: "Executing requested changes...",
          tool_calls: [
            {
              id: "call-e1",
              type: "function",
              function: {
                name: "createReminder",
                arguments: JSON.stringify({ title: "Review PR", dueAt: "today at 5pm" }),
              },
            },
            {
              id: "call-e2",
              type: "function",
              function: {
                name: "completeReminder",
                arguments: JSON.stringify({ idOrQuery: "Write tests" }),
              },
            },
          ],
        })
        .mockRejectedValueOnce(rateLimitError)
        // Provider 2 completes:
        .mockResolvedValueOnce({
          content: "Done — created Review PR and completed Write tests.",
          tool_calls: [],
        });

      const history = [{ id: "h-multi", role: "user", text: "Create PR reminder and complete tests", ts: Date.now() }] as any;
      const result = await sendChat(history);

      expect(result).toBe("Done — created Review PR and completed Write tests.");
      expect(mockTool.createReminder).toHaveBeenCalledTimes(1);
      expect(mockTool.completeReminder).toHaveBeenCalledTimes(1);
      expect(result).not.toContain(NO_ACTION_NOTICE);
    });
  });

  // =========================================================================
  // DEF-05: Local intent reminders must route through authoritative ReminderTool
  // =========================================================================
  describe("DEF-05: Local Intent Reminders Route Through Authoritative ReminderTool", () => {
    it("Test F: Local intent 'remind me to...' calls ReminderTool.createReminder", async () => {
      const mockTool = {
        createReminder: vi.fn().mockResolvedValue({
          success: true,
          operation: "createReminder",
          data: { id: "rem-f", title: "buy milk" },
        }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      const reply = await tryLocalIntent("remind me to buy milk at tomorrow at 10am");

      expect(mockTool.createReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "buy milk",
        }),
      );
      
      expect(reply).toContain("Done — reminder added: \"buy milk\"");
    });

    it("Test G: Local intent 'what are my reminders' calls ReminderTool.listReminders", async () => {
      const mockTool = {
        listReminders: vi.fn().mockResolvedValue({
          success: true,
          operation: "listReminders",
          data: [
            { id: "rem-g1", title: "Doctor appointment", reminderState: "active" },
          ],
        }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      const reply = await tryLocalIntent("what are my reminders");

      expect(mockTool.listReminders).toHaveBeenCalledTimes(1);
      expect(reply).toContain("**Reminders:**");
      expect(reply).toContain("Doctor appointment");
    });

    it("Test H: Local intent 'clear all reminders' calls ReminderTool.deleteReminder for all items", async () => {
      const mockTool = {
        listReminders: vi.fn().mockResolvedValue({
          success: true,
          operation: "listReminders",
          data: [
            { id: "rem-h1", title: "Item 1" },
            { id: "rem-h2", title: "Item 2" },
          ],
        }),
        deleteReminder: vi.fn().mockResolvedValue({ success: true, operation: "deleteReminder", data: { title: "Item" } }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      const reply = await tryLocalIntent("clear all reminders");

      expect(mockTool.listReminders).toHaveBeenCalledTimes(1);
      expect(mockTool.deleteReminder).toHaveBeenCalledTimes(2);
      expect(mockTool.deleteReminder).toHaveBeenCalledWith("rem-h1");
      expect(mockTool.deleteReminder).toHaveBeenCalledWith("rem-h2");
      
      expect(reply).toBe("Cleared all 2 reminders.");
    });

    it("Test I: Local intent 'mark X as done' calls ReminderTool.completeReminder", async () => {
      const mockTool = {
        completeReminder: vi.fn().mockResolvedValue({
          success: true,
          operation: "completeReminder",
          data: { id: "rem-i1", title: "dentist appointment", reminderState: "completed" },
        }),
      };
      (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

      const reply = await tryLocalIntent("mark dentist appointment as done");

      expect(mockTool.completeReminder).toHaveBeenCalledWith("dentist appointment");
      
      expect(reply).toBe('Marked reminder "dentist appointment" as done.');
    });

    it("Test J: Local intent with unauthenticated user fails safely without corrupting local state", async () => {
      (auth.getAuth as any).mockReturnValue({ currentUser: null });

      const reply = await tryLocalIntent("remind me to call mom at 5pm");

      expect(reply).toBe("You need to be signed in to manage reminders.");
      
    });
  });

  // =========================================================================
  // DEF-06: Context retrieval and rerankContext must read from authoritative store
  // =========================================================================
  describe("DEF-06: Context Retrieval from Authoritative Store", () => {
    it("Test K: ctxSummary reflects Firestore reminders, NOT alphaStore.reminders", () => {
      // Setup stale reminder in alphaStore
      (alphaStore.get as any).mockReturnValue({
        settings: { buildRecord: "" },
        profile: { name: "Alex" },
        chat: [],
        notes: [],
        bills: [],
        reminders: [
          { id: "stale-1", title: "STALE_LOCAL_REMINDER", when: "2026-01-01", notes: "", done: "no" },
        ],
        plans: [],
        memories: [],
      });

      const authoritativeReminders: FirestoreReminder[] = [
        {
          id: "firestore-1",
          userId: "user-123",
          title: "AUTHORITATIVE_FIRESTORE_REMINDER",
          dueAt: Date.now() + 3600000,
          
          reminderState: "active",
          source: "voice",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      const summary = ctxSummary(authoritativeReminders);

      expect(summary).toContain("AUTHORITATIVE_FIRESTORE_REMINDER");
      expect(summary).not.toContain("STALE_LOCAL_REMINDER");
    });

    it("Test L: rerankContext matches queries against Firestore reminders, NOT alphaStore.reminders", () => {
      (alphaStore.get as any).mockReturnValue({
        settings: {},
        profile: { name: "Alex" },
        chat: [],
        notes: [],
        bills: [],
        reminders: [
          { id: "stale-2", title: "STALE_LOCAL_GROCERIES", when: "2026-01-01", notes: "", done: "no" },
        ],
        plans: [],
        memories: [],
      });

      const authoritativeReminders: FirestoreReminder[] = [
        {
          id: "firestore-2",
          userId: "user-123",
          title: "Buy organic eggs at Trader Joes",
          notes: "Get the pasture raised ones",
          dueAt: Date.now() + 3600000,
          
          reminderState: "active",
          source: "voice",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      const retrieved = rerankContext("Trader Joes organic eggs", authoritativeReminders);

      expect(retrieved).toContain("Buy organic eggs at Trader Joes");
      expect(retrieved).not.toContain("STALE_LOCAL_GROCERIES");
    });
  });
});
