// AP-2 Instanziierungs-Beleg (headless, Node). Beweist die Stop-Condition:
//   - 500x500 (box) baut + evolviert + Zellzahl stimmt
//   - Kreis r=500 baut + evolviert + Zellzahl tool-gezaehlt
//   - Speicher (RSS-Delta + theoretische Bytes/Zelle) ausgewiesen
//   - HQST-Cap und Zell-Caps geprueft
// Augenmass (8-GB-PC): 1x bauen + wenige Steps, Median loggen, KEIN Dauerlauf.
//
// Lauf:  node tests/manual/ap2-instantiation.mjs
import {
  buildNeighbors, circleGridDims, worldSize,
  CELL_CAP, CIRCLE_CELL_CAP, MAX_CIRCLE_RADIUS, HQST_CELL_CAP,
  stepWater, mkHqstWork, stepHQST,
} from "../../src/lib/sim-engine.js";

const MB = (b) => (b / 1048576).toFixed(1);
function rss() { return process.memoryUsage().rss; }

// Minimaler boolescher Hex-Life-Step (B2/S34) direkt auf der Nachbar-Tabelle.
// Genau die Arithmetik aus App.tsx step() in Kurzform — reicht als Instanz-Beleg.
function stepBoolLife(alive, NL, mask, buf) {
  const n = alive.length;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) { buf[i] = 0; continue; }
    const b = i * 6; let cnt = 0;
    for (let k = 0; k < 6; k++) { const j = NL[b + k]; if (j >= 0 && alive[j]) cnt++; }
    buf[i] = alive[i] ? (cnt === 3 || cnt === 4 ? 1 : 0) : (cnt === 2 ? 1 : 0);
  }
  return buf;
}

function median(a) { const s = a.slice().sort((x, y) => x - y); return s[(s.length / 2) | 0]; }

function seedRandom(arr, mask, p, seedVal) {
  let a = seedVal | 0;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let live = 0;
  for (let i = 0; i < arr.length; i++) { if (mask[i] && next() < p) { arr[i] = 1; live++; } }
  return live;
}

function benchBoolGrid(label, R, C, opts, steps) {
  const r0 = rss();
  const N = R * C;
  const t0 = Date.now();
  const neigh = buildNeighbors(R, C, opts.shape, opts);
  const tBuild = Date.now() - t0;
  const inCount = neigh.inCount;
  let alive = new Uint8Array(N);
  let buf = new Uint8Array(N);
  const live0 = seedRandom(alive, neigh.mask, 0.2, 4242);
  const dts = [];
  for (let s = 0; s < steps; s++) {
    const ts = process.hrtime.bigint();
    stepBoolLife(alive, neigh.torus, neigh.mask, buf);
    const te = process.hrtime.bigint();
    dts.push(Number(te - ts) / 1e6); // ms
    [alive, buf] = [buf, alive];
  }
  let liveEnd = 0; for (let i = 0; i < N; i++) liveEnd += alive[i];
  const r1 = rss();
  const medMs = median(dts);
  // Bytes/Zelle (Bool-CA aktive Felder im Hauptpfad):
  // color+ghost+age(2)+nColor+nGhost+nAge(2)+prevColor+prevGhost = 1+1+2+1+1+2+1+1 = 10 B
  // + Nachbar-Tabellen torus(6*4)+edge(6*4)=48 B + mask/bnd 2 B = 60 B/Zelle theor.
  const theorBytesPerCell = 60;
  console.log(`[${label}] R=${R} C=${C} N=${N}`);
  console.log(`  build=${tBuild}ms  inCount(Zellen in Domaene)=${inCount}  Maske-Anteil=${(inCount / N * 100).toFixed(1)}%`);
  console.log(`  seed live0=${live0}  -> nach ${steps} Steps liveEnd=${liveEnd}  (Evolution lief: ${liveEnd !== live0 ? "JA" : "?"})`);
  console.log(`  Step-Zeit Median=${medMs.toFixed(2)}ms  min=${Math.min(...dts).toFixed(2)}  max=${Math.max(...dts).toFixed(2)} ms/Step`);
  console.log(`  RSS-Delta dieser Block=${MB(r1 - r0)} MB  | theor. ~${theorBytesPerCell} B/Zelle -> ${MB(theorBytesPerCell * N)} MB`);
  return { N, inCount, medMs, rssDelta: r1 - r0 };
}

