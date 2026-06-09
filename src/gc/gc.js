import { HeapRegion } from "./heap-region.js";
import { OldGeneration } from "./old-generation.js";
import { RememberedSet } from "./remembered-set.js";
import { enumerateRoots, collectLiveHeapIds } from "./roots.js";
import { sweepHeapPayloads } from "../core/value/index.js";
import { tracer } from "../core/tracing/index.js";
import { IncrementalMarker, COLOR_WHITE } from "./incremental-marker.js";

const TENURE_THRESHOLD = 2;
const MAJOR_GC_RATIO = 0.75;
const MAJOR_GC_GROWTH_FACTOR = 1.5;
const DEFAULT_ALLOCATION_BUDGET = 4096;
const PRETENURE_SIZE_THRESHOLD = 512;
const MIN_ALLOCATION_BUDGET = 1024;
const MAX_ALLOCATION_BUDGET = 65536;
const DEFAULT_TARGET_PAUSE_MS = 2;

export class GenerationalGC {
  constructor(options = {}) {
    this.fromSpace = new HeapRegion(options.youngGenSize);
    this.toSpace = new HeapRegion(options.youngGenSize);
    this.oldGen = new OldGeneration(options.oldGenCapacity);
    this.rememberedSet = new RememberedSet();

    this.interpreter = null;
    this.globalCells = null;
    this.microtaskQueue = null;

    this._allocationBudget = options.allocationBudget || DEFAULT_ALLOCATION_BUDGET;
    this._allocationsSinceGC = 0;
    this._majorGCThreshold = 0;
    this._targetPauseMs = options.targetPauseMs || DEFAULT_TARGET_PAUSE_MS;

    this.stats = {
      minorGCCount: 0,
      majorGCCount: 0,
      totalPromoted: 0,
      totalCollected: 0,
      totalAllocated: 0,
    };

    this.incrementalMarker = new IncrementalMarker();
    this._incrementalMajorGCActive = false;
  }

  bindRoots(interpreter, globalCells, microtaskQueue) {
    this.interpreter = interpreter;
    this.globalCells = globalCells;
    this.microtaskQueue = microtaskQueue;
  }

  allocate(obj, pretenure = false) {
    if (!obj.gcHeader) {
      obj.gcHeader = {
        age: 0,
        marked: false,
        forwarding: null,
        generation: "young",
        youngIndex: -1,
        oldGenIndex: -1,
        color: COLOR_WHITE,
      };
    }

    if (pretenure) {
      this._allocateOld(obj);
      this.stats.totalAllocated++;
      return obj;
    }

    const index = this.fromSpace.allocate(obj);
    if (index === null) {
      this.minorGC();
      const retryIndex = this.fromSpace.allocate(obj);
      if (retryIndex === null) {
        this._allocateOld(obj);
        return obj;
      }
      obj.gcHeader.youngIndex = retryIndex;
    } else {
      obj.gcHeader.youngIndex = index;
    }

    obj.gcHeader.generation = "young";
    this.stats.totalAllocated++;
    this._allocationsSinceGC++;
    return obj;
  }

  needsCollection() {
    return this._allocationsSinceGC >= this._allocationBudget || this.fromSpace.isFull();
  }

  checkSafepoint() {
    if (this._incrementalMajorGCActive) {
      this.incrementalMarkingStep();
    }
    if (this.needsCollection()) {
      this.minorGC();
    }
  }

