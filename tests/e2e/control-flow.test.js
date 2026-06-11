import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: control flow", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("if/else", () => {
    it("takes true branch", () => {
      expect(engine.runValue("var r; if (true) r = 1; else r = 2; r;").value).toBe(1);
    });

    it("takes false branch", () => {
      expect(engine.runValue("var r; if (false) r = 1; else r = 2; r;").value).toBe(2);
    });

    it("chained if/else if/else", () => {
      const r = engine.runValue(`
        function classify(n) {
          if (n < 0) return "negative";
          else if (n === 0) return "zero";
          else return "positive";
        }
        classify(-5) + "," + classify(0) + "," + classify(3);
      `);
      expect(r.value).toBe("negative,zero,positive");
    });
  });

  describe("ternary", () => {
    it("evaluates truthy branch", () => {
      expect(engine.runValue("1 ? 10 : 20").value).toBe(10);
    });

    it("evaluates falsy branch", () => {
      expect(engine.runValue("0 ? 10 : 20").value).toBe(20);
    });

    it("nested ternary", () => {
      expect(engine.runValue("var x = 2; x === 1 ? \"a\" : x === 2 ? \"b\" : \"c\";").value).toBe("b");
    });
  });

  describe("for loop", () => {
    it("sums 1 to 100", () => {
      const r = engine.runValue(`
        var sum = 0;
        for (var i = 1; i <= 100; i++) sum += i;
        sum;
      `);
      expect(r.value).toBe(5050);
    });

    it("break exits loop early", () => {
      const r = engine.runValue(`
        var last = 0;
        for (var i = 0; i < 100; i++) {
          if (i === 5) break;
          last = i;
        }
        last;
      `);
      expect(r.value).toBe(4);
    });

    it("continue skips iteration", () => {
      const r = engine.runValue(`
        var sum = 0;
        for (var i = 0; i < 10; i++) {
          if (i % 2 === 0) continue;
          sum += i;
        }
        sum;
      `);
      expect(r.value).toBe(25);
    });

    it("nested for loops", () => {
      const r = engine.runValue(`
        var count = 0;
        for (var i = 0; i < 5; i++)
          for (var j = 0; j < 5; j++)
            count++;
        count;
      `);
      expect(r.value).toBe(25);
    });

    it("nested let loops re-run the inner loop fully on every outer pass", () => {
      const r = engine.runValue(`
        let s = "";
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) s = s + "x";
        }
        s;
      `);
      expect(r.value).toBe("xxxx");
    });

    it("nested let loops that shadow the same variable name stay independent", () => {
      const r = engine.runValue(`
        let count = 0;
        for (let i = 0; i < 2; i++) {
          for (let i = 0; i < 3; i++) count = count + 1;
        }
        count;
      `);
      expect(r.value).toBe(6);
    });

    it("triple-nested let loops iterate the full product", () => {
      const r = engine.runValue(`
        let count = 0;
        for (let a = 0; a < 2; a++)
          for (let b = 0; b < 2; b++)
            for (let c = 0; c < 2; c++) count = count + 1;
        count;
      `);
      expect(r.value).toBe(8);
    });

    it("a let loop variable shadows an outer binding of the same name", () => {
      const r = engine.runValue(`
        let i = 99;
        let s = "";
        for (let i = 0; i < 2; i++) s = s + i;
        s + "|" + i;
      `);
      expect(r.value).toBe("01|99");
    });
  });

  describe("while loop", () => {
    it("counts up", () => {
      const r = engine.runValue("var x = 0; while (x < 10) x++; x;");
      expect(r.value).toBe(10);
    });

    it("break in while", () => {
      const r = engine.runValue(`
        var i = 0;
        while (true) {
          if (i >= 3) break;
          i++;
        }
        i;
      `);
      expect(r.value).toBe(3);
    });
  });

  describe("do-while loop", () => {
    it("executes body at least once", () => {
      const r = engine.runValue("var x = 0; do { x += 10; } while (false); x;");
      expect(r.value).toBe(10);
    });

    it("loops until condition false", () => {
      const r = engine.runValue("var x = 1; do { x *= 2; } while (x < 100); x;");
      expect(r.value).toBe(128);
    });
  });

  describe("switch", () => {
    it("matches correct case", () => {
      const r = engine.runValue(`
        var r = "";
        switch (2) {
          case 1: r = "one"; break;
          case 2: r = "two"; break;
          case 3: r = "three"; break;
        }
        r;
      `);
      expect(r.value).toBe("two");
    });

    it("falls through without break (engine breaks implicitly per case)", () => {
      const r = engine.runValue(`
        var r = "";
        switch (1) {
          case 1: r += "a";
          case 2: r += "b"; break;
        }
        r;
      `);
      expect(r.value).toBe("a");
    });

    it("default case when no match", () => {
      const r = engine.runValue(`
        var r;
        switch (99) {
          case 1: r = "one"; break;
          default: r = "other"; break;
        }
        r;
      `);
      expect(r.value).toBe("other");
    });
  });

  describe("logical operators short-circuit", () => {
    it("&& short-circuits on falsy", () => {
      expect(engine.runValue("0 && 42").value).toBe(0);
    });

    it("&& returns second operand on truthy", () => {
      expect(engine.runValue("1 && 42").value).toBe(42);
    });

    it("|| short-circuits on truthy", () => {
      expect(engine.runValue("1 || 42").value).toBe(1);
    });

    it("|| returns second operand on falsy", () => {
      expect(engine.runValue("0 || 42").value).toBe(42);
    });

    it("nullish coalescing chain with ||", () => {
      expect(engine.runValue("null || undefined || 0 || 99").value).toBe(99);
    });
  });
});
