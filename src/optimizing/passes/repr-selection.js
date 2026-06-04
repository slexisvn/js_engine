import {
  IR_PARAMETER,
  IR_CONSTANT,
  IR_INT32_ADD,
  IR_INT32_SUB,
  IR_INT32_MUL,
  IR_INT32_DIV,
  IR_INT32_MOD,
  IR_INT32_SHL,
  IR_INT32_SHR,
  IR_INT32_AND,
  IR_FLOAT64_ADD,
  IR_FLOAT64_SUB,
  IR_FLOAT64_MUL,
  IR_FLOAT64_DIV,
  IR_INT32_COMPARE,
  IR_FLOAT64_COMPARE,
  IR_CHECK_SMI,
  IR_CHECK_NUMBER,
  IR_CHECK_MAP,
  IR_CHECK_ARRAY,
  IR_CHECK_ELEMENTS_KIND,
  IR_CHECK_BOUNDS,
  IR_CHECK_CALL_TARGET,
  IR_LOAD_FIELD,
  IR_POLYMORPHIC_LOAD,
  IR_LOAD_ARRAY_LENGTH,
  IR_LOAD_ELEMENT,
  IR_LOAD_GLOBAL,
  IR_STORE_GLOBAL,
  IR_LOAD_LOCAL,
  IR_LOAD_CONST,
  IR_STORE_FIELD,
  IR_STORE_ELEMENT,
  IR_GENERIC_ADD,
  IR_GENERIC_SUB,
  IR_GENERIC_MUL,
  IR_GENERIC_DIV,
  IR_GENERIC_MOD,
  IR_GENERIC_COMPARE,
  IR_GENERIC_GET_PROP,
  IR_GENERIC_SET_PROP,
  IR_GENERIC_CALL,
  IR_GENERIC_GET_INDEX,
  IR_GENERIC_SET_INDEX,
  IR_GENERIC_BITAND,
  IR_GENERIC_BITOR,
  IR_GENERIC_BITXOR,
  IR_GENERIC_SHL,
  IR_GENERIC_SHR,
  IR_GENERIC_USHR,
  IR_GENERIC_POW,
  IR_GENERIC_BITNOT,
  IR_NEW_OBJECT,
  IR_NEW_ARRAY,
  IR_CALL_BUILTIN,
  IR_TYPEOF,
  IR_NOT,
  IR_NEG,
  IR_RETURN,
  IR_BRANCH,
  IR_PHI,
  IR_BOX,
  IR_UNBOX,
  irBox,
  irUnbox,
} from "../ir/index.js";

export const REP_INT32 = "int32";
export const REP_FLOAT64 = "float64";
export const REP_TAGGED_NUMBER = "tagged-number";
export const REP_HANDLE = "handle";
export const REP_BOOL = "bool";

