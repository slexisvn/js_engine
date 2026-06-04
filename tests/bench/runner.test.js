import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeVariants, runBenchmark } from "../../bench/run.js";
import { MiniJIT } from "../../src/index.js";

describe("benchmark runner", () => {
  it("creates deterministic variants from a fixed seed", () => {
    assert.deepEqual(makeVariants(99, 3), makeVariants(99, 3));
  });

  it("reports every kernel with finite numeric outputs", () => {
    const report = runBenchmark({
      seed: 99,
      variants: 2,
      warmup: 1,
      measure: 1,
    });
    assert.equal(report.results.length >= 5, true);
    for (const result of report.results) {
      assert.equal(Number.isFinite(result.totalMs), true);
      assert.equal(Number.isFinite(result.meanMs), true);
      assert.equal(result.outputs.every(Number.isFinite), true);
    }
  });

  it("keeps performance measurement out of the public engine API", () => {
    assert.equal(Object.hasOwn(MiniJIT.prototype, "benchmark"), false);
  });
});
