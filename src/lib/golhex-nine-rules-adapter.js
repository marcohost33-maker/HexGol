// Adapter: GolHex-Simulationszustand -> Trace fuer das 9-Regel-Modell.
//
// Das 9-Regel-Modul (nine-rules.js) ist bewusst domaenenfrei: es kennt Zustaende,
// Uebergaenge und Verlaeufe, aber nichts von Hexgittern. Dieser Adapter stellt die
// Verbindung her -- und er ist der Ort, an dem die MODELLENTSCHEIDUNGEN sichtbar
// gemacht werden muessen, statt sie im UI-Code zu verstecken.
//
// WAS IST DIE ENTITAET? Das ist die erste Frage, die die Spezifikation stellt
// ("Testobjekt muss zuerst gewaehlt werden"), und sie hat hier eine bewusste Antwort:
//
//   Die Entitaet ist die POPULATION des Gitters ueber die Zeit -- nicht eine einzelne
//   Zelle und nicht "das Spiel".
//
// Daraus folgt unmittelbar, welche Regeln etwas sagen koennen und welche nicht:
//
//   u_t = Anzahl lebender/aktiver Zellen   -> traegt R1, R8
//   a_t = dieselbe Zahl als Entwicklungsgroesse -> traegt R2
//   Historie = der Populationsverlauf      -> traegt R3, R7
//   Vergleichsraum = Population und Aktivitaet -> traegt R4
//
// UND -- das ist der ehrliche Teil -- eine Population hat KEINEN ORT und KEINE
// ORIENTIERUNG. R5 (Richtung) und R6 (Bewegung) sind fuer diese Entitaet deshalb
// N/A, nicht FAIL. Man koennte einen Schwerpunkt ausrechnen und so tun, als bewege
// sich etwas; das waere eine erfundene Groesse, um ein Feld gruen zu bekommen. Die
// Spezifikation verbietet genau das ("N/A, nicht kuenstlich PASS").
//
// R9 (Lebt) bekommt ein EXPLIZITES LifeModel: "CA-Life" heisst hier, dass die
// Population ueber das Beobachtungsfenster weder ausstirbt noch einfriert. Das ist
// ein Proxy fuer Aktivitaet, keine Aussage ueber Leben -- und traegt deshalb den
// Claim-Tier MODEL/PROXY.

import { evaluateNineRules, R2_MODUS } from "./nine-rules.js";

// Fuer diese Entitaet sinnlose Regeln -- bewusst abgeschaltet statt erfunden.
//
// R5/R6: eine Population hat keinen Ort und keine Orientierung.
// R4 kam am 2026-08-11 dazu (Befund B3 der unabhaengigen Pruefung). Der erste Entwurf
// verglich hier Populationszahl mit Aenderungszahl -- zwei verschiedene Groessen
// desselben Frames. Deren Ungleichheit belegt keine Unterscheidungsleistung, und
// empirisch fiel das Urteil falsch herum aus: ein ERSTARRTER Automat "unterschied"
// (9 != 0), ein sterbender nicht (0 == 0). In den Physik-Modi ist es sogar determiniert,
// weil dort pop === active gesetzt wird -- das Ergebnis haengt am Simulationsmodus statt
// am Gegenstand. Arithmetisch korrekt auf falsch konstruierter Metrik ist wertlos.
// Der Populations-Ringpuffer traegt keinen Vergleichsraum, der Unterscheidung belegen
// koennte; er ist eine Zahl pro Generation. Also: aus.
export const NICHT_ANWENDBAR = Object.freeze(["R4", "R5", "R6"]);

/**
 * Baut den Trace aus dem Populations-Ringpuffer.
 *
 * @param {{pop:number[], active:number[]}} buf Ringpuffer aus popgraph.js
 * @param {number} gen aktuelle Generation (nur fuer die Beschriftung)
 * @returns {Array<object>} Zustaende, aelteste zuerst
 */
export function baueTrace(buf, gen = 0) {
  if (!buf || !Array.isArray(buf.pop)) return [];
  const n = buf.pop.length;
  const ersteGen = Math.max(0, gen - n + 1);
  return buf.pop.map((p, i) => ({
    u: p,                                  // intrinsischer Zustand: wie viele leben
    a: p,                                  // Entwicklungsgroesse: waechst die Population?
    aktiv: buf.active?.[i] ?? 0,           // wie viele Zellen wechselten in diesem Schritt
    gen: ersteGen + i,
    // KEIN q: eine Population hat keinen Ort. Siehe Kopfkommentar.
  }));
}

/**
 * Das LifeModel fuer GolHex. Explizit benannt und versioniert, wie die Spec verlangt.
 * "Lebendig" heisst hier ausschliesslich: im Beobachtungsfenster weder tot noch erstarrt.
 */
export const CA_LIFE = Object.freeze({
  name: "CA-Life",
  version: "1.0",
  predicate(last, trace) {
    if (!last || trace.length < 2) return false;
    if (last.u <= 0) return false;                     // ausgestorben
    const fenster = trace.slice(-Math.min(8, trace.length));
    // Erstarrt: seit mehreren Schritten wechselt keine Zelle mehr.
    const bewegt = fenster.some((s) => (s.aktiv ?? 0) > 0);
    return bewegt;
  },
});

/**
 * Wertet die neun Regeln gegen den aktuellen GolHex-Zustand aus.
 *
 * @param {{pop:number[], active:number[]}} buf Populations-Ringpuffer
 * @param {number} gen aktuelle Generation
 * @param {{laeuft?:boolean, r2Modus?:string}} opts
 *   laeuft: ob die Simulation gerade laeuft. Bestimmt, ob der Trace als abgeschlossen
 *   gilt -- und damit, ob TRACE-Regeln endgueltig oder nur vorlaeufig urteilen duerfen.
 */
export function bewerteGolHex(buf, gen, opts = {}) {
  const trace = baueTrace(buf, gen);
  const laeuft = opts.laeuft !== false;

  const config = {
    // R2: Populationswachstum, mit Rueckschritten. Ein Muster darf schrumpfen und
    // sich wieder erholen -- deshalb ORDERED und nicht MONOTONE.
    progressVariable: (s) => s.a,
    r2Modus: opts.r2Modus || R2_MODUS.ORDERED,
    // R4 ist abgeschaltet (siehe NICHT_ANWENDBAR) -- kein Vergleichsraum vorhanden.
    // R7: terminal heisst ausgestorben.
    terminalPredicate: (s) => s.u <= 0,
    lifeModel: CA_LIFE,
  };

  const enabled = ["R1", "R2", "R3", "R7", "R8", "R9"]; // R4/R5/R6 bewusst aus
  return evaluateNineRules(trace, config, { traceComplete: !laeuft, enabled });
}
