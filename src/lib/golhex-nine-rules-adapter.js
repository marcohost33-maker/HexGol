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

import { evaluateNineRules, R2_MODUS, R4_MODUS, D6, STATUS } from "./nine-rules.js";

// Re-Export fuer die App: sie laedt dieses Modul dynamisch und soll nine-rules.js
// nicht zusaetzlich statisch importieren (sonst landet es wieder im Haupt-Chunk).
export { STATUS };

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
/** RP2 (Kreis + Torus): maximale Streuung (RMS) um den Schwerpunkt, relativ zum Kreisradius. */
export const RP2_STREU_MAX = 0.5;
/** Toleranz in Gitterschritten fuer "steht still" / "liegt auf einer Hex-Achse" / "gleich kurz". */
export const ACHS_TOL = 1e-9;

const istGanz = (x) => Number.isInteger(x);
const mod = (a, m) => ((a % m) + m) % m;
const S3 = Math.sqrt(3);

// Koordinaten. Spaltenkoordinate x = Spalte + 0.5 auf ungeraden Reihen, y = Reihe
// (beide in Gitterschritten); axial q = x - y/2, r = y. Euklidische Welt wie in
// sim-engine buildNeighbors (Hexradius 1): X = x*sqrt(3), Y = y*1.5.
// Positionen bleiben FRAKTIONAL: erst runden und dann vergleichen machte eine
// schraege Verschiebung zu einer D6-Richtung (Codex-Befund PR #228).
const axialAusXY = (x, y) => ({ q: x - y / 2, r: y });
const xyAusAxial = (p) => ({ x: p.q + p.r / 2, y: p.r });

/** RP2-Bild eines Weltvektors v (relativ zur Kreismitte) jenseits der Antipoden-Naht. */
function rp2Bild(vx, vy, rho) {
  const l = Math.hypot(vx, vy);
  if (!(l > 0)) return [vx, vy];
  const f = -(2 * rho - l) / l;
  return [vx * f, vy * f];
}

/**
 * Schwerpunkt der lebenden Zellen eines odd-r-Gitters (fraktional, axial).
 *
 * @param {ArrayLike<number>} col Zellfarben (0 = tot), Laenge R*C
 * @param {number} R Reihen
 * @param {number} C Spalten
 * @param {{topologie?: string, mask?: ArrayLike<number>}} opts
 *   topologie: "edge" | "torus" (Rechteck) | "rp2" (Kreis + Torus, braucht mask) | sonst unbestimmt
 * @returns {{pos?:{q:number,r:number}, geom?:object|null, grund?:string}}
 */
export function schwerpunkt(col, R, C, opts = {}) {
  const topo = opts.topologie || "edge";
  if (!col || !istGanz(R) || !istGanz(C) || R < 1 || C < 1 || col.length < R * C) {
    return { grund: "keine Gitterdaten" };
  }
  if (topo !== "edge" && topo !== "torus" && topo !== "rp2") {
    return { grund: `Topologie '${topo}' hat keinen eindeutigen Schwerpunkt` };
  }
  if (topo === "edge") {
    let n = 0, sx = 0, sy = 0;
    for (let row = 0; row < R; row++) {
      const halb = (row & 1) ? 0.5 : 0;
      for (let c = 0; c < C; c++) {
        if (col[row * C + c] !== 0) { n++; sx += c + halb; sy += row; }
      }
    }
    if (n === 0) return { grund: "keine lebende Zelle" };
    return { pos: axialAusXY(sx / n, sy / n), geom: null };
  }
  if (topo === "rp2") return schwerpunktRP2(col, R, C, opts.mask);
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
  return { pos: axialAusXY(xq, yq), geom: { art: "torus", R, C } };
}

/**
 * RP2: Kreis-Rahmen, dessen Rand antipodal identifiziert ist (Engine: Randzelle ->
 * Punktspiegelung am Zentrum). Eine Zelle nahe dem Rand hat ein zweites Bild jenseits
 * der Naht: Spiegelung am Zentrum, dann radial am Kreis gespiegelt. Der Schwerpunkt
 * ist das Mittel, bei dem jede Zelle das Bild nimmt, das ihm naeher liegt (wenige
 * Fixpunkt-Iterationen); liegt es ausserhalb des Kreises, wird es zurueckgebildet.
 * Kreisradius aus der Maske: groesster Zentrumsabstand einer Domaenenzelle + sqrt(3)/2
 * (halber Nachbarabstand -- Naeherung an die Naht der Engine).
 */
