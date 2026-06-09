import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";
import { getPayload } from "../../src/core/value/index.js";

describe("E2E: JIT tiering", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("function starts unoptimized", () => {
    engine.run("function f(x) { return x + 1; } f(1);");
    const fn = engine.collectFunctions().find((f) => f.name === "f");
    expect(fn).toBeDefined();
    expect(fn.invocationCount).toBe(1);
    expect(fn.optimizedCode).toBeFalsy();
  });

  it("function gets baseline compiled after threshold", () => {
    engine.run("function f(x) { return x + 1; } for (var i = 0; i < 3; i++) f(i);");
    const fn = engine.collectFunctions().find((f) => f.name === "f");
    expect(fn.baselineCode).toBeTruthy();
  });

  it("function gets JIT optimized after jitThreshold", () => {
    engine.run("function f(a, b) { return a + b; } for (var i = 0; i < 10; i++) f(i, i);");
    const fn = engine.collectFunctions().find((f) => f.name === "f");
    expect(fn.optimizedCode).toBeTruthy();
  });

  it("optimized function produces correct results", () => {
    const r = engine.run(`
      function add(a, b) { return a + b; }
      for (var i = 0; i < 10; i++) add(i, i);
      add(100, 200);
    `);
    expect(getPayload(r)).toBe(300);
  });

  it("optimized arithmetic is correct for various inputs", () => {
    const r = engine.run(`
      function compute(x) { return x * x + x - 1; }
      for (var i = 0; i < 10; i++) compute(i);
      compute(7);
    `);
    expect(getPayload(r)).toBe(55);
  });

  it("optimized function with multiple params", () => {
    const r = engine.run(`
      function poly(a, b, c) { return a * a + b * 2 + c; }
      for (var i = 0; i < 10; i++) poly(i, i, i);
      poly(3, 4, 5);
    `);
    expect(getPayload(r)).toBe(22);
  });

  it("compilations count reflects JIT activity", () => {
    engine.run("function f(x) { return x; } for (var i = 0; i < 10; i++) f(i);");
    expect(engine.getStats().compilations).toBeGreaterThanOrEqual(1);
  });
});

describe("E2E: speculation and type feedback", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("integer-specialized function handles integer inputs correctly", () => {
    const r = engine.run(`
      function add(a, b) { return a + b; }
      for (var i = 0; i < 10; i++) add(i, i + 1);
      add(50, 70);
    `);
    expect(getPayload(r)).toBe(120);
  });

  it("property access specialized on object shape", () => {
    const r = engine.run(`
      function getX(o) { return o.x; }
      var obj = {x: 42, y: 10};
      for (var i = 0; i < 10; i++) getX(obj);
      getX(obj);
    `);
    expect(getPayload(r)).toBe(42);
    const fn = engine.collectFunctions().find((f) => f.name === "getX");
    expect(fn.optimizedCode).toBeTruthy();
  });

  it("call target specialization on same function", () => {
    const r = engine.run(`
      function double(x) { return x * 2; }
      function callIt(fn, v) { return fn(v); }
      for (var i = 0; i < 10; i++) callIt(double, i);
      callIt(double, 25);
    `);
    expect(getPayload(r)).toBe(50);
  });

  it("loop with consistent types gets optimized", () => {
    const r = engine.run(`
      function sum(n) {
        var s = 0;
        for (var i = 0; i < n; i++) s += i;
        return s;
      }
      for (var i = 0; i < 10; i++) sum(10);
      sum(100);
    `);
    expect(getPayload(r)).toBe(4950);
  });
});

