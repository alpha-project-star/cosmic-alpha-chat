// tests/reminder-scheduler.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReminderScheduler } from '../src/lib/reminder-scheduler';
import { ReminderRepository, FirestoreReminder } from '../src/lib/reminder-repo';
import { temporal } from '../src/lib/temporal';

class MockReminderRepository implements ReminderRepository {
  public store = new Map<string, FirestoreReminder>();
  public shouldFailNextUpdate = false;

  async listReminders(userId: string): Promise<FirestoreReminder[]> {
    return Array.from(this.store.values()).filter(r => r.userId === userId);
  }

  async getReminder(userId: string, reminderId: string): Promise<FirestoreReminder | null> {
    const r = this.store.get(reminderId);
    if (!r || r.userId !== userId) return null;
    return r;
  }

  async createReminder(userId: string, reminder: FirestoreReminder): Promise<void> {
    this.store.set(reminder.id, { ...reminder, userId });
  }

  async updateReminder(userId: string, reminderId: string, patch: Partial<FirestoreReminder>): Promise<void> {
    if (this.shouldFailNextUpdate) {
      throw new Error('Simulated network / transaction failure');
    }
    const r = this.store.get(reminderId);
    if (!r || r.userId !== userId) throw new Error('Not found');
    if (patch.notificationState === 'claimed' && r.notificationState !== 'pending') {
      throw new Error('Transaction conflict: already claimed');
    }
    this.store.set(reminderId, { ...r, ...patch, updatedAt: Date.now() });
  }

  async deleteReminder(userId: string, reminderId: string): Promise<void> {
    this.store.delete(reminderId);
  }
}

