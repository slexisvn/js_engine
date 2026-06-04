import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";

function runVal(source) {
  return new MiniJIT().runValue(source).value;
}

function assertThrowsReference(source, pattern) {
  assert.throws(
    () => new MiniJIT().run(source),
    pattern || /before initialization/,
  );
}

describe("JS binding hoisting semantics", () => {
  it("hoists var declarations with undefined", () => {
    assert.equal(runVal("x; var x = 1;"), undefined);
  });

  it("does not reset an initialized var on redeclaration without initializer", () => {
    assert.equal(runVal("var x = 1; var x; x;"), 1);
  });

  it("keeps var function-scoped outside blocks", () => {
    assert.equal(runVal("if (true) { var x = 42; } x;"), 42);
  });

  it("throws for let access in the temporal dead zone", () => {
    assertThrowsReference("x; let x = 1;");
  });

  it("throws for const access in the temporal dead zone", () => {
    assertThrowsReference("x; const x = 1;");
  });

  it("uses block-scoped let shadowing with TDZ", () => {
    assertThrowsReference("let x = 1; { x; let x = 2; }");
  });

  it("allows let after initialization", () => {
    assert.equal(runVal("let x; x = 5; x;"), 5);
  });

  it("keeps const assignment illegal", () => {
    assert.throws(
      () => new MiniJIT().run("const x = 1; x = 2;"),
      /Assignment to constant variable/,
    );
  });

  it("hoists function declarations before execution", () => {
    assert.equal(
      runVal("let result = f(); function f() { return 7; } result;"),
      7,
    );
  });
});
