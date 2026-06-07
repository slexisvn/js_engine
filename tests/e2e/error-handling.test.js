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
});
