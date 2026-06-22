// =============================================================================
// GolHex OffscreenCanvas-Render-Worker (AP-1, Stufe 1).
// Laeuft die Simulation (step) UND den Raster-Render OFF-MAIN-THREAD auf einer
// per transferControlToOffscreen uebergebenen OffscreenCanvas. Der Haupt-Thread
// behaelt nur UI/Eingabe. Doppelpuffer: Zeichnen in den 2D-Kontext der
// OffscreenCanvas wird beim Yield automatisch committed (HTML-Spec: der
// "transferControlToOffscreen"-Kanal ist der Doppelpuffer); zusaetzlich kann auf
// Anforderung ein ImageBitmap (transferToImageBitmap) zurueckgereicht werden.
//
// Geteilte Logik mit dem Haupt-Thread (KEIN Fork):
//   - Sim-Kernels + Nachbar-Builder + Solver  : src/lib/sim-engine.js
//   - Raster-Fast-Path (Pixel)                : src/lib/raster-render.js
// Damit ist die Engine-Arithmetik im Worker bit-identisch zum Main-Thread-Pfad.
//
// SCOPE: der Worker zeichnet BEIDE Pfade und waehlt sie pro Render mit DERSELBEN
// reinen Logik wie der Main-Thread (usesRasterPath, src/lib/ui-gestures.js):
//   - sub-aufloesende Zellen (pxR < 2.0, grosse Gitter) -> renderRaster (Quadrate,
//     korrekt weil <2px keine Hexform zeigt; Freeze-Schutz fuer 250k);
//   - aufloesbare Zellen (pxR >= 2.0, ODER hr>5) -> renderHex (Path2D-Hexagone mit
//     Viewport-Culling, src/lib/hex-render.js) -- gespiegelt von App.tsx draw().
// WURZEL des wiederkehrenden "5XL rendert Quadrate"-Bugs (Marco, 4. Wiederholung
// 2026-06-11): bisher kannte der Worker NUR renderRaster -> hineingezoomt blieben
// 250k-Zellen Quadrate. Jetzt schaltet er bei pxR>=2 auf echte Hexagone um.
// Gesten + inkrementelles Neuzeichnen bleiben Main-Thread (Fallback-Pfad). Der
// Worker ist feature-detektiert + optional; faellt er weg, laeuft der Main-Pfad voll.
// =============================================================================
import {
  buildNeighbors, mkHqstWork, stepHQST, stepReiter, stepWater, stepCollatz, stepGenes,
  RMETA, INT_META, WATZ_META, hexClass2, COSH, SINH, COMPLEMENT,
  birthColorQuad, cMixVec, mMixCnt, driftHue, hash2, PRIMARY,
} from "../lib/sim-engine.js";
import { renderRaster } from "../lib/raster-render.js";
import { renderHex } from "../lib/hex-render.js";
import { usesRasterPath } from "../lib/ui-gestures.js";

// --- Worker-State ------------------------------------------------------------
let canvas = null;        // OffscreenCanvas
let ctx = null;           // 2D-Kontext (alpha:false, konsistent mit Main)
let running = false;
let timer = null;

// Geometrie / Felder
let R = 0, C = 0, N = 0, hr = 1;
let neigh = null;         // { torus, edge, mask, bnd }
let cfg = null;           // {ruleIdx, torusOn, ax, a5, watzOnly, ruleSrc, solverId, sysT, sysSp, bcMode, openSys}
let mode = "life";        // "life" | "rval"
let rule = "snow";        // rval-Regel

// Zustands-Arrays (vom Main-Thread per Transfer uebernommen, Worker-eigen).
let col, gh, age, nCol, nGh, nAge;        // life
let fld, fim, fBuf, fBufIm, fRec;         // rval
let hqstWork;
let CX, CY;                                // Welt-Zentren je Zelle (Render)

// View / Canvas-Pixelmasse
let view = { s: 1, tx: 0, ty: 0 };
let dpr = 1;
let Wc = 0, Hc = 0;

