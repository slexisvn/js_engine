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

  free(reg) {
    this.freeTemps.push(reg);
  }
}
