import { describe, it, expect } from "vitest";
import {
  requiresInterpreterOnly,
  errorToTaggedValue,
  RegisterMiniJITException,
} from "../../../src/bytecode/register/interpreter/helpers.js";
import {
  RegisterCompiledFunction,
  RegisterInstruction,
  ROP_ADD,
  ROP_RETURN,
  ROP_AWAIT,
  ROP_GET_ITERATOR,
  ROP_YIELD,
} from "../../../src/bytecode/register/ops/bytecode.js";
import { mkString, getPayload } from "../../../src/core/value/index.js";

describe("requiresInterpreterOnly", () => {
  it("returns true for async functions", () => {
    const fn = new RegisterCompiledFunction("asyncFn", 0);
    fn.isAsync = true;
    expect(requiresInterpreterOnly(fn)).toBe(true);
  });

  it("returns true when instructions contain interpreter-only ops (await, yield, iterators)", () => {
    for (const op of [ROP_AWAIT, ROP_GET_ITERATOR, ROP_YIELD]) {
      const fn = new RegisterCompiledFunction("test", 0);
      fn.instructions = [new RegisterInstruction(op)];
      expect(requiresInterpreterOnly(fn)).toBe(true);
    }
  });

  it("returns false for normal sync functions without special ops", () => {
    const fn = new RegisterCompiledFunction("simple", 0);
    fn.instructions = [
      new RegisterInstruction(ROP_ADD, 0, 0),
      new RegisterInstruction(ROP_RETURN),
    ];
    expect(requiresInterpreterOnly(fn)).toBe(false);
  });
});

describe("errorToTaggedValue", () => {
  it("unwraps RegisterMiniJITException to its inner value", () => {
    const val = mkString("boom");
    const ex = new RegisterMiniJITException(val);
    expect(errorToTaggedValue(ex)).toBe(val);
  });

  it("converts plain Error to tagged string with message", () => {
    const result = errorToTaggedValue(new Error("something broke"));
    expect(getPayload(result)).toContain("something broke");
  });
});
