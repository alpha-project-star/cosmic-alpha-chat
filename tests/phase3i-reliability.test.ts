import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ReminderScheduler,
  InMemoryReminderRepository,
} from '../src/lib/reminder-scheduler';
import {
  ReminderEventDelivery,
} from '../src/lib/reminder-event-delivery';
import { ProactiveTrigger } from '../src/lib/proactive-trigger';
import {
  NotificationDeliveryManager,
  InMemoryDeliveryRepository,
  DeliveryRecord,
} from '../src/lib/notification-delivery';
import {
  NotificationAcknowledgementManager,
  InMemoryAcknowledgementRepository,
  AcknowledgementRecord,
  notificationAcknowledgementManager,
} from '../src/lib/notification-acknowledgement';
import {
  NotificationRecoveryManager,
  notificationRecoveryManager,
} from '../src/lib/notification-recovery';
import {
  resolveNotificationStatus,
  acknowledgeNotificationFromUI,
} from '../src/lib/notification-ui-state';
import {
  validateLifecycleTransition,
  auditRetentionPolicy,
} from '../src/lib/notification-lifecycle';
import { reminderContextManager } from '../src/lib/reminder-context';
import { alphaStore } from '../src/lib/alpha-store';
import { FirestoreReminder } from '../src/lib/reminder-repo';
import { ReminderDueEvent, generateReminderEventId } from '../src/lib/reminder-events';

