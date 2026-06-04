import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../../src/frontend/lexer/index.js";
import { Parser } from "../../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler } from "../../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../../src/bytecode/register/interpreter/index.js";
import { resetHiddenClasses } from "../../../src/objects/maps/hidden-class.js";
import { resetMigrationStats } from "../../../src/objects/heap/js-object.js";
import {
  getPayload,
  toDisplayString,
  isSmi,
  isString,
  isBool,
  isArray,
  isObject,
  isUndefined,
} from "../../../src/core/value/index.js";

function run(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new RegisterBytecodeCompiler();
  const compiledFn = compiler.compile(ast);
  const interp = new RegisterInterpreter(null);
  return interp.execute(compiledFn);
}

function runVal(source) {
  const result = run(source);
  return getPayload(result);
}

describe("Register-Based Bytecode", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetMigrationStats();
  });

  describe("basic arithmetic", () => {
    it("compiles and executes addition expression", () =>
      assert.equal(runVal("1 + 2;"), 3));
    it("compiles and executes subtraction expression", () =>
      assert.equal(runVal("10 - 3;"), 7));
    it("compiles and executes multiplication expression", () =>
      assert.equal(runVal("4 * 5;"), 20));
    it("compiles and executes division expression", () =>
      assert.equal(runVal("20 / 4;"), 5));
    it("compiles and executes modulo expression", () =>
      assert.equal(runVal("17 % 5;"), 2));
    it("complex expression", () =>
      assert.equal(runVal("(2 + 3) * (4 - 1);"), 15));
    it("compiles and executes unary negation expression", () =>
      assert.equal(runVal("-5;"), -5));
  });

  describe("variables and assignment", () => {
    it("compiles and executes let variable declaration", () =>
      assert.equal(runVal("let x = 42; x;"), 42));
    it("compiles and executes variable assignment", () =>
      assert.equal(runVal("let x = 1; x = 10; x;"), 10));
    it("multiple variables", () =>
      assert.equal(runVal("let a = 3; let b = 4; a + b;"), 7));
    it("variable in expression", () =>
      assert.equal(runVal("let x = 10; let y = 20; x * y + 5;"), 205));
  });

  describe("comparisons and booleans", () => {
    it("compiles and executes equal comparison (==)", () =>
      assert.equal(runVal("1 === 1;"), true));
    it("compiles and executes not equal comparison (!=)", () =>
      assert.equal(runVal("1 !== 2;"), true));
    it("compiles and executes less than comparison (<)", () =>
      assert.equal(runVal("1 < 2;"), true));
    it("compiles and executes greater than comparison (>)", () =>
      assert.equal(runVal("5 > 3;"), true));
    it("compiles and executes logical NOT (!)", () =>
      assert.equal(runVal("!false;"), true));
    it("compiles and executes typeof operator", () =>
      assert.equal(runVal("typeof 42;"), "number"));
  });

  describe("control flow", () => {
    it("compiles and executes if-else statement with true condition", () =>
      assert.equal(
        runVal("let x = 0; if (true) { x = 1; } else { x = 2; } x;"),
        1,
      ));
    it("compiles and executes if-else statement with false condition", () =>
      assert.equal(
        runVal("let x = 0; if (false) { x = 1; } else { x = 2; } x;"),
        2,
      ));
    it("compiles and executes while loop statement", () =>
      assert.equal(
        runVal(
          "let s = 0; let i = 1; while (i <= 10) { s = s + i; i = i + 1; } s;",
        ),
        55,
      ));
    it("compiles and executes standard for loop statement", () =>
      assert.equal(
        runVal(
          "let s = 0; for (let i = 0; i < 5; i = i + 1) { s = s + i; } s;",
        ),
        10,
      ));
    it("compiles and executes ternary conditional expression", () =>
      assert.equal(runVal("let x = true ? 1 : 2; x;"), 1));
    it("logical AND short-circuit", () =>
      assert.equal(runVal("false && true;"), false));
    it("logical OR short-circuit", () =>
      assert.equal(runVal("false || true;"), true));
  });

  describe("functions", () => {
    it("function declaration and call", () => {
      assert.equal(
        runVal("function add(a, b) { return a + b; } add(3, 4);"),
        7,
      );
    });

    it("recursive function (fibonacci)", () => {
      assert.equal(
        runVal(
          "function fib(n) { if (n <= 1) { return n; } return fib(n - 1) + fib(n - 2); } fib(10);",
        ),
        55,
      );
    });

    it("compiles and executes closures capturing outer variables", () => {
      assert.equal(
        runVal(
          "function makeCounter() { let count = 0; function inc() { count = count + 1; return count; } return inc; } let c = makeCounter(); c(); c(); c();",
        ),
        3,
      );
    });

    it("function as argument", () => {
      assert.equal(
        runVal(
          "function apply(f, x) { return f(x); } function double(n) { return n * 2; } apply(double, 21);",
        ),
        42,
      );
    });
  });

  describe("objects", () => {
    it("object literal and property access", () => {
      assert.equal(runVal("let obj = { x: 10, y: 20 }; obj.x + obj.y;"), 30);
    });

    it("property assignment", () => {
      assert.equal(runVal("let obj = { x: 1 }; obj.x = 42; obj.x;"), 42);
    });

    it("compiles and executes method calls on objects", () => {
      assert.equal(
        runVal(
          "function getX() { return this.x; } let obj = { x: 10 }; obj.getX = getX; obj.getX();",
        ),
        10,
      );
    });

    it("constructor with new", () => {
      assert.equal(
        runVal(
          "function Point(x, y) { this.x = x; this.y = y; } let p = new Point(3, 4); p.x + p.y;",
        ),
        7,
      );
    });
  });

  describe("arrays", () => {
    it("compiles and executes array literals", () => {
      const result = run("let a = [1, 2, 3]; a;");
      assert.ok(isArray(result));
      assert.equal(getPayload(result).getLength(), 3);
    });

    it("array index access", () => {
      assert.equal(runVal("let a = [10, 20, 30]; a[1];"), 20);
    });

    it("array index assignment", () => {
      assert.equal(runVal("let a = [1, 2, 3]; a[0] = 99; a[0];"), 99);
    });
  });

  describe("strings", () => {
    it("string concatenation", () => {
      assert.equal(runVal('"hello" + " " + "world";'), "hello world");
    });

    it("compiles and executes string length property access", () => {
      assert.equal(runVal('let s = "hello"; s.length;'), 5);
    });
  });

  describe("switch/case", () => {
    it("matches correct case", () => {
      assert.equal(
        runVal(
          "let x = 2; let r = 0; switch (x) { case 1: r = 10; break; case 2: r = 20; break; case 3: r = 30; break; } r;",
        ),
        20,
      );
    });

    it("compiles and executes switch statements falling back to default case", () => {
      assert.equal(
        runVal(
          "let x = 99; let r = 0; switch (x) { case 1: r = 10; break; default: r = -1; break; } r;",
        ),
        -1,
      );
    });
  });

  describe("try/catch", () => {
    it("catches thrown value", () => {
      assert.equal(
        runVal(
          "let result = 0; try { throw 42; } catch (e) { result = e; } result;",
        ),
        42,
      );
    });

    it("executes try body when no error", () => {
      assert.equal(
        runVal(
          "let result = 0; try { result = 10; } catch (e) { result = -1; } result;",
        ),
        10,
      );
    });
  });

  describe("disassembly", () => {
    it("produces readable disassembly", () => {
      const lexer = new Lexer("let x = 1 + 2; x;");
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      const ast = parser.parse();
      const compiler = new RegisterBytecodeCompiler();
      const fn = compiler.compile(ast);
      const dis = fn.disassemble();
      assert.ok(dis.includes("LdaConst"));
      assert.ok(dis.includes("Add"));
      assert.ok(dis.includes("Star"));
      assert.ok(dis.includes("Return"));
    });
  });

  describe("complex programs", () => {
    it("nested function calls", () => {
      assert.equal(
        runVal(
          "function square(n) { return n * n; } function sumOfSquares(a, b) { return square(a) + square(b); } sumOfSquares(3, 4);",
        ),
        25,
      );
    });

    it("accumulator pattern (reduce-like)", () => {
      assert.equal(
        runVal(
          "let arr = [1, 2, 3, 4, 5]; let sum = 0; let i = 0; while (i < 5) { sum = sum + arr[i]; i = i + 1; } sum;",
        ),
        15,
      );
    });

    it("class declaration", () => {
      assert.equal(
        runVal(
          "class Counter { constructor(start) { this.count = start; } inc() { this.count = this.count + 1; return this.count; } } let c = new Counter(10); c.inc(); c.inc(); c.inc();",
        ),
        13,
      );
    });
  });
});
