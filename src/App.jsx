// =============================================================================
// GolHex v17.14 - Hexagonal Game of Life (TELEMETRY + TEST BRIDGE, hardened)
// Coworker Research / Coworkerz - 2026-05-07
// Project: GHX (KAT GHX, L003)
// Lineage: v17.13 -> v17.14 (8 hardening items, audit-driven)
//
// CONTEXT: v17.13 introduced the telemetry pipeline and the window.__TEST__
// bridge. Konstruktiv-kritische Selbstpruefung against the rendered source
// surfaced eight real defects that v17.14 closes.
//
// FIXES v17.13 -> v17.14:
//   NR-G56 (P0): rowActive scratch buffer was allocated as a new Uint8Array
//        every step(). Under MAX speed on the XXL grid this is 4 allocs per
//        animation frame (the MAX_STEPS_PER_TICK inner loop), 240 GC-eligible
//        allocations per second. Now persisted in rowActiveRef and grown only
//        when the grid changes. Removes a measurable jank source on long runs.
//   NR-G57 (P0): paintAt first-touch behaved as tap-toggle regardless of
//        active tool. In TOOL_ERASE mode this meant single-tap on a dead cell
//        PAINTED it - the exact opposite of the user's intent. Fix: when the
//        active tool is ERASE, first-touch only acts on alive cells; when the
//        active tool is PAINT, first-touch only paints (no toggle-erase). PAN
//        mode keeps the original toggle semantics for tap-to-toggle UX.
//   NR-G58 (P1): stats display was stale after undo/restart/slot-load until
//        the next sim tick. recomputeStats() is now called from those paths.
//   NR-G59 (P1): selectTool always used the "touch" pxR threshold for auto-
//        zoom. Tracked lastPointerTypeRef and use it so mouse users do not
//        get an unnecessarily large auto-zoom.
//   NR-G60 (P1): cleanupGesture was declared after its first reference in
//        onPD/onPM. Functionally OK at call time (closure scope), but reads
//        as out-of-order. Reordered so all gesture helpers are declared
//        before any pointer handler.
//   NR-G61 (P1): Removed the inline "@import" font URL from the JSX <style>
//        tag. Fonts are now preconnected and stylesheet-linked from
//        index.html, which gives the browser the right loading priority and
//        avoids the long-deprecated CSSOM @import dependency chain.
//   NR-G62 (P1): __TEST__ bridge cleanup did not unset bridge.ready. Tests
//        spawning multiple instances saw a stale ready=true on the second
//        attach. Cleanup now sets bridge.ready=false before unmounting and
//        falls back to "= undefined" if "delete window.__TEST__" is denied.
//   NR-G63 (P1): __TEST__.step(n) ignored the running flag. Tests sending
//        step(1) while the rAF sim loop also ticked produced double steps.
//        Bridge now pauses the sim before stepping and restores prior state.
//   NR-G64 (P1): aria-busy added to the canvas wrapper during isPending.
//
// CARRIED FORWARD: alle NR-G3..G55, F01..F19, ASCII-clean, brace 0/0/0.
// =============================================================================

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  memo,
  useTransition,
  useDeferredValue,
} from "react";

import {
  S3, C0, CR, CB, CY, ALIVE_T, FADE,
  TB, RULES, birthLUT, survLUT, ageBucket,
  HC6, HS6,
  buildGrid, pixelToOddR, pixelToOddRSnap, cMix, mMix, rng,
  minZoom, fitView, paintableView,
  classify, PATS, PAT_KEYS, GRID_SIZES,
  SPEEDS, SPLBL, DENS, cl,
} from "./lib/hex.js";

// -----------------------------------------------------------------------------
// THEME - Tactile Brutalism / Lab Oscilloscope
// -----------------------------------------------------------------------------
const T = {
  bg:        "#000000",
  bg2:       "#06090A",
  bg3:       "#0A1014",
  panel:     "#0C1416",
  text:      "#E8F5F2",
  sub:       "#5C8580",
  mute:      "#3A4F4D",
  accent:    "#5CF0CC",
  accent2:   "#FFB800",
  red:       "#FF3A8C",
  blue:      "#33CCFF",
  yellow:    "#FFD700",
  redA:      [255,  58, 140],
  blueA:     [ 51, 204, 255],
  yellowA:   [255, 215,   0],
  strokeC:    "rgba(92,240,204,0.18)",
  strokeLive: "rgba(92,240,204,0.42)",
  border:    "2px solid rgba(92,240,204,0.20)",
  borderHi:  "2px solid rgba(92,240,204,0.55)",
  borderSub: "1px solid rgba(92,240,204,0.10)",
  btn:       "#0A1418",
  btn2:      "#16383C",
  hardShadow: "2px 2px 0 0 rgba(92,240,204,0.12)",
  hardShadowActive: "1px 1px 0 0 rgba(92,240,204,0.35)",
  fontMono: "'JetBrains Mono','IBM Plex Mono',ui-monospace,'SF Mono','Menlo','Monaco','Consolas','Courier New',monospace",
  fontDisplay: "'JetBrains Mono','IBM Plex Mono',ui-monospace,'SF Mono',monospace",
};

// -----------------------------------------------------------------------------
// CONSTANTS local to App
// -----------------------------------------------------------------------------
const SPRITE_THRESHOLD = 4;
const TAP_FLASH_DURATION_MS = 300;

const PAINT_MIN_PXR = {
  mouse:   8,
  pen:    10,
  touch:  12,
  unknown: 10,
};
const PAINT_SOFT_PXR = {
  mouse:   6,
  pen:     8,
  touch:  10,
  unknown: 8,
};
function normPointerType(pt) {
  return pt === "mouse" || pt === "pen" || pt === "touch" ? pt : "unknown";
}
function getPaintMinPxR(pt) { return PAINT_MIN_PXR[normPointerType(pt)]; }
function getPaintSoftPxR(pt) { return PAINT_SOFT_PXR[normPointerType(pt)]; }

const SNAP_RADIUS_PX = {
  mouse:   8, pen: 14, touch: 28, unknown: 18,
};
const SNAP_RADIUS_SMALL_CELL_PX = {
  mouse:  12, pen: 20, touch: 36, unknown: 24,
};
function getSnapRadiusPx(pt, pxR) {
  const n = normPointerType(pt);
  return pxR < getPaintSoftPxR(n)
    ? SNAP_RADIUS_SMALL_CELL_PX[n]
    : SNAP_RADIUS_PX[n];
}

const DBG_HISTORY_SIZE = 5;
const MAX_STEPS_PER_TICK = 4;

const TOUCH_MOVE_THRESHOLD_MOUSE = 5;
const TOUCH_MOVE_THRESHOLD_TOUCH = 12;
const TOUCH_MOVE_THRESHOLD_PEN   = 6;
const TOUCH_MOVE_THRESHOLD = 10;
const TOUCH_MIN = 32;

const TOOL_PAN   = 0;
const TOOL_PAINT = 1;
const TOOL_ERASE = 2;
const STROKE_STEP_FRACTION = 0.5;

const TELEMETRY_CAP = 5000;

// -----------------------------------------------------------------------------
// SPRITE / STAMP / RENDER helpers (unchanged from v17.13 except smart-quote
// cleanup; kept inline because they close over T and HC6/HS6 imports above)
// -----------------------------------------------------------------------------
function makeScratch(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

function makeHexSprite(screenR, fillStyle, strokeStyle, lw, glowColor, glowR) {
  const pad = Math.ceil(Math.max(lw, glowR || 0, 1) + 2);
  const size = Math.ceil(screenR * 2 + pad * 2);
  const cv = makeScratch(size, size);
  const ctx = cv.getContext("2d", { alpha: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);

  const p = new Path2D();
  p.moveTo(screenR * HC6[0], screenR * HS6[0]);
  for (let k = 1; k < 6; k++) p.lineTo(screenR * HC6[k], screenR * HS6[k]);
  p.closePath();

  if (glowColor && glowR > 0) {
    const gr = screenR + glowR;
    const gp = new Path2D();
    gp.moveTo(gr * HC6[0], gr * HS6[0]);
    for (let k = 1; k < 6; k++) gp.lineTo(gr * HC6[k], gr * HS6[k]);
    gp.closePath();
    ctx.fillStyle = glowColor;
    ctx.fill(gp);
  }
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill(p);
  }
  if (strokeStyle && lw > 0) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lw;
    ctx.stroke(p);
  }
  return { canvas: cv, size, half: size / 2 };
}

function buildSpriteSet(screenR) {
  const mk = (f, s, l, g, gl) => makeHexSprite(screenR, f, s, l, g, gl);
  const ra = T.redA.join(",");
  const ba = T.blueA.join(",");
  const ya = T.yellowA.join(",");
  const sc = Math.max(1, screenR / 12);
  const gridLw = Math.max(0.5, 0.8 * sc);
  const liveLw = Math.max(0.5, 0.7 * sc);
  const glowExt = Math.min(Math.max(0.5, 1.0 * sc), screenR * 0.1);
  const hovLw = Math.max(0.8, 1.5 * sc);

  return {
    dead: mk(null, T.strokeC, gridLw, null, 0),
    live: {
      [CR]: mk("rgba(" + ra + ",0.92)", T.strokeLive, liveLw, "rgba(" + ra + ",0.18)", glowExt),
      [CB]: mk("rgba(" + ba + ",0.92)", T.strokeLive, liveLw, "rgba(" + ba + ",0.18)", glowExt),
      [CY]: mk("rgba(" + ya + ",0.92)", T.strokeLive, liveLw, "rgba(" + ya + ",0.18)", glowExt),
    },
    trail: TB.map(bkt => ({
      [CR]: mk("rgba(" + ra + "," + bkt.a + ")", T.strokeC, gridLw, null, 0),
      [CB]: mk("rgba(" + ba + "," + bkt.a + ")", T.strokeC, gridLw, null, 0),
      [CY]: mk("rgba(" + ya + "," + bkt.a + ")", T.strokeC, gridLw, null, 0),
    })),
    hover: mk(null, "rgba(92,240,204,0.65)", hovLw, null, 0),
    screenR,
  };
}

const spriteCache = new Map();
function getSpriteSet(screenR) {
  const qR = Math.round(screenR);
  if (qR < 3) return null;
  if (spriteCache.has(qR)) return spriteCache.get(qR);
  if (spriteCache.size > 10) {
    const first = spriteCache.keys().next().value;
    spriteCache.delete(first);
  }
  const set = buildSpriteSet(qR);
  spriteCache.set(qR, set);
  return set;
}

const STAMP_CACHE_MAX = 8;
const stampCache = new Map();
function getStamp(pxR) {
  const key = Math.round(pxR * 10);
  if (stampCache.has(key)) {
    const v = stampCache.get(key);
    stampCache.delete(key);
    stampCache.set(key, v);
    return v;
  }
  const r = Math.ceil(pxR);
  const fill = [], border = [];
  const w = S3 * pxR * 0.5;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const adx = Math.abs(dx), ady = Math.abs(dy);
      const edgeY = pxR * 2 - (pxR / w) * adx;
      const inHex = ady <= pxR && ady <= edgeY;
      const edgeYo = (pxR + 0.9) * 2 - ((pxR + 0.9) / (w + 0.9)) * adx;
      const inOuter = ady <= pxR + 0.9 && ady <= edgeYo;
      if (inHex) fill.push(dx, dy);
      else if (inOuter) border.push(dx, dy);
    }
  }
  const s = { fill: new Int16Array(fill), border: new Int16Array(border) };
  if (stampCache.size >= STAMP_CACHE_MAX) {
    const first = stampCache.keys().next().value;
    stampCache.delete(first);
  }
  stampCache.set(key, s);
  return s;
}

const packRGBA = (r, g, b, a) => (a << 24) | (b << 16) | (g << 8) | r;
const BG32   = packRGBA( 6,  9, 10, 255);
const GRID32 = packRGBA(28, 56, 52, 255);
const LIVE32 = {
  [CR]: packRGBA(255,  58, 140, 255),
  [CB]: packRGBA( 51, 204, 255, 255),
  [CY]: packRGBA(255, 215,   0, 255),
};
const TRAIL32 = TB.map(bkt => {
  const a = bkt.a, ia = 1 - a;
  const mix = (rgb) => packRGBA(
    (rgb[0] * a + 6  * ia) | 0,
    (rgb[1] * a + 9  * ia) | 0,
    (rgb[2] * a + 10 * ia) | 0,
    255
  );
  return {
    [CR]: mix(T.redA),
    [CB]: mix(T.blueA),
    [CY]: mix(T.yellowA),
  };
});

