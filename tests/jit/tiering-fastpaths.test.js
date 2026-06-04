import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";
import { DEOPT_RUNTIME_STUB_FAILURE } from "../../src/deopt/deoptimizer.js";

describe("tiering fast paths", () => {
  it("keeps recursive calls correct by deopting unsupported optimized self-entry", () => {
    const engine = new MiniJIT();
    const compiled = engine.compile(`
function recur(n) {
  if (n < 2) { return n; }
  return recur(n - 1) + recur(n - 2);
}
recur(8);
`);
    for (let i = 0; i < 24; i++) engine.interpreter.execute(compiled);
    const recurFn = compiled.constants.find((c) => c && c.name === "recur");
    assert.equal(getPayload(engine.interpreter.execute(compiled)), 21);
    assert.equal(recurFn.lastDeoptReason, DEOPT_RUNTIME_STUB_FAILURE);
  });

  it("uses generic smi fast paths without specializing names", () => {
    const engine = new MiniJIT();
    const result = engine.run(`
function calc(a, b) {
  let out = 0;
  let i = 0;
  while (i < 40) {
    out = out + a * b - i;
    i = i + 1;
  }
  return out >= 0;
}
calc(7, 9);
`);
    assert.equal(getPayload(result), true);
  });

  it("builds constructor stubs from bytecode shape, not constructor names", () => {
    const engine = new MiniJIT();
    const compiled = engine.compile(`
function Recordish(alpha, beta, gamma) {
  this.left = alpha;
  this.middle = beta;
  this.right = gamma;
}
function run() {
  let obj = new Recordish(3, 4, 5);
  return obj.left + obj.middle + obj.right;
}
run();
`);
    assert.equal(getPayload(engine.interpreter.execute(compiled)), 12);
    const ctor = compiled.constants.find((c) => c && c.name === "Recordish");
    assert.ok(ctor.constructorStub);
  });
});
