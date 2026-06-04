import { getTag } from "../../core/value/index.js";

export const CELL_UNINITIALIZED = "uninitialized";
export const CELL_CONSTANT = "constant";
export const CELL_MUTABLE = "mutable";

export class GlobalCell {
  constructor(name) {
    this.name = name;
    this.value = undefined;
    this.state = CELL_UNINITIALIZED;
    this.writeCount = 0;
    this.firstValue = undefined;
  }

  read() {
    return this.value;
  }

  write(value) {
    this.writeCount++;
    if (this.state === CELL_UNINITIALIZED) {
      this.state = CELL_CONSTANT;
      this.firstValue = value;
    } else if (this.state === CELL_CONSTANT) {
      if (
        value !== this.firstValue ||
        getTag(value) !== getTag(this.firstValue)
      ) {
        this.state = CELL_MUTABLE;
      }
    }
    this.value = value;
  }

  isConstant() {
    return this.state === CELL_CONSTANT;
  }

  isMutable() {
    return this.state === CELL_MUTABLE;
  }
}

export class GlobalCellMap {
  constructor() {
    this.cells = new Map();
  }

  getOrCreate(name) {
    if (!this.cells.has(name)) {
      this.cells.set(name, new GlobalCell(name));
    }
    return this.cells.get(name);
  }

  get(name) {
    return this.cells.get(name);
  }

  has(name) {
    return this.cells.has(name);
  }

  read(name) {
    const cell = this.cells.get(name);
    return cell ? cell.read() : undefined;
  }

  write(name, value) {
    this.getOrCreate(name).write(value);
  }
}
