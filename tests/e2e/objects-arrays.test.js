import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: objects and arrays", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("objects", () => {
    it("literal with dot access", () => {
      expect(engine.runValue("var o = {x: 10, y: 20}; o.x + o.y;").value).toBe(30);
    });

    it("bracket access with string key", () => {
      expect(engine.runValue('var o = {a: 42}; var k = "a"; o[k];').value).toBe(42);
    });

    it("dynamic property assignment", () => {
      expect(engine.runValue("var o = {}; o.x = 99; o.x;").value).toBe(99);
    });

    it("nested object access", () => {
      expect(engine.runValue("var o = {a: {b: {c: 42}}}; o.a.b.c;").value).toBe(42);
    });

    it("shorthand property", () => {
      expect(engine.runValue("var x = 5; var o = {x}; o.x;").value).toBe(5);
    });

    it("delete removes property", () => {
      const r = engine.runValue("var o = {a: 1, b: 2}; delete o.a; o.a;");
      expect(r.tag).toBe("undefined");
    });

    it("in operator checks property existence", () => {
      expect(engine.runValue('var o = {x: 1}; "x" in o;').value).toBe(true);
      expect(engine.runValue('var o = {x: 1}; "y" in o;').value).toBe(false);
    });

    it("method shorthand in class-like object", () => {
      const r = engine.runValue(`
        var calc = {
          val: 0,
          add: function(n) { this.val += n; return this; },
          result: function() { return this.val; }
        };
        calc.add(10).add(20).add(12).result();
      `);
      expect(r.value).toBe(42);
    });

    it("computed property access", () => {
      const r = engine.runValue(`
        var o = {};
        for (var i = 0; i < 5; i++) {
          o["key" + i] = i * 10;
        }
        o.key0 + o.key4;
      `);
      expect(r.value).toBe(40);
    });
  });

  describe("arrays", () => {
    it("literal and index access", () => {
      expect(engine.runValue("var a = [10, 20, 30]; a[1];").value).toBe(20);
    });

    it("length property", () => {
      expect(engine.runValue("var a = [1, 2, 3, 4, 5]; a.length;").value).toBe(5);
    });

    it("push and access last element", () => {
      const r = engine.runValue(`
        var a = [1, 2];
        a.push(3);
        a[2];
      `);
      expect(r.value).toBe(3);
    });

    it("pop returns and removes last element", () => {
      const r = engine.runValue(`
        var a = [10, 20, 30];
        var popped = a.pop();
        popped * 10 + a.length;
      `);
      expect(r.value).toBe(302);
    });

    it("index assignment", () => {
      expect(engine.runValue("var a = [0, 0, 0]; a[1] = 42; a[1];").value).toBe(42);
    });

    it("sparse array access returns undefined", () => {
      const r = engine.runValue("var a = [1]; a[100];");
      expect(r.tag).toBe("undefined");
    });

    it("iterate array with for loop", () => {
      const r = engine.runValue(`
        var a = [1, 2, 3, 4, 5];
        var sum = 0;
        for (var i = 0; i < a.length; i++) sum += a[i];
        sum;
      `);
      expect(r.value).toBe(15);
    });

    it("nested arrays", () => {
      const r = engine.runValue(`
        var matrix = [[1, 2], [3, 4], [5, 6]];
        matrix[1][0] + matrix[2][1];
      `);
      expect(r.value).toBe(9);
    });

    it("array of objects", () => {
      const r = engine.runValue(`
        var items = [{v: 10}, {v: 20}, {v: 30}];
        var total = 0;
        for (var i = 0; i < items.length; i++) total += items[i].v;
        total;
      `);
      expect(r.value).toBe(60);
    });

    it("spread into array", () => {
      const r = engine.runValue(`
        var a = [2, 3];
        var b = [1, ...a, 4];
        b.length;
      `);
      expect(r.value).toBe(4);
    });
  });

  describe("destructuring", () => {
    it("array destructuring", () => {
      expect(engine.runValue("var [a, b, c] = [10, 20, 30]; a + b + c;").value).toBe(60);
    });

    it("object destructuring", () => {
      expect(engine.runValue("var {x, y} = {x: 3, y: 4}; x * y;").value).toBe(12);
    });

    it("nested array destructuring with skip", () => {
      const r = engine.runValue(`
        var [a, , c] = [1, 2, 3];
        a + c;
      `);
      expect(r.value).toBe(4);
    });

    it("destructuring result used in computation", () => {
      const r = engine.runValue(`
        var obj = {a: 10, b: 20};
        var {a, b} = obj;
        a + b;
      `);
      expect(r.value).toBe(30);
    });
  });
});
