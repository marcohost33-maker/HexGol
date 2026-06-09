// =============================================================================
// GolHex v34 — Aufnahme der Feld-Evolution als teilbares Video (Feature 2)
// Pure, framework-freie Logik + ein DOM-/Browser-naher, aber INJIZIERBARER
// MediaRecorder-Controller. Kein React-Import, damit Zustandsmaschine, Dauer-
// Formatter, Codec-Aushandlung und Feature-Detection in Vitest/jsdom unit-testbar
// bleiben (Browser-APIs hinter einer duennen, in Tests mockbaren Schnittstelle).
//
// Designentscheide (AGENTS.md §3 "keine schweren Runtime-Deps"):
//   - KEINE GIF-Lib (gif.js ~30KB+ gz, Worker-Setup): canvas.captureStream() +
//     MediaRecorder ist nativ und dep-frei. Ergebnis = WebM (Chrome/Firefox/
//     Android) oder MP4/H.264 (Safari/iOS, wo verfuegbar). Teilen via Web Share
//     Level 2 (s. snapshot.js shareOrDownloadBlob) bzw. Download-Fallback.
//   - EHRLICHKEIT (Reality-Anchor, recherchiert 2026-06-09): canvas.captureStream()
//     + MediaRecorder ist auf iOS-Safari HISTORISCH unzuverlaessig — der
//     captureStream-Video-Track enthielt teils keine gueltigen Daten und
//     MediaRecorder.stop() konnte die Seite einfrieren (WebKit Bug 181663).
//     Safari unterstuetzt NUR den MP4/H.264-Container (kein WebM). Neuere
//     WebKit-Fixes (2026) verbessern das, aber FINAL verifizierbar ist es nur am
//     echten iPhone. Deshalb: Feature-Detection fail-closed + ehrliche UI-/
//     README-Caveat, KEIN Ueberversprechen. Quellen im README + PR.
//   - Container/Codec wird per MediaRecorder.isTypeSupported() in Praeferenz-
//     Reihenfolge ausgehandelt: zuerst mp4/h264 (iOS-tauglich, breit teilbar),
//     dann webm/vp9, webm/vp8, webm. So bekommt jeder Browser sein bestes Format.
// =============================================================================

/**
 * Praeferenz-Reihenfolge der MIME-Typen fuer die Aufnahme.
 * mp4/h264 zuerst: das EINZIGE von iOS-Safari unterstuetzte Format und auf
 * Apple-Geraeten am breitesten weiterteilbar. Danach die WebM-Varianten fuer
 * Chrome/Firefox/Android (dort meist hoehere Qualitaet/Effizienz).
 * @type {string[]}
 */
/**
 * Maximale Clip-Dauer in Millisekunden. Ohne Limit fuellt eine lange Aufnahme
 * EINEN In-Memory-Blob unbegrenzt (kein timeslice) -> Speicher-Leck bei langen
 * Sessions (Codex-Review Befund 6). Bei Erreichen stoppt der Controller die
 * Aufnahme automatisch sauber (wie ein manueller Stop) und publiziert den Clip.
 * 2 Minuten ist fuer einen teilbaren Evolutions-Clip grosszuegig.
 * @type {number}
 */
export const RECORDER_MAX_DURATION_MS = 120_000;

export const RECORDER_MIME_PREFERENCE = [
  "video/mp4;codecs=h264",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm;codecs=h264",
  "video/webm",
];

/**
 * Endung zum MIME-Typ (fuer den Datei-/Share-Namen).
 * @param {string} mime z.B. "video/webm;codecs=vp9"
 * @returns {"mp4"|"webm"}
 */
export function extForMime(mime) {
  return typeof mime === "string" && mime.indexOf("mp4") !== -1 ? "mp4" : "webm";
}

/**
 * Waehlt den ersten unterstuetzten MIME-Typ aus der Praeferenzliste.
 * Fail-closed: fehlt MediaRecorder oder isTypeSupported, gibt es null zurueck
 * (Aufrufer schaltet die Aufnahme dann sauber ab, statt zu crashen).
 * @param {object} [env]
 * @param {typeof MediaRecorder} [env.MediaRecorderCtor=globalThis.MediaRecorder]
 * @returns {string|null} unterstuetzter MIME-Typ oder null
 */
