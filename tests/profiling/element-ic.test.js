import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InlineCache,
  IC_MONOMORPHIC,
  IC_POLYMORPHIC,
  IC_MEGAMORPHIC,
} from "../../src/feedback/ic/index.js";
import {
  FeedbackSlot,
  FEEDBACK_PROPERTY,
} from "../../src/feedback/vector/index.js";
import { createJSArray } from "../../src/objects/heap/factory.js";
import {
  PACKED_SMI,
  PACKED_DOUBLE,
  PACKED_TAGGED,
  HOLEY_SMI,
  HOLEY_DOUBLE,
} from "../../src/objects/elements/elements-kind.js";
import { mkSmi, mkDouble, mkString } from "../../src/core/value/index.js";

describe("Element InlineCache", () => {
  it("creates a monomorphic element load IC", () => {
    const ic = new InlineCache("elem_site");
    const arr = createJSArray([mkSmi(1)]);
    ic.lookupElement(arr, 0);
    ic.lookupElement(arr, 0);
    assert.equal(ic.elementLoadIC.state, IC_MONOMORPHIC);
    assert.equal(ic.elementLoadIC.entries[0].elementsKind, PACKED_SMI);
    assert.equal(ic.elementLoadIC.hitCount, 1);
  });

  it("creates a polymorphic element load IC across elements kinds", () => {
    const ic = new InlineCache("elem_site");
    const smi = createJSArray([mkSmi(1)]);
    const dbl = createJSArray([mkDouble(1.5)]);
    ic.lookupElement(smi, 0);
    ic.lookupElement(dbl, 0);
    assert.equal(ic.elementLoadIC.state, IC_POLYMORPHIC);
    assert.deepEqual(
      ic.elementLoadIC.entries.map((e) => e.elementsKind),
      [PACKED_SMI, PACKED_DOUBLE],
    );
  });

  it("transitions element load IC to megamorphic after too many kinds", () => {
    const ic = new InlineCache("elem_site");
    const arrays = [
      createJSArray([mkSmi(1)]),
      createJSArray([mkDouble(1.5)]),
      createJSArray([mkString("x")]),
      createJSArray([mkSmi(1)]),
      createJSArray([mkDouble(1.5)]),
    ];
    arrays[3].setIndex(2, mkSmi(3));
    arrays[4].setIndex(2, mkDouble(3.5));

    for (const arr of arrays) {
      ic.lookupElement(arr, 0);
    }

    assert.equal(ic.elementLoadIC.state, IC_MEGAMORPHIC);
    assert.equal(ic.elementLoadIC.entries, null);
  });

  it("refreshes element store IC when store changes elements kind", () => {
    const ic = new InlineCache("elem_store_site");
    const arr = createJSArray([mkSmi(1)]);
    ic.lookupElementForWrite(arr, 0, mkDouble(1.5));
    assert.equal(arr.getElementsKind(), PACKED_DOUBLE);
    assert.equal(ic.elementStoreIC.state, IC_POLYMORPHIC);
    assert.deepEqual(
      ic.elementStoreIC.entries.map((e) => e.elementsKind),
      [PACKED_SMI, PACKED_DOUBLE],
    );
  });

  it("records array feedback by elements kind", () => {
    const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
    slot.recordArrayAccess(true, true, PACKED_SMI);
    slot.recordArrayAccess(true, true, PACKED_DOUBLE);
    assert.equal(slot.icState, IC_POLYMORPHIC);
    assert.equal(slot.arrayAccessCount, 2);
    assert.equal(slot.integerIndexCount, 2);
    assert.deepEqual(slot.getObservedElementsKinds(), [
      PACKED_SMI,
      PACKED_DOUBLE,
    ]);
    assert.equal(slot.hasOnlyArrayAccesses(), true);
  });

  it("marks mixed indexed feedback as megamorphic", () => {
    const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
    slot.recordArrayAccess(true, true, PACKED_SMI);
    slot.recordArrayAccess(false, true, null);
    assert.equal(slot.icState, IC_MEGAMORPHIC);
    assert.equal(slot.hasOnlyArrayAccesses(), false);
  });
});
