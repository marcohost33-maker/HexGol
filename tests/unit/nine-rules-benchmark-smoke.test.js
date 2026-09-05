import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

describe("nine-rule benchmark harness", () => {
  it("runs a tiny observe-only benchmark and emits the machine-readable v1 schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "hexgol-nine-rules-bench-"));
    const output = join(dir, "result.json");

    try {
      const run = spawnSync(process.execPath, ["experimental/bench-nine-rules.mjs"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          BENCH_LENGTHS: "8,16",
          BENCH_TARGET_STATES: "64",
          BENCH_MIN_SAMPLES: "4",
          BENCH_OUTPUT: output,
        },
      });

      expect(run.status, run.stderr || run.stdout).toBe(0);
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report.schema).toBe("hexgol.nine-rules-benchmark.v1");
      expect(report.lengths).toEqual([8, 16]);
      expect(Object.keys(report.profiles)).toEqual(["local", "golhex", "full"]);
      expect(report.rows).toHaveLength(6);
      expect(report.rows.every((row) => row.n >= 4)).toBe(true);
      expect(report.rows.every((row) => row.p50Ms >= 0 && row.p95Ms >= row.p50Ms)).toBe(true);
      expect(report.interpretation.thresholdPolicy).toMatch(/observe-only/i);
      expect(report.interpretation.cachePolicy).toMatch(/incremental caching only if/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