let tick = 0, stepsSinceReport = 0, t0 = 0;
let cvd = false;           // F10: CVD-safe Encoding (opt-in; vom Main via init/config)
let speedMs = 16;          // iv (0 = TURBO)
let solverWarn = false, diverged = false;
let lastRenderMode = null; // "raster" | "hex" -- nur bei Wechsel an den Main melden
// Capture-Mirror (Snapshot/Recorder, worker-mode): nach transferControlToOffscreen
// ist das Main-Thread-Placeholder-<canvas> NICHT lesbar (getContext wirft, toBlob/
// captureStream liefern ein LEERES Bild -- empirisch 0,0,0,0). Das vom Worker
// gezeichnete (Hexagon-)Bild lebt allein in DIESER OffscreenCanvas. Deshalb reicht
// der Worker das aktuelle Bild als ImageBitmap an den Main zurueck, der es auf eine
// lesbare Spiegel-Canvas zeichnet -> Capture == Live-Render (gleiche Geometrie).
let mirrorStream = false;  // true = nach jedem Render einen Frame zurueckschicken (Recording)
// Snapshot-„Beauty-Shot": ein Foto wird IMMER als echte Hexagone gerendert -- auch
// wenn die Live-Anzeige aus Performancegruenden den Raster-Fast-Path (Quadrate bei
// sub-2px-Zellen, Freeze-Schutz fuer 250k) nutzt. Marco-Befund 2026-06-17: „nach dem
// Snapshot sind es Quadrate statt Hexagons". WURZEL: der bisherige captureFrame rief
// renderToCanvas(), das bei pxR<2 den Raster-Pfad waehlt -> das Foto erbte die
// Quadrate. Ein Foto ist aber ein bewusster Einmal-Render, fuer den das Freeze-Budget
// NICHT gilt. Deshalb zeichnen wir den Snapshot in eine SEPARATE Scratch-Canvas mit
// erzwungenem renderHex (Path2D-Hexagone), ohne die Live-OffscreenCanvas zu beruehren
// (kein Flackern). Recording (mirror) bleibt Live-treu (per-Frame-Forcing waere bei
// 250k zu teuer). Plattform-unabhaengig (greift in Chromium UND iOS/WebKit).
let capCanvas = null, capCtx = null;