export function pickSupportedMime(env = {}) {
  const MR =
    env.MediaRecorderCtor !== undefined
      ? env.MediaRecorderCtor
      : typeof MediaRecorder !== "undefined"
        ? MediaRecorder
        : undefined;
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  for (const mime of RECORDER_MIME_PREFERENCE) {
    try {
      if (MR.isTypeSupported(mime)) return mime;
    } catch {
      /* defekte Implementierung -> naechsten probieren */
    }
  }
  return null;
}

/**
 * Prueft fail-closed, ob die Aufnahme im aktuellen Umfeld grundsaetzlich
 * moeglich ist: Canvas mit captureStream UND ein unterstuetztes MediaRecorder-
 * Format. Wirft NIE — gibt ein Diagnose-Objekt zurueck.
 * @param {HTMLCanvasElement|null} canvas
 * @param {object} [env]
 * @param {typeof MediaRecorder} [env.MediaRecorderCtor]
 * @returns {{ ok: boolean, mime: string|null, reason: string }}
 */
export function detectRecordingSupport(canvas, env = {}) {
  const MR =
    env.MediaRecorderCtor !== undefined
      ? env.MediaRecorderCtor
      : typeof MediaRecorder !== "undefined"
        ? MediaRecorder
        : undefined;
  if (!MR) return { ok: false, mime: null, reason: "MediaRecorder fehlt" };
  if (!canvas || typeof canvas.captureStream !== "function") {
    return { ok: false, mime: null, reason: "canvas.captureStream fehlt" };
  }
  const mime = pickSupportedMime({ MediaRecorderCtor: MR });
  if (!mime) return { ok: false, mime: null, reason: "kein unterstuetztes Videoformat" };
  return { ok: true, mime, reason: "" };
}

/**
 * Formatiert eine Dauer in Millisekunden als mm:ss (auf-/abgerundet auf ganze
 * Sekunden, floor). Negative/NaN -> "00:00". Stunden werden in Minuten
 * weitergezaehlt (z.B. 75 min -> "75:00"), da Clips kurz sind.
 * @param {number} ms
 * @returns {string} "mm:ss"
 */
