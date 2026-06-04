import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../src/frontend/lexer/index.js";
import { Parser } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { SpeculativeOptimizer } from "../../src/optimizing/optimizer.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import { resetMigrationStats } from "../../src/objects/heap/js-object.js";
import { getPayload, isFunction } from "../../src/core/value/index.js";
import {
  FeedbackSlot,
  FeedbackVector,
  FEEDBACK_CALL,
  IC_MONOMORPHIC,
  IC_POLYMORPHIC,
} from "../../src/feedback/vector/index.js";

function compile(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new RegisterBytecodeCompiler();
  return compiler.compile(ast);
}

function run(source) {
  const compiledFn = compile(source);
  const interp = new RegisterInterpreter(null);
  return interp.execute(compiledFn);
}

function runVal(source) {
  return getPayload(run(source));
}

function runMultiple(source, times) {
  const compiledFn = compile(source);
  const interp = new RegisterInterpreter(null);
  let result;
  for (let i = 0; i < times; i++) {
    result = interp.execute(compiledFn);
  }
  return result;
}

describe("Polymorphic Inlining", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetMigrationStats();
  });

  describe("Feedback: Call Target Tracking", () => {
    it("tracks monomorphic call target", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const fakeCompiled = { id: 1, version: 0, name: "foo" };
      slot.recordCallTarget("foo", fakeCompiled, 1);
      assert.equal(slot.isMonomorphic(), true);
      assert.equal(slot.getMonomorphicCallTargetRef(), fakeCompiled);
    });

    it("tracks polymorphic call targets", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const fn1 = { id: 1, version: 0, name: "add" };
      const fn2 = { id: 2, version: 0, name: "mul" };
      slot.recordCallTarget("add", fn1, 1);
      slot.recordCallTarget("add", fn1, 1);
      slot.recordCallTarget("mul", fn2, 1);
      assert.equal(slot.isPolymorphic(), true);
      const polyTargets = slot.getPolymorphicCallTargets();
      assert.ok(polyTargets);
      assert.equal(polyTargets.length, 2);
      assert.equal(polyTargets[0].ref, fn1);
      assert.equal(polyTargets[0].count, 2);
      assert.equal(polyTargets[1].ref, fn2);
      assert.equal(polyTargets[1].count, 1);
    });

    it("separates different compiled function objects even when id and name match", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const fn1 = { id: 7, version: 0, name: "same" };
      const fn2 = { id: 7, version: 0, name: "same" };
      slot.recordCallTarget("same", fn1, 1);
      slot.recordCallTarget("same", fn2, 1);
      assert.equal(slot.isPolymorphic(), true);
      const polyTargets = slot.getPolymorphicCallTargets();
      assert.equal(polyTargets.length, 2);
      assert.deepEqual(
        polyTargets.map((target) => target.ref),
        [fn1, fn2],
      );
      assert.notEqual(polyTargets[0].key, polyTargets[1].key);
    });

    it("keeps repeated calls to the same compiled object monomorphic regardless of display name", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const fn = { id: 13, version: 0, name: "firstName" };
      slot.recordCallTarget("firstName", fn, 1);
      fn.name = "secondName";
      slot.recordCallTarget("secondName", fn, 1);
      assert.equal(slot.isMonomorphic(), true);
      assert.equal(slot.getMonomorphicCallTargetRef(), fn);
    });

    it("returns null for monomorphic getPolymorphicCallTargets", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const fn1 = { id: 1, version: 0, name: "add" };
      slot.recordCallTarget("add", fn1, 1);
      assert.equal(slot.getPolymorphicCallTargets(), null);
    });

    it("sorts polymorphic targets by frequency", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const fn1 = { id: 1, version: 0, name: "rare" };
      const fn2 = { id: 2, version: 0, name: "hot" };
      slot.recordCallTarget("rare", fn1, 1);
      slot.recordCallTarget("hot", fn2, 1);
      slot.recordCallTarget("hot", fn2, 1);
      slot.recordCallTarget("hot", fn2, 1);
      const targets = slot.getPolymorphicCallTargets();
      assert.equal(targets[0].ref.name, "hot");
      assert.equal(targets[1].ref.name, "rare");
    });
  });

  describe("IR: CheckCallTarget and CallKnownFunction", () => {
    it("IR nodes can be constructed", async () => {
      const { irCheckCallTarget, irCallKnownFunction } =
        await import("../../src/optimizing/ir/index.js");
      const { irConstant } = await import("../../src/optimizing/ir/index.js");
      const fakeCallee = irConstant(42);
      const fakeTarget = { id: 1, name: "test" };

      const check = irCheckCallTarget(fakeCallee, fakeTarget);
      assert.equal(check.type, "CheckCallTarget");
      assert.equal(check.props.expectedTarget, fakeTarget);
      assert.equal(check.inputs.length, 1);

      const call = irCallKnownFunction(fakeTarget, [
        irConstant(1),
        irConstant(2),
      ]);
      assert.equal(call.type, "CallKnownFunction");
      assert.equal(call.props.target, fakeTarget);
      assert.equal(call.props.argCount, 2);
      assert.equal(call.inputs.length, 2);
    });
  });

  describe("Inline Target Selection", () => {
    it("selects monomorphic target for inline", () => {
      const result = runVal(`
        function add(a, b) { return a + b; }
        let r = 0;
        let i = 0;
        while (i < 10) {
          r = add(i, 1);
          i++;
        }
        r;
      `);
      assert.equal(result, 10);
    });

    it("handles polymorphic call sites correctly at runtime", () => {
      const result = runVal(`
        function add(a, b) { return a + b; }
        function mul(a, b) { return a * b; }
        function apply(fn, x, y) { return fn(x, y); }
        let r1 = apply(add, 3, 4);
        let r2 = apply(mul, 3, 4);
        r1 + r2;
      `);
      assert.equal(result, 19);
    });

    it("handles three polymorphic targets", () => {
      const result = runVal(`
        function add(a, b) { return a + b; }
        function sub(a, b) { return a - b; }
        function mul(a, b) { return a * b; }
        function apply(fn, x, y) { return fn(x, y); }
        apply(add, 10, 5) + apply(sub, 10, 5) + apply(mul, 10, 5);
      `);
      assert.equal(result, 70);
    });
  });

  describe("Speculative Optimizer Integration", () => {
    it("optimizer does not crash on polymorphic call feedback", () => {
      const source = `
        function add(a, b) { return a + b; }
        function mul(a, b) { return a * b; }
        function apply(fn, x, y) { return fn(x, y); }
        let r = 0;
        let i = 0;
        while (i < 100) {
          if (i % 2 === 0) {
            r = apply(add, i, 1);
          } else {
            r = apply(mul, i, 2);
          }
          i++;
        }
        r;
      `;
      const compiledFn = compile(source);
      const interp = new RegisterInterpreter(null);
      const result = interp.execute(compiledFn);
      assert.equal(getPayload(result), 198);

      if (compiledFn.feedbackVector) {
        const optimizer = new SpeculativeOptimizer();
        assert.doesNotThrow(() => {
          optimizer.compile(compiledFn);
        });
      }
    });
  });

  describe("selectInlineTarget function", () => {
    it("returns polymorphic targets when call site is polymorphic", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const fn1 = {
        id: 1,
        version: 0,
        name: "fn1",
        paramCount: 2,
        instructions: new Array(10),
        feedbackVector: new FeedbackVector(1),
      };
      const fn2 = {
        id: 2,
        version: 0,
        name: "fn2",
        paramCount: 2,
        instructions: new Array(10),
        feedbackVector: new FeedbackVector(1),
      };

      slot.recordCallTarget("fn1", fn1, 2);
      slot.recordCallTarget("fn2", fn2, 2);

      assert.equal(slot.isPolymorphic(), true);
      const targets = slot.getPolymorphicCallTargets();
      assert.ok(targets);
      assert.equal(targets.length, 2);
    });
  });
});
