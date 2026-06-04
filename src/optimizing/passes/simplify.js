import {
  irConstant,
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
  IR_NOT,
  IR_NEG,
  IR_CHECK_SMI,
  IR_CHECK_NUMBER,
  IR_LOAD_LOCAL,
  IR_STORE_LOCAL,
  IR_GENERIC_ADD,
  irInt32Add,
  irInt32Sub,
  irInt32Shl,
  irInt32Shr,
  irInt32And,
} from "../ir/index.js";

import { tracer } from "../../core/tracing/index.js";
import { replaceGraphFrameStateValue } from "./frame-state-values.js";

function rewireUses(graph, node, replacement) {
  for (const use of node.uses) {
    for (let j = 0; j < use.inputs.length; j++) {
      if (use.inputs[j] === node) {
        use.inputs[j] = replacement;
        replacement.uses.push(use);
      }
    }
  }
  for (const inp of node.inputs) {
    if (inp) inp.uses = inp.uses.filter((u) => u !== node);
  }
  replaceGraphFrameStateValue(graph, node, replacement);
}

export function constantFolding(graph) {
  const ARITH_OPS = {
    [IR_INT32_ADD]: (a, b) => (a + b) | 0,
    [IR_INT32_SUB]: (a, b) => (a - b) | 0,
    [IR_INT32_MUL]: (a, b) => Math.imul(a, b),
    [IR_INT32_DIV]: (a, b) => (b !== 0 ? (a / b) | 0 : 0),
    [IR_INT32_MOD]: (a, b) => (b !== 0 ? a % b : 0),
    [IR_INT32_SHL]: (a, b) => (a << b) | 0,
    [IR_INT32_SHR]: (a, b) => (a >> b) | 0,
    [IR_INT32_AND]: (a, b) => (a & b) | 0,
    [IR_FLOAT64_ADD]: (a, b) => a + b,
    [IR_FLOAT64_SUB]: (a, b) => a - b,
    [IR_FLOAT64_MUL]: (a, b) => a * b,
    [IR_FLOAT64_DIV]: (a, b) => a / b,
  };

  const COMPARE_OPS = {
    "==": (a, b) => a === b,
    "!=": (a, b) => a !== b,
    "loose==": (a, b) => a == b,
    "loose!=": (a, b) => a != b,
    "<": (a, b) => a < b,
    ">": (a, b) => a > b,
    "<=": (a, b) => a <= b,
    ">=": (a, b) => a >= b,
  };

  let foldCount = 0;
  const dead = new Set();

  const replaceInPlace = (node, replacement, block, index) => {
    rewireUses(graph, node, replacement);
    replacement.block = block;
    block.nodes[index] = replacement;
    foldCount++;
  };

  const bypassWith = (node, replacement) => {
    rewireUses(graph, node, replacement);
    dead.add(node);
    foldCount++;
  };

  let changed = true;
  while (changed) {
    changed = false;
    dead.clear();

    for (const block of graph.blocks) {
      for (let i = 0; i < block.nodes.length; i++) {
        const node = block.nodes[i];

        const folder = ARITH_OPS[node.type];
        if (
          folder &&
          node.inputs.length === 2 &&
          node.inputs[0]?.type === IR_CONSTANT &&
          node.inputs[1]?.type === IR_CONSTANT
        ) {
          const a = node.inputs[0].props.value;
          const b = node.inputs[1].props.value;
          if (typeof a === "number" && typeof b === "number") {
            replaceInPlace(node, irConstant(folder(a, b)), block, i);
            changed = true;
            continue;
          }
        }

        if (
          (node.type === IR_INT32_COMPARE ||
            node.type === IR_FLOAT64_COMPARE) &&
          node.inputs.length === 2 &&
          node.inputs[0]?.type === IR_CONSTANT &&
          node.inputs[1]?.type === IR_CONSTANT
        ) {
          const a = node.inputs[0].props.value;
          const b = node.inputs[1].props.value;
          const cmpFn = COMPARE_OPS[node.props.op];
          if (typeof a === "number" && typeof b === "number" && cmpFn) {
            replaceInPlace(node, irConstant(cmpFn(a, b) ? 1 : 0), block, i);
            changed = true;
            continue;
          }
        }

        if (
          node.type === IR_NOT &&
          node.inputs.length === 1 &&
          node.inputs[0]?.type === IR_CONSTANT
        ) {
          replaceInPlace(
            node,
            irConstant(node.inputs[0].props.value ? 0 : 1),
            block,
            i,
          );
          changed = true;
          continue;
        }

        if (
          node.type === IR_NEG &&
          node.inputs.length === 1 &&
          node.inputs[0]?.type === IR_CONSTANT
        ) {
          const val = node.inputs[0].props.value;
          if (typeof val === "number") {
            replaceInPlace(node, irConstant(-val), block, i);
            changed = true;
            continue;
          }
        }

        if (
          (node.type === IR_INT32_ADD || node.type === IR_FLOAT64_ADD) &&
          node.inputs.length === 2
        ) {
          if (
            node.inputs[1]?.type === IR_CONSTANT &&
            node.inputs[1].props.value === 0
          ) {
            bypassWith(node, node.inputs[0]);
            changed = true;
            continue;
          }
          if (
            node.inputs[0]?.type === IR_CONSTANT &&
            node.inputs[0].props.value === 0
          ) {
            bypassWith(node, node.inputs[1]);
            changed = true;
            continue;
          }
        }

        if (
          (node.type === IR_INT32_MUL || node.type === IR_FLOAT64_MUL) &&
          node.inputs.length === 2
        ) {
          if (
            node.inputs[1]?.type === IR_CONSTANT &&
            node.inputs[1].props.value === 1
          ) {
            bypassWith(node, node.inputs[0]);
            changed = true;
            continue;
          }
          if (
            node.inputs[0]?.type === IR_CONSTANT &&
            node.inputs[0].props.value === 1
          ) {
            bypassWith(node, node.inputs[1]);
            changed = true;
            continue;
          }
          if (
            (node.inputs[0]?.type === IR_CONSTANT &&
              node.inputs[0].props.value === 0) ||
            (node.inputs[1]?.type === IR_CONSTANT &&
              node.inputs[1].props.value === 0)
          ) {
            replaceInPlace(node, irConstant(0), block, i);
            changed = true;
            continue;
          }
        }

        if (
          node.type === IR_NEG &&
          node.inputs.length === 1 &&
          node.inputs[0]?.type === IR_NEG
        ) {
          bypassWith(node, node.inputs[0].inputs[0]);
          changed = true;
          continue;
        }

        if (
          node.type === IR_NOT &&
          node.inputs.length === 1 &&
          node.inputs[0]?.type === IR_NOT
        ) {
          bypassWith(node, node.inputs[0].inputs[0]);
          changed = true;
          continue;
        }

        if (
          node.type === IR_GENERIC_ADD &&
          node.inputs.length === 2 &&
          node.inputs[0]?.type === IR_CONSTANT &&
          node.inputs[1]?.type === IR_CONSTANT
        ) {
          const a = node.inputs[0].props.value;
          const b = node.inputs[1].props.value;
          if (typeof a === "string" && typeof b === "string") {
            replaceInPlace(node, irConstant(a + b), block, i);
            tracer.jitCompile(
              graph.name,
              `ConstantFold: string concat "${a}" + "${b}" → "${a + b}"`,
            );
            changed = true;
            continue;
          }
        }
      }

      if (dead.size > 0) {
        block.nodes = block.nodes.filter((n) => !dead.has(n));
        dead.clear();
      }
    }
  }

  return foldCount;
}

