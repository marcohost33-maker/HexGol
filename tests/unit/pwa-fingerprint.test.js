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

  it("fingerprints binary icon bytes and changes when one byte changes", () => {
    const iconA = [
      ...base,
      { path: "./icon-192.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]) },
    ];
    const iconB = [
      ...base,
      { path: "./icon-192.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]) },
    ];
    expect(fingerprintEntries(iconA)).not.toBe(fingerprintEntries(iconB));
  });

  it("accepts generic typed-array content used by binary build inputs", () => {
    const withTypedArray = [
      ...base,
      { path: "./icon.svg.bin", content: new Uint8Array([1, 2, 3, 4]) },
    ];
    expect(fingerprintEntries(withTypedArray)).toMatch(/^[0-9a-f]{20}$/);
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
