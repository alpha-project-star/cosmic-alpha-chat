import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { KittScanner } from "../components/KittScanner";
import { SimpleCrud } from "../components/SimpleCrud";
import { alphaStore, uid, useAlpha, type Plan } from "../lib/alpha-store";

export const Route = createFileRoute("/plans")({
  head: () => ({ meta: [{ title: "Alpha — Plans & Routes" }, { name: "description", content: "Plans and routes." }] }),
  component: PlansRoute,
});

function PlansRoute() {
  const plans = useAlpha(s => s.plans);
  return (
    <div className="starfield min-h-screen">
      <header className="p-3 flex items-center gap-3 glass border-b border-primary/20">
        <Link to="/" className="p-1.5 rounded-full glass"><ArrowLeft className="w-4 h-4 text-primary" /></Link>
        <span className="text-xs tracking-[0.4em] text-muted-foreground">PLANS</span>
      </header>
      <div className="px-3 pt-2"><KittScanner bars={22} height={8} /></div>
      <SimpleCrud<Plan>
        title="Plans & Routes"
        items={plans}
        fields={[
          { key: "title", label: "Title", type: "text" },
          { key: "from", label: "From", type: "text" },
          { key: "to", label: "To", type: "text" },
          { key: "date", label: "Date", type: "date" },
          { key: "details", label: "Details", type: "textarea" },
        ]}
        makeNew={() => ({ id: uid(), title: "", from: "", to: "", date: new Date().toISOString().slice(0, 10), details: "" })}
        onSave={p => alphaStore.upsertPlan(p)}
        onDelete={id => alphaStore.deletePlan(id)}
      />
    </div>
  );
}