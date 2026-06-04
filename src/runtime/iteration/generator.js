export const GEN_NEWBORN = "newborn";
export const GEN_EXECUTING = "executing";
export const GEN_SUSPENDED = "suspended";
export const GEN_COMPLETED = "completed";

export class GeneratorObject {
  constructor(frame, interpreter) {
    this.frame = frame;
    this.interpreter = interpreter;
    this.state = GEN_NEWBORN;
  }
}

export class GeneratorSuspend {
  constructor(value) {
    this.value = value;
  }
}
