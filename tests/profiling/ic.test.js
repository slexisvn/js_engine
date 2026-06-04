import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  InlineCache,
  InlineCacheManager,
  CallIC,
  IC_UNINITIALIZED,
  IC_MONOMORPHIC,
  IC_POLYMORPHIC,
  IC_MEGAMORPHIC,
} from "../../src/feedback/ic/index.js";
import {
  FeedbackSlot,
  FeedbackVector,
  FEEDBACK_PROPERTY,
  FEEDBACK_BINARY_OP,
  FEEDBACK_UNARY_OP,
  FEEDBACK_CALL,
} from "../../src/feedback/vector/index.js";
import {
  ROOT_HIDDEN_CLASS,
  resetHiddenClasses,
} from "../../src/objects/maps/hidden-class.js";
import { createJSObject } from "../../src/objects/heap/factory.js";
import { JSObject } from "../../src/objects/heap/js-object.js";
import {
  JSFunction,
  mkObject,
  mkSmi,
  getPayload,
} from "../../src/core/value/index.js";
import { RegisterCompiledFunction as CompiledFunction } from "../../src/bytecode/register/ops/bytecode.js";
import { FeedbackNexus } from "../../src/feedback/nexus/index.js";
import { TypeKind } from "../../src/optimizing/types/lattice.js";

function nexusForSlot(slot) {
  return new FeedbackNexus({
    getSlot(index) {
      return index === 0 ? slot : null;
    },
  });
}

