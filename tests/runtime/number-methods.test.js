import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("Number.prototype methods", () => {
  it("toString converts number to string", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(42).toString();")), "42");
  });

  it("toString with radix 16", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(255).toString(16);")), "ff");
  });

  it("toString with radix 2", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(10).toString(2);")), "1010");
  });

  it("toFixed formats decimal places", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(3.14159).toFixed(2);")), "3.14");
  });

  it("toFixed with zero digits", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(3.7).toFixed(0);")), "4");
  });

  it("valueOf returns the number", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(42).valueOf();")), 42);
  });

  it("toPrecision formats with precision", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(1234.5).toPrecision(4);")), "1235");
  });

  it("toExponential formats in exponential notation", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(1234.5).toExponential(2);")), "1.23e+3");
  });

  it("works with double values", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("(0.1 + 0.2).toFixed(1);")), "0.3");
  });

  it("toString on negative number", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("var n = -42; n.toString();")), "-42");
  });
});
