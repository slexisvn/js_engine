import { EFFECT_NONE, EFFECT_READ } from "../ir/index.js";
import { markFrameStateValues } from "./frame-state-values.js";

export function deadCodeElimination(graph) {
  let dceCount = 0;

  const liveNodes = new Set();
  const worklist = [];

  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (isRequiredEffect(node)) {
        liveNodes.add(node.id);
        worklist.push(node);
      }
    }
  }

  while (worklist.length > 0) {
    const node = worklist.pop();
    for (const input of node.inputs) {
      if (input && !liveNodes.has(input.id)) {
        liveNodes.add(input.id);
        worklist.push(input);
      }
    }
    if (node.frameState) {
      markFrameStateValues(node.frameState, liveNodes, worklist);
    }
  }

  for (const param of graph.parameters) {
    liveNodes.add(param.id);
  }
  for (const block of graph.blocks) {
    for (const param of block.params || []) {
      liveNodes.add(param.id);
    }
  }

  for (const block of graph.blocks) {
    block.nodes = block.nodes.filter((node) => {
      if (liveNodes.has(node.id)) return true;
      node.inputs.forEach((inp) => {
        if (inp) inp.uses = inp.uses.filter((u) => u !== node);
      });
      dceCount++;
      return false;
    });
    const liveNodeSet = new Set(block.nodes);
    block.params = (block.params || []).filter((param) =>
      liveNodeSet.has(param),
    );
  }

  graph.rebuildUses?.();
  return dceCount;
}

function isRequiredEffect(node) {
  return node.effectKind !== EFFECT_NONE && node.effectKind !== EFFECT_READ;
}

export function eliminateUnreachableBlocks(graph) {
  if (!graph.entry) return 0;

  const reachable = new Set();
  const worklist = [graph.entry];
  reachable.add(graph.entry.id);

  while (worklist.length > 0) {
    const block = worklist.pop();
    for (const succ of block.successors) {
      if (!reachable.has(succ.id)) {
        reachable.add(succ.id);
        worklist.push(succ);
      }
    }
  }

  const origLen = graph.blocks.length;
  if (reachable.size === origLen) return 0;

  const deadBlocks = graph.blocks.filter((b) => !reachable.has(b.id));
  for (const dead of deadBlocks) {
    for (const node of dead.nodes) {
      node.inputs.forEach((inp) => {
        if (inp) inp.uses = inp.uses.filter((u) => u !== node);
      });
    }
    for (const succ of dead.successors) {
      succ.predecessors = succ.predecessors.filter((p) => p !== dead);
    }
  }

  graph.blocks = graph.blocks.filter((b) => reachable.has(b.id));
  graph.rebuildUses?.();
  return origLen - graph.blocks.length;
}
