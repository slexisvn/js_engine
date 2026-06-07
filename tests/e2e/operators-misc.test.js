import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: delete operator", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("deletes a property from object", () => {
    const r = engine.runValue(`
      var o = {a: 1, b: 2, c: 3};
      delete o.b;
      o.b;
    `);
    expect(r.tag).toBe("undefined");
  });

  it("remaining properties still accessible after delete", () => {
    const r = engine.runValue(`
      var o = {x: 10, y: 20};
      delete o.x;
      o.y;
    `);
    expect(r.value).toBe(20);
  });

  it("delete with bracket notation", () => {
    const r = engine.runValue(`
      var o = {key: 42};
      delete o["key"];
      o.key;
    `);
    expect(r.tag).toBe("undefined");
  });
});

describe("E2E: in operator", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("returns true for existing property", () => {
    const r = engine.runValue('"a" in {a: 1, b: 2};');
    expect(r.value).toBe(true);
  });

  it("returns false for missing property", () => {
    const r = engine.runValue('"c" in {a: 1, b: 2};');
    expect(r.value).toBe(false);
  });

  it("works with computed property names", () => {
    const r = engine.runValue(`
      var key = "hello";
      var o = {};
      o[key] = 42;
      key in o;
    `);
    expect(r.value).toBe(true);
  });

  it("works with array indices", () => {
    const r = engine.runValue(`
      var arr = [10, 20, 30];
      (0 in arr) && (2 in arr) && !(5 in arr);
    `);
    expect(r.value).toBe(true);
  });
});

describe("E2E: void operator", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("returns undefined", () => {
    const r = engine.runValue("void 0;");
    expect(r.tag).toBe("undefined");
  });

  it("evaluates expression but returns undefined", () => {
    const r = engine.runValue("void (1 + 2);");
    expect(r.tag).toBe("undefined");
  });
});

describe("E2E: labeled statements", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("labeled break exits outer loop", () => {
    const r = engine.runValue(`
      var count = 0;
      outer: for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) {
          if (j === 1) break outer;
          count++;
        }
      }
      count;
    `);
    expect(r.value).toBe(1);
  });

  it("labeled break with different nesting", () => {
    const r = engine.runValue(`
      var sum = 0;
      loop: for (var i = 0; i < 10; i++) {
        if (i === 5) break loop;
        sum += i;
      }
      sum;
    `);
    expect(r.value).toBe(10);
  });
});

describe("E2E: spread operator", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("spread in array literal", () => {
    const r = engine.runValue(`
      var a = [1, 2, 3];
      var b = [...a, 4, 5];
      b.join(",");
    `);
    expect(r.value).toBe("1,2,3,4,5");
  });

  it("spread combines multiple arrays", () => {
    const r = engine.runValue(`
      var a = [1, 2];
      var b = [3, 4];
      var c = [...a, ...b];
      c.length;
    `);
    expect(r.value).toBe(4);
  });

  it("spread in function call", () => {
    const r = engine.runValue(`
      function sum(a, b, c) { return a + b + c; }
      var args = [10, 20, 30];
      sum(...args);
    `);
    expect(r.value).toBe(60);
  });

  it("spread copies object properties", () => {
    const r = engine.runValue(`
      var a = {x: 1, y: 2};
      var b = {...a, z: 3};
      b.x + b.y + b.z;
    `);
    expect(r.value).toBe(6);
  });

  it("spread object override", () => {
    const r = engine.runValue(`
      var defaults = {color: "red", size: 10};
      var custom = {...defaults, color: "blue"};
      custom.color + "," + custom.size;
    `);
    expect(r.value).toBe("blue,10");
  });
});

describe("E2E: destructuring", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("array destructuring", () => {
    const r = engine.runValue(`
      var [a, b, c] = [10, 20, 30];
      a + b + c;
    `);
    expect(r.value).toBe(60);
  });

  it("array destructuring with skip", () => {
    const r = engine.runValue(`
      var [a, , c] = [1, 2, 3];
      a + c;
    `);
    expect(r.value).toBe(4);
  });

  it("object destructuring", () => {
    const r = engine.runValue(`
      var {x, y} = {x: 10, y: 20, z: 30};
      x + y;
    `);
    expect(r.value).toBe(30);
  });

  it("destructuring from function return", () => {
    const r = engine.runValue(`
      function getPoint() { return {x: 5, y: 10}; }
      var {x, y} = getPoint();
      x * y;
    `);
    expect(r.value).toBe(50);
  });

  it("array destructuring from function return", () => {
    const r = engine.runValue(`
      function pair() { return [1, 2]; }
      var [a, b] = pair();
      a + b;
    `);
    expect(r.value).toBe(3);
  });
});

describe("E2E: rest parameters", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("collects remaining arguments", () => {
    const r = engine.runValue(`
      function f(first, ...rest) {
        return first + rest.length;
      }
      f(10, 20, 30, 40);
    `);
    expect(r.value).toBe(13);
  });

  it("rest is a real array", () => {
    const r = engine.runValue(`
      function sum(a, ...nums) {
        var total = a;
        for (var i = 0; i < nums.length; i++) total += nums[i];
        return total;
      }
      sum(1, 2, 3, 4, 5);
    `);
    expect(r.value).toBe(15);
  });

  it("empty rest when no extra arguments", () => {
    const r = engine.runValue(`
      function f(a, ...rest) {
        return rest.length;
      }
      f(1);
    `);
    expect(r.value).toBe(0);
  });
});

describe("E2E: toString and valueOf", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("number toString", () => {
    const r = engine.runValue("(42).toString();");
    expect(r.value).toBe("42");
  });

  it("boolean toString", () => {
    const r = engine.runValue("true.toString();");
    expect(r.value).toBe("true");
  });

  it("string conversion via concatenation", () => {
    const r = engine.runValue('"value:" + 42;');
    expect(r.value).toBe("value:42");
  });
});
