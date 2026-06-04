import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import {
  getPayload,
  isNull,
  isBool,
  isArray,
  isString,
} from "../../src/core/value/index.js";

describe("RegExp support", () => {
  describe("regex literals", () => {
    it("creates regex from literal /abc/", () => {
      const jit = new MiniJIT();
      const result = jit.run("typeof /abc/;");
      assert.equal(getPayload(result), "object");
    });

    it("creates regex with flags /\\d+/g", () => {
      const jit = new MiniJIT();
      const result = jit.run("/\\d+/g.flags;");
      assert.equal(getPayload(result), "g");
    });

    it("creates case-insensitive regex /[a-z]/i", () => {
      const jit = new MiniJIT();
      const result = jit.run("/[a-z]/i.ignoreCase;");
      assert.equal(getPayload(result), true);
    });

    it("regex source property", () => {
      const jit = new MiniJIT();
      const result = jit.run("/hello/.source;");
      assert.equal(getPayload(result), "hello");
    });
  });

  describe("RegExp constructor", () => {
    it("creates regex with new RegExp()", () => {
      const jit = new MiniJIT();
      const result = jit.run('new RegExp("abc", "g").flags;');
      assert.equal(getPayload(result), "g");
    });

    it("creates regex via RegExp() call", () => {
      const jit = new MiniJIT();
      const result = jit.run('RegExp("\\\\d+").source;');
      assert.equal(getPayload(result), "\\d+");
    });
  });

  describe("RegExp.prototype.test()", () => {
    it("returns true for matching string", () => {
      const jit = new MiniJIT();
      const result = jit.run('/foo/.test("foobar");');
      assert.equal(getPayload(result), true);
    });

    it("returns false for non-matching string", () => {
      const jit = new MiniJIT();
      const result = jit.run('/baz/.test("foobar");');
      assert.equal(getPayload(result), false);
    });
  });

  describe("RegExp.prototype.exec()", () => {
    it("returns array with match", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        let r = /(\\d+)/.exec("abc123");
        r[0];
      `);
      assert.equal(getPayload(result), "123");
    });

    it("returns capture group", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        let r = /(\\d+)/.exec("abc123");
        r[1];
      `);
      assert.equal(getPayload(result), "123");
    });

    it("returns null for no match", () => {
      const jit = new MiniJIT();
      const result = jit.run('/\\d+/.exec("abc");');
      assert.ok(isNull(result));
    });
  });

  describe("lastIndex statefulness", () => {
    it("advances lastIndex with global flag", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        let re = /\\d+/g;
        re.test("a1b2c3");
        re.lastIndex;
      `);
      assert.equal(getPayload(result), 2);
    });

    it("finds successive matches with global flag", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        let re = /\\d+/g;
        let a = re.exec("a1b22c3");
        let b = re.exec("a1b22c3");
        b[0];
      `);
      assert.equal(getPayload(result), "22");
    });
  });

  describe("String methods with regex", () => {
    it("match returns array", () => {
      const jit = new MiniJIT();
      const result = jit.run('"abc123def".match(/\\d+/)[0];');
      assert.equal(getPayload(result), "123");
    });

    it("match with global returns all matches", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        let m = "a1b2c3".match(/\\d/g);
        m[0] + m[1] + m[2];
      `);
      assert.equal(getPayload(result), "123");
    });

    it("match returns null for no match", () => {
      const jit = new MiniJIT();
      const result = jit.run('"abc".match(/\\d+/);');
      assert.ok(isNull(result));
    });

    it("replace with regex", () => {
      const jit = new MiniJIT();
      const result = jit.run('"abc123".replace(/\\d+/, "NUM");');
      assert.equal(getPayload(result), "abcNUM");
    });

    it("replace with global regex", () => {
      const jit = new MiniJIT();
      const result = jit.run('"a1b2c3".replace(/\\d/g, "X");');
      assert.equal(getPayload(result), "aXbXcX");
    });

    it("replace with regex and callback", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        function upper(m) { return m.toUpperCase(); }
        "abc".replace(/[a-c]/g, upper);
      `);
      assert.equal(getPayload(result), "ABC");
    });

    it("search returns index", () => {
      const jit = new MiniJIT();
      const result = jit.run('"abc123".search(/\\d+/);');
      assert.equal(getPayload(result), 3);
    });

    it("search returns -1 for no match", () => {
      const jit = new MiniJIT();
      const result = jit.run('"abc".search(/\\d+/);');
      assert.equal(getPayload(result), -1);
    });

    it("split with regex", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        let parts = "a1b2c3".split(/\\d/);
        parts[0] + parts[1] + parts[2];
      `);
      assert.equal(getPayload(result), "abc");
    });
  });

  describe("edge cases", () => {
    it("escaped slash in regex", () => {
      const jit = new MiniJIT();
      const result = jit.run('/a\\/b/.test("a/b");');
      assert.equal(getPayload(result), true);
    });

    it("character class with slash", () => {
      const jit = new MiniJIT();
      const result = jit.run('/[/]/.test("/");');
      assert.equal(getPayload(result), true);
    });

    it("division after identifier not treated as regex", () => {
      const jit = new MiniJIT();
      const result = jit.run("let a = 10; let b = 2; a / b;");
      assert.equal(getPayload(result), 5);
    });

    it("division after closing paren not treated as regex", () => {
      const jit = new MiniJIT();
      const result = jit.run("(10) / 2;");
      assert.equal(getPayload(result), 5);
    });

    it("regex after assignment operator", () => {
      const jit = new MiniJIT();
      const result = jit.run('let x = /foo/; x.test("foo");');
      assert.equal(getPayload(result), true);
    });

    it("regex after return keyword", () => {
      const jit = new MiniJIT();
      const result = jit.run(`
        function f() { return /test/; }
        f().test("test");
      `);
      assert.equal(getPayload(result), true);
    });

    it("typeof regex is object", () => {
      const jit = new MiniJIT();
      const result = jit.run("typeof /abc/;");
      assert.equal(getPayload(result), "object");
    });

    it("regex flag properties", () => {
      const jit = new MiniJIT();
      assert.equal(getPayload(jit.run("/a/g.global;")), true);
      assert.equal(getPayload(jit.run("/a/i.ignoreCase;")), true);
      assert.equal(getPayload(jit.run("/a/m.multiline;")), true);
      assert.equal(getPayload(jit.run("/a/.global;")), false);
    });
  });
});
