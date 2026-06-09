import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";
import { getPayload } from "../../src/core/value/index.js";

function jitEngine() {
  return new MiniJIT({
    tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
  });
}

describe("WASM: f64 widening for overflow-prone INT32 arithmetic", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("sum(1M) does not overflow with f64 widening", () => {
    const r = engine.runValue(`
      function sum(n) {
        var s = 0;
        for (var i = 0; i < n; i++) s = s + i;
        return s;
      }
      for (var j = 0; j < 10; j++) sum(100);
      sum(1000000);
    `);
    expect(r.value).toBe(499999500000);
  });

  it("large multiply does not overflow with f64 widening", () => {
    const r = engine.runValue(`
      function mulSum(n) {
        var s = 0;
        for (var i = 1; i <= n; i++) s = s + i * i;
        return s;
      }
      for (var j = 0; j < 10; j++) mulSum(10);
      mulSum(10000);
    `);
    expect(r.value).toBe(333383335000);
  });

  it("subtraction past negative i32 range stays correct", () => {
    const r = engine.runValue(`
      function subLoop(n) {
        var s = 0;
        for (var i = 0; i < n; i++) s = s - i;
        return s;
      }
      for (var j = 0; j < 10; j++) subLoop(100);
      subLoop(1000000);
    `);
    expect(r.value).toBe(-499999500000);
  });

  it("mixed add and multiply in loop", () => {
    const r = engine.runValue(`
      function mathLoop(n) {
        var s = 0;
        for (var i = 1; i < n; i++) {
          s = s + i * 2 - 1;
        }
        return s;
      }
      for (var j = 0; j < 10; j++) mathLoop(100);
      mathLoop(100000);
    `);
    expect(r.value).toBe(9999800001);
  });

  it("noOverflow path uses i32 for small ranges", () => {
    const r = engine.runValue(`
      function small(n) {
        var s = 0;
        for (var i = 0; i < n; i++) s = s + 1;
        return s;
      }
      for (var j = 0; j < 10; j++) small(10);
      small(100);
    `);
    expect(r.value).toBe(100);
  });
});

describe("WASM: self-recursive calls stay in WASM", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("fib(20) returns correct result", () => {
    const r = engine.runValue(`
      function fib(n) {
        if (n < 2) return n;
        return fib(n - 1) + fib(n - 2);
      }
      for (var j = 0; j < 10; j++) fib(5);
      fib(20);
    `);
    expect(r.value).toBe(6765);
  });

  it("fib(25) returns correct result", () => {
    const r = engine.runValue(`
      function fib(n) {
        if (n < 2) return n;
        return fib(n - 1) + fib(n - 2);
      }
      for (var j = 0; j < 10; j++) fib(5);
      fib(25);
    `);
    expect(r.value).toBe(75025);
  });

  it("fib does not deopt", () => {
    engine.runValue(`
      function fib(n) {
        if (n < 2) return n;
        return fib(n - 1) + fib(n - 2);
      }
      for (var j = 0; j < 10; j++) fib(5);
      fib(20);
    `);
    const fn = engine.collectFunctions().find((f) => f.name === "fib");
    expect(fn.deoptCount).toBe(0);
    expect(fn.optimizedCode).toBeTruthy();
  });

  it("recursive sum accumulator", () => {
    const r = engine.runValue(`
      function sumTo(n) {
        if (n <= 0) return 0;
        return n + sumTo(n - 1);
      }
      for (var j = 0; j < 10; j++) sumTo(5);
      sumTo(100);
    `);
    expect(r.value).toBe(5050);
  });

  it("recursive countdown returns base case", () => {
    const r = engine.runValue(`
      function countdown(n) {
        if (n <= 0) return 0;
        return countdown(n - 1);
      }
      for (var j = 0; j < 10; j++) countdown(5);
      countdown(50);
    `);
    expect(r.value).toBe(0);
  });

  it("recursive power function", () => {
    const r = engine.runValue(`
      function pow(base, exp) {
        if (exp <= 0) return 1;
        return base * pow(base, exp - 1);
      }
      for (var j = 0; j < 10; j++) pow(2, 5);
      pow(2, 10);
    `);
    expect(r.value).toBe(1024);
  });
});

