// Unit test: GolHex branding Splash (v33 branding welle).
// Oracle = behaviour the user actually sees:
//   1. the REAL version string passed in is rendered (no hard-coded number),
//   2. tap/click dismisses (onDismiss fires),
//   3. Escape key dismisses,
//   4. auto-dismiss fires after the hold without any interaction,
//   5. a11y role/label present.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import Splash from "../../src/lib/Splash.jsx";

afterEach(() => cleanup());

describe("GolHex Splash", () => {
  it("renders the real version it was given (not hard-coded)", () => {
    render(<Splash version="33.0.3" onDismiss={() => {}} />);
    expect(screen.getByTestId("splash-version").textContent).toContain("V33.0.3");
    // A different version must show through unchanged -> proves no hard-code.
    cleanup();
    render(<Splash version="99.1.2" onDismiss={() => {}} />);
    expect(screen.getByTestId("splash-version").textContent).toContain("V99.1.2");
  });

  it("exposes an accessible dialog role + label", () => {
    render(<Splash version="33.0.3" onDismiss={() => {}} />);
    const el = screen.getByTestId("splash");
    expect(el.getAttribute("role")).toBe("dialog");
    expect(el.getAttribute("aria-label")).toBe("GolHex Intro");
  });

  it("dismisses on click/tap (onDismiss fires once)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Splash version="33.0.3" holdMs={1500} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("splash"));
    // fade timeout (320ms) then onDismiss
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // a second click after dismiss must NOT fire onDismiss again (guarded)
    fireEvent.click(screen.getByTestId("splash"));
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("dismisses on Escape", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Splash version="33.0.3" onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("auto-dismisses after the hold with no interaction", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Splash version="33.0.3" holdMs={1500} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1499));
    expect(onDismiss).not.toHaveBeenCalled(); // not before the hold
    act(() => vi.advanceTimersByTime(1 + 400)); // hold + fade
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
