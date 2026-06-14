import { createFileRoute, Link } from "@tanstack/react-router";
import { SimpleCrud } from "../components/SimpleCrud";
import { alphaStore, uid, useAlpha, type Note } from "../lib/alpha-store";
import { Home } from "lucide-react";

export const Route = createFileRoute("/notes")({
  head: () => ({ meta: [{ title: "Alpha — Notes" }, { name: "description", content: "Quick plaintext notes." }] }),
  component: NotesRoute,
});

function NotesRoute() {
  const notes = useAlpha(s => s.notes);
  return (
    <div className="starfield min-h-screen">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" className="p-1.5 rounded-full glass"><Home className="w-4 h-4 text-primary" /></Link>
        <span className="font-semibold neon-text">Notes</span>
      </header>
      <SimpleCrud<Note>
        title="Your Notes"
        items={notes}
        fields={[
          { key: "title", label: "Title", type: "text" },
          { key: "body", label: "Body", type: "textarea" },
        ]}
        makeNew={() => ({ id: uid(), title: "", body: "", updatedAt: Date.now() })}
        onSave={n => alphaStore.upsertNote({ ...n, updatedAt: Date.now() })}
        onDelete={id => alphaStore.deleteNote(id)}
      />
    </div>
  );
}