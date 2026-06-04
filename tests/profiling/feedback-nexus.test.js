import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FeedbackSlot,
  FeedbackVector,
  FEEDBACK_BINARY_OP,
  FEEDBACK_CALL,
  FEEDBACK_PROPERTY,
  FEEDBACK_UNARY_OP,
} from "../../src/feedback/vector/index.js";
import {
  FeedbackNexus,
  FEEDBACK_HINT_MEGAMORPHIC,
  FEEDBACK_HINT_MONOMORPHIC,
  FEEDBACK_HINT_POLYMORPHIC,
} from "../../src/feedback/nexus/index.js";
import { TypeKind } from "../../src/optimizing/types/lattice.js";
import {
  PACKED_DOUBLE,
  PACKED_SMI,
} from "../../src/objects/elements/elements-kind.js";

describe("FeedbackNexus", () => {
  it("joins observed binary operand tags into a lattice type", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_BINARY_OP);
    vector.getSlot(0).recordBinaryOp("smi", "double");
    const hint = new FeedbackNexus(vector).binaryOp(0);
    assert.equal(hint.inputType.kind, TypeKind.Number);
  });

  it("reports binary operator feedback state from operand pair diversity", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_BINARY_OP);
    const slot = vector.getSlot(0);
    slot.recordBinaryOp("smi", "smi");
    assert.equal(
      new FeedbackNexus(vector).binaryOp(0).state,
      FEEDBACK_HINT_MONOMORPHIC,
    );
    slot.recordBinaryOp("string", "smi");
    assert.equal(
      new FeedbackNexus(vector).binaryOp(0).state,
      FEEDBACK_HINT_POLYMORPHIC,
    );
  });

  it("reports unary operator feedback state from operand tag diversity", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_UNARY_OP);
    const slot = vector.getSlot(0);
    slot.recordUnaryOp("smi");
    assert.equal(
      new FeedbackNexus(vector).unaryOp(0).state,
      FEEDBACK_HINT_MONOMORPHIC,
    );
    slot.recordUnaryOp("double");
    assert.equal(
      new FeedbackNexus(vector).unaryOp(0).state,
      FEEDBACK_HINT_POLYMORPHIC,
    );
  });

  it("returns monomorphic property shape with map version and field offset", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_PROPERTY);
    vector.getSlot(0).recordPropertyAccess(41, 3, 9, 0);
    const hint = new FeedbackNexus(vector).property(0);
    assert.equal(hint.kind, FEEDBACK_HINT_MONOMORPHIC);
    assert.equal(hint.objectType.kind, TypeKind.Object);
    assert.equal(hint.objectType.map, 41);
    assert.equal(hint.mapVersion, 9);
    assert.equal(hint.offset, 3);
  });

  it("returns polymorphic property shapes without choosing a benchmark-favored map", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_PROPERTY);
    vector.getSlot(0).recordPropertyAccess(17, 1, 2, 0);
    vector.getSlot(0).recordPropertyAccess(29, 5, 7, 0);
    const hint = new FeedbackNexus(vector).property(0);
    assert.equal(hint.kind, FEEDBACK_HINT_POLYMORPHIC);
    assert.deepEqual(hint.maps, [17, 29]);
    assert.deepEqual(hint.offsets, [1, 5]);
  });

  it("returns megamorphic property feedback as unsupported specialization input", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_PROPERTY);
    for (let i = 0; i < 5; i++)
      vector.getSlot(0).recordPropertyAccess(100 + i, i, i, 0);
    const hint = new FeedbackNexus(vector).property(0);
    assert.equal(hint.kind, FEEDBACK_HINT_MEGAMORPHIC);
  });

  it("returns monomorphic array elements kind for index access", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_PROPERTY);
    vector.getSlot(0).recordArrayAccess(true, true, PACKED_SMI);
    const hint = new FeedbackNexus(vector).elements(0);
    assert.equal(hint.kind, FEEDBACK_HINT_MONOMORPHIC);
    assert.equal(hint.arrayAccess, true);
    assert.equal(hint.elementsKind, PACKED_SMI);
    assert.equal(hint.arrayType.kind, TypeKind.Array);
  });

  it("keeps multiple elements kinds visible instead of pretending one kind is stable", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_PROPERTY);
    vector.getSlot(0).recordArrayAccess(true, true, PACKED_SMI);
    vector.getSlot(0).recordArrayAccess(true, true, PACKED_DOUBLE);
    const hint = new FeedbackNexus(vector).elements(0);
    assert.equal(hint.kind, FEEDBACK_HINT_POLYMORPHIC);
    assert.deepEqual(hint.observedKinds, [PACKED_SMI, PACKED_DOUBLE]);
    assert.equal(hint.elementsKind, null);
  });

  it("tracks call targets by compiled identity even when names and ids match", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_CALL);
    const left = { id: 11, version: 0, name: "same" };
    const right = { id: 11, version: 0, name: "same" };
    const slot = vector.getSlot(0);
    slot.recordCallTarget("same", left, 2);
    slot.recordCallTarget("same", right, 2);
    const hint = new FeedbackNexus(vector).call(0);
    assert.equal(hint.kind, FEEDBACK_HINT_POLYMORPHIC);
    assert.deepEqual(
      hint.targets.map((target) => target.ref),
      [left, right],
    );
  });

  it("returns monomorphic call hint with target identity and call-site frequency", () => {
    const vector = new FeedbackVector(1);
    vector.initSlot(0, FEEDBACK_CALL);
    const target = { id: 19, version: 3, name: "sameDisplayName" };
    const slot = vector.getSlot(0);
    for (let i = 0; i < 5; i++)
      slot.recordCallTarget("sameDisplayName", target, 2);
    const hint = new FeedbackNexus(vector).call(0);
    assert.equal(hint.kind, FEEDBACK_HINT_MONOMORPHIC);
    assert.equal(hint.targetRef, target);
    assert.equal(hint.targetVersion, 3);
    assert.equal(hint.argCount, 2);
    assert.equal(hint.frequency, 5);
  });
});
