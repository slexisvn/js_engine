import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import {
  getTag,
  getPayload,
  toString as valToString,
  toDisplayString,
} from "../../src/core/value/index.js";

/**
 * V8 treats arrays as objects with a separate indexed element backing store
 * and a standard hidden-class property table for non-index (named) keys.
 *
 * These tests verify that the interpreter's ROP_STA_PROP / ROP_LDA_PROP
 * opcodes delegate to JSArray.setProperty / getProperty for named keys,
 * preserving object-like semantics on arrays (reference sharing, hidden-class
 * transitions, overwrite, mixed access, etc.).
 */

function run(code) {
  return new MiniJIT().run(code);
}

describe("Array named properties — V8 object model parity", () => {
  // ─── basic read / write ────────────────────────────────────────────

  describe("basic named property storage", () => {
    it("stores and retrieves a named property on an array", () => {
      const r = run("let a = [1, 2]; a.x = 42; a.x");
      assert.equal(getPayload(r), 42);
    });

    it("stores multiple distinct named properties", () => {
      const r = run('let a = []; a.foo = "hello"; a.bar = 99; a.foo');
      assert.equal(getPayload(r), "hello");

      const r2 = run('let a = []; a.foo = "hello"; a.bar = 99; a.bar');
      assert.equal(getPayload(r2), 99);
    });

    it("overwrites a named property with a new value", () => {
      const r = run("let a = []; a.x = 1; a.x = 2; a.x");
      assert.equal(getPayload(r), 2);
    });

    it("returns undefined for a named property that was never set", () => {
      const r = run("let a = [1, 2]; a.missing");
      assert.equal(getTag(r), "undefined");
    });
  });

  // ─── named props must not corrupt indexed elements ─────────────────

  describe("isolation between named properties and indexed elements", () => {
    it("does not alter array length when adding a named property", () => {
      const r = run('let a = [1, 2, 3]; a.tag = "test"; a.length');
      assert.equal(getPayload(r), 3);
    });

    it("preserves indexed elements after adding a named property", () => {
      const r = run('let a = [10, 20]; a.label = "arr"; a[0] + a[1]');
      assert.equal(getPayload(r), 30);
    });

    it("allows push after named property assignment", () => {
      const r = run("let a = [1]; a.x = 5; a.push(2); a.length");
      assert.equal(getPayload(r), 2);
    });

    it("allows setting length as a property to truncate", () => {
      const r = run("let a = [1, 2, 3, 4, 5]; a.length = 2; a.length");
      assert.equal(getPayload(r), 2);
    });
  });

  // ─── reference semantics (the original bug) ────────────────────────

  describe("reference semantics through named properties", () => {
    it("mutates the original object via chained member access", () => {
      const r = run(`
        let obj = { id: 10, name: "Abc" };
        let arr = [1, 2];
        arr.o = obj;
        arr.o.id = 1;
        obj.id
      `);
      assert.equal(getPayload(r), 1);
    });

    it("shares references across multiple arrays", () => {
      const r = run(`
        let o = { v: 0 };
        let a = [];
        let b = [];
        a.ref = o;
        b.ref = o;
        a.ref.v = 99;
        b.ref.v
      `);
      assert.equal(getPayload(r), 99);
    });

    it("propagates nested object mutation through array named prop", () => {
      const r = run(`
        let a = [];
        a.meta = { deep: { val: 42 } };
        a.meta.deep.val
      `);
      assert.equal(getPayload(r), 42);
    });
  });

  // ─── computed property access (STA_INDEX / LDA_INDEX path) ────────

  describe("computed (bracket) access for named properties", () => {
    it("reads and writes a named property via bracket notation", () => {
      const r = run('let a = []; let k = "hi"; a[k] = 10; a[k]');
      assert.equal(getPayload(r), 10);
    });

    it("mutates a referenced object via computed bracket access", () => {
      const r = run(`
        let o = { v: 1 };
        let a = [];
        a["r"] = o;
        a["r"].v = 5;
        o.v
      `);
      assert.equal(getPayload(r), 5);
    });
  });

  // ─── typeof and type coercion ──────────────────────────────────────

  describe("typeof and type checks on array named properties", () => {
    it('returns "object" for an object stored as a named property', () => {
      const r = run("let a = []; a.obj = { x: 1 }; typeof a.obj");
      assert.equal(getPayload(r), "object");
    });

    it('returns "function" for a function stored as a named property', () => {
      const r = run("let a = []; a.fn = function(){}; typeof a.fn");
      assert.equal(getPayload(r), "function");
    });

    it('returns "string" for a string stored as a named property', () => {
      const r = run('let a = []; a.s = "hello"; typeof a.s');
      assert.equal(getPayload(r), "string");
    });

    it('returns "number" for a number stored as a named property', () => {
      const r = run("let a = []; a.n = 3.14; typeof a.n");
      assert.equal(getPayload(r), "number");
    });
  });

  // ─── hidden-class transitions ──────────────────────────────────────

  describe("hidden-class transitions on arrays", () => {
    it("supports sequential named property additions (transition chain)", () => {
      const r = run(`
        let a = [1, 2, 3];
        a.first = "a";
        a.second = "b";
        a.third = "c";
        a.first + a.second + a.third
      `);
      assert.equal(getPayload(r), "abc");
    });

    it("retains earlier named properties after further transitions", () => {
      const r = run(`
        let a = [];
        a.x = 10;
        a.y = 20;
        a.z = 30;
        a.x
      `);
      assert.equal(getPayload(r), 10);
    });
  });

  // ─── toDisplayString — Chrome DevTools-style output ────────────────

  describe("toDisplayString shows named properties like Chrome DevTools", () => {
    it("includes named properties after indexed elements", () => {
      const r = run(
        'let obj = { id: 10, name: "Abc" }, arr = [1, 2]; arr.o = obj; arr',
      );
      assert.equal(toDisplayString(r), "[1, 2, o: { id: 10, name: Abc }]");
    });

    it("shows only indexed elements when no named properties exist", () => {
      const r = run("let a = [1, 2, 3]; a");
      assert.equal(toDisplayString(r), "[1, 2, 3]");
    });

    it("shows only named properties on an empty array", () => {
      const r = run("let a = []; a.x = 42; a");
      assert.equal(toDisplayString(r), "[x: 42]");
    });

    it("shows nested objects inside named properties", () => {
      const r = run("let a = [1]; a.meta = { deep: true }; a");
      assert.equal(toDisplayString(r), "[1, meta: { deep: true }]");
    });

    it("shows multiple named properties in transition order", () => {
      const r = run('let a = []; a.foo = "hello"; a.bar = 99; a');
      assert.equal(toDisplayString(r), "[foo: hello, bar: 99]");
    });

    it("does not leak named properties into toString (spec coercion)", () => {
      const r = run("let a = [1, 2]; a.x = 3; a");
      assert.equal(valToString(r), "[1, 2]");
    });
  });
});
