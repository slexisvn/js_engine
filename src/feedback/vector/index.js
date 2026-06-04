import { tracer } from "../../core/tracing/index.js";

export const FEEDBACK_PROPERTY = "property";
export const FEEDBACK_BINARY_OP = "binary_op";
export const FEEDBACK_UNARY_OP = "unary_op";
export const FEEDBACK_CALL = "call";
export const FEEDBACK_ALLOCATION = "allocation";
export const FEEDBACK_BRANCH = "branch";

export const IC_UNINITIALIZED = "uninitialized";
export const IC_MONOMORPHIC = "monomorphic";
export const IC_POLYMORPHIC = "polymorphic";
export const IC_MEGAMORPHIC = "megamorphic";

const MAX_POLYMORPHIC_ENTRIES = 4;
const STABILITY_SETTLE_THRESHOLD = 50;

const LATTICE_ORDER = {
  [IC_UNINITIALIZED]: 0,
  [IC_MONOMORPHIC]: 1,
  [IC_POLYMORPHIC]: 2,
  [IC_MEGAMORPHIC]: 3,
};

export class FeedbackSlot {
  constructor(kind) {
    this.kind = kind;
    this.icState = IC_UNINITIALIZED;
    this.maps = [];
    this.mapVersions = [];
    this.offsets = [];
    this.protoDepths = [];
    this._mapIndex = new Map();
    this.typeCounts = new Map();
    this.lhsTypeCounts = new Map();
    this.rhsTypeCounts = new Map();
    this.callTargetCounts = new Map();
    this.callTargetIds = [];
    this.callTargetKeys = [];
    this.callTargetVersions = [];
    this._callTargetIndex = new Map();
    this._callTargetObjectKeys = new WeakMap();
    this._nextCallTargetObjectKey = 1;
    this.callArgCounts = new Map();
    this.callReceiverMaps = [];
    this.callReceiverMapVersions = [];
    this._receiverMapIndex = new Map();
    this.inlineDecisions = [];
    this.callTargetRef = null;
    this.totalCallCount = 0;
    this.allocationSiteHCs = new Set();
    this.arrayAccessCount = 0;
    this.arrayLengthAccessCount = 0;
    this.integerIndexCount = 0;
    this.elementsKindCounts = new Map();
    this.isStable = false;
    this.stableSinceCount = 0;
    this.lastTransitionTimestamp = 0;
    this.totalRecordCount = 0;
  }

  get lhsTypes() {
    return this.lhsTypeCounts;
  }

  get rhsTypes() {
    return this.rhsTypeCounts;
  }

  get callTargets() {
    return this.callTargetCounts;
  }

  _advanceLattice(newState) {
    const currentOrder = LATTICE_ORDER[this.icState];
    const newOrder = LATTICE_ORDER[newState];
    if (newOrder > currentOrder) {
      const prevState = this.icState;
      this.icState = newState;
      this.lastTransitionTimestamp = Date.now();
      this.stableSinceCount = 0;
      this.isStable = false;
      tracer.feedbackRecord(0, this.kind, `${prevState} → ${this.icState}`);
      return true;
    }
    return false;
  }

  _checkStability() {
    this.stableSinceCount++;
    if (this.stableSinceCount >= STABILITY_SETTLE_THRESHOLD && !this.isStable) {
      this.isStable = true;
    }
  }

  recordPropertyAccess(hiddenClassId, offset, mapVersion = 0, protoDepth = 0) {
    this.totalRecordCount++;
    const idx = this._mapIndex.get(hiddenClassId);
    if (idx !== undefined) {
      this.mapVersions[idx] = mapVersion;
      this.offsets[idx] = offset;
      this.protoDepths[idx] = protoDepth;
      this._checkStability();
      return;
    }

    if (this.icState === IC_UNINITIALIZED) {
      this._advanceLattice(IC_MONOMORPHIC);
    } else if (this.maps.length < MAX_POLYMORPHIC_ENTRIES) {
      this._advanceLattice(IC_POLYMORPHIC);
    } else {
      this._advanceLattice(IC_MEGAMORPHIC);
      return;
    }
    const newIdx = this.maps.length;
    this._mapIndex.set(hiddenClassId, newIdx);
    this.maps.push(hiddenClassId);
    this.mapVersions.push(mapVersion);
    this.offsets.push(offset);
    this.protoDepths.push(protoDepth);
  }

