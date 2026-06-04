import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../src/frontend/lexer/index.js";
import { Parser } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import { resetMigrationStats } from "../../src/objects/heap/js-object.js";
import {
  getPayload,
  isFunction,
  isString,
} from "../../src/core/value/index.js";

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
  return getPayload(run(source));
}

describe("Arrow Functions & Function Expressions", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetMigrationStats();
  });

  describe("Arrow Functions", () => {
    it("single param no parens", () => {
      assert.equal(
        runVal(`
        let double = x => x * 2;
        double(5);
      `),
        10,
      );
    });

    it("multiple params", () => {
      assert.equal(
        runVal(`
        let add = (a, b) => a + b;
        add(3, 4);
      `),
        7,
      );
    });

    it("no params", () => {
      assert.equal(
        runVal(`
        let five = () => 5;
        five();
      `),
        5,
      );
    });

    it("block body", () => {
      assert.equal(
        runVal(`
        let factorial = (n) => {
          if (n <= 1) { return 1; }
          return n * factorial(n - 1);
        };
        factorial(5);
      `),
        120,
      );
    });

    it("arrow as callback", () => {
      assert.equal(
        runVal(`
        function apply(fn, x) {
          return fn(x);
        }
        apply(x => x + 10, 5);
      `),
        15,
      );
    });

    it("arrow captures outer variable via closure", () => {
      assert.equal(
        runVal(`
        function makeAdder(n) {
          return x => x + n;
        }
        let add5 = makeAdder(5);
        add5(10);
      `),
        15,
      );
    });

    it("arrow with expression body returns value", () => {
      assert.equal(
        runVal(`
        let sq = x => x * x;
        sq(7);
      `),
        49,
      );
    });
  });

  describe("Function Expressions", () => {
    it("anonymous function expression", () => {
      assert.equal(
        runVal(`
        let double = function(x) { return x * 2; };
        double(6);
      `),
        12,
      );
    });

    it("named function expression", () => {
      assert.equal(
        runVal(`
        let fact = function factorial(n) {
          if (n <= 1) { return 1; }
          return n * factorial(n - 1);
        };
        fact(6);
      `),
        720,
      );
    });

    it("IIFE", () => {
      assert.equal(
        runVal(`
        (function() { return 42; })();
      `),
        42,
      );
    });

    it("function expression as argument", () => {
      assert.equal(
        runVal(`
        function apply(fn, x) {
          return fn(x);
        }
        apply(function(n) { return n * n; }, 8);
      `),
        64,
      );
    });
  });

  describe("Object Shorthand", () => {
    it("property shorthand", () => {
      assert.equal(
        runVal(`
        let x = 10;
        let y = 20;
        let obj = { x, y };
        obj.x + obj.y;
      `),
        30,
      );
    });

    it("method shorthand", () => {
      assert.equal(
        runVal(`
        let obj = {
          value: 5,
          double() {
            return this.value * 2;
          }
        };
        obj.double();
      `),
        10,
      );
    });

    it("method shorthand with params", () => {
      assert.equal(
        runVal(`
        let math = {
          add(a, b) { return a + b; },
          mul(a, b) { return a * b; }
        };
        math.add(3, 4) + math.mul(2, 5);
      `),
        17,
      );
    });

    it("mixed shorthand and regular", () => {
      assert.equal(
        runVal(`
        let name = "world";
        let obj = { name, greeting: "hello" };
        obj.greeting;
      `),
        "hello",
      );
    });
  });

  describe("Combined", () => {
    it("arrow in object method", () => {
      assert.equal(
        runVal(`
        let obj = {
          items: [1, 2, 3],
          sum() {
            let total = 0;
            let i = 0;
            while (i < 3) {
              total += this.items[i];
              i++;
            }
            return total;
          }
        };
        obj.sum();
      `),
        6,
      );
    });

    it("higher-order with arrows", () => {
      assert.equal(
        runVal(`
        function compose(f, g) {
          return x => f(g(x));
        }
        let double = x => x * 2;
        let inc = x => x + 1;
        let doubleInc = compose(double, inc);
        doubleInc(5);
      `),
        12,
      );
    });
  });
});
