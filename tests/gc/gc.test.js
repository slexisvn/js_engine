import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiniJIT } from "../../src/index.js";
import { resetHiddenClasses } from "../../src/objects/maps/hidden-class.js";
import { GenerationalGC } from "../../src/gc/gc.js";
import { HeapRegion } from "../../src/gc/heap-region.js";
import { OldGeneration } from "../../src/gc/old-generation.js";
import { RememberedSet } from "../../src/gc/remembered-set.js";

describe("HeapRegion", () => {
  it("allocates objects with bump pointer", () => {
    const region = new HeapRegion(8);
    const obj = { gcHeader: null };
    const idx = region.allocate(obj);
    assert.equal(idx, 0);
    assert.equal(region.get(0), obj);
    assert.equal(region.usedSlots(), 1);
  });

  it("returns null when full", () => {
    const region = new HeapRegion(2);
    region.allocate({ gcHeader: null });
    region.allocate({ gcHeader: null });
    assert.equal(region.allocate({ gcHeader: null }), null);
    assert.equal(region.isFull(), true);
  });

  it("resets properly", () => {
    const region = new HeapRegion(4);
    region.allocate({ gcHeader: null });
    region.allocate({ gcHeader: null });
    region.reset();
    assert.equal(region.usedSlots(), 0);
    assert.equal(region.isFull(), false);
  });
});

describe("OldGeneration", () => {
  it("allocates and tracks live count", () => {
    const old = new OldGeneration(16);
    const obj = {
      gcHeader: {
        age: 2,
        marked: false,
        forwarding: null,
        generation: "old",
        oldGenIndex: -1,
      },
    };
    old.allocate(obj);
    assert.equal(old.liveCount, 1);
    assert.equal(obj.gcHeader.oldGenIndex, 0);
  });

  it("mark-sweep collects unreachable objects", () => {
    const old = new OldGeneration(16);
    const live = {
      gcHeader: {
        age: 2,
        marked: false,
        forwarding: null,
        generation: "old",
        oldGenIndex: -1,
      },
    };
    const dead = {
      gcHeader: {
        age: 2,
        marked: false,
        forwarding: null,
        generation: "old",
        oldGenIndex: -1,
      },
    };
    old.allocate(live);
    old.allocate(dead);
    assert.equal(old.liveCount, 2);

    const markSet = new Set([live]);
    const swept = old.markSweep(markSet);
    assert.equal(swept, 1);
    assert.equal(old.liveCount, 1);
  });

  it("compacts when fragmented", () => {
    const old = new OldGeneration(16);
    const objs = [];
    for (let i = 0; i < 10; i++) {
      const obj = {
        gcHeader: {
          age: 2,
          marked: false,
          forwarding: null,
          generation: "old",
          oldGenIndex: -1,
        },
        id: i,
      };
      old.allocate(obj);
      objs.push(obj);
    }
    const markSet = new Set([objs[0], objs[5], objs[9]]);
    old.markSweep(markSet);
    assert.equal(old.liveCount, 3);

    const compacted = old.compact();
    assert.ok(compacted > 0, "should have compacted objects");
    // After compaction, surviving objects should be at valid indices
    for (const obj of markSet) {
      const idx = obj.gcHeader.oldGenIndex;
      assert.ok(
        idx >= 0 && idx < old.allocPointer,
        `object should have valid index, got ${idx}`,
      );
    }
  });
});

describe("RememberedSet", () => {
  it("records and tracks entries", () => {
    const rs = new RememberedSet();
    const holder = {};
    rs.record(holder);
    assert.equal(rs.size, 1);
    assert.ok(rs.has(holder));
  });

  it("deduplicates entries", () => {
    const rs = new RememberedSet();
    const holder = {};
    rs.record(holder);
    rs.record(holder);
    assert.equal(rs.size, 1);
  });

  it("clears all entries", () => {
    const rs = new RememberedSet();
    rs.record({});
    rs.record({});
    rs.clear();
    assert.equal(rs.size, 0);
  });

  it("removes entries", () => {
    const rs = new RememberedSet();
    const h = {};
    rs.record(h);
    rs.remove(h);
    assert.equal(rs.size, 0);
    assert.ok(!rs.has(h));
  });

  it("iterates holders", () => {
    const rs = new RememberedSet();
    const a = { id: "a" };
    const b = { id: "b" };
    rs.record(a);
    rs.record(b);
    const visited = [];
    rs.iterateHolders((h) => visited.push(h));
    assert.equal(visited.length, 2);
  });
});

