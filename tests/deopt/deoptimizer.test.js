import { describe, it, expect, beforeEach } from "vitest";
import { LazyDeoptMarker, Deoptimizer } from "../../src/deopt/deoptimizer.js";
import {
  mkSmi,
  mkString,
  mkBool,
  mkNull,
  mkUndefined,
  mkNumber,
  getPayload,
  isSmi,
  isString,
  isBool,
  isNull,
  isUndefined,
} from "../../src/core/value/index.js";

describe("LazyDeoptMarker", () => {
  let marker;
  let fn1;
  let fn2;

  beforeEach(() => {
    marker = new LazyDeoptMarker();
    fn1 = { id: 1, name: "fn1", optimizedCode: true };
    fn2 = { id: 2, name: "fn2", optimizedCode: true };
  });

  it("markForDeopt sets pending, hasPendingDeopt returns true", () => {
    marker.markForDeopt(fn1, "smi-check-failed");
    expect(marker.hasPendingDeopt(fn1)).toBe(true);
    expect(marker.hasPendingDeopt(fn2)).toBe(false);
  });

  it("markForDeopt is idempotent (does not overwrite first mark)", () => {
    marker.markForDeopt(fn1, "first-reason");
    marker.markForDeopt(fn1, "second-reason");
    const info = marker.consumeDeopt(fn1);
    expect(info.reason).toBe("first-reason");
  });

  it("consumeDeopt returns info and removes pending", () => {
    marker.markForDeopt(fn1, "overflow");
    const info = marker.consumeDeopt(fn1);
    expect(info.reason).toBe("overflow");
    expect(info.functionName).toBe("fn1");
    expect(marker.hasPendingDeopt(fn1)).toBe(false);
  });

  it("consumeDeopt returns undefined when nothing pending", () => {
    expect(marker.consumeDeopt(fn1)).toBeUndefined();
  });

  it("invalidateDependents marks matching functions", () => {
    const allFns = [fn1, fn2];
    const count = marker.invalidateDependents(
      "proto-changed",
      (fn) => fn.name === "fn1",
      allFns,
    );
    expect(count).toBe(1);
    expect(marker.hasPendingDeopt(fn1)).toBe(true);
    expect(marker.hasPendingDeopt(fn2)).toBe(false);
  });

  it("invalidateDependents skips functions without optimizedCode", () => {
    fn1.optimizedCode = null;
    const count = marker.invalidateDependents("x", () => true, [fn1]);
    expect(count).toBe(0);
  });

  it("invalidateDependents returns 0 when allFunctions is falsy", () => {
    expect(marker.invalidateDependents("x", () => true, null)).toBe(0);
  });

  it("clear removes all pending deopts", () => {
    marker.markForDeopt(fn1, "a");
    marker.markForDeopt(fn2, "b");
    marker.clear();
    expect(marker.hasPendingDeopt(fn1)).toBe(false);
    expect(marker.hasPendingDeopt(fn2)).toBe(false);
  });
});