describe("E2E: deoptimization on type change", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("deoptimizes on smi→string and produces correct result", () => {
    engine.run("function add(a, b) { return a + b; } for (var i = 0; i < 10; i++) add(i, i);");
    const fn = engine.collectFunctions().find((f) => f.name === "add");
    expect(fn.optimizedCode).toBeTruthy();

    const r = engine.run('add("hello", " world");');
    expect(getPayload(r)).toBe("hello world");

    const fnAfter = engine.collectFunctions().find((f) => f.name === "add");
    expect(fnAfter.lastDeoptReason).toBe("smi-check-failed");
  });

  it("deoptimizes on number overflow and still computes correctly", () => {
    engine.run("function mul(a, b) { return a * b; } for (var i = 0; i < 10; i++) mul(i, 2);");
    const fn = engine.collectFunctions().find((f) => f.name === "mul");
    expect(fn.optimizedCode).toBeTruthy();

    const r = engine.run("mul(999999999, 999999999);");
    expect(getPayload(r)).toBe(999999998000000001);
  });

  it("deoptimizes on object shape change and returns correct value", () => {
    engine.run(`
      function getX(o) { return o.x; }
      var obj = {x: 1};
      for (var i = 0; i < 10; i++) getX(obj);
    `);
    const fn = engine.collectFunctions().find((f) => f.name === "getX");
    expect(fn.optimizedCode).toBeTruthy();

    const r = engine.run("getX({x: 99, y: 200, z: 300});");
    expect(getPayload(r)).toBe(99);

    const fnAfter = engine.collectFunctions().find((f) => f.name === "getX");
    expect(fnAfter.lastDeoptReason).toBe("map-check-failed");
  });

  it("deopt preserves correct computation in complex expression", () => {
    engine.run(`
      function calc(a, b) { return (a + b) * (a - b); }
      for (var i = 1; i < 10; i++) calc(i, 1);
    `);

    const r = engine.run("calc(10, 3);");
    expect(getPayload(r)).toBe(91);
  });

  it("function works correctly after deopt fallback to interpreter", () => {
    engine.run("function inc(x) { return x + 1; } for (var i = 0; i < 10; i++) inc(i);");

    engine.run('inc("hello");');

    const r1 = engine.run("inc(41);");
    expect(getPayload(r1)).toBe(42);

    const r2 = engine.run('inc("world");');
    expect(getPayload(r2)).toBe("world1");
  });
});

describe("E2E: deoptimization with property access patterns", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("monomorphic property access deopts on polymorphic shapes", () => {
    engine.run(`
      function getVal(o) { return o.val; }
      var a = {val: 1};
      for (var i = 0; i < 10; i++) getVal(a);
    `);

    const r = engine.run("getVal({val: 42, extra: true});");
    expect(getPayload(r)).toBe(42);
  });

  it("optimized property access deopts on added properties", () => {
    engine.run(`
      function getAB(o) { return o.a + o.b; }
      var obj = {a: 1, b: 2};
      for (var i = 0; i < 10; i++) getAB(obj);
    `);

    const r = engine.run("getAB({a: 50, b: 50, c: 999});");
    expect(getPayload(r)).toBe(100);
  });

  it("nested property access with deopt returns correct value", () => {
    engine.run(`
      function getDeep(o) { return o.a + o.b; }
      var obj = {a: 10, b: 20};
      for (var i = 0; i < 10; i++) getDeep(obj);
    `);

    const r = engine.run("getDeep({a: 100, b: 200, c: 300});");
    expect(getPayload(r)).toBe(300);
  });
});

describe("E2E: force optimization via API", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 100, baselineThreshold: 50 },
    });
  });

  it("optimizeFunction installs optimized code", () => {
    engine.run("function f(x) { return x + 1; } for (var i = 0; i < 5; i++) f(i);");
    const fn = engine.collectFunctions().find((f) => f.name === "f");
    expect(fn.optimizedCode).toBeFalsy();

    engine.optimizeFunction(fn);
    expect(fn.optimizedCode).toBeTruthy();
  });

  it("force-optimized function produces correct results", () => {
    engine.run("function sq(x) { return x * x; } for (var i = 0; i < 5; i++) sq(i);");
    const fn = engine.collectFunctions().find((f) => f.name === "sq");
    engine.optimizeFunction(fn);

    const r = engine.run("sq(12);");
    expect(getPayload(r)).toBe(144);
  });

  it("force-optimized function deopts correctly on type mismatch", () => {
    engine.run("function sum(a, b) { return a + b; } for (var i = 0; i < 5; i++) sum(i, i);");
    const fn = engine.collectFunctions().find((f) => f.name === "sum");
    engine.optimizeFunction(fn);
    expect(fn.optimizedCode).toBeTruthy();

    engine.run('sum("x", "y");');
    expect(fn.lastDeoptReason).toBeTruthy();
  });

  it("baselineCompile installs baseline code", () => {
    engine.run("function g(x) { return x - 1; } g(5);");
    const fn = engine.collectFunctions().find((f) => f.name === "g");
    expect(fn.baselineCode).toBeFalsy();

    engine.baselineCompile(fn);
    expect(fn.baselineCode).toBeTruthy();
  });

  it("async functions are skipped for optimization", () => {
    engine.run("async function af() { return 1; } af();");
    engine.drainMicrotasks();
    const fn = engine.collectFunctions().find((f) => f.name === "af");
    if (fn) {
      engine.optimizeFunction(fn);
      expect(fn.optimizedCode).toBeFalsy();
    }
  });
});

