import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AdaptiveTieringPolicy } from "../../src/runtime/tiering/adaptive.js";
import { ExecutionProfile } from "../../src/feedback/profile/index.js";
import { createTieringPolicy } from "../../src/runtime/tiering/policy.js";
import { MiniJIT } from "../../src/index.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import { getPayload } from "../../src/core/value/index.js";

describe("ExecutionProfile", () => {
  it("records execution time with EMA", () => {
    const profile = new ExecutionProfile();
    profile.recordExecution(10);
    assert.equal(profile.totalCalls, 1);
    assert.equal(profile.emaTimeMs, 10);

    profile.recordExecution(20);
    assert.equal(profile.totalCalls, 2);
    assert.ok(profile.emaTimeMs > 10);
    assert.ok(profile.emaTimeMs < 20);
  });

  it("tracks deopt count and reasons", () => {
    const profile = new ExecutionProfile();
    profile.recordDeopt("smi-check-failed");
    profile.recordDeopt("map-check-failed");
    assert.equal(profile.deoptCount, 2);
    assert.deepEqual(profile.deoptReasons, [
      "smi-check-failed",
      "map-check-failed",
    ]);
  });

  it("computes hotness score", () => {
    const profile = new ExecutionProfile();
    profile.recordExecution(5);
    profile.recordExecution(5);
    assert.ok(profile.hotness() >= 0);
  });

  it("tracks IC stability", () => {
    const profile = new ExecutionProfile();
    assert.equal(profile.isStable(), false);

    for (let i = 0; i < 50; i++) {
      profile.recordExecution(1);
    }
    assert.equal(profile.isStable(), true);

    profile.recordICTransition();
    assert.equal(profile.isStable(), false);
  });
});

