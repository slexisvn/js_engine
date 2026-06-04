import {
  IR_INT32_ADD,
  IR_INT32_SUB,
  IR_INT32_MUL,
  IR_INT32_DIV,
  IR_INT32_MOD,
  IR_INT32_SHL,
  IR_INT32_SHR,
  IR_INT32_AND,
  IR_INT32_OR,
  IR_INT32_XOR,
  IR_FLOAT64_ADD,
  IR_FLOAT64_SUB,
  IR_FLOAT64_MUL,
  IR_FLOAT64_DIV,
  EFFECT_NONE,
  IR_PARAMETER,
  IR_CONSTANT,
  IR_PHI,
} from "../ir/index.js";
import { computeDominators, buildDominatorTree } from "./dominators.js";
import { replaceGraphFrameStateValue } from "./frame-state-values.js";

const KEEP_ALIVE = new Set([IR_PARAMETER, IR_CONSTANT, IR_PHI]);

const COMMUTATIVE_OPS = new Set([
  IR_INT32_ADD,
  IR_INT32_MUL,
  IR_INT32_AND,
  IR_INT32_OR,
  IR_INT32_XOR,
  IR_FLOAT64_ADD,
  IR_FLOAT64_MUL,
]);

function hashNode(node) {
  let h = node.type;

  if (COMMUTATIVE_OPS.has(node.type) && node.inputs.length === 2) {
    const id0 = node.inputs[0].id;
    const id1 = node.inputs[1].id;
    if (id0 <= id1) {
      h += "|" + id0 + "|" + id1;
    } else {
      h += "|" + id1 + "|" + id0;
    }
  } else {
    for (const inp of node.inputs) {
      h += "|" + inp.id;
    }
  }

  if (node.props.op) h += "|op=" + node.props.op;
  if (node.props.offset !== undefined) h += "|off=" + node.props.offset;
  if (node.props.mapId !== undefined) h += "|map=" + node.props.mapId;
  if (node.props.propName) h += "|pn=" + node.props.propName;
  return h;
}

export function globalValueNumbering(graph) {
  let gvnCount = 0;
  const dominators = computeDominators(graph);
  const { children } = buildDominatorTree(graph, dominators);

  const replaceNode = (node, existing) => {
    for (const use of [...node.uses]) {
      for (let i = 0; i < use.inputs.length; i++) {
        if (use.inputs[i] === node) {
          use.replaceInput(i, existing);
        }
      }
    }
    replaceGraphFrameStateValue(graph, node, existing);
    if (node.frameState && !existing.frameState) {
      existing.frameState = node.frameState;
    }
    for (const inp of node.inputs) {
      inp.uses = inp.uses.filter((u) => u !== node);
    }
    node.uses = [];
    node.inputs = [];
    gvnCount++;
  };

  const visit = (block, inheritedTable) => {
    const valueTable = new Map(inheritedTable);
    for (const node of block.nodes) {
      if (node.effectKind !== EFFECT_NONE) continue;
      if (KEEP_ALIVE.has(node.type)) continue;
      if (node.inputs.length === 0) continue;

      const hash = hashNode(node);
      const existing = valueTable.get(hash);

      if (existing && existing !== node && existing.type === node.type) {
        replaceNode(node, existing);
      } else if (!existing) {
        valueTable.set(hash, node);
      }
    }
    for (const child of children.get(block) || []) {
      visit(child, valueTable);
    }
  };

  if (graph.entry) {
    visit(graph.entry, new Map());
  }

  if (gvnCount > 0) {
    for (const block of graph.blocks) {
      block.nodes = block.nodes.filter(
        (n) =>
          n.inputs.length > 0 ||
          n.uses.length > 0 ||
          n.effectKind !== EFFECT_NONE ||
          KEEP_ALIVE.has(n.type),
      );
    }
    graph.rebuildUses?.();
  }

  return gvnCount;
}
