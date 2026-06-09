import * as ir from "../ir/index.js";

import { tracer } from "../../core/tracing/index.js";
import { computeDominators, dominates } from "./dominators.js";
import { visitFrameStateValues } from "./frame-state-values.js";

export function hoistLoopInvariants(graph, findLoopsFn) {
  const loops = findLoopsFn(graph);
  if (loops.length === 0) return;

  for (const loop of loops) {
    const header = loop.header;
    const bodyBlocks = loop.blocks;
    const bodyBlockIds = new Set(bodyBlocks.map((b) => b.id));

    const nodeToBlock = new Map();
    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        nodeToBlock.set(node.id, block);
      }
    }

    const storeTargets = new Map();
    for (const b of bodyBlocks) {
      for (const n of b.nodes) {
        if (n.type === ir.IR_STORE_FIELD && n.inputs[0]) {
          const objId = n.inputs[0].id;
          const offset = n.props && n.props.offset;
          if (!storeTargets.has(objId)) storeTargets.set(objId, new Set());
          storeTargets.get(objId).add(offset);
        }
      }
    }

    const HOISTABLE = new Set([
      ir.IR_CHECK_MAP,
      ir.IR_CHECK_SMI,
      ir.IR_CHECK_NUMBER,
      ir.IR_LOAD_FIELD,
      ir.IR_CONSTANT,
    ]);

    const loadAliasesStore = (loadNode) => {
      const objId = loadNode.inputs[0] && loadNode.inputs[0].id;
      const offset = loadNode.props && loadNode.props.offset;
      if (objId === undefined) return true;
      const stored = storeTargets.get(objId);
      if (stored && stored.has(offset)) return true;
      if (storeTargets.size > 0) {
        for (const [storeObjId, offsets] of storeTargets) {
          if (storeObjId === objId) continue;
          if (offsets.has(offset)) return true;
        }
      }
      return false;
    };

    const isDefinedOutsideLoop = (node) => {
      if (node.type === ir.IR_PARAMETER || node.type === ir.IR_CONSTANT) return true;
      const block = nodeToBlock.get(node.id);
      if (!block) return true;
      return !bodyBlockIds.has(block.id);
    };

    const invariantNodes = [];
    const alreadyInvariant = new Set();
    const candidates = [];

    for (const block of bodyBlocks) {
      for (const node of block.nodes) {
        if (!HOISTABLE.has(node.type)) continue;
        if (node.frameState) continue;
        if (node.type === ir.IR_LOAD_FIELD && loadAliasesStore(node)) continue;
        candidates.push({ node, block });
      }
    }

    const worklist = [...candidates];
    while (worklist.length > 0) {
      const { node, block } = worklist.pop();
      if (alreadyInvariant.has(node.id)) continue;

      const allInputsOutside = node.inputs.every(
        (inp) => isDefinedOutsideLoop(inp) || alreadyInvariant.has(inp.id),
      );

      if (allInputsOutside) {
        invariantNodes.push({ node, block });
        alreadyInvariant.add(node.id);
        for (const use of node.uses) {
          if (!alreadyInvariant.has(use.id) && bodyBlockIds.has(nodeToBlock.get(use.id)?.id)) {
            const useBlock = nodeToBlock.get(use.id);
            if (useBlock && HOISTABLE.has(use.type) && !use.frameState) {
              if (use.type !== ir.IR_LOAD_FIELD || !loadAliasesStore(use)) {
                worklist.push({ node: use, block: useBlock });
              }
            }
          }
        }
      }
    }

    if (invariantNodes.length === 0) continue;

    let preHeader = null;
    for (const pred of header.predecessors) {
      if (!bodyBlockIds.has(pred.id)) {
        preHeader = pred;
        break;
      }
    }

    if (!preHeader) continue;

    const terminator = preHeader.getTerminator();
    let insertionPoint = terminator
      ? preHeader.nodes.indexOf(terminator)
      : preHeader.nodes.length;

    for (const { node, block } of invariantNodes) {
      block.nodes = block.nodes.filter((n) => n !== node);
      preHeader.nodes.splice(insertionPoint, 0, node);
      insertionPoint++;
      node.block = preHeader;
      nodeToBlock.set(node.id, preHeader);
      tracer.jitCompile(
        graph.name,
        `LICM: hoisted ${node.type} v${node.id} from B${block.id} to pre-header B${preHeader.id}`,
      );
    }
  }
}

export function findLoops(graph) {
  const loops = [];

  const dfsOrder = computeDfsOrder(graph);

  for (const block of graph.blocks) {
    if (!block.isLoopHeader) continue;

    const bodyBlocks = [];
    const visited = new Set();
    const worklist = [];

    visited.add(block.id);
    bodyBlocks.push(block);

    for (const pred of block.predecessors) {
      if (pred.id >= block.id || isBackEdgeWithOrder(pred, block, dfsOrder)) {
        if (!visited.has(pred.id)) {
          visited.add(pred.id);
          worklist.push(pred);
          bodyBlocks.push(pred);
        }
      }
    }

    while (worklist.length > 0) {
      const current = worklist.pop();
      for (const pred of current.predecessors) {
        if (!visited.has(pred.id)) {
          visited.add(pred.id);
          worklist.push(pred);
          bodyBlocks.push(pred);
        }
      }
    }

    loops.push({ header: block, blocks: bodyBlocks });
  }

  return loops;
}