describe("WASM: native GenericAdd/Sub/Mul for typed inputs", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("generic add of two self-recursive results is native", () => {
    const r = engine.runValue(`
      function fib(n) {
        if (n < 2) return n;
        return fib(n - 1) + fib(n - 2);
      }
      for (var j = 0; j < 10; j++) fib(5);
      fib(15);
    `);
    expect(r.value).toBe(610);
  });

  it("generic add does not regress for non-typed inputs", () => {
    const r = engine.runValue(`
      function add(a, b) { return a + b; }
      for (var i = 0; i < 10; i++) add(i, i);
      add(50, 70);
    `);
    expect(r.value).toBe(120);
  });

  it("generic add deopts correctly to string concat", () => {
    const r = engine.runValue(`
      function add(a, b) { return a + b; }
      for (var i = 0; i < 10; i++) add(i, i);
      add("hello", " world");
    `);
    expect(r.value).toBe("hello world");
  });
});

describe("WASM: orphan constant nodes from strength reduction", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("x * 2 strength-reduced to x << 1 works correctly", () => {
    const r = engine.runValue(`
      function double(x) { return x * 2; }
      function callIt(fn, v) { return fn(v); }
      for (var i = 0; i < 10; i++) callIt(double, i);
      callIt(double, 25);
    `);
    expect(r.value).toBe(50);
  });

  it("x * 4 strength-reduced to x << 2 works correctly", () => {
    const r = engine.runValue(`
      function quad(x) { return x * 4; }
      for (var i = 0; i < 10; i++) quad(i);
      quad(10);
    `);
    expect(r.value).toBe(40);
  });

  it("x * 8 strength-reduced to x << 3 works correctly", () => {
    const r = engine.runValue(`
      function oct(x) { return x * 8; }
      for (var i = 0; i < 10; i++) oct(i);
      oct(7);
    `);
    expect(r.value).toBe(56);
  });
});

describe("WASM: INT32 bitwise operations", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("bitwise AND", () => {
    const r = engine.runValue(`
      function band(a, b) { return a & b; }
      for (var i = 0; i < 10; i++) band(i, 7);
      band(0xFF, 0x0F);
    `);
    expect(r.value).toBe(0x0F);
  });

  it("bitwise OR", () => {
    const r = engine.runValue(`
      function bor(a, b) { return a | b; }
      for (var i = 0; i < 10; i++) bor(i, 0);
      bor(0xF0, 0x0F);
    `);
    expect(r.value).toBe(0xFF);
  });

  it("bitwise XOR", () => {
    const r = engine.runValue(`
      function bxor(a, b) { return a ^ b; }
      for (var i = 0; i < 10; i++) bxor(i, i);
      bxor(0xFF, 0x0F);
    `);
    expect(r.value).toBe(0xF0);
  });

  it("left shift", () => {
    const r = engine.runValue(`
      function shl(a, b) { return a << b; }
      for (var i = 0; i < 10; i++) shl(i, 1);
      shl(5, 3);
    `);
    expect(r.value).toBe(40);
  });

  it("right shift (signed)", () => {
    const r = engine.runValue(`
      function shr(a, b) { return a >> b; }
      for (var i = 0; i < 10; i++) shr(i, 1);
      shr(40, 3);
    `);
    expect(r.value).toBe(5);
  });

  it("unsigned right shift", () => {
    const r = engine.runValue(`
      function ushr(a, b) { return a >>> b; }
      for (var i = 0; i < 10; i++) ushr(i, 1);
      ushr(32, 2);
    `);
    expect(r.value).toBe(8);
  });

  it("bitwise NOT", () => {
    const r = engine.runValue(`
      function bnot(a) { return ~a; }
      for (var i = 0; i < 10; i++) bnot(i);
      bnot(0);
    `);
    expect(r.value).toBe(-1);
  });

  it("combined bitwise in loop", () => {
    const r = engine.runValue(`
      function bitLoop(n) {
        var s = 0;
        for (var i = 0; i < n; i++) {
          s = (s ^ i) & 0xFFFF;
        }
        return s;
      }
      for (var j = 0; j < 10; j++) bitLoop(10);
      bitLoop(1000);
    `);
    var expected = 0;
    for (var i = 0; i < 1000; i++) expected = (expected ^ i) & 0xFFFF;
    expect(r.value).toBe(expected);
  });
});