describe("E2E: deopt with arithmetic edge cases", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("integer-trained function handles floating-point correctly after deopt", () => {
    engine.run("function add(a, b) { return a + b; } for (var i = 0; i < 10; i++) add(i, 1);");
    const r = engine.run("add(1.5, 2.7);");
    expect(getPayload(r)).toBeCloseTo(4.2);
  });

  it("multiplication deopt with large numbers gives correct result", () => {
    engine.run("function mul(a, b) { return a * b; } for (var i = 1; i < 10; i++) mul(i, i);");
    const r = engine.run("mul(100000, 100000);");
    expect(getPayload(r)).toBe(10000000000);
  });

  it("subtraction deopt with negative result", () => {
    engine.run("function sub(a, b) { return a - b; } for (var i = 0; i < 10; i++) sub(i + 10, i);");
    const r = engine.run("sub(5, 100);");
    expect(getPayload(r)).toBe(-95);
  });

  it("division gives correct integer result after optimization", () => {
    engine.run("function div(a, b) { return a / b; } for (var i = 1; i < 10; i++) div(i * 2, 2);");
    const r = engine.run("div(100, 5);");
    expect(getPayload(r)).toBe(20);
  });

  it("modulo with deopt", () => {
    engine.run("function mod(a, b) { return a % b; } for (var i = 0; i < 10; i++) mod(i * 7, 5);");
    const r = engine.run("mod(17, 3);");
    expect(getPayload(r)).toBe(2);
  });
});

describe("E2E: JIT correctness with control flow", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("optimized function with if/else", () => {
    const r = engine.run(`
      function abs(x) { if (x < 0) return -x; return x; }
      for (var i = -5; i < 5; i++) abs(i);
      abs(-42);
    `);
    expect(getPayload(r)).toBe(42);
  });

  it("optimized function with nested loops", () => {
    const r = engine.run(`
      function matSum(n) {
        var s = 0;
        for (var i = 0; i < n; i++)
          for (var j = 0; j < n; j++)
            s += 1;
        return s;
      }
      for (var k = 0; k < 10; k++) matSum(3);
      matSum(5);
    `);
    expect(getPayload(r)).toBe(25);
  });

  it("optimized recursive function", () => {
    const r = engine.run(`
      function fib(n) {
        if (n <= 1) return n;
        return fib(n - 1) + fib(n - 2);
      }
      for (var i = 0; i < 10; i++) fib(5);
      fib(10);
    `);
    expect(getPayload(r)).toBe(55);
  });

  it("optimized function with early return", () => {
    const r = engine.run(`
      function findFirst(arr, target) {
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] === target) return i;
        }
        return -1;
      }
      var a = [10, 20, 30, 40, 50];
      for (var i = 0; i < 10; i++) findFirst(a, 30);
      findFirst(a, 40);
    `);
    expect(getPayload(r)).toBe(3);
  });

  it("optimized function with ternary", () => {
    const r = engine.run(`
      function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
      for (var i = 0; i < 10; i++) clamp(i, 2, 7);
      clamp(100, 0, 50);
    `);
    expect(getPayload(r)).toBe(50);
  });
});

describe("E2E: deopt recovery correctness", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("computation after deopt matches interpreter semantics", () => {
    engine.run(`
      function process(x) { return x * 3 + 1; }
      for (var i = 0; i < 10; i++) process(i);
    `);

    const optimized = engine.run("process(10);");
    expect(getPayload(optimized)).toBe(31);

    engine.run('process("trigger deopt");');

    const afterDeopt = engine.run("process(10);");
    expect(getPayload(afterDeopt)).toBe(31);
  });

  it("state is preserved across deopt for accumulated values", () => {
    const r = engine.run(`
      function accum(arr) {
        var sum = 0;
        for (var i = 0; i < arr.length; i++) sum += arr[i];
        return sum;
      }
      for (var k = 0; k < 10; k++) accum([1, 2, 3]);
      accum([10, 20, 30, 40]);
    `);
    expect(getPayload(r)).toBe(100);
  });

  it("mixed type calls all produce correct results", () => {
    engine.run(`
      function identity(x) { return x; }
      for (var i = 0; i < 10; i++) identity(i);
    `);

    expect(getPayload(engine.run("identity(42);"))).toBe(42);
    expect(getPayload(engine.run('identity("hello");'))).toBe("hello");
    expect(getPayload(engine.run("identity(true);"))).toBe(true);
    expect(getPayload(engine.run("identity(3.14);"))).toBeCloseTo(3.14);
  });

  it("deopt in loop body resumes correctly", () => {
    const r = engine.run(`
      function sumArr(arr) {
        var s = 0;
        for (var i = 0; i < arr.length; i++) {
          s = s + arr[i];
        }
        return s;
      }
      for (var k = 0; k < 10; k++) sumArr([1, 2, 3]);
      sumArr([10, 20, 30, 40, 50]);
    `);
    expect(getPayload(r)).toBe(150);
  });
});

