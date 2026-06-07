import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: Symbol", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("each Symbol call creates a unique value", () => {
    const r = engine.runValue(`
      var s1 = Symbol("test");
      var s2 = Symbol("test");
      s1 === s2;
    `);
    expect(r.value).toBe(false);
  });

  it("typeof Symbol is 'symbol'", () => {
    const r = engine.runValue("typeof Symbol()");
    expect(r.value).toBe("symbol");
  });

  it("symbol as object property key", () => {
    const r = engine.runValue(`
      var sym = Symbol("key");
      var obj = {};
      obj[sym] = 42;
      obj[sym];
    `);
    expect(r.value).toBe(42);
  });

  it("symbol properties are independent from string properties", () => {
    const r = engine.runValue(`
      var sym = Symbol("x");
      var obj = {x: "string"};
      obj[sym] = "symbol";
      obj.x + "," + obj[sym];
    `);
    expect(r.value).toBe("string,symbol");
  });

  it("multiple symbol keys on same object", () => {
    const r = engine.runValue(`
      var s1 = Symbol("a");
      var s2 = Symbol("b");
      var obj = {};
      obj[s1] = 10;
      obj[s2] = 20;
      obj[s1] + obj[s2];
    `);
    expect(r.value).toBe(30);
  });

  it("symbol used as hidden property key", () => {
    const r = engine.runValue(`
      var secret = Symbol("secret");
      var obj = {};
      obj[secret] = 42;
      obj.public = "visible";
      obj[secret] + "," + obj.public;
    `);
    expect(r.value).toBe("42,visible");
  });

  it("symbol property survives object method calls", () => {
    const r = engine.runValue(`
      var tag = Symbol("tag");
      var obj = {
        name: "test"
      };
      obj[tag] = "tagged";
      obj[tag];
    `);
    expect(r.value).toBe("tagged");
  });
});