describe("WASM: global cell native access", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("loop with global accumulator", () => {
    const r = engine.runValue(`
      var total = 0;
      function addToTotal(x) {
        total = total + x;
        return total;
      }
      for (var i = 0; i < 10; i++) addToTotal(i);
      addToTotal(100);
    `);
    expect(r.value).toBe(145);
  });

  it("global counter in loop", () => {
    const r = engine.runValue(`
      var count = 0;
      function incCount() {
        count = count + 1;
        return count;
      }
      for (var i = 0; i < 10; i++) incCount();
      incCount();
    `);
    expect(r.value).toBe(11);
  });
});

describe("WASM: Math builtin intrinsics", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("Math.abs", () => {
    const r = engine.runValue(`
      function absVal(x) { return Math.abs(x); }
      for (var i = 0; i < 10; i++) absVal(-i);
      absVal(-42);
    `);
    expect(r.value).toBe(42);
  });

  it("Math.floor", () => {
    const r = engine.runValue(`
      function flr(x) { return Math.floor(x); }
      for (var i = 0; i < 10; i++) flr(i + 0.5);
      flr(3.7);
    `);
    expect(r.value).toBe(3);
  });

  it("Math.ceil", () => {
    const r = engine.runValue(`
      function cl(x) { return Math.ceil(x); }
      for (var i = 0; i < 10; i++) cl(i + 0.5);
      cl(3.2);
    `);
    expect(r.value).toBe(4);
  });

  it("Math.sqrt", () => {
    const r = engine.runValue(`
      function sq(x) { return Math.sqrt(x); }
      for (var i = 1; i < 10; i++) sq(i);
      sq(144);
    `);
    expect(r.value).toBe(12);
  });

  it("Math.min", () => {
    const r = engine.runValue(`
      function mn(a, b) { return Math.min(a, b); }
      for (var i = 0; i < 10; i++) mn(i, 5);
      mn(3, 7);
    `);
    expect(r.value).toBe(3);
  });

  it("Math.max", () => {
    const r = engine.runValue(`
      function mx(a, b) { return Math.max(a, b); }
      for (var i = 0; i < 10; i++) mx(i, 5);
      mx(3, 7);
    `);
    expect(r.value).toBe(7);
  });

  it("Math.trunc", () => {
    const r = engine.runValue(`
      function tr(x) { return Math.trunc(x); }
      for (var i = 0; i < 10; i++) tr(i + 0.9);
      tr(5.9);
    `);
    expect(r.value).toBe(5);
  });

  it("Math.round", () => {
    const r = engine.runValue(`
      function rnd(x) { return Math.round(x); }
      for (var i = 0; i < 10; i++) rnd(i + 0.3);
      rnd(5.7);
    `);
    expect(r.value).toBe(6);
  });

  it("chained Math intrinsics in loop", () => {
    const r = engine.runValue(`
      function mathChain(n) {
        var s = 0;
        for (var i = 1; i <= n; i++) {
          s = s + Math.floor(Math.sqrt(i));
        }
        return s;
      }
      for (var j = 0; j < 10; j++) mathChain(10);
      mathChain(100);
    `);
    var expected = 0;
    for (var i = 1; i <= 100; i++) expected += Math.floor(Math.sqrt(i));
    expect(r.value).toBe(expected);
  });
});

