import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  InlineCache,
  PropertyLoadIC,
  PropertyStoreIC,
  MegamorphicCache,
  globalMegamorphicCache,
  IC_UNINITIALIZED,
  IC_MONOMORPHIC,
  IC_POLYMORPHIC,
  IC_MEGAMORPHIC,
} from "../../src/feedback/ic/index.js";
import {
  FeedbackVector,
  FeedbackSlot,
  FEEDBACK_PROPERTY,
} from "../../src/feedback/vector/index.js";
import { createJSObject } from "../../src/objects/heap/factory.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import { mkSmi } from "../../src/core/value/index.js";
import {
  IR_POLYMORPHIC_LOAD,
  IR_POLYMORPHIC_STORE,
  IR_DISPATCH_MAP,
  IR_MEGAMORPHIC_LOAD,
  IR_MEGAMORPHIC_STORE,
  IRNode,
  EFFECT_READ,
  EFFECT_WRITE,
} from "../../src/optimizing/ir/index.js";
import { inlineCacheLowering } from "../../src/optimizing/passes/ic-lowering.js";

function makeDistinctObjects(count) {
  const objects = [];
  for (let i = 0; i < count; i++) {
    const obj = createJSObject();
    for (let j = 0; j < i; j++) {
      obj.setProperty(`pad${j}`, mkSmi(0));
    }
    obj.setProperty("x", mkSmi(i * 10));
    objects.push(obj);
  }
  return objects;
}