  recordUnaryOp(operandTag) {
    this.totalRecordCount++;
    const prev = this.typeCounts.get(operandTag) || 0;
    this.typeCounts.set(operandTag, prev + 1);
    if (prev === 0) this._recordTypeShape(this.typeCounts.size);
    this._checkStability();
  }

  recordBranch(taken) {
    this.totalRecordCount++;
    if (taken) {
      this.takenCount = (this.takenCount || 0) + 1;
    } else {
      this.notTakenCount = (this.notTakenCount || 0) + 1;
    }
    this._checkStability();
  }

  getBranchBias() {
    const taken = this.takenCount || 0;
    const notTaken = this.notTakenCount || 0;
    if (taken === 0 && notTaken === 0) return "unknown";
    if (taken > notTaken * 10) return "likely-true";
    if (notTaken > taken * 10) return "likely-false";
    return "mixed";
  }

  recordReturnType(tag) {
    this.totalRecordCount++;
    const key = `return:${tag}`;
    const prev = this.typeCounts.get(key) || 0;
    this.typeCounts.set(key, prev + 1);
  }

  hasOnlySmiReturns() {
    for (const [k, v] of this.typeCounts) {
      if (k.startsWith("return:") && k !== "return:smi") return false;
    }
    return this.typeCounts.has("return:smi");
  }

  hasOnlyNumberReturns() {
    for (const [k, v] of this.typeCounts) {
      if (
        k.startsWith("return:") &&
        k !== "return:smi" &&
        k !== "return:double"
      )
        return false;
    }
    return (
      this.typeCounts.has("return:smi") || this.typeCounts.has("return:double")
    );
  }

  recordBinaryOp(lhsTag, rhsTag) {
    this.totalRecordCount++;
    const lhsPrev = this.lhsTypeCounts.get(lhsTag) || 0;
    this.lhsTypeCounts.set(lhsTag, lhsPrev + 1);

    const rhsPrev = this.rhsTypeCounts.get(rhsTag) || 0;
    this.rhsTypeCounts.set(rhsTag, rhsPrev + 1);

    const combinedKey = `${lhsTag}|${rhsTag}`;
    const prev = this.typeCounts.get(combinedKey) || 0;
    this.typeCounts.set(combinedKey, prev + 1);

    if (prev === 0) this._recordTypeShape(this.typeCounts.size);
    this._checkStability();
  }

  _recordTypeShape(shapeCount) {
    if (shapeCount === 1 && this.icState === IC_UNINITIALIZED) {
      this._advanceLattice(IC_MONOMORPHIC);
    } else if (
      shapeCount <= MAX_POLYMORPHIC_ENTRIES &&
      this.icState === IC_MONOMORPHIC
    ) {
      this._advanceLattice(IC_POLYMORPHIC);
    } else if (shapeCount > MAX_POLYMORPHIC_ENTRIES) {
      this._advanceLattice(IC_MEGAMORPHIC);
    }
  }