describe("WASM: entry guard deopt for interior block guards", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("typeof narrowing true branch computes correctly", () => {
    const r = engine.runValue(`
      function check(x) {
        if (typeof x === "number") {
          return x * 2;
        }
        return -1;
      }
      for (var i = 0; i < 10; i++) check(i);
      check(5);
    `);
    expect(r.value).toBe(10);
  });

  it("typeof narrowing false branch returns non-number path", () => {
    const r = engine.runValue(`
      function check(x) {
        if (typeof x === "number") {
          return x * 2;
        }
        return -1;
      }
      for (var i = 0; i < 10; i++) check(i);
      check("hello");
    `);
    expect(r.value).toBe(-1);
  });

  it("guard from interior block deopts to correct bytecode position", () => {
    const r = engine.runValue(`
      function process(x) {
        if (x > 0) {
          return x + 10;
        }
        return x - 10;
      }
      for (var i = 0; i < 10; i++) process(i);
      process(-5);
    `);
    expect(r.value).toBe(-15);
  });
});

describe("WASM: INT32 compare with f64 inputs", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("compare loop accumulator (f64 widened) against constant", () => {
    const r = engine.runValue(`
      function sumUntil(limit) {
        var s = 0;
        var i = 0;
        while (s < limit) {
          s = s + i;
          i = i + 1;
        }
        return i;
      }
      for (var j = 0; j < 10; j++) sumUntil(10);
      sumUntil(100);
    `);
    expect(r.value).toBeGreaterThan(0);
    var s = 0, i = 0;
    while (s < 100) { s += i; i++; }
    expect(r.value).toBe(i);
  });

  it("compare two f64-widened values", () => {
    const r = engine.runValue(`
      function maxSum(a, b) {
        var sa = 0;
        for (var i = 0; i < a; i++) sa = sa + i;
        var sb = 0;
        for (var j = 0; j < b; j++) sb = sb + j;
        if (sa > sb) return sa;
        return sb;
      }
      for (var k = 0; k < 10; k++) maxSum(5, 3);
      maxSum(100, 50);
    `);
    expect(r.value).toBe(4950);
  });
});

describe("WASM: combined features in complex functions", () => {
  let engine;
  beforeEach(() => { engine = jitEngine(); });

  it("collatz sequence length", () => {
    const r = engine.runValue(`
      function collatz(n) {
        var steps = 0;
        while (n > 1) {
          if (n & 1) {
            n = n * 3 + 1;
          } else {
            n = n >> 1;
          }
          steps = steps + 1;
        }
        return steps;
      }
      for (var i = 1; i < 10; i++) collatz(i);
      collatz(27);
    `);
    expect(r.value).toBe(111);
  });

  it("GCD via recursion", () => {
    const r = engine.runValue(`
      function gcd(a, b) {
        if (b === 0) return a;
        return gcd(b, a - (Math.floor(a / b) * b));
      }
      for (var i = 0; i < 10; i++) gcd(12, 8);
      gcd(48, 18);
    `);
    expect(r.value).toBe(6);
  });

  it("loop with bitwise, arithmetic, and comparison", () => {
    const r = engine.runValue(`
      function mixedLoop(n) {
        var s = 0;
        for (var i = 0; i < n; i++) {
          s = s + (i & 0xFF) + (i >> 2);
        }
        return s;
      }
      for (var j = 0; j < 10; j++) mixedLoop(10);
      mixedLoop(500);
    `);
    var expected = 0;
    for (var i = 0; i < 500; i++) expected += (i & 0xFF) + (i >> 2);
    expect(r.value).toBe(expected);
  });

  it("recursive fib does not produce boundary crossings for add", () => {
    engine.runValue(`
      function fib(n) {
        if (n < 2) return n;
        return fib(n - 1) + fib(n - 2);
      }
      for (var j = 0; j < 10; j++) fib(5);
      fib(20);
    `);
    const fn = engine.collectFunctions().find((f) => f.name === "fib");
    expect(fn.deoptCount).toBe(0);
    expect(fn.optimizedCode).toBeTruthy();
    const stubs = fn.optimizedStubSummary || [];
    const addStub = stubs.find((s) => s.opcode === "GenericAdd");
    expect(addStub).toBeUndefined();
  });
});