describe("Polymorphic IC Improvements", () => {
  beforeEach(() => {
    resetHiddenClasses();
    globalMegamorphicCache.loadCache.clear();
    globalMegamorphicCache.storeCache.clear();
  });

  describe("extended polymorphic capacity", () => {
    it("holds up to 8 polymorphic entries before megamorphic", () => {
      const ic = new InlineCache("poly8");
      const objects = makeDistinctObjects(8);
      for (const obj of objects) {
        ic.lookup(obj, "x");
      }
      assert.equal(ic.loadIC.state, IC_POLYMORPHIC);
      assert.equal(ic.loadIC.entries.length, 8);
    });

    it("transitions to megamorphic at 9 shapes", () => {
      const ic = new InlineCache("poly9");
      const objects = makeDistinctObjects(9);
      for (const obj of objects) {
        ic.lookup(obj, "x");
      }
      assert.equal(ic.loadIC.state, IC_MEGAMORPHIC);
      assert.equal(ic.loadIC.entries, null);
    });

    it("store IC holds up to 8 entries", () => {
      const ic = new InlineCache("store8");
      const objects = makeDistinctObjects(8);
      for (const obj of objects) {
        ic.lookupForWrite(obj, "x", mkSmi(99));
      }
      assert.equal(ic.storeIC.state, IC_POLYMORPHIC);
      assert.equal(ic.storeIC.entries.length, 8);
    });
  });

  describe("getSortedHandlers", () => {
    it("returns handlers sorted by hit count descending", () => {
      const ic = new InlineCache("sort_site");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(2));

      ic.lookup(obj1, "x");
      for (let i = 0; i < 5; i++) {
        ic.lookup(obj2, "x");
      }
      ic.lookup(obj1, "x");

      const sorted = ic.loadIC.getSortedHandlers();
      assert.equal(sorted.length, 2);
      assert.ok(sorted[0].hitCount >= sorted[1].hitCount);
    });

    it("returns empty array when no entries", () => {
      const ic = new InlineCache("empty_sort");
      assert.deepEqual(ic.loadIC.getSortedHandlers(), []);
    });
  });

  describe("getDominantHandler", () => {
    it("returns dominant handler when one has >= 80% hits", () => {
      const ic = new InlineCache("dominant_site");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(2));

      ic.lookup(obj1, "x");
      ic.lookup(obj2, "x");
      for (let i = 0; i < 8; i++) {
        ic.lookup(obj1, "x");
      }

      const dominant = ic.loadIC.getDominantHandler();
      assert.notEqual(dominant, null);
      assert.ok(dominant.hitCount >= 8);
    });

    it("returns null when no handler dominates", () => {
      const ic = new InlineCache("no_dominant");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(2));

      ic.lookup(obj1, "x");
      ic.lookup(obj2, "x");
      ic.lookup(obj1, "x");
      ic.lookup(obj2, "x");

      const dominant = ic.loadIC.getDominantHandler();
      assert.equal(dominant, null);
    });

    it("returns null for monomorphic IC", () => {
      const ic = new InlineCache("mono");
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));
      ic.lookup(obj, "x");
      assert.equal(ic.loadIC.getDominantHandler(), null);
    });
  });

  describe("isSettled", () => {
    it("considers IC settled after many hits with no transitions", () => {
      const ic = new InlineCache("settled_site");
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));

      for (let i = 0; i < 102; i++) {
        ic.lookup(obj, "x");
      }

      assert.equal(ic.loadIC.isSettled(), true);
    });

    it("is not settled with few hits", () => {
      const ic = new InlineCache("unsettled");
      const obj = createJSObject();
      obj.setProperty("x", mkSmi(1));
      ic.lookup(obj, "x");
      ic.lookup(obj, "x");
      assert.equal(ic.loadIC.isSettled(), false);
    });
  });

  describe("getPolymorphicProfile", () => {
    it("returns profile with hit ratios for each entry", () => {
      const ic = new InlineCache("profile_site");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(2));

      ic.lookup(obj1, "x");
      ic.lookup(obj2, "x");
      for (let i = 0; i < 3; i++) {
        ic.lookup(obj1, "x");
      }

      const profile = ic.loadIC.getPolymorphicProfile();
      assert.equal(profile.length, 2);
      const totalRatio = profile.reduce((s, p) => s + p.ratio, 0);
      assert.ok(Math.abs(totalRatio - 1.0) < 0.001);
    });

    it("returns empty array when entries are null", () => {
      const ic = new InlineCache("mega_profile");
      const objects = makeDistinctObjects(10);
      for (const obj of objects) {
        ic.lookup(obj, "x");
      }
      assert.equal(ic.loadIC.state, IC_MEGAMORPHIC);
      assert.deepEqual(ic.loadIC.getPolymorphicProfile(), []);
    });
  });

  describe("store IC new methods", () => {
    it("getSortedHandlers on store IC", () => {
      const ic = new InlineCache("store_sort");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(2));

      ic.lookupForWrite(obj1, "x", mkSmi(10));
      for (let i = 0; i < 4; i++) {
        ic.lookupForWrite(obj2, "x", mkSmi(20));
      }

      const sorted = ic.storeIC.getSortedHandlers();
      assert.equal(sorted.length, 2);
      assert.ok(sorted[0].hitCount >= sorted[1].hitCount);
    });

    it("getDominantHandler on store IC", () => {
      const ic = new InlineCache("store_dom");
      const obj1 = createJSObject();
      obj1.setProperty("x", mkSmi(1));
      const obj2 = createJSObject();
      obj2.setProperty("y", mkSmi(0));
      obj2.setProperty("x", mkSmi(2));

      ic.lookupForWrite(obj1, "x", mkSmi(10));
      ic.lookupForWrite(obj2, "x", mkSmi(20));
      for (let i = 0; i < 8; i++) {
        ic.lookupForWrite(obj1, "x", mkSmi(10));
      }

      assert.notEqual(ic.storeIC.getDominantHandler(), null);
    });
  });

  describe("MegamorphicCache", () => {
    it("caches and retrieves load handlers", () => {
      const cache = new MegamorphicCache();
      const handler = { type: "test" };
      cache.setLoad(1, "x", handler);
      assert.equal(cache.getLoad(1, "x"), handler);
      assert.equal(cache.getLoad(2, "x"), undefined);
    });

    it("caches and retrieves store handlers", () => {
      const cache = new MegamorphicCache();
      const handler = { type: "store-test" };
      cache.setStore(1, "y", handler);
      assert.equal(cache.getStore(1, "y"), handler);
    });

    it("deletes load handlers", () => {
      const cache = new MegamorphicCache();
      cache.setLoad(1, "x", { type: "test" });
      cache.deleteLoad(1, "x");
      assert.equal(cache.getLoad(1, "x"), undefined);
    });

    it("caches element load and store handlers", () => {
      const cache = new MegamorphicCache();
      const loadH = { type: "elem-load" };
      const storeH = { type: "elem-store" };
      cache.setElementLoad("PACKED_SMI", loadH);
      cache.setElementStore("PACKED_SMI", storeH);
      assert.equal(cache.getElementLoad("PACKED_SMI"), loadH);
      assert.equal(cache.getElementStore("PACKED_SMI"), storeH);
    });
  });

  describe("FeedbackVector polymorphic profile", () => {
    it("getPolymorphicProfile returns distribution info", () => {
      const vec = new FeedbackVector(2);
      vec.initSlot(0, FEEDBACK_PROPERTY);
      const slot = vec.slots[0];
      slot.recordPropertyAccess(10, 2, 1, 0);
      slot.recordPropertyAccess(10, 2, 1, 0);
      slot.recordPropertyAccess(20, 3, 2, 0);

      const profile = vec.getPolymorphicProfile(0);
      assert.notEqual(profile, null);
      assert.ok(profile.totalRecords >= 3);
    });

    it("isSettled returns false for unstable slot", () => {
      const vec = new FeedbackVector(2);
      vec.initSlot(0, FEEDBACK_PROPERTY);
      vec.slots[0].recordPropertyAccess(10, 2, 1, 0);
      assert.equal(vec.isSettled(0), false);
    });

    it("returns null for invalid slot index", () => {
      const vec = new FeedbackVector(1);
      assert.equal(vec.getPolymorphicProfile(5), null);
      assert.equal(vec.isSettled(5), false);
    });
  });
});

