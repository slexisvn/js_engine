import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IncrementalMarker,
  COLOR_WHITE,
  COLOR_GREY,
  COLOR_BLACK,
} from "../../src/gc/incremental-marker.js";
import { HeapRegion } from "../../src/gc/heap-region.js";
import { OldGeneration } from "../../src/gc/old-generation.js";
import {
  HiddenClass,
  resetHiddenClasses,
} from "../../src/objects/maps/hidden-class.js";

function makeObj(id) {
  const refs = [];
  return {
    id,
    gcHeader: {
      color: COLOR_WHITE,
      generation: "young",
      marked: false,
      oldGenIndex: -1,
    },
    visitReferences(cb) {
      refs.forEach(cb);
    },
    _refs: refs,
    addRef(other) {
      refs.push(other);
    },
  };
}

describe("GC & Heap Improvements", () => {
  describe("IncrementalMarker time budget", () => {
    it("step uses wall-clock time and respects budget", () => {
      const marker = new IncrementalMarker();
      // Create a chain of objects
      const objs = [];
      for (let i = 0; i < 100; i++) {
        objs.push(makeObj(i));
      }
      // Chain them: each references the next
      for (let i = 0; i < 99; i++) {
        objs[i].addRef(objs[i + 1]);
      }

      marker.startMarking([objs[0]]);
      // With a tiny budget, should not process all in one step
      // but at least process 1 (we always process at least 1)
      const stillWorking = marker.step(0.001); // 0.001ms budget
      assert.ok(marker.totalMarked >= 1, "should mark at least 1 object");
    });

    it("step with large budget processes everything", () => {
      const marker = new IncrementalMarker();
      const objs = [];
      for (let i = 0; i < 10; i++) {
        objs.push(makeObj(i));
      }
      for (let i = 0; i < 9; i++) {
        objs[i].addRef(objs[i + 1]);
      }

      marker.startMarking([objs[0]]);
      marker.step(1000); // 1 second — plenty of time
      assert.equal(marker.totalMarked, 10);
      assert.ok(marker.markingComplete);
    });
  });

  describe("SATB write barrier", () => {
    it("pushes old reference onto worklist when overwriting BLACK→WHITE field", () => {
      const marker = new IncrementalMarker();
      const holder = makeObj("holder");
      const oldRef = makeObj("old");
      const newRef = makeObj("new");

      holder.gcHeader.color = COLOR_BLACK;
      oldRef.gcHeader.color = COLOR_WHITE;
      newRef.gcHeader.color = COLOR_WHITE;

      marker.marking = true;
      marker.markingComplete = false;

      marker.writeBarrier(holder, newRef, oldRef);

      // Both old and new should be GREY and in worklist
      assert.equal(oldRef.gcHeader.color, COLOR_GREY);
      assert.equal(newRef.gcHeader.color, COLOR_GREY);
      assert.ok(marker.worklist.length >= 2);
    });

    it("Dijkstra barrier still works without old ref", () => {
      const marker = new IncrementalMarker();
      const holder = makeObj("holder");
      const newRef = makeObj("new");

      holder.gcHeader.color = COLOR_BLACK;
      newRef.gcHeader.color = COLOR_WHITE;

      marker.marking = true;
      marker.markingComplete = false;

      marker.writeBarrier(holder, newRef); // no oldRef
      assert.equal(newRef.gcHeader.color, COLOR_GREY);
    });
  });

  describe("HeapRegion reset O(used)", () => {
    it("reset only clears used portion", () => {
      const region = new HeapRegion(1024);
      // Allocate only 3 objects
      region.allocate({ a: 1 });
      region.allocate({ a: 2 });
      region.allocate({ a: 3 });
      assert.equal(region.usedSlots(), 3);

      region.reset();
      assert.equal(region.usedSlots(), 0);
      assert.equal(region.get(0), undefined);
      assert.equal(region.get(1), undefined);
      assert.equal(region.get(2), undefined);
    });

    it("reset allows re-allocation from the start", () => {
      const region = new HeapRegion(16);
      for (let i = 0; i < 10; i++) region.allocate({ i });
      region.reset();
      assert.equal(region.usedSlots(), 0);
      const idx = region.allocate({ x: 42 });
      assert.equal(idx, 0);
      assert.deepEqual(region.get(0), { x: 42 });
    });
  });

  describe("Old gen partial compaction", () => {
    it("does not compact when fragmentation < 30%", () => {
      const oldGen = new OldGeneration(64);
      for (let i = 0; i < 10; i++) {
        oldGen.allocate(makeObj(i));
      }
      // No free list entries → 0% fragmentation
      const moved = oldGen.compact();
      assert.equal(moved, 0);
    });

    it("compacts when fragmentation is high", () => {
      const oldGen = new OldGeneration(64);
      const objs = [];
      for (let i = 0; i < 20; i++) {
        objs.push(makeObj(i));
        oldGen.allocate(objs[i]);
      }
      // Free half the objects to create fragmentation
      const markSet = new Set();
      for (let i = 0; i < 20; i += 2) {
        markSet.add(objs[i]); // keep even indices
      }
      oldGen.markSweep(markSet);
      // 10 free out of 20 → 50% fragmentation
      const moved = oldGen.compact();
      assert.ok(moved > 0, "should have moved objects");
      assert.equal(oldGen.liveCount, 10);
    });

    it("objects have correct indices after compaction", () => {
      const oldGen = new OldGeneration(64);
      const objs = [];
      for (let i = 0; i < 10; i++) {
        objs.push(makeObj(i));
        oldGen.allocate(objs[i]);
      }
      // Free odd indices
      const markSet = new Set([objs[0], objs[2], objs[4], objs[6], objs[8]]);
      oldGen.markSweep(markSet);
      oldGen.compact();

      // Each surviving object should be accessible at its oldGenIndex
      for (const obj of markSet) {
        const idx = obj.gcHeader.oldGenIndex;
        assert.ok(idx >= 0 && idx < oldGen.allocPointer);
      }
    });
  });

  describe("Hidden class deprecation memoization", () => {
    it("caches migration target for same property set", () => {
      resetHiddenClasses();

      // Create two hidden classes with identical property sets
      const hc1Root = new HiddenClass(null, null, null, 0);
      const hc1a = hc1Root.transition("x");
      const hc1b = hc1a.transition("y");

      const hc2Root = new HiddenClass(null, null, null, 0);
      const hc2a = hc2Root.transition("x");
      const hc2b = hc2a.transition("y");

      // Deprecate both — should get same migration target
      const target1 = hc1b.deprecate("test1");
      const target2 = hc2b.deprecate("test2");

      assert.strictEqual(
        target1,
        target2,
        "same property set should reuse cached migration target",
      );
    });

    it("different property sets get different targets", () => {
      resetHiddenClasses();

      const hc1Root = new HiddenClass(null, null, null, 0);
      const hc1a = hc1Root.transition("x");

      const hc2Root = new HiddenClass(null, null, null, 0);
      const hc2a = hc2Root.transition("y"); // different property name

      const target1 = hc1a.deprecate("test1");
      const target2 = hc2a.deprecate("test2");

      assert.notStrictEqual(
        target1,
        target2,
        "different property sets should get different targets",
      );
    });
  });
});
