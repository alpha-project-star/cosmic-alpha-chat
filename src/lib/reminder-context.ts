import { FirestoreReminder } from './reminder-repo';
import { formatReminderDate } from './reminder-date-utils';

export interface ActiveReminderContext {
  id: string;
  title: string;
  dueAt: number;
    userId: string;
  notes?: string;
  updatedAt: number;
}

export type ReminderContextInput = 
  | FirestoreReminder 
  | {
      id: string;
      title: string;
      dueAt: number;
            userId?: string;
      notes?: string;
    };

/**
 * Authoritative in-memory conversational reminder context manager.
 * Tracks the current reminder in conversational focus per authenticated user.
 * Enforces strict user isolation: access attempts with a different userId clear context.
 */
class ReminderContextManager {
  private activeContext: ActiveReminderContext | null = null;
  private currentUserId: string | null = null;

  setContext(userId: string, reminder: ReminderContextInput) {
    if (!userId) return;
    this.currentUserId = userId;
    this.activeContext = {
      id: reminder.id,
      title: reminder.title,
      dueAt: reminder.dueAt,
            userId,
      notes: (reminder as any).notes,
      updatedAt: Date.now()
    };
  }

  getContext(userId: string): ActiveReminderContext | null {
    if (!userId || this.currentUserId !== userId) {
      this.clear();
      return null;
    }
    return this.activeContext;
  }

  clear() {
    this.activeContext = null;
    this.currentUserId = null;
  }

  invalidate(userId: string, reminderId: string) {
    if (this.currentUserId === userId && this.activeContext?.id === reminderId) {
      this.clear();
    }
  }
}

export const reminderContextManager = new ReminderContextManager();