describe("GenerationalGC", () => {
  it("allocates objects into young generation", () => {
    const gc = new GenerationalGC({ youngGenSize: 64 });
    const obj = { id: 1 };
    gc.allocate(obj);
    assert.equal(obj.gcHeader.generation, "young");
    assert.equal(obj.gcHeader.age, 0);
    assert.equal(gc.stats.totalAllocated, 1);
  });

  it("triggers minor GC when young gen is full", () => {
    const gc = new GenerationalGC({ youngGenSize: 4 });
    for (let i = 0; i < 5; i++) {
      gc.allocate({ id: i });
    }
    assert.ok(gc.stats.minorGCCount >= 1);
  });

  it("promotes objects after tenure threshold", () => {
    const gc = new GenerationalGC({ youngGenSize: 8 });
    const fakeInterpreter = {
      activeFrames: [
        {
          locals: [],
          stack: [],
        },
      ],
    };
    const persistent = { id: "persistent", visitReferences: () => {} };
    gc.allocate(persistent);
    fakeInterpreter.activeFrames[0].locals.push(persistent);
    gc.bindRoots(fakeInterpreter, null, null);

    gc.minorGC();
    gc.minorGC();

    assert.equal(persistent.gcHeader.generation, "old");
    assert.ok(gc.stats.totalPromoted >= 1);
  });

  it("reports stats correctly", () => {
    const gc = new GenerationalGC({ youngGenSize: 16 });
    for (let i = 0; i < 5; i++) {
      gc.allocate({ id: i });
    }
    const stats = gc.getStats();
    assert.equal(stats.totalAllocated, 5);
    assert.ok(stats.youngGenUsed >= 0);
  });

  it("major GC collects unreachable old-gen objects", () => {
    const gc = new GenerationalGC({ youngGenSize: 4 });
    const objs = [];
    for (let i = 0; i < 6; i++) {
      const obj = { id: i, visitReferences: () => {} };
      gc.allocate(obj);
      objs.push(obj);
    }
    gc.minorGC();
    gc.minorGC();

    gc.majorGC();
    assert.ok(gc.stats.majorGCCount >= 1);
  });
});

describe("GC integration with engine", () => {
  it("engine has gc instance", () => {
    resetHiddenClasses();
    const engine = new MiniJIT();
    assert.ok(engine.gc);
    assert.ok(engine.gc instanceof GenerationalGC);
  });

  it("engine getStats includes gc stats", () => {
    resetHiddenClasses();
    const engine = new MiniJIT();
    const stats = engine.getStats();
    assert.ok(stats.gc);
    assert.equal(typeof stats.gc.totalAllocated, "number");
  });

  it("runs programs with gc active", () => {
    resetHiddenClasses();
    const engine = new MiniJIT();
    const result = engine.runValue(`
      let sum = 0;
      let i = 0;
      while (i < 100) {
        sum = sum + i;
        i = i + 1;
      }
      sum;
    `);
    assert.equal(result.value, 4950);
  });

  it("object allocation routes through gc", () => {
    resetHiddenClasses();
    const engine = new MiniJIT();
    engine.run(`
      let obj = { x: 1, y: 2 };
      let arr = [1, 2, 3];
      obj.x + arr[0];
    `);
    assert.ok(engine.gc.stats.totalAllocated > 0);
  });

  it("collectGarbage triggers minor gc", () => {
    resetHiddenClasses();
    const engine = new MiniJIT();
    engine.run(`let obj = { x: 1 };`);
    engine.collectGarbage("minor");
    assert.ok(engine.gc.stats.minorGCCount >= 1);
  });

  it("collectGarbage full triggers both minor and major", () => {
    resetHiddenClasses();
    const engine = new MiniJIT();
    engine.run(`let obj = { x: 1 };`);
    engine.collectGarbage("full");
    assert.ok(engine.gc.stats.minorGCCount >= 1);
    assert.ok(engine.gc.stats.majorGCCount >= 1);
  });
});
