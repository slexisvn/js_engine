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

describe("E2E: promises", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("Promise constructor resolves synchronously set value", () => {
    const r = asyncResult(
      engine,
      "async function f() { return await new Promise(function(resolve) { resolve(42); }); } f();",
    );
    expect(r.state).toBe("fulfilled");
    expect(r.value).toBe(42);
  });

  it("Promise constructor rejects", () => {
    const r = asyncResult(
      engine,
      'async function f() { try { await new Promise(function(_, reject) { reject("fail"); }); } catch(e) { return "caught:" + e; } } f();',
    );
    expect(r.state).toBe("fulfilled");
    expect(r.value).toBe("caught:fail");
  });

  it("Promise.resolve wraps a value", () => {
    const r = asyncResult(
      engine,
      "async function f() { return await Promise.resolve(99); } f();",
    );
    expect(r.value).toBe(99);
  });

  it("Promise.resolve unwraps nested promise", () => {
    const r = asyncResult(
      engine,
      "async function f() { return await Promise.resolve(Promise.resolve(42)); } f();",
    );
    expect(r.value).toBe(42);
  });

  it("then chaining transforms values", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        return await Promise.resolve(10)
          .then(function(v) { return v * 2; })
          .then(function(v) { return v + 5; });
      }
      f();`,
    );
    expect(r.value).toBe(25);
  });

  it("catch handles rejection in chain", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        return await Promise.reject("err")
          .catch(function(e) { return "handled:" + e; });
      }
      f();`,
    );
    expect(r.value).toBe("handled:err");
  });

  it("then after catch continues the chain", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        return await Promise.reject(10)
          .catch(function(e) { return e + 5; })
          .then(function(v) { return v * 2; });
      }
      f();`,
    );
    expect(r.value).toBe(30);
  });

  it("Promise.all resolves with array of values", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        var results = await Promise.all([
          Promise.resolve(1),
          Promise.resolve(2),
          Promise.resolve(3)
        ]);
        return results[0] + results[1] + results[2];
      }
      f();`,
    );
    expect(r.value).toBe(6);
  });

  it("Promise.all rejects if any promise rejects", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        try {
          await Promise.all([
            Promise.resolve(1),
            Promise.reject("bad"),
            Promise.resolve(3)
          ]);
        } catch(e) {
          return "rejected:" + e;
        }
      }
      f();`,
    );
    expect(r.value).toBe("rejected:bad");
  });

  it("Promise.race resolves with first settled", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        return await Promise.race([
          Promise.resolve(42),
          Promise.resolve(99)
        ]);
      }
      f();`,
    );
    expect(r.value).toBe(42);
  });

  it("multiple then callbacks on same promise", () => {
    const r = asyncResult(
      engine,
      `async function f() {
        var p = Promise.resolve(10);
        var a = await p.then(function(v) { return v + 1; });
        var b = await p.then(function(v) { return v + 2; });
        return a + b;
      }
      f();`,
    );
    expect(r.value).toBe(23);
  });

  it("rejected promise without catch propagates", () => {
    const r = engine.runValue('async function f() { throw "boom"; } f();');
    engine.drainMicrotasks();
    expect(r.value.state).toBe("rejected");
    expect(getPayload(r.value.result)).toBe("boom");
  });
});
