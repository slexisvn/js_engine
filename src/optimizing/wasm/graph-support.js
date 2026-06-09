import * as ir from "../ir/index.js";
import {
  REP_INT32,
  REP_FLOAT64,
  REP_TAGGED_NUMBER,
  REP_HANDLE,
  REP_BOOL,
} from "../passes/repr-selection.js";
import {
  TYPE_I32,
  TYPE_F64,
  OP_I32_EQ,
  OP_F64_EQ,
  OP_I32_NE,
  OP_F64_NE,
  OP_I32_LT_S,
  OP_F64_LT,
  OP_I32_GT_S,
  OP_F64_GT,
  OP_I32_LE_S,
  OP_F64_LE,
  OP_I32_GE_S,
  OP_F64_GE,
  OP_I32_ADD,
  OP_I32_SUB,
  OP_I32_MUL,
  OP_I32_DIV_S,
  OP_I32_REM_S,
  OP_I32_SHL,
  OP_I32_SHR_S,
  OP_I32_AND,
  OP_I32_OR,
  OP_I32_XOR,
  OP_I32_SHR_U,
  OP_I64_ADD,
  OP_I64_SUB,
  OP_I64_MUL,
  OP_F64_ADD,
  OP_F64_SUB,
  OP_F64_MUL,
  OP_F64_DIV,
  OP_F64_ABS,
  OP_F64_NEG,
  OP_F64_CEIL,
  OP_F64_FLOOR,
  OP_F64_TRUNC,
  OP_F64_NEAREST,
  OP_F64_SQRT,
  OP_F64_MIN,
  OP_F64_MAX,
} from "./wasm-format.js";
import { ELEMENTS_KIND_IDS } from "./object-layout.js";

export const RUNTIME_STUB_NODES = new Set([
  ir.IR_GENERIC_ADD,
  ir.IR_GENERIC_SUB,
  ir.IR_GENERIC_MUL,
  ir.IR_GENERIC_DIV,
  ir.IR_GENERIC_MOD,
  ir.IR_GENERIC_COMPARE,
  ir.IR_GENERIC_GET_PROP,
  ir.IR_GENERIC_SET_PROP,
  ir.IR_GENERIC_CALL,
  ir.IR_GENERIC_GET_INDEX,
  ir.IR_GENERIC_SET_INDEX,
  ir.IR_GENERIC_BITAND,
  ir.IR_GENERIC_BITOR,
  ir.IR_GENERIC_BITXOR,
  ir.IR_GENERIC_SHL,
  ir.IR_GENERIC_SHR,
  ir.IR_GENERIC_USHR,
  ir.IR_GENERIC_POW,
  ir.IR_GENERIC_BITNOT,
  ir.IR_GENERIC_INSTANCEOF,
  ir.IR_GENERIC_IN,
  ir.IR_LOAD_GLOBAL,
  ir.IR_STORE_GLOBAL,
  ir.IR_NEW_OBJECT,
  ir.IR_NEW_ARRAY,
  ir.IR_NEW_REGEX,
  ir.IR_TYPEOF,
  ir.IR_NOT,
  ir.IR_NEG,
  ir.IR_UNBOX,
  ir.IR_CALL_BUILTIN,
  ir.IR_CALL_KNOWN_FUNCTION,
  ir.IR_CHECK_CALL_TARGET,
  ir.IR_DISPATCH_MAP,
  ir.IR_MEGAMORPHIC_LOAD,
  ir.IR_MEGAMORPHIC_STORE,
  ir.IR_FLOAT64_POW,
]);

