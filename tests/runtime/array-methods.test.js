import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("Array.prototype methods", () => {
  it("push adds elements and returns new length", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2];
      let len = arr.push(3);
      len;
    `);
    assert.equal(getPayload(result), 3);
  });

  it("pop removes and returns last element", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3];
      arr.pop();
    `);
    assert.equal(getPayload(result), 3);
  });

  it("shift removes and returns first element", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [10, 20, 30];
      arr.shift();
    `);
    assert.equal(getPayload(result), 10);
  });

  it("unshift adds to front and returns new length", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [2, 3];
      arr.unshift(1);
    `);
    assert.equal(getPayload(result), 3);
  });

  it("indexOf finds element index", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [10, 20, 30];
      arr.indexOf(20);
    `);
    assert.equal(getPayload(result), 1);
  });

  it("indexOf returns -1 for missing element", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [10, 20, 30];
      arr.indexOf(99);
    `);
    assert.equal(getPayload(result), -1);
  });

  it("includes returns boolean", () => {
    const jit = new MiniJIT();
    const r1 = jit.run("let arr = [1, 2, 3]; arr.includes(2);");
    assert.equal(getPayload(r1), true);
    jit.reset();
    const r2 = jit.run("let arr = [1, 2, 3]; arr.includes(99);");
    assert.equal(getPayload(r2), false);
  });

  it("join creates string from array", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3];
      arr.join("-");
    `);
    assert.equal(getPayload(result), "1-2-3");
  });

  it("reverse mutates and returns array", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3];
      arr.reverse();
      arr[0];
    `);
    assert.equal(getPayload(result), 3);
  });

  it("slice returns sub-array", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [10, 20, 30, 40];
      let s = arr.slice(1, 3);
      s.length;
    `);
    assert.equal(getPayload(result), 2);
  });

  it("concat merges arrays", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let a = [1, 2];
      let b = [3, 4];
      let c = a.concat(b);
      c.length;
    `);
    assert.equal(getPayload(result), 4);
  });
});

describe("Array callback methods", () => {
  it("forEach iterates all elements", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3];
      let sum = 0;
      function adder(x) { sum = sum + x; }
      arr.forEach(adder);
      sum;
    `);
    assert.equal(getPayload(result), 6);
  });

  it("map transforms elements", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3];
      function double(x) { return x * 2; }
      let mapped = arr.map(double);
      mapped[0] + mapped[1] + mapped[2];
    `);
    assert.equal(getPayload(result), 12);
  });

  it("filter selects elements", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3, 4, 5];
      function isEven(x) { return x % 2 === 0; }
      let evens = arr.filter(isEven);
      evens.length;
    `);
    assert.equal(getPayload(result), 2);
  });

  it("reduce accumulates a value", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3, 4];
      function add(a, b) { return a + b; }
      arr.reduce(add, 0);
    `);
    assert.equal(getPayload(result), 10);
  });

  it("reduce without initial value", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3];
      function add(a, b) { return a + b; }
      arr.reduce(add);
    `);
    assert.equal(getPayload(result), 6);
  });

  it("find returns first matching element", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3, 4];
      function isThree(x) { return x === 3; }
      arr.find(isThree);
    `);
    assert.equal(getPayload(result), 3);
  });

  it("findIndex returns first matching index", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [10, 20, 30];
      function isTwenty(x) { return x === 20; }
      arr.findIndex(isTwenty);
    `);
    assert.equal(getPayload(result), 1);
  });

  it("sort with comparator", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [3, 1, 2];
      function cmp(a, b) { return a - b; }
      arr.sort(cmp);
      arr[0];
    `);
    assert.equal(getPayload(result), 1);
  });

  it("method chaining: filter then map", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let arr = [1, 2, 3, 4, 5, 6];
      function isOdd(x) { return x % 2 !== 0; }
      function triple(x) { return x * 3; }
      let r = arr.filter(isOdd).map(triple);
      r[0] + r[1] + r[2];
    `);
    assert.equal(getPayload(result), 27);
  });
});
