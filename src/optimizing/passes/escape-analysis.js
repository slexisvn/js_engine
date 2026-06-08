import {
  irConstant,
  IR_NEW_OBJECT,
  IR_NEW_ARRAY,
  IR_GENERIC_SET_PROP,
  IR_GENERIC_GET_PROP,
  IR_GENERIC_SET_INDEX,
  IR_GENERIC_GET_INDEX,
  IR_STORE_ELEMENT,
  IR_LOAD_ELEMENT,
  IR_CHECK_MAP,
  IR_CHECK_ARRAY,
  IR_STORE_FIELD,
  IR_LOAD_FIELD,
  IR_PHI,
} from "../ir/index.js";

import { tracer } from "../../core/tracing/index.js";
import {
  computeDominators,
  buildDominatorTree,
  dominates,
} from "./dominators.js";
import { replaceGraphFrameStateValue } from "./frame-state-values.js";

export function escapeAnalysisAndScalarReplacement(graph) {
  let scalarReplCount = 0;
  const dom = computeDominators(graph);
  const { children } = buildDominatorTree(graph, dom);

  const blockOf = new Map();
  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      blockOf.set(node, block);
    }
  }

  const allocations = [];
  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (node.type === IR_NEW_OBJECT || node.type === IR_NEW_ARRAY) {
        allocations.push(node);
      }
    }
  }

  for (const alloc of allocations) {
    const allocBlock = blockOf.get(alloc);
    if (!allocBlock) continue;

    let escapes = false;
    const safeUses = new Set();
    const aliases = new Set([alloc]);
    const worklist = [alloc];

    while (worklist.length > 0 && !escapes) {
      const ref = worklist.pop();
      for (const use of [...ref.uses]) {
        if (safeUses.has(use)) continue;
        if (
          isPropertyUse(use, aliases) ||
          isElementUse(use, aliases) ||
          isFieldUse(use, aliases)
        ) {
          safeUses.add(use);
        } else if (
          isReferenceGuard(use, aliases) ||
          isSameReferencePhi(use, aliases)
        ) {
          safeUses.add(use);
          aliases.add(use);
          worklist.push(use);
        } else {
          escapes = true;
          break;
        }
      }
    }

    if (escapes) continue;

    let allDominated = true;
    for (const use of safeUses) {
      const useBlock = blockOf.get(use);
      if (!useBlock) {
        allDominated = false;
        break;
      }
      if (!dominates(dom, allocBlock, useBlock)) {
        allDominated = false;
        break;
      }
    }

    if (!allDominated) continue;

    const toDelete = new Set([...aliases].map((node) => node.id));

    const processBlock = (block, propState, offsetState) => {
      for (let i = 0; i < block.nodes.length; i++) {
        const node = block.nodes[i];
        if (node === alloc) continue;
        if (!safeUses.has(node)) continue;

        if (
          node.type === IR_CHECK_MAP ||
          node.type === IR_CHECK_ARRAY ||
          node.type === IR_PHI
        ) {
          toDelete.add(node.id);
        } else if (
          node.type === IR_STORE_FIELD &&
          toDelete.has(node.inputs[0]?.id)
        ) {
          const offset = node.props.offset;
          const value = node.inputs[1];
          offsetState.set(offset, value);
          toDelete.add(node.id);
        } else if (
          node.type === IR_LOAD_FIELD &&
          toDelete.has(node.inputs[0]?.id)
        ) {
          const offset = node.props.offset;
          let val = offsetState.get(offset);
          if (!val) {
            val = insertUndefinedConstant(block, i);
            blockOf.set(val, block);
            i++;
          }
          replaceValue(graph, node, val);
          replaceGraphFrameStateValue(graph, node, val);
          toDelete.add(node.id);
        } else if (
          node.type === IR_GENERIC_SET_PROP &&
          toDelete.has(node.inputs[0]?.id)
        ) {
          const propName = node.props.propName;
          const value = node.inputs[1];
          propState.set(propName, value);
          toDelete.add(node.id);
        } else if (
          node.type === IR_GENERIC_GET_PROP &&
          toDelete.has(node.inputs[0]?.id)
        ) {
          const propName = node.props.propName;
          let val = propState.get(propName);
          if (!val) {
            val = insertUndefinedConstant(block, i);
            blockOf.set(val, block);
            i++;
          }
          replaceValue(graph, node, val);
          replaceGraphFrameStateValue(graph, node, val);
          toDelete.add(node.id);
        } else if (
          (node.type === IR_STORE_ELEMENT ||
            node.type === IR_GENERIC_SET_INDEX) &&
          toDelete.has(node.inputs[0]?.id)
        ) {
          const idx =
            node.props.index !== undefined
              ? node.props.index
              : node.inputs[1]
                ? node.inputs[1].id
                : 0;
          const value =
            node.type === IR_STORE_ELEMENT ? node.inputs[2] : node.inputs[2];
          if (value) {
            offsetState.set("elem_" + idx, value);
            toDelete.add(node.id);
          }
        } else if (
          (node.type === IR_LOAD_ELEMENT ||
            node.type === IR_GENERIC_GET_INDEX) &&
          toDelete.has(node.inputs[0]?.id)
        ) {
          const idx =
            node.props.index !== undefined
              ? node.props.index
              : node.inputs[1]
                ? node.inputs[1].id
                : 0;
          let val = offsetState.get("elem_" + idx);
          if (!val) {
            val = insertUndefinedConstant(block, i);
            blockOf.set(val, block);
            i++;
          }
          replaceValue(graph, node, val);
          replaceGraphFrameStateValue(graph, node, val);
          toDelete.add(node.id);
        }
      }
    };

    const walkDom = (block, propState, offsetState) => {
      const localProp = new Map(propState);
      const localOffset = new Map(offsetState);
      processBlock(block, localProp, localOffset);
      for (const child of children.get(block) || []) {
        walkDom(child, localProp, localOffset);
      }
    };

    walkDom(allocBlock, new Map(), new Map());

    removeNodes(graph, toDelete);

    tracer.jitCompile(
      graph.name,
      `EscapeAnalysis: Scalar replaced object allocation v${alloc.id} (${toDelete.size} nodes removed)`,
    );
    scalarReplCount++;
  }

  return scalarReplCount;
}

