import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: Object static methods", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("Object.keys", () => {
    it("returns own property names", () => {
      const r = engine.runValue(`
        var o = {a: 1, b: 2, c: 3};
        Object.keys(o).length;
      `);
      expect(r.value).toBe(3);
    });

    it("returns keys in insertion order", () => {
      const r = engine.runValue(`
        var o = {x: 10, y: 20, z: 30};
        Object.keys(o).join(",");
      `);
      expect(r.value).toBe("x,y,z");
    });

    it("returns empty array for empty object", () => {
      const r = engine.runValue("Object.keys({}).length;");
      expect(r.value).toBe(0);
    });
  });

  describe("Object.values", () => {
    it("returns own property values", () => {
      const r = engine.runValue(`
        var o = {a: 10, b: 20, c: 30};
        var vals = Object.values(o);
        vals[0] + vals[1] + vals[2];
      `);
      expect(r.value).toBe(60);
    });

    it("returns values in insertion order", () => {
      const r = engine.runValue(`
        var o = {x: "hello", y: "world"};
        Object.values(o).join(" ");
      `);
      expect(r.value).toBe("hello world");
    });
  });

  describe("Object.entries", () => {
    it("returns key-value pairs", () => {
      const r = engine.runValue(`
        var o = {a: 1, b: 2};
        var e = Object.entries(o);
        e[0][0] + "=" + e[0][1] + "," + e[1][0] + "=" + e[1][1];
      `);
      expect(r.value).toBe("a=1,b=2");
    });

    it("entries length matches key count", () => {
      const r = engine.runValue(`
        Object.entries({x: 1, y: 2, z: 3}).length;
      `);
      expect(r.value).toBe(3);
    });
  });

  describe("Object.assign", () => {
    it("copies properties to target", () => {
      const r = engine.runValue(`
        var t = {};
        Object.assign(t, {a: 1}, {b: 2});
        t.a + t.b;
      `);
      expect(r.value).toBe(3);
    });

    it("later sources overwrite earlier ones", () => {
      const r = engine.runValue(`
        var t = {x: 1};
        Object.assign(t, {x: 10, y: 20}, {x: 100});
        t.x + t.y;
      `);
      expect(r.value).toBe(120);
    });

    it("returns the target object", () => {
      const r = engine.runValue(`
        var t = {};
        var result = Object.assign(t, {a: 42});
        result.a;
      `);
      expect(r.value).toBe(42);
    });
  });

  describe("Object.defineProperty", () => {
    it("defines a property with value", () => {
      const r = engine.runValue(`
        var o = {};
        Object.defineProperty(o, "x", {value: 42});
        o.x;
      `);
      expect(r.value).toBe(42);
    });

    it("defines a getter property", () => {
      const r = engine.runValue(`
        var o = {_val: 10};
        Object.defineProperty(o, "double", {
          get: function() { return this._val * 2; }
        });
        o.double;
      `);
      expect(r.value).toBe(20);
    });
  });

  describe("Object.getOwnPropertyDescriptor", () => {
    it("returns descriptor with value", () => {
      const r = engine.runValue(`
        var o = {x: 42};
        var d = Object.getOwnPropertyDescriptor(o, "x");
        d.value;
      `);
      expect(r.value).toBe(42);
    });
  });

  describe("Object.hasOwn", () => {
    it("returns true for own property", () => {
      const r = engine.runValue('Object.hasOwn({a: 1}, "a");');
      expect(r.value).toBe(true);
    });

    it("returns false for missing property", () => {
      const r = engine.runValue('Object.hasOwn({a: 1}, "b");');
      expect(r.value).toBe(false);
    });
  });
});

describe("E2E: JSON", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("stringify simple object", () => {
    const r = engine.runValue('JSON.stringify({a: 1, b: 2});');
    expect(r.value).toBe('{"a":1,"b":2}');
  });

  it("stringify array", () => {
    const r = engine.runValue("JSON.stringify([1, 2, 3]);");
    expect(r.value).toBe("[1,2,3]");
  });

  it("stringify nested object", () => {
    const r = engine.runValue('JSON.stringify({a: {b: {c: 1}}});');
    expect(r.value).toBe('{"a":{"b":{"c":1}}}');
  });

  it("stringify string value", () => {
    const r = engine.runValue('JSON.stringify("hello");');
    expect(r.value).toBe('"hello"');
  });

  it("stringify number", () => {
    const r = engine.runValue("JSON.stringify(42);");
    expect(r.value).toBe("42");
  });

  it("stringify boolean", () => {
    const r = engine.runValue("JSON.stringify(true);");
    expect(r.value).toBe("true");
  });

  it("stringify null", () => {
    const r = engine.runValue("JSON.stringify(null);");
    expect(r.value).toBe("null");
  });

  it("parse simple object", () => {
    const r = engine.runValue(`
      var o = JSON.parse('{"x":42,"y":"hello"}');
      o.x + "," + o.y;
    `);
    expect(r.value).toBe("42,hello");
  });

  it("parse array", () => {
    const r = engine.runValue(`
      var a = JSON.parse("[1,2,3]");
      a[0] + a[1] + a[2];
    `);
    expect(r.value).toBe(6);
  });

  it("parse nested structure", () => {
    const r = engine.runValue(`
      var o = JSON.parse('{"a":{"b":10}}');
      o.a.b;
    `);
    expect(r.value).toBe(10);
  });

  it("roundtrip object through stringify then parse", () => {
    const r = engine.runValue(`
      var original = {name: "test", value: 99, items: [1, 2, 3]};
      var json = JSON.stringify(original);
      var restored = JSON.parse(json);
      restored.name + ":" + restored.value + ":" + restored.items.length;
    `);
    expect(r.value).toBe("test:99:3");
  });
});

describe("E2E: Array static methods", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("Array.isArray on array", () => {
    const r = engine.runValue("Array.isArray([1, 2, 3]);");
    expect(r.value).toBe(true);
  });

  it("Array.isArray on non-array", () => {
    const r = engine.runValue("Array.isArray({length: 3});");
    expect(r.value).toBe(false);
  });

  it("Array.from string", () => {
    const r = engine.runValue('Array.from("abc").join(",");');
    expect(r.value).toBe("a,b,c");
  });
});
