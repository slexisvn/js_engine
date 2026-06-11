export class TempAllocator {
  constructor(func) {
    this.func = func;
    this.freeTemps = [];
  }

  alloc() {
    if (this.freeTemps.length > 0) {
      return this.freeTemps.pop();
    }
    return this.func.allocTemp();
  }

  allocContiguous(count) {
    const base = this.func.registerCount;
    this.func.registerCount += count;
    return base;
  }

  free(reg) {
    this.freeTemps.push(reg);
  }
}
