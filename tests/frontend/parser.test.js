import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Parser, parse } from "../../src/frontend/parser/index.js";
import { Lexer } from "../../src/frontend/lexer/index.js";
import { NodeType } from "../../src/frontend/ast/index.js";

function parseSource(src) {
  return parse(src);
}

function parseExpr(src) {
  const ast = parseSource(src + ";");
  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].type, NodeType.ExpressionStatement);
  return ast.body[0].expression;
}

function parseStmt(src) {
  const ast = parseSource(src);
  assert.equal(ast.body.length, 1);
  return ast.body[0];
}

describe("Parser", () => {
  describe("let declarations", () => {
    it("parses let with init", () => {
      const stmt = parseStmt("let x = 5;");
      assert.equal(stmt.type, NodeType.LetDeclaration);
      assert.equal(stmt.name, "x");
      assert.equal(stmt.init.type, NodeType.Literal);
      assert.equal(stmt.init.value, 5);
    });

    it("parses let without init", () => {
      const stmt = parseStmt("let y;");
      assert.equal(stmt.type, NodeType.LetDeclaration);
      assert.equal(stmt.name, "y");
      assert.equal(stmt.init, null);
    });

    it("parses let with expression init", () => {
      const stmt = parseStmt("let z = 1 + 2;");
      assert.equal(stmt.init.type, NodeType.BinaryExpression);
      assert.equal(stmt.init.op, "+");
    });
  });

  describe("function declarations", () => {
    it("parses no-param function", () => {
      const stmt = parseStmt("function f() { return 1; }");
      assert.equal(stmt.type, NodeType.FunctionDeclaration);
      assert.equal(stmt.name, "f");
      assert.equal(stmt.params.length, 0);
      assert.equal(stmt.body.type, NodeType.BlockStatement);
    });

    it("parses single-param function", () => {
      const stmt = parseStmt("function inc(x) { return x + 1; }");
      assert.deepEqual(stmt.params, ["x"]);
      assert.equal(stmt.body.body.length, 1);
      assert.equal(stmt.body.body[0].type, NodeType.ReturnStatement);
    });

    it("parses multi-param function", () => {
      const stmt = parseStmt("function add(a, b, c) { return a + b + c; }");
      assert.deepEqual(stmt.params, ["a", "b", "c"]);
    });

    it("parses function with multiple statements", () => {
      const stmt = parseStmt("function foo(x) { let y = x + 1; return y; }");
      assert.equal(stmt.body.body.length, 2);
      assert.equal(stmt.body.body[0].type, NodeType.LetDeclaration);
      assert.equal(stmt.body.body[1].type, NodeType.ReturnStatement);
    });
  });

  describe("operator precedence", () => {
    it("multiplies before adding: 1 + 2 * 3", () => {
      const expr = parseExpr("1 + 2 * 3");
      assert.equal(expr.type, NodeType.BinaryExpression);
      assert.equal(expr.op, "+");
      assert.equal(expr.left.value, 1);
      assert.equal(expr.right.type, NodeType.BinaryExpression);
      assert.equal(expr.right.op, "*");
      assert.equal(expr.right.left.value, 2);
      assert.equal(expr.right.right.value, 3);
    });

    it("groups left-to-right for same precedence: 1 - 2 + 3", () => {
      const expr = parseExpr("1 - 2 + 3");
      assert.equal(expr.op, "+");
      assert.equal(expr.left.type, NodeType.BinaryExpression);
      assert.equal(expr.left.op, "-");
    });

    it("compares before logical: a < b && c > d", () => {
      const expr = parseExpr("a < b && c > d");
      assert.equal(expr.type, NodeType.LogicalExpression);
      assert.equal(expr.op, "&&");
      assert.equal(expr.left.op, "<");
      assert.equal(expr.right.op, ">");
    });

    it("&& before ||", () => {
      const expr = parseExpr("a || b && c");
      assert.equal(expr.type, NodeType.LogicalExpression);
      assert.equal(expr.op, "||");
      assert.equal(expr.left.type, NodeType.Identifier);
      assert.equal(expr.right.type, NodeType.LogicalExpression);
      assert.equal(expr.right.op, "&&");
    });

    it("parentheses override precedence: (1 + 2) * 3", () => {
      const expr = parseExpr("(1 + 2) * 3");
      assert.equal(expr.op, "*");
      assert.equal(expr.left.type, NodeType.BinaryExpression);
      assert.equal(expr.left.op, "+");
    });

    it("division and modulo at same precedence as multiply", () => {
      const expr = parseExpr("a * b / c % d");
      assert.equal(expr.op, "%");
      assert.equal(expr.left.op, "/");
      assert.equal(expr.left.left.op, "*");
    });

    it("=== and !== at same precedence", () => {
      const expr = parseExpr("a === b");
      assert.equal(expr.op, "===");
      assert.equal(expr.left.name, "a");
      assert.equal(expr.right.name, "b");
    });
  });

  describe("if/else statements", () => {
    it("parses simple if", () => {
      const stmt = parseStmt("if (x) { y; }");
      assert.equal(stmt.type, NodeType.IfStatement);
      assert.equal(stmt.test.name, "x");
      assert.equal(stmt.consequent.type, NodeType.BlockStatement);
      assert.equal(stmt.alternate, null);
    });

    it("parses if-else", () => {
      const stmt = parseStmt("if (a) { b; } else { c; }");
      assert.equal(stmt.consequent.body[0].expression.name, "b");
      assert.notEqual(stmt.alternate, null);
      assert.equal(stmt.alternate.body[0].expression.name, "c");
    });

    it("parses if-else if chain", () => {
      const stmt = parseStmt("if (a) { b; } else if (c) { d; } else { e; }");
      assert.equal(stmt.type, NodeType.IfStatement);
      assert.equal(stmt.alternate.type, NodeType.IfStatement);
      assert.equal(stmt.alternate.alternate.type, NodeType.BlockStatement);
    });

    it("parses complex condition", () => {
      const stmt = parseStmt("if (x > 0 && x < 10) { ok; }");
      assert.equal(stmt.test.type, NodeType.LogicalExpression);
      assert.equal(stmt.test.op, "&&");
    });
  });

  describe("while statements", () => {
    it("parses simple while", () => {
      const stmt = parseStmt("while (i < 10) { i = i + 1; }");
      assert.equal(stmt.type, NodeType.WhileStatement);
      assert.equal(stmt.test.op, "<");
      assert.equal(stmt.body.type, NodeType.BlockStatement);
    });

    it("parses while with complex body", () => {
      const ast = parseSource("while (x) { let a = 1; let b = 2; }");
      const whileStmt = ast.body[0];
      assert.equal(whileStmt.body.body.length, 2);
    });
  });

  describe("return statements", () => {
    it("parses return with value", () => {
      const ast = parseSource("function f() { return 42; }");
      const retStmt = ast.body[0].body.body[0];
      assert.equal(retStmt.type, NodeType.ReturnStatement);
      assert.equal(retStmt.argument.value, 42);
    });

    it("parses return without value", () => {
      const ast = parseSource("function f() { return; }");
      const retStmt = ast.body[0].body.body[0];
      assert.equal(retStmt.argument, null);
    });

    it("parses return with expression", () => {
      const ast = parseSource("function f(a, b) { return a + b; }");
      const retStmt = ast.body[0].body.body[0];
      assert.equal(retStmt.argument.type, NodeType.BinaryExpression);
    });
  });

  describe("object expressions", () => {
    it("parses object in let init", () => {
      const ast = parseSource("let o = {};");
      const init = ast.body[0].init;
      assert.equal(init.type, NodeType.ObjectExpression);
      assert.equal(init.properties.length, 0);
    });

    it("parses single property object", () => {
      const ast = parseSource("let o = { x: 1 };");
      const obj = ast.body[0].init;
      assert.equal(obj.properties.length, 1);
      assert.equal(obj.properties[0].key, "x");
      assert.equal(obj.properties[0].value.value, 1);
    });

    it("parses multiple properties", () => {
      const ast = parseSource("let o = { x: 1, y: 2, z: 3 };");
      const obj = ast.body[0].init;
      assert.equal(obj.properties.length, 3);
      assert.equal(obj.properties[0].key, "x");
      assert.equal(obj.properties[1].key, "y");
      assert.equal(obj.properties[2].key, "z");
    });

    it("parses nested objects", () => {
      const ast = parseSource("let o = { a: { b: 1 } };");
      const obj = ast.body[0].init;
      assert.equal(obj.properties[0].value.type, NodeType.ObjectExpression);
      assert.equal(obj.properties[0].value.properties[0].key, "b");
    });

    it("parses string property keys", () => {
      const ast = parseSource('let o = { "name": "alice" };');
      const obj = ast.body[0].init;
      assert.equal(obj.properties[0].key, "name");
      assert.equal(obj.properties[0].value.value, "alice");
    });
  });

  describe("array expressions", () => {
    it("parses empty array", () => {
      const expr = parseExpr("[]");
      assert.equal(expr.type, NodeType.ArrayExpression);
      assert.equal(expr.elements.length, 0);
    });

    it("parses array with elements", () => {
      const expr = parseExpr("[1, 2, 3]");
      assert.equal(expr.elements.length, 3);
      assert.equal(expr.elements[0].value, 1);
      assert.equal(expr.elements[2].value, 3);
    });

    it("parses nested arrays", () => {
      const expr = parseExpr("[[1, 2], [3, 4]]");
      assert.equal(expr.elements.length, 2);
      assert.equal(expr.elements[0].type, NodeType.ArrayExpression);
    });
  });

  describe("member expressions", () => {
    it("parses dot access", () => {
      const expr = parseExpr("a.b");
      assert.equal(expr.type, NodeType.MemberExpression);
      assert.equal(expr.object.name, "a");
      assert.equal(expr.property, "b");
    });

    it("parses chained dot access", () => {
      const expr = parseExpr("a.b.c");
      assert.equal(expr.type, NodeType.MemberExpression);
      assert.equal(expr.property, "c");
      assert.equal(expr.object.type, NodeType.MemberExpression);
      assert.equal(expr.object.property, "b");
    });

    it("parses computed access", () => {
      const expr = parseExpr("a[0]");
      assert.equal(expr.type, NodeType.MemberExpression);
      assert.equal(expr.object.name, "a");
      assert.equal(expr.property.value, 0);
    });

    it("parses computed access with identifier", () => {
      const expr = parseExpr("a[i]");
      assert.equal(expr.property.type, NodeType.Identifier);
      assert.equal(expr.property.name, "i");
    });
  });

  describe("call expressions", () => {
    it("parses no-arg call", () => {
      const expr = parseExpr("f()");
      assert.equal(expr.type, NodeType.CallExpression);
      assert.equal(expr.callee.name, "f");
      assert.equal(expr.args.length, 0);
    });

    it("parses single-arg call", () => {
      const expr = parseExpr("f(1)");
      assert.equal(expr.args.length, 1);
      assert.equal(expr.args[0].value, 1);
    });

    it("parses multi-arg call", () => {
      const expr = parseExpr("add(a, b, c)");
      assert.equal(expr.args.length, 3);
    });

    it("parses chained calls", () => {
      const expr = parseExpr("f(1)(2)");
      assert.equal(expr.type, NodeType.CallExpression);
      assert.equal(expr.callee.type, NodeType.CallExpression);
    });

    it("parses method call", () => {
      const expr = parseExpr("obj.method(x)");
      assert.equal(expr.type, NodeType.CallExpression);
      assert.equal(expr.callee.type, NodeType.MemberExpression);
      assert.equal(expr.callee.property, "method");
    });
  });

  describe("new expressions", () => {
    it("parses new with parens", () => {
      const expr = parseExpr("new Foo()");
      assert.equal(expr.type, NodeType.NewExpression);
      assert.equal(expr.callee.name, "Foo");
      assert.equal(expr.args.length, 0);
    });

    it("parses new with args", () => {
      const expr = parseExpr("new Point(1, 2)");
      assert.equal(expr.args.length, 2);
    });

    it("parses new without parens", () => {
      const expr = parseExpr("new Foo");
      assert.equal(expr.type, NodeType.NewExpression);
      assert.equal(expr.args.length, 0);
    });
  });

  describe("assignment expressions", () => {
    it("parses simple assignment", () => {
      const expr = parseExpr("x = 5");
      assert.equal(expr.type, NodeType.AssignmentExpression);
      assert.equal(expr.target.name, "x");
      assert.equal(expr.value.value, 5);
    });

    it("parses member assignment", () => {
      const expr = parseExpr("a.b = 10");
      assert.equal(expr.target.type, NodeType.MemberExpression);
      assert.equal(expr.target.property, "b");
    });

    it("rejects invalid assignment target", () => {
      assert.throws(() => parseSource("1 = 2;"), SyntaxError);
    });
  });

  describe("unary expressions", () => {
    it("parses negation", () => {
      const expr = parseExpr("-x");
      assert.equal(expr.type, NodeType.UnaryExpression);
      assert.equal(expr.op, "-");
      assert.equal(expr.argument.name, "x");
    });

    it("parses logical not", () => {
      const expr = parseExpr("!true");
      assert.equal(expr.op, "!");
      assert.equal(expr.argument.value, true);
    });

    it("parses double negation", () => {
      const expr = parseExpr("!!x");
      assert.equal(expr.op, "!");
      assert.equal(expr.argument.type, NodeType.UnaryExpression);
      assert.equal(expr.argument.op, "!");
    });
  });

  describe("literals", () => {
    it("parses true", () => {
      const expr = parseExpr("true");
      assert.equal(expr.value, true);
      assert.equal(expr.kind, "boolean");
    });

    it("parses false", () => {
      const expr = parseExpr("false");
      assert.equal(expr.value, false);
    });

    it("parses null", () => {
      const expr = parseExpr("null");
      assert.equal(expr.value, null);
      assert.equal(expr.kind, "null");
    });

    it("parses undefined", () => {
      const expr = parseExpr("undefined");
      assert.equal(expr.value, undefined);
      assert.equal(expr.kind, "undefined");
    });

    it("parses this", () => {
      const expr = parseExpr("this");
      assert.equal(expr.type, NodeType.ThisExpression);
    });
  });

  describe("program structure", () => {
    it("parses empty program", () => {
      const ast = parseSource("");
      assert.equal(ast.type, NodeType.Program);
      assert.equal(ast.body.length, 0);
    });

    it("parses multiple statements", () => {
      const ast = parseSource("let a = 1; let b = 2; let c = 3;");
      assert.equal(ast.body.length, 3);
    });

    it("parses mixed statement types", () => {
      const ast = parseSource("let x = 1; function f() { return x; } f();");
      assert.equal(ast.body[0].type, NodeType.LetDeclaration);
      assert.equal(ast.body[1].type, NodeType.FunctionDeclaration);
      assert.equal(ast.body[2].type, NodeType.ExpressionStatement);
    });
  });

  describe("error handling", () => {
    it("allows ASI at end of input for let declaration", () => {
      const ast = parseSource("let x = 1");
      assert.equal(ast.body.length, 1);
      assert.equal(ast.body[0].type, NodeType.LetDeclaration);
    });

    it("throws on missing closing paren", () => {
      assert.throws(() => parseSource("f(1, 2;"), SyntaxError);
    });

    it("throws on missing closing brace", () => {
      assert.throws(() => parseSource("if (x) { y;"), SyntaxError);
    });

    it("parses lone semicolon as empty statement", () => {
      const ast = parseSource(";");
      assert.equal(ast.body.length, 1);
      assert.equal(ast.body[0].type, NodeType.EmptyStatement);
    });

    it("error message includes position", () => {
      try {
        parseSource("let = 5;");
        assert.fail("Should have thrown");
      } catch (e) {
        assert.ok(e instanceof SyntaxError);
        assert.ok(
          e.message.includes("Parser"),
          `Expected parser error, got: ${e.message}`,
        );
      }
    });
  });
});

