import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPayload,
  getTag,
  isBool,
  isNull,
  isSmi,
  isUndefined,
  mkArray,
  mkBool,
  mkDouble,
  mkFunction,
  mkNull,
  mkObject,
  mkSmi,
  mkString,
  mkUndefined,
  abstractLooseEqual,
  toPrimitive,
} from "../src/core/value/index.js";
import { createJSArray, createJSObject } from "../src/objects/heap/factory.js";

describe("pointer tagged values", () => {
  it("encodes immediate primitives as numbers", () => {
    const smi = mkSmi(42);
    const t = mkBool(true);
    const f = mkBool(false);
    const n = mkNull();
    const u = mkUndefined();
    assert.equal(typeof smi, "number");
    assert.equal(typeof t, "number");
    assert.equal(typeof f, "number");
    assert.equal(typeof n, "number");
    assert.equal(typeof u, "number");
    assert.equal(isSmi(smi), true);
    assert.equal(isBool(t), true);
    assert.equal(isBool(f), true);
    assert.equal(isNull(n), true);
    assert.equal(isUndefined(u), true);
    assert.equal(getPayload(smi), 42);
    assert.equal(getPayload(t), true);
    assert.equal(getPayload(f), false);
  });

  it("round trips heap backed values", () => {
    const obj = createJSObject();
    const arr = createJSArray([mkSmi(1)]);
    const fn = { name: "f", call: () => mkUndefined() };
    const values = [
      [mkDouble(1.5), "double", 1.5],
      [mkString("x"), "string", "x"],
      [mkObject(obj), "object", obj],
      [mkArray(arr), "array", arr],
      [mkFunction(fn), "function", fn],
    ];
    for (const [value, tag, payload] of values) {
      assert.equal(typeof value, "number");
      assert.equal(getTag(value), tag);
      assert.equal(getPayload(value), payload);
    }
  });
});

describe("abstractLooseEqual", () => {
  it("null == undefined", () => {
    assert.equal(abstractLooseEqual(mkNull(), mkUndefined()), true);
    assert.equal(abstractLooseEqual(mkUndefined(), mkNull()), true);
  });

  it("returns false when loosely comparing null and 0", () => {
    assert.equal(abstractLooseEqual(mkNull(), mkSmi(0)), false);
  });

  it("number == string", () => {
    assert.equal(abstractLooseEqual(mkSmi(5), mkString("5")), true);
    assert.equal(abstractLooseEqual(mkString("10"), mkSmi(10)), true);
    assert.equal(abstractLooseEqual(mkSmi(5), mkString("6")), false);
  });

  it("returns true when loosely comparing true and 1 or false and 0", () => {
    assert.equal(abstractLooseEqual(mkBool(true), mkSmi(1)), true);
    assert.equal(abstractLooseEqual(mkBool(false), mkSmi(0)), true);
    assert.equal(abstractLooseEqual(mkBool(true), mkSmi(2)), false);
  });

  it("same type falls through to strict", () => {
    assert.equal(abstractLooseEqual(mkSmi(3), mkSmi(3)), true);
    assert.equal(abstractLooseEqual(mkSmi(3), mkSmi(4)), false);
    assert.equal(abstractLooseEqual(mkString("a"), mkString("a")), true);
  });

  it("smi == double with same value", () => {
    assert.equal(abstractLooseEqual(mkSmi(5), mkDouble(5.0)), true);
    assert.equal(abstractLooseEqual(mkSmi(5), mkDouble(5.5)), false);
  });
});

describe("toPrimitive", () => {
  it("returns primitives unchanged", () => {
    const smi = mkSmi(42);
    assert.equal(toPrimitive(smi), smi);
    const str = mkString("hello");
    assert.equal(toPrimitive(str), str);
  });
});