export const VALUE_PRODUCING = new Set([
  ir.IR_PARAMETER,
  ir.IR_CONSTANT,
  ir.IR_CHECK_SMI,
  ir.IR_CHECK_NUMBER,
  ir.IR_CHECK_MAP,
  ir.IR_CHECK_ARRAY,
  ir.IR_CHECK_ELEMENTS_KIND,
  ir.IR_CHECK_BOUNDS,
  ir.IR_CHECK_CALL_TARGET,
  ir.IR_INT32_ADD,
  ir.IR_INT32_SUB,
  ir.IR_INT32_MUL,
  ir.IR_INT32_DIV,
  ir.IR_INT32_MOD,
  ir.IR_FLOAT64_ADD,
  ir.IR_FLOAT64_SUB,
  ir.IR_FLOAT64_MUL,
  ir.IR_FLOAT64_DIV,
  ir.IR_INT32_COMPARE,
  ir.IR_FLOAT64_COMPARE,
  ir.IR_LOAD_FIELD,
  ir.IR_PHI,
  ir.IR_LOAD_ARRAY_LENGTH,
  ir.IR_LOAD_ELEMENT,
  ir.IR_POLYMORPHIC_LOAD,
  ir.IR_GENERIC_GET_PROP,
  ir.IR_GENERIC_ADD,
  ir.IR_GENERIC_SUB,
  ir.IR_GENERIC_MUL,
  ir.IR_GENERIC_DIV,
  ir.IR_GENERIC_MOD,
  ir.IR_GENERIC_COMPARE,
  ir.IR_GENERIC_CALL,
  ir.IR_GENERIC_GET_INDEX,
  ir.IR_GENERIC_SET_INDEX,
  ir.IR_GENERIC_BITAND,
  ir.IR_GENERIC_BITOR,
  ir.IR_GENERIC_BITXOR,
  ir.IR_GENERIC_SHL,
  ir.IR_GENERIC_SHR,
  ir.IR_GENERIC_USHR,
  ir.IR_GENERIC_POW,
  ir.IR_GENERIC_BITNOT,
  ir.IR_GENERIC_INSTANCEOF,
  ir.IR_GENERIC_IN,
  ir.IR_DISPATCH_MAP,
  ir.IR_MEGAMORPHIC_LOAD,
  ir.IR_MEGAMORPHIC_STORE,
  ir.IR_FLOAT64_POW,
  ir.IR_INT32_SHL,
  ir.IR_INT32_SHR,
  ir.IR_INT32_USHR,
  ir.IR_INT32_AND,
  ir.IR_INT32_OR,
  ir.IR_INT32_XOR,
  ir.IR_INT32_NOT,
  ir.IR_LOAD_GLOBAL,
  ir.IR_NEW_OBJECT,
  ir.IR_NEW_ARRAY,
  ir.IR_NEW_REGEX,
  ir.IR_TYPEOF,
  ir.IR_NOT,
  ir.IR_NEG,
  ir.IR_BOX,
  ir.IR_UNBOX,
  ir.IR_LOAD_LOCAL,
  ir.IR_LOAD_CONST,
  ir.IR_CALL_BUILTIN,
  ir.IR_CALL_KNOWN_FUNCTION,
]);

export const SUPPORTED_GRAPH_NODES = new Set([
  ...VALUE_PRODUCING,
  ...RUNTIME_STUB_NODES,
  ir.IR_STORE_FIELD,
  ir.IR_STORE_ELEMENT,
  ir.IR_STORE_LOCAL,
  ir.IR_STORE_GLOBAL,
  ir.IR_POLYMORPHIC_STORE,
  ir.IR_RETURN,
  ir.IR_BRANCH,
  ir.IR_JUMP,
  ir.IR_DEOPTIMIZE,
]);

