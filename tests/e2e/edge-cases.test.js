import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: edge cases and tricky semantics", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("numeric edge cases", () => {
    it("negative zero", () => {
      const r = engine.runValue("1 / (-0)");
      expect(r.value).toBe(-Infinity);
    });

    it("Infinity arithmetic", () => {
      expect(engine.runValue("1 / 0").value).toBe(Infinity);
      expect(engine.runValue("-1 / 0").value).toBe(-Infinity);
    });

    it("NaN propagates through arithmetic", () => {
      const r = engine.runValue("var x = 0/0; x + 5;");
      expect(r.value).toBeNaN();
    });

    it("integer wrap around with bitwise", () => {
      expect(engine.runValue("0xFFFFFFFF | 0").value).toBe(-1);
    });

    it("large number multiplication stays precise as double", () => {
      const r = engine.runValue("100000 * 100000");
      expect(r.value).toBe(10000000000);
    });
  });

  describe("string edge cases", () => {
    it("empty string concatenation", () => {
      expect(engine.runValue('"" + ""').value).toBe("");
    });

    it("number to string conversion via concatenation", () => {
      expect(engine.runValue('"" + 0').value).toBe("0");
      expect(engine.runValue('"" + true').value).toBe("true");
      expect(engine.runValue('"" + null').value).toBe("null");
      expect(engine.runValue('"" + undefined').value).toBe("undefined");
    });

    it("string repeat zero times gives empty", () => {
      expect(engine.runValue('"abc".repeat(0)').value).toBe("");
    });

    it("slice with negative index", () => {
      expect(engine.runValue('"hello".slice(-3)').value).toBe("llo");
    });
  });

  describe("array edge cases", () => {
    it("empty array operations", () => {
      expect(engine.runValue("[].length").value).toBe(0);
      const r = engine.runValue("[].pop()");
      expect(r.tag).toBe("undefined");
    });

    it("array with holes via index assignment", () => {
      const r = engine.runValue(`
        var a = [];
        a[0] = 1;
        a[5] = 6;
        a.length;
      `);
      expect(r.value).toBe(6);
    });

    it("push returns new length", () => {
      expect(engine.runValue("var a = [1]; a.push(2);").value).toBe(2);
    });

    it("reduce on single element with no initial value", () => {
      expect(engine.runValue("[42].reduce(function(a,b){return a+b;})").value).toBe(42);
    });
  });

  describe("function edge cases", () => {
    it("recursive closure with mutable state", () => {
      const r = engine.runValue(`
        function makeAccum() {
          var total = 0;
          return function add(n) {
            total += n;
            return total;
          };
        }
        var acc = makeAccum();
        acc(10);
        acc(20);
        acc(30);
      `);
      expect(r.value).toBe(60);
    });

    it("function that returns another function preserves closure", () => {
      const r = engine.runValue(`
        function multiplier(factor) {
          return function(x) { return x * factor; };
        }
        var double = multiplier(2);
        var triple = multiplier(3);
        double(5) + triple(5);
      `);
      expect(r.value).toBe(25);
    });

    it("immediately invoked arrow function", () => {
      expect(engine.runValue("((x) => x + 1)(41)").value).toBe(42);
    });
  });

  describe("object edge cases", () => {
    it("property access on non-existing key returns undefined", () => {
      const r = engine.runValue("var o = {}; o.nonexistent;");
      expect(r.tag).toBe("undefined");
    });

    it("overwrite property changes value", () => {
      const r = engine.runValue(`
        var o = {x: 1};
        o.x = 2;
        o.x = 3;
        o.x;
      `);
      expect(r.value).toBe(3);
    });

    it("object used as simple namespace", () => {
      const r = engine.runValue(`
        var math = {
          add: function(a, b) { return a + b; },
          mul: function(a, b) { return a * b; }
        };
        math.add(3, 4) + math.mul(5, 6);
      `);
      expect(r.value).toBe(37);
    });
  });

  describe("control flow edge cases", () => {
    it("early return inside nested loops", () => {
      const r = engine.runValue(`
        function findPair(arr, target) {
          for (var i = 0; i < arr.length; i++) {
            for (var j = i + 1; j < arr.length; j++) {
              if (arr[i] + arr[j] === target) return i * 10 + j;
            }
          }
          return -1;
        }
        findPair([2, 7, 11, 15], 9);
      `);
      expect(r.value).toBe(1);
    });

    it("deeply nested if-else produces correct result", () => {
      const r = engine.runValue(`
        function classify(n) {
          if (n < 0) {
            if (n < -100) return "very-neg";
            else return "neg";
          } else {
            if (n === 0) return "zero";
            else {
              if (n > 100) return "very-pos";
              else return "pos";
            }
          }
        }
        classify(-200) + " " + classify(-5) + " " + classify(0) + " " + classify(50) + " " + classify(999);
      `);
      expect(r.value).toBe("very-neg neg zero pos very-pos");
    });

    it("break from labeled statement (if supported) or nested break", () => {
      const r = engine.runValue(`
        var found = false;
        for (var i = 0; i < 10; i++) {
          for (var j = 0; j < 10; j++) {
            if (i === 3 && j === 5) { found = true; break; }
          }
          if (found) break;
        }
        i * 10 + j;
      `);
      expect(r.value).toBe(35);
    });
  });

  describe("mixed-type operations", () => {
    it("adding different types coerces correctly", () => {
      expect(engine.runValue("1 + \"2\"").value).toBe("12");
      expect(engine.runValue("\"3\" + 4").value).toBe("34");
    });

    it("comparison between types", () => {
      expect(engine.runValue("null === undefined").value).toBe(false);
      expect(engine.runValue("null === null").value).toBe(true);
    });

    it("truthy/falsy values in conditions", () => {
      const r = engine.runValue(`
        var truthy = 0;
        if (1) truthy++;
        if ("a") truthy++;
        if ({}) truthy++;
        if ([]) truthy++;
        var falsy = 0;
        if (!0) falsy++;
        if (!"") falsy++;
        if (!null) falsy++;
        if (!undefined) falsy++;
        if (!false) falsy++;
        truthy * 10 + falsy;
      `);
      expect(r.value).toBe(45);
    });
  });
});