describe("AdaptiveTieringPolicy", () => {
  it("creates profiles per function", () => {
    const policy = new AdaptiveTieringPolicy();
    const fn = { id: "test", name: "test" };
    const profile = policy.getProfile(fn);
    assert.ok(profile instanceof ExecutionProfile);
    assert.equal(policy.getProfile(fn), profile);
  });

  it("keeps profiles separate for different functions with the same name and id", () => {
    const policy = new AdaptiveTieringPolicy();
    const left = { id: "same", name: "same" };
    const right = { id: "same", name: "same" };
    policy.recordExecution(left, 1);
    policy.recordExecution(right, 1);
    policy.recordExecution(right, 1);
    assert.equal(policy.getProfileStats(left).totalCalls, 1);
    assert.equal(policy.getProfileStats(right).totalCalls, 2);
  });

  it("keeps tiering decisions independent from function names", () => {
    const policy = new AdaptiveTieringPolicy({
      jitThreshold: 1,
      hotnessThreshold: 0,
    });
    const first = { name: "shared", invocationCount: 100 };
    const second = { name: "shared", invocationCount: 100 };
    policy.recordCompileFailure(first, "unsupported-graph");
    assert.equal(policy.getProfileStats(second).compileFailureCount, 0);
  });

  it("blocks optimization during cooldown", () => {
    const policy = new AdaptiveTieringPolicy({ jitThreshold: 1 });
    const fn = { id: "test", name: "test", invocationCount: 100 };

    policy.recordDeopt(fn, "smi-check-failed");
    assert.equal(policy.shouldOptimize(fn), false);
  });

  it("blocks optimization when IC is unstable after deopt", () => {
    const policy = new AdaptiveTieringPolicy({ jitThreshold: 1 });
    const fn = {
      id: "test",
      name: "test",
      invocationCount: 100,
      optimizationCooldownUntil: 0,
    };

    policy.recordDeopt(fn, "map-check-failed");
    fn.optimizationCooldownUntil = 0;
    assert.equal(policy.shouldOptimize(fn), false);
  });

  it("records compilation pressure", () => {
    const policy = new AdaptiveTieringPolicy();
    policy.notifyCompilationStart();
    assert.equal(policy.compilationPressure, 1);
    policy.notifyCompilationEnd();
    assert.equal(policy.compilationPressure, 0.5);
  });

  it("blocks optimization after repeated compile failures", () => {
    const policy = new AdaptiveTieringPolicy({
      jitThreshold: 1,
      hotnessThreshold: 0,
    });
    const fn = {
      id: "compile-fails",
      name: "compile-fails",
      invocationCount: 100,
    };
    for (let i = 0; i < 4; i++)
      policy.recordCompileFailure(fn, `unsupported-${i}`);
    assert.equal(policy.shouldOptimize(fn), false);
    const stats = policy.getProfileStats(fn);
    assert.equal(stats.compileFailureCount, 4);
    assert.equal(stats.lastCompileFailureReason, "unsupported-3");
  });

  it("blocks OSR after repeated compile failures recorded in the profile", () => {
    const policy = new AdaptiveTieringPolicy({ loopOsrThreshold: 3 });
    const fn = { id: "osr-compile-fails", name: "osr-compile-fails" };
    for (let i = 0; i < 4; i++)
      policy.recordCompileFailure(fn, `invalid-graph-${i}`);
    assert.equal(policy.shouldOSR(fn, 100), false);
  });

  it("clears compile failure counters after successful optimized compilation", () => {
    const policy = new AdaptiveTieringPolicy({
      jitThreshold: 1,
      hotnessThreshold: 0,
    });
    const fn = {
      id: "compile-recovers",
      name: "compile-recovers",
      invocationCount: 100,
    };
    policy.recordCompileFailure(fn, "unsupported-graph");
    policy.recordCompileSuccess(fn);
    const stats = policy.getProfileStats(fn);
    assert.equal(stats.compileFailureCount, 0);
    assert.equal(stats.lastCompileFailureReason, null);
  });

  it("requires usable feedback before OSR starts", () => {
    const policy = new AdaptiveTieringPolicy({ loopOsrThreshold: 3 });
    const fn = {
      id: "unstable-osr",
      name: "unstable-osr",
      feedbackVector: {
        getSummaryStats() {
          return {
            initializedSlots: 1,
            megamorphicSlots: 1,
            stableSlots: 0,
            monomorphicSlots: 0,
          };
        },
      },
    };
    assert.equal(policy.shouldOSR(fn, 100), false);
  });

  it("does not start OSR when no feedback slots have recorded runtime data", () => {
    const policy = new AdaptiveTieringPolicy({ loopOsrThreshold: 3 });
    const fn = {
      id: "empty-feedback-osr",
      name: "empty-feedback-osr",
      feedbackVector: {
        getSummaryStats() {
          return {
            initializedSlots: 0,
            megamorphicSlots: 0,
            stableSlots: 0,
            monomorphicSlots: 0,
            totalRecords: 0,
          };
        },
      },
    };
    policy.recordExecution(fn, 10);
    assert.equal(policy.shouldOSR(fn, 100), false);
    assert.equal(policy.getProfileStats(fn).osrFeedbackReady, false);
  });

  it("blocks OSR when stable feedback exists but no optimized OSR entry is installed", () => {
    const policy = new AdaptiveTieringPolicy({ loopOsrThreshold: 3 });
    const fn = {
      id: "renamed-hot-loop",
      name: "benchmarkLookingName",
      feedbackVector: {
        getSummaryStats() {
          return {
            initializedSlots: 2,
            megamorphicSlots: 0,
            stableSlots: 2,
            monomorphicSlots: 2,
            totalRecords: 17,
          };
        },
      },
    };
    policy.recordExecution(fn, 10);
    assert.equal(policy.shouldOSR(fn, 100), false);
    assert.equal(policy.getProfileStats(fn).osrFeedbackReady, true);
    assert.equal(policy.getProfileStats(fn).osrEntryReady, false);
  });

  it("starts OSR only from stable feedback plus an optimized OSR entry", () => {
    const policy = new AdaptiveTieringPolicy({ loopOsrThreshold: 3 });
    const fn = {
      id: "optimized-osr-ready",
      name: "renamedLoop",
      optimizedCode: {
        _osrEntry() {},
      },
      feedbackVector: {
        getSummaryStats() {
          return {
            initializedSlots: 2,
            megamorphicSlots: 0,
            stableSlots: 2,
            monomorphicSlots: 2,
            totalRecords: 17,
          };
        },
      },
    };
    policy.recordExecution(fn, 10);
    assert.equal(policy.shouldOSR(fn, 100), true);
    const stats = policy.getProfileStats(fn);
    assert.equal(stats.osrFeedbackReady, true);
    assert.equal(stats.osrEntryReady, true);
  });

  it("uses recorded loop iterations in profile stats", () => {
    const policy = new AdaptiveTieringPolicy();
    const fn = { id: "loop-profile", name: "loop-profile" };
    policy.recordLoopIterations(fn, 37);
    assert.equal(policy.getProfileStats(fn).loopIterations, 37);
  });

  it("returns profile stats", () => {
    const policy = new AdaptiveTieringPolicy();
    const fn = { id: "test", name: "test" };
    policy.recordExecution(fn, 5);
    const stats = policy.getProfileStats(fn);
    assert.equal(stats.totalCalls, 1);
    assert.equal(typeof stats.avgTimeMs, "number");
    assert.equal(typeof stats.hotness, "number");
  });
});