describe("Deoptimizer.materializeValue", () => {
  let deopt;

  beforeEach(() => {
    deopt = new Deoptimizer(null);
  });

  it("null/undefined input returns mkUndefined", () => {
    const result = deopt.materializeValue(null, new Map());
    expect(isUndefined(result)).toBe(true);
  });

  it("resolves IR node from runtimeValues", () => {
    const irNode = { id: 10, type: "SomeOp" };
    const runtimeValues = new Map([[10, mkSmi(99)]]);
    const result = deopt.materializeValue(irNode, runtimeValues);
    expect(isSmi(result)).toBe(true);
    expect(getPayload(result)).toBe(99);
  });

  it("materializes Constant number", () => {
    const irNode = { id: 5, type: "Constant", props: { value: 42 } };
    const result = deopt.materializeValue(irNode, new Map());
    expect(getPayload(result)).toBe(42);
  });

  it("materializes Constant string", () => {
    const irNode = { id: 6, type: "Constant", props: { value: "hello" } };
    const result = deopt.materializeValue(irNode, new Map());
    expect(isString(result)).toBe(true);
    expect(getPayload(result)).toBe("hello");
  });

  it("materializes Constant boolean", () => {
    const irNode = { id: 7, type: "Constant", props: { value: true } };
    const result = deopt.materializeValue(irNode, new Map());
    expect(isBool(result)).toBe(true);
    expect(getPayload(result)).toBe(true);
  });

  it("materializes Constant null", () => {
    const irNode = { id: 8, type: "Constant", props: { value: null } };
    const result = deopt.materializeValue(irNode, new Map());
    expect(isNull(result)).toBe(true);
  });

  it("materializes Constant undefined", () => {
    const irNode = { id: 9, type: "Constant", props: { value: undefined } };
    const result = deopt.materializeValue(irNode, new Map());
    expect(isUndefined(result)).toBe(true);
  });

  it("returns mkUndefined for unknown IR node without runtime value", () => {
    const irNode = { id: 100, type: "UnknownOp" };
    const result = deopt.materializeValue(irNode, new Map());
    expect(isUndefined(result)).toBe(true);
  });

  it("passes through already-tagged values", () => {
    const tagged = mkSmi(77);
    const result = deopt.materializeValue(tagged, new Map());
    expect(result).toBe(tagged);
  });
});

describe("Deoptimizer.recordDeoptReason / getStats", () => {
  it("tracks deopt reasons and counts", () => {
    const deopt = new Deoptimizer(null);
    deopt.recordDeoptReason("smi-check-failed");
    deopt.recordDeoptReason("smi-check-failed");
    deopt.recordDeoptReason("overflow");
    deopt.deoptCount = 3;
    const stats = deopt.getStats();
    expect(stats.total).toBe(3);
    expect(stats.reasons["smi-check-failed"]).toBe(2);
    expect(stats.reasons["overflow"]).toBe(1);
  });

  it("getStats returns empty reasons when nothing recorded", () => {
    const deopt = new Deoptimizer(null);
    const stats = deopt.getStats();
    expect(stats.total).toBe(0);
    expect(Object.keys(stats.reasons)).toHaveLength(0);
  });
});

describe("Deoptimizer.handleDisableOptimization", () => {
  it("increments deoptCount and clears optimizedCode", () => {
    const deopt = new Deoptimizer(null);
    deopt.lastDeoptReason = "overflow";
    const fn = { name: "test", deoptCount: 0, optimizedCode: {}, optimizedDependencies: [] };
    deopt.handleDisableOptimization(fn);
    expect(fn.deoptCount).toBe(1);
    expect(fn.optimizedCode).toBe(null);
    expect(fn.lastDeoptReason).toBe("overflow");
  });

  it("disables optimization after maxDeoptCount", () => {
    const deopt = new Deoptimizer({ tieringPolicy: { maxDeoptCount: 2, recordDeopt() {} } });
    deopt.lastDeoptReason = "overflow";
    const fn = { name: "test", deoptCount: 1, optimizedCode: {}, optimizedDependencies: [] };
    deopt.handleDisableOptimization(fn);
    expect(fn.deoptCount).toBe(2);
    expect(fn.disableOptimization).toBe(true);
  });

  it("calls tieringPolicy.recordDeopt when available", () => {
    const recorded = [];
    const deopt = new Deoptimizer({
      tieringPolicy: {
        maxDeoptCount: 10,
        recordDeopt(fn, reason) { recorded.push({ fn, reason }); },
      },
    });
    deopt.lastDeoptReason = "map-check-failed";
    const fn = { name: "fn", deoptCount: 0, optimizedCode: {}, optimizedDependencies: [] };
    deopt.handleDisableOptimization(fn);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].reason).toBe("map-check-failed");
  });
});
