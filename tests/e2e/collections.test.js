import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: Map", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("set and get with string keys", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set("a", 10);
      m.set("b", 20);
      m.get("a") + m.get("b");
    `);
    expect(r.value).toBe(30);
  });

  it("set and get with number keys", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set(1, "one");
      m.set(2, "two");
      m.get(1) + "," + m.get(2);
    `);
    expect(r.value).toBe("one,two");
  });

  it("set and get with object keys (identity-based)", () => {
    const r = engine.runValue(`
      var m = new Map();
      var k1 = {id: 1};
      var k2 = {id: 2};
      m.set(k1, 100);
      m.set(k2, 200);
      m.get(k1) + m.get(k2);
    `);
    expect(r.value).toBe(300);
  });

  it("has returns true for existing key, false otherwise", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set("x", 1);
      (m.has("x") ? 10 : 0) + (m.has("y") ? 1 : 0);
    `);
    expect(r.value).toBe(10);
  });

  it("delete removes key-value pair", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set("a", 1);
      m.set("b", 2);
      m.delete("a");
      m.has("a") ? "bad" : "ok";
    `);
    expect(r.value).toBe("ok");
  });

  it("size reflects number of entries", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set("a", 1);
      m.set("b", 2);
      m.set("c", 3);
      m.delete("b");
      m.size;
    `);
    expect(r.value).toBe(2);
  });

  it("set overwrites existing key", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set("x", 1);
      m.set("x", 99);
      m.get("x") * 10 + m.size;
    `);
    expect(r.value).toBe(991);
  });

  it("clear removes all entries", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set(1, "a");
      m.set(2, "b");
      m.set(3, "c");
      m.clear();
      m.size;
    `);
    expect(r.value).toBe(0);
  });

  it("forEach iterates all entries in insertion order", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.set("x", 10);
      m.set("y", 20);
      m.set("z", 30);
      var keys = "";
      var sum = 0;
      m.forEach(function(v, k) {
        keys += k;
        sum += v;
      });
      keys + ":" + sum;
    `);
    expect(r.value).toBe("xyz:60");
  });

  it("get on non-existing key returns undefined", () => {
    const r = engine.runValue(`
      var m = new Map();
      m.get("nope");
    `);
    expect(r.tag).toBe("undefined");
  });

  it("used as a frequency counter", () => {
    const r = engine.runValue(`
      var items = ["a", "b", "a", "c", "b", "a"];
      var freq = new Map();
      for (var i = 0; i < items.length; i++) {
        var key = items[i];
        if (freq.has(key)) {
          freq.set(key, freq.get(key) + 1);
        } else {
          freq.set(key, 1);
        }
      }
      freq.get("a") * 100 + freq.get("b") * 10 + freq.get("c");
    `);
    expect(r.value).toBe(321);
  });
});

describe("E2E: Set", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("add and has", () => {
    const r = engine.runValue(`
      var s = new Set();
      s.add(1);
      s.add(2);
      s.add(3);
      (s.has(1) ? 100 : 0) + (s.has(2) ? 10 : 0) + (s.has(4) ? 1 : 0);
    `);
    expect(r.value).toBe(110);
  });

  it("deduplicates values", () => {
    const r = engine.runValue(`
      var s = new Set();
      s.add(1);
      s.add(2);
      s.add(1);
      s.add(3);
      s.add(2);
      s.size;
    `);
    expect(r.value).toBe(3);
  });

  it("delete removes value", () => {
    const r = engine.runValue(`
      var s = new Set();
      s.add("a");
      s.add("b");
      s.add("c");
      s.delete("b");
      s.has("b") ? "bad" : "ok";
    `);
    expect(r.value).toBe("ok");
  });

  it("size reflects unique count", () => {
    const r = engine.runValue(`
      var s = new Set();
      for (var i = 0; i < 10; i++) s.add(i % 3);
      s.size;
    `);
    expect(r.value).toBe(3);
  });

  it("clear empties the set", () => {
    const r = engine.runValue(`
      var s = new Set();
      s.add(1);
      s.add(2);
      s.clear();
      s.size + (s.has(1) ? 10 : 0);
    `);
    expect(r.value).toBe(0);
  });

  it("forEach iterates all values", () => {
    const r = engine.runValue(`
      var s = new Set();
      s.add(10);
      s.add(20);
      s.add(30);
      var sum = 0;
      s.forEach(function(v) { sum += v; });
      sum;
    `);
    expect(r.value).toBe(60);
  });

  it("used to find unique elements", () => {
    const r = engine.runValue(`
      var arr = [1, 3, 2, 3, 1, 4, 2, 5, 4, 5];
      var s = new Set();
      for (var i = 0; i < arr.length; i++) s.add(arr[i]);
      s.size;
    `);
    expect(r.value).toBe(5);
  });

  it("set with string values", () => {
    const r = engine.runValue(`
      var s = new Set();
      s.add("hello");
      s.add("world");
      s.add("hello");
      s.size * 10 + (s.has("hello") ? 1 : 0);
    `);
    expect(r.value).toBe(21);
  });
});

describe("E2E: WeakMap", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("set and get with object keys", () => {
    const r = engine.runValue(`
      var wm = new WeakMap();
      var k = {};
      wm.set(k, 42);
      wm.get(k);
    `);
    expect(r.value).toBe(42);
  });

  it("has returns true for existing key", () => {
    const r = engine.runValue(`
      var wm = new WeakMap();
      var k = {};
      wm.set(k, "val");
      wm.has(k);
    `);
    expect(r.value).toBe(true);
  });

  it("delete removes entry", () => {
    const r = engine.runValue(`
      var wm = new WeakMap();
      var k = {};
      wm.set(k, 1);
      wm.delete(k);
      wm.has(k);
    `);
    expect(r.value).toBe(false);
  });

  it("different object keys are independent", () => {
    const r = engine.runValue(`
      var wm = new WeakMap();
      var a = {};
      var b = {};
      wm.set(a, "alpha");
      wm.set(b, "beta");
      wm.get(a) + "," + wm.get(b);
    `);
    expect(r.value).toBe("alpha,beta");
  });

  it("overwrite existing key", () => {
    const r = engine.runValue(`
      var wm = new WeakMap();
      var k = {};
      wm.set(k, "first");
      wm.set(k, "second");
      wm.get(k);
    `);
    expect(r.value).toBe("second");
  });

  it("used as metadata store for objects", () => {
    const r = engine.runValue(`
      var wm = new WeakMap();
      var obj1 = {name: "Alice"};
      var obj2 = {name: "Bob"};
      wm.set(obj1, {age: 30});
      wm.set(obj2, {age: 25});
      wm.get(obj1).age + wm.get(obj2).age;
    `);
    expect(r.value).toBe(55);
  });
});
