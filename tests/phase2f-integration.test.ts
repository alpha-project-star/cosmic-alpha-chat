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

describe('Phase 2F — Reminder System Final Integration Audit', () => {
  let repo: MockReminderRepository;
  let tool: ReminderTool;
  const userId = 'user-test-2f';

  beforeEach(() => {
    repo = new MockReminderRepository();
    tool = new ReminderTool(userId, repo);
    reminderContextManager.clear();
    temporal.setMockDate(new Date('2026-09-08T10:00:00Z'));
  });

  it('Journey A — Simple creation with natural date parsing', async () => {
    const res = await tool.createReminder({
      title: 'study',
      dueAt: 'tomorrow at 3 PM'
    });
    expect(res.success).toBe(true);
    expect(res.data?.title).toBe('study');
    expect(reminderContextManager.getContext(userId)?.id).toBe(res.data?.id);
  });

  it('Journey B — Clarification flow simulation (missing title or time)', async () => {
    const res = await tool.createReminder({
      dueAt: 'tomorrow at 4 PM'
    } as any);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_INPUT');
  });

  it('Journey C — Follow-up correction ("Actually make that 5")', async () => {
    const created = await tool.createReminder({
      title: 'study',
      dueAt: 'tomorrow at 3 PM'
    });
    expect(created.success).toBe(true);

    const updated = await tool.updateReminder({
      dueAt: 'tomorrow at 5 PM'
    });
    expect(updated.success).toBe(true);
    expect(updated.data?.dueAt).toBeGreaterThan(created.data!.dueAt);
  });

  it('Journey D — Ambiguity handling (multiple matching reminders)', async () => {
    await tool.createReminder({ title: 'Study mathematics', dueAt: 'tomorrow at 3 PM' });
    await tool.createReminder({ title: 'Study physics', dueAt: 'tomorrow at 4 PM' });

    const res = await tool.getReminder('study');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('AMBIGUOUS');
    expect(res.error?.candidates?.length).toBe(2);
  });

  it('Journey E — Contextual action ("Move that to Monday")', async () => {
    const created = await tool.createReminder({
      title: 'Call John',
      dueAt: 'tomorrow'
    });
    expect(created.success).toBe(true);

    const updated = await tool.updateReminder({
      dueAt: 'Monday at 9 AM'
    });
    expect(updated.success).toBe(true);
    expect(updated.data?.title).toBe('Call John');
  });

  it('Journey F — Context invalidation after deletion', async () => {
    const created = await tool.createReminder({
      title: 'Temporary task',
      dueAt: 'tomorrow'
    });
    expect(reminderContextManager.getContext(userId)?.id).toBe(created.data?.id);

    const deleted = await tool.deleteReminder();
    expect(deleted.success).toBe(true);
    expect(reminderContextManager.getContext(userId)).toBeNull();

    const failedUpdate = await tool.updateReminder({ dueAt: 'tomorrow at 5 PM' });
    expect(failedUpdate.success).toBe(false);
  });

  it('Journey G — Explicit override ignores active context', async () => {
    await tool.createReminder({
      title: 'Reminder A',
      dueAt: 'tomorrow'
    });

    const reminderB = await tool.createReminder({
      title: 'Reminder B (Meeting)',
      dueAt: 'tomorrow'
    });

    const updated = await tool.updateReminder({
      query: 'Meeting',
      dueAt: '5 PM'
    });

    expect(updated.success).toBe(true);
    expect(updated.data?.id).toBe(reminderB.data?.id);
  });

  it('Security Audit — Cross-user isolation and ownership validation', async () => {
    const toolUser1 = new ReminderTool('user-1', repo);
    const toolUser2 = new ReminderTool('user-2', repo);

    const r1 = await toolUser1.createReminder({ title: 'User 1 task', dueAt: 'tomorrow' });
    
    const getRes = await toolUser2.getReminder(r1.data!.id);
    expect(getRes.success).toBe(false);
    expect(getRes.error?.code).toBe('NOT_FOUND');
  });
});
