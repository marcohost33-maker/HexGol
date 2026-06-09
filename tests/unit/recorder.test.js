// v34 Feature 2: Aufnahme der Feld-Evolution -> teilbares Video.
// Unit-Tests fuer die PUREN Helfer, die Zustandsmaschine und den mockbaren
// MediaRecorder-Controller. Korrektheits-Orakel: feste Erwartungen +
// gestubte Browser-APIs (kein echtes MediaRecorder/captureStream).
// Silent-Failure-Gate: Edge-/Negativ-Inputs (fehlende API, 0-Byte-Blob,
// invalide Uebergaenge) fail-before-Tests, nicht als spaeterer Glueckstreffer.
import { describe, it, expect, vi } from "vitest";
import {
  RECORDER_MIME_PREFERENCE,
  REC_STATES,
  extForMime,
  pickSupportedMime,
  detectRecordingSupport,
  formatDuration,
  buildClipFilename,
  createRecorderMachine,
  createRecorderController,
} from "../../src/lib/recorder.js";

describe("extForMime", () => {
  it("mp4 fuer mp4-Container", () => {
    expect(extForMime("video/mp4;codecs=h264")).toBe("mp4");
    expect(extForMime("video/mp4")).toBe("mp4");
  });
  it("webm sonst (inkl. Unsinn-Input)", () => {
    expect(extForMime("video/webm;codecs=vp9")).toBe("webm");
    expect(extForMime("")).toBe("webm");
    expect(extForMime(null)).toBe("webm");
    expect(extForMime(undefined)).toBe("webm");
  });
});

describe("pickSupportedMime (Codec-Aushandlung, fail-closed)", () => {
  it("waehlt den ERSTEN unterstuetzten Typ aus der Praeferenz", () => {
    // Nur webm/vp8 unterstuetzt -> mp4-Praeferenzen werden uebersprungen.
    const MediaRecorderCtor = {
      isTypeSupported: (m) => m === "video/webm;codecs=vp8",
    };
    expect(pickSupportedMime({ MediaRecorderCtor })).toBe("video/webm;codecs=vp8");
  });
  it("bevorzugt mp4/h264 wenn verfuegbar (iOS-tauglich, vor webm)", () => {
    const MediaRecorderCtor = { isTypeSupported: () => true };
    expect(pickSupportedMime({ MediaRecorderCtor })).toBe(RECORDER_MIME_PREFERENCE[0]);
    expect(RECORDER_MIME_PREFERENCE[0]).toBe("video/mp4;codecs=h264");
  });
  it("null wenn KEIN Typ unterstuetzt wird (fail-closed)", () => {
    const MediaRecorderCtor = { isTypeSupported: () => false };
    expect(pickSupportedMime({ MediaRecorderCtor })).toBeNull();
  });
  it("null wenn MediaRecorder/isTypeSupported fehlt (kein Crash)", () => {
    expect(pickSupportedMime({ MediaRecorderCtor: null })).toBeNull();
    expect(pickSupportedMime({ MediaRecorderCtor: {} })).toBeNull();
  });
  it("ueberspringt Typen, deren isTypeSupported wirft", () => {
    const MediaRecorderCtor = {
      isTypeSupported: (m) => {
        if (m.indexOf("mp4") !== -1) throw new Error("kaputt");
        return m === "video/webm;codecs=vp9";
      },
    };
    expect(pickSupportedMime({ MediaRecorderCtor })).toBe("video/webm;codecs=vp9");
  });
});

describe("detectRecordingSupport (fail-closed Diagnose)", () => {
  const okCanvas = { captureStream: () => ({}) };
  const okMR = { isTypeSupported: () => true };
  it("ok wenn Canvas+captureStream+MIME vorhanden", () => {
    const r = detectRecordingSupport(okCanvas, { MediaRecorderCtor: okMR });
    expect(r.ok).toBe(true);
    expect(r.mime).toBe("video/mp4;codecs=h264");
    expect(r.reason).toBe("");
  });
  it("nicht ok ohne MediaRecorder", () => {
    const r = detectRecordingSupport(okCanvas, { MediaRecorderCtor: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/MediaRecorder/);
  });
  it("nicht ok ohne captureStream (alter Safari)", () => {
    const r = detectRecordingSupport({}, { MediaRecorderCtor: okMR });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/captureStream/);
  });
  it("nicht ok wenn kein Videoformat unterstuetzt", () => {
    const r = detectRecordingSupport(okCanvas, { MediaRecorderCtor: { isTypeSupported: () => false } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Videoformat/);
  });
  it("nicht ok bei null-Canvas (kein Crash)", () => {
    const r = detectRecordingSupport(null, { MediaRecorderCtor: okMR });
    expect(r.ok).toBe(false);
  });
});

describe("formatDuration (mm:ss)", () => {
  it("formatiert Sekunden/Minuten mit 0-Padding", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(5_000)).toBe("00:05");
    expect(formatDuration(65_000)).toBe("01:05");
    expect(formatDuration(600_000)).toBe("10:00");
  });
  it("floor auf ganze Sekunden", () => {
    expect(formatDuration(5_999)).toBe("00:05");
    expect(formatDuration(59_900)).toBe("00:59");
  });
  it("negative/NaN -> 00:00 (kein Crash, fail-closed)", () => {
    expect(formatDuration(-1)).toBe("00:00");
    expect(formatDuration(NaN)).toBe("00:00");
    expect(formatDuration(Infinity)).toBe("00:00");
    expect(formatDuration(undefined)).toBe("00:00");
  });
  it("Stunden zaehlen in Minuten weiter (kurze Clips)", () => {
    expect(formatDuration(75 * 60_000)).toBe("75:00");
  });
});

