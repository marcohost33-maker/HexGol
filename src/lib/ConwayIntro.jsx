// GolHex Bildungs-Intro — "Conway-First-Open-Intro" (additiv, 2026-06-10).
//
// Ein einmaliges Bildungs-Overlay, das NACH dem Branding-Splash (Splash.jsx,
// unveraendert) beim ERSTEN Besuch erscheint. Es erklaert knapp:
//   - wer John Horton Conway war,
//   - was Game of Life ist,
//   - was GolHex daraus macht.
// Danach merkt sich ein localStorage-Flag, dass das Intro gesehen wurde; es
// erscheint dann nicht mehr automatisch. Ueber einen dezenten "ⓘ"-Button in
// der Top-Leiste laesst es sich jederzeit wieder oeffnen.
//
// Abgrenzung zu Splash.jsx: Der Splash ist das kurze Branding-Logo (~1.5 s,
// auto-dismiss). Dieses Intro ist INHALTLICH (Wissen) und bleibt offen, bis der
// Nutzer es aktiv schliesst ("Los geht's" / Esc / Tap auf den Hintergrund).
//
// Faktenquelle (verifiziert 2026-06-10):
//   John Horton Conway, * 26.12.1937 Liverpool (England), † 11.04.2020;
//   erfand 1970 das Game of Life, popularisiert in Martin Gardners
//   "Mathematical Games"-Kolumne (Scientific American, Okt. 1970). Spaeter
//   von-Neumann-Professur in Princeton. (en.wikipedia.org/wiki/John_Horton_Conway)
//
// A11y: role=dialog, aria-modal, aria-label, Esc/Tap-auf-Backdrop schliesst,
// Fokus liegt initial auf "Los geht's", prefers-reduced-motion deaktiviert die
// Einblend-Animation (analog Splash.jsx).

import { useEffect, useRef, useState } from "react";
// #163/#168: der Schriftstapel kommt aus der EINEN Quelle. Ein eigenes Literal
// hier hiesse: auf Rechnern mit der benannten Schrift sieht das Overlay anders
// aus als auf allen anderen -- und die App liefert diese Schrift nicht aus.
import { FONT_SANS } from "./typography.js";

// localStorage-Flag: einmal gesehen -> nicht mehr automatisch zeigen. Versioniert
// (v1), damit ein spaeteres, inhaltlich neues Intro erneut einmalig erscheinen kann.
export const INTRO_SEEN_KEY = "golhex_intro_seen_v1";

/** Wurde das Intro schon gesehen? Fail-open: bei localStorage-Fehler "nein". */
export function introSeen() {
  try {
    return (
      typeof window !== "undefined" &&
      !!window.localStorage &&
      window.localStorage.getItem(INTRO_SEEN_KEY) === "1"
    );
  } catch {
    return false;
  }
}

/** Flag setzen (best effort; Fehler werden geschluckt, z.B. Private-Mode/Quota). */
export function markIntroSeen() {
  try {
    window.localStorage?.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* localStorage nicht verfuegbar -> Intro erscheint ggf. erneut, kein Crash. */
  }
}

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

const GREEN = "#34d399"; // HEX-Akzent (Brand, identisch Splash)

/**
 * Bildungs-Intro-Overlay.
 *
 * @param {object}   props
 * @param {function} props.onDismiss  wird genau einmal aufgerufen, wenn das Intro
 *                                    geschlossen werden soll (setzt KEIN Flag selbst
 *                                    NICHT — siehe persist).
 * @param {boolean}  [props.persist=true] bei true wird beim Schliessen das
 *                                    localStorage-Flag gesetzt (First-Open-Pfad).
 *                                    Re-Open ueber den ⓘ-Button kann false setzen,
 *                                    aendert aber faktisch nichts (Flag bereits 1).
 */
