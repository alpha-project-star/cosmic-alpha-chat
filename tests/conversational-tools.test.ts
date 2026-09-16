import { describe, expect, it, vi, beforeEach } from "vitest";
import { alphaStore, conversationSummary } from "../src/lib/alpha-store";
import * as openaiCompat from "../src/lib/openai-compat";
import * as auth from "firebase/auth";
import * as toolRegistry from "../src/lib/tool-registry";

// Mock dependencies
vi.mock("../src/lib/alpha-store", () => ({
  alphaStore: {
    get: vi.fn(() => ({
      settings: {
        openRouterKey: "sk-ant-test-key-123",
        groqApiKey: "sk-ant-test-key-123",
        openaiCompatKey: "sk-ant-test-key-123",
        taskModels: {},
        ollamaEndpoint: "" // Disable Ollama fallback in tests
      },
      profile: { name: "Alex" },
      chat: [],
      notes: [],
      bills: [],
      reminders: [],
      plans: [],
      memories: []
    })),
    sub: vi.fn(),
    appendChat: vi.fn(),
  },
  conversationSummary: { get: vi.fn(), set: vi.fn() },
  uid: vi.fn(() => "msg-123")
}));
vi.mock("../src/lib/openai-compat");
vi.mock("firebase/auth");
vi.mock("../src/lib/tool-registry");
vi.mock("../src/lib/activity", () => ({
  activity: { set: vi.fn(), clear: vi.fn() }
}));
vi.mock("../src/lib/local-intents", () => ({
  tryLocalIntent: vi.fn()
}));
vi.mock("../src/lib/web-search", () => ({
  decideSearch: vi.fn(() => ({ search: false })),
  SEARCH_FORBIDDEN_HINT: "HINT_FORBIDDEN",
  SEARCH_OFFER_HINT: "HINT_OFFER",
  SEARCH_CAPABILITY_HINT: "HINT_CAPABILITY"
}));
vi.mock("../src/lib/models", () => ({
  MODEL_TRIO: { primary: "openrouter:model-1", fast: "openrouter:model-2", capable: "openrouter:model-3", coding: "openrouter:model-4" },
  TEXT_FALLBACKS: [],
  VISION_FALLBACKS: [],
  GROQ_EMERGENCY_MODEL: "emergency",
  MAX_OUTPUT_TOKENS: { fast: 100, auto: 100, thinking: 100, coding: 100, vision: 100 },
  HISTORY_TURNS: { fast: 5, auto: 5, thinking: 5, coding: 5, vision: 5 },
  parseRouteSpec: (s: string) => {
    const [p, m] = (s || "").split(":");
    return { prov: p as any, model: m || "" };
  },
  routeLabel: (p: string, m: string) => `${m} (${p})`
}));
vi.mock("../src/lib/ollama", () => ({
  sendChatOllama: vi.fn().mockResolvedValue("Ollama response")
}));
vi.mock("../src/lib/research", () => ({
  BoundedResearchService: vi.fn().mockImplementation(() => ({
    research: vi.fn().mockResolvedValue({ status: "success", results: [], evidence: [] })
  }))
}));
vi.mock("../src/lib/actions", () => ({
  executeActionTags: vi.fn((t) => ({ text: t, results: [] })),
  executeActionTagsAsync: vi.fn(async (t) => ({ text: t, results: [] })),
  renderActionReport: vi.fn(() => ""),
  claimsMutationWithoutTag: vi.fn(() => false),
  NO_ACTION_NOTICE: "NO_ACTION"
}));

import { sendChat } from "../src/lib/alpha.functions";

