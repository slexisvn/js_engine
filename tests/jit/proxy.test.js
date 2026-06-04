import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

function runVal(source) {
  return getPayload(
    new MiniJIT({
      tieringPolicy: {
        baselineThreshold: 3,
        optimizeThreshold: 6,
      },
    }).run(source),
  );
}

describe("Proxy IC and JIT safety", () => {
  it("does not reuse a normal object field fast path for proxy receivers", () => {
    assert.equal(
      runVal(`
      function readX(o) { return o.x; }
      var normal = { x: 1 };
      var result = 0;
      for (var i = 0; i < 12; i++) {
        result = readX(normal);
      }
      var proxy = new Proxy(normal, {
        get: function(t, k, r) { return 42; }
      });
      readX(proxy);
    `),
      42,
    );
  });

  it("keeps invoking proxy get trap after warmup", () => {
    assert.equal(
      runVal(`
      function readX(o) { return o.x; }
      var count = 0;
      var proxy = new Proxy({ x: 1 }, {
        get: function(t, k, r) {
          count = count + 1;
          return count;
        }
      });
      var result = 0;
      for (var i = 0; i < 20; i++) {
        result = readX(proxy);
      }
      result;
    `),
      20,
    );
  });

  it("uses generic object indexed get in baseline proxy traps", () => {
    assert.equal(
      runVal(`
      function read(o, k) { return o[k]; }
      var proxy = new Proxy({ x: 7 }, {
        get: function(t, k, r) { return t[k]; }
      });
      var result = 0;
      for (var i = 0; i < 20; i++) {
        result = read(proxy, "x");
      }
      result;
    `),
      7,
    );
  });

  it("uses generic object indexed set in baseline proxy traps", () => {
    assert.equal(
      runVal(`
      function write(o, k, v) { o[k] = v; }
      var target = { x: 1 };
      var proxy = new Proxy(target, {
        set: function(t, k, v, r) {
          t[k] = v;
          return true;
        },
        get: function(t, k, r) { return t[k]; }
      });
      for (var i = 0; i < 20; i++) {
        write(proxy, "x", i);
      }
      proxy.x;
    `),
      19,
    );
  });
});