describe("Lazy Parsing", () => {
  it("produces LazyFunctionDeclaration for inner functions", () => {
    const src =
      "function outer() { function inner(x) { return x + 1; } return inner(5); }";
    const ast = parse(src, { lazy: true });

    assert.equal(ast.body.length, 1);
    const outer = ast.body[0];
    assert.equal(outer.type, NodeType.FunctionDeclaration);
    assert.equal(outer.name, "outer");

    const innerDecl = outer.body.body[0];
    assert.equal(innerDecl.type, NodeType.LazyFunctionDeclaration);
    assert.equal(innerDecl.name, "inner");
    assert.deepEqual(innerDecl.params, ["x"]);
    assert.ok(innerDecl.isLazy);
    assert.ok(innerDecl.source);
    assert.ok(typeof innerDecl.bodyStart === "number");
    assert.ok(typeof innerDecl.bodyEnd === "number");
  });

  it("does not lazily parse top-level functions", () => {
    const src = "function top(a) { return a; }";
    const ast = parse(src, { lazy: true });

    assert.equal(ast.body.length, 1);
    const fn = ast.body[0];
    assert.equal(fn.type, NodeType.FunctionDeclaration);
    assert.equal(fn.name, "top");

    assert.ok(fn.body);
    assert.equal(fn.body.type, NodeType.BlockStatement);
  });

  it("eagerly parses all functions when lazy=false", () => {
    const src = "function outer() { function inner() { return 1; } }";
    const ast = parse(src, { lazy: false });

    const outer = ast.body[0];
    const inner = outer.body.body[0];
    assert.equal(inner.type, NodeType.FunctionDeclaration);
    assert.equal(inner.name, "inner");

    assert.ok(inner.body);
    assert.equal(inner.body.type, NodeType.BlockStatement);
  });

  it("lazy-compiled function executes correctly via engine", async () => {
    const { MiniJIT } = await import("../../src/index.js");
    const { resetHiddenClasses } =
      await import("../../src/objects/maps/hidden-class.js");
    resetHiddenClasses();
    const engine = new MiniJIT();

    const src =
      "function outer() { function add(a, b) { return a + b; } return add(3, 4); } outer();";

    const compiled = engine.compile(src, { lazy: true });
    const result = engine.executeValue(compiled);
    assert.equal(result.value, 7);
  });
});
