import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReminderTool } from "../src/lib/reminder-tool";
import { ReminderRepository } from "../src/lib/reminder-repo";

describe("ReminderTool", () => {
  const userId = "user-123";
  let mockRepo: ReminderRepository;
  let tool: ReminderTool;

  beforeEach(() => {
    mockRepo = {
      listReminders: vi.fn(),
      getReminder: vi.fn(),
      createReminder: vi.fn(),
      updateReminder: vi.fn(),
      deleteReminder: vi.fn(),
    } as any;
    tool = new ReminderTool(userId, mockRepo);
  });

  it("createReminder success", async () => {
    const input = { title: "Test Reminder", dueAt: Date.now() + 10000 };
    const result = await tool.createReminder(input);
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe(input.title);
    expect(mockRepo.createReminder).toHaveBeenCalledWith(userId, expect.objectContaining({
      title: input.title,
      userId: userId
    }));
  });

  it("getReminder success", async () => {
    const mockReminder = { id: "r1", userId, title: "R1" } as any;
    (mockRepo.getReminder as any).mockResolvedValue(mockReminder);
    const result = await tool.getReminder("r1");
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockReminder);
  });

  it("listReminders success", async () => {
    const mockList = [{ id: "r1", dueAt: Date.now() }, { id: "r2", dueAt: Date.now() }] as any;
    (mockRepo.listReminders as any).mockResolvedValue(mockList);
    const result = await tool.listReminders();
    expect(result.success).toBe(true);
    expect(result.data?.[0].id).toBe("r1");
    expect(result.data?.[0].dueAt).toBeDefined();
  });

  it("updateReminder success", async () => {
    const mockReminder = { id: "r1", userId, title: "R1" } as any;
    (mockRepo.getReminder as any).mockResolvedValueOnce(mockReminder).mockResolvedValueOnce({ ...mockReminder, title: "New Title" });
    const result = await tool.updateReminder({ id: "r1", title: "New Title" });
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe("New Title");
    expect(mockRepo.updateReminder).toHaveBeenCalledWith(userId, "r1", expect.objectContaining({
      title: "New Title"
    }));
  });

  it("deleteReminder success", async () => {
    (mockRepo.getReminder as any).mockResolvedValue({ id: "r1", userId } as any);
    const result = await tool.deleteReminder("r1");
    expect(result.success).toBe(true);
    expect(mockRepo.deleteReminder).toHaveBeenCalledWith(userId, "r1");
  });

  it("completeReminder success", async () => {
    (mockRepo.getReminder as any).mockResolvedValueOnce({ id: "r1", userId } as any).mockResolvedValueOnce({ id: "r1", userId, reminderState: 'completed' } as any);
    const result = await tool.completeReminder("r1");
    expect(result.success).toBe(true);
    expect(mockRepo.updateReminder).toHaveBeenCalledWith(userId, "r1", expect.objectContaining({ reminderState: 'completed' }));
  });

  it("unauthenticated requests rejected", async () => {
    const unauthTool = new ReminderTool(null, mockRepo);
    const result = await unauthTool.listReminders();
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNAUTHENTICATED');
  });

  it("arbitrary UID override rejected (tool uses context UID)", async () => {
    const input = { title: "Hacked Reminder", dueAt: Date.now() + 10000, userId: "hacker-456" };
    // Even if the input contains a userId (which CreateReminderSchema ignores), the tool uses constructor userId
    const result = await tool.createReminder(input);
    expect(result.success).toBe(true);
    expect(result.data?.userId).toBe(userId); // Still user-123
    expect(mockRepo.createReminder).toHaveBeenCalledWith(userId, expect.objectContaining({
      userId: userId
    }));
  });

  it("invalid inputs rejected", async () => {
    const result = await tool.createReminder({ title: "" });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it("repository failures return structured failure results", async () => {
    (mockRepo.listReminders as any).mockRejectedValue(new Error("Firebase down"));
    const result = await tool.listReminders();
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('REPOSITORY_ERROR');
    expect(result.error?.message).toContain("Firebase down");
  });

  it("not-found behavior is handled correctly", async () => {
    (mockRepo.getReminder as any).mockResolvedValue(null);
    (mockRepo.listReminders as any).mockResolvedValue([]);
    const result = await tool.getReminder("unknown");
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it("tool operations remain user-scoped (passes correct UID to repo)", async () => {
    await tool.listReminders();
    expect(mockRepo.listReminders).toHaveBeenCalledWith(userId);
  });
});
