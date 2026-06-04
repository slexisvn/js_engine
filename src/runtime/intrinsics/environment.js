export class UpvalueCell {
  constructor(frame, localSlot) {
    this.frame = frame;
    this.localSlot = localSlot;
    this.closed = false;
    this.closedValue = null;
  }

  get() {
    if (this.closed) return this.closedValue;
    return this.frame.locals[this.localSlot];
  }

  set(value) {
    if (this.closed) {
      this.closedValue = value;
    } else {
      this.frame.locals[this.localSlot] = value;
    }
  }

  close() {
    if (!this.closed) {
      this.closedValue = this.frame.locals[this.localSlot];
      this.closed = true;
      this.frame = null;
    }
  }
}

export class Environment {
  constructor(cells) {
    this.cells = cells;
  }

  getUpvalue(index) {
    return this.cells[index].get();
  }

  setUpvalue(index, value) {
    this.cells[index].set(value);
  }
}
