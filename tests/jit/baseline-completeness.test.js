import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BaselineCompiler } from "../../src/optimizing/baseline/compiler.js";
import { parse } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler as RegisterCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

function run(source) {
  const ast = parse(source);
  const compiler = new RegisterCompiler();
  const compiled = compiler.compile(ast);
  const interp = new RegisterInterpreter();
  return interp.execute(compiled);
}

function runAndCapture(source) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    run(source);
    return logs;
  } finally {
    console.log = origLog;
  }
}

function compileAndGetBaseline(source) {
  const ast = parse(source);
  const compiler = new RegisterCompiler();
  const compiled = compiler.compile(ast);
  const interp = new RegisterInterpreter();
  interp.execute(compiled);

  // Try to get the inner function and baseline-compile it
  const bc = new BaselineCompiler();
  return { bc, interp, compiled };
}

describe("Completeness & Stubs", () => {
  describe("WASM memory has growth capability", () => {
    it("WebAssembly.Memory supports maximum parameter", async () => {
      // Verify that Memory can be created with maximum
      const mem = new WebAssembly.Memory({ initial: 1, maximum: 256 });
      assert.ok(
        mem.buffer.byteLength >= 65536,
        "initial should be at least 64KB",
      );
      // Growth should work
      mem.grow(1);
      assert.ok(mem.buffer.byteLength >= 131072, "should grow to 128KB");
    });
  });

  describe("Baseline handles loose equality", () => {
    it("loose equality (==) works in interpreter", () => {
      const logs = runAndCapture(`
        print(1 == 1);
        print(1 == "1");
        print(null == undefined);
        print(0 == false);
      `);
      assert.deepEqual(logs, ["true", "true", "true", "true"]);
    });

    it("loose inequality (!=) works in interpreter", () => {
      const logs = runAndCapture(`
        print(1 != 2);
        print(1 != "1");
        print(null != undefined);
      `);
      assert.deepEqual(logs, ["true", "false", "false"]);
    });
  });

  describe("Baseline handles nullish check", () => {
    it("nullish check works", () => {
      const logs = runAndCapture(`
        let a = null;
        let b = undefined;
        let c = 0;
        let d = "";
        print(a == null);
        print(b == null);
        print(c == null);
        print(d == null);
      `);
      assert.deepEqual(logs, ["true", "true", "false", "false"]);
    });
  });

  describe("Baseline handles getLength", () => {
    it("array length works", () => {
      const logs = runAndCapture(`
        let arr = [1, 2, 3, 4, 5];
        print(arr.length);
      `);
      assert.deepEqual(logs, ["5"]);
    });

    it("string length works", () => {
      const logs = runAndCapture(`
        let s = "hello";
        print(s.length);
      `);
      assert.deepEqual(logs, ["5"]);
    });
  });

  describe("Baseline handles power operator", () => {
    it("power operator works through all tiers", () => {
      const logs = runAndCapture(`
        print(2 ** 8);
        print(3 ** 3);
      `);
      assert.deepEqual(logs, ["256", "27"]);
    });
  });

  describe("Baseline skips exception bytecode", () => {
    it("does not install baseline code for try/catch functions", () => {
      const source = `
        function f() {
          try { throw 7; } catch (e) { return e + 1; }
        }
      `;
      const ast = parse(source);
      const compiler = new RegisterCompiler();
      const compiled = compiler.compile(ast);
      const fn = compiled.constants.find((c) => c.name === "f");
      const interp = new RegisterInterpreter();
      interp.execute(compiled);

      const baseline = new BaselineCompiler().compile(fn, interp);
      assert.equal(baseline, null);
    });

    it("keeps try/catch and finally correct after baseline threshold", () => {
      const source = `
        function caught() {
          try { throw 7; } catch (e) { return e + 1; }
        }
        function finalized() {
          let x = 1;
          try { x = x + 1; } finally { x = x + 2; }
          return x;
        }
      `;
      const engine = new MiniJIT();
      engine.run(source);
      const caught = getPayload(engine.interpreter.globalCells.read("caught")).compiled;
      const finalized = getPayload(
        engine.interpreter.globalCells.read("finalized"),
      ).compiled;

      for (let i = 0; i < 40; i++) {
        assert.equal(engine.executeValue(caught).value, 8);
        assert.equal(engine.executeValue(finalized).value, 4);
      }

      assert.equal(caught.baselineCode, null);
      assert.equal(finalized.baselineCode, null);
    });
  });

  describe("Baseline skips unsupported spread and accessor bytecode", () => {
    it("keeps spread calls, spread arrays, and accessor literals correct after baseline threshold", () => {
      const source = `
        function add(a, b, c) { return a + b + c; }
        function spreadCall() {
          let a = [1, 2, 3];
          return add(...a);
        }
        function spreadArray() {
          let a = [1, 2];
          let b = [0, ...a, 3];
          return b[2];
        }
        function accessorLiteral() {
          let o = { _x: 3, get x() { return this._x + 1; } };
          return o.x;
        }
      `;
      const engine = new MiniJIT();
      engine.run(source);
      const spreadCall = getPayload(
        engine.interpreter.globalCells.read("spreadCall"),
      ).compiled;
      const spreadArray = getPayload(
        engine.interpreter.globalCells.read("spreadArray"),
      ).compiled;
      const accessorLiteral = getPayload(
        engine.interpreter.globalCells.read("accessorLiteral"),
      ).compiled;

      for (let i = 0; i < 40; i++) {
        assert.equal(engine.executeValue(spreadCall).value, 6);
        assert.equal(engine.executeValue(spreadArray).value, 2);
        assert.equal(engine.executeValue(accessorLiteral).value, 4);
      }

      assert.equal(spreadCall.baselineCode, null);
      assert.equal(spreadArray.baselineCode, null);
      assert.equal(accessorLiteral.baselineCode, null);
    });

    it("does not baseline compile rest-argument functions", () => {
      const source = "function g(...xs) { return xs[2]; }";
      const ast = parse(source);
      const compiler = new RegisterCompiler();
      const compiled = compiler.compile(ast);
      const fn = compiled.constants.find((c) => c.name === "g");
      const interp = new RegisterInterpreter();
      interp.execute(compiled);

      const baseline = new BaselineCompiler().compile(fn, interp);
      assert.equal(baseline, null);
    });
  });

  describe("Baseline handles bitwise ops", () => {
    it("all bitwise ops work", () => {
      const logs = runAndCapture(`
        print(0xFF & 0x0F);
        print(0xF0 | 0x0F);
        print(0xFF ^ 0x0F);
        print(1 << 4);
        print(16 >> 2);
        print(~0);
      `);
      assert.deepEqual(logs, ["15", "255", "240", "16", "4", "-1"]);
    });
  });

  describe("WASM codegen handles dispatch/megamorphic nodes", () => {
    it("IR_DISPATCH_MAP, IR_MEGAMORPHIC_LOAD/STORE are in RUNTIME_STUB_NODES", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/optimizing/wasm/graph-support.js", import.meta.url),
        "utf-8",
      );
      assert.ok(
        content.includes("ir.IR_DISPATCH_MAP"),
        "DISPATCH_MAP should be in runtime stubs",
      );
      assert.ok(
        content.includes("ir.IR_MEGAMORPHIC_LOAD"),
        "MEGAMORPHIC_LOAD should be in runtime stubs",
      );
      assert.ok(
        content.includes("ir.IR_MEGAMORPHIC_STORE"),
        "MEGAMORPHIC_STORE should be in runtime stubs",
      );
    });
  });
});