  minorGC() {
    tracer.log(
      "GC",
      `Scavenge start — young gen: ${this.fromSpace.usedSlots()} objects`,
    );
    const startTime = performance.now();

    const temp = this.fromSpace;
    this.fromSpace = this.toSpace;
    this.toSpace = temp;
    this.fromSpace.reset();

    const roots = enumerateRoots(
      this.interpreter,
      this.globalCells,
      this.microtaskQueue,
    );
    let promoted = 0;
    let copied = 0;
    const visited = new Set();

    const processRef = (obj) => {
      if (!obj || !obj.gcHeader || visited.has(obj)) return;
      if (obj.gcHeader.generation !== "young") return;
      visited.add(obj);

      obj.gcHeader.age++;

      if (obj.gcHeader.age >= TENURE_THRESHOLD) {
        this._promote(obj);
        promoted++;
      } else {
        const newIndex = this.fromSpace.allocate(obj);
        if (newIndex === null) {
          this._promote(obj);
          promoted++;
        } else {
          obj.gcHeader.youngIndex = newIndex;
          copied++;
        }
      }

      if (obj.visitReferences) {
        obj.visitReferences(processRef);
      }
    };

    for (const root of roots) {
      processRef(root);
    }

    const processedHolders = new Set();
    this.rememberedSet.iterateHolders((holder) => {
      if (!holder || !holder.gcHeader || processedHolders.has(holder)) return;
      if (holder.gcHeader.generation !== "old") return;
      processedHolders.add(holder);
      if (holder.visitReferences) {
        holder.visitReferences(processRef);
      }
    });

    this.toSpace.reset();

    this.rememberedSet.clear();

    this.stats.minorGCCount++;
    this.stats.totalPromoted += promoted;
    this._allocationsSinceGC = 0;

    const elapsedMs = performance.now() - startTime;
    const elapsed = elapsedMs.toFixed(2);
    tracer.log(
      "GC",
      `Scavenge end — copied: ${copied}, promoted: ${promoted}, time: ${elapsed}ms`,
    );

    if (elapsedMs > this._targetPauseMs) {
      this._allocationBudget = Math.max(
        MIN_ALLOCATION_BUDGET,
        this._allocationBudget >>> 1,
      );
    } else if (elapsedMs < this._targetPauseMs / 2) {
      this._allocationBudget = Math.min(
        MAX_ALLOCATION_BUDGET,
        (this._allocationBudget * 3) >>> 1,
      );
    }

    this._checkMajorGCTrigger();
  }

  majorGC() {
    tracer.log(
      "GC",
      `Mark-Compact start — old gen: ${this.oldGen.liveCount} objects`,
    );
    const startTime = performance.now();

    const markSet = new Set();
    const worklist = [];

    const roots = enumerateRoots(
      this.interpreter,
      this.globalCells,
      this.microtaskQueue,
    );
    for (const root of roots) {
      if (root && root.gcHeader) {
        markSet.add(root);
        worklist.push(root);
      }
    }

    this.fromSpace.forEach((obj) => {
      if (obj && obj.gcHeader) {
        markSet.add(obj);
        worklist.push(obj);
      }
    });

    while (worklist.length > 0) {
      const obj = worklist.pop();
      if (!obj.visitReferences) continue;
      obj.visitReferences((ref) => {
        if (ref && ref.gcHeader && !markSet.has(ref)) {
          markSet.add(ref);
          worklist.push(ref);
        }
      });
    }

    const { swept, evacuated } = this.oldGen.markCompact(markSet);
    this.stats.majorGCCount++;
    this.stats.totalCollected += swept;

    this.rememberedSet.clear();
    this._rebuildRememberedSetFromOldGen();

    const liveIds = collectLiveHeapIds(this.interpreter, this.globalCells);
    const heapFreed = sweepHeapPayloads(liveIds);

    this._majorGCThreshold = Math.max(
      this.oldGen.liveCount * MAJOR_GC_GROWTH_FACTOR,
      this.oldGen.capacity * MAJOR_GC_RATIO,
    );

    const elapsed = (performance.now() - startTime).toFixed(2);
    tracer.log(
      "GC",
      `Mark-Compact end — swept: ${swept}, evacuated: ${evacuated}, heapFreed: ${heapFreed}, time: ${elapsed}ms`,
    );
  }

  collectGarbage(type = "minor") {
    if (type === "major" || type === "full") {
      this.minorGC();
      this.majorGC();
    } else {
      this.minorGC();
    }
  }

  startIncrementalMajorGC() {
    if (this._incrementalMajorGCActive) return;
    tracer.log(
      "GC",
      `Incremental Mark-Compact start — old gen: ${this.oldGen.liveCount} objects`,
    );
    this._incrementalMajorGCActive = true;

    this.oldGen.forEach((obj) => {
      if (obj.gcHeader) obj.gcHeader.color = COLOR_WHITE;
    });
    this.fromSpace.forEach((obj) => {
      if (obj && obj.gcHeader) obj.gcHeader.color = COLOR_WHITE;
    });

    const roots = enumerateRoots(
      this.interpreter,
      this.globalCells,
      this.microtaskQueue,
    );
    this.fromSpace.forEach((obj) => {
      if (obj && obj.gcHeader) roots.push(obj);
    });

    this.incrementalMarker.startMarking(roots);
  }

