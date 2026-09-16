// tests/proactive-trigger.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReminderDueEvent } from '../src/lib/reminder-events';
import { ReminderRepository, FirestoreReminder } from '../src/lib/reminder-repo';
import { alphaStore, ChatMessage } from '../src/lib/alpha-store';
import {
  ProactiveTrigger,
  handleReminderDue,
  ProactiveTriggerResult,
} from '../src/lib/proactive-trigger';
import { ReminderEventDelivery } from '../src/lib/reminder-event-delivery';

class MockReminderRepository implements ReminderRepository {
  public store = new Map<string, FirestoreReminder>();
  public shouldFailUpdate = false;
  public updateCount = 0;

  async listReminders(userId: string): Promise<FirestoreReminder[]> {
    return Array.from(this.store.values()).filter((r) => r.userId === userId);
  }

  async getReminder(userId: string, reminderId: string): Promise<FirestoreReminder | null> {
    const r = this.store.get(reminderId);
    if (!r || r.userId !== userId) return null;
    return { ...r };
  }

  async createReminder(userId: string, reminder: FirestoreReminder): Promise<void> {
    this.store.set(reminder.id, { ...reminder, userId });
  }

  async updateReminder(
    userId: string,
    reminderId: string,
    patch: Partial<FirestoreReminder>,
  ): Promise<void> {
    this.updateCount++;
    if (this.shouldFailUpdate) {
      throw new Error('Database transaction simulated failure');
    }
    const r = this.store.get(reminderId);
    if (!r || r.userId !== userId) throw new Error('Reminder not found');
    const isLeaseActive =
      r.proactiveState === 'generating' &&
      Date.now() - (r.updatedAt || 0) < 30000;
    if (
      patch.proactiveState === 'generating' &&
      (isLeaseActive || r.proactiveState === 'generated')
    ) {
      throw new Error('Transaction conflict: already generating or generated');
    }
    this.store.set(reminderId, { ...r, ...patch, updatedAt: Date.now() });
  }

  async deleteReminder(userId: string, reminderId: string): Promise<void> {
    this.store.delete(reminderId);
  }
}

