import {
  IC_MEGAMORPHIC,
  IC_MONOMORPHIC,
  IC_POLYMORPHIC,
} from "../vector/index.js";
import {
  anyType,
  arrayType,
  booleanType,
  doubleType,
  joinTypes,
  nullishType,
  numberType,
  objectType,
  smiType,
  stringType,
} from "../../optimizing/types/lattice.js";

export const FEEDBACK_HINT_GENERIC = "generic";
export const FEEDBACK_HINT_MONOMORPHIC = "monomorphic";
export const FEEDBACK_HINT_POLYMORPHIC = "polymorphic";
export const FEEDBACK_HINT_MEGAMORPHIC = "megamorphic";

export class FeedbackNexus {
  constructor(vector) {
    this.vector = vector;
  }

  getSlot(index) {
    if (index < 0 || !this.vector) return null;
    return this.vector.getSlot(index);
  }

  binaryOp(index) {
    const slot = this.getSlot(index);
    return {
      slot,
      inputType: observedBinaryType(slot),
      state: slot ? slot.icState : FEEDBACK_HINT_GENERIC,
      stable: isStableSlot(slot),
    };
  }

  unaryOp(index) {
    const slot = this.getSlot(index);
    return {
      slot,
      inputType: observedUnaryType(slot),
      state: slot ? slot.icState : FEEDBACK_HINT_GENERIC,
      stable: isStableSlot(slot),
    };
  }

  property(index) {
    const slot = this.getSlot(index);
    if (!slot) return { slot: null, kind: FEEDBACK_HINT_GENERIC };
    if (slot.icState === IC_MONOMORPHIC) {
      return {
        slot,
        kind: FEEDBACK_HINT_MONOMORPHIC,
        objectType: objectHintType(slot),
        map: slot.getMonomorphicMap(),
        mapVersion: slot.getMonomorphicMapVersion(),
        offset: slot.getMonomorphicOffset(),
        protoDepth: slot.getMonomorphicProtoDepth(),
        stable: isStableSlot(slot),
      };
    }
    if (slot.icState === IC_POLYMORPHIC) {
      return {
        slot,
        kind: FEEDBACK_HINT_POLYMORPHIC,
        maps: slot.getPolymorphicMaps() || [],
        mapVersions: slot.getPolymorphicMapVersions() || [],
        offsets: slot.getPolymorphicOffsets() || [],
        protoDepths: slot.getPolymorphicProtoDepths() || [],
        stable: isStableSlot(slot),
      };
    }
    if (slot.icState === IC_MEGAMORPHIC) {
      return { slot, kind: FEEDBACK_HINT_MEGAMORPHIC, stable: false };
    }
    return { slot, kind: FEEDBACK_HINT_GENERIC, stable: isStableSlot(slot) };
  }

  elements(index) {
    const slot = this.getSlot(index);
    if (!slot) return { slot: null, kind: FEEDBACK_HINT_GENERIC };
    const kinds = slot.getObservedElementsKinds();
    const elementsKind = slot.getMonomorphicElementsKind();
    const arrayAccess = slot.hasOnlyArrayAccesses();
    const lengthAccess = slot.hasOnlyArrayLengthAccesses();
    return {
      slot,
      kind:
        slot.icState === IC_MEGAMORPHIC
          ? FEEDBACK_HINT_MEGAMORPHIC
          : elementsKind
            ? FEEDBACK_HINT_MONOMORPHIC
            : FEEDBACK_HINT_POLYMORPHIC,
      arrayType: arrayType(elementsKind),
      arrayAccess,
      lengthAccess,
      elementsKind,
      observedKinds: kinds,
      stable: isStableSlot(slot),
    };
  }

  call(index) {
    const slot = this.getSlot(index);
    if (!slot)
      return {
        slot: null,
        kind: FEEDBACK_HINT_GENERIC,
        target: null,
        targets: null,
        frequency: 0,
      };
    if (slot.icState === IC_MONOMORPHIC) {
      return {
        slot,
        kind: FEEDBACK_HINT_MONOMORPHIC,
        target: slot.getMonomorphicCallTarget(),
        targetVersion: slot.getMonomorphicCallTargetVersion(),
        argCount: slot.getMonomorphicCallArgCount(),
        receiverMap: slot.getMonomorphicReceiverMap(),
        receiverMapVersion:
          slot.callReceiverMapVersions.length === 1
            ? slot.callReceiverMapVersions[0]
            : null,
        targetRef: slot.getMonomorphicCallTargetRef(),
        frequency: slot.totalCallCount,
        stable: isStableSlot(slot),
      };
    }
    if (slot.icState === IC_POLYMORPHIC) {
      return {
        slot,
        kind: FEEDBACK_HINT_POLYMORPHIC,
        targets: slot.getPolymorphicCallTargets() || [],
        argCount: slot.getMonomorphicCallArgCount(),
        frequency: slot.totalCallCount,
        stable: isStableSlot(slot),
      };
    }
    if (slot.icState === IC_MEGAMORPHIC) {
      return {
        slot,
        kind: FEEDBACK_HINT_MEGAMORPHIC,
        target: null,
        targets: null,
        frequency: slot.totalCallCount,
        stable: false,
      };
    }
    return {
      slot,
      kind: FEEDBACK_HINT_GENERIC,
      target: null,
      targets: null,
      frequency: slot.totalCallCount,
      stable: isStableSlot(slot),
    };
  }

  branch(index) {
    const slot = this.getSlot(index);
    return {
      slot,
      bias: slot ? slot.getBranchBias() : "unknown",
      stable: isStableSlot(slot),
    };
  }

  returnType(index) {
    const slot = this.getSlot(index);
    if (!slot) return anyType();
    if (slot.hasOnlySmiReturns()) return smiType();
    if (slot.hasOnlyNumberReturns()) return numberType();
    return anyType();
  }
}

function isStableSlot(slot) {
  return (
    !!slot &&
    (slot.isStable ||
      (slot.totalRecordCount > 0 && slot.icState === IC_MONOMORPHIC))
  );
}

function observedBinaryType(slot) {
  if (!slot) return anyType();
  let type = null;
  for (const tag of slot.lhsTypeCounts.keys())
    type = joinTypes(type, typeFromFeedbackTag(tag));
  for (const tag of slot.rhsTypeCounts.keys())
    type = joinTypes(type, typeFromFeedbackTag(tag));
  return type || anyType();
}

function observedUnaryType(slot) {
  if (!slot) return anyType();
  let type = null;
  for (const tag of slot.typeCounts.keys())
    type = joinTypes(type, typeFromFeedbackTag(tag));
  return type || anyType();
}

function objectHintType(slot) {
  const elementsKind = slot.getMonomorphicElementsKind();
  if (elementsKind) return arrayType(elementsKind);
  return objectType(slot.getMonomorphicMap());
}

function typeFromFeedbackTag(tag) {
  if (tag === "smi") return smiType();
  if (tag === "double") return doubleType();
  if (tag === "number") return numberType();
  if (tag === "string") return stringType();
  if (tag === "boolean") return booleanType();
  if (tag === "null" || tag === "undefined") return nullishType();
  return anyType();
}
