import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: variables and scoping", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("var declaration and assignment", () => {
    expect(engine.runValue("var x = 42; x;").value).toBe(42);
  });

  it("let block scoping", () => {
    const r = engine.runValue(`
      var result = 0;
      { let x = 10; result = x; }
      result;
    `);
    expect(r.value).toBe(10);
  });

  it("const prevents reassignment (throws)", () => {
    expect(() => engine.run("const x = 1; x = 2;")).toThrow();
  });

  it("let TDZ throws ReferenceError", () => {
    expect(() => engine.run("x; let x = 1;")).toThrow();
  });

  it("var hoisting — declared but undefined before assignment", () => {
    const r = engine.runValue("var r = x; var x = 5; r;");
    expect(r.tag).toBe("undefined");
  });

  it("nested scopes shadow outer variables", () => {
    const r = engine.runValue(`
      var x = 1;
      function f() {
        var x = 2;
        return x;
      }
      f() * 10 + x;
    `);
    expect(r.value).toBe(21);
  });

  it("closure captures variable from enclosing scope", () => {
    const r = engine.runValue(`
      function makeCounter() {
        var count = 0;
        return function() {
          count = count + 1;
          return count;
        };
      }
      var c = makeCounter();
      c(); c(); c();
    `);
    expect(r.value).toBe(3);
  });

  it("multiple closures share the same variable", () => {
    const r = engine.runValue(`
      function pair() {
        var val = 0;
        function inc() { val = val + 1; return val; }
        function get() { return val; }
        return {inc: inc, get: get};
      }
      var p = pair();
      p.inc();
      p.inc();
      p.get();
    `);
    expect(r.value).toBe(2);
  });

  it("deeply nested closures", () => {
    const r = engine.runValue(`
      function a(x) {
        return function b(y) {
          return function c(z) {
            return x + y + z;
          };
        };
      }
      a(1)(2)(3);
    `);
    expect(r.value).toBe(6);
  });

  it("IIFE creates isolated scope", () => {
    const r = engine.runValue(`
      var x = 100;
      var y = (function() { var x = 42; return x; })();
      x + y;
    `);
    expect(r.value).toBe(142);
  });

  describe("global persistence between run() calls", () => {
    it("var persists across run calls", () => {
      engine.run("var x = 42;");
      expect(engine.runValue("x;").value).toBe(42);
    });

    it("var assignment updates persisted value", () => {
      engine.run("var x = 1;");
      engine.run("x = 100;");
      expect(engine.runValue("x;").value).toBe(100);
    });

    it("multiple vars persist independently", () => {
      engine.run("var a = 10; var b = 20;");
      expect(engine.runValue("a + b;").value).toBe(30);
    });

    it("var redeclaration updates value", () => {
      engine.run("var x = 1;");
      engine.run("var x = 2;");
      expect(engine.runValue("x;").value).toBe(2);
    });

    it("function declared in first run callable in second", () => {
      engine.run("function add(a, b) { return a + b; }");
      expect(engine.runValue("add(3, 4);").value).toBe(7);
    });

    it("function can reference vars from previous run", () => {
      engine.run("var multiplier = 10;");
      engine.run("function scale(x) { return x * multiplier; }");
      expect(engine.runValue("scale(5);").value).toBe(50);
    });

    it("function redefinition replaces old function", () => {
      engine.run("function f() { return 1; }");
      engine.run("function f() { return 2; }");
      expect(engine.runValue("f();").value).toBe(2);
    });

    it("counter increments across runs", () => {
      engine.run("var count = 0;");
      engine.run("count = count + 1;");
      engine.run("count = count + 1;");
      engine.run("count = count + 1;");
      expect(engine.runValue("count;").value).toBe(3);
    });

    it("array builds up across runs", () => {
      engine.run("var arr = [];");
      engine.run("arr.push(1);");
      engine.run("arr.push(2);");
      engine.run("arr.push(3);");
      expect(engine.runValue("arr.length;").value).toBe(3);
    });

    it("object properties accumulate across runs", () => {
      engine.run("var obj = {};");
      engine.run("obj.x = 10;");
      engine.run("obj.y = 20;");
      expect(engine.runValue("obj.x + obj.y;").value).toBe(30);
    });

    it("let does not persist across runs", () => {
      engine.run("let x = 42;");
      expect(() => engine.run("x;")).toThrow();
    });

    it("const does not persist across runs", () => {
      engine.run("const x = 42;");
      expect(() => engine.run("x;")).toThrow();
    });
  });

  describe("var hoisting in globals", () => {
    it("hoisted var is undefined before assignment", () => {
      const r = engine.runValue(`
        var result = typeof y;
        var y = 10;
        result;
      `);
      expect(r.value).toBe("undefined");
    });

    it("for-var loop variable persists as global", () => {
      engine.run("for (var i = 0; i < 5; i++) {}");
      expect(engine.runValue("i;").value).toBe(5);
    });

    it("for-var loop variable accessible after loop in same run", () => {
      const r = engine.runValue(`
        var sum = 0;
        for (var i = 1; i <= 10; i++) { sum = sum + i; }
        i;
      `);
      expect(r.value).toBe(11);
    });

    it("for-in var persists as global", () => {
      engine.run("var obj = {a: 1, b: 2}; for (var k in obj) {}");
      expect(() => engine.run("k;")).not.toThrow();
    });
  });
});
