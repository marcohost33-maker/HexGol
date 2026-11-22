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
//   Uebergangsklassen des letzten Schritts -> traegt R4   (seit 2026-11-22)
//   Schwerpunkt der lebenden Zellen        -> traegt R5, R6 (seit 2026-11-22)
//
// R4/R5/R6 waren bis 2026-11-22 abgeschaltet, weil der Ringpuffer nur EINE Zahl pro
// Generation trug. Jetzt erhebt App.tsx je Probe zusaetzliche, ECHT GEMESSENE
// Groessen (popgraph `extra`): Geburten und Tode getrennt, Domaenengroesse und den
// Schwerpunkt der lebenden Zellen. Was sich daraus nicht eindeutig bestimmen laesst,
// meldet der Adapter als UNBESTIMMT (Regel -> UNKNOWN), nie als geratenes PASS:
//
//   R6/R5: Der Schwerpunkt ist eine ABGELEITETE Zusammenfassung der Population, kein
//   Objekt, das "sich bewegt". Er ist nur dort definiert, wo er eindeutig ist: auf
//   Rand-Topologie (arithmetisches Mittel in axialen Koordinaten) und auf dem
//   Rechteck-Torus nur fuer eine LOKALISIERTE Population (Kreismittel je Achse mit
//   mittlerer Resultantenlaenge >= RBAR_MIN). Gleichverteilt auf dem Torus und auf
//   allen anderen Torus-Rahmen (Kreis + Torus = RP2) bleibt er unbestimmt.
//   R5 traegt nur eine Richtung, wenn die letzte Verschiebung exakt entlang einer der
//   sechs Hex-Achsen lief; schraeg -> unbestimmt (nicht auf D6 gerundet, das waere
//   ein PASS per Konstruktion).
//
//   R4 (ACTIVE): Das System "unterscheidet", wenn sein letzter Schritt Zellen
//   GLEICHEN Vorzustands verschieden behandelt hat -- manche Lebende ueberleben,
//   andere sterben, oder manche Leere werden geboren, andere nicht. Das ist die
//   Leistung der B/S-Regel selbst (sie entscheidet nach der Nachbarschaft). Ein
//   erstarrter Automat unterscheidet damit NICHT, ein teilweise sterbender schon --
//   umgekehrt zum verworfenen Erstentwurf (Befund B3, 2026-08-11).
//
// R9 (Lebt) bekommt ein EXPLIZITES LifeModel: "CA-Life" heisst hier, dass die
// Population ueber das Beobachtungsfenster weder ausstirbt noch einfriert. Das ist
// ein Proxy fuer Aktivitaet, keine Aussage ueber Leben -- und traegt deshalb den
// Claim-Tier MODEL/PROXY.

import { evaluateNineRules, R2_MODUS, R4_MODUS, D6, hexDistance } from "./nine-rules.js";

// Abgeschaltete Regeln. Seit 2026-11-22 leer: R4/R5/R6 werden auf erhobenen Groessen
// ausgewertet (siehe Kopf). Export bleibt fuer bestehende Aufrufer erhalten.
//
// Historie: R5/R6 waren aus, weil der Trace keinen Ort trug.
// R4 kam am 2026-08-11 dazu (Befund B3 der unabhaengigen Pruefung). Der erste Entwurf
// verglich hier Populationszahl mit Aenderungszahl -- zwei verschiedene Groessen
// desselben Frames. Deren Ungleichheit belegt keine Unterscheidungsleistung, und
// empirisch fiel das Urteil falsch herum aus: ein ERSTARRTER Automat "unterschied"
// (9 != 0), ein sterbender nicht (0 == 0). In den Physik-Modi ist es sogar determiniert,
// weil dort pop === active gesetzt wird -- das Ergebnis haengt am Simulationsmodus statt
// am Gegenstand. Arithmetisch korrekt auf falsch konstruierter Metrik ist wertlos.
// Der Populations-Ringpuffer traegt keinen Vergleichsraum, der Unterscheidung belegen
// koennte; er ist eine Zahl pro Generation. Damals richtig: aus. Die Loesung ist
// eine ANDERE Metrik (Uebergangsklassen), nicht dieselbe wieder eingeschaltet.
export const NICHT_ANWENDBAR = Object.freeze([]);

/** Mindest-Resultantenlaenge je Achse fuer einen Torus-Schwerpunkt (0..1). */
export const RBAR_MIN = 0.5;

const istGanz = (x) => Number.isInteger(x);
const mod = (a, m) => ((a % m) + m) % m;

/** Kubische Rundung fraktionaler axialer Koordinaten auf die naechste Hexzelle. */
function axialRunden(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 }; // +0 normalisiert -0
}

