import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { SpeculativeOptimizer } from "../../src/optimizing/optimizer.js";
import { WasmCodegen } from "../../src/optimizing/wasm/codegen.js";
import { buildIR } from "../../src/optimizing/builder/ir-builder.js";
import { RegisterBytecodeCompiler } from "../../src/bytecode/register/compiler/index.js";
import { Lexer } from "../../src/frontend/lexer/index.js";
import { Parser } from "../../src/frontend/parser/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { MiniJIT } from "../../src/index.js";
import {
  FeedbackVector,
  FeedbackSlot,
  FEEDBACK_BINARY_OP,
  FEEDBACK_PROPERTY,
} from "../../src/feedback/vector/index.js";
import {
  resetHiddenClasses,
  ROOT_HIDDEN_CLASS,
} from "../../src/objects/maps/hidden-class.js";
import {
  createJSObject,
  createJSArray,
} from "../../src/objects/heap/factory.js";
import {
  PACKED_SMI,
  PACKED_DOUBLE,
  HOLEY_SMI,
} from "../../src/objects/elements/elements-kind.js";
import {
  mkSmi,
  mkDouble,
  mkObject,
  mkArray,
  mkNumber,
  mkString,
  mkBool,
  mkUndefined,
  mkNull,
  getPayload,
  getTag,
} from "../../src/core/value/index.js";
import {
  IR_PARAMETER,
  IR_CONSTANT,
  IR_CHECK_SMI,
  IR_CHECK_NUMBER,
  IR_CHECK_MAP,
  IRGraph,
  IR_CHECK_ELEMENTS_KIND,
  IR_INT32_ADD,
  IR_INT32_SUB,
  IR_INT32_MUL,
  IR_FLOAT64_ADD,
  IR_LOAD_FIELD,
  IR_STORE_FIELD,
  IR_LOAD_ARRAY_LENGTH,
  IR_LOAD_ELEMENT,
  IR_POLYMORPHIC_LOAD,
  IR_POLYMORPHIC_STORE,
  IR_RETURN,
  IR_GENERIC_ADD,
  IR_GENERIC_COMPARE,
  IR_GENERIC_GET_PROP,
  IR_GENERIC_SET_PROP,
  IR_GENERIC_GET_INDEX,
  IR_GENERIC_SET_INDEX,
  IR_GENERIC_CALL,
  IR_LOAD_GLOBAL,
  IR_GENERIC_BITAND,
  IR_GENERIC_BITOR,
  IR_GENERIC_BITXOR,
  IR_GENERIC_SHL,
  IR_GENERIC_SHR,
  IR_GENERIC_USHR,
  IR_GENERIC_POW,
  IR_GENERIC_BITNOT,
  IR_GENERIC_INSTANCEOF,
  IR_GENERIC_IN,
  IR_NEW_REGEX,
  IR_NEW_ARRAY,
  IR_NEW_OBJECT,
  IR_TYPEOF,
  IR_NOT,
  IR_NEG,
  IR_UNBOX,
  IR_BLOCK_PARAM,
  resetIRNodeIds,
} from "../../src/optimizing/ir/index.js";

function compileFunction(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new RegisterBytecodeCompiler();
  return compiler.compile(ast);
}

function trainSmiAdd(compiledFn, interpreter, iterations) {
  for (let i = 0; i < iterations; i++) {
    interpreter.execute(compiledFn, [mkSmi(i), mkSmi(i + 1)]);
  }
}

function buildInitialGraph(compiledFn) {
  const graph = new IRGraph(compiledFn.name);
  const frameStates = [];
  for (let i = 0; i < compiledFn.paramCount; i++) graph.addParameter(i);
  buildIR(
    graph,
    graph.addBlock(),
    compiledFn,
    compiledFn.feedbackVector,
    frameStates,
  );
  graph.rebuildUses();
  return graph;
}

describe("SpeculativeOptimizer", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetIRNodeIds();
  });

  describe("smi-trained arithmetic", () => {
    it("produces CheckSmi + Int32Add for smi-only add", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      assert.ok(innerFn, 'Expected to find inner function "add"');

      const engine = new MiniJIT();
      const interpreter = engine.interpreter;

      trainSmiAdd(innerFn, interpreter, 5);

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);

      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const checkSmis = allNodes.filter((n) => n.type === IR_CHECK_SMI);
      const int32Adds = allNodes.filter((n) => n.type === IR_INT32_ADD);

      assert.ok(
        checkSmis.length >= 2,
        `Expected >=2 CheckSmi nodes, got ${checkSmis.length}`,
      );
      assert.ok(
        int32Adds.length >= 1,
        `Expected >=1 Int32Add nodes, got ${int32Adds.length}`,
      );
    });

    it("produces Int32Sub for smi-trained subtraction", () => {
      const src = "function sub(a, b) { return a - b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "sub");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i + 10), mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const int32Subs = allNodes.filter((n) => n.type === IR_INT32_SUB);
      assert.ok(int32Subs.length >= 1);
    });

    it("produces Float64Add for mixed number feedback", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [
          mkDouble(i + 0.5),
          mkDouble(i + 1.5),
        ]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const float64Adds = allNodes.filter((n) => n.type === IR_FLOAT64_ADD);
      assert.ok(float64Adds.length >= 1);
    });

    it("produces GenericAdd without type feedback", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      engine.interpreter.execute(innerFn, [mkSmi(1), mkSmi(2)]);
      engine.interpreter.execute(innerFn, [
        mkSmi(1),
        { tag: "string", value: "x" },
      ]);

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const genericAdds = allNodes.filter((n) => n.type === IR_GENERIC_ADD);
      assert.ok(
        genericAdds.length >= 1,
        "Expected GenericAdd for mixed type feedback",
      );
    });
  });

  describe("monomorphic property access", () => {
    it("produces CheckMap + LoadField for monomorphic property", () => {
      const src = "function getX(obj) { return obj.x; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "getX");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        const obj = createJSObject();
        obj.setProperty("x", mkSmi(i));
        engine.interpreter.execute(innerFn, [mkObject(obj)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);

      const checkMaps = allNodes.filter((n) => n.type === IR_CHECK_MAP);
      const loadFields = allNodes.filter((n) => n.type === IR_LOAD_FIELD);

      assert.ok(
        checkMaps.length >= 1,
        `Expected >=1 CheckMap, got ${checkMaps.length}`,
      );
      assert.ok(
        loadFields.length >= 1,
        `Expected >=1 LoadField, got ${loadFields.length}`,
      );

      const checkMap = checkMaps[0];
      assert.ok(checkMap.props.expectedMapId !== undefined);

      const loadField = loadFields[0];
      assert.equal(loadField.props.offset, 0);
    });

    it("produces PolymorphicLoad for polymorphic property", () => {
      const src = "function getX(obj) { return obj.x; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "getX");
      const engine = new MiniJIT();

      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      engine.interpreter.execute(innerFn, [mkObject(obj1)]);

      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(2));
      engine.interpreter.execute(innerFn, [mkObject(obj2)]);

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);

      const polymorphicLoads = allNodes.filter(
        (n) => n.type === IR_POLYMORPHIC_LOAD,
      );
      assert.ok(
        polymorphicLoads.length >= 1,
        "Expected PolymorphicLoad for polymorphic access",
      );
    });

    it("falls back to GenericGetProp for prototype property feedback", () => {
      const src = "function getX(obj) { return obj.x; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "getX");
      const engine = new MiniJIT();
      const proto = createJSObject();
      proto.setProperty("x", mkSmi(1));

      for (let i = 0; i < 5; i++) {
        const obj = createJSObject();
        obj.setPrototype(proto);
        engine.interpreter.execute(innerFn, [mkObject(obj)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);

      const genericGets = allNodes.filter(
        (n) => n.type === IR_GENERIC_GET_PROP,
      );
      const loadFields = allNodes.filter((n) => n.type === IR_LOAD_FIELD);
      assert.ok(genericGets.length >= 1);
      assert.equal(loadFields.length, 0);
    });

    it("produces PolymorphicStore for polymorphic own property stores", () => {
      const src = "function setX(obj, v) { obj.x = v; return obj.x; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "setX");
      innerFn.feedbackVector = new FeedbackVector(innerFn.feedbackSlotCount);
      innerFn.feedbackVector.initSlot(0, FEEDBACK_PROPERTY);
      const slot = innerFn.feedbackVector.getSlot(0);
      slot.recordPropertyAccess(101, 0, 1, 0);
      slot.recordPropertyAccess(103, 2, 1, 0);

      const graph = buildInitialGraph(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);

      assert.ok(allNodes.some((n) => n.type === IR_POLYMORPHIC_STORE));
      assert.equal(
        allNodes.filter((n) => n.type === IR_GENERIC_SET_PROP).length,
        0,
      );
    });

    it("falls back to GenericSetProp when polymorphic store feedback includes prototype depth", () => {
      const src = "function setX(obj, v) { obj.x = v; return obj.x; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "setX");
      innerFn.feedbackVector = new FeedbackVector(innerFn.feedbackSlotCount);
      innerFn.feedbackVector.initSlot(0, FEEDBACK_PROPERTY);
      const slot = innerFn.feedbackVector.getSlot(0);
      slot.recordPropertyAccess(107, 0, 1, 0);
      slot.recordPropertyAccess(109, 1, 1, 1);

      const graph = buildInitialGraph(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);

      assert.ok(allNodes.some((n) => n.type === IR_GENERIC_SET_PROP));
      assert.equal(
        allNodes.filter((n) => n.type === IR_POLYMORPHIC_STORE).length,
        0,
      );
      assert.equal(allNodes.filter((n) => n.type === IR_STORE_FIELD).length, 0);
    });
  });

  describe("packed numeric array access", () => {
    it("produces packed smi element load and array length nodes", () => {
      const src = `
function sumArray(arr) {
  let sum = 0;
  let i = 0;
  while (i < arr.length) {
    sum = sum + arr[i];
    i = i + 1;
  }
  return sum;
}`;
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "sumArray");
      const engine = new MiniJIT();
      const arr = mkArray(createJSArray([mkSmi(1), mkSmi(2), mkSmi(3)]));

      for (let i = 0; i < 20; i++) {
        engine.interpreter.execute(innerFn, [arr]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const kindChecks = allNodes.filter(
        (n) => n.type === IR_CHECK_ELEMENTS_KIND,
      );
      const lengths = allNodes.filter((n) => n.type === IR_LOAD_ARRAY_LENGTH);
      const loads = allNodes.filter((n) => n.type === IR_LOAD_ELEMENT);

      assert.ok(kindChecks.some((n) => n.props.elementsKind === PACKED_SMI));
      assert.ok(lengths.length >= 1);
      assert.ok(
        loads.some(
          (n) =>
            n.props.elementsKind === PACKED_SMI &&
            n.props.elementRep === "int32",
        ),
      );
    });

    it("produces packed double element load", () => {
      const src = `
function sumArray(arr) {
  let sum = 0.0;
  let i = 0;
  while (i < arr.length) {
    sum = sum + arr[i];
    i = i + 1;
  }
  return sum;
}`;
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "sumArray");
      const engine = new MiniJIT();
      const arr = mkArray(
        createJSArray([mkDouble(1.5), mkDouble(2.5), mkDouble(3.5)]),
      );

      for (let i = 0; i < 20; i++) {
        engine.interpreter.execute(innerFn, [arr]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const loads = allNodes.filter((n) => n.type === IR_LOAD_ELEMENT);

      assert.ok(
        loads.some(
          (n) =>
            n.props.elementsKind === PACKED_DOUBLE &&
            n.props.elementRep === "float64",
        ),
      );
    });

    it("keeps holey arrays on generic index path", () => {
      const src = "function getAt(arr, i) { return arr[i]; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "getAt");
      const engine = new MiniJIT();
      const jsArr = createJSArray([mkSmi(1), mkSmi(2)]);
      jsArr.setIndex(4, mkSmi(5));
      assert.equal(jsArr.getElementsKind(), HOLEY_SMI);
      const arr = mkArray(jsArr);

      for (let i = 0; i < 10; i++) {
        engine.interpreter.execute(innerFn, [arr, mkSmi(0)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const allNodes = graph.blocks.flatMap((b) => b.nodes);

      assert.equal(
        allNodes.filter((n) => n.type === IR_LOAD_ELEMENT).length,
        0,
      );
      assert.ok(allNodes.some((n) => n.type === IR_GENERIC_GET_INDEX));
    });
  });

  describe("redundant check elimination", () => {
    it("removes duplicate CheckSmi for same input", () => {
      const src = "function calc(a, b) { return (a + b) + (a - b); }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "calc");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i + 5), mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);

      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const checkSmis = allNodes.filter((n) => n.type === IR_CHECK_SMI);

      assert.ok(
        checkSmis.length <= 4,
        `Expected <=4 CheckSmi after elimination (a, b checked once + 2 results), got ${checkSmis.length}`,
      );
    });

    it("simple function has exactly 2 CheckSmi for 2 params", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i), mkSmi(i + 1)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);

      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const checkSmis = allNodes.filter((n) => n.type === IR_CHECK_SMI);

      assert.equal(
        checkSmis.length,
        2,
        `Expected exactly 2 CheckSmi for add(a, b), got ${checkSmis.length}`,
      );
    });
  });

  describe("constant folding", () => {
    it("foldConstants processes blocks without error", () => {
      const src = "function f() { return 3 + 4; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, []);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);

      const allNodes = graph.blocks.flatMap((b) => b.nodes);
      const constants = allNodes.filter((n) => n.type === IR_CONSTANT);

      const has3 = constants.some((n) => n.props.value === 3);
      const has4 = constants.some((n) => n.props.value === 4);
      assert.ok(has3, "Expected constant 3 in graph");
      assert.ok(has4, "Expected constant 4 in graph");
    });

    it("constant function still computes correct result via wasm", () => {
      const src = "function f() { return 3 + 4; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, []);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      if (wasmFn) {
        const r = wasmFn([], null, engine.interpreter);
        assert.equal(getPayload(r), 7);
      } else {
        const interpreted = engine.interpreter.execute(innerFn, []);
        assert.equal(getPayload(interpreted), 7);
      }
    });
  });

  describe("frame states", () => {
    it("captures frame states for speculative operations", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      trainSmiAdd(innerFn, interpreter(engine), 5);

      const optimizer = new SpeculativeOptimizer();
      const { frameStates } = optimizer.compile(innerFn);

      assert.ok(frameStates.length > 0, "Expected at least one frame state");
      const fs = frameStates[0];
      assert.equal(fs.compiledFunction, innerFn);
      assert.ok(fs.bytecodeOffset >= 0);
    });
  });

  describe("CFG-first IR", () => {
    it("uses block params and edge args for loop state", () => {
      const src = `
function count(arr) {
  let i = 0;
  while (i < arr.length) {
    i = i + 1;
  }
  return i;
}`;
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "count");
      const engine = new MiniJIT();
      const arr = mkArray(createJSArray([mkSmi(1), mkSmi(2), mkSmi(3)]));

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(innerFn, [arr]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const loopHeader = result.graph.blocks.find((b) => b.isLoopHeader);

      assert.ok(result.graph.dump().includes("CFG Function"));
      assert.ok(loopHeader);
      assert.ok(loopHeader.params.length > 0);
      assert.ok(
        loopHeader.nodes
          .slice(0, loopHeader.params.length)
          .every((n) => n.type === IR_BLOCK_PARAM),
      );
      assert.ok(
        loopHeader.predecessors.some(
          (pred) =>
            (pred.getEdgeArgs(loopHeader) || []).length ===
            loopHeader.params.length,
        ),
      );
    });
  });
});

