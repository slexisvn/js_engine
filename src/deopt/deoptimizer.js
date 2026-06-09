import { FrameState } from "./frame-state.js";
import {
  RegisterFrame,
  MAX_DEOPT_COUNT,
  updateCallMode,
} from "../bytecode/register/interpreter/index.js";
import { DeoptSignal } from "./signal.js";
import { ObjectMaterializer } from "./materializer.js";
import {
  mkUndefined,
  mkSmi,
  mkDouble,
  mkNumber,
  mkBool,
  mkString,
  mkNull,
  mkObject,
  mkArray,
  mkFunction,
  isNumber,
  isSmi,
  isObject,
  isArray,
  isFunction,
  isBool,
  isString,
  toNumber,
  toBool,
  toDisplayString,
  typeOf,
  getPayload,
  TAG_SMI,
  TAG_DOUBLE,
} from "../core/value/index.js";
import { tracer } from "../core/tracing/index.js";
import { dependencyRegistry } from "./dependencies.js";
import * as ir from "../optimizing/ir/index.js";

export { DeoptSignal };

export const DEOPT_SMI_CHECK_FAILED = "smi-check-failed";
export const DEOPT_NUMBER_CHECK_FAILED = "number-check-failed";
export const DEOPT_MAP_CHECK_FAILED = "map-check-failed";
export const DEOPT_ARRAY_CHECK_FAILED = "array-check-failed";
export const DEOPT_ELEMENTS_KIND_CHECK_FAILED = "elements-kind-check-failed";
export const DEOPT_BOUNDS_CHECK_FAILED = "bounds-check-failed";
export const DEOPT_OVERFLOW = "integer-overflow";
export const DEOPT_DIVISION_BY_ZERO = "division-by-zero";
export const DEOPT_WRONG_CALL_TARGET = "wrong-call-target";
export const DEOPT_GUARD_FAILURE = "guard-failure";
export const DEOPT_RUNTIME_STUB_FAILURE = "runtime-stub-failure";

export class LazyDeoptMarker {
  constructor() {
    this.pendingDeopts = new Map();
  }

  markForDeopt(compiledFn, reason, dependency = null) {
    if (this.pendingDeopts.has(compiledFn)) return;
    this.pendingDeopts.set(compiledFn, {
      reason,
      dependency,
      markedAt: Date.now(),
      functionId: compiledFn.id,
      functionName: compiledFn.name || "<anonymous>",
    });
    tracer.jitDeopt(compiledFn.name, `Marked for lazy deopt: ${reason}`, -1);
  }

  hasPendingDeopt(compiledFn) {
    return this.pendingDeopts.has(compiledFn);
  }

  consumeDeopt(compiledFn) {
    const info = this.pendingDeopts.get(compiledFn);
    this.pendingDeopts.delete(compiledFn);
    return info;
  }

  invalidateDependents(reason, predicate, allFunctions) {
    let count = 0;
    if (!allFunctions) return count;
    for (const fn of allFunctions) {
      if (fn.optimizedCode && predicate(fn)) {
        this.markForDeopt(fn, reason);
        count++;
      }
    }
    if (count > 0) {
      tracer.log(
        "deopt",
        `Lazy deopt: marked ${count} functions for deopt (${reason})`,
      );
    }
    return count;
  }

  clear() {
    this.pendingDeopts.clear();
  }
}

const IC_FAILURE_REASONS = new Set([
  "map-check-failed",
  "smi-check-failed",
  "number-check-failed",
  "array-check-failed",
  "elements-kind-check-failed",
  "wrong-call-target",
]);

export class Deoptimizer {
  constructor(interpreter) {
    this.interpreter = interpreter;
    this.deoptCount = 0;
    this.globalDeoptReasons = new Map();
    this.lazyMarker = new LazyDeoptMarker();
    this.materializer = new ObjectMaterializer();
  }

  deoptimize(signal, frameStates) {
    let frameState = null;
    if (
      signal.frameStateId !== undefined &&
      signal.frameStateId >= 0 &&
      frameStates
    ) {
      frameState = frameStates[signal.frameStateId];
    }

    this.deoptCount++;
    this.lastDeoptReason = signal.reason;
    this.recordDeoptReason(signal.reason);

    if (frameState) {
      return this.deoptimizeFromFrameState(signal, frameState);
    } else {
      return this.deoptimizeFromSignalState(signal);
    }
  }

