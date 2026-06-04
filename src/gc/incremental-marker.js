export const COLOR_WHITE = 0;
export const COLOR_GREY = 1;
export const COLOR_BLACK = 2;

const DEFAULT_TIME_BUDGET_MS = 1;

export class IncrementalMarker {
  constructor() {
    this.worklist = [];
    this.marking = false;
    this.markingComplete = false;
    this.timeBudgetMs = DEFAULT_TIME_BUDGET_MS;
    this.totalMarked = 0;
    this.stepsRun = 0;
  }

  startMarking(roots) {
    this.worklist = [];
    this.marking = true;
    this.markingComplete = false;
    this.totalMarked = 0;
    this.stepsRun = 0;

    for (const root of roots) {
      if (root && root.gcHeader && root.gcHeader.color === COLOR_WHITE) {
        root.gcHeader.color = COLOR_GREY;
        this.worklist.push(root);
      }
    }
  }

  step(budgetMs = this.timeBudgetMs) {
    if (!this.marking || this.markingComplete) return false;
    this.stepsRun++;

    const deadline = performance.now() + budgetMs;
    let processed = 0;

    while (this.worklist.length > 0) {
      if (processed > 0 && performance.now() >= deadline) break;

      const obj = this.worklist.pop();
      if (!obj.gcHeader || obj.gcHeader.color === COLOR_BLACK) continue;

      obj.gcHeader.color = COLOR_BLACK;
      processed++;
      this.totalMarked++;

      if (obj.visitReferences) {
        obj.visitReferences((ref) => {
          if (ref && ref.gcHeader && ref.gcHeader.color === COLOR_WHITE) {
            ref.gcHeader.color = COLOR_GREY;
            this.worklist.push(ref);
          }
        });
      }
    }

    if (this.worklist.length === 0) {
      this.markingComplete = true;
    }

    return !this.markingComplete;
  }

  /**
   * SATB (Snapshot-At-The-Beginning) write barrier.
   * When a BLACK object overwrites a field, we must push the OLD value
   * (not just the new value) onto the worklist to prevent floating garbage.
   * The new value is also grey-pushed if WHITE (Dijkstra-style).
   */
  writeBarrier(holder, newRef, oldRef) {
    if (!this.marking || this.markingComplete) return;
    if (!holder || !holder.gcHeader) return;

    // SATB: if holder is BLACK and oldRef is WHITE, push oldRef
    // This prevents the old reference from becoming floating garbage
    if (oldRef && oldRef.gcHeader && holder.gcHeader.color === COLOR_BLACK) {
      if (oldRef.gcHeader.color === COLOR_WHITE) {
        oldRef.gcHeader.color = COLOR_GREY;
        this.worklist.push(oldRef);
      }
    }

    // Dijkstra: if holder is BLACK and newRef is WHITE, push newRef
    if (newRef && newRef.gcHeader) {
      if (
        holder.gcHeader.color === COLOR_BLACK &&
        newRef.gcHeader.color === COLOR_WHITE
      ) {
        newRef.gcHeader.color = COLOR_GREY;
        this.worklist.push(newRef);
      }
    }
  }

  finishMarking() {
    while (this.worklist.length > 0) {
      this.step(Infinity);
    }
    this.marking = false;
    this.markingComplete = true;
  }

  isMarking() {
    return this.marking && !this.markingComplete;
  }

  reset() {
    this.worklist = [];
    this.marking = false;
    this.markingComplete = false;
    this.totalMarked = 0;
    this.stepsRun = 0;
  }
}
