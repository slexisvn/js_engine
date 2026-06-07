import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: built-in methods", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("Array methods", () => {
    it("map transforms each element", () => {
      const r = engine.runValue(`
        var a = [1, 2, 3, 4];
        var b = a.map(function(x) { return x * x; });
        b[0] + b[1] + b[2] + b[3];
      `);
      expect(r.value).toBe(30);
    });

    it("filter keeps matching elements", () => {
      const r = engine.runValue(`
        var nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var evens = nums.filter(function(x) { return x % 2 === 0; });
        evens.length;
      `);
      expect(r.value).toBe(5);
    });

    it("reduce accumulates a value", () => {
      const r = engine.runValue(`
        var product = [1, 2, 3, 4, 5].reduce(function(acc, x) {
          return acc * x;
        }, 1);
        product;
      `);
      expect(r.value).toBe(120);
    });

    it("find returns first match", () => {
      const r = engine.runValue(`
        var items = [
          {name: "a", val: 1},
          {name: "b", val: 2},
          {name: "c", val: 3}
        ];
        var found = items.find(function(item) { return item.val > 1; });
        found.name;
      `);
      expect(r.value).toBe("b");
    });

    it("some returns true if any match", () => {
      expect(engine.runValue("[1,2,3].some(function(x){return x>2;})").value).toBe(true);
      expect(engine.runValue("[1,2,3].some(function(x){return x>5;})").value).toBe(false);
    });

    it("every returns true if all match", () => {
      expect(engine.runValue("[2,4,6].every(function(x){return x%2===0;})").value).toBe(true);
      expect(engine.runValue("[2,4,5].every(function(x){return x%2===0;})").value).toBe(false);
    });

    it("forEach visits each element", () => {
      const r = engine.runValue(`
        var indices = "";
        [10, 20, 30].forEach(function(val, idx) {
          indices += idx;
        });
        indices;
      `);
      expect(r.value).toBe("012");
    });

    it("join concatenates with separator", () => {
      expect(engine.runValue('[1,2,3].join("-")').value).toBe("1-2-3");
    });

    it("indexOf finds element position", () => {
      expect(engine.runValue("[10,20,30,40].indexOf(30)").value).toBe(2);
      expect(engine.runValue("[10,20,30].indexOf(99)").value).toBe(-1);
    });

    it("includes checks membership", () => {
      expect(engine.runValue("[1,2,3].includes(2)").value).toBe(true);
      expect(engine.runValue("[1,2,3].includes(5)").value).toBe(false);
    });

    it("reverse mutates in place", () => {
      const r = engine.runValue(`
        var a = [1, 2, 3];
        a.reverse();
        a[0] * 100 + a[1] * 10 + a[2];
      `);
      expect(r.value).toBe(321);
    });

    it("concat merges arrays", () => {
      const r = engine.runValue(`
        var a = [1, 2].concat([3, 4], [5]);
        a.length * 10 + a[4];
      `);
      expect(r.value).toBe(55);
    });

    it("slice extracts subarray", () => {
      const r = engine.runValue(`
        var a = [10, 20, 30, 40, 50];
        var b = a.slice(1, 4);
        b[0] + b[1] + b[2];
      `);
      expect(r.value).toBe(90);
    });

    it("splice removes and returns elements", () => {
      const r = engine.runValue(`
        var a = [1, 2, 3, 4, 5];
        var removed = a.splice(1, 2);
        a.length * 100 + removed.length * 10 + removed[0];
      `);
      expect(r.value).toBe(322);
    });

    it("flat flattens one level", () => {
      const r = engine.runValue(`
        var a = [[1, 2], [3], [4, 5, 6]];
        var b = a.flat();
        b.length;
      `);
      expect(r.value).toBe(6);
    });

    it("sort with comparator", () => {
      const r = engine.runValue(`
        var a = [30, 10, 50, 20, 40];
        a.sort(function(x, y) { return x - y; });
        a[0] * 10000 + a[1] * 1000 + a[2] * 100 + a[3] * 10 + a[4];
      `);
      expect(r.value).toBe(123450);
    });

    it("unshift prepends elements", () => {
      const r = engine.runValue(`
        var a = [3, 4];
        a.unshift(1);
        a.unshift(0);
        a[0] * 1000 + a[1] * 100 + a[2] * 10 + a[3];
      `);
      expect(r.value).toBe(134);
    });

    it("shift removes first element", () => {
      const r = engine.runValue(`
        var a = [10, 20, 30];
        var first = a.shift();
        first * 100 + a[0] * 10 + a.length;
      `);
      expect(r.value).toBe(1202);
    });

    it("fill replaces elements", () => {
      const r = engine.runValue(`
        var a = [1, 2, 3, 4, 5];
        a.fill(0, 1, 4);
        a[0] + a[1] + a[2] + a[3] + a[4];
      `);
      expect(r.value).toBe(6);
    });

    it("Array.isArray distinguishes arrays from objects", () => {
      expect(engine.runValue("Array.isArray([1,2,3])").value).toBe(true);
      expect(engine.runValue("Array.isArray({length: 3})").value).toBe(false);
    });
  });

  describe("String methods", () => {
    it("slice extracts substring", () => {
      expect(engine.runValue('"hello world".slice(6)').value).toBe("world");
      expect(engine.runValue('"hello world".slice(0, 5)').value).toBe("hello");
    });

    it("indexOf finds substring position", () => {
      expect(engine.runValue('"abcdef".indexOf("cd")').value).toBe(2);
      expect(engine.runValue('"abcdef".indexOf("xyz")').value).toBe(-1);
    });

    it("toUpperCase and toLowerCase", () => {
      expect(engine.runValue('"Hello".toUpperCase()').value).toBe("HELLO");
      expect(engine.runValue('"Hello".toLowerCase()').value).toBe("hello");
    });

    it("trim removes whitespace", () => {
      expect(engine.runValue('"  hello  ".trim()').value).toBe("hello");
    });

    it("includes checks substring presence", () => {
      expect(engine.runValue('"hello world".includes("world")').value).toBe(true);
      expect(engine.runValue('"hello world".includes("xyz")').value).toBe(false);
    });

    it("startsWith and endsWith", () => {
      expect(engine.runValue('"hello".startsWith("hel")').value).toBe(true);
      expect(engine.runValue('"hello".endsWith("llo")').value).toBe(true);
    });

    it("repeat duplicates string", () => {
      expect(engine.runValue('"abc".repeat(3)').value).toBe("abcabcabc");
    });

    it("split tokenizes string", () => {
      const r = engine.runValue(`
        var parts = "a:b:c:d".split(":");
        parts.length * 100 + parts[0].length;
      `);
      expect(r.value).toBe(401);
    });

    it("padStart pads to target length", () => {
      expect(engine.runValue('"42".padStart(5, "0")').value).toBe("00042");
    });

    it("replace substitutes first occurrence", () => {
      expect(engine.runValue('"foo bar foo".replace("foo", "baz")').value).toBe("baz bar foo");
    });

    it("charAt returns character at index", () => {
      expect(engine.runValue('"hello"[2]').value).toBe("l");
    });
  });

  describe("Math methods", () => {
    it("abs returns absolute value", () => {
      expect(engine.runValue("Math.abs(-42)").value).toBe(42);
      expect(engine.runValue("Math.abs(42)").value).toBe(42);
    });

    it("max and min", () => {
      expect(engine.runValue("Math.max(1, 5, 3, 9, 2)").value).toBe(9);
      expect(engine.runValue("Math.min(1, 5, 3, 9, 2)").value).toBe(1);
    });

    it("floor, ceil, round, trunc", () => {
      expect(engine.runValue("Math.floor(3.9)").value).toBe(3);
      expect(engine.runValue("Math.ceil(3.1)").value).toBe(4);
      expect(engine.runValue("Math.round(3.5)").value).toBe(4);
      expect(engine.runValue("Math.trunc(3.9)").value).toBe(3);
    });

    it("sqrt", () => {
      expect(engine.runValue("Math.sqrt(144)").value).toBe(12);
    });

    it("pow", () => {
      expect(engine.runValue("Math.pow(2, 10)").value).toBe(1024);
    });

    it("floor on negative rounds toward -Infinity", () => {
      expect(engine.runValue("Math.floor(-3.1)").value).toBe(-4);
    });

    it("trunc on negative rounds toward zero", () => {
      expect(engine.runValue("Math.trunc(-3.9)").value).toBe(-3);
    });
  });

  describe("global functions", () => {
    it("parseInt parses integer from string", () => {
      expect(engine.runValue('parseInt("42")').value).toBe(42);
      expect(engine.runValue('parseInt("  100px")').value).toBe(100);
    });

    it("parseFloat parses decimal from string", () => {
      expect(engine.runValue('parseFloat("3.14")').value).toBeCloseTo(3.14);
    });

    it("isNaN detects NaN", () => {
      expect(engine.runValue("isNaN(0 / 0)").value).toBe(true);
      expect(engine.runValue("isNaN(42)").value).toBe(false);
    });

    it("isFinite checks finiteness", () => {
      expect(engine.runValue("isFinite(42)").value).toBe(true);
      expect(engine.runValue("isFinite(1 / 0)").value).toBe(false);
    });
  });

  describe("Regex", () => {
    it("test checks for pattern match", () => {
      expect(engine.runValue('/^[0-9]+$/.test("123")').value).toBe(true);
      expect(engine.runValue('/^[0-9]+$/.test("abc")').value).toBe(false);
    });

    it("exec returns capture groups", () => {
      const r = engine.runValue(`
        var m = /([a-z]+)([0-9]+)/.exec("abc123");
        m[1] + ":" + m[2];
      `);
      expect(r.value).toBe("abc:123");
    });

    it("string.match finds pattern", () => {
      const r = engine.runValue(`
        var m = "hello 42 world 99".match(/[0-9]+/);
        m[0];
      `);
      expect(r.value).toBe("42");
    });
  });

  describe("Map", () => {
    it("set/get/has/delete/size", () => {
      const r = engine.runValue(`
        var m = new Map();
        m.set("a", 10);
        m.set("b", 20);
        m.set("c", 30);
        m.delete("b");
        var hasA = m.has("a");
        var hasB = m.has("b");
        var size = m.size;
        var val = m.get("a");
        (hasA ? 1000 : 0) + (hasB ? 100 : 0) + size * 10 + val;
      `);
      expect(r.value).toBe(1030);
    });

    it("overwrites existing key", () => {
      const r = engine.runValue(`
        var m = new Map();
        m.set("x", 1);
        m.set("x", 2);
        m.get("x") * 10 + m.size;
      `);
      expect(r.value).toBe(21);
    });
  });

  describe("Set", () => {
    it("add/has/delete/size with dedup", () => {
      const r = engine.runValue(`
        var s = new Set();
        s.add(1);
        s.add(2);
        s.add(3);
        s.add(2);
        s.add(1);
        var size = s.size;
        s.delete(3);
        var has3 = s.has(3);
        size * 100 + s.size * 10 + (has3 ? 1 : 0);
      `);
      expect(r.value).toBe(320);
    });
  });
});
