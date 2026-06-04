const YOUNG_GEN_SEMI_SPACE_SIZE = 1 << 19;

export class HeapRegion {
  constructor(size = YOUNG_GEN_SEMI_SPACE_SIZE) {
    this.size = size;
    this.storage = new Array(size);
    this.allocPointer = 0;
  }

  allocate(obj) {
    if (this.allocPointer >= this.size) {
      return null;
    }
    const index = this.allocPointer++;
    this.storage[index] = obj;
    return index;
  }

  get(index) {
    return this.storage[index];
  }

  set(index, obj) {
    this.storage[index] = obj;
  }

  reset() {
    this.storage.fill(undefined, 0, this.allocPointer);
    this.allocPointer = 0;
  }

  isFull() {
    return this.allocPointer >= this.size;
  }

  usedSlots() {
    return this.allocPointer;
  }

  forEach(callback) {
    for (let i = 0; i < this.allocPointer; i++) {
      if (this.storage[i] !== undefined) {
        callback(this.storage[i], i);
      }
    }
  }
}

export { YOUNG_GEN_SEMI_SPACE_SIZE };
