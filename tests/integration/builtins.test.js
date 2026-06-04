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

describe("Builtins & Runtime Completeness", () => {
  describe("Object.assign", () => {
    it("copies properties from source to target", () => {
      const logs = runAndCapture(`
        let target = { a: 1 };
        let source = { b: 2, c: 3 };
        Object.assign(target, source);
        print(target.a);
        print(target.b);
        print(target.c);
      `);
      assert.deepEqual(logs, ["1", "2", "3"]);
    });

    it("overwrites existing properties", () => {
      const logs = runAndCapture(`
        let t = { x: 1 };
        Object.assign(t, { x: 99 });
        print(t.x);
      `);
      assert.deepEqual(logs, ["99"]);
    });

    it("handles multiple sources", () => {
      const logs = runAndCapture(`
        let t = {};
        Object.assign(t, { a: 1 }, { b: 2 });
        print(t.a);
        print(t.b);
      `);
      assert.deepEqual(logs, ["1", "2"]);
    });
  });

  describe("Object.freeze/isFrozen", () => {
    it("Object.freeze marks object as frozen", () => {
      const logs = runAndCapture(`
        let obj = { x: 1 };
        print(Object.isFrozen(obj));
        Object.freeze(obj);
        print(Object.isFrozen(obj));
      `);
      assert.deepEqual(logs, ["false", "true"]);
    });
  });

  describe("Object.create", () => {
    it("creates new object", () => {
      const logs = runAndCapture(`
        let obj = Object.create(null);
        print(typeof obj);
      `);
      assert.deepEqual(logs, ["object"]);
    });
  });

  describe("Object.hasOwn", () => {
    it("checks own property", () => {
      const logs = runAndCapture(`
        let obj = { a: 1 };
        print(Object.hasOwn(obj, "a"));
        print(Object.hasOwn(obj, "b"));
      `);
      assert.deepEqual(logs, ["true", "false"]);
    });
  });

  describe("Array.flat", () => {
    it("flattens one level by default", () => {
      const logs = runAndCapture(`
        let arr = [1, [2, 3], [4, [5]]];
        let flat = arr.flat();
        print(flat.length);
        print(flat[0]);
        print(flat[1]);
        print(flat[2]);
        print(flat[3]);
      `);
      assert.deepEqual(logs, ["5", "1", "2", "3", "4"]);
    });

    it("flattens with depth", () => {
      const logs = runAndCapture(`
        let arr = [1, [2, [3, [4]]]];
        let flat = arr.flat(2);
        print(flat.length);
        print(flat[2]);
      `);
      assert.deepEqual(logs, ["4", "3"]);
    });
  });

  describe("Array.at", () => {
    it("supports positive index", () => {
      const logs = runAndCapture(`
        let arr = [10, 20, 30];
        print(arr.at(0));
        print(arr.at(1));
      `);
      assert.deepEqual(logs, ["10", "20"]);
    });

    it("supports negative index", () => {
      const logs = runAndCapture(`
        let arr = [10, 20, 30];
        print(arr.at(-1));
        print(arr.at(-2));
      `);
      assert.deepEqual(logs, ["30", "20"]);
    });
  });

  describe("Array.fill", () => {
    it("fills entire array", () => {
      const logs = runAndCapture(`
        let arr = [1, 2, 3, 4];
        arr.fill(0);
        print(arr[0]);
        print(arr[3]);
      `);
      assert.deepEqual(logs, ["0", "0"]);
    });

    it("fills with start and end", () => {
      const logs = runAndCapture(`
        let arr = [1, 2, 3, 4];
        arr.fill(9, 1, 3);
        print(arr[0]);
        print(arr[1]);
        print(arr[2]);
        print(arr[3]);
      `);
      assert.deepEqual(logs, ["1", "9", "9", "4"]);
    });
  });

  describe("Array.every/some", () => {
    it("every returns true when all pass", () => {
      const logs = runAndCapture(`
        let arr = [2, 4, 6];
        print(arr.every(x => x % 2 === 0));
      `);
      assert.deepEqual(logs, ["true"]);
    });

    it("some returns true when at least one passes", () => {
      const logs = runAndCapture(`
        let arr = [1, 3, 4];
        print(arr.some(x => x % 2 === 0));
        print(arr.some(x => x > 10));
      `);
      assert.deepEqual(logs, ["true", "false"]);
    });
  });

  describe("Array.flatMap", () => {
    it("maps and flattens", () => {
      const logs = runAndCapture(`
        let arr = [1, 2, 3];
        let result = arr.flatMap(x => [x, x * 2]);
        print(result.length);
        print(result[0]);
        print(result[1]);
        print(result[4]);
      `);
      assert.deepEqual(logs, ["6", "1", "2", "3"]);
    });
  });

  describe("String.replaceAll", () => {
    it("replaces all occurrences", () => {
      const logs = runAndCapture(`
        let s = "a-b-c-d";
        print(s.replaceAll("-", "_"));
      `);
      assert.deepEqual(logs, ["a_b_c_d"]);
    });

    it("works with empty match", () => {
      const logs = runAndCapture(`
        let s = "abc";
        print(s.replaceAll("b", "X"));
      `);
      assert.deepEqual(logs, ["aXc"]);
    });
  });

  describe("String.at", () => {
    it("supports positive and negative index", () => {
      const logs = runAndCapture(`
        let s = "hello";
        print(s.at(0));
        print(s.at(-1));
      `);
      assert.deepEqual(logs, ["h", "o"]);
    });
  });

  describe("JSON.parse with reviver", () => {
    it("reviver transforms values", () => {
      const logs = runAndCapture(`
        let obj = JSON.parse('{"a":1,"b":2}', function(key, value) {
          if (key === "") { return value; }
          return value * 10;
        });
        print(obj.a);
        print(obj.b);
      `);
      assert.deepEqual(logs, ["10", "20"]);
    });
  });

  describe("JSON.stringify with replacer", () => {
    it("array replacer filters keys", () => {
      const logs = runAndCapture(`
        let obj = { a: 1, b: 2, c: 3 };
        print(JSON.stringify(obj, ["a", "c"]));
      `);
      assert.deepEqual(logs, ['{"a":1,"c":3}']);
    });
  });
});
