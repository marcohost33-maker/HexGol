// v33 PR-D: Canvas-Snapshot teilen — Unit-Tests fuer die PUREN Helfer und die
// Share-vs-Download-Dispatch-Logik (mit injizierter Umgebung, kein echtes DOM/iOS).
// Korrektheits-Orakel: Dateiname/Label gegen feste Erwartungen; Dispatcher gegen
// gestubte navigator/document — wir pruefen WELCHER Pfad mit WELCHEN Argumenten
// aufgerufen wird (Silent-Failure-Gate: Edge-Inputs fail-before-Tests).
import { describe, it, expect, vi } from "vitest";
import {
  buildSnapshotFilename, buildWatermarkLabel, mimeForFormat,
  canvasToBlob, shareOrDownloadBlob,
} from "../../src/lib/snapshot.js";

describe("buildSnapshotFilename", () => {
  it("baut golhex_<YYYY-MM-DD>_gen<N>.png mit 0-Padding", () => {
    const d = new Date(2026, 5, 7); // 2026-06-07 (Monat 0-basiert)
    expect(buildSnapshotFilename(d, 1234)).toBe("golhex_2026-06-07_gen1234.png");
  });
  it("paddet einstellige Monate/Tage", () => {
    const d = new Date(2026, 0, 3); // 2026-01-03
    expect(buildSnapshotFilename(d, 0)).toBe("golhex_2026-01-03_gen0.png");
  });
  it("jpg-Endung bei Format jpg", () => {
    const d = new Date(2026, 11, 31);
    expect(buildSnapshotFilename(d, 5, "jpg")).toBe("golhex_2026-12-31_gen5.jpg");
  });
  // Edge: ungueltige/negative gen -> 0; kaputtes Date -> Epoch-Fallback (kein Crash).
  it("negative Generation wird zu gen0", () => {
    expect(buildSnapshotFilename(new Date(2026, 5, 7), -9)).toBe("golhex_2026-06-07_gen0.png");
  });
  it("nicht-finite Generation (NaN) wird zu gen0", () => {
    expect(buildSnapshotFilename(new Date(2026, 5, 7), NaN)).toBe("golhex_2026-06-07_gen0.png");
  });
  it("Float-Generation wird ganzzahlig (floor)", () => {
    expect(buildSnapshotFilename(new Date(2026, 5, 7), 42.9)).toBe("golhex_2026-06-07_gen42.png");
  });
  it("ungueltiges Date crasht nicht (Epoch-Fallback)", () => {
    const out = buildSnapshotFilename(new Date("not-a-date"), 1);
    expect(out).toMatch(/^golhex_1970-01-01_gen1\.png$/);
  });
});

describe("buildWatermarkLabel", () => {
  it("setzt GolHex · Gen N · Regel zusammen", () => {
    expect(buildWatermarkLabel(7, "B2/S34")).toBe("GolHex · Gen 7 · B2/S34");
  });
  it("laesst leeres Regel-Label weg (kein Schwanz)", () => {
    expect(buildWatermarkLabel(3, "")).toBe("GolHex · Gen 3");
    expect(buildWatermarkLabel(3, undefined)).toBe("GolHex · Gen 3");
  });
  it("laesst Platzhalter '—' weg", () => {
    expect(buildWatermarkLabel(0, "—")).toBe("GolHex · Gen 0");
  });
  it("negative/NaN Generation -> Gen 0", () => {
    expect(buildWatermarkLabel(-5, "HQST")).toBe("GolHex · Gen 0 · HQST");
    expect(buildWatermarkLabel(NaN, "HQST")).toBe("GolHex · Gen 0 · HQST");
  });
});

describe("mimeForFormat", () => {
  it("png/jpg korrekt", () => {
    expect(mimeForFormat("png")).toBe("image/png");
    expect(mimeForFormat("jpg")).toBe("image/jpeg");
    expect(mimeForFormat("jpeg")).toBe("image/jpeg");
    expect(mimeForFormat("xyz")).toBe("image/png"); // Default
  });
});

