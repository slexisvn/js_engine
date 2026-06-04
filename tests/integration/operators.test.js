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
  isSmi,
  isBool,
  isUndefined,
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

describe("Core Missing Operators", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetMigrationStats();
  });

  describe("Compound Assignment", () => {
    it("supports addition assignment (+=) on variables", () =>
      assert.equal(runVal("let x = 5; x += 3; x;"), 8));
    it("supports subtraction assignment (-=) on variables", () =>
      assert.equal(runVal("let x = 10; x -= 4; x;"), 6));
    it("supports multiplication assignment (*=) on variables", () =>
      assert.equal(runVal("let x = 3; x *= 4; x;"), 12));
    it("supports division assignment (/=) on variables", () =>
      assert.equal(runVal("let x = 20; x /= 5; x;"), 4));
    it("supports modulo assignment (%=) on variables", () =>
      assert.equal(runVal("let x = 17; x %= 5; x;"), 2));

    it("supports string concatenation assignment (+=)", () => {
      const result = run('let s = "hello"; s += " world"; s;');
      assert.equal(getPayload(result), "hello world");
    });

    it("supports compound addition assignment on object property members", () => {
      assert.equal(
        runVal(`
        let obj = { x: 10 };
        obj.x += 5;
        obj.x;
      `),
        15,
      );
    });

    it("compound assignment returns value", () => {
      assert.equal(runVal("let x = 5; x += 3;"), 8);
    });
  });

  describe("Increment/Decrement", () => {
    it("evaluates prefix increment (++x) and returns the incremented value", () =>
      assert.equal(runVal("let x = 5; ++x;"), 6));
    it("evaluates prefix decrement (--x) and returns the decremented value", () =>
      assert.equal(runVal("let x = 5; --x;"), 4));
    it("evaluates postfix increment (x++) and returns the original value", () =>
      assert.equal(runVal("let x = 5; x++;"), 5));
    it("evaluates postfix decrement (x--) and returns the original value", () =>
      assert.equal(runVal("let x = 5; x--;"), 5));

    it("prefix ++ modifies variable", () => {
      assert.equal(runVal("let x = 5; ++x; x;"), 6);
    });

    it("postfix ++ modifies variable", () => {
      assert.equal(runVal("let x = 5; x++; x;"), 6);
    });

    it("handles postfix increment inside loop update expressions", () => {
      assert.equal(
        runVal(`
        let sum = 0;
        for (let i = 0; i < 5; i++) {
          sum += i;
        }
        sum;
      `),
        10,
      );
    });

    it("handles postfix decrement inside loop body expressions", () => {
      assert.equal(
        runVal(`
        let x = 5;
        let sum = 0;
        while (x > 0) {
          sum += x;
          x--;
        }
        sum;
      `),
        15,
      );
    });
  });

  describe("Bitwise Operators", () => {
    it("evaluates bitwise AND (&) correctly", () =>
      assert.equal(runVal("12 & 10;"), 8));
    it("evaluates bitwise OR (|) correctly", () =>
      assert.equal(runVal("12 | 10;"), 14));
    it("evaluates bitwise XOR (^) correctly", () =>
      assert.equal(runVal("12 ^ 10;"), 6));
    it("evaluates bitwise NOT (~) correctly", () =>
      assert.equal(runVal("~5;"), -6));
    it("evaluates left shift (<<) correctly", () =>
      assert.equal(runVal("5 << 2;"), 20));
    it("evaluates signed right shift (>>) correctly", () =>
      assert.equal(runVal("20 >> 2;"), 5));
    it("evaluates unsigned right shift (>>>) correctly", () =>
      assert.equal(runVal("-1 >>> 0;"), 4294967295));

    it("bitwise AND assignment", () => {
      assert.equal(runVal("let x = 15; x &= 9; x;"), 9);
    });

    it("bitwise OR assignment", () => {
      assert.equal(runVal("let x = 5; x |= 3; x;"), 7);
    });

    it("bitwise XOR assignment", () => {
      assert.equal(runVal("let x = 12; x ^= 10; x;"), 6);
    });

    it("shift left assignment", () => {
      assert.equal(runVal("let x = 5; x <<= 2; x;"), 20);
    });

    it("precedence: & lower than ==", () => {
      const result = run("1 & 1 === 1;");
      assert(isSmi(result));
      assert.equal(getPayload(result), 1);
    });
  });

  describe("Exponentiation", () => {
    it("evaluates exponentiation (2 ** 10) correctly", () =>
      assert.equal(runVal("2 ** 10;"), 1024));
    it("evaluates exponentiation (3 ** 3) correctly", () =>
      assert.equal(runVal("3 ** 3;"), 27));
    it("right-associative: 2 ** 3 ** 2 = 2 ** 9 = 512", () => {
      assert.equal(runVal("2 ** 3 ** 2;"), 512);
    });
    it("supports exponentiation assignment (**=) on variables", () => {
      assert.equal(runVal("let x = 2; x **= 10; x;"), 1024);
    });
  });

  describe("instanceof", () => {
    it("basic instanceof", () => {
      const result = run(`
        class Animal {}
        let a = new Animal();
        a instanceof Animal;
      `);
      assert(isBool(result));
      assert.equal(getPayload(result), true);
    });

    it("instanceof own class", () => {
      const result = run(`
        class Dog {}
        let d = new Dog();
        d instanceof Dog;
      `);
      assert(isBool(result));
      assert.equal(getPayload(result), true);
    });

    it("instanceof false case", () => {
      const result = run(`
        class Animal {}
        class Car {}
        let c = new Car();
        c instanceof Animal;
      `);
      assert(isBool(result));
      assert.equal(getPayload(result), false);
    });
  });

  describe("in operator", () => {
    it("property in object", () => {
      const result = run(`
        let obj = { x: 1, y: 2 };
        "x" in obj;
      `);
      assert(isBool(result));
      assert.equal(getPayload(result), true);
    });

    it("missing property in object", () => {
      const result = run(`
        let obj = { x: 1 };
        "y" in obj;
      `);
      assert(isBool(result));
      assert.equal(getPayload(result), false);
    });

    it("supports checking if index exists in array via in operator", () => {
      const result = run(`
        let arr = [10, 20, 30];
        1 in arr;
      `);
      assert(isBool(result));
      assert.equal(getPayload(result), true);
    });
  });

  describe("do...while", () => {
    it("compiles and executes basic do-while loops", () => {
      assert.equal(
        runVal(`
        let x = 0;
        do {
          x = x + 1;
        } while (x < 5);
        x;
      `),
        5,
      );
    });

    it("body executes at least once", () => {
      assert.equal(
        runVal(`
        let x = 10;
        do {
          x = x + 1;
        } while (false);
        x;
      `),
        11,
      );
    });

    it("do-while with break", () => {
      assert.equal(
        runVal(`
        let x = 0;
        do {
          x = x + 1;
          if (x === 3) { break; }
        } while (x < 10);
        x;
      `),
        3,
      );
    });

    it("do-while with continue", () => {
      assert.equal(
        runVal(`
        let x = 0;
        let sum = 0;
        do {
          x = x + 1;
          if (x === 3) { continue; }
          sum = sum + x;
        } while (x < 5);
        sum;
      `),
        12,
      );
    });
  });

  describe("continue statement", () => {
    it("continue in while", () => {
      assert.equal(
        runVal(`
        let i = 0;
        let sum = 0;
        while (i < 5) {
          i = i + 1;
          if (i === 3) { continue; }
          sum = sum + i;
        }
        sum;
      `),
        12,
      );
    });

    it("handles continue statement inside standard for loops", () => {
      assert.equal(
        runVal(`
        let sum = 0;
        for (let i = 0; i < 10; i++) {
          if (i % 2 === 0) { continue; }
          sum += i;
        }
        sum;
      `),
        25,
      );
    });
  });

  describe("void operator", () => {
    it("void returns undefined", () => {
      assert(isUndefined(run("void 0;")));
    });
    it("void on expression", () => {
      assert(isUndefined(run("void (1 + 2);")));
    });
  });

  describe("delete operator", () => {
    it("delete property from object", () => {
      assert(
        isUndefined(
          run(`
        let obj = { x: 1, y: 2 };
        delete obj.x;
        obj.x;
      `),
        ),
      );
    });
  });

  describe("combined usage", () => {
    it("fizzbuzz with bitwise and compound assign", () => {
      assert.equal(
        runVal(`
        let result = 0;
        for (let i = 1; i <= 20; i++) {
          if (i % 15 === 0) { result += 3; }
          else if (i % 3 === 0) { result += 1; }
          else if (i % 5 === 0) { result += 2; }
        }
        result;
      `),
        14,
      );
    });

    it("bitwise flags pattern", () => {
      assert.equal(
        runVal(`
        let READ = 1;
        let WRITE = 2;
        let EXEC = 4;
        let perms = 0;
        perms |= READ;
        perms |= WRITE;
        perms |= EXEC;
        perms;
      `),
        7,
      );
    });

    it("power of 2 check with bitwise", () => {
      const result = run(`
        function isPow2(n) {
          return n > 0 & (n & (n - 1)) === 0;
        }
        isPow2(16);
      `);
      assert.equal(getPayload(result), 1);
    });
  });
});