export const FIXED_INPUT_COUNTS = new Map([
  [ir.IR_PARAMETER, 0],
  [ir.IR_CONSTANT, 0],
  [ir.IR_CHECK_MAP, 1],
  [ir.IR_CHECK_SMI, 1],
  [ir.IR_CHECK_NUMBER, 1],
  [ir.IR_CHECK_CALL_TARGET, 1],
  [ir.IR_INT32_ADD, 2],
  [ir.IR_INT32_SUB, 2],
  [ir.IR_INT32_MUL, 2],
  [ir.IR_INT32_DIV, 2],
  [ir.IR_INT32_MOD, 2],
  [ir.IR_FLOAT64_ADD, 2],
  [ir.IR_FLOAT64_SUB, 2],
  [ir.IR_FLOAT64_MUL, 2],
  [ir.IR_FLOAT64_DIV, 2],
  [ir.IR_INT32_COMPARE, 2],
  [ir.IR_FLOAT64_COMPARE, 2],
  [ir.IR_LOAD_FIELD, 1],
  [ir.IR_STORE_FIELD, 2],
  [ir.IR_GENERIC_ADD, 2],
  [ir.IR_GENERIC_SUB, 2],
  [ir.IR_GENERIC_MUL, 2],
  [ir.IR_GENERIC_DIV, 2],
  [ir.IR_GENERIC_MOD, 2],
  [ir.IR_GENERIC_COMPARE, 2],
  [ir.IR_CHECK_ARRAY, 1],
  [ir.IR_CHECK_ELEMENTS_KIND, 1],
  [ir.IR_CHECK_BOUNDS, 2],
  [ir.IR_LOAD_ARRAY_LENGTH, 1],
  [ir.IR_LOAD_ELEMENT, 2],
  [ir.IR_STORE_ELEMENT, 3],
  [ir.IR_POLYMORPHIC_LOAD, 1],
  [ir.IR_POLYMORPHIC_STORE, 2],
  [ir.IR_GENERIC_GET_PROP, 1],
  [ir.IR_GENERIC_SET_PROP, 2],
  [ir.IR_LOAD_LOCAL, 0],
  [ir.IR_STORE_LOCAL, 1],
  [ir.IR_LOAD_GLOBAL, 0],
  [ir.IR_STORE_GLOBAL, 1],
  [ir.IR_BRANCH, 1],
  [ir.IR_JUMP, 0],
  [ir.IR_RETURN, 1],
  [ir.IR_DEOPTIMIZE, 0],
  [ir.IR_BOX, 1],
  [ir.IR_UNBOX, 1],
  [ir.IR_LOAD_CONST, 0],
  [ir.IR_TYPEOF, 1],
  [ir.IR_NOT, 1],
  [ir.IR_NEG, 1],
  [ir.IR_GENERIC_GET_INDEX, 2],
  [ir.IR_GENERIC_SET_INDEX, 3],
  [ir.IR_INT32_SHL, 2],
  [ir.IR_INT32_SHR, 2],
  [ir.IR_INT32_USHR, 2],
  [ir.IR_INT32_AND, 2],
  [ir.IR_INT32_OR, 2],
  [ir.IR_INT32_XOR, 2],
  [ir.IR_INT32_NOT, 1],
  [ir.IR_FLOAT64_POW, 2],
  [ir.IR_GENERIC_BITAND, 2],
  [ir.IR_GENERIC_BITOR, 2],
  [ir.IR_GENERIC_BITXOR, 2],
  [ir.IR_GENERIC_SHL, 2],
  [ir.IR_GENERIC_SHR, 2],
  [ir.IR_GENERIC_USHR, 2],
  [ir.IR_GENERIC_POW, 2],
  [ir.IR_GENERIC_BITNOT, 1],
  [ir.IR_GENERIC_INSTANCEOF, 2],
  [ir.IR_GENERIC_IN, 2],
  [ir.IR_DISPATCH_MAP, 1],
  [ir.IR_MEGAMORPHIC_LOAD, 1],
  [ir.IR_MEGAMORPHIC_STORE, 2],
  [ir.IR_NEW_REGEX, 0],
]);

export function repForNode(node) {
  return node?.props?._rep || REP_HANDLE;
}

export function wasmTypeForRep(rep) {
  if (rep === REP_FLOAT64 || rep === REP_TAGGED_NUMBER) return TYPE_F64;
  return TYPE_I32;
}

export function valueRepForRep(rep) {
  if (rep === REP_HANDLE) return REP_HANDLE;
  if (rep === REP_BOOL) return REP_BOOL;
  return REP_TAGGED_NUMBER;
}

function nodeLocation(node, fallbackBlock) {
  const blockId = node.block ? node.block.id : fallbackBlock.id;
  return `block ${blockId} instruction ${node.id} ${node.type}`;
}

function isCompiledFunctionConstant(value) {
  return (
    value &&
    typeof value === "object" &&
    Array.isArray(value.instructions) &&
    typeof value.paramCount === "number"
  );
}