describe("InlineCache", () => {
  beforeEach(() => {
    resetHiddenClasses();
  });

  describe("state machine", () => {
    it("starts uninitialized", () => {
      const ic = new InlineCache("site_0");
      assert.equal(ic.state, IC_UNINITIALIZED);
      assert.equal(ic.entries.length, 0);
    });

    it("transitions to monomorphic on first miss", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(10));
      ic.lookup(obj, "x");
      assert.equal(ic.state, IC_MONOMORPHIC);
      assert.equal(ic.entries.length, 1);
    });

    it("stays monomorphic for same shape", () => {
      const ic = new InlineCache("site_0");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(10));
      const obj2 = createJSObject();
      obj2.setProperty("x", mkSmi(20));

      ic.lookup(obj1, "x");
      assert.equal(ic.state, IC_MONOMORPHIC);

      const result = ic.lookup(obj2, "x");
      assert.equal(ic.state, IC_MONOMORPHIC);
      assert.equal(result.hit, true);
      assert.equal(getPayload(result.value), 20);
    });

    it("transitions to polymorphic on second shape", () => {
      const ic = new InlineCache("site_0");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(10));
      const obj2 = createJSObject();
      obj2.setProperty("a", mkSmi(0));
      obj2.setProperty("x", mkSmi(20));

      ic.lookup(obj1, "x");
      assert.equal(ic.state, IC_MONOMORPHIC);

      ic.lookup(obj2, "x");
      assert.equal(ic.state, IC_POLYMORPHIC);
      assert.equal(ic.entries.length, 2);
    });

    it("transitions to megamorphic after too many shapes", () => {
      const ic = new InlineCache("site_0");

      const shapes = [];
      for (let i = 0; i < 10; i++) {
        const obj = createJSObject();
        for (let j = 0; j < i; j++) {
          obj.setProperty(`pad${j}`, mkSmi(0));
        }
        obj.setProperty("x", mkSmi(i));
        shapes.push(obj);
      }

      for (const obj of shapes) {
        ic.lookup(obj, "x");
      }

      assert.equal(ic.state, IC_MEGAMORPHIC);
    });
  });

  describe("monomorphic hit", () => {
    it("returns correct value on hit", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(42));

      ic.lookup(obj, "x");

      const result = ic.lookup(obj, "x");
      assert.equal(result.hit, true);
      assert.equal(getPayload(result.value), 42);
    });

    it("reflects updated value", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));

      ic.lookup(obj, "x");

      obj.setProperty("x", mkSmi(99));
      const result = ic.lookup(obj, "x");
      assert.equal(result.hit, true);
      assert.equal(getPayload(result.value), 99);
    });

    it("caches correct offset", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();
      obj.setProperty("a", mkSmi(1));
      obj.setProperty("b", mkSmi(2));
      obj.setProperty("c", mkSmi(3));

      ic.lookup(obj, "c");
      assert.equal(ic.entries[0].offset, 2);
    });
  });

  describe("polymorphic lookup", () => {
    it("finds value for any cached shape", () => {
      const ic = new InlineCache("site_0");

      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(10));
      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(20));

      ic.lookup(obj1, "x");
      ic.lookup(obj2, "x");

      assert.equal(ic.state, IC_POLYMORPHIC);

      const r1 = ic.lookup(obj1, "x");
      assert.equal(r1.hit, true);
      assert.equal(getPayload(r1.value), 10);

      const r2 = ic.lookup(obj2, "x");
      assert.equal(r2.hit, true);
      assert.equal(getPayload(r2.value), 20);
    });

    it("accumulates up to 4 entries", () => {
      const ic = new InlineCache("site_0");

      for (let i = 0; i < 4; i++) {
        const obj = createJSObject();
        for (let j = 0; j < i; j++) {
          obj.setProperty(`p${j}`, mkSmi(0));
        }
        obj.setProperty("x", mkSmi(i * 10));
        ic.lookup(obj, "x");
      }

      assert.equal(ic.state, IC_POLYMORPHIC);
      assert.equal(ic.entries.length, 4);
    });
  });

  describe("megamorphic behavior", () => {
    it("returns miss for megamorphic", () => {
      const ic = new InlineCache("site_0");

      for (let i = 0; i < 10; i++) {
        const obj = createJSObject();
        for (let j = 0; j < i; j++) {
          obj.setProperty(`pad${j}`, mkSmi(0));
        }
        obj.setProperty("x", mkSmi(i));
        ic.lookup(obj, "x");
      }

      assert.equal(ic.state, IC_MEGAMORPHIC);

      const newObj = createJSObject();
      newObj.setProperty("x", mkSmi(999));
      const result = ic.lookup(newObj, "x");
      assert.equal(result.hit, false);
    });

    it("nullifies entries on megamorphic", () => {
      const ic = new InlineCache("site_0");

      for (let i = 0; i < 10; i++) {
        const obj = createJSObject();
        for (let j = 0; j < i; j++) {
          obj.setProperty(`pad${j}`, mkSmi(0));
        }
        obj.setProperty("x", mkSmi(i));
        ic.lookup(obj, "x");
      }

      assert.equal(ic.entries, null);
    });
  });

  describe("lookupForWrite", () => {
    it("writes to existing property", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));

      ic.lookupForWrite(obj, "x", mkSmi(99));
      assert.equal(getPayload(obj.getProperty("x")), 99);
    });

    it("creates new property if missing", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();

      ic.lookupForWrite(obj, "x", mkSmi(42));
      assert.equal(getPayload(obj.getProperty("x")), 42);
    });

    it("updates IC state on new property write", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();

      ic.lookupForWrite(obj, "x", mkSmi(1));
      assert.ok(
        ic.state === IC_MONOMORPHIC || ic.state === IC_POLYMORPHIC,
        `Expected mono or poly, got ${ic.state}`,
      );
    });
  });

  describe("non-existent property", () => {
    it("returns undefined for missing property", () => {
      const ic = new InlineCache("site_0");
      const obj = createJSObject();

      const result = ic.lookup(obj, "missing");
      assert.equal(result.value, undefined);
    });
  });
});

