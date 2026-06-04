import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../src/frontend/parser/index.js";
import { RegisterBytecodeCompiler as RegisterCompiler } from "../../src/bytecode/register/compiler/index.js";
import { RegisterInterpreter } from "../../src/bytecode/register/interpreter/index.js";
import { Lexer, TokenType } from "../../src/frontend/lexer/index.js";

function run(source) {
  const ast = parse(source);
  const compiler = new RegisterCompiler();
  const compiled = compiler.compile(ast);
  const interp = new RegisterInterpreter();
  return interp.execute(compiled);
}

function runAndCapture(source) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    run(source);
    return logs;
  } finally {
    console.log = origLog;
  }
}

describe("Async, Exceptions, Number Literals", () => {
  describe("Number literal parsing", () => {
    it("parses hex literals", () => {
      const logs = runAndCapture(`
        print(0xFF);
        print(0x10);
        print(0xCAFE);
      `);
      assert.deepEqual(logs, ["255", "16", "51966"]);
    });

    it("parses binary literals", () => {
      const logs = runAndCapture(`
        print(0b1010);
        print(0b11111111);
        print(0B0);
      `);
      assert.deepEqual(logs, ["10", "255", "0"]);
    });

    it("parses octal literals", () => {
      const logs = runAndCapture(`
        print(0o17);
        print(0o777);
        print(0O10);
      `);
      assert.deepEqual(logs, ["15", "511", "8"]);
    });

    it("parses scientific notation", () => {
      const logs = runAndCapture(`
        print(1e3);
        print(2.5e2);
        print(1e0);
      `);
      assert.deepEqual(logs, ["1000", "250", "1"]);
    });

    it("parses scientific notation with negative exponent", () => {
      const logs = runAndCapture(`
        print(1e-1);
        print(5e-3);
      `);
      assert.deepEqual(logs, ["0.1", "0.005"]);
    });

    it("parses scientific notation with positive sign", () => {
      const logs = runAndCapture(`
        print(1e+3);
      `);
      assert.deepEqual(logs, ["1000"]);
    });

    it("lexer tokenizes hex as number", () => {
      const lexer = new Lexer("0xFF");
      const tokens = lexer.tokenize();
      assert.equal(tokens[0].type, TokenType.Number);
      assert.equal(tokens[0].value, "0xFF");
    });

    it("lexer tokenizes binary as number", () => {
      const lexer = new Lexer("0b1010");
      const tokens = lexer.tokenize();
      assert.equal(tokens[0].type, TokenType.Number);
      assert.equal(tokens[0].value, "0b1010");
    });

    it("lexer tokenizes scientific as number", () => {
      const lexer = new Lexer("1.5e10");
      const tokens = lexer.tokenize();
      assert.equal(tokens[0].type, TokenType.Number);
      assert.equal(tokens[0].value, "1.5e10");
    });
  });

  describe("Finally blocks", () => {
    it("finally runs on normal exit", () => {
      const logs = runAndCapture(`
        try {
          print("try");
        } finally {
          print("finally");
        }
      `);
      assert.deepEqual(logs, ["try", "finally"]);
    });

    it("finally runs after catch", () => {
      const logs = runAndCapture(`
        try {
          throw "err";
        } catch (e) {
          print("caught");
        } finally {
          print("finally");
        }
      `);
      assert.deepEqual(logs, ["caught", "finally"]);
    });

    it("finally runs on uncaught throw", () => {
      const logs = runAndCapture(`
        try {
          try {
            throw "inner";
          } finally {
            print("inner-finally");
          }
        } catch (e) {
          print("outer-caught");
        }
      `);
      assert.deepEqual(logs, ["inner-finally", "outer-caught"]);
    });

    it("try-finally without catch still runs finally", () => {
      const logs = runAndCapture(`
        let x = 0;
        try {
          try {
            throw "boom";
          } finally {
            x = 42;
          }
        } catch (e) {
          print(x);
          print(e);
        }
      `);
      assert.deepEqual(logs, ["42", "boom"]);
    });
  });

  describe("Typed errors", () => {
    it("TypeError has name and message properties", () => {
      const logs = runAndCapture(`
        try {
          let x = 5;
          x();
        } catch (e) {
          print(e.name);
          print(e.message);
        }
      `);
      assert.equal(logs[0], "TypeError");
      assert.ok(logs[1].includes("not a function"));
    });

    it("caught errors are objects with properties", () => {
      const logs = runAndCapture(`
        try {
          let notAFunc = 42;
          notAFunc();
        } catch (e) {
          print(typeof e);
          print(e.name);
        }
      `);
      assert.equal(logs[0], "object");
      assert.equal(logs[1], "TypeError");
    });
  });

  describe("Async/await with resolved promises", () => {
    it("await resolved promise gets value", () => {
      const logs = runAndCapture(`
        async function foo() {
          let p = Promise.resolve(42);
          let val = await p;
          print(val);
        }
        foo();
      `);
      assert.deepEqual(logs, ["42"]);
    });

    it("async function returns promise", () => {
      const logs = runAndCapture(`
        async function bar() {
          return 10;
        }
        let p = bar();
        print(typeof p);
      `);
      // async function returns a promise object
      assert.equal(logs[0], "object");
    });

    it("await non-promise passes through", () => {
      const logs = runAndCapture(`
        async function baz() {
          let x = await 99;
          print(x);
        }
        baz();
      `);
      assert.deepEqual(logs, ["99"]);
    });
  });
});