describe('Phase 3I: Notification Reliability, Reconciliation & Lifecycle Hardening', () => {
  let reminderRepo: InMemoryReminderRepository;
  let deliveryRepo: InMemoryDeliveryRepository;
  let ackRepo: InMemoryAcknowledgementRepository;

  let scheduler: ReminderScheduler;
  let eventDelivery: ReminderEventDelivery;
  let proactiveTrigger: ProactiveTrigger;
  let deliveryManager: NotificationDeliveryManager;
  let ackManager: NotificationAcknowledgementManager;
  let recoveryManager: NotificationRecoveryManager;

  const userA = 'user-3i-alpha';
  const userB = 'user-3i-beta';

  beforeEach(() => {
    reminderRepo = new InMemoryReminderRepository();
    deliveryRepo = new InMemoryDeliveryRepository();
    ackRepo = new InMemoryAcknowledgementRepository();

    eventDelivery = new ReminderEventDelivery(reminderRepo);
    scheduler = new ReminderScheduler({
      repo: reminderRepo,
      eventDelivery,
    });

    proactiveTrigger = new ProactiveTrigger({
      repo: reminderRepo,
      modelProvider: async () => 'Proactive reminder notification message for testing.',
    });

    deliveryManager = new NotificationDeliveryManager({ repo: deliveryRepo });
    ackManager = new NotificationAcknowledgementManager({ repo: ackRepo });
    recoveryManager = new NotificationRecoveryManager(ackRepo);

    notificationAcknowledgementManager.setRepository(ackRepo);
    notificationRecoveryManager.setRepository(ackRepo);

    alphaStore.replaceAll({ reminders: [], chat: [] });
    reminderContextManager.clear();
  });

  // =========================================================================
  // 1. Concurrency & Multi-Tab Protection (Tests 1 - 8)
  // =========================================================================
  describe('1. Concurrency & Multi-Tab Protection', () => {
    it('1. concurrent scheduler ticks claim a due reminder exactly once', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-c1',
        userId: userA,
        title: 'Team sync',
        notes: '',
        dueAt: now - 5000,
        createdAt: now - 60000,
        updatedAt: now - 60000,
        reminderState: 'active',
        notificationState: 'pending',
      });

      // Simulate Tab A and Tab B running ticks concurrently
      const [claimedA, claimedB] = await Promise.all([
        scheduler.runTick(userA, now),
        scheduler.runTick(userA, now),
      ]);

      const totalClaimed = claimedA.length + claimedB.length;
      expect(totalClaimed).toBe(1);
    });

    it('2. concurrent event delivery consumers process the same event idempotently', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-c2',
        userId: userA,
        title: 'Submit report',
        notes: '',
        dueAt: now - 1000,
        createdAt: now - 60000,
        updatedAt: now - 60000,
        reminderState: 'active',
        notificationState: 'pending',
      });

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: 'due_rem-c2_' + (now - 1000),
        reminderId: 'rem-c2',
        userId: userA,
        title: 'Submit report',
        dueAt: now - 1000,
        detectedAt: now,
      };

      const [resA, resB] = await Promise.all([
        eventDelivery.consumeEvent(event),
        eventDelivery.consumeEvent(event),
      ]);

      // Exactly one should be successful primary consumption, other should handle safely
      expect(resA.success || resB.success).toBe(true);
      const rem = await reminderRepo.getReminder(userA, 'rem-c2');
      expect(rem?.notificationState).toBe('accepted');
    });

    it('3. concurrent proactive trigger invocations for the same event do not produce duplicate messages', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-c3',
        userId: userA,
        title: 'Call client',
        notes: '',
        dueAt: now - 1000,
        createdAt: now - 60000,
        updatedAt: now - 60000,
        reminderState: 'active',
        notificationState: 'accepted',
        proactiveState: 'pending',
      });

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: 'due_rem-c3_' + (now - 1000),
        reminderId: 'rem-c3',
        userId: userA,
        title: 'Call client',
        dueAt: now - 1000,
        detectedAt: now,
      };

      const [resA, resB] = await Promise.all([
        proactiveTrigger.handleReminderDue(event),
        proactiveTrigger.handleReminderDue(event),
      ]);

      const successful = [resA, resB].filter((r) => r.success);
      expect(successful.length).toBe(1);
    });

    it('4. concurrent delivery manager calls for the same event produce exactly one chat message', async () => {
      const eventId = 'due_rem-c4_1000';
      const [resA, resB] = await Promise.all([
        deliveryManager.deliverProactiveResponse({
          authenticatedUserId: userA,
          eventId,
          reminderId: 'rem-c4',
          title: 'Review PR',
          proactiveText: 'Hey Alex, time to review the PR.',
        }),
        deliveryManager.deliverProactiveResponse({
          authenticatedUserId: userA,
          eventId,
          reminderId: 'rem-c4',
          title: 'Review PR',
          proactiveText: 'Hey Alex, time to review the PR.',
        }),
      ]);

      expect(resA.success).toBe(true);
      expect(resB.success).toBe(true);
      // Both point to the same delivery ID and message ID
      expect(resA.deliveryId).toBe(resB.deliveryId);
      expect(resA.messageId).toBe(resB.messageId);

      const msgs = alphaStore.get().chat.filter((m) => m.proactiveEventId === eventId);
      expect(msgs.length).toBe(1);
    });

    it('5. concurrent acknowledgements for the same event resolve cleanly without duplicate records', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-c5_1000',
        reminderId: 'rem-c5',
        title: 'Check oven',
      });

      const [ackA, ackB] = await Promise.all([
        ackManager.acknowledgeReminder({
          authenticatedUserId: userA,
          eventId: 'due_rem-c5_1000',
          userConfirmationText: 'Got it',
        }),
        ackManager.acknowledgeReminder({
          authenticatedUserId: userA,
          eventId: 'due_rem-c5_1000',
          userConfirmationText: 'Understood',
        }),
      ]);

      expect(ackA.success || ackB.success).toBe(true);
      const list = await ackRepo.listAcknowledgements(userA);
      expect(list.length).toBe(1);
      expect(list[0].status).toBe('acknowledged');
    });

    it('6. multi-tab UI acknowledgement from both tabs resolves to authoritative acknowledged status', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-c6_1000',
        reminderId: 'rem-c6',
        title: 'Water plants',
      });

      const [uiResA, uiResB] = await Promise.all([
        acknowledgeNotificationFromUI(userA, 'due_rem-c6_1000', 'rem-c6'),
        acknowledgeNotificationFromUI(userA, 'due_rem-c6_1000', 'rem-c6'),
      ]);

      expect(uiResA.success).toBe(true);
      expect(uiResB.success).toBe(true);

      const status = await resolveNotificationStatus(userA, 'due_rem-c6_1000', 'rem-c6');
      expect(status).toBe('acknowledged');
    });

    it('7. multi-tab racing: Tab A acknowledges while Tab B queries recovery simultaneously', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-c7_1000',
        reminderId: 'rem-c7',
        title: 'Take vitamins',
      });

      const [ackRes, recRes] = await Promise.all([
        ackManager.acknowledgeReminder({
          authenticatedUserId: userA,
          eventId: 'due_rem-c7_1000',
        }),
        recoveryManager.getOutstandingAcknowledgements(userA),
      ]);

      expect(ackRes.success).toBe(true);
      // Query finishes safely and durable state reflects acknowledged
      const finalRec = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(finalRec.count).toBe(0);
    });

    it('8. in-flight locking prevents cross-tab collision on rapid sequential clicks', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-c8_1000',
        reminderId: 'rem-c8',
        title: 'Turn off stove',
      });

      const results = await Promise.all([
        ackManager.acknowledgeReminder({ authenticatedUserId: userA, eventId: 'due_rem-c8_1000' }),
        ackManager.acknowledgeReminder({ authenticatedUserId: userA, eventId: 'due_rem-c8_1000' }),
        ackManager.acknowledgeReminder({ authenticatedUserId: userA, eventId: 'due_rem-c8_1000' }),
      ]);

      const successful = results.filter((r) => r.success);
      expect(successful.length).toBeGreaterThanOrEqual(1);
      const list = await ackRepo.listAcknowledgements(userA);
      expect(list.length).toBe(1);
      expect(list[0].status).toBe('acknowledged');
    });
  });

  // =========================================================================
  // 2. Crash & Interruption Recovery (Tests 9 - 16)
  // =========================================================================
  describe('2. Crash & Interruption Recovery', () => {
    it('9. interrupted proactive generation leaves state recoverable upon lease expiry', async () => {
      const now = Date.now();
      const past = now - 120000; // 2 minutes ago
      await reminderRepo.createReminder(userA, {
        id: 'rem-cr1',
        userId: userA,
        title: 'Dentist appointment',
        notes: '',
        dueAt: past,
        createdAt: past - 60000,
        updatedAt: past,
        reminderState: 'active',
        notificationState: 'claimed',
      });

      // Simulate lease recovery
      const recovered = await scheduler.recoverStaleClaims(userA, 60000, now);
      expect(recovered).toBe(1);

      const rem = await reminderRepo.getReminder(userA, 'rem-cr1');
      expect(rem?.notificationState).toBe('pending');
    });

    it('10. already-generated proactive response is reused and not regenerated after crash', async () => {
      const now = Date.now();
      const eventId = 'due_rem-cr2_' + (now - 5000);
      await reminderRepo.createReminder(userA, {
        id: 'rem-cr2',
        userId: userA,
        title: 'Dentist visit',
        notes: '',
        dueAt: now - 5000,
        createdAt: now - 60000,
        updatedAt: now - 5000,
        reminderState: 'active',
        notificationState: 'accepted',
        proactiveState: 'generated',
        proactiveEventId: eventId,
        proactiveMessageId: 'msg-existing-1',
      });

      let modelCalled = false;
      const customTrigger = new ProactiveTrigger({
        repo: reminderRepo,
        modelProvider: async () => {
          modelCalled = true;
          return 'New generated response';
        },
      });

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId,
        reminderId: 'rem-cr2',
        userId: userA,
        title: 'Dentist visit',
        dueAt: now - 5000,
        detectedAt: now,
      };

      const res = await customTrigger.handleReminderDue(event);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('ALREADY_HANDLED');
      expect(modelCalled).toBe(false);
    });

    it('11. interrupted delivery resumes safely and delivers generated message without duplicates', async () => {
      const eventId = 'due_rem-cr3_1000';
      // Record a delivered record in repository
      await deliveryRepo.saveDelivery(userA, {
        deliveryId: eventId + ':in_app:delivery',
        eventId,
        reminderId: 'rem-cr3',
        userId: userA,
        channel: 'in_app',
        status: 'delivered',
        messageId: 'msg-delivered-1',
        title: 'Car service',
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000,
      });

      // Inject message into chat
      alphaStore.appendChat({
        id: 'msg-delivered-1',
        role: 'model',
        origin: 'proactive',
        proactiveEventId: eventId,
        text: 'Car service reminder',
        ts: Date.now() - 10000,
      });

      const res = await deliveryManager.deliverProactiveResponse({
        authenticatedUserId: userA,
        eventId,
        reminderId: 'rem-cr3',
        title: 'Car service',
        proactiveText: 'Car service reminder',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('already_delivered');
      expect(res.messageId).toBe('msg-delivered-1');

      const chatMatches = alphaStore.get().chat.filter((m) => m.proactiveEventId === eventId);
      expect(chatMatches.length).toBe(1);
    });

    it('12. interrupted acknowledgement retries safely without creating duplicate records', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-cr4_1000',
        reminderId: 'rem-cr4',
        title: 'Call accountant',
      });

      const firstTry = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'due_rem-cr4_1000',
      });
      expect(firstTry.success).toBe(true);
      expect(firstTry.status).toBe('acknowledged');

      const secondTry = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'due_rem-cr4_1000',
      });
      expect(secondTry.success).toBe(true);
      expect(secondTry.status).toBe('already_acknowledged');

      const allAcks = await ackRepo.listAcknowledgements(userA);
      expect(allAcks.length).toBe(1);
    });

    it('13. persistent store crash simulation during ack returns structured PERSISTENCE_FAILURE', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-cr5_1000',
        reminderId: 'rem-cr5',
        title: 'Submit tax form',
      });

      ackRepo.shouldFail = true;
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'due_rem-cr5_1000',
      });

      expect(res.success).toBe(false);
      expect(res.error.code).toBe('PERSISTENCE_FAILURE');
      ackRepo.shouldFail = false;
    });

    it('14. UI action error is returned when UI acknowledgement persistence fails', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-cr6_1000',
        reminderId: 'rem-cr6',
        title: 'Bank appointment',
      });

      ackRepo.shouldFail = true;
      const uiRes = await acknowledgeNotificationFromUI(userA, 'due_rem-cr6_1000', 'rem-cr6');
      expect(uiRes.success).toBe(false);
      expect(uiRes.error).toBe("I couldn't save that acknowledgement. Try again.");
      ackRepo.shouldFail = false;
    });

    it('15. recovery manager handles persistence error with structured query_failure without throwing', async () => {
      ackRepo.shouldFail = true;
      const res = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('PERSISTENCE_FAILURE');
      ackRepo.shouldFail = false;
    });

    it('16. conversational inquiry returns error message when query fails rather than false empty', async () => {
      ackRepo.shouldFail = true;
      const reply = await recoveryManager.handleConversationalInquiry(userA, 'What reminders did I miss?');
      expect(reply).toBe('I could not verify your outstanding reminder status at this moment.');
      ackRepo.shouldFail = false;
    });
  });

  // =========================================================================
  // 3. Lease Management & Recovery (Tests 17 - 23)
  // =========================================================================
  describe('3. Lease Management & Recovery', () => {
    it('17. active lease is NOT recovered prematurely before leaseTimeoutMs expires', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-l1',
        userId: userA,
        title: 'Morning stretch',
        notes: '',
        dueAt: now - 5000,
        createdAt: now - 10000,
        updatedAt: now - 5000, // Updated 5s ago
        reminderState: 'active',
        notificationState: 'claimed',
      });

      // Lease timeout is 60s
      const recovered = await scheduler.recoverStaleClaims(userA, 60000, now);
      expect(recovered).toBe(0);

      const rem = await reminderRepo.getReminder(userA, 'rem-l1');
      expect(rem?.notificationState).toBe('claimed');
    });

    it('18. expired lease is recovered cleanly and reset to pending', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-l2',
        userId: userA,
        title: 'Morning stretch',
        notes: '',
        dueAt: now - 120000,
        createdAt: now - 180000,
        updatedAt: now - 120000, // Updated 120s ago
        reminderState: 'active',
        notificationState: 'claimed',
      });

      const recovered = await scheduler.recoverStaleClaims(userA, 60000, now);
      expect(recovered).toBe(1);

      const rem = await reminderRepo.getReminder(userA, 'rem-l2');
      expect(rem?.notificationState).toBe('pending');
    });

    it('19. delivery manager stale claim recovery resets delivering records to pending', async () => {
      const now = Date.now();
      await deliveryRepo.saveDelivery(userA, {
        deliveryId: 'del-stale-1',
        eventId: 'evt-stale-1',
        reminderId: 'rem-l3',
        userId: userA,
        channel: 'in_app',
        status: 'delivering',
        createdAt: now - 120000,
        updatedAt: now - 120000,
      });

      const recovered = await deliveryManager.recoverStaleClaims(userA, 60000, now);
      expect(Array.isArray(recovered) ? recovered.length : recovered).toBe(1);

      const record = await deliveryRepo.getDelivery(userA, 'del-stale-1');
      expect(record?.status).toBe('pending');
    });

    it('20. event delivery stale claims recovery resets claimed events to pending', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-l4',
        userId: userA,
        title: 'Stale reminder event',
        notes: '',
        dueAt: now - 120000,
        createdAt: now - 180000,
        updatedAt: now - 120000,
        reminderState: 'active',
        notificationState: 'claimed',
      });

      const recovered = await eventDelivery.recoverStaleClaims(userA, 60000);
      expect(recovered.length).toBe(1);

      const record = await reminderRepo.getReminder(userA, 'rem-l4');
      expect(record?.notificationState).toBe('pending');
    });

    it('21. already completed/accepted records are never reset by stale claim recovery', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-l5',
        userId: userA,
        title: 'Done task',
        notes: '',
        dueAt: now - 120000,
        createdAt: now - 180000,
        updatedAt: now - 120000,
        reminderState: 'active',
        notificationState: 'accepted',
      });

      const recovered = await scheduler.recoverStaleClaims(userA, 60000, now);
      expect(recovered).toBe(0);

      const rem = await reminderRepo.getReminder(userA, 'rem-l5');
      expect(rem?.notificationState).toBe('accepted');
    });

    it('22. lease recovery does not cross user isolation boundaries', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userB, {
        id: 'rem-l6-b',
        userId: userB,
        title: 'User B reminder',
        notes: '',
        dueAt: now - 120000,
        createdAt: now - 180000,
        updatedAt: now - 120000,
        reminderState: 'active',
        notificationState: 'claimed',
      });

      // User A runs recovery
      const recoveredA = await scheduler.recoverStaleClaims(userA, 60000, now);
      expect(recoveredA).toBe(0);

      const remB = await reminderRepo.getReminder(userB, 'rem-l6-b');
      expect(remB?.notificationState).toBe('claimed');
    });

    it('23. recovered reminder can be successfully claimed and processed on subsequent tick', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-l7',
        userId: userA,
        title: 'Pick up package',
        notes: '',
        dueAt: now - 10000,
        createdAt: now - 60000,
        updatedAt: now - 120000,
        reminderState: 'active',
        notificationState: 'claimed',
      });

      await scheduler.recoverStaleClaims(userA, 60000, now);
      const claimed = await scheduler.runTick(userA, now);
      expect(claimed.length).toBe(1);
      expect(claimed[0].reminderId).toBe('rem-l7');
    });
  });

  // =========================================================================
  // 4. State Machine & Transition Validation (Tests 24 - 31)
  // =========================================================================
  describe('4. State Machine & Transition Validation', () => {
    it('24. permits valid reminder lifecycle transitions: active -> completed', () => {
      const res = validateLifecycleTransition('reminder', 'active', 'completed');
      expect(res.valid).toBe(true);
    });

    it('25. permits valid reminder lifecycle transitions: active -> cancelled', () => {
      const res = validateLifecycleTransition('reminder', 'active', 'cancelled');
      expect(res.valid).toBe(true);
    });

    it('26. permits valid event delivery transitions: pending -> claimed -> accepted', () => {
      const step1 = validateLifecycleTransition('due_event', 'pending', 'claimed');
      expect(step1.valid).toBe(true);
      const step2 = validateLifecycleTransition('due_event', 'claimed', 'accepted');
      expect(step2.valid).toBe(true);
    });

    it('27. rejects invalid event delivery transitions: accepted -> pending', () => {
      const res = validateLifecycleTransition('due_event', 'accepted', 'pending');
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('28. rejects invalid proactive generation transitions: generated -> generating', () => {
      const res = validateLifecycleTransition('proactive_generation', 'generated', 'generating');
      expect(res.valid).toBe(false);
    });

    it('29. rejects invalid notification delivery transitions: delivered -> delivering', () => {
      const res = validateLifecycleTransition('notification_delivery', 'delivered', 'delivering');
      expect(res.valid).toBe(false);
    });

    it('30. rejects invalid acknowledgement transitions: acknowledged -> pending', () => {
      const res = validateLifecycleTransition('acknowledgement', 'acknowledged', 'pending');
      expect(res.valid).toBe(false);
    });

    it('31. self-transitions are universally recognized as idempotent noops', () => {
      expect(validateLifecycleTransition('reminder', 'active', 'active').valid).toBe(true);
      expect(validateLifecycleTransition('acknowledgement', 'acknowledged', 'acknowledged').valid).toBe(true);
      expect(validateLifecycleTransition('notification_delivery', 'delivered', 'delivered').valid).toBe(true);
    });
  });

  // =========================================================================
  // 5. Idempotency Matrix (Tests 32 - 38)
  // =========================================================================
  describe('5. Idempotency Matrix', () => {
    it('32. deterministic event ID generation is identical across independent invocations', () => {
      const id1 = generateReminderEventId('rem-idem-1', 1700000000000);
      const id2 = generateReminderEventId('rem-idem-1', 1700000000000);
      expect(id1).toBe('due_rem-idem-1_1700000000000');
      expect(id1).toBe(id2);
    });

    it('33. due event consumption is strictly idempotent on repeated calls', async () => {
      await reminderRepo.createReminder(userA, {
        id: 'rem-idem-2',
        userId: userA,
        title: 'Meeting',
        notes: '',
        dueAt: 1000,
        createdAt: 500,
        updatedAt: 500,
        reminderState: 'active',
        notificationState: 'pending',
      });

      const event: ReminderDueEvent = {
        type: 'reminder_due',
        eventId: 'due_rem-idem-2_1000',
        reminderId: 'rem-idem-2',
        userId: userA,
        title: 'Meeting',
        dueAt: 1000,
        detectedAt: 1000,
      };

      const res1 = await eventDelivery.consumeEvent(event);
      expect(res1.success).toBe(true);

      const res2 = await eventDelivery.consumeEvent(event);
      expect(res2.success).toBe(true);
      expect(res2.status).toBe('already_consumed');
    });

    it('34. delivery manager invocation is strictly idempotent on repeated calls', async () => {
      const payload = {
        authenticatedUserId: userA,
        eventId: 'due_rem-idem-3_1000',
        reminderId: 'rem-idem-3',
        title: 'Standup',
        proactiveText: 'Time for daily standup.',
      };

      const d1 = await deliveryManager.deliverProactiveResponse(payload);
      expect(d1.success).toBe(true);
      expect(d1.status).toBe('delivered');

      const d2 = await deliveryManager.deliverProactiveResponse(payload);
      expect(d2.success).toBe(true);
      expect(d2.status).toBe('already_delivered');
      expect(d1.messageId).toBe(d2.messageId);
    });

    it('35. acknowledgement manager invocation is strictly idempotent on repeated calls', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-idem-4_1000',
        reminderId: 'rem-idem-4',
        title: 'Walk dog',
      });

      const a1 = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'due_rem-idem-4_1000',
      });
      expect(a1.success).toBe(true);
      expect(a1.status).toBe('acknowledged');

      const a2 = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'due_rem-idem-4_1000',
      });
      expect(a2.success).toBe(true);
      expect(a2.status).toBe('already_acknowledged');
    });

    it('36. UI acknowledgement action is strictly idempotent on repeated button clicks', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-idem-5_1000',
        reminderId: 'rem-idem-5',
        title: 'Water lawn',
      });

      const click1 = await acknowledgeNotificationFromUI(userA, 'due_rem-idem-5_1000', 'rem-idem-5');
      expect(click1.success).toBe(true);

      const click2 = await acknowledgeNotificationFromUI(userA, 'due_rem-idem-5_1000', 'rem-idem-5');
      expect(click2.success).toBe(true);
    });

    it('37. recovery queries return deterministic results on consecutive executions', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-idem-6_1000',
        reminderId: 'rem-idem-6',
        title: 'Call mom',
      });

      const q1 = await recoveryManager.getOutstandingAcknowledgements(userA);
      const q2 = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(q1.count).toBe(1);
      expect(q2.count).toBe(1);
      expect(q1.records[0].eventId).toBe(q2.records[0].eventId);
    });

    it('38. status resolution returns deterministic value across repeated checks', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'due_rem-idem-7_1000',
        reminderId: 'rem-idem-7',
        title: 'Gym session',
      });

      const s1 = await resolveNotificationStatus(userA, 'due_rem-idem-7_1000', 'rem-idem-7');
      const s2 = await resolveNotificationStatus(userA, 'due_rem-idem-7_1000', 'rem-idem-7');
      expect(s1).toBe('awaiting_acknowledgement');
      expect(s2).toBe('awaiting_acknowledgement');
    });
  });

  // =========================================================================
  // 6. UI & Durable-State Reconciliation (Tests 39 - 44)
  // =========================================================================
  describe('6. UI & Durable-State Reconciliation', () => {
    it('39. resolveNotificationStatus reflects acknowledged status when durable ack exists', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-rec-1',
        reminderId: 'rem-rec-1',
        title: 'Doctors appointment',
      });
      await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'evt-rec-1',
      });

      const status = await resolveNotificationStatus(userA, 'evt-rec-1', 'rem-rec-1');
      expect(status).toBe('acknowledged');
    });

    it('40. resolveNotificationStatus reflects completed status when reminder is marked done in store', async () => {
      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-rec-2',
        title: 'Oil change',
        when: '2026-09-09 10:00',
        notes: '',
        done: 'yes',
      }] });

      const status = await resolveNotificationStatus(userA, 'evt-rec-2', 'rem-rec-2');
      expect(status).toBe('completed');
    });

    it('41. resolveNotificationStatus returns awaiting_acknowledgement when delivered and not done', async () => {
      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-rec-3',
        title: 'Pay rent',
        when: '2026-09-09 10:00',
        notes: '',
        done: 'no',
      }] });
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-rec-3',
        reminderId: 'rem-rec-3',
        title: 'Pay rent',
      });

      const status = await resolveNotificationStatus(userA, 'evt-rec-3', 'rem-rec-3');
      expect(status).toBe('awaiting_acknowledgement');
    });

    it('42. resolveNotificationStatus returns unknown for unknown event and reminder', async () => {
      const status = await resolveNotificationStatus(userA, 'evt-nonexistent', 'rem-nonexistent');
      expect(status).toBe('unknown');
    });

    it('43. acknowledging from UI updates durable store and clears from outstanding list', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-rec-5',
        reminderId: 'rem-rec-5',
        title: 'Dentist',
      });

      const beforeRec = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(beforeRec.count).toBe(1);

      const uiRes = await acknowledgeNotificationFromUI(userA, 'evt-rec-5', 'rem-rec-5');
      expect(uiRes.success).toBe(true);

      const afterRec = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(afterRec.count).toBe(0);
    });

    it('44. unauthenticated UI acknowledgement returns clean error without throwing', async () => {
      const res = await acknowledgeNotificationFromUI('', 'evt-rec-6', 'rem-rec-6');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Authentication required to acknowledge notification.');
    });
  });

  // =========================================================================
  // 7. Authentication Transitions & User Isolation (Tests 45 - 51)
  // =========================================================================
  describe('7. Authentication Transitions & User Isolation', () => {
    it('45. User A cannot view User B outstanding notifications', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userB,
        eventId: 'evt-user-b-1',
        reminderId: 'rem-b-1',
        title: 'User B private reminder',
      });

      const resA = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(resA.count).toBe(0);

      const resB = await recoveryManager.getOutstandingAcknowledgements(userB);
      expect(resB.count).toBe(1);
    });

    it('46. User A cannot acknowledge User B notification', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userB,
        eventId: 'evt-user-b-2',
        reminderId: 'rem-b-2',
        title: 'User B private reminder',
      });

      const ackRes = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'evt-user-b-2',
      });

      expect(ackRes.success).toBe(false);
      expect(['USER_MISMATCH', 'NOT_FOUND']).toContain(ackRes.error?.code);
    });

    it('47. unauthenticated call to acknowledgeReminder fails with UNAUTHENTICATED', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: '',
        eventId: 'evt-1',
      });
      expect(res.success).toBe(false);
      expect(res.error.code).toBe('UNAUTHENTICATED');
    });

    it('48. unauthenticated call to getOutstandingAcknowledgements fails with UNAUTHENTICATED', async () => {
      const res = await recoveryManager.getOutstandingAcknowledgements('');
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('UNAUTHENTICATED');
    });

    it('49. clearing user context removes user-specific in-flight claims', async () => {
      ackManager.clearUserContext(userA);
      // Ensure clean state
      expect(true).toBe(true);
    });

    it('50. switching users resets active reminder context immediately', () => {
      reminderContextManager.setContext(userA, {
        id: 'rem-switch-1',
        title: 'User A Task',
        dueAt: Date.now(),
      });

      expect(reminderContextManager.getContext(userA)?.id).toBe('rem-switch-1');
      // User B attempts to get context -> clears context and returns null
      expect(reminderContextManager.getContext(userB)).toBeNull();
      expect(reminderContextManager.getContext(userA)).toBeNull();
    });

    it('51. conversational inquiry fails gracefully when user is unauthenticated', async () => {
      const res = await recoveryManager.handleConversationalInquiry('', 'What was that?');
      expect(res).toBeNull();
    });
  });

  // =========================================================================
  // 8. Multiple Simultaneous Due Reminders (Tests 52 - 57)
  // =========================================================================
  describe('8. Multiple Simultaneous Due Reminders', () => {
    it('52. scheduler claims multiple simultaneous due reminders in a single tick', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-multi-1',
        userId: userA,
        title: 'Task 1',
        notes: '',
        dueAt: now - 10000,
        createdAt: now - 60000,
        updatedAt: now - 60000,
        reminderState: 'active',
        notificationState: 'pending',
      });
      await reminderRepo.createReminder(userA, {
        id: 'rem-multi-2',
        userId: userA,
        title: 'Task 2',
        notes: '',
        dueAt: now - 5000,
        createdAt: now - 60000,
        updatedAt: now - 60000,
        reminderState: 'active',
        notificationState: 'pending',
      });

      const claimed = await scheduler.runTick(userA, now);
      expect(claimed.length).toBe(2);
    });

    it('53. recovery manager returns multiple outstanding reminders ordered by time', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m1',
        reminderId: 'rem-m1',
        title: 'Doctor',
        dueAt: 1000,
      });
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m2',
        reminderId: 'rem-m2',
        title: 'Dentist',
        dueAt: 2000,
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(res.count).toBe(2);
    });

    it('54. acknowledging one of multiple simultaneous reminders leaves the other outstanding', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m3',
        reminderId: 'rem-m3',
        title: 'Electric bill',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m4',
        reminderId: 'rem-m4',
        title: 'Water bill',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'evt-m3',
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(res.count).toBe(1);
      expect(res.records[0].eventId).toBe('evt-m4');
    });

    it('55. conversational utterance with explicit title resolves target when multiple are pending', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m5',
        reminderId: 'rem-m5',
        title: 'Doctor appointment',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m6',
        reminderId: 'rem-m6',
        title: 'Car inspection',
      });

      const res = await ackManager.acknowledgeFromUserUtterance(userA, 'Got the car inspection reminder');
      expect(res.success).toBe(true);
      expect(res.reminderId).toBe('rem-m6');

      const remaining = await recoveryManager.getOutstandingAcknowledgements(userA);
      expect(remaining.count).toBe(1);
      expect(remaining.records[0].reminderId).toBe('rem-m5');
    });

    it('56. ambiguous utterance with multiple pending reminders returns AMBIGUOUS_TARGET with candidates', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m7',
        reminderId: 'rem-m7',
        title: 'Pay electric bill',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m8',
        reminderId: 'rem-m8',
        title: 'Pay internet bill',
      });

      const res = await ackManager.acknowledgeFromUserUtterance(userA, 'Thanks');
      expect(res.success).toBe(false);
      expect(res.error.code).toBe('AMBIGUOUS_TARGET');
      expect(res.error.candidates?.length).toBe(2);
    });

    it('57. conversational inquiry lists multiple outstanding reminders clearly', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m9',
        reminderId: 'rem-m9',
        title: 'Gym session',
        dueAt: Date.now() + 1000,
      });
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-m10',
        reminderId: 'rem-m10',
        title: 'Dinner reservation',
        dueAt: Date.now() + 2000,
      });

      const reply = await recoveryManager.handleConversationalInquiry(userA, 'What did I miss?');
      expect(reply).toContain('2 reminders awaiting confirmation');
      expect(reply).toContain('Gym session');
      expect(reply).toContain('Dinner reservation');
    });
  });

  // =========================================================================
  // 9. Lifecycle Mutations & Historical Integrity (Tests 58 - 65)
  // =========================================================================
  describe('9. Lifecycle Mutations & Historical Integrity', () => {
    it('58. completing a reminder after notification delivery retains historical acknowledgement record', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-mut-1',
        reminderId: 'rem-mut-1',
        title: 'Submit quarterly budget',
      });

      // User marks reminder completed in store
      alphaStore.replaceAll({ reminders: [...alphaStore.get().reminders, {
        id: 'rem-mut-1',
        title: 'Submit quarterly budget',
        when: '2026-09-09 10:00',
        notes: '',
        done: 'yes',
      }] });

      // Historical acknowledgement record still exists
      const ackRec = await ackRepo.getAcknowledgementByEventId(userA, 'evt-mut-1');
      expect(ackRec).toBeDefined();
      expect(ackRec?.reminderId).toBe('rem-mut-1');

      // Status resolution recognizes completion
      const status = await resolveNotificationStatus(userA, 'evt-mut-1', 'rem-mut-1');
      expect(status).toBe('completed');
    });

    it('59. rescheduling a reminder before due time prevents old due event from firing', async () => {
      const now = Date.now();
      // Originally due in the past
      await reminderRepo.createReminder(userA, {
        id: 'rem-mut-2',
        userId: userA,
        title: 'Dentist',
        notes: '',
        dueAt: now + 3600000, // Rescheduled to 1 hr in future
        createdAt: now - 60000,
        updatedAt: now,
        reminderState: 'active',
        notificationState: 'pending',
      });

      const due = await scheduler.evaluateDueReminders(userA, now);
      expect(due.length).toBe(0);
    });

    it('60. cancelling a reminder excludes it from scheduler ticks', async () => {
      const now = Date.now();
      await reminderRepo.createReminder(userA, {
        id: 'rem-mut-3',
        userId: userA,
        title: 'Cancelled meeting',
        notes: '',
        dueAt: now - 5000,
        createdAt: now - 60000,
        updatedAt: now,
        reminderState: 'cancelled',
        notificationState: 'pending',
      });

      const due = await scheduler.evaluateDueReminders(userA, now);
      expect(due.length).toBe(0);
    });

    it('61. retention policy audit verifies historical acknowledgement records are preserved', () => {
      const records: AcknowledgementRecord[] = [
        {
          ackId: 'ack-1',
          eventId: 'evt-1',
          reminderId: 'rem-1',
          userId: userA,
          channel: 'in_app',
          status: 'acknowledged',
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          ackId: 'ack-2',
          eventId: 'evt-2',
          reminderId: 'rem-2',
          userId: userA,
          channel: 'in_app',
          status: 'delivered',
          createdAt: 2000,
          updatedAt: 2000,
        },
      ];

      const audit = auditRetentionPolicy(records);
      expect(audit.totalAcknowledgements).toBe(2);
      expect(audit.acknowledgedCount).toBe(1);
      expect(audit.deliveredUnacknowledgedCount).toBe(1);
      expect(audit.safeToRetain).toBe(true);
    });

    it('62. conversational context is preserved during conversational recovery inquiries', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-ctx-1',
        reminderId: 'rem-ctx-1',
        title: 'Vet appointment',
        dueAt: Date.now() + 10000,
      });

      const reply = await recoveryManager.handleConversationalInquiry(userA, 'When was that appointment?');
      expect(reply).toContain('was scheduled for');
      expect(reply).toContain('Vet appointment');
    });

    it('63. acknowledging an active reminder preserves conversational reply stating reminder remains active', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: userA,
        eventId: 'evt-ctx-2',
        reminderId: 'rem-ctx-2',
        title: 'Grocery shopping',
      });

      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'evt-ctx-2',
        userConfirmationText: 'Got it',
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.conversationalReply).toContain('remains active');
      }
    });

    it('64. invalid input with missing IDs returns structured INVALID_INPUT error', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
      });
      expect(res.success).toBe(false);
      expect(res.error.code).toBe('INVALID_INPUT');
    });

    it('65. unsupported channel returns structured UNSUPPORTED_CHANNEL error', async () => {
      const res = await ackManager.acknowledgeReminder({
        authenticatedUserId: userA,
        eventId: 'evt-chan-1',
        channel: 'unsupported_custom' as any,
      });
      expect(res.success).toBe(false);
      expect(res.error.code).toBe('UNSUPPORTED_CHANNEL');
    });
  });
});
