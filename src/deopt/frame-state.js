import { getTag, toDisplayString } from "../core/value/index.js";

export class FrameState {
  constructor(compiledFunction, bytecodeOffset) {
    this.compiledFunction = compiledFunction;
    this.bytecodeOffset = bytecodeOffset;
    this.localValues = new Map();
    this.stackValues = [];
    this.thisValue = null;
    this.id = -1;
    this.callerFrameState = null;
    this.isInlinedFrame = false;
    this.safepoint = false;
    this.sunkAllocations = null;
  }

  setLocal(slot, value) {
    this.localValues.set(slot, value);
  }

  getLocal(slot) {
    return this.localValues.get(slot);
  }

  hasLocal(slot) {
    return this.localValues.has(slot);
  }

  pushStack(value) {
    this.stackValues.push(value);
  }

  popStack() {
    return this.stackValues.pop();
  }

  peekStack() {
    return this.stackValues[this.stackValues.length - 1];
  }

  setThis(value) {
    this.thisValue = value;
  }

  setCallerFrame(callerFS) {
    this.callerFrameState = callerFS;
    this.isInlinedFrame = true;
  }

  markAsSafepoint() {
    this.safepoint = true;
  }

  setSunkAllocations(sunkAllocs) {
    this.sunkAllocations = sunkAllocs;
  }

  clone() {
    const fs = new FrameState(this.compiledFunction, this.bytecodeOffset);
    for (const [k, v] of this.localValues) {
      fs.localValues.set(k, v);
    }
    fs.stackValues = [...this.stackValues];
    fs.thisValue = this.thisValue;
    fs.id = this.id;
    fs.callerFrameState = this.callerFrameState;
    fs.isInlinedFrame = this.isInlinedFrame;
    fs.safepoint = this.safepoint;
    fs.sunkAllocations = this.sunkAllocations
      ? new Map(this.sunkAllocations)
      : null;
    return fs;
  }

  setBytecodeOffset(offset) {
    this.bytecodeOffset = offset;
  }

  get localCount() {
    return this.localValues.size;
  }

  get stackDepth() {
    return this.stackValues.length;
  }

  get functionName() {
    return this.compiledFunction?.name || "<anonymous>";
  }

  getLocalsArray() {
    const result = [];
    const maxSlot = Math.max(...this.localValues.keys(), -1);
    for (let i = 0; i <= maxSlot; i++) {
      result.push(this.localValues.get(i) || null);
    }
    return result;
  }

  getInlineChain() {
    const chain = [this];
    let current = this.callerFrameState;
    while (current) {
      chain.push(current);
      current = current.callerFrameState;
    }
    return chain;
  }

  getInlineDepth() {
    let depth = 0;
    let current = this.callerFrameState;
    while (current) {
      depth++;
      current = current.callerFrameState;
    }
    return depth;
  }

  matches(other) {
    if (this.compiledFunction !== other.compiledFunction) return false;
    if (this.bytecodeOffset !== other.bytecodeOffset) return false;
    if (this.localValues.size !== other.localValues.size) return false;
    for (const [key, val] of this.localValues) {
      if (!other.localValues.has(key)) return false;
      const otherVal = other.localValues.get(key);
      if (val !== otherVal) return false;
    }
    if (this.stackValues.length !== other.stackValues.length) return false;
    for (let i = 0; i < this.stackValues.length; i++) {
      if (this.stackValues[i] !== other.stackValues[i]) return false;
    }
    return true;
  }

  toCompact() {
    const fnName = this.functionName;
    const localCount = this.localValues.size;
    const stackDepth = this.stackValues.length;
    const inline = this.isInlinedFrame ? " [inlined]" : "";
    const sp = this.safepoint ? " [safepoint]" : "";
    return `fs#${this.id} ${fnName}@bc:${this.bytecodeOffset} L=${localCount} S=${stackDepth}${inline}${sp}`;
  }

  toString() {
    const fnName = this.functionName;
    const locals = [];
    const sortedKeys = [...this.localValues.keys()].sort((a, b) => a - b);
    for (const slot of sortedKeys) {
      const val = this.localValues.get(slot);
      const valStr = formatIRValue(val);
      const name = this.compiledFunction?.localNames?.[slot] || `L${slot}`;
      locals.push(`${name}=${valStr}`);
    }
    const stackStr = this.stackValues.map((v) => formatIRValue(v)).join(", ");
    const callerStr = this.callerFrameState
      ? ` caller=fs#${this.callerFrameState.id}`
      : "";
    const spStr = this.safepoint ? " [safepoint]" : "";

    return (
      `FrameState#${this.id}(fn=${fnName}, pc=${this.bytecodeOffset}, ` +
      `locals=[${locals.join(", ")}], stack=[${stackStr}]${callerStr}${spStr})`
    );
  }
}

function formatIRValue(val) {
  if (val === null || val === undefined) return "null";
  if (
    typeof val === "object" &&
    val.id !== undefined &&
    val.type !== undefined
  ) {
    return `v${val.id}`;
  }
  if (typeof val === "number") {
    const tag = getTag(val);
    if (tag === "string") return `"${toDisplayString(val)}"`;
    if (tag === "null") return "null";
    if (tag === "undefined") return "undefined";
    if (tag === "smi" || tag === "double" || tag === "bool")
      return toDisplayString(val);
    return `<${tag}>`;
  }
  return String(val);
}

export class FrameStateBuilder {
  constructor() {
    this.states = [];
  }

  capture(
    compiledFunction,
    bytecodeOffset,
    locals,
    stack,
    thisValue,
    callerFS,
  ) {
    const fs = new FrameState(compiledFunction, bytecodeOffset);

    if (locals instanceof Map) {
      for (const [slot, node] of locals) {
        fs.setLocal(slot, node);
      }
    } else if (Array.isArray(locals)) {
      for (let i = 0; i < locals.length; i++) {
        if (locals[i] !== undefined && locals[i] !== null) {
          fs.setLocal(i, locals[i]);
        }
      }
    }

    if (Array.isArray(stack)) {
      for (const node of stack) {
        fs.pushStack(node);
      }
    }

    if (thisValue !== undefined && thisValue !== null) {
      fs.setThis(thisValue);
    }

    if (callerFS) {
      fs.setCallerFrame(callerFS);
    }

    fs.id = this.states.length;
    this.states.push(fs);
    return fs;
  }

  getState(id) {
    return this.states[id] || null;
  }

  get count() {
    return this.states.length;
  }

  dump() {
    const lines = [`FrameStates (${this.states.length}):`];
    for (const fs of this.states) {
      lines.push(`  ${fs.toCompact()}`);
    }
    return lines.join("\n");
  }
}
