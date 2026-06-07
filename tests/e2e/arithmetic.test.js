import { describe, it, expect, beforeEach } from "vitest";
import { MiniJIT } from "../../src/api/engine.js";

describe("E2E: arithmetic and numeric operations", () => {
  let engine;

  beforeEach(() => {
    engine = new MiniJIT();
  });

  it("adds two integers", () => {
    const r = engine.runValue("2 + 3");
    expect(r.value).toBe(5);
  });

  it("subtracts", () => {
    expect(engine.runValue("10 - 7").value).toBe(3);
  });

  it("multiplies", () => {
    expect(engine.runValue("6 * 7").value).toBe(42);
  });

  it("divides integers producing double", () => {
    const r = engine.runValue("7 / 2");
    expect(r.value).toBe(3.5);
    expect(r.tag).toBe("double");
  });

  it("modulo", () => {
    expect(engine.runValue("17 % 5").value).toBe(2);
  });

  it("unary negation", () => {
    expect(engine.runValue("-42").value).toBe(-42);
  });

  it("chained arithmetic respects precedence", () => {
    expect(engine.runValue("2 + 3 * 4").value).toBe(14);
  });

  it("parentheses override precedence", () => {
    expect(engine.runValue("(2 + 3) * 4").value).toBe(20);
  });

  it("floating point addition", () => {
    const r = engine.runValue("0.1 + 0.2");
    expect(r.value).toBeCloseTo(0.3, 10);
  });

  it("integer overflow produces double", () => {
    const r = engine.runValue("2147483647 + 1");
    expect(r.value).toBe(2147483648);
  });

  it("bitwise AND", () => {
    expect(engine.runValue("0xFF & 0x0F").value).toBe(0x0F);
  });

  it("bitwise OR", () => {
    expect(engine.runValue("0xF0 | 0x0F").value).toBe(0xFF);
  });

  it("bitwise XOR", () => {
    expect(engine.runValue("5 ^ 3").value).toBe(6);
  });

  it("left shift", () => {
    expect(engine.runValue("1 << 10").value).toBe(1024);
  });

  it("right shift", () => {
    expect(engine.runValue("1024 >> 3").value).toBe(128);
  });

  it("unsigned right shift", () => {
    expect(engine.runValue("-1 >>> 0").value).toBe(4294967295);
  });

  it("bitwise NOT", () => {
    expect(engine.runValue("~0").value).toBe(-1);
  });

  it("complex expression with mixed ops", () => {
    expect(engine.runValue("((10 + 5) * 2 - 4) / 2").value).toBe(13);
  });

  it("pre-increment in expression", () => {
    expect(engine.runValue("var x = 5; ++x;").value).toBe(6);
  });

  it("post-increment returns old value", () => {
    expect(engine.runValue("var x = 5; x++;").value).toBe(5);
  });

  it("compound assignment operators", () => {
    expect(engine.runValue("var x = 10; x += 5; x -= 3; x *= 2; x;").value).toBe(24);
  });
});