export function constantPropagation(graph) {
  let propCount = 0;
  const knownValues = new Map();

  for (const block of graph.blocks) {
    for (const node of block.nodes) {
      if (
        node.type === IR_STORE_LOCAL &&
        node.inputs.length === 1 &&
        node.inputs[0]?.type === IR_CONSTANT
      ) {
        knownValues.set(node.props.slot, node.inputs[0]);
      }

      if (
        node.type === IR_STORE_LOCAL &&
        node.inputs.length === 1 &&
        node.inputs[0]?.type !== IR_CONSTANT
      ) {
        knownValues.delete(node.props.slot);
      }
    }
  }

  for (const block of graph.blocks) {
    const localState = new Map(knownValues);

    for (const node of block.nodes) {
      if (node.type === IR_STORE_LOCAL && node.inputs.length === 1) {
        if (node.inputs[0]?.type === IR_CONSTANT) {
          localState.set(node.props.slot, node.inputs[0]);
        } else {
          localState.delete(node.props.slot);
        }
        continue;
      }

      if (node.type === IR_LOAD_LOCAL) {
        const known = localState.get(node.props.slot);
        if (known && known.type === IR_CONSTANT) {
          rewireUses(graph, node, known);
          propCount++;
        }
        continue;
      }

      for (let k = 0; k < node.inputs.length; k++) {
        const inp = node.inputs[k];
        if (
          inp &&
          inp.type === IR_CHECK_SMI &&
          inp.inputs[0]?.type === IR_CONSTANT
        ) {
          const val = inp.inputs[0].props.value;
          if (
            typeof val === "number" &&
            Number.isInteger(val) &&
            val === (val | 0)
          ) {
            const replacement = inp.inputs[0];
            node.inputs[k] = replacement;
            replacement.uses.push(node);
            inp.uses = inp.uses.filter((u) => u !== node);
            propCount++;
          }
        }
        if (
          inp &&
          inp.type === IR_CHECK_NUMBER &&
          inp.inputs[0]?.type === IR_CONSTANT
        ) {
          const val = inp.inputs[0].props.value;
          if (typeof val === "number") {
            const replacement = inp.inputs[0];
            node.inputs[k] = replacement;
            replacement.uses.push(node);
            inp.uses = inp.uses.filter((u) => u !== node);
            propCount++;
          }
        }
      }
    }
  }

  return propCount;
}

