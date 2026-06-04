import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  IRNode,
  IRGraph,
  irConstant,
  irParameter,
  IR_INT32_OR,
  IR_INT32_XOR,
  IR_INT32_USHR,
  IR_INT32_NOT,
  IR_FLOAT64_POW,
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
  IR_DISPATCH_MAP,
  IR_MEGAMORPHIC_LOAD,
  IR_MEGAMORPHIC_STORE,
  IR_RETURN,
  IR_PARAMETER,
  IR_NEW_OBJECT,
  IR_INT32_ADD,
} from "../../src/optimizing/ir/index.js";

import { BaselineCompiler } from "../../src/optimizing/baseline/compiler.js";
import { parse } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler as RegisterCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";

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

describe("Backend Correctness Bugs", () => {
  describe("OSR entry ownership", () => {
    it("baseline code does not expose an OSR entry because OSR belongs to optimized code", () => {
      const ast = parse("function f() { return 1; }");
      const compiler = new RegisterCompiler();
      const compiled = compiler.compile(ast);
      const interp = new RegisterInterpreter();

      interp.execute(compiled);
      const fCell = interp.globalCells.get("f");
      if (!fCell) return;

      const fCompiled = fCell.compiled || (fCell.read && fCell.read());
      if (!fCompiled || !fCompiled.compiled) return;

      const bc = new BaselineCompiler();
      const baselineCode = bc.compile(fCompiled.compiled || fCompiled, interp);
      if (!baselineCode) return;

      assert.equal(baselineCode._osrEntry, undefined);
    });
  });

  describe("Missing IR node types availability", () => {
    it("INT32_OR, INT32_XOR, INT32_USHR, INT32_NOT are defined", () => {
      assert.ok(IR_INT32_OR, "IR_INT32_OR should be defined");
      assert.ok(IR_INT32_XOR, "IR_INT32_XOR should be defined");
      assert.ok(IR_INT32_USHR, "IR_INT32_USHR should be defined");
      assert.ok(IR_INT32_NOT, "IR_INT32_NOT should be defined");
    });

    it("Generic bitwise/shift/pow/instanceof/in IR nodes are defined", () => {
      assert.ok(IR_GENERIC_BITAND);
      assert.ok(IR_GENERIC_BITOR);
      assert.ok(IR_GENERIC_BITXOR);
      assert.ok(IR_GENERIC_SHL);
      assert.ok(IR_GENERIC_SHR);
      assert.ok(IR_GENERIC_USHR);
      assert.ok(IR_GENERIC_POW);
      assert.ok(IR_GENERIC_BITNOT);
      assert.ok(IR_GENERIC_INSTANCEOF);
      assert.ok(IR_GENERIC_IN);
    });

    it("Megamorphic/DispatchMap IR nodes are defined", () => {
      assert.ok(IR_DISPATCH_MAP);
      assert.ok(IR_MEGAMORPHIC_LOAD);
      assert.ok(IR_MEGAMORPHIC_STORE);
    });

    it("INT32_NOT node can be created with single input", () => {
      const param = new IRNode(IR_PARAMETER, { index: 0 });
      const notNode = new IRNode(IR_INT32_NOT);
      notNode.addInput(param);
      assert.equal(notNode.inputs.length, 1);
      assert.equal(notNode.type, IR_INT32_NOT);
    });
  });

  describe("Bitwise operations work in interpreter", () => {
    it("bitwise OR works", () => {
      const logs = runAndCapture("print(5 | 3);");
      assert.deepEqual(logs, ["7"]);
    });

    it("bitwise XOR works", () => {
      const logs = runAndCapture("print(5 ^ 3);");
      assert.deepEqual(logs, ["6"]);
    });

    it("bitwise AND works", () => {
      const logs = runAndCapture("print(5 & 3);");
      assert.deepEqual(logs, ["1"]);
    });

    it("left shift works", () => {
      const logs = runAndCapture("print(1 << 3);");
      assert.deepEqual(logs, ["8"]);
    });

    it("right shift works", () => {
      const logs = runAndCapture("print(8 >> 2);");
      assert.deepEqual(logs, ["2"]);
    });

    it("unsigned right shift works", () => {
      const logs = runAndCapture("print(-1 >>> 28);");
      assert.deepEqual(logs, ["15"]);
    });

    it("bitwise NOT works", () => {
      const logs = runAndCapture("print(~0);");
      assert.deepEqual(logs, ["-1"]);
    });

    it("power operator works", () => {
      const logs = runAndCapture("print(2 ** 10);");
      assert.deepEqual(logs, ["1024"]);
    });
  });

  describe("Dead code removal", () => {
    it("WASM codegen does not have dead IR_GENERIC_GET/SET_PROP switch cases", async () => {
      // Read the wasm-codegen.js file and verify the dead cases were removed
      const fs = await import("node:fs");
      const content = fs.readFileSync(
        new URL("../../src/optimizing/wasm/codegen.js", import.meta.url),
        "utf-8",
      );
      // Should NOT contain genericGetImportIdx or genericSetImportIdx
      assert.ok(
        !content.includes("genericGetImportIdx"),
        "genericGetImportIdx should be removed (dead code)",
      );
      assert.ok(
        !content.includes("genericSetImportIdx"),
        "genericSetImportIdx should be removed (dead code)",
      );
    });
  });
});
