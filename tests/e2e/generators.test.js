import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: generators", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("yields values one at a time", () => {
    const r = engine.runValue(`
      function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }
      var g = gen();
      var a = g.next().value;
      var b = g.next().value;
      var c = g.next().value;
      a * 100 + b * 10 + c;
    `);
    expect(r.value).toBe(123);
  });

  it("done is true after final yield", () => {
    const r = engine.runValue(`
      function* gen() { yield 1; }
      var g = gen();
      g.next();
      g.next().done;
    `);
    expect(r.value).toBe(true);
  });

  it("return value appears as final value", () => {
    const r = engine.runValue(`
      function* gen() {
        yield 10;
        return 99;
      }
      var g = gen();
      g.next();
      g.next().value;
    `);
    expect(r.value).toBe(99);
  });

  it("generator as range iterator", () => {
    const r = engine.runValue(`
      function* range(start, end) {
        for (var i = start; i < end; i++) yield i;
      }
      var sum = 0;
      var g = range(1, 6);
      var n = g.next();
      while (!n.done) {
        sum += n.value;
        n = g.next();
      }
      sum;
    `);
    expect(r.value).toBe(15);
  });

  it("generator with conditional yield", () => {
    const r = engine.runValue(`
      function* evens(max) {
        for (var i = 0; i <= max; i++) {
          if (i % 2 === 0) yield i;
        }
      }
      var result = "";
      var g = evens(8);
      var n = g.next();
      while (!n.done) {
        if (result.length > 0) result += ",";
        result += n.value;
        n = g.next();
      }
      result;
    `);
    expect(r.value).toBe("0,2,4,6,8");
  });

  it("multiple independent generator instances", () => {
    const r = engine.runValue(`
      function* counter() {
        var i = 0;
        while (true) {
          yield i;
          i++;
        }
      }
      var a = counter();
      var b = counter();
      a.next(); a.next(); a.next();
      b.next();
      a.next().value * 10 + b.next().value;
    `);
    expect(r.value).toBe(31);
  });

  it("generator that produces fibonacci sequence", () => {
    const r = engine.runValue(`
      function* fib() {
        var a = 0;
        var b = 1;
        while (true) {
          yield a;
          var tmp = a + b;
          a = b;
          b = tmp;
        }
      }
      var g = fib();
      var result = "";
      for (var i = 0; i < 8; i++) {
        if (i > 0) result += ",";
        result += g.next().value;
      }
      result;
    `);
    expect(r.value).toBe("0,1,1,2,3,5,8,13");
  });
});