describe("buildClipFilename", () => {
  it("golhex_<datum>_clip.<ext> mit 0-Padding", () => {
    const d = new Date(2026, 5, 9); // 2026-06-09
    expect(buildClipFilename(d, "webm")).toBe("golhex_2026-06-09_clip.webm");
    expect(buildClipFilename(d, "mp4")).toBe("golhex_2026-06-09_clip.mp4");
  });
  it("default webm; invalides Date -> Epoch-Fallback", () => {
    expect(buildClipFilename(new Date(2026, 0, 3))).toBe("golhex_2026-01-03_clip.webm");
    expect(buildClipFilename(new Date("nope"), "mp4")).toBe("golhex_1970-01-01_clip.mp4");
  });
});

describe("createRecorderMachine (reine Uebergaenge)", () => {
  it("startet in idle", () => {
    expect(createRecorderMachine().state()).toBe(REC_STATES.IDLE);
  });
  it("Normalpfad idle->recording->encoding->idle", () => {
    const seen = [];
    const m = createRecorderMachine((s) => seen.push(s));
    expect(m.to("recording")).toBe(true);
    expect(m.to("encoding")).toBe(true);
    expect(m.to("idle")).toBe(true);
    expect(seen).toEqual(["recording", "encoding", "idle"]);
  });
  it("verbietet illegale Spruenge (idle->encoding)", () => {
    const m = createRecorderMachine();
    expect(m.to("encoding")).toBe(false);
    expect(m.state()).toBe(REC_STATES.IDLE);
  });
  it("error nur nach idle zurueck", () => {
    const m = createRecorderMachine();
    m.to("error");
    expect(m.to("recording")).toBe(false); // error->recording verboten
    expect(m.to("idle")).toBe(true);
  });
  it("idempotenter Selbst-Uebergang (kein Crash, kein Event)", () => {
    const seen = [];
    const m = createRecorderMachine((s) => seen.push(s));
    expect(m.to("idle")).toBe(true);
    expect(seen).toEqual([]); // idle->idle feuert nichts
  });
  it("unbekannter Zielzustand -> false", () => {
    expect(createRecorderMachine().to("bogus")).toBe(false);
  });
  it("reset bringt aus jedem Zustand nach idle", () => {
    const m = createRecorderMachine();
    m.to("recording");
    m.reset();
    expect(m.state()).toBe(REC_STATES.IDLE);
  });
});

// --- Controller: mockbarer MediaRecorder-Lebenszyklus -----------------------
// Minimaler MediaRecorder-Mock: speichert die Handler, die start()/stop()
// setzen, damit der Test dataavailable/stop/error manuell ausloesen kann.
function makeMockEnv({ chunkBytes = 8, supported = true, captureStreamThrows = false } = {}) {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks };
  const canvas = {
    captureStream: vi.fn(() => {
      if (captureStreamThrows) throw new Error("kein Track");
      return stream;
    }),
  };
  let inst = null;
  class MockMR {
    static isTypeSupported() { return supported; }
    constructor(s, opts) {
      this.stream = s; this.mimeType = opts.mimeType;
      this.ondataavailable = null; this.onstop = null; this.onerror = null;
      inst = this;
    }
    start() { this.started = true; }
    stop() {
      // Realistisch: erst dataavailable, dann onstop.
      if (this.ondataavailable && chunkBytes > 0) {
        this.ondataavailable({ data: new Blob([new Uint8Array(chunkBytes)], { type: this.mimeType }) });
      }
      if (this.onstop) this.onstop();
    }
  }
  return { canvas, stream, tracks, getInst: () => inst, MockMR };
}