  recordCallTarget(
    targetName,
    compiledFn = null,
    argCount = 0,
    receiverMapId = null,
    receiverMapVersion = null,
    inlineDecision = null,
  ) {
    this.totalRecordCount++;
    this.totalCallCount++;
    const targetId = compiledFn ? compiledFn.id : `builtin:${targetName}`;
    const targetVersion = compiledFn ? compiledFn.version : 0;
    const key = this._callTargetKey(targetName, compiledFn);
    const prev = this.callTargetCounts.get(key) || 0;
    this.callTargetCounts.set(key, prev + 1);
    this.callArgCounts.set(
      argCount,
      (this.callArgCounts.get(argCount) || 0) + 1,
    );

    const existingIdx = this._callTargetIndex.get(key);
    if (existingIdx === undefined) {
      const newIdx = this.callTargetIds.length;
      this._callTargetIndex.set(key, newIdx);
      this.callTargetKeys.push(key);
      this.callTargetIds.push(targetId);
      this.callTargetVersions.push(targetVersion);
    } else {
      this.callTargetVersions[existingIdx] = targetVersion;
    }

    if (receiverMapId !== null && receiverMapId !== undefined) {
      const receiverIdx = this._receiverMapIndex.get(receiverMapId);
      if (receiverIdx === undefined) {
        const newIdx = this.callReceiverMaps.length;
        this._receiverMapIndex.set(receiverMapId, newIdx);
        this.callReceiverMaps.push(receiverMapId);
        this.callReceiverMapVersions.push(receiverMapVersion || 0);
      } else {
        this.callReceiverMapVersions[receiverIdx] = receiverMapVersion || 0;
      }
    }

    if (inlineDecision)
      this.recordInlineDecision(inlineDecision.kind, inlineDecision.reason);

    if (compiledFn && this.callTargetIds.length === 1)
      this.callTargetRef = compiledFn;

    if (compiledFn) {
      if (!this.callTargetRefs) this.callTargetRefs = new Map();
      this.callTargetRefs.set(key, compiledFn);
    }

    if (this.icState === IC_UNINITIALIZED) {
      this._advanceLattice(IC_MONOMORPHIC);
    } else if (
      this.callTargetIds.length > 1 &&
      this.icState === IC_MONOMORPHIC
    ) {
      this._advanceLattice(IC_POLYMORPHIC);
      this.callTargetRef = null;
    } else if (this.callTargetIds.length > MAX_POLYMORPHIC_ENTRIES) {
      this._advanceLattice(IC_MEGAMORPHIC);
      this.callTargetRef = null;
    }
    this._checkStability();
  }

  _callTargetKey(targetName, compiledFn) {
    if (
      !compiledFn ||
      (typeof compiledFn !== "object" && typeof compiledFn !== "function")
    ) {
      return `builtin:${targetName}`;
    }
    let key = this._callTargetObjectKeys.get(compiledFn);
    if (!key) {
      key = `fn:${this._nextCallTargetObjectKey++}`;
      this._callTargetObjectKeys.set(compiledFn, key);
    }
    return key;
  }

  recordInlineDecision(kind, reason) {
    this.inlineDecisions.push({ kind, reason });
    if (this.inlineDecisions.length > 16) this.inlineDecisions.shift();
  }
  recordAllocationSite(hiddenClassId) {
    this.totalRecordCount++;
    this.allocationSiteHCs.add(hiddenClassId);
  }

  recordArrayAccess(isArrayObj, isIntegerIndex, elementsKind = null) {
    this.totalRecordCount++;
    if (isArrayObj) this.arrayAccessCount++;
    if (isIntegerIndex) this.integerIndexCount++;
    if (isArrayObj && isIntegerIndex) {
      if (elementsKind) {
        const prev = this.elementsKindCounts.get(elementsKind) || 0;
        this.elementsKindCounts.set(elementsKind, prev + 1);
      }
      if (this.icState === IC_UNINITIALIZED) {
        this._advanceLattice(IC_MONOMORPHIC);
      } else if (
        this.elementsKindCounts.size > 1 &&
        this.icState === IC_MONOMORPHIC
      ) {
        this._advanceLattice(IC_POLYMORPHIC);
      } else if (this.elementsKindCounts.size > MAX_POLYMORPHIC_ENTRIES) {
        this._advanceLattice(IC_MEGAMORPHIC);
      }
      this._checkStability();
    } else {
      this._advanceLattice(IC_MEGAMORPHIC);
    }
  }