describe("createTieringPolicy with adaptive mode", () => {
  it("creates adaptive policy when mode is adaptive", () => {
    const policy = createTieringPolicy({ mode: "adaptive" });
    assert.ok(policy instanceof AdaptiveTieringPolicy);
  });

  it("creates adaptive policy with string shortcut", () => {
    const policy = createTieringPolicy("adaptive");
    assert.ok(policy instanceof AdaptiveTieringPolicy);
  });

  it("creates fixed policy by default", () => {
    const policy = createTieringPolicy();
    assert.equal(policy.baselineThreshold, 20);
    assert.equal(policy.jitThreshold, 100);
  });
});

describe("Adaptive tiering with engine", () => {
  it("engine accepts adaptive tiering policy", () => {
    resetHiddenClasses();
    const engine = new MiniJIT({ tieringPolicy: "adaptive" });
    assert.ok(engine.tieringPolicy instanceof AdaptiveTieringPolicy);
  });

  it("runs programs correctly with adaptive tiering", () => {
    resetHiddenClasses();
    const engine = new MiniJIT({ tieringPolicy: "adaptive" });
    const result = engine.runValue(`
      let x = 0;
      let i = 0;
      while (i < 50) {
        x = x + i;
        i = i + 1;
      }
      x;
    `);
    assert.equal(result.value, 1225);
  });

  it("records execution count and loop hotness through the engine", () => {
    resetHiddenClasses();
    const engine = new MiniJIT({ tieringPolicy: "adaptive" });
    const compiled = engine.compile(`
      let i = 0;
      let total = 0;
      while (i < 8) {
        total = total + i;
        i = i + 1;
      }
      total;
    `);
    engine.executeValue(compiled);
    const stats = engine.tieringPolicy.getProfileStats(compiled);
    assert.equal(stats.totalCalls, 1);
    assert.ok(stats.loopIterations > 0);
  });

  it("does not baseline compile or enter OSR from a backedge without an optimized OSR entry", () => {
    resetHiddenClasses();
    const engine = new MiniJIT({
      tieringPolicy: {
        baselineThreshold: 1000,
        jitThreshold: 1000,
        loopOsrThreshold: 3,
      },
    });
    let optimizedCompiles = 0;
    engine.optimizeFunction = () => {
      optimizedCompiles++;
    };
    const compiled = engine.compile(`
      let i = 0;
      let total = 0;
      while (i < 12) {
        total = total + i;
        i = i + 1;
      }
      total;
    `);
    const result = engine.interpreter.execute(compiled);
    assert.equal(getPayload(result), 66);
    assert.equal(optimizedCompiles, 0);
    assert.equal(compiled.baselineCode, null);
  });

  it("records wasm deopts and avoids immediate recompile loops", () => {
    resetHiddenClasses();
    const engine = new MiniJIT({
      tieringPolicy: {
        mode: "adaptive",
        baselineThreshold: 3,
        jitThreshold: 10,
      },
    });

    engine.run(`
function add(a, b) { return a + b; }
for (let i = 0; i < 50; i = i + 1) {
  add(i, 1);
}
let r1 = add("hello", " world");
let r2 = add(10, 20);
let r3 = add("foo", "bar");
`);

    const addFn = getPayload(engine.interpreter.globalCells.get("add").read())
      .compiled;
    const profile = engine.tieringPolicy.getProfileStats(addFn);
    const slot = addFn.feedbackVector.getSlot(0);

    assert.equal(engine.compilationCount, 1);
    assert.equal(addFn.deoptCount, 1);
    assert.equal(profile.deoptCount, 1);
    assert.equal(addFn.optimizedCode, null);
    assert.equal(addFn.optimizationCooldownUntil > Date.now(), true);
    assert.equal(slot.icState, "polymorphic");
    assert.deepEqual([...slot.lhsTypeCounts.keys()].sort(), ["smi", "string"]);
    assert.deepEqual([...slot.rhsTypeCounts.keys()].sort(), ["smi", "string"]);

    addFn.optimizationCooldownUntil = 0;
    assert.equal(engine.tieringPolicy.shouldOptimize(addFn), false);
  });
});
