import { mkUndefined } from "../../../core/value/index.js";
import { UpvalueCell } from "../../../runtime/intrinsics/environment.js";
import { VMReferenceError } from "../../../core/errors/index.js";

export const TDZ_UNINITIALIZED = { kind: "tdz-uninitialized" };

export function isTDZUninitialized(value) {
  return value === TDZ_UNINITIALIZED;
}

export function throwIfTDZ(value, name) {
  if (isTDZUninitialized(value)) {
    throw new VMReferenceError(
      `Cannot access '${name || "<binding>"}' before initialization`,
    );
  }
  return value;
}

export class RegisterFrame {
  constructor(compiledFn, args, thisValue, closureEnv) {
    this.compiledFn = compiledFn;
    this.pc = 0;
    this.acc = mkUndefined();
    const regCount = compiledFn.registerCount;
    this.registers = new Array(regCount);
    for (let i = 0; i < regCount; i++) this.registers[i] = mkUndefined();
    if (compiledFn.uninitializedLocalSlots) {
      for (const slot of compiledFn.uninitializedLocalSlots) {
        this.registers[slot] = TDZ_UNINITIALIZED;
      }
    }
    this.thisValue = thisValue || mkUndefined();
    this.closureEnv = closureEnv || null;
    this.openUpvalues = new Map();
    this.originalArgs = args.slice();
    this.exceptionHandlers = [];
    this.locals = this.registers;

    for (let i = 0; i < args.length && i < compiledFn.paramCount; i++) {
      this.registers[i] = args[i];
    }
  }

  getReg(idx) {
    if (this.openUpvalues.has(idx)) {
      return throwIfTDZ(
        this.openUpvalues.get(idx).get(),
        this.compiledFn.localNames[idx],
      );
    }
    return throwIfTDZ(this.registers[idx], this.compiledFn.localNames[idx]);
  }

  setReg(idx, value) {
    if (this.openUpvalues.has(idx)) {
      this.openUpvalues.get(idx).set(value);
    } else {
      this.registers[idx] = value;
    }
  }

  getOrCreateUpvalueCell(localSlot) {
    if (this.openUpvalues.has(localSlot)) {
      return this.openUpvalues.get(localSlot);
    }
    const cell = new UpvalueCell(this, localSlot);
    this.openUpvalues.set(localSlot, cell);
    return cell;
  }

  closeUpvalues() {
    for (const cell of this.openUpvalues.values()) {
      cell.close();
    }
  }
}
