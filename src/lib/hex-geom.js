// Hex-Wuerfelkoordinaten-Geometrie (Red Blob Games kanonisch) — extrahiert aus
// App.tsx (2026-06-04, v31-Rekonvergenz), unit-getestet. Reine Funktionen ohne
// React/DOM. App.tsx IMPORTIERT diese (Single Source — kein Copy-Drift); Tests in
// tests/unit/hex-geom.test.js (hex corners / outlines / Maske-Konsistenz).
//
// Grundlage des exakten hexagonalen Rahmens: Punkte mit hex-Abstand <= r bilden
// ein regelmaessiges Sechseck; die 6 Ecken liegen genau r Schritte in den 6
// kanonischen Wuerfel-Richtungen vom Zentrum. (verifiziert via zentrierte
// Hexzahlen 1+3r(r+1)).

// odd-r offset -> Wuerfelkoordinaten.
export function oddRToCube(col, row) {
  const x = col - ((row - (row & 1)) / 2);
  const z = row;
  return { x, y: -x - z, z };
}
// Wuerfel -> odd-r offset.
export function cubeToOddR(c) {
  return { col: c.x + ((c.z - (c.z & 1)) / 2), row: c.z };
}
// Hex-Manhattan-Distanz in Wuerfelkoordinaten.
export function hexDist(a, b) {
  return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z)) / 2;
}
// Die 6 kanonischen Wuerfel-Richtungen. Die Ecken eines hexDist-Sechsecks liegen
// genau hexRad Schritte in diesen Richtungen.
export const CUBE_DIRS = [
  { x: 1, y: -1, z: 0 }, { x: 1, y: 0, z: -1 }, { x: 0, y: 1, z: -1 },
  { x: -1, y: 1, z: 0 }, { x: -1, y: 0, z: 1 }, { x: 0, y: -1, z: 1 },
];

// --- v33 Stempel-Primitive (Red Blob Games "Rings"/"Spirals") ---------------
// Kanonischer Ring um ein Zentrum in Wuerfelkoordinaten. Ein Ring der Distanz n
// (n>=1) hat GENAU 6n Zellen (Red Blob `cube_ring`). Reihenfolge: vom Start-Eck
// (n Schritte in CUBE_DIRS[4]) im Uhrzeigersinn umlaufend — deterministisch, damit
// die k-Faerbung zusammenhaengende Sektoren bildet.
//   Beleg-Orakel: ring(c,n).length === 6n; alle Zellen hexDist == n.
export function cubeRing(center, n) {
  if (n < 0) return [];
  if (n === 0) return [{ ...center }];
  const out = [];
  // Start: n Schritte in Richtung CUBE_DIRS[4]; danach 6 Kanten a n Schritte.
  let cube = {
    x: center.x + CUBE_DIRS[4].x * n,
    y: center.y + CUBE_DIRS[4].y * n,
    z: center.z + CUBE_DIRS[4].z * n,
  };
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < n; j++) {
      out.push({ ...cube });
      cube = { x: cube.x + CUBE_DIRS[i].x, y: cube.y + CUBE_DIRS[i].y, z: cube.z + CUBE_DIRS[i].z };
    }
  }
  return out;
}

// Spirale/Scheibe: alle Zellen mit hexDist <= n (Zentrum + Ringe 1..n).
// Anzahl = zentrierte Hexzahl 1 + 3n(n+1) (Red Blob `cube_spiral`).
//   Beleg-Orakel: disk(c,n).length === 1 + 3n(n+1); alle hexDist <= n.
export function cubeDisk(center, n) {
  const out = [{ ...center }];
  for (let k = 1; k <= n; k++) out.push(...cubeRing(center, k));
  return out;
}

// Symmetrische k-Faerbung der Stempel-Zellen. Gibt fuer jede Eingabe-Zelle einen
// Farb-Index 0..k-1 zurueck, der einen ZUSAMMENHAENGENDEN Winkel-Sektor bildet.
//   - Ring (geordnete 6n-Liste): Sektor = floor(i / (len/k)) -> exakt restfrei,
//     da 6n fuer jedes n durch 1,2,3,6 teilbar ist (Audit A4).
//   - Scheibe/sonst (orderByAngle=false NICHT setzbar hier): wir nutzen den Winkel
//     der Zelle zum Zentrum, damit Disk-Sektoren auch winkelbasiert sauber sind.
// Diese Funktion bekommt die bereits geordnete Ring-Liste ODER eine Disk-Liste;
// `mode` waehlt die Strategie. Zentrumszelle (hexDist 0) bei Disk -> Farbe 0.
export function kColorByIndex(len, k) {
  // Reiner Index-Sektor fuer geordnete Ringe: 6n/k zusammenhaengende Zellen je Farbe.
  if (k <= 1) return (_i) => 0;
  const per = len / k;
  return (i) => Math.min(k - 1, Math.floor(i / per));
}

