import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const tsconfig = JSON.parse(readFileSync("tsconfig.typecheck.json", "utf8"));

describe("TypeScript quality-gate contract (#169)", () => {
  it("keeps TypeScript as a direct pinned devDependency in manifest and lockfile", () => {
    expect(pkg.devDependencies?.typescript).toBe("6.0.3");
    expect(lock.packages?.[""]?.devDependencies?.typescript).toBe("6.0.3");
    expect(lock.packages?.["node_modules/typescript"]?.version).toBe("6.0.3");
    expect(lock.packages?.["node_modules/typescript"]?.integrity).toMatch(/^sha512-/);
  });

  it("makes typecheck part of the normal required npm test path", () => {
    expect(pkg.scripts?.typecheck).toBe("tsc -p tsconfig.typecheck.json --noEmit");
    expect(pkg.scripts?.test).toMatch(/^npm run typecheck && /);
  });

  it("checks declarations instead of hiding @types errors", () => {
    expect(tsconfig.compilerOptions?.noEmit).toBe(true);
    expect(tsconfig.compilerOptions?.skipLibCheck).toBe(false);
    expect(tsconfig.compilerOptions?.allowJs).toBe(true);
    expect(tsconfig.compilerOptions?.checkJs).toBe(false);
    expect(tsconfig.include).toContain("src/App.tsx");
    expect(tsconfig.include).toContain("tests/types/**/*.ts");
  });
});
