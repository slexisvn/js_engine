import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

describe("Map", () => {
  it("construct empty", () => {
    const logs = runAndCapture(`
      let m = new Map();
      print(m.size);
    `);
    assert.deepEqual(logs, ["0"]);
  });

  it("construct from array of pairs", () => {
    const logs = runAndCapture(`
      let m = new Map([["a", 1], ["b", 2]]);
      print(m.size);
      print(m.get("a"));
      print(m.get("b"));
    `);
    assert.deepEqual(logs, ["2", "1", "2"]);
  });

  it("set / get / has / delete", () => {
    const logs = runAndCapture(`
      let m = new Map();
      m.set("x", 10);
      print(m.has("x"));
      print(m.get("x"));
      print(m.size);
      m.delete("x");
      print(m.has("x"));
      print(m.size);
    `);
    assert.deepEqual(logs, ["true", "10", "1", "false", "0"]);
  });

  it("set returns the map for chaining", () => {
    const logs = runAndCapture(`
      let m = new Map();
      m.set("a", 1).set("b", 2);
      print(m.size);
    `);
    assert.deepEqual(logs, ["2"]);
  });

  it("overwrite existing key", () => {
    const logs = runAndCapture(`
      let m = new Map();
      m.set("k", 1);
      m.set("k", 99);
      print(m.get("k"));
      print(m.size);
    `);
    assert.deepEqual(logs, ["99", "1"]);
  });

  it("clear", () => {
    const logs = runAndCapture(`
      let m = new Map();
      m.set("a", 1);
      m.set("b", 2);
      m.clear();
      print(m.size);
      print(m.has("a"));
    `);
    assert.deepEqual(logs, ["0", "false"]);
  });

  it("object keys", () => {
    const logs = runAndCapture(`
      let m = new Map();
      let key = { id: 1 };
      m.set(key, "val");
      print(m.has(key));
      print(m.get(key));
    `);
    assert.deepEqual(logs, ["true", "val"]);
  });

  it("forEach", () => {
    const logs = runAndCapture(`
      let m = new Map([["a", 1], ["b", 2]]);
      m.forEach(function(value, key) {
        print(key + "=" + value);
      });
    `);
    assert.deepEqual(logs, ["a=1", "b=2"]);
  });

  it("for...of iteration", () => {
    const logs = runAndCapture(`
      let m = new Map([["x", 10], ["y", 20]]);
      for (let entry of m) {
        print(entry[0] + ":" + entry[1]);
      }
    `);
    assert.deepEqual(logs, ["x:10", "y:20"]);
  });

  it("keys / values iterators", () => {
    const logs = runAndCapture(`
      let m = new Map([["a", 1], ["b", 2]]);
      for (let k of m.keys()) {
        print(k);
      }
      for (let v of m.values()) {
        print(v);
      }
    `);
    assert.deepEqual(logs, ["a", "b", "1", "2"]);
  });
});

describe("Set", () => {
  it("construct empty", () => {
    const logs = runAndCapture(`
      let s = new Set();
      print(s.size);
    `);
    assert.deepEqual(logs, ["0"]);
  });

  it("construct from array", () => {
    const logs = runAndCapture(`
      let s = new Set([1, 2, 3]);
      print(s.size);
    `);
    assert.deepEqual(logs, ["3"]);
  });

  it("add / has / delete", () => {
    const logs = runAndCapture(`
      let s = new Set();
      s.add(42);
      print(s.has(42));
      print(s.size);
      s.delete(42);
      print(s.has(42));
      print(s.size);
    `);
    assert.deepEqual(logs, ["true", "1", "false", "0"]);
  });

  it("add returns the set for chaining", () => {
    const logs = runAndCapture(`
      let s = new Set();
      s.add(1).add(2).add(3);
      print(s.size);
    `);
    assert.deepEqual(logs, ["3"]);
  });

  it("deduplication", () => {
    const logs = runAndCapture(`
      let s = new Set([1, 2, 2, 3, 3, 3]);
      print(s.size);
    `);
    assert.deepEqual(logs, ["3"]);
  });

  it("clear", () => {
    const logs = runAndCapture(`
      let s = new Set([1, 2, 3]);
      s.clear();
      print(s.size);
    `);
    assert.deepEqual(logs, ["0"]);
  });

  it("forEach", () => {
    const logs = runAndCapture(`
      let s = new Set([10, 20, 30]);
      s.forEach(function(value) {
        print(value);
      });
    `);
    assert.deepEqual(logs, ["10", "20", "30"]);
  });

  it("for...of iteration", () => {
    const logs = runAndCapture(`
      let s = new Set([1, 2, 3]);
      for (let v of s) {
        print(v);
      }
    `);
    assert.deepEqual(logs, ["1", "2", "3"]);
  });

  it("entries iterator returns [value, value] pairs", () => {
    const logs = runAndCapture(`
      let s = new Set(["a", "b"]);
      for (let e of s.entries()) {
        print(e[0] + "=" + e[1]);
      }
    `);
    assert.deepEqual(logs, ["a=a", "b=b"]);
  });
});

describe("WeakMap", () => {
  it("construct empty", () => {
    const logs = runAndCapture(`
      let wm = new WeakMap();
      print(typeof wm);
    `);
    assert.deepEqual(logs, ["object"]);
  });

  it("set / get / has / delete with object keys", () => {
    const logs = runAndCapture(`
      let wm = new WeakMap();
      let k1 = {};
      let k2 = { name: "key2" };
      wm.set(k1, "v1");
      wm.set(k2, "v2");
      print(wm.has(k1));
      print(wm.get(k1));
      print(wm.get(k2));
      wm.delete(k1);
      print(wm.has(k1));
    `);
    assert.deepEqual(logs, ["true", "v1", "v2", "false"]);
  });

  it("construct from array of pairs", () => {
    const logs = runAndCapture(`
      let k = {};
      let wm = new WeakMap([[k, 42]]);
      print(wm.get(k));
    `);
    assert.deepEqual(logs, ["42"]);
  });

  it("rejects non-object keys", () => {
    assert.throws(() => {
      run(`
        let wm = new WeakMap();
        wm.set("string_key", 1);
      `);
    });
  });
});