describe('ReminderScheduler — Phase 3A Foundation', () => {
  let repo: MockReminderRepository;
  let scheduler: ReminderScheduler;
  const userId = 'user-3a';
  const nowMs = 1788940800000; // Fixed timestamp (e.g. Sep 8, 2026)

  beforeEach(() => {
    repo = new MockReminderRepository();
    scheduler = new ReminderScheduler(userId, repo);
    temporal.setMockDate(new Date(nowMs));
  });

  it('1. Future reminder is not due', () => {
    const reminder: FirestoreReminder = {
      id: 'r1',
      userId,
      title: 'Future task',
      notes: '',
      dueAt: nowMs + 60000, // 1 min in future
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    const due = scheduler.evaluateDueReminders([reminder], nowMs);
    expect(due.length).toBe(0);
  });

  it('2. Reminder exactly at "now" is due', () => {
    const reminder: FirestoreReminder = {
      id: 'r2',
      userId,
      title: 'Exact task',
      notes: '',
      dueAt: nowMs,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    const due = scheduler.evaluateDueReminders([reminder], nowMs);
    expect(due.length).toBe(1);
    expect(due[0].id).toBe('r2');
  });

  it('3. Past reminder is due', () => {
    const reminder: FirestoreReminder = {
      id: 'r3',
      userId,
      title: 'Past task',
      notes: '',
      dueAt: nowMs - 1000, // 1 sec in past
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    const due = scheduler.evaluateDueReminders([reminder], nowMs);
    expect(due.length).toBe(1);
  });

  it('4. Invalid timestamp is rejected safely', () => {
    const reminder: FirestoreReminder = {
      id: 'r4',
      userId,
      title: 'Invalid task',
      notes: '',
      dueAt: NaN,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    const due = scheduler.evaluateDueReminders([reminder], nowMs);
    expect(due.length).toBe(0);
  });

  it('5 & 6 & 7. Unfired due reminder fires once and repeated ticks do not duplicate', async () => {
    const reminder: FirestoreReminder = {
      id: 'r5',
      userId,
      title: 'Task 5',
      notes: '',
      dueAt: nowMs - 1000,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    await repo.createReminder(userId, reminder);

    // Tick 1: should fire
    const events1 = await scheduler.runTick();
    expect(events1.length).toBe(1);
    expect(events1[0].reminderId).toBe('r5');

    // Check repo state is now claimed
    const updated = await repo.getReminder(userId, 'r5');
    expect(updated?.notificationState).toBe('claimed');
    expect(updated?.legacyFiredAt).toBeDefined();

    // Tick 2: already fired, should not fire again
    const events2 = await scheduler.runTick();
    expect(events2.length).toBe(0);
  });

  it('8. Completed reminder does not fire', () => {
    const reminder: FirestoreReminder = {
      id: 'r8',
      userId,
      title: 'Completed task',
      notes: '',
      dueAt: nowMs - 1000,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'completed',
      notificationState: 'pending'
    };
    const due = scheduler.evaluateDueReminders([reminder], nowMs);
    expect(due.length).toBe(0);
  });

  it('9. Deleted/nonexistent reminder does not fire', async () => {
    // If not in store or deleted
    const reminders = await repo.listReminders(userId);
    const due = scheduler.evaluateDueReminders(reminders, nowMs);
    expect(due.length).toBe(0);
  });

  it('10 & 11. Multiple reminders evaluated independently and only due returned', async () => {
    const r1: FirestoreReminder = { id: 'due1', userId, title: 'Due 1', notes: '', dueAt: nowMs - 500, createdAt: nowMs, updatedAt: nowMs, reminderState: 'active', notificationState: 'pending' };
    const r2: FirestoreReminder = { id: 'fut1', userId, title: 'Fut 1', notes: '', dueAt: nowMs + 5000, createdAt: nowMs, updatedAt: nowMs, reminderState: 'active', notificationState: 'pending' };
    const r3: FirestoreReminder = { id: 'due2', userId, title: 'Due 2', notes: '', dueAt: nowMs - 100, createdAt: nowMs, updatedAt: nowMs, reminderState: 'active', notificationState: 'pending' };

    await repo.createReminder(userId, r1);
    await repo.createReminder(userId, r2);
    await repo.createReminder(userId, r3);

    const events = await scheduler.runTick();
    expect(events.length).toBe(2);
    expect(events.map(e => e.reminderId).sort()).toEqual(['due1', 'due2']);
  });

  it('12 & 13 & 14. Authentication / User isolation security', () => {
    expect(() => new ReminderScheduler('', repo)).toThrow();

    const otherUserScheduler = new ReminderScheduler('user-b', repo);
    const reminderForA: FirestoreReminder = {
      id: 'ra',
      userId: 'user-a',
      title: 'A task',
      notes: '',
      dueAt: nowMs - 1000,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };

    const due = otherUserScheduler.evaluateDueReminders([reminderForA], nowMs);
    expect(due.length).toBe(0); // User B cannot process User A's reminder
  });

  it('15 & 16 & 17. Concurrency / Racing and transaction failures', async () => {
    const reminder: FirestoreReminder = {
      id: 'race1',
      userId,
      title: 'Race task',
      notes: '',
      dueAt: nowMs - 1000,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    await repo.createReminder(userId, reminder);

    const scheduler2 = new ReminderScheduler(userId, repo);

    // Simulate simultaneous ticks racing
    const [events1, events2] = await Promise.all([
      scheduler.runTick(),
      scheduler2.runTick()
    ]);

    const totalEvents = [...events1, ...events2];
    expect(totalEvents.length).toBe(1); // Exactly one wins the claim
  });

  it('18. Overdue reminder discovered after scheduler restart', async () => {
    const reminder: FirestoreReminder = {
      id: 'overdue1',
      userId,
      title: 'Overdue task',
      notes: '',
      dueAt: nowMs - 10000, // 10s overdue while offline/stopped
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    await repo.createReminder(userId, reminder);

    // Scheduler starts fresh (simulating restart)
    const newScheduler = new ReminderScheduler(userId, repo);
    const events = await newScheduler.runTick();
    expect(events.length).toBe(1);
    expect(events[0].reminderId).toBe('overdue1');
  });

  it('19 & 20. Failed tick / network failure handling and retry', async () => {
    const reminder: FirestoreReminder = {
      id: 'fail1',
      userId,
      title: 'Fail task',
      notes: '',
      dueAt: nowMs - 1000,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    await repo.createReminder(userId, reminder);

    repo.shouldFailNextUpdate = true;
    let errorCaught = false;
    const errScheduler = new ReminderScheduler(userId, repo, {
      onError: () => { errorCaught = true; }
    });

    const events1 = await errScheduler.runTick();
    expect(events1.length).toBe(0);
    expect(errorCaught).toBe(true);

    // Retry after network recovered
    repo.shouldFailNextUpdate = false;
    const events2 = await errScheduler.runTick();
    expect(events2.length).toBe(1);
    expect(events2[0].reminderId).toBe('fail1');
  });

  it('21. Timezone correctness (absolute timestamps)', () => {
    // Absolute timestamp comparison is unaffected by local system/display timezone
    const reminder: FirestoreReminder = {
      id: 'tz1',
      userId,
      title: 'TZ task',
      notes: '',
      dueAt: nowMs - 1,
      createdAt: nowMs,
      updatedAt: nowMs,
      reminderState: 'active',
      notificationState: 'pending'
    };
    const due = scheduler.evaluateDueReminders([reminder], nowMs);
    expect(due.length).toBe(1);
  });

  it('22 & 23 & 24. Lifecycle management (start, stop, active state)', () => {
    expect(scheduler.isActive()).toBe(false);
    scheduler.start();
    expect(scheduler.isActive()).toBe(true);
    
    // Starting again should be safe (no duplicate interval)
    scheduler.start();
    expect(scheduler.isActive()).toBe(true);

    scheduler.stop();
    expect(scheduler.isActive()).toBe(false);

    // Restarting works correctly
    scheduler.start();
    expect(scheduler.isActive()).toBe(true);
    scheduler.stop();
  });
});