// --- Sim-Schritt (Spiegel von App.tsx step(), gleiche Engine-Aufrufe) --------
function stepLife() {
  const { ruleIdx: ri, torusOn: to, ax: A, a5: A5, watzOnly: wO, ruleSrc: rs, sysT, sysSp, bcMode: bc } = cfg;
  const meta = wO ? WATZ_META : (rs === "int" ? INT_META[ri] : RMETA[ri]);
  const { bL, sL, smin, smax } = meta;
  const isINT = !!meta.isINT, b2 = meta.b2 || null, s2 = meta.s2 || null;
  const NL = to ? neigh.torus : neigh.edge;
  const dmask = neigh.mask;
  const t = tick + 1, n = col.length;
  const spN = sysT ? Math.round(sysSp * 6) : 0;
  for (let i = 0; i < n; i++) {
    if (dmask[i] === 0) { nCol[i] = 0; nGh[i] = 0; nAge[i] = 0; continue; }
    const base = i * 6;
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let live = 0, sx = 0, sy = 0, mask = 0;
    const self = col[i], selfAlive = self !== 0;
    const adia = bc === "adiabatic";
    for (let k = 0; k < 6; k++) {
      const j = NL[base + k];
      if (j < 0) {
        if (adia) {
          if (selfAlive) { cnt[self]++; live++; sx += COSH[self]; sy += SINH[self]; mask |= (1 << k); }
          else if (A.a4 && gh[i]) live++;
        }
        continue;
      }
      const cj = col[j];
      if (cj !== 0) { cnt[cj]++; live++; sx += COSH[cj]; sy += SINH[cj]; mask |= (1 << k); }
      else if (A.a4 && gh[j]) live++;
    }
    const cntSelf = selfAlive ? cnt[self] : 0;
    let maxN = 0; for (let c = 1; c <= 12; c++) if (cnt[c] > maxN) maxN = cnt[c];
    let eff = live;
    if (A5 === "sym") eff = selfAlive ? cntSelf : maxN;
    else if (A5 === "komp") eff = selfAlive ? live - cntSelf : live - maxN;
    let born = false, newC = 0;
    if (selfAlive) {
      let surv = eff <= 6 && sL[eff] === 1;
      if (surv && isINT && eff === 2 && s2 && !s2.includes(hexClass2(mask))) surv = false;
      if (!surv && A.a3 && age[i] >= 6 && eff >= smin - 1 && eff <= smax + 1) surv = true;
      if (sysT) { if (!surv && live > 0 && live < spN) surv = true; else if (surv && live > spN + 1) surv = false; }
      if (surv) { born = true; newC = (A.colorMode === "drift" && live > 0) ? driftHue(self, sx, sy) : self; }
    } else if (live > 0 && eff >= 0 && eff <= 6 && bL[eff] === 1) {
      let ok = true;
      if (isINT && eff === 2 && b2 && !b2.includes(hexClass2(mask))) ok = false;
      if (sysT && live > spN) ok = false;
      if (ok) {
        born = true;
        if (A.colorMode === "quad") newC = birthColorQuad(cnt, sx, sy);
        else if (A.a2) newC = mMixCnt(cnt, i);
        else newC = cMixVec(sx, sy, i);
      }
    }
    if (born) { nCol[i] = newC; nGh[i] = 0; nAge[i] = selfAlive ? (age[i] < 65535 ? age[i] + 1 : 65535) : 1; }
    else { nAge[i] = 0; if (selfAlive && A.a4) { nCol[i] = 0; nGh[i] = 1; } else { nCol[i] = 0; nGh[i] = 0; } }
  }
  if (A.a1) {
    for (let i = 0; i < n; i++) {
      if (nCol[i] !== 0 || nGh[i] !== 0 || col[i] !== 0) continue;
      const base = i * 6; let silent = true;
      for (let k = 0; k < 6; k++) { const j = NL[base + k]; if (j < 0) continue; if (col[j] !== 0 || (A.a4 && gh[j])) { silent = false; break; } }
      if (silent && hash2(i, t) < 0.012) { nCol[i] = PRIMARY[Math.floor(hash2(i + 7, t * 3 + 1) * 3)]; nAge[i] = 1; }
    }
  }
  // Doppelpuffer-Tausch (wie App.tsx step()).
  let tmp;
  tmp = col; col = nCol; nCol = tmp;
  tmp = gh; gh = nGh; nGh = tmp;
  tmp = age; age = nAge; nAge = tmp;
  tick = t;
}

function stepRval() {
  const to = cfg.torusOn;
  const NL = to ? neigh.torus : neigh.edge;
  const dmask = neigh.mask;
  const n = fld.length, C2 = C;
  if (rule === "hqst") {
    const conv = stepHQST(fld, fim, NL, 0.15, 0.0, 0.5, fBuf, fBufIm, hqstWork, cfg.solverId);
    if (conv === false && !solverWarn) solverWarn = true;
    let tmp;
    tmp = fld; fld = fBuf; fBuf = tmp;
    tmp = fim; fim = fBufIm; fBufIm = tmp;
    let maxA = 0, bad = false;
    for (let i = 0; i < n; i++) { const a = Math.abs(fld[i]) + Math.abs(fim[i]); if (a > maxA) maxA = a; if (!Number.isFinite(a)) { bad = true; break; } }
    if (bad || maxA > 1e4) { fld.fill(0); fim.fill(0); diverged = true; running = false; }
  } else if (rule === "water") {
    const out = stepWater(fld, NL, C2, fBuf); fBuf = fld; fld = out;
  } else if (rule === "collatz") {
    const out = stepCollatz(fld, NL, fBuf); fBuf = fld; fld = out;
  } else if (rule === "genes") {
    const out = stepGenes(fld, NL, fBuf, tick + 1); fBuf = fld; fld = out;
  } else {
    const out = stepReiter(fld, NL, 1.0, 0.01, fBuf, fRec); fBuf = fld; fld = out;
  }
  for (let i = 0; i < n; i++) if (dmask[i] === 0) { fld[i] = 0; fim[i] = 0; }
  if (cfg.openSys && (rule === "snow" || rule === "water")) {
    const bnd = neigh.bnd, src = rule === "snow" ? 0.6 : 1.0;
    for (let i = 0; i < n; i++) if (bnd[i]) fld[i] = src;
  }
  tick += 1;
}