describe("InlineCacheManager", () => {
  it("creates cache on first access", () => {
    const mgr = new InlineCacheManager();
    const ic = mgr.getOrCreate("site_a");
    assert.ok(ic instanceof InlineCache);
  });

  it("returns same cache for same site", () => {
    const mgr = new InlineCacheManager();
    const ic1 = mgr.getOrCreate("site_a");
    const ic2 = mgr.getOrCreate("site_a");
    assert.equal(ic1, ic2);
  });

  it("returns different caches for different sites", () => {
    const mgr = new InlineCacheManager();
    const ic1 = mgr.getOrCreate("site_a");
    const ic2 = mgr.getOrCreate("site_b");
    assert.notEqual(ic1, ic2);
  });

  it("get returns undefined for unknown site", () => {
    const mgr = new InlineCacheManager();
    assert.equal(mgr.get("nope"), undefined);
  });

  it("get returns existing cache", () => {
    const mgr = new InlineCacheManager();
    const ic = mgr.getOrCreate("site_a");
    assert.equal(mgr.get("site_a"), ic);
  });
});

describe("FeedbackSlot", () => {
  describe("property access feedback", () => {
    beforeEach(() => {
      resetHiddenClasses();
    });

    it("starts uninitialized", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      assert.equal(slot.icState, IC_UNINITIALIZED);
      assert.equal(slot.maps.length, 0);
    });

    it("goes monomorphic on first record", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      slot.recordPropertyAccess(1, 0);
      assert.equal(slot.icState, IC_MONOMORPHIC);
      assert.equal(slot.maps.length, 1);
      assert.equal(slot.maps[0], 1);
      assert.equal(slot.offsets[0], 0);
    });

    it("stays monomorphic for same map", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      slot.recordPropertyAccess(1, 0);
      slot.recordPropertyAccess(1, 0);
      assert.equal(slot.icState, IC_MONOMORPHIC);
      assert.equal(slot.maps.length, 1);
    });

    it("goes polymorphic for different map", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      slot.recordPropertyAccess(1, 0);
      slot.recordPropertyAccess(2, 1);
      assert.equal(slot.icState, IC_POLYMORPHIC);
      assert.equal(slot.maps.length, 2);
    });

    it("goes megamorphic after 4 maps", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      slot.recordPropertyAccess(1, 0);
      slot.recordPropertyAccess(2, 0);
      slot.recordPropertyAccess(3, 0);
      slot.recordPropertyAccess(4, 0);
      assert.equal(slot.icState, IC_POLYMORPHIC);

      slot.recordPropertyAccess(5, 0);
      assert.equal(slot.icState, IC_MEGAMORPHIC);
    });

    it("isMonomorphic returns correctly", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      assert.equal(slot.isMonomorphic(), false);
      slot.recordPropertyAccess(1, 0);
      assert.equal(slot.isMonomorphic(), true);
      slot.recordPropertyAccess(2, 0);
      assert.equal(slot.isMonomorphic(), false);
    });

    it("getMonomorphicMap returns map when monomorphic", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      slot.recordPropertyAccess(42, 3);
      assert.equal(slot.getMonomorphicMap(), 42);
      assert.equal(slot.getMonomorphicOffset(), 3);
    });

    it("getMonomorphicMap returns null when not monomorphic", () => {
      const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
      assert.equal(slot.getMonomorphicMap(), null);
      slot.recordPropertyAccess(1, 0);
      slot.recordPropertyAccess(2, 0);
      assert.equal(slot.getMonomorphicMap(), null);
    });
  });

  describe("binary op feedback", () => {
    it("records lhs and rhs types", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      slot.recordBinaryOp("smi", "smi");
      assert.ok(slot.lhsTypes.has("smi"));
      assert.ok(slot.rhsTypes.has("smi"));
    });

    it("uses operand pair shapes for binary IC state transitions", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      slot.recordBinaryOp("smi", "smi");
      assert.equal(slot.icState, IC_MONOMORPHIC);
      slot.recordBinaryOp("smi", "double");
      assert.equal(slot.icState, IC_POLYMORPHIC);
      slot.recordBinaryOp("double", "smi");
      slot.recordBinaryOp("double", "double");
      assert.equal(slot.icState, IC_POLYMORPHIC);
      slot.recordBinaryOp("string", "smi");
      assert.equal(slot.icState, IC_MEGAMORPHIC);
    });

    it("does not become polymorphic when the same binary shape repeats with different values", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      for (let i = 0; i < 8; i++) slot.recordBinaryOp("smi", "smi");
      assert.equal(slot.icState, IC_MONOMORPHIC);
      assert.equal(slot.typeCounts.size, 1);
    });

    it("reports pure smi binary feedback through the type lattice", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      slot.recordBinaryOp("smi", "smi");
      assert.equal(nexusForSlot(slot).binaryOp(0).inputType.kind, TypeKind.Smi);
    });

    it("joins mixed binary feedback through the type lattice", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      slot.recordBinaryOp("smi", "smi");
      slot.recordBinaryOp("string", "smi");
      assert.equal(
        nexusForSlot(slot).binaryOp(0).inputType.kind,
        TypeKind.Tagged,
      );
    });

    it("reports empty binary feedback as any", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      assert.equal(nexusForSlot(slot).binaryOp(0).inputType.kind, TypeKind.Any);
    });

    it("joins smi and double binary feedback as number", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      slot.recordBinaryOp("smi", "double");
      slot.recordBinaryOp("double", "smi");
      assert.equal(
        nexusForSlot(slot).binaryOp(0).inputType.kind,
        TypeKind.Number,
      );
    });

    it("does not treat string-mixed binary feedback as numeric", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      slot.recordBinaryOp("smi", "string");
      assert.equal(
        nexusForSlot(slot).binaryOp(0).inputType.kind,
        TypeKind.Tagged,
      );
    });

    it("accumulates multiple type pairs", () => {
      const slot = new FeedbackSlot(FEEDBACK_BINARY_OP);
      slot.recordBinaryOp("smi", "smi");
      slot.recordBinaryOp("double", "double");
      assert.equal(slot.lhsTypes.size, 2);
      assert.equal(slot.rhsTypes.size, 2);
    });
  });

  describe("unary op feedback", () => {
    it("uses operand tags for unary IC state transitions", () => {
      const slot = new FeedbackSlot(FEEDBACK_UNARY_OP);
      slot.recordUnaryOp("smi");
      assert.equal(slot.icState, IC_MONOMORPHIC);
      slot.recordUnaryOp("double");
      assert.equal(slot.icState, IC_POLYMORPHIC);
      slot.recordUnaryOp("boolean");
      slot.recordUnaryOp("string");
      assert.equal(slot.icState, IC_POLYMORPHIC);
      slot.recordUnaryOp("object");
      assert.equal(slot.icState, IC_MEGAMORPHIC);
    });
  });

  describe("call feedback", () => {
    it("records call targets", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const add = new CompiledFunction("same", 2);
      const sub = new CompiledFunction("same", 2);
      sub.id = add.id;
      slot.recordCallTarget("same", add, 2);
      slot.recordCallTarget("same", sub, 2);
      assert.equal(slot.callTargets.size, 2);
      assert.equal(slot.isPolymorphic(), true);
      assert.deepEqual(
        slot.getPolymorphicCallTargets().map((target) => target.ref),
        [add, sub],
      );
    });

    it("deduplicates call targets", () => {
      const slot = new FeedbackSlot(FEEDBACK_CALL);
      const add = new CompiledFunction("add", 2);
      slot.recordCallTarget("add", add, 2);
      slot.recordCallTarget("add", add, 2);
      assert.equal(slot.callTargets.size, 1);
      assert.equal(slot.getMonomorphicCallTargetRef(), add);
      assert.equal(slot.getMonomorphicCallArgCount(), 2);
    });
  });
});