// Winkel-basierte k-Faerbung (fuer Scheibe/Disk): Sektor aus atan2 des Versatzes
// zum Zentrum in WELT-Koordinaten. Rot/Sektor 0 startet "oben" (Itten-Konvention,
// konsistent mit placeColorWheel: -90 Grad = oben, im Uhrzeigersinn).
//   wxFn/wyFn: Welt-Koordinaten-Funktionen (row,col)->Welt; cube->odd-r via cubeToOddR.
export function sectorByAngle(cube, center, k, wxFn, wyFn) {
  if (k <= 1) return 0;
  const a = cubeToOddR(cube), c = cubeToOddR(center);
  const dx = wxFn(a.row, a.col) - wxFn(c.row, c.col);
  const dy = wyFn(a.row) - wyFn(c.row);
  if (dx === 0 && dy === 0) return 0; // Zentrum -> Sektor 0
  let raw = Math.atan2(dy, dx);        // 0 = rechts, +unten
  let ang = -(raw + Math.PI / 2);      // oben -> 0, im Uhrzeigersinn
  ang %= (2 * Math.PI); if (ang < 0) ang += 2 * Math.PI;
  return Math.min(k - 1, Math.floor((ang / (2 * Math.PI)) * k));
}

// --- v33 PR-E: Punkt-in-Polygon via Winding-Number (Hormann-Agathos 2001) -----
// Robuste Punkt-in-Polygon-Klassifikation fuer BELIEBIGE (auch selbst-
// ueberschneidende) Polygone. Liefert die WINDING NUMBER (Umlaufzahl): wie oft
// das Polygon den Testpunkt umlaeuft. != 0 => innen (nonzero-Regel).
//
// Warum Winding statt Even-Odd: selbst-ueberschneidende Formen (z.B. ein Stern,
// frei gezeichnet) klassifiziert Even-Odd in den ueberlappenden Innenflaechen
// FALSCH als "aussen". Winding ist hier korrekt (Audit Mathe TEIL B(b)).
//
// Robustheits-Kern (Hormann-Agathos): KEINE Gleitkomma-Schnittpunkte berechnen.
// Stattdessen pro Kante nur das VORZEICHEN der Lage des Punkts relativ zur Kante
// pruefen (Kreuzprodukt `isLeft`) und zaehlen, ob die Kante den horizontalen
// Strahl nach rechts kreuzt. Fuer GolHex liegen Hex-Zellzentren auf einem
// ganzzahligen Cube-Gitter -> wenn das Polygon ebenfalls auf Integer-Koordinaten
// uebergeben wird, sind alle Tests exakt (keine epsilon-Toleranz noetig).
// Quelle: Hormann & Agathos, *The Point in Polygon Problem for Arbitrary
//   Polygons*, Comp. Geometry 2001 (Algorithm 6 / det-basierter wn-Zaehler).
//   https://www.inf.usi.ch/hormann/papers/Hormann.2001.TPI.pdf
//
// `polygon`: Array von {x, y}-Punkten (offen ODER geschlossen — letztes==erstes
//   wird toleriert). Mindestens 3 Eckpunkte.
//
// `isLeft`: > 0 wenn (px,py) links von der gerichteten Kante a->b liegt, < 0
// rechts, == 0 exakt AUF der Kantengeraden (kollinear).
function isLeft(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (px - ax) * (by - ay);
}

// Reine Umlaufzahl (ohne Boundary-Sonderbehandlung).
export function windingNumber(px, py, polygon) {
  if (!polygon || polygon.length < 3) return 0;
  let wn = 0;
  const n = polygon.length;
  // Geschlossen-Toleranz: wenn letzter == erster Punkt, diesen nicht doppelt zaehlen.
  const last = polygon[n - 1], first = polygon[0];
  const m = (last.x === first.x && last.y === first.y) ? n - 1 : n;
  for (let i = 0; i < m; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % m];
    if (a.y <= py) {
      // aufsteigende Kante kreuzt den Strahl nach rechts?
      if (b.y > py && isLeft(a.x, a.y, b.x, b.y, px, py) > 0) wn++;
    } else {
      // absteigende Kante kreuzt den Strahl nach rechts?
      if (b.y <= py && isLeft(a.x, a.y, b.x, b.y, px, py) < 0) wn--;
    }
  }
  return wn;
}

// Punkt-auf-Kante-Test: liegt (px,py) exakt AUF einem Polygon-Segment? Hex-
// Zellzentren liegen oft EXAKT auf einer gezeichneten Linie (Normalfall, nicht
// Sonderfall — Audit Mathe TEIL B(b) / Adversarial B1) -> eigener robuster Zweig.
// kollinear (isLeft==0) UND innerhalb der Bounding-Box des Segments.
function onSegment(ax, ay, bx, by, px, py) {
  if (isLeft(ax, ay, bx, by, px, py) !== 0) return false;
  // Bounding-Box-Inklusion (deckt auch entartete Punkt-Segmente a==b ab).
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx)
    && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}

// Punkt-in-Polygon mit explizitem Boundary-Branch: Punkt AUF einer Kante zaehlt
// als INNEN (Konvention fuer die Domaenen-Maske — eine gezeichnete Grenzlinie
// soll dazugehoeren). Sonst: nonzero-Winding (wn != 0 => innen).
//   Rueckgabe: true = innen ODER auf dem Rand; false = aussen.
export function pointInPolygonWN(px, py, polygon) {
  if (!polygon || polygon.length < 3) return false;
  const n = polygon.length;
  const last = polygon[n - 1], first = polygon[0];
  const m = (last.x === first.x && last.y === first.y) ? n - 1 : n;
  // 1) Boundary-Branch zuerst (Punkt-auf-Kante == innen).
  for (let i = 0; i < m; i++) {
    const a = polygon[i], b = polygon[(i + 1) % m];
    if (onSegment(a.x, a.y, b.x, b.y, px, py)) return true;
  }
  // 2) nonzero-Winding.
  return windingNumber(px, py, polygon) !== 0;
}
