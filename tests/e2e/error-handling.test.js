import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: error handling", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("try-catch catches thrown number", () => {
    const r = engine.runValue(`
      var caught;
      try { throw 42; }
      catch (e) { caught = e; }
      caught;
    `);
    expect(r.value).toBe(42);
  });

  it("try-catch catches thrown string", () => {
    const r = engine.runValue(`
      var msg;
      try { throw "oops"; }
      catch (e) { msg = e; }
      msg;
    `);
    expect(r.value).toBe("oops");
  });

  it("finally always runs on normal flow", () => {
    const r = engine.runValue(`
      var log = "";
      try { log += "try "; }
      catch (e) { log += "catch "; }
      finally { log += "finally"; }
      log;
    `);
    expect(r.value).toBe("try finally");
  });

  it("finally runs after catch", () => {
    const r = engine.runValue(`
      var log = "";
      try { throw 1; }
      catch (e) { log += "catch "; }
      finally { log += "finally"; }
      log;
    `);
    expect(r.value).toBe("catch finally");
  });

  it("nested try-catch: inner catches, outer does not", () => {
    const r = engine.runValue(`
      var result = "";
      try {
        try { throw "inner"; }
        catch (e) { result += e; }
        result += " ok";
      } catch (e) {
        result += " outer";
      }
      result;
    `);
    expect(r.value).toBe("inner ok");
  });

  it("re-throw propagates to outer catch", () => {
    const r = engine.runValue(`
      var result;
      try {
        try { throw "err"; }
        catch (e) { throw e; }
      } catch (e) {
        result = "outer:" + e;
      }
      result;
    `);
    expect(r.value).toBe("outer:err");
  });

  it("error in function propagates to caller catch", () => {
    const r = engine.runValue(`
      function boom() { throw "bang"; }
      var result;
      try { boom(); }
      catch (e) { result = e; }
      result;
    `);
    expect(r.value).toBe("bang");
  });

  it("try-catch in loop", () => {
    const r = engine.runValue(`
      var errors = 0;
      for (var i = 0; i < 5; i++) {
        try {
          if (i % 2 === 0) throw i;
        } catch (e) {
          errors++;
        }
      }
      errors;
    `);
    expect(r.value).toBe(3);
  });

  it("finally runs even when return inside try", () => {
    const r = engine.runValue(`
      var finallyRan = false;
      function f() {
        try { return 42; }
        finally { finallyRan = true; }
      }
      f();
      finallyRan;
    `);
    expect(r.value).toBe(true);
  });

  it("catch block has access to outer scope", () => {
    const r = engine.runValue(`
      var x = 100;
      var result;
      try { throw 1; }
      catch (e) { result = x + e; }
      result;
    `);
    expect(r.value).toBe(101);
  });

  describe("TypeError on null/undefined property access", () => {
    describe("null property read", () => {
      it("null.foo throws TypeError", () => {
        expect(() => engine.run("null.foo")).toThrow("Cannot read properties of null");
      });

      it("null.foo includes property name in message", () => {
        expect(() => engine.run("null.foo")).toThrow("reading 'foo'");
      });

      it("null[0] throws TypeError", () => {
        expect(() => engine.run("null[0]")).toThrow("Cannot read properties of null");
      });

      it("null['bar'] throws TypeError", () => {
        expect(() => engine.run("null['bar']")).toThrow("Cannot read properties of null");
      });

      it("variable holding null throws on property access", () => {
        expect(() => engine.run("var x = null; x.prop;")).toThrow("Cannot read properties of null");
      });

      it("nested null access throws", () => {
        expect(() => engine.run("var o = {a: null}; o.a.b;")).toThrow("Cannot read properties of null");
      });
    });

    describe("undefined property read", () => {
      it("undefined.foo throws TypeError", () => {
        expect(() => engine.run("undefined.foo")).toThrow("Cannot read properties of undefined");
      });

      it("undefined[0] throws TypeError", () => {
        expect(() => engine.run("undefined[0]")).toThrow("Cannot read properties of undefined");
      });

      it("missing property chain throws", () => {
        expect(() => engine.run("var o = {}; o.a.b;")).toThrow("Cannot read properties of undefined");
      });

      it("function returning undefined then accessing property throws", () => {
        expect(() => engine.run(`
          function f() {}
          f().x;
        `)).toThrow("Cannot read properties of undefined");
      });
    });

    describe("null/undefined property write", () => {
      it("null.foo = 1 throws TypeError", () => {
        expect(() => engine.run("null.foo = 1;")).toThrow("Cannot set properties of null");
      });

      it("undefined.foo = 1 throws TypeError", () => {
        expect(() => engine.run("undefined.foo = 1;")).toThrow("Cannot set properties of undefined");
      });

      it("null[0] = 1 throws TypeError", () => {
        expect(() => engine.run("null[0] = 1;")).toThrow("Cannot set properties of null");
      });

      it("undefined[0] = 1 throws TypeError", () => {
        expect(() => engine.run("undefined[0] = 1;")).toThrow("Cannot set properties of undefined");
      });
    });

    describe("catchable TypeError", () => {
      it("try-catch catches null property access TypeError", () => {
        const r = engine.runValue(`
          var caught = false;
          try { null.foo; }
          catch (e) { caught = true; }
          caught;
        `);
        expect(r.value).toBe(true);
      });

      it("try-catch catches undefined property access TypeError", () => {
        const r = engine.runValue(`
          var caught = false;
          try { undefined.foo; }
          catch (e) { caught = true; }
          caught;
        `);
        expect(r.value).toBe(true);
      });

      it("execution continues after caught TypeError", () => {
        const r = engine.runValue(`
          var result = 0;
          try { null.x; } catch (e) { result = 1; }
          result + 10;
        `);
        expect(r.value).toBe(11);
      });
    });

    describe("valid property access still works", () => {
      it("object property read", () => {
        expect(engine.runValue("var o = {x: 42}; o.x;").value).toBe(42);
      });

      it("array index read", () => {
        expect(engine.runValue("[10,20,30][1]").value).toBe(20);
      });

      it("string property read", () => {
        expect(engine.runValue("'hello'.length").value).toBe(5);
      });

      it("number property access returns undefined", () => {
        const r = engine.runValue("var x = 42; x.foo;");
        expect(r.tag).toBe("undefined");
      });

      it("false.constructor does not throw", () => {
        expect(() => engine.run("false.constructor")).not.toThrow();
      });
    });
  });
});
