// GolHex branding intro-splash (additive, v33 branding welle, 2026-06-09).
// Mounts once on first render, then auto-dismisses after ~1.5 s OR on tap/Esc.
// Non-blocking: the app mounts and runs underneath; the splash is just an
// overlay that fades out. Mirrors the dePlani intro pattern (radial dark bg +
// wordmark) and the Marco-approved mockup (2026-06-09_Logos-Intro_Mockup.png).
//
// Version is passed in as a prop (read from the real source via __APP_VERSION__
// in App.tsx); the component never hard-codes it. The Splash is self-contained
// (own palette per the mockup spec) so it does not depend on the app theme.

import { useEffect, useRef, useState } from "react";

const GREEN = "#34d399"; // HEX wordmark accent (brand)

// v33 branding revision (Marco, 2026-06-10, iPhone feedback): the glider is now
// rendered as classic black/white Game-of-Life squares (live = white tile, dead
// = dark "black" tile) instead of green, plus a "J C" homage to John Horton
// Conway (inventor of the Game of Life) under the wordmark.
const LIVE = "#f7f9fc";                       // live cell — white square
const DEAD = "#161b23";                       // dead cell — dark ("black") square
const DEAD_BORDER = "rgba(255,255,255,0.07)"; // faint edge so dead cells read as tiles

// Classic Conway glider on a 3x3 raster. Live cells per spec:
// (row,col) = (0,1), (1,2), (2,0), (2,1), (2,2). One white square per live cell;
// the remaining cells are dark tiles (black/white GoL look).
const GLIDER = [
  [0, 1],
  [1, 2],
  [2, 0],
  [2, 1],
  [2, 2],
];

function prefersReducedMotion() {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/**
 * @param {object}   props
 * @param {string}   props.version   real app version (e.g. "33.0.3")
 * @param {number}   [props.holdMs]  visible hold before auto-dismiss (default 1500)
 * @param {function} [props.onDismiss] called once when the splash should unmount
 */
export default function Splash({ version, holdMs = 1500, onDismiss }) {
  const [leaving, setLeaving] = useState(false);
  const reduced = prefersReducedMotion();
  // Reduced-motion: no fade, shorter hold so it never feels like a freeze.
  const fadeMs = reduced ? 0 : 320;
  const hold = reduced ? Math.min(holdMs, 900) : holdMs;
  const dismissedRef = useRef(false);
  const timersRef = useRef([]);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setLeaving(true);
    const t = setTimeout(() => {
      onDismiss?.();
    }, fadeMs);
    timersRef.current.push(t);
  };

  useEffect(() => {
    const auto = setTimeout(dismiss, hold);
    timersRef.current.push(auto);
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      for (const t of timersRef.current) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cell = 22; // px per glider cell
  const gap = 4;
  const gridPx = cell * 3 + gap * 2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="GolHex Intro"
      data-testid="splash"
      onClick={dismiss}
      onTouchStart={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        background: "radial-gradient(120% 100% at 50% 35%, #1b2230 0%, #0f1216 70%)",
        color: "#ffffff",
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        opacity: leaving ? 0 : 1,
        transition: reduced ? "none" : `opacity ${fadeMs}ms ease`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      {/* Conway glider */}
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(3, ${cell}px)`,
          gridTemplateRows: `repeat(3, ${cell}px)`,
          gap: `${gap}px`,
          width: gridPx,
          height: gridPx,
        }}
      >
        {Array.from({ length: 9 }, (_, i) => {
          const r = Math.floor(i / 3);
          const c = i % 3;
          const live = GLIDER.some(([gr, gc]) => gr === r && gc === c);
          return (
            <div
              key={i}
              style={{
                width: cell,
                height: cell,
                borderRadius: 4,
                background: live ? LIVE : DEAD,
                border: live ? "none" : `1px solid ${DEAD_BORDER}`,
                boxShadow: live ? "0 0 9px rgba(255,255,255,0.28)" : "none",
              }}
            />
          );
        })}
      </div>

      {/* Wordmark */}
      <div style={{ textAlign: "center", lineHeight: 1.05 }}>
        <div
          style={{
            fontSize: "clamp(44px, 12vw, 84px)",
            fontWeight: 800,
            letterSpacing: "0.02em",
            color: "#ffffff",
          }}
        >
          GOL
        </div>
        <div
          style={{
            fontSize: "clamp(20px, 5.5vw, 34px)",
            fontWeight: 700,
            letterSpacing: "0.42em",
            // letter-spacing pushes the box right; pad-left re-centres it.
            paddingLeft: "0.42em",
            color: GREEN,
          }}
        >
          HEX
        </div>
      </div>

      {/* John Conway homage — initials under the wordmark */}
      <div
        aria-label="John Conway"
        title="John Horton Conway — Erfinder von Game of Life"
        style={{
          fontSize: "clamp(13px, 3.4vw, 18px)",
          fontWeight: 700,
          letterSpacing: "0.5em",
          paddingLeft: "0.5em",
          color: "#cbd5e1",
          marginTop: "-4px",
        }}
      >
        · J C ·
      </div>

      {/* Tagline + real version */}
      <div
        data-testid="splash-version"
        style={{
          fontSize: "clamp(10px, 2.6vw, 13px)",
          letterSpacing: "0.34em",
          paddingLeft: "0.34em",
          color: "#7c8a99",
          textTransform: "uppercase",
        }}
      >
        COWORKER RESEARCH · V{version}
      </div>
    </div>
  );
}
