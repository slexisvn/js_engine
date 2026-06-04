export class DeoptSignal {
  constructor(
    reason,
    bytecodeOffset,
    stack,
    locals,
    frameStateId = -1,
    runtimeValues = new Map(),
  ) {
    this.reason = reason;
    this.bytecodeOffset = bytecodeOffset;
    this.stack = stack;
    this.locals = locals;
    this.frameStateId = frameStateId;
    this.runtimeValues = runtimeValues;
  }

  toString() {
    return `DeoptSignal(fs=${this.frameStateId}, reason="${this.reason}", bc=${this.bytecodeOffset})`;
  }
}