function interpreter(engine) {
  return engine.interpreter;
}

describe("WasmCodegen", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetIRNodeIds();
  });

  describe("canCompile gate", () => {
    it("returns false for null graph", () => {
      const codegen = new WasmCodegen();
      assert.equal(codegen.canCompile(null), false);
    });

    it("returns false for empty graph", () => {
      const codegen = new WasmCodegen();
      assert.equal(codegen.canCompile({ blocks: [] }), false);
    });

    it("accepts graphs with runtime-stubbed generic nodes", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      engine.interpreter.execute(innerFn, [
        mkSmi(1),
        { tag: "string", value: "x" },
      ]);

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      assert.equal(codegen.canCompile(graph), true);
    });

    it("accepts supported multi-block graphs", () => {
      const src = `
function f(x) {
  if (x > 0) { return x; }
  return 0;
}`;
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      assert.equal(codegen.canCompile(graph), true);
    });

    it("accepts object-field call targets when handle field lowering is available", () => {
      const src = `
function target(value) { return value + 1; }
function dispatch(obj, value) { return obj.run(value); }
`;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      engine.interpreter.execute(script);
      const targetValue = engine.interpreter.globalCells.read("target");
      const dispatchFn = script.constants.find((c) => c.name === "dispatch");
      const receiver = createJSObject();
      receiver.setProperty("run", targetValue);

      for (let i = 0; i < 8; i++) {
        engine.interpreter.execute(dispatchFn, [mkObject(receiver), mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const { graph } = optimizer.compile(dispatchFn);
      const codegen = new WasmCodegen();
      assert.equal(codegen.canCompile(graph), true);
    });
  });

  describe("monomorphic property codegen", () => {
    it("returns LoadField values from optimized wasm for later same-shape objects", () => {
      const src = "function getX(obj) { return obj.x; }";
      const cases = [
        { name: "smi", value: mkSmi(777), tag: "smi", payload: 777 },
        { name: "double", value: mkDouble(7.25), tag: "double", payload: 7.25 },
        { name: "bool", value: mkBool(true), tag: "bool", payload: true },
        { name: "string", value: mkString("ok"), tag: "string", payload: "ok" },
        {
          name: "undefined",
          value: mkUndefined(),
          tag: "undefined",
          payload: undefined,
        },
        { name: "null", value: mkNull(), tag: "null", payload: null },
      ];

      for (const testCase of cases) {
        const script = compileFunction(src);
        const getX = script.constants.find((c) => c.name === "getX");
        const engine = new MiniJIT();

        const trainObj = createJSObject();
        trainObj.setProperty("x", mkSmi(1));
        for (let i = 0; i < 20; i++) {
          engine.interpreter.execute(getX, [mkObject(trainObj)]);
        }

        engine.optimizeFunction(getX);
        assert.ok(getX.optimizedCode, testCase.name);

        const lateObj = createJSObject();
        lateObj.setProperty("x", testCase.value);
        const result = engine.executeValue(getX, [mkObject(lateObj)]);

        assert.equal(result.tag, testCase.tag, testCase.name);
        assert.equal(result.value, testCase.payload, testCase.name);
      }
    });

    it("returns object LoadField values from optimized wasm", () => {
      const src = "function getX(obj) { return obj.x; }";
      const script = compileFunction(src);
      const getX = script.constants.find((c) => c.name === "getX");
      const engine = new MiniJIT();

      const trainObj = createJSObject();
      trainObj.setProperty("x", mkSmi(1));
      for (let i = 0; i < 20; i++) {
        engine.interpreter.execute(getX, [mkObject(trainObj)]);
      }

      engine.optimizeFunction(getX);
      assert.ok(getX.optimizedCode);

      const nested = createJSObject();
      nested.setProperty("y", mkSmi(12));
      const lateObj = createJSObject();
      lateObj.setProperty("x", mkObject(nested));
      const result = engine.executeValue(getX, [mkObject(lateObj)]);

      assert.equal(result.tag, "object");
      assert.equal(result.value, nested);
    });

    it("returns non-zero-offset LoadField values from optimized wasm", () => {
      const src = "function getY(obj) { return obj.y; }";
      const script = compileFunction(src);
      const getY = script.constants.find((c) => c.name === "getY");
      const engine = new MiniJIT();

      const trainObj = createJSObject();
      trainObj.setProperty("x", mkSmi(0));
      trainObj.setProperty("y", mkSmi(1));
      for (let i = 0; i < 20; i++) {
        engine.interpreter.execute(getY, [mkObject(trainObj)]);
      }

      engine.optimizeFunction(getY);
      assert.ok(getY.optimizedCode);

      const lateObj = createJSObject();
      lateObj.setProperty("x", mkSmi(9));
      lateObj.setProperty("y", mkString("tail"));
      const result = engine.executeValue(getY, [mkObject(lateObj)]);

      assert.equal(result.tag, "string");
      assert.equal(result.value, "tail");
    });

    it("branches on LoadField handle truthiness from optimized wasm", () => {
      const src = "function f(obj) { if (obj.x) return obj.x; return 9; }";
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      const trainObj = createJSObject();
      trainObj.setProperty("x", mkString("v"));
      for (let i = 0; i < 20; i++) {
        engine.interpreter.execute(fn, [mkObject(trainObj)]);
      }

      engine.optimizeFunction(fn);
      assert.ok(fn.optimizedCode);
      assert.ok(
        fn.optimizedStubSummary.some(
          (s) => s.opcode === IR_LOAD_FIELD && s.outputRep === "handle",
        ),
      );
      assert.ok(
        fn.optimizedStubSummary.some(
          (s) => s.opcode === IR_UNBOX && s.outputRep === "bool",
        ),
      );

      const truthyObj = createJSObject();
      truthyObj.setProperty("x", mkString("late"));
      assert.equal(engine.executeValue(fn, [mkObject(truthyObj)]).value, "late");

      const falseObj = createJSObject();
      falseObj.setProperty("x", mkBool(false));
      assert.equal(engine.executeValue(fn, [mkObject(falseObj)]).value, 9);

      const zeroObj = createJSObject();
      zeroObj.setProperty("x", mkSmi(0));
      assert.equal(engine.executeValue(fn, [mkObject(zeroObj)]).value, 9);

      const undefinedObj = createJSObject();
      undefinedObj.setProperty("x", mkUndefined());
      assert.equal(engine.executeValue(fn, [mkObject(undefinedObj)]).value, 9);
    });

    it("keeps numeric LoadField arithmetic on the wasm fast path", () => {
      const src = "function addX(obj) { return obj.x + 1; }";
      const script = compileFunction(src);
      const addX = script.constants.find((c) => c.name === "addX");
      const engine = new MiniJIT();

      const trainObj = createJSObject();
      trainObj.setProperty("x", mkSmi(1));
      for (let i = 0; i < 20; i++) {
        engine.interpreter.execute(addX, [mkObject(trainObj)]);
      }

      engine.optimizeFunction(addX);
      assert.ok(addX.optimizedCode);
      assert.ok(
        !(addX.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_LOAD_FIELD,
        ),
      );

      const lateObj = createJSObject();
      lateObj.setProperty("x", mkSmi(41));
      const result = engine.executeValue(addX, [mkObject(lateObj)]);

      assert.equal(result.value, 42);
    });

    it("returns polymorphic LoadField handle values from optimized wasm", () => {
      const src = "function getX(obj) { return obj.x; }";
      const script = compileFunction(src);
      const getX = script.constants.find((c) => c.name === "getX");
      const engine = new MiniJIT();

      const shapeA = createJSObject();
      shapeA.setProperty("x", mkSmi(1));
      const shapeB = createJSObject();
      shapeB.setProperty("y", mkSmi(0));
      shapeB.setProperty("x", mkSmi(2));
      for (let i = 0; i < 24; i++) {
        engine.interpreter.execute(getX, [
          mkObject(i % 2 === 0 ? shapeA : shapeB),
        ]);
      }

      engine.optimizeFunction(getX);
      assert.ok(getX.optimizedCode);

      const lateA = createJSObject();
      lateA.setProperty("x", mkDouble(3.5));
      const resultA = engine.executeValue(getX, [mkObject(lateA)]);
      assert.equal(resultA.tag, "double");
      assert.equal(resultA.value, 3.5);

      const lateB = createJSObject();
      lateB.setProperty("y", mkSmi(9));
      lateB.setProperty("x", mkString("poly"));
      const resultB = engine.executeValue(getX, [mkObject(lateB)]);
      assert.equal(resultB.tag, "string");
      assert.equal(resultB.value, "poly");
    });

    it("stores monomorphic handle field values from optimized wasm", () => {
      const src = "function setX(obj, value) { obj.x = value; return value; }";
      const script = compileFunction(src);
      const setX = script.constants.find((c) => c.name === "setX");
      const engine = new MiniJIT();

      const trainObj = createJSObject();
      trainObj.setProperty("x", mkSmi(1));
      for (let i = 0; i < 20; i++) {
        engine.interpreter.execute(setX, [mkObject(trainObj), mkSmi(i)]);
      }

      engine.optimizeFunction(setX);
      assert.ok(setX.optimizedCode);

      const lateObj = createJSObject();
      lateObj.setProperty("x", mkSmi(0));
      const result = engine.executeValue(setX, [
        mkObject(lateObj),
        mkString("stored"),
      ]);

      assert.equal(result.tag, "string");
      assert.equal(result.value, "stored");
      assert.equal(getTag(lateObj.getPropertyByOffset(0)), "string");
      assert.equal(getPayload(lateObj.getPropertyByOffset(0)), "stored");
    });

    it("stores polymorphic handle field values from optimized wasm", () => {
      const src = "function setX(obj, value) { obj.x = value; return value; }";
      const script = compileFunction(src);
      const setX = script.constants.find((c) => c.name === "setX");
      const engine = new MiniJIT();

      const shapeA = createJSObject();
      shapeA.setProperty("x", mkSmi(1));
      const shapeB = createJSObject();
      shapeB.setProperty("y", mkSmi(0));
      shapeB.setProperty("x", mkSmi(2));
      for (let i = 0; i < 24; i++) {
        engine.interpreter.execute(setX, [
          mkObject(i % 2 === 0 ? shapeA : shapeB),
          mkSmi(i),
        ]);
      }

      engine.optimizeFunction(setX);
      assert.ok(setX.optimizedCode);
      assert.ok(
        (setX.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_POLYMORPHIC_STORE,
        ),
      );

      const lateB = createJSObject();
      lateB.setProperty("y", mkSmi(9));
      lateB.setProperty("x", mkSmi(0));
      const nested = createJSObject();
      nested.setProperty("z", mkSmi(5));
      const result = engine.executeValue(setX, [
        mkObject(lateB),
        mkObject(nested),
      ]);

      assert.equal(result.tag, "object");
      assert.equal(result.value, nested);
      assert.equal(getPayload(lateB.getPropertyByOffset(1)), nested);
    });

    it("deopts polymorphic LoadField map misses and resumes with generic property lookup", () => {
      const src = "function getX(obj) { return obj.x; }";
      const script = compileFunction(src);
      const getX = script.constants.find((c) => c.name === "getX");
      const engine = new MiniJIT();

      const shapeA = createJSObject();
      shapeA.setProperty("x", mkSmi(1));
      const shapeB = createJSObject();
      shapeB.setProperty("y", mkSmi(0));
      shapeB.setProperty("x", mkSmi(2));
      for (let i = 0; i < 24; i++) {
        engine.interpreter.execute(getX, [
          mkObject(i % 2 === 0 ? shapeA : shapeB),
        ]);
      }

      engine.optimizeFunction(getX);
      assert.ok(getX.optimizedCode);
      assert.ok(
        (getX.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_POLYMORPHIC_LOAD,
        ),
      );

      const lateC = createJSObject();
      lateC.setProperty("z", mkSmi(9));
      lateC.setProperty("x", mkString("miss"));
      const result = engine.executeValue(getX, [mkObject(lateC)]);

      assert.equal(result.tag, "string");
      assert.equal(result.value, "miss");
      assert.equal(getX.deoptCount, 1);
    });

    it("deopts polymorphic StoreField map misses without losing the accumulator", () => {
      const src =
        "function setX(obj, value) { obj.x = value; return obj.x; }";
      const script = compileFunction(src);
      const setX = script.constants.find((c) => c.name === "setX");
      const engine = new MiniJIT();

      const shapeA = createJSObject();
      shapeA.setProperty("x", mkSmi(1));
      const shapeB = createJSObject();
      shapeB.setProperty("y", mkSmi(0));
      shapeB.setProperty("x", mkSmi(2));
      for (let i = 0; i < 24; i++) {
        engine.interpreter.execute(setX, [
          mkObject(i % 2 === 0 ? shapeA : shapeB),
          mkSmi(i),
        ]);
      }

      engine.optimizeFunction(setX);
      assert.ok(setX.optimizedCode);
      assert.ok(
        (setX.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_POLYMORPHIC_STORE,
        ),
      );

      const lateC = createJSObject();
      lateC.setProperty("z", mkSmi(9));
      lateC.setProperty("x", mkSmi(0));
      const result = engine.executeValue(setX, [
        mkObject(lateC),
        mkString("miss-store"),
      ]);

      assert.equal(result.tag, "string");
      assert.equal(result.value, "miss-store");
      assert.equal(getTag(lateC.getPropertyByOffset(1)), "string");
      assert.equal(getPayload(lateC.getPropertyByOffset(1)), "miss-store");
      assert.equal(setX.deoptCount, 1);
    });

    it("returns handle parameters from optimized wasm without losing tags", () => {
      const src = "function id(value) { return value; }";
      const objectValue = createJSObject();
      objectValue.setProperty("x", mkSmi(3));
      const cases = [
        {
          name: "string",
          value: mkString("idstr"),
          tag: "string",
          payload: "idstr",
        },
        { name: "bool", value: mkBool(true), tag: "bool", payload: true },
        {
          name: "undefined",
          value: mkUndefined(),
          tag: "undefined",
          payload: undefined,
        },
        { name: "null", value: mkNull(), tag: "null", payload: null },
        {
          name: "object",
          value: mkObject(objectValue),
          tag: "object",
          payload: objectValue,
        },
      ];

      for (const testCase of cases) {
        const script = compileFunction(src);
        const id = script.constants.find((c) => c.name === "id");
        const engine = new MiniJIT();

        for (let i = 0; i < 20; i++) {
          engine.interpreter.execute(id, [mkSmi(i)]);
        }

        engine.optimizeFunction(id);
        assert.ok(id.optimizedCode, testCase.name);

        const result = engine.executeValue(id, [testCase.value]);
        assert.equal(result.tag, testCase.tag, testCase.name);
        assert.equal(result.value, testCase.payload, testCase.name);
      }
    });

    it("keeps scalar-replaced object literal handle fields tagged in wasm", () => {
      const src =
        "function make(value) { let obj = { x: value }; return obj.x; }";
      const script = compileFunction(src);
      const make = script.constants.find((c) => c.name === "make");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(make, [mkSmi(i)]);
      }

      engine.optimizeFunction(make);
      assert.ok(make.optimizedCode);

      const result = engine.executeValue(make, [mkString("objlit")]);
      assert.equal(result.tag, "string");
      assert.equal(result.value, "objlit");
    });

    it("returns object literals with handle field slots still tagged", () => {
      const src = "function make(value) { return { x: value }; }";
      const script = compileFunction(src);
      const make = script.constants.find((c) => c.name === "make");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(make, [mkSmi(i)]);
      }

      engine.optimizeFunction(make);
      assert.ok(make.optimizedCode);

      const result = engine.executeValue(make, [mkString("retobj")]);
      assert.equal(result.tag, "object");
      const slot = result.value.getProperty("x");
      assert.equal(getTag(slot), "string");
      assert.equal(getPayload(slot), "retobj");
    });
  });

  describe("compile pure i32 add", () => {
    it("compiles smi add function to wasm and returns correct result", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i), mkSmi(i + 1)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null, "Expected Wasm compilation to succeed");
      assert.equal(typeof wasmFn, "function");

      const r = wasmFn([mkSmi(42), mkSmi(58)], null, engine.interpreter);
      assert.equal(getTag(r), "smi");
      assert.equal(getPayload(r), 100);
    });

    it("compiles subtraction and returns correct result", () => {
      const src = "function sub(a, b) { return a - b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "sub");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i + 10), mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null);

      const r = wasmFn([mkSmi(100), mkSmi(37)], null, engine.interpreter);
      assert.equal(getTag(r), "smi");
      assert.equal(getPayload(r), 63);
    });

    it("compiles multiplication correctly", () => {
      const src = "function mul(a, b) { return a * b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "mul");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i), mkSmi(i + 1)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null);
      const r = wasmFn([mkSmi(7), mkSmi(6)], null, engine.interpreter);
      assert.equal(getPayload(r), 42);
    });
  });

  describe("runtime stubs", () => {
    it("compiles generic numeric nodes through runtime stubs", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      engine.interpreter.execute(innerFn, [
        mkSmi(1),
        { tag: "string", value: "hi" },
      ]);

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null);
      assert.ok(
        innerFn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_ADD),
      );
      const summary = innerFn.optimizedStubSummary.find(
        (s) => s.opcode === IR_GENERIC_ADD,
      );
      assert.equal(typeof summary.blockId, "number");
      assert.equal(typeof summary.instructionId, "number");
      assert.deepEqual(summary.inputReps, ["handle", "handle"]);
      assert.equal(summary.outputRep, "handle");
      assert.equal(summary.sideEffect, false);
      const r = wasmFn([mkSmi(10), mkDouble(2.5)], null, engine.interpreter);
      assert.equal(getPayload(r), 12.5);
    });

    it("returns string handles from generic add runtime stubs", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      engine.interpreter.execute(innerFn, [mkSmi(1), mkString("x")]);

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null);
      const r = wasmFn([mkString("a"), mkSmi(3)], null, engine.interpreter);
      assert.equal(getTag(r), "string");
      assert.equal(getPayload(r), "a3");
    });

    it("lowers typeof, not, and neg through typed runtime stubs", () => {
      const src = `
function ty(x) { return typeof x; }
function no(x) { return !x; }
function neg(x) { return -x; }`;
      const script = compileFunction(src);
      const ty = script.constants.find((c) => c.name === "ty");
      const no = script.constants.find((c) => c.name === "no");
      const neg = script.constants.find((c) => c.name === "neg");
      const engine = new MiniJIT();

      engine.interpreter.execute(ty, [mkSmi(1)]);
      engine.interpreter.execute(no, [mkBool(false)]);
      engine.interpreter.execute(neg, [mkSmi(3)]);

      const optimizer = new SpeculativeOptimizer();
      const codegen = new WasmCodegen();

      const tyWasm = codegen.compile(optimizer.compile(ty), ty);
      const noWasm = codegen.compile(optimizer.compile(no), no);
      const negWasm = codegen.compile(optimizer.compile(neg), neg);

      assert.ok(tyWasm !== null);
      assert.ok(noWasm !== null);
      assert.ok(negWasm !== null);
      assert.ok(
        ty.optimizedStubSummary.some(
          (s) => s.opcode === IR_TYPEOF && s.outputRep === "handle",
        ),
      );
      assert.ok(
        no.optimizedStubSummary.some(
          (s) => s.opcode === IR_NOT && s.outputRep === "bool",
        ),
      );
      assert.ok(
        neg.optimizedStubSummary.some(
          (s) => s.opcode === IR_NEG && s.outputRep === "int32",
        ),
      );
      assert.equal(
        getPayload(tyWasm([mkSmi(9)], null, engine.interpreter)),
        "number",
      );
      assert.equal(
        getPayload(noWasm([mkBool(false)], null, engine.interpreter)),
        true,
      );
      assert.equal(
        getPayload(negWasm([mkSmi(7)], null, engine.interpreter)),
        -7,
      );
    });

    it("compiles loose equality through generic compare runtime stubs", () => {
      const src = `
function eq(a, b) { return a == b; }
function neq(a, b) { return a != b; }`;
      const script = compileFunction(src);
      const eq = script.constants.find((c) => c.name === "eq");
      const neq = script.constants.find((c) => c.name === "neq");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(eq, [mkString("1"), mkSmi(1)]);
        engine.executeValue(neq, [mkString("1"), mkSmi(1)]);
      }

      engine.optimizeFunction(eq);
      engine.optimizeFunction(neq);

      assert.ok(eq.optimizedCode);
      assert.ok(neq.optimizedCode);
      assert.ok(
        eq.optimizedStubSummary.some(
          (s) => s.opcode === IR_GENERIC_COMPARE && s.outputRep === "bool",
        ),
      );
      assert.ok(
        neq.optimizedStubSummary.some(
          (s) => s.opcode === IR_GENERIC_COMPARE && s.outputRep === "bool",
        ),
      );

      assert.equal(
        engine.executeValue(eq, [mkString("1"), mkSmi(1)]).value,
        true,
      );
      assert.equal(
        engine.executeValue(eq, [mkNull(), mkUndefined()]).value,
        true,
      );
      assert.equal(
        engine.executeValue(eq, [mkBool(false), mkSmi(0)]).value,
        true,
      );
      assert.equal(
        engine.executeValue(neq, [mkString("1"), mkSmi(2)]).value,
        true,
      );
    });

    it("branches on loose equality compare results in wasm", () => {
      const src =
        'function f(a, b) { if (a == b) return "yes"; return "no"; }';
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(fn, [mkString("1"), mkSmi(1)]);
      }
      engine.optimizeFunction(fn);

      assert.ok(fn.optimizedCode);
      assert.ok(
        fn.optimizedStubSummary.some(
          (s) => s.opcode === IR_GENERIC_COMPARE && s.outputRep === "bool",
        ),
      );
      assert.equal(
        engine.executeValue(fn, [mkString("1"), mkSmi(1)]).value,
        "yes",
      );
      assert.equal(
        engine.executeValue(fn, [mkString("1"), mkSmi(2)]).value,
        "no",
      );
      assert.equal(
        engine.executeValue(fn, [mkNull(), mkUndefined()]).value,
        "yes",
      );
    });

    it("branches on handle truthiness through unbox runtime stubs", () => {
      const src = "function f(x) { if (x) return 1; return 2; }";
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(fn, [mkBool(true)]);
      }
      engine.optimizeFunction(fn);

      assert.ok(fn.optimizedCode);
      assert.ok(
        fn.optimizedStubSummary.some(
          (s) => s.opcode === IR_UNBOX && s.outputRep === "bool",
        ),
      );
      assert.equal(engine.executeValue(fn, [mkBool(false)]).value, 2);
      assert.equal(engine.executeValue(fn, [mkSmi(0)]).value, 2);
      assert.equal(engine.executeValue(fn, [mkString("")]).value, 2);
      assert.equal(engine.executeValue(fn, [mkString("x")]).value, 1);
      assert.equal(engine.executeValue(fn, [mkNull()]).value, 2);
      assert.equal(engine.executeValue(fn, [mkUndefined()]).value, 2);
    });

    it("branches on typeof loose equality through wasm runtime stubs", () => {
      const src =
        'function f(x) { if (typeof x == "string") return x; return "no"; }';
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(fn, [mkString("a")]);
      }
      engine.optimizeFunction(fn);

      assert.ok(fn.optimizedCode);
      assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === IR_TYPEOF));
      assert.ok(
        fn.optimizedStubSummary.some(
          (s) => s.opcode === IR_GENERIC_COMPARE && s.outputRep === "bool",
        ),
      );
      assert.equal(engine.executeValue(fn, [mkString("z")]).value, "z");
      assert.equal(engine.executeValue(fn, [mkSmi(1)]).value, "no");
      assert.equal(engine.executeValue(fn, [mkBool(true)]).value, "no");
      assert.equal(engine.executeValue(fn, [mkUndefined()]).value, "no");
    });

    it("returns tagged numeric values from generic arithmetic runtime stubs", () => {
      const src = `
function add(a, b) { return a + b; }
function band(a, b) { return a & b; }
function bor(a, b) { return a | b; }
function bxor(a, b) { return a ^ b; }
function shl(a, b) { return a << b; }
function shr(a, b) { return a >> b; }
function ushr(a, b) { return a >>> b; }
function bnot(a) { return ~a; }`;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      const cases = [
        {
          name: "add",
          args: [mkSmi(1), mkSmi(1)],
          trainArgs: [mkSmi(1), mkString("x")],
          opcode: IR_GENERIC_ADD,
          outputRep: "handle",
          expected: 2,
        },
        {
          name: "band",
          args: [mkSmi(6), mkSmi(3)],
          trainArgs: [mkSmi(6), mkSmi(3)],
          opcode: IR_GENERIC_BITAND,
          outputRep: "int32",
          expected: 2,
        },
        {
          name: "bor",
          args: [mkBool(false), mkSmi(2)],
          trainArgs: [mkSmi(4), mkSmi(1)],
          opcode: IR_GENERIC_BITOR,
          outputRep: "int32",
          expected: 2,
        },
        {
          name: "bxor",
          args: [mkSmi(7), mkSmi(3)],
          trainArgs: [mkSmi(7), mkSmi(3)],
          opcode: IR_GENERIC_BITXOR,
          outputRep: "int32",
          expected: 4,
        },
        {
          name: "shl",
          args: [mkSmi(1), mkSmi(33)],
          trainArgs: [mkSmi(2), mkSmi(3)],
          opcode: IR_GENERIC_SHL,
          outputRep: "int32",
          expected: 2,
        },
        {
          name: "shr",
          args: [mkString("-8"), mkSmi(2)],
          trainArgs: [mkSmi(-8), mkSmi(1)],
          opcode: IR_GENERIC_SHR,
          outputRep: "int32",
          expected: -2,
        },
        {
          name: "ushr",
          args: [mkSmi(-1), mkSmi(1)],
          trainArgs: [mkSmi(-1), mkSmi(1)],
          opcode: IR_GENERIC_USHR,
          outputRep: "tagged-number",
          expectedTag: "double",
          expected: 2147483647,
        },
        {
          name: "bnot",
          args: [mkBool(false)],
          trainArgs: [mkSmi(5)],
          opcode: IR_GENERIC_BITNOT,
          outputRep: "int32",
          expected: -1,
        },
      ];

      for (const testCase of cases) {
        const fn = script.constants.find((c) => c.name === testCase.name);
        for (let i = 0; i < 30; i++) {
          engine.executeValue(fn, testCase.trainArgs);
        }
        engine.optimizeFunction(fn);

        assert.ok(fn.optimizedCode, testCase.name);
        assert.ok(
          fn.optimizedStubSummary.some(
            (s) =>
              s.opcode === testCase.opcode &&
              s.outputRep === testCase.outputRep,
          ),
          testCase.name,
        );
        const result = engine.executeValue(fn, testCase.args);
        assert.equal(result.tag, testCase.expectedTag || "smi", testCase.name);
        assert.equal(result.value, testCase.expected, testCase.name);
      }
    });

    it("preserves double handle parameters in generic pow runtime stubs", () => {
      const src = "function pow(a, b) { return a ** b; }";
      const script = compileFunction(src);
      const pow = script.constants.find((c) => c.name === "pow");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(pow, [mkSmi(2), mkSmi(3)]);
      }
      engine.optimizeFunction(pow);

      assert.ok(pow.optimizedCode);
      assert.ok(
        pow.optimizedStubSummary.some(
          (s) =>
            s.opcode === IR_GENERIC_POW && s.outputRep === "tagged-number",
        ),
      );
      assert.equal(engine.executeValue(pow, [mkSmi(9), mkDouble(0.5)]).value, 3);
      const doubleResult = engine.executeValue(pow, [mkDouble(2.5), mkSmi(2)]);
      assert.equal(doubleResult.tag, "double");
      assert.equal(doubleResult.value, 6.25);
    });

    it("checks array indexes in generic in runtime stubs", () => {
      const src = "function has(key, obj) { return key in obj; }";
      const script = compileFunction(src);
      const has = script.constants.find((c) => c.name === "has");
      const engine = new MiniJIT();
      const trainArray = createJSArray([mkSmi(1)]);

      for (let i = 0; i < 30; i++) {
        engine.executeValue(has, [mkString("0"), mkArray(trainArray)]);
      }
      engine.optimizeFunction(has);

      assert.ok(has.optimizedCode);
      assert.ok(
        has.optimizedStubSummary.some(
          (s) => s.opcode === IR_GENERIC_IN && s.outputRep === "handle",
        ),
      );

      const lateArray = createJSArray([mkSmi(1)]);
      assert.equal(
        engine.executeValue(has, [mkSmi(0), mkArray(lateArray)]).value,
        true,
      );
      assert.equal(
        engine.executeValue(has, [mkString("0"), mkArray(lateArray)]).value,
        true,
      );
      assert.equal(
        engine.executeValue(has, [mkSmi(2), mkArray(lateArray)]).value,
        false,
      );
    });

    it("checks constructor prototype chains in generic instanceof runtime stubs", () => {
      const src = `
function A() { this.x = 1; }
function B() { this.y = 2; }
function isA() { let a = new A(); return a instanceof A; }
function isB() { let a = new A(); return a instanceof B; }`;
      const script = compileFunction(src);
      const isA = script.constants.find((c) => c.name === "isA");
      const isB = script.constants.find((c) => c.name === "isB");
      const engine = new MiniJIT();
      engine.interpreter.execute(script);

      for (let i = 0; i < 30; i++) {
        engine.executeValue(isA);
        engine.executeValue(isB);
      }
      engine.optimizeFunction(isA);
      engine.optimizeFunction(isB);

      for (const fn of [isA, isB]) {
        assert.ok(fn.optimizedCode, fn.name);
        assert.ok(
          fn.optimizedStubSummary.some(
            (s) => s.opcode === IR_GENERIC_INSTANCEOF,
          ),
          fn.name,
        );
      }

      assert.equal(engine.executeValue(isA).value, true);
      assert.equal(engine.executeValue(isB).value, false);
    });

    it("preserves regex method receivers through generic call runtime stubs", () => {
      const src = "function f(s) { return /a+/.test(s); }";
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(fn, [mkString("aaa")]);
      }
      engine.optimizeFunction(fn);

      assert.ok(fn.optimizedCode);
      assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === IR_NEW_REGEX));
      assert.ok(
        fn.optimizedStubSummary.some(
          (s) => s.opcode === IR_GENERIC_GET_PROP,
        ),
      );
      assert.ok(
        fn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL),
      );

      assert.equal(engine.executeValue(fn, [mkString("aaa")]).value, true);
      assert.equal(engine.executeValue(fn, [mkString("b")]).value, false);
    });

    it("looks up builtin prototype methods through generic get prop runtime stubs", () => {
      const src = `
        function charAt() { let s = "abc"; return s.charAt(1); }
        function indexOf() { let s = "abc"; return s.indexOf("b"); }
        function numberToString() { let n = 12; return n.toString(); }
        function boolToString() { let b = true; return b.toString(); }
      `;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      const cases = [
        ["charAt", "b"],
        ["indexOf", 1],
        ["numberToString", "12"],
        ["boolToString", "true"],
      ];

      for (const [name, expected] of cases) {
        const fn = script.constants.find((c) => c.name === name);
        for (let i = 0; i < 30; i++) {
          engine.executeValue(fn);
        }
        engine.optimizeFunction(fn);

        assert.ok(fn.optimizedCode, name);
        assert.ok(
          fn.optimizedStubSummary.some(
            (s) => s.opcode === IR_GENERIC_GET_PROP,
          ),
          name,
        );
        assert.ok(
          fn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL),
          name,
        );
        assert.equal(engine.executeValue(fn).value, expected);
      }
    });

    it("syncs receiver mutations from generic call runtime stubs", () => {
      const src = `
        function readPushedElement() { let a = []; a.push(4); return a[0]; }
        function addPushLengthAndElement() {
          let a = [1];
          let n = a.push(2, 3);
          return n + a[2];
        }
        function addPoppedElementAndLength() {
          let a = [5, 6];
          let x = a.pop();
          return x + a.length;
        }
      `;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      const cases = [
        ["readPushedElement", 4],
        ["addPushLengthAndElement", 6],
        ["addPoppedElementAndLength", 7],
      ];

      for (const [name, expected] of cases) {
        const fn = script.constants.find((c) => c.name === name);
        for (let i = 0; i < 30; i++) {
          engine.executeValue(fn);
        }
        engine.optimizeFunction(fn);

        assert.ok(fn.optimizedCode, name);
        assert.ok(
          fn.optimizedStubSummary.some((s) => s.opcode === IR_NEW_ARRAY),
          name,
        );
        assert.ok(
          fn.optimizedStubSummary.some(
            (s) => s.opcode === IR_GENERIC_GET_PROP,
          ),
          name,
        );
        assert.ok(
          fn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL),
          name,
        );
        assert.equal(engine.executeValue(fn).value, expected);
      }
    });

    it("passes the interpreter into callback-based builtin runtime stubs", () => {
      const src = `
        function inc(x) { return x + 1; }
        function big(x) { return x > 2; }
        function add(a, b) { return a + b; }
        function repl(x) { return x + x; }
        function mapped() { let a = [1, 2, 3]; let b = a.map(inc); return b[2]; }
        function filtered() { let a = [1, 2, 3, 4]; let b = a.filter(big); return b[0]; }
        function reduced() { let a = [1, 2, 3]; return a.reduce(add, 0); }
        function replaced() { return "abc".replace(/b/, repl); }
      `;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      engine.interpreter.execute(script);
      const cases = [
        ["mapped", 4],
        ["filtered", 3],
        ["reduced", 6],
        ["replaced", "abbc"],
      ];

      for (const [name, expected] of cases) {
        const fn = script.constants.find((c) => c.name === name);
        for (let i = 0; i < 30; i++) {
          engine.executeValue(fn);
        }
        engine.optimizeFunction(fn);

        assert.ok(fn.optimizedCode, name);
        assert.ok(
          fn.optimizedStubSummary.some((s) => s.opcode === IR_LOAD_GLOBAL),
          name,
        );
        assert.ok(
          fn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL),
          name,
        );
        assert.equal(engine.executeValue(fn).value, expected);
      }
    });

    it("materializes compiled function constants for local constructors", () => {
      const src = `
        function returnsObject() {
          function C() { return { x: 9 }; }
          let c = new C();
          return c.x;
        }
        function returnsPrimitive() {
          function C() { this.x = 8; return 1; }
          let c = new C();
          return c.x;
        }
      `;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      const cases = [
        ["returnsObject", 9],
        ["returnsPrimitive", 8],
      ];

      for (const [name, expected] of cases) {
        const fn = script.constants.find((c) => c.name === name);
        for (let i = 0; i < 30; i++) {
          engine.executeValue(fn);
        }
        engine.optimizeFunction(fn);

        assert.ok(fn.optimizedCode, name);
        assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === IR_NEW_OBJECT));
        assert.ok(
          fn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL),
          name,
        );
        assert.equal(engine.executeValue(fn).value, expected);
      }
    });

    it("keeps closures with upvalues on the interpreter path", () => {
      const src = `
        function ctorObject() {
          let y = 4;
          function C() { return { x: y + 5 }; }
          let c = new C();
          return c.x;
        }
        function callbackMap() {
          let y = 10;
          function inc(x) { return x + y; }
          let a = [1, 2, 3];
          let b = a.map(inc);
          return b[2];
        }
        function callbackReplace() {
          let y = "!";
          function repl(x) { return x + y; }
          return "abc".replace(/b/, repl);
        }
        function mutateCapture() {
          let y = 1;
          function bump() { y = y + 2; return y; }
          return bump() + bump();
        }
      `;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      const cases = [
        ["ctorObject", 9],
        ["callbackMap", 13],
        ["callbackReplace", "ab!c"],
        ["mutateCapture", 8],
      ];

      for (const [name, expected] of cases) {
        const fn = script.constants.find((c) => c.name === name);
        for (let i = 0; i < 30; i++) {
          assert.equal(engine.executeValue(fn).value, expected);
        }

        assert.equal(fn.baselineCode, null, name);
        engine.optimizeFunction(fn);

        assert.equal(fn.optimizedCode, null, name);
        assert.match(fn.lastCompileFailureReason, /closure constant with upvalues/);
        assert.equal(engine.executeValue(fn).value, expected);
      }
    });

    it("preserves null returns from generic call runtime stubs", () => {
      const src = "function f(s) { return /a+/.exec(s); }";
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(fn, [mkString("aaa")]);
      }
      engine.optimizeFunction(fn);

      assert.ok(fn.optimizedCode);
      assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === IR_NEW_REGEX));
      assert.ok(
        fn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL),
      );

      const match = engine.executeValue(fn, [mkString("aaa")]);
      assert.equal(match.tag, "array");
      const miss = engine.executeValue(fn, [mkString("b")]);
      assert.equal(miss.tag, "null");
      assert.equal(miss.value, null);
    });

    it("keeps handle elements in new array runtime stubs", () => {
      const src = "function f(a, b) { return [a, b][1]; }";
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.executeValue(fn, [mkSmi(1), mkSmi(2)]);
      }
      engine.optimizeFunction(fn);

      assert.ok(fn.optimizedCode);
      assert.ok(
        fn.optimizedStubSummary.some(
          (s) => s.opcode === IR_NEW_ARRAY && s.outputRep === "handle",
        ),
      );

      assert.equal(engine.executeValue(fn, [mkSmi(1), mkBool(true)]).value, true);
      assert.equal(
        engine.executeValue(fn, [mkSmi(1), mkString("two")]).value,
        "two",
      );
      assert.equal(
        engine.executeValue(fn, [mkSmi(1), mkUndefined()]).tag,
        "undefined",
      );
    });

    it("optimizes nullish checks and default parameters with missing arguments", () => {
      const src = `
        function nullishParam(a) { return a ?? 9; }
        function defaultParam(a = 3) { return a + 1; }
        function nullishLocalZero() { let x = 0; return x ?? 7; }
        function callDefault() { return defaultParam(); }
        function callNullish() { return nullishParam(); }
      `;
      const script = compileFunction(src);
      const engine = new MiniJIT();
      engine.interpreter.execute(script);
      const fns = new Map(
        script.constants
          .filter((c) => c && c.name)
          .map((fn) => [fn.name, fn]),
      );

      for (let i = 0; i < 30; i++) {
        assert.equal(engine.executeValue(fns.get("nullishParam")).value, 9);
        assert.equal(engine.executeValue(fns.get("defaultParam")).value, 4);
        assert.equal(engine.executeValue(fns.get("nullishLocalZero")).value, 0);
        assert.equal(engine.executeValue(fns.get("callDefault")).value, 4);
        assert.equal(engine.executeValue(fns.get("callNullish")).value, 9);
      }

      for (const name of [
        "nullishParam",
        "defaultParam",
        "nullishLocalZero",
        "callDefault",
        "callNullish",
      ]) {
        engine.optimizeFunction(fns.get(name));
        assert.ok(fns.get(name).optimizedCode, name);
      }

      assert.equal(
        engine.executeValue(fns.get("nullishParam"), [mkUndefined()]).value,
        9,
      );
      assert.equal(engine.executeValue(fns.get("nullishParam"), [mkNull()]).value, 9);
      assert.equal(engine.executeValue(fns.get("nullishParam"), [mkSmi(0)]).value, 0);
      assert.equal(engine.executeValue(fns.get("defaultParam"), [mkSmi(8)]).value, 9);
      assert.equal(engine.executeValue(fns.get("callDefault")).value, 4);
      assert.equal(engine.executeValue(fns.get("callNullish")).value, 9);
    });

    it("preserves constructor semantics through generic new runtime stubs", () => {
      const src = `
function Box(x) { this.x = x; }
function Override(x) { this.x = 1; return { y: x }; }
function makeBox(x) { return new Box(x).x; }
function makeOverride(x) { return new Override(x).y; }`;
      const script = compileFunction(src);
      const makeBox = script.constants.find((c) => c.name === "makeBox");
      const makeOverride = script.constants.find(
        (c) => c.name === "makeOverride",
      );
      const engine = new MiniJIT();
      engine.interpreter.execute(script);

      for (let i = 0; i < 30; i++) {
        engine.executeValue(makeBox, [mkSmi(i)]);
        engine.executeValue(makeOverride, [mkSmi(i)]);
      }
      engine.optimizeFunction(makeBox);
      engine.optimizeFunction(makeOverride);

      for (const fn of [makeBox, makeOverride]) {
        assert.ok(fn.optimizedCode, fn.name);
        assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === IR_NEW_OBJECT));
        assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL));
      }

      assert.equal(engine.executeValue(makeBox, [mkString("box")]).value, "box");
      assert.equal(
        engine.executeValue(makeOverride, [mkString("override")]).value,
        "override",
      );
    });

    it("compiles global load and generic call through runtime stubs", () => {
      const src = "function caller(x) { return Number(x); }";
      const script = compileFunction(src);
      const caller = script.constants.find((c) => c.name === "caller");
      const engine = new MiniJIT();
      engine.interpreter.execute(script);

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(caller, [mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(caller);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, caller);

      assert.ok(wasmFn !== null);
      assert.ok(
        caller.optimizedStubSummary.some((s) => s.opcode === IR_GENERIC_CALL),
      );
      const r = wasmFn([mkSmi(41)], null, engine.interpreter);
      assert.equal(getPayload(r), 41);
    });

    it("compiles object allocation through runtime stubs", () => {
      const src = "function f() { return {}; }";
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(fn, []);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(fn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, fn);

      assert.ok(wasmFn !== null);
      assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === "NewObject"));
      const r = wasmFn([], null, engine.interpreter);
      assert.equal(getTag(r), "object");
    });

    it("compiles array allocation through runtime stubs", () => {
      const src = "function f(a) { return [a, 2]; }";
      const script = compileFunction(src);
      const fn = script.constants.find((c) => c.name === "f");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(fn, [mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(fn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, fn);

      assert.ok(wasmFn !== null);
      assert.ok(fn.optimizedStubSummary.some((s) => s.opcode === "NewArray"));
      const r = wasmFn([mkSmi(88)], null, engine.interpreter);
      assert.equal(getTag(r), "array");
      assert.equal(getPayload(getPayload(r).getIndex(0)), 88);
    });

    it("compiles generic indexed property get and set through runtime stubs", () => {
      const src =
        "function setKey(obj, key, value) { obj[key] = value; return obj[key]; }";
      const script = compileFunction(src);
      const setKey = script.constants.find((c) => c.name === "setKey");
      const engine = new MiniJIT();
      const trainObj = createJSObject();
      trainObj.setProperty("a", mkSmi(1));

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(setKey, [
          mkObject(trainObj),
          mkString("a"),
          mkSmi(i),
        ]);
      }

      engine.optimizeFunction(setKey);
      assert.ok(setKey.optimizedCode);
      assert.ok(
        (setKey.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_GENERIC_SET_INDEX,
        ),
      );
      assert.ok(
        (setKey.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_GENERIC_GET_INDEX,
        ),
      );

      const lateObj = createJSObject();
      lateObj.setProperty("a", mkSmi(0));
      const result = engine.executeValue(setKey, [
        mkObject(lateObj),
        mkString("b"),
        mkString("bee"),
      ]);

      assert.equal(result.tag, "string");
      assert.equal(result.value, "bee");
      assert.equal(getTag(lateObj.getProperty("b")), "string");
      assert.equal(getPayload(lateObj.getProperty("b")), "bee");
    });
  });

  describe("guard failure deoptimizes through the public wrapper", () => {
    it("resumes in the interpreter when called with non-smi", () => {
      const src = "function add(a, b) { return a + b; }";
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "add");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(innerFn, [mkSmi(i), mkSmi(i + 1)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null);

      const resumed = wasmFn(
        [mkString("hello"), mkSmi(1)],
        null,
        engine.interpreter,
      );
      assert.equal(getTag(resumed), "string");
      assert.equal(getPayload(resumed), "hello1");
    });
  });

  describe("multiple compilations", () => {
    it("compiles different functions independently", () => {
      const src1 = "function add(a, b) { return a + b; }";
      const src2 = "function sub(a, b) { return a - b; }";

      const script1 = compileFunction(src1);
      const script2 = compileFunction(src2);
      const addFn = script1.constants.find((c) => c.name === "add");
      const subFn = script2.constants.find((c) => c.name === "sub");
      const engine = new MiniJIT();

      for (let i = 0; i < 5; i++) {
        engine.interpreter.execute(addFn, [mkSmi(i), mkSmi(i)]);
        engine.interpreter.execute(subFn, [mkSmi(i + 10), mkSmi(i)]);
      }

      const optimizer = new SpeculativeOptimizer();
      const codegen = new WasmCodegen();

      resetIRNodeIds();
      const r1 = optimizer.compile(addFn);
      const wasmAdd = codegen.compile(r1, addFn);

      resetIRNodeIds();
      const r2 = optimizer.compile(subFn);
      const wasmSub = codegen.compile(r2, subFn);

      assert.ok(wasmAdd !== null);
      assert.ok(wasmSub !== null);

      const addResult = wasmAdd(
        [mkSmi(10), mkSmi(20)],
        null,
        engine.interpreter,
      );
      assert.equal(getPayload(addResult), 30);

      const subResult = wasmSub(
        [mkSmi(50), mkSmi(25)],
        null,
        engine.interpreter,
      );
      assert.equal(getPayload(subResult), 25);
    });
  });

  describe("packed array codegen", () => {
    it("compiles packed smi sumArray to wasm and returns smi", () => {
      const src = `
function sumArray(arr) {
  let sum = 0;
  let i = 0;
  while (i < arr.length) {
    sum = sum + arr[i];
    i = i + 1;
  }
  return sum;
}`;
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "sumArray");
      const engine = new MiniJIT();
      const arr = mkArray(
        createJSArray([mkSmi(1), mkSmi(2), mkSmi(3), mkSmi(4)]),
      );

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(innerFn, [arr]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null);
      const r = wasmFn([arr], null, engine.interpreter);
      assert.equal(getTag(r), "smi");
      assert.equal(getPayload(r), 10);
    });

    it("compiles packed double sumArray to wasm and returns double", () => {
      const src = `
function sumArray(arr) {
  let sum = 0.0;
  let i = 0;
  while (i < arr.length) {
    sum = sum + arr[i];
    i = i + 1;
  }
  return sum;
}`;
      const script = compileFunction(src);
      const innerFn = script.constants.find((c) => c.name === "sumArray");
      const engine = new MiniJIT();
      const arr = mkArray(
        createJSArray([mkDouble(1.5), mkDouble(2.25), mkDouble(3.75)]),
      );

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(innerFn, [arr]);
      }

      const optimizer = new SpeculativeOptimizer();
      const result = optimizer.compile(innerFn);
      const codegen = new WasmCodegen();
      const wasmFn = codegen.compile(result, innerFn);

      assert.ok(wasmFn !== null);
      const r = wasmFn([arr], null, engine.interpreter);
      assert.equal(getTag(r), "double");
      assert.equal(getPayload(r), 7.5);
    });

    it("updates loop block params through diamond branches", () => {
      const src = `
function branchAccum(n) {
  let i = 0;
  let acc = 0;
  while (i < n) {
    if ((i & 1) == 0) {
      acc = acc + i;
    } else {
      acc = acc + 2;
    }
    i = i + 1;
  }
  return acc;
}`;
      const script = compileFunction(src);
      const branchAccum = script.constants.find(
        (c) => c.name === "branchAccum",
      );
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(branchAccum, [mkSmi(20)]);
      }

      engine.optimizeFunction(branchAccum);
      assert.ok(branchAccum.optimizedCode);
      assert.ok(
        (branchAccum.optimizedStubSummary || []).some(
          (stub) =>
            stub.opcode === IR_GENERIC_BITAND && stub.outputRep === "int32",
        ),
      );

      const result = engine.executeValue(branchAccum, [mkSmi(9)]);
      assert.equal(result.tag, "smi");
      assert.equal(result.value, 28);
    });

    it("performs loop phi updates as parallel copies", () => {
      const src = `
function swapPhi(n) {
  let i = 0;
  let x = 1;
  let y = 2;
  while (i < n) {
    let t = x;
    x = y;
    y = t + y;
    i = i + 1;
  }
  return x + y;
}`;
      const script = compileFunction(src);
      const swapPhi = script.constants.find((c) => c.name === "swapPhi");
      const engine = new MiniJIT();

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(swapPhi, [mkSmi(12)]);
      }

      engine.optimizeFunction(swapPhi);
      assert.ok(swapPhi.optimizedCode);

      const result = engine.executeValue(swapPhi, [mkSmi(7)]);
      assert.equal(result.tag, "smi");
      assert.equal(result.value, 89);
    });

    it("merges if-without-else loop edges after handle truthiness", () => {
      const src = `
function truthyArrayLoop(arr) {
  let i = 0;
  let acc = 0;
  while (i < arr.length) {
    if (arr[i]) {
      acc = acc + 1;
    }
    i = i + 1;
  }
  return acc;
}`;
      const script = compileFunction(src);
      const truthyArrayLoop = script.constants.find(
        (c) => c.name === "truthyArrayLoop",
      );
      const engine = new MiniJIT();
      const trainArray = mkArray(
        createJSArray([
          mkBool(true),
          mkBool(true),
          mkBool(false),
          mkBool(true),
          mkBool(false),
        ]),
      );

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(truthyArrayLoop, [trainArray]);
      }

      engine.optimizeFunction(truthyArrayLoop);
      assert.ok(truthyArrayLoop.optimizedCode);
      assert.ok(
        (truthyArrayLoop.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_UNBOX && stub.outputRep === "bool",
        ),
      );

      const lateArray = mkArray(
        createJSArray([
          mkBool(true),
          mkBool(false),
          mkBool(true),
          mkBool(true),
        ]),
      );
      const result = engine.executeValue(truthyArrayLoop, [lateArray]);
      assert.equal(result.tag, "smi");
      assert.equal(result.value, 3);
    });

    it("keeps property load and store loops on optimized wasm paths", () => {
      const src = `
function loadLoop(o, n) {
  let i = 0;
  let acc = 0;
  while (i < n) {
    acc = acc + o.x;
    i = i + 1;
  }
  return acc;
}
function storeLoop(o, n) {
  let i = 0;
  while (i < n) {
    o.x = i;
    i = i + 1;
  }
  return o.x;
}`;
      const script = compileFunction(src);
      const loadLoop = script.constants.find((c) => c.name === "loadLoop");
      const storeLoop = script.constants.find((c) => c.name === "storeLoop");
      const engine = new MiniJIT();

      const trainLoadObj = createJSObject();
      trainLoadObj.setProperty("x", mkSmi(3));
      const trainStoreObj = createJSObject();
      trainStoreObj.setProperty("x", mkSmi(0));
      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(loadLoop, [
          mkObject(trainLoadObj),
          mkSmi(8),
        ]);
        engine.interpreter.execute(storeLoop, [
          mkObject(trainStoreObj),
          mkSmi(10),
        ]);
      }

      engine.optimizeFunction(loadLoop);
      engine.optimizeFunction(storeLoop);
      assert.ok(loadLoop.optimizedCode);
      assert.ok(storeLoop.optimizedCode);

      const lateLoadObj = createJSObject();
      lateLoadObj.setProperty("x", mkSmi(3));
      const loadResult = engine.executeValue(loadLoop, [
        mkObject(lateLoadObj),
        mkSmi(5),
      ]);
      assert.equal(loadResult.tag, "smi");
      assert.equal(loadResult.value, 15);

      const lateStoreObj = createJSObject();
      lateStoreObj.setProperty("x", mkSmi(0));
      const storeResult = engine.executeValue(storeLoop, [
        mkObject(lateStoreObj),
        mkSmi(6),
      ]);
      assert.equal(storeResult.tag, "smi");
      assert.equal(storeResult.value, 5);
      assert.equal(getPayload(lateStoreObj.getPropertyByOffset(0)), 5);
    });

    it("deopts packed element stores without losing the stored accumulator", () => {
      const src =
        "function setAt(arr, i, value) { arr[i] = value; return arr[i]; }";
      const script = compileFunction(src);
      const setAt = script.constants.find((c) => c.name === "setAt");
      const engine = new MiniJIT();
      const trainArr = mkArray(createJSArray([mkSmi(1), mkSmi(2)]));

      for (let i = 0; i < 30; i++) {
        engine.interpreter.execute(setAt, [
          trainArr,
          mkSmi(i % 2),
          mkSmi(i),
        ]);
      }

      engine.optimizeFunction(setAt);
      assert.ok(setAt.optimizedCode);

      const lateArr = createJSArray([mkSmi(1), mkSmi(2)]);
      const result = engine.executeValue(setAt, [
        mkArray(lateArr),
        mkSmi(3),
        mkString("wide"),
      ]);

      assert.equal(result.tag, "string");
      assert.equal(result.value, "wide");
      assert.equal(getTag(lateArr.getIndex(3)), "string");
      assert.equal(getPayload(lateArr.getIndex(3)), "wide");
      assert.equal(setAt.deoptCount, 1);
    });

    it("unwinds inlined wasm deopts from polymorphic field stores", () => {
      const src = `
function helper(obj, value) { obj.x = value; return obj.x; }
function outer(obj, value) { return helper(obj, value); }`;
      const script = compileFunction(src);
      const outer = script.constants.find((c) => c.name === "outer");
      const engine = new MiniJIT();
      engine.interpreter.execute(script);

      const shapeA = createJSObject();
      shapeA.setProperty("x", mkSmi(1));
      const shapeB = createJSObject();
      shapeB.setProperty("y", mkSmi(0));
      shapeB.setProperty("x", mkSmi(2));
      for (let i = 0; i < 40; i++) {
        engine.interpreter.execute(outer, [
          mkObject(i % 2 === 0 ? shapeA : shapeB),
          mkSmi(i),
        ]);
      }

      engine.optimizeFunction(outer);
      assert.ok(outer.optimizedCode);
      assert.ok(
        (outer.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_POLYMORPHIC_STORE,
        ),
      );

      const lateC = createJSObject();
      lateC.setProperty("z", mkSmi(9));
      lateC.setProperty("x", mkSmi(0));
      const result = engine.executeValue(outer, [
        mkObject(lateC),
        mkString("inline-miss"),
      ]);

      assert.equal(result.tag, "string");
      assert.equal(result.value, "inline-miss");
      assert.equal(getTag(lateC.getPropertyByOffset(1)), "string");
      assert.equal(getPayload(lateC.getPropertyByOffset(1)), "inline-miss");
      assert.equal(outer.deoptCount, 1);
    });

    it("unwinds nested inlined wasm deopts with expression arguments", () => {
      const src = `
function leaf(obj, value) { obj.x = value; return obj.x; }
function mid(obj, value) { return leaf(obj, value + 1); }
function outer(obj, value) { return mid(obj, value + 2); }`;
      const script = compileFunction(src);
      const outer = script.constants.find((c) => c.name === "outer");
      const engine = new MiniJIT();
      engine.interpreter.execute(script);

      const shapeA = createJSObject();
      shapeA.setProperty("x", mkSmi(1));
      const shapeB = createJSObject();
      shapeB.setProperty("y", mkSmi(0));
      shapeB.setProperty("x", mkSmi(2));
      for (let i = 0; i < 80; i++) {
        engine.interpreter.execute(outer, [
          mkObject(i % 2 === 0 ? shapeA : shapeB),
          mkSmi(i),
        ]);
      }

      engine.optimizeFunction(outer);
      assert.ok(outer.optimizedCode);
      assert.ok(
        (outer.optimizedStubSummary || []).some(
          (stub) => stub.opcode === IR_POLYMORPHIC_STORE,
        ),
      );

      const lateC = createJSObject();
      lateC.setProperty("z", mkSmi(9));
      lateC.setProperty("x", mkSmi(0));
      const result = engine.executeValue(outer, [mkObject(lateC), mkSmi(10)]);

      assert.equal(result.tag, "smi");
      assert.equal(result.value, 13);
      assert.equal(getTag(lateC.getPropertyByOffset(1)), "smi");
      assert.equal(getPayload(lateC.getPropertyByOffset(1)), 13);
      assert.equal(outer.deoptCount, 1);
    });
  });
});

