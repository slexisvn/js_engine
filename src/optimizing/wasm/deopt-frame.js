import * as ir from "../ir/index.js";
import { RegisterFrame } from "../../bytecode/register/interpreter/index.js";
import {
  isObject,
  isString,
  mkNumber,
  mkBool,
  mkString,
  mkNull,
  mkUndefined,
  toNumber,
  toBool,
  toDisplayString,
  getPayload,
} from "../../core/value/index.js";
import {
  DEOPT_ARRAY_CHECK_FAILED,
  DEOPT_BOUNDS_CHECK_FAILED,
  DEOPT_DIVISION_BY_ZERO,
  DEOPT_ELEMENTS_KIND_CHECK_FAILED,
  DEOPT_GUARD_FAILURE,
  DEOPT_MAP_CHECK_FAILED,
  DEOPT_NUMBER_CHECK_FAILED,
  DEOPT_OVERFLOW,
  DEOPT_RUNTIME_STUB_FAILURE,
  DEOPT_SMI_CHECK_FAILED,
  DEOPT_WRONG_CALL_TARGET,
} from "../../deopt/deoptimizer.js";
import { compareValues } from "./runtime-support.js";

const DEOPT_REASON_LIST = [
  DEOPT_GUARD_FAILURE,
  DEOPT_SMI_CHECK_FAILED,
  DEOPT_NUMBER_CHECK_FAILED,
  DEOPT_MAP_CHECK_FAILED,
  DEOPT_ARRAY_CHECK_FAILED,
  DEOPT_ELEMENTS_KIND_CHECK_FAILED,
  DEOPT_BOUNDS_CHECK_FAILED,
  DEOPT_OVERFLOW,
  DEOPT_DIVISION_BY_ZERO,
  DEOPT_WRONG_CALL_TARGET,
  DEOPT_RUNTIME_STUB_FAILURE,
];

const DEOPT_REASON_IDS = new Map(
  DEOPT_REASON_LIST.map((reason, id) => [reason, id]),
);

export function deoptReasonId(reason) {
  return (
    DEOPT_REASON_IDS.get(reason) ?? DEOPT_REASON_IDS.get(DEOPT_GUARD_FAILURE)
  );
}

export function deoptReasonFromId(id) {
  return DEOPT_REASON_LIST[id] || DEOPT_GUARD_FAILURE;
}

export function deoptReasonForNode(node) {
  if (!node) return DEOPT_GUARD_FAILURE;
  if (node.type === ir.IR_CHECK_SMI) return DEOPT_SMI_CHECK_FAILED;
  if (node.type === ir.IR_CHECK_NUMBER) return DEOPT_NUMBER_CHECK_FAILED;
  if (node.type === ir.IR_CHECK_MAP) return DEOPT_MAP_CHECK_FAILED;
  if (node.type === ir.IR_CHECK_ARRAY) return DEOPT_ARRAY_CHECK_FAILED;
  if (node.type === ir.IR_CHECK_ELEMENTS_KIND)
    return DEOPT_ELEMENTS_KIND_CHECK_FAILED;
  if (node.type === ir.IR_CHECK_BOUNDS) return DEOPT_BOUNDS_CHECK_FAILED;
  if (node.type === ir.IR_CHECK_CALL_TARGET) return DEOPT_WRONG_CALL_TARGET;
  if (node.type === ir.IR_DEOPTIMIZE)
    return node.props.reason || DEOPT_GUARD_FAILURE;
  return DEOPT_GUARD_FAILURE;
}

