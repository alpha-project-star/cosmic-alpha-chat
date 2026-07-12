import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { KittScanner } from "../components/KittScanner";
import { SimpleCrud } from "../components/SimpleCrud";
import { alphaStore, uid, useAlpha, type Memory } from "../lib/alpha-store";

export const Route = createFileRoute("/memories")({
  head: () => ({ meta: [{ title: "Alpha — Memories" }, { name: "description", content: "Things Alpha remembers about you." }] }),
  component: MemoriesRoute,
});

function MemoriesRoute() {
  const memories = useAlpha(s => s.memories);
  return (
    <div className="starfield min-h-screen">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" className="p-1.5 rounded-full glass"><ArrowLeft className="w-4 h-4 text-primary" /></Link>
        <span className="text-xs tracking-[0.4em] text-muted-foreground">MEMORIES</span>
      </header>
      <div className="px-3 pt-2"><KittScanner bars={22} height={8} /></div>
      <SimpleCrud<Memory>
        title="Long-term memory"
        items={memories}
        fields={[
          { key: "topic", label: "Topic", type: "text" },
          { key: "detail", label: "Detail", type: "textarea" },
        ]}
        makeNew={() => ({ id: uid(), topic: "", detail: "", updatedAt: Date.now() })}
        onSave={m => alphaStore.upsertMemory({ ...m, updatedAt: Date.now() })}
        onDelete={id => alphaStore.deleteMemory(id)}
      />
    </div>
  );
}