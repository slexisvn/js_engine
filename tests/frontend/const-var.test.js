import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";

describe("const declaration", () => {
  it("basic const declaration and usage", () => {
    const jit = new MiniJIT();
    const result = jit.runValue("const x = 42; x;");
    assert.equal(result.value, 42);
  });

  it("const with expression initializer", () => {
    const jit = new MiniJIT();
    const result = jit.runValue("const x = 10 + 20; x;");
    assert.equal(result.value, 30);
  });

  it("const requires initializer", () => {
    const jit = new MiniJIT();
    assert.throws(() => jit.run("const x;"), /Missing initializer/);
  });

  it("const reassignment throws at compile time", () => {
    const jit = new MiniJIT();
    assert.throws(
      () => jit.run("const x = 1; x = 2;"),
      /Assignment to constant variable/,
    );
  });

  it("const in block scope", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      const a = 1;
      let b = 0;
      if (true) {
        const c = 10;
        b = c;
      }
      a + b;
    `);
    assert.equal(result.value, 11);
  });

  it("const in for loop init", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let sum = 0;
      for (const x = 5; sum < 10;) {
        sum = sum + x;
      }
      sum;
    `);
    assert.equal(result.value, 10);
  });

  it("const in for-of loop", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let sum = 0;
      let arr = [1, 2, 3];
      for (const x of arr) {
        sum = sum + x;
      }
      sum;
    `);
    assert.equal(result.value, 6);
  });
});

describe("var declaration", () => {
  it("basic var declaration and usage", () => {
    const jit = new MiniJIT();
    const result = jit.runValue("var x = 42; x;");
    assert.equal(result.value, 42);
  });

  it("var without initializer defaults to undefined", () => {
    const jit = new MiniJIT();
    const result = jit.runValue("var x; typeof x;");
    assert.equal(result.value, "undefined");
  });

  it("var function scoping — visible outside block", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function test() {
        if (true) {
          var x = 42;
        }
        return x;
      }
      test();
    `);
    assert.equal(result.value, 42);
  });

  it("var redeclaration reuses slot", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      var x = 1;
      var x = 2;
      x;
    `);
    assert.equal(result.value, 2);
  });

  it("var can be reassigned", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      var x = 1;
      x = 42;
      x;
    `);
    assert.equal(result.value, 42);
  });

  it("var in for loop", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let sum = 0;
      for (var i = 0; i < 5; i = i + 1) {
        sum = sum + i;
      }
      sum;
    `);
    assert.equal(result.value, 10);
  });

  it("var in for-in loop", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let obj = { a: 1, b: 2 };
      let count = 0;
      for (var k in obj) {
        count = count + 1;
      }
      count;
    `);
    assert.equal(result.value, 2);
  });
});

describe("const and var mixed with let", () => {
  it("const, let, and var coexist", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      const a = 10;
      let b = 20;
      var c = 30;
      a + b + c;
    `);
    assert.equal(result.value, 60);
  });

  it("const inside function", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function add(x, y) {
        const sum = x + y;
        return sum;
      }
      add(3, 4);
    `);
    assert.equal(result.value, 7);
  });
});