describe("canvasToBlob (null-Guard)", () => {
  it("loest mit Blob auf, wenn toBlob einen liefert", async () => {
    const fake = {
      toBlob: (cb) => cb(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
    };
    const blob = await canvasToBlob(fake);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(3);
  });
  it("lehnt ab, wenn toBlob null liefert", async () => {
    const fake = { toBlob: (cb) => cb(null) };
    await expect(canvasToBlob(fake)).rejects.toThrow(/null\/leeren/);
  });
  it("lehnt ab, wenn toBlob leeren Blob liefert", async () => {
    const fake = { toBlob: (cb) => cb(new Blob([], { type: "image/png" })) };
    await expect(canvasToBlob(fake)).rejects.toThrow(/null\/leeren/);
  });
  it("lehnt ab ohne toBlob-Methode", async () => {
    await expect(canvasToBlob({})).rejects.toThrow(/nicht verfuegbar/);
    await expect(canvasToBlob(null)).rejects.toThrow(/nicht verfuegbar/);
  });
});

// --- Dispatcher: Share-Pfad vs. Download-Pfad ------------------------------
function pngBlob() {
  // minimaler "PNG"-Blob (Inhalt egal fuer die Logik).
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
}

function fakeAnchor() {
  return { href: "", download: "", click: vi.fn(), parentNode: null };
}
function fakeDoc(anchor) {
  const body = { appendChild: vi.fn((el) => { el.parentNode = body; }), removeChild: vi.fn() };
  return { body, createElement: vi.fn(() => anchor) };
}
function fakeUrl() {
  return { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() };
}

describe("shareOrDownloadBlob — Share-Pfad", () => {
  it("ruft navigator.share mit File-Array, wenn canShare(files) true", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const nav = { share, canShare };
    const res = await shareOrDownloadBlob(pngBlob(), "golhex_2026-06-07_gen3.png", {
      navigatorObj: nav, title: "GolHex", text: "GolHex · Gen 3 · B2/S34",
      documentObj: fakeDoc(fakeAnchor()), urlObj: fakeUrl(),
    });
    expect(res).toEqual({ method: "share", shared: true });
    expect(canShare).toHaveBeenCalledTimes(1);
    const shareArg = share.mock.calls[0][0];
    expect(Array.isArray(shareArg.files)).toBe(true);
    expect(shareArg.files[0]).toBeInstanceOf(File);
    expect(shareArg.files[0].name).toBe("golhex_2026-06-07_gen3.png");
    expect(shareArg.files[0].type).toBe("image/png");
    expect(shareArg.title).toBe("GolHex");
    expect(shareArg.text).toBe("GolHex · Gen 3 · B2/S34");
  });

  it("AbortError -> cancelled, KEIN Download", async () => {
    const err = new Error("user aborted"); err.name = "AbortError";
    const share = vi.fn().mockRejectedValue(err);
    const nav = { share, canShare: () => true };
    const url = fakeUrl();
    const res = await shareOrDownloadBlob(pngBlob(), "f.png", {
      navigatorObj: nav, documentObj: fakeDoc(fakeAnchor()), urlObj: url,
    });
    expect(res).toEqual({ method: "share", shared: false, cancelled: true });
    expect(url.createObjectURL).not.toHaveBeenCalled(); // kein Download nach Abbruch
  });

  it("share() wirft anderen Fehler -> Download-Fallback", async () => {
    const err = new Error("boom"); err.name = "DataError";
    const share = vi.fn().mockRejectedValue(err);
    const nav = { share, canShare: () => true };
    const anchor = fakeAnchor();
    const url = fakeUrl();
    const res = await shareOrDownloadBlob(pngBlob(), "f.png", {
      navigatorObj: nav, documentObj: fakeDoc(anchor), urlObj: url,
    });
    expect(res).toEqual({ method: "download" });
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("f.png");
  });
});

describe("shareOrDownloadBlob — Download-Pfad", () => {
  it("kein canShare -> Download mit korrektem Dateinamen + ObjectURL revoke", async () => {
    vi.useFakeTimers();
    const anchor = fakeAnchor();
    const url = fakeUrl();
    const res = await shareOrDownloadBlob(pngBlob(), "golhex_2026-06-07_gen0.png", {
      navigatorObj: {}, documentObj: fakeDoc(anchor), urlObj: url,
    });
    expect(res).toEqual({ method: "download" });
    expect(url.createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe("golhex_2026-06-07_gen0.png");
    expect(anchor.href).toBe("blob:fake");
    expect(anchor.click).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.useRealTimers();
  });

  it("canShare(files)===false -> Download (nicht share)", async () => {
    const share = vi.fn();
    const nav = { share, canShare: () => false };
    const anchor = fakeAnchor();
    const res = await shareOrDownloadBlob(pngBlob(), "f.png", {
      navigatorObj: nav, documentObj: fakeDoc(anchor), urlObj: fakeUrl(),
    });
    expect(res.method).toBe("download");
    expect(share).not.toHaveBeenCalled();
  });

  it("leerer Blob -> Fehler (fail-closed)", async () => {
    await expect(
      shareOrDownloadBlob(new Blob([], { type: "image/png" }), "f.png", {})
    ).rejects.toThrow(/kein Blob/);
  });

  it("weder Share noch Download verfuegbar -> Fehler", async () => {
    // Umgebung ohne createObjectURL (z.B. exotischer Container) -> fail-closed.
    await expect(
      shareOrDownloadBlob(pngBlob(), "f.png", { navigatorObj: {}, documentObj: {}, urlObj: {} })
    ).rejects.toThrow(/weder Web Share noch Download/);
  });
});