describe("IC Lowering Pass", () => {
  function makeNode(id, type, props) {
    const node = new IRNode(type, props);
    node.id = id;
    return node;
  }

  function makeGraph(nodes) {
    const block = { nodes };
    for (const node of nodes) {
      node.block = block;
    }
    return {
      blocks: [block],
    };
  }

  it("lowers polymorphic load to dispatch when >= 2 handlers", () => {
    const node = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [
        { mapId: 1, offset: 0, hitCount: 10 },
        { mapId: 2, offset: 1, hitCount: 5 },
      ],
    });
    const graph = makeGraph([node]);
    const count = inlineCacheLowering(graph, {});
    assert.equal(count, 1);
    assert.equal(graph.blocks[0].nodes[0].type, IR_DISPATCH_MAP);
    assert.equal(graph.blocks[0].nodes[0] instanceof IRNode, true);
    assert.equal(graph.blocks[0].nodes[0].effectKind, EFFECT_READ);
  });

  it("orders dispatch handlers by frequency", () => {
    const node = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [
        { mapId: 1, offset: 0, hitCount: 2 },
        { mapId: 2, offset: 1, hitCount: 10 },
        { mapId: 3, offset: 2, hitCount: 5 },
      ],
    });
    const graph = makeGraph([node]);
    inlineCacheLowering(graph, {});
    const dispatched = graph.blocks[0].nodes[0];
    assert.equal(dispatched.props.handlers[0].hitCount, 10);
    assert.equal(dispatched.props.handlers[1].hitCount, 5);
    assert.equal(dispatched.props.handlers[2].hitCount, 2);
  });

  it("detects dominant handler in dispatch", () => {
    const node = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [
        { mapId: 1, offset: 0, hitCount: 90 },
        { mapId: 2, offset: 1, hitCount: 10 },
      ],
    });
    const graph = makeGraph([node]);
    inlineCacheLowering(graph, {});
    const dispatched = graph.blocks[0].nodes[0];
    assert.notEqual(dispatched.props.dominant, null);
    assert.equal(dispatched.props.dominant.hitCount, 90);
  });

  it("returns null dominant when no handler exceeds 80%", () => {
    const node = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [
        { mapId: 1, offset: 0, hitCount: 6 },
        { mapId: 2, offset: 1, hitCount: 4 },
      ],
    });
    const graph = makeGraph([node]);
    inlineCacheLowering(graph, {});
    const dispatched = graph.blocks[0].nodes[0];
    assert.equal(dispatched.props.dominant, null);
  });

  it("lowers to megamorphic load when > 6 handlers", () => {
    const handlers = [];
    for (let i = 0; i < 7; i++) {
      handlers.push({ mapId: i, offset: i, hitCount: 1 });
    }
    const node = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers,
    });
    const graph = makeGraph([node]);
    inlineCacheLowering(graph, {});
    assert.equal(graph.blocks[0].nodes[0].type, IR_MEGAMORPHIC_LOAD);
  });

  it("lowers polymorphic store to dispatch", () => {
    const node = makeNode(1, IR_POLYMORPHIC_STORE, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [
        { mapId: 1, offset: 0, hitCount: 5 },
        { mapId: 2, offset: 1, hitCount: 3 },
      ],
    });
    const graph = makeGraph([node]);
    const count = inlineCacheLowering(graph, {});
    assert.equal(count, 1);
    const dispatched = graph.blocks[0].nodes[0];
    assert.equal(dispatched.type, IR_DISPATCH_MAP);
    assert.equal(dispatched.props.isStore, true);
    assert.equal(dispatched instanceof IRNode, true);
    assert.equal(dispatched.effectKind, EFFECT_WRITE);
  });

  it("lowers to megamorphic store when > 6 handlers", () => {
    const handlers = [];
    for (let i = 0; i < 7; i++) {
      handlers.push({ mapId: i, offset: i, hitCount: 1 });
    }
    const node = makeNode(1, IR_POLYMORPHIC_STORE, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers,
    });
    const graph = makeGraph([node]);
    inlineCacheLowering(graph, {});
    assert.equal(graph.blocks[0].nodes[0].type, IR_MEGAMORPHIC_STORE);
    assert.equal(graph.blocks[0].nodes[0] instanceof IRNode, true);
    assert.equal(graph.blocks[0].nodes[0].effectKind, EFFECT_WRITE);
  });

  it("does not lower single-handler polymorphic loads", () => {
    const node = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [{ mapId: 1, offset: 0, hitCount: 10 }],
    });
    const graph = makeGraph([node]);
    const count = inlineCacheLowering(graph, {});
    assert.equal(count, 0);
    assert.equal(graph.blocks[0].nodes[0].type, IR_POLYMORPHIC_LOAD);
  });

  it("preserves non-IC nodes in the block", () => {
    const icNode = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [
        { mapId: 1, offset: 0, hitCount: 5 },
        { mapId: 2, offset: 1, hitCount: 3 },
      ],
    });
    const otherNode = makeNode(2, "OTHER", {});
    const graph = makeGraph([otherNode, icNode]);
    inlineCacheLowering(graph, {});
    assert.equal(graph.blocks[0].nodes.length, 2);
    assert.equal(graph.blocks[0].nodes[0].type, "OTHER");
    assert.equal(graph.blocks[0].nodes[1].type, IR_DISPATCH_MAP);
  });

  it("updates uses when replacing nodes", () => {
    const icNode = makeNode(1, IR_POLYMORPHIC_LOAD, {
      propertyName: "x",
      feedbackSlot: 0,
      handlers: [
        { mapId: 1, offset: 0, hitCount: 5 },
        { mapId: 2, offset: 1, hitCount: 3 },
      ],
    });
    const consumer = makeNode(2, "USE", {});
    consumer.inputs = [icNode];
    icNode.uses = [consumer];

    const graph = makeGraph([icNode, consumer]);
    inlineCacheLowering(graph, {});
    assert.equal(consumer.inputs[0].type, IR_DISPATCH_MAP);
    assert.equal(consumer.inputs[0] instanceof IRNode, true);
  });
});