function drawSpriteMode(ctx, pw, ph, G, cBuf, aBuf, tx, ty, zm, dpr, hovIdx, sprites) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = T.bg2;
  ctx.fillRect(0, 0, pw, ph);

  const { ROWS, COLS, HR, centers, vStep, wStep } = G;
  const scale = zm * dpr;
  const txP = tx * dpr, tyP = ty * dpr;
  const sprHalf = sprites.dead.half;
  const sprSize = sprites.dead.size;

  const x0 = -txP / scale - HR * 2, x1 = (pw - txP) / scale + HR * 2;
  const y0 = -tyP / scale - HR * 2, y1 = (ph - tyP) / scale + HR * 2;
  const rowMin = Math.max(0, Math.floor(y0 / vStep) - 1);
  const rowMax = Math.min(ROWS - 1, Math.ceil(y1 / vStep) + 1);
  const colMin = Math.max(0, Math.floor(x0 / wStep) - 1);
  const colMax = Math.min(COLS - 1, Math.ceil(x1 / wStep) + 1);

  for (let rr = rowMin; rr <= rowMax; rr++) {
    const ro = rr * COLS;
    for (let cc = colMin; cc <= colMax; cc++) {
      const i = ro + cc;
      const col = cBuf[i], age = aBuf[i];
      let sp;
      if (!col || age <= 0) sp = sprites.dead;
      else if (age >= ALIVE_T) sp = sprites.live[col];
      else {
        const bi = ageBucket[age];
        sp = bi >= 0 ? sprites.trail[bi][col] : sprites.dead;
      }
      if (!sp) continue;
      const sx = (centers[i * 2] * scale + txP - sprHalf + 0.5) | 0;
      const sy = (centers[i * 2 + 1] * scale + tyP - sprHalf + 0.5) | 0;
      if (sx + sprSize < 0 || sx > pw || sy + sprSize < 0 || sy > ph) continue;
      ctx.drawImage(sp.canvas, sx, sy);
    }
  }

  if (hovIdx >= 0 && hovIdx < G.N && sprites.hover) {
    const sp = sprites.hover;
    const sx = (centers[hovIdx * 2] * scale + txP - sp.half + 0.5) | 0;
    const sy = (centers[hovIdx * 2 + 1] * scale + tyP - sp.half + 0.5) | 0;
    ctx.drawImage(sp.canvas, sx, sy);
  }
}

function drawStampMode(u32, pw, ph, G, cBuf, aBuf, tx, ty, zm, dpr) {
  u32.fill(BG32);
  const { ROWS, COLS, HR, centers, vStep, wStep } = G;
  const txP = tx * dpr, tyP = ty * dpr, zmP = zm * dpr;

  const x0w = -txP / zmP, x1w = (pw - txP) / zmP;
  const y0w = -tyP / zmP, y1w = (ph - tyP) / zmP;
  const rowMin = Math.max(0, Math.floor((y0w - HR) / vStep));
  const rowMax = Math.min(ROWS - 1, Math.ceil((y1w + HR) / vStep));
  const colMin = Math.max(0, Math.floor((x0w - HR) / wStep) - 1);
  const colMax = Math.min(COLS - 1, Math.ceil((x1w + HR) / wStep) + 1);

  const pxR = HR * zmP;
  const showGrid = pxR >= 2.5;
  if (pxR < 0.5) return;
  const stamp = getStamp(pxR);

  for (let rr = rowMin; rr <= rowMax; rr++) {
    const ro = rr * COLS;
    for (let cc = colMin; cc <= colMax; cc++) {
      const i = ro + cc;
      const cx = (centers[i * 2] * zmP + txP) | 0;
      const cy = (centers[i * 2 + 1] * zmP + tyP) | 0;
      const col = cBuf[i], age = aBuf[i];
      const alive = col !== C0 && age >= ALIVE_T;
      const trail = col !== C0 && age > 0 && age < ALIVE_T;

      if (alive) {
        const c32 = LIVE32[col], sf = stamp.fill;
        for (let j = 0; j < sf.length; j += 2) {
          const px = cx + sf[j], py = cy + sf[j + 1];
          if (px >= 0 && px < pw && py >= 0 && py < ph) u32[py * pw + px] = c32;
        }
      } else if (trail) {
        const bi = ageBucket[age];
        if (bi >= 0) {
          const c32 = TRAIL32[bi][col], sf = stamp.fill;
          for (let j = 0; j < sf.length; j += 2) {
            const px = cx + sf[j], py = cy + sf[j + 1];
            if (px >= 0 && px < pw && py >= 0 && py < ph) u32[py * pw + px] = c32;
          }
        }
      } else if (showGrid) {
        const sb = stamp.border;
        for (let j = 0; j < sb.length; j += 2) {
          const px = cx + sb[j], py = cy + sb[j + 1];
          if (px >= 0 && px < pw && py >= 0 && py < ph) u32[py * pw + px] = GRID32;
        }
      }
    }
  }
}

function drawMissFlashes(ctx, flashes, dpr, now) {
  if (!flashes || flashes.size === 0) return false;
  ctx.save();
  let anyAlive = false;
  for (const [, f] of flashes) {
    if (f.expiry <= now) continue;
    anyAlive = true;
    const t = (f.expiry - now) / TAP_FLASH_DURATION_MS;
    const cx = f.x * dpr, cy = f.y * dpr;
    const r = 16 * dpr * (1 + (1 - t) * 0.6);
    ctx.lineWidth = Math.max(2, 3 * dpr);
    ctx.strokeStyle = "rgba(255,80,120," + Math.min(0.9, t * 1.2) + ")";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const ch = r * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - ch, cy); ctx.lineTo(cx + ch, cy);
    ctx.moveTo(cx, cy - ch); ctx.lineTo(cx, cy + ch);
    ctx.stroke();
  }
  ctx.restore();
  return anyAlive;
}

function drawHoverHex(ctx, G, hovIdx, panX, panY, zoom, dpr) {
  if (hovIdx < 0 || hovIdx >= G.N) return;
  const scale = zoom * dpr;
  const cx = G.centers[hovIdx * 2] * scale + panX * dpr;
  const cy = G.centers[hovIdx * 2 + 1] * scale + panY * dpr;
  const r  = G.HR * zoom * dpr;
  ctx.save();
  ctx.strokeStyle = "rgba(92,240,204,0.85)";
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(cx + r * HC6[0], cy + r * HS6[0]);
  for (let k = 1; k < 6; k++) {
    ctx.lineTo(cx + r * HC6[k], cy + r * HS6[k]);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawTapFlashes(ctx, G, flashes, panX, panY, zoom, dpr, now) {
  if (!flashes || flashes.size === 0) return false;
  const scale = zoom * dpr;
  const r  = G.HR * zoom * dpr;
  const flashR = Math.max(r * 1.4, 18);
  ctx.save();
  let anyAlive = false;
  for (const [idx, expiry] of flashes) {
    if (expiry <= now) continue;
    anyAlive = true;
    if (idx < 0 || idx >= G.N) continue;
    const t = (expiry - now) / TAP_FLASH_DURATION_MS;
    const innerAlpha = Math.min(1, t * 1.4);
    const outerAlpha = Math.min(0.6, t * 0.8);
    const cx = G.centers[idx * 2] * scale + panX * dpr;
    const cy = G.centers[idx * 2 + 1] * scale + panY * dpr;
    const outerR = flashR * (1 + (1 - t) * 0.4);
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.strokeStyle = "rgba(255,255,255," + outerAlpha + ")";
    ctx.beginPath();
    ctx.moveTo(cx + outerR * HC6[0], cy + outerR * HS6[0]);
    for (let k = 1; k < 6; k++) {
      ctx.lineTo(cx + outerR * HC6[k], cy + outerR * HS6[k]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = Math.max(2.5, r * 0.22);
    ctx.strokeStyle = "rgba(92,240,204," + innerAlpha + ")";
    ctx.beginPath();
    ctx.moveTo(cx + flashR * HC6[0], cy + flashR * HS6[0]);
    for (let k = 1; k < 6; k++) {
      ctx.lineTo(cx + flashR * HC6[k], cy + flashR * HS6[k]);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  return anyAlive;
}

function renderStampToCanvas(ctx, pw, ph, G, cBuf, aBuf, panX, panY, zoom, dpr,
                             imgRef, u32Ref) {
  if (!imgRef.current
      || imgRef.current.width !== pw
      || imgRef.current.height !== ph) {
    imgRef.current = ctx.createImageData(pw, ph);
    u32Ref.current = new Uint32Array(imgRef.current.data.buffer);
  }
  drawStampMode(u32Ref.current, pw, ph, G, cBuf, aBuf, panX, panY, zoom, dpr);
  ctx.putImageData(imgRef.current, 0, 0);
}

function drawSpark(ctx, w, h, hist) {
  ctx.clearRect(0, 0, w, h);
  if (hist.length < 2) return;
  let max = 1;
  for (const p of hist) {
    if (p.r > max) max = p.r;
    if (p.b > max) max = p.b;
    if (p.y > max) max = p.y;
  }
  ctx.strokeStyle = "rgba(92,240,204,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const yy = (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }
  const draw = (color, key) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < hist.length; i++) {
      const x = (i / (hist.length - 1)) * w;
      const y = h - (hist[i][key] / max) * h * 0.92;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  draw(T.red, "r");
  draw(T.blue, "b");
  draw(T.yellow, "y");
  ctx.fillStyle = T.mute;
  ctx.font = "9px " + T.fontMono;
  ctx.textBaseline = "top";
  ctx.fillText("max " + max, 4, 2);
}

// -----------------------------------------------------------------------------
// URL hash sharing
// -----------------------------------------------------------------------------
function readUrlState() {
  if (typeof window === "undefined") return null;
  try {
    const h = window.location.hash;
    if (!h || h.length < 2) return null;
    const params = new URLSearchParams(h.slice(1));
    return {
      p: params.get("p"),
      r: params.get("r") !== null ? parseInt(params.get("r"), 10) : null,
      w: params.get("w") !== null ? params.get("w") === "1" : null,
      m: params.get("m"),
      d: params.get("d") !== null ? parseInt(params.get("d"), 10) : null,
      g: params.get("g") !== null ? parseInt(params.get("g"), 10) : null,
      s: params.get("s") !== null ? parseInt(params.get("s"), 10) : null,
    };
  } catch (err) {
    return null;
  }
}

function writeUrlState(state) {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams();
    if (state.p) params.set("p", state.p);
    if (state.r != null) params.set("r", String(state.r));
    if (state.w != null) params.set("w", state.w ? "1" : "0");
    if (state.m) params.set("m", state.m);
    if (state.d != null) params.set("d", String(state.d));
    if (state.g != null) params.set("g", String(state.g));
    if (state.s != null) params.set("s", String(state.s));
    const newHash = "#" + params.toString();
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
    }
  } catch (err) {
    // Some sandboxed contexts (data: URLs, srcdoc) reject history mutation
  }
}

function getPrefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// -----------------------------------------------------------------------------
// Small UI atoms
// -----------------------------------------------------------------------------
const Stat = memo(function Stat({ label, value, color, big }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "baseline" }}>
      <span
        style={{
          color: T.mute,
          fontSize: big ? 9 : 8,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: color || T.text,
          fontSize: big ? 14 : 11,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
        }}
      >
        {value}
      </span>
    </span>
  );
});

const Btn = memo(function Btn({ l, o, k, w, disabled, title, ariaPressed }) {
  const active = k === "a";
  return (
    <button
      onClick={o}
      disabled={disabled}
      title={title}
      aria-label={title || l}
      aria-pressed={ariaPressed}
      style={{
        background: active ? T.btn2 : T.btn,
        color: k === "w" ? T.accent : T.text,
        border: active ? T.borderHi : T.border,
        borderRadius: 0,
        boxShadow: active ? T.hardShadowActive : T.hardShadow,
        padding: "0 10px",
        minHeight: TOUCH_MIN,
        minWidth: w ? Math.max(TOUCH_MIN, 64) : TOUCH_MIN,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        cursor: disabled ? "default" : "pointer",
        fontFamily: T.fontMono,
        opacity: disabled ? 0.32 : 1,
        whiteSpace: "nowrap",
        textTransform: "uppercase",
        outline: "none",
        transition: "background 80ms",
      }}
    >
      {l}
    </button>
  );
});

const ColorChip = memo(function ColorChip({ l, c, o, on }) {
  return (
    <button
      onClick={o}
      aria-label={"Brush " + l}
      aria-pressed={on}
      style={{
        background: on ? c : "transparent",
        color: on ? "#000" : c,
        border: "2px solid " + c,
        borderRadius: 0,
        boxShadow: on
          ? "1px 1px 0 0 rgba(255,255,255,0.15)"
          : "2px 2px 0 0 rgba(255,255,255,0.04)",
        padding: "0 10px",
        minHeight: TOUCH_MIN,
        minWidth: TOUCH_MIN,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.08em",
        cursor: "pointer",
        fontFamily: T.fontMono,
        textTransform: "uppercase",
      }}
    >
      {l}
    </button>
  );
});

const Sec = memo(function Sec({ t, o, g, children }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={g}
        aria-expanded={o}
        style={{
          background: "transparent",
          color: T.accent,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.16em",
          padding: "6px 0",
          cursor: "pointer",
          textTransform: "uppercase",
          border: "none",
          borderBottom: o ? T.border : T.borderSub,
          width: "100%",
          textAlign: "left",
          fontFamily: T.fontMono,
          minHeight: TOUCH_MIN,
        }}
      >
        {o ? "[-] " : "[+] "}{t}
      </button>
      {o && <div style={{ paddingLeft: 4, paddingTop: 6 }}>{children}</div>}
    </div>
  );
});

