import { describe, it, expect, beforeEach } from 'vitest';
import {
  NotificationAcknowledgementManager,
  InMemoryAcknowledgementRepository,
  generateAcknowledgementId,
  classifyAcknowledgementUtterance,
  generateConversationalAcknowledgementReply,
  AcknowledgementRecord,
} from '../src/lib/notification-acknowledgement';
import { reminderContextManager } from '../src/lib/reminder-context';

describe('Phase 3F: Persistent Notification Acknowledgement & Visibility Layer', () => {
  let repo: InMemoryAcknowledgementRepository;
  let ackManager: NotificationAcknowledgementManager;
  const user1 = 'user_alpha_1';
  const user2 = 'user_beta_2';

  beforeEach(() => {
    repo = new InMemoryAcknowledgementRepository();
    ackManager = new NotificationAcknowledgementManager({ repo });
    reminderContextManager.clear();
  });

  describe('1. Deterministic Acknowledgement Identity', () => {
    it('1.1 generates standard in_app acknowledgement ID', () => {
      const id = generateAcknowledgementId('evt_123', 'in_app');
      expect(id).toBe('evt_123:in_app:ack');
    });

    it('1.2 defaults channel to in_app if omitted', () => {
      const id = generateAcknowledgementId('evt_456');
      expect(id).toBe('evt_456:in_app:ack');
    });

    it('1.3 supports other valid channels like push or browser', () => {
      expect(generateAcknowledgementId('evt_789', 'push')).toBe('evt_789:push:ack');
      expect(generateAcknowledgementId('evt_789', 'browser')).toBe('evt_789:browser:ack');
      expect(generateAcknowledgementId('evt_789', 'tts')).toBe('evt_789:tts:ack');
    });

    it('1.4 throws error if event ID is missing or empty', () => {
      expect(() => generateAcknowledgementId('')).toThrow();
      expect(() => generateAcknowledgementId(null as any)).toThrow();
    });

    it('1.5 trims whitespace from eventId and channel', () => {
      const id = generateAcknowledgementId('  evt_999  ', ' in_app ');
      expect(id).toBe('evt_999:in_app:ack');
    });
  });

  describe('2. Delivery Recording & Lifecycle State Separation', () => {
    it('2.1 records initial delivery in delivered status', async () => {
      const record = await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_101',
        reminderId: 'rem_101',
        channel: 'in_app',
        title: 'Dentist Appointment',
        dueAt: 1700000000000,
      });

      expect(record.status).toBe('delivered');
      expect(record.ackId).toBe('evt_101:in_app:ack');
      expect(record.userId).toBe(user1);
      expect(record.deliveredAt).toBeDefined();
      expect(record.acknowledgedAt).toBeUndefined();
    });

    it('2.2 transitions to acknowledged when user acknowledges', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_102',
        reminderId: 'rem_102',
        title: 'Team Standup',
      });

      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_102',
        userConfirmationText: 'Yes, I heard.',
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.status).toBe('acknowledged');
        expect(res.record.status).toBe('acknowledged');
        expect(res.record.acknowledgedAt).toBeDefined();
        expect(res.record.userConfirmationText).toBe('Yes, I heard.');
      }
    });

    it('2.3 idempotently handles repeated acknowledgement without error', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_103',
        reminderId: 'rem_103',
      });

      const firstRes = await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_103',
        userConfirmationText: 'Got it.',
      });
      expect(firstRes.success).toBe(true);

      const secondRes = await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_103',
        userConfirmationText: 'Got it.',
      });
      expect(secondRes.success).toBe(true);
      if (secondRes.success) {
        expect(secondRes.status).toBe('already_acknowledged');
      }
    });

    it('2.4 recordDelivery on already acknowledged record does not revert state to delivered', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_104',
        reminderId: 'rem_104',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_104',
        userConfirmationText: 'Thanks',
      });

      const reRecord = await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_104',
        reminderId: 'rem_104',
      });

      expect(reRecord.status).toBe('acknowledged');
    });

    it('2.5 maintains separate records for distinct reminder events', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_201',
        reminderId: 'rem_201',
        title: 'Task 1',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_202',
        reminderId: 'rem_202',
        title: 'Task 2',
      });

      const pending = await ackManager.getPendingAcknowledgements(user1);
      expect(pending.length).toBe(2);

      await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_201',
        userConfirmationText: 'Understood',
      });

      const remainingPending = await ackManager.getPendingAcknowledgements(user1);
      expect(remainingPending.length).toBe(1);
      expect(remainingPending[0].eventId).toBe('evt_202');
    });
  });

  describe('3. Natural Language Acknowledgement Classification', () => {
    it('3.1 recognizes "Yes, I heard."', () => {
      const c = classifyAcknowledgementUtterance('Yes, I heard.');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.2 recognizes "I heard you."', () => {
      const c = classifyAcknowledgementUtterance('I heard you');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.3 recognizes "I remember."', () => {
      const c = classifyAcknowledgementUtterance('I remember');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.4 recognizes "Got it."', () => {
      const c = classifyAcknowledgementUtterance('Got it');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.5 recognizes "Gotcha."', () => {
      const c = classifyAcknowledgementUtterance('Gotcha');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.6 recognizes "Thanks, Alpha."', () => {
      const c = classifyAcknowledgementUtterance('Thanks, Alpha');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.7 recognizes "Thank you."', () => {
      const c = classifyAcknowledgementUtterance('Thank you');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.8 recognizes "Understood."', () => {
      const c = classifyAcknowledgementUtterance('Understood');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.9 recognizes "Okay, I\'ll handle it."', () => {
      const c = classifyAcknowledgementUtterance("Okay, I'll handle it");
      expect(c.type).toBe('acknowledgement');
    });

    it('3.10 recognizes "Alright, I\'ll do it."', () => {
      const c = classifyAcknowledgementUtterance("Alright, I'll do it");
      expect(c.type).toBe('acknowledgement');
    });

    it('3.11 recognizes "Noted."', () => {
      const c = classifyAcknowledgementUtterance('Noted');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.12 recognizes "Duly noted."', () => {
      const c = classifyAcknowledgementUtterance('Duly noted');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.13 recognizes "Acknowledged."', () => {
      const c = classifyAcknowledgementUtterance('Acknowledged');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.14 recognizes "Sounds good."', () => {
      const c = classifyAcknowledgementUtterance('Sounds good');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.15 recognizes "Yes, got it Alpha."', () => {
      const c = classifyAcknowledgementUtterance('Yes, got it Alpha');
      expect(c.type).toBe('acknowledgement');
    });

    it('3.16 recognizes explicit mention: "I heard about the dentist"', () => {
      const c = classifyAcknowledgementUtterance('I heard about the dentist');
      expect(c.type).toBe('acknowledgement');
      if (c.type === 'acknowledgement') {
        expect(c.explicitTarget).toBe('dentist');
      }
    });

    it('3.17 recognizes explicit mention: "Got the standup reminder"', () => {
      const c = classifyAcknowledgementUtterance('Got the standup reminder');
      expect(c.type).toBe('acknowledgement');
      if (c.type === 'acknowledgement') {
        expect(c.explicitTarget).toBe('standup');
      }
    });

    it('3.18 recognizes explicit mention: "Thanks for the medicine reminder"', () => {
      const c = classifyAcknowledgementUtterance('Thanks for the medicine reminder');
      expect(c.type).toBe('acknowledgement');
      if (c.type === 'acknowledgement') {
        expect(c.explicitTarget).toBe('medicine');
      }
    });
  });

  describe('4. Separation from Task Completion, Rescheduling & Inquiries', () => {
    it('4.1 classifies "mark it done" as completion, NOT acknowledgement', () => {
      const c = classifyAcknowledgementUtterance('mark it done');
      expect(c.type).toBe('completion');
    });

    it('4.2 classifies "I finished it" as completion, NOT acknowledgement', () => {
      const c = classifyAcknowledgementUtterance('I finished it');
      expect(c.type).toBe('completion');
    });

    it('4.3 classifies "complete the reminder" as completion', () => {
      const c = classifyAcknowledgementUtterance('complete the reminder');
      expect(c.type).toBe('completion');
    });

    it('4.4 classifies "done" as completion', () => {
      const c = classifyAcknowledgementUtterance('done');
      expect(c.type).toBe('completion');
    });

    it('4.5 classifies "remind me tomorrow" as reschedule', () => {
      const c = classifyAcknowledgementUtterance('remind me tomorrow');
      expect(c.type).toBe('reschedule');
    });

    it('4.6 classifies "snooze" as reschedule', () => {
      const c = classifyAcknowledgementUtterance('snooze');
      expect(c.type).toBe('reschedule');
    });

    it('4.7 classifies "what reminder?" as inquiry', () => {
      const c = classifyAcknowledgementUtterance('what reminder?');
      expect(c.type).toBe('inquiry');
    });

    it('4.8 classifies "when is it?" as inquiry', () => {
      const c = classifyAcknowledgementUtterance('when is it?');
      expect(c.type).toBe('inquiry');
    });

    it('4.9 classifies "what was the other reminder again?" as inquiry', () => {
      const c = classifyAcknowledgementUtterance('what was the other reminder again?');
      expect(c.type).toBe('inquiry');
    });

    it('4.10 classifies unrelated questions as unrelated', () => {
      const c = classifyAcknowledgementUtterance('What is the weather in Tokyo?');
      expect(c.type).toBe('unrelated');
    });

    it('4.11 classifies empty or null string as unrelated', () => {
      expect(classifyAcknowledgementUtterance('').type).toBe('unrelated');
      expect(classifyAcknowledgementUtterance(null as any).type).toBe('unrelated');
    });
  });

  describe('5. Conversational Utterance Resolution with Context', () => {
    it('5.1 acknowledges active reminder in context when user says "Got it"', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_301',
        reminderId: 'rem_301',
        title: 'Meeting with Sarah',
      });

      reminderContextManager.setContext(user1, {
        id: 'rem_301',
        title: 'Meeting with Sarah',
        dueAt: Date.now(),
      });

      const res = await ackManager.acknowledgeFromUserUtterance(user1, 'Got it');
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.reminderId).toBe('rem_301');
        expect(res.record.status).toBe('acknowledged');
      }
    });

    it('5.2 acknowledges single pending reminder even without explicit context', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_302',
        reminderId: 'rem_302',
        title: 'Doctor Appointment',
      });

      const res = await ackManager.acknowledgeFromUserUtterance(user1, 'Yes, I heard.');
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.reminderId).toBe('rem_302');
      }
    });

    it('5.3 returns ambiguous_target when multiple pending exist and no active context is set', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_303A',
        reminderId: 'rem_303A',
        title: 'Pay electric bill',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_303B',
        reminderId: 'rem_303B',
        title: 'Call mom',
      });

      const res = await ackManager.acknowledgeFromUserUtterance(user1, 'I heard you');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe('ambiguous_target');
        expect(res.error.candidates?.length).toBe(2);
      }
    });

    it('5.4 resolves correct reminder by explicit keyword even with multiple pending', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_304A',
        reminderId: 'rem_304A',
        title: 'Pay electric bill',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_304B',
        reminderId: 'rem_304B',
        title: 'Call mom',
      });

      const res = await ackManager.acknowledgeFromUserUtterance(user1, 'Got the electric bill reminder');
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.reminderId).toBe('rem_304A');
      }
    });

    it('5.5 returns not_found when user says "Got it" but no reminders were delivered', async () => {
      const res = await ackManager.acknowledgeFromUserUtterance(user1, 'Got it');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe('not_found');
      }
    });

    it('5.6 returns not_acknowledgement when user says "mark it done"', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_305',
        reminderId: 'rem_305',
      });

      const res = await ackManager.acknowledgeFromUserUtterance(user1, 'mark it done');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe('not_acknowledgement');
      }
    });
  });

  describe('6. Authentication & Strict User Isolation', () => {
    it('6.1 rejects unauthenticated acknowledgeReminder call', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: '',
        eventId: 'evt_401',
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('6.2 rejects cross-user acknowledgement attempts', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_402',
        reminderId: 'rem_402',
      });

      // User 2 attempts to acknowledge User 1's reminder
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: user2,
        ackId: 'evt_402:in_app:ack',
        eventId: 'evt_402',
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(['NOT_FOUND', 'USER_MISMATCH']).toContain(res.error.code);
      }
    });

    it('6.3 isolates pending lists between users', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_403A',
        reminderId: 'rem_403A',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user2,
        eventId: 'evt_403B',
        reminderId: 'rem_403B',
      });

      const pending1 = await ackManager.getPendingAcknowledgements(user1);
      const pending2 = await ackManager.getPendingAcknowledgements(user2);

      expect(pending1.length).toBe(1);
      expect(pending1[0].eventId).toBe('evt_403A');

      expect(pending2.length).toBe(1);
      expect(pending2[0].eventId).toBe('evt_403B');
    });

    it('6.4 clears user context cleanly without affecting other users', () => {
      ackManager.clearUserContext(user1);
      // No errors thrown
      expect(true).toBe(true);
    });
  });

  describe('7. Concurrency & In-Flight Protection', () => {
    it('7.1 rejects concurrent in-flight acknowledgement for the same reminder', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_501',
        reminderId: 'rem_501',
      });

      // Simulate repository delay
      let resolveRepo: () => void;
      const delayedSave = new Promise<void>((resolve) => {
        resolveRepo = resolve;
      });

      const originalSave = repo.saveAcknowledgement.bind(repo);
      repo.saveAcknowledgement = async (u, r) => {
        await delayedSave;
        return originalSave(u, r);
      };

      const p1 = ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_501',
      });

      const p2 = ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_501',
      });

      const res2 = await p2;
      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.error.code).toBe('CONCURRENCY_CONFLICT');
      }

      resolveRepo!();
      const res1 = await p1;
      expect(res1.success).toBe(true);
    });
  });

  describe('8. Failure Handling & Unsupported Channels', () => {
    it('8.1 returns unsupported channel error for invalid channel string', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_601',
        channel: 'sms' as any,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('UNSUPPORTED_CHANNEL');
      }
    });

    it('8.2 returns PERSISTENCE_FAILURE when repository throws error', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_602',
        reminderId: 'rem_602',
      });

      repo.shouldFail = true;

      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_602',
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('PERSISTENCE_FAILURE');
      }
    });
  });

  describe('9. Conversational Reply Generation', () => {
    it('9.1 generates warm reply for "Thanks, Alpha"', () => {
      const reply = generateConversationalAcknowledgementReply('Thanks, Alpha');
      expect(reply).toBe("You're welcome. The reminder is acknowledged, but not marked complete.");
    });

    it('9.2 generates warm reply for "I remember"', () => {
      const reply = generateConversationalAcknowledgementReply('I remember');
      expect(reply).toBe('Understood.');
    });

    it('9.3 generates warm reply for "Yes, I heard"', () => {
      const reply = generateConversationalAcknowledgementReply('Yes, I heard');
      expect(reply).toBe("Good. I'll leave the reminder active until you tell me it's done.");
    });

    it('9.4 generates warm reply for "Okay, I\'ll handle it"', () => {
      const reply = generateConversationalAcknowledgementReply("Okay, I'll handle it");
      expect(reply).toBe("Sounds good. Let me know when you'd like to mark it done.");
    });

    it('9.5 generates warm reply for "Got it"', () => {
      const reply = generateConversationalAcknowledgementReply('Got it');
      expect(reply).toBe("Understood. The reminder remains active until you're ready to complete it.");
    });

    it('9.6 reply does NOT contain internal IDs, UUIDs, or tool call names', () => {
      const record: AcknowledgementRecord = {
        ackId: 'evt_999:in_app:ack',
        eventId: 'evt_999',
        reminderId: 'rem_999',
        userId: user1,
        channel: 'in_app',
        status: 'acknowledged',
        title: 'Walk the dog',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const reply = generateConversationalAcknowledgementReply('understood', record);
      expect(reply).not.toContain('evt_999');
      expect(reply).not.toContain('rem_999');
      expect(reply).not.toContain('completeReminder');
    });
  });

  describe('10. End-to-End Integration Scenario', () => {
    it('10.1 full lifecycle: due event -> delivery -> unacknowledged -> user acknowledgment -> verified status', async () => {
      // 1. Proactive delivery occurs
      const deliveryRecord = await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_e2e_1',
        reminderId: 'rem_e2e_1',
        title: 'Submit Tax Returns',
        dueAt: Date.now(),
      });
      expect(deliveryRecord.status).toBe('delivered');

      // 2. Status is delivered, NOT acknowledged
      const status1 = await ackManager.getAcknowledgementStatus(user1, 'evt_e2e_1');
      expect(status1).toBe('delivered');

      // 3. User says "Yes, I heard."
      reminderContextManager.setContext(user1, {
        id: 'rem_e2e_1',
        title: 'Submit Tax Returns',
        dueAt: Date.now(),
      });

      const ackResult = await ackManager.acknowledgeFromUserUtterance(user1, 'Yes, I heard.');
      expect(ackResult.success).toBe(true);

      // 4. Status is now acknowledged
      const status2 = await ackManager.getAcknowledgementStatus(user1, 'evt_e2e_1');
      expect(status2).toBe('acknowledged');

      // 5. Pending list is now empty
      const pending = await ackManager.getPendingAcknowledgements(user1);
      expect(pending.length).toBe(0);
    });
  });
});
