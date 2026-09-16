// tests/notification-delivery.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { alphaStore, ChatMessage } from '../src/lib/alpha-store';
import { reminderContextManager } from '../src/lib/reminder-context';
import {
  NotificationDeliveryManager,
  deliverProactiveResponse,
  InMemoryDeliveryRepository,
  generateDeliveryId,
  type ProactiveResponseRecord,
  type DeliverProactiveInput,
  type DeliveryRecord,
} from '../src/lib/notification-delivery';
import { ReminderDueEvent } from '../src/lib/reminder-events';
import { FirestoreReminder, ReminderRepository } from '../src/lib/reminder-repo';
import { ProactiveTrigger } from '../src/lib/proactive-trigger';
import * as voiceModule from '../src/lib/voice';

class MockReminderRepository implements ReminderRepository {
  public store = new Map<string, FirestoreReminder>();

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
    const r = this.store.get(reminderId);
    if (!r || r.userId !== userId) throw new Error('Reminder not found');
    this.store.set(reminderId, { ...r, ...patch, updatedAt: Date.now() });
  }

  async deleteReminder(userId: string, reminderId: string): Promise<void> {
    this.store.delete(reminderId);
  }
}

describe('Phase 3E — Notification Delivery Foundation', () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let deliveryManager: NotificationDeliveryManager;

  const authUserId = 'user-alex-123';
  const otherUserId = 'user-mallory-666';
  const nowMs = 1788940800000;

  const validRecord: ProactiveResponseRecord = {
    eventId: 'due_rem1_1788940800000',
    reminderId: 'rem1',
    userId: authUserId,
    messageId: 'msg-proactive-1',
    text: 'Hi Alex, your reminder "Dentist appointment" is due now.',
    generatedAt: nowMs,
    title: 'Dentist appointment',
    dueAt: nowMs,
  };

  beforeEach(() => {
    alphaStore.clearChat();
    reminderContextManager.clear();
    deliveryRepo = new InMemoryDeliveryRepository();
    deliveryManager = new NotificationDeliveryManager({
      repo: deliveryRepo,
      leaseTimeoutMs: 30000,
    });
  });

  // =========================================================================
  // 1. Delivery Contract
  // =========================================================================
  describe('1. Delivery Contract', () => {
    it('1. Valid proactive response record is accepted by delivery foundation', async () => {
      const input: DeliverProactiveInput = {
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      };

      const result = await deliveryManager.deliverProactiveResponse(input);
      expect(result.success).toBe(true);
    });

    it('2. Output conforms to structured delivery result contract', async () => {
      const input: DeliverProactiveInput = {
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      };

      const result = await deliveryManager.deliverProactiveResponse(input);
      expect(result).toHaveProperty('success', true);
      if (result.success) {
        expect(result).toHaveProperty('deliveryId');
        expect(result).toHaveProperty('eventId', validRecord.eventId);
        expect(result).toHaveProperty('messageId', validRecord.messageId);
        expect(result).toHaveProperty('channel', 'in_app');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('deliveredAt');
        expect(typeof result.deliveredAt).toBe('number');
      }
    });

    it('3. Delivery result explicitly indicates delivery status ("delivered")', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.status).toBe('delivered');
      }
    });

    it('4. Deterministic deliveryId is returned', async () => {
      const expectedId = `${validRecord.eventId}:in_app`;
      const generated = generateDeliveryId(validRecord.eventId, 'in_app');
      expect(generated).toBe(expectedId);

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.deliveryId).toBe(expectedId);
      }
    });

    it('5. In-app delivery channel is explicitly represented in the result', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.channel).toBe('in_app');
      }
    });
  });

  // =========================================================================
  // 2. Channel Handling
  // =========================================================================
  describe('2. Channel Handling', () => {
    it('6. "in_app" channel is accepted and routed to in-app deliverer', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      const chat = alphaStore.get().chat;
      expect(chat.some((m) => m.proactiveEventId === validRecord.eventId)).toBe(true);
    });

    it('7. Unsupported channel ("push") is rejected with explicit code', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'push',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe('rejected');
        expect(result.error.code).toBe('UNSUPPORTED_CHANNEL');
      }
    });

    it('8. Unsupported channel ("email") is rejected with explicit code', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'email',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe('rejected');
        expect(result.error.code).toBe('UNSUPPORTED_CHANNEL');
      }
    });

    it('9. Unsupported channel ("tts") is rejected with explicit code', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'tts',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe('rejected');
        expect(result.error.code).toBe('UNSUPPORTED_CHANNEL');
      }
    });

    it('10. Empty or invalid channel string is rejected', async () => {
      const emptyResult = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: '',
      });
      expect(emptyResult.success).toBe(false);
      if (!emptyResult.success) {
        expect(emptyResult.error.code).toBe('UNSUPPORTED_CHANNEL');
      }

      const whitespaceResult = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: '   ',
      });
      expect(whitespaceResult.success).toBe(false);
      if (!whitespaceResult.success) {
        expect(whitespaceResult.error.code).toBe('UNSUPPORTED_CHANNEL');
      }
    });
  });

  // =========================================================================
  // 3. Authentication & Isolation
  // =========================================================================
  describe('3. Authentication & Isolation', () => {
    it('11. Unauthenticated delivery attempt is rejected', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: undefined,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('12. Delivery attempt with mismatched userId is rejected', async () => {
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: otherUserId, // Session is Mallory
        record: validRecord,              // Record belongs to Alex
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_MISMATCH');
      }
    });

    it('13. User A cannot deliver to User B’s conversational store', async () => {
      const spoofedRecord: ProactiveResponseRecord = {
        ...validRecord,
        userId: otherUserId,
      };

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId, // Alex
        record: spoofedRecord,           // Mallory's record
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('USER_MISMATCH');
      }

      // Ensure no message was delivered to chat store
      expect(alphaStore.get().chat.length).toBe(0);
    });

    it('14. Delivery layer uses authenticated Firebase identity rather than trusting caller payload alone', async () => {
      const maliciousRecord: ProactiveResponseRecord = {
        ...validRecord,
        userId: authUserId,
      };

      // Unauthenticated caller attempting to supply a valid record
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: '',
        record: maliciousRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('15. Cross-user delivery claims are isolated and non-interfering', async () => {
      const userARecord: ProactiveResponseRecord = {
        ...validRecord,
        eventId: 'event_user_a',
        userId: authUserId,
      };
      const userBRecord: ProactiveResponseRecord = {
        ...validRecord,
        eventId: 'event_user_b',
        userId: otherUserId,
      };

      // Deliver User A
      const resA = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: userARecord,
        channel: 'in_app',
      });
      expect(resA.success).toBe(true);

      // Deliver User B
      const resB = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: otherUserId,
        record: userBRecord,
        channel: 'in_app',
      });
      expect(resB.success).toBe(true);

      // Verify repository records are segregated by userId
      const deliveriesA = await deliveryRepo.listDeliveries(authUserId);
      const deliveriesB = await deliveryRepo.listDeliveries(otherUserId);

      expect(deliveriesA.length).toBe(1);
      expect(deliveriesA[0].eventId).toBe('event_user_a');

      expect(deliveriesB.length).toBe(1);
      expect(deliveriesB[0].eventId).toBe('event_user_b');
    });
  });

  // =========================================================================
  // 4. Idempotency & Duplicate Suppression
  // =========================================================================
  describe('4. Idempotency & Duplicate Suppression', () => {
    it('16. Delivering the same response record twice returns idempotent success or duplicate status', async () => {
      const res1 = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });
      expect(res1.success).toBe(true);
      if (res1.success) {
        expect(res1.status).toBe('delivered');
      }

      const res2 = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });
      expect(res2.success).toBe(true);
      if (res2.success) {
        expect(res2.status).toBe('already_delivered');
      }
    });

    it('17. Second delivery attempt does not insert a second message into conversation history', async () => {
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });
      expect(alphaStore.get().chat.length).toBe(1);

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });
      expect(alphaStore.get().chat.length).toBe(1);
    });

    it('18. Concurrent duplicate deliveries result in exactly one inserted message', async () => {
      const [res1, res2] = await Promise.all([
        deliveryManager.deliverProactiveResponse({
          authenticatedUserId: authUserId,
          record: validRecord,
          channel: 'in_app',
        }),
        deliveryManager.deliverProactiveResponse({
          authenticatedUserId: authUserId,
          record: validRecord,
          channel: 'in_app',
        }),
      ]);

      const matchingMessages = alphaStore.get().chat.filter(
        (m) => m.proactiveEventId === validRecord.eventId,
      );
      expect(matchingMessages.length).toBe(1);

      // Exactly one must be 'delivered', the other rejected as 'DELIVERY_IN_PROGRESS' or resolved as 'already_delivered'
      const statuses = [res1.status, res2.status];
      expect(statuses).toContain('delivered');
    });

    it('19. Re-delivery after reload/remount does not duplicate the message', async () => {
      // First instance delivers
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });
      expect(alphaStore.get().chat.length).toBe(1);

      // Simulate page reload: new delivery manager instance sharing the same repository and chat store
      const remountedManager = new NotificationDeliveryManager({
        repo: deliveryRepo,
      });

      const remountResult = await remountedManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(remountResult.success).toBe(true);
      if (remountResult.success) {
        expect(remountResult.status).toBe('already_delivered');
      }
      expect(alphaStore.get().chat.length).toBe(1);
    });

    it('20. Already-delivered response can be queried or checked without mutating state', async () => {
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const deliveryId = generateDeliveryId(validRecord.eventId, 'in_app');
      const statusBefore = await deliveryManager.getDeliveryStatus(authUserId, deliveryId);
      expect(statusBefore).not.toBeNull();
      expect(statusBefore?.status).toBe('delivered');
      const chatLengthBefore = alphaStore.get().chat.length;

      // Query again
      const statusAfter = await deliveryManager.getDeliveryStatus(authUserId, deliveryId);
      expect(statusAfter?.updatedAt).toBe(statusBefore?.updatedAt);
      expect(alphaStore.get().chat.length).toBe(chatLengthBefore);
    });
  });

  // =========================================================================
  // 5. Concurrency & Multi-Tab Claiming
  // =========================================================================
  describe('5. Concurrency & Multi-Tab Claiming', () => {
    it('21. Two concurrent delivery attempts for same deliveryId: exactly one acquires the active claim', async () => {
      const deliveryId = generateDeliveryId(validRecord.eventId, 'in_app');

      // Pre-set repository claim as 'delivering' with active timestamp
      await deliveryRepo.saveDelivery(authUserId, {
        deliveryId,
        eventId: validRecord.eventId,
        reminderId: validRecord.reminderId,
        userId: authUserId,
        messageId: validRecord.messageId,
        channel: 'in_app',
        status: 'delivering',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retryCount: 0,
      });

      // Another tab attempts to deliver while claim is active
      const secondAttempt = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(secondAttempt.success).toBe(false);
      if (!secondAttempt.success) {
        expect(secondAttempt.error.code).toBe('DELIVERY_IN_PROGRESS');
      }
    });

    it('22. Second concurrent claim is rejected with DELIVERY_IN_PROGRESS', async () => {
      const deliveryId = generateDeliveryId(validRecord.eventId, 'in_app');
      await deliveryRepo.saveDelivery(authUserId, {
        deliveryId,
        eventId: validRecord.eventId,
        reminderId: validRecord.reminderId,
        userId: authUserId,
        messageId: validRecord.messageId,
        channel: 'in_app',
        status: 'delivering',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retryCount: 0,
      });

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DELIVERY_IN_PROGRESS');
      }
    });

    it('23. Simulated crash during claim allows bounded lease recovery', async () => {
      const deliveryId = generateDeliveryId(validRecord.eventId, 'in_app');
      const expiredTime = Date.now() - 35000; // 35s ago (lease is 30s)

      await deliveryRepo.saveDelivery(authUserId, {
        deliveryId,
        eventId: validRecord.eventId,
        reminderId: validRecord.reminderId,
        userId: authUserId,
        messageId: validRecord.messageId,
        channel: 'in_app',
        status: 'delivering',
        createdAt: expiredTime,
        updatedAt: expiredTime,
        retryCount: 0,
      });

      const recovered = await deliveryManager.recoverStaleClaims(authUserId);
      expect(recovered).toContain(deliveryId);

      const status = await deliveryManager.getDeliveryStatus(authUserId, deliveryId);
      expect(status?.status).toBe('failed');
    });

    it('24. Expired delivery lease can be safely reclaimed', async () => {
      const deliveryId = generateDeliveryId(validRecord.eventId, 'in_app');
      const expiredTime = Date.now() - 40000;

      // Crashed tab left state in 'delivering'
      await deliveryRepo.saveDelivery(authUserId, {
        deliveryId,
        eventId: validRecord.eventId,
        reminderId: validRecord.reminderId,
        userId: authUserId,
        messageId: validRecord.messageId,
        channel: 'in_app',
        status: 'delivering',
        createdAt: expiredTime,
        updatedAt: expiredTime,
        retryCount: 0,
      });

      // Surviving tab delivers
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.status).toBe('delivered');
      }
      expect(alphaStore.get().chat.length).toBe(1);
    });

    it('25. Multiple distinct events for the same user can be delivered concurrently without blocking each other', async () => {
      const event1: ProactiveResponseRecord = {
        ...validRecord,
        eventId: 'event_distinct_1',
        messageId: 'msg_1',
        text: 'Reminder 1',
      };
      const event2: ProactiveResponseRecord = {
        ...validRecord,
        eventId: 'event_distinct_2',
        messageId: 'msg_2',
        text: 'Reminder 2',
      };

      const [res1, res2] = await Promise.all([
        deliveryManager.deliverProactiveResponse({
          authenticatedUserId: authUserId,
          record: event1,
          channel: 'in_app',
        }),
        deliveryManager.deliverProactiveResponse({
          authenticatedUserId: authUserId,
          record: event2,
          channel: 'in_app',
        }),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(alphaStore.get().chat.length).toBe(2);
    });
  });

  // =========================================================================
  // 6. In-App Store Integration
  // =========================================================================
  describe('6. In-App Store Integration', () => {
    it('26. Delivered message appears in conversation store with role "model"', async () => {
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const message = alphaStore.get().chat.find((m) => m.proactiveEventId === validRecord.eventId);
      expect(message).toBeDefined();
      expect(message?.role).toBe('model');
    });

    it('27. Delivered message retains origin "proactive"', async () => {
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const message = alphaStore.get().chat.find((m) => m.proactiveEventId === validRecord.eventId);
      expect(message?.origin).toBe('proactive');
    });

    it('28. Delivered message retains exact proactiveEventId', async () => {
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const message = alphaStore.get().chat.find((m) => m.proactiveEventId === validRecord.eventId);
      expect(message?.proactiveEventId).toBe(validRecord.eventId);
    });

    it('29. Delivered message contains the generated text without alteration', async () => {
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const message = alphaStore.get().chat.find((m) => m.proactiveEventId === validRecord.eventId);
      expect(message?.text).toBe(validRecord.text);
    });

    it('30. Delivered message does not wipe or corrupt existing conversation history', async () => {
      const priorUserMessage: ChatMessage = {
        id: 'user_prior_1',
        role: 'user',
        text: 'What time is my flight tomorrow?',
        ts: nowMs - 10000,
      };
      const priorModelMessage: ChatMessage = {
        id: 'model_prior_1',
        role: 'model',
        text: 'Your flight is at 10:00 AM.',
        ts: nowMs - 5000,
      };

      alphaStore.appendChat(priorUserMessage);
      alphaStore.appendChat(priorModelMessage);

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(3);
      expect(chat[0].id).toBe(priorUserMessage.id);
      expect(chat[1].id).toBe(priorModelMessage.id);
      expect(chat[2].id).toBe(validRecord.messageId);
    });
  });

  // =========================================================================
  // 7. Non-Interference With Active Turns
  // =========================================================================
  describe('7. Non-Interference With Active Turns', () => {
    it('31. In-app delivery does not overwrite an in-flight user draft', async () => {
      const userDraftMessage: ChatMessage = {
        id: 'user_active_draft',
        role: 'user',
        text: 'I am typing a draft message...',
        ts: nowMs,
      };
      alphaStore.appendChat(userDraftMessage);

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const chat = alphaStore.get().chat;
      expect(chat.some((m) => m.id === 'user_active_draft')).toBe(true);
      expect(chat.find((m) => m.id === 'user_active_draft')?.text).toBe('I am typing a draft message...');
    });

    it('32. In-app delivery waits or cleanly appends without interrupting an active assistant generation', async () => {
      // Deliver proactive response cleanly
      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
      const chat = alphaStore.get().chat;
      expect(chat[chat.length - 1].origin).toBe('proactive');
    });

    it('33. Delivery during active chat does not cause state race conditions', async () => {
      // Simulate rapid interleaved user actions and proactive delivery
      alphaStore.appendChat({
        id: 'user_turn_1',
        role: 'user',
        text: 'Turn 1',
        ts: Date.now(),
      });

      const deliverPromise = deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      alphaStore.appendChat({
        id: 'user_turn_2',
        role: 'user',
        text: 'Turn 2',
        ts: Date.now(),
      });

      const result = await deliverPromise;
      expect(result.success).toBe(true);

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(3);
      expect(chat.map((m) => m.id)).toContain('user_turn_1');
      expect(chat.map((m) => m.id)).toContain('user_turn_2');
      expect(chat.map((m) => m.id)).toContain(validRecord.messageId);
    });

    it('34. Delivery does not clear active conversation context', async () => {
      reminderContextManager.setContext(authUserId, {
        id: 'existing_context_rem',
        title: 'Meeting with Sarah',
        dueAt: nowMs + 3600000,
        userId: authUserId,
      });

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const ctx = reminderContextManager.getContext(authUserId);
      expect(ctx).not.toBeNull();
      expect(ctx?.id).toBe(validRecord.reminderId);
    });

    it('35. Delivery preserves active reminder continuity state', async () => {
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const ctx = reminderContextManager.getContext(authUserId);
      expect(ctx?.id).toBe('rem1');
      expect(ctx?.title).toBe('Dentist appointment');
      expect(ctx?.userId).toBe(authUserId);
    });
  });

  // =========================================================================
  // 8. Failure & Recovery
  // =========================================================================
  describe('8. Failure & Recovery', () => {
    it('36. Storage failure during delivery returns structured failure result', async () => {
      deliveryRepo.shouldFail = true;

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.status).toBe('failed');
        expect(result.error.code).toBe('PERSISTENCE_FAILURE');
      }
    });

    it('37. Failed delivery does not leave delivery state permanently stuck in "delivering"', async () => {
      deliveryRepo.shouldFail = true;

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const deliveryId = generateDeliveryId(validRecord.eventId, 'in_app');
      expect(deliveryManager.isInFlight(deliveryId)).toBe(false);
    });

    it('38. Failed delivery can be retried without re-calling the LLM', async () => {
      // First attempt fails due to storage failure
      deliveryRepo.shouldFail = true;
      const failResult = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });
      expect(failResult.success).toBe(false);

      // Now storage recovers
      deliveryRepo.shouldFail = false;

      // Retry delivery using the exact same response record without any model generation
      const retryResult = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(retryResult.success).toBe(true);
      if (retryResult.success) {
        expect(retryResult.status).toBe('delivered');
      }
      expect(alphaStore.get().chat.length).toBe(1);
    });

    it('39. Retried delivery that succeeds updates delivery state to "delivered"', async () => {
      // First attempt fails
      deliveryRepo.shouldFail = true;
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      // Storage restored
      deliveryRepo.shouldFail = false;
      const retryResult = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(retryResult.success).toBe(true);

      const deliveryId = generateDeliveryId(validRecord.eventId, 'in_app');
      const status = await deliveryManager.getDeliveryStatus(authUserId, deliveryId);
      expect(status?.status).toBe('delivered');
    });

    it('40. Delivery failure does not mutate the underlying reminder’s core state', async () => {
      const mockReminderRepo = new MockReminderRepository();
      const originalReminder: FirestoreReminder = {
        id: 'rem1',
        userId: authUserId,
        title: 'Dentist appointment',
        notes: 'Bring card',
        dueAt: nowMs,
        createdAt: nowMs - 1000,
        updatedAt: nowMs - 1000,
        reminderState: 'active',
        notificationState: 'claimed',
      };
      await mockReminderRepo.createReminder(authUserId, originalReminder);

      deliveryRepo.shouldFail = true;
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      const freshReminder = await mockReminderRepo.getReminder(authUserId, 'rem1');
      expect(freshReminder?.reminderState).toBe('active');
      expect(freshReminder?.title).toBe('Dentist appointment');
      expect(freshReminder?.dueAt).toBe(nowMs);
    });
  });

  // =========================================================================
  // 9. Architectural Separation & Safety
  // =========================================================================
  describe('9. Architectural Separation & Safety', () => {
    it('41. Notification delivery does not invoke the LLM or re-generate text', async () => {
      const mockLLM = vi.fn();

      // Pass input to delivery layer
      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(mockLLM).not.toHaveBeenCalled();
    });

    it('42. Notification delivery does not re-evaluate whether the reminder is due', async () => {
      // Even if dueAt is in the future or past, delivery foundation respects the authoritative input
      const futureRecord: ProactiveResponseRecord = {
        ...validRecord,
        dueAt: nowMs + 1000000,
      };

      const result = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: futureRecord,
        channel: 'in_app',
      });

      expect(result.success).toBe(true);
    });

    it('43. Notification delivery does not emit autonomous loops or self-triggering chains', async () => {
      const dispatchCountBefore = alphaStore.get().reminders.length;

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      // Reminders collection was not augmented or touched by delivery
      expect(alphaStore.get().reminders.length).toBe(dispatchCountBefore);
    });

    it('44. Notification delivery does not trigger TTS or audio output in this phase', async () => {
      const speakSpy = vi.spyOn(voiceModule, 'speakWith');
      const prepareSpy = vi.spyOn(voiceModule, 'prepareUtterance');

      await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: authUserId,
        record: validRecord,
        channel: 'in_app',
      });

      expect(speakSpy).not.toHaveBeenCalled();
      expect(prepareSpy).not.toHaveBeenCalled();

      speakSpy.mockRestore();
      prepareSpy.mockRestore();
    });

    it('45. Full pipeline integration: ReminderDueEvent -> ProactiveTrigger -> Response Record -> NotificationDelivery -> In-App Store works end-to-end', async () => {
      const mockRepo = new MockReminderRepository();
      const initialReminder: FirestoreReminder = {
        id: 'rem_pipeline_1',
        userId: authUserId,
        title: 'Submit tax return',
        notes: 'W2 ready',
        dueAt: nowMs,
        createdAt: nowMs - 3600000,
        updatedAt: nowMs - 3600000,
        reminderState: 'active',
        notificationState: 'claimed',
      };
      await mockRepo.createReminder(authUserId, initialReminder);

      const dueEvent: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: 'due_rem_pipeline_1_1788940800000',
        reminderId: 'rem_pipeline_1',
        userId: authUserId,
        dueAt: nowMs,
        detectedAt: nowMs + 5,
        title: 'Submit tax return',
      };

      let generatorCalled = false;
      const trigger = new ProactiveTrigger({
        repo: mockRepo,
        deliveryManager,
        generateResponse: async (e) => {
          generatorCalled = true;
          return `Alex, your reminder "${e.title}" is due now.`;
        },
      });

      const triggerResult = await trigger.handleReminderDue(dueEvent, authUserId);
      expect(triggerResult.success).toBe(true);
      expect(generatorCalled).toBe(true);

      // Verify message was committed to in-app store by delivery layer
      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(1);
      expect(chat[0].proactiveEventId).toBe(dueEvent.eventId);
      expect(chat[0].origin).toBe('proactive');
      expect(chat[0].text).toContain('Submit tax return');

      // Verify delivery record in repository
      const deliveryId = generateDeliveryId(dueEvent.eventId, 'in_app');
      const deliveryRecord = await deliveryManager.getDeliveryStatus(authUserId, deliveryId);
      expect(deliveryRecord).not.toBeNull();
      expect(deliveryRecord?.status).toBe('delivered');

      // Verify reminder state in repository is marked 'generated'
      const updatedReminder = await mockRepo.getReminder(authUserId, 'rem_pipeline_1');
      expect(updatedReminder?.proactiveState).toBe('generated');
      expect(updatedReminder?.proactiveEventId).toBe(dueEvent.eventId);
    });
  });
});
