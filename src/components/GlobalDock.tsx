import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, MessageSquare, Sparkles } from "lucide-react";
import { MiniOrb } from "./MiniOrb";

/**
 * Persistent floating dock so the user can talk to Alpha or navigate from any
 * page. Hidden on the main Orb page (/) and on /chat (the chat already shows
 * its own mini-orb in the sticky header).
 */
export function GlobalDock() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path === "/" || path === "/chat") return null;
  return (
    <div className="fixed top-3 right-3 z-40 flex items-center gap-2 glass neon-border rounded-full px-2 py-1.5 shadow-xl">
      <Link to="/" aria-label="Home" className="p-2 rounded-full hover:bg-primary/10">
        <Sparkles className="w-4 h-4 text-primary" />
      </Link>
      <Link to="/chat" aria-label="Open chat" className="p-2 rounded-full hover:bg-primary/10">
        <MessageSquare className="w-4 h-4 text-primary" />
      </Link>
      <MiniOrb size={36} />
    </div>
  );
}

/** Reusable back arrow shown in every secondary page header. */
export function BackArrow({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} aria-label="Back" className="p-1.5 rounded-full glass neon-border">
      <ArrowLeft className="w-4 h-4 text-primary" />
    </Link>
  );
}
