import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("Promise runtime", () => {
  it("runs then reactions through microtasks", () => {
    const engine = new MiniJIT();
    const result = engine.runValue(`
function inc(x) { return x + 1; }
let p = Promise.resolve(1).then(inc);
p;
`);
    assert.equal(result.tag, "promise");
    assert.equal(result.value.state, "fulfilled");
    assert.equal(getPayload(result.value.result), 2);
  });

  it("handles rejection catch and finally", () => {
    const engine = new MiniJIT();
    const result = engine.runValue(`
let ran = 0;
function mark() { ran = 1; }
function recover(x) { return x + ran; }
let p = Promise.reject(4).finally(mark).catch(recover);
p;
`);
    assert.equal(result.value.state, "fulfilled");
    assert.equal(getPayload(result.value.result), 5);
  });

  it("resolves all and race", () => {
    const engine = new MiniJIT();
    const all = engine.runValue("Promise.all([Promise.resolve(1), 2]);");
    assert.equal(all.value.state, "fulfilled");
    assert.deepEqual(
      getPayload(all.value.result).elements.map((v) => getPayload(v)),
      [1, 2],
    );

    const race = engine.runValue(
      "Promise.race([Promise.resolve(7), Promise.resolve(9)]);",
    );
    assert.equal(race.value.state, "fulfilled");
    assert.equal(getPayload(race.value.result), 7);
  });

  it("assimilates thenable objects", () => {
    const engine = new MiniJIT();
    const result = engine.runValue(`
function then(resolve, reject) {
  resolve(8);
}
let t = {};
t.then = then;
Promise.resolve(t);
`);
    assert.equal(result.value.state, "fulfilled");
    assert.equal(getPayload(result.value.result), 8);
  });
});

describe("async await", () => {
  it("returns a promise and resumes after await", () => {
    const engine = new MiniJIT();
    const result = engine.runValue(`
async function f() {
  let x = await Promise.resolve(4);
  return x + 1;
}
f();
`);
    assert.equal(result.tag, "promise");
    assert.equal(result.value.state, "fulfilled");
    assert.equal(getPayload(result.value.result), 5);
  });

  it("routes rejected await through catch", () => {
    const engine = new MiniJIT();
    const result = engine.runValue(`
async function f() {
  try {
    let x = await Promise.reject(7);
    return x;
  } catch (e) {
    return e + 2;
  }
}
f();
`);
    assert.equal(result.value.state, "fulfilled");
    assert.equal(getPayload(result.value.result), 9);
  });

  it("preserves this for async methods", () => {
    const engine = new MiniJIT();
    const result = engine.runValue(`
let o = { x: 4 };
async function m() {
  return this.x + await Promise.resolve(3);
}
o.m = m;
o.m();
`);
    assert.equal(result.value.state, "fulfilled");
    assert.equal(getPayload(result.value.result), 7);
  });
});

describe("iterator protocol", () => {
  it("iterates arrays and strings with for-of", () => {
    const engine = new MiniJIT();
    const arr = engine.runValue(`
let s = 0;
for (let x of [1, 2, 3]) {
  s = s + x;
}
s;
`);
    assert.equal(arr.value, 6);

    const str = engine.runValue(`
let s = "";
for (let x of "abc") {
  s = s + x;
}
s;
`);
    assert.equal(str.value, "abc");
  });

  it("iterates custom @@iterator objects", () => {
    const engine = new MiniJIT();
    const result = engine.runValue(`
let i = 0;
function next() {
  if (i < 3) {
    i = i + 1;
    return { value: i, done: false };
  }
  return { value: 0, done: true };
}
function iter() {
  return { next: next };
}
let obj = {};
obj["@@iterator"] = iter;
let s = 0;
for (let x of obj) {
  s = s + x;
}
s;
`);
    assert.equal(result.value, 6);
  });
});
