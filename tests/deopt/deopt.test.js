import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FrameState } from "../../src/deopt/frame-state.js";
import {
  RegisterInterpreter,
  MAX_DEOPT_COUNT,
} from "../../src/bytecode/register/interpreter/index.js";
import { DEFAULT_TIERING_POLICY } from "../../src/runtime/tiering/policy.js";
import { DeoptSignal } from "../../src/deopt/signal.js";
import {
  DEOPT_ELEMENTS_KIND_CHECK_FAILED,
  DEOPT_MAP_CHECK_FAILED,
  DEOPT_SMI_CHECK_FAILED,
  DEOPT_WRONG_CALL_TARGET,
} from "../../src/deopt/deoptimizer.js";
const JIT_THRESHOLD = DEFAULT_TIERING_POLICY.jitThreshold;
import { MiniJIT } from "../../src/index.js";
import { RegisterBytecodeCompiler } from "../../src/bytecode/register/compiler/index.js";
import { Lexer } from "../../src/frontend/lexer/index.js";
import { Parser } from "../../src/frontend/parser/index.js";
import { RegisterCompiledFunction } from "../../src/bytecode/register/ops/bytecode.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import {
  resetIRNodeIds,
  irConstant,
  irParameter,
  IR_TYPEOF,
} from "../../src/optimizing/ir/index.js";
import {
  createJSArray,
  createJSObject,
} from "../../src/objects/heap/factory.js";
import {
  mkSmi,
  mkDouble,
  mkString,
  mkObject,
  mkArray,
} from "../../src/core/value/index.js";

function compileSource(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new RegisterBytecodeCompiler();
  return compiler.compile(ast);
}

describe("FrameState", () => {
  it("creates with compiled function and offset", () => {
    const fn = new RegisterCompiledFunction("test", 2);
    const fs = new FrameState(fn, 5);
    assert.equal(fs.compiledFunction, fn);
    assert.equal(fs.bytecodeOffset, 5);
  });

  it("stores and retrieves locals", () => {
    const fn = new RegisterCompiledFunction("test", 2);
    const fs = new FrameState(fn, 0);
    const val1 = irConstant(42);
    const val2 = irConstant(99);

    fs.setLocal(0, val1);
    fs.setLocal(1, val2);

    assert.equal(fs.localValues.get(0), val1);
    assert.equal(fs.localValues.get(1), val2);
  });

  it("pushes stack values", () => {
    const fn = new RegisterCompiledFunction("test", 0);
    const fs = new FrameState(fn, 0);
    const val = irConstant(10);

    fs.pushStack(val);
    assert.equal(fs.stackValues.length, 1);
    assert.equal(fs.stackValues[0], val);
  });

  it("reports localCount correctly", () => {
    const fn = new RegisterCompiledFunction("test", 0);
    const fs = new FrameState(fn, 0);
    assert.equal(fs.localCount, 0);

    fs.setLocal(0, irConstant(1));
    fs.setLocal(1, irConstant(2));
    assert.equal(fs.localCount, 2);
  });

  it("reports stackDepth correctly", () => {
    const fn = new RegisterCompiledFunction("test", 0);
    const fs = new FrameState(fn, 0);
    assert.equal(fs.stackDepth, 0);

    fs.pushStack(irConstant(1));
    fs.pushStack(irConstant(2));
    fs.pushStack(irConstant(3));
    assert.equal(fs.stackDepth, 3);
  });

  it("sets bytecodeOffset", () => {
    const fn = new RegisterCompiledFunction("test", 0);
    const fs = new FrameState(fn, 5);
    fs.setBytecodeOffset(10);
    assert.equal(fs.bytecodeOffset, 10);
  });

  it("sets thisValue", () => {
    const fn = new RegisterCompiledFunction("test", 0);
    const fs = new FrameState(fn, 0);
    const thisVal = irConstant("this");
    fs.setThis(thisVal);
    assert.equal(fs.thisValue, thisVal);
  });

  describe("clone", () => {
    it("creates independent copy", () => {
      const fn = new RegisterCompiledFunction("test", 2);
      const fs = new FrameState(fn, 3);
      fs.setLocal(0, irConstant(10));
      fs.setLocal(1, irConstant(20));
      fs.pushStack(irConstant(30));
      fs.setThis(irConstant("self"));

      const clone = fs.clone();

      assert.equal(clone.compiledFunction, fn);
      assert.equal(clone.bytecodeOffset, 3);
      assert.equal(clone.localValues.get(0), fs.localValues.get(0));
      assert.equal(clone.localValues.get(1), fs.localValues.get(1));
      assert.equal(clone.stackValues.length, 1);
      assert.equal(clone.thisValue, fs.thisValue);
    });

    it("mutating clone does not affect original", () => {
      const fn = new RegisterCompiledFunction("test", 1);
      const fs = new FrameState(fn, 0);
      fs.setLocal(0, irConstant(1));
      fs.pushStack(irConstant(2));

      const clone = fs.clone();
      clone.setLocal(0, irConstant(99));
      clone.pushStack(irConstant(88));

      assert.notEqual(fs.localValues.get(0), clone.localValues.get(0));
      assert.equal(fs.stackValues.length, 1);
      assert.equal(clone.stackValues.length, 2);
    });
  });

  describe("toString", () => {
    it("includes function name", () => {
      const fn = new RegisterCompiledFunction("myFunc", 0);
      const fs = new FrameState(fn, 5);
      const str = fs.toString();
      assert.ok(str.includes("myFunc"), str);
    });

    it("includes bytecode offset", () => {
      const fn = new RegisterCompiledFunction("test", 0);
      const fs = new FrameState(fn, 42);
      const str = fs.toString();
      assert.ok(str.includes("42"), str);
    });
  });
});

