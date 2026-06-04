import { irConstant } from "../ir/index.js";

const ACC_SLOT = -1;

export function rememberIncomingState(states, target, predecessor, regs, acc) {
  if (!states.has(target)) states.set(target, []);
  states.get(target).push({ predecessor, regs: new Map(regs), acc });
}

function definedValue(value) {
  return value || irConstant(undefined);
}

export function restoreIncomingState(block, states, regs, acc) {
  if (!states || states.length === 0) return acc;
  if (states.length === 1 || block.predecessors.length <= 1) {
    const state = states[0];
    for (const [slot, value] of state.regs) regs.set(slot, value);
    return state.acc ?? acc;
  }

  const byPred = new Map(states.map((state) => [state.predecessor, state]));
  const slots = new Set();
  for (const state of states) {
    for (const slot of state.regs.keys()) slots.add(slot);
    if (state.acc) slots.add(ACC_SLOT);
  }

  const edgeArgs = new Map(block.predecessors.map((pred) => [pred, []]));
  let nextAcc = acc;

  for (const slot of slots) {
    const values = block.predecessors.map((pred) => {
      const state = byPred.get(pred);
      if (!state) return slot === ACC_SLOT ? acc : regs.get(slot);
      return slot === ACC_SLOT ? state.acc : state.regs.get(slot);
    });
    const incoming = values.map(definedValue);
    const first = incoming[0];
    const same = incoming.every((value) => value === first);
    const selected = same ? first : block.addParam(incoming);
    if (!same) {
      for (let i = 0; i < block.predecessors.length; i++) {
        edgeArgs.get(block.predecessors[i]).push(incoming[i]);
      }
    }
    if (slot === ACC_SLOT) {
      nextAcc = selected;
    } else {
      regs.set(slot, selected);
    }
  }

  for (const pred of block.predecessors) {
    if (pred.successors.includes(block))
      pred.setEdgeArgs(block, edgeArgs.get(pred));
  }

  return nextAcc;
}