  recordArrayLengthAccess(isArrayObj, elementsKind = null) {
    this.totalRecordCount++;
    if (!isArrayObj) {
      this._advanceLattice(IC_MEGAMORPHIC);
      return;
    }

    this.arrayLengthAccessCount++;
    if (elementsKind) {
      const prev = this.elementsKindCounts.get(elementsKind) || 0;
      this.elementsKindCounts.set(elementsKind, prev + 1);
    }
    if (this.icState === IC_UNINITIALIZED) {
      this._advanceLattice(IC_MONOMORPHIC);
    } else if (
      this.elementsKindCounts.size > 1 &&
      this.icState === IC_MONOMORPHIC
    ) {
      this._advanceLattice(IC_POLYMORPHIC);
    } else if (this.elementsKindCounts.size > MAX_POLYMORPHIC_ENTRIES) {
      this._advanceLattice(IC_MEGAMORPHIC);
    }
    this._checkStability();
  }

  hasOnlyArrayAccesses() {
    return (
      this.arrayAccessCount > 0 &&
      this.arrayAccessCount === this.integerIndexCount &&
      this.icState !== IC_MEGAMORPHIC
    );
  }

  hasOnlyArrayLengthAccesses() {
    return (
      this.arrayLengthAccessCount > 0 &&
      this.arrayAccessCount === 0 &&
      this.icState !== IC_MEGAMORPHIC
    );
  }

  getObservedElementsKinds() {
    return [...this.elementsKindCounts.keys()];
  }

  getMonomorphicElementsKind() {
    if (this.icState === IC_MONOMORPHIC && this.elementsKindCounts.size === 1) {
      return this.elementsKindCounts.keys().next().value;
    }
    return null;
  }

  isMonomorphic() {
    return this.icState === IC_MONOMORPHIC;
  }
  isPolymorphic() {
    return this.icState === IC_POLYMORPHIC;
  }
  isMegamorphic() {
    return this.icState === IC_MEGAMORPHIC;
  }

  getMonomorphicMap() {
    if (this.icState === IC_MONOMORPHIC && this.maps.length === 1)
      return this.maps[0];
    return null;
  }

  getMonomorphicOffset() {
    if (this.icState === IC_MONOMORPHIC && this.offsets.length === 1)
      return this.offsets[0];
    return null;
  }

  getMonomorphicMapVersion() {
    if (this.icState === IC_MONOMORPHIC && this.mapVersions.length === 1)
      return this.mapVersions[0];
    return null;
  }

  getMonomorphicProtoDepth() {
    if (this.icState === IC_MONOMORPHIC && this.protoDepths.length === 1)
      return this.protoDepths[0];
    return 0;
  }

  getPolymorphicMaps() {
    if (this.icState === IC_POLYMORPHIC) return this.maps;
    return null;
  }

  getPolymorphicOffsets() {
    if (this.icState === IC_POLYMORPHIC) return this.offsets;
    return null;
  }

  getPolymorphicMapVersions() {
    if (this.icState === IC_POLYMORPHIC) return this.mapVersions;
    return null;
  }

  getPolymorphicProtoDepths() {
    if (this.icState === IC_POLYMORPHIC) return this.protoDepths;
    return null;
  }

  getMonomorphicCallTarget() {
    if (this.callTargetIds.length === 1) {
      return this.callTargetIds[0];
    }
    return null;
  }

  getMonomorphicCallTargetRef() {
    if (this.callTargetIds.length === 1) return this.callTargetRef;
    return null;
  }

  getMonomorphicCallTargetVersion() {
    if (this.callTargetVersions.length === 1) return this.callTargetVersions[0];
    return null;
  }

