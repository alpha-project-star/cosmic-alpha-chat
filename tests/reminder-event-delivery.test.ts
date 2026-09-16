// tests/reminder-event-delivery.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { ReminderDueEvent, validateReminderDueEvent, generateReminderEventId } from '../src/lib/reminder-events';
import { ReminderEventDelivery } from '../src/lib/reminder-event-delivery';
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
      throw new Error('Simulated network failure');
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

describe('Reminder Event Delivery Layer — Phase 3B Foundation', () => {
  let repo: MockReminderRepository;
  let delivery: ReminderEventDelivery;
  let scheduler: ReminderScheduler;
  const userId = 'user-3b';
  const nowMs = 1788940800000;

  beforeEach(() => {
    repo = new MockReminderRepository();
    delivery = new ReminderEventDelivery(repo);
    scheduler = new ReminderScheduler(userId, repo);
    temporal.setMockDate(new Date(nowMs));
  });

  // --- 1. Event Creation & Identity ---
  describe('Event Creation & Identity', () => {
    it('1. Due scheduler result creates a valid event', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-1',
        userId,
        title: 'Check oven',
        notes: '',
        dueAt: nowMs - 5000,
        createdAt: nowMs - 10000,
        updatedAt: nowMs - 10000,
        reminderState: 'active',
        notificationState: 'pending'
      };
      await repo.createReminder(userId, reminder);

      const events = await scheduler.runTick();
      expect(events.length).toBe(1);
      const validation = validateReminderDueEvent(events[0]);
      expect(validation.success).toBe(true);
    });

    it('2 & 3 & 4 & 5. Event contains correct reminderId, userId, dueAt, detectedAt', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-2',
        userId,
        title: 'Call doctor',
        notes: '',
        dueAt: nowMs - 2000,
        createdAt: nowMs - 10000,
        updatedAt: nowMs - 10000,
        reminderState: 'active',
        notificationState: 'pending'
      };
      await repo.createReminder(userId, reminder);

      const events = await scheduler.runTick();
      expect(events.length).toBe(1);
      const evt = events[0];
      expect(evt.reminderId).toBe('rem-2');
      expect(evt.userId).toBe(userId);
      expect(evt.dueAt).toBe(nowMs - 2000);
      expect(evt.detectedAt).toBe(nowMs);
      expect(evt.title).toBe('Call doctor');
    });

    it('6. Event has stable unique identity (generateReminderEventId)', () => {
      const id1 = generateReminderEventId('rem-1', 1788940000);
      const id2 = generateReminderEventId('rem-1', 1788940000);
      const id3 = generateReminderEventId('rem-2', 1788940000);

      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id1).toBe('due_rem-1_1788940000');
    });
  });

  // --- 2. Validation ---
  describe('Event Validation Boundary', () => {
    it('7. Malformed event is rejected', () => {
      const res = validateReminderDueEvent(null);
      expect(res.success).toBe(false);

      const res2 = validateReminderDueEvent('not an object');
      expect(res2.success).toBe(false);
    });

    it('8. Wrong event type is rejected', () => {
      const res = validateReminderDueEvent({
        type: 'alarm_due',
        eventId: 'evt-1',
        reminderId: 'rem-1',
        userId,
        dueAt: nowMs,
        detectedAt: nowMs
      });
      expect(res.success).toBe(false);
    });

    it('9. Invalid timestamps are rejected', () => {
      const res = validateReminderDueEvent({
        type: 'reminder_due',
        eventId: 'evt-1',
        reminderId: 'rem-1',
        userId,
        dueAt: -100, // Negative timestamp
        detectedAt: nowMs
      });
      expect(res.success).toBe(false);

      const res2 = validateReminderDueEvent({
        type: 'reminder_due',
        eventId: 'evt-1',
        reminderId: 'rem-1',
        userId,
        dueAt: NaN,
        detectedAt: nowMs
      });
      expect(res2.success).toBe(false);
    });

    it('10. Missing required identity fields are rejected', () => {
      const res = validateReminderDueEvent({
        type: 'reminder_due',
        eventId: '',
        reminderId: 'rem-1',
        userId,
        dueAt: nowMs,
        detectedAt: nowMs
      });
      expect(res.success).toBe(false);

      const res2 = validateReminderDueEvent({
        type: 'reminder_due',
        eventId: 'evt-1',
        reminderId: '',
        userId,
        dueAt: nowMs,
        detectedAt: nowMs
      });
      expect(res2.success).toBe(false);
    });
  });

  // --- 3. Consumption & Exactly-Once Semantics ---
  describe('Event Consumption & Deduplication', () => {
    it('11 & 12. Valid event can be consumed and second consumption is rejected as already_consumed', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-c1',
        userId,
        title: 'Task C1',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'active',
        notificationState: 'claimed'
      };
      await repo.createReminder(userId, reminder);

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: generateReminderEventId('rem-c1', nowMs - 1000),
        reminderId: 'rem-c1',
        userId,
        dueAt: nowMs - 1000,
        detectedAt: nowMs,
        title: 'Task C1'
      };

      let consumerInvoked = 0;
      const res1 = await delivery.consumeEvent(userId, event, async () => {
        consumerInvoked++;
      });
      expect(res1.status).toBe('consumed');
      expect(consumerInvoked).toBe(1);

      // Verify repository updated to 'accepted'
      const stored = await repo.getReminder(userId, 'rem-c1');
      expect(stored?.notificationState).toBe('accepted');

      // Attempt second consumption of same event
      const res2 = await delivery.consumeEvent(userId, event, async () => {
        consumerInvoked++;
      });
      expect(res2.status).toBe('already_consumed');
      expect(consumerInvoked).toBe(1); // Not invoked again!
    });

    it('13. Concurrent consumers result in only one successful authoritative consumption', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-race',
        userId,
        title: 'Race Task',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'active',
        notificationState: 'claimed'
      };
      await repo.createReminder(userId, reminder);

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: generateReminderEventId('rem-race', nowMs - 1000),
        reminderId: 'rem-race',
        userId,
        dueAt: nowMs - 1000,
        detectedAt: nowMs,
        title: 'Race Task'
      };

      let executions = 0;
      const [res1, res2] = await Promise.all([
        delivery.consumeEvent(userId, event, async () => {
          executions++;
        }),
        delivery.consumeEvent(userId, event, async () => {
          executions++;
        })
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain('consumed');
      expect(executions).toBe(1);
    });

    it('14. Consumer rejects another user event', async () => {
      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: generateReminderEventId('rem-other', nowMs),
        reminderId: 'rem-other',
        userId: 'user-intruder',
        dueAt: nowMs,
        detectedAt: nowMs,
        title: 'Intruder task'
      };

      const res = await delivery.consumeEvent(userId, event, async () => {});
      expect(res.status).toBe('rejected');
      expect(res.error).toContain('Access denied');
    });
  });

  // --- 4. Failure & Retry ---
  describe('Failure & Retry Handling', () => {
    it('15 & 16. Failed consumption can be retried and does not mark event consumed', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-fail',
        userId,
        title: 'Fail Task',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'active',
        notificationState: 'claimed'
      };
      await repo.createReminder(userId, reminder);

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: generateReminderEventId('rem-fail', nowMs - 1000),
        reminderId: 'rem-fail',
        userId,
        dueAt: nowMs - 1000,
        detectedAt: nowMs,
        title: 'Fail Task'
      };

      // Consumer throws an error
      const res1 = await delivery.consumeEvent(userId, event, async () => {
        throw new Error('Simulated processing failure');
      });
      expect(res1.status).toBe('failed');

      // Verify repo is still claimed (NOT accepted)
      const stored = await repo.getReminder(userId, 'rem-fail');
      expect(stored?.notificationState).toBe('claimed');

      // Retry: consumer succeeds
      let retried = false;
      const res2 = await delivery.consumeEvent(userId, event, async () => {
        retried = true;
      });
      expect(res2.status).toBe('consumed');
      expect(retried).toBe(true);

      const storedAfter = await repo.getReminder(userId, 'rem-fail');
      expect(storedAfter?.notificationState).toBe('accepted');
    });

    it('17. Duplicate delivery after successful consumption is safely ignored', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-dup',
        userId,
        title: 'Dup Task',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'active',
        notificationState: 'accepted' // Already accepted
      };
      await repo.createReminder(userId, reminder);

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: generateReminderEventId('rem-dup', nowMs - 1000),
        reminderId: 'rem-dup',
        userId,
        dueAt: nowMs - 1000,
        detectedAt: nowMs,
        title: 'Dup Task'
      };

      let called = false;
      const res = await delivery.consumeEvent(userId, event, async () => {
        called = true;
      });
      expect(res.status).toBe('already_consumed');
      expect(called).toBe(false);
    });

    it('18. Consumer restart does not lose recoverable events', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-rec',
        userId,
        title: 'Recover Task',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'active',
        notificationState: 'claimed'
      };
      await repo.createReminder(userId, reminder);

      // Create a fresh delivery instance (simulating consumer restart)
      const newDelivery = new ReminderEventDelivery(repo);

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: generateReminderEventId('rem-rec', nowMs - 1000),
        reminderId: 'rem-rec',
        userId,
        dueAt: nowMs - 1000,
        detectedAt: nowMs,
        title: 'Recover Task'
      };

      let consumed = false;
      const res = await newDelivery.consumeEvent(userId, event, async () => {
        consumed = true;
      });
      expect(res.status).toBe('consumed');
      expect(consumed).toBe(true);
    });
  });

  // --- 5. Scheduler Integration ---
  describe('Scheduler to Event Delivery Integration', () => {
    it('19 & 20. One due reminder produces one logical event and repeated ticks do not duplicate', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-s1',
        userId,
        title: 'Scheduler Event 1',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'active',
        notificationState: 'pending'
      };
      await repo.createReminder(userId, reminder);

      const emittedEvents: ReminderDueEvent[] = [];
      const sched = new ReminderScheduler(userId, repo, {
        onReminderDue: (e) => emittedEvents.push(e)
      });

      // Tick 1
      await sched.runTick();
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].eventId).toBe(generateReminderEventId('rem-s1', nowMs - 1000));

      // Tick 2
      await sched.runTick();
      expect(emittedEvents.length).toBe(1); // Still 1, no duplicate
    });

    it('21. Multi-tab scheduler race still produces only one logical event', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-multi',
        userId,
        title: 'Multi Tab Task',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'active',
        notificationState: 'pending'
      };
      await repo.createReminder(userId, reminder);

      const schedA = new ReminderScheduler(userId, repo);
      const schedB = new ReminderScheduler(userId, repo);

      const [resA, resB] = await Promise.all([
        schedA.runTick(),
        schedB.runTick()
      ]);

      const allEvents = [...resA, ...resB];
      expect(allEvents.length).toBe(1);
    });

    it('22. Future reminder produces no event', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-future',
        userId,
        title: 'Future Task',
        notes: '',
        dueAt: nowMs + 100000,
        createdAt: nowMs,
        updatedAt: nowMs,
        reminderState: 'active',
        notificationState: 'pending'
      };
      await repo.createReminder(userId, reminder);

      const events = await scheduler.runTick();
      expect(events.length).toBe(0);
    });

    it('23. Completed/deleted reminder produces no event', async () => {
      const reminder: FirestoreReminder = {
        id: 'rem-done',
        userId,
        title: 'Done Task',
        notes: '',
        dueAt: nowMs - 1000,
        createdAt: nowMs - 5000,
        updatedAt: nowMs - 5000,
        reminderState: 'completed',
        notificationState: 'pending'
      };
      await repo.createReminder(userId, reminder);

      const events = await scheduler.runTick();
      expect(events.length).toBe(0);
    });
  });

  // --- 6. Recovery & Stale Claims ---
  describe('Stale Claim Recovery', () => {
    it('24 & 25. Stale processing claim safely recovers if lease expired', async () => {
      const staleClaimTime = nowMs - 60000; // 60s ago
      const reminder: FirestoreReminder = {
        id: 'rem-stale',
        userId,
        title: 'Stale Claim Task',
        notes: '',
        dueAt: nowMs - 120000,
        createdAt: nowMs - 150000,
        updatedAt: staleClaimTime,
        legacyFiredAt: staleClaimTime,
        reminderState: 'active',
        notificationState: 'claimed'
      };
      await repo.createReminder(userId, reminder);

      // Run stale claim recovery with 30s lease timeout
      const recovered = await delivery.recoverStaleClaims(userId, 30000);
      expect(recovered).toContain('rem-stale');

      // Verify notificationState was reset to pending for retry
      const updated = await repo.getReminder(userId, 'rem-stale');
      expect(updated?.notificationState).toBe('pending');
    });
  });

  // --- 7. Isolation & Subscription ---
  describe('Isolation & Subscription', () => {
    it('26 & 27. User A cannot emit or consume User B event', async () => {
      const eventForB: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: 'due_rem-b_123',
        reminderId: 'rem-b',
        userId: 'user-b',
        dueAt: nowMs,
        detectedAt: nowMs,
        title: 'User B Task'
      };

      // Emit check
      await expect(delivery.emitReminderDueEvent(eventForB, 'user-a')).rejects.toThrow('User isolation violation');

      // Consume check
      const res = await delivery.consumeEvent('user-a', eventForB, async () => {});
      expect(res.status).toBe('rejected');
    });

    it('Subscriber lifecycle (subscribe and unsubscribe)', async () => {
      let received = 0;
      const unsubscribe = delivery.subscribe(async (e) => {
        received++;
      });

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: 'due_rem-sub_123',
        reminderId: 'rem-sub',
        userId,
        dueAt: nowMs,
        detectedAt: nowMs,
        title: 'Subscriber Task'
      };

      await delivery.emitReminderDueEvent(event);
      expect(received).toBe(1);

      unsubscribe();
      await delivery.emitReminderDueEvent(event);
      expect(received).toBe(1); // No second call
    });
  });
});
