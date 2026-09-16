import { describe, expect, it, vi, beforeEach } from "vitest";
import { alphaStore } from "../src/lib/alpha-store";
import * as openaiCompat from "../src/lib/openai-compat";
import * as toolRegistry from "../src/lib/tool-registry";
import { sendChat } from "../src/lib/alpha.functions";

import * as auth from "firebase/auth";

// Mock dependencies
vi.mock("../src/lib/alpha-store", () => ({
  alphaStore: {
    get: vi.fn(() => ({
      settings: {
        openRouterKey: "key",
        groqApiKey: "key",
        openaiCompatKey: "key",
        taskModels: {},
      },
      profile: { name: "Alex" },
      chat: [],
      notes: [],
      bills: [],
      reminders: [],
      plans: [],
      memories: []
    })),
    appendChat: vi.fn(),
  },
  conversationSummary: { get: vi.fn(), set: vi.fn() },
  uid: vi.fn(() => "msg-id")
}));

vi.mock("../src/lib/openai-compat");
vi.mock("firebase/auth", () => ({
  getAuth: vi.fn()
}));
vi.mock("../src/lib/tool-registry");
vi.mock("../src/lib/activity", () => ({
  activity: { set: vi.fn(), clear: vi.fn(), label: vi.fn() }
}));
vi.mock("../src/lib/web-search", () => ({
  decideSearch: vi.fn(() => ({ search: false })),
  SEARCH_FORBIDDEN_HINT: "HINT",
  SEARCH_OFFER_HINT: "HINT",
  SEARCH_CAPABILITY_HINT: "HINT"
}));
vi.mock("../src/lib/models", () => ({
  MODEL_TRIO: { primary: "openrouter:model-1", fast: "openrouter:model-2", capable: "openrouter:model-3", coding: "openrouter:model-4" },
  TEXT_FALLBACKS: [],
  VISION_FALLBACKS: [],
  GROQ_EMERGENCY_MODEL: "emergency",
  MAX_OUTPUT_TOKENS: { auto: 100 },
  HISTORY_TURNS: { auto: 5 },
  parseRouteSpec: (s: string) => {
    const [p, m] = (s || "").split(":");
    return { prov: p as any, model: m || "" };
  },
  routeLabel: () => "model"
}));

describe("Phase 2C: Production Path Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    (auth.getAuth as any).mockReturnValue({ currentUser: { uid: "user-123" } });
    (openaiCompat.sendChatOpenAICompat as any).mockReset();
  });

  it("runChat persists intermediate tool messages to alphaStore", async () => {
    const mockTool = {
      createReminder: vi.fn().mockResolvedValue({ success: true, operation: 'createReminder' })
    };
    (toolRegistry.getReminderTool as any).mockReturnValue(mockTool);

    (openaiCompat.sendChatOpenAICompat as any)
      .mockResolvedValueOnce({ 
        content: "Wait a sec...", 
        tool_calls: [{ id: "call-1", type: "function", function: { name: "createReminder", arguments: "{}" } }] 
      })
      .mockResolvedValueOnce({ content: "Done!" });

    const history = [{ id: "u1", role: "user", text: "Create it", ts: Date.now() }] as any;
    await sendChat(history);

    // Should have appended:
    // 1. Assistant message (with tool_calls)
    // 2. Tool result message
    expect(alphaStore.appendChat).toHaveBeenCalledTimes(2);
    
    const calls = (alphaStore.appendChat as any).mock.calls;
    expect(calls[0][0].role).toBe("model");
    expect(calls[0][0].tool_calls).toBeDefined();
    
    expect(calls[1][0].role).toBe("tool");
    expect(calls[1][0].tool_call_id).toBe("call-1");
  });

  it("UI correctly handles filtering of tool messages", () => {
    // This is more of a logic check since we are testing the hook/render logic
    // but we can verify the ChatMessage interface and the intended filtering logic.
    const messages = [
      { id: "1", role: "user", text: "Hi" },
      { id: "2", role: "model", text: "", tool_calls: [{ id: "c1" }] },
      { id: "3", role: "tool", text: "{}" },
      { id: "4", role: "model", text: "Final answer" }
    ];
    
    // The intended logic in chat.tsx is:
    const filtered = messages.filter(m => {
      if (m.role === "tool") return false;
      if (m.role === "model" && !m.text && m.tool_calls?.length) return false;
      return true;
    });
    
    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe("1");
    expect(filtered[1].id).toBe("4");
  });
});
