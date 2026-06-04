import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../src/frontend/lexer/index.js";
import { Parser } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import { resetMigrationStats } from "../../src/objects/heap/js-object.js";
import { getPayload } from "../../src/core/value/index.js";

function run(source) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const compiler = new RegisterBytecodeCompiler();
  const compiledFn = compiler.compile(ast);
  const interp = new RegisterInterpreter(null);
  return interp.execute(compiledFn);
}

function runVal(source) {
  return getPayload(run(source));
}

describe("Template Literals, Optional Chaining, Nullish Coalescing", () => {
  beforeEach(() => {
    resetHiddenClasses();
    resetMigrationStats();
  });

  describe("Template Literals", () => {
    it("simple template with no interpolation", () => {
      assert.equal(runVal("`hello world`;"), "hello world");
    });

    it("template with single interpolation", () => {
      assert.equal(runVal("let x = 5; `value is ${x}`;"), "value is 5");
    });

    it("template with multiple interpolations", () => {
      assert.equal(
        runVal("let a = 1; let b = 2; `${a} + ${b} = ${a + b}`;"),
        "1 + 2 = 3",
      );
    });

    it("template with expressions", () => {
      assert.equal(runVal("let x = 10; `result: ${x * 2 + 1}`;"), "result: 21");
    });

    it("template with string variable", () => {
      assert.equal(
        runVal('let name = "world"; `hello ${name}!`;'),
        "hello world!",
      );
    });

    it("nested template usage", () => {
      assert.equal(runVal("let x = 3; let y = 4; `${x}${y}`;"), "34");
    });
  });

  describe("Single Quote Strings", () => {
    it("basic single quote string", () => {
      assert.equal(runVal("'hello';"), "hello");
    });

    it("single quote with escape", () => {
      assert.equal(runVal("'it\\'s';"), "it's");
    });
  });

  describe("Nullish Coalescing (??)", () => {
    it("returns left when not null/undefined", () => {
      assert.equal(runVal("let x = 5; x ?? 10;"), 5);
    });

    it("returns right when left is null", () => {
      assert.equal(runVal("let x = null; x ?? 10;"), 10);
    });

    it("returns right when left is undefined", () => {
      assert.equal(runVal("let x = undefined; x ?? 10;"), 10);
    });

    it("does not treat 0 as nullish", () => {
      assert.equal(runVal("let x = 0; x ?? 10;"), 0);
    });

    it("does not treat empty string as nullish", () => {
      assert.equal(runVal('let x = ""; x ?? "default";'), "");
    });

    it("does not treat false as nullish", () => {
      assert.equal(runVal("let x = false; x ?? true;"), false);
    });

    it("chains correctly", () => {
      assert.equal(
        runVal("let a = null; let b = null; let c = 42; a ?? b ?? c;"),
        42,
      );
    });
  });

  describe("Optional Chaining (?.)", () => {
    it("accesses property on non-null object", () => {
      assert.equal(runVal("let obj = { x: 10 }; obj?.x;"), 10);
    });

    it("returns undefined for null object", () => {
      assert.equal(runVal("let obj = null; obj?.x;"), undefined);
    });

    it("returns undefined for undefined object", () => {
      assert.equal(runVal("let obj = undefined; obj?.x;"), undefined);
    });

    it("chains with nested access", () => {
      assert.equal(runVal("let obj = { a: { b: 42 } }; obj?.a?.b;"), 42);
    });

    it("short-circuits on null in chain", () => {
      assert.equal(runVal("let obj = { a: null }; obj?.a?.b;"), undefined);
    });

    it("optional call on function", () => {
      assert.equal(
        runVal(`
        function greet() { return 42; }
        let fn = greet;
        fn?.();
      `),
        42,
      );
    });

    it("optional call on null returns undefined", () => {
      assert.equal(runVal("let fn = null; fn?.();"), undefined);
    });

    it("optional call with args", () => {
      assert.equal(
        runVal(`
        function add(a, b) { return a + b; }
        let fn = add;
        fn?.(3, 4);
      `),
        7,
      );
    });
  });

  describe("Combined", () => {
    it("optional chaining with nullish coalescing", () => {
      assert.equal(runVal('let obj = null; obj?.x ?? "default";'), "default");
    });

    it("optional chaining on existing with nullish coalescing", () => {
      assert.equal(runVal('let obj = { x: 0 }; obj?.x ?? "default";'), 0);
    });

    it("template with optional chaining", () => {
      assert.equal(
        runVal(
          'let obj = { name: "test" }; `name: ${obj?.name ?? "unknown"}`;',
        ),
        "name: test",
      );
    });
  });
});
