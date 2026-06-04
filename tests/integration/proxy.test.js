import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

function runVal(source) {
  return getPayload(new MiniJIT().run(source));
}

describe("Proxy core traps", () => {
  it("get trap handles existing properties", () => {
    assert.equal(
      runVal(`
      var target = { x: 1 };
      var proxy = new Proxy(target, {
        get: function(t, k, r) { return t.x + 41; }
      });
      proxy.x;
    `),
      42,
    );
  });

  it("get trap handles missing properties", () => {
    assert.equal(
      runVal(`
      var target = {};
      var proxy = new Proxy(target, {
        get: function(t, k, r) { return k + "-missing"; }
      });
      proxy.name;
    `),
      "name-missing",
    );
  });

  it("missing get trap forwards to target", () => {
    assert.equal(
      runVal(`
      var target = { x: 7 };
      var proxy = new Proxy(target, {});
      proxy.x;
    `),
      7,
    );
  });

  it("set trap receives target key value and receiver", () => {
    assert.equal(
      runVal(`
      var target = {};
      var proxy = new Proxy(target, {
        set: function(t, k, v, r) {
          t[k] = v + 1;
          t.sameReceiver = r === proxy;
          return true;
        }
      });
      proxy.x = 41;
      target.x + (target.sameReceiver ? 1 : 0);
    `),
      43,
    );
  });

  it("deleteProperty trap handles delete", () => {
    assert.equal(
      runVal(`
      var target = { x: 1 };
      var proxy = new Proxy(target, {
        deleteProperty: function(t, k) {
          t.deleted = k;
          return true;
        }
      });
      delete proxy.x;
      target.deleted;
    `),
      "x",
    );
  });

  it("has trap handles in operator", () => {
    assert.equal(
      runVal(`
      var proxy = new Proxy({}, {
        has: function(t, k) { return k === "visible"; }
      });
      "visible" in proxy;
    `),
      true,
    );
  });

  it("ownKeys trap handles Object.keys", () => {
    assert.equal(
      runVal(`
      var proxy = new Proxy({}, {
        ownKeys: function(t) { return ["a", "b"]; },
        get: function(t, k, r) { return k; }
      });
      var keys = Object.keys(proxy);
      keys[0] + keys[1];
    `),
      "ab",
    );
  });

  it("ownKeys trap handles object spread with get", () => {
    assert.equal(
      runVal(`
      var proxy = new Proxy({}, {
        ownKeys: function(t) { return ["x"]; },
        get: function(t, k, r) { return 9; }
      });
      var copy = { ...proxy };
      copy.x;
    `),
      9,
    );
  });

  it("descriptor traps handle getOwnPropertyDescriptor and defineProperty", () => {
    assert.equal(
      runVal(`
      var target = {};
      var proxy = new Proxy(target, {
        getOwnPropertyDescriptor: function(t, k) {
          return { value: 11, writable: true, enumerable: true, configurable: true };
        },
        defineProperty: function(t, k, d) {
          t[k] = d.value + 1;
          return true;
        }
      });
      var desc = Object.getOwnPropertyDescriptor(proxy, "x");
      Object.defineProperty(proxy, "y", { value: desc.value });
      target.y;
    `),
      12,
    );
  });

  it("array proxy supports index read write and length fallback", () => {
    assert.equal(
      runVal(`
      var target = [1, 2];
      var proxy = new Proxy(target, {});
      proxy[1] = 40;
      proxy[1] + proxy.length;
    `),
      42,
    );
  });
});
