import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("Monkey patching", () => {
  it("adds custom method to String.prototype", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      String.prototype.shout = function() { return this.toUpperCase() + "!"; };
      "hello".shout();
    `);
    assert.equal(getPayload(result), "HELLO!");
  });

  it("adds custom method to Array.prototype", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      Array.prototype.last = function() { return this[this.length - 1]; };
      [1, 2, 3].last();
    `);
    assert.equal(getPayload(result), 3);
  });

  it("adds custom method to Number.prototype", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      Number.prototype.isEven = function() { return this % 2 === 0; };
      (42).isEven();
    `);
    assert.equal(getPayload(result), true);
  });

  it("adds custom method to Boolean.prototype", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      Boolean.prototype.toYesNo = function() { return this.valueOf() ? "yes" : "no"; };
      true.toYesNo();
    `);
    assert.equal(getPayload(result), "yes");
  });

  it("overrides existing String method", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var original = "hello".indexOf("l");
      String.prototype.indexOf = function() { return -999; };
      var modified = "hello".indexOf("l");
      original * 1000 + modified;
    `);
    assert.equal(getPayload(result), 2000 + -999);
  });

  it("existing string methods still work after adding custom methods", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      String.prototype.custom = function() { return "custom"; };
      "hello".toUpperCase();
    `);
    assert.equal(getPayload(result), "HELLO");
  });

  it("existing array methods still work after adding custom methods", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      Array.prototype.custom = function() { return "custom"; };
      var arr = [1, 2, 3];
      arr.push(4);
      arr.length;
    `);
    assert.equal(getPayload(result), 4);
  });

  it("monkey-patched method can use this to access string length", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      String.prototype.size = function() { return this.length; };
      "hello".size();
    `);
    assert.equal(getPayload(result), 5);
  });

  it("monkey-patched array method can call built-in methods", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      Array.prototype.pushAndCount = function(x) { this.push(x); return this.length; };
      var arr = [1, 2];
      arr.pushAndCount(3);
    `);
    assert.equal(getPayload(result), 3);
  });
});