export function compileRejectionForNode(node, block) {
  if (!SUPPORTED_GRAPH_NODES.has(node.type)) {
    return `${nodeLocation(node, block)} is not supported by wasm backend`;
  }

  if (node.type === ir.IR_DISPATCH_MAP) {
    const expectedInputs = node.props.isStore ? 2 : 1;
    if (node.inputs.length !== expectedInputs) {
      return `${nodeLocation(node, block)} has ${node.inputs.length} inputs, expected ${expectedInputs}`;
    }
  }

  const fixedInputCount = FIXED_INPUT_COUNTS.get(node.type);
  if (
    node.type !== ir.IR_DISPATCH_MAP &&
    fixedInputCount !== undefined &&
    node.inputs.length !== fixedInputCount
  ) {
    return `${nodeLocation(node, block)} has ${node.inputs.length} inputs, expected ${fixedInputCount}`;
  }

  for (let i = 0; i < node.inputs.length; i++) {
    if (!node.inputs[i]) {
      return `${nodeLocation(node, block)} input ${i} is empty`;
    }
  }

  if (
    node.type === ir.IR_CONSTANT &&
    isCompiledFunctionConstant(node.props.value) &&
    node.props.value.upvalues &&
    node.props.value.upvalues.length > 0
  ) {
    return `${nodeLocation(node, block)} is closure constant with upvalues`;
  }

  if (
    (node.type === ir.IR_INT32_COMPARE ||
      node.type === ir.IR_FLOAT64_COMPARE ||
      node.type === ir.IR_GENERIC_COMPARE) &&
    !COMPARE_OPS[node.props.op]
  ) {
    return `${nodeLocation(node, block)} has unsupported compare operator ${node.props.op}`;
  }

  if (node.type === ir.IR_LOAD_FIELD || node.type === ir.IR_STORE_FIELD) {
    if (!Number.isInteger(node.props.offset) || node.props.offset < 0) {
      return `${nodeLocation(node, block)} has invalid field offset`;
    }
  }

  if (node.type === ir.IR_CHECK_MAP) {
    if (!Number.isInteger(node.props.expectedMapId)) {
      return `${nodeLocation(node, block)} has invalid expected map`;
    }
  }

  if (node.type === ir.IR_CHECK_ELEMENTS_KIND) {
    if (!ELEMENTS_KIND_IDS.has(node.props.elementsKind)) {
      return `${nodeLocation(node, block)} has invalid elements kind`;
    }
  }

  if (
    node.type === ir.IR_POLYMORPHIC_LOAD ||
    node.type === ir.IR_POLYMORPHIC_STORE
  ) {
    const maps = node.props.maps;
    const offsets = node.props.offsets;
    if (
      !Array.isArray(maps) ||
      !Array.isArray(offsets) ||
      maps.length === 0 ||
      maps.length !== offsets.length
    ) {
      return `${nodeLocation(node, block)} has invalid polymorphic map table`;
    }
    for (let i = 0; i < maps.length; i++) {
      if (
        !Number.isInteger(maps[i]) ||
        !Number.isInteger(offsets[i]) ||
        offsets[i] < 0
      ) {
        return `${nodeLocation(node, block)} has invalid polymorphic entry ${i}`;
      }
    }
  }

  if (node.type === ir.IR_DISPATCH_MAP) {
    const propName = node.props.propertyName || node.props.propName;
    const handlers = node.props.handlers;
    if (typeof propName !== "string" || propName.length === 0) {
      return `${nodeLocation(node, block)} has invalid dispatch property`;
    }
    if (!Array.isArray(handlers) || handlers.length < 2) {
      return `${nodeLocation(node, block)} has invalid dispatch handler table`;
    }
    for (let i = 0; i < handlers.length; i++) {
      const handler = handlers[i];
      if (
        !handler ||
        !Number.isInteger(handler.mapId) ||
        !Number.isInteger(handler.offset) ||
        handler.offset < 0
      ) {
        return `${nodeLocation(node, block)} has invalid dispatch handler ${i}`;
      }
    }
  }

  if (
    node.type === ir.IR_MEGAMORPHIC_LOAD ||
    node.type === ir.IR_MEGAMORPHIC_STORE
  ) {
    const propName = node.props.propertyName || node.props.propName;
    if (typeof propName !== "string" || propName.length === 0) {
      return `${nodeLocation(node, block)} has invalid megamorphic property`;
    }
  }

  if (node.type === ir.IR_GENERIC_CALL) {
    const expectedInputs = 1 + node.props.argCount;
    if (
      !Number.isInteger(node.props.argCount) ||
      node.props.argCount < 0 ||
      node.inputs.length !== expectedInputs
    ) {
      return `${nodeLocation(node, block)} has invalid call arity`;
    }
  }

  if (node.type === ir.IR_CALL_KNOWN_FUNCTION) {
    if (
      !Number.isInteger(node.props.argCount) ||
      node.props.argCount < 0 ||
      node.inputs.length !== node.props.argCount
    ) {
      return `${nodeLocation(node, block)} has invalid call arity`;
    }
  }

  if (node.type === ir.IR_CALL_BUILTIN) {
    if (
      !Number.isInteger(node.props.argCount) ||
      node.props.argCount < 0 ||
      node.inputs.length !== node.props.argCount
    ) {
      return `${nodeLocation(node, block)} has invalid builtin arity`;
    }
  }

  if (node.type === ir.IR_NEW_ARRAY) {
    if (
      !Number.isInteger(node.props.elementCount) ||
      node.props.elementCount < 0 ||
      node.inputs.length !== node.props.elementCount
    ) {
      return `${nodeLocation(node, block)} has invalid variadic arity`;
    }
  }

  return null;
}

