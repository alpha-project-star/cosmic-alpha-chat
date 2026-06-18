import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { SimpleCrud } from "../components/SimpleCrud";
import { alphaStore, uid, useAlpha, type Reminder } from "../lib/alpha-store";

export const Route = createFileRoute("/reminders")({
  head: () => ({ meta: [{ title: "Alpha — Reminders" }, { name: "description", content: "Alarms and reminders." }] }),
  component: RemindersRoute,
});

function RemindersRoute() {
  const reminders = useAlpha(s => s.reminders);
  return (
    <div className="starfield min-h-screen">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" className="p-1.5 rounded-full glass"><ArrowLeft className="w-4 h-4 text-primary" /></Link>
        <span className="text-xs tracking-[0.4em] text-muted-foreground">REMINDERS</span>
      </header>
      <SimpleCrud<Reminder>
        title="Reminders & Alarms"
        items={reminders}
        fields={[
          { key: "title", label: "Title", type: "text" },
          { key: "when", label: "When", type: "text" },
          { key: "notes", label: "Notes", type: "textarea" },
          { key: "done", label: "Done", type: "select", options: ["no", "yes"] },
        ]}
        makeNew={() => ({ id: uid(), title: "", when: "", notes: "", done: "no" })}
        onSave={r => alphaStore.upsertReminder(r)}
        onDelete={id => alphaStore.deleteReminder(id)}
      />
    </div>
  );
}