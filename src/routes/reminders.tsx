import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Bell } from "lucide-react";
import { SimpleCrud } from "../components/SimpleCrud";
import { alphaStore, uid, useAlpha, type Reminder } from "../lib/alpha-store";
import { requestAlarmPermission } from "../lib/alarm-engine";
import { useState } from "react";

export const Route = createFileRoute("/reminders")({
  head: () => ({ meta: [{ title: "Alpha — Reminders" }, { name: "description", content: "Alarms and reminders." }] }),
  component: RemindersRoute,
});

function RemindersRoute() {
  const reminders = useAlpha(s => s.reminders);
  const [permMsg, setPermMsg] = useState("");

  async function enableAlarms() {
    const ok = await requestAlarmPermission();
    setPermMsg(ok ? "✅ Alarms enabled." : "⚠️ Notification permission denied — alarms will still speak, but no system pop-ups.");
  }

  return (
    <div className="starfield min-h-screen">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" className="p-1.5 rounded-full glass"><ArrowLeft className="w-4 h-4 text-primary" /></Link>
        <span className="text-xs tracking-[0.4em] text-muted-foreground">REMINDERS</span>
        <button onClick={enableAlarms} className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full glass neon-border">
          <Bell className="w-3 h-3" /> Enable alarms
        </button>
      </header>
      {permMsg && <div className="px-4 pt-3 text-xs text-muted-foreground">{permMsg}</div>}
      <div className="px-4 pt-3 text-[11px] text-muted-foreground">
        Tip: for "When" use an ISO date/time (e.g. <code>2026-07-15T09:00</code>) or say "in 5 minutes" / "tomorrow 8am" to Alpha.
      </div>
      <SimpleCrud<Reminder>
        title="Reminders & Alarms"
        items={reminders}
        fields={[
          { key: "title", label: "Title", type: "text" },
          { key: "when", label: "When (ISO or text)", type: "text" },
          { key: "notes", label: "Notes", type: "textarea" },
          { key: "done", label: "Done", type: "select", options: ["no", "yes"] },
        ]}
        makeNew={() => ({ id: uid(), title: "", when: "", notes: "", done: "no" })}
        onSave={r => alphaStore.upsertReminder({ ...r, firedAt: undefined })}
        onDelete={id => alphaStore.deleteReminder(id)}
      />
    </div>
  );
}