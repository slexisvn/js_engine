import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler as RegisterCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { RememberedSet } from "../../src/gc/remembered-set.js";
import { FreeList, OldGeneration } from "../../src/gc/old-generation.js";
import {
  abstractLooseEqual,
  mkSmi,
  mkDouble,
  mkString,
  mkBool,
  mkNull,
  mkUndefined,
  mkNumber,
  toPrimitive,
} from "../../src/core/value/index.js";

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

describe("Correctness Foundations", () => {
  describe("RememberedSet dedup", () => {
    it("deduplicates entries with same holder", () => {
      const rs = new RememberedSet();
      const holder = { gcHeader: { oldGenIndex: 42 } };
      rs.record(holder);
      rs.record(holder);
      rs.record(holder);
      assert.equal(rs.size, 1);
    });

    it("has() returns true for recorded entries", () => {
      const rs = new RememberedSet();
      const holder = { gcHeader: { oldGenIndex: 7 } };
      rs.record(holder);
      assert.equal(rs.has(holder), true);
      assert.equal(rs.has({}), false);
    });

    it("remove() correctly removes entries", () => {
      const rs = new RememberedSet();
      const h1 = { gcHeader: { oldGenIndex: 3 } };
      const h2 = { gcHeader: { oldGenIndex: 4 } };
      rs.record(h1);
      rs.record(h2);
      assert.equal(rs.size, 2);
      rs.remove(h1);
      assert.equal(rs.size, 1);
      assert.equal(rs.has(h1), false);
      assert.equal(rs.has(h2), true);
    });

    it("iterate() yields all holders", () => {
      const rs = new RememberedSet();
      const h1 = { gcHeader: { oldGenIndex: 1 } };
      const h2 = { gcHeader: { oldGenIndex: 2 } };
      rs.record(h1);
      rs.record(h2);
      const holders = [];
      rs.iterateHolders((h) => holders.push(h));
      assert.equal(holders.length, 2);
    });

    it("clear() removes all entries", () => {
      const rs = new RememberedSet();
      const holder = { gcHeader: { oldGenIndex: 5 } };
      rs.record(holder);
      rs.clear();
      assert.equal(rs.size, 0);
    });
  });

  describe("FreeList simplified", () => {
    it("add and take work correctly", () => {
      const fl = new FreeList();
      fl.add(10);
      fl.add(20);
      fl.add(30);
      assert.equal(fl.totalFree, 3);
      assert.equal(fl.take(), 30); // LIFO
      assert.equal(fl.take(), 20);
      assert.equal(fl.take(), 10);
      assert.equal(fl.take(), null);
    });

    it("clear empties the list", () => {
      const fl = new FreeList();
      fl.add(1);
      fl.add(2);
      fl.clear();
      assert.equal(fl.totalFree, 0);
      assert.equal(fl.take(), null);
    });

    it("OldGeneration reuses freed slots", () => {
      const og = new OldGeneration(64);
      const obj1 = {
        gcHeader: { oldGenIndex: -1, marked: false, generation: "old" },
      };
      const obj2 = {
        gcHeader: { oldGenIndex: -1, marked: false, generation: "old" },
      };
      const obj3 = {
        gcHeader: { oldGenIndex: -1, marked: false, generation: "old" },
      };
      og.allocate(obj1);
      og.allocate(obj2);
      og.allocate(obj3);
      assert.equal(og.liveCount, 3);

      // Sweep: only obj2 survives
      const markSet = new Set([obj2]);
      const swept = og.markSweep(markSet);
      assert.equal(swept, 2);
      assert.equal(og.liveCount, 1);

      // Allocate new objects — should reuse freed slots
      const obj4 = {
        gcHeader: { oldGenIndex: -1, marked: false, generation: "old" },
      };
      og.allocate(obj4);
      assert.equal(og.liveCount, 2);
      // Should have reused a freed slot (index 0 or 2)
      assert.ok(obj4.gcHeader.oldGenIndex < og.allocPointer);
    });
  });

  describe("Loose equality (==, !=)", () => {
    it("null == undefined is true", () => {
      const logs = runAndCapture(`
        print(null == undefined);
        print(undefined == null);
      `);
      assert.deepEqual(logs, ["true", "true"]);
    });

    it("null == 0 is false", () => {
      const logs = runAndCapture(`
        print(null == 0);
        print(null == "");
        print(null == false);
      `);
      assert.deepEqual(logs, ["false", "false", "false"]);
    });

    it("number == string coercion", () => {
      const logs = runAndCapture(`
        print(5 == "5");
        print(0 == "");
        print(1 == "1");
      `);
      assert.deepEqual(logs, ["true", "true", "true"]);
    });

    it("boolean == number coercion", () => {
      const logs = runAndCapture(`
        print(true == 1);
        print(false == 0);
        print(true == 2);
      `);
      assert.deepEqual(logs, ["true", "true", "false"]);
    });

    it("boolean == string coercion", () => {
      const logs = runAndCapture(`
        print(true == "1");
        print(false == "0");
        print(false == "");
      `);
      assert.deepEqual(logs, ["true", "true", "true"]);
    });

    it("!= operator works", () => {
      const logs = runAndCapture(`
        print(null != undefined);
        print(5 != "5");
        print(5 != "6");
        print(null != 0);
      `);
      assert.deepEqual(logs, ["false", "false", "true", "true"]);
    });

    it("strict === still works correctly", () => {
      const logs = runAndCapture(`
        print(null === undefined);
        print(5 === "5");
        print(5 === 5);
        print("a" === "a");
      `);
      assert.deepEqual(logs, ["false", "false", "true", "true"]);
    });

    it("strict !== still works correctly", () => {
      const logs = runAndCapture(`
        print(null !== undefined);
        print(5 !== "5");
        print(5 !== 5);
      `);
      assert.deepEqual(logs, ["true", "true", "false"]);
    });
  });

  describe("abstractLooseEqual unit tests", () => {
    it("null == undefined", () => {
      assert.equal(abstractLooseEqual(mkNull(), mkUndefined()), true);
      assert.equal(abstractLooseEqual(mkUndefined(), mkNull()), true);
    });

    it("returns false when loosely comparing null and 0", () => {
      assert.equal(abstractLooseEqual(mkNull(), mkSmi(0)), false);
    });

    it("number == string", () => {
      assert.equal(abstractLooseEqual(mkSmi(5), mkString("5")), true);
      assert.equal(abstractLooseEqual(mkString("10"), mkSmi(10)), true);
      assert.equal(abstractLooseEqual(mkSmi(5), mkString("6")), false);
    });

    it("returns true when loosely comparing true and 1 or false and 0", () => {
      assert.equal(abstractLooseEqual(mkBool(true), mkSmi(1)), true);
      assert.equal(abstractLooseEqual(mkBool(false), mkSmi(0)), true);
      assert.equal(abstractLooseEqual(mkBool(true), mkSmi(2)), false);
    });

    it("same type falls through to strict", () => {
      assert.equal(abstractLooseEqual(mkSmi(3), mkSmi(3)), true);
      assert.equal(abstractLooseEqual(mkSmi(3), mkSmi(4)), false);
      assert.equal(abstractLooseEqual(mkString("a"), mkString("a")), true);
    });

    it("smi == double with same value", () => {
      assert.equal(abstractLooseEqual(mkSmi(5), mkDouble(5.0)), true);
      assert.equal(abstractLooseEqual(mkSmi(5), mkDouble(5.5)), false);
    });
  });

  describe("toPrimitive", () => {
    it("returns primitives unchanged", () => {
      const smi = mkSmi(42);
      assert.equal(toPrimitive(smi), smi);
      const str = mkString("hello");
      assert.equal(toPrimitive(str), str);
    });
  });
});