describe("DeoptSignal", () => {
  it("carries reason and bytecode offset", () => {
    const signal = new DeoptSignal("guard-failure", 10, [], []);
    assert.equal(signal.reason, "guard-failure");
    assert.equal(signal.bytecodeOffset, 10);
  });

  it("carries stack and locals", () => {
    const stack = [mkSmi(1), mkSmi(2)];
    const locals = [mkSmi(10)];
    const signal = new DeoptSignal("not-smi", 5, stack, locals);
    assert.equal(signal.stack.length, 2);
    assert.equal(signal.locals.length, 1);
  });
});

describe("Full deopt cycle", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetIRNodeIds();
  });

  it("trains, compiles, deopts on wrong type, still returns correct result", () => {
    const engine = new MiniJIT();

    const src = `
function add(a, b) { return a + b; }
let i = 0;
while (i < 200) {
  add(i, i + 1);
  i = i + 1;
}
add(42, 58);`;

    const result = engine.runValue(src);
    assert.equal(result.tag, "smi");
    assert.equal(result.value, 100);
  });

  it("deopt increments deoptCount on the compiled function", () => {
    const engine = new MiniJIT();

    const src = "function add(a, b) { return a + b; }";
    const script = compileSource(src);
    const addFn = script.constants.find((c) => c.name === "add");

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(addFn, [mkSmi(i), mkSmi(i)]);
    }

    assert.ok(
      addFn.optimizedCode !== null,
      "Expected function to be JIT compiled",
    );

    const deoptCountBefore = addFn.deoptCount || 0;
    engine.interpreter.execute(addFn, [mkString("hello"), mkString(" world")]);
    assert.ok(
      addFn.deoptCount > deoptCountBefore,
      "Expected deoptCount to increase",
    );
    assert.equal(addFn.lastDeoptReason, DEOPT_SMI_CHECK_FAILED);
  });

  it("classifies wrong map deopts separately from numeric guard deopts", () => {
    const engine = new MiniJIT();
    const script = compileSource("function getX(obj) { return obj.x; }");
    const getX = script.constants.find((c) => c.name === "getX");
    const first = createJSObject();
    first.setProperty("x", mkSmi(1));
    const second = createJSObject();
    second.setProperty("y", mkSmi(2));
    second.setProperty("x", mkSmi(3));

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(getX, [mkObject(first)]);
    }

    assert.ok(getX.optimizedCode !== null);
    const result = engine.executeValue(getX, [mkObject(second)]);
    assert.equal(result.value, 3);
    assert.equal(getX.lastDeoptReason, DEOPT_MAP_CHECK_FAILED);
  });

  it("classifies wrong elements kind deopts separately from map deopts", () => {
    const engine = new MiniJIT();
    const script = compileSource("function first(arr) { return arr[0]; }");
    const firstFn = script.constants.find((c) => c.name === "first");
    const smiArray = mkArray(createJSArray([mkSmi(1), mkSmi(2)]));
    const doubleArray = mkArray(createJSArray([mkDouble(1.5), mkDouble(2.5)]));

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(firstFn, [smiArray]);
    }

    assert.ok(firstFn.optimizedCode !== null);
    const result = engine.executeValue(firstFn, [doubleArray]);
    assert.equal(result.value, 1.5);
    assert.equal(firstFn.lastDeoptReason, DEOPT_ELEMENTS_KIND_CHECK_FAILED);
  });

  it("classifies invalid runtime call targets as wrong call target deopts", () => {
    const engine = new MiniJIT();
    const script = compileSource(`
function id(x) { return x; }
function invoke(fn, x) { return fn(x); }
`);
    engine.interpreter.execute(script);
    const idValue = engine.interpreter.globalCells.read("id");
    const invokeFn = script.constants.find((c) => c.name === "invoke");

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(invokeFn, [idValue, mkSmi(i)]);
    }

    assert.ok(invokeFn.optimizedCode !== null);
    assert.throws(() =>
      engine.interpreter.execute(invokeFn, [mkSmi(7), mkSmi(8)]),
    );
    assert.equal(invokeFn.lastDeoptReason, DEOPT_WRONG_CALL_TARGET);
  });

  it("resumes method calls with field-loaded callees after wrong call target deopts", () => {
    const engine = new MiniJIT();
    const script = compileSource(`
function alpha(value) { return value + 10; }
function beta(value) { return value + 20; }
function dispatch(obj, value) { return obj.run(value); }
`);
    engine.interpreter.execute(script);
    const alphaValue = engine.interpreter.globalCells.read("alpha");
    const betaValue = engine.interpreter.globalCells.read("beta");
    const dispatchFn = script.constants.find((c) => c.name === "dispatch");
    const first = createJSObject();
    first.setProperty("run", alphaValue);
    const second = createJSObject();
    second.setProperty("run", betaValue);

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(dispatchFn, [mkObject(first), mkSmi(i)]);
    }

    assert.ok(dispatchFn.optimizedCode !== null);
    const result = engine.executeValue(dispatchFn, [
      mkObject(second),
      mkSmi(5),
    ]);
    assert.equal(result.value, 25);
    assert.equal(dispatchFn.lastDeoptReason, DEOPT_WRONG_CALL_TARGET);
  });

  it("keeps polymorphic field-loaded method calls optimized through generic call dispatch", () => {
    const engine = new MiniJIT();
    const script = compileSource(`
function alpha(value) { return value + 10; }
function beta(value) { return value + 20; }
function gamma(value) { return value + 30; }
function dispatch(obj, value) { return obj.run(value); }
`);
    engine.interpreter.execute(script);
    const alphaValue = engine.interpreter.globalCells.read("alpha");
    const betaValue = engine.interpreter.globalCells.read("beta");
    const gammaValue = engine.interpreter.globalCells.read("gamma");
    const dispatchFn = script.constants.find((c) => c.name === "dispatch");
    const first = createJSObject();
    first.setProperty("run", alphaValue);
    const second = createJSObject();
    second.setProperty("pad", mkSmi(1));
    second.setProperty("run", betaValue);
    const third = createJSObject();
    third.setProperty("run", gammaValue);

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      const receiver = i % 2 === 0 ? first : second;
      engine.interpreter.execute(dispatchFn, [mkObject(receiver), mkSmi(i)]);
    }

    assert.ok(dispatchFn.optimizedCode !== null);
    const result = engine.executeValue(dispatchFn, [mkObject(third), mkSmi(5)]);
    assert.equal(result.value, 35);
    assert.equal(dispatchFn.lastDeoptReason, undefined);
  });

  it("does not repeatedly deopt while optimized code is in cooldown", () => {
    const engine = new MiniJIT();

    const src = "function add(a, b) { return a + b; }";
    const script = compileSource(src);
    const addFn = script.constants.find((c) => c.name === "add");

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(addFn, [mkSmi(i), mkSmi(i)]);
    }
    assert.ok(addFn.optimizedCode);

    engine.interpreter.execute(addFn, [mkString("a"), mkString("b")]);
    const deoptCount = addFn.deoptCount;

    assert.equal(addFn.optimizedCode, null);

    for (let i = 0; i < MAX_DEOPT_COUNT + 1; i++) {
      engine.interpreter.execute(addFn, [mkString("a"), mkString("b")]);
    }

    assert.equal(addFn.deoptCount, deoptCount);
    assert.equal(addFn.disableOptimization, false);
  });

  it("continues executing correctly in interpreter after deopt", () => {
    const engine = new MiniJIT();

    const src = "function add(a, b) { return a + b; }";
    const script = compileSource(src);
    const addFn = script.constants.find((c) => c.name === "add");

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(addFn, [mkSmi(i), mkSmi(i)]);
    }

    assert.ok(addFn.optimizedCode !== null);

    const r1 = engine.executeValue(addFn, [
      mkString("hello"),
      mkString(" world"),
    ]);
    assert.equal(r1.tag, "string");
    assert.equal(r1.value, "hello world");

    const r2 = engine.executeValue(addFn, [mkSmi(10), mkSmi(20)]);
    assert.equal(r2.tag, "smi");
    assert.equal(r2.value, 30);
  });

  it("deopt from compiled function resumes at correct point", () => {
    const engine = new MiniJIT();

    const src = "function add(a, b) { return a + b; }";
    const script = compileSource(src);
    const addFn = script.constants.find((c) => c.name === "add");

    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(addFn, [mkSmi(i), mkSmi(i)]);
    }

    const result = engine.executeValue(addFn, [mkDouble(1.5), mkDouble(2.5)]);
    assert.equal(result.value, 4);
  });
});