function schwerpunktRP2(col, R, C, mask) {
  if (!mask || mask.length < R * C) return { grund: "RP2 ohne Domaenen-Maske: Kreisrand unbekannt" };
  const cr = (R - 1) / 2, cc = (C - 1) / 2;
  const cx = cc + ((cr & 1) ? 0.5 : 0), cy = cr;          // wie buildNeighbors (inkl. &1 auf cr)
  let maxD = 0;
  const vs = [];
  for (let row = 0; row < R; row++) {
    const halb = (row & 1) ? 0.5 : 0;
    for (let c = 0; c < C; c++) {
      const i = row * C + c;
      if (!mask[i]) continue;
      const vx = (c + halb - cx) * S3, vy = (row - cy) * 1.5;
      const d = Math.hypot(vx, vy);
      if (d > maxD) maxD = d;
      if (col[i] !== 0) vs.push(vx, vy);
    }
  }
  const n = vs.length / 2;
  if (n === 0) return { grund: "keine lebende Zelle" };
  const rho = maxD + S3 / 2;
  // Fixpunkt-Iteration ab mehreren Startpunkten (Mittel + bis zu 8 Zellen): ab dem
  // Mittel allein bliebe ein Haufen ueber der Naht in der Kreismitte haengen.
  const iteriere = (mx, my) => {
    let streu = Infinity;
    for (let it = 0; it < 8; it++) {
      let sx = 0, sy = 0, s2 = 0;
      const reps = [];
      for (let k = 0; k < vs.length; k += 2) {
        const [bx, by] = rp2Bild(vs[k], vs[k + 1], rho);
        const direkt = Math.hypot(vs[k] - mx, vs[k + 1] - my), bild = Math.hypot(bx - mx, by - my);
        const [px, py] = bild < direkt ? [bx, by] : [vs[k], vs[k + 1]];
        reps.push(px, py); sx += px; sy += py;
      }
      const nx = sx / n, ny = sy / n;
      for (let k = 0; k < reps.length; k += 2) s2 += (reps[k] - nx) ** 2 + (reps[k + 1] - ny) ** 2;
      streu = Math.sqrt(s2 / n);
      const fertig = nx === mx && ny === my;
      mx = nx; my = ny;
      if (fertig) break;
    }
    return { mx, my, streu };
  };
  let sx0 = 0, sy0 = 0;
  for (let k = 0; k < vs.length; k += 2) { sx0 += vs[k]; sy0 += vs[k + 1]; }
  let best = iteriere(sx0 / n, sy0 / n);
  const schritt = Math.max(1, Math.floor(n / 8));
  for (let z = 0; z < n; z += schritt) {
    const v = iteriere(vs[2 * z], vs[2 * z + 1]);
    if (v.streu < best.streu) best = v;
  }
  let { mx, my } = best;
  const { streu } = best;
  // NaN-fest: nur ein WAHRER Vergleich laesst einen Schwerpunkt zu.
  if (!(streu <= RP2_STREU_MAX * rho)) {
    return { grund: `Population ueber die Scheibe verteilt (Streuung ${(streu / rho).toFixed(2)} rho > ${RP2_STREU_MAX})` };
  }
  if (Math.hypot(mx, my) > rho) [mx, my] = rp2Bild(mx, my, rho);
  return { pos: axialAusXY(cx + mx / S3, cy + my / 1.5), geom: { art: "rp2", cx, cy, rho } };
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

const weltAbstand = (a, b) => {
  const pa = xyAusAxial(a), pb = xyAusAxial(b);
  return Math.hypot((pb.x - pa.x) * S3, (pb.y - pa.y) * 1.5);
};

/**
 * Kuerzeste axiale Verschiebung a->b.
 * Torus: ueber die 9 Gitterbilder; RP2: direkt oder ueber die Antipoden-Naht.
 * Mehrere gleich kurze, VERSCHIEDENE Wege -> keine Richtung (Codex-Befund PR #228).
 * @returns {{q:number, r:number} | {grund:string}}
 */
function verschiebung(a, b, geom) {
  if (!geom) return { q: b.q - a.q, r: b.r - a.r };
  const kandidaten = [];
  if (geom.art === "torus") {
    const pb = xyAusAxial(b);
    for (const dy of [-geom.R, 0, geom.R]) {
      for (const dx of [-geom.C, 0, geom.C]) kandidaten.push({ p: axialAusXY(pb.x + dx, pb.y + dy), naht: false });
    }
  } else if (geom.art === "rp2") {
    const pb = xyAusAxial(b);
    const vx = (pb.x - geom.cx) * S3, vy = (pb.y - geom.cy) * 1.5;
    const [bx, by] = rp2Bild(vx, vy, geom.rho);
    kandidaten.push({ p: b, naht: false });
    kandidaten.push({ p: axialAusXY(geom.cx + bx / S3, geom.cy + by / 1.5), naht: true });
  } else {
    return { grund: `unbekannte Geometrie '${geom.art}'` };
  }
  for (const k of kandidaten) k.d = weltAbstand(a, k.p);
  const min = Math.min(...kandidaten.map((k) => k.d));
  if (!Number.isFinite(min)) return { grund: "Abstand nicht bestimmbar" };
  const kurz = kandidaten.filter((k) => k.d - min <= ACHS_TOL * (1 + min));
  const erster = kurz[0];
  const verschieden = kurz.some((k) => weltAbstand(erster.p, k.p) > ACHS_TOL * (1 + min));
  if (verschieden && min > ACHS_TOL) return { grund: "mehrdeutig (gleich kurze Wege in verschiedene Richtungen)" };
  if (erster.naht && min > ACHS_TOL) {
    return { grund: "Verschiebung ueber die Antipoden-Naht: auf RP2 nicht orientierbar" };
  }
  return { q: erster.p.q - a.q, r: erster.p.r - a.r };
}

/** Identitaet der Schwerpunkt-Definition einer Probe (Rand | Torus RxC | RP2-Scheibe). */
const geomSchluessel = (g) => (!g ? "edge" : g.art === "torus" ? `torus:${g.R}x${g.C}`
  : g.art === "rp2" ? `rp2:${g.cx},${g.cy},${g.rho}` : `?:${g.art}`);

/** D6-Einheitsrichtung, falls v (bis auf ACHS_TOL) ein positives Vielfaches einer Hex-Achse ist. */
function achsRichtung(v) {
  const k = Math.max(Math.abs(v.q), Math.abs(v.r), Math.abs(v.q + v.r));
  if (!(k > ACHS_TOL)) return null;
  const tol = ACHS_TOL * (1 + k);
  return D6.find((d) => Math.abs(d.q * k - v.q) <= tol && Math.abs(d.r * k - v.r) <= tol) || null;
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
    // A1-Spontangeburten fehlen in stepLife-`births` (Stand main, Codex-Befund PR #228);
    // ohne vollstaendige Zaehlung kein Urteil. Entfaellt, sobald die Engine sie zaehlt.
    else if (x.a1 === true) s.vergleichsraumGrund = "A1 aktiv: Spontangeburten fehlen in den Zaehlwerten";
    else {
      const k = uebergangsKlassen(p, x.births, x.deaths, x.zellen);
      if (k.klassen) s.klassen = k.klassen; else s.vergleichsraumGrund = k.grund;
    }
    // R6: Schwerpunkt, sonst unbestimmt mit Grund.
    if (x && x.pos && Number.isFinite(x.pos.q) && Number.isFinite(x.pos.r)) {
      s.q = { q: x.pos.q, r: x.pos.r };
      s.geom = x.geom ?? null;
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
    // Topologiewechsel zwischen zwei Proben: die Schwerpunkte sind verschieden definiert,
    // ihre Differenz ist keine Bewegung (Codex R2, PR #228). Position UND Richtung
    // dieser Probe gelten als unbestimmt; R6 vergleicht sonst die rohen Koordinaten.
    if (geomSchluessel(s.geom) !== geomSchluessel(v.geom)) {
      const g = "Topologie gewechselt (Schwerpunkte verschieden definiert)";
      delete s.q;
      s.qUnbekannt = g;
      s.dUnbekannt = g;
      continue;
    }
    const vs = verschiebung(v.q, s.q, s.geom);
    if (typeof vs.grund === "string") { s.dUnbekannt = vs.grund; continue; }
    const laenge = Math.max(Math.abs(vs.q), Math.abs(vs.r), Math.abs(vs.q + vs.r));
    if (laenge <= ACHS_TOL) {
      // Innerhalb der Toleranz unbewegt: die Position der Vorprobe uebernehmen, damit
      // R6 (vergleicht roh, strikt > 0) kein Gleitkomma-Rauschen als Bewegung liest.
      s.q = { q: v.q.q, r: v.q.r };
      s.dGrund = "Schwerpunkt unbewegt";
      continue;
    }
    const d = achsRichtung(vs);
    if (d) s.d = { q: d.q, r: d.r };
    else s.dUnbekannt = `Verschiebung (${+vs.q.toFixed(3)},${+vs.r.toFixed(3)}) liegt auf keiner Hex-Achse`;
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
    // Vielfachheit bleibt erhalten (Codex R2): eine Klasse mit n >= 2 Zellen stellt zwei
    // Repraesentanten -- n gleich behandelte Zellen sind ein gemessenes "unterscheidet
    // nicht" (FAIL), kein fehlender Vergleich. Nur eine einzige Zelle bleibt UNKNOWN.
    population: (s) => (s && Array.isArray(s.klassen)
      ? s.klassen.filter((k) => k.n > 0).flatMap((k) => (k.n >= 2 ? [k, k] : [k]))
      : []),
    discriminator: (a, b) => a.vor === b.vor && a.nach !== b.nach,
    // R7: terminal heisst ausgestorben.
    terminalPredicate: (s) => s.u <= 0,
    lifeModel: CA_LIFE,
  };

  return evaluateNineRules(trace, config, { traceComplete: !laeuft });
}