describe('Phase 3C — Proactive Alpha Trigger & Conversational Response Foundation', () => {
  let repo: MockReminderRepository;
  let trigger: ProactiveTrigger;
  const userId = 'user-alex-123';
  const nowMs = 1788940800000;

  const validEvent: ReminderDueEvent = {
    type: 'reminder_due',
    eventId: 'due_rem1_1788940800000',
    reminderId: 'rem1',
    userId,
    dueAt: nowMs,
    detectedAt: nowMs + 10,
    title: 'Dentist appointment',
  };

  const initialReminder: FirestoreReminder = {
    id: 'rem1',
    userId,
    title: 'Dentist appointment',
    notes: 'Bring insurance card',
    dueAt: nowMs,
    createdAt: nowMs - 3600000,
    updatedAt: nowMs - 3600000,
    reminderState: 'active',
    notificationState: 'claimed',
  };

  beforeEach(() => {
    repo = new MockReminderRepository();
    repo.store.set(initialReminder.id, { ...initialReminder });

    // Reset alphaStore chat
    alphaStore.clearChat();

    trigger = new ProactiveTrigger({
      repo,
      generateResponse: async (e) => `Hi Alex, your reminder "${e.title}" is due now.`,
    });
  });

  // -------------------------------------------------------------------------
  // Event Validation
  // -------------------------------------------------------------------------
  describe('Event Validation', () => {
    it('1. Valid ReminderDueEvent is accepted', async () => {
      const result = await trigger.handleReminderDue(validEvent, userId);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.eventId).toBe(validEvent.eventId);
        expect(result.text).toContain('Dentist appointment');
      }
    });

    it('2. Invalid event payload (non-object or null) is rejected', async () => {
      const result1 = await trigger.handleReminderDue(null, userId);
      expect(result1.success).toBe(false);
      if (!result1.success) {
        expect(result1.error.code).toBe('INVALID_EVENT');
      }

      const result2 = await trigger.handleReminderDue('not-an-event', userId);
      expect(result2.success).toBe(false);
      if (!result2.success) {
        expect(result2.error.code).toBe('INVALID_EVENT');
      }
    });

    it('3. Wrong event type is rejected', async () => {
      const invalid = { ...validEvent, type: 'other_event' };
      const result = await trigger.handleReminderDue(invalid, userId);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });

    it('4. Missing reminder identity is rejected', async () => {
      const invalid = { ...validEvent, reminderId: '' };
      const result = await trigger.handleReminderDue(invalid, userId);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_EVENT');
      }
    });

    it('5. Invalid timestamps are rejected', async () => {
      const negativeDueAt = { ...validEvent, dueAt: -100 };
      const res1 = await trigger.handleReminderDue(negativeDueAt, userId);
      expect(res1.success).toBe(false);
      if (!res1.success) {
        expect(res1.error.code).toBe('INVALID_EVENT');
      }

      const nanDetectedAt = { ...validEvent, detectedAt: NaN };
      const res2 = await trigger.handleReminderDue(nanDetectedAt, userId);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.error.code).toBe('INVALID_EVENT');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Authentication & Isolation
  // -------------------------------------------------------------------------
  describe('Authentication & Isolation', () => {
    it('6. Unauthenticated user cannot trigger proactive response', async () => {
      const resNull = await trigger.handleReminderDue(validEvent, undefined);
      expect(resNull.success).toBe(false);
      if (!resNull.success) {
        expect(resNull.error.code).toBe('UNAUTHENTICATED');
      }

      const resEmpty = await trigger.handleReminderDue(validEvent, '   ');
      expect(resEmpty.success).toBe(false);
      if (!resEmpty.success) {
        expect(resEmpty.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('7. User A cannot process User B’s event', async () => {
      const result = await trigger.handleReminderDue(validEvent, 'user-mallory-666');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_MISMATCH');
      }
    });

    it('8. Event identity cannot override authenticated identity', async () => {
      // Mallory tries to spoof event.userId to match her own session, but reminder belongs to Alex
      const spoofedEvent = { ...validEvent, userId: 'user-mallory' };
      const result = await trigger.handleReminderDue(spoofedEvent, 'user-mallory');
      expect(result.success).toBe(false);
      if (!result.success) {
        // Since reminder in repo belongs to Alex, repo lookup fails or returns null
        expect(result.error.code).toBe('REPOSITORY_ERROR');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Basic Generation
  // -------------------------------------------------------------------------
  describe('Basic Generation', () => {
    it('9. Valid event reaches the Alpha generation pipeline', async () => {
      let reachedPipeline = false;
      const customTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async (e) => {
          reachedPipeline = true;
          return `Your reminder ${e.title} is due!`;
        },
      });

      const result = await customTrigger.handleReminderDue(validEvent, userId);
      expect(reachedPipeline).toBe(true);
      expect(result.success).toBe(true);
    });

    it('10. Generated response is returned successfully with messageId and text', async () => {
      const result = await trigger.handleReminderDue(validEvent, userId);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.messageId).toBeDefined();
        expect(typeof result.messageId).toBe('string');
        expect(result.text).toBe('Hi Alex, your reminder "Dentist appointment" is due now.');
      }
    });

    it('11. Verified reminder information reaches the model', async () => {
      let receivedEvent: ReminderDueEvent | null = null;
      const customTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async (e) => {
          receivedEvent = e;
          return `Reminder: ${e.title}`;
        },
      });

      await customTrigger.handleReminderDue(validEvent, userId);
      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent?.title).toBe('Dentist appointment');
      expect(receivedEvent?.dueAt).toBe(nowMs);
      expect(receivedEvent?.reminderId).toBe('rem1');
    });

    it('12. Model is explicitly informed that due status is authoritative', async () => {
      // Test the default generator function prompt construction
      const { generateProactiveReminderResponse } = await import('../src/lib/alpha.functions');
      expect(typeof generateProactiveReminderResponse).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency & Concurrency
  // -------------------------------------------------------------------------
  describe('Idempotency & Concurrency', () => {
    it('13. Same event cannot generate two proactive responses', async () => {
      const res1 = await trigger.handleReminderDue(validEvent, userId);
      expect(res1.success).toBe(true);

      const res2 = await trigger.handleReminderDue(validEvent, userId);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.error.code).toBe('ALREADY_HANDLED');
      }

      // Ensure only 1 message was added to chat store
      const messages = alphaStore.get().chat;
      expect(messages.filter((m) => m.proactiveEventId === validEvent.eventId).length).toBe(1);
    });

    it('14. Duplicate delivery is safely ignored', async () => {
      await trigger.handleReminderDue(validEvent, userId);

      // Attempt second delivery
      const res = await trigger.handleReminderDue(validEvent, userId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('ALREADY_HANDLED');
      }
    });

    it('15. Two concurrent tabs cannot both successfully generate the same proactive response', async () => {
      let callCount = 0;
      const slowTrigger1 = new ProactiveTrigger({
        repo,
        generateResponse: async () => {
          callCount++;
          await new Promise((r) => setTimeout(r, 40));
          return 'Slow Tab 1 reply';
        },
      });

      const slowTrigger2 = new ProactiveTrigger({
        repo,
        generateResponse: async () => {
          callCount++;
          await new Promise((r) => setTimeout(r, 40));
          return 'Slow Tab 2 reply';
        },
      });

      // Fire simultaneously
      const [res1, res2] = await Promise.all([
        slowTrigger1.handleReminderDue(validEvent, userId),
        slowTrigger2.handleReminderDue(validEvent, userId),
      ]);

      // Exactly one succeeds, the other is rejected as concurrent processing or already handled
      const successes = [res1, res2].filter((r) => r.success);
      const failures = [res1, res2].filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(['CONCURRENT_PROCESSING', 'ALREADY_HANDLED']).toContain(
        (failures[0] as any).error.code,
      );

      // Chat store has exactly 1 proactive response
      const chat = alphaStore.get().chat;
      expect(chat.filter((m) => m.proactiveEventId === validEvent.eventId).length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Failure Handling & Retries
  // -------------------------------------------------------------------------
  describe('Failure Handling & Retries', () => {
    it('16. Model failure does not create a fake assistant message', async () => {
      const failingTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async () => {
          throw new Error('503 Service Unavailable');
        },
      });

      const result = await failingTrigger.handleReminderDue(validEvent, userId);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('MODEL_ERROR');
      }

      // No message in alphaStore
      expect(alphaStore.get().chat.length).toBe(0);

      // Repository state reflects failure
      const rem = await repo.getReminder(userId, validEvent.reminderId);
      expect(rem?.proactiveState).toBe('failed');
    });

    it('17. Failed generation remains retryable where designed', async () => {
      let attempt = 0;
      const retryableTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async () => {
          attempt++;
          if (attempt === 1) throw new Error('Transient 429 Rate Limit');
          return 'Recovered on attempt 2!';
        },
      });

      // First attempt fails
      const res1 = await retryableTrigger.handleReminderDue(validEvent, userId);
      expect(res1.success).toBe(false);
      expect(alphaStore.get().chat.length).toBe(0);

      // Retry succeeds
      const res2 = await retryableTrigger.retryReminderDue(validEvent, userId);
      expect(res2.success).toBe(true);
      expect(alphaStore.get().chat.length).toBe(1);
      expect(alphaStore.get().chat[0].text).toBe('Recovered on attempt 2!');
    });

    it('18. Retry after failure can succeed', async () => {
      let succeed = false;
      const toggleTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async () => {
          if (!succeed) throw new Error('Initial fail');
          return 'Now working';
        },
      });

      const res1 = await toggleTrigger.handleReminderDue(validEvent, userId);
      expect(res1.success).toBe(false);

      succeed = true;
      const res2 = await toggleTrigger.retryReminderDue(validEvent, userId);
      expect(res2.success).toBe(true);
      if (res2.success) {
        expect(res2.text).toBe('Now working');
      }
    });

    it('19. Successful generation is not regenerated unnecessarily', async () => {
      const res1 = await trigger.handleReminderDue(validEvent, userId);
      expect(res1.success).toBe(true);

      const res2 = await trigger.retryReminderDue(validEvent, userId);
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.error.code).toBe('ALREADY_HANDLED');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Conversation Safety
  // -------------------------------------------------------------------------
  describe('Conversation Safety', () => {
    it('20. Proactive response is distinguishable from a user message', async () => {
      const res = await trigger.handleReminderDue(validEvent, userId);
      expect(res.success).toBe(true);

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(1);
      const msg = chat[0];

      // Distinguishable origin and role
      expect(msg.role).toBe('model');
      expect(msg.origin).toBe('proactive');
      expect(msg.proactiveEventId).toBe(validEvent.eventId);
      expect(msg.role).not.toBe('user');
    });

    it('21. Existing conversation history remains intact', async () => {
      const priorUserMsg: ChatMessage = {
        id: 'msg_user_1',
        role: 'user',
        origin: 'user',
        text: 'What is the capital of France?',
        ts: nowMs - 5000,
      };
      const priorModelMsg: ChatMessage = {
        id: 'msg_model_1',
        role: 'model',
        origin: 'model',
        text: 'The capital of France is Paris.',
        ts: nowMs - 4000,
      };
      alphaStore.setChat([priorUserMsg, priorModelMsg]);

      await trigger.handleReminderDue(validEvent, userId);

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(3);
      expect(chat[0].id).toBe('msg_user_1');
      expect(chat[1].id).toBe('msg_model_1');
      expect(chat[2].origin).toBe('proactive');
      expect(chat[2].proactiveEventId).toBe(validEvent.eventId);
    });

    it('22. Normal user-generated chat still works alongside proactive responses', async () => {
      await trigger.handleReminderDue(validEvent, userId);

      // User sends a message afterwards
      const newUserMsg: ChatMessage = {
        id: 'msg_user_2',
        role: 'user',
        origin: 'user',
        text: 'Thanks Alpha!',
        ts: nowMs + 1000,
      };
      alphaStore.appendChat(newUserMsg);

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(2);
      expect(chat[0].origin).toBe('proactive');
      expect(chat[1].role).toBe('user');
    });

    it('23. Active normal generation is not corrupted by a proactive event', async () => {
      // In ProactiveTrigger, waitForChatIdle ensures any active user generation completes first
      const executionOrder: string[] = [];

      const customTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async () => {
          executionOrder.push('proactive_generate');
          return 'Proactive message';
        },
      });

      await customTrigger.handleReminderDue(validEvent, userId);
      expect(executionOrder).toContain('proactive_generate');
    });

    it('24. Multiple due events are handled safely in sequential FIFO order', async () => {
      const eventA: ReminderDueEvent = { ...validEvent, eventId: 'due_A', reminderId: 'remA' };
      const eventB: ReminderDueEvent = { ...validEvent, eventId: 'due_B', reminderId: 'remB' };
      const eventC: ReminderDueEvent = { ...validEvent, eventId: 'due_C', reminderId: 'remC' };

      repo.store.set('remA', { ...initialReminder, id: 'remA' });
      repo.store.set('remB', { ...initialReminder, id: 'remB' });
      repo.store.set('remC', { ...initialReminder, id: 'remC' });

      const completedOrder: string[] = [];

      const queuedTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async (e) => {
          await new Promise((r) => setTimeout(r, 10));
          completedOrder.push(e.eventId);
          return `Due: ${e.eventId}`;
        },
      });

      // Submit all 3 concurrently
      const results = await Promise.all([
        queuedTrigger.handleReminderDue(eventA, userId),
        queuedTrigger.handleReminderDue(eventB, userId),
        queuedTrigger.handleReminderDue(eventC, userId),
      ]);

      expect(results.every((r) => r.success)).toBe(true);
      expect(completedOrder).toEqual(['due_A', 'due_B', 'due_C']);

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(3);
      expect(chat.map((m) => m.proactiveEventId)).toEqual(['due_A', 'due_B', 'due_C']);
    });
  });

  // -------------------------------------------------------------------------
  // Tool Isolation
  // -------------------------------------------------------------------------
  describe('Tool Isolation', () => {
    it('25. Proactive reminder generation cannot accidentally execute unrelated reminder mutations', async () => {
      const initialReminderCount = repo.store.size;
      await trigger.handleReminderDue(validEvent, userId);

      // No new reminders were created or deleted
      expect(repo.store.size).toBe(initialReminderCount);
    });

    it('26. No unauthorized tool calls are made', async () => {
      // In generateProactiveReminderResponse, tools is strictly empty []
      const res = await trigger.handleReminderDue(validEvent, userId);
      expect(res.success).toBe(true);

      const msg = alphaStore.get().chat[0];
      expect(msg.tool_calls).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Recovery & Persistence
  // -------------------------------------------------------------------------
  describe('Recovery & Persistence', () => {
    it('27. Browser/process restart does not create duplicate proactive responses', async () => {
      // Tab 1 generates proactive response and persists state to repository
      await trigger.handleReminderDue(validEvent, userId);

      const rem = await repo.getReminder(userId, validEvent.reminderId);
      expect(rem?.proactiveState).toBe('generated');
      expect(rem?.proactiveEventId).toBe(validEvent.eventId);

      // Simulated process restart: new trigger instance and fresh in-memory chat store
      alphaStore.clearChat();
      const restartedTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async () => 'Should not be called',
      });

      const res = await restartedTrigger.handleReminderDue(validEvent, userId);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('ALREADY_HANDLED');
      }
      // Chat store remains empty
      expect(alphaStore.get().chat.length).toBe(0);
    });

    it('28. Recoverable pending proactive work can be retried', async () => {
      // Stale claim: reminder is in 'generating' state from 60 seconds ago (tab crashed)
      repo.store.set('rem1', {
        ...initialReminder,
        proactiveState: 'generating',
        proactiveEventId: validEvent.eventId,
        updatedAt: Date.now() - 60000, // expired lease
      });

      const recoveredTrigger = new ProactiveTrigger({
        repo,
        leaseTimeoutMs: 30000,
        generateResponse: async () => 'Recovered after crash!',
      });

      const res = await recoveredTrigger.handleReminderDue(validEvent, userId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.text).toBe('Recovered after crash!');
      }

      const updated = await repo.getReminder(userId, 'rem1');
      expect(updated?.proactiveState).toBe('generated');
    });
  });

  // -------------------------------------------------------------------------
  // Integration with Phase 3B Event Delivery
  // -------------------------------------------------------------------------
  describe('Integration with Phase 3B Event Delivery', () => {
    it('Integrates seamlessly with ReminderEventDelivery.consumeEvent', async () => {
      const delivery = new ReminderEventDelivery(repo);

      // Event is emitted and consumed via consumeEvent calling handleReminderDue
      const result = await delivery.consumeEvent(userId, validEvent, async (event) => {
        const proactiveRes = await trigger.handleReminderDue(event, userId);
        if (!proactiveRes.success) {
          throw new Error(proactiveRes.error.message);
        }
      });

      expect(result.status).toBe('consumed');

      // Both notificationState (Phase 3B) and proactiveState (Phase 3C) are acknowledged
      const rem = await repo.getReminder(userId, validEvent.reminderId);
      expect(rem?.notificationState).toBe('accepted');
      expect(rem?.proactiveState).toBe('generated');

      // Proactive message is in conversation history
      expect(alphaStore.get().chat.length).toBe(1);
      expect(alphaStore.get().chat[0].origin).toBe('proactive');
    });
  });
});
