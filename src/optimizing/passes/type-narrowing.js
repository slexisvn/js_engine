import {
  IR_CHECK_SMI,
  IR_CHECK_NUMBER,
  IR_CHECK_MAP,
  IR_GENERIC_ADD,
  IR_GENERIC_SUB,
  IR_GENERIC_MUL,
  IR_GENERIC_DIV,
  IR_GENERIC_MOD,
  IR_GENERIC_COMPARE,
  IR_INT32_ADD,
  IR_INT32_SUB,
  IR_INT32_MUL,
  IR_INT32_DIV,
  IR_INT32_MOD,
  IR_INT32_COMPARE,
  IR_FLOAT64_ADD,
  IR_FLOAT64_SUB,
  IR_FLOAT64_MUL,
  IR_FLOAT64_DIV,
  IR_FLOAT64_COMPARE,
  IR_TYPEOF,
  IR_NOT,
  IR_CONSTANT,
  IR_BRANCH,
  IR_BLOCK_PARAM,
} from "../ir/index.js";
import { computeDominators, buildDominatorTree } from "./dominators.js";
import { tracer } from "../../core/tracing/index.js";
import {
  TypeKind,
  booleanType,
  joinTypes,
  narrowType,
  numberType,
  objectType,
  smiType,
  stringType,
  typeFromConstant,
  typeFromTypeof,
} from "../types/lattice.js";

const GENERIC_TO_INT32 = {
  [IR_GENERIC_ADD]: IR_INT32_ADD,
  [IR_GENERIC_SUB]: IR_INT32_SUB,
  [IR_GENERIC_MUL]: IR_INT32_MUL,
  [IR_GENERIC_DIV]: IR_INT32_DIV,
  [IR_GENERIC_MOD]: IR_INT32_MOD,
  [IR_GENERIC_COMPARE]: IR_INT32_COMPARE,
};

const GENERIC_TO_FLOAT64 = {
  [IR_GENERIC_ADD]: IR_FLOAT64_ADD,
  [IR_GENERIC_SUB]: IR_FLOAT64_SUB,
  [IR_GENERIC_MUL]: IR_FLOAT64_MUL,
  [IR_GENERIC_DIV]: IR_FLOAT64_DIV,
  [IR_GENERIC_COMPARE]: IR_FLOAT64_COMPARE,
};

export function typeNarrowing(graph) {
  const dominators = computeDominators(graph);
  const { children } = buildDominatorTree(graph, dominators);
  let narrowCount = 0;

  const walkBlock = (block, inherited) => {
    const facts = new Map(inherited);
    mergeBlockParams(block, facts);

    for (const node of block.nodes) {
      recordNodeType(node, facts);

      const specializedType = specializeNode(node, facts);
      if (specializedType) {
        node.type = specializedType;
        if (!node.frameState) node.frameState = frameStateFromInputs(node);
        narrowCount++;
        recordNodeType(node, facts);
      }
    }

    for (const child of children.get(block) || []) {
      walkBlock(child, factsForDominatorChild(block, child, facts));
    }
  };

  if (graph.blocks[0]) walkBlock(graph.blocks[0], new Map());

  if (narrowCount > 0) {
    tracer.jitCompile(
      "",
      `TypeNarrowing: specialized ${narrowCount} operations`,
    );
  }
  return narrowCount;
}

function mergeBlockParams(block, facts) {
  for (const param of block.params || []) {
    let merged = null;
    for (const input of param.inputs || []) {
      merged = joinTypes(
        merged,
        inferValueType(input, facts, new Set([param.id])),
      );
    }
    if (merged) facts.set(param.id, merged);
  }
}