  deoptimizeFromFrameState(signal, frameState) {
    const compiledFn = frameState.compiledFunction;
    const bytecodeOffset = frameState.bytecodeOffset;

    tracer.jitDeopt(compiledFn.name, signal.reason, bytecodeOffset);

    let materializedObjects = new Map();
    if (frameState.sunkAllocations && frameState.sunkAllocations.size > 0) {
      materializedObjects = this.materializer.materialize(
        frameState.sunkAllocations,
        signal.runtimeValues,
      );
      for (const [id, val] of materializedObjects) {
        signal.runtimeValues.set(id, val);
      }
    }

    const frame = new RegisterFrame(compiledFn, [], null);

    const localsCount = frame.locals.length;
    for (let i = 0; i < localsCount; i++) {
      if (frameState.hasLocal(i)) {
        frame.locals[i] = this.materializeValue(
          frameState.getLocal(i),
          signal.runtimeValues,
        );
      } else {
        frame.locals[i] = mkUndefined();
      }
    }

    if (frameState.stackValues && frameState.stackValues.length > 0) {
      const lastValue =
        frameState.stackValues[frameState.stackValues.length - 1];
      frame.acc = this.materializeValue(lastValue, signal.runtimeValues);
    }

    if (frameState.thisValue !== null) {
      frame.thisValue = this.materializeValue(
        frameState.thisValue,
        signal.runtimeValues,
      );
    }

    frame.pc = bytecodeOffset;

    this.handleDisableOptimization(compiledFn);

    if (frameState.isInlinedFrame && frameState.callerFrameState) {
      tracer.log("deopt", "Cascaded deoptimization: unwinding inline chain");
      return this.resumeCascaded(frame, frameState);
    }

    tracer.jitResume(compiledFn.name, bytecodeOffset);
    return this.interpreter.resumeAt(frame);
  }

  deoptimizeFromSignalState(signal) {
    const fnName = "<unknown>";
    tracer.jitDeopt(fnName, signal.reason, signal.bytecodeOffset);
    throw new Error(
      `Deoptimization without FrameState not fully supported yet: ${signal.reason}`,
    );
  }

  resumeCascaded(innerFrame, innerFrameState) {
    let currentFrame = innerFrame;
    let currentFs = innerFrameState;

    let finalResult = this.interpreter.resumeAt(currentFrame);

    while (currentFs.callerFrameState) {
      const callerFs = currentFs.callerFrameState;
      const callerFn = callerFs.compiledFunction;
      const callerFrame = new RegisterFrame(callerFn, [], null);

      const localsCount = callerFrame.locals.length;
      for (let i = 0; i < localsCount; i++) {
        if (callerFs.hasLocal(i)) {
          callerFrame.locals[i] = this.materializeValue(
            callerFs.getLocal(i),
            new Map(),
          );
        } else {
          callerFrame.locals[i] = mkUndefined();
        }
      }

      if (callerFs.stackValues && callerFs.stackValues.length > 0) {
        const lastValue = callerFs.stackValues[callerFs.stackValues.length - 1];
        callerFrame.acc = this.materializeValue(lastValue, new Map());
      }

      callerFrame.acc = finalResult;

      if (callerFs.thisValue !== null) {
        callerFrame.thisValue = this.materializeValue(
          callerFs.thisValue,
          new Map(),
        );
      }

      callerFrame.pc = callerFs.bytecodeOffset;

      this.handleDisableOptimization(callerFn);

      tracer.jitResume(callerFn.name, callerFs.bytecodeOffset);
      finalResult = this.interpreter.resumeAt(callerFrame);
      currentFs = callerFs;
    }

    return finalResult;
  }

  handleDisableOptimization(compiledFn) {
    const policy = this.interpreter && this.interpreter.tieringPolicy;
    const maxDeoptCount = policy ? policy.maxDeoptCount : MAX_DEOPT_COUNT;
    compiledFn.deoptCount = (compiledFn.deoptCount || 0) + 1;
    dependencyRegistry.unregister(compiledFn);
    compiledFn.optimizedCode = null;
    updateCallMode(compiledFn);

    const reason = this.lastDeoptReason || "unknown";
    compiledFn.lastDeoptReason = reason;

    if (policy && typeof policy.recordDeopt === "function") {
      policy.recordDeopt(compiledFn, reason);
    }

    if (compiledFn.deoptCount >= maxDeoptCount) {
      compiledFn.disableOptimization = true;
      tracer.jitDeopt(
        compiledFn.name,
        `Optimization permanently disabled after ${maxDeoptCount} deoptimizations`,
        -1,
      );
    }
  }