export const INT32_ARITH = new Set([
  ir.IR_INT32_ADD,
  ir.IR_INT32_SUB,
  ir.IR_INT32_MUL,
  ir.IR_INT32_DIV,
  ir.IR_INT32_MOD,
]);

export const FLOAT64_ARITH = new Set([
  ir.IR_FLOAT64_ADD,
  ir.IR_FLOAT64_SUB,
  ir.IR_FLOAT64_MUL,
  ir.IR_FLOAT64_DIV,
]);

export const INT32_OVERFLOW_CHECK = new Set([
  ir.IR_INT32_ADD,
  ir.IR_INT32_SUB,
  ir.IR_INT32_MUL,
]);

export const COMPARE_OPS = {
  "==": { i32: OP_I32_EQ, f64: OP_F64_EQ },
  "!=": { i32: OP_I32_NE, f64: OP_F64_NE },
  "loose==": { i32: OP_I32_EQ, f64: OP_F64_EQ },
  "loose!=": { i32: OP_I32_NE, f64: OP_F64_NE },
  "<": { i32: OP_I32_LT_S, f64: OP_F64_LT },
  ">": { i32: OP_I32_GT_S, f64: OP_F64_GT },
  "<=": { i32: OP_I32_LE_S, f64: OP_F64_LE },
  ">=": { i32: OP_I32_GE_S, f64: OP_F64_GE },
};

export const INT32_ARITH_OPCODES = {
  [ir.IR_INT32_ADD]: OP_I32_ADD,
  [ir.IR_INT32_SUB]: OP_I32_SUB,
  [ir.IR_INT32_MUL]: OP_I32_MUL,
  [ir.IR_INT32_DIV]: OP_I32_DIV_S,
  [ir.IR_INT32_MOD]: OP_I32_REM_S,
  [ir.IR_INT32_SHL]: OP_I32_SHL,
  [ir.IR_INT32_SHR]: OP_I32_SHR_S,
  [ir.IR_INT32_AND]: OP_I32_AND,
  [ir.IR_INT32_OR]: OP_I32_OR,
  [ir.IR_INT32_XOR]: OP_I32_XOR,
  [ir.IR_INT32_USHR]: OP_I32_SHR_U,
};

export const INT64_ARITH_OPCODES = {
  [ir.IR_INT32_ADD]: OP_I64_ADD,
  [ir.IR_INT32_SUB]: OP_I64_SUB,
  [ir.IR_INT32_MUL]: OP_I64_MUL,
};

export const FLOAT64_ARITH_OPCODES = {
  [ir.IR_FLOAT64_ADD]: OP_F64_ADD,
  [ir.IR_FLOAT64_SUB]: OP_F64_SUB,
  [ir.IR_FLOAT64_MUL]: OP_F64_MUL,
  [ir.IR_FLOAT64_DIV]: OP_F64_DIV,
};

export const CONDITIONALLY_NATIVE = new Set([
  ir.IR_GENERIC_BITAND,
  ir.IR_GENERIC_BITOR,
  ir.IR_GENERIC_BITXOR,
  ir.IR_GENERIC_SHL,
  ir.IR_GENERIC_SHR,
  ir.IR_GENERIC_USHR,
  ir.IR_GENERIC_BITNOT,
  ir.IR_NOT,
  ir.IR_NEG,
  ir.IR_TYPEOF,
]);