console.log("=== AP-2 Instanziierungs-Beleg (headless) ===");
console.log(`Node ${process.version}  Start-RSS=${MB(rss())} MB`);
console.log(`Caps: CELL_CAP=${CELL_CAP}  CIRCLE_CELL_CAP=${CIRCLE_CELL_CAP}  MAX_CIRCLE_RADIUS=${MAX_CIRCLE_RADIUS}  HQST_CELL_CAP=${HQST_CELL_CAP}`);
console.log("");

// (1) 500x500 Quadrat = 250'000 Zellen
const box = benchBoolGrid("BOX 500x500", 500, 500, { shape: "box" }, 20);
console.log(`  ASSERT N==250000: ${box.N === 250000 ? "PASS" : "FAIL"}`);
console.log(`  ASSERT N<=CELL_CAP: ${box.N <= CELL_CAP ? "PASS" : "FAIL"}`);
console.log("");

// (2) Kreis r=500
const cd = circleGridDims(500);
console.log(`circleGridDims(500) -> rows=${cd.rows} cols=${cd.cols} hr=${cd.hr} radius=${cd.radius}  BoundingN=${cd.rows * cd.cols}`);
const circle = benchBoolGrid("CIRCLE r=500", cd.rows, cd.cols, { shape: "circle", circleRadius: cd.radius }, 20);
console.log(`  ASSERT inCount>0 (Kreis nicht leer): ${circle.inCount > 0 ? "PASS" : "FAIL"}`);
console.log(`  ASSERT BoundingN<=CIRCLE_CELL_CAP: ${circle.N <= CIRCLE_CELL_CAP ? "PASS" : "FAIL"}`);
console.log("");

// (2b) Kreis r=250 (Default)
const cd250 = circleGridDims(250);
console.log(`circleGridDims(250) -> rows=${cd250.rows} cols=${cd250.cols} hr=${cd250.hr}  BoundingN=${cd250.rows * cd250.cols}`);
const c250 = benchBoolGrid("CIRCLE r=250", cd250.rows, cd250.cols, { shape: "circle", circleRadius: 250 }, 20);
console.log("");

// (3) Klemm-Verhalten: circleRadius > eingeschriebenes Max wird geklemmt (kein Ueberlauf)
{
  const R = 41, C = 41;
  const full = buildNeighbors(R, C, "circle", { circleRadius: 9999 }); // riesig -> klemmt
  const noOpt = buildNeighbors(R, C, "circle"); // eingeschriebenes Maximum
  console.log(`KLEMM-TEST 41x41: circleRadius=9999 inCount=${full.inCount} vs default inCount=${noOpt.inCount}`);
  console.log(`  ASSERT geklemmt (gleich Maximum): ${full.inCount === noOpt.inCount ? "PASS" : "FAIL"}`);
}
console.log("");

// (4) HQST am Cap-Grenzfall (kleines Grid) — beweist Solver laeuft + Cap-Logik plausibel
{
  const R = 60, C = 60, N = R * C;
  const neigh = buildNeighbors(R, C, "box");
  let re = new Float32Array(N), im = new Float32Array(N);
  re[((R / 2) | 0) * C + ((C / 2) | 0)] = 1;
  let reBuf = new Float32Array(N), imBuf = new Float32Array(N);
  const work = mkHqstWork(N);
  const nrm = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i] + b[i] * b[i]; return s; };
  const norm0 = nrm(re, im);
  // solveCN schreibt das Ergebnis in reBuf/imBuf -> nach jedem Step puffern tauschen.
  // Stabile Parameter: a*||H|| = (dt/2)*6J = 0.05*6 = 0.3 < 1 -> konvergent + unitaer.
  for (let s = 0; s < 5; s++) { stepHQST(re, im, neigh.edge, 1, 0, 0.1, reBuf, imBuf, work, "cn"); [re, reBuf] = [reBuf, re]; [im, imBuf] = [imBuf, im]; }
  const norm1 = nrm(re, im);
  console.log(`HQST 60x60 (5 Steps, CN): Norm ${norm0.toFixed(4)} -> ${norm1.toFixed(4)} (unitaer ~erhalten: ${Math.abs(norm1 - norm0) < 0.05 ? "PASS" : "drift"})`);
  console.log(`  HQST_CELL_CAP=${HQST_CELL_CAP}: 250000-Grid waere ueber Cap -> UI sperrt (Bool-CA bleibt erlaubt)`);
}
console.log("");
console.log(`End-RSS=${MB(rss())} MB`);
console.log("=== ENDE ===");
