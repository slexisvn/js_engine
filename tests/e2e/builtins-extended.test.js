import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: String methods (extended)", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("charCodeAt returns UTF-16 code", () => {
    const r = engine.runValue('"A".charCodeAt(0);');
    expect(r.value).toBe(65);
  });

  it("substring extracts range", () => {
    const r = engine.runValue('"hello world".substring(6, 11);');
    expect(r.value).toBe("world");
  });

  it("substring from index to end", () => {
    const r = engine.runValue('"hello world".substring(6);');
    expect(r.value).toBe("world");
  });

  it("lastIndexOf finds last occurrence", () => {
    const r = engine.runValue('"abcabc".lastIndexOf("bc");');
    expect(r.value).toBe(4);
  });

  it("trimStart removes leading whitespace", () => {
    const r = engine.runValue('"  hi  ".trimStart();');
    expect(r.value).toBe("hi  ");
  });

  it("trimEnd removes trailing whitespace", () => {
    const r = engine.runValue('"  hi  ".trimEnd();');
    expect(r.value).toBe("  hi");
  });

  it("replaceAll substitutes all occurrences", () => {
    const r = engine.runValue('"abcabc".replaceAll("a", "x");');
    expect(r.value).toBe("xbcxbc");
  });

  it("padEnd pads to target length", () => {
    const r = engine.runValue('"hi".padEnd(5, ".");');
    expect(r.value).toBe("hi...");
  });

  it("concat joins strings", () => {
    const r = engine.runValue('"hello".concat(" ", "world");');
    expect(r.value).toBe("hello world");
  });

  it("search returns index of regex match", () => {
    const r = engine.runValue('"hello123".search(/[0-9]/);');
    expect(r.value).toBe(5);
  });

  it("search returns -1 when no match", () => {
    const r = engine.runValue('"hello".search(/[0-9]/);');
    expect(r.value).toBe(-1);
  });

  it("match returns first match", () => {
    const r = engine.runValue('"hello123".match(/[0-9]+/)[0];');
    expect(r.value).toBe("123");
  });
});

describe("E2E: Array methods (extended)", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("at with positive index", () => {
    const r = engine.runValue("[10, 20, 30].at(1);");
    expect(r.value).toBe(20);
  });

  it("at with negative index", () => {
    const r = engine.runValue("[10, 20, 30].at(-1);");
    expect(r.value).toBe(30);
  });

  it("flatMap maps and flattens", () => {
    const r = engine.runValue(`
      [1, 2, 3].flatMap(function(x) { return [x, x * 10]; }).join(",");
    `);
    expect(r.value).toBe("1,10,2,20,3,30");
  });

  it("findIndex returns first matching index", () => {
    const r = engine.runValue(`
      [10, 20, 30, 40].findIndex(function(x) { return x > 25; });
    `);
    expect(r.value).toBe(2);
  });

  it("findIndex returns -1 when not found", () => {
    const r = engine.runValue(`
      [1, 2, 3].findIndex(function(x) { return x > 10; });
    `);
    expect(r.value).toBe(-1);
  });

  it("Array.from converts string to array", () => {
    const r = engine.runValue('Array.from("abc").join(",");');
    expect(r.value).toBe("a,b,c");
  });

  it("Array.from with array returns copy", () => {
    const r = engine.runValue(`
      var a = [1, 2, 3];
      var b = Array.from(a);
      b.push(4);
      a.length + "," + b.length;
    `);
    expect(r.value).toBe("3,4");
  });

  it("lastIndexOf finds last element position", () => {
    const r = engine.runValue("[1, 2, 3, 2, 1].lastIndexOf(2);");
    expect(r.value).toBe(3);
  });

  it("reduce with initial value", () => {
    const r = engine.runValue(`
      [1, 2, 3, 4].reduce(function(acc, v) { return acc * v; }, 1);
    `);
    expect(r.value).toBe(24);
  });
});

describe("E2E: JSON advanced", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("stringify array with mixed types", () => {
    const r = engine.runValue('JSON.stringify([1, "two", true, null]);');
    expect(r.value).toBe('[1,"two",true,null]');
  });

  it("parse boolean values", () => {
    const r = engine.runValue(`
      var o = JSON.parse('{"a":true,"b":false}');
      o.a && !o.b;
    `);
    expect(r.value).toBe(true);
  });

  it("roundtrip array", () => {
    const r = engine.runValue(`
      var arr = [1, 2, [3, 4]];
      var json = JSON.stringify(arr);
      var back = JSON.parse(json);
      back[2][0] + back[2][1];
    `);
    expect(r.value).toBe(7);
  });

  it("stringify with nested arrays and objects", () => {
    const r = engine.runValue(`
      var data = {items: [{id: 1}, {id: 2}]};
      var json = JSON.stringify(data);
      var back = JSON.parse(json);
      back.items[0].id + back.items[1].id;
    `);
    expect(r.value).toBe(3);
  });
});

describe("E2E: Regex operations", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("regex test with character class", () => {
    const r = engine.runValue("/^[a-z]+$/.test(\"hello\");");
    expect(r.value).toBe(true);
  });

  it("regex test fails on mismatch", () => {
    const r = engine.runValue("/^[a-z]+$/.test(\"Hello\");");
    expect(r.value).toBe(false);
  });

  it("regex with quantifiers", () => {
    const r = engine.runValue("/^\\d{3}-\\d{4}$/.test(\"123-4567\");");
    expect(r.value).toBe(true);
  });

  it("replace with regex", () => {
    const r = engine.runValue('"abc123def".replace(/[0-9]+/, "NUM");');
    expect(r.value).toBe("abcNUMdef");
  });

  it("split with regex", () => {
    const r = engine.runValue('"a1b2c3".split(/[0-9]/).join(",");');
    expect(r.value).toBe("a,b,c,");
  });
});
