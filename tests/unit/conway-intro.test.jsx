// Unit test: GolHex Bildungs-Intro (ConwayIntro.jsx).
// Oracle = what the user actually experiences:
//   1. content is present (Conway, Game of Life, GolHex terms — fachlich korrekt),
//   2. a11y dialog role + label,
//   3. "Los geht's" dismisses: onDismiss fires once AND the seen-flag is set,
//   4. Escape dismisses,
//   5. backdrop tap dismisses, card tap does NOT,
//   6. introSeen()/markIntroSeen() round-trip the localStorage flag,
//   7. persist=false (re-open path) does NOT touch the flag.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import ConwayIntro, {
  introSeen,
  markIntroSeen,
  INTRO_SEEN_KEY,
} from "../../src/lib/ConwayIntro.jsx";

beforeEach(() => {
  try {
    window.localStorage?.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => cleanup());

describe("ConwayIntro — content", () => {
  it("renders Conway / Game of Life / GolHex education content", () => {
    render(<ConwayIntro onDismiss={() => {}} />);
    const root = screen.getByTestId("conway-intro");
    const text = root.textContent || "";
    // Conway facts (verified: born 1937, died 2020).
    expect(text).toContain("John Horton Conway");
    expect(text).toContain("1937");
    expect(text).toContain("2020");
    expect(text).toContain("Game of Life");
    // GolHex specifics — must stay consistent with README/AGENTS.md.
    expect(text).toContain("GolHex");
    expect(text).toContain("Carter-Bays");
    expect(text).toContain("hexagonal");
    expect(text).toContain("HQST");
    expect(text).toContain("16 Regelsaetze");
  });

  it("exposes an accessible dialog role + label", () => {
    render(<ConwayIntro onDismiss={() => {}} />);
    const el = screen.getByTestId("conway-intro");
    expect(el.getAttribute("role")).toBe("dialog");
    expect(el.getAttribute("aria-modal")).toBe("true");
    expect(el.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("ConwayIntro — dismiss behaviour", () => {
  it("'Los geht's' dismisses once and sets the seen flag", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConwayIntro onDismiss={onDismiss} />);
    expect(introSeen()).toBe(false);
    fireEvent.click(screen.getByTestId("conway-intro-start"));
    act(() => vi.advanceTimersByTime(400)); // fade then onDismiss
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(introSeen()).toBe(true);
    // A second click must not fire onDismiss again (guarded).
    fireEvent.click(screen.getByTestId("conway-intro-start"));
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("Escape dismisses", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConwayIntro onDismiss={onDismiss} />);
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("backdrop tap dismisses, card tap does not", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConwayIntro onDismiss={onDismiss} />);
    // Tap on the card (the start button's parent card) -> NOT dismissed.
    const card = screen.getByTestId("conway-intro-start").parentElement;
    fireEvent.click(card);
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).not.toHaveBeenCalled();
    // Tap on the backdrop (the dialog root) -> dismissed.
    fireEvent.click(screen.getByTestId("conway-intro"));
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("persist=false (re-open) does NOT set the seen flag", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ConwayIntro persist={false} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("conway-intro-start"));
    act(() => vi.advanceTimersByTime(400));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(introSeen()).toBe(false); // flag untouched
    vi.useRealTimers();
  });
});

describe("ConwayIntro — seen flag helpers", () => {
  it("introSeen() reflects the localStorage flag set by markIntroSeen()", () => {
    expect(introSeen()).toBe(false);
    markIntroSeen();
    expect(window.localStorage.getItem(INTRO_SEEN_KEY)).toBe("1");
    expect(introSeen()).toBe(true);
  });

  it("with the flag already set, the helper reports seen (auto-show should be suppressed by the caller)", () => {
    window.localStorage.setItem(INTRO_SEEN_KEY, "1");
    expect(introSeen()).toBe(true);
    // The component itself is presentational; the *caller* (App) gates auto-show
    // on introSeen(). We assert the contract the caller relies on.
  });
});
