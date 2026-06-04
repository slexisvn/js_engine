import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { RegisterBytecodeCompiler } from "../../src/bytecode/register/compiler/index.js";
import { Lexer } from "../../src/frontend/lexer/index.js";
import { Parser } from "../../src/frontend/parser/index.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import {
  createJSArray,
  createJSObject,
} from "../../src/objects/heap/factory.js";
import { PACKED_SMI } from "../../src/objects/elements/elements-kind.js";
import {
  dependencyRegistry,
  DEP_CALL_TARGET,
  DEP_ELEMENTS_KIND,
  DEP_MAP,
} from "../../src/deopt/dependencies.js";
import { resetIRNodeIds } from "../../src/optimizing/ir/index.js";
import {
  mkArray,
  mkDouble,
  mkObject,
  mkSmi,
} from "../../src/core/value/index.js";

function compileSource(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new RegisterBytecodeCompiler();
  return compiler.compile(ast);
}

describe("Optimized dependencies", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetIRNodeIds();
    dependencyRegistry.clear();
  });

  it("registers map dependencies for monomorphic field loads", () => {
    const engine = new MiniJIT();
    const script = compileSource("function getX(obj) { return obj.x; }");
    const getX = script.constants.find((c) => c.name === "getX");
    const obj = createJSObject();
    obj.setProperty("x", mkSmi(1));

    for (let i = 0; i < 20; i++) {
      engine.interpreter.execute(getX, [mkObject(obj)]);
    }
    engine.optimizeFunction(getX);

    assert.ok(getX.optimizedCode);
    assert.ok(
      getX.optimizedDependencies.some(
        (d) =>
          d.kind === DEP_MAP &&
          d.id === obj.hiddenClass.id &&
          d.version === obj.hiddenClass.version,
      ),
    );
  });

  it("marks map dependents for lazy deopt on property mutation", () => {
    const engine = new MiniJIT();
    const script = compileSource("function getX(obj) { return obj.x; }");
    const getX = script.constants.find((c) => c.name === "getX");
    const obj = createJSObject();
    obj.setProperty("x", mkSmi(1));

    for (let i = 0; i < 20; i++) {
      engine.interpreter.execute(getX, [mkObject(obj)]);
    }
    engine.optimizeFunction(getX);
    assert.ok(getX.optimizedCode);

    obj.setProperty("x", mkSmi(9));
    assert.equal(engine.deoptimizer.lazyMarker.hasPendingDeopt(getX), true);

    const result = engine.executeValue(getX, [mkObject(obj)]);
    assert.equal(result.value, 9);
    assert.equal(getX.optimizedCode, null);
    assert.equal(getX.dependencyDeoptCount, 1);
  });

  it("registers elements kind dependencies and invalidates on transition", () => {
    const engine = new MiniJIT();
    const script = compileSource(`
function sumArray(arr) {
  let sum = 0;
  let i = 0;
  while (i < arr.length) {
    sum = sum + arr[i];
    i = i + 1;
  }
  return sum;
}`);
    const sumArray = script.constants.find((c) => c.name === "sumArray");
    const jsArr = createJSArray([mkSmi(1), mkSmi(2), mkSmi(3)]);
    const arr = mkArray(jsArr);

    for (let i = 0; i < 30; i++) {
      engine.interpreter.execute(sumArray, [arr]);
    }
    engine.optimizeFunction(sumArray);

    assert.ok(sumArray.optimizedCode);
    assert.ok(
      sumArray.optimizedDependencies.some(
        (d) => d.kind === DEP_ELEMENTS_KIND && d.id === PACKED_SMI,
      ),
    );

    jsArr.setIndex(1, mkDouble(2.5));
    assert.equal(engine.deoptimizer.lazyMarker.hasPendingDeopt(sumArray), true);

    const result = engine.executeValue(sumArray, [arr]);
    assert.equal(result.value, 6.5);
    assert.equal(sumArray.optimizedCode, null);
  });

  it("registers call target dependencies for inlined calls", () => {
    const engine = new MiniJIT({
      tieringPolicy: {
        jitThreshold: 100000,
        loopOsrThreshold: 100000,
        baselineThreshold: 100000,
      },
    });
    const script = compileSource(`
function add(a, b) { return a + b; }
function caller(x) { return add(x, x); }
`);
    engine.interpreter.execute(script);
    const add = script.constants.find((c) => c.name === "add");
    const caller = script.constants.find((c) => c.name === "caller");

    for (let i = 0; i < 40; i++) {
      engine.interpreter.execute(caller, [mkSmi(i)]);
    }
    engine.optimizeFunction(caller);

    assert.ok(
      caller.optimizedDependencies.some(
        (d) =>
          d.kind === DEP_CALL_TARGET &&
          d.id === add.id &&
          d.version === add.version,
      ),
    );
  });
});