function doStep() { if (mode === "rval") stepRval(); else stepLife(); stepsSinceReport++; }

// --- Render (Pfad-Wahl raster vs. hex -- DIESELBE Logik wie der Main-Thread) --
// Meldet einen Wechsel des Render-Modus an den Main-Thread, der ihn auf
// canvas[data-render-mode] spiegelt (observable e2e-Marker, KEIN window-Hook ->
// AGENTS.md §2). Damit kann der Hex-Gate-Test beweisen, dass 5XL hineingezoomt
// HEXAGONE rendert (mode==="hex"), nicht Quadrate.
function reportRenderMode(m) {
  if (m === lastRenderMode) return;
  lastRenderMode = m;
  postMessage({ type: "renderMode", mode: m });
}

// Schickt das AKTUELLE OffscreenCanvas-Bild als ImageBitmap an den Main-Thread.
// createImageBitmap(canvas) ist nicht-destruktiv (anders als transferToImageBitmap,
// das die Canvas leeren wuerde) -> die laufende Live-Anzeige bleibt unberuehrt.
// kind="snapshot" (einmalig, Foto) | "mirror" (laufend, Recording-Stream).
function emitFrame(kind) {
  if (!canvas) return;
  Promise.resolve()
    .then(() => createImageBitmap(canvas))
    .then((bmp) => { postMessage({ type: "frame", kind, bitmap: bmp }, [bmp]); })
    .catch((err) => { postMessage({ type: "frameError", kind, message: err && err.message ? err.message : String(err) }); });
}

// Rendert den erzwungenen Hexagon-Pfad (renderHex, OHNE usesRasterPath-Weiche) in die
// Scratch-Canvas capCanvas und liefert sie zurueck. Wirft, wenn kein OffscreenCanvas/
// 2D-Kontext verfuegbar ist. Beruehrt die Live-OffscreenCanvas NICHT.
function renderCaptureHex() {
  if (typeof OffscreenCanvas === "undefined") throw new Error("no OffscreenCanvas");
  const w = canvas.width, h = canvas.height;
  if (!capCanvas) { capCanvas = new OffscreenCanvas(w, h); capCtx = capCanvas.getContext("2d", { alpha: false }); }
  if (capCanvas.width !== w || capCanvas.height !== h) { capCanvas.width = w; capCanvas.height = h; }
  if (!capCtx) throw new Error("no capture 2d ctx");
  // DIESELBEN Geometrie-/Farbparameter wie der Live-Hex-Pfad (renderToCanvas hex-Zweig).
  renderHex(capCtx, {
    Wc: w, Hc: h, hr, s: view.s, tx: view.tx, ty: view.ty, dpr, CX, CY,
    mode, rule, col, gh, fld, fim,
  });
  return capCanvas;
}

// Snapshot-Frame: erzwingt den Hexagon-Pfad in eine Scratch-Canvas (siehe capCanvas-
// Kommentar oben), unabhaengig davon, ob die Live-Anzeige gerade Raster (Quadrate)
// zeigt. Die Live-OffscreenCanvas bleibt unberuehrt.
//
// READBACK-HAERTUNG (SOTA, 2026-06-17): PRIMAER ueber OffscreenCanvas.convertToBlob()
// -> der Worker encodiert das PNG SELBST und liefert einen Blob. Das umgeht
// createImageBitmap(OffscreenCanvas) + ImageBitmap-Transfer, die Klasse mit
// dokumentierten iOS/WebKit-Defekten (WebKit #229825 createImageBitmap-Leak;
// OffscreenCanvas auf iOS historisch inkomplett). convertToBlob ist seit Safari 16.4
// (03/2023) breit verfuegbar. Der Main-Thread dekodiert den Blob via
// createImageBitmap(Blob) -- das ist der verlaessliche Bild-Dekodier-Pfad, NICHT der
// fragile OffscreenCanvas-Snapshot-Pfad. FALLBACK (aelteres Safari < 16.4 ohne
// convertToBlob): createImageBitmap(capCanvas) wie bisher. LETZTER Fallback: Live-Bild.
function emitSnapshotHexFrame() {
  if (!canvas) return;
  Promise.resolve()
    .then(() => {
      const cap = renderCaptureHex();
      // PRIMAER: worker-direkter PNG-Blob (iOS-robust).
      if (typeof cap.convertToBlob === "function") {
        return cap.convertToBlob({ type: "image/png" })
          .then((blob) => { postMessage({ type: "snapshotBlob", blob }); });
      }
      // FALLBACK: ImageBitmap (Chromium/aeltere Pfade).
      return createImageBitmap(cap).then((bmp) => { postMessage({ type: "frame", kind: "snapshot", bitmap: bmp }, [bmp]); });
    })
    .catch(() => {
      // Robuster Fallback: bisheriges Live-Bild (kann Raster sein, aber besser als kein Foto).
      try { renderToCanvas(); emitFrame("snapshot"); }
      catch (err) { postMessage({ type: "frameError", kind: "snapshot", message: err && err.message ? err.message : String(err) }); }
    });
}

