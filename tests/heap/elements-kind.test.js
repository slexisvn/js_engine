import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createJSArray } from "../../src/objects/heap/factory.js";
import {
  PACKED_SMI,
  PACKED_DOUBLE,
  PACKED_TAGGED,
  HOLEY_SMI,
  HOLEY_DOUBLE,
  HOLEY_TAGGED,
} from "../../src/objects/elements/elements-kind.js";
import {
  mkSmi,
  mkDouble,
  mkString,
  mkObject,
  mkUndefined,
} from "../../src/core/value/index.js";
import { createJSObject } from "../../src/objects/heap/factory.js";

describe("ElementsKind", () => {
  it("starts packed smi for integer arrays", () => {
    const arr = createJSArray([mkSmi(1), mkSmi(2), mkSmi(3)]);
    assert.equal(arr.getElementsKind(), PACKED_SMI);
  });

  it("transitions smi arrays to packed double", () => {
    const arr = createJSArray([mkSmi(1), mkSmi(2)]);
    arr.setIndex(1, mkDouble(2.5));
    assert.equal(arr.getElementsKind(), PACKED_DOUBLE);
  });

  it("transitions numeric arrays to packed tagged", () => {
    const arr = createJSArray([mkSmi(1), mkDouble(2.5)]);
    arr.setIndex(0, mkString("x"));
    assert.equal(arr.getElementsKind(), PACKED_TAGGED);
  });

  it("transitions packed arrays to holey when writing past length", () => {
    const arr = createJSArray([mkSmi(1), mkSmi(2), mkSmi(3)]);
    arr.setIndex(5, mkSmi(6));
    assert.equal(arr.getElementsKind(), HOLEY_SMI);
    assert.equal(arr.getLength(), 6);
    assert.equal(arr.getIndex(4), undefined);
  });

  it("keeps holey state after truncating length", () => {
    const arr = createJSArray([mkSmi(1)]);
    arr.setLength(4);
    assert.equal(arr.getElementsKind(), HOLEY_SMI);
    arr.setLength(1);
    assert.equal(arr.getElementsKind(), HOLEY_SMI);
  });

  it("does not downgrade tagged or holey arrays", () => {
    const arr = createJSArray([mkObject(createJSObject())]);
    assert.equal(arr.getElementsKind(), PACKED_TAGGED);
    arr.setIndex(4, mkDouble(1.5));
    assert.equal(arr.getElementsKind(), HOLEY_TAGGED);
    arr.setIndex(1, mkSmi(1));
    assert.equal(arr.getElementsKind(), HOLEY_TAGGED);
  });

  it("preserves double payload after becoming holey", () => {
    const arr = createJSArray([mkDouble(1.5)]);
    arr.setLength(3);
    assert.equal(arr.getElementsKind(), HOLEY_DOUBLE);
    arr.setIndex(1, mkSmi(2));
    assert.equal(arr.getElementsKind(), HOLEY_DOUBLE);
  });

  it("treats explicit undefined values as tagged values", () => {
    const arr = createJSArray([mkUndefined()]);
    assert.equal(arr.getElementsKind(), PACKED_TAGGED);
  });
});