  getPolymorphicCallTargets() {
    if (!this.isPolymorphic() || !this.callTargetRefs) return null;
    const targets = [];
    for (const [key, ref] of this.callTargetRefs) {
      if (ref) {
        const idx = this._callTargetIndex.get(key);
        const id = idx !== undefined ? this.callTargetIds[idx] : key;
        const version = idx !== undefined ? this.callTargetVersions[idx] : null;
        const count = this.callTargetCounts.get(key) || 0;
        targets.push({ id, key, ref, version, count });
      }
    }
    targets.sort((a, b) => b.count - a.count);
    return targets.length >= 2 ? targets : null;
  }

  getMonomorphicCallArgCount() {
    if (this.callArgCounts.size === 1) {
      return Number(this.callArgCounts.keys().next().value);
    }
    return null;
  }

  getMonomorphicReceiverMap() {
    if (this.callReceiverMaps.length === 1) return this.callReceiverMaps[0];
    return null;
  }

  getCallFrequency(targetName) {
    return this.callTargetCounts.get(targetName) || 0;
  }

  getDominantType() {
    let maxCount = 0;
    let dominant = null;
    for (const [key, count] of this.typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = key;
      }
    }
    return dominant;
  }

  reset() {
    this.icState = IC_UNINITIALIZED;
    this.maps = [];
    this.mapVersions = [];
    this.offsets = [];
    this.protoDepths = [];
    this._mapIndex.clear();
    this.typeCounts.clear();
    this.lhsTypeCounts.clear();
    this.rhsTypeCounts.clear();
    this.callTargetCounts.clear();
    this.callTargetIds = [];
    this.callTargetKeys = [];
    this.callTargetVersions = [];
    this._callTargetIndex.clear();
    this._callTargetObjectKeys = new WeakMap();
    this._nextCallTargetObjectKey = 1;
    this.callArgCounts.clear();
    this.callReceiverMaps = [];
    this.callReceiverMapVersions = [];
    this._receiverMapIndex.clear();
    this.inlineDecisions = [];
    this.callTargetRef = null;
    this.totalCallCount = 0;
    this.allocationSiteHCs = new Set();
    this.arrayAccessCount = 0;
    this.arrayLengthAccessCount = 0;
    this.integerIndexCount = 0;
    this.elementsKindCounts.clear();
    this.isStable = false;
    this.stableSinceCount = 0;
    this.lastTransitionTimestamp = 0;
    this.totalRecordCount = 0;
  }

  serialize() {
    return {
      kind: this.kind,
      icState: this.icState,
      maps: [...this.maps],
      mapVersions: [...this.mapVersions],
      offsets: [...this.offsets],
      protoDepths: [...this.protoDepths],
      typeCounts: Object.fromEntries(this.typeCounts),
      lhsTypeCounts: Object.fromEntries(this.lhsTypeCounts),
      rhsTypeCounts: Object.fromEntries(this.rhsTypeCounts),
      callTargetCounts: Object.fromEntries(this.callTargetCounts),
      callTargetIds: [...this.callTargetIds],
      callTargetKeys: [...this.callTargetKeys],
      callTargetVersions: [...this.callTargetVersions],
      callArgCounts: Object.fromEntries(this.callArgCounts),
      callReceiverMaps: [...this.callReceiverMaps],
      callReceiverMapVersions: [...this.callReceiverMapVersions],
      inlineDecisions: [...this.inlineDecisions],
      totalCallCount: this.totalCallCount,
      allocationSiteHCs: [...this.allocationSiteHCs],
      arrayAccessCount: this.arrayAccessCount,
      arrayLengthAccessCount: this.arrayLengthAccessCount,
      integerIndexCount: this.integerIndexCount,
      elementsKindCounts: Object.fromEntries(this.elementsKindCounts),
      isStable: this.isStable,
      stableSinceCount: this.stableSinceCount,
      lastTransitionTimestamp: this.lastTransitionTimestamp,
      totalRecordCount: this.totalRecordCount,
    };
  }

  static deserialize(data) {
    const slot = new FeedbackSlot(data.kind);
    slot.icState = data.icState;
    slot.maps = data.maps;
    slot.mapVersions = data.mapVersions || [];
    slot.offsets = data.offsets;
    slot.protoDepths = data.protoDepths || [];
    slot._mapIndex = new Map();
    for (let i = 0; i < slot.maps.length; i++)
      slot._mapIndex.set(slot.maps[i], i);
    slot.typeCounts = new Map(Object.entries(data.typeCounts));
    slot.lhsTypeCounts = new Map(Object.entries(data.lhsTypeCounts));
    slot.rhsTypeCounts = new Map(Object.entries(data.rhsTypeCounts));
    slot.callTargetCounts = new Map(Object.entries(data.callTargetCounts));
    slot.callTargetIds = data.callTargetIds || [];
    slot.callTargetKeys =
      data.callTargetKeys || slot.callTargetIds.map((id) => String(id));
    slot.callTargetVersions = data.callTargetVersions || [];
    slot._callTargetIndex = new Map();
    for (let i = 0; i < slot.callTargetKeys.length; i++)
      slot._callTargetIndex.set(slot.callTargetKeys[i], i);
    slot._callTargetObjectKeys = new WeakMap();
    slot._nextCallTargetObjectKey = slot.callTargetKeys.length + 1;
    slot.callArgCounts = new Map(Object.entries(data.callArgCounts || {}));
    slot.callReceiverMaps = data.callReceiverMaps || [];
    slot.callReceiverMapVersions = data.callReceiverMapVersions || [];
    slot._receiverMapIndex = new Map();
    for (let i = 0; i < slot.callReceiverMaps.length; i++)
      slot._receiverMapIndex.set(slot.callReceiverMaps[i], i);
    slot.inlineDecisions = data.inlineDecisions || [];
    slot.totalCallCount = data.totalCallCount;
    slot.allocationSiteHCs = new Set(data.allocationSiteHCs);
    slot.arrayAccessCount = data.arrayAccessCount || 0;
    slot.arrayLengthAccessCount = data.arrayLengthAccessCount || 0;
    slot.integerIndexCount = data.integerIndexCount || 0;
    slot.elementsKindCounts = new Map(
      Object.entries(data.elementsKindCounts || {}),
    );
    slot.isStable = data.isStable;
    slot.stableSinceCount = data.stableSinceCount;
    slot.lastTransitionTimestamp = data.lastTransitionTimestamp;
    slot.totalRecordCount = data.totalRecordCount;
    return slot;
  }

  toString() {
    const parts = [
      `FeedbackSlot(${this.kind}, state=${this.icState}, stable=${this.isStable})`,
    ];
    if (this.maps.length > 0) {
      parts.push(`  maps: [${this.maps.join(", ")}]`);
    }
    if (this.mapVersions.length > 0) {
      parts.push(`  versions: [${this.mapVersions.join(", ")}]`);
    }
    if (this.typeCounts.size > 0) {
      const entries = [];
      for (const [k, v] of this.typeCounts) entries.push(`${k}:${v}`);
      parts.push(`  types: {${entries.join(", ")}}`);
    }
    if (this.callTargetCounts.size > 0) {
      const entries = [];
      for (const [k, v] of this.callTargetCounts) entries.push(`${k}:${v}`);
      parts.push(`  calls: {${entries.join(", ")}}`);
    }
    if (this.elementsKindCounts.size > 0) {
      const entries = [];
      for (const [k, v] of this.elementsKindCounts) entries.push(`${k}:${v}`);
      parts.push(`  elements: {${entries.join(", ")}}`);
    }
    return parts.join("\n");
  }
}

