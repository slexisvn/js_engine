import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: Proxy", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("get trap", () => {
    it("intercepts property access", () => {
      const r = engine.runValue(`
        var target = {x: 10, y: 20};
        var p = new Proxy(target, {
          get: function(t, prop) { return t[prop] * 2; }
        });
        p.x + p.y;
      `);
      expect(r.value).toBe(60);
    });

    it("can return computed values", () => {
      const r = engine.runValue(`
        var p = new Proxy({}, {
          get: function(t, prop) { return prop.length; }
        });
        p.hello + p.ab;
      `);
      expect(r.value).toBe(7);
    });

    it("passthrough when no get trap", () => {
      const r = engine.runValue(`
        var target = {val: 42};
        var p = new Proxy(target, {});
        p.val;
      `);
      expect(r.value).toBe(42);
    });
  });

  describe("set trap", () => {
    it("intercepts property assignment", () => {
      const r = engine.runValue(`
        var target = {};
        var p = new Proxy(target, {
          set: function(t, prop, val) {
            t[prop] = val + 100;
            return true;
          }
        });
        p.x = 5;
        target.x;
      `);
      expect(r.value).toBe(105);
    });

    it("can validate assignments", () => {
      const r = engine.runValue(`
        var target = {count: 0};
        var log = "";
        var p = new Proxy(target, {
          set: function(t, prop, val) {
            log += prop + "=" + val + " ";
            t[prop] = val;
            return true;
          }
        });
        p.count = 1;
        p.count = 2;
        log;
      `);
      expect(r.value).toBe("count=1 count=2 ");
    });
  });

  describe("has trap", () => {
    it("intercepts in operator", () => {
      const r = engine.runValue(`
        var p = new Proxy({}, {
          has: function(t, prop) {
            return prop === "magic";
          }
        });
        var a = "magic" in p;
        var b = "other" in p;
        a && !b;
      `);
      expect(r.value).toBe(true);
    });
  });

  describe("deleteProperty trap", () => {
    it("intercepts delete operator", () => {
      const r = engine.runValue(`
        var log = "";
        var target = {a: 1, b: 2};
        var p = new Proxy(target, {
          deleteProperty: function(t, prop) {
            log += "del:" + prop + " ";
            delete t[prop];
            return true;
          }
        });
        delete p.a;
        log + target.a;
      `);
      expect(r.value).toBe("del:a undefined");
    });
  });

  describe("combined traps", () => {
    it("logging proxy records get and set", () => {
      const r = engine.runValue(`
        var log = "";
        var target = {x: 1};
        var p = new Proxy(target, {
          get: function(t, prop) {
            log += "get:" + prop + " ";
            return t[prop];
          },
          set: function(t, prop, val) {
            log += "set:" + prop + " ";
            t[prop] = val;
            return true;
          }
        });
        var v = p.x;
        p.x = v + 10;
        log;
      `);
      expect(r.value).toBe("get:x set:x ");
    });

    it("proxy wrapping an array", () => {
      const r = engine.runValue(`
        var accessCount = 0;
        var arr = [10, 20, 30];
        var p = new Proxy(arr, {
          get: function(t, prop) {
            accessCount++;
            return t[prop];
          }
        });
        var sum = p[0] + p[1] + p[2];
        sum * 100 + accessCount;
      `);
      expect(r.value).toBe(6003);
    });

    it("proxy as property validation layer", () => {
      const r = engine.runValue(`
        var errors = 0;
        var target = {};
        var p = new Proxy(target, {
          set: function(t, prop, val) {
            if (typeof val === "number" && val < 0) {
              errors++;
              return true;
            }
            t[prop] = val;
            return true;
          }
        });
        p.a = 10;
        p.b = -5;
        p.c = 20;
        p.d = -3;
        (target.a || 0) + (target.b || 0) + (target.c || 0) + errors * 1000;
      `);
      expect(r.value).toBe(2030);
    });
  });

  describe("proxy passthrough (empty handler)", () => {
    it("reads and writes go through to target", () => {
      const r = engine.runValue(`
        var obj = {a: 1};
        var p = new Proxy(obj, {});
        p.b = 2;
        obj.a + obj.b + p.a + p.b;
      `);
      expect(r.value).toBe(6);
    });

    it("delete goes through to target", () => {
      const r = engine.runValue(`
        var obj = {x: 42};
        var p = new Proxy(obj, {});
        delete p.x;
        obj.x;
      `);
      expect(r.tag).toBe("undefined");
    });

    it("in operator goes through to target", () => {
      const r = engine.runValue(`
        var obj = {a: 1};
        var p = new Proxy(obj, {});
        "a" in p;
      `);
      expect(r.value).toBe(true);
    });
  });
});
