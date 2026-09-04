/**
 * Centralised activity-status bus.
 *
 * The APPLICATION sets these — never the model's prose. Chat, voice-first mode,
 * the desktop HUD and the mini orb all read the same value, so what the user
 * sees always corresponds to the operation actually running.
 */

export type ActivityKind =
  | "idle"
  | "listening"
  | "thinking"
  | "preparing"
  | "searching"
  | "reading_image"
  | "processing_attachment"
  | "reading_memory"
  | "reading_note"
  | "reading_reminder"
  | "checking_settings"
  | "writing_note"
  | "writing_reminder"
  | "writing_bill"
  | "writing_memory"
  | "updating_plan"
  | "editing_settings"
  | "writing_code"
  | "calculating"
  | "calling_tool"
  | "executing_action"
  | "waiting_confirmation"
  | "waiting_provider"
  | "switching_model"
  | "retrying"
  | "preparing_voice"
  | "speaking"
  | "stopping_speech"
  | "action_failed"
  | "error";

const LABELS: Record<ActivityKind, string> = {
  idle: "",
  listening: "Listening…",
  thinking: "Thinking…",
  preparing: "Preparing response…",
  searching: "Searching the web…",
  reading_image: "Reading image…",
  processing_attachment: "Processing attachment…",
  reading_memory: "Reading memory…",
  reading_note: "Reading note…",
  reading_reminder: "Checking reminder…",
  checking_settings: "Checking settings…",
  writing_note: "Writing note…",
  writing_reminder: "Writing reminder…",
  writing_bill: "Writing bill…",
  writing_memory: "Writing memory…",
  updating_plan: "Updating plan…",
  editing_settings: "Editing settings…",
  writing_code: "Writing code…",
  calculating: "Running calculation…",
  calling_tool: "Calling tool…",
  executing_action: "Executing action…",
  waiting_confirmation: "Waiting for confirmation…",
  waiting_provider: "Waiting for provider…",
  switching_model: "Switching model…",
  retrying: "Retrying…",
  preparing_voice: "Preparing voice…",
  speaking: "Speaking…",
  stopping_speech: "Stopping speech…",
  action_failed: "Action failed",
  error: "Error",
};

export interface Activity {
  kind: ActivityKind;
  /** Optional override text — still user-facing wording, never API details. */
  detail?: string;
}

let current: Activity = { kind: "idle" };
const listeners = new Set<(a: Activity) => void>();

export const activity = {
  get: (): Activity => current,
  /** Human label for the current (or a given) activity. */
  label(a: Activity = current): string {
    return a.detail || LABELS[a.kind] || "";
  },
  set(kind: ActivityKind, detail?: string) {
    if (current.kind === kind && current.detail === detail) return;
    current = { kind, detail };
    listeners.forEach(l => l(current));
  },
  clear() {
    activity.set("idle");
  },
  sub(l: (a: Activity) => void) {
    listeners.add(l);
    l(current);
    return () => { listeners.delete(l); };
  },
  isBusy(): boolean {
    return current.kind !== "idle" && current.kind !== "listening";
  },
};

/** Map an action tag name to the status shown while it executes. */
export function actionActivity(tag: string): ActivityKind {
  const t = tag.toUpperCase();
  if (t.includes("NOTE")) return t.startsWith("ADD") || t.startsWith("UPDATE") ? "writing_note" : "executing_action";
  if (t.includes("REMINDER")) return "writing_reminder";
  if (t.includes("BILL")) return "writing_bill";
  if (t.includes("MEMORY")) return "writing_memory";
  if (t.includes("PLAN")) return "updating_plan";
  if (t.includes("SETTING") || t.includes("PROFILE")) return "editing_settings";
  return "executing_action";
}