// -----------------------------------------------------------------------------
// MAIN APP
// -----------------------------------------------------------------------------
export default function App() {
  const urlInit = useMemo(() => readUrlState(), []);

  const [gridSizeI, setGridSizeI] = useState(
    urlInit?.g != null && urlInit.g >= 0 && urlInit.g < GRID_SIZES.length
      ? urlInit.g
      : 1
  );
  const gs = GRID_SIZES[gridSizeI];
  const gridRef = useRef(null);

  const getGrid = () => {
    if (!gridRef.current
        || gridRef.current.ROWS !== gs.rows
        || gridRef.current.COLS !== gs.cols) {
      gridRef.current = buildGrid(gs.rows, gs.cols, gs.hr);
    }
    return gridRef.current;
  };

  const cA = useRef(null);
  const aA = useRef(null);
  const cB = useRef(null);
  const aB = useRef(null);
  const alt = useRef(false);

  // NR-G56: persistent rowActive scratch buffer for step()'s quiescent-row
  // pre-scan. Allocated once per grid instead of once per step.
  const rowActiveRef = useRef(null);

  const ensureBufs = () => {
    const G = getGrid();
    if (!cA.current || cA.current.length !== G.N) {
      cA.current = new Uint8Array(G.N);
      aA.current = new Uint8Array(G.N);
      cB.current = new Uint8Array(G.N);
      aB.current = new Uint8Array(G.N);
      alt.current = false;
    }
    if (!rowActiveRef.current || rowActiveRef.current.length !== G.ROWS) {
      rowActiveRef.current = new Uint8Array(G.ROWS);
    }
  };

  const [view,    setView]    = useState({ zoom: 1, panX: 8, panY: 8 });
  const [running, setRunning] = useState(false);
  const [gen,     setGen]     = useState(0);
  const [spdI,    setSpdI]    = useState(3);
  const [rI,      setRI]      = useState(
    urlInit?.r != null && urlInit.r >= 0 && urlInit.r < RULES.length ? urlInit.r : 0
  );
  const [wrap,    setWrap]    = useState(urlInit?.w != null ? urlInit.w : true);
  const [seed,    setSeed]    = useState(urlInit?.s != null ? urlInit.s : 12348);
  const [brush,   setBrush]   = useState(CR);
  const [mix,     setMix]     = useState(
    urlInit?.m === "maj" ? "majority" : "circular"
  );
  const [denI,    setDenI]    = useState(
    urlInit?.d != null && urlInit.d >= 0 && urlInit.d < DENS.length ? urlInit.d : 2
  );
  const [pat,     setPat]     = useState(
    urlInit?.p && PATS[urlInit.p] ? urlInit.p : "Block"
  );
  const [hov,     setHov]     = useState(-1);
  const [uiTick,  setUiTick]  = useState(0);
  const [gps,     setGps]     = useState(0);
  const [fps,     setFps]     = useState(0);
  const [tool,    setTool]    = useState(TOOL_PAN);
  const [pO,      setPO]      = useState(false);
  const [sO,      setSO]      = useState(false);
  const [slO,     setSlO]     = useState(false);
  const [s0,      setS0]      = useState(null);
  const [s1,      setS1]      = useState(null);
  const [stats,   setStats]   = useState({ pop: 0, r: 0, b: 0, y: 0 });
  const [scR,     setScR]     = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [webgpuOk, setWebgpuOk] = useState(null);
  const [reducedMotion, setReducedMotion] = useState(getPrefersReducedMotion());
  const [shareCopied, setShareCopied] = useState(false);
  const [diagOn, setDiagOn] = useState(false);
  const [diagInfo, setDiagInfo] = useState(null);
  const [diagHistory, setDiagHistory] = useState([]);

  const [isPending, startTransitionPending] = useTransition();
  const deferredStats = useDeferredValue(stats);

  const genRef = useRef(0);
  const dirty  = useRef(true);
  const simStats = useRef({ counter: 0, lastAt: performance.now() });
  const fpsStats = useRef({ count: 0, lastAt: performance.now(), ema: 0 });
  // NR-G65: simPaused is a hard-pause flag readable by the sim-loop's tick().
  // The __TEST__ bridge uses it to suspend the sim during deterministic steps
  // without going through setRunning, which React would batch into a no-op.
  const simPaused = useRef(false);
  const perfStats = useRef({
    simStepMs: 0,
    renderMs: 0,
    frameBudget: 0,
    samples: 0,
    clipHits: 0,
    fullHits: 0,
  });

  const telemetry = useRef({
    buffer: new Array(TELEMETRY_CAP),
    idx: 0,
    size: 0,
    sessionStart: Date.now(),
    capabilities: { hasObserver: false, longAnimationFrame: false, longtask: false, event: false },
    inpMaxMs: 0,
    longTaskCount: 0,
    longTaskTotalMs: 0,
    longFrameCount: 0,
    longFrameTotalMs: 0,
  });
  const telemetryPush = useCallback((entry) => {
    const t = telemetry.current;
    t.buffer[t.idx] = entry;
    t.idx = (t.idx + 1) % TELEMETRY_CAP;
    if (t.size < TELEMETRY_CAP) t.size++;
    if (entry.type === "longtask") {
      t.longTaskCount++;
      t.longTaskTotalMs += entry.duration || 0;
    } else if (entry.type === "loaf") {
      t.longFrameCount++;
      t.longFrameTotalMs += entry.duration || 0;
    } else if (entry.type === "event") {
      if (entry.duration > t.inpMaxMs) t.inpMaxMs = entry.duration;
    }
  }, []);

  const dirtyBBox = useRef({
    minRow: -1, maxRow: -1, minCol: -1, maxCol: -1, valid: false,
  });
  const pH = useRef([]);
  const MH = 120;
  const scanToken = useRef(0);

  const rR  = useRef(running);
  const spR = useRef(spdI);
  const ruR = useRef(rI);
  const wR  = useRef(wrap);
  const mR  = useRef(mix);
  const brR = useRef(brush);
  const hvR = useRef(hov);
  const vR  = useRef(view);
  const toolR = useRef(tool);

  // NR-G59: track the last pointer type that interacted with the canvas, so
  // selectTool's auto-zoom can use the appropriate threshold. Defaults to
  // "touch" (largest threshold) until a real pointer arrives.
  const lastPointerTypeRef = useRef("touch");

  useEffect(() => { rR.current = running; }, [running]);
  useEffect(() => { spR.current = spdI; }, [spdI]);
  useEffect(() => { ruR.current = rI; }, [rI]);
  useEffect(() => { wR.current = wrap; }, [wrap]);
  useEffect(() => { mR.current = mix; }, [mix]);
  useEffect(() => { brR.current = brush; }, [brush]);
  useEffect(() => { hvR.current = hov; dirty.current = true; }, [hov]);
  useEffect(() => { vR.current = view; }, [view]);
  useEffect(() => { toolR.current = tool; }, [tool]);

  useEffect(() => {
    writeUrlState({
      p: pat, r: rI, w: wrap,
      m: mix === "circular" ? "circ" : "maj",
      d: denI, g: gridSizeI, s: seed,
    });
  }, [pat, rI, wrap, mix, denI, gridSizeI, seed]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (e) => setReducedMotion(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", listener);
    else if (mq.addListener) mq.addListener(listener);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", listener);
      else if (mq.removeListener) mq.removeListener(listener);
    };
  }, []);

  const history = useRef([]);
  // NR-G68: getCur/getNxt are self-protecting. ensureBufs is idempotent
  // (short-circuits when buffers match the current grid) so the cost is one
  // length compare per call, but it eliminates a real crash class: a tap
  // arriving between changeGridSize() nulling the buffers and the next rAF
  // forceDraw() reallocating them would otherwise dereference null and
  // silently break selection on XL/XXL where users switch grids most often.
  const getCur = () => {
    ensureBufs();
    return alt.current
      ? { c: cB.current, a: aB.current }
      : { c: cA.current, a: aA.current };
  };
  const getNxt = () => {
    ensureBufs();
    return alt.current
      ? { c: cA.current, a: aA.current }
      : { c: cB.current, a: aB.current };
  };

  const cvRef = useRef(null);
  const ctxR = useRef(null);
  const spkRef = useRef(null);
  const spkCtx = useRef(null);
  const stampImg = useRef(null);
  const stampU32 = useRef(null);
  const cvSz = useRef({ w: 0, h: 0 });
  const lastUi = useRef(0);
  const didFit = useRef(false);

  const rectCache = useRef({ rect: null, ts: 0 });
  const getCachedRect = () => {
    const cv = cvRef.current;
    if (!cv) return { left: 0, top: 0, width: 400, height: 300 };
    const now = performance.now();
    if (!rectCache.current.rect || now - rectCache.current.ts > 500) {
      rectCache.current.rect = cv.getBoundingClientRect();
      rectCache.current.ts = now;
    }
    return rectCache.current.rect;
  };

  // Pointer/touch state refs
  const pointerCache = useRef(new Map());
  const drag = useRef({
    on: false, moved: false, lx: 0, ly: 0,
    painting: false, startX: 0, startY: 0,
  });
  const pinch = useRef({ active: false, dist: 0, cx: 0, cy: 0 });
  const lastPaintedIdx = useRef(-1);
  const tapFlashes = useRef(new Map());
  const missFlashes = useRef(new Map());
  const missCounter = useRef(0);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.gpu) {
      navigator.gpu.requestAdapter().then(
        (a) => setWebgpuOk(!!a),
        ()  => setWebgpuOk(false)
      );
    } else {
      setWebgpuOk(false);
    }
  }, []);

  const saveHist = useCallback(() => {
    ensureBufs();
    const { c, a } = getCur();
    history.current.push({
      c: new Uint8Array(c),
      a: new Uint8Array(a),
      gen: genRef.current,
    });
    if (history.current.length > 30) history.current.shift();
  }, []);

  // NR-G58: stats recompute, called from any path that mutates the buffer
  // outside of step(). Without this, undo/restart/slot-load show stale
  // POP/R/B/Y until the next sim tick.
  const recomputeStats = useCallback(() => {
    const G = getGrid();
    const { c, a } = getCur();
    let pop = 0, r = 0, b = 0, y = 0;
    for (let i = 0; i < G.N; i++) {
      if (a[i] >= ALIVE_T) {
        pop++;
        const col = c[i];
        if (col === CR) r++;
        else if (col === CB) b++;
        else if (col === CY) y++;
      }
    }
    setStats({ pop, r, b, y });
  }, []);

  const undo = useCallback(() => {
    if (!history.current.length) return;
    setRunning(false);
    const snap = history.current.pop();
    const { c, a } = getCur();
    c.set(snap.c);
    a.set(snap.a);
    genRef.current = snap.gen;
    setGen(snap.gen);
    dirty.current = true;
    setUiTick(t => t + 1);
    recomputeStats();
  }, [recomputeStats]);

  const restart = useCallback(() => {
    if (!history.current.length) return;
    const snap = history.current[0];
    history.current.length = 0;
    setRunning(false);
    const { c, a } = getCur();
    c.set(snap.c);
    a.set(snap.a);
    genRef.current = snap.gen;
    setGen(snap.gen);
    dirty.current = true;
    setUiTick(t => t + 1);
    recomputeStats();
  }, [recomputeStats]);

  // NR-G47: viewport changes invalidate the dirty-bbox optimization. The
  // bbox is reset to "full grid" so forceDraw falls back to full render
  // for one frame; the bbox returns to fine-grained tracking immediately.
  const applyView = useCallback((updater, commit) => {
    const next = typeof updater === "function" ? updater(vR.current) : updater;
    vR.current = next;
    dirty.current = true;
    const G = getGrid();
    if (G) {
      const bb = dirtyBBox.current;
      bb.valid = true;
      bb.minRow = 0;
      bb.maxRow = G.ROWS - 1;
      bb.minCol = 0;
      bb.maxCol = G.COLS - 1;
    }
    if (commit) setView(next);
  }, []);

  const commitView = useCallback(() => setView(vR.current), []);

  // NR-G60: cleanupGesture declared before any pointer handler that calls it.
  const cleanupGesture = useCallback((options) => {
    const o = options || {};
    const commit = o.commit !== false;
    const clearPointers = o.clearPointers !== false;
    const clearHover = o.clearHover !== false;
    if (commit) commitView();
    drag.current.on = false;
    drag.current.moved = false;
    drag.current.painting = false;
    drag.current.lx = 0;
    drag.current.ly = 0;
    drag.current.startX = 0;
    drag.current.startY = 0;
    pinch.current.active = false;
    pinch.current.dist = 0;
    pinch.current.cx = 0;
    pinch.current.cy = 0;
    if (clearPointers) pointerCache.current.clear();
    lastPaintedIdx.current = -1;
    if (clearHover && hvR.current !== -1) setHov(-1);
    dirty.current = true;
  }, [commitView]);

  const ensureCanvas = useCallback(() => {
    const cv = cvRef.current;
    if (!cv) return false;
    const dpr = window.devicePixelRatio || 1;
    const cw = cv.clientWidth, ch = cv.clientHeight;
    const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
    if (pw !== cvSz.current.w || ph !== cvSz.current.h) {
      cv.width = pw;
      cv.height = ph;
      cvSz.current = { w: pw, h: ph };
      ctxR.current = cv.getContext("2d", { alpha: false });
    }
    if (!didFit.current && cw > 0) {
      const G = getGrid();
      const targetPxR = getPaintMinPxR(lastPointerTypeRef.current);
      const fv = paintableView(cw, ch, G.GRID_W, G.GRID_H, G.HR, targetPxR);
      vR.current = fv;
      setView(fv);
      didFit.current = true;
    }
    return true;
    // gridSizeI dependency is intentional: a grid switch resets didFit.
  }, [gridSizeI]);

  const forceDraw = useCallback(() => {
    if (!ensureCanvas()) return;
    ensureBufs();
    const renderT0 = performance.now();
    const G = getGrid(), v = vR.current, dpr = window.devicePixelRatio || 1;
    const ctx = ctxR.current, pw = cvSz.current.w, ph = cvSz.current.h;
    const { c, a } = getCur();
    const pxR = G.HR * v.zoom;

    const bb = dirtyBBox.current;
    let useClip = false;
    let clipScreenL = 0, clipScreenT = 0, clipScreenW = 0, clipScreenH = 0;
    if (bb.valid && bb.minRow >= 0 && bb.maxRow >= bb.minRow) {
      const bbW = (bb.maxCol - bb.minCol + 1);
      const bbH = (bb.maxRow - bb.minRow + 1);
      const coverage = (bbW * bbH) / (G.ROWS * G.COLS);
      if (coverage < 0.6) {
        const wStep = S3 * G.HR;
        const wxL = bb.minCol * wStep;
        const wxR = (bb.maxCol + 2) * wStep;
        const wyT = bb.minRow * 1.5 * G.HR;
        const wyB = (bb.maxRow + 1) * 1.5 * G.HR + G.HR;
        const PAD = 2 * dpr;
        const sxL = (wxL * v.zoom + v.panX) * dpr - PAD;
        const sxR = (wxR * v.zoom + v.panX) * dpr + PAD;
        const syT = (wyT * v.zoom + v.panY) * dpr - PAD;
        const syB = (wyB * v.zoom + v.panY) * dpr + PAD;
        const L = Math.max(0, Math.min(pw, Math.floor(sxL)));
        const R = Math.max(0, Math.min(pw, Math.ceil(sxR)));
        const T2 = Math.max(0, Math.min(ph, Math.floor(syT)));
        const B = Math.max(0, Math.min(ph, Math.ceil(syB)));
        clipScreenL = L;
        clipScreenT = T2;
        clipScreenW = R - L;
        clipScreenH = B - T2;
        if (clipScreenW > 0 && clipScreenH > 0) useClip = true;
      }
    }

    if (useClip) perfStats.current.clipHits += 1;
    else         perfStats.current.fullHits += 1;

    if (useClip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipScreenL, clipScreenT, clipScreenW, clipScreenH);
      ctx.clip();
      ctx.clearRect(clipScreenL, clipScreenT, clipScreenW, clipScreenH);
      if (pxR >= SPRITE_THRESHOLD) {
        const screenR = G.HR * v.zoom * dpr;
        const sprites = getSpriteSet(screenR);
        if (sprites) {
          drawSpriteMode(ctx, pw, ph, G, c, a, v.panX, v.panY, v.zoom, dpr, hvR.current, sprites);
          drawHoverHex(ctx, G, hvR.current, v.panX, v.panY, v.zoom, dpr);
        } else {
          renderStampToCanvas(ctx, pw, ph, G, c, a, v.panX, v.panY, v.zoom, dpr, stampImg, stampU32);
          drawHoverHex(ctx, G, hvR.current, v.panX, v.panY, v.zoom, dpr);
        }
      } else {
        renderStampToCanvas(ctx, pw, ph, G, c, a, v.panX, v.panY, v.zoom, dpr, stampImg, stampU32);
        drawHoverHex(ctx, G, hvR.current, v.panX, v.panY, v.zoom, dpr);
      }
      ctx.restore();
    } else {
      if (pxR >= SPRITE_THRESHOLD) {
        const screenR = G.HR * v.zoom * dpr;
        const sprites = getSpriteSet(screenR);
        if (sprites) {
          drawSpriteMode(ctx, pw, ph, G, c, a, v.panX, v.panY, v.zoom, dpr, hvR.current, sprites);
          drawHoverHex(ctx, G, hvR.current, v.panX, v.panY, v.zoom, dpr);
        } else {
          renderStampToCanvas(ctx, pw, ph, G, c, a, v.panX, v.panY, v.zoom, dpr, stampImg, stampU32);
          drawHoverHex(ctx, G, hvR.current, v.panX, v.panY, v.zoom, dpr);
        }
      } else {
        renderStampToCanvas(ctx, pw, ph, G, c, a, v.panX, v.panY, v.zoom, dpr, stampImg, stampU32);
        drawHoverHex(ctx, G, hvR.current, v.panX, v.panY, v.zoom, dpr);
      }
    }

    const now0 = performance.now();
    for (const [idx, expiry] of tapFlashes.current) {
      if (expiry <= now0) tapFlashes.current.delete(idx);
    }
    const flashesAlive = drawTapFlashes(ctx, G, tapFlashes.current,
                                         v.panX, v.panY, v.zoom, dpr, now0);
    for (const [k, f] of missFlashes.current) {
      if (f.expiry <= now0) missFlashes.current.delete(k);
    }
    const missesAlive = drawMissFlashes(ctx, missFlashes.current, dpr, now0);
    dirty.current = flashesAlive || missesAlive;

    fpsStats.current.count++;
    const now = performance.now();
    if (now - fpsStats.current.lastAt > 500) {
      const inst = fpsStats.current.count * 1000 / (now - fpsStats.current.lastAt);
      const ema  = fpsStats.current.ema || inst;
      fpsStats.current.ema = ema * 0.6 + inst * 0.4;
      fpsStats.current.count = 0;
      fpsStats.current.lastAt = now;
      setFps(Math.round(fpsStats.current.ema));
    }

    const renderDt = performance.now() - renderT0;
    perfStats.current.renderMs = perfStats.current.renderMs * 0.8 + renderDt * 0.2;
    const totalMs = perfStats.current.simStepMs + perfStats.current.renderMs;
    const budgetDt = Math.max(0, 16.67 - totalMs);
    perfStats.current.frameBudget = perfStats.current.frameBudget * 0.8 + budgetDt * 0.2;
    if (renderDt >= 4) {
      telemetryPush({
        t: Date.now(),
        type: "render",
        duration: renderDt,
        name: useClip ? "clipped" : "full",
      });
    }
    const bb_reset = dirtyBBox.current;
    bb_reset.valid = false;
    bb_reset.minRow = bb_reset.maxRow = bb_reset.minCol = bb_reset.maxCol = -1;
  }, [ensureCanvas, telemetryPush]);

  const reset = useCallback(() => {
    ensureBufs();
    cA.current.fill(0);
    aA.current.fill(0);
    cB.current.fill(0);
    aB.current.fill(0);
    alt.current = false;
    history.current.length = 0;
    pH.current.length = 0;
    genRef.current = 0;
    dirty.current = true;
  }, []);

  // NR-G66: accept an optional seed override. The __TEST__ bridge uses this
  // for one-shot deterministic randomize() without round-tripping through
  // setSeed -> useEffect -> next render.
  const randomize = useCallback((seedOverride) => {
    reset();
    const usedSeed = Number.isFinite(seedOverride) ? (seedOverride | 0) : seed;
    const G = getGrid(), g = rng(usedSeed);
    const { c, a } = getCur();
    const d = DENS[denI];
    for (let i = 0; i < G.N; i++) {
      if (g() < d) {
        c[i] = [CR, CB, CY][(g() * 3) | 0];
        a[i] = ALIVE_T;
      }
    }
    saveHist();
    setGen(0);
    setRunning(false);
    dirty.current = true;
    setUiTick(t => t + 1);
    recomputeStats();
  }, [seed, denI, reset, saveHist, recomputeStats]);

  const clearAll = useCallback(() => {
    reset();
    saveHist();
    setGen(0);
    setRunning(false);
    setStats({ pop: 0, r: 0, b: 0, y: 0 });
    dirty.current = true;
    setUiTick(t => t + 1);
  }, [reset, saveHist]);

  const place = useCallback((nm) => {
    const p = PATS[nm];
    if (!p) return;
    reset();
    setGen(0);
    setRunning(false);
    const G = getGrid(), { c, a } = getCur();
    const cr = Math.floor(G.ROWS / 2) - 2, cc = Math.floor(G.COLS / 2) - 2;
    for (const [r, ccc] of p.c) {
      const rr = cr + r, col = cc + ccc;
      if (rr >= 0 && rr < G.ROWS && col >= 0 && col < G.COLS) {
        const idx = rr * G.COLS + col;
        c[idx] = CR;
        a[idx] = ALIVE_T;
      }
    }
    saveHist();
    dirty.current = true;
    setUiTick(t => t + 1);
    recomputeStats();
  }, [reset, saveHist, recomputeStats]);

  useEffect(() => { place(pat); }, [place, pat]);

  const changeGridSize = useCallback((newI) => {
    setRunning(false);
    startTransitionPending(() => {
      gridRef.current = null;
      cA.current = null;
      aA.current = null;
      cB.current = null;
      aB.current = null;
      alt.current = false;
      rowActiveRef.current = null;
      history.current.length = 0;
      pH.current.length = 0;
      stampImg.current = null;
      stampU32.current = null;
      spriteCache.clear();
      didFit.current = false;
      rectCache.current.rect = null;
      rectCache.current.ts = 0;
      tapFlashes.current.clear();
      missFlashes.current.clear();
      drag.current.on = false;
      drag.current.painting = false;
      drag.current.moved = false;
      drag.current.lx = 0;
      drag.current.ly = 0;
      drag.current.startX = 0;
      drag.current.startY = 0;
      pinch.current.active = false;
      pinch.current.dist = 0;
      pinch.current.cx = 0;
      pinch.current.cy = 0;
      pointerCache.current.clear();
      lastPaintedIdx.current = -1;
      setStats({ pop: 0, r: 0, b: 0, y: 0 });
      setGps(0);
      simStats.current.counter = 0;
      simStats.current.lastAt = performance.now();
      setHov(-1);
      setDiagInfo(null);
      setDiagHistory([]);
      setGridSizeI(newI);
      setGen(0);
      dirty.current = true;
      setUiTick(t => t + 1);
    });
  }, [startTransitionPending]);

  const scan = useCallback(() => {
    const p = PATS[pat];
    if (!p) return;
    const token = ++scanToken.current;
    setScanBusy(true);
    setScR(null);
    const results = [];
    let idx = 0;
    const tick = () => {
      if (token !== scanToken.current) return;
      const batch = 4;
      for (let b = 0; b < batch && idx < RULES.length; b++, idx++) {
        results.push(RULES[idx].l + ":" + classify(p.c, idx));
      }
      if (idx < RULES.length) {
        setTimeout(tick, 0);
      } else {
        setScR(results.join(" | "));
        setScanBusy(false);
      }
    };
    setTimeout(tick, 0);
  }, [pat]);

  useEffect(() => { scanToken.current++; }, [pat, rI]);

  // ---------------------------------------------------------------------------
  // Simulation step. NR-G56 caches rowActive across calls.
  // ---------------------------------------------------------------------------
  const step = useCallback(function (manual) {
    ensureBufs();
    if (manual) saveHist();
    const G = getGrid(), ri = ruR.current;
    const bL = birthLUT[ri], sL = survLUT[ri];
    const NL = wR.current ? G.NLW : G.NLE;
    const { c: cCur, a: aCur } = getCur();
    const { c: cNxt, a: aNxt } = getNxt();
    const mixF = mR.current === "circular" ? cMix : mMix;
    let pop = 0, r = 0, b = 0, y = 0;

    const simT0 = performance.now();

    const ROWS = G.ROWS, COLS = G.COLS;
    // NR-G56: persistent scratch buffer; cleared, not reallocated.
    const rowActive = rowActiveRef.current;
    rowActive.fill(0);
    for (let row = 0; row < ROWS; row++) {
      const base = row * COLS;
      for (let col = 0; col < COLS; col++) {
        const i = base + col;
        if (aCur[i] > 0) { rowActive[row] = 1; break; }
      }
    }

    for (let row = 0; row < ROWS; row++) {
      const above = row > 0 ? rowActive[row - 1] : (wR.current ? rowActive[ROWS - 1] : 0);
      const below = row < ROWS - 1 ? rowActive[row + 1] : (wR.current ? rowActive[0] : 0);
      if (!rowActive[row] && !above && !below) {
        const base = row * COLS;
        for (let col = 0; col < COLS; col++) {
          const i = base + col;
          cNxt[i] = 0;
          aNxt[i] = 0;
        }
        continue;
      }

      const base = row * COLS;
      for (let col = 0; col < COLS; col++) {
        const i = base + col;
        let nR = 0, nB = 0, nY = 0;
        const nb = i * 6;
        for (let k = 0; k < 6; k++) {
          const ni = NL[nb + k];
          if (ni < 0) continue;
          if (cCur[ni] && aCur[ni] >= ALIVE_T) {
            const cc2 = cCur[ni];
            if (cc2 === CR) nR++;
            else if (cc2 === CB) nB++;
            else nY++;
          }
        }
        const nc = nR + nB + nY;
        if (cCur[i] && aCur[i] >= ALIVE_T) {
          if (sL[nc]) {
            cNxt[i] = cCur[i];
            aNxt[i] = ALIVE_T;
            pop++;
            if (cCur[i] === CR) r++;
            else if (cCur[i] === CB) b++;
            else y++;
          } else {
            cNxt[i] = cCur[i];
            aNxt[i] = Math.max(0, aCur[i] - FADE);
          }
        } else if (bL[nc]) {
          cNxt[i] = mixF(nR, nB, nY, row, col);
          aNxt[i] = ALIVE_T;
          pop++;
          if (cNxt[i] === CR) r++;
          else if (cNxt[i] === CB) b++;
          else y++;
        } else if (cCur[i] && aCur[i] > 0) {
          cNxt[i] = cCur[i];
          aNxt[i] = Math.max(0, aCur[i] - FADE);
        } else {
          cNxt[i] = 0;
          aNxt[i] = 0;
        }
      }
    }

    const simDt = performance.now() - simT0;
    perfStats.current.simStepMs = perfStats.current.simStepMs * 0.8 + simDt * 0.2;
    perfStats.current.samples++;
    if (simDt >= 2) {
      telemetryPush({
        t: Date.now(),
        type: "sim",
        duration: simDt,
        name: "g" + gridSizeI + "_r" + ruR.current,
      });
    }

    alt.current = !alt.current;
    genRef.current++;
    dirty.current = true;
    const bb = dirtyBBox.current;
    bb.valid = true;
    bb.minRow = 0;
    bb.maxRow = G.ROWS - 1;
    bb.minCol = 0;
    bb.maxCol = G.COLS - 1;

    const now = performance.now();
    if (now - lastUi.current > 80 || manual) {
      setGen(genRef.current);
      setStats({ pop, r, b, y });
      pH.current.push({ r, b, y });
      if (pH.current.length > MH) pH.current.shift();
      lastUi.current = now;
      simStats.current.counter++;
      if (now - simStats.current.lastAt > 1000) {
        setGps(Math.round(simStats.current.counter * 1000 / (now - simStats.current.lastAt)));
        simStats.current.counter = 0;
        simStats.current.lastAt = now;
      }
    }
  }, [saveHist, gridSizeI, telemetryPush]);

  useEffect(() => {
    if (!running) return;
    let alive = true, toId = 0;
    const tick = () => {
      if (!alive) return;
      const spd = SPEEDS[spR.current];
      // NR-G65: respect the simPaused hard-pause flag. The bridge's step()
      // sets it before issuing deterministic steps so the rAF tick that was
      // already scheduled by setTimeout cannot race ahead and add phantom
      // generations. A paused tick reschedules itself and yields.
      if (simPaused.current) {
        toId = setTimeout(tick, spd <= 16 ? 16 : spd);
        return;
      }
      if (spd <= 16) {
        for (let i = 0; i < MAX_STEPS_PER_TICK; i++) step(false);
      } else {
        step(false);
      }
      toId = setTimeout(tick, spd <= 16 ? 0 : spd);
    };
    tick();
    return () => { alive = false; clearTimeout(toId); };
  }, [running, step]);

  useEffect(() => {
    let on = true;
    const loop = () => {
      if (!on) return;
      if (dirty.current) forceDraw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { on = false; };
  }, [forceDraw]);

  useEffect(() => { dirty.current = true; }, [uiTick, view, hov]);

  useEffect(() => {
    const cv = spkRef.current;
    if (!cv || !sO) return;
    if (!spkCtx.current) spkCtx.current = cv.getContext("2d");
    drawSpark(spkCtx.current, cv.width, cv.height, pH.current);
  }, [uiTick, sO]);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => {
      rectCache.current.rect = null;
      cvSz.current = { w: 0, h: 0 };
      dirty.current = true;
      const G = gridRef.current;
      if (G) {
        const bb = dirtyBBox.current;
        bb.valid = true;
        bb.minRow = 0;
        bb.maxRow = G.ROWS - 1;
        bb.minCol = 0;
        bb.maxCol = G.COLS - 1;
      }
    });
    ro.observe(cv);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const invalidate = () => {
      rectCache.current.rect = null;
      rectCache.current.ts = 0;
      dirty.current = true;
    };
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("scroll", invalidate, { passive: true });
      vv.addEventListener("resize", invalidate, { passive: true });
    }
    return () => {
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
      if (vv) {
        vv.removeEventListener("scroll", invalidate);
        vv.removeEventListener("resize", invalidate);
      }
    };
  }, []);

  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    document.addEventListener("gesturestart",  prevent, { passive: false });
    document.addEventListener("gesturechange", prevent, { passive: false });
    document.addEventListener("gestureend",    prevent, { passive: false });
    return () => {
      document.removeEventListener("gesturestart",  prevent);
      document.removeEventListener("gesturechange", prevent);
      document.removeEventListener("gestureend",    prevent);
    };
  }, []);

  const dirtyBBoxAdd = useCallback((row, col) => {
    const b = dirtyBBox.current;
    if (!b.valid) {
      b.minRow = b.maxRow = row;
      b.minCol = b.maxCol = col;
      b.valid = true;
      return;
    }
    if (row < b.minRow) b.minRow = row;
    if (row > b.maxRow) b.maxRow = row;
    if (col < b.minCol) b.minCol = col;
    if (col > b.maxCol) b.maxCol = col;
  }, []);

  useEffect(() => {
    if (!diagOn) return;
    const id = setInterval(() => setUiTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [diagOn]);

  const addTapFlash = useCallback((idx) => {
    if (idx < 0) return;
    tapFlashes.current.set(idx, performance.now() + TAP_FLASH_DURATION_MS);
    dirty.current = true;
  }, []);

  const addMissFlash = useCallback((sx, sy) => {
    const key = ++missCounter.current;
    missFlashes.current.set(key, {
      x: sx, y: sy,
      expiry: performance.now() + TAP_FLASH_DURATION_MS,
    });
    dirty.current = true;
  }, []);

  const pushDiagHistory = useCallback((entry) => {
    setDiagHistory(prev => {
      const next = [entry, ...prev];
      if (next.length > DBG_HISTORY_SIZE) next.length = DBG_HISTORY_SIZE;
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // paintAt - NR-G57 fix: first-touch is tool-aware.
  //   PAN tool   : tap-toggle (legacy)
  //   PAINT tool : paint only - never erase a cell on first touch
  //   ERASE tool : erase only - never paint a cell on first touch
  // Stroke moves keep their tool-specific behavior (set color / clear cell).
  // ---------------------------------------------------------------------------
  const paintAt = useCallback((sx, sy, isFirstTouch, isErase, pointerType) => {
    const G = getGrid(), rect = getCachedRect();
    const v = vR.current;
    const wx = (sx - rect.left - v.panX) / v.zoom;
    const wy = (sy - rect.top  - v.panY) / v.zoom;
    const pxR = G.HR * v.zoom;
    const snapPx = getSnapRadiusPx(pointerType, pxR);
    const snapWorld = snapPx / v.zoom;
    const strictIdx = pixelToOddR(wx, wy, G.HR, G.ROWS, G.COLS);
    const idx = strictIdx >= 0
      ? strictIdx
      : pixelToOddRSnap(wx, wy, G.HR, G.ROWS, G.COLS, snapWorld);

    if (diagOn) {
      const entry = {
        ts: Math.round(performance.now()),
        sx: Math.round(sx), sy: Math.round(sy),
        wx: wx.toFixed(1), wy: wy.toFixed(1),
        idx,
        firstTouch: isFirstTouch,
        erase: isErase,
        pointerType: normPointerType(pointerType),
        rectLeft: Math.round(rect.left),
        rectTop: Math.round(rect.top),
        zoom: v.zoom.toFixed(3),
        panX: v.panX.toFixed(1),
        panY: v.panY.toFixed(1),
        pxR: pxR.toFixed(2),
        snapPx,
        snapped: idx >= 0 && strictIdx < 0,
      };
      setDiagInfo(entry);
      pushDiagHistory(entry);
    }

    if (idx < 0) {
      addMissFlash(sx, sy);
      return false;
    }

    if (!isFirstTouch && idx === lastPaintedIdx.current) {
      addTapFlash(idx);
      return false;
    }

    const { c, a } = getCur();
    const isAlive = c[idx] && a[idx] >= ALIVE_T;
    let changed = false;
    const activeTool = toolR.current;

    if (isFirstTouch) {
      // NR-G57: first-touch is tool-aware.
      if (activeTool === TOOL_ERASE) {
        if (isAlive) { c[idx] = 0; a[idx] = 0; changed = true; }
      } else if (activeTool === TOOL_PAINT) {
        if (!(isAlive && c[idx] === brR.current)) {
          c[idx] = brR.current;
          a[idx] = ALIVE_T;
          changed = true;
        }
      } else {
        // TOOL_PAN: legacy tap-toggle
        if (isAlive) { c[idx] = 0; a[idx] = 0; changed = true; }
        else { c[idx] = brR.current; a[idx] = ALIVE_T; changed = true; }
      }
    } else if (isErase) {
      if (isAlive) { c[idx] = 0; a[idx] = 0; changed = true; }
    } else {
      if (!(isAlive && c[idx] === brR.current)) {
        c[idx] = brR.current;
        a[idx] = ALIVE_T;
        changed = true;
      }
    }

    lastPaintedIdx.current = idx;
    addTapFlash(idx);
    if (changed) {
      dirty.current = true;
      dirtyBBoxAdd(Math.floor(idx / G.COLS), idx % G.COLS);
      setUiTick(t => t + 1);
    }
    return changed;
  }, [addTapFlash, addMissFlash, diagOn, pushDiagHistory, dirtyBBoxAdd]);

  const paintStroke = useCallback((sx0, sy0, sx1, sy1, isErase, pointerType) => {
    const G = getGrid(), v = vR.current;
    const stepWorld = G.HR * STROKE_STEP_FRACTION;
    const stepScreen = stepWorld * v.zoom;
    const dx = sx1 - sx0, dy = sy1 - sy0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      paintAt(sx1, sy1, false, isErase, pointerType);
      return;
    }
    const steps = Math.max(1, Math.ceil(dist / Math.max(stepScreen, 1)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      paintAt(sx0 + dx * t, sy0 + dy * t, false, isErase, pointerType);
    }
  }, [paintAt]);

  const releasePtr = useCallback((e) => {
    try {
      const cv = cvRef.current;
      if (cv && cv.hasPointerCapture && cv.hasPointerCapture(e.pointerId))
        cv.releasePointerCapture(e.pointerId);
    } catch (err) {
      // silently ignore - pointer was already released
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Pointer down
  // ---------------------------------------------------------------------------
  const onPD = useCallback((e) => {
    const cv = cvRef.current;
    if (!cv) return;
    if (e.button !== 0 && e.button !== undefined) return;

    // NR-G59: track pointer type for selectTool's auto-zoom decision
    lastPointerTypeRef.current = normPointerType(e.pointerType);

    try { cv.setPointerCapture(e.pointerId); } catch (err) {
      // some platforms / iframes deny pointer capture
    }
    pointerCache.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointerCache.current.size === 2) {
      const pts = [...pointerCache.current.values()];
      if (!pts[0] || !pts[1] ||
          !Number.isFinite(pts[0].x) || !Number.isFinite(pts[0].y) ||
          !Number.isFinite(pts[1].x) || !Number.isFinite(pts[1].y)) {
        cleanupGesture({ commit: false, clearPointers: true, clearHover: true });
        return;
      }
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) {
        cleanupGesture({ commit: false, clearPointers: false, clearHover: true });
        return;
      }
      pinch.current = {
        active: true,
        dist: dist,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      };
      drag.current.on = false;
      lastPaintedIdx.current = -1;
      return;
    }

    if (e.isPrimary === false) return;
    lastPaintedIdx.current = -1;

    const isPaintTool = tool === TOOL_PAINT || tool === TOOL_ERASE;
    if (isPaintTool) {
      saveHist();
      drag.current = {
        on: true, moved: false,
        lx: e.clientX, ly: e.clientY,
        painting: true,
        startX: e.clientX, startY: e.clientY,
      };
      paintAt(e.clientX, e.clientY, true, false, e.pointerType);
      return;
    }
    drag.current = {
      on: true, moved: false,
      lx: e.clientX, ly: e.clientY,
      painting: false,
      startX: e.clientX, startY: e.clientY,
    };
  }, [tool, paintAt, saveHist, cleanupGesture]);

  // ---------------------------------------------------------------------------
  // Pointer move
  // ---------------------------------------------------------------------------
  const onPM = useCallback((e) => {
    if (pointerCache.current.has(e.pointerId))
      pointerCache.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current.active && pointerCache.current.size >= 2) {
      const pts = [...pointerCache.current.values()];
      if (!pts[0] || !pts[1] ||
          !Number.isFinite(pts[0].x) || !Number.isFinite(pts[0].y) ||
          !Number.isFinite(pts[1].x) || !Number.isFinite(pts[1].y)) {
        cleanupGesture({ commit: true, clearPointers: true, clearHover: true });
        return;
      }
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const newDist = Math.hypot(dx, dy);
      if (newDist < 1) return;
      const ncx = (pts[0].x + pts[1].x) / 2;
      const ncy = (pts[0].y + pts[1].y) / 2;
      const ratio = newDist / (pinch.current.dist || 1);
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const v = vR.current;
      const rect = getCachedRect();
      const mx = ncx - rect.left, my = ncy - rect.top;
      const panDx = ncx - pinch.current.cx, panDy = ncy - pinch.current.cy;
      const G = getGrid();
      const mZ = minZoom(rect.width, rect.height, G.GRID_W, G.GRID_H);
      const nz = cl(v.zoom * ratio, mZ, 80);
      const npx = mx - (mx - v.panX) * (nz / v.zoom) + panDx;
      const npy = my - (my - v.panY) * (nz / v.zoom) + panDy;
      applyView({ zoom: nz, panX: npx, panY: npy });
      pinch.current.dist = newDist;
      pinch.current.cx = ncx;
      pinch.current.cy = ncy;
      return;
    }

    if (!drag.current.on) return;

    const t = e.pointerType;
    const threshold = t === "mouse" ? TOUCH_MOVE_THRESHOLD_MOUSE
                    : t === "touch" ? TOUCH_MOVE_THRESHOLD_TOUCH
                    : t === "pen"   ? TOUCH_MOVE_THRESHOLD_PEN
                    : TOUCH_MOVE_THRESHOLD;

    const totalDx = e.clientX - drag.current.startX;
    const totalDy = e.clientY - drag.current.startY;
    const wasMoved = drag.current.moved;
    if (!wasMoved
        && (Math.abs(totalDx) > threshold || Math.abs(totalDy) > threshold)) {
      drag.current.moved = true;
    }

    if (drag.current.painting) {
      const isErase = tool === TOOL_ERASE;
      paintStroke(drag.current.lx, drag.current.ly,
                  e.clientX, e.clientY, isErase, e.pointerType);
      drag.current.lx = e.clientX;
      drag.current.ly = e.clientY;
    } else if (drag.current.moved) {
      const dx = e.clientX - drag.current.lx;
      const dy = e.clientY - drag.current.ly;
      applyView(v => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
      drag.current.lx = e.clientX;
      drag.current.ly = e.clientY;
    }
  }, [applyView, paintStroke, tool, cleanupGesture]);

  const finishPtr = useCallback((e) => {
    pointerCache.current.delete(e.pointerId);
    releasePtr(e);
    if (pinch.current.active) {
      if (pointerCache.current.size < 2) {
        pinch.current.active = false;
        commitView();
        if (pointerCache.current.size === 1) {
          const [remaining] = pointerCache.current.values();
          drag.current = {
            on: true, moved: true,
            lx: remaining.x, ly: remaining.y,
            startX: remaining.x, startY: remaining.y,
            painting: false,
          };
          lastPaintedIdx.current = -1;
        }
      }
      return;
    }
    if (drag.current.on) {
      if (!drag.current.moved && !drag.current.painting) {
        const G = getGrid(), rect = getCachedRect(), v = vR.current;
        const wx = (e.clientX - rect.left - v.panX) / v.zoom;
        const wy = (e.clientY - rect.top  - v.panY) / v.zoom;
        const pxR = G.HR * v.zoom;
        const snapPx = getSnapRadiusPx(e.pointerType, pxR);
        const snapWorld = snapPx / v.zoom;
        const strictIdx = pixelToOddR(wx, wy, G.HR, G.ROWS, G.COLS);
        const idx = strictIdx >= 0
          ? strictIdx
          : pixelToOddRSnap(wx, wy, G.HR, G.ROWS, G.COLS, snapWorld);

        if (diagOn) {
          const entry = {
            ts: Math.round(performance.now()),
            sx: Math.round(e.clientX), sy: Math.round(e.clientY),
            wx: wx.toFixed(1), wy: wy.toFixed(1),
            idx,
            firstTouch: true,
            erase: false,
            pointerType: normPointerType(e.pointerType),
            rectLeft: Math.round(rect.left),
            rectTop: Math.round(rect.top),
            zoom: v.zoom.toFixed(3),
            panX: v.panX.toFixed(1),
            panY: v.panY.toFixed(1),
            pxR: pxR.toFixed(2),
            snapPx,
            snapped: idx >= 0 && strictIdx < 0,
          };
          setDiagInfo(entry);
          pushDiagHistory(entry);
        }

        if (idx >= 0) {
          saveHist();
          const { c, a } = getCur();
          if (c[idx] && a[idx] >= ALIVE_T) { c[idx] = 0; a[idx] = 0; }
          else { c[idx] = brR.current; a[idx] = ALIVE_T; }
          dirty.current = true;
          setUiTick(t => t + 1);
          addTapFlash(idx);
          recomputeStats();
        } else {
          addMissFlash(e.clientX, e.clientY);
        }
      }
      commitView();
      drag.current.on = false;
      drag.current.painting = false;
      lastPaintedIdx.current = -1;
    }
  }, [commitView, saveHist, releasePtr, addTapFlash, addMissFlash, diagOn,
      pushDiagHistory, recomputeStats]);

  const onHov = useCallback((e) => {
    if ((drag.current.on && drag.current.moved)
        || drag.current.painting
        || pinch.current.active) return;
    const G = getGrid(), rect = getCachedRect(), v = vR.current;
    const wx = (e.clientX - rect.left - v.panX) / v.zoom;
    const wy = (e.clientY - rect.top  - v.panY) / v.zoom;
    const idx = pixelToOddR(wx, wy, G.HR, G.ROWS, G.COLS);
    if (idx !== hvR.current) setHov(idx);
  }, []);

  const onCanvasPM = useCallback((e) => {
    onPM(e);
    if (!drag.current.painting && !drag.current.moved && !pinch.current.active) onHov(e);
  }, [onPM, onHov]);

  // Wheel handler: NR-G33 + NR-G50 + NR-G52 (deltaMode-aware)
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const onWh = (e) => {
      e.preventDefault();
      const G = getGrid(), rect = getCachedRect(), v = vR.current;
      const mZ = minZoom(rect.width, rect.height, G.GRID_W, G.GRID_H);
      if (e.ctrlKey || e.metaKey) {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        let zoomDelta;
        if (e.deltaMode === 1) {
          zoomDelta = Math.max(-2, Math.min(2, e.deltaY)) * 5;
        } else if (e.deltaMode === 2) {
          zoomDelta = Math.max(-1, Math.min(1, e.deltaY)) * 10;
        } else {
          zoomDelta = Math.max(-10, Math.min(10, e.deltaY));
        }
        const factor = Math.pow(2, -zoomDelta * 0.0125);
        const nz = cl(v.zoom * factor, mZ, 80);
        const npx = mx - (mx - v.panX) * (nz / v.zoom);
        const npy = my - (my - v.panY) * (nz / v.zoom);
        applyView({ zoom: nz, panX: npx, panY: npy }, true);
      } else {
        let scale;
        if (e.deltaMode === 1)      scale = 16;
        else if (e.deltaMode === 2) scale = rect.height || 800;
        else                        scale = 1;
        applyView(prev => ({
          zoom: prev.zoom,
          panX: prev.panX - e.deltaX * scale,
          panY: prev.panY - e.deltaY * scale,
        }), true);
      }
    };
    cv.addEventListener("wheel", onWh, { passive: false });
    return () => cv.removeEventListener("wheel", onWh);
  }, [applyView, gridSizeI]);

  // NR-G48: Safari macOS-Trackpad GestureEvent listener.
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const isMacOSSafari =
      typeof window.GestureEvent !== "undefined" &&
      typeof window.TouchEvent  === "undefined";
    if (!isMacOSSafari) return;

    let active = false;
    let lastScale = 1;
    let anchorX = 0, anchorY = 0;
    const SPEEDUP = 2;

    const onGS = (e) => {
      if (e.cancelable !== false) e.preventDefault();
      active = true;
      lastScale = e.scale || 1;
      const rect = getCachedRect();
      anchorX = (e.clientX || rect.left + rect.width / 2) - rect.left;
      anchorY = (e.clientY || rect.top  + rect.height / 2) - rect.top;
      pinch.current.active = true;
    };

    const onGC = (e) => {
      if (e.cancelable !== false) e.preventDefault();
      if (!active) return;
      const scale = e.scale || lastScale;
      let ratio = scale / lastScale;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      ratio = Math.pow(ratio, SPEEDUP);
      const v = vR.current;
      const G = getGrid();
      const rect = getCachedRect();
      const mZ = minZoom(rect.width, rect.height, G.GRID_W, G.GRID_H);
      const nz = cl(v.zoom * ratio, mZ, 80);
      const npx = anchorX - (anchorX - v.panX) * (nz / v.zoom);
      const npy = anchorY - (anchorY - v.panY) * (nz / v.zoom);
      applyView({ zoom: nz, panX: npx, panY: npy });
      lastScale = scale;
    };

    const onGE = () => {
      if (!active) return;
      active = false;
      lastScale = 1;
      pinch.current.active = false;
      commitView();
      dirty.current = true;
    };

    cv.addEventListener("gesturestart",  onGS, { passive: false });
    cv.addEventListener("gesturechange", onGC, { passive: false });
    cv.addEventListener("gestureend",    onGE);
    return () => {
      cv.removeEventListener("gesturestart",  onGS);
      cv.removeEventListener("gesturechange", onGC);
      cv.removeEventListener("gestureend",    onGE);
    };
  }, [applyView, commitView, gridSizeI]);

  // NR-G52: PerformanceObserver telemetry suite.
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const supported = PerformanceObserver.supportedEntryTypes || [];
    telemetry.current.capabilities = {
      hasObserver: true,
      longAnimationFrame: supported.includes("long-animation-frame"),
      longtask: supported.includes("longtask"),
      event: supported.includes("event"),
    };
    const observers = [];

    if (supported.includes("long-animation-frame")) {
      try {
        const o = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            telemetryPush({
              t: Date.now(),
              type: "loaf",
              duration: entry.duration,
              blockingDuration: entry.blockingDuration || 0,
              renderStart: entry.renderStart || 0,
              styleAndLayoutStart: entry.styleAndLayoutStart || 0,
            });
          }
        });
        o.observe({ type: "long-animation-frame", buffered: true });
        observers.push(o);
      } catch (err) { /* unsupported */ }
    }

    if (supported.includes("longtask")) {
      try {
        const o = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            telemetryPush({
              t: Date.now(),
              type: "longtask",
              duration: entry.duration,
              name: entry.name || "",
            });
          }
        });
        o.observe({ type: "longtask", buffered: true });
        observers.push(o);
      } catch (err) { /* skip */ }
    }

    if (supported.includes("event")) {
      try {
        const o = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!Number.isFinite(entry.duration) || entry.duration < 16) continue;
            telemetryPush({
              t: Date.now(),
              type: "event",
              duration: entry.duration,
              name: entry.name,
              inputDelay: (entry.processingStart || 0) - (entry.startTime || 0),
              processingDuration: (entry.processingEnd || 0) - (entry.processingStart || 0),
            });
          }
        });
        o.observe({ type: "event", buffered: true, durationThreshold: 16 });
        observers.push(o);
      } catch (err) { /* skip */ }
    }

    return () => {
      for (const o of observers) {
        try { o.disconnect(); } catch (e) { /* ignore */ }
      }
    };
  }, [telemetryPush]);

  // NR-G54: CSV/JSON export helpers.
  const exportTelemetry = useCallback((format) => {
    const t = telemetry.current;
    const entries = t.size < TELEMETRY_CAP
      ? t.buffer.slice(0, t.size)
      : [...t.buffer.slice(t.idx), ...t.buffer.slice(0, t.idx)];
    let body, mime, ext;
    if (format === "json") {
      body = JSON.stringify({
        version: "1.0",
        sessionStart: t.sessionStart,
        sessionEnd: Date.now(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        capabilities: t.capabilities,
        counters: {
          longTaskCount: t.longTaskCount,
          longTaskTotalMs: t.longTaskTotalMs,
          longFrameCount: t.longFrameCount,
          longFrameTotalMs: t.longFrameTotalMs,
          inpMaxMs: t.inpMaxMs,
        },
        entries,
      }, null, 2);
      mime = "application/json";
      ext  = "json";
    } else {
      const cols = ["t", "type", "duration", "name", "blockingDuration", "inputDelay"];
      const quote = (v) => {
        if (v == null) return "";
        const s = String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const header = cols.join(",");
      const rows = entries.map(e => cols.map(c => quote(e[c] != null ? e[c] : "")).join(","));
      body = header + "\n" + rows.join("\n") + "\n";
      mime = "text/csv";
      ext  = "csv";
    }
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ghx_telemetry_" + t.sessionStart + "." + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // NR-G55 + NR-G62/G63: __TEST__ bridge.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let testMode = false;
    try {
      const url = new URL(window.location.href);
      testMode = url.searchParams.get("test") === "1";
    } catch (e) { /* not a normal URL */ }
    if (!testMode) return;

    const bridge = {
      ready: false,
      version: "v17.14",
      seed: (() => {
        try {
          const url = new URL(window.location.href);
          const s = parseInt(url.searchParams.get("seed") || "42", 10);
          return Number.isFinite(s) ? s : 42;
        } catch (e) { return 42; }
      })(),
      state: () => {
        const G = getGrid();
        const { c, a } = getCur();
        let alive = 0;
        for (let i = 0; i < a.length; i++) if (a[i] === ALIVE_T) alive++;
        return {
          gen: genRef.current,
          alive,
          rows: G.ROWS,
          cols: G.COLS,
          gridSizeI,
          ruleI: ruR.current,
          wrap: wR.current,
          mix: mR.current,
          view: { ...vR.current },
        };
      },
      step: (n) => {
        // NR-G65: simPaused (a ref) is read by the rAF sim tick. Setting it
        // synchronously prevents any in-flight setTimeout from racing the
        // bridge's deterministic steps. v17.14's setRunning(false)/(true)
        // toggle was batched away by React and did not actually pause.
        const wasPaused = simPaused.current;
        simPaused.current = true;
        const count = Math.max(1, Math.min(1000, n || 1));
        try {
          for (let i = 0; i < count; i++) step(true);
        } finally {
          simPaused.current = wasPaused;
        }
        dirty.current = true;
      },
      advanceTime: (ms) => {
        const stepsApprox = Math.max(1, Math.round((ms || 16.67) / 16.67));
        const wasPaused = simPaused.current;
        simPaused.current = true;
        try {
          for (let i = 0; i < stepsApprox; i++) step(true);
        } finally {
          simPaused.current = wasPaused;
        }
        dirty.current = true;
      },
      // NR-G66: randomize accepts an optional seed override so tests can
      // reproduce a specific random initialization without first calling
      // setSeed and waiting for a re-render. When omitted, uses app state.
      randomize: (seedOverride) => randomize(seedOverride),
      clear: () => clearAll(),
      setSeed: (n) => {
        if (Number.isFinite(n)) setSeed(n | 0);
      },
      setRuleset: (i) => {
        if (Number.isInteger(i) && i >= 0 && i < RULES.length) setRI(i);
      },
      setGrid: (i) => {
        if (Number.isInteger(i) && i >= 0 && i < GRID_SIZES.length) {
          changeGridSize(i);
        }
      },
      telemetry: () => {
        const t = telemetry.current;
        return t.size < TELEMETRY_CAP
          ? t.buffer.slice(0, t.size)
          : [...t.buffer.slice(t.idx), ...t.buffer.slice(0, t.idx)];
      },
      perfStats: () => ({ ...perfStats.current }),
    };
    window.__TEST__ = bridge;
    Promise.resolve().then(() => { bridge.ready = true; });
    return () => {
      // NR-G62: explicit ready=false before teardown so any test that
      // briefly observes the bridge during unmount sees a stop signal.
      bridge.ready = false;
      try { delete window.__TEST__; }
      catch (e) { window.__TEST__ = undefined; }
    };
  }, [step, randomize, clearAll, gridSizeI, changeGridSize]);

  const onLeave = useCallback((e) => {
    pointerCache.current.delete(e.pointerId);
    try { cvRef.current?.releasePointerCapture?.(e.pointerId); }
    catch (err) { /* ignore */ }
    const gestureActive = drag.current.on || drag.current.painting || pinch.current.active;
    if (gestureActive) {
      cleanupGesture({
        commit: true,
        clearPointers: pointerCache.current.size === 0,
        clearHover: true,
      });
    } else if (hvR.current !== -1) {
      setHov(-1);
    }
  }, [cleanupGesture]);

  const cancelPtr = useCallback((e) => {
    pointerCache.current.delete(e.pointerId);
    try { cvRef.current?.releasePointerCapture?.(e.pointerId); }
    catch (err) { /* ignore */ }
    cleanupGesture({
      commit: false,
      clearPointers: true,
      clearHover: true,
    });
  }, [cleanupGesture]);

  // NR-G59: selectTool uses last observed pointer type
  const selectTool = useCallback((newTool) => {
    setTool(newTool);
    if (newTool === TOOL_PAINT || newTool === TOOL_ERASE) {
      const G = getGrid(), v = vR.current;
      const minPxR = getPaintMinPxR(lastPointerTypeRef.current);
      const pxR = G.HR * v.zoom;
      if (pxR < minPxR) {
        const targetZoom = minPxR / G.HR;
        const cv = cvRef.current;
        if (cv) {
          const cw = cv.clientWidth, ch = cv.clientHeight;
          const mx = cw / 2, my = ch / 2;
          const newPanX = mx - (mx - v.panX) * (targetZoom / v.zoom);
          const newPanY = my - (my - v.panY) * (targetZoom / v.zoom);
          applyView({ zoom: targetZoom, panX: newPanX, panY: newPanY }, true);
        }
      }
    }
  }, [applyView]);

  const onLostCapture = useCallback((e) => {
    pointerCache.current.delete(e.pointerId);
    const gestureActive = drag.current.on || drag.current.painting || pinch.current.active;
    if (gestureActive) {
      cleanupGesture({
        commit: true,
        clearPointers: pointerCache.current.size === 0,
        clearHover: true,
      });
    } else if (hvR.current !== -1) {
      setHov(-1);
    }
  }, [cleanupGesture]);

  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        if (!running) saveHist();
        setRunning(r => !r);
      } else if (e.key === "s" || e.key === "S") {
        setRunning(false);
        step(true);
      } else if (e.key === "r" || e.key === "R") {
        randomize();
      } else if (e.key === "c" || e.key === "C") {
        clearAll();
      } else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [running, randomize, clearAll, undo, step, saveHist]);

  const getVD = () => ({
    cw: cvRef.current ? cvRef.current.clientWidth  : 400,
    ch: cvRef.current ? cvRef.current.clientHeight : 300,
  });

  const shareUrl = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 1800);
      }, () => {
        // clipboard write was denied
      });
    }
  }, []);

  const rl = RULES[rI] || RULES[0];
  const G = getGrid();

  // NR-G61: scoped <style> contains only application-specific rules. Fonts
  // are loaded from index.html so we do not pay for an inline @import that
  // re-runs on every render and bypasses preconnect priorities.
  const scopedCss = `
    * { box-sizing: border-box; }
    button:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
    ::selection { background: ${T.accent}; color: #000; }
    .scanlines::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        to bottom,
        transparent 0px,
        transparent 2px,
        rgba(92,240,204,0.025) 2px,
        rgba(92,240,204,0.025) 3px
      );
      z-index: 2;
    }
    @media (max-width: 640px) {
      .ghx-header { grid-template-columns: 1fr !important; gap: 6px !important; }
      .ghx-header > .ghx-stats { justify-content: flex-start !important; gap: 10px !important; }
      .ghx-header > .ghx-badges { justify-content: flex-start !important; }
      .ghx-display-title { font-size: 22px !important; }
    }
    @keyframes ghx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .ghx-pulsing { animation: ghx-pulse 600ms ease-in-out infinite; }
    ${reducedMotion ? `
      *, *::before, *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
      .scanlines::before { display: none; }
    ` : ""}
    @media (prefers-reduced-motion: reduce) {
      .scanlines::before { display: none; }
      .ghx-pulsing { animation: none !important; }
    }
  `;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        background: T.bg,
        color: T.text,
        fontFamily: T.fontMono,
        padding: 8,
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <style>{scopedCss}</style>

      <header
        className="ghx-header"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 16,
          padding: "0 8px 8px",
          borderBottom: T.border,
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            className="ghx-display-title"
            style={{
              color: T.accent,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontFamily: T.fontDisplay,
              lineHeight: 1,
            }}
          >
            GolHex
          </span>
          <span
            style={{
              color: T.mute,
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            v17.14 &middot; COWORKER RESEARCH
          </span>
        </div>

        <div
          className="ghx-stats"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: 14,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Stat label="GEN"  value={gen} color={T.accent} big />
          <Stat label="POP"  value={deferredStats.pop} color={T.text} big />
          <Stat label="GRID" value={gs.rows + " x " + gs.cols} color={T.sub} />
          <Stat label="SPD"  value={SPLBL[spdI]} color={T.text} />
          <Stat label="RUL"  value={rl.l} color={T.accent} />
          <Stat label="FPS"  value={fps || "--"} color={T.sub} />
          {running && gps > 0 && <Stat label="g/s" value={gps} color={T.sub} />}
        </div>

        <div
          className="ghx-badges"
          style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}
        >
          {isPending && (
            <span
              className="ghx-pulsing"
              title="Grid resize in progress"
              style={{
                color: "#000",
                background: T.accent,
                fontSize: 8,
                fontWeight: 800,
                padding: "2px 6px",
                letterSpacing: "0.14em",
              }}
            >
              TRANSITION
            </span>
          )}
          {tool !== TOOL_PAN && (
            <span
              style={{
                color: "#000",
                background: tool === TOOL_ERASE ? T.red : T.yellow,
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 6px",
                letterSpacing: "0.12em",
                boxShadow: "2px 2px 0 0 rgba(0,0,0,0.3)",
              }}
            >
              {tool === TOOL_ERASE ? "ERASE" : "PAINT"}
            </span>
          )}
          {(G.HR * view.zoom) < getPaintSoftPxR("touch") && (
            <span
              className="ghx-pulsing"
              title={"Cells too small for touch (pxR=" + (G.HR * view.zoom).toFixed(1)
                     + ", touch comfort >=" + getPaintSoftPxR("touch")
                     + "). Pinch or scroll-wheel to zoom in."}
              style={{
                color: "#000",
                background: T.accent2,
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 6px",
                letterSpacing: "0.12em",
                boxShadow: "2px 2px 0 0 rgba(0,0,0,0.3)",
              }}
            >
              ZOOM IN
            </span>
          )}
          {webgpuOk !== null && (
            <span
              title={webgpuOk
                ? "WebGPU adapter available"
                : "WebGPU not available - Canvas2D path active"}
              style={{
                color: webgpuOk ? T.accent : T.mute,
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: "0.14em",
                border: "2px solid " + (webgpuOk ? T.accent : T.mute),
                padding: "1px 5px",
                lineHeight: 1.4,
              }}
            >
              {webgpuOk ? "GPU.OK" : "GPU.--"}
            </span>
          )}
          {reducedMotion && (
            <span
              title="prefers-reduced-motion active"
              style={{
                color: T.accent2,
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: "0.14em",
                border: "2px solid " + T.accent2,
                padding: "1px 5px",
                lineHeight: 1.4,
              }}
            >
              RM
            </span>
          )}
        </div>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5 }}>
        <Btn
          l={running ? "PAUSE" : "PLAY"}
          k="a"
          ariaPressed={running}
          o={() => { if (!running) saveHist(); setRunning(r => !r); }}
          title="Space"
        />
        <Btn l="STEP" o={() => { setRunning(false); step(true); }} title="S" />
        <Btn l="UNDO" o={undo} title="Ctrl+Z" />
        <Btn l="RST"  o={restart} title="Restart from first snapshot" />
        <Btn l="RAND" o={randomize} title="R" />
        <Btn l="CLR"  o={clearAll} title="C" />
        <Btn
          l="FIT"
          o={() => {
            const { cw, ch } = getVD();
            setView(fitView(cw, ch, G.GRID_W, G.GRID_H));
          }}
          title="Fit grid to viewport"
        />
        <Btn
          l="PAN"
          k={tool === TOOL_PAN ? "a" : ""}
          ariaPressed={tool === TOOL_PAN}
          o={() => selectTool(TOOL_PAN)}
          title="Pan/zoom mode (default). Tap to toggle a single cell."
        />
        <Btn
          l="PAINT"
          k={tool === TOOL_PAINT ? "a" : ""}
          ariaPressed={tool === TOOL_PAINT}
          o={() => selectTool(TOOL_PAINT)}
          title="Paint mode. Drag to fill cells with the brush color."
        />
        <Btn
          l="ERASE"
          k={tool === TOOL_ERASE ? "a" : ""}
          ariaPressed={tool === TOOL_ERASE}
          o={() => selectTool(TOOL_ERASE)}
          title="Erase mode. Drag to clear cells."
        />
        <Btn
          l={shareCopied ? "COPIED" : "SHARE"}
          k={shareCopied ? "a" : ""}
          o={shareUrl}
          title="Copy URL with current state"
        />
        <Btn
          l="DBG"
          k={diagOn ? "a" : ""}
          ariaPressed={diagOn}
          o={() => setDiagOn(d => !d)}
          title="Toggle diagnostic panel"
        />
      </div>

      <div
        className="scanlines"
        aria-busy={isPending ? "true" : "false"}
        style={{
          flex: 1,
          minHeight: 200,
          position: "relative",
          overflow: "hidden",
          border: T.border,
          background: T.bg2,
          boxShadow: T.hardShadow,
        }}
      >
        <canvas
          ref={cvRef}
          aria-label="GolHex hexagonal cellular automaton canvas"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: tool === TOOL_PAINT ? "crosshair"
                  : tool === TOOL_ERASE ? "cell"
                  : "grab",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            WebkitTapHighlightColor: "transparent",
            WebkitUserDrag: "none",
            // NR-G69: discard taps that arrive while the grid resize is
            // pending. The transition has not yet committed setGridSizeI,
            // so any tap would mutate the OLD-sized buffers - those
            // buffers are reallocated when the transition resolves and
            // the user's tap is silently lost. Disabling pointer events
            // for the duration is the standard React 18+ pattern for
            // useTransition-guarded UI.
            pointerEvents: isPending ? "none" : "auto",
          }}
          onPointerDown={onPD}
          onPointerMove={onCanvasPM}
          onPointerUp={finishPtr}
          onPointerCancel={cancelPtr}
          onPointerLeave={onLeave}
          onLostPointerCapture={onLostCapture}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
        <Btn
          l="Z-"
          o={() => {
            const { cw, ch } = getVD();
            const mZ = minZoom(cw, ch, G.GRID_W, G.GRID_H);
            applyView(v => {
              const mx = cw / 2, my = ch / 2;
              const nz = cl(v.zoom / 1.3, mZ, 80);
              const npx = mx - (mx - v.panX) * (nz / v.zoom);
              const npy = my - (my - v.panY) * (nz / v.zoom);
              return { zoom: nz, panX: npx, panY: npy };
            }, true);
          }}
          title="Zoom out"
        />
        <Btn
          l="Z+"
          o={() => {
            const { cw, ch } = getVD();
            const mZ = minZoom(cw, ch, G.GRID_W, G.GRID_H);
            applyView(v => {
              const mx = cw / 2, my = ch / 2;
              const nz = cl(v.zoom * 1.3, mZ, 80);
              const npx = mx - (mx - v.panX) * (nz / v.zoom);
              const npy = my - (my - v.panY) * (nz / v.zoom);
              return { zoom: nz, panX: npx, panY: npy };
            }, true);
          }}
          title="Zoom in"
        />
        <Btn l={rl.l} k="w" w o={() => setRI(i => (i + 1) % RULES.length)} title="Cycle rule" />
        <Btn l="SP-" o={() => setSpdI(i => cl(i - 1, 0, 7))} />
        <Btn l="SP+" o={() => setSpdI(i => cl(i + 1, 0, 7))} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
        {GRID_SIZES.map((g, i) => (
          <Btn
            key={i}
            l={g.l + " " + g.rows + "x" + g.cols}
            k={i === gridSizeI ? "a" : ""}
            ariaPressed={i === gridSizeI}
            o={() => changeGridSize(i)}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
        <Btn l={wrap ? "TORUS" : "EDGE"} k="a" ariaPressed={wrap} o={() => setWrap(w => !w)} />
        <Btn l={"S" + seed} o={() => setSeed(s => s + 1)} title="Cycle seed" />
        <Btn
          l={"D" + Math.round(DENS[denI] * 100) + "%"}
          o={() => setDenI(i => (i + 1) % DENS.length)}
        />
        <Btn
          l={mix === "circular" ? "CIRC" : "MAJ"}
          o={() => setMix(m => m === "circular" ? "majority" : "circular")}
          title="Color mix mode"
        />
        <ColorChip l="R" c={T.red}    on={brush === CR} o={() => setBrush(CR)} />
        <ColorChip l="B" c={T.blue}   on={brush === CB} o={() => setBrush(CB)} />
        <ColorChip l="Y" c={T.yellow} on={brush === CY} o={() => setBrush(CY)} />
      </div>

      <div
        style={{
          marginTop: 8,
          maxHeight: "26vh",
          overflowY: "auto",
          paddingBottom: 8,
        }}
      >
        <Sec t="PATTERNS" o={pO} g={() => setPO(x => !x)}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {PAT_KEYS.map(p => (
              <Btn
                key={p}
                l={p}
                k={p === pat ? "a" : ""}
                ariaPressed={p === pat}
                o={() => setPat(p)}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
            <Btn l={scanBusy ? "SCAN..." : "SCAN ALL RULES"} o={scan} disabled={scanBusy} />
          </div>
          {scR && (
            <div
              style={{
                color: T.accent,
                fontSize: 9,
                fontWeight: 600,
                marginTop: 6,
                fontFamily: T.fontMono,
                letterSpacing: "0.02em",
                lineHeight: 1.6,
                padding: "4px 6px",
                border: T.borderSub,
                background: T.bg2,
              }}
            >
              {scR}
            </div>
          )}
        </Sec>

        <Sec t="STATS" o={sO} g={() => setSO(x => !x)}>
          <div
            style={{
              display: "flex",
              gap: 14,
              fontVariantNumeric: "tabular-nums",
              marginBottom: 4,
            }}
          >
            <Stat label="R" value={deferredStats.r} color={T.red} />
            <Stat label="B" value={deferredStats.b} color={T.blue} />
            <Stat label="Y" value={deferredStats.y} color={T.yellow} />
          </div>
          <canvas
            ref={spkRef}
            width={300}
            height={48}
            aria-label="RGB population history sparkline"
            style={{
              width: "100%",
              height: 48,
              display: "block",
              background: T.bg2,
              border: T.borderSub,
            }}
          />
        </Sec>

        <Sec t="SLOTS" o={slO} g={() => setSlO(x => !x)}>
          <div style={{ display: "flex", gap: 4 }}>
            <Btn
              l={s0 ? "A>" : "A.-"}
              o={() => {
                if (s0) {
                  reset();
                  const { c, a } = getCur();
                  c.set(s0.c);
                  a.set(s0.a);
                  saveHist();
                  setGen(0);
                  dirty.current = true;
                  setUiTick(t => t + 1);
                  recomputeStats();
                }
              }}
              title="Load slot A"
            />
            <Btn
              l="A<"
              k="a"
              o={() => {
                const { c, a } = getCur();
                setS0({ c: Uint8Array.from(c), a: Uint8Array.from(a) });
              }}
              title="Save to slot A"
            />
            <Btn
              l={s1 ? "B>" : "B.-"}
              o={() => {
                if (s1) {
                  reset();
                  const { c, a } = getCur();
                  c.set(s1.c);
                  a.set(s1.a);
                  saveHist();
                  setGen(0);
                  dirty.current = true;
                  setUiTick(t => t + 1);
                  recomputeStats();
                }
              }}
              title="Load slot B"
            />
            <Btn
              l="B<"
              k="a"
              o={() => {
                const { c, a } = getCur();
                setS1({ c: Uint8Array.from(c), a: Uint8Array.from(a) });
              }}
              title="Save to slot B"
            />
          </div>
        </Sec>
      </div>

      {diagOn && (
        <div
          style={{
            position: "fixed",
            bottom: 12,
            right: 12,
            background: T.bg2,
            border: T.borderHi,
            color: T.text,
            fontFamily: T.fontMono,
            fontSize: 10,
            padding: "8px 10px",
            zIndex: 100,
            maxWidth: 280,
            lineHeight: 1.5,
            boxShadow: T.hardShadow,
            pointerEvents: "none",
          }}
          aria-live="polite"
          aria-label="Diagnostic last-tap info"
        >
          <div style={{ color: T.accent, fontWeight: 800, marginBottom: 4, letterSpacing: "0.12em" }}>
            DIAGNOSTIC &middot; LAST TAP
          </div>
          <div style={{
            marginBottom: 6, paddingBottom: 4,
            borderBottom: "1px dashed " + T.mute,
            color: T.sub, fontVariantNumeric: "tabular-nums",
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2, color: T.accent }}>PERF</div>
            <div>
              sim={perfStats.current.simStepMs.toFixed(2)}ms &middot; render={perfStats.current.renderMs.toFixed(2)}ms
            </div>
            <div>
              budget={perfStats.current.frameBudget.toFixed(2)}ms (60Hz target=16.67ms)
              {perfStats.current.frameBudget < 2 && (
                <span style={{ color: T.red }}> &middot; TIGHT</span>
              )}
            </div>
            {((perfStats.current.clipHits || 0) + (perfStats.current.fullHits || 0)) > 0 && (() => {
              const clip = perfStats.current.clipHits || 0;
              const full = perfStats.current.fullHits || 0;
              const ratio = (clip / (clip + full) * 100).toFixed(0);
              return (
                <div>
                  clip-hits: {clip}/{clip + full} ({ratio}%)
                </div>
              );
            })()}
            {dirtyBBox.current.valid && (
              <div>
                bbox: r{dirtyBBox.current.minRow}-{dirtyBBox.current.maxRow}{" "}
                c{dirtyBBox.current.minCol}-{dirtyBBox.current.maxCol}
              </div>
            )}
          </div>
          <div style={{
            marginBottom: 6, paddingBottom: 4,
            borderBottom: "1px dashed " + T.mute,
            color: T.sub, fontVariantNumeric: "tabular-nums",
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2, color: T.accent }}>TELEMETRY</div>
            <div>
              caps: LoAF={String(telemetry.current.capabilities.longAnimationFrame)} &middot;{" "}
              LT={String(telemetry.current.capabilities.longtask)} &middot;{" "}
              EV={String(telemetry.current.capabilities.event)}
            </div>
            <div>
              long-tasks: {telemetry.current.longTaskCount} (sum{" "}
              {telemetry.current.longTaskTotalMs.toFixed(0)}ms)
            </div>
            <div>
              long-frames: {telemetry.current.longFrameCount} (sum{" "}
              {telemetry.current.longFrameTotalMs.toFixed(0)}ms)
            </div>
            <div>
              INP-max: {telemetry.current.inpMaxMs.toFixed(0)}ms &middot;{" "}
              buf: {telemetry.current.size}/{TELEMETRY_CAP}
            </div>
            <div style={{ marginTop: 4, display: "flex", gap: 4, pointerEvents: "auto" }}>
              <button
                onClick={() => exportTelemetry("csv")}
                style={{
                  fontSize: 10, padding: "2px 6px",
                  background: T.btn, color: T.text,
                  border: T.borderSub, fontFamily: T.fontMono,
                  cursor: "pointer",
                }}
                title="Export ring buffer as RFC-4180 CSV"
              >
                CSV
              </button>
              <button
                onClick={() => exportTelemetry("json")}
                style={{
                  fontSize: 10, padding: "2px 6px",
                  background: T.btn, color: T.text,
                  border: T.borderSub, fontFamily: T.fontMono,
                  cursor: "pointer",
                }}
                title="Export ring buffer as JSON envelope"
              >
                JSON
              </button>
            </div>
          </div>
          {diagInfo ? (
            <div style={{ fontVariantNumeric: "tabular-nums" }}>
              <div>ts={diagInfo.ts}ms</div>
              <div>screen=({diagInfo.sx},{diagInfo.sy}) rect=({diagInfo.rectLeft},{diagInfo.rectTop})</div>
              <div>world=({diagInfo.wx},{diagInfo.wy})</div>
              <div>view: zoom={diagInfo.zoom} pan=({diagInfo.panX},{diagInfo.panY})</div>
              <div>
                idx=<b style={{ color: diagInfo.idx >= 0 ? T.accent : T.red }}>
                  {diagInfo.idx}
                </b>
                {diagInfo.idx < 0 && " (MISSED grid)"}
                {diagInfo.snapped && (
                  <span style={{ color: T.accent2 }}> [SNAPPED]</span>
                )}
              </div>
              <div>type: {diagInfo.firstTouch ? "tap" : (diagInfo.erase ? "stroke-erase" : "stroke-paint")}</div>
              <div style={{ marginTop: 4, color: T.sub }}>
                pxR={(G.HR * view.zoom).toFixed(2)} &middot;
                {" "}touch&gt;={getPaintSoftPxR("touch")}{" "}
                {(G.HR * view.zoom) < getPaintSoftPxR("touch") && (
                  <span style={{ color: T.accent2 }}> &middot; TOO SMALL FOR TOUCH</span>
                )}
              </div>
              {diagInfo.pointerType && (
                <div style={{ color: T.sub }}>pointerType: {diagInfo.pointerType} (snapPx={diagInfo.snapPx})</div>
              )}
              {diagHistory.length > 1 && (
                <div style={{ marginTop: 6, paddingTop: 4, borderTop: "1px dashed " + T.mute, color: T.sub }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>HISTORY</div>
                  {diagHistory.slice(1).map((h, i) => (
                    <div key={h.ts + ":" + i} style={{ fontSize: 9 }}>
                      {h.firstTouch ? "tap" : "drag"} idx=
                      <span style={{ color: h.idx >= 0 ? T.text : T.red }}>{h.idx}</span>
                      {" "}@({h.sx},{h.sy})
                      {h.snapped && <span style={{ color: T.accent2 }}> [S]</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: T.mute }}>Tap any cell to see diagnostics</div>
          )}
        </div>
      )}

      <footer
        style={{
          marginTop: 6,
          color: T.mute,
          fontSize: 8,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          textAlign: "center",
          fontWeight: 700,
          paddingTop: 6,
          borderTop: T.border,
        }}
      >
        v17.14 &middot; GOLHEX &middot; COWORKER RESEARCH &middot; CARTER-BAYS HEX TOPOLOGY &middot; WCAG 2.5.8 AA &middot; SAFARI GESTUREEVENT &middot; LOAF/LONGTASK/EVENT TELEMETRY &middot; CSV/JSON EXPORT &middot; __TEST__ BRIDGE
      </footer>
    </div>
  );
}