export function representationSelection(graph) {
  const INT32_PRODUCERS = new Set([
    IR_INT32_ADD,
    IR_INT32_SUB,
    IR_INT32_MUL,
    IR_INT32_DIV,
    IR_INT32_MOD,
    IR_INT32_SHL,
    IR_INT32_SHR,
    IR_INT32_AND,
    IR_LOAD_ARRAY_LENGTH,
    IR_GENERIC_BITAND,
    IR_GENERIC_BITOR,
    IR_GENERIC_BITXOR,
    IR_GENERIC_SHL,
    IR_GENERIC_SHR,
    IR_GENERIC_BITNOT,
  ]);

  const BOOL_PRODUCERS = new Set([
    IR_INT32_COMPARE,
    IR_FLOAT64_COMPARE,
    IR_GENERIC_COMPARE,
    IR_CHECK_CALL_TARGET,
    IR_NOT,
  ]);

  const FLOAT64_PRODUCERS = new Set([
    IR_FLOAT64_ADD,
    IR_FLOAT64_SUB,
    IR_FLOAT64_MUL,
    IR_FLOAT64_DIV,
  ]);

  const INT32_CONSUMERS = new Set([
    IR_INT32_ADD,
    IR_INT32_SUB,
    IR_INT32_MUL,
    IR_INT32_DIV,
    IR_INT32_MOD,
    IR_INT32_SHL,
    IR_INT32_SHR,
    IR_INT32_AND,
    IR_INT32_COMPARE,
  ]);

  const FLOAT64_CONSUMERS = new Set([
    IR_FLOAT64_ADD,
    IR_FLOAT64_SUB,
    IR_FLOAT64_MUL,
    IR_FLOAT64_DIV,
    IR_FLOAT64_COMPARE,
  ]);

  const TAGGED_NUMBER_PRODUCERS = new Set([
    IR_GENERIC_SUB,
    IR_GENERIC_MUL,
    IR_GENERIC_DIV,
    IR_GENERIC_MOD,
    IR_GENERIC_USHR,
    IR_GENERIC_POW,
  ]);

  const HANDLE_PRODUCERS = new Set([
    IR_GENERIC_ADD,
    IR_GENERIC_GET_PROP,
    IR_GENERIC_SET_PROP,
    IR_GENERIC_GET_INDEX,
    IR_GENERIC_SET_INDEX,
    IR_LOAD_GLOBAL,
    IR_LOAD_LOCAL,
    IR_LOAD_CONST,
    IR_NEW_OBJECT,
    IR_NEW_ARRAY,
    IR_CALL_BUILTIN,
    IR_TYPEOF,
  ]);

  const nodeRep = new Map();

  for (const param of graph.parameters) {
    nodeRep.set(param.id, REP_HANDLE);
  }

  const constantRep = (value) => {
    if (typeof value === "boolean") return REP_BOOL;
    if (typeof value === "number") {
      if (
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647
      )
        return REP_INT32;
      return REP_FLOAT64;
    }
    if (
      value === undefined ||
      value === null ||
      typeof value === "string" ||
      typeof value === "object"
    )
      return REP_HANDLE;
    return REP_HANDLE;
  };

  const mergePhiRep = (inputs) => {
    let hasHandle = false;
    let hasTaggedNumber = false;
    let hasFloat64 = false;
    let hasInt32 = false;
    let hasBool = false;

    for (const inp of inputs) {
      const rep = nodeRep.get(inp.id);
      if (rep === REP_HANDLE || rep === undefined) hasHandle = true;
      else if (rep === REP_TAGGED_NUMBER) hasTaggedNumber = true;
      else if (rep === REP_FLOAT64) hasFloat64 = true;
      else if (rep === REP_INT32) hasInt32 = true;
      else if (rep === REP_BOOL) hasBool = true;
    }

    if (hasHandle) return REP_HANDLE;
    if (hasTaggedNumber) return REP_TAGGED_NUMBER;
    if (hasFloat64) return REP_FLOAT64;
    if (hasInt32) return REP_INT32;
    if (hasBool) return REP_BOOL;
    return REP_HANDLE;
  };

  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (INT32_PRODUCERS.has(node.type)) {
        nodeRep.set(node.id, REP_INT32);
      } else if (BOOL_PRODUCERS.has(node.type)) {
        nodeRep.set(node.id, REP_BOOL);
      } else if (FLOAT64_PRODUCERS.has(node.type)) {
        nodeRep.set(node.id, REP_FLOAT64);
      } else if (node.type === IR_CONSTANT) {
        nodeRep.set(node.id, constantRep(node.props.value));
      } else if (node.type === IR_CHECK_SMI) {
        nodeRep.set(node.id, REP_INT32);
      } else if (node.type === IR_CHECK_NUMBER) {
        let needsFloat = false;
        for (const use of node.uses) {
          if (FLOAT64_CONSUMERS.has(use.type)) {
            needsFloat = true;
            break;
          }
        }
        nodeRep.set(node.id, needsFloat ? REP_FLOAT64 : REP_INT32);
      } else if (node.type === IR_PHI) {
        nodeRep.set(node.id, mergePhiRep(node.inputs));
      } else if (node.type === IR_BOX) {
        nodeRep.set(
          node.id,
          node.props.fromType === "handle" ? REP_HANDLE : REP_TAGGED_NUMBER,
        );
      } else if (node.type === IR_UNBOX) {
        nodeRep.set(
          node.id,
          node.props.toType === "float64"
            ? REP_FLOAT64
            : node.props.toType === "bool"
              ? REP_BOOL
              : REP_INT32,
        );
      } else if (node.type === IR_LOAD_ELEMENT) {
        if (node.props.elementRep === "int32") nodeRep.set(node.id, REP_INT32);
        else if (node.props.elementRep === "float64")
          nodeRep.set(node.id, REP_FLOAT64);
        else nodeRep.set(node.id, REP_HANDLE);
      } else if (
        node.type === IR_LOAD_FIELD ||
        node.type === IR_POLYMORPHIC_LOAD
      ) {
        let fieldRep = REP_TAGGED_NUMBER;
        if (node.uses && node.uses.length > 0) {
          let allNumeric = true;
          for (const use of node.uses) {
            if (
              use.type !== IR_CHECK_SMI &&
              use.type !== IR_CHECK_NUMBER &&
              use.type !== IR_GENERIC_SUB &&
              use.type !== IR_GENERIC_MUL &&
              use.type !== IR_GENERIC_DIV &&
              use.type !== IR_GENERIC_MOD &&
              use.type !== IR_GENERIC_COMPARE
            ) {
              allNumeric = false;
              break;
            }
          }
          if (!allNumeric) fieldRep = REP_HANDLE;
        }
        nodeRep.set(node.id, fieldRep);
      } else if (
        node.type === IR_CHECK_MAP ||
        node.type === IR_CHECK_ARRAY ||
        node.type === IR_CHECK_ELEMENTS_KIND ||
        node.type === IR_CHECK_BOUNDS
      ) {
        const inputRep = nodeRep.get(node.inputs[0]?.id);
        nodeRep.set(node.id, inputRep || REP_HANDLE);
      } else if (node.type === IR_NEG) {
        const inputRep = nodeRep.get(node.inputs[0]?.id);
        nodeRep.set(
          node.id,
          inputRep === REP_FLOAT64 ? REP_FLOAT64 : REP_INT32,
        );
      } else if (TAGGED_NUMBER_PRODUCERS.has(node.type)) {
        nodeRep.set(node.id, REP_TAGGED_NUMBER);
      } else if (node.type === IR_GENERIC_CALL) {
        let callRep = REP_HANDLE;
        if (node.uses && node.uses.length > 0) {
          let allSmi = true;
          let allNum = true;
          for (const use of node.uses) {
            if (use.type !== IR_CHECK_SMI) allSmi = false;
            if (use.type !== IR_CHECK_SMI && use.type !== IR_CHECK_NUMBER)
              allNum = false;
          }
          if (allSmi) callRep = REP_INT32;
          else if (allNum) callRep = REP_FLOAT64;
        }
        nodeRep.set(node.id, callRep);
      } else if (HANDLE_PRODUCERS.has(node.type)) {
        let hRep = REP_HANDLE;
        if (node.uses && node.uses.length > 0) {
          let allSmi = true;
          let allNum = true;
          for (const use of node.uses) {
            if (use.type !== IR_CHECK_SMI) allSmi = false;
            if (use.type !== IR_CHECK_SMI && use.type !== IR_CHECK_NUMBER)
              allNum = false;
          }
          if (allSmi) hRep = REP_INT32;
          else if (allNum) hRep = REP_FLOAT64;
        }
        nodeRep.set(node.id, hRep);
      } else {
        nodeRep.set(node.id, REP_HANDLE);
      }
    }
  }

  for (const param of graph.parameters) {
    let rep = nodeRep.get(param.id) || REP_HANDLE;
    for (const use of param.uses) {
      if (
        use.type === IR_CHECK_MAP ||
        use.type === IR_CHECK_ARRAY ||
        use.type === IR_CHECK_ELEMENTS_KIND
      ) {
        rep = REP_HANDLE;
        break;
      }
      if (use.type === IR_CHECK_NUMBER || FLOAT64_CONSUMERS.has(use.type))
        rep = REP_FLOAT64;
      else if (use.type === IR_CHECK_SMI || INT32_CONSUMERS.has(use.type))
        rep = rep === REP_FLOAT64 ? REP_FLOAT64 : REP_INT32;
    }
    nodeRep.set(param.id, rep);
  }

  let insertCount = 0;

  const getExpectedInputRep = (consumer, inputIndex) => {
    if (INT32_CONSUMERS.has(consumer.type)) return REP_INT32;
    if (FLOAT64_CONSUMERS.has(consumer.type)) return REP_FLOAT64;
    if (consumer.type === IR_RETURN)
      return nodeRep.get(consumer.inputs[inputIndex]?.id) || REP_HANDLE;
    if (consumer.type === IR_BRANCH) return REP_BOOL;
    if (
      consumer.type === IR_STORE_FIELD ||
      consumer.type === IR_STORE_ELEMENT
    ) {
      if (consumer.type === IR_STORE_FIELD && inputIndex === 1)
        return (
          nodeRep.get(consumer.inputs[inputIndex]?.id) || REP_TAGGED_NUMBER
        );
      if (consumer.type === IR_STORE_ELEMENT && inputIndex === 1)
        return REP_INT32;
      if (consumer.type === IR_STORE_ELEMENT && inputIndex === 2) {
        if (consumer.props.elementRep === "int32") return REP_INT32;
        if (consumer.props.elementRep === "float64") return REP_FLOAT64;
        return REP_HANDLE;
      }
    }
    if (consumer.type === IR_LOAD_ELEMENT && inputIndex === 1) return REP_INT32;
    if (consumer.type === IR_CHECK_BOUNDS && inputIndex === 0) return REP_INT32;
    if (consumer.type === IR_TYPEOF) return REP_HANDLE;
    if (consumer.type === IR_CHECK_CALL_TARGET) return REP_HANDLE;
    if (consumer.type === IR_NOT)
      return nodeRep.get(consumer.inputs[inputIndex]?.id) || REP_HANDLE;
    if (consumer.type === IR_NEG)
      return nodeRep.get(consumer.inputs[inputIndex]?.id) === REP_FLOAT64
        ? REP_FLOAT64
        : REP_INT32;
    if (consumer.type === IR_GENERIC_COMPARE) return REP_HANDLE;
    if (
      consumer.type === IR_GENERIC_SUB ||
      consumer.type === IR_GENERIC_MUL ||
      consumer.type === IR_GENERIC_DIV ||
      consumer.type === IR_GENERIC_MOD ||
      consumer.type === IR_GENERIC_BITAND ||
      consumer.type === IR_GENERIC_BITOR ||
      consumer.type === IR_GENERIC_BITXOR ||
      consumer.type === IR_GENERIC_SHL ||
      consumer.type === IR_GENERIC_SHR ||
      consumer.type === IR_GENERIC_USHR ||
      consumer.type === IR_GENERIC_POW ||
      consumer.type === IR_GENERIC_BITNOT
    ) {
      return REP_TAGGED_NUMBER;
    }
    if (
      consumer.type === IR_GENERIC_ADD ||
      consumer.type === IR_GENERIC_CALL ||
      consumer.type === IR_GENERIC_GET_PROP ||
      consumer.type === IR_GENERIC_SET_PROP ||
      consumer.type === IR_GENERIC_GET_INDEX ||
      consumer.type === IR_GENERIC_SET_INDEX ||
      consumer.type === IR_NEW_ARRAY ||
      consumer.type === IR_STORE_GLOBAL
    ) {
      return nodeRep.get(consumer.inputs[inputIndex]?.id) || REP_HANDLE;
    }
    if (consumer.type === IR_PHI) {
      return nodeRep.get(consumer.id) || REP_HANDLE;
    }
    return null;
  };

  for (const block of graph.blocks) {
    const result = [];
    for (const node of block.nodes) {
      const pending = [];
      for (let i = 0; i < node.inputs.length; i++) {
        const input = node.inputs[i];
        const producerRep = nodeRep.get(input.id);
        const expectedRep = getExpectedInputRep(node, i);

        if (!expectedRep || !producerRep || producerRep === expectedRep)
          continue;

        if (producerRep === REP_INT32 && expectedRep === REP_TAGGED_NUMBER) {
          const boxNode = irBox(input, "int32");
          boxNode.frameState = node.frameState;
          nodeRep.set(boxNode.id, REP_TAGGED_NUMBER);
          node.replaceInput(i, boxNode);
          pending.push(boxNode);
          insertCount++;
        } else if (
          producerRep === REP_FLOAT64 &&
          expectedRep === REP_TAGGED_NUMBER
        ) {
          const boxNode = irBox(input, "float64");
          boxNode.frameState = node.frameState;
          nodeRep.set(boxNode.id, REP_TAGGED_NUMBER);
          node.replaceInput(i, boxNode);
          pending.push(boxNode);
          insertCount++;
        } else if (producerRep === REP_BOOL && expectedRep === REP_INT32) {
          nodeRep.set(input.id, REP_INT32);
        } else if (producerRep === REP_INT32 && expectedRep === REP_BOOL) {
          nodeRep.set(input.id, REP_BOOL);
        } else if (
          (producerRep === REP_TAGGED_NUMBER || producerRep === REP_HANDLE) &&
          expectedRep === REP_BOOL
        ) {
          const unboxNode = irUnbox(input, "bool");
          unboxNode.frameState = node.frameState;
          nodeRep.set(unboxNode.id, REP_BOOL);
          node.replaceInput(i, unboxNode);
          pending.push(unboxNode);
          insertCount++;
        } else if (
          (producerRep === REP_TAGGED_NUMBER || producerRep === REP_HANDLE) &&
          expectedRep === REP_INT32
        ) {
          const unboxNode = irUnbox(input, "int32");
          unboxNode.frameState = node.frameState;
          nodeRep.set(unboxNode.id, REP_INT32);
          node.replaceInput(i, unboxNode);
          pending.push(unboxNode);
          insertCount++;
        } else if (
          (producerRep === REP_TAGGED_NUMBER || producerRep === REP_HANDLE) &&
          expectedRep === REP_FLOAT64
        ) {
          const unboxNode = irUnbox(input, "float64");
          unboxNode.frameState = node.frameState;
          nodeRep.set(unboxNode.id, REP_FLOAT64);
          node.replaceInput(i, unboxNode);
          pending.push(unboxNode);
          insertCount++;
        }
      }

      for (const p of pending) {
        p.block = block;
        result.push(p);
      }
      result.push(node);
    }
    block.nodes = result;
  }

  const nodeById = new Map();
  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      nodeById.set(node.id, node);
    }
  }
  for (const param of graph.parameters) {
    nodeById.set(param.id, param);
  }

  for (const [nodeId, rep] of nodeRep) {
    const node = nodeById.get(nodeId);
    if (node) node.props._rep = rep;
  }

  return insertCount;
}
