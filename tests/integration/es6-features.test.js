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

describe("Remaining ES6+", () => {
  describe("Default Parameters", () => {
    it("uses default when arg is missing", () => {
      const logs = runAndCapture(`
        function greet(name = "world") {
          print(name);
        }
        greet();
      `);
      assert.deepEqual(logs, ["world"]);
    });

    it("uses provided arg over default", () => {
      const logs = runAndCapture(`
        function greet(name = "world") {
          print(name);
        }
        greet("Alice");
      `);
      assert.deepEqual(logs, ["Alice"]);
    });

    it("works with multiple defaults", () => {
      const logs = runAndCapture(`
        function add(a = 1, b = 2) {
          print(a + b);
        }
        add();
        add(10);
        add(10, 20);
      `);
      assert.deepEqual(logs, ["3", "12", "30"]);
    });

    it("default can reference earlier params", () => {
      const logs = runAndCapture(`
        function foo(x, y = x * 2) {
          print(y);
        }
        foo(5);
      `);
      assert.deepEqual(logs, ["10"]);
    });

    it("works in arrow functions", () => {
      const logs = runAndCapture(`
        const add = (a = 0, b = 0) => a + b;
        print(add());
        print(add(3));
        print(add(3, 4));
      `);
      assert.deepEqual(logs, ["0", "3", "7"]);
    });
  });

  describe("Rest Parameters", () => {
    it("collects remaining args", () => {
      const logs = runAndCapture(`
        function sum(first, ...rest) {
          let total = first;
          for (let i = 0; i < rest.length; i = i + 1) {
            total = total + rest[i];
          }
          print(total);
        }
        sum(1, 2, 3, 4);
      `);
      assert.deepEqual(logs, ["10"]);
    });

    it("rest is empty array when no extra args", () => {
      const logs = runAndCapture(`
        function foo(a, ...rest) {
          print(rest.length);
        }
        foo(1);
      `);
      assert.deepEqual(logs, ["0"]);
    });

    it("rest collects all when no named params", () => {
      const logs = runAndCapture(`
        function all(...args) {
          print(args.length);
        }
        all(1, 2, 3);
      `);
      assert.deepEqual(logs, ["3"]);
    });
  });

  describe("Spread in Arrays", () => {
    it("spreads array into new array", () => {
      const logs = runAndCapture(`
        let a = [1, 2];
        let b = [...a, 3, 4];
        print(b.length);
        print(b[0]);
        print(b[3]);
      `);
      assert.deepEqual(logs, ["4", "1", "4"]);
    });

    it("concatenates arrays via spread", () => {
      const logs = runAndCapture(`
        let a = [1, 2];
        let b = [3, 4];
        let c = [...a, ...b];
        print(c.length);
        print(c[2]);
      `);
      assert.deepEqual(logs, ["4", "3"]);
    });
  });

  describe("Spread in Function Calls", () => {
    it("spreads array as function arguments", () => {
      const logs = runAndCapture(`
        function add(a, b, c) {
          print(a + b + c);
        }
        let args = [1, 2, 3];
        add(...args);
      `);
      assert.deepEqual(logs, ["6"]);
    });

    it("mixes spread and regular args", () => {
      const logs = runAndCapture(`
        function sum(a, b, c, d) {
          print(a + b + c + d);
        }
        let rest = [3, 4];
        sum(1, 2, ...rest);
      `);
      assert.deepEqual(logs, ["10"]);
    });
  });

  describe("Computed Property Names", () => {
    it("uses expression as property key", () => {
      const logs = runAndCapture(`
        let key = "hello";
        let obj = { [key]: 42 };
        print(obj.hello);
      `);
      assert.deepEqual(logs, ["42"]);
    });

    it("uses concatenation as key", () => {
      const logs = runAndCapture(`
        let prefix = "get";
        let obj = { [prefix + "Name"]: "Alice" };
        print(obj.getName);
      `);
      assert.deepEqual(logs, ["Alice"]);
    });
  });

  describe("Spread in Objects", () => {
    it("copies properties from another object", () => {
      const logs = runAndCapture(`
        let defaults = { x: 1, y: 2 };
        let obj = { ...defaults, z: 3 };
        print(obj.x);
        print(obj.y);
        print(obj.z);
      `);
      assert.deepEqual(logs, ["1", "2", "3"]);
    });

    it("later properties override spread", () => {
      const logs = runAndCapture(`
        let base = { a: 1, b: 2 };
        let obj = { ...base, b: 99 };
        print(obj.a);
        print(obj.b);
      `);
      assert.deepEqual(logs, ["1", "99"]);
    });
  });

  describe("Labeled Statements", () => {
    it("break with label exits labeled loop", () => {
      const logs = runAndCapture(`
        let count = 0;
        outer: for (let i = 0; i < 5; i = i + 1) {
          if (i === 3) {
            break outer;
          }
          count = count + 1;
        }
        print(count);
      `);
      assert.deepEqual(logs, ["3"]);
    });

    it("labeled break exits while loop", () => {
      const logs = runAndCapture(`
        let x = 0;
        loop: while (true) {
          x = x + 1;
          if (x === 5) {
            break loop;
          }
        }
        print(x);
      `);
      assert.deepEqual(logs, ["5"]);
    });
  });

  describe("Combined Features", () => {
    it("rest + spread roundtrip", () => {
      const logs = runAndCapture(`
        function wrapper(...args) {
          function inner(a, b, c) {
            return a + b + c;
          }
          return inner(...args);
        }
        print(wrapper(10, 20, 30));
      `);
      assert.deepEqual(logs, ["60"]);
    });

    it("defaults with destructuring-like patterns", () => {
      const logs = runAndCapture(`
        function config(opts = {}) {
          let x = opts.x;
          if (x === undefined) { x = 10; }
          print(x);
        }
        config();
        config({ x: 42 });
      `);
      assert.deepEqual(logs, ["10", "42"]);
    });

    it("number keys in objects", () => {
      const logs = runAndCapture(`
        let obj = { 0: "a", 1: "b" };
        print(obj[0]);
        print(obj[1]);
      `);
      assert.deepEqual(logs, ["a", "b"]);
    });
  });
});
