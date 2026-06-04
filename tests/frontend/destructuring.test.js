import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";

describe("Object destructuring", () => {
  it("basic object destructuring with let", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let obj = { x: 10, y: 20 };
      let { x, y } = obj;
      x + y;
    `);
    assert.equal(result.value, 30);
  });

  it("object destructuring with const", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let obj = { a: 1, b: 2 };
      const { a, b } = obj;
      a + b;
    `);
    assert.equal(result.value, 3);
  });

  it("object destructuring with alias", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let obj = { name: "hello" };
      let { name: greeting } = obj;
      greeting;
    `);
    assert.equal(result.value, "hello");
  });

  it("object destructuring with var", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let obj = { x: 42 };
      var { x } = obj;
      x;
    `);
    assert.equal(result.value, 42);
  });

  it("const destructured values cannot be reassigned", () => {
    const jit = new MiniJIT();
    assert.throws(
      () =>
        jit.run(`
      let obj = { x: 1 };
      const { x } = obj;
      x = 2;
    `),
      /Assignment to constant variable/,
    );
  });

  it("destructuring from function return value", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function getPoint() { return { x: 3, y: 4 }; }
      let { x, y } = getPoint();
      x * x + y * y;
    `);
    assert.equal(result.value, 25);
  });
});

describe("Array destructuring", () => {
  it("basic array destructuring with let", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let arr = [10, 20, 30];
      let [a, b, c] = arr;
      a + b + c;
    `);
    assert.equal(result.value, 60);
  });

  it("array destructuring with const", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      const [x, y] = [1, 2];
      x + y;
    `);
    assert.equal(result.value, 3);
  });

  it("array destructuring with holes", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let [, second] = [10, 20, 30];
      second;
    `);
    assert.equal(result.value, 20);
  });

  it("array destructuring fewer elements", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let [first] = [10, 20, 30];
      first;
    `);
    assert.equal(result.value, 10);
  });

  it("array destructuring from string split", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      let [first, second] = "hello world".split(" ");
      first;
    `);
    assert.equal(result.value, "hello");
  });
});
