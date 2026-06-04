import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("Boolean.prototype methods", () => {
  it("toString on true", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("true.toString();")), "true");
  });

  it("toString on false", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("false.toString();")), "false");
  });

  it("valueOf on true", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("true.valueOf();")), true);
  });

  it("valueOf on false", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run("false.valueOf();")), false);
  });
});
