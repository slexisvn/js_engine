import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("Class extends and super()", () => {
  it("inherits methods from parent class", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Animal { speak() { return "generic"; } }
      class Dog extends Animal {}
      var d = new Dog();
      d.speak();
    `);
    assert.equal(getPayload(result), "generic");
  });

  it("super() calls parent constructor", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Animal { constructor(name) { this.name = name; } }
      class Dog extends Animal { constructor(name) { super(name); } }
      var d = new Dog("Rex");
      d.name;
    `);
    assert.equal(getPayload(result), "Rex");
  });

  it("super() with multiple arguments", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Animal {
        constructor(name) { this.name = name; }
      }
      class Dog extends Animal {
        constructor(name, breed) {
          super(name);
          this.breed = breed;
        }
        info() { return this.name + " is a " + this.breed; }
      }
      var d = new Dog("Rex", "Labrador");
      d.info();
    `);
    assert.equal(getPayload(result), "Rex is a Labrador");
  });

  it("calls inherited methods with correct this", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Animal {
        constructor(name) { this.name = name; }
        speak() { return this.name + " speaks"; }
      }
      class Dog extends Animal {
        constructor(name) { super(name); }
      }
      var d = new Dog("Buddy");
      d.speak();
    `);
    assert.equal(getPayload(result), "Buddy speaks");
  });

  it("child method overrides parent method", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Animal { speak() { return "generic"; } }
      class Dog extends Animal { speak() { return "woof"; } }
      var d = new Dog();
      d.speak();
    `);
    assert.equal(getPayload(result), "woof");
  });

  it("supports multi-level inheritance", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class A { greet() { return "hello"; } }
      class B extends A {}
      class C extends B {}
      var c = new C();
      c.greet();
    `);
    assert.equal(getPayload(result), "hello");
  });

  it("child can have own methods alongside inherited ones", () => {
    const jit = new MiniJIT();
    const r1 = jit.run(`
      class Animal { speak() { return "generic"; } }
      class Dog extends Animal { bark() { return "woof"; } }
      var d = new Dog();
      d.bark();
    `);
    assert.equal(getPayload(r1), "woof");
    jit.reset();
    const r2 = jit.run(`
      class Animal { speak() { return "generic"; } }
      class Dog extends Animal { bark() { return "woof"; } }
      var d = new Dog();
      d.speak();
    `);
    assert.equal(getPayload(r2), "generic");
  });

  it("super() in multi-level chain", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class A {
        constructor(x) { this.x = x; }
      }
      class B extends A {
        constructor(x, y) { super(x); this.y = y; }
      }
      class C extends B {
        constructor(x, y, z) { super(x, y); this.z = z; }
        sum() { return this.x + this.y + this.z; }
      }
      var c = new C(1, 2, 3);
      c.sum();
    `);
    assert.equal(getPayload(result), 6);
  });
});