function renderToCanvas() {
  if (!ctx || !canvas) return;
  if (Wc !== canvas.width || Hc !== canvas.height) { Wc = canvas.width; Hc = canvas.height; }
  const pxR = hr * view.s;
  // EINE Quelle der Wahrheit fuer die Pfad-Wahl (src/lib/ui-gestures.js): bei
  // sub-aufloesenden Zellen grosser Gitter (pxR<2, hr<=5) -> Raster (Quadrate ok);
  // sonst -> echte Hexagone. Identisch zu App.tsx draw() (Main-Thread).
  if (usesRasterPath(pxR, hr)) {
    // ImageData wiederverwenden; OffscreenCanvas-2D unterstuetzt createImageData/
    // putImageData identisch zum Main-Thread. putImageData ignoriert die Transform
    // -> wir muessen sie hier NICHT zuruecksetzen (der Hex-Pfad setzt sie selbst).
    if (!renderToCanvas._img || renderToCanvas._img.width !== Wc || renderToCanvas._img.height !== Hc) {
      renderToCanvas._img = ctx.createImageData(Wc, Hc);
    }
    const img = renderToCanvas._img, d32 = new Uint32Array(img.data.buffer);
    renderRaster(d32, {
      Wc, Hc, hr, s: view.s, tx: view.tx, ty: view.ty, dpr, CX, CY,
      mode, rule, col, fld, fim,
    });
    ctx.putImageData(img, 0, 0);
    reportRenderMode("raster");
    if (mirrorStream) emitFrame("mirror");
    return;
  }
  // Path2D-Hexagon-Pfad mit Viewport-Culling (src/lib/hex-render.js). Spiegelt
  // App.tsx draw() (gleiche Ecken/Radien/Farben/Reihenfolge). Beim Hineinzoomen
  // auf 250k liegt nur ein Bruchteil im Viewport -> die teure Pfad-Arbeit bleibt
  // beschraenkt (Freeze-Schutz, gegen den der Raster-Pfad gebaut war, haelt).
  renderHex(ctx, {
    Wc, Hc, hr, s: view.s, tx: view.tx, ty: view.ty, dpr, CX, CY,
    mode, rule, col, gh, age, fld, fim, cvd,
  });
  reportRenderMode("hex");
  if (mirrorStream) emitFrame("mirror");
  // Hinweis: der v31-Rahmen-Umriss (drawFrame) wird im Worker NICHT gezeichnet
  // (er gehoert zum Main-Thread-Detailpfad). Die Rahmen-Linie liefert der
  // Main-Thread-Pfad bei aktivem Worker nicht -- bewusst eng gehalten (das Feld
  // selbst ist im Worker-Modus die observable Wahrheit; Rahmen ist dekorativ).
}

// --- Loop (Worker-eigen, spiegelt das Step-Budget aus App.tsx) ---------------
function frame() {
  if (running) {
    const STEP_BUDGET_MS = 12, STEP_HARDCAP = 4000, tStart = performanceNow();
    let guard = 0;
    // iv-getriebene Schrittzahl: iv=0 (TURBO) -> nur Budget begrenzt.
    do {
      doStep(); guard++;
      if (performanceNow() - tStart >= STEP_BUDGET_MS) break;
    } while (guard < STEP_HARDCAP && speedMs === 0);
    renderToCanvas();
    const now = performanceNow(), dt = (now - t0) / 1000;
    if (dt >= 0.25) {
      const sps = stepsSinceReport / dt; stepsSinceReport = 0; t0 = now;
      postMessage({ type: "telemetry", tick, sps, solverWarn, diverged });
      if (diverged) { running = false; diverged = false; }
    }
  }
  if (running) timer = setTimeout(frame, speedMs > 0 ? Math.min(speedMs, 16) : 0);
}

