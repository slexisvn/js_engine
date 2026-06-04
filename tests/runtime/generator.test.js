import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";

describe("Generators", () => {
  it("basic generator with yield", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        yield 1;
        yield 2;
        yield 3;
      }
      let gen = g();
      let a = gen.next();
      let b = gen.next();
      let c = gen.next();
      let d = gen.next();
      a.value * 100 + b.value * 10 + c.value;
    `);
    assert.equal(result.value, 123);
  });

  it("generator done flag", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        yield 1;
      }
      let gen = g();
      let first = gen.next();
      let second = gen.next();
      let r = "";
      if (first.done === false) { r = r + "a"; }
      if (second.done === true) { r = r + "b"; }
      r;
    `);
    assert.equal(result.value, "ab");
  });

  it("generator with return value", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        yield 1;
        return 42;
      }
      let gen = g();
      gen.next();
      let final = gen.next();
      final.value;
    `);
    assert.equal(result.value, 42);
  });

  it("generator receives value from next()", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        let x = yield 1;
        let y = yield 2;
        return x + y;
      }
      let gen = g();
      gen.next();
      gen.next(10);
      let final = gen.next(20);
      final.value;
    `);
    assert.equal(result.value, 30);
  });

  it("generator with for-of loop", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* range(start, end) {
        let i = start;
        while (i < end) {
          yield i;
          i = i + 1;
        }
      }
      let sum = 0;
      for (let n of range(1, 5)) {
        sum = sum + n;
      }
      sum;
    `);
    assert.equal(result.value, 10);
  });

  it("infinite generator with early exit", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* naturals() {
        let n = 0;
        while (true) {
          yield n;
          n = n + 1;
        }
      }
      let gen = naturals();
      let sum = 0;
      let i = 0;
      while (i < 5) {
        sum = sum + gen.next().value;
        i = i + 1;
      }
      sum;
    `);
    assert.equal(result.value, 10);
  });

  it("generator.return() completes the generator", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        yield 1;
        yield 2;
        yield 3;
      }
      let gen = g();
      let a = gen.next();
      let b = gen.return(99);
      let c = gen.next();
      a.value * 100 + b.value * 10 + c.done;
    `);

    assert.equal(result.value, 1091);
  });

  it("generator.throw() propagates error", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        yield 1;
        yield 2;
      }
      let gen = g();
      gen.next();
      let caught = "";
      try {
        gen.throw("oops");
      } catch (e) {
        caught = e;
      }
      caught;
    `);
    assert.equal(result.value, "oops");
  });

  it("generator with try/catch catches thrown error", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        try {
          yield 1;
          yield 2;
        } catch (e) {
          yield "caught: " + e;
        }
      }
      let gen = g();
      gen.next();
      let r = gen.throw("boom");
      r.value;
    `);
    assert.equal(result.value, "caught: boom");
  });

  it("generator yield without argument", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* g() {
        yield;
        yield;
      }
      let gen = g();
      let a = gen.next();
      a.done === false;
    `);
    assert.equal(result.value, true);
  });

  it("fibonacci generator", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* fibonacci() {
        let a = 0;
        let b = 1;
        while (true) {
          yield a;
          let temp = a + b;
          a = b;
          b = temp;
        }
      }
      let gen = fibonacci();
      let r = "";
      let i = 0;
      while (i < 8) {
        if (i > 0) { r = r + ","; }
        r = r + gen.next().value;
        i = i + 1;
      }
      r;
    `);
    assert.equal(result.value, "0,1,1,2,3,5,8,13");
  });

  it("multiple generators are independent", () => {
    const jit = new MiniJIT();
    const result = jit.runValue(`
      function* counter(start) {
        let n = start;
        while (true) {
          yield n;
          n = n + 1;
        }
      }
      let a = counter(0);
      let b = counter(100);
      let r1 = a.next().value;
      let r2 = b.next().value;
      let r3 = a.next().value;
      let r4 = b.next().value;
      r1 * 1000 + r2 * 100 + r3 * 10 + (r4 - 100);
    `);

    assert.equal(result.value, 10011);
  });
});
