import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { getPayload } from "../../src/core/value/index.js";

describe("String.prototype methods", () => {
  it("charAt returns character at index", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello".charAt(1);')), "e");
  });

  it("charCodeAt returns char code", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"A".charCodeAt(0);')), 65);
  });

  it("substring extracts sub-string", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello".substring(1, 4);')), "ell");
  });

  it("slice extracts with negative index", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello".slice(1, 4);')), "ell");
  });

  it("indexOf finds substring position", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello world".indexOf("world");')), 6);
  });

  it("indexOf returns -1 when not found", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello".indexOf("xyz");')), -1);
  });

  it("includes checks substring existence", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello world".includes("world");')), true);
    jit.reset();
    assert.equal(getPayload(jit.run('"hello".includes("xyz");')), false);
  });

  it("startsWith checks prefix", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello".startsWith("hel");')), true);
    jit.reset();
    assert.equal(getPayload(jit.run('"hello".startsWith("xyz");')), false);
  });

  it("endsWith checks suffix", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello".endsWith("llo");')), true);
  });

  it("split divides string into array", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let parts = "a,b,c".split(",");
      parts.length;
    `);
    assert.equal(getPayload(result), 3);
  });

  it("split returns correct elements", () => {
    const jit = new MiniJIT();
    const result = jit.run(`
      let parts = "hello world".split(" ");
      parts[0];
    `);
    assert.equal(getPayload(result), "hello");
  });

  it("replace substitutes first occurrence", () => {
    const jit = new MiniJIT();
    assert.equal(
      getPayload(jit.run('"hello world".replace("world", "jit");')),
      "hello jit",
    );
  });

  it("trim removes whitespace", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"  hello  ".trim();')), "hello");
  });

  it("trimStart removes leading whitespace", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"  hello  ".trimStart();')), "hello  ");
  });

  it("trimEnd removes trailing whitespace", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"  hello  ".trimEnd();')), "  hello");
  });

  it("toLowerCase converts to lowercase", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"HELLO".toLowerCase();')), "hello");
  });

  it("toUpperCase converts to uppercase", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"hello".toUpperCase();')), "HELLO");
  });

  it("repeat duplicates string", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"ab".repeat(3);')), "ababab");
  });

  it("padStart pads from the left", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"5".padStart(3, "0");')), "005");
  });

  it("padEnd pads from the right", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"5".padEnd(3, "0");')), "500");
  });

  it("concat joins strings", () => {
    const jit = new MiniJIT();
    assert.equal(
      getPayload(jit.run('"hello".concat(" ", "world");')),
      "hello world",
    );
  });

  it("method chaining works", () => {
    const jit = new MiniJIT();
    assert.equal(
      getPayload(jit.run('"hello world".toUpperCase().slice(0, 5);')),
      "HELLO",
    );
  });

  it("lastIndexOf finds last occurrence", () => {
    const jit = new MiniJIT();
    assert.equal(getPayload(jit.run('"abcabc".lastIndexOf("bc");')), 4);
  });
});
