// Nachrichten-Protokoll des OffscreenCanvas-Render-Workers (src/worker/render-worker.js).
// Der Worker war bisher nur via e2e abgedeckt; sein Message-Kontrakt (die Typen, die
// App.tsx sendet/erwartet) hatte KEINEN Unit-Test. Hier wird er ohne echten Worker
// getestet: self.onmessage wird beim Import registriert, postMessage abgefangen, und
// eine Fake-OffscreenCanvas (getContext -> Fake-2D-Kontext mit createImageData/
// putImageData) eingespeist. Geprueft: init->ready, getContext-Fehler->error (kein
// Wurf), snapshot-Rueckgabe, und dass alle uebrigen Nachrichtentypen nicht werfen.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const posted = [];
let dispatch; // self.onmessage

function fakeCtx() {
  return {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {}, setTransform() {}, fillRect() {},
    set fillStyle(_v) {}, get fillStyle() { return "#000"; },
  };
}
function fakeCanvas(w = 8, h = 8) {
  const c = { width: w, height: h };
  const ctx = fakeCtx();
  c.getContext = () => ctx;
  return c;
}
const baseCfg = { ruleIdx: 0, torusOn: false, ax: { colorMode: "quad" }, a5: "off", watzOnly: false, ruleSrc: "std" };
function initMsg(extra = {}) {
  return { type: "init", canvas: fakeCanvas(8, 8), cfg: baseCfg, mode: "life", rule: "snow", R: 6, C: 6, hr: 4, dpr: 1, shape: "box", ...extra };
}
const send = (msg) => dispatch({ data: msg });

beforeAll(async () => {
  // Globale VOR dem Import setzen: der Worker registriert self.onmessage am Modulkopf
  // und ruft das blanke postMessage(...) auf -> beide auf Capture umbiegen.
  globalThis.postMessage = (m) => posted.push(m);
  if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
  globalThis.self.postMessage = globalThis.postMessage;
  await import("../../src/worker/render-worker.js");
  dispatch = globalThis.self.onmessage;
  expect(typeof dispatch).toBe("function"); // Handler wurde registriert
});

beforeEach(() => { posted.length = 0; });

describe("render-worker — Nachrichten-Protokoll", () => {
  it("init: erstellt den 2D-Kontext und meldet 'ready' (kein 'error')", () => {
    send(initMsg());
    expect(posted.some((m) => m.type === "ready")).toBe(true);
    expect(posted.some((m) => m.type === "error")).toBe(false);
  });

  it("init mit fehlschlagendem getContext: meldet 'error' statt zu werfen", () => {
    const bad = fakeCanvas(8, 8);
    bad.getContext = () => { throw new Error("no ctx"); };
    expect(() => send(initMsg({ canvas: bad }))).not.toThrow();
    expect(posted.some((m) => m.type === "error")).toBe(true);
  });

  it("snapshot: sendet den Zustand zurueck (col/gh/age/fld/fim als ArrayBuffer + tick)", () => {
    send(initMsg());
    posted.length = 0;
    send({ type: "snapshot" });
    const snap = posted.find((m) => m.type === "snapshot");
    expect(snap).toBeTruthy();
    for (const k of ["col", "gh", "age", "fld", "fim"]) expect(snap[k]).toBeInstanceOf(ArrayBuffer);
    expect(typeof snap.tick).toBe("number");
  });

  it("view/resize/config/state/redraw/dispose/unbekannt: keine Ausnahme", () => {
    send(initMsg());
    expect(() => {
      send({ type: "view", view: { s: 1, tx: 0, ty: 0 } });
      send({ type: "resize", width: 10, height: 10, dpr: 1 });
      send({ type: "config", cfg: { ...baseCfg, ruleIdx: 1, torusOn: true }, mode: "rval", rule: "water", speedMs: 0 });
      send({ type: "state", col: new Uint8Array(36).buffer, tick: 5 });
      send({ type: "redraw" });
      send({ type: "dispose" });
      send({ type: "voellig-unbekannt" });
    }).not.toThrow();
  });

  it("regeom: In-Place-Geometrie-Update des laufenden Workers wirft nicht", () => {
    send(initMsg());
    expect(() => send({ type: "regeom", R: 8, C: 8, hr: 3, dpr: 1, shape: "circle", circleRadius: 3, width: 12, height: 12, view: { s: 1, tx: 0, ty: 0 } })).not.toThrow();
    // nach regeom liefert ein Snapshot die NEUE Groesse (8x8 = 64 Zellen).
    posted.length = 0;
    send({ type: "snapshot" });
    const snap = posted.find((m) => m.type === "snapshot");
    expect(snap.col.byteLength).toBe(64); // Uint8 64 Zellen
  });
});
