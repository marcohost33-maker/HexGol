import { describe, expect, it } from "vitest";
import { fingerprintEntries } from "../../scripts/pwa-fingerprint.mjs";

describe("PWA shell fingerprint", () => {
  const base = [
    { path: "./", content: "<html>shell</html>" },
    { path: "./manifest.webmanifest", content: '{"name":"GolHex"}' },
    { path: "./assets/app-a.js", content: "console.log('a')" },
  ];

  it("is deterministic independent of entry iteration order", () => {
    expect(fingerprintEntries(base)).toBe(fingerprintEntries([...base].reverse()));
  });

  it.each([
    ["HTML", 0, "<html>changed</html>"],
    ["manifest", 1, '{"name":"GolHex changed"}'],
    ["generated asset", 2, "console.log('changed')"],
  ])("changes when %s content changes", (_label, index, content) => {
    const changed = base.map((entry, i) => i === index ? { ...entry, content } : entry);
    expect(fingerprintEntries(changed)).not.toBe(fingerprintEntries(base));
  });

  it("changes when a precached path changes even with identical bytes", () => {
    const changed = base.map((entry, i) => i === 2 ? { ...entry, path: "./assets/app-b.js" } : entry);
    expect(fingerprintEntries(changed)).not.toBe(fingerprintEntries(base));
  });

  it("rejects empty and duplicate entry sets", () => {
    expect(() => fingerprintEntries([])).toThrow(/at least one entry/);
    expect(() => fingerprintEntries([base[0], base[0]])).toThrow(/duplicate/);
  });
});
