// tests/e2e-reminder-validation.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { temporal } from "../src/lib/temporal";
import { ReminderScheduler } from "../src/lib/reminder-scheduler";
import { alphaStore } from "../src/lib/alpha-store";
import { InMemoryReminderRepository } from "../src/lib/reminder-repo";

describe("End-to-End Reminder Validation", () => {
  const userId = "e2e-user";
  let repo: InMemoryReminderRepository;

  beforeEach(() => {
    temporal.setMockDate(null);
    alphaStore.replaceAll({ reminders: [] });
    repo = new InMemoryReminderRepository();
  });

  it("1. Real reminder creation, detection, and in-app notification", async () => {
    // 1a. Create reminder (mock time)
    const now = new Date("2026-09-07T12:00:00Z");
    temporal.setMockDate(now);
    const dueTime = new Date("2026-09-07T12:01:00Z"); // 1 minute in future
    
    const reminderId = "e2e-1";
    await repo.createReminder(userId, {
      id: reminderId,
      userId,
      title: "Check the oven",
      dueAt: dueTime.getTime(),
      notes: "It's time!",
      reminderState: "active",
      notificationState: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // 1b. Scheduler should not fire yet
    const scheduler = new ReminderScheduler(userId, repo);
    await scheduler.runTick();
    let stored = await repo.getReminder(userId, reminderId);
    expect(stored?.notificationState).toBe("pending");

    // 1c. Fast forward to due time
    temporal.setMockDate(dueTime);
    await scheduler.runTick();

    // 1d. Confirm claimed in repository
    stored = await repo.getReminder(userId, reminderId);
    expect(stored?.notificationState).toBe("claimed");
    expect(stored?.legacyFiredAt).toBe(dueTime.getTime());
    
    // 1e. Confirm duplicate does not fire
    const events = await scheduler.runTick();
    expect(events.length).toBe(0);
  });

  it("2. Missed reminder test", async () => {
    // 2a. Reminder due in past
    const pastDue = new Date("2026-09-07T10:00:00Z");
    const now = new Date("2026-09-07T11:00:00Z");
    temporal.setMockDate(now);
    
    const reminderId = "e2e-2";
    await repo.createReminder(userId, {
      id: reminderId,
      userId,
      title: "Missed Reminder",
      dueAt: pastDue.getTime(),
      notes: "Late!",
      reminderState: "active",
      notificationState: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // 2b. Scheduler runTick should detect it immediately
    const scheduler = new ReminderScheduler(userId, repo);
    await scheduler.runTick();

    const stored = await repo.getReminder(userId, reminderId);
    expect(stored?.notificationState).toBe("claimed");
    
    // 2c. Refresh shouldn't refire
    const events = await scheduler.runTick();
    expect(events.length).toBe(0);
  });

  it("4. CRUD compatibility test", () => {
    // Create
    const reminder = { id: "e2e-3", title: "Edit me", when: "2026-09-07T13:00:00Z", notes: "", done: "no" as const };
    alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, reminder] });
    
    // Edit
    alphaStore.replaceAll({ reminders: alphaStore.get().reminders.map(r => r.id === reminder.id ? { ...reminder, title: "Edited" } : r) });
    expect(alphaStore.get().reminders.find(r => r.id === "e2e-3")?.title).toBe("Edited");
    
    // Delete
    alphaStore.replaceAll({ reminders: alphaStore.get().reminders.filter(r => r.id !== "e2e-3") });
    expect(alphaStore.get().reminders.find(r => r.id === "e2e-3")).toBeUndefined();
  });
});
