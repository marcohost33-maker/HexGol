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

  // ===========================================================================
  // MARCO 5XL-QUADRATE-BUG (dauerhafte Loesung, 4. Wiederholung 2026-06-11):
  // Der Worker MUSS denselben Pfad-Wahl-Schalter wie der Main-Thread haben
  // (usesRasterPath, src/lib/ui-gestures.js). Beleg ueber den observable
  // renderMode-postMessage-Marker (KEIN window-Hook -> AGENTS.md §2):
  //   - 5XL (hr=1.3) HERAUSGEZOOMT (pxR<2) -> "raster" (Quadrate ok, Freeze-Schutz);
  //   - 5XL HINEINGEZOOMT (pxR>=2) -> "hex" (echte Hexagone).
  // FALSIFIKATION: vor dem Fix kannte der Worker nur renderRaster -> er haette bei
  // JEDER Zoomstufe "raster"/Quadrate geliefert. Der zoomed-in "hex"-Marker ist
  // genau der Beweis, dass der Hex-Pfad jetzt im Worker greift.
  // ===========================================================================
  it("5XL herausgezoomt meldet renderMode 'raster' (Quadrate, Freeze-Schutz)", () => {
    // 5XL: hr=1.3, default view s=1 -> pxR = 1.3 < 2.0 -> Raster bereits beim init.
    send(initMsg({ R: 500, C: 500, hr: 1.3, width: 360, height: 700 }));
    const rmInit = posted.filter((m) => m.type === "renderMode").pop();
    expect(rmInit, "init postet einen renderMode-Marker").toBeTruthy();
    expect(rmInit.mode, "herausgezoomt -> Raster (Quadrate)").toBe("raster");
  });

  it("5XL HINEINGEZOOMT meldet renderMode 'hex' (echte Hexagone, kein Quadrat)", () => {
    send(initMsg({ R: 500, C: 500, hr: 1.3, width: 360, height: 700 }));
    posted.length = 0;
    // pxR = hr * s = 1.3 * 2.0 = 2.6 >= RASTER_PX_THRESHOLD(2.0) -> Hexagone.
    send({ type: "view", view: { s: 2.0, tx: 0, ty: 0 } });
    const rm = posted.filter((m) => m.type === "renderMode").pop();
    expect(rm, "renderMode-Marker gepostet").toBeTruthy();
    expect(rm.mode, "5XL hineingezoomt MUSS Hexagone (hex), NICHT Quadrate (raster)").toBe("hex");
  });

  it("renderMode wird NUR bei Wechsel gemeldet (kein Spam pro Frame)", () => {
    send(initMsg({ R: 500, C: 500, hr: 1.3, width: 360, height: 700 }));
    // zweimal derselbe hineingezoomte View -> hoechstens EIN 'hex'-Marker dazu.
    send({ type: "view", view: { s: 2.0, tx: 0, ty: 0 } });
    posted.length = 0;
    send({ type: "view", view: { s: 2.0, tx: 0, ty: 0 } }); // identisch -> kein neuer Marker
    send({ type: "redraw" });
    expect(posted.filter((m) => m.type === "renderMode").length, "kein redundanter Marker bei gleichem Modus").toBe(0);
  });
});
