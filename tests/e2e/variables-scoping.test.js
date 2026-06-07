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
});
