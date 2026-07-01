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

describe("PWA service-worker registration (B1)", () => {
  const main = readFileSync(resolve(root, "src/main.jsx"), "utf8");

  it("registers public/sw.js from src/main.jsx", () => {
    expect(main).toMatch(/navigator\.serviceWorker\.register\(/);
    expect(main).toContain("sw.js");
  });

  it("registers only in Production and guards the API", () => {
    expect(main).toContain("import.meta.env.PROD");
    expect(main).toContain('"serviceWorker" in navigator');
  });

  it("uses a base-URL-safe scope so root and subpath both work", () => {
    expect(main).toContain("import.meta.env.BASE_URL");
    expect(main).toMatch(/scope:\s*base/);
  });
});

describe("index.html asset paths are base-URL-safe (B2)", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");

  it("uses %BASE_URL% for manifest + all icon links", () => {
    for (const asset of [
      "manifest.webmanifest",
      "icon.svg",
      "icon-192.png",
      "apple-touch-icon.png",
    ]) {
      expect(html).toContain(`%BASE_URL%${asset}`);
    }
  });

  it("has no absolute-root href for manifest/icon assets", () => {
    expect(html).not.toMatch(/href="\/(manifest\.webmanifest|icon\.svg|icon-192\.png|apple-touch-icon\.png)"/);
  });
});
