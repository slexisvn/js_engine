import {
  IR_LOAD_FIELD,
  IR_STORE_FIELD,
  IR_GENERIC_CALL,
  IR_CALL_BUILTIN,
  IR_CALL_KNOWN_FUNCTION,
  IR_GENERIC_SET_PROP,
  IR_GENERIC_SET_INDEX,
  IR_NEW_OBJECT,
  IR_NEW_ARRAY,
} from "../ir/index.js";
import { computeDominators, buildDominatorTree } from "./dominators.js";
import { replaceGraphFrameStateValue } from "./frame-state-values.js";

const CALL_LIKE = new Set([
  IR_GENERIC_CALL,
  IR_CALL_BUILTIN,
  IR_CALL_KNOWN_FUNCTION,
]);

const ARBITRARY_WRITE = new Set([IR_GENERIC_SET_PROP, IR_GENERIC_SET_INDEX]);

function cloneState(state) {
  const copy = new Map();
  for (const [objId, offsets] of state) {
    copy.set(objId, new Map(offsets));
  }
  return copy;
}

function stateGet(state, objId, offset) {
  const offsets = state.get(objId);
  return offsets ? offsets.get(offset) : undefined;
}

function stateSet(state, objId, offset, val) {
  let offsets = state.get(objId);
  if (!offsets) {
    offsets = new Map();
    state.set(objId, offsets);
  }
  offsets.set(offset, val);
}

function stateDeleteObj(state, objId) {
  state.delete(objId);
}

function detachNode(node) {
  for (const input of node.inputs) {
    if (input?.uses) input.uses = input.uses.filter((use) => use !== node);
  }
  node.uses = [];
}

export function loadElimination(graph) {
  const dominators = computeDominators(graph);
  const { children } = buildDominatorTree(graph, dominators);
  let eliminatedCount = 0;

  const freshAllocations = new Set();
  const escapedAllocations = new Set();
  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (node.type === IR_NEW_OBJECT || node.type === IR_NEW_ARRAY) {
        freshAllocations.add(node.id);
      }
    }
  }
  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (CALL_LIKE.has(node.type)) {
        for (const input of node.inputs) {
          if (input && freshAllocations.has(input.id)) {
            escapedAllocations.add(input.id);
          }
        }
      }
      if (ARBITRARY_WRITE.has(node.type)) {
        for (let i = 1; i < node.inputs.length; i++) {
          const input = node.inputs[i];
          if (input && freshAllocations.has(input.id)) {
            escapedAllocations.add(input.id);
          }
        }
      }
    }
  }

  const definiteNoAlias = (id1, id2) => {
    if (id1 !== id2 && freshAllocations.has(id1) && freshAllocations.has(id2)) {
      return true;
    }
    return false;
  };

  const walkDomTree = (block, parentState) => {
    const state = cloneState(parentState);
    const nodesToRemove = [];

    for (const node of block.nodes) {
      if (node.type === IR_STORE_FIELD) {
        const obj = node.inputs[0];
        const val = node.inputs[1];
        const offset = node.props.offset;
        if (obj && val && offset !== undefined) {
          const objOffsets = state.get(obj.id);
          if (objOffsets) {
            objOffsets.delete(offset);
            if (objOffsets.size === 0) state.delete(obj.id);
          }
          for (const [oid, offsets] of [...state]) {
            if (oid === obj.id) continue;
            if (definiteNoAlias(oid, obj.id)) continue;
            if (freshAllocations.has(oid) || freshAllocations.has(obj.id))
              continue;
            if (offsets.has(offset)) {
              offsets.delete(offset);
              if (offsets.size === 0) state.delete(oid);
            }
          }
          stateSet(state, obj.id, offset, val);
        }
        continue;
      }

      if (node.type === IR_LOAD_FIELD) {
        const obj = node.inputs[0];
        const offset = node.props.offset;
        if (obj && offset !== undefined) {
          const available = stateGet(state, obj.id, offset);
          if (available) {
            for (const use of [...node.uses]) {
              for (let i = 0; i < use.inputs.length; i++) {
                if (use.inputs[i] === node) {
                  use.replaceInput(i, available);
                }
              }
            }
            replaceGraphFrameStateValue(graph, node, available);
            detachNode(node);
            nodesToRemove.push(node);
            eliminatedCount++;
          } else {
            stateSet(state, obj.id, offset, node);
          }
        }
        continue;
      }

      if (CALL_LIKE.has(node.type)) {
        for (const [oid] of state) {
          if (freshAllocations.has(oid) && !escapedAllocations.has(oid)) {
            continue;
          }
          stateDeleteObj(state, oid);
        }
        continue;
      }

      if (ARBITRARY_WRITE.has(node.type)) {
        const obj = node.inputs[0];
        if (obj) {
          for (const [oid] of state) {
            if (!definiteNoAlias(oid, obj.id)) {
              stateDeleteObj(state, oid);
            }
          }
        } else {
          state.clear();
        }
        continue;
      }
    }

    if (nodesToRemove.length > 0) {
      const deadSet = new Set(nodesToRemove);
      block.nodes = block.nodes.filter((n) => !deadSet.has(n));
    }

    const childBlocks = children.get(block) || [];
    for (const child of childBlocks) {
      walkDomTree(child, state);
    }
  };

  const entry = graph.blocks[0];
  if (entry) {
    walkDomTree(entry, new Map());
  }

  return eliminatedCount;
}
