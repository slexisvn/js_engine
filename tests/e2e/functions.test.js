import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: functions", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("declarations and expressions", () => {
    it("function declaration with return", () => {
      expect(engine.runValue("function f(x) { return x * 2; } f(21);").value).toBe(42);
    });

    it("function expression assigned to var", () => {
      expect(engine.runValue("var f = function(a, b) { return a - b; }; f(10, 3);").value).toBe(7);
    });

    it("arrow function expression body", () => {
      expect(engine.runValue("var f = (x) => x * x; f(7);").value).toBe(49);
    });

    it("arrow function block body", () => {
      expect(engine.runValue("var f = (a, b) => { return a + b; }; f(3, 4);").value).toBe(7);
    });

    it("arrow no-parens single param", () => {
      expect(engine.runValue("var f = x => x + 1; f(9);").value).toBe(10);
    });

    it("function with no return gives undefined", () => {
      const r = engine.runValue("function f() {} f();");
      expect(r.tag).toBe("undefined");
    });
  });

  describe("parameters", () => {
    it("default parameter value", () => {
      expect(engine.runValue("function f(a, b = 10) { return a + b; } f(5);").value).toBe(15);
    });

    it("default parameter overridden by argument", () => {
      expect(engine.runValue("function f(a, b = 10) { return a + b; } f(5, 20);").value).toBe(25);
    });

    it("rest parameters collect remaining args", () => {
      const r = engine.runValue(`
        function sum(first, ...rest) {
          var s = first;
          for (var i = 0; i < rest.length; i++) s += rest[i];
          return s;
        }
        sum(1, 2, 3, 4, 5);
      `);
      expect(r.value).toBe(15);
    });

    it("extra arguments are ignored", () => {
      expect(engine.runValue("function f(a) { return a; } f(1, 2, 3);").value).toBe(1);
    });

    it("missing arguments are undefined", () => {
      const r = engine.runValue("function f(a, b) { return b; } f(1);");
      expect(r.tag).toBe("undefined");
    });
  });

  describe("recursion", () => {
    it("factorial", () => {
      const r = engine.runValue(`
        function fact(n) {
          if (n <= 1) return 1;
          return n * fact(n - 1);
        }
        fact(10);
      `);
      expect(r.value).toBe(3628800);
    });

    it("fibonacci", () => {
      const r = engine.runValue(`
        function fib(n) {
          if (n <= 1) return n;
          return fib(n - 1) + fib(n - 2);
        }
        fib(10);
      `);
      expect(r.value).toBe(55);
    });

    it("mutual recursion", () => {
      const r = engine.runValue(`
        function isEven(n) {
          if (n === 0) return true;
          return isOdd(n - 1);
        }
        function isOdd(n) {
          if (n === 0) return false;
          return isEven(n - 1);
        }
        var r = "";
        if (isEven(10)) r += "10even ";
        if (isOdd(7)) r += "7odd";
        r;
      `);
      expect(r.value).toBe("10even 7odd");
    });
  });

  describe("higher-order functions", () => {
    it("function passed as argument", () => {
      const r = engine.runValue(`
        function apply(f, x) { return f(x); }
        function double(n) { return n * 2; }
        apply(double, 21);
      `);
      expect(r.value).toBe(42);
    });

    it("function returned from function", () => {
      const r = engine.runValue(`
        function adder(a) {
          return function(b) { return a + b; };
        }
        adder(10)(32);
      `);
      expect(r.value).toBe(42);
    });

    it("callback pattern", () => {
      const r = engine.runValue(`
        function forEach(arr, fn) {
          for (var i = 0; i < arr.length; i++) fn(arr[i], i);
        }
        var sum = 0;
        forEach([10, 20, 30], function(val) { sum += val; });
        sum;
      `);
      expect(r.value).toBe(60);
    });
  });

  describe("this binding", () => {
    it("method call binds this to object", () => {
      const r = engine.runValue(`
        var obj = {
          val: 42,
          getVal: function() { return this.val; }
        };
        obj.getVal();
      `);
      expect(r.value).toBe(42);
    });
  });

  describe("argument register allocation", () => {
    it("passes contiguous arguments when preceded by array literals", () => {
      const r = engine.runValue(`
        function pick(m) { return m[0]; }
        function add(x, y) { return x + y; }
        var a = [[1, 2], [3, 4]];
        var b = [[5, 6], [7, 8]];
        add(pick(a)[0], pick(b)[0]);
      `);
      expect(r.value).toBe(6);
    });

    it("computes 2x2 matrix multiplication with global array arguments", () => {
      const r = engine.runValue(`
        function matmul(a, b) {
          var result = [[0, 0], [0, 0]];
          for (var i = 0; i < 2; i++)
            for (var j = 0; j < 2; j++)
              for (var k = 0; k < 2; k++)
                result[i][j] += a[i][k] * b[k][j];
          return result;
        }
        var a = [[1, 2], [3, 4]];
        var b = [[5, 6], [7, 8]];
        var c = matmul(a, b);
        c[0][0] * 1000 + c[0][1] * 100 + c[1][0] * 10 + c[1][1];
      `);
      expect(r.value).toBe(19000 + 2200 + 430 + 50);
    });
  });
});
