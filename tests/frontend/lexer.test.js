import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Lexer, TokenType } from "../../src/frontend/lexer/index.js";

function tokenize(src) {
  return new Lexer(src).tokenize();
}

function tokenValues(src) {
  return tokenize(src).map((t) => t.value);
}

function tokenTypes(src) {
  return tokenize(src).map((t) => t.type);
}

describe("Lexer", () => {
  describe("integers", () => {
    it("tokenizes single digit", () => {
      const tokens = tokenize("0");
      assert.equal(tokens.length, 2);
      assert.equal(tokens[0].type, TokenType.Number);
      assert.equal(tokens[0].value, "0");
      assert.equal(tokens[1].type, TokenType.EOF);
    });

    it("tokenizes multi-digit integer", () => {
      const tokens = tokenize("42");
      assert.equal(tokens[0].type, TokenType.Number);
      assert.equal(tokens[0].value, "42");
    });

    it("tokenizes large integer", () => {
      const tokens = tokenize("9999999");
      assert.equal(tokens[0].value, "9999999");
    });

    it("tokenizes zero", () => {
      const tokens = tokenize("0");
      assert.equal(tokens[0].value, "0");
    });
  });

  describe("floats", () => {
    it("tokenizes simple float", () => {
      const tokens = tokenize("3.14");
      assert.equal(tokens[0].type, TokenType.Number);
      assert.equal(tokens[0].value, "3.14");
    });

    it("tokenizes float starting with zero", () => {
      const tokens = tokenize("0.5");
      assert.equal(tokens[0].value, "0.5");
    });

    it("tokenizes float with many decimals", () => {
      const tokens = tokenize("1.23456789");
      assert.equal(tokens[0].value, "1.23456789");
    });
  });

  describe("strings", () => {
    it("tokenizes empty string", () => {
      const tokens = tokenize('""');
      assert.equal(tokens[0].type, TokenType.String);
      assert.equal(tokens[0].value, "");
    });

    it("tokenizes simple string", () => {
      const tokens = tokenize('"hello"');
      assert.equal(tokens[0].value, "hello");
    });

    it("tokenizes string with spaces", () => {
      const tokens = tokenize('"hello world"');
      assert.equal(tokens[0].value, "hello world");
    });

    it("tokenizes escaped newline", () => {
      const tokens = tokenize('"line1\\nline2"');
      assert.equal(tokens[0].value, "line1\nline2");
    });

    it("tokenizes escaped tab", () => {
      const tokens = tokenize('"col1\\tcol2"');
      assert.equal(tokens[0].value, "col1\tcol2");
    });

    it("tokenizes escaped backslash", () => {
      const tokens = tokenize('"path\\\\file"');
      assert.equal(tokens[0].value, "path\\file");
    });

    it("tokenizes escaped quote", () => {
      const tokens = tokenize('"say \\"hi\\""');
      assert.equal(tokens[0].value, 'say "hi"');
    });

    it("throws on unterminated string", () => {
      assert.throws(() => tokenize('"oops'), SyntaxError);
    });
  });

  describe("identifiers", () => {
    it("tokenizes single letter", () => {
      const tokens = tokenize("x");
      assert.equal(tokens[0].type, TokenType.Identifier);
      assert.equal(tokens[0].value, "x");
    });

    it("tokenizes camelCase", () => {
      const tokens = tokenize("myVar");
      assert.equal(tokens[0].value, "myVar");
    });

    it("tokenizes with underscore", () => {
      const tokens = tokenize("_private");
      assert.equal(tokens[0].value, "_private");
    });

    it("tokenizes with dollar sign", () => {
      const tokens = tokenize("$el");
      assert.equal(tokens[0].value, "$el");
    });

    it("tokenizes with digits in name", () => {
      const tokens = tokenize("var2");
      assert.equal(tokens[0].value, "var2");
    });

    it("tokenizes underscore-only identifier", () => {
      const tokens = tokenize("_");
      assert.equal(tokens[0].type, TokenType.Identifier);
      assert.equal(tokens[0].value, "_");
    });
  });

  describe("keywords", () => {
    const keywords = [
      "let",
      "function",
      "if",
      "else",
      "while",
      "return",
      "true",
      "false",
      "null",
      "undefined",
      "new",
      "this",
    ];

    for (const kw of keywords) {
      it(`recognizes "${kw}"`, () => {
        const tokens = tokenize(kw);
        assert.equal(tokens[0].type, TokenType.Keyword);
        assert.equal(tokens[0].value, kw);
      });
    }

    it("does not treat partial keyword match as keyword", () => {
      const tokens = tokenize("letter");
      assert.equal(tokens[0].type, TokenType.Identifier);
    });

    it("does not treat keyword prefix as keyword", () => {
      const tokens = tokenize("returned");
      assert.equal(tokens[0].type, TokenType.Identifier);
    });
  });

  describe("multi-char operators", () => {
    it("tokenizes ===", () => {
      const tokens = tokenize("===");
      assert.equal(tokens[0].type, TokenType.Punctuator);
      assert.equal(tokens[0].value, "===");
    });

    it("tokenizes !==", () => {
      const tokens = tokenize("!==");
      assert.equal(tokens[0].value, "!==");
    });

    it("tokenizes <=", () => {
      const tokens = tokenize("<=");
      assert.equal(tokens[0].value, "<=");
    });

    it("tokenizes >=", () => {
      const tokens = tokenize(">=");
      assert.equal(tokens[0].value, ">=");
    });

    it("tokenizes &&", () => {
      const tokens = tokenize("&&");
      assert.equal(tokens[0].value, "&&");
    });

    it("tokenizes ||", () => {
      const tokens = tokenize("||");
      assert.equal(tokens[0].value, "||");
    });

    it("differentiates = from ===", () => {
      const tokens = tokenize("a === b = c");
      assert.equal(tokens[1].value, "===");
      assert.equal(tokens[3].value, "=");
    });

    it("differentiates ! from !==", () => {
      const tokens = tokenize("!x !== y");
      assert.equal(tokens[0].value, "!");
      assert.equal(tokens[2].value, "!==");
    });
  });

  describe("single-char punctuators", () => {
    const singles = [
      "+",
      "-",
      "*",
      "/",
      "%",
      "<",
      ">",
      "!",
      "=",
      ".",
      ",",
      ";",
      "(",
      ")",
      "{",
      "}",
      "[",
      "]",
      ":",
    ];

    for (const ch of singles) {
      it(`tokenizes '${ch}'`, () => {
        const src =
          ch === "!" ? "!x" : ch === "." ? "a.b" : ch === "/" ? "a / b" : ch;
        const tokens = tokenize(src);
        const found = tokens.find((t) => t.value === ch);
        assert.ok(found, `Expected to find punctuator '${ch}'`);
        assert.equal(found.type, TokenType.Punctuator);
      });
    }
  });

  describe("comment skipping", () => {
    it("skips single-line comment", () => {
      const tokens = tokenize("42 // this is a comment\n58");
      assert.equal(tokens[0].type, TokenType.Number);
      assert.equal(tokens[0].value, "42");
      assert.equal(tokens[1].type, TokenType.Number);
      assert.equal(tokens[1].value, "58");
    });

    it("skips comment at end of input", () => {
      const tokens = tokenize("x // trailing");
      assert.equal(tokens.length, 2);
      assert.equal(tokens[0].value, "x");
      assert.equal(tokens[1].type, TokenType.EOF);
    });

    it("skips multiple comment lines", () => {
      const tokens = tokenize("// first\n// second\n99");
      assert.equal(tokens[0].value, "99");
    });

    it("does not skip // inside strings", () => {
      const tokens = tokenize('"hello // world"');
      assert.equal(tokens[0].type, TokenType.String);
      assert.equal(tokens[0].value, "hello // world");
    });
  });

  describe("line and column tracking", () => {
    it("tracks column on first line", () => {
      const tokens = tokenize("let x = 5;");
      assert.equal(tokens[0].line, 1);
      assert.equal(tokens[0].column, 1);
      assert.equal(tokens[1].line, 1);
      assert.equal(tokens[1].column, 5);
    });

    it("tracks line after newline", () => {
      const tokens = tokenize("a\nb");
      assert.equal(tokens[0].line, 1);
      assert.equal(tokens[1].line, 2);
    });

    it("resets column after newline", () => {
      const tokens = tokenize("a\n  b");
      assert.equal(tokens[1].line, 2);
      assert.equal(tokens[1].column, 3);
    });

    it("tracks through multiple lines", () => {
      const tokens = tokenize("a\nb\nc");
      assert.equal(tokens[0].line, 1);
      assert.equal(tokens[1].line, 2);
      assert.equal(tokens[2].line, 3);
    });
  });

  describe("whitespace handling", () => {
    it("skips spaces", () => {
      const tokens = tokenize("  42  ");
      assert.equal(tokens[0].value, "42");
    });

    it("skips tabs", () => {
      const tokens = tokenize("\t42\t");
      assert.equal(tokens[0].value, "42");
    });

    it("skips carriage returns", () => {
      const tokens = tokenize("\r\n42");
      assert.equal(tokens[0].value, "42");
    });
  });

  describe("complex tokenization", () => {
    it("tokenizes a let declaration", () => {
      const vals = tokenValues("let x = 42;");
      assert.deepEqual(vals, ["let", "x", "=", "42", ";", ""]);
    });

    it("tokenizes a function declaration", () => {
      const types = tokenTypes("function add(a, b) { return a + b; }");
      assert.deepEqual(types, [
        "Keyword",
        "Identifier",
        "Punctuator",
        "Identifier",
        "Punctuator",
        "Identifier",
        "Punctuator",
        "Punctuator",
        "Keyword",
        "Identifier",
        "Punctuator",
        "Identifier",
        "Punctuator",
        "Punctuator",
        "EOF",
      ]);
    });

    it("tokenizes member access chain", () => {
      const vals = tokenValues("a.b.c");
      assert.deepEqual(vals, ["a", ".", "b", ".", "c", ""]);
    });

    it("tokenizes comparison expression", () => {
      const vals = tokenValues("x <= 10");
      assert.deepEqual(vals, ["x", "<=", "10", ""]);
    });

    it("tokenizes array literal", () => {
      const vals = tokenValues("[1, 2, 3]");
      assert.deepEqual(vals, ["[", "1", ",", "2", ",", "3", "]", ""]);
    });

    it("tokenizes object literal", () => {
      const vals = tokenValues("{ x: 1, y: 2 }");
      assert.deepEqual(vals, ["{", "x", ":", "1", ",", "y", ":", "2", "}", ""]);
    });
  });

  describe("error cases", () => {
    it("throws on unexpected character", () => {
      assert.throws(() => tokenize("@"), SyntaxError);
    });

    // backtick now supported (template literals) — no longer throws

    it("throws on hash", () => {
      assert.throws(() => tokenize("#private"), SyntaxError);
    });

    it("error includes line and column", () => {
      try {
        tokenize("\n\n  @");
        assert.fail("Should have thrown");
      } catch (e) {
        assert.ok(e instanceof SyntaxError);
        assert.ok(e.message.includes("3:"), `Expected line 3 in: ${e.message}`);
      }
    });
  });

  describe("empty input", () => {
    it("returns only EOF for empty string", () => {
      const tokens = tokenize("");
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0].type, TokenType.EOF);
    });

    it("returns only EOF for whitespace", () => {
      const tokens = tokenize("   \n\t  ");
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0].type, TokenType.EOF);
    });

    it("returns only EOF for comment-only input", () => {
      const tokens = tokenize("// nothing here");
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0].type, TokenType.EOF);
    });
  });
});

describe("Number Literal Tokenization", () => {
  it("tokenizes hex as number", () => {
    const lexer = new Lexer("0xFF");
    const tokens = lexer.tokenize();
    assert.equal(tokens[0].type, TokenType.Number);
    assert.equal(tokens[0].value, "0xFF");
  });

  it("tokenizes binary as number", () => {
    const lexer = new Lexer("0b1010");
    const tokens = lexer.tokenize();
    assert.equal(tokens[0].type, TokenType.Number);
    assert.equal(tokens[0].value, "0b1010");
  });

  it("tokenizes scientific as number", () => {
    const lexer = new Lexer("1.5e10");
    const tokens = lexer.tokenize();
    assert.equal(tokens[0].type, TokenType.Number);
    assert.equal(tokens[0].value, "1.5e10");
  });
});
