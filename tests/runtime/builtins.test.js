import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { builtins } from "../../src/runtime/builtins/index.js";
import {
  mkUndefined,
  mkNumber,
  mkString,
  mkBool,
  mkDouble,
  mkSmi,
  mkNull,
  mkArray,
  mkObject,
  toDisplayString,
  isNumber,
  isString,
  isBool,
  isObject,
  isArray,
  isNull,
  isUndefined,
  toNumber,
  getPayload,
} from "../../src/core/value/index.js";
import {
  createJSObject,
  createJSArray,
} from "../../src/objects/heap/factory.js";

describe("Runtime Builtins", () => {
  describe("JSON.parse", () => {
    it("parses a number", () => {
      const result = builtins.JSON.parse.call([mkString("42")]);
      assert.equal(toNumber(result), 42);
    });

    it("parses a string", () => {
      const result = builtins.JSON.parse.call([mkString('"hello"')]);
      assert.equal(getPayload(result), "hello");
    });

    it("parses a boolean", () => {
      const result = builtins.JSON.parse.call([mkString("true")]);
      assert.equal(getPayload(result), true);
    });

    it("parses null", () => {
      const result = builtins.JSON.parse.call([mkString("null")]);
      assert.ok(isNull(result));
    });

    it("parses an array", () => {
      const result = builtins.JSON.parse.call([mkString("[1,2,3]")]);
      assert.ok(isArray(result));
      const arr = getPayload(result);
      assert.equal(arr.getLength(), 3);
      assert.equal(toNumber(arr.elements[0]), 1);
      assert.equal(toNumber(arr.elements[1]), 2);
      assert.equal(toNumber(arr.elements[2]), 3);
    });

    it("parses an object", () => {
      const result = builtins.JSON.parse.call([mkString('{"a":1,"b":"hi"}')]);
      assert.ok(isObject(result));
      const obj = getPayload(result);
      assert.equal(toNumber(obj.getProperty("a")), 1);
      assert.equal(getPayload(obj.getProperty("b")), "hi");
    });

    it("throws on invalid JSON", () => {
      assert.throws(() => {
        builtins.JSON.parse.call([mkString("{bad}")]);
      }, /SyntaxError/);
    });
  });

  describe("JSON.stringify", () => {
    it("stringifies a number", () => {
      const result = builtins.JSON.stringify.call([mkSmi(42)]);
      assert.equal(getPayload(result), "42");
    });

    it("stringifies a string", () => {
      const result = builtins.JSON.stringify.call([mkString("hello")]);
      assert.equal(getPayload(result), '"hello"');
    });

    it("stringifies a boolean", () => {
      const result = builtins.JSON.stringify.call([mkBool(true)]);
      assert.equal(getPayload(result), "true");
    });

    it("stringifies null", () => {
      const result = builtins.JSON.stringify.call([mkNull()]);
      assert.equal(getPayload(result), "null");
    });

    it("stringifies an array", () => {
      const arr = createJSArray([mkSmi(1), mkSmi(2), mkSmi(3)]);
      const result = builtins.JSON.stringify.call([mkArray(arr)]);
      assert.equal(getPayload(result), "[1,2,3]");
    });

    it("stringifies an object", () => {
      const obj = createJSObject();
      obj.setProperty("a", mkSmi(1));
      obj.setProperty("b", mkString("hi"));
      const result = builtins.JSON.stringify.call([mkObject(obj)]);
      const parsed = JSON.parse(getPayload(result));
      assert.equal(parsed.a, 1);
      assert.equal(parsed.b, "hi");
    });

    it("returns undefined with no args", () => {
      const result = builtins.JSON.stringify.call([]);
      assert.ok(isUndefined(result));
    });
  });

  describe("Array.from", () => {
    it("copies an array", () => {
      const src = mkArray(createJSArray([mkSmi(1), mkSmi(2)]));
      const result = builtins.Array.from.call([src]);
      assert.ok(isArray(result));
      const arr = getPayload(result);
      assert.equal(arr.getLength(), 2);
      assert.equal(toNumber(arr.elements[0]), 1);
      assert.equal(toNumber(arr.elements[1]), 2);
    });

    it("creates array from string", () => {
      const result = builtins.Array.from.call([mkString("abc")]);
      assert.ok(isArray(result));
      const arr = getPayload(result);
      assert.equal(arr.getLength(), 3);
      assert.equal(getPayload(arr.elements[0]), "a");
      assert.equal(getPayload(arr.elements[1]), "b");
      assert.equal(getPayload(arr.elements[2]), "c");
    });

    it("returns empty array with no args", () => {
      const result = builtins.Array.from.call([]);
      assert.ok(isArray(result));
      assert.equal(getPayload(result).getLength(), 0);
    });
  });

  describe("Array.isArray", () => {
    it("returns true for arrays", () => {
      const arr = mkArray(createJSArray([]));
      const result = builtins.Array.isArray.call([arr]);
      assert.equal(getPayload(result), true);
    });

    it("returns false for non-arrays", () => {
      assert.equal(getPayload(builtins.Array.isArray.call([mkSmi(1)])), false);
      assert.equal(
        getPayload(builtins.Array.isArray.call([mkString("hi")])),
        false,
      );
      assert.equal(getPayload(builtins.Array.isArray.call([])), false);
    });
  });

  describe("String builtin", () => {
    it("converts number to string", () => {
      const result = builtins.String.call([mkSmi(42)]);
      assert.equal(getPayload(result), "42");
    });

    it("converts boolean to string", () => {
      const result = builtins.String.call([mkBool(true)]);
      assert.equal(getPayload(result), "true");
    });

    it("returns empty string with no args", () => {
      const result = builtins.String.call([]);
      assert.equal(getPayload(result), "");
    });
  });

  describe("Math builtins", () => {
    it("Math.abs works", () => {
      assert.equal(toNumber(builtins.Math.abs.call([mkSmi(-5)])), 5);
    });

    it("Math.floor works", () => {
      assert.equal(toNumber(builtins.Math.floor.call([mkDouble(3.7)])), 3);
    });

    it("Math.ceil works", () => {
      assert.equal(toNumber(builtins.Math.ceil.call([mkDouble(3.2)])), 4);
    });

    it("Math.round works", () => {
      assert.equal(toNumber(builtins.Math.round.call([mkDouble(3.5)])), 4);
    });

    it("Math.min/max work", () => {
      assert.equal(
        toNumber(builtins.Math.min.call([mkSmi(3), mkSmi(1), mkSmi(5)])),
        1,
      );
      assert.equal(
        toNumber(builtins.Math.max.call([mkSmi(3), mkSmi(1), mkSmi(5)])),
        5,
      );
    });

    it("Math.pow works", () => {
      assert.equal(
        toNumber(builtins.Math.pow.call([mkSmi(2), mkSmi(10)])),
        1024,
      );
    });
  });

  describe("Existing builtins still work", () => {
    it("parseInt works", () => {
      const result = builtins.parseInt.call([mkString("42")]);
      assert.equal(toNumber(result), 42);
    });

    it("parseFloat works", () => {
      const result = builtins.parseFloat.call([mkString("3.14")]);
      assert.ok(Math.abs(toNumber(result) - 3.14) < 0.001);
    });

    it("isNaN works", () => {
      assert.equal(getPayload(builtins.isNaN.call([mkString("hello")])), true);
      assert.equal(getPayload(builtins.isNaN.call([mkSmi(42)])), false);
    });

    it("Number builtin works", () => {
      assert.equal(toNumber(builtins.Number.call([mkString("42")])), 42);
      assert.equal(toNumber(builtins.Number.call([])), 0);
    });

    it("Boolean builtin works", () => {
      assert.equal(getPayload(builtins.Boolean.call([mkSmi(0)])), false);
      assert.equal(getPayload(builtins.Boolean.call([mkSmi(1)])), true);
    });

    it("typeof works", () => {
      assert.equal(getPayload(builtins.typeof.call([mkSmi(1)])), "number");
      assert.equal(
        getPayload(builtins.typeof.call([mkString("hi")])),
        "string",
      );
    });

    it("Object.keys works", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));
      obj.setProperty("y", mkSmi(2));
      const result = builtins.Object.keys.call([mkObject(obj)]);
      assert.ok(isArray(result));
      assert.equal(getPayload(result).getLength(), 2);
    });

    it("Object.values works", () => {
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(10));
      const result = builtins.Object.values.call([mkObject(obj)]);
      assert.ok(isArray(result));
      assert.equal(toNumber(getPayload(result).elements[0]), 10);
    });

    it("Object.entries works", () => {
      const obj = createJSObject();
      obj.setProperty("a", mkSmi(1));
      const result = builtins.Object.entries.call([mkObject(obj)]);
      assert.ok(isArray(result));
      const entry = getPayload(result).elements[0];
      assert.ok(isArray(entry));
    });
  });
});