describe("createRecorderController (mockbarer Lebenszyklus)", () => {
  it("Happy-Path: start->stop liefert non-empty Blob + Dauer, Zustaende sauber", () => {
    const { canvas, MockMR } = makeMockEnv({ chunkBytes: 16 });
    let result = null;
    const states = [];
    let t = 1000;
    const ctrl = createRecorderController({
      canvas, MediaRecorderCtor: MockMR,
      now: () => t,
      onResult: (blob, mime, dur) => { result = { blob, mime, dur }; },
      onState: (s) => states.push(s),
    });
    expect(ctrl.start()).toBe(true);
    expect(ctrl.state()).toBe(REC_STATES.RECORDING);
    expect(ctrl.isActive()).toBe(true);
    expect(ctrl.mime()).toBe("video/mp4;codecs=h264");
    t = 3500; // 2.5s spaeter
    expect(ctrl.stop()).toBe(true);
    expect(result).not.toBeNull();
    expect(result.blob.size).toBe(16);
    expect(result.dur).toBe(2500);
    expect(result.mime).toBe("video/mp4;codecs=h264");
    expect(ctrl.state()).toBe(REC_STATES.IDLE);
    // Uebergaenge enthalten recording, encoding, idle (in dieser Reihenfolge).
    expect(states).toEqual(["recording", "encoding", "idle"]);
  });

  it("stoppt die Stream-Tracks nach Aufnahme (kein Leak)", () => {
    const env = makeMockEnv({ chunkBytes: 8 });
    const ctrl = createRecorderController({ canvas: env.canvas, MediaRecorderCtor: env.MockMR, now: () => 0 });
    ctrl.start();
    ctrl.stop();
    expect(env.tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it("fail-closed: fehlendes MediaRecorder -> error-State + onError, kein Crash", () => {
    const { canvas } = makeMockEnv();
    let err = null;
    const ctrl = createRecorderController({
      canvas, MediaRecorderCtor: null, onError: (r) => { err = r; },
    });
    expect(ctrl.start()).toBe(false);
    expect(ctrl.state()).toBe(REC_STATES.ERROR);
    expect(err).toMatch(/MediaRecorder/);
  });

  it("fail-closed: captureStream wirft -> error + onError, kein Crash", () => {
    const { canvas, MockMR } = makeMockEnv({ captureStreamThrows: true });
    let err = null;
    const ctrl = createRecorderController({
      canvas, MediaRecorderCtor: MockMR, onError: (r) => { err = r; },
    });
    expect(ctrl.start()).toBe(false);
    expect(ctrl.state()).toBe(REC_STATES.ERROR);
    expect(err).toMatch(/captureStream/);
  });

  it("fail-closed: 0-Byte-Aufnahme (iOS-Risiko) -> error, KEIN onResult", () => {
    const { canvas, MockMR } = makeMockEnv({ chunkBytes: 0 });
    let result = null, err = null;
    const ctrl = createRecorderController({
      canvas, MediaRecorderCtor: MockMR, now: () => 0,
      onResult: () => { result = "should-not-happen"; },
      onError: (r) => { err = r; },
    });
    ctrl.start();
    ctrl.stop();
    expect(result).toBeNull();
    expect(err).toMatch(/leere Aufnahme/);
    expect(ctrl.state()).toBe(REC_STATES.ERROR);
  });

  it("doppeltes start() ignoriert (kein zweiter Recorder)", () => {
    const env = makeMockEnv();
    const ctrl = createRecorderController({ canvas: env.canvas, MediaRecorderCtor: env.MockMR, now: () => 0 });
    expect(ctrl.start()).toBe(true);
    expect(ctrl.start()).toBe(false); // schon recording
    expect(env.canvas.captureStream).toHaveBeenCalledTimes(1);
  });

  it("stop() ohne laufende Aufnahme -> false (kein Crash)", () => {
    const env = makeMockEnv();
    const ctrl = createRecorderController({ canvas: env.canvas, MediaRecorderCtor: env.MockMR, now: () => 0 });
    expect(ctrl.stop()).toBe(false);
  });

  it("recorder.onerror waehrend Aufnahme -> error-State + onError", () => {
    const env = makeMockEnv();
    let err = null;
    const ctrl = createRecorderController({
      canvas: env.canvas, MediaRecorderCtor: env.MockMR, now: () => 0,
      onError: (r) => { err = r; },
    });
    ctrl.start();
    env.getInst().onerror({ error: { message: "Disk voll" } });
    expect(ctrl.state()).toBe(REC_STATES.ERROR);
    expect(err).toBe("Disk voll");
  });
});
