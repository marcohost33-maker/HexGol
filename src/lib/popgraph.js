// popgraph.js — PURE Ring-Buffer + Sparkline-Pfad-Berechnung fuer den
// Live-Populations-Graphen (Feature 1, v33-Welle 2026-06-09).
//
// WARUM pur + separat (AGENTS.md §2): wie sim-core/hex-geom wird die Kern-Logik
// (Ring-Buffer-Wrap + Pfad-Skalierung) aus App.tsx extrahiert und Vitest-getestet.
// Die UI in App.tsx ruft nur push/reset/buildPaths auf und zeichnet das Ergebnis.
//
// Datenfluss: pro Simulationsschritt liefert pushStats() {pop, active}. pop = lebende
// Zellen (Lebenswelt) bzw. aktive Zellen (rval). active = pro-Schritt geaenderte Zellen
// (Lebenswelt: births+deaths; rval: gleich pop, da kein separater Diff vorliegt).
// Beide Werte werden BEREITS in der Stats-Zeile getrackt — hier nur gepuffert, NICHT
// neu berechnet.

export const POPGRAPH_CAP = 200;

/**
 * Erzeugt einen leeren Ring-Buffer fester Kapazitaet.
 * @param {number} cap maximale Anzahl gepufferter Generationen (Default 200)
 * @returns {{pop:number[], active:number[], cap:number}}
 */
export function createBuffer(cap = POPGRAPH_CAP) {
  const c = Math.max(1, cap | 0);
  return { pop: [], active: [], cap: c };
}

/**
 * Haengt eine Stichprobe an. Bei Ueberlauf wird der aelteste Wert verworfen
 * (FIFO-Ring-Verhalten ueber push+shift). Nicht-endliche Eingaben werden auf 0
 * geklemmt (Silent-Failure-Gate: NaN/Infinity duerfen die Skalierung nicht vergiften).
 * @param {{pop:number[], active:number[], cap:number}} buf
 * @param {number} pop
 * @param {number} active
 * @returns {{pop:number[], active:number[], cap:number}} derselbe (mutierte) Buffer
 */
export function pushSample(buf, pop, active) {
  const p = Number.isFinite(pop) ? Math.max(0, pop) : 0;
  const a = Number.isFinite(active) ? Math.max(0, active) : 0;
  buf.pop.push(p);
  buf.active.push(a);
  // Beide Reihen parallel halten und gemeinsam am Kapazitaetsrand kuerzen.
  while (buf.pop.length > buf.cap) buf.pop.shift();
  while (buf.active.length > buf.cap) buf.active.shift();
  return buf;
}

/**
 * Leert den Buffer (neuer Lauf: Leeren/Random/Regel-/Feld-Wechsel), ohne die
 * Identitaet oder Kapazitaet zu aendern.
 * @param {{pop:number[], active:number[], cap:number}} buf
 * @returns {{pop:number[], active:number[], cap:number}}
 */
export function resetBuffer(buf) {
  buf.pop.length = 0;
  buf.active.length = 0;
  return buf;
}

/**
 * Baut einen SVG-Pfad-String fuer eine Reihe in einer w x h-Box.
 * x ist streng monoton steigend (links=aelteste, rechts=neueste Generation).
 * y ist invertiert (groesserer Wert = weiter oben, da SVG-y nach unten waechst).
 * Skaliert relativ zu `max` (gemeinsame Skala, von buildPaths vorgegeben), sodass
 * Pop und Aktiv vergleichbar bleiben. Leere/1-Punkt-Reihen ergeben "" (nichts zeichnen).
 * @param {number[]} values
 * @param {number} w Breite der Box
 * @param {number} h Hoehe der Box
 * @param {number} max gemeinsames Maximum (>=1 erzwungen)
 * @returns {string} SVG-Pfad ("M..L..") oder ""
 */
export function buildPath(values, w, h, max) {
  const n = values.length;
  if (n < 2) return "";
  const m = Math.max(1, max);
  const denom = n - 1;
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = (i / denom) * w;
    const v = Number.isFinite(values[i]) ? Math.max(0, values[i]) : 0;
    const y = h - (v / m) * h;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

/**
 * Baut beide Sparkline-Pfade (pop, active) mit GEMEINSAMER Skala.
 * Gemeinsames Maximum = groesster endlicher Wert ueber beide Reihen (>=1). Dadurch
 * sitzt die Pop-Linie nie unter der Aktiv-Linie bei gleichem Wert und das Verhaeltnis
 * der beiden bleibt visuell lesbar (Mockup Panel 1: Pop oben kraeftig, Aktiv darunter).
 * @param {{pop:number[], active:number[], cap:number}} buf
 * @param {number} w
 * @param {number} h
 * @returns {{pop:string, active:string, max:number, n:number}}
 */
export function buildPaths(buf, w, h) {
  const n = Math.min(buf.pop.length, buf.active.length);
  let max = 1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(buf.pop[i]) && buf.pop[i] > max) max = buf.pop[i];
    if (Number.isFinite(buf.active[i]) && buf.active[i] > max) max = buf.active[i];
  }
  return {
    pop: buildPath(buf.pop.slice(0, n), w, h, max),
    active: buildPath(buf.active.slice(0, n), w, h, max),
    max,
    n,
  };
}
