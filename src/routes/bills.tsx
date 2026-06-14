import { createFileRoute, Link } from "@tanstack/react-router";
import { SimpleCrud } from "../components/SimpleCrud";
import { alphaStore, uid, useAlpha, type Bill } from "../lib/alpha-store";
import { Home } from "lucide-react";

export const Route = createFileRoute("/bills")({
  head: () => ({ meta: [{ title: "Alpha — Bills" }, { name: "description", content: "Track bills & balances." }] }),
  component: BillsRoute,
});

function BillsRoute() {
  const bills = useAlpha(s => s.bills);
  const total = bills.reduce((s, b) => s + (b.balance || 0), 0);
  return (
    <div className="starfield min-h-screen">
      <header className="p-3 flex items-center justify-between glass border-b border-primary/20">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-1.5 rounded-full glass"><Home className="w-4 h-4 text-primary" /></Link>
          <span className="font-semibold neon-text">Ledger</span>
        </div>
        <span className="text-sm text-muted-foreground">Outstanding: <span className="text-primary font-semibold">${total.toFixed(2)}</span></span>
      </header>
      <SimpleCrud<Bill>
        title="Bills & Ledger"
        items={bills}
        fields={[
          { key: "name", label: "Name", type: "text" },
          { key: "amount", label: "Amount", type: "number", prefix: "$" },
          { key: "balance", label: "Balance", type: "number", prefix: "$" },
          { key: "dueDate", label: "Due Date", type: "date" },
          { key: "status", label: "Status", type: "select", options: ["due", "paid", "overdue"] },
        ]}
        makeNew={() => ({ id: uid(), name: "", amount: 0, balance: 0, dueDate: new Date().toISOString().slice(0, 10), status: "due" })}
        onSave={b => alphaStore.upsertBill(b)}
        onDelete={id => alphaStore.deleteBill(id)}
      />
    </div>
  );
}