function computeDfsOrder(graph) {
  const visited = new Set();
  const stack = [graph.entry];
  const dfsOrder = new Map();
  let order = 0;

  while (stack.length > 0) {
    const block = stack.pop();
    if (visited.has(block.id)) continue;
    visited.add(block.id);
    dfsOrder.set(block.id, order++);
    for (const succ of block.successors) {
      stack.push(succ);
    }
  }

  return dfsOrder;
}

function isBackEdgeWithOrder(from, to, dfsOrder) {
  const fromOrder = dfsOrder.get(from.id);
  const toOrder = dfsOrder.get(to.id);
  return (
    fromOrder !== undefined && toOrder !== undefined && fromOrder >= toOrder
  );
}

export function loopUnrolling(graph, findLoopsFn) {
  const MAX_PEEL_NODES = 80;
  const loops = findLoopsFn(graph);
  let unrollCount = 0;
  const blockById = new Map();
  for (const block of graph.blocks) blockById.set(block.id, block);

  for (const loop of loops) {
    const header = loop.header;
    const bodyBlocks = loop.blocks;
    const bodyBlockIds = new Set(bodyBlocks.map((b) => b.id));

    let totalNodes = 0;
    for (const block of bodyBlocks) {
      totalNodes += block.nodes.length;
    }

    if (totalNodes > MAX_PEEL_NODES) continue;

    const headerTerm = header.getTerminator();
    if (!headerTerm || headerTerm.type !== ir.IR_BRANCH) continue;

    const trueBlock = blockById.get(headerTerm.props.trueBlock);
    const falseBlock = blockById.get(headerTerm.props.falseBlock);
    if (!trueBlock || !falseBlock) continue;

    const exitBlock = bodyBlockIds.has(trueBlock.id) ? falseBlock : trueBlock;
    const continueBlock = bodyBlockIds.has(trueBlock.id)
      ? trueBlock
      : falseBlock;

    let preHeader = null;
    for (const pred of header.predecessors) {
      if (!bodyBlockIds.has(pred.id)) {
        preHeader = pred;
        break;
      }
    }
    if (!preHeader) continue;

    const preHeaderTerm = preHeader.getTerminator();
    let insertIdx = preHeaderTerm
      ? preHeader.nodes.indexOf(preHeaderTerm)
      : preHeader.nodes.length;
    const nodeToBlock = buildNodeToBlock(graph);
    const dominators = computeDominators(graph);
    const canUseInPreHeader = (value) =>
      valueAvailableAtBlock(value, preHeader, nodeToBlock, dominators);
    const peeledNodes = [];
    const peelableLoads = new Map();

    for (const block of bodyBlocks) {
      for (const node of block.nodes) {
        if (node.type === ir.IR_LOAD_FIELD && node.inputs.every(canUseInPreHeader)) {
          peelableLoads.set(node.id, node);
        }
      }
    }

    const canResolveInput = (value) =>
      canUseInPreHeader(value) || peelableLoads.has(value.id);

    for (const block of bodyBlocks) {
      for (const node of block.nodes) {
        if (node === headerTerm) continue;
        if (!isPeelableCheck(node)) continue;
        if (!node.frameState) continue;
        if (!node.inputs.every(canResolveInput)) continue;
        if (
          !frameStateAvailableAtBlock(
            node.frameState,
            preHeader,
            nodeToBlock,
            dominators,
          )
        )
          continue;
        for (const inp of node.inputs) {
          if (peelableLoads.has(inp.id) && !peeledNodes.some((p) => p.original === inp)) {
            peeledNodes.push({ original: inp, isLoad: true });
          }
        }
        peeledNodes.push({ original: node, isLoad: false });
      }
    }

    if (peeledNodes.length === 0) continue;

    const cloneMap = new Map();
    for (const { original, isLoad } of peeledNodes) {
      const peeled = new ir.IRNode(original.type, { ...original.props });
      for (const inp of original.inputs) {
        peeled.addInput(cloneMap.get(inp.id) || inp);
      }
      if (original.frameState) peeled.frameState = original.frameState;
      preHeader.nodes.splice(insertIdx, 0, peeled);
      insertIdx++;
      peeled.block = preHeader;
      cloneMap.set(original.id, peeled);

      tracer.jitCompile(
        graph.name,
        `LoopUnroll: peeled ${original.type} v${original.id} into pre-header B${preHeader.id}`,
      );
    }

    unrollCount++;
  }

  return unrollCount;
}

function buildNodeToBlock(graph) {
  const nodeToBlock = new Map();
  for (const block of graph.blocks) {
    for (const node of block.nodes) nodeToBlock.set(node.id, block);
  }
  return nodeToBlock;
}

function isPeelableCheck(node) {
  return (
    node.type === ir.IR_CHECK_SMI ||
    node.type === ir.IR_CHECK_MAP ||
    node.type === ir.IR_CHECK_NUMBER ||
    node.type === ir.IR_CHECK_ARRAY
  );
}

function valueAvailableAtBlock(value, block, nodeToBlock, dominators) {
  if (!value) return true;
  if (value.type === ir.IR_PARAMETER || value.type === ir.IR_CONSTANT) return true;
  const owner = nodeToBlock.get(value.id);
  if (!owner) return false;
  return dominates(dominators, owner, block);
}

function frameStateAvailableAtBlock(
  frameState,
  block,
  nodeToBlock,
  dominators,
) {
  let available = true;
  visitFrameStateValues(frameState, (value) => {
    if (!valueAvailableAtBlock(value, block, nodeToBlock, dominators))
      available = false;
  });
  return available;
}