function recordNodeType(node, facts) {
  if (node.type === IR_CHECK_SMI && node.inputs[0]) {
    const narrowed = narrowType(facts.get(node.inputs[0].id), smiType());
    facts.set(node.inputs[0].id, narrowed);
    facts.set(node.id, narrowed);
    return;
  }

  if (node.type === IR_CHECK_NUMBER && node.inputs[0]) {
    const narrowed = narrowType(facts.get(node.inputs[0].id), numberType());
    facts.set(node.inputs[0].id, narrowed);
    facts.set(node.id, narrowed);
    return;
  }

  if (node.type === IR_CHECK_MAP && node.inputs[0]) {
    const narrowed = narrowType(
      facts.get(node.inputs[0].id),
      objectType(node.props.expectedMapId ?? null),
    );
    facts.set(node.inputs[0].id, narrowed);
    facts.set(node.id, narrowed);
    return;
  }

  if (node.type === IR_CONSTANT) {
    facts.set(node.id, typeFromConstant(node.props.value));
    return;
  }

  if (node.type === IR_NOT) {
    facts.set(node.id, booleanType());
    return;
  }

  if (node.type === IR_TYPEOF) {
    facts.set(node.id, stringType());
    return;
  }

  if (node.type === IR_BLOCK_PARAM) {
    let merged = null;
    for (const input of node.inputs || [])
      merged = joinTypes(
        merged,
        inferValueType(input, facts, new Set([node.id])),
      );
    if (merged) facts.set(node.id, merged);
  }
}

function inferValueType(value, facts, seen = new Set()) {
  const existing = facts.get(value.id);
  if (existing) return existing;
  if (seen.has(value.id)) return null;
  seen.add(value.id);
  if (value.type === IR_CONSTANT) return typeFromConstant(value.props.value);
  if (value.type === IR_CHECK_SMI) return smiType();
  if (value.type === IR_CHECK_NUMBER) return numberType();
  if (value.type === IR_CHECK_MAP)
    return objectType(value.props.expectedMapId ?? null);
  if (value.type === IR_NOT) return booleanType();
  if (value.type === IR_TYPEOF) return stringType();
  if (value.type === IR_BLOCK_PARAM) {
    let merged = null;
    for (const input of value.inputs || [])
      merged = joinTypes(merged, inferValueType(input, facts, seen));
    return merged;
  }
  return null;
}

function factsForDominatorChild(block, child, facts) {
  const next = new Map(facts);
  const terminator = block.getTerminator
    ? block.getTerminator()
    : block.nodes[block.nodes.length - 1];
  if (!terminator || terminator.type !== IR_BRANCH) return next;
  if (terminator.props.trueBlock !== child.id) return next;
  recordTrueBranchFact(terminator, next);
  return next;
}

function recordTrueBranchFact(branch, facts) {
  if (!branch.inputs[0]) return;
  const condition = branch.inputs[0];
  if (
    condition.type !== IR_INT32_COMPARE ||
    condition.props.op !== "==" ||
    condition.inputs.length !== 2
  ) {
    return;
  }

  const [left, right] = condition.inputs;
  if (
    left.type === IR_TYPEOF &&
    right.type === IR_CONSTANT &&
    typeof right.props.value === "string" &&
    left.inputs[0]
  ) {
    const fact = typeFromTypeof(right.props.value);
    if (fact)
      facts.set(
        left.inputs[0].id,
        narrowType(facts.get(left.inputs[0].id), fact),
      );
  }
}

function specializeNode(node, facts) {
  if (node.inputs.length < 2) return null;
  const left = facts.get(node.inputs[0].id);
  const right = facts.get(node.inputs[1].id);
  if (!left || !right) return null;

  if (left.kind === TypeKind.Smi && right.kind === TypeKind.Smi) {
    return GENERIC_TO_INT32[node.type] || null;
  }

  if (isNumeric(left) && isNumeric(right)) {
    return GENERIC_TO_FLOAT64[node.type] || null;
  }

  return null;
}

function isNumeric(type) {
  return (
    type.kind === TypeKind.Smi ||
    type.kind === TypeKind.Double ||
    type.kind === TypeKind.Number
  );
}

function frameStateFromInputs(node) {
  for (const input of node.inputs) {
    if (input && input.frameState) return input.frameState;
  }
  return null;
}