describe("compile cooldown policy", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetIRNodeIds();
  });

  it("runtime-stubbed typeof compiles without cooldown", () => {
    const engine = new MiniJIT();

    const src = "function mixed(a) { return typeof a; }";

    const script = compileSource(src);
    const mixedFn = script.constants.find((c) => c.name === "mixed");

    engine.interpreter.execute(mixedFn, [mkSmi(1)]);

    engine.optimizeFunction(mixedFn);
    assert.equal(mixedFn.disableOptimization, false);
    assert.ok(mixedFn.optimizedCode !== null);
    assert.equal(mixedFn.compileFailureCount || 0, 0);
    assert.ok(
      !mixedFn.optimizationCooldownUntil ||
        mixedFn.optimizationCooldownUntil <= Date.now(),
    );
    assert.ok(
      mixedFn.optimizedStubSummary.some(
        (s) => s.opcode === IR_TYPEOF && s.outputRep === "handle",
      ),
    );
  });

  it("runtime-stubbed typeof remains optimized on repeated tier checks", () => {
    const engine = new MiniJIT();

    const src = "function f(a) { return typeof a; }";
    const script = compileSource(src);
    const fn = script.constants.find((c) => c.name === "f");

    engine.interpreter.execute(fn, [mkSmi(1)]);

    engine.optimizeFunction(fn);
    assert.equal(fn.disableOptimization, false);
    assert.ok(fn.optimizedCode !== null);
    const firstFailures = fn.compileFailureCount;
    const optimizedCode = fn.optimizedCode;

    fn.invocationCount = JIT_THRESHOLD + 100;
    for (let i = 0; i < 50; i++) {
      engine.interpreter.execute(fn, [mkSmi(i)]);
    }

    assert.equal(fn.optimizedCode, optimizedCode);
    assert.equal(fn.compileFailureCount, firstFailures);

    fn.optimizationCooldownUntil = 0;
    for (let i = 0; i < JIT_THRESHOLD + 10; i++) {
      engine.interpreter.execute(fn, [mkSmi(i)]);
    }
    assert.ok(fn.optimizedCode !== null);
  });
});