function isPropertyUse(node, aliases) {
  return (
    (node.type === IR_GENERIC_SET_PROP || node.type === IR_GENERIC_GET_PROP) &&
    aliases.has(node.inputs[0])
  );
}

function isElementUse(node, aliases) {
  return (
    (node.type === IR_GENERIC_SET_INDEX ||
      node.type === IR_GENERIC_GET_INDEX ||
      node.type === IR_STORE_ELEMENT ||
      node.type === IR_LOAD_ELEMENT) &&
    aliases.has(node.inputs[0])
  );
}

function isFieldUse(node, aliases) {
  return (
    (node.type === IR_STORE_FIELD || node.type === IR_LOAD_FIELD) &&
    aliases.has(node.inputs[0])
  );
}

function isReferenceGuard(node, aliases) {
  return (
    (node.type === IR_CHECK_MAP || node.type === IR_CHECK_ARRAY) &&
    aliases.has(node.inputs[0])
  );
}

function isSameReferencePhi(node, aliases) {
  return (
    node.type === IR_PHI &&
    node.inputs.length > 0 &&
    node.inputs.every((input) => aliases.has(input))
  );
}

function insertUndefinedConstant(block, index) {
  const value = irConstant(undefined);
  value.block = block;
  block.nodes.splice(index, 0, value);
  return value;
}

function replaceValue(graph, oldValue, newValue) {
  for (const use of [...oldValue.uses]) {
    for (let i = 0; i < use.inputs.length; i++) {
      if (use.inputs[i] === oldValue) {
        use.inputs[i] = newValue;
        newValue.uses.push(use);
      }
    }
  }
  oldValue.uses.length = 0;
}

function removeNodes(graph, toDelete) {
  for (const block of graph.blocks) {
    const kept = [];
    for (const node of block.nodes) {
      if (toDelete.has(node.id)) {
        detachInputs(node);
        node.uses = [];
        node.block = null;
      } else {
        kept.push(node);
      }
    }
    block.nodes = kept;
  }
}

function detachInputs(node) {
  for (const input of node.inputs) {
    if (input && input.uses)
      input.uses = input.uses.filter((use) => use !== node);
  }
  node.inputs = [];
}
