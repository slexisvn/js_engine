import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("Object literal getter/setter", () => {
  it("getter returns computed value", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = { _x: 10, get x() { return this._x * 2; } };
      obj.x;
    `);
    assert.equal(getPayload(result), 20);
  });

  it("setter modifies internal state", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = { _x: 0, set x(v) { this._x = v; } };
      obj.x = 42;
      obj._x;
    `);
    assert.equal(getPayload(result), 42);
  });

  it("getter and setter on same property", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = {
        _name: "Rex",
        get name() { return this._name; },
        set name(v) { this._name = v; }
      };
      obj.name = "Max";
      obj.name;
    `);
    assert.equal(getPayload(result), "Max");
  });

  it("getter without setter returns undefined on set", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = { get x() { return 42; } };
      obj.x = 99;
      obj.x;
    `);
    assert.equal(getPayload(result), 42);
  });

  it("setter without getter returns undefined on get", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = { _v: 0, set x(v) { this._v = v; } };
      var result = obj.x;
      result;
    `);
    assert.equal(getPayload(result), undefined);
  });

  it("getter with this context", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = {
        first: "John",
        last: "Doe",
        get fullName() { return this.first + " " + this.last; }
      };
      obj.fullName;
    `);
    assert.equal(getPayload(result), "John Doe");
  });
});

describe("Class getter/setter", () => {
  it("class getter", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Circle {
        constructor(r) { this.radius = r; }
        get diameter() { return this.radius * 2; }
      }
      var c = new Circle(5);
      c.diameter;
    `);
    assert.equal(getPayload(result), 10);
  });

  it("class setter", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Box {
        constructor() { this._w = 0; }
        set width(v) { this._w = v; }
        getWidth() { return this._w; }
      }
      var b = new Box();
      b.width = 100;
      b.getWidth();
    `);
    assert.equal(getPayload(result), 100);
  });

  it("class getter and setter together", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Counter {
        constructor() { this._count = 0; }
        get count() { return this._count; }
        set count(v) { this._count = v; }
      }
      var c = new Counter();
      c.count = 10;
      c.count;
    `);
    assert.equal(getPayload(result), 10);
  });

  it("inherited getter from parent class", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      class Animal {
        constructor(name) { this._name = name; }
        get name() { return this._name; }
      }
      class Dog extends Animal {
        constructor(name) { super(name); }
      }
      var d = new Dog("Rex");
      d.name;
    `);
    assert.equal(getPayload(result), "Rex");
  });
});

describe("Object.defineProperty", () => {
  it("defines a data property", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = {};
      Object.defineProperty(obj, "x", { value: 42, writable: true, enumerable: true, configurable: true });
      obj.x;
    `);
    assert.equal(getPayload(result), 42);
  });

  it("defines an accessor property", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = { _val: 10 };
      Object.defineProperty(obj, "val", {
        get: function() { return this._val; },
        set: function(v) { this._val = v; }
      });
      obj.val = 20;
      obj.val;
    `);
    assert.equal(getPayload(result), 20);
  });

  it("returns the object", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = {};
      var ret = Object.defineProperty(obj, "x", { value: 1 });
      ret === obj;
    `);
    assert.equal(getPayload(result), true);
  });
});

describe("Object.getOwnPropertyDescriptor", () => {
  it("returns descriptor for data property", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = { x: 42 };
      var desc = Object.getOwnPropertyDescriptor(obj, "x");
      desc.value;
    `);
    assert.equal(getPayload(result), 42);
  });

  it("returns undefined for non-existent property", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      var obj = {};
      Object.getOwnPropertyDescriptor(obj, "x");
    `);
    assert.equal(getPayload(result), undefined);
  });
});