const axialAusOffset = (row, col) => ({ q: col - (row - (row & 1)) / 2, r: row });
const offsetAusAxial = (p) => ({ row: p.r, col: p.q + (p.r - (p.r & 1)) / 2 });

/**
 * Schwerpunkt der lebenden Zellen eines odd-r-Gitters.
 *
 * @param {ArrayLike<number>} col Zellfarben (0 = tot), Laenge R*C
 * @param {number} R Reihen
 * @param {number} C Spalten
 * @param {{topologie?: string}} opts "edge" | "torus" (nur Rechteck) | sonst unbestimmt
 * @returns {{pos?:{q:number,r:number}, periode?:{R:number,C:number}|null, grund?:string}}
 */
export function schwerpunkt(col, R, C, opts = {}) {
  const topo = opts.topologie || "edge";
  if (!col || !istGanz(R) || !istGanz(C) || R < 1 || C < 1 || col.length < R * C) {
    return { grund: "keine Gitterdaten" };
  }
  if (topo !== "edge" && topo !== "torus") {
    return { grund: `Topologie '${topo}' hat keinen eindeutigen Schwerpunkt` };
  }
  if (topo === "edge") {
    let n = 0, sq = 0, sr = 0;
    for (let row = 0; row < R; row++) {
      const versatz = (row - (row & 1)) / 2;
      for (let c = 0; c < C; c++) {
        if (col[row * C + c] !== 0) { n++; sq += c - versatz; sr += row; }
      }
    }
    if (n === 0) return { grund: "keine lebende Zelle" };
    return { pos: axialRunden(sq / n, sr / n), periode: null };
  }
  // Torus (Rechteck, periodisch in Reihe und Spalte): Kreismittel je Achse.
  // Weltkoordinate x = Spalte + 0.5 auf ungeraden Reihen (Periode C), y = Reihe (R).
  const proReihe = new Float64Array(R);
  const proHalbspalte = new Float64Array(2 * C); // Index 2*x
  let n = 0;
  for (let row = 0; row < R; row++) {
    const halb = row & 1;
    for (let c = 0; c < C; c++) {
      if (col[row * C + c] !== 0) { n++; proReihe[row]++; proHalbspalte[2 * c + halb]++; }
    }
  }
  if (n === 0) return { grund: "keine lebende Zelle" };
  let yc = 0, ys = 0, xc = 0, xs = 0;
  for (let row = 0; row < R; row++) {
    if (!proReihe[row]) continue;
    const w = (2 * Math.PI * row) / R;
    yc += proReihe[row] * Math.cos(w); ys += proReihe[row] * Math.sin(w);
  }
  for (let h = 0; h < 2 * C; h++) {
    if (!proHalbspalte[h]) continue;
    const w = (2 * Math.PI * (h / 2)) / C;
    xc += proHalbspalte[h] * Math.cos(w); xs += proHalbspalte[h] * Math.sin(w);
  }
  const rbarY = Math.hypot(yc, ys) / n, rbarX = Math.hypot(xc, xs) / n;
  // NaN-fest: nur ein WAHRER Vergleich laesst einen Schwerpunkt zu.
  if (!(rbarY >= RBAR_MIN && rbarX >= RBAR_MIN)) {
    return { grund: `Population ueber den Torus verteilt (R=${Math.min(rbarX, rbarY).toFixed(2)} < ${RBAR_MIN})` };
  }
  const yq = mod((Math.atan2(ys, yc) * R) / (2 * Math.PI), R);
  const xq = mod((Math.atan2(xs, xc) * C) / (2 * Math.PI), C);
  const a = axialRunden(xq - yq / 2, yq);
  // Auf die kanonische Zelle im Grundgebiet normieren.
  const o = offsetAusAxial(a);
  const row = mod(o.row, R), c = mod(o.col, C);
  const pos = axialAusOffset(row, c);
  return { pos: { q: pos.q + 0, r: pos.r + 0 }, periode: { R, C } };
}

/**
 * Uebergangsklassen des letzten Simulationsschritts aus Zaehlwerten.
 * vorher lebend = pop - births + deaths.
 * @returns {{klassen?: Array<{vor:0|1, nach:0|1, n:number}>, grund?: string}}
 */
export function uebergangsKlassen(pop, births, deaths, zellen) {
  if (![pop, births, deaths, zellen].every((x) => istGanz(x) && x >= 0)) {
    return { grund: "Zaehlwerte fehlen oder sind ungueltig" };
  }
  const ueberlebt = pop - births;
  const leerGeblieben = zellen - pop - deaths;
  if (ueberlebt < 0 || leerGeblieben < 0) {
    return { grund: "Zaehlung inkonsistent (Geburten/Tode passen nicht zu Population/Domaene)" };
  }
  return {
    klassen: [
      { vor: 1, nach: 1, n: ueberlebt }, { vor: 1, nach: 0, n: deaths },
      { vor: 0, nach: 1, n: births }, { vor: 0, nach: 0, n: leerGeblieben },
    ],
  };
}