export function formatDuration(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Baut den Clip-Dateinamen: golhex_<YYYY-MM-DD>_clip.<ext>
 * @param {Date} [date=new Date()]
 * @param {"mp4"|"webm"} [ext="webm"]
 * @returns {string}
 */
export function buildClipFilename(date = new Date(), ext = "webm") {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date(0);
  const e = ext === "mp4" ? "mp4" : "webm";
  const p2 = (n) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return `golhex_${ymd}_clip.${e}`;
}

// --- Zustandsmaschine --------------------------------------------------------
// idle -> recording -> encoding -> idle   (Normalpfad)
//   *  -> error (von idle/recording aus, wenn API fehlt oder onerror feuert)
// Die Maschine ist REIN (kein DOM): sie verwaltet nur den Zustandsnamen +
// erlaubte Uebergaenge. Der MediaRecorderController unten haengt die echten
// Browser-Effekte daran. So sind die Uebergaenge isoliert unit-testbar.
export const REC_STATES = Object.freeze({
  IDLE: "idle",
  RECORDING: "recording",
  ENCODING: "encoding",
  ERROR: "error",
});

/** Erlaubte Uebergaenge je Quellzustand. */
const ALLOWED = Object.freeze({
  idle: ["recording", "error"],
  recording: ["encoding", "error", "idle"], // idle = harter Reset/abort
  encoding: ["idle", "error"],
  error: ["idle"], // nur zuruecksetzen
});

/**
 * Erzeugt eine reine Recorder-Zustandsmaschine. Kein Browser-Zugriff.
 * @param {(state:string)=>void} [onChange] Callback bei jedem Wechsel.
 * @returns {{
 *   state:()=>string,
 *   can:(target:string)=>boolean,
 *   to:(target:string)=>boolean,
 *   reset:()=>void,
 * }}
 */
export function createRecorderMachine(onChange) {
  let state = REC_STATES.IDLE;
  const emit = () => { if (typeof onChange === "function") onChange(state); };
  return {
    state: () => state,
    can: (target) => (ALLOWED[state] || []).indexOf(target) !== -1,
    to(target) {
      if (!Object.values(REC_STATES).includes(target)) return false;
      if (state === target) return true; // idempotent, kein Crash
      if ((ALLOWED[state] || []).indexOf(target) === -1) return false;
      state = target;
      emit();
      return true;
    },
    reset() {
      if (state !== REC_STATES.IDLE) { state = REC_STATES.IDLE; emit(); }
    },
  };
}

/**
 * Duenne, mockbare Huelle um canvas.captureStream() + MediaRecorder.
 * Kapselt den GANZEN Browser-Lebenszyklus hinter start()/stop(), damit App.tsx
 * keine MediaRecorder-Details kennt und Tests den Controller ohne echtes
 * Browser-API treiben koennen (env-Injektion).
 *
 * Lebenszyklus:
 *   start(): support pruefen -> captureStream(fps) -> MediaRecorder(stream,{mime})
 *            -> dataavailable sammelt Chunks -> Maschine: idle->recording.
 *   stop():  recorder.stop() -> onstop baut Blob aus Chunks -> Maschine:
 *            recording->encoding->idle, ruft onResult(blob, mime, durationMs).
 *   Fehler:  onerror ODER fehlende API -> Maschine->error, onError(reason).
 *
 * @param {object} cfg
 * @param {HTMLCanvasElement} cfg.canvas        aufzunehmender Canvas
 * @param {number} [cfg.fps=30]                 Capture-Framerate
 * @param {(blob:Blob, mime:string, durationMs:number)=>void} [cfg.onResult]
 * @param {(reason:string)=>void} [cfg.onError]
 * @param {(state:string)=>void} [cfg.onState]
 * @param {()=>number} [cfg.now=()=>Date.now()] Zeitquelle (Tests: deterministisch)
 * @param {number} [cfg.maxDurationMs=RECORDER_MAX_DURATION_MS] Auto-Stop-Limit (Befund 6)
 * @param {(cb:()=>void, ms:number)=>any} [cfg.setTimer=setTimeout] injizierbar (Tests)
 * @param {(id:any)=>void} [cfg.clearTimer=clearTimeout] injizierbar (Tests)
 * @param {typeof MediaRecorder} [cfg.MediaRecorderCtor] Tests: Mock-Ctor
 * @returns {{
 *   start:()=>boolean,
 *   stop:()=>boolean,
 *   state:()=>string,
 *   mime:()=>string|null,
 *   isActive:()=>boolean,
 * }}
 */
export function createRecorderController(cfg) {
  const canvas = cfg && cfg.canvas;
  const fps = Number.isFinite(cfg && cfg.fps) && cfg.fps > 0 ? cfg.fps : 30;
  const onResult = (cfg && cfg.onResult) || (() => {});
  const onError = (cfg && cfg.onError) || (() => {});
  const onState = cfg && cfg.onState;
  const now = (cfg && cfg.now) || (() => Date.now());
  const maxDurationMs =
    Number.isFinite(cfg && cfg.maxDurationMs) && cfg.maxDurationMs > 0
      ? cfg.maxDurationMs
      : RECORDER_MAX_DURATION_MS;
  const setTimer = (cfg && cfg.setTimer) ||
    (typeof setTimeout !== "undefined" ? setTimeout : null);
  const clearTimer = (cfg && cfg.clearTimer) ||
    (typeof clearTimeout !== "undefined" ? clearTimeout : null);
  const MR =
    cfg && cfg.MediaRecorderCtor !== undefined
      ? cfg.MediaRecorderCtor
      : typeof MediaRecorder !== "undefined"
        ? MediaRecorder
        : undefined;

  const machine = createRecorderMachine(onState);
  let recorder = null;
  let stream = null;
  let chunks = [];
  let mime = null;
  let t0 = 0;
  // Lebenszyklus-Guards (Codex-Review Befunde 1 + 2):
  //  - settled: nach onstop/fail() ist dieser Controller endgueltig erledigt;
  //    spaetere Browser-Events (verzoegertes dataavailable/stop NACH error)
  //    duerfen NICHT erneut publizieren (kein onResult nach Error, Befund 2).
  //  - stopping: zwischen stop() und onstop ist die Aufnahme bereits beendet;
  //    ein zweiter Stop-Tap darf recorder.stop() NICHT erneut aufrufen
  //    (sonst InvalidStateError auf inaktivem Recorder, Befund 1).
  let settled = false;
  let stopping = false;
  let autoStopTimer = null;

  function clearAutoStop() {
    if (autoStopTimer !== null && clearTimer) {
      try { clearTimer(autoStopTimer); } catch { /* ignore */ }
    }
    autoStopTimer = null;
  }

  function detachRecorder() {
    // Handler kappen, damit verspaetete Events nach fail()/onstop nichts mehr
    // ausloesen (Befund 2: Error -> spaeter onstop -> korrupter onResult).
    if (recorder) {
      try { recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; }
      catch { /* ignore */ }
    }
  }

  function cleanupStream() {
    if (stream && typeof stream.getTracks === "function") {
      try { stream.getTracks().forEach((t) => t.stop && t.stop()); } catch { /* ignore */ }
    }
    stream = null;
  }

  function fail(reason) {
    if (settled) return;          // schon erledigt -> kein doppeltes onError
    settled = true;
    clearAutoStop();
    detachRecorder();
    cleanupStream();
    recorder = null;
    chunks = [];
    machine.to(REC_STATES.ERROR);
    onError(reason);
  }

  function publishOnStop() {
    if (settled) return;          // Befund 2: kein onResult nach vorherigem Error
    settled = true;
    clearAutoStop();
    const durationMs = Math.max(0, now() - t0);
    const blob = new Blob(chunks, { type: mime });
    detachRecorder();
    cleanupStream();
    recorder = null;
    chunks = [];
    // recording -> encoding -> idle
    machine.to(REC_STATES.ENCODING);
    if (!blob || blob.size === 0) {
      // Silent-Failure-Gate: leeres Ergebnis ehrlich als Fehler melden,
      // nicht als "fertig" mit 0-Byte-Datei (iOS-captureStream-Risiko).
      machine.to(REC_STATES.ERROR);
      onError("leere Aufnahme (0 Bytes) — Format evtl. nicht unterstuetzt");
      return;
    }
    machine.to(REC_STATES.IDLE);
    onResult(blob, mime, durationMs);
  }

  function doStop() {
    // Idempotenter Stop (Befund 1): nur EIN recorder.stop(), danach gesperrt.
    if (stopping || settled || machine.state() !== REC_STATES.RECORDING || !recorder) {
      return false;
    }
    stopping = true;
    clearAutoStop();
    try {
      recorder.stop();
    } catch (e) {
      fail("recorder.stop warf: " + (e && e.message ? e.message : e));
      return false;
    }
    return true;
  }

  return {
    state: () => machine.state(),
    mime: () => mime,
    isActive: () => machine.state() === REC_STATES.RECORDING && !stopping,

    start() {
      if (machine.state() !== REC_STATES.IDLE) return false;
      const sup = detectRecordingSupport(canvas, { MediaRecorderCtor: MR });
      if (!sup.ok) { fail(sup.reason); return false; }
      mime = sup.mime;
      try {
        stream = canvas.captureStream(fps);
      } catch (e) {
        fail("captureStream warf: " + (e && e.message ? e.message : e));
        return false;
      }
      if (!stream) { fail("captureStream lieferte keinen Stream"); return false; }
      try {
        recorder = new MR(stream, { mimeType: mime });
      } catch (e) {
        fail("MediaRecorder warf: " + (e && e.message ? e.message : e));
        return false;
      }
      chunks = [];
      recorder.ondataavailable = (ev) => {
        if (ev && ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = (ev) => {
        const r = ev && ev.error && ev.error.message ? ev.error.message : "Recorder-Fehler";
        fail(r);
      };
      recorder.onstop = () => { publishOnStop(); };
      try {
        t0 = now();
        recorder.start();
      } catch (e) {
        fail("recorder.start warf: " + (e && e.message ? e.message : e));
        return false;
      }
      machine.to(REC_STATES.RECORDING);
      // Befund 6: Auto-Stop nach Max-Dauer -> bounded Speicher, sauberer Clip.
      if (setTimer) {
        autoStopTimer = setTimer(() => { autoStopTimer = null; doStop(); }, maxDurationMs);
      }
      return true;
    },

    stop() { return doStop(); },
  };
}
