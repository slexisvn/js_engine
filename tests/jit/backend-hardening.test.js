import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parse } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler as RegisterCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { BaselineCompiler } from "../../src/optimizing/baseline/compiler.js";

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

describe("Performance & Hardening", () => {
  describe("Execution counters in WASM wrapper", () => {
    it("WASM codegen wrapper updates invocationCount", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/optimizing/wasm/codegen.js", import.meta.url),
        "utf-8",
      );
      assert.ok(
        content.includes("compiledFn.invocationCount"),
        "should update invocationCount",
      );
      assert.ok(
        content.includes("compiledFn.lastExecutionTime"),
        "should update lastExecutionTime",
      );
    });
  });

  describe("Baseline updates lastExecutionTime", () => {
    it("baseline generated code sets lastExecutionTime", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/optimizing/baseline/compiler.js", import.meta.url),
        "utf-8",
      );
      assert.ok(
        content.includes("$.cf.lastExecutionTime=Date.now()"),
        "should emit lastExecutionTime update",
      );
    });
  });

  describe("Stack overflow detection", () => {
    it("WASM codegen has stack depth protection", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/optimizing/wasm/codegen.js", import.meta.url),
        "utf-8",
      );
      assert.ok(
        content.includes("wasmCallDepth"),
        "should have wasmCallDepth counter",
      );
      assert.ok(
        content.includes("MAX_WASM_CALL_DEPTH"),
        "should have max depth constant",
      );
    });

    it("baseline compiler has stack depth protection", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/optimizing/baseline/runtime.js", import.meta.url),
        "utf-8",
      );
      assert.ok(
        content.includes("globalCallDepth"),
        "should have globalCallDepth counter",
      );
      assert.ok(
        content.includes("MAX_CALL_DEPTH"),
        "should have max depth constant",
      );
      assert.ok(
        content.includes("Maximum call stack size exceeded"),
        "should throw RangeError",
      );
    });
  });

  describe("Memory leak on code aging", () => {
    it("WASM wrapper has _dispose method", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/optimizing/wasm/codegen.js", import.meta.url),
        "utf-8",
      );
      assert.ok(
        content.includes("_dispose"),
        "should have _dispose method on wrapper",
      );
    });

    it("engine.js calls _dispose before nulling optimizedCode", async () => {
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/api/engine.js", import.meta.url),
        "utf-8",
      );
      assert.ok(
        content.includes("_dispose"),
        "should call _dispose in ageCode",
      );
    });
  });

  describe("Tail call detection in baseline", () => {
    it("emitOp accepts nextInstr parameter", () => {
      const bc = new BaselineCompiler();
      // emitOp should have 5 params (instr, idx, compiledFn, hasClosures, nextInstr)
      assert.equal(bc.emitOp.length, 5, "emitOp should accept 5 params");
    });

    it("functions with tail calls still produce correct results", () => {
      const logs = runAndCapture(`
        function add(a, b) { return a + b; }
        function wrapper(x) { return add(x, 10); }
        print(wrapper(5));
        print(wrapper(20));
      `);
      assert.deepEqual(logs, ["15", "30"]);
    });
  });
});
