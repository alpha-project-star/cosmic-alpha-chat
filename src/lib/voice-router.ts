import type { useRouter } from "@tanstack/react-router";

type Router = ReturnType<typeof useRouter>;

export type RouterIntent =
  | { kind: "navigate"; to: "/chat" | "/notes" | "/bills" | "/image" | "/settings" | "/" }
  | { kind: "stop" }
  | { kind: "chat"; text: string };

export function parseIntent(transcript: string): RouterIntent {
  const t = transcript.toLowerCase().trim();
  if (/(stop listening|pause listening|mute mic|go silent)/.test(t)) return { kind: "stop" };
  if (/\bopen (chat|console)\b/.test(t)) return { kind: "navigate", to: "/chat" };
  if (/\bopen notes?\b/.test(t)) return { kind: "navigate", to: "/notes" };
  if (/\bopen (bills?|ledger|finance)\b/.test(t)) return { kind: "navigate", to: "/bills" };
  if (/\bopen (image|camera|vision|gallery)\b/.test(t)) return { kind: "navigate", to: "/image" };
  if (/\bopen settings?\b/.test(t)) return { kind: "navigate", to: "/settings" };
  if (/\b(go )?home\b|\borb\b/.test(t)) return { kind: "navigate", to: "/" };
  return { kind: "chat", text: transcript };
}

export function execIntent(router: Router, intent: RouterIntent, onChat: (text: string) => void, onStop: () => void) {
  if (intent.kind === "navigate") router.navigate({ to: intent.to });
  else if (intent.kind === "stop") onStop();
  else onChat(intent.text);
}