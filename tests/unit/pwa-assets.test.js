import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

describe("PWA/mobile manifest assets", () => {
  it("ships an install manifest with relative scope-safe paths", () => {
    const manifest = readJson("public/manifest.webmanifest");
    expect(manifest.name).toBe("GolHex");
    expect(manifest.short_name).toBe("GolHex");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe(".");
    expect(manifest.scope).toBe(".");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "icon.svg",
      "icon-192.png",
      "icon-512.png",
    ]);
  });

  it("keeps all manifest icon targets present in public/", () => {
    for (const file of ["icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
      expect(existsSync(resolve(root, "public", file)), file).toBe(true);
    }
  });
});