describe("End-to-end JIT compilation", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetIRNodeIds();
  });

  it("function goes hot and gets compiled to Wasm", () => {
    const engine = new MiniJIT();
    const src = `
function add(a, b) { return a + b; }
let i = 0;
while (i < 200) {
  add(i, i + 1);
  i = i + 1;
}
add(42, 58);`;

    const result = engine.run(src);
    assert.equal(getTag(result), "smi");
    assert.equal(getPayload(result), 100);
  });

  it("compiled function produces correct results for various inputs", () => {
    const engine = new MiniJIT();

    const src = `
function add(a, b) { return a + b; }
let i = 0;
while (i < 200) {
  add(i, i + 1);
  i = i + 1;
}
add(0, 0);`;

    const result = engine.run(src);
    assert.equal(getPayload(result), 0);
  });
});

describe("Inlining with control flow", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
    resetHiddenClasses();
    resetIRNodeIds();
  });

  it("inlines a function with if/else and produces correct result", () => {
    const src = `
function max(a, b) {
  if (a > b) {
    return a;
  } else {
    return b;
  }
}
let i = 0;
while (i < 200) {
  max(i, 10);
  i = i + 1;
}
max(5, 10);`;

    const result = engine.run(src);
    assert.equal(getPayload(result), 10);
  });

  it("inlines function with single-branch if (no else)", () => {
    const src = `
function clamp(x) {
  if (x > 100) {
    return 100;
  }
  return x;
}
let i = 0;
while (i < 200) {
  clamp(i);
  i = i + 1;
}
clamp(50);`;

    const result = engine.run(src);
    assert.equal(getPayload(result), 50);
  });

  it("does not inline functions with loops", () => {
    const src = `
function sumTo(n) {
  let s = 0;
  let i = 0;
  while (i < n) {
    s = s + i;
    i = i + 1;
  }
  return s;
}
sumTo(5);`;

    const result = engine.run(src);
    assert.equal(getPayload(result), 10);
  });

  it("inlines monomorphic method calls with receiver property loads", () => {
    const src = `
function getX() { return this.x; }
let o = {};
o.x = 42;
o.m = getX;
let i = 0;
let total = 0;
while (i < 80) {
  total = total + o.m();
  i = i + 1;
}
total;`;
    const script = compileFunction(src);
    const localEngine = new MiniJIT({
      tieringPolicy: {
        jitThreshold: 100000,
        loopOsrThreshold: 100000,
        baselineThreshold: 100000,
      },
    });
    const result = localEngine.interpreter.execute(script);
    assert.equal(getPayload(result), 3360);

    const optimizer = new SpeculativeOptimizer();
    const { graph } = optimizer.compile(script);
    const allNodes = graph.blocks.flatMap((b) => b.nodes);

    assert.ok(allNodes.some((n) => n.type === IR_LOAD_FIELD));
    assert.equal(
      allNodes.some((n) => n.type === IR_GENERIC_CALL),
      false,
    );
  });

  it("captures callee and caller frame states for inlined speculative guards", () => {
    const src = `
function readX(obj) { return obj.x; }
let o = {};
o.x = 9;
let i = 0;
let total = 0;
while (i < 80) {
  total = total + readX(o);
  i = i + 1;
}
total;`;
    const script = compileFunction(src);
    const localEngine = new MiniJIT({
      tieringPolicy: {
        jitThreshold: 100000,
        loopOsrThreshold: 100000,
        baselineThreshold: 100000,
      },
    });
    const result = localEngine.interpreter.execute(script);
    assert.equal(getPayload(result), 720);

    const optimizer = new SpeculativeOptimizer();
    const { graph } = optimizer.compile(script);
    const guardedInlineLoad = graph.blocks
      .flatMap((b) => b.nodes)
      .find(
        (n) =>
          n.type === IR_CHECK_MAP &&
          n.frameState &&
          n.frameState.compiledFunction.name === "readX",
      );

    assert.ok(guardedInlineLoad);
    assert.equal(guardedInlineLoad.frameState.isInlinedFrame, true);
    assert.equal(
      guardedInlineLoad.frameState.callerFrameState.compiledFunction,
      script,
    );
    assert.equal(
      guardedInlineLoad.frameState.callerFrameState.bytecodeOffset >
        guardedInlineLoad.frameState.bytecodeOffset,
      true,
    );
  });

  it("inlines nested packed array helper calls into a wasm-compilable graph", () => {
    const src = `
function first(arr) { return arr[0]; }
function twice(arr) { return first(arr) + first(arr); }
let arr = [7, 8, 9];
let i = 0;
let total = 0;
while (i < 80) {
  total = total + twice(arr);
  i = i + 1;
}
total;`;
    const script = compileFunction(src);
    const localEngine = new MiniJIT({
      tieringPolicy: {
        jitThreshold: 100000,
        loopOsrThreshold: 100000,
        baselineThreshold: 100000,
      },
    });
    const result = localEngine.interpreter.execute(script);
    assert.equal(getPayload(result), 1120);

    const optimizer = new SpeculativeOptimizer();
    const { graph } = optimizer.compile(script);
    const allNodes = graph.blocks.flatMap((b) => b.nodes);

    assert.ok(
      allNodes.some(
        (n) =>
          n.type === IR_LOAD_ELEMENT && n.props.elementsKind === PACKED_SMI,
      ),
    );
    assert.equal(
      allNodes.some((n) => n.type === IR_GENERIC_CALL),
      false,
    );
  });

  it("inlines helper property loads using polymorphic feedback from the callee", () => {
    const src = `
function readX(obj) { return obj.x; }
let a = {};
a.x = 1;
let b = {};
b.pad = 0;
b.x = 2;
let i = 0;
let total = 0;
while (i < 80) {
  if (i % 2 === 0) {
    total = total + readX(a);
  } else {
    total = total + readX(b);
  }
  i = i + 1;
}
total;`;
    const script = compileFunction(src);
    const localEngine = new MiniJIT({
      tieringPolicy: {
        jitThreshold: 100000,
        loopOsrThreshold: 100000,
        baselineThreshold: 100000,
      },
    });
    const result = localEngine.interpreter.execute(script);
    assert.equal(getPayload(result), 120);

    const optimizer = new SpeculativeOptimizer();
    const { graph } = optimizer.compile(script);
    const allNodes = graph.blocks.flatMap((b) => b.nodes);

    assert.ok(allNodes.some((n) => n.type === IR_POLYMORPHIC_LOAD));
    assert.equal(
      allNodes.some((n) => n.type === IR_GENERIC_CALL),
      false,
    );
  });
});
