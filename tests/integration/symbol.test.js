import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import {
  getTag,
  getPayload,
  toDisplayString,
} from "../../src/core/value/index.js";

function run(code) {
  return new MiniJIT().run(code);
}

function runBool(code) {
  return getPayload(run(code));
}

describe("Symbol — Phase 1: core type", () => {
  describe("creation and typeof", () => {
    it("Symbol() returns a symbol value", () => {
      assert.equal(getTag(run("Symbol()")), "symbol");
    });

    it('typeof Symbol() === "symbol"', () => {
      assert.equal(getPayload(run("typeof Symbol()")), "symbol");
    });

    it('Symbol("desc") returns a symbol with description', () => {
      assert.equal(toDisplayString(run('Symbol("hello")')), "Symbol(hello)");
    });

    it("Symbol() without description displays Symbol()", () => {
      assert.equal(toDisplayString(run("Symbol()")), "Symbol()");
    });
  });

  describe("identity and equality", () => {
    it("two Symbol() calls produce different symbols", () => {
      assert.equal(runBool('Symbol("a") === Symbol("a")'), false);
    });

    it("same symbol variable is strictly equal to itself", () => {
      assert.equal(runBool('let s = Symbol("x"); s === s'), true);
    });

    it("same symbol variable is not strictly unequal to itself", () => {
      assert.equal(runBool("let s = Symbol(); s !== s"), false);
    });

    it("different symbols are strictly unequal", () => {
      assert.equal(
        runBool("let a = Symbol(); let b = Symbol(); a !== b"),
        true,
      );
    });

    it("symbol is not loosely equal to string with same description", () => {
      assert.equal(runBool('Symbol("foo") == "foo"'), false);
    });

    it("symbol is not loosely equal to undefined", () => {
      assert.equal(runBool("Symbol() == undefined"), false);
    });

    it("symbol is not loosely equal to null", () => {
      assert.equal(runBool("Symbol() == null"), false);
    });
  });

  describe("truthiness and coercion", () => {
    it("symbol is truthy", () => {
      assert.equal(runBool("Symbol() ? true : false"), true);
    });

    it("symbol in conditional acts as truthy", () => {
      assert.equal(runBool("let s = Symbol(); s ? true : false"), true);
    });

    it("symbol is a primitive", () => {
      assert.equal(getPayload(run("typeof Symbol()")), "symbol");
    });
  });

  describe("use as identity key (array-based map pattern)", () => {
    it("can store and retrieve by symbol identity in a manual map", () => {
      const r = run(`
        let sym = Symbol("key");
        let entries = [];
        entries.push({ k: sym, v: 42 });
        let found = -1;
        let i = 0;
        while (i < entries.length) {
          if (entries[i].k === sym) { found = entries[i].v; }
          i = i + 1;
        }
        found
      `);
      assert.equal(getPayload(r), 42);
    });

    it("different symbols do not collide in manual map", () => {
      const r = run(`
        let a = Symbol("x");
        let b = Symbol("x");
        let entries = [];
        entries.push({ k: a, v: 1 });
        entries.push({ k: b, v: 2 });
        let found = 0;
        let i = 0;
        while (i < entries.length) {
          if (entries[i].k === a) { found = entries[i].v; }
          i = i + 1;
        }
        found
      `);
      assert.equal(getPayload(r), 1);
    });
  });

  describe("ternary guard pattern (proxy.js compatibility)", () => {
    it("Symbol is truthy when defined as a global", () => {
      assert.equal(runBool("Symbol ? true : false"), true);
    });

    it('Symbol ? Symbol("x") : "fallback" returns a symbol', () => {
      assert.equal(getTag(run('Symbol ? Symbol("x") : "fallback"')), "symbol");
    });
  });
});

