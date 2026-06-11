import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: for-of loops", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("iterates over array elements", () => {
    const r = engine.runValue(`
      var sum = 0;
      for (var v of [10, 20, 30]) sum += v;
      sum;
    `);
    expect(r.value).toBe(60);
  });

  it("iterates over string characters", () => {
    const r = engine.runValue(`
      var s = "";
      for (var c of "hello") s += c + ".";
      s;
    `);
    expect(r.value).toBe("h.e.l.l.o.");
  });

  it("for-of with break", () => {
    const r = engine.runValue(`
      var sum = 0;
      for (var v of [1, 2, 3, 4, 5]) {
        if (v > 3) break;
        sum += v;
      }
      sum;
    `);
    expect(r.value).toBe(6);
  });

  it("for-of with continue", () => {
    const r = engine.runValue(`
      var sum = 0;
      for (var v of [1, 2, 3, 4, 5]) {
        if (v % 2 === 0) continue;
        sum += v;
      }
      sum;
    `);
    expect(r.value).toBe(9);
  });

  it("for-of with empty array", () => {
    const r = engine.runValue(`
      var count = 0;
      for (var v of []) count++;
      count;
    `);
    expect(r.value).toBe(0);
  });

  it("for-of collects into new array", () => {
    const r = engine.runValue(`
      var result = [];
      for (var v of [1, 2, 3]) result.push(v * 10);
      result.join(",");
    `);
    expect(r.value).toBe("10,20,30");
  });

  it("for-of with index tracking", () => {
    const r = engine.runValue(`
      var items = ["a", "b", "c"];
      var result = "";
      var idx = 0;
      for (var v of items) {
        result += idx + ":" + v + " ";
        idx++;
      }
      result;
    `);
    expect(r.value).toBe("0:a 1:b 2:c ");
  });

  it("nested for-of loops keep independent iterators", () => {
    const r = engine.runValue(`
      let s = "";
      for (const i of [0, 1]) {
        for (const j of [0, 1]) s = s + i + j + " ";
      }
      s;
    `);
    expect(r.value).toBe("00 01 10 11 ");
  });

  it("a for-of nested inside a for loop restarts each outer iteration", () => {
    const r = engine.runValue(`
      let s = "";
      for (let i = 0; i < 2; i++) {
        for (const j of [1, 2, 3]) s = s + j;
        s = s + "|";
      }
      s;
    `);
    expect(r.value).toBe("123|123|");
  });

  it("an inner for-of shadows an outer loop variable of the same name", () => {
    const r = engine.runValue(`
      let s = "";
      for (let i = 0; i < 3; i++) {
        for (const i of [0, 1, 2]) s = s + i;
        s = s + "|";
      }
      s;
    `);
    expect(r.value).toBe("012|012|012|");
  });
});

describe("E2E: for-in loops", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("iterates over object keys", () => {
    const r = engine.runValue(`
      var keys = "";
      for (var k in {a: 1, b: 2, c: 3}) keys += k;
      keys;
    `);
    expect(r.value).toBe("abc");
  });

  it("accesses values through keys", () => {
    const r = engine.runValue(`
      var o = {x: 10, y: 20};
      var sum = 0;
      for (var k in o) sum += o[k];
      sum;
    `);
    expect(r.value).toBe(30);
  });

  it("for-in with empty object", () => {
    const r = engine.runValue(`
      var count = 0;
      for (var k in {}) count++;
      count;
    `);
    expect(r.value).toBe(0);
  });

  it("for-in collects into string", () => {
    const r = engine.runValue(`
      var o = {first: 1, second: 2, third: 3};
      var result = "";
      for (var k in o) result += k + "=" + o[k] + " ";
      result;
    `);
    expect(r.value).toBe("first=1 second=2 third=3 ");
  });

  it("for-in with property check", () => {
    const r = engine.runValue(`
      var o = {name: "Alice", age: 30, city: "NYC"};
      var count = 0;
      for (var k in o) count++;
      count;
    `);
    expect(r.value).toBe(3);
  });
});