  materializeValue(irNodeOrValue, runtimeValues) {
    if (irNodeOrValue === null || irNodeOrValue === undefined) {
      return mkUndefined();
    }

    if (
      typeof irNodeOrValue === "object" &&
      irNodeOrValue.id !== undefined &&
      irNodeOrValue.type !== undefined
    ) {
      const runtimeVal = runtimeValues.get(irNodeOrValue.id);
      if (runtimeVal !== undefined) {
        return runtimeVal;
      }

      switch (irNodeOrValue.type) {
        case ir.IR_CHECK_SMI:
        case ir.IR_CHECK_NUMBER:
        case ir.IR_CHECK_MAP:
        case ir.IR_CHECK_ARRAY:
        case ir.IR_CHECK_ELEMENTS_KIND:
        case ir.IR_CHECK_BOUNDS:
        case ir.IR_CHECK_CALL_TARGET:
        case ir.IR_BOX:
        case ir.IR_UNBOX:
        case ir.IR_BLOCK_PARAM:
        case ir.IR_LOAD_LOCAL:
          return this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
      }

      if (irNodeOrValue.type === ir.IR_TYPEOF) {
        const input = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
        return mkString(typeOf(input));
      }

      if (irNodeOrValue.type === ir.IR_STORE_LOCAL) {
        return this.materializeValue(irNodeOrValue.inputs[1], runtimeValues);
      }

      if (irNodeOrValue.type === ir.IR_PARAMETER) {
        return mkUndefined();
      }

      if (irNodeOrValue.type === ir.IR_CONSTANT && irNodeOrValue.props) {
        const constValue = irNodeOrValue.props.value;
        if (typeof constValue === "number") {
          return mkNumber(constValue);
        }
        if (typeof constValue === "string") {
          return mkString(constValue);
        }
        if (typeof constValue === "boolean") {
          return mkBool(constValue);
        }
        if (constValue === null) return mkNull();
        if (constValue === undefined) return mkUndefined();
      }

      switch (irNodeOrValue.type) {
        case ir.IR_INT32_ADD:
        case ir.IR_FLOAT64_ADD:
        case ir.IR_GENERIC_ADD: {
          const left = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
          const right = this.materializeValue(irNodeOrValue.inputs[1], runtimeValues);
          if (isString(left) || isString(right)) {
            return mkString(toDisplayString(left) + toDisplayString(right));
          }
          return mkNumber(toNumber(left) + toNumber(right));
        }
        case ir.IR_INT32_SUB:
        case ir.IR_FLOAT64_SUB:
        case ir.IR_GENERIC_SUB: {
          const left = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
          const right = this.materializeValue(irNodeOrValue.inputs[1], runtimeValues);
          return mkNumber(toNumber(left) - toNumber(right));
        }
        case ir.IR_INT32_MUL:
        case ir.IR_FLOAT64_MUL:
        case ir.IR_GENERIC_MUL: {
          const left = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
          const right = this.materializeValue(irNodeOrValue.inputs[1], runtimeValues);
          return mkNumber(toNumber(left) * toNumber(right));
        }
        case ir.IR_INT32_DIV:
        case ir.IR_FLOAT64_DIV:
        case ir.IR_GENERIC_DIV: {
          const left = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
          const right = this.materializeValue(irNodeOrValue.inputs[1], runtimeValues);
          return mkNumber(toNumber(left) / toNumber(right));
        }
        case ir.IR_INT32_MOD:
        case ir.IR_GENERIC_MOD: {
          const left = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
          const right = this.materializeValue(irNodeOrValue.inputs[1], runtimeValues);
          return mkNumber(toNumber(left) % toNumber(right));
        }
        case ir.IR_NEG: {
          const input = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
          return mkNumber(-toNumber(input));
        }
        case ir.IR_NOT: {
          const input = this.materializeValue(irNodeOrValue.inputs[0], runtimeValues);
          return mkBool(!toBool(input));
        }
      }

      return mkUndefined();
    }

    return irNodeOrValue;
  }

  recordDeoptReason(reason) {
    const count = this.globalDeoptReasons.get(reason) || 0;
    this.globalDeoptReasons.set(reason, count + 1);
  }

  getStats() {
    const reasons = {};
    for (const [r, count] of this.globalDeoptReasons) {
      reasons[r] = count;
    }
    return {
      total: this.deoptCount,
      reasons,
    };
  }
}
