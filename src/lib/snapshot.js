// =============================================================================
// GolHex v33 — Canvas-Snapshot + Teilen (PR-D)
// Pure, framework-freie Helfer + ein DOM-naher, aber injizierbarer Share/Download-
// Dispatcher. Kein React-Import, damit Dateinamen-Builder, Label-Formatierung und
// die Share-vs-Download-Entscheidung in Vitest/jsdom unit-testbar bleiben.
//
// Designentscheide (AGENTS.md §3 "keine schweren Runtime-Deps"):
//   - KEINE Lib (html2canvas/file-saver): canvas.toBlob ist nativ; Web Share API
//     Level 2 (navigator.canShare/share) + <a download>-Fallback reichen.
//   - Reihenfolge laut Recherche-Report Thema 4: zuerst canShare({files}) pruefen,
//     dann share({files,...}); sonst Download-Fallback. PNG = verlustfrei (CA-Gitter).
//   - share() MUSS im selben User-Gesten-Tick laufen (iOS-Anforderung). Deshalb
//     erzeugen wir den Blob synchron VOR der Entscheidung nicht moeglich (toBlob ist
//     async) — Loesung: der Aufrufer ruft takeSnapshot() direkt im click-Handler und
//     wir reichen das bereits ermittelte Blob in shareOrDownloadBlob durch; der
//     share()-Call passiert im selben Microtask-Zweig nach toBlob (Praxis-OK in
//     iOS 15+; Reality-Anchor: nur am echten iPhone final verifizierbar).
// =============================================================================

/** Zweistelliger 0-gepadeter String (lokale Datums-/Zeitkomponenten). */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Baut den Snapshot-Dateinamen: golhex_<YYYY-MM-DD>_gen<N>.png
 * @param {Date}   [date=new Date()] Zeitpunkt (lokale Zeitzone).
 * @param {number} [gen=0]           Generation (>=0, ganzzahlig).
 * @param {"png"|"jpg"} [ext="png"]  Dateiendung.
 * @returns {string}
 */
export function buildSnapshotFilename(date = new Date(), gen = 0, ext = "png") {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date(0);
  const g = Number.isFinite(gen) && gen >= 0 ? Math.floor(gen) : 0;
  const e = ext === "jpg" || ext === "jpeg" ? "jpg" : "png";
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `golhex_${ymd}_gen${g}.png`.replace(/\.png$/, `.${e}`);
}

/**
 * Baut das dezente Wasserzeichen/Label: "GolHex · Gen N · <ruleLabel>".
 * Leeres/fehlendes ruleLabel wird weggelassen (kein "· —"-Schwanz).
 * @param {number} gen           Generation.
 * @param {string} [ruleLabel]   z.B. "B2/S34" oder "HQST".
 * @returns {string}
 */
export function buildWatermarkLabel(gen, ruleLabel) {
  const g = Number.isFinite(gen) && gen >= 0 ? Math.floor(gen) : 0;
  const parts = ["GolHex", `Gen ${g}`];
  if (ruleLabel && String(ruleLabel).trim() && String(ruleLabel).trim() !== "—") {
    parts.push(String(ruleLabel).trim());
  }
  return parts.join(" · ");
}

/** MIME-Typ aus Format-Kuerzel. */
export function mimeForFormat(ext) {
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
}

/**
 * canvas.toBlob als Promise (null-Guard). Lehnt ab, wenn der Canvas keinen Blob
 * liefert (z.B. tainted oder 0x0). Standard PNG.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [type="image/png"]
 * @param {number} [quality]  nur fuer image/jpeg relevant (0..1).
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== "function") {
      reject(new Error("snapshot: canvas.toBlob nicht verfuegbar"));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0) {
          reject(new Error("snapshot: toBlob lieferte null/leeren Blob"));
        } else {
          resolve(blob);
        }
      },
      type,
      quality
    );
  });
}

/**
 * Teilt einen Blob per Web Share API (Level 2, Dateien) ODER faellt auf einen
 * <a download>-Klick zurueck. Reine Logik mit injizierbarer Umgebung (Tests).
 *
 * Ablauf (Recherche Thema 4):
 *   1. File aus Blob bauen.
 *   2. nav.canShare?.({files:[file]}) === true  -> nav.share({files,title,text})
 *      - bei Erfolg: { method:"share", shared:true }
 *      - bei Reject/AbortError: Download-Fallback (User hat ggf. abgebrochen ->
 *        wir bieten den Download NICHT erneut an, sondern melden cancelled).
 *   3. sonst: Download-Fallback (ObjectURL + <a download>, URL revoken).
 *
 * @param {Blob}   blob
 * @param {string} filename
 * @param {object} [opts]
 * @param {string} [opts.title="GolHex"]
 * @param {string} [opts.text]
 * @param {Navigator} [opts.navigatorObj=globalThis.navigator]
 * @param {Document}  [opts.documentObj=globalThis.document]
 * @param {object}    [opts.urlObj=globalThis.URL]
 * @returns {Promise<{method:"share"|"download", shared?:boolean, cancelled?:boolean}>}
 */
export async function shareOrDownloadBlob(blob, filename, opts = {}) {
  if (!blob || blob.size === 0) throw new Error("snapshot: kein Blob zum Teilen");
  const nav = opts.navigatorObj || (typeof navigator !== "undefined" ? navigator : undefined);
  const doc = opts.documentObj || (typeof document !== "undefined" ? document : undefined);
  const urlObj = opts.urlObj || (typeof URL !== "undefined" ? URL : undefined);
  const title = opts.title || "GolHex";
  const text = opts.text;

  // File aus Blob (gleicher Typ).
  let file;
  try {
    file = new File([blob], filename, { type: blob.type || "image/png" });
  } catch {
    file = blob; // sehr alte Umgebung ohne File-Konstruktor -> Blob direkt
  }

  // 1) Web Share API Level 2 (Dateien). canShare MUSS true sein, sonst kein share.
  if (
    nav &&
    typeof nav.share === "function" &&
    typeof nav.canShare === "function" &&
    file instanceof (typeof File !== "undefined" ? File : Object) &&
    nav.canShare({ files: [file] })
  ) {
    try {
      const payload = { files: [file], title };
      if (text) payload.text = text;
      await nav.share(payload);
      return { method: "share", shared: true };
    } catch (e) {
      // AbortError = User hat das Share-Sheet geschlossen. Nicht als Fehler werten,
      // aber auch NICHT automatisch downloaden (er wollte ja nicht teilen).
      if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) {
        return { method: "share", shared: false, cancelled: true };
      }
      // Anderer Fehler (z.B. share() warf trotz canShare) -> Download-Fallback.
    }
  }

  // 2) Download-Fallback.
  if (!doc || !urlObj || typeof urlObj.createObjectURL !== "function") {
    throw new Error("snapshot: weder Web Share noch Download verfuegbar");
  }
  const url = urlObj.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  if (doc.body) doc.body.appendChild(a);
  a.click();
  if (doc.body && a.parentNode === doc.body) doc.body.removeChild(a);
  // Revoke verzoegert, damit der Klick die URL noch aufloesen kann.
  setTimeout(() => {
    try { urlObj.revokeObjectURL(url); } catch { /* ignore */ }
  }, 1000);
  return { method: "download" };
}
