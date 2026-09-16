// tests/temporal-and-scheduler.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { temporal } from "../src/lib/temporal";
import { ReminderScheduler } from "../src/lib/reminder-scheduler";
import { alphaStore } from "../src/lib/alpha-store";
import { InMemoryReminderRepository } from "../src/lib/reminder-repo";

describe("Temporal & Scheduler", () => {
  const userId = "test-user";
  let repo: InMemoryReminderRepository;

  beforeEach(() => {
    temporal.setMockDate(null);
    alphaStore.replaceAll({ reminders: [] });
    repo = new InMemoryReminderRepository();
  });

  it("temporal.now returns mock date when set", () => {
    const mockDate = new Date("2026-09-07T12:00:00Z");
    temporal.setMockDate(mockDate);
    expect(temporal.now().toISOString()).toBe(mockDate.toISOString());
  });

  it("scheduler triggers due reminder and claims it in repository", async () => {
    const mockDate = new Date("2026-09-07T12:00:00Z");
    temporal.setMockDate(mockDate);
    
    const reminderId = "rem-1";
    await repo.createReminder(userId, {
      id: reminderId,
      userId,
      title: "Test Reminder",
      dueAt: new Date("2026-09-07T11:00:00Z").getTime(), // Past
      notes: "Test notes",
      reminderState: "active",
      notificationState: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const scheduler = new ReminderScheduler(userId, repo);
    const events = await scheduler.runTick();
    
    expect(events.length).toBe(1);
    expect(events[0].reminderId).toBe(reminderId);

    const stored = await repo.getReminder(userId, reminderId);
    expect(stored?.notificationState).toBe("claimed");
    expect(stored?.legacyFiredAt).toBe(mockDate.getTime());
  });

  it("scheduler does not trigger already claimed reminder", async () => {
    const mockDate = new Date("2026-09-07T12:00:00Z");
    temporal.setMockDate(mockDate);
    
    const reminderId = "rem-1";
    await repo.createReminder(userId, {
      id: reminderId,
      userId,
      title: "Test Reminder",
      dueAt: new Date("2026-09-07T11:00:00Z").getTime(), // Past
      notes: "Test notes",
      reminderState: "active",
      notificationState: "claimed", // Already claimed
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const scheduler = new ReminderScheduler(userId, repo);
    const events = await scheduler.runTick();
    
    expect(events.length).toBe(0);
    const stored = await repo.getReminder(userId, reminderId);
    expect(stored?.notificationState).toBe("claimed");
  });
});