export const GENERIC_BITWISE_OPCODES = {
  [ir.IR_GENERIC_BITAND]: OP_I32_AND,
  [ir.IR_GENERIC_BITOR]: OP_I32_OR,
  [ir.IR_GENERIC_BITXOR]: OP_I32_XOR,
  [ir.IR_GENERIC_SHL]: OP_I32_SHL,
  [ir.IR_GENERIC_SHR]: OP_I32_SHR_S,
  [ir.IR_GENERIC_USHR]: OP_I32_SHR_U,
};

export const SPECULATIVE_ARITH_I32 = {
  [ir.IR_GENERIC_ADD]: ir.IR_INT32_ADD,
  [ir.IR_GENERIC_SUB]: ir.IR_INT32_SUB,
  [ir.IR_GENERIC_MUL]: ir.IR_INT32_MUL,
  [ir.IR_GENERIC_DIV]: ir.IR_INT32_DIV,
  [ir.IR_GENERIC_MOD]: ir.IR_INT32_MOD,
};

export const SPECULATIVE_ARITH_F64 = {
  [ir.IR_GENERIC_ADD]: ir.IR_FLOAT64_ADD,
  [ir.IR_GENERIC_SUB]: ir.IR_FLOAT64_SUB,
  [ir.IR_GENERIC_MUL]: ir.IR_FLOAT64_MUL,
  [ir.IR_GENERIC_DIV]: ir.IR_FLOAT64_DIV,
};

export const SPECULATIVE_COMPARE = new Set([
  ir.IR_GENERIC_COMPARE,
]);

export function isNativeEligible(node) {
  const rep = repForNode(node);
  if (CONDITIONALLY_NATIVE.has(node.type)) {
    if (node.type === ir.IR_TYPEOF) {
      return rep !== REP_HANDLE;
    }
    if (node.type === ir.IR_NEG) {
      return rep === REP_INT32 || rep === REP_FLOAT64 || rep === REP_TAGGED_NUMBER;
    }
    if (node.type === ir.IR_NOT) {
      return rep === REP_INT32 || rep === REP_BOOL;
    }
    return rep !== REP_HANDLE;
  }
  return false;
}

export const MATH_INTRINSICS = new Map([
  ["Math.abs", { opcode: OP_F64_ABS, arity: 1 }],
  ["Math.floor", { opcode: OP_F64_FLOOR, arity: 1 }],
  ["Math.ceil", { opcode: OP_F64_CEIL, arity: 1 }],
  ["Math.sqrt", { opcode: OP_F64_SQRT, arity: 1 }],
  ["Math.trunc", { opcode: OP_F64_TRUNC, arity: 1 }],
  ["Math.round", { opcode: OP_F64_NEAREST, arity: 1 }],
  ["Math.min", { opcode: OP_F64_MIN, arity: 2 }],
  ["Math.max", { opcode: OP_F64_MAX, arity: 2 }],
]);

export function mathIntrinsicForNode(node) {
  if (node.type !== ir.IR_CALL_BUILTIN) return null;
  const name = node.props.name || node.props.builtinName;
  if (!name) return null;
  const intrinsic = MATH_INTRINSICS.get(name);
  if (!intrinsic) return null;
  if (node.props.argCount !== intrinsic.arity) return null;
  return intrinsic;
}

export function computeBlockOrder(graph) {
  const visited = new Set();
  const order = [];

  function dfs(block) {
    if (visited.has(block.id)) return;
    visited.add(block.id);
    for (const succ of block.successors) {
      if (!visited.has(succ.id)) {
        dfs(succ);
      }
    }
    order.push(block);
  }

  if (graph.entry) {
    dfs(graph.entry);
  }
  for (const block of graph.blocks) {
    if (!visited.has(block.id)) {
      dfs(block);
    }
  }
  order.reverse();
  return order;
}

export function findBackEdges(graph, order) {
  const orderIndex = new Map();
  for (let i = 0; i < order.length; i++) {
    orderIndex.set(order[i].id, i);
  }
  const backEdges = [];
  for (const block of order) {
    for (const succ of block.successors) {
      if (
        orderIndex.has(succ.id) &&
        orderIndex.get(succ.id) <= orderIndex.get(block.id)
      ) {
        backEdges.push({ from: block, to: succ });
      }
    }
  }
  return backEdges;
}

