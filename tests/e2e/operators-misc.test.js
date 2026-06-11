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

describe("E2E: unary plus", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("converts a numeric string to a number", () => {
    const r = engine.runValue('+"5";');
    expect(r.tag).toBe("smi");
    expect(r.value).toBe(5);
  });

  it("converts a boolean to a number", () => {
    const r = engine.runValue("+true;");
    expect(r.value).toBe(1);
  });

  it("leaves a number unchanged", () => {
    const r = engine.runValue("+8.5;");
    expect(r.value).toBe(8.5);
  });

  it("composes with other unary operators", () => {
    const r = engine.runValue("+-3;");
    expect(r.value).toBe(-3);
  });

  it("converts an empty array to zero", () => {
    const r = engine.runValue("+[];");
    expect(r.value).toBe(0);
  });

  it("produces NaN for a non-numeric string", () => {
    const r = engine.runValue('+"abc";');
    expect(r.tag).toBe("double");
    expect(Number.isNaN(r.value)).toBe(true);
  });

  it("survives optimization in a hot loop", () => {
    engine.run(`
      function unaryPlus(s) {
        let acc = 0;
        for (let i = 0; i < 5; i++) { acc = acc + +s; }
        return acc;
      }
    `);
    for (let i = 0; i < 200; i++) engine.run('unaryPlus("4");');
    expect(engine.runValue('unaryPlus("4");').value).toBe(20);
  });
});

describe("E2E: additive operator coercion", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("concatenates a string with an array via ToPrimitive", () => {
    const r = engine.runValue('"x" + [1, 2];');
    expect(r.value).toBe("x1,2");
  });

  it("concatenates an array with a string", () => {
    const r = engine.runValue('[1, 2, 3] + "";');
    expect(r.value).toBe("1,2,3");
  });

  it("concatenates a boolean with an array", () => {
    const r = engine.runValue("false + [1, 2];");
    expect(r.value).toBe("false1,2");
  });

  it("concatenates a number with a plain object", () => {
    const r = engine.runValue("1 + {};");
    expect(r.value).toBe("1[object Object]");
  });

  it("adds numbers obtained from single-element arrays", () => {
    const r = engine.runValue("[5] * 1;");
    expect(r.value).toBe(5);
  });

  it("treats an empty array as zero in arithmetic", () => {
    const r = engine.runValue("[] % 6;");
    expect(r.value).toBe(0);
  });
});

describe("E2E: relational comparison coercion", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("compares equal arrays via their string form", () => {
    expect(engine.runValue("[1, 2, 3] <= [1, 2, 3];").value).toBe(true);
    expect(engine.runValue("[1, 2, 3] >= [1, 2, 3];").value).toBe(true);
    expect(engine.runValue("[1, 2, 3] < [1, 2, 3];").value).toBe(false);
  });

  it("compares an array against a string", () => {
    expect(engine.runValue('[1, 2] < "1,3";').value).toBe(true);
  });

  it("keeps numeric comparison when an operand coerces to a number", () => {
    expect(engine.runValue("[] < 1.9;").value).toBe(true);
    expect(engine.runValue('"5" <= 5;').value).toBe(true);
  });

  it("yields false when an operand is not comparable", () => {
    expect(engine.runValue('"a" < 1;').value).toBe(false);
  });

  it("stays correct after optimization in a hot loop", () => {
    engine.run(`
      function cmp(x) {
        let hits = 0;
        for (let i = 0; i < 5; i++) { if (x <= [1, 2, 3]) hits = hits + 1; }
        return hits;
      }
    `);
    for (let i = 0; i < 200; i++) engine.run("cmp([1, 2, 3]);");
    expect(engine.runValue("cmp([1, 2, 3]);").value).toBe(5);
  });
});

describe("E2E: sequence (comma) operator", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("evaluates to the last expression", () => {
    expect(engine.runValue("(1, 2, 3);").value).toBe(3);
  });

  it("evaluates each operand for side effects", () => {
    const r = engine.runValue("let a = 0; (a = 5, a + 1);");
    expect(r.value).toBe(6);
  });

  it("works as an initializer", () => {
    expect(engine.runValue("let x = (10, 20); x;").value).toBe(20);
  });

  it("does not swallow commas in call arguments", () => {
    const r = engine.runValue("function f(x) { return x; } f((1, 2));");
    expect(r.value).toBe(2);
  });

  it("does not swallow commas in array literals", () => {
    const r = engine.runValue("[(1, 2), (3, 4)].length;");
    expect(r.value).toBe(2);
  });
});