describe("CallIC", () => {
  beforeEach(() => {
    resetHiddenClasses();
  });

  it("creates a monomorphic call IC by target identity", () => {
    const ic = new CallIC("call_site");
    const fn = new JSFunction(new CompiledFunction("add", 2), "add");
    ic.lookup(fn, 2);
    const result = ic.lookup(fn, 2);
    assert.equal(ic.state, IC_MONOMORPHIC);
    assert.equal(result.hit, true);
  });

  it("does not alias functions with the same name", () => {
    const ic = new CallIC("call_site");
    const a = new JSFunction(new CompiledFunction("same", 1), "same");
    const b = new JSFunction(new CompiledFunction("same", 1), "same");
    ic.lookup(a, 1);
    ic.lookup(b, 1);
    assert.equal(ic.state, IC_POLYMORPHIC);
    assert.equal(ic.entries.length, 2);
  });

  it("guards method calls by receiver map version", () => {
    const ic = new CallIC("method_site");
    const fn = new JSFunction(new CompiledFunction("m", 0), "m");
    const receiver = mkObject(createJSObject());
    ic.lookup(fn, 0, receiver);
    const hit = ic.lookup(fn, 0, receiver);
    assert.equal(hit.hit, true);
    getPayload(receiver).setProperty("x", mkSmi(1));
    const miss = ic.lookup(fn, 0, receiver);
    assert.equal(miss.hit, false);
  });
});

