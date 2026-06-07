import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: strings and type coercion", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  describe("string operations", () => {
    it("concatenation", () => {
      expect(engine.runValue('"hello" + " " + "world"').value).toBe("hello world");
    });

    it("length property", () => {
      expect(engine.runValue('"abcde".length').value).toBe(5);
    });

    it("template literal with interpolation", () => {
      expect(engine.runValue("var x = 42; `value=${x}`;").value).toBe("value=42");
    });

    it("template literal with expression", () => {
      expect(engine.runValue("`sum=${2 + 3}`;").value).toBe("sum=5");
    });

    it("string comparison", () => {
      expect(engine.runValue('"abc" === "abc"').value).toBe(true);
      expect(engine.runValue('"abc" === "def"').value).toBe(false);
    });

    it("string + number coerces to string", () => {
      expect(engine.runValue('"count: " + 42').value).toBe("count: 42");
    });

    it("charAt access via bracket", () => {
      expect(engine.runValue('"hello"[1]').value).toBe("e");
    });

    it("empty string is falsy", () => {
      expect(engine.runValue('"" ? 1 : 0').value).toBe(0);
    });

    it("non-empty string is truthy", () => {
      expect(engine.runValue('"x" ? 1 : 0').value).toBe(1);
    });
  });

  describe("typeof operator", () => {
    it("typeof number", () => {
      expect(engine.runValue("typeof 42").value).toBe("number");
    });

    it("typeof string", () => {
      expect(engine.runValue('typeof "hello"').value).toBe("string");
    });

    it("typeof boolean", () => {
      expect(engine.runValue("typeof true").value).toBe("boolean");
    });

    it("typeof undefined", () => {
      expect(engine.runValue("typeof undefined").value).toBe("undefined");
    });

    it("typeof null is object", () => {
      expect(engine.runValue("typeof null").value).toBe("object");
    });

    it("typeof function", () => {
      expect(engine.runValue("typeof function(){}").value).toBe("function");
    });

    it("typeof object", () => {
      expect(engine.runValue("typeof {}").value).toBe("object");
    });
  });

  describe("comparison and equality", () => {
    it("strict equality", () => {
      expect(engine.runValue("1 === 1").value).toBe(true);
      expect(engine.runValue("1 === 2").value).toBe(false);
    });

    it("strict inequality", () => {
      expect(engine.runValue("1 !== 2").value).toBe(true);
    });

    it("less than / greater than", () => {
      expect(engine.runValue("3 < 5").value).toBe(true);
      expect(engine.runValue("5 > 3").value).toBe(true);
      expect(engine.runValue("3 >= 3").value).toBe(true);
      expect(engine.runValue("3 <= 3").value).toBe(true);
    });

    it("string comparison is lexicographic", () => {
      expect(engine.runValue('"apple" < "banana"').value).toBe(true);
    });

    it("not operator", () => {
      expect(engine.runValue("!true").value).toBe(false);
      expect(engine.runValue("!false").value).toBe(true);
      expect(engine.runValue("!0").value).toBe(true);
      expect(engine.runValue("!1").value).toBe(false);
    });

    it("double not coerces to boolean", () => {
      expect(engine.runValue("!!42").value).toBe(true);
      expect(engine.runValue('!!""').value).toBe(false);
      expect(engine.runValue("!!null").value).toBe(false);
    });
  });

  describe("type values", () => {
    it("null", () => {
      const r = engine.runValue("null");
      expect(r.tag).toBe("null");
      expect(r.value).toBe(null);
    });

    it("undefined", () => {
      const r = engine.runValue("undefined");
      expect(r.tag).toBe("undefined");
    });

    it("boolean true/false", () => {
      expect(engine.runValue("true").value).toBe(true);
      expect(engine.runValue("false").value).toBe(false);
    });

    it("NaN is not equal to itself", () => {
      expect(engine.runValue("var x = 0/0; x === x;").value).toBe(false);
    });
  });
});