/** Kuerzeste axiale Verschiebung a->b, auf dem Torus ueber die 9 Gitterbilder. */
function verschiebung(a, b, periode) {
  if (!periode) return { q: b.q - a.q, r: b.r - a.r };
  const ob = offsetAusAxial(b);
  let best = null;
  for (const dr of [-periode.R, 0, periode.R]) {
    for (const dc of [-periode.C, 0, periode.C]) {
      const bild = axialAusOffset(ob.row + dr, ob.col + dc);
      const d = hexDistance(a, bild);
      if (!best || d < best.d) best = { d, q: bild.q - a.q, r: bild.r - a.r };
    }
  }
  return { q: best.q, r: best.r };
}

/** D6-Einheitsrichtung, falls v ein positives Vielfaches einer Hex-Achse ist. */
function achsRichtung(v) {
  const k = Math.max(Math.abs(v.q), Math.abs(v.r), Math.abs(v.q + v.r));
  if (k === 0) return null;
  return D6.find((d) => d.q * k === v.q && d.r * k === v.r) || null;
}

/**
 * Baut den Trace aus dem Populations-Ringpuffer.
 *
 * @param {{pop:number[], active:number[], extra?:Array<object|null>}} buf Ringpuffer aus popgraph.js
 * @param {number} gen aktuelle Generation (nur fuer die Beschriftung)
 * @returns {Array<object>} Zustaende, aelteste zuerst
 */
export function baueTrace(buf, gen = 0) {
  if (!buf || !Array.isArray(buf.pop)) return [];
  const n = buf.pop.length;
  const ersteGen = Math.max(0, gen - n + 1);
  const trace = buf.pop.map((p, i) => {
    const x = buf.extra?.[i] ?? null;
    const s = {
      u: p,                                  // intrinsischer Zustand: wie viele leben
      a: p,                                  // Entwicklungsgroesse: waechst die Population?
      aktiv: buf.active?.[i] ?? 0,           // wie viele Zellen wechselten in diesem Schritt
      gen: ersteGen + i,
    };
    // R4: Uebergangsklassen nur fuer echte Simulationsschritte.
    if (!x) s.vergleichsraumGrund = "keine Uebergangsdaten erhoben";
    else if (x.schritt !== true) s.vergleichsraumGrund = "kein Simulationsschritt (Malen/Laden/Physikmodus)";
    else {
      const k = uebergangsKlassen(p, x.births, x.deaths, x.zellen);
      if (k.klassen) s.klassen = k.klassen; else s.vergleichsraumGrund = k.grund;
    }
    // R6: Schwerpunkt, sonst unbestimmt mit Grund.
    if (x && x.pos && Number.isFinite(x.pos.q) && Number.isFinite(x.pos.r)) {
      s.q = { q: x.pos.q, r: x.pos.r };
      s.periode = x.periode ?? null;
    } else {
      s.qUnbekannt = x?.posGrund || "keine Ortsdaten erhoben";
    }
    return s;
  });
  // R5: Richtung der letzten Schwerpunkt-Verschiebung.
  for (let i = 0; i < trace.length; i++) {
    const s = trace[i];
    const v = i > 0 ? trace[i - 1] : null;
    if (!v) { s.dUnbekannt = "noch keine Verschiebung beobachtet"; continue; }
    if (!s.q || !v.q) { s.dUnbekannt = s.qUnbekannt || v.qUnbekannt; continue; }
    const vs = verschiebung(v.q, s.q, s.periode);
    if (vs.q === 0 && vs.r === 0) { s.dGrund = "Schwerpunkt unbewegt"; continue; }
    const d = achsRichtung(vs);
    if (d) s.d = { q: d.q, r: d.r };
    else s.dUnbekannt = `Verschiebung (${vs.q},${vs.r}) liegt auf keiner Hex-Achse`;
  }
  return trace;
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
    // R4 ACTIVE: Vergleichsraum = besetzte Uebergangsklassen des letzten Schritts;
    // das System unterscheidet, wenn es gleiche Vorzustaende verschieden fortschreibt.
    r4Modus: R4_MODUS.ACTIVE,
    population: (s) => (s && Array.isArray(s.klassen) ? s.klassen.filter((k) => k.n > 0) : []),
    discriminator: (a, b) => a.vor === b.vor && a.nach !== b.nach,
    // R7: terminal heisst ausgestorben.
    terminalPredicate: (s) => s.u <= 0,
    lifeModel: CA_LIFE,
  };

  return evaluateNineRules(trace, config, { traceComplete: !laeuft });
}