describe("FeedbackVector", () => {
  it("creates vector with given slot count", () => {
    const fv = new FeedbackVector(5);
    assert.equal(fv.slots.length, 5);
  });

  it("slots start as null", () => {
    const fv = new FeedbackVector(3);
    assert.equal(fv.slots[0], null);
    assert.equal(fv.slots[1], null);
    assert.equal(fv.slots[2], null);
  });

  it("initSlot creates FeedbackSlot", () => {
    const fv = new FeedbackVector(3);
    fv.initSlot(0, FEEDBACK_PROPERTY);
    fv.initSlot(1, FEEDBACK_BINARY_OP);
    assert.ok(fv.getSlot(0) instanceof FeedbackSlot);
    assert.equal(fv.getSlot(0).kind, FEEDBACK_PROPERTY);
    assert.equal(fv.getSlot(1).kind, FEEDBACK_BINARY_OP);
    assert.equal(fv.getSlot(2), null);
  });
});

describe("Prototype Chain IC", () => {
  beforeEach(() => {
    resetHiddenClasses();
  });

  it("caches prototype property lookups", () => {
    const proto = createJSObject();
    proto.setProperty("greet", mkSmi(42));

    const child = createJSObject();
    child.setPrototype(proto);

    const ic = new InlineCache("proto_site_0");

    const result1 = ic.lookup(child, "greet");
    assert.equal(result1.hit, true);
    assert.equal(getPayload(result1.value), 42);

    const result2 = ic.lookup(child, "greet");
    assert.equal(result2.hit, true);
    assert.equal(getPayload(result2.value), 42);

    assert.equal(ic.loadIC.state, IC_MONOMORPHIC);
    assert.equal(ic.loadIC.hitCount, 1);
  });

  it("returns own property over prototype", () => {
    const proto = createJSObject();
    proto.setProperty("x", mkSmi(100));

    const child = createJSObject();
    child.setPrototype(proto);
    child.setProperty("x", mkSmi(200));

    const ic = new InlineCache("proto_site_1");

    const result = ic.lookup(child, "x");
    assert.equal(result.hit, true);
    assert.equal(getPayload(result.value), 200);
  });

  it("invalidates proto IC when prototype map changes", () => {
    const proto = createJSObject();
    proto.setProperty("method", mkSmi(10));

    const child = createJSObject();
    child.setPrototype(proto);

    const ic = new InlineCache("proto_site_2");

    ic.lookup(child, "method");
    assert.equal(ic.loadIC.state, IC_MONOMORPHIC);

    proto.setProperty("newProp", mkSmi(99));

    const result = ic.lookup(child, "method");
    assert.equal(result.hit, false);
    assert.equal(getPayload(result.value), 10);
  });

  it("returns undefined for property not on prototype chain", () => {
    const proto = createJSObject();
    proto.setProperty("exists", mkSmi(1));

    const child = createJSObject();
    child.setPrototype(proto);

    const ic = new InlineCache("proto_site_3");
    const result = ic.lookup(child, "doesNotExist");
    assert.equal(result.hit, false);
    assert.equal(result.value, undefined);
  });
});
