import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: classes and prototypes", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("class constructor and method", () => {
    const r = engine.runValue(`
      class Point {
        constructor(x, y) {
          this.x = x;
          this.y = y;
        }
        sum() { return this.x + this.y; }
      }
      var p = new Point(3, 4);
      p.sum();
    `);
    expect(r.value).toBe(7);
  });

  it("class inheritance with extends and super", () => {
    const r = engine.runValue(`
      class Animal {
        constructor(name) { this.name = name; }
        speak() { return this.name + " makes a sound"; }
      }
      class Dog extends Animal {
        constructor(name) { super(name); }
        speak() { return this.name + " barks"; }
      }
      var d = new Dog("Rex");
      d.speak();
    `);
    expect(r.value).toBe("Rex barks");
  });

  it("instanceof checks", () => {
    const r = engine.runValue(`
      class A {}
      class B extends A {}
      var b = new B();
      var r1 = b instanceof B;
      var r2 = b instanceof A;
      r1 && r2;
    `);
    expect(r.value).toBe(true);
  });

  it("class method can access inherited properties", () => {
    const r = engine.runValue(`
      class Base {
        constructor() { this.val = 10; }
      }
      class Child extends Base {
        constructor() { super(); this.extra = 20; }
        total() { return this.val + this.extra; }
      }
      new Child().total();
    `);
    expect(r.value).toBe(30);
  });

  it("multiple instances are independent", () => {
    const r = engine.runValue(`
      class Counter {
        constructor() { this.count = 0; }
        inc() { this.count++; return this; }
      }
      var a = new Counter();
      var b = new Counter();
      a.inc().inc().inc();
      b.inc();
      a.count * 10 + b.count;
    `);
    expect(r.value).toBe(31);
  });

  it("constructor returns new object", () => {
    const r = engine.runValue(`
      class Box {
        constructor(v) { this.v = v; }
      }
      var b1 = new Box(1);
      var b2 = new Box(2);
      b1.v + b2.v;
    `);
    expect(r.value).toBe(3);
  });

  it("prototype chain for property lookup", () => {
    const r = engine.runValue(`
      class A {
        constructor() { this.fromA = 100; }
      }
      class B extends A {
        constructor() { super(); this.fromB = 200; }
      }
      class C extends B {
        constructor() { super(); this.fromC = 300; }
        total() { return this.fromA + this.fromB + this.fromC; }
      }
      new C().total();
    `);
    expect(r.value).toBe(600);
  });
});