function performanceNow() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

function startLoop() { if (!timer && running) { t0 = performanceNow(); timer = setTimeout(frame, 0); } }
function stopLoop() { if (timer) { clearTimeout(timer); timer = null; } }

// v33 PR-E: buildNeighbors-opts aus der init/config-Nachricht ableiten. Spiegelt
// App.tsx (frameOpts) -> EINE Logik fuer Kreis-Radius / Ellipse-Achsen / Freiform-
// Polygon, damit Worker-Maske == Main-Thread-Maske.
function frameOpts(m) {
  if (m.shape === "circle") {
    return Number.isFinite(m.circleRadius) ? { circleRadius: m.circleRadius } : undefined;
  }
  if (m.shape === "ellipse") {
    const o = {};
    if (Number.isFinite(m.ellipseA)) o.ellipseA = m.ellipseA;
    if (Number.isFinite(m.ellipseB)) o.ellipseB = m.ellipseB;
    return o;
  }
  if (m.shape === "freeform") {
    return Array.isArray(m.polygon) && m.polygon.length >= 3 ? { polygon: m.polygon } : undefined;
  }
  return undefined;
}

// v33 P2-C: Geometrie-Einrichtung des Workers EINMAL faktorisiert (init UND regeom
// teilen sie). Baut neigh aus shape+frameOpts, (re-)alloziert ALLE N-abhaengigen
// Arrays auf das neue N (col/gh/age + Doppelpuffer + rval-Felder + hqstWork),
// uebernimmt die vom Main gelieferten CX/CY (oder frisch), setzt die Canvas-
// Pixelmasse (dpr) sowie die View, nullt tick und rendert. KEINE Sim-Loop laeuft
// danach (running wird vom Aufrufer auf false gesetzt -> konsistent mit dem Main-
// Grid-Rebuild, der setRunning(false) macht). N-Mismatch-sicher: ALLE Arrays werden
// auf das NEUE N neu allokiert, daher kein out-of-bounds gegen alte Laengen.
function applyGeometry(m) {
  R = m.R; C = m.C; N = R * C; hr = m.hr; dpr = m.dpr || 1;
  neigh = buildNeighbors(R, C, m.shape, frameOpts(m));
  // Zustands-Arrays: vom Main per Transfer uebernehmen, sonst frisch (= Reset).
  col = m.col ? new Uint8Array(m.col) : new Uint8Array(N);
  gh = m.gh ? new Uint8Array(m.gh) : new Uint8Array(N);
  age = m.age ? new Uint16Array(m.age) : new Uint16Array(N);
  nCol = new Uint8Array(N); nGh = new Uint8Array(N); nAge = new Uint16Array(N);
  fld = m.fld ? new Float32Array(m.fld) : new Float32Array(N);
  fim = m.fim ? new Float32Array(m.fim) : new Float32Array(N);
  fBuf = new Float32Array(N); fBufIm = new Float32Array(N); fRec = new Uint8Array(N);
  hqstWork = mkHqstWork(N);
  CX = m.CX ? new Float32Array(m.CX) : new Float32Array(N);
  CY = m.CY ? new Float32Array(m.CY) : new Float32Array(N);
  // Canvas-Pixelmasse: bei regeom liefert der Main width/height (Grid-Wechsel kann
  // die fit-View und damit die noetige Aufloesung aendern). Beim init kommt die
  // Groesse bereits vom transferierten Element -> dann nur setzen, wenn geliefert.
  if (canvas && Number.isFinite(m.width) && Number.isFinite(m.height)) {
    canvas.width = m.width; canvas.height = m.height;
  }
  // Resize eines 2D-Kontexts loescht den ImageData-Cache-Bedarf -> neu anlegen.
  renderToCanvas._img = null;
  // Geometrie-Wechsel (Grid/hr) kann die Pfad-Wahl kippen -> Marker neu melden lassen.
  lastRenderMode = null;
  view = m.view || view;
  tick = Number.isFinite(m.tick) ? m.tick : 0;
}