describe("Symbol — Phase 2: global registry and well-known symbols", () => {
  describe("Symbol.for / Symbol.keyFor", () => {
    it("Symbol.for returns the same symbol for the same key", () => {
      assert.equal(runBool('Symbol.for("foo") === Symbol.for("foo")'), true);
    });

    it("Symbol.for returns different symbols for different keys", () => {
      assert.equal(runBool('Symbol.for("a") === Symbol.for("b")'), false);
    });

    it("Symbol.keyFor returns the key for a global symbol", () => {
      assert.equal(
        getPayload(run('let s = Symbol.for("bar"); Symbol.keyFor(s)')),
        "bar",
      );
    });

    it("Symbol.keyFor returns undefined for a non-global symbol", () => {
      assert.equal(getTag(run('Symbol.keyFor(Symbol("x"))')), "undefined");
    });

    it("Symbol.for symbol is different from Symbol() with same description", () => {
      assert.equal(runBool('Symbol.for("x") === Symbol("x")'), false);
    });
  });

  describe("well-known symbols", () => {
    it("Symbol.iterator is a symbol", () => {
      assert.equal(getPayload(run("typeof Symbol.iterator")), "symbol");
    });

    it("Symbol.hasInstance is a symbol", () => {
      assert.equal(getPayload(run("typeof Symbol.hasInstance")), "symbol");
    });

    it("Symbol.toPrimitive is a symbol", () => {
      assert.equal(getPayload(run("typeof Symbol.toPrimitive")), "symbol");
    });

    it("Symbol.toStringTag is a symbol", () => {
      assert.equal(getPayload(run("typeof Symbol.toStringTag")), "symbol");
    });

    it("Symbol.iterator is stable across accesses", () => {
      assert.equal(runBool("Symbol.iterator === Symbol.iterator"), true);
    });

    it("well-known symbols are distinct from each other", () => {
      assert.equal(runBool("Symbol.iterator === Symbol.hasInstance"), false);
    });
  });
});

describe("Symbol — Phase 3: symbols as object property keys", () => {
  describe("basic symbol-keyed properties on objects", () => {
    it("sets and gets a symbol-keyed property", () => {
      assert.equal(
        getPayload(run('let s = Symbol("x"); let o = {}; o[s] = 42; o[s]')),
        42,
      );
    });

    it("different symbols store different values", () => {
      const r = run(`
        let a = Symbol("a");
        let b = Symbol("b");
        let o = {};
        o[a] = 1;
        o[b] = 2;
        o[a]
      `);
      assert.equal(getPayload(r), 1);
    });

    it("symbol keys do not appear in Object.keys", () => {
      assert.equal(
        getPayload(
          run(
            "let s = Symbol(); let o = {a:1}; o[s] = 2; Object.keys(o).length",
          ),
        ),
        1,
      );
    });

    it("overwrites a symbol-keyed property", () => {
      assert.equal(
        getPayload(
          run("let s = Symbol(); let o = {}; o[s] = 1; o[s] = 99; o[s]"),
        ),
        99,
      );
    });

    it("returns undefined for unset symbol key", () => {
      assert.equal(
        getTag(run("let s = Symbol(); let o = {}; o[s]")),
        "undefined",
      );
    });
  });

  describe("in operator with symbol keys", () => {
    it("returns true when symbol key exists", () => {
      assert.equal(
        runBool("let s = Symbol(); let o = {}; o[s] = 1; s in o"),
        true,
      );
    });

    it("returns false when symbol key does not exist", () => {
      assert.equal(runBool("let s = Symbol(); let o = {}; s in o"), false);
    });
  });

  describe("symbol-keyed properties on arrays", () => {
    it("sets and gets a symbol-keyed property on an array", () => {
      assert.equal(
        getPayload(
          run('let s = Symbol(); let a = [1,2]; a[s] = "hello"; a[s]'),
        ),
        "hello",
      );
    });

    it("does not affect array length or elements", () => {
      assert.equal(
        getPayload(
          run("let s = Symbol(); let a = [1,2,3]; a[s] = 99; a.length"),
        ),
        3,
      );
    });
  });

  describe("well-known symbol as property key", () => {
    it("Symbol.iterator can be used as a property key", () => {
      assert.equal(
        getPayload(
          run("let o = {}; o[Symbol.iterator] = 42; o[Symbol.iterator]"),
        ),
        42,
      );
    });
  });

  describe("symbol keys with reference semantics", () => {
    it("stores and retrieves object references via symbol key", () => {
      const r = run(`
        let s = Symbol("ref");
        let inner = { v: 10 };
        let o = {};
        o[s] = inner;
        o[s].v = 99;
        inner.v
      `);
      assert.equal(getPayload(r), 99);
    });
  });
});
