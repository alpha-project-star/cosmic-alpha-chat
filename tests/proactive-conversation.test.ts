// tests/proactive-conversation.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { ReminderDueEvent } from '../src/lib/reminder-events';
import { ReminderRepository, FirestoreReminder } from '../src/lib/reminder-repo';
import { alphaStore, ChatMessage } from '../src/lib/alpha-store';
import {
  ProactiveTrigger,
  handleReminderDue,
} from '../src/lib/proactive-trigger';
import { reminderContextManager } from '../src/lib/reminder-context';
import { ReminderTool } from '../src/lib/reminder-tool';

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
    this.store.set(reminderId, { ...r, ...patch, updatedAt: Date.now() });
  }

  async deleteReminder(userId: string, reminderId: string): Promise<void> {
    this.store.delete(reminderId);
  }
}

describe('Phase 3D — Proactive Conversation Continuity & Lifecycle Hardening', () => {
  let repo: MockReminderRepository;
  let trigger: ProactiveTrigger;
  const userA = 'user-alex-123';
  const userB = 'user-charlie-456';
  const nowMs = 1788940800000;

  const validDueEvent: ReminderDueEvent = {
    type: 'reminder_due',
    eventId: 'due_rem_dentist_1788940800000',
    reminderId: 'rem-dentist-1',
    userId: userA,
    dueAt: nowMs,
    detectedAt: nowMs + 10,
    title: 'Dentist appointment',
  };

  beforeEach(() => {
    alphaStore.clearChat();
    reminderContextManager.clear();

    repo = new MockReminderRepository();
    repo.store.set('rem-dentist-1', {
      id: 'rem-dentist-1',
      userId: userA,
      title: 'Dentist appointment',
      dueAt: nowMs,
      notes: 'Bring insurance card and medical history',
      createdAt: nowMs - 3600000,
      updatedAt: nowMs - 3600000,
      reminderState: 'active',
      notificationState: 'claimed',
    });

    repo.store.set('rem-gym-2', {
      id: 'rem-gym-2',
      userId: userA,
      title: 'Gym workout',
      dueAt: nowMs + 7200000,
      notes: 'Leg day session',
      createdAt: nowMs - 3600000,
      updatedAt: nowMs - 3600000,
      reminderState: 'active',
      notificationState: 'pending',
    });

    trigger = new ProactiveTrigger({
      repo,
      generateResponse: async () => 'Hi Alex, your reminder "Dentist appointment" is due now.',
    });
  });

  describe('1. Proactive Event Context Initialization', () => {
    it('sets conversational active context in ReminderContextManager when proactive message succeeds', async () => {
      const result = await trigger.handleReminderDue(validDueEvent, userA);
      expect(result.success).toBe(true);

      const activeCtx = reminderContextManager.getContext(userA);
      expect(activeCtx).not.toBeNull();
      expect(activeCtx?.id).toBe('rem-dentist-1');
      expect(activeCtx?.title).toBe('Dentist appointment');
      expect(activeCtx?.dueAt).toBe(nowMs);
      expect(activeCtx?.notes).toBe('Bring insurance card and medical history');
    });

    it('persists assistant message with origin: proactive in alphaStore', async () => {
      const result = await trigger.handleReminderDue(validDueEvent, userA);
      expect(result.success).toBe(true);

      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(1);
      expect(chat[0].role).toBe('model');
      expect(chat[0].origin).toBe('proactive');
      expect(chat[0].proactiveEventId).toBe(validDueEvent.eventId);
      expect(chat[0].text).toContain('Dentist appointment');
    });

    it('does not establish active context when proactive generation fails', async () => {
      const failingTrigger = new ProactiveTrigger({
        repo,
        generateResponse: async () => {
          throw new Error('LLM connection error');
        },
      });

      const result = await failingTrigger.handleReminderDue(validDueEvent, userA);
      expect(result.success).toBe(false);

      const activeCtx = reminderContextManager.getContext(userA);
      expect(activeCtx).toBeNull();
      expect(alphaStore.get().chat.length).toBe(0);
    });
  });

  describe('2. Conversational Continuity & Follow-Up Questions', () => {
    it('provides active reminder context for follow-up questions without re-querying', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      // Simulate user follow-up turn in chat
      const followUpUserMessage: ChatMessage = {
        id: 'msg-user-1',
        role: 'user',
        text: 'What appointment?',
        ts: Date.now(),
      };
      alphaStore.appendChat(followUpUserMessage);

      // Context is available for the next turn
      const activeCtx = reminderContextManager.getContext(userA);
      expect(activeCtx).not.toBeNull();
      expect(activeCtx?.title).toBe('Dentist appointment');
      expect(activeCtx?.notes).toContain('insurance card');

      // Chat history has both the proactive message and the user question
      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(2);
      expect(chat[0].origin).toBe('proactive');
      expect(chat[1].text).toBe('What appointment?');
    });
  });

  describe('3. Contextual Commands (Pronouns / Indirect References)', () => {
    it('completes the active proactive reminder when user says "mark it done" without ID', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      const tool = new ReminderTool(userA, repo);
      // Model calls completeReminder without explicit ID
      const compResult = await tool.completeReminder();

      expect(compResult.success).toBe(true);
      expect(compResult.data?.id).toBe('rem-dentist-1');
      expect(compResult.data?.reminderState).toBe('completed');

      // Repo has updated state
      const inRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(inRepo?.reminderState).toBe('completed');

      // Active context is updated with completed reminder
      const activeCtx = reminderContextManager.getContext(userA);
      expect(activeCtx?.id).toBe('rem-dentist-1');
    });

    it('reschedules the active proactive reminder when user says "reschedule it" without ID', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      const newTimeMs = nowMs + 86400000;
      const tool = new ReminderTool(userA, repo);
      // Model calls updateReminder with new dueAt but no ID
      const updateResult = await tool.updateReminder({ dueAt: newTimeMs });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.id).toBe('rem-dentist-1');
      expect(updateResult.data?.dueAt).toBe(newTimeMs);

      // Repo has updated due time
      const inRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(inRepo?.dueAt).toBe(newTimeMs);

      // Active context is updated with new due time
      const activeCtx = reminderContextManager.getContext(userA);
      expect(activeCtx?.dueAt).toBe(newTimeMs);
    });

    it('deletes the active proactive reminder and invalidates context when user says "delete that"', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      const tool = new ReminderTool(userA, repo);
      // Model calls deleteReminder without explicit ID
      const delResult = await tool.deleteReminder();

      expect(delResult.success).toBe(true);
      expect(delResult.data?.id).toBe('rem-dentist-1');

      // Repo no longer has the reminder
      const inRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(inRepo).toBeNull();

      // Active context is cleared
      const activeCtx = reminderContextManager.getContext(userA);
      expect(activeCtx).toBeNull();
    });
  });

  describe('4. Explicit Overrides (Different Reminder Targeted)', () => {
    it('deletes the explicitly named reminder and does NOT touch active proactive reminder', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      // Active reminder is Dentist appointment
      expect(reminderContextManager.getContext(userA)?.id).toBe('rem-dentist-1');

      // User explicitly says: "Delete my gym reminder"
      const tool = new ReminderTool(userA, repo);
      const delResult = await tool.deleteReminder('gym');

      expect(delResult.success).toBe(true);
      expect(delResult.data?.id).toBe('rem-gym-2');

      // Gym reminder is deleted from repo
      expect(await repo.getReminder(userA, 'rem-gym-2')).toBeNull();

      // Active dentist reminder remains untouched in repo!
      const dentistInRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(dentistInRepo).not.toBeNull();
      expect(dentistInRepo?.reminderState).toBe('active');

      // Active context for dentist appointment remains intact
      expect(reminderContextManager.getContext(userA)?.id).toBe('rem-dentist-1');
    });

    it('updates explicitly named reminder without modifying active proactive reminder', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      const newGymTime = nowMs + 10000000;
      const tool = new ReminderTool(userA, repo);
      // User says: "Reschedule my gym workout to later"
      const updateResult = await tool.updateReminder({ query: 'gym', dueAt: newGymTime });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.id).toBe('rem-gym-2');
      expect(updateResult.data?.dueAt).toBe(newGymTime);

      // Dentist reminder remains untouched
      const dentistInRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(dentistInRepo?.dueAt).toBe(nowMs);
    });
  });

  describe('5. Benign User Acknowledgements ("Thanks", "Got it")', () => {
    it('does NOT mutate reminder state when user casually acknowledges notification', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      // User says "Thanks!"
      const ackMessage: ChatMessage = {
        id: 'msg-ack-1',
        role: 'user',
        text: 'Thanks, got it!',
        ts: Date.now(),
      };
      alphaStore.appendChat(ackMessage);

      // Verify that no tool calls were executed and reminder state is unmodified
      const reminderInRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(reminderInRepo?.reminderState).toBe('active');
      expect(reminderInRepo?.notificationState).toBe('claimed');

      // Chat history has proactive message and user acknowledgment
      expect(alphaStore.get().chat.length).toBe(2);
    });
  });

  describe('6. Autonomous Loop Prevention', () => {
    it('does not trigger autonomous follow-ups or secondary turns without user action', async () => {
      const result = await trigger.handleReminderDue(validDueEvent, userA);
      expect(result.success).toBe(true);

      // Chat contains strictly 1 message (the proactive announcement)
      const chat = alphaStore.get().chat;
      expect(chat.length).toBe(1);
      expect(chat[0].role).toBe('model');

      // Calling handleReminderDue again for the same event is rejected (idempotent / already handled)
      const secondResult = await trigger.handleReminderDue(validDueEvent, userA);
      expect(secondResult.success).toBe(false);
      expect(secondResult.error?.code).toBe('ALREADY_HANDLED');

      // Chat still has only 1 message
      expect(alphaStore.get().chat.length).toBe(1);
    });
  });

  describe('7. Multi-User Isolation', () => {
    it('prevents User B from accessing User A active reminder context', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      // User B attempts to access context
      const userBContext = reminderContextManager.getContext(userB);
      expect(userBContext).toBeNull();
    });

    it('prevents User B from executing contextual reminder tools against User A reminder', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);

      // User B creates a tool instance
      const toolB = new ReminderTool(userB, repo);

      // User B tries to complete with no ID (attempting to use context)
      const result = await toolB.completeReminder();
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_INPUT');

      // User A's reminder is still intact
      const reminderInRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(reminderInRepo?.reminderState).toBe('active');
    });

    it('clears active context on explicit clear (e.g. logout)', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);
      expect(reminderContextManager.getContext(userA)).not.toBeNull();

      reminderContextManager.clear();
      expect(reminderContextManager.getContext(userA)).toBeNull();
    });
  });

  describe('8. UI Lifecycle Protections', () => {
    it('disallows prepareRetry on proactive messages', async () => {
      const result = await trigger.handleReminderDue(validDueEvent, userA);
      expect(result.success).toBe(true);

      const retryResult = alphaStore.prepareRetry(result.messageId);
      expect(retryResult).toBeNull();

      // Proactive message remains in chat
      expect(alphaStore.get().chat.length).toBe(1);
    });

    it('deleting proactive chat message from UI does NOT alter repo or scheduler state', async () => {
      const result = await trigger.handleReminderDue(validDueEvent, userA);
      expect(result.success).toBe(true);

      // User deletes message from UI chat view
      const deleted = alphaStore.deleteChatMessage(result.messageId);
      expect(deleted).toBe(true);
      expect(alphaStore.get().chat.length).toBe(0);

      // Repository state is NOT deleted or acknowledged
      const reminderInRepo = await repo.getReminder(userA, 'rem-dentist-1');
      expect(reminderInRepo).not.toBeNull();
      expect(reminderInRepo?.reminderState).toBe('active');
      expect(reminderInRepo?.proactiveState).toBe('generated');
    });

    it('clearChat clears both messages and active reminder context', async () => {
      await trigger.handleReminderDue(validDueEvent, userA);
      expect(reminderContextManager.getContext(userA)).not.toBeNull();
      expect(alphaStore.get().chat.length).toBe(1);

      alphaStore.clearChat();
      expect(alphaStore.get().chat.length).toBe(0);
      expect(reminderContextManager.getContext(userA)).toBeNull();
    });
  });
});