// --- Nachrichten-Bruecke -----------------------------------------------------
self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case "init": {
      canvas = m.canvas;
      try { ctx = canvas.getContext("2d", { alpha: false }); }
      catch (err) { postMessage({ type: "error", message: "getContext failed: " + err.message }); return; }
      cfg = m.cfg; mode = m.mode; rule = m.rule; speedMs = m.speedMs ?? 16;
      if (typeof m.cvd === "boolean") cvd = m.cvd;
      applyGeometry(m);
      renderToCanvas();
      postMessage({ type: "ready" });
      break;
    }
    case "regeom": {
      // v33 P2-C: In-Place-Geometrie-Update des LAUFENDEN Workers (kein Respawn -
      // transferControlToOffscreen ist je Element irreversibel). Wird vom Main NUR
      // bei bereits AKTIVEM Worker gesendet, nachdem dort das Grid neu gebaut +
      // fitView gelaufen ist (frische view). Stoppt die Sim (neues Grid = Reset,
      // konsistent mit dem Main-Grid-Rebuild, der setRunning(false) macht).
      if (!canvas || !ctx) break;            // ohne Kontext nichts zu tun
      running = false; stopLoop();
      applyGeometry(m);
      renderToCanvas();
      break;
    }
    case "view": view = m.view; if (!running) renderToCanvas(); break;
    case "resize": if (canvas) { canvas.width = m.width; canvas.height = m.height; dpr = m.dpr || dpr; if (!running) renderToCanvas(); } break;
    case "config": if (m.cfg) cfg = m.cfg; if (m.mode) mode = m.mode; if (m.rule) rule = m.rule; if (typeof m.speedMs === "number") speedMs = m.speedMs; if (typeof m.cvd === "boolean") cvd = m.cvd; if (!running) renderToCanvas(); break;
    case "state": // vollstaendiger Zustands-Push (z.B. nach Paint/Reset/Undo im Main-Thread)
      if (m.col) col = new Uint8Array(m.col);
      if (m.gh) gh = new Uint8Array(m.gh);
      if (m.age) age = new Uint16Array(m.age);
      if (m.fld) fld = new Float32Array(m.fld);
      if (m.fim) fim = new Float32Array(m.fim);
      if (m.CX) CX = new Float32Array(m.CX);
      if (m.CY) CY = new Float32Array(m.CY);
      if (typeof m.tick === "number") tick = m.tick;
      if (!running) renderToCanvas();
      break;
    case "run": running = !!m.running; if (running) startLoop(); else { stopLoop(); renderToCanvas(); } break;
    case "redraw": renderToCanvas(); break;
    case "captureFrame": {
      // Einmal-Foto (Snapshot): IMMER als echte Hexagone in eine Scratch-Canvas
      // rendern (emitSnapshotHexFrame), unabhaengig vom Live-Raster-Fast-Path.
      // Die Live-OffscreenCanvas bleibt unberuehrt (kein renderToCanvas auf ihr).
      emitSnapshotHexFrame();
      break;
    }
    case "mirror": {
      // Recording-Stream an/aus: bei "an" sofort einen Startframe liefern, danach
      // schickt renderToCanvas() laufend Frames (Live == aufgenommenes Bild).
      mirrorStream = !!m.on;
      if (mirrorStream) { renderToCanvas(); emitFrame("mirror"); }
      break;
    }
    case "snapshot": {
      // Forschungs-Haken: aktuellen Zustand zur Main-Thread-Seite zuruecksenden
      // (Snapshot/Recorder/Undo bleiben Main-Thread-Verantwortung -> Readback ok).
      postMessage({
        type: "snapshot",
        tick,
        col: col.slice().buffer, gh: gh.slice().buffer, age: age.slice().buffer,
        fld: fld.slice().buffer, fim: fim.slice().buffer,
      });
      break;
    }
    case "dispose": stopLoop(); break;
    default: break;
  }
};
