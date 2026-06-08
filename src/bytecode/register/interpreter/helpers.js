import * as bytecode from "../ops/bytecode.js";

import {
  mkString,
  mkObject,
  getPayload,
  getTag,
} from "../../../core/value/index.js";

import { createJSObject } from "../../../objects/heap/factory.js";
import { PROMISE_FULFILLED } from "../../../runtime/async/promise.js";
import { DEFAULT_TIERING_POLICY } from "../../../runtime/tiering/policy.js";
import { VMError, vmErrorToTagged } from "../../../core/errors/index.js";

export const MAX_DEOPT_COUNT = DEFAULT_TIERING_POLICY.maxDeoptCount;

export const INTERPRETER_ONLY_OPS = new Set([
  bytecode.ROP_AWAIT,
  bytecode.ROP_GET_ITERATOR,
  bytecode.ROP_ITER_NEXT,
  bytecode.ROP_ITER_DONE,
  bytecode.ROP_ITER_VALUE,
  bytecode.ROP_YIELD,
]);

export function requiresInterpreterOnly(compiledFn) {
  return (
    compiledFn.isAsync ||
    compiledFn.instructions.some((instr) =>
      INTERPRETER_ONLY_OPS.has(instr.opcode),
    )
  );
}

export function getBinaryOperands(frame, operands, compiledFn) {
  const left = frame.acc;
  const right = frame.getReg(operands[0]);
  const fv = compiledFn.feedbackVector;
  if (fv && !fv.saturated) {
    const slot = fv.getSlot(operands[1]);
    if (slot && !slot.isStable) slot.recordBinaryOp(getTag(left), getTag(right));
  }
  return { left, right };
}

export class RegisterMiniJITException {
  constructor(value) {
    this.value = value;
  }
}

export class AsyncSuspend {
  constructor(frame, pendingPromise) {
    this.frame = frame;
    this.pendingPromise = pendingPromise;
  }
}

export function runAsyncWithSuspension(interpreter, asyncFrame, capability) {
  try {
    const result = interpreter.runFrame(asyncFrame);
    capability.resolve(result);
  } catch (e) {
    if (e instanceof AsyncSuspend) {
      const pendingPromise = getPayload(e.pendingPromise);
      const suspendedFrame = e.frame;
      pendingPromise.addReaction((state, result) => {
        if (state === PROMISE_FULFILLED) {
          suspendedFrame.acc = result;
          runAsyncWithSuspension(interpreter, suspendedFrame, capability);
        } else {
          if (suspendedFrame.exceptionHandlers.length > 0) {
            const handler = suspendedFrame.exceptionHandlers.pop();
            suspendedFrame.acc = result;
            suspendedFrame.pc = handler.catchPC;
            runAsyncWithSuspension(interpreter, suspendedFrame, capability);
          } else {
            capability.reject(result);
          }
        }
      });
      if (interpreter.microtaskQueue) {
        interpreter.microtaskQueue.drain();
      }
    } else {
      const errVal = errorToTaggedValue(e);
      capability.reject(errVal);
    }
  }
}

export function errorToTaggedValue(e) {
  if (e instanceof RegisterMiniJITException) return e.value;
  if (e instanceof VMError)
    return vmErrorToTagged(e, mkString, mkObject, createJSObject);
  return mkString(String(e.message || e));
}
