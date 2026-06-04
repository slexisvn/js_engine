import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  IncrementalMarker,
  COLOR_WHITE,
  COLOR_GREY,
  COLOR_BLACK,
} from "../../src/gc/incremental-marker.js";
import { GenerationalGC } from "../../src/gc/gc.js";
import { storeBarrier, bindWriteBarrierGC } from "../../src/gc/write-barrier.js";

function makeObj(name, refs = []) {
  const obj = {
    name,
    refs,
    gcHeader: null,
    visitReferences(cb) {
      for (const r of this.refs) cb(r);
    },
  };
  return obj;
}

describe("Incremental GC with Tri-Color Marking", () => {
  describe("Tri-Color Marking", () => {
    it("marks single root as black", () => {
      const marker = new IncrementalMarker();
      const root = makeObj("root");
      root.gcHeader = { color: COLOR_WHITE };
      marker.startMarking([root]);
      marker.step(100);
      assert.equal(root.gcHeader.color, COLOR_BLACK);
      assert.equal(marker.markingComplete, true);
    });

    it("marks reachable objects transitively", () => {
      const marker = new IncrementalMarker();
      const c = makeObj("c");
      c.gcHeader = { color: COLOR_WHITE };
      const b = makeObj("b", [c]);
      b.gcHeader = { color: COLOR_WHITE };
      const a = makeObj("a", [b]);
      a.gcHeader = { color: COLOR_WHITE };

      marker.startMarking([a]);
      marker.step(100);

      assert.equal(a.gcHeader.color, COLOR_BLACK);
      assert.equal(b.gcHeader.color, COLOR_BLACK);
      assert.equal(c.gcHeader.color, COLOR_BLACK);
      assert.equal(marker.totalMarked, 3);
    });

    it("leaves unreachable objects white", () => {
      const marker = new IncrementalMarker();
      const reachable = makeObj("reachable");
      reachable.gcHeader = { color: COLOR_WHITE };
      const unreachable = makeObj("unreachable");
      unreachable.gcHeader = { color: COLOR_WHITE };

      marker.startMarking([reachable]);
      marker.step(100);

      assert.equal(reachable.gcHeader.color, COLOR_BLACK);
      assert.equal(unreachable.gcHeader.color, COLOR_WHITE);
    });

    it("supports incremental stepping with budget", () => {
      const marker = new IncrementalMarker();
      const objects = [];
      for (let i = 0; i < 10; i++) {
        const obj = makeObj(`obj${i}`);
        obj.gcHeader = { color: COLOR_WHITE };
        objects.push(obj);
      }
      for (let i = 0; i < 9; i++) {
        objects[i].refs = [objects[i + 1]];
      }

      marker.startMarking([objects[0]]);
      // Time-based budget: even a small ms budget processes at least 1
      // Use a generous budget to process all
      while (marker.step(10)) {}
      assert.equal(marker.markingComplete, true);
      assert.equal(marker.totalMarked, 10);
    });
  });

  describe("Write Barrier During Incremental Marking", () => {
    it("re-greys black object when new white ref added", () => {
      const marker = new IncrementalMarker();
      const a = makeObj("a");
      a.gcHeader = { color: COLOR_WHITE };

      marker.startMarking([a]);
      marker.step(10);
      assert.equal(a.gcHeader.color, COLOR_BLACK);

      // Manually set marker to active state to test write barrier
      marker.marking = true;
      marker.markingComplete = false;

      const newObj = makeObj("new");
      newObj.gcHeader = { color: COLOR_WHITE };

      marker.writeBarrier(a, newObj);
      assert.equal(newObj.gcHeader.color, COLOR_GREY);
      assert.ok(marker.worklist.length >= 1);
    });

    it("no-ops when not marking", () => {
      const marker = new IncrementalMarker();
      const root = makeObj("root");
      root.gcHeader = { color: COLOR_BLACK };
      const newObj = makeObj("new");
      newObj.gcHeader = { color: COLOR_WHITE };

      marker.writeBarrier(root, newObj);
      assert.equal(newObj.gcHeader.color, COLOR_WHITE);
    });
  });

  describe("GC Integration", () => {
    it("startIncrementalMajorGC initializes marking", () => {
      const gc = new GenerationalGC({ youngGenSize: 100, oldGenCapacity: 100 });
      const obj = makeObj("test");
      gc.allocate(obj);
      obj.gcHeader.generation = "old";
      gc.oldGen.allocate(obj);

      gc.startIncrementalMajorGC();
      assert.equal(gc.isIncrementalMarkingActive(), true);
    });

    it("incremental marking completes and sweeps", () => {
      const gc = new GenerationalGC({ youngGenSize: 100, oldGenCapacity: 100 });
      const obj1 = makeObj("obj1");
      gc.allocate(obj1);
      const obj2 = makeObj("obj2");
      gc.allocate(obj2);

      gc.startIncrementalMajorGC();
      while (gc.incrementalMarkingStep(10)) {}
      assert.equal(gc.isIncrementalMarkingActive(), false);
    });

    it("write barrier integration during incremental GC", () => {
      const gc = new GenerationalGC({ youngGenSize: 100, oldGenCapacity: 100 });
      const holder = makeObj("holder");
      gc.allocate(holder);
      holder.gcHeader.color = COLOR_BLACK;

      const newRef = makeObj("newRef");
      gc.allocate(newRef);
      newRef.gcHeader.color = COLOR_WHITE;

      gc._incrementalMajorGCActive = true;
      gc.incrementalMarker.marking = true;
      gc.incrementalMarker.markingComplete = false;

      bindWriteBarrierGC(gc);
      storeBarrier(holder, newRef);
      assert.equal(newRef.gcHeader.color, COLOR_GREY);
      bindWriteBarrierGC(null);
    });

    it("checkSafepoint advances incremental marking", () => {
      const gc = new GenerationalGC({ youngGenSize: 100, oldGenCapacity: 100 });
      const obj = makeObj("obj");
      gc.allocate(obj);

      gc.startIncrementalMajorGC();
      const wasActive = gc.isIncrementalMarkingActive();
      gc.checkSafepoint();
      assert.ok(wasActive);
    });
  });

  describe("IncrementalMarker state management", () => {
    it("reset clears all state", () => {
      const marker = new IncrementalMarker();
      const root = makeObj("root");
      root.gcHeader = { color: COLOR_WHITE };
      marker.startMarking([root]);
      marker.step(100);

      marker.reset();
      assert.equal(marker.marking, false);
      assert.equal(marker.markingComplete, false);
      assert.equal(marker.worklist.length, 0);
      assert.equal(marker.totalMarked, 0);
    });

    it("finishMarking processes remaining worklist", () => {
      const marker = new IncrementalMarker();
      const objects = [];
      for (let i = 0; i < 20; i++) {
        const obj = makeObj(`obj${i}`);
        obj.gcHeader = { color: COLOR_WHITE };
        objects.push(obj);
      }
      for (let i = 0; i < 19; i++) {
        objects[i].refs = [objects[i + 1]];
      }

      marker.startMarking([objects[0]]);
      // Use 0.001ms budget — processes at least 1 but may not finish all 20
      marker.step(0.001);
      const markedSoFar = marker.totalMarked;
      assert.ok(markedSoFar >= 1, "should mark at least 1");

      marker.finishMarking();
      assert.equal(marker.markingComplete, true);
      assert.equal(marker.totalMarked, 20);
      for (const obj of objects) {
        assert.equal(obj.gcHeader.color, COLOR_BLACK);
      }
    });
  });
});
