## Why you only see the mobile view

The desktop HUD layout is gated behind Tailwind's `lg` breakpoint (≥1024px wide). Your preview is currently 384px wide, so only the `lg:hidden` mobile layout renders. Nothing is broken — desktop Alpha just isn't being asked to show up.

## How to see Desktop Alpha

Two options, both non-destructive:

1. **Switch the in-app preview to Desktop** (fastest)
   - Use the device switcher above the preview and pick Desktop. I can flip it for you on approval.
   - You'll immediately see: wordmark up top, giant orb on the left, HUD chat panel on the right, tool rail on the left edge, mic dock centered at the bottom.

2. **Open the live URL on a real desktop browser**
   - Preview: `https://id-preview--4320e15a-16b3-433e-8ebe-dfe7c2c03827.lovable.app`
   - Published: `https://cosmic-alpha-chat.lovable.app`
   - Any window ≥1024px wide will render the HUD layout automatically.

## What I'll do on approval

- Call `preview_ui--set_preview_device_viewport` with `desktop` so your preview flips to the HUD immediately.
- No code changes. The mobile experience stays exactly as it is.

## If you also want desktop-on-phone

Currently the phone (384px) intentionally shows the mobile layout because the HUD assumes a wide canvas. If you want the HUD to also render on phones (scaled down, likely cramped), say the word and I'll draft a separate plan to lower the breakpoint or add a "force desktop" toggle — but I'd recommend against it unless you specifically want it.
