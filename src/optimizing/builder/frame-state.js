import { FrameState } from "../../deopt/frame-state.js";

export function captureFrameState(
  compiledFn,
  bytecodeOffset,
  regs,
  stack,
  frameStates,
) {
  return captureFrameStateWithCaller(
    compiledFn,
    bytecodeOffset,
    regs,
    stack,
    frameStates,
    null,
  );
}

export function captureFrameStateWithCaller(
  compiledFn,
  bytecodeOffset,
  regs,
  stack,
  frameStates,
  callerFrameState,
) {
  const fs = new FrameState(compiledFn, bytecodeOffset);

  if (regs instanceof Map) {
    for (const [slot, node] of regs) {
      fs.setLocal(slot, node);
    }
  }

  if (stack) {
    for (const node of stack) {
      fs.pushStack(node);
    }
  }

  if (callerFrameState) {
    fs.setCallerFrame(callerFrameState);
  }

  const id = frameStates.length;
  fs.id = id;
  frameStates.push(fs);

  return fs;
}
