import { test, expect } from "@playwright/test";

// v33 PR-D: Canvas-Snapshot teilen (Web Share L2 + Download-Fallback).
// Realer DOM-/Verhaltens-Kontrakt (KEINE window.telemetry-Hooks, AGENTS.md §2):
//   - 📷 oben loest 1-Tipp den Share- bzw. Download-Pfad aus (kein Zwischendialog).
//   - Download-Pfad: Browser-Download-Event, Dateiname golhex_<datum>_genN.png,
//     Inhalt ist ein non-empty PNG (Magic Bytes 89 50 4E 47).
//   - Share-Pfad: navigator.canShare/share werden GESTUBT; geprueft, dass share()
//     mit einem File-Array (PNG) im selben Klick aufgerufen wird.
//   - Keine Konsolen-/Page-Fehler im ganzen Ablauf.
// Laeuft im "mobile"-Projekt (390x844, playwright.config.ts).

function attachErrorGuards(page: import("@playwright/test").Page, errors: string[]) {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
}

test.describe("GolHex v33 Snapshot teilen (PR-D)", () => {
  test("📷 Download-Fallback: PNG-Datei mit korrektem Namen + Magic-Bytes", async ({ page }) => {
    const errors: string[] = [];
    attachErrorGuards(page, errors);

    // Web Share deaktivieren -> App muss auf den Download-Pfad fallen.
    await page.addInitScript(() => {
      // canShare existiert nicht / liefert false => kein share-Pfad.
      // @ts-expect-error Test-Stub
      delete navigator.canShare;
      // @ts-expect-error Test-Stub
      delete navigator.share;
    });

    await page.goto("/");
    await page.waitForTimeout(400);

    // Etwas auf dem Feld, damit der Snapshot Inhalt hat (deterministischer Seed).
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(200);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("snapshot-btn").click();
    const download = await downloadPromise;

    const name = download.suggestedFilename();
    expect(name, "Dateiname golhex_<datum>_genN.png").toMatch(/^golhex_\d{4}-\d{2}-\d{2}_gen\d+\.png$/);

    // PNG Magic Bytes pruefen (89 50 4E 47 0D 0A 1A 0A).
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect(buf.length, "PNG ist non-empty").toBeGreaterThan(8);
    expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    await expect(page.getByTestId("snap-msg")).toContainText("Heruntergeladen");
    expect(errors, "keine Fehler im Download-Ablauf").toEqual([]);
  });

  test("📷 Share-Pfad: navigator.share wird mit PNG-File-Array aufgerufen", async ({ page }) => {
    const errors: string[] = [];
    attachErrorGuards(page, errors);

    // Web Share stubben: canShare(files)->true, share() loggt die File-Metadaten
    // in ein window-Feld, das der Test ausliest (kein echtes Share-Sheet headless).
    await page.addInitScript(() => {
      // @ts-expect-error Test-Stub-Feld
      window.__shared = null;
      // @ts-expect-error Test-Stub
      navigator.canShare = (data: { files?: File[] }) =>
        !!(data && Array.isArray(data.files) && data.files.length > 0);
      // @ts-expect-error Test-Stub
      navigator.share = async (data: { files?: File[]; title?: string; text?: string }) => {
        const f = data.files && data.files[0];
        // @ts-expect-error Test-Stub-Feld
        window.__shared = {
          count: data.files ? data.files.length : 0,
          name: f ? f.name : null,
          type: f ? f.type : null,
          size: f ? f.size : 0,
          title: data.title || null,
        };
      };
    });

    await page.goto("/");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.waitForTimeout(200);

    await page.getByTestId("snapshot-btn").click();
    await expect(page.getByTestId("snap-msg")).toContainText("Geteilt");

    const shared = await page.evaluate(() => (window as unknown as { __shared: {
      count: number; name: string; type: string; size: number; title: string;
    } | null }).__shared);
    expect(shared, "navigator.share wurde aufgerufen").not.toBeNull();
    expect(shared!.count, "ein File geteilt").toBe(1);
    expect(shared!.name, "PNG-Dateiname").toMatch(/^golhex_\d{4}-\d{2}-\d{2}_gen\d+\.png$/);
    expect(shared!.type).toBe("image/png");
    expect(shared!.size, "non-empty Bild").toBeGreaterThan(0);
    expect(shared!.title).toBe("GolHex");

    expect(errors, "keine Fehler im Share-Ablauf").toEqual([]);
  });
});
