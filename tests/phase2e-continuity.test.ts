import { describe, it, expect, beforeEach } from 'vitest';
import { ReminderTool } from '../src/lib/reminder-tool';
import { ReminderRepository, FirestoreReminder } from '../src/lib/reminder-repo';
import { reminderContextManager } from '../src/lib/reminder-context';
import { temporal } from '../src/lib/temporal';

class MockReminderRepository implements ReminderRepository {
  private store = new Map<string, FirestoreReminder>();

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
    const r = this.store.get(reminderId);
    if (!r || r.userId !== userId) throw new Error('Not found');
    this.store.set(reminderId, { ...r, ...patch, updatedAt: Date.now() });
  }

  async deleteReminder(userId: string, reminderId: string): Promise<void> {
    const r = this.store.get(reminderId);
    if (!r || r.userId !== userId) throw new Error('Not found');
    this.store.delete(reminderId);
  }
}

describe('Phase 2E — Reminder State & Conversational Continuity', () => {
  let repo: MockReminderRepository;
  let tool: ReminderTool;
  const userId = 'user-test-2e';

  beforeEach(() => {
    repo = new MockReminderRepository();
    tool = new ReminderTool(userId, repo);
    reminderContextManager.clear();
    temporal.setMockDate(new Date('2026-09-08T10:00:00Z'));
  });

  it('1. Successful creation establishes active context', async () => {
    const res = await tool.createReminder({
      title: 'Study math',
      dueAt: 'tomorrow at 3 PM'
    });

    expect(res.success).toBe(true);
    const ctx = reminderContextManager.getContext(userId);
    expect(ctx).not.toBeNull();
    expect(ctx?.title).toBe('Study math');
    expect(ctx?.id).toBe(res.data?.id);
  });

  it('2. Follow-up reference updates active context without specifying ID/query', async () => {
    // Turn 1: Create reminder
    const created = await tool.createReminder({
      title: 'Draft report',
      dueAt: 'tomorrow at 2 PM'
    });
    expect(created.success).toBe(true);

    // Turn 2: User says "Actually make that 5 PM" (no ID or query given)
    const updated = await tool.updateReminder({
      dueAt: 'tomorrow at 5 PM'
    });

    expect(updated.success).toBe(true);
    expect(updated.data?.dueAt).toBeGreaterThan(created.data!.dueAt); // 5 PM vs 2 PM
    expect(updated.data?.title).toBe('Draft report');
  });

  it('3. Explicit user reference overrides conversational context', async () => {
    // Create Reminder A (context)
    await tool.createReminder({
      title: 'Review notes',
      dueAt: 'tomorrow at 10 AM'
    });

    // Create Reminder B explicitly
    const reminderB = await tool.createReminder({
      title: 'Buy groceries',
      dueAt: 'tomorrow at 4 PM'
    });

    // User says: "Change my groceries reminder to 6 PM" (explicit query provided)
    const updated = await tool.updateReminder({
      query: 'groceries',
      dueAt: 'tomorrow at 6 PM'
    });

    expect(updated.success).toBe(true);
    expect(updated.data?.title).toBe('Buy groceries');

    // Context should now point to Reminder B (the last created/updated)
    const ctx = reminderContextManager.getContext(userId);
    expect(ctx?.id).toBe(reminderB.data?.id);
  });

  it('4. Successful deletion invalidates active context', async () => {
    const created = await tool.createReminder({
      title: 'Temporary task',
      dueAt: 'tomorrow'
    });
    expect(reminderContextManager.getContext(userId)?.id).toBe(created.data?.id);

    // Delete using contextual reference (no ID provided)
    const deleted = await tool.deleteReminder();
    expect(deleted.success).toBe(true);

    // Context should be cleared
    expect(reminderContextManager.getContext(userId)).toBeNull();
  });

  it('5. Failed operations do not replace valid context', async () => {
    const created = await tool.createReminder({
      title: 'Important task',
      dueAt: 'tomorrow'
    });
    const originalContextId = reminderContextManager.getContext(userId)?.id;

    // Attempt invalid update (missing time/query)
    const failedUpdate = await tool.updateReminder({ dueAt: 'invalid-time-string' });
    expect(failedUpdate.success).toBe(false);

    // Context should remain intact
    expect(reminderContextManager.getContext(userId)?.id).toBe(originalContextId);
  });

  it('6. Context isolation across users', async () => {
    const toolUser1 = new ReminderTool('user-1', repo);
    const toolUser2 = new ReminderTool('user-2', repo);

    await toolUser1.createReminder({ title: 'Task 1', dueAt: 'tomorrow' });
    const ctx1 = reminderContextManager.getContext('user-1');
    const ctx2 = reminderContextManager.getContext('user-2');

    expect(ctx1).not.toBeNull();
    expect(ctx2).toBeNull(); // User 2 has no context
  });
});
