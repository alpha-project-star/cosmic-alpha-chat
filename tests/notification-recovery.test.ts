import { describe, it, expect, beforeEach } from 'vitest';
import {
  NotificationRecoveryManager,
  classifyInquiryUtterance,
  OutstandingAcknowledgementRecord,
} from '../src/lib/notification-recovery';
import {
  NotificationAcknowledgementManager,
  InMemoryAcknowledgementRepository,
  generateAcknowledgementId,
} from '../src/lib/notification-acknowledgement';
import { reminderContextManager } from '../src/lib/reminder-context';

describe('Phase 3G: Persistent Notification Follow-up & Recovery', () => {
  let repo: InMemoryAcknowledgementRepository;
  let ackManager: NotificationAcknowledgementManager;
  let recoveryManager: NotificationRecoveryManager;

  const user1 = 'user_alpha_alpha';
  const user2 = 'user_beta_beta';

  beforeEach(() => {
    repo = new InMemoryAcknowledgementRepository();
    ackManager = new NotificationAcknowledgementManager({ repo });
    recoveryManager = new NotificationRecoveryManager(repo);
    reminderContextManager.clear();
  });

  describe('1. Recovery Contract & Lifecycle Separation', () => {
    it('1.1 returns empty result when no notifications exist', async () => {
      const res = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.status).toBe('empty');
        expect(res.count).toBe(0);
        expect(res.records).toEqual([]);
      }
    });

    it('1.2 recovers delivered notification as outstanding when unacknowledged', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_rec_1',
        reminderId: 'rem_rec_1',
        channel: 'in_app',
        title: 'Doctor Appointment',
        dueAt: 1770000000000,
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.status).toBe('success');
        expect(res.count).toBe(1);
        expect(res.records[0].eventId).toBe('evt_rec_1');
        expect(res.records[0].reminderId).toBe('rem_rec_1');
        expect(res.records[0].status).toBe('delivered');
        expect(res.records[0].title).toBe('Doctor Appointment');
      }
    });

    it('1.3 excludes already acknowledged records from outstanding list', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_rec_2',
        reminderId: 'rem_rec_2',
        title: 'Dentist',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_rec_2',
        userConfirmationText: 'Got it',
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.status).toBe('empty');
        expect(res.count).toBe(0);
      }
    });

    it('1.4 read-only queries do not mutate records or state', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_rec_3',
        reminderId: 'rem_rec_3',
        title: 'Submit Tax',
      });

      const before = await repo.listAcknowledgements(user1);
      await recoveryManager.getOutstandingAcknowledgements(user1);
      await recoveryManager.getOutstandingAcknowledgementForEvent(user1, 'evt_rec_3');
      await recoveryManager.getOutstandingAcknowledgementForReminder(user1, 'rem_rec_3');
      const after = await repo.listAcknowledgements(user1);

      expect(before).toEqual(after);
    });

    it('1.5 maintains stable deterministic record identity across queries', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_rec_4',
        reminderId: 'rem_rec_4',
        title: 'Buy Groceries',
      });

      const res1 = await recoveryManager.getOutstandingAcknowledgements(user1);
      const res2 = await recoveryManager.getOutstandingAcknowledgements(user1);

      expect(res1).toEqual(res2);
      if (res1.success && res2.success) {
        expect(res1.records[0].ackId).toBe('evt_rec_4:in_app:ack');
      }
    });

    it('1.6 correctly identifies delivered and unacknowledged via isDeliveredAndUnacknowledged', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_rec_5',
        reminderId: 'rem_rec_5',
      });

      const isUnack = await recoveryManager.isDeliveredAndUnacknowledged(user1, 'evt_rec_5');
      expect(isUnack).toBe(true);

      const isAck = await recoveryManager.isAcknowledged(user1, 'evt_rec_5');
      expect(isAck).toBe(false);
    });

    it('1.7 correctly identifies acknowledged state via isAcknowledged', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_rec_6',
        reminderId: 'rem_rec_6',
      });
      await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_rec_6',
      });

      const isUnack = await recoveryManager.isDeliveredAndUnacknowledged(user1, 'evt_rec_6');
      expect(isUnack).toBe(false);

      const isAck = await recoveryManager.isAcknowledged(user1, 'evt_rec_6');
      expect(isAck).toBe(true);
    });
  });

  describe('2. Persistence Across Reloads, Restarts & Session Restoration', () => {
    it('2.1 outstanding acknowledgement survives simulated browser reload with new manager instance', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_persist_1',
        reminderId: 'rem_persist_1',
        title: 'Board Meeting',
        dueAt: 1750000000000,
      });

      // Simulate reload by creating a brand new NotificationRecoveryManager with the same backing store
      const restoredRecoveryManager = new NotificationRecoveryManager(repo);
      const res = await restoredRecoveryManager.getOutstandingAcknowledgements(user1);

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.count).toBe(1);
        expect(res.records[0].title).toBe('Board Meeting');
      }
    });

    it('2.2 recovery does not create duplicate chat messages or duplicate records', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_persist_2',
        reminderId: 'rem_persist_2',
        title: 'Car Service',
      });

      const countBefore = (await repo.listAcknowledgements(user1)).length;

      // Perform 5 recovery queries
      for (let i = 0; i < 5; i++) {
        await recoveryManager.getOutstandingAcknowledgements(user1);
      }

      const countAfter = (await repo.listAcknowledgements(user1)).length;
      expect(countAfter).toBe(countBefore);
      expect(countAfter).toBe(1);
    });

    it('2.3 survives temporary network / storage errors gracefully and recovers when online', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_persist_3',
        reminderId: 'rem_persist_3',
        title: 'Flight Check-in',
      });

      repo.shouldFail = true;
      const failRes = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(failRes.success).toBe(false);
      if (!failRes.success) {
        expect(failRes.status).toBe('persistence_failure');
      }

      repo.shouldFail = false;
      const okRes = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(okRes.success).toBe(true);
      if (okRes.success) {
        expect(okRes.count).toBe(1);
      }
    });

    it('2.4 recovers specific event by ID after restart', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_persist_4',
        reminderId: 'rem_persist_4',
        title: 'Pick up dry cleaning',
      });

      const newManager = new NotificationRecoveryManager(repo);
      const res = await newManager.getOutstandingAcknowledgementForEvent(user1, 'evt_persist_4');
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.records[0].title).toBe('Pick up dry cleaning');
      }
    });

    it('2.5 recovers specific reminder by reminderId after restart', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_persist_5',
        reminderId: 'rem_persist_5',
        title: 'Renew Passport',
      });

      const newManager = new NotificationRecoveryManager(repo);
      const res = await newManager.getOutstandingAcknowledgementForReminder(user1, 'rem_persist_5');
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.records[0].title).toBe('Renew Passport');
      }
    });
  });

  describe('3. Authentication & Strict User Isolation', () => {
    it('3.1 rejects unauthenticated recovery request with structured error', async () => {
      const res = await recoveryManager.getOutstandingAcknowledgements('');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('3.2 rejects unauthenticated event query', async () => {
      const res = await recoveryManager.getOutstandingAcknowledgementForEvent('', 'evt_1');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('3.3 rejects unauthenticated reminder query', async () => {
      const res = await recoveryManager.getOutstandingAcknowledgementForReminder('', 'rem_1');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('3.4 strictly isolates records between different users', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_iso_1',
        reminderId: 'rem_iso_1',
        title: 'User 1 Task',
      });

      await ackManager.recordDelivery({
        authenticatedUserId: user2,
        eventId: 'evt_iso_2',
        reminderId: 'rem_iso_2',
        title: 'User 2 Task',
      });

      const res1 = await recoveryManager.getOutstandingAcknowledgements(user1);
      const res2 = await recoveryManager.getOutstandingAcknowledgements(user2);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      if (res1.success && res2.success) {
        expect(res1.count).toBe(1);
        expect(res1.records[0].title).toBe('User 1 Task');

        expect(res2.count).toBe(1);
        expect(res2.records[0].title).toBe('User 2 Task');
      }
    });

    it('3.5 user 2 cannot query user 1 event record', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_iso_3',
        reminderId: 'rem_iso_3',
        title: 'Confidential Reminder',
      });

      const res = await recoveryManager.getOutstandingAcknowledgementForEvent(user2, 'evt_iso_3');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe('not_found');
      }
    });

    it('3.6 clearing user context clears active context and session state without affecting other users', () => {
      reminderContextManager.setContext(user1, {
        id: 'rem_iso_4',
        title: 'Context Item',
        dueAt: Date.now(),
      });

      recoveryManager.clearUserContext(user1);
      expect(reminderContextManager.getContext(user1)).toBeNull();
    });
  });

  describe('4. Multiple Outstanding Reminders & Deterministic Ordering', () => {
    it('4.1 orders multiple outstanding reminders deterministically by delivery time descending', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_1',
        reminderId: 'rem_multi_1',
        title: 'Task A',
      });

      // Deliver second reminder later
      await new Promise((r) => setTimeout(r, 10));

      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_2',
        reminderId: 'rem_multi_2',
        title: 'Task B',
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.count).toBe(2);
        expect(res.records[0].eventId).toBe('evt_multi_2');
        expect(res.records[1].eventId).toBe('evt_multi_1');
      }
    });

    it('4.2 acknowledging one leaves other reminders intact and outstanding', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_3',
        reminderId: 'rem_multi_3',
        title: 'Doctor Appointment',
      });

      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_4',
        reminderId: 'rem_multi_4',
        title: 'Electricity Bill',
      });

      await ackManager.acknowledgeReminder({
        authenticatedUserId: user1,
        eventId: 'evt_multi_3',
        userConfirmationText: 'Yes, I heard.',
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.count).toBe(1);
        expect(res.records[0].eventId).toBe('evt_multi_4');
        expect(res.records[0].title).toBe('Electricity Bill');
      }
    });

    it('4.3 getActiveOutstandingAcknowledgement returns null when multiple exist and no context matches', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_5A',
        reminderId: 'rem_multi_5A',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_5B',
        reminderId: 'rem_multi_5B',
      });

      const active = await recoveryManager.getActiveOutstandingAcknowledgement(user1);
      expect(active).toBeNull();
    });

    it('4.4 getActiveOutstandingAcknowledgement resolves single item automatically', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_6',
        reminderId: 'rem_multi_6',
        title: 'Solo Task',
      });

      const active = await recoveryManager.getActiveOutstandingAcknowledgement(user1);
      expect(active).not.toBeNull();
      expect(active?.title).toBe('Solo Task');
    });

    it('4.5 getActiveOutstandingAcknowledgement respects conversational active context among multiple items', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_7A',
        reminderId: 'rem_multi_7A',
        title: 'Task Alpha',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_multi_7B',
        reminderId: 'rem_multi_7B',
        title: 'Task Beta',
      });

      reminderContextManager.setContext(user1, {
        id: 'rem_multi_7B',
        title: 'Task Beta',
        dueAt: Date.now(),
      });

      const active = await recoveryManager.getActiveOutstandingAcknowledgement(user1);
      expect(active?.reminderId).toBe('rem_multi_7B');
    });
  });

  describe('5. Conversational Inquiry Classification', () => {
    it('5.1 classifies "What reminder did I miss?" as missed inquiry', () => {
      const c = classifyInquiryUtterance('What reminder did I miss?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('missed');
    });

    it('5.2 classifies "Did I miss any reminder?" as missed inquiry', () => {
      const c = classifyInquiryUtterance('Did I miss any reminder?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('missed');
    });

    it('5.3 classifies "Is there anything I missed?" as missed inquiry', () => {
      const c = classifyInquiryUtterance('Is there anything I missed?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('missed');
    });

    it('5.4 classifies "What was that appointment?" as what inquiry with explicit target', () => {
      const c = classifyInquiryUtterance('What was that appointment?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('what');
    });

    it('5.5 classifies "What was that?" as what inquiry', () => {
      const c = classifyInquiryUtterance('What was that?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('what');
    });

    it('5.6 classifies "Which reminder have I not acknowledged?" as missed inquiry', () => {
      const c = classifyInquiryUtterance('Which reminder have I not acknowledged?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('missed');
    });

    it('5.7 classifies "When was that appointment?" as when inquiry', () => {
      const c = classifyInquiryUtterance('When was that appointment?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('when');
    });

    it('5.8 classifies "When is it?" as when inquiry', () => {
      const c = classifyInquiryUtterance('When is it?');
      expect(c.isInquiry).toBe(true);
      expect(c.queryType).toBe('when');
    });

    it('5.9 ignores general conversation questions', () => {
      const c = classifyInquiryUtterance('How far is the Moon?');
      expect(c.isInquiry).toBe(false);
    });

    it('5.10 ignores empty or whitespace string', () => {
      expect(classifyInquiryUtterance('').isInquiry).toBe(false);
      expect(classifyInquiryUtterance('   ').isInquiry).toBe(false);
    });
  });

  describe('6. Conversational Inquiry Answering & Follow-up Flow', () => {
    it('6.1 answers when no reminders are awaiting confirmation', async () => {
      const reply = await recoveryManager.handleConversationalInquiry(user1, 'What reminder did I miss?');
      expect(reply).toBe('You have no outstanding reminder notifications awaiting confirmation.');
    });

    it('6.2 answers with single outstanding reminder title and scheduled time', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_inq_1',
        reminderId: 'rem_inq_1',
        title: 'Dentist Checkup',
        dueAt: 1770000000000,
      });

      const reply = await recoveryManager.handleConversationalInquiry(user1, 'What was that reminder?');
      expect(reply).toContain('Dentist Checkup');
      expect(reply).toContain('delivered, but you have not acknowledged it yet');
      expect(reply).not.toContain('evt_inq_1');
      expect(reply).not.toContain('rem_inq_1');
    });

    it('6.3 synchronizes conversational context on inquiry answer', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_inq_2',
        reminderId: 'rem_inq_2',
        title: 'Team Retrospective',
        dueAt: 1770000000000,
      });

      expect(reminderContextManager.getContext(user1)).toBeNull();

      await recoveryManager.handleConversationalInquiry(user1, 'What did I miss?');

      const ctx = reminderContextManager.getContext(user1);
      expect(ctx).not.toBeNull();
      expect(ctx?.id).toBe('rem_inq_2');
      expect(ctx?.title).toBe('Team Retrospective');
    });

    it('6.4 answers "When was that appointment?" using active context or single item', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_inq_3',
        reminderId: 'rem_inq_3',
        title: 'Doctor Appointment',
        dueAt: 1770000000000,
      });

      const reply = await recoveryManager.handleConversationalInquiry(user1, 'When was that appointment?');
      expect(reply).toContain('scheduled for');
      expect(reply).toContain('Doctor Appointment');
    });

    it('6.5 lists multiple outstanding reminders cleanly and asks which one to follow up on', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_inq_4A',
        reminderId: 'rem_inq_4A',
        title: 'Pay Gas Bill',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_inq_4B',
        reminderId: 'rem_inq_4B',
        title: 'Dentist Appointment',
      });

      const reply = await recoveryManager.handleConversationalInquiry(user1, 'What reminders did I miss?');
      expect(reply).toContain('You have 2 reminders awaiting confirmation:');
      expect(reply).toContain('Pay Gas Bill');
      expect(reply).toContain('Dentist Appointment');
      expect(reply).toContain('Which one would you like to follow up on?');
    });

    it('6.6 graceful fallback message if storage fails during inquiry', async () => {
      repo.shouldFail = true;
      const reply = await recoveryManager.handleConversationalInquiry(user1, 'What reminder did I miss?');
      expect(reply).toBe('I could not verify your outstanding reminder status at this moment.');
    });
  });

  describe('7. End-to-End Delivery -> Recovery -> Explicit Acknowledgement -> Verified State', () => {
    it('7.1 full end-to-end follow-up cycle', async () => {
      // 1. Proactive delivery occurs
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_e2e_rec_1',
        reminderId: 'rem_e2e_rec_1',
        title: 'Flight to Paris',
        dueAt: 1780000000000,
      });

      // 2. User reloads browser / restarts session -> asks "What reminder did I miss?"
      const inqReply = await recoveryManager.handleConversationalInquiry(user1, 'What was that reminder?');
      expect(inqReply).toContain('Flight to Paris');
      expect(inqReply).toContain('delivered, but you have not acknowledged it yet');

      // 3. User says "Yes, I heard."
      const ackRes = await ackManager.acknowledgeFromUserUtterance(user1, 'Yes, I heard.');
      expect(ackRes.success).toBe(true);

      // 4. Follow-up inquiry confirms no outstanding reminders remain
      const followUpInquiry = await recoveryManager.handleConversationalInquiry(user1, 'Is there anything I missed?');
      expect(followUpInquiry).toBe('You have no outstanding reminder notifications awaiting confirmation.');

      // 5. Explicit status check confirms acknowledged
      const isAck = await recoveryManager.isAcknowledged(user1, 'evt_e2e_rec_1');
      expect(isAck).toBe(true);
    });

    it('7.2 multi-reminder explicit target follow-up', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_e2e_rec_2A',
        reminderId: 'rem_e2e_rec_2A',
        title: 'Electricity Payment',
      });
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_e2e_rec_2B',
        reminderId: 'rem_e2e_rec_2B',
        title: 'Doctor Appointment',
      });

      // User asks for specific reminder
      const reply = await recoveryManager.handleConversationalInquiry(user1, 'What about the electricity payment?');
      expect(reply).toContain('Electricity Payment');

      // User acknowledges only the electricity reminder
      const ackRes = await ackManager.acknowledgeFromUserUtterance(user1, 'Got the electricity payment reminder');
      expect(ackRes.success).toBe(true);
      if (ackRes.success) {
        expect(ackRes.reminderId).toBe('rem_e2e_rec_2A');
      }

      // Check remaining outstanding: doctor appointment is still pending
      const remaining = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(remaining.success).toBe(true);
      if (remaining.success) {
        expect(remaining.count).toBe(1);
        expect(remaining.records[0].title).toBe('Doctor Appointment');
      }
    });
  });

  describe('8. Autonomous-Loop Prevention & Regression Guards', () => {
    it('8.1 recovery queries do NOT mutate underlying reminder records', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_guard_1',
        reminderId: 'rem_guard_1',
        title: 'Static Reminder',
      });

      const res = await recoveryManager.getOutstandingAcknowledgements(user1);
      expect(res.success).toBe(true);
      // Delivery status remains delivered, not completed
      if (res.success) {
        expect(res.records[0].status).toBe('delivered');
      }
    });

    it('8.2 recovery queries do NOT trigger automated acknowledgements', async () => {
      await ackManager.recordDelivery({
        authenticatedUserId: user1,
        eventId: 'evt_guard_2',
        reminderId: 'rem_guard_2',
        title: 'Unacknowledged Reminder',
      });

      await recoveryManager.getOutstandingAcknowledgements(user1);
      await recoveryManager.handleConversationalInquiry(user1, 'What reminder did I miss?');

      const isAck = await recoveryManager.isAcknowledged(user1, 'evt_guard_2');
      expect(isAck).toBe(false);
    });

    it('8.3 invalid eventId in query returns structured error without throwing unhandled exception', async () => {
      const res = await recoveryManager.getOutstandingAcknowledgementForEvent(user1, '');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('INVALID_INPUT');
      }
    });

    it('8.4 invalid reminderId in query returns structured error without throwing unhandled exception', async () => {
      const res = await recoveryManager.getOutstandingAcknowledgementForReminder(user1, '');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.code).toBe('INVALID_INPUT');
      }
    });
  });
});
