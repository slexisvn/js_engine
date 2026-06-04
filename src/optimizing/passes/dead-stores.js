import {
  IR_STORE_FIELD,
  IR_LOAD_FIELD,
  IR_GENERIC_CALL,
  IR_CALL_BUILTIN,
  IR_RETURN,
} from "../ir/index.js";
import { computeDominators, buildDominatorTree } from "./dominators.js";

function detachNode(node) {
  for (const input of node.inputs) {
    if (input?.uses) input.uses = input.uses.filter((use) => use !== node);
  }
  node.uses = [];
}

function removeDeadNodes(block, deadNodes) {
  if (deadNodes.size === 0) return;
  for (const node of deadNodes) detachNode(node);
  block.nodes = block.nodes.filter((node) => !deadNodes.has(node));
}

export function deadStoreElimination(graph) {
  let eliminatedCount = 0;

  for (const block of graph.blocks) {
    const lastStore = new Map();
    const deadStores = new Set();

    for (const node of block.nodes) {
      if (node.type === IR_STORE_FIELD && node.inputs[0]) {
        const key = node.inputs[0].id + ":" + node.props.offset;
        const prev = lastStore.get(key);
        if (prev) {
          deadStores.add(prev);
          eliminatedCount++;
        }
        lastStore.set(key, node);
        continue;
      }

      if (node.type === IR_LOAD_FIELD && node.inputs[0]) {
        const key = node.inputs[0].id + ":" + node.props.offset;
        lastStore.delete(key);
        continue;
      }

      if (
        node.type === IR_GENERIC_CALL ||
        node.type === IR_CALL_BUILTIN ||
        node.type === IR_RETURN
      ) {
        lastStore.clear();
        continue;
      }
    }

    removeDeadNodes(block, deadStores);
  }

  const dominators = computeDominators(graph);
  const { children } = buildDominatorTree(graph, dominators);

  const blockStores = new Map();
  const blockLoads = new Map();
  const blockCalls = new Map();

  for (const block of graph.blocks) {
    const stores = new Map();
    const loads = new Set();
    let hasCalls = false;

    for (const node of block.nodes) {
      if (node.type === IR_STORE_FIELD && node.inputs[0]) {
        const key = node.inputs[0].id + ":" + node.props.offset;
        stores.set(key, node);
      } else if (node.type === IR_LOAD_FIELD && node.inputs[0]) {
        const key = node.inputs[0].id + ":" + node.props.offset;
        loads.add(key);
      } else if (
        node.type === IR_GENERIC_CALL ||
        node.type === IR_CALL_BUILTIN ||
        node.type === IR_RETURN
      ) {
        hasCalls = true;
      }
    }

    blockStores.set(block.id, stores);
    blockLoads.set(block.id, loads);
    blockCalls.set(block.id, hasCalls);
  }

  const crossBlockDead = new Set();

  for (const block of graph.blocks) {
    const stores = blockStores.get(block.id);
    if (!stores || stores.size === 0) continue;

    for (const [key, storeNode] of stores) {
      const loads = blockLoads.get(block.id);
      if (loads && loads.has(key)) continue;
      if (blockCalls.get(block.id)) continue;

      if (block.successors.length === 0) continue;

      let allSuccessorsOverwrite = true;
      for (const succ of block.successors) {
        const succStores = blockStores.get(succ.id);
        const succLoads = blockLoads.get(succ.id);

        if (succLoads && succLoads.has(key)) {
          let storeBeforeLoad = false;
          for (const node of succ.nodes) {
            if (
              node.type === IR_STORE_FIELD &&
              node.inputs[0] &&
              node.inputs[0].id + ":" + node.props.offset === key
            ) {
              storeBeforeLoad = true;
              break;
            }
            if (
              node.type === IR_LOAD_FIELD &&
              node.inputs[0] &&
              node.inputs[0].id + ":" + node.props.offset === key
            ) {
              break;
            }
          }
          if (!storeBeforeLoad) {
            allSuccessorsOverwrite = false;
            break;
          }
        } else if (!succStores || !succStores.has(key)) {
          allSuccessorsOverwrite = false;
          break;
        }

        if (blockCalls.get(succ.id)) {
          let callBeforeStore = false;
          for (const node of succ.nodes) {
            if (
              node.type === IR_GENERIC_CALL ||
              node.type === IR_CALL_BUILTIN ||
              node.type === IR_RETURN
            ) {
              callBeforeStore = true;
              break;
            }
            if (
              node.type === IR_STORE_FIELD &&
              node.inputs[0] &&
              node.inputs[0].id + ":" + node.props.offset === key
            ) {
              break;
            }
          }
          if (callBeforeStore) {
            allSuccessorsOverwrite = false;
            break;
          }
        }
      }

      if (allSuccessorsOverwrite) {
        crossBlockDead.add(storeNode);
        eliminatedCount++;
      }
    }
  }

  if (crossBlockDead.size > 0) {
    for (const block of graph.blocks) {
      const blockDead = new Set();
      for (const node of block.nodes) {
        if (crossBlockDead.has(node)) blockDead.add(node);
      }
      removeDeadNodes(block, blockDead);
    }
  }

  return eliminatedCount;
}
