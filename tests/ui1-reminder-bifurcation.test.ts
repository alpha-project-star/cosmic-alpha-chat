// tests/ui1-reminder-bifurcation.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderRepository } from "../src/lib/reminder-repo";
import { ReminderTool } from "../src/lib/reminder-tool";
import { DEFAULT_SYSTEM } from "../src/lib/alpha.functions";

describe("UI-1 Regression: Firestore vs localStorage Reminder Bifurcation", () => {
  const userId = "test-user-ui1";
  let repo: InMemoryReminderRepository;
  let tool: ReminderTool;

  beforeEach(() => {
    repo = new InMemoryReminderRepository();
    tool = new ReminderTool(userId, repo);
  });

  it("ensures reminders created via conversational ReminderTool are visible to repository-based UI", async () => {
    const dueTime = Date.now() + 60000;
    const createResult = await tool.createReminder({
      title: "Doctor Appointment",
      dueAt: dueTime,
      notes: "Bring previous records",
    });

    expect(createResult.success).toBe(true);
    const createdId = createResult.data!.id;

    // Simulate what RemindersRoute now does (querying the repository)
    const uiListed = await repo.listReminders(userId);
    expect(uiListed.length).toBe(1);
    expect(uiListed[0].id).toBe(createdId);
    expect(uiListed[0].title).toBe("Doctor Appointment");
    expect(uiListed[0].notes).toBe("Bring previous records");
    expect(uiListed[0].reminderState).toBe("active");
  });

  it("ensures reminders created or updated by the UI in the repository are visible and actionable by ReminderTool", async () => {
    const dueTime = Date.now() + 120000;
    const reminderId = "ui-created-reminder-1";

    // Simulate UI creating a reminder directly in repository
    await repo.createReminder(userId, {
      id: reminderId,
      userId,
      title: "Pick up groceries",
      notes: "Milk, eggs, apples",
      dueAt: dueTime,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reminderState: "active",
      notificationState: "pending",
    });

    // Tool should find it
    const findResult = await tool.getReminder("groceries");
    expect(findResult.success).toBe(true);
    expect(findResult.data?.id).toBe(reminderId);

    // Tool should be able to complete it
    const completeResult = await tool.completeReminder(reminderId);
    expect(completeResult.success).toBe(true);
    expect(completeResult.data?.reminderState).toBe("completed");

    // UI reading repository should reflect completed state
    const fetched = await repo.getReminder(userId, reminderId);
    expect(fetched?.reminderState).toBe("completed");
  });

  it("verifies DEFAULT_SYSTEM instructions have removed deprecated localStorage action tags for reminders", () => {
    const systemPrompt = DEFAULT_SYSTEM("", "", "");
    // Deprecated reminder action tags that bypassed Firestore
    expect(systemPrompt).not.toContain("[[ADD_REMINDER:");
    expect(systemPrompt).not.toContain("[[UPDATE_REMINDER:");
    expect(systemPrompt).not.toContain("[[MARK_REMINDER_DONE:");
    // Confirms authoritative tool instruction exists
    expect(systemPrompt).toContain("REMINDER TOOLS:");
    expect(systemPrompt).toContain("Use `createReminder` for new reminders.");
    expect(systemPrompt).toContain("These tools are the authoritative way to manage reminders.");
  });
});
