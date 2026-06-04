import {
  IR_NEW_OBJECT,
  IR_GENERIC_SET_PROP,
  IR_GENERIC_GET_PROP,
  IR_CHECK_MAP,
  IR_STORE_FIELD,
  IR_LOAD_FIELD,
  IR_DEOPTIMIZE,
  IR_RETURN,
} from "../ir/index.js";
import { tracer } from "../../core/tracing/index.js";
import { replaceGraphFrameStateValue } from "./frame-state-values.js";

export function allocationSinking(graph) {
  let sunkCount = 0;

  for (const block of graph.blocks) {
    const allocations = [];
    for (const node of block.nodes) {
      if (node.type === IR_NEW_OBJECT) {
        allocations.push(node);
      }
    }

    for (const alloc of allocations) {
      const analysis = analyzeEscape(alloc, block, graph);
      if (!analysis) continue;
      if (analysis.fullyEscapes || analysis.escapePoints.length === 0) continue;

      const onlyEscapesOnDeopt = analysis.escapePoints.every(
        (ep) => ep.type === IR_DEOPTIMIZE,
      );

      if (onlyEscapesOnDeopt) {
        sinkToDeoptOnly(alloc, block, analysis, graph);
        sunkCount++;
        tracer.log(
          "JIT",
          `AllocationSinking: eliminated allocation v${alloc.id} — escapes only on deopt`,
        );
      }
    }
  }

  return { sunkCount };
}

function analyzeEscape(alloc, defBlock, graph) {
  const safeUses = new Set();
  const escapePoints = [];
  let fullyEscapes = false;
  const fieldStores = new Map();
  const propStores = new Map();

  for (const use of alloc.uses) {
    if (use.type === IR_GENERIC_SET_PROP && use.inputs[0] === alloc) {
      safeUses.add(use);
      propStores.set(use.props.propName, use);
    } else if (use.type === IR_GENERIC_GET_PROP && use.inputs[0] === alloc) {
      safeUses.add(use);
    } else if (use.type === IR_CHECK_MAP && use.inputs[0] === alloc) {
      safeUses.add(use);
      for (const checkUse of use.uses) {
        if (checkUse.type === IR_STORE_FIELD && checkUse.inputs[0] === use) {
          safeUses.add(checkUse);
          fieldStores.set(checkUse.props.offset, checkUse);
        } else if (
          checkUse.type === IR_LOAD_FIELD &&
          checkUse.inputs[0] === use
        ) {
          safeUses.add(checkUse);
        } else {
          escapePoints.push(checkUse);
        }
      }
    } else if (use.type === IR_DEOPTIMIZE) {
      escapePoints.push(use);
    } else if (use.type === IR_RETURN) {
      escapePoints.push(use);
    } else {
      fullyEscapes = true;
      break;
    }
  }

  if (fullyEscapes)
    return {
      fullyEscapes: true,
      escapePoints: [],
      safeUses,
      fieldStores,
      propStores,
    };

  return {
    fullyEscapes: false,
    escapePoints,
    safeUses,
    fieldStores,
    propStores,
  };
}

function sinkToDeoptOnly(alloc, block, analysis, graph) {
  const virtualState = buildVirtualState(alloc, block, analysis);

  for (const deoptNode of analysis.escapePoints) {
    if (deoptNode.type !== IR_DEOPTIMIZE) continue;
    if (!deoptNode.props) deoptNode.props = {};
    if (!deoptNode.props.sunkAllocations)
      deoptNode.props.sunkAllocations = new Map();
    deoptNode.props.sunkAllocations.set(alloc.id, {
      fields: new Map(virtualState.fields),
      props: new Map(virtualState.props),
    });
    deoptNode.inputs = deoptNode.inputs.filter((input) => input !== alloc);
  }

  removeAllocation(alloc, analysis, graph);
}

function buildVirtualState(alloc, block, analysis) {
  const fields = new Map();
  const props = new Map();

  for (const [offset, storeNode] of analysis.fieldStores) {
    fields.set(offset, storeNode.inputs[1]);
  }
  for (const [propName, storeNode] of analysis.propStores) {
    props.set(propName, storeNode.inputs[1]);
  }

  return { fields, props };
}

function removeAllocation(alloc, analysis, graph) {
  const toDelete = new Set([alloc.id]);

  for (const use of analysis.safeUses) {
    toDelete.add(use.id);
  }

  alloc.inputs.forEach((inp) => {
    if (inp) inp.uses = inp.uses.filter((u) => u !== alloc);
  });

  for (const use of analysis.safeUses) {
    if (use.type === IR_GENERIC_GET_PROP || use.type === IR_LOAD_FIELD) {
      const replacement = findStoredValue(use, analysis);
      if (replacement) {
        for (const user of use.uses) {
          for (let j = 0; j < user.inputs.length; j++) {
            if (user.inputs[j] === use) {
              user.inputs[j] = replacement;
              replacement.uses.push(user);
            }
          }
        }
        replaceGraphFrameStateValue(graph, use, replacement);
      }
    }
  }

  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (!toDelete.has(node.id)) continue;
      for (const input of node.inputs) {
        if (input?.uses) input.uses = input.uses.filter((use) => use !== node);
      }
      node.uses = [];
      node.inputs = [];
    }
  }

  alloc.uses = alloc.uses.filter((use) => !analysis.escapePoints.includes(use));

  for (const graphBlock of graph.blocks) {
    graphBlock.nodes = graphBlock.nodes.filter((n) => !toDelete.has(n.id));
  }
}

function findStoredValue(loadNode, analysis) {
  if (loadNode.type === IR_LOAD_FIELD) {
    const offset = loadNode.props.offset;
    const storeNode = analysis.fieldStores.get(offset);
    return storeNode ? storeNode.inputs[1] : null;
  }
  if (loadNode.type === IR_GENERIC_GET_PROP) {
    const propName = loadNode.props.propName;
    const storeNode = analysis.propStores.get(propName);
    return storeNode ? storeNode.inputs[1] : null;
  }
  return null;
}