  incrementalMarkingStep(budget) {
    if (!this._incrementalMajorGCActive) return false;
    const moreWork = this.incrementalMarker.step(budget);
    if (!moreWork) {
      this.finishIncrementalMajorGC();
      return false;
    }
    return true;
  }

  finishIncrementalMajorGC() {
    if (!this._incrementalMajorGCActive) return;

    this.incrementalMarker.finishMarking();

    const markSet = new Set();
    this.oldGen.forEach((obj) => {
      if (obj.gcHeader && obj.gcHeader.color !== COLOR_WHITE) {
        markSet.add(obj);
      }
    });
    this.fromSpace.forEach((obj) => {
      if (obj && obj.gcHeader && obj.gcHeader.color !== COLOR_WHITE) {
        markSet.add(obj);
      }
    });

    const { swept, evacuated } = this.oldGen.markCompact(markSet);
    this.stats.majorGCCount++;
    this.stats.totalCollected += swept;

    this.rememberedSet.clear();
    this._rebuildRememberedSetFromOldGen();

    const liveIds = collectLiveHeapIds(this.interpreter, this.globalCells);
    const heapFreed = sweepHeapPayloads(liveIds);

    this._majorGCThreshold = Math.max(
      this.oldGen.liveCount * MAJOR_GC_GROWTH_FACTOR,
      this.oldGen.capacity * MAJOR_GC_RATIO,
    );

    tracer.log(
      "GC",
      `Incremental Mark-Compact end — marked: ${this.incrementalMarker.totalMarked}, steps: ${this.incrementalMarker.stepsRun}, swept: ${swept}, evacuated: ${evacuated}, heapFreed: ${heapFreed}`,
    );

    this.incrementalMarker.reset();
    this._incrementalMajorGCActive = false;
  }

  incrementalWriteBarrier(holder, newRef, oldRef) {
    this.incrementalMarker.writeBarrier(holder, newRef, oldRef);
  }

  isIncrementalMarkingActive() {
    return this._incrementalMajorGCActive;
  }

  isInYoungGen(obj) {
    return obj && obj.gcHeader && obj.gcHeader.generation === "young";
  }

  isInOldGen(obj) {
    return obj && obj.gcHeader && obj.gcHeader.generation === "old";
  }

  getStats() {
    return {
      ...this.stats,
      youngGenUsed: this.fromSpace.usedSlots(),
      oldGenLive: this.oldGen.liveCount,
      oldGenCapacity: this.oldGen.capacity,
      rememberedSetSize: this.rememberedSet.size,
      allocationBudget: this._allocationBudget,
      allocationsSinceGC: this._allocationsSinceGC,
    };
  }

  _promote(obj) {
    obj.gcHeader.generation = "old";
    this.oldGen.allocate(obj);
  }

  _allocateOld(obj) {
    obj.gcHeader.generation = "old";
    obj.gcHeader.age = TENURE_THRESHOLD;
    this.oldGen.allocate(obj);
  }

  _checkMajorGCTrigger() {
    const threshold = this._majorGCThreshold > 0
      ? this._majorGCThreshold
      : this.oldGen.capacity * MAJOR_GC_RATIO;

    if (this.oldGen.liveCount > threshold) {
      if (!this._incrementalMajorGCActive) {
        this.startIncrementalMajorGC();
      }
    }
  }

  _rebuildRememberedSetFromOldGen() {
    this.oldGen.forEach((oldObj) => {
      if (!oldObj.visitReferences) return;
      let hasYoungRef = false;
      oldObj.visitReferences((ref) => {
        if (ref && ref.gcHeader && ref.gcHeader.generation === "young") {
          hasYoungRef = true;
        }
      });
      if (hasYoungRef) {
        this.rememberedSet.record(oldObj);
      }
    });
  }
}