export default function ConwayIntro({ onDismiss, persist = true }) {
  const [leaving, setLeaving] = useState(false);
  const reduced = prefersReducedMotion();
  const fadeMs = reduced ? 0 : 260;
  const dismissedRef = useRef(false);
  const timerRef = useRef(null);
  const startBtnRef = useRef(null);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (persist) markIntroSeen();
    setLeaving(true);
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, fadeMs);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    // Fokus auf den primaeren Button (Tastatur/Screenreader landen im Dialog).
    startBtnRef.current?.focus?.();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Klick auf den Backdrop schliesst; Klick auf die Karte selbst nicht (stopP).
  const onBackdrop = () => dismiss();

  const sectionTitle = {
    fontSize: 13,
    fontWeight: 700,
    color: GREEN,
    margin: "0 0 3px",
    letterSpacing: "0.02em",
  };
  const sectionBody = {
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "#d4dae3",
    margin: 0,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Was ist GolHex? Einfuehrung"
      data-testid="conway-intro"
      onClick={onBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998, // unter dem Splash (9999), darueber kommt nichts anderes
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
        boxSizing: "border-box",
        background: "rgba(8, 11, 16, 0.74)",
        backdropFilter: reduced ? "none" : "blur(2px)",
        WebkitBackdropFilter: reduced ? "none" : "blur(2px)",
        fontFamily: FONT_SANS,
        opacity: leaving ? 0 : 1,
        transition: reduced ? "none" : `opacity ${fadeMs}ms ease`,
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)",
          maxHeight: "100%",
          overflowY: "auto",
          boxSizing: "border-box",
          background: "linear-gradient(180deg, #1a212c 0%, #11151b 100%)",
          border: "1px solid rgba(52,211,153,0.28)",
          borderRadius: 16,
          padding: "22px 22px 20px",
          color: "#ffffff",
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Kopf */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>Willkommen bei</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: GREEN }}>GolHex</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <section>
            <h2 style={sectionTitle}>John Horton Conway</h2>
            <p style={sectionBody}>
              Britischer Mathematiker (1937&ndash;2020). Er erfand 1970 das{" "}
              <strong style={{ color: "#fff" }}>Game of Life</strong> &mdash; ein
              kurzes Spiel mit ein paar Regeln, das ihn weltbekannt machte.
            </p>
          </section>

          <section>
            <h2 style={sectionTitle}>Game of Life</h2>
            <p style={sectionBody}>
              Ein <em>zellulaerer Automat</em>: ein Gitter aus Zellen, die leben
              oder tot sind. Einfache Geburts- und Ueberlebens-Regeln (abhaengig
              von der Zahl lebender Nachbarn) erzeugen Schritt fuer Schritt
              ueberraschend komplexes, <strong style={{ color: "#fff" }}>emergentes</strong>{" "}
              Verhalten &mdash; wandernde &bdquo;Gleiter&ldquo;, blinkende
              Oszillatoren und mehr.
            </p>
          </section>

          <section>
            <h2 style={sectionTitle}>Was GolHex daraus macht</h2>
            <p style={sectionBody}>
              GolHex bringt Game of Life auf ein{" "}
              <strong style={{ color: "#fff" }}>hexagonales</strong> Gitter
              (Carter-Bays-Topologie) und erweitert es um{" "}
              <strong style={{ color: "#fff" }}>reellwertige Physik-Modi</strong>{" "}
              (Schnee, Wasser, unitaere HQST-Quantenwelle) und{" "}
              <strong style={{ color: "#fff" }}>16 Regelsaetze</strong>. So ist es
              zugleich Spielwiese und Forschungswerkzeug.
            </p>
          </section>
        </div>

        {/* Aktion */}
        <button
          ref={startBtnRef}
          onClick={dismiss}
          data-testid="conway-intro-start"
          aria-label="Intro schliessen und loslegen"
          style={{
            marginTop: 20,
            width: "100%",
            minHeight: 46,
            border: "none",
            borderRadius: 11,
            background: GREEN,
            color: "#04110d",
            fontSize: 15,
            fontWeight: 800,
            fontFamily: FONT_SANS,
            cursor: "pointer",
            letterSpacing: "0.01em",
          }}
        >
          Los geht&rsquo;s
        </button>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: 11,
            color: "#7c8a99",
            textAlign: "center",
          }}
        >
          Du kannst diese Einf&uuml;hrung jederzeit &uuml;ber{" "}
          <span aria-hidden="true">&#9432;</span> oben wieder &ouml;ffnen.
        </p>
      </div>
    </div>
  );
}
