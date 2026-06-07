import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: getters and setters", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("getter in object literal", () => {
    const r = engine.runValue(`
      var o = { get x() { return 42; } };
      o.x;
    `);
    expect(r.value).toBe(42);
  });

  it("setter in object literal", () => {
    const r = engine.runValue(`
      var o = {
        _v: 0,
        set v(x) { this._v = x * 2; },
        get v() { return this._v; }
      };
      o.v = 5;
      o.v;
    `);
    expect(r.value).toBe(10);
  });

  it("getter computes derived value", () => {
    const r = engine.runValue(`
      var rect = {
        width: 5,
        height: 3,
        get area() { return this.width * this.height; }
      };
      rect.area;
    `);
    expect(r.value).toBe(15);
  });

  it("setter validates input", () => {
    const r = engine.runValue(`
      var o = {
        _age: 0,
        set age(v) { this._age = v < 0 ? 0 : v; },
        get age() { return this._age; }
      };
      o.age = -5;
      var a = o.age;
      o.age = 25;
      a + "," + o.age;
    `);
    expect(r.value).toBe("0,25");
  });

  it("getter in class", () => {
    const r = engine.runValue(`
      class Circle {
        constructor(r) { this.radius = r; }
        get diameter() { return this.radius * 2; }
      }
      var c = new Circle(5);
      c.diameter;
    `);
    expect(r.value).toBe(10);
  });

  it("setter in class", () => {
    const r = engine.runValue(`
      class Box {
        constructor(w) { this._width = w; }
        get width() { return this._width; }
        set width(w) { this._width = w > 0 ? w : 1; }
      }
      var b = new Box(10);
      b.width = -5;
      b.width;
    `);
    expect(r.value).toBe(1);
  });

  it("multiple getters on same object", () => {
    const r = engine.runValue(`
      var o = {
        first: "John",
        last: "Doe",
        get full() { return this.first + " " + this.last; },
        get initials() { return this.first[0] + this.last[0]; }
      };
      o.full + "," + o.initials;
    `);
    expect(r.value).toBe("John Doe,JD");
  });
});

describe("E2E: optional chaining", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("accesses nested property", () => {
    const r = engine.runValue(`
      var o = {a: {b: {c: 42}}};
      o?.a?.b?.c;
    `);
    expect(r.value).toBe(42);
  });

  it("returns undefined for null base", () => {
    const r = engine.runValue("var o = null; o?.x;");
    expect(r.tag).toBe("undefined");
  });

  it("returns undefined for undefined base", () => {
    const r = engine.runValue("var o = undefined; o?.x;");
    expect(r.tag).toBe("undefined");
  });

  it("stops at null in chain", () => {
    const r = engine.runValue(`
      var o = {a: null};
      o?.a?.b;
    `);
    expect(r.tag).toBe("undefined");
  });

  it("works with method calls", () => {
    const r = engine.runValue(`
      var o = {greet: function() { return "hi"; }};
      o?.greet();
    `);
    expect(r.value).toBe("hi");
  });

  it("mixed with regular access", () => {
    const r = engine.runValue(`
      var data = {users: [{name: "Alice"}]};
      data?.users[0].name;
    `);
    expect(r.value).toBe("Alice");
  });
});

describe("E2E: nullish coalescing", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("returns left side for non-nullish", () => {
    const r = engine.runValue("42 ?? 99;");
    expect(r.value).toBe(42);
  });

  it("returns right side for null", () => {
    const r = engine.runValue("null ?? 42;");
    expect(r.value).toBe(42);
  });

  it("returns right side for undefined", () => {
    const r = engine.runValue("undefined ?? 42;");
    expect(r.value).toBe(42);
  });

  it("preserves 0 (unlike ||)", () => {
    const r = engine.runValue("0 ?? 42;");
    expect(r.value).toBe(0);
  });

  it("preserves empty string (unlike ||)", () => {
    const r = engine.runValue('"" ?? "default";');
    expect(r.value).toBe("");
  });

  it("preserves false (unlike ||)", () => {
    const r = engine.runValue("false ?? true;");
    expect(r.value).toBe(false);
  });

  it("chains correctly", () => {
    const r = engine.runValue("null ?? undefined ?? 42;");
    expect(r.value).toBe(42);
  });
});

describe("E2E: computed property names", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("variable as property name", () => {
    const r = engine.runValue(`
      var key = "hello";
      var o = {[key]: 42};
      o.hello;
    `);
    expect(r.value).toBe(42);
  });

  it("expression as property name", () => {
    const r = engine.runValue(`
      var o = {["a" + "b"]: 99};
      o.ab;
    `);
    expect(r.value).toBe(99);
  });

  it("multiple computed properties", () => {
    const r = engine.runValue(`
      var a = "x";
      var b = "y";
      var o = {[a]: 1, [b]: 2};
      o.x + o.y;
    `);
    expect(r.value).toBe(3);
  });

  it("computed and regular properties mixed", () => {
    const r = engine.runValue(`
      var k = "dynamic";
      var o = {static: 10, [k]: 20};
      o.static + o.dynamic;
    `);
    expect(r.value).toBe(30);
  });
});
