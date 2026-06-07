// =============================================================================
// GolHex OffscreenCanvas-Worker Feature-Detection (AP-1).
// Reine, testbare Erkennung, ob der Off-Main-Thread-Render-Pfad verfuegbar ist.
// Fail-closed: im Zweifel (fehlende API, alte Safari/Browser, kein Worker)
// liefert die Funktion false -> der Haupt-Thread-Pfad (Fallback) laeuft voll.
//
// Geprueft (alle drei muessen wahr sein):
//   1. OffscreenCanvas-Konstruktor existiert.
//   2. HTMLCanvasElement.transferControlToOffscreen existiert (Render-Transfer).
//   3. Worker-Konstruktor existiert (off-main-thread Ausfuehrung).
// Quelle: MDN OffscreenCanvas / transferControlToOffscreen Browser-Compat.
// =============================================================================

/**
 * @param {object} [env] Test-Hook: ueberschreibbares Globals-Objekt
 *   (Default = globalThis). Erlaubt deterministische Negativ-Tests ohne DOM.
 * @returns {boolean} true wenn der OffscreenCanvas-Worker-Pfad sicher nutzbar ist.
 */
export function supportsOffscreenWorker(env) {
  const g = env || (typeof globalThis !== "undefined" ? globalThis : {});
  try {
    const hasOffscreen = typeof g.OffscreenCanvas !== "undefined" && typeof g.OffscreenCanvas === "function";
    const hasWorker = typeof g.Worker !== "undefined" && typeof g.Worker === "function";
    const Canvas = g.HTMLCanvasElement;
    const hasTransfer = !!Canvas && !!Canvas.prototype &&
      typeof Canvas.prototype.transferControlToOffscreen === "function";
    return hasOffscreen && hasWorker && hasTransfer;
  } catch {
    return false; // jede Ausnahme = nicht unterstuetzt (fail-closed)
  }
}
