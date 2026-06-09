import { CODE_UNDEFINED } from "../../../core/value/index.js";
import { UpvalueCell } from "../../../runtime/intrinsics/environment.js";
import { VMReferenceError } from "../../../core/errors/index.js";

export const TDZ_UNINITIALIZED = { kind: "tdz-uninitialized" };

export function isTDZUninitialized(value) {
  return value === TDZ_UNINITIALIZED;
}

export function throwIfTDZ(value, name) {
  if (value === TDZ_UNINITIALIZED) {
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
    this.acc = CODE_UNDEFINED;
    const regCount = compiledFn.registerCount;
    this.registers = new Array(regCount).fill(CODE_UNDEFINED);
    this.hasTDZ = compiledFn.uninitializedLocalSlots?.size > 0;
    if (this.hasTDZ) {
      for (const slot of compiledFn.uninitializedLocalSlots) {
        this.registers[slot] = TDZ_UNINITIALIZED;
      }
    }
    this.thisValue = thisValue || CODE_UNDEFINED;
    this.closureEnv = closureEnv || null;
    this.openUpvalues = null;
    this.hasUpvalues = false;
    this.originalArgs = args;
    this.exceptionHandlers = null;
    this.locals = this.registers;

    for (let i = 0; i < args.length && i < compiledFn.paramCount; i++) {
      this.registers[i] = args[i];
    }
  }

  get directRegisters() {
    if (!this.hasUpvalues && !this.hasTDZ) return this.registers;
    return null;
  }

  getReg(idx) {
    if (this.hasUpvalues && this.openUpvalues.has(idx)) {
      return throwIfTDZ(
        this.openUpvalues.get(idx).get(),
        this.compiledFn.localNames[idx],
      );
    }
    const val = this.registers[idx];
    if (this.hasTDZ && val === TDZ_UNINITIALIZED) {
      throw new VMReferenceError(
        `Cannot access '${this.compiledFn.localNames[idx] || "<binding>"}' before initialization`,
      );
    }
    return val;
  }

  setReg(idx, value) {
    if (this.hasUpvalues && this.openUpvalues.has(idx)) {
      this.openUpvalues.get(idx).set(value);
    } else {
      this.registers[idx] = value;
    }
  }

  getOrCreateUpvalueCell(localSlot) {
    if (!this.openUpvalues) {
      this.openUpvalues = new Map();
      this.hasUpvalues = true;
    }
    if (this.openUpvalues.has(localSlot)) {
      return this.openUpvalues.get(localSlot);
    }
    const cell = new UpvalueCell(this, localSlot);
    this.openUpvalues.set(localSlot, cell);
    return cell;
  }

  closeUpvalues() {
    if (!this.openUpvalues) return;
    for (const cell of this.openUpvalues.values()) {
      cell.close();
    }
  }
}
