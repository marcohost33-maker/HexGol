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