export function findLoopHeaders(backEdges) {
  const headers = new Set();
  for (const edge of backEdges) {
    headers.add(edge.to.id);
  }
  return headers;
}

export function findLoopBlocks(header, backEdges, allBlocks) {
  const loopBackEdges = backEdges.filter((e) => e.to.id === header.id);
  const loopBlocks = new Set();
  loopBlocks.add(header.id);

  const worklist = [];
  for (const be of loopBackEdges) {
    if (!loopBlocks.has(be.from.id)) {
      loopBlocks.add(be.from.id);
      worklist.push(be.from);
    }
  }

  while (worklist.length > 0) {
    const block = worklist.pop();
    for (const pred of block.predecessors) {
      if (!loopBlocks.has(pred.id)) {
        loopBlocks.add(pred.id);
        worklist.push(pred);
      }
    }
  }

  return loopBlocks;
}

class StructuredRegion {
  constructor(type, blockIds) {
    this.type = type;
    this.blockIds = blockIds;
    this.children = [];
    this.headerBlockId = null;
    this.exitBlockId = null;
    this.trueBlockId = null;
    this.falseBlockId = null;
  }
}

export function buildRegions(graph, order, backEdges) {
  const loopHeaders = findLoopHeaders(backEdges);
  const blockMap = new Map();
  for (const block of graph.blocks) {
    blockMap.set(block.id, block);
  }

  const regions = [];
  const processed = new Set();

  for (const block of order) {
    if (processed.has(block.id)) continue;
    processed.add(block.id);

    if (loopHeaders.has(block.id)) {
      const loopBlockIds = findLoopBlocks(block, backEdges, graph.blocks);
      const region = new StructuredRegion("loop", loopBlockIds);
      region.headerBlockId = block.id;

      let exitBlockId = null;
      for (const lbId of loopBlockIds) {
        const lb = blockMap.get(lbId);
        if (!lb) continue;
        for (const succ of lb.successors) {
          if (!loopBlockIds.has(succ.id)) {
            exitBlockId = succ.id;
            break;
          }
        }
        if (exitBlockId !== null) break;
      }
      region.exitBlockId = exitBlockId;
      regions.push(region);

      for (const lbId of loopBlockIds) {
        processed.add(lbId);
      }
    } else {
      const term = block.getTerminator();
      if (term && term.type === ir.IR_BRANCH && block.successors.length === 2) {
        const region = new StructuredRegion("branch", new Set([block.id]));
        region.headerBlockId = block.id;
        region.trueBlockId = term.props.trueBlock;
        region.falseBlockId = term.props.falseBlock;
        regions.push(region);
      } else {
        const region = new StructuredRegion("linear", new Set([block.id]));
        region.headerBlockId = block.id;
        regions.push(region);
      }
    }
  }

  return regions;
}

export class RuntimeStubTable {
  constructor() {
    this.stubs = [];
    this.byNodeId = new Map();
  }

  register(node) {
    if (this.byNodeId.has(node.id)) return this.byNodeId.get(node.id);
    const stub = {
      id: this.stubs.length,
      nodeId: node.id,
      instructionId: node.id,
      blockId: node.block ? node.block.id : -1,
      opcode: node.type,
      bytecodeOffset: node.frameState ? node.frameState.bytecodeOffset : -1,
      frameStateId: node.frameState ? node.frameState.id : 0,
      inputReps: node.inputs.map((input) => repForNode(input)),
      outputRep: repForNode(node),
      sideEffect: runtimeStubHasSideEffect(node),
    };
    this.stubs.push(stub);
    this.byNodeId.set(node.id, stub);
    return stub;
  }

  unregister(nodeId) {
    const stub = this.byNodeId.get(nodeId);
    if (stub) {
      this.byNodeId.delete(nodeId);
      const idx = this.stubs.indexOf(stub);
      if (idx >= 0) this.stubs.splice(idx, 1);
      for (let i = idx; i < this.stubs.length; i++) {
        this.stubs[i].id = i;
      }
    }
  }

  getByNodeId(nodeId) {
    return this.byNodeId.get(nodeId);
  }

  getById(id) {
    return this.stubs[id];
  }
}

function runtimeStubHasSideEffect(node) {
  return (
    node.effectKind !== ir.EFFECT_NONE && node.effectKind !== ir.EFFECT_READ
  );
}