export function strengthReduction(graph) {
  let count = 0;

  function isPowerOf2(n) {
    return (
      typeof n === "number" &&
      Number.isInteger(n) &&
      n > 0 &&
      (n & (n - 1)) === 0
    );
  }

  function log2(n) {
    let p = 0;
    while (1 << p < n) p++;
    return p;
  }

  function decomposeMultiplier(c) {
    if (typeof c !== "number" || !Number.isInteger(c) || c <= 1) return null;
    if (isPowerOf2(c)) return null;

    const cMinus1 = c - 1;
    if (cMinus1 > 0 && isPowerOf2(cMinus1)) {
      return { shift: log2(cMinus1), op: "add" };
    }

    const cPlus1 = c + 1;
    if (cPlus1 > 0 && isPowerOf2(cPlus1)) {
      return { shift: log2(cPlus1), op: "sub" };
    }

    return null;
  }

  const replaceInPlace = (node, replacement, block, index) => {
    rewireUses(graph, node, replacement);
    replacement.block = block;
    block.nodes[index] = replacement;
  };

  const replaceWithSequence = (node, sequence, block, index) => {
    const replacement = sequence[sequence.length - 1];
    rewireUses(graph, node, replacement);
    for (const item of sequence) item.block = block;
    block.nodes.splice(index, 1, ...sequence);
  };

  for (const block of graph.blocks) {
    for (let i = 0; i < block.nodes.length; i++) {
      const node = block.nodes[i];

      if (node.type === IR_INT32_MUL && node.inputs.length === 2) {
        let constInput = null;
        let otherInput = null;
        if (node.inputs[1]?.type === IR_CONSTANT) {
          constInput = node.inputs[1];
          otherInput = node.inputs[0];
        } else if (node.inputs[0]?.type === IR_CONSTANT) {
          constInput = node.inputs[0];
          otherInput = node.inputs[1];
        }

        if (constInput) {
          const c = constInput.props.value;

          if (isPowerOf2(c)) {
            const shift = log2(c);
            if (shift > 0 && shift < 31) {
              const shlNode = irInt32Shl(otherInput, irConstant(shift));
              shlNode.frameState = node.frameState;
              replaceInPlace(node, shlNode, block, i);
              tracer.jitCompile(
                graph.name,
                `StrengthReduce: v${node.id} Int32Mul * ${c} → Int32Shl by ${shift}`,
              );
              count++;
              continue;
            }
          }

          const decomp = decomposeMultiplier(c);
          if (decomp && decomp.shift > 0 && decomp.shift < 31) {
            const shifted = irInt32Shl(otherInput, irConstant(decomp.shift));
            let result;
            if (decomp.op === "add") {
              result = irInt32Add(shifted, otherInput);
            } else {
              result = irInt32Sub(shifted, otherInput);
            }
            result.frameState = node.frameState;
            replaceWithSequence(node, [shifted, result], block, i);
            tracer.jitCompile(
              graph.name,
              `StrengthReduce: v${node.id} Int32Mul * ${c} → (x << ${decomp.shift}) ${decomp.op === "add" ? "+" : "-"} x`,
            );
            count++;
            continue;
          }
        }
      }

      if (node.type === IR_INT32_DIV && node.inputs.length === 2) {
        if (node.inputs[1]?.type === IR_CONSTANT) {
          const divisor = node.inputs[1].props.value;
          if (isPowerOf2(divisor)) {
            const shift = log2(divisor);
            if (shift > 0 && shift < 31) {
              const shrNode = irInt32Shr(node.inputs[0], irConstant(shift));
              shrNode.frameState = node.frameState;
              replaceInPlace(node, shrNode, block, i);
              tracer.jitCompile(
                graph.name,
                `StrengthReduce: v${node.id} Int32Div / ${divisor} → Int32Shr by ${shift}`,
              );
              count++;
            }
          }
        }
      }

      if (node.type === IR_INT32_MOD && node.inputs.length === 2) {
        if (node.inputs[1]?.type === IR_CONSTANT) {
          const divisor = node.inputs[1].props.value;
          if (isPowerOf2(divisor)) {
            const andNode = irInt32And(node.inputs[0], irConstant(divisor - 1));
            andNode.frameState = node.frameState;
            replaceInPlace(node, andNode, block, i);
            tracer.jitCompile(
              graph.name,
              `StrengthReduce: v${node.id} Int32Mod % ${divisor} → Int32And ${divisor - 1}`,
            );
            count++;
          }
        }
      }

      if (
        node.type === IR_INT32_SUB &&
        node.inputs.length === 2 &&
        node.inputs[0] === node.inputs[1]
      ) {
        const result = irConstant(0);
        replaceInPlace(node, result, block, i);
        count++;
      }
    }
  }

  return count;
}