describe("E2E: JIT with closures and scoping", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("optimized closure captures variables correctly", () => {
    const r = engine.run(`
      function makeAdder(n) {
        return function(x) { return x + n; };
      }
      var add5 = makeAdder(5);
      for (var i = 0; i < 10; i++) add5(i);
      add5(37);
    `);
    expect(getPayload(r)).toBe(42);
  });

  it("optimized counter closure", () => {
    const r = engine.run(`
      function makeCounter() {
        var count = 0;
        return function() { count++; return count; };
      }
      var c = makeCounter();
      for (var i = 0; i < 20; i++) c();
      c();
    `);
    expect(getPayload(r)).toBe(21);
  });
});

describe("E2E: getStats deopt tracking", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
  });

  it("tracks deoptCount on the compiled function", () => {
    engine.run("function f(x) { return x + 1; } for (var i = 0; i < 10; i++) f(i);");
    const fn = engine.collectFunctions().find((f) => f.name === "f");
    expect(fn.deoptCount || 0).toBe(0);

    engine.run('f("str");');
    const fnAfter = engine.collectFunctions().find((f) => f.name === "f");
    expect(fnAfter.deoptCount).toBeGreaterThanOrEqual(1);
  });

  it("records deopt reason string", () => {
    engine.run("function g(a, b) { return a + b; } for (var i = 0; i < 10; i++) g(i, i);");
    engine.run('g("trigger", "deopt");');
    const fn = engine.collectFunctions().find((f) => f.name === "g");
    expect(fn.lastDeoptReason).toBeTruthy();
    expect(typeof fn.lastDeoptReason).toBe("string");
  });

  it("different deopt reasons for different failures", () => {
    engine.run("function h(o) { return o.x; } var a = {x: 1}; for (var i = 0; i < 10; i++) h(a);");
    engine.run("h({x: 2, y: 3});");
    const fn = engine.collectFunctions().find((f) => f.name === "h");
    expect(fn.lastDeoptReason).toBe("map-check-failed");
  });
});

describe("E2E: JIT global variable correctness", () => {
  it("global accumulator returns correct sum after JIT optimization", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    const r = engine.run(`
      var sum = 0;
      function addToSum(i) { sum = sum + i; }
      for (var i = 0; i < 100; i++) { addToSum(i); }
      sum;
    `);
    expect(getPayload(r)).toBe(4950);
  });

  it("global variable read/write consistency across JIT boundary", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    const r = engine.run(`
      var counter = 0;
      function inc() { counter = counter + 1; return counter; }
      var last = 0;
      for (var i = 0; i < 20; i++) { last = inc(); }
      last;
    `);
    expect(getPayload(r)).toBe(20);
  });

  it("global accumulator with function returning value", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    const r = engine.run(`
      var sum = 0;
      function a(i) { sum = sum + i; return i + 4; }
      for (var i = 0; i < 2000; i++) { a(i); }
      sum;
    `);
    expect(getPayload(r)).toBe(1999000);
  });

  it("multiple globals stay independent under JIT", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    const r = engine.run(`
      var x = 0;
      var y = 1;
      function step(i) { x = x + i; y = y * 2; }
      for (var i = 1; i <= 10; i++) { step(i); }
      x;
    `);
    expect(getPayload(r)).toBe(55);
  });
});

describe("E2E: JIT self-recursive functions", () => {
  it("recursive fib returns correct result under JIT", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    const r = engine.run(`
      function fib(n) { if (n <= 1) return n; return fib(n - 1) + fib(n - 2); }
      fib(20);
    `);
    expect(getPayload(r)).toBe(6765);
  });

  it("self-recursive function does not deopt repeatedly", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    engine.run(`
      function fib(n) { if (n <= 1) return n; return fib(n - 1) + fib(n - 2); }
      fib(20);
    `);
    const fn = engine.collectFunctions().find((f) => f.name === "fib");
    expect(fn.deoptCount).toBe(0);
    expect(fn.disableOptimization).toBeFalsy();
  });

  it("recursive sum accumulator under JIT", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    const r = engine.run(`
      function sumTo(n) { if (n <= 0) return 0; return n + sumTo(n - 1); }
      sumTo(100);
    `);
    expect(getPayload(r)).toBe(5050);
  });

  it("mutual recursion works under JIT", () => {
    const engine = new MiniJIT({
      tieringPolicy: { jitThreshold: 5, baselineThreshold: 2 },
    });
    const r = engine.run(`
      function isEven(n) { if (n === 0) return true; return isOdd(n - 1); }
      function isOdd(n) { if (n === 0) return false; return isEven(n - 1); }
      for (var i = 0; i < 20; i++) { isEven(i); }
      isEven(10) ? 1 : 0;
    `);
    expect(getPayload(r)).toBe(1);
  });
});
