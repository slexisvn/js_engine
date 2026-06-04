import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  InlineCache,
  IC_MONOMORPHIC,
  IC_MEGAMORPHIC,
  globalMegamorphicCache,
} from "../../src/feedback/ic/index.js";
import {
  FeedbackSlot,
  FEEDBACK_PROPERTY,
} from "../../src/feedback/vector/index.js";
import { createJSObject } from "../../src/objects/heap/factory.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import { mkSmi, getPayload } from "../../src/core/value/index.js";

describe("Prototype guards and shape feedback", () => {
  beforeEach(() => {
    resetHiddenClasses();
    globalMegamorphicCache.loadCache.clear();
    globalMegamorphicCache.storeCache.clear();
  });

  it("guards proto loads by receiver map and prototype validity", () => {
    const proto = createJSObject();
    proto.setProperty("x", mkSmi(1));
    const obj = createJSObject();
    obj.setPrototype(proto);
    const ic = new InlineCache("proto_guard");

    const first = ic.lookup(obj, "x");
    const second = ic.lookup(obj, "x");
    assert.equal(getPayload(first.value), 1);
    assert.equal(second.hit, true);
    assert.equal(ic.loadIC.state, IC_MONOMORPHIC);

    proto.setProperty("x", mkSmi(2));
    const third = ic.lookup(obj, "x");
    assert.equal(third.hit, false);
    assert.equal(getPayload(third.value), 2);
  });

  it("guards proto loads when receiver prototype changes", () => {
    const proto1 = createJSObject();
    const proto2 = createJSObject();
    proto1.setProperty("x", mkSmi(1));
    proto2.setProperty("x", mkSmi(2));
    const obj = createJSObject();
    obj.setPrototype(proto1);
    const ic = new InlineCache("proto_change");

    assert.equal(getPayload(ic.lookup(obj, "x").value), 1);
    obj.setPrototype(proto2);
    const next = ic.lookup(obj, "x");
    assert.equal(next.hit, false);
    assert.equal(getPayload(next.value), 2);
  });

  it("does not keep stale megamorphic prototype handlers", () => {
    const ic = new InlineCache("mega_proto");
    const proto = createJSObject();
    proto.setProperty("x", mkSmi(1));

    for (let i = 0; i < 10; i++) {
      const obj = createJSObject();
      obj.setProperty(`k${i}`, mkSmi(i));
      obj.setPrototype(proto);
      ic.lookup(obj, "x");
    }

    assert.equal(ic.loadIC.state, IC_MEGAMORPHIC);
    const obj = createJSObject();
    obj.setProperty("final", mkSmi(1));
    obj.setPrototype(proto);
    ic.lookup(obj, "x");
    proto.setProperty("x", mkSmi(9));
    const result = ic.lookup(obj, "x");
    assert.equal(result.hit, false);
    assert.equal(getPayload(result.value), 9);
  });

  it("records map versions and proto depth in feedback", () => {
    const slot = new FeedbackSlot(FEEDBACK_PROPERTY);
    slot.recordPropertyAccess(10, 2, 7, 1);
    assert.equal(slot.getMonomorphicMap(), 10);
    assert.equal(slot.getMonomorphicOffset(), 2);
    assert.equal(slot.getMonomorphicMapVersion(), 7);
    assert.equal(slot.getMonomorphicProtoDepth(), 1);
  });
});
