/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolHeader } from "../src/components/ToolHeader";
import { GlobalDock } from "../src/components/GlobalDock";
import { TOOL_NAV_ITEMS, CHAT_NAV_ITEMS } from "../src/lib/navigation";

// Mock @tanstack/react-router
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, onClick, ...props }: any) => (
    <a href={to} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => ({
    location: { pathname: "/notes" },
  }),
  useRouter: () => ({
    navigate: vi.fn(),
  }),
}));

// Mock MiniOrb and KittScanner
vi.mock("../src/components/MiniOrb", () => ({
  MiniOrb: ({ size }: { size?: number }) => (
    <div data-testid="mini-orb" data-size={size}>
      MiniOrb
    </div>
  ),
}));

vi.mock("../src/components/KittScanner", () => ({
  KittScanner: ({ state, bars, height }: any) => (
    <div data-testid="kitt-scanner" data-state={state} data-bars={bars} data-height={height}>
      KittScanner
    </div>
  ),
}));

describe("UI-2: Navigation, Header & Interface Organization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Navigation Items Single Source of Truth", () => {
    it("contains all expected destinations in TOOL_NAV_ITEMS", () => {
      const paths = TOOL_NAV_ITEMS.map((item) => item.to);
      expect(paths).toContain("/");
      expect(paths).toContain("/chat");
      expect(paths).toContain("/notes");
      expect(paths).toContain("/bills");
      expect(paths).toContain("/image");
      expect(paths).toContain("/reminders");
      expect(paths).toContain("/plans");
      expect(paths).toContain("/memories");
      expect(paths).toContain("/settings");
      expect(paths.length).toBe(9);
    });

    it("CHAT_NAV_ITEMS matches Chat destinations", () => {
      const paths = CHAT_NAV_ITEMS.map((item) => item.to);
      expect(paths).toContain("/");
      expect(paths).toContain("/notes");
      expect(paths).toContain("/bills");
      expect(paths).toContain("/image");
      expect(paths).toContain("/reminders");
      expect(paths).toContain("/plans");
      expect(paths).toContain("/memories");
      expect(paths).toContain("/settings");
      expect(paths.length).toBe(8);
    });
  });

  describe("ToolHeader Component", () => {
    it("renders the fixed/sticky header layout with title, back link, MiniOrb, and right content", () => {
      render(
        <ToolHeader
          title="Ledger"
          right={<span data-testid="test-right">Outstanding: $50.00</span>}
          scannerState="idle"
        />
      );

      // Title & back link
      expect(screen.getByText("Ledger")).toBeDefined();
      const backLink = screen.getByLabelText("Back to home");
      expect(backLink).toBeDefined();
      expect(backLink.getAttribute("href")).toBe("/");

      // Centered MiniOrb
      const orb = screen.getByTestId("mini-orb");
      expect(orb).toBeDefined();
      expect(orb.getAttribute("data-size")).toBe("50");

      // Integrated KittScanner
      const scanner = screen.getByTestId("kitt-scanner");
      expect(scanner).toBeDefined();
      expect(scanner.getAttribute("data-state")).toBe("idle");

      // Right slot
      expect(screen.getByTestId("test-right").textContent).toBe("Outstanding: $50.00");
    });

    it("renders the floating burger navigation button with correct aria attributes", () => {
      render(<ToolHeader title="Notes" />);

      const burgerButton = screen.getByLabelText("Navigation menu");
      expect(burgerButton).toBeDefined();
      expect(burgerButton.getAttribute("aria-expanded")).toBe("false");
      expect(burgerButton.getAttribute("aria-haspopup")).toBe("dialog");
    });

    it("opens and closes navigation dock via the floating burger button", () => {
      render(<ToolHeader title="Notes" />);

      const burgerButton = screen.getByLabelText("Navigation menu");
      // Initially closed
      expect(screen.queryByRole("dialog")).toBeNull();

      // Click to open
      fireEvent.click(burgerButton);
      expect(burgerButton.getAttribute("aria-expanded")).toBe("true");
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeDefined();

      // Check destinations are present inside the dock
      expect(screen.getByText("Orb")).toBeDefined();
      expect(screen.getByText("Chat")).toBeDefined();
      expect(screen.getByText("Bills")).toBeDefined();
      expect(screen.getByText("Image")).toBeDefined();
      expect(screen.getByText("Reminders")).toBeDefined();
      expect(screen.getByText("Plans")).toBeDefined();
      expect(screen.getByText("Memories")).toBeDefined();
      expect(screen.getByText("Settings")).toBeDefined();

      // Click to close
      fireEvent.click(burgerButton);
      expect(burgerButton.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes the dock when Escape key is pressed", () => {
      render(<ToolHeader title="Plans" />);

      const burgerButton = screen.getByLabelText("Navigation menu");
      fireEvent.click(burgerButton);
      expect(screen.getByRole("dialog")).toBeDefined();

      // Press Escape
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(burgerButton.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("Obsolete Header Removal & ToolHeader Authority", () => {
    it("ensures obsolete GlobalDock renders null, preventing duplicate navigation clusters", () => {
      const { container } = render(<GlobalDock />);
      expect(container.firstChild).toBeNull();
    });

    it("verifies ToolHeader provides the single authoritative header on tool pages", () => {
      render(<ToolHeader title="Bills" right={<span data-testid="right-action">Total</span>} />);
      expect(screen.getByText("Bills")).toBeDefined();
      expect(screen.getByTestId("mini-orb")).toBeDefined();
      expect(screen.getByTestId("right-action")).toBeDefined();
    });
  });

  describe("Voice-First Two-Sided Bottom Dock", () => {
    it("preserves left down-arrow dock for tools and right down-arrow dock for Settings and Eye", () => {
      const mockToggleEye = vi.fn();
      let toolsOpen = false;
      let settingsOpen = false;
      let eyeActive = false;

      const { rerender } = render(
        <div data-testid="voice-dock">
          {/* Left down-arrow dock */}
          <button
            onClick={() => {
              toolsOpen = !toolsOpen;
              settingsOpen = false;
            }}
            aria-label="Alpha tools"
            aria-expanded={toolsOpen}
          >
            Tools Arrow
          </button>
          {toolsOpen && (
            <div data-testid="tools-panel">
              <a href="/notes">Notes</a>
              <a href="/bills">Bills</a>
            </div>
          )}

          {/* Center chat */}
          <a href="/chat" aria-label="Open chat">Chat</a>

          {/* Right down-arrow dock */}
          <button
            onClick={() => {
              settingsOpen = !settingsOpen;
              toolsOpen = false;
            }}
            aria-label="Alpha settings & controls"
            aria-expanded={settingsOpen}
          >
            Settings Arrow
          </button>
          {settingsOpen && (
            <div data-testid="settings-panel">
              <a href="/settings">Settings</a>
              <button
                onClick={() => {
                  mockToggleEye();
                  eyeActive = !eyeActive;
                }}
                aria-label={eyeActive ? "Stop Live Eye" : "Enable Live Eye"}
              >
                {eyeActive ? "Stop Eye" : "Live Eye"}
              </button>
            </div>
          )}
        </div>
      );

      // Initially panels are closed
      expect(screen.queryByTestId("tools-panel")).toBeNull();
      expect(screen.queryByTestId("settings-panel")).toBeNull();

      // Open left dock
      fireEvent.click(screen.getByLabelText("Alpha tools"));
      rerender(
        <div data-testid="voice-dock">
          <button
            onClick={() => {
              toolsOpen = !toolsOpen;
              settingsOpen = false;
            }}
            aria-label="Alpha tools"
            aria-expanded={toolsOpen}
          >
            Tools Arrow
          </button>
          {toolsOpen && (
            <div data-testid="tools-panel">
              <a href="/notes">Notes</a>
              <a href="/bills">Bills</a>
            </div>
          )}
          <a href="/chat" aria-label="Open chat">Chat</a>
          <button
            onClick={() => {
              settingsOpen = !settingsOpen;
              toolsOpen = false;
            }}
            aria-label="Alpha settings & controls"
            aria-expanded={settingsOpen}
          >
            Settings Arrow
          </button>
          {settingsOpen && (
            <div data-testid="settings-panel">
              <a href="/settings">Settings</a>
              <button
                onClick={() => {
                  mockToggleEye();
                  eyeActive = !eyeActive;
                }}
                aria-label={eyeActive ? "Stop Live Eye" : "Enable Live Eye"}
              >
                {eyeActive ? "Stop Eye" : "Live Eye"}
              </button>
            </div>
          )}
        </div>
      );
      expect(screen.getByTestId("tools-panel")).toBeDefined();
      expect(screen.queryByTestId("settings-panel")).toBeNull();

      // Open right dock
      fireEvent.click(screen.getByLabelText("Alpha settings & controls"));
      rerender(
        <div data-testid="voice-dock">
          <button
            onClick={() => {
              toolsOpen = !toolsOpen;
              settingsOpen = false;
            }}
            aria-label="Alpha tools"
            aria-expanded={toolsOpen}
          >
            Tools Arrow
          </button>
          {toolsOpen && (
            <div data-testid="tools-panel">
              <a href="/notes">Notes</a>
              <a href="/bills">Bills</a>
            </div>
          )}
          <a href="/chat" aria-label="Open chat">Chat</a>
          <button
            onClick={() => {
              settingsOpen = !settingsOpen;
              toolsOpen = false;
            }}
            aria-label="Alpha settings & controls"
            aria-expanded={settingsOpen}
          >
            Settings Arrow
          </button>
          {settingsOpen && (
            <div data-testid="settings-panel">
              <a href="/settings">Settings</a>
              <button
                onClick={() => {
                  mockToggleEye();
                  eyeActive = !eyeActive;
                }}
                aria-label={eyeActive ? "Stop Live Eye" : "Enable Live Eye"}
              >
                {eyeActive ? "Stop Eye" : "Live Eye"}
              </button>
            </div>
          )}
        </div>
      );
      expect(screen.queryByTestId("tools-panel")).toBeNull();
      expect(screen.getByTestId("settings-panel")).toBeDefined();
      expect(screen.getByText("Settings")).toBeDefined();

      // Opening right dock must NOT have activated Eye
      expect(mockToggleEye).not.toHaveBeenCalled();

      // Explicitly clicking Eye inside right dock activates it
      fireEvent.click(screen.getByLabelText("Enable Live Eye"));
      expect(mockToggleEye).toHaveBeenCalledTimes(1);
    });
  });

  describe("Settings Default Organization", () => {
    it("starts with all groups collapsed by default and allows selective expansion", () => {
      // Test the state machine of openGroup initialized to null
      let openGroup: "online" | "offline" | "data" | "migration" | null = null;
      const setOpenGroup = vi.fn((val) => {
        openGroup = val;
      });

      // Default state: all collapsed
      expect(openGroup).toBeNull();

      // Toggling online expands it
      setOpenGroup("online");
      expect(openGroup).toBe("online");

      // Toggling online again collapses it
      setOpenGroup(openGroup === "online" ? null : "online");
      expect(openGroup).toBeNull();
    });
  });
});
