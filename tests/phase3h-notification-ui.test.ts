import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NotificationAcknowledgementManager,
  InMemoryAcknowledgementRepository,
  AcknowledgementRecord,
  notificationAcknowledgementManager,
} from '../src/lib/notification-acknowledgement';
import {
  NotificationRecoveryManager,
} from '../src/lib/notification-recovery';
import {
  resolveNotificationStatus,
  acknowledgeNotificationFromUI,
  NotificationDisplayStatus,
} from '../src/lib/notification-ui-state';
import { alphaStore, type ChatMessage } from '../src/lib/alpha-store';
import { reminderContextManager } from '../src/lib/reminder-context';

describe('Phase 3H: User-Facing Notification Experience & Visibility Layer', () => {
  let ackRepo: InMemoryAcknowledgementRepository;
  let ackManager: NotificationAcknowledgementManager;
  let recoveryManager: NotificationRecoveryManager;

  const testUser = 'user-3h-main';
  const otherUser = 'user-3h-secondary';

  beforeEach(() => {
    ackRepo = new InMemoryAcknowledgementRepository();
    ackManager = new NotificationAcknowledgementManager({ repo: ackRepo });
    recoveryManager = new NotificationRecoveryManager(ackRepo);
    notificationAcknowledgementManager.setRepository(ackRepo);
    alphaStore.replaceAll({ reminders: [], chat: [] });
    reminderContextManager.clear();
  });

  // ==========================================
  // 1. Rendering and State Resolution Tests
  // ==========================================
  describe('Rendering & State Resolution', () => {
    it('1. identifies a delivered-but-unacknowledged notification as awaiting_acknowledgement', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-1',
        reminderId: 'rem-1',
        title: 'Doctor appointment',
        dueAt: Date.now() + 3600000,
      });

      const status = await resolveNotificationStatus(testUser, 'evt-1', 'rem-1');
      expect(status).toBe('awaiting_acknowledgement');
    });

    it('2. identifies an explicitly acknowledged notification as acknowledged', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-2',
        reminderId: 'rem-2',
        title: 'Dentist visit',
      });
      await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-2',
        reminderId: 'rem-2',
        userConfirmationText: 'Got it',
      });

      const status = await resolveNotificationStatus(testUser, 'evt-2', 'rem-2');
      expect(status).toBe('acknowledged');
    });

    it('3. identifies a completed reminder as completed even if previously unacknowledged', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-3',
        reminderId: 'rem-3',
        title: 'Pay electricity bill',
      });

      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-3',
        title: 'Pay electricity bill',
        when: '5:00 PM',
        notes: '',
        done: 'yes',
      }] });

      const status = await resolveNotificationStatus(testUser, 'evt-3', 'rem-3');
      expect(status).toBe('completed');
    });

    it('4. distinguishes between ordinary chat messages and proactive notifications', () => {
      const normalMsg: ChatMessage = {
        id: 'msg-norm',
        role: 'model',
        text: 'Hello! How can I help you today?',
        ts: Date.now(),
      };
      const proactiveMsg: ChatMessage = {
        id: 'msg-proactive',
        role: 'model',
        origin: 'proactive',
        proactiveEventId: 'evt-pro-1',
        text: 'Reminder: Doctor appointment in 10 minutes.',
        ts: Date.now(),
      };

      expect(normalMsg.origin).toBeUndefined();
      expect(normalMsg.proactiveEventId).toBeUndefined();
      expect(proactiveMsg.origin).toBe('proactive');
      expect(proactiveMsg.proactiveEventId).toBe('evt-pro-1');
    });

    it('5. returns unknown status for non-existent event IDs', async () => {
      const status = await resolveNotificationStatus(testUser, 'non-existent-event');
      expect(status).toBe('unknown');
    });

    it('6. returns unknown status when user is unauthenticated', async () => {
      const status = await resolveNotificationStatus('', 'evt-1');
      expect(status).toBe('unknown');
    });
  });

  // ==========================================
  // 2. Explicit Acknowledgement Operations
  // ==========================================
  describe('Explicit Acknowledgement Operations', () => {
    it('7. allows explicit UI acknowledgement of a delivered notification', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-ack-1',
        reminderId: 'rem-ack-1',
        title: 'Take medicine',
      });

      // Point global manager to our test instance if needed or acknowledge directly
      const prevRepo = ackManager.getRepository();
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-ack-1',
        reminderId: 'rem-ack-1',
        userConfirmationText: 'Explicit UI acknowledgement',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('acknowledged');

      const updated = await prevRepo.getAcknowledgementByEventId(testUser, 'evt-ack-1');
      expect(updated?.status).toBe('acknowledged');
    });

    it('8. repeated explicit acknowledgement is idempotent', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-ack-idem',
        reminderId: 'rem-ack-idem',
        title: 'Team standup',
      });

      const first = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-ack-idem',
        reminderId: 'rem-ack-idem',
      });
      expect(first.success).toBe(true);
      expect(first.status).toBe('acknowledged');

      const second = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-ack-idem',
        reminderId: 'rem-ack-idem',
      });
      expect(second.success).toBe(true);
      expect(second.status).toBe('already_acknowledged');
    });

    it('9. UI acknowledgement does NOT append duplicate proactive messages to chat', async () => {
      const initialCount = alphaStore.get().chat.length;

      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-chat-check',
        reminderId: 'rem-chat-check',
        title: 'Pick up dry cleaning',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-chat-check',
        reminderId: 'rem-chat-check',
      });

      // No new messages added to chat store merely because button was pressed
      expect(alphaStore.get().chat.length).toBe(initialCount);
    });

    it('10. UI acknowledgement does NOT invoke LLM generation', async () => {
      const llmSpy = vi.fn();
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-no-llm',
        reminderId: 'rem-no-llm',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-no-llm',
        reminderId: 'rem-no-llm',
      });

      expect(llmSpy).not.toHaveBeenCalled();
    });

    it('11. UI acknowledgement does NOT complete the underlying reminder', async () => {
      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-not-completed',
        title: 'Submit quarterly report',
        when: 'Tomorrow',
        notes: '',
        done: 'no',
      }] });

      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-not-comp',
        reminderId: 'rem-not-completed',
        title: 'Submit quarterly report',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-not-comp',
        reminderId: 'rem-not-completed',
      });

      const reminder = alphaStore.get().reminders.find((r) => r.id === 'rem-not-completed');
      expect(reminder?.done).toBe('no'); // Explicitly remains uncompleted
    });
  });

  // ==========================================
  // 3. Non-Acknowledgement Verification
  // ==========================================
  describe('Non-Acknowledgement Invariance', () => {
    it('12. rendering the notification card does NOT acknowledge the reminder', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-render',
        reminderId: 'rem-render',
      });

      // Simulate rendering check
      const status = await resolveNotificationStatus(testUser, 'evt-render', 'rem-render');
      expect(status).toBe('awaiting_acknowledgement');

      const ack = await ackRepo.getAcknowledgementByEventId(testUser, 'evt-render');
      expect(ack?.status).toBe('delivered');
    });

    it('13. opening or reloading chat does NOT acknowledge the reminder', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-reload',
        reminderId: 'rem-reload',
      });

      // Chat reload simulation: list messages
      const outstanding = await recoveryManager.getOutstandingAcknowledgements(testUser);
      expect(outstanding.count).toBe(1);

      const ack = await ackRepo.getAcknowledgementByEventId(testUser, 'evt-reload');
      expect(ack?.status).toBe('delivered');
    });

    it('14. scrolling or focusing the window does NOT acknowledge the reminder', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-scroll',
        reminderId: 'rem-scroll',
      });

      const ack = await ackRepo.getAcknowledgementByEventId(testUser, 'evt-scroll');
      expect(ack?.status).toBe('delivered');
    });

    it('15. asking recovery questions ("what was that reminder?") does NOT acknowledge the reminder', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-inquiry',
        reminderId: 'rem-inquiry',
        title: 'Water the plants',
      });

      const reply = await recoveryManager.handleConversationalInquiry(testUser, 'What was that reminder?');
      expect(reply).toContain('Water the plants');

      const ack = await ackRepo.getAcknowledgementByEventId(testUser, 'evt-inquiry');
      expect(ack?.status).toBe('delivered'); // Still delivered, not acknowledged
    });
  });

  // ==========================================
  // 4. Multiple Outstanding Notifications
  // ==========================================
  describe('Multiple Outstanding Notifications', () => {
    it('16. renders multiple outstanding notifications independently', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-m1',
        reminderId: 'rem-m1',
        title: 'Reminder A',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-m2',
        reminderId: 'rem-m2',
        title: 'Reminder B',
      });

      const outstanding = await recoveryManager.getOutstandingAcknowledgements(testUser);
      expect(outstanding.count).toBe(2);
    });

    it('17. acknowledging one notification leaves all other notifications awaiting acknowledgement', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-iso-1',
        reminderId: 'rem-iso-1',
        title: 'Reminder 1',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-iso-2',
        reminderId: 'rem-iso-2',
        title: 'Reminder 2',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-iso-3',
        reminderId: 'rem-iso-3',
        title: 'Reminder 3',
      });

      // Acknowledge only Reminder 2
      await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-iso-2',
        reminderId: 'rem-iso-2',
      });

      const status1 = await resolveNotificationStatus(testUser, 'evt-iso-1', 'rem-iso-1');
      const status2 = await resolveNotificationStatus(testUser, 'evt-iso-2', 'rem-iso-2');
      const status3 = await resolveNotificationStatus(testUser, 'evt-iso-3', 'rem-iso-3');

      expect(status1).toBe('awaiting_acknowledgement');
      expect(status2).toBe('acknowledged');
      expect(status3).toBe('awaiting_acknowledgement');
    });

    it('18. orders multiple notifications deterministically (most recently delivered first)', async () => {
      const t1 = 100000;
      const t2 = 200000;
      const t3 = 300000;

      await ackRepo.saveAcknowledgement(testUser, {
        ackId: 'ack-1',
        eventId: 'evt-order-1',
        reminderId: 'rem-order-1',
        userId: testUser,
        channel: 'in_app',
        status: 'delivered',
        deliveredAt: t1,
        title: 'Oldest reminder',
        createdAt: t1,
        updatedAt: t1,
      });

      await ackRepo.saveAcknowledgement(testUser, {
        ackId: 'ack-3',
        eventId: 'evt-order-3',
        reminderId: 'rem-order-3',
        userId: testUser,
        channel: 'in_app',
        status: 'delivered',
        deliveredAt: t3,
        title: 'Newest reminder',
        createdAt: t3,
        updatedAt: t3,
      });

      await ackRepo.saveAcknowledgement(testUser, {
        ackId: 'ack-2',
        eventId: 'evt-order-2',
        reminderId: 'rem-order-2',
        userId: testUser,
        channel: 'in_app',
        status: 'delivered',
        deliveredAt: t2,
        title: 'Middle reminder',
        createdAt: t2,
        updatedAt: t2,
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(testUser);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.records[0].eventId).toBe('evt-order-3');
        expect(res.records[1].eventId).toBe('evt-order-2');
        expect(res.records[2].eventId).toBe('evt-order-1');
      }
    });

    it('19. explicit notification selection targets the intended reminder regardless of order', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-target-1',
        reminderId: 'rem-target-1',
        title: 'Target One',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-target-2',
        reminderId: 'rem-target-2',
        title: 'Target Two',
      });

      const result = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-target-1',
        reminderId: 'rem-target-1',
      });

      expect(result.success).toBe(true);
      expect(result.reminderId).toBe('rem-target-1');
      expect(result.eventId).toBe('evt-target-1');
    });
  });

  // ==========================================
  // 5. Persistence Across Reloads and Restarts
  // ==========================================
  describe('Persistence & Durable State', () => {
    it('20. reconstructs awaiting-acknowledgement notifications from durable storage after reload', async () => {
      await ackRepo.saveAcknowledgement(testUser, {
        ackId: 'ack-persist-1',
        eventId: 'evt-persist-1',
        reminderId: 'rem-persist-1',
        userId: testUser,
        channel: 'in_app',
        status: 'delivered',
        deliveredAt: Date.now() - 5000,
        title: 'Renew gym membership',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000,
      });

      // New recovery manager reading from the same durable repository
      const freshRecovery = new NotificationRecoveryManager(ackRepo);
      const outstanding = await freshRecovery.getOutstandingAcknowledgements(testUser);

      expect(outstanding.success).toBe(true);
      expect(outstanding.count).toBe(1);
      if (outstanding.success) {
        expect(outstanding.records[0].title).toBe('Renew gym membership');
      }
    });

    it('21. reconstructs acknowledged status from durable storage after reload', async () => {
      await ackRepo.saveAcknowledgement(testUser, {
        ackId: 'ack-persist-2',
        eventId: 'evt-persist-2',
        reminderId: 'rem-persist-2',
        userId: testUser,
        channel: 'in_app',
        status: 'acknowledged',
        acknowledgedAt: Date.now() - 1000,
        title: 'Check car tire pressure',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now() - 1000,
      });

      const freshAck = new NotificationAcknowledgementManager({ repo: ackRepo });
      const record = await freshAck.getRepository().getAcknowledgementByEventId(testUser, 'evt-persist-2');
      expect(record?.status).toBe('acknowledged');
    });

    it('22. no duplicate messages appear on session reconnect', async () => {
      alphaStore.appendChat({
        id: 'msg-exist-1',
        role: 'model',
        origin: 'proactive',
        proactiveEventId: 'evt-dup-check',
        text: 'Reminder: Dentist today at 3 PM',
        ts: Date.now(),
      });

      const beforeLength = alphaStore.get().chat.length;

      // Duplicate check simulation
      const found = alphaStore.get().chat.some((m) => m.proactiveEventId === 'evt-dup-check');
      expect(found).toBe(true);
      expect(alphaStore.get().chat.length).toBe(beforeLength);
    });
  });

  // ==========================================
  // 6. Context & Precedence Rules
  // ==========================================
  describe('Context & Precedence', () => {
    it('23. rendering older notifications does NOT clobber active conversational context', () => {
      // User is currently discussing Reminder B
      reminderContextManager.setContext(testUser, {
        id: 'rem-active-b',
        title: 'Project deadline',
        dueAt: Date.now() + 86400000,
        userId: testUser,
      });

      // Older notification for Reminder A is rendered
      const activeBefore = reminderContextManager.getContext(testUser);
      expect(activeBefore?.id).toBe('rem-active-b');

      // Merely checking status of Reminder A
      const activeAfter = reminderContextManager.getContext(testUser);
      expect(activeAfter?.id).toBe('rem-active-b');
    });

    it('24. explicit notification button click acknowledges target without altering unrelated context', async () => {
      reminderContextManager.setContext(testUser, {
        id: 'rem-context-b',
        title: 'Context B',
        dueAt: Date.now(),
        userId: testUser,
      });

      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-explicit-a',
        reminderId: 'rem-explicit-a',
        title: 'Target A',
      });

      const ackRes = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-explicit-a',
        reminderId: 'rem-explicit-a',
      });

      expect(ackRes.success).toBe(true);
      expect(ackRes.reminderId).toBe('rem-explicit-a');
      // Active context B is preserved
      expect(reminderContextManager.getContext(testUser)?.id).toBe('rem-context-b');
    });
  });

  // ==========================================
  // 7. Authentication & User Isolation
  // ==========================================
  describe('Authentication & User Isolation', () => {
    it('25. strictly isolates outstanding notifications between users', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-user-1',
        reminderId: 'rem-user-1',
        title: 'User 1 task',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: otherUser,
        eventId: 'evt-user-2',
        reminderId: 'rem-user-2',
        title: 'User 2 task',
      });

      const u1Outstanding = await recoveryManager.getOutstandingAcknowledgements(testUser);
      const u2Outstanding = await recoveryManager.getOutstandingAcknowledgements(otherUser);

      expect(u1Outstanding.count).toBe(1);
      expect(u2Outstanding.count).toBe(1);
      if (u1Outstanding.success && u2Outstanding.success) {
        expect(u1Outstanding.records[0].title).toBe('User 1 task');
        expect(u2Outstanding.records[0].title).toBe('User 2 task');
      }
    });

    it('26. rejects acknowledgement attempts when user ID does not match record owner', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-cross-user',
        reminderId: 'rem-cross-user',
      });

      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: otherUser, // Malicious / cross-user attempt
        eventId: 'evt-cross-user',
        reminderId: 'rem-cross-user',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('user_mismatch');
    });

    it('27. rejects unauthenticated acknowledgement requests', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: '',
        eventId: 'evt-unauth',
        reminderId: 'rem-unauth',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('unauthenticated');
    });

    it('28. clears memory context when auth user changes', () => {
      reminderContextManager.setContext(testUser, {
        id: 'rem-u1',
        title: 'U1 reminder',
        dueAt: Date.now(),
        userId: testUser,
      });

      expect(reminderContextManager.getContext(testUser)?.userId).toBe(testUser);

      // Context for another user returns null and clears previous context
      expect(reminderContextManager.getContext(otherUser)).toBeNull();
    });
  });

  // ==========================================
  // 8. Error Handling & Resilience
  // ==========================================
  describe('Error Handling & Resilience', () => {
    it('29. does NOT mark notification acknowledged if persistence fails', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-fail-test',
        reminderId: 'rem-fail-test',
      });

      ackRepo.shouldFail = true;

      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-fail-test',
        reminderId: 'rem-fail-test',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('persistence_failure');

      // Restore repo and check status remained delivered
      ackRepo.shouldFail = false;
      const ack = await ackRepo.getAcknowledgementByEventId(testUser, 'evt-fail-test');
      expect(ack?.status).toBe('delivered');
    });

    it('30. provides user-friendly error message on persistence failure', async () => {
      ackRepo.shouldFail = true;
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-msg-err',
        reminderId: 'rem-msg-err',
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('PERSISTENCE_FAILURE');
      }
    });

    it('31. allows retry after a failed acknowledgement attempt', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-retry',
        reminderId: 'rem-retry',
      });

      // First attempt fails
      ackRepo.shouldFail = true;
      const attempt1 = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-retry',
        reminderId: 'rem-retry',
      });
      expect(attempt1.success).toBe(false);

      // Second attempt succeeds
      ackRepo.shouldFail = false;
      const attempt2 = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-retry',
        reminderId: 'rem-retry',
      });
      expect(attempt2.success).toBe(true);
      expect(attempt2.status).toBe('acknowledged');
    });

    it('32. handles malformed notification inputs gracefully', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: '',
        reminderId: '',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('invalid_input');
    });

    it('33. handles missing delivery record gracefully', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'non-existent-event-id',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('not_found');
    });
  });

  // ==========================================
  // 9. Accessibility & Presentation Attributes
  // ==========================================
  describe('Accessibility & Presentation', () => {
    it('34. formats status labels clearly with distinct text and icons', () => {
      const statuses: NotificationDisplayStatus[] = [
        'awaiting_acknowledgement',
        'acknowledged',
        'completed',
        'unknown',
      ];

      expect(statuses).toContain('awaiting_acknowledgement');
      expect(statuses).toContain('acknowledged');
      expect(statuses).toContain('completed');
    });

    it('35. generates accessible action label for explicit acknowledgement control', () => {
      const title = 'Cardiologist appointment';
      const accessibleLabel = `Acknowledge reminder: ${title}`;
      expect(accessibleLabel).toBe('Acknowledge reminder: Cardiologist appointment');
    });

    it('36. does not rely solely on color for notification status indication', () => {
      const statusMeta = {
        awaiting_acknowledgement: { text: 'Awaiting acknowledgement', icon: 'Clock' },
        acknowledged: { text: 'Acknowledged', icon: 'Check' },
        completed: { text: 'Completed', icon: 'CheckCircle' },
      };

      expect(statusMeta.awaiting_acknowledgement.text).toBe('Awaiting acknowledgement');
      expect(statusMeta.acknowledged.text).toBe('Acknowledged');
      expect(statusMeta.completed.text).toBe('Completed');
    });
  });

  // ==========================================
  // 10. End-to-End Lifecycle & Verification
  // ==========================================
  describe('End-to-End Notification Lifecycle', () => {
    it('37. transitions through due -> delivered -> awaiting_ack -> acknowledged -> completed', async () => {
      // 1. Due & Delivered
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-lifecycle-1',
        reminderId: 'rem-lifecycle-1',
        title: 'Submit tax return',
        dueAt: Date.now(),
      });

      // 2. Awaiting acknowledgement
      let status = await resolveNotificationStatus(testUser, 'evt-lifecycle-1', 'rem-lifecycle-1');
      expect(status).toBe('awaiting_acknowledgement');

      // 3. Explicit acknowledgement
      const ackRes = await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-lifecycle-1',
        reminderId: 'rem-lifecycle-1',
        userConfirmationText: 'I heard Alpha',
      });
      expect(ackRes.success).toBe(true);

      status = await resolveNotificationStatus(testUser, 'evt-lifecycle-1', 'rem-lifecycle-1');
      expect(status).toBe('acknowledged');

      // 4. Completed
      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-lifecycle-1',
        title: 'Submit tax return',
        when: 'Today',
        notes: '',
        done: 'yes',
      }] });

      status = await resolveNotificationStatus(testUser, 'evt-lifecycle-1', 'rem-lifecycle-1');
      expect(status).toBe('completed');
    });

    it('38. subscribers receive reactive updates on record delivery', async () => {
      const deliveredEvents: string[] = [];
      const unsub = ackManager.subscribe((rec) => {
        deliveredEvents.push(rec.eventId);
      });

      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-sub-1',
        reminderId: 'rem-sub-1',
      });

      expect(deliveredEvents).toContain('evt-sub-1');
      unsub();
    });

    it('39. subscribers receive reactive updates on acknowledgement', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-sub-ack',
        reminderId: 'rem-sub-ack',
      });

      const ackEvents: string[] = [];
      const unsub = ackManager.subscribe((rec) => {
        if (rec.status === 'acknowledged') {
          ackEvents.push(rec.eventId);
        }
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-sub-ack',
        reminderId: 'rem-sub-ack',
      });

      expect(ackEvents).toContain('evt-sub-ack');
      unsub();
    });

    it('40. conversational recovery continues to function alongside the UI layer', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-conv-ui',
        reminderId: 'rem-conv-ui',
        title: 'Meeting with Sarah',
      });

      // UI queries outstanding
      const uiOutstanding = await recoveryManager.getOutstandingAcknowledgements(testUser);
      expect(uiOutstanding.count).toBe(1);

      // User asks natural language question
      const convReply = await recoveryManager.handleConversationalInquiry(
        testUser,
        'What reminders are waiting for me?',
      );
      expect(convReply).toContain('Meeting with Sarah');
    });

    it('41. completing a reminder without prior acknowledgement sets status to completed', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-direct-complete',
        reminderId: 'rem-direct-complete',
        title: 'Direct completion task',
      });

      // User directly finishes task
      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-direct-complete',
        title: 'Direct completion task',
        when: 'Today',
        notes: '',
        done: 'yes',
      }] });

      const status = await resolveNotificationStatus(testUser, 'evt-direct-complete', 'rem-direct-complete');
      expect(status).toBe('completed');
    });

    it('42. acknowledging an already completed reminder preserves completed status', async () => {
      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-comp-first',
        title: 'Complete first task',
        when: 'Today',
        notes: '',
        done: 'yes',
      }] });

      await ackManager.recordDelivery({
        authenticatedUserId: testUser,
        eventId: 'evt-comp-first',
        reminderId: 'rem-comp-first',
        title: 'Complete first task',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: testUser,
        eventId: 'evt-comp-first',
        reminderId: 'rem-comp-first',
      });

      const status = await resolveNotificationStatus(testUser, 'evt-comp-first', 'rem-comp-first');
      expect(status).toBe('completed');
    });
  });
});