describe("Conversational Tool Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    (auth.getAuth as any).mockReturnValue({ currentUser: { uid: "user-123" } });
    // Re-apply the alphaStore mock return value to be safe
    const mockState = {
      settings: {
        openRouterKey: "sk-ant-test-key-123",
        groqApiKey: "sk-ant-test-key-123",
        openaiCompatKey: "sk-ant-test-key-123",
        taskModels: {},
        ollamaEndpoint: "" 
      },
      profile: { name: "Alex" },
      chat: [],
      notes: [],
      bills: [],
      reminders: [],
      plans: [],
      memories: []
    };
    (alphaStore.get as any).mockReturnValue(mockState);
  });

  it("Normal conversation (no tools) works", async () => {
    (openaiCompat.sendChatOpenAICompat as any).mockResolvedValue({ content: "Hello there!" });
    
    const history = [{ id: "1", role: "user", text: "Hi", ts: Date.now() }] as any;
    const result = await sendChat(history);
    
    expect(result).toBe("Hello there!");
    expect(openaiCompat.sendChatOpenAICompat).toHaveBeenCalledTimes(1);
  });

  it("Model requests a tool call and it executes correctly", async () => {
    const mockTool = {
      createReminder: vi.fn().mockResolvedValue({ success: true, operation: 'createReminder', data: { id: "r1", title: "Test" } })
    };
    (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

    // First call: tool request
    (openaiCompat.sendChatOpenAICompat as any)
      .mockResolvedValueOnce({ 
        content: "I'll set that for you.", 
        tool_calls: [{ id: "call-1", type: "function", function: { name: "createReminder", arguments: JSON.stringify({ title: "Test", dueAt: 12345 }) } }] 
      })
      // Second call: final response after tool result
      .mockResolvedValueOnce({ content: "OK, I set the reminder for Test." });

    const history = [{ id: "1", role: "user", text: "Remind me to test", ts: Date.now() }] as any;
    const result = await sendChat(history);

    expect(result).toBe("OK, I set the reminder for Test.");
    expect(mockTool.createReminder).toHaveBeenCalledWith({ title: "Test", dueAt: 12345 });
    expect(openaiCompat.sendChatOpenAICompat).toHaveBeenCalledTimes(2);
    
    // Verify tool message was sent back in history
    const secondCallHistory = (openaiCompat.sendChatOpenAICompat as any).mock.calls[1][0];
    expect(secondCallHistory).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "call-1" }));
  });

  it("Tool failures are reported truthfully to the model", async () => {
    const mockTool = {
      createReminder: vi.fn().mockResolvedValue({ success: false, operation: 'createReminder', error: { code: 'INVALID_INPUT', message: 'Time must be in future' } })
    };
    (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

    (openaiCompat.sendChatOpenAICompat as any)
      .mockResolvedValueOnce({ 
        content: "", 
        tool_calls: [{ id: "call-1", type: "function", function: { name: "createReminder", arguments: JSON.stringify({ title: "Test", dueAt: 100 }) } }] 
      })
      .mockResolvedValueOnce({ content: "I couldn't set that because the time must be in the future." });

    const history = [{ id: "1", role: "user", text: "Remind me in the past", ts: Date.now() }] as any;
    const result = await sendChat(history);

    expect(result).toContain("couldn't set that");
    const secondCallHistory = (openaiCompat.sendChatOpenAICompat as any).mock.calls[1][0];
    const toolMsg = secondCallHistory.find((m: any) => m.role === "tool");
    expect(JSON.parse(toolMsg.text).success).toBe(false);
  });

  it("Ownership UID cannot be overridden by model arguments", async () => {
    const mockTool = {
      createReminder: vi.fn().mockResolvedValue({ success: true, operation: 'createReminder' })
    };
    (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

    (openaiCompat.sendChatOpenAICompat as any)
      .mockResolvedValueOnce({ 
        content: "", 
        tool_calls: [{ id: "call-1", type: "function", function: { name: "createReminder", arguments: JSON.stringify({ title: "Hacked", dueAt: 123, userId: "hacker" }) } }] 
      })
      .mockResolvedValueOnce({ content: "Done." });

    const history = [{ id: "1", role: "user", text: "Hack me", ts: Date.now() }] as any;
    await sendChat(history);

    // The executeTool helper should have stripped userId
    expect(mockTool.createReminder).toHaveBeenCalledWith({ title: "Hacked", dueAt: 123 });
    // And getReminderTool should have been called with the real user-123
    expect(toolRegistry.getReminderTool).toHaveBeenCalledWith("user-123");
  });

  it("Unauthenticated execution is handled", async () => {
    (auth.getAuth as any).mockReturnValue({ currentUser: null });
    
    // In our implementation, executeTool will call getReminderTool(null)
    // and the tool.createReminder will return UNAUTHENTICATED error.
    const mockTool = {
      createReminder: vi.fn().mockResolvedValue({ success: false, error: { code: 'UNAUTHENTICATED' } })
    };
    (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

    (openaiCompat.sendChatOpenAICompat as any)
      .mockResolvedValueOnce({ 
        content: "", 
        tool_calls: [{ id: "call-1", type: "function", function: { name: "createReminder", arguments: JSON.stringify({ title: "Secret", dueAt: 123 }) } }] 
      })
      .mockResolvedValueOnce({ content: "You must sign in first." });

    const history = [{ id: "1", role: "user", text: "Save secret", ts: Date.now() }] as any;
    await sendChat(history);

    expect(toolRegistry.getReminderTool).toHaveBeenCalledWith(null);
  });

  it("Caps tool execution at 5 rounds to prevent infinite loops", async () => {
    const history = [{ id: "1", role: "user", text: "Infinite loop", ts: Date.now() }] as any;
    
    const toolCall = {
      id: "call-loop",
      type: "function" as const,
      function: { name: "createReminder", arguments: JSON.stringify({ title: "Loop" }) }
    };

    // Model keeps requesting a tool call every time
    (openaiCompat.sendChatOpenAICompat as any).mockResolvedValue({
      role: "assistant",
      content: "I'm doing it...",
      tool_calls: [toolCall]
    });

    const mockTool = {
      createReminder: vi.fn().mockResolvedValue({ success: true })
    };
    (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

    const result = await sendChat(history);

    // Rounds 0, 1, 2, 3, 4 each execute a tool call.
    // Each round calls sendChatOpenAICompat once.
    // Plus the final one after the loop or the one that hits the limit?
    // Wait, the loop is:
    /*
      for (let round = 0; round < 5; round++) {
        const res = await sendChatOpenAICompat(...);
        finalResponse = res;
        if (!res.tool_calls || res.tool_calls.length === 0) break;
        ... execute tools ...
        currentHistory.push(...tool results...);
      }
    */
    // Round 0: model calls 1, returns tool_calls. loop continues.
    // Round 1: model calls 2, returns tool_calls. loop continues.
    // Round 2: model calls 3, returns tool_calls. loop continues.
    // Round 3: model calls 4, returns tool_calls. loop continues.
    // Round 4: model calls 5, returns tool_calls. loop ends.
    // total 5 calls.
    
    expect(openaiCompat.sendChatOpenAICompat).toHaveBeenCalledTimes(5);
    expect(result).toContain("performed several actions");
  });
});