export const DEFAULT_LOOP_BUDGET = 1000;

export class FeedbackVector {
  constructor(slotCount) {
    this.slots = [];
    for (let i = 0; i < slotCount; i++) {
      this.slots.push(null);
    }
    this.createdAt = Date.now();
    this.loopBudget = DEFAULT_LOOP_BUDGET;
    this.loopBudgetExhausted = false;
  }

  decrementLoopBudget(amount = 1) {
    this.loopBudget -= amount;
    if (this.loopBudget <= 0 && !this.loopBudgetExhausted) {
      this.loopBudgetExhausted = true;
      return true;
    }
    return false;
  }

  resetLoopBudget() {
    this.loopBudget = DEFAULT_LOOP_BUDGET;
    this.loopBudgetExhausted = false;
  }

  initSlot(index, kind) {
    if (!this.slots[index]) {
      this.slots[index] = new FeedbackSlot(kind);
    }
  }

  getSlot(index) {
    return this.slots[index];
  }

  slotCount() {
    return this.slots.length;
  }

  resetSlot(index) {
    const slot = this.slots[index];
    if (slot) {
      slot.reset();
    }
  }

  resetAll() {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) {
        this.slots[i].reset();
      }
    }
    this.resetLoopBudget();
  }

  getSummaryStats() {
    let totalSlots = 0;
    let initializedSlots = 0;
    let stableSlots = 0;
    let monomorphicSlots = 0;
    let polymorphicSlots = 0;
    let megamorphicSlots = 0;
    let totalRecords = 0;

    for (let i = 0; i < this.slots.length; i++) {
      totalSlots++;
      const slot = this.slots[i];
      if (!slot) continue;
      initializedSlots++;
      totalRecords += slot.totalRecordCount;
      if (slot.isStable) stableSlots++;
      if (slot.icState === IC_MONOMORPHIC) monomorphicSlots++;
      else if (slot.icState === IC_POLYMORPHIC) polymorphicSlots++;
      else if (slot.icState === IC_MEGAMORPHIC) megamorphicSlots++;
    }

    return {
      totalSlots,
      initializedSlots,
      stableSlots,
      monomorphicSlots,
      polymorphicSlots,
      megamorphicSlots,
      totalRecords,
      createdAt: this.createdAt,
    };
  }

  serialize() {
    return {
      slotCount: this.slots.length,
      createdAt: this.createdAt,
      loopBudget: this.loopBudget,
      loopBudgetExhausted: this.loopBudgetExhausted,
      slots: this.slots.map((s) => (s ? s.serialize() : null)),
    };
  }

  static deserialize(data) {
    const vec = new FeedbackVector(data.slotCount);
    vec.createdAt = data.createdAt;
    if (data.loopBudget !== undefined) {
      vec.loopBudget = data.loopBudget;
      vec.loopBudgetExhausted = data.loopBudgetExhausted || false;
    }
    for (let i = 0; i < data.slots.length; i++) {
      if (data.slots[i]) {
        vec.slots[i] = FeedbackSlot.deserialize(data.slots[i]);
      }
    }
    return vec;
  }

  static fromCompiledFunction(compiledFn) {
    const vec = new FeedbackVector(compiledFn.feedbackSlotCount);
    return vec;
  }

  getPolymorphicProfile(slotIdx) {
    const slot = this.slots[slotIdx];
    if (!slot) return null;
    return {
      icState: slot.icState,
      mapDistribution: slot.mapCounts
        ? [...slot.mapCounts.entries()].sort((a, b) => b[1] - a[1])
        : [],
      isStable: slot.isStable,
      totalRecords: slot.totalRecordCount,
    };
  }

  isSettled(slotIdx) {
    const slot = this.slots[slotIdx];
    if (!slot) return false;
    return slot.isStable && slot.totalRecordCount >= 50;
  }

  getSlotsNeedingRefresh() {
    const result = [];
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      if (
        slot.icState === IC_MEGAMORPHIC ||
        (!slot.isStable && slot.totalRecordCount > 0)
      ) {
        result.push(i);
      }
    }
    return result;
  }

  toString() {
    const lines = [`FeedbackVector(${this.slots.length} slots)`];
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot) {
        lines.push(`  [${i}] ${slot}`);
      } else {
        lines.push(`  [${i}] <empty>`);
      }
    }
    return lines.join("\n");
  }
}