export function materializeFrameValue(value, runtimeValues, args, interpreter) {
  if (value === null || value === undefined) return mkUndefined();
  if (
    typeof value === "object" &&
    value.id !== undefined &&
    value.type !== undefined
  ) {
    if (value.type === ir.IR_LOAD_FIELD) {
      const obj = materializeFrameValue(
        value.inputs[0],
        runtimeValues,
        args,
        interpreter,
      );
      if (isObject(obj)) {
        const fieldValue = getPayload(obj).getPropertyByOffset(
          value.props.offset,
        );
        return fieldValue !== undefined ? fieldValue : mkUndefined();
      }
      return mkUndefined();
    }
    if (value.type === ir.IR_POLYMORPHIC_LOAD) {
      const obj = materializeFrameValue(
        value.inputs[0],
        runtimeValues,
        args,
        interpreter,
      );
      if (isObject(obj)) {
        const payload = getPayload(obj);
        const mapIndex = value.props.maps.indexOf(payload.hiddenClass.id);
        if (mapIndex >= 0) {
          const fieldValue = payload.getPropertyByOffset(
            value.props.offsets[mapIndex],
          );
          return fieldValue !== undefined ? fieldValue : mkUndefined();
        }
      }
      return mkUndefined();
    }
    if (value.type === ir.IR_GENERIC_GET_PROP) {
      const obj = materializeFrameValue(
        value.inputs[0],
        runtimeValues,
        args,
        interpreter,
      );
      if (isObject(obj)) {
        const propValue = getPayload(obj).getProperty(value.props.propName);
        return propValue !== undefined ? propValue : mkUndefined();
      }
      return mkUndefined();
    }
    switch (value.type) {
      case ir.IR_CHECK_SMI:
      case ir.IR_CHECK_NUMBER:
      case ir.IR_CHECK_MAP:
      case ir.IR_CHECK_ARRAY:
      case ir.IR_CHECK_ELEMENTS_KIND:
      case ir.IR_CHECK_BOUNDS:
      case ir.IR_CHECK_CALL_TARGET:
      case ir.IR_BOX:
      case ir.IR_UNBOX:
        return materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
    }
    if (value.type === ir.IR_PARAMETER) {
      const index = value.props ? value.props.index : -1;
      return index >= 0 && index < args.length ? args[index] : mkUndefined();
    }
    if (value.type === ir.IR_LOAD_GLOBAL && value.props && interpreter) {
      const globalValue = interpreter.globalCells.read(value.props.name);
      return globalValue !== undefined ? globalValue : mkUndefined();
    }
    if (value.type === ir.IR_CONSTANT && value.props) {
      const constant = value.props.value;
      if (typeof constant === "number") return mkNumber(constant);
      if (typeof constant === "string") return mkString(constant);
      if (typeof constant === "boolean") return mkBool(constant);
      if (constant === null) return mkNull();
      if (constant === undefined) return mkUndefined();
    }
    const runtimeValue = runtimeValues
      ? runtimeValues.get(value.id)
      : undefined;
    if (runtimeValue !== undefined) return runtimeValue;
    switch (value.type) {
      case ir.IR_INT32_ADD:
      case ir.IR_FLOAT64_ADD:
      case ir.IR_GENERIC_ADD: {
        const left = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        const right = materializeFrameValue(
          value.inputs[1],
          runtimeValues,
          args,
          interpreter,
        );
        if (isString(left) || isString(right)) {
          return mkString(toDisplayString(left) + toDisplayString(right));
        }
        return mkNumber(toNumber(left) + toNumber(right));
      }
      case ir.IR_INT32_SUB:
      case ir.IR_FLOAT64_SUB:
      case ir.IR_GENERIC_SUB: {
        const left = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        const right = materializeFrameValue(
          value.inputs[1],
          runtimeValues,
          args,
          interpreter,
        );
        return mkNumber(toNumber(left) - toNumber(right));
      }
      case ir.IR_INT32_MUL:
      case ir.IR_FLOAT64_MUL:
      case ir.IR_GENERIC_MUL: {
        const left = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        const right = materializeFrameValue(
          value.inputs[1],
          runtimeValues,
          args,
          interpreter,
        );
        return mkNumber(toNumber(left) * toNumber(right));
      }
      case ir.IR_INT32_DIV:
      case ir.IR_FLOAT64_DIV:
      case ir.IR_GENERIC_DIV: {
        const left = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        const right = materializeFrameValue(
          value.inputs[1],
          runtimeValues,
          args,
          interpreter,
        );
        return mkNumber(toNumber(left) / toNumber(right));
      }
      case ir.IR_INT32_MOD:
      case ir.IR_GENERIC_MOD: {
        const left = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        const right = materializeFrameValue(
          value.inputs[1],
          runtimeValues,
          args,
          interpreter,
        );
        return mkNumber(toNumber(left) % toNumber(right));
      }
      case ir.IR_INT32_COMPARE:
      case ir.IR_FLOAT64_COMPARE:
      case ir.IR_GENERIC_COMPARE: {
        const left = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        const right = materializeFrameValue(
          value.inputs[1],
          runtimeValues,
          args,
          interpreter,
        );
        return mkBool(compareValues(value.props.op, left, right));
      }
      case ir.IR_NEG: {
        const input = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        return mkNumber(-toNumber(input));
      }
      case ir.IR_NOT: {
        const input = materializeFrameValue(
          value.inputs[0],
          runtimeValues,
          args,
          interpreter,
        );
        return mkBool(!toBool(input));
      }
    }
    return mkUndefined();
  }
  return value;
}

export function materializeFrameFromState(
  compiledFn,
  args,
  thisValue,
  frameState,
  runtimeValues,
  interpreter,
) {
  const frame = new RegisterFrame(compiledFn, args, thisValue || mkUndefined());
  if (!frameState) return frame;
  const localsCount = frame.locals.length;
  for (let i = 0; i < localsCount; i++) {
    if (frameState.hasLocal(i)) {
      frame.locals[i] = materializeFrameValue(
        frameState.getLocal(i),
        runtimeValues,
        args,
        interpreter,
      );
    }
  }
  if (frameState.stackValues && frameState.stackValues.length > 0) {
    frame.acc = materializeFrameValue(
      frameState.stackValues[frameState.stackValues.length - 1],
      runtimeValues,
      args,
      interpreter,
    );
  }
  if (frameState.thisValue !== null) {
    frame.thisValue = materializeFrameValue(
      frameState.thisValue,
      runtimeValues,
      args,
      interpreter,
    );
  }
  frame.pc = frameState.bytecodeOffset;
  return frame;
}

export function resumeFrameStateChain(
  args,
  thisValue,
  frameState,
  runtimeValues,
  interpreter,
) {
  let currentFrameState = frameState;
  let currentFrame = materializeFrameFromState(
    currentFrameState.compiledFunction,
    args,
    thisValue,
    currentFrameState,
    runtimeValues,
    interpreter,
  );
  let finalResult = interpreter.resumeAt(currentFrame);

  while (currentFrameState.callerFrameState) {
    currentFrameState = currentFrameState.callerFrameState;
    const callerFrame = materializeFrameFromState(
      currentFrameState.compiledFunction,
      args,
      thisValue,
      currentFrameState,
      runtimeValues,
      interpreter,
    );
    callerFrame.acc = finalResult;
    finalResult = interpreter.resumeAt(callerFrame);
  }

  return finalResult;
}
