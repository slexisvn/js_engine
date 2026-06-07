import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";
import { getPayload, getTag } from "../../src/core/value/index.js";

function asyncResult(engine, source) {
  const r = engine.runValue(source);
  engine.drainMicrotasks();
  return {
    state: r.value.state,
    tag: getTag(r.value.result),
    value: getPayload(r.value.result),
  };
}

describe("E2E: async/await", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("async function returns fulfilled promise", () => {
    const r = engine.runValue("async function f() { return 42; } f();");
    engine.drainMicrotasks();
    expect(r.tag).toBe("promise");
    expect(r.value.state).toBe("fulfilled");
    expect(getPayload(r.value.result)).toBe(42);
  });

  it("await unwraps a resolved promise", () => {
    const r = asyncResult(
      engine,
      "async function f() { var v = await Promise.resolve(42); return v; } f();",
    );
    expect(r.value).toBe(42);
  });

  it("await on a non-promise returns the value directly", () => {
    const r = asyncResult(
      engine,
      "async function f() { var v = await 42; return v; } f();",
    );
    expect(r.value).toBe(42);
  });

  it("multiple sequential awaits", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        var a = await Promise.resolve(1);
        var b = await Promise.resolve(2);
        var c = await Promise.resolve(3);
        return a + b + c;
      }
      f();`,
    );
    expect(r.value).toBe(6);
  });

  it("await in conditional branches", () => {
    const r = asyncResult(
      engine,
      `async function f(flag) {
        if (flag) {
          return await Promise.resolve("yes");
        } else {
          return await Promise.resolve("no");
        }
      }
      f(true);`,
    );
    expect(r.value).toBe("yes");
  });

  it("try-catch around await handles rejection", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        try {
          await Promise.reject("error");
          return "should not reach";
        } catch(e) {
          return "caught:" + e;
        }
      }
      f();`,
    );
    expect(r.value).toBe("caught:error");
  });

  it("try-finally with await in try", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        var log = "";
        try {
          log += "try ";
          return await Promise.resolve(log + "done");
        } finally {
          log += "finally ";
        }
      }
      f();`,
    );
    expect(r.value).toBe("try done");
  });

  it("async function calling another async function", () => {
    const r = asyncResult(
      engine,
      `async function double(x) {
        return await Promise.resolve(x * 2);
      }
      async function main() {
        var a = await double(5);
        var b = await double(a);
        return b;
      }
      main();`,
    );
    expect(r.value).toBe(20);
  });

  it("async function with parameter", () => {
    const r = asyncResult(
      engine,
      `async function f(x) {
        var v = await Promise.resolve(x);
        return v + 1;
      }
      f(41);`,
    );
    expect(r.value).toBe(42);
  });

  it("async function with throw rejects the promise", () => {
    const r = engine.runValue('async function f() { throw "boom"; } f();');
    engine.drainMicrotasks();
    expect(r.value.state).toBe("rejected");
    expect(getPayload(r.value.result)).toBe("boom");
  });

  it("await in a while loop", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        var sum = 0;
        var i = 0;
        while (i < 5) {
          sum += await Promise.resolve(i);
          i++;
        }
        return sum;
      }
      f();`,
    );
    expect(r.value).toBe(10);
  });

  it("chained then on async function result", () => {
    const r = asyncResult(
      engine,
      `async function getVal() { return 10; }
      async function main() {
        return await getVal().then(function(v) { return v * 3; });
      }
      main();`,
    );
    expect(r.value).toBe(30);
  });
});
