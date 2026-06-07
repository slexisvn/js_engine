import * as ir from "../ir/index.js";

import { RegisterFrame } from "../../bytecode/register/interpreter/index.js";
import {
  isSmi,
  isDouble,
  isNumber,
  isObject,
  isBool,
  isArray,
  isString,
  isFunction,
  isNull,
  isUndefined,
  mkSmi,
  mkDouble,
  mkNumber,
  mkBool,
  mkString,
  mkNull,
  mkObject,
  mkFunction,
  JSFunction,
  mkArray,
  mkUndefined,
  mkRegex,
  toNumber,
  toBool,
  toDisplayString,
  typeOf,
  TAG_SMI,
  TAG_DOUBLE,
  getPayload,
  getTag,
  strictEqual,
  isTaggedValue,
} from "../../core/value/index.js";
import {
  DeoptSignal,
  DEOPT_ARRAY_CHECK_FAILED,
  DEOPT_BOUNDS_CHECK_FAILED,
  DEOPT_DIVISION_BY_ZERO,
  DEOPT_ELEMENTS_KIND_CHECK_FAILED,
  DEOPT_GUARD_FAILURE,
  DEOPT_MAP_CHECK_FAILED,
  DEOPT_NUMBER_CHECK_FAILED,
  DEOPT_OVERFLOW,
  DEOPT_RUNTIME_STUB_FAILURE,
  DEOPT_SMI_CHECK_FAILED,
  DEOPT_WRONG_CALL_TARGET,
} from "../../deopt/deoptimizer.js";
import { tracer } from "../../core/tracing/index.js";
import {
  runtimeGetProperty as proxyRuntimeGetProperty,
  runtimeSetProperty as proxyRuntimeSetProperty,
  runtimeHasProperty as proxyRuntimeHasProperty,
} from "../../objects/exotic/proxy-ops.js";
import {
  PACKED_SMI,
  PACKED_DOUBLE,
  HOLEY_SMI,
  HOLEY_DOUBLE,
  PACKED_TAGGED,
  HOLEY_TAGGED,
} from "../../objects/elements/elements-kind.js";
import { createJSObject, createJSArray } from "../../objects/heap/factory.js";
import { getHiddenClassById } from "../../objects/maps/hidden-class.js";
import { dependencyRegistry } from "../../deopt/dependencies.js";
import {
  REP_INT32,
  REP_FLOAT64,
  REP_TAGGED_NUMBER,
  REP_HANDLE,
  REP_BOOL,
} from "../passes/repr-selection.js";
import { validateOptimizedGraph } from "../validation/graph-validator.js";
import * as wasmFormat from "./wasm-format.js";
import { elementsKindId } from "./object-layout.js";
import {
  RUNTIME_STUB_NODES,
  VALUE_PRODUCING,
  INT32_ARITH,
  FLOAT64_ARITH,
  INT32_OVERFLOW_CHECK,
  COMPARE_OPS,
  INT32_ARITH_OPCODES,
  INT64_ARITH_OPCODES,
  FLOAT64_ARITH_OPCODES,
  RuntimeStubTable,
  repForNode,
  wasmTypeForRep,
  valueRepForRep,
  compileRejectionForNode,
  computeBlockOrder,
  findBackEdges,
  findLoopHeaders,
  findLoopBlocks,
  buildRegions,
} from "./graph-support.js";
import {
  deoptReasonId,
  deoptReasonFromId,
  deoptReasonForNode,
  materializeFrameFromState,
  resumeFrameStateChain,
} from "./deopt-frame.js";
import {
  executeRuntimeStub,
  serializeObject,
  deserializeObject,
} from "./runtime-support.js";

const threadLocal = {
  currentObjPtrs: null,
  currentRuntime: null,
};

const MAX_WASM_CALL_DEPTH = 1000;
let wasmCallDepth = 0;

export class WasmCodegen {
  failAnalysis(node, reason) {
    const blockId = node.block ? node.block.id : -1;
    this.lastAnalysisFailure = `block ${blockId} instruction ${node.id} ${node.type}: ${reason}`;
    return null;
  }

  compileRejection(graph) {
    if (!graph || !Array.isArray(graph.blocks))
      return "graph is missing blocks";
    if (graph.blocks.length === 0) return "graph has no blocks";
    let hasReturn = false;
    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        const nodeRejection = compileRejectionForNode(node, block);
        if (nodeRejection) return nodeRejection;
        if (node.type === ir.IR_RETURN) hasReturn = true;
      }
    }
    if (!hasReturn) return "graph has no return";
    return null;
  }

  canCompile(graph) {
    this.lastCompileRejection = this.compileRejection(graph);
    return this.lastCompileRejection === null;
  }

  analyzeGraph(graph) {
    const nodeWasmType = new Map();
    const nodeLocal = new Map();
    const localAlias = new Map();
    const nodeValueRep = new Map();
    const runtimeStubTable = new RuntimeStubTable();

    let needsMemory = false;
    let needsDeoptImport = false;
    let needsRuntimeStubImport = false;
    let needsAllocObjImport = false;
    const allocObjNodes = [];
    const entryGuards = [];
    const phiNodes = [];

    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        if (VALUE_PRODUCING.has(node.type)) {
          nodeValueRep.set(node.id, valueRepForRep(repForNode(node)));
        }
        if (
          node.type === ir.IR_NEW_OBJECT &&
          node.props.targetHiddenClassId != null
        ) {
          if (node.props.targetSlotCount != null) {
            needsMemory = true;
          } else {
            needsAllocObjImport = true;
          }
          needsMemory = true;
          nodeWasmType.set(node.id, wasmFormat.TYPE_I32);
          allocObjNodes.push(node);
          continue;
        }
        if (this.needsFieldRuntimeStub(node)) {
          runtimeStubTable.register(node);
          needsRuntimeStubImport = true;
          needsMemory = true;
          nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
          continue;
        }
        if (RUNTIME_STUB_NODES.has(node.type)) {
          runtimeStubTable.register(node);
          needsRuntimeStubImport = true;
          needsMemory = true;
          nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
          continue;
        }
        switch (node.type) {
          case ir.IR_INT32_ADD:
          case ir.IR_INT32_SUB:
          case ir.IR_INT32_MUL:
          case ir.IR_INT32_DIV:
          case ir.IR_INT32_MOD:
          case ir.IR_INT32_COMPARE:
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            break;
          case ir.IR_FLOAT64_ADD:
          case ir.IR_FLOAT64_SUB:
          case ir.IR_FLOAT64_MUL:
          case ir.IR_FLOAT64_DIV:
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            break;
          case ir.IR_FLOAT64_COMPARE:
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            break;
          case ir.IR_LOAD_FIELD:
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            needsMemory = true;
            break;
          case ir.IR_POLYMORPHIC_LOAD:
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            needsMemory = true;
            needsDeoptImport = true;
            break;
          case ir.IR_LOAD_ARRAY_LENGTH:
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            needsMemory = true;
            break;
          case ir.IR_LOAD_ELEMENT:
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            needsMemory = true;
            break;
          case ir.IR_STORE_ELEMENT:
            needsMemory = true;
            break;
          case ir.IR_STORE_FIELD:
            needsMemory = true;
            break;
          case ir.IR_CHECK_MAP:
            needsMemory = true;
            needsDeoptImport = true;
            break;
          case ir.IR_CHECK_ELEMENTS_KIND:
            needsMemory = true;
            needsDeoptImport = true;
            break;
          case ir.IR_CHECK_SMI:
          case ir.IR_CHECK_NUMBER:
            needsDeoptImport = true;
            break;
          case ir.IR_POLYMORPHIC_STORE:
            needsMemory = true;
            needsDeoptImport = true;
            break;
          case ir.IR_DEOPTIMIZE:
            needsDeoptImport = true;
            break;
          case ir.IR_CONSTANT: {
            const v = node.props.value;
            if (typeof v === "boolean" || typeof v === "number") {
              nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            } else {
              nodeWasmType.set(node.id, wasmFormat.TYPE_I32);
              needsMemory = true;
              if (!this._nonPrimitiveConstants)
                this._nonPrimitiveConstants = [];
              this._nonPrimitiveConstants.push(node);
            }
            break;
          }
          case ir.IR_LOAD_LOCAL: {
            nodeWasmType.set(node.id, wasmFormat.TYPE_F64);
            break;
          }
          case ir.IR_STORE_LOCAL: {
            break;
          }
          case ir.IR_LOAD_CONST: {
            nodeWasmType.set(node.id, wasmFormat.TYPE_I32);
            needsMemory = true;
            if (!this._nonPrimitiveConstants) this._nonPrimitiveConstants = [];
            this._nonPrimitiveConstants.push(node);
            break;
          }
          case ir.IR_BOX: {
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            break;
          }
          case ir.IR_UNBOX: {
            nodeWasmType.set(node.id, wasmTypeForRep(repForNode(node)));
            break;
          }
          case ir.IR_PHI: {
            phiNodes.push(node);
            break;
          }
        }
      }
    }

    if (INT32_OVERFLOW_CHECK.size > 0) {
      for (const block of graph.blocks) {
        for (const node of block.nodes) {
          if (INT32_OVERFLOW_CHECK.has(node.type)) {
            needsDeoptImport = true;
          }
        }
      }
    }

    for (const param of graph.parameters) {
      let type = null;
      for (const use of param.uses) {
        if (use.type === ir.IR_CHECK_SMI || use.type === ir.IR_CHECK_NUMBER)
          type = type || wasmTypeForRep(repForNode(use));
        else if (
          use.type === ir.IR_CHECK_MAP ||
          use.type === ir.IR_CHECK_ARRAY ||
          use.type === ir.IR_CHECK_ELEMENTS_KIND
        ) {
          type = wasmFormat.TYPE_I32;
          needsMemory = true;
        } else if (
          INT32_ARITH.has(use.type) ||
          use.type === ir.IR_INT32_COMPARE
        )
          type = type || wasmFormat.TYPE_I32;
        else if (
          FLOAT64_ARITH.has(use.type) ||
          use.type === ir.IR_FLOAT64_COMPARE
        )
          type = type || wasmFormat.TYPE_F64;
        else if (
          use.type === ir.IR_GENERIC_ADD ||
          use.type === ir.IR_GENERIC_SUB ||
          use.type === ir.IR_GENERIC_MUL ||
          use.type === ir.IR_GENERIC_DIV ||
          use.type === ir.IR_GENERIC_MOD ||
          use.type === ir.IR_GENERIC_COMPARE ||
          use.type === ir.IR_NEG
        ) {
          type = type || wasmFormat.TYPE_F64;
          needsMemory = true;
        } else if (RUNTIME_STUB_NODES.has(use.type)) {
          type = type || wasmTypeForRep(repForNode(param));
          needsMemory = true;
        }
      }
      if (type === null) type = wasmTypeForRep(repForNode(param));
      nodeWasmType.set(param.id, type);
      nodeValueRep.set(param.id, valueRepForRep(repForNode(param)));
    }

    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        if (node.type === ir.IR_CHECK_SMI || node.type === ir.IR_CHECK_NUMBER) {
          const inputType = nodeWasmType.get(node.inputs[0]?.id);
          nodeWasmType.set(node.id, inputType || wasmFormat.TYPE_I32);
          localAlias.set(node.id, node.inputs[0]?.id);
          entryGuards.push(node);
        } else if (
          node.type === ir.IR_CHECK_MAP ||
          node.type === ir.IR_CHECK_ARRAY ||
          node.type === ir.IR_CHECK_ELEMENTS_KIND
        ) {
          const inputType = nodeWasmType.get(node.inputs[0]?.id);
          nodeWasmType.set(node.id, inputType || wasmFormat.TYPE_I32);
          localAlias.set(node.id, node.inputs[0]?.id);
        } else if (node.type === ir.IR_CHECK_BOUNDS) {
          const inputType = nodeWasmType.get(node.inputs[0]?.id);
          nodeWasmType.set(node.id, inputType || wasmFormat.TYPE_I32);
          localAlias.set(node.id, node.inputs[0]?.id);
        }
      }
    }

    for (const phi of phiNodes) {
      let resolvedType = null;
      for (const inp of phi.inputs) {
        const t = nodeWasmType.get(inp.id);
        if (t !== undefined) {
          if (resolvedType === null) {
            resolvedType = t;
          } else if (resolvedType !== t) {
            resolvedType = wasmFormat.TYPE_F64;
          }
        }
      }
      nodeWasmType.set(phi.id, resolvedType || wasmFormat.TYPE_I32);
    }

    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        if (
          node.type === ir.IR_CHECK_SMI ||
          node.type === ir.IR_CHECK_NUMBER ||
          node.type === ir.IR_CHECK_MAP ||
          node.type === ir.IR_CHECK_ARRAY ||
          node.type === ir.IR_CHECK_ELEMENTS_KIND ||
          node.type === ir.IR_CHECK_BOUNDS
        ) {
          const inputType = nodeWasmType.get(node.inputs[0]?.id);
          if (inputType) nodeWasmType.set(node.id, inputType);
        }
      }
    }

    const paramTypes = [];
    const paramValueReps = [];
    for (const param of graph.parameters) {
      const pType = nodeWasmType.get(param.id) || wasmFormat.TYPE_I32;
      const pValueRep =
        nodeValueRep.get(param.id) || valueRepForRep(repForNode(param));
      paramTypes.push(pType);
      paramValueReps.push(pValueRep);
      if (pValueRep === REP_HANDLE) needsMemory = true;
      nodeLocal.set(param.id, param.props.index);
    }

    const localNodesI32 = [];
    const localNodesF64 = [];

    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        if (!VALUE_PRODUCING.has(node.type)) continue;
        if (node.type === ir.IR_PARAMETER) continue;
        if (localAlias.has(node.id)) continue;

        const wType = nodeWasmType.get(node.id) || wasmFormat.TYPE_I32;
        if (wType === wasmFormat.TYPE_I32) localNodesI32.push(node.id);
        else localNodesF64.push(node.id);
      }
    }

    let nextLocal = graph.parameterCount;
    for (const id of localNodesI32) {
      nodeLocal.set(id, nextLocal++);
    }
    for (const id of localNodesF64) {
      nodeLocal.set(id, nextLocal++);
    }

    const additionalLocalTypes = {
      [wasmFormat.TYPE_I32]: localNodesI32.length,
      [wasmFormat.TYPE_F64]: localNodesF64.length,
    };

    let overflowTempLocal = -1;
    let hasOverflowChecks = false;
    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        if (INT32_OVERFLOW_CHECK.has(node.type)) {
          hasOverflowChecks = true;
          break;
        }
      }
      if (hasOverflowChecks) break;
    }

    if (hasOverflowChecks) {
      overflowTempLocal = nextLocal;
      nextLocal++;
    }

    let _allocTempLocal = -1;
    let hasInlineAlloc = false;
    for (const n of allocObjNodes) {
      if (n.props.targetSlotCount != null) {
        hasInlineAlloc = true;
        break;
      }
    }
    if (hasInlineAlloc) {
      _allocTempLocal = nextLocal;
      nextLocal++;
    }

    const phiUpdateTempLocal = new Map();
    let phiUpdateTempI32Count = 0;
    let phiUpdateTempF64Count = 0;
    for (const phi of phiNodes) {
      const phiType = nodeWasmType.get(phi.id) || wasmFormat.TYPE_I32;
      if (phiType === wasmFormat.TYPE_I32) {
        phiUpdateTempLocal.set(phi.id, nextLocal++);
        phiUpdateTempI32Count++;
      }
    }
    for (const phi of phiNodes) {
      const phiType = nodeWasmType.get(phi.id) || wasmFormat.TYPE_I32;
      if (phiType === wasmFormat.TYPE_F64) {
        phiUpdateTempLocal.set(phi.id, nextLocal++);
        phiUpdateTempF64Count++;
      }
    }

    const additionalLocals = [];
    if (additionalLocalTypes[wasmFormat.TYPE_I32] > 0) {
      additionalLocals.push({
        count: additionalLocalTypes[wasmFormat.TYPE_I32],
        type: wasmFormat.TYPE_I32,
      });
    }
    if (additionalLocalTypes[wasmFormat.TYPE_F64] > 0) {
      additionalLocals.push({
        count: additionalLocalTypes[wasmFormat.TYPE_F64],
        type: wasmFormat.TYPE_F64,
      });
    }
    if (hasOverflowChecks) {
      additionalLocals.push({ count: 1, type: wasmFormat.TYPE_I64 });
    }
    if (hasInlineAlloc) {
      additionalLocals.push({ count: 1, type: wasmFormat.TYPE_I32 });
    }
    if (phiUpdateTempI32Count > 0) {
      additionalLocals.push({
        count: phiUpdateTempI32Count,
        type: wasmFormat.TYPE_I32,
      });
    }
    if (phiUpdateTempF64Count > 0) {
      additionalLocals.push({
        count: phiUpdateTempF64Count,
        type: wasmFormat.TYPE_F64,
      });
    }

    let resultType = wasmFormat.TYPE_I32;
    let resultValueRep = null;
    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        if (node.type === ir.IR_RETURN && node.inputs[0]) {
          const rt = nodeWasmType.get(node.inputs[0].id);
          if (rt) resultType = rt;
          resultValueRep = nodeValueRep.get(node.inputs[0].id) || null;
        }
      }
    }

    if (needsDeoptImport) {
      needsMemory = true;
    }
    if (needsRuntimeStubImport) {
      needsMemory = true;
    }

    const _localSlotMap = new Map();
    let _localSlotNextLocal = nextLocal;
    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        if (node.type === ir.IR_LOAD_LOCAL || node.type === ir.IR_STORE_LOCAL) {
          const slot = node.props.slot;
          if (!_localSlotMap.has(slot)) {
            _localSlotMap.set(slot, _localSlotNextLocal++);
          }
        }
      }
    }
    if (_localSlotMap.size > 0) {
      additionalLocals.push({
        count: _localSlotMap.size,
        type: wasmFormat.TYPE_F64,
      });
    }

    const _nonPrimitiveConstants = this._nonPrimitiveConstants || [];
    this._nonPrimitiveConstants = null;

    return {
      paramTypes,
      paramValueReps,
      resultType,
      additionalLocals,
      nodeWasmType,
      nodeLocal,
      localAlias,
      nodeValueRep,
      needsMemory,
      needsDeoptImport,
      entryGuards,
      needsRuntimeStubImport,
      runtimeStubTable,
      resultValueRep,
      needsAllocObjImport,
      allocObjNodes,
      phiNodes,
      phiUpdateTempLocal,
      overflowTempLocal,
      hasOverflowChecks,
      _allocTempLocal,
      hasInlineAlloc,
      _localSlotMap,
      _nonPrimitiveConstants,
    };
  }

  resolveLocal(nodeId, analysis) {
    if (analysis.localAlias.has(nodeId)) {
      return this.resolveLocal(analysis.localAlias.get(nodeId), analysis);
    }
    return analysis.nodeLocal.get(nodeId);
  }

  generateBody(
    graph,
    analysis,
    deoptImportIdx,
    runtimeStubImportIdx,
    allocObjImportIdx,
  ) {
    const bytes = [];
    const order = computeBlockOrder(graph);
    const backEdges = findBackEdges(graph, order);
    const loopHeaders = findLoopHeaders(backEdges);

    if (order.length === 1) {
      const block = order[0];
      for (const node of block.nodes) {
        this.emitNode(
          node,
          analysis,
          bytes,
          deoptImportIdx,
          runtimeStubImportIdx,
          allocObjImportIdx,
        );
      }
      return bytes;
    }

    const blockMap = new Map();
    for (const block of graph.blocks) {
      blockMap.set(block.id, block);
    }

    const orderIndex = new Map();
    for (let i = 0; i < order.length; i++) {
      orderIndex.set(order[i].id, i);
    }

    const loopInfoMap = new Map();
    for (const headerId of loopHeaders) {
      const header = blockMap.get(headerId);
      const loopBlocks = findLoopBlocks(header, backEdges, graph.blocks);
      let exitBlockId = null;
      for (const lbId of loopBlocks) {
        const lb = blockMap.get(lbId);
        if (!lb) continue;
        for (const succ of lb.successors) {
          if (!loopBlocks.has(succ.id)) {
            exitBlockId = succ.id;
            break;
          }
        }
        if (exitBlockId !== null) break;
      }
      loopInfoMap.set(headerId, { loopBlocks, exitBlockId });
    }

    const labelStack = [];
    const emitted = new Set();

    const emitPhiUpdates = (targetBlockId, predecessor = null) => {
      const targetBlock = blockMap.get(targetBlockId);
      if (!targetBlock) return;
      const edgeArgs =
        predecessor && typeof predecessor.getEdgeArgs === "function"
          ? predecessor.getEdgeArgs(targetBlock)
          : null;
      const pending = [];
      for (const node of targetBlock.nodes) {
        if (node.type !== ir.IR_PHI) break;
        const phiLocal = analysis.nodeLocal.get(node.id);
        const tempLocal = analysis.phiUpdateTempLocal?.get(node.id);
        if (phiLocal === undefined) continue;
        if (tempLocal === undefined) continue;
        const input =
          edgeArgs && edgeArgs.length > node.props.index
            ? edgeArgs[node.props.index]
            : node.inputs.length > 1
              ? node.inputs[1]
              : node.inputs[0];
        if (!input) continue;
        const inputLocal = this.resolveLocal(input.id, analysis);
        if (inputLocal === undefined) continue;
        const inputType = analysis.nodeWasmType.get(input.id);
        const phiType = analysis.nodeWasmType.get(node.id);
        pending.push({ phiLocal, tempLocal, inputLocal, inputType, phiType });
      }
      for (const update of pending) {
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(update.inputLocal),
        );
        if (
          update.phiType === wasmFormat.TYPE_F64 &&
          update.inputType === wasmFormat.TYPE_I32
        ) {
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        } else if (
          update.phiType === wasmFormat.TYPE_I32 &&
          update.inputType === wasmFormat.TYPE_F64
        ) {
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        }
        bytes.push(
          wasmFormat.OP_LOCAL_SET,
          ...wasmFormat.encodeU32(update.tempLocal),
        );
      }
      for (const update of pending) {
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(update.tempLocal),
        );
        bytes.push(
          wasmFormat.OP_LOCAL_SET,
          ...wasmFormat.encodeU32(update.phiLocal),
        );
      }
    };

    const emitBlockNodes = (block, options = {}) => {
      for (const node of block.nodes) {
        if (node.type === ir.IR_JUMP) {
          const targetId = node.props.targetBlock;
          if (options.stopBeforeTargets?.has(targetId)) {
            emitPhiUpdates(targetId, block);
            return;
          }
          if (loopHeaders.has(targetId)) {
            const loopLabelIdx = this.findLabelDepth(
              labelStack,
              "loop",
              targetId,
            );
            if (loopLabelIdx >= 0) {
              emitPhiUpdates(targetId, block);
              bytes.push(
                wasmFormat.OP_BR,
                ...wasmFormat.encodeU32(loopLabelIdx),
              );
              return;
            }
          }
          const blockLabelIdx = this.findLabelDepth(
            labelStack,
            "block",
            targetId,
          );
          if (blockLabelIdx >= 0) {
            emitPhiUpdates(targetId, block);
            bytes.push(
              wasmFormat.OP_BR,
              ...wasmFormat.encodeU32(blockLabelIdx),
            );
            return;
          }
          if (!emitted.has(targetId) && blockMap.has(targetId)) {
            emitPhiUpdates(targetId, block);
            emitRegion(blockMap.get(targetId));
          }
          return;
        }

        if (node.type === ir.IR_BRANCH) {
          const condLocal = this.resolveLocal(node.inputs[0].id, analysis);
          const trueBlockId = node.props.trueBlock;
          const falseBlockId = node.props.falseBlock;

          const trueIsBackEdge =
            loopHeaders.has(trueBlockId) &&
            this.findLabelDepth(labelStack, "loop", trueBlockId) >= 0;
          const falseIsBackEdge =
            loopHeaders.has(falseBlockId) &&
            this.findLabelDepth(labelStack, "loop", falseBlockId) >= 0;

          if (trueIsBackEdge) {
            const loopDepth = this.findLabelDepth(
              labelStack,
              "loop",
              trueBlockId,
            );
            emitPhiUpdates(trueBlockId, block);
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(condLocal),
            );
            bytes.push(wasmFormat.OP_BR_IF, ...wasmFormat.encodeU32(loopDepth));
            if (!emitted.has(falseBlockId) && blockMap.has(falseBlockId)) {
              emitRegion(blockMap.get(falseBlockId));
            } else {
              const exitDepth = this.findLabelDepth(
                labelStack,
                "block",
                falseBlockId,
              );
              if (exitDepth >= 0) {
                bytes.push(
                  wasmFormat.OP_BR,
                  ...wasmFormat.encodeU32(exitDepth),
                );
              }
            }
            return;
          }

          if (falseIsBackEdge) {
            const loopDepth = this.findLabelDepth(
              labelStack,
              "loop",
              falseBlockId,
            );
            emitPhiUpdates(falseBlockId, block);
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(condLocal),
            );
            bytes.push(wasmFormat.OP_I32_EQZ);
            bytes.push(wasmFormat.OP_BR_IF, ...wasmFormat.encodeU32(loopDepth));
            if (!emitted.has(trueBlockId) && blockMap.has(trueBlockId)) {
              emitRegion(blockMap.get(trueBlockId));
            } else {
              const exitDepth = this.findLabelDepth(
                labelStack,
                "block",
                trueBlockId,
              );
              if (exitDepth >= 0) {
                bytes.push(
                  wasmFormat.OP_BR,
                  ...wasmFormat.encodeU32(exitDepth),
                );
              }
            }
            return;
          }

          const trueExitLabel = this.findLabelDepth(
            labelStack,
            "block",
            trueBlockId,
          );
          const falseExitLabel = this.findLabelDepth(
            labelStack,
            "block",
            falseBlockId,
          );

          if (trueExitLabel >= 0 && falseExitLabel >= 0) {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(condLocal),
            );
            bytes.push(
              wasmFormat.OP_BR_IF,
              ...wasmFormat.encodeU32(trueExitLabel),
            );
            bytes.push(
              wasmFormat.OP_BR,
              ...wasmFormat.encodeU32(falseExitLabel),
            );
            return;
          }

          const trueBlock = blockMap.get(trueBlockId);
          const falseBlock = blockMap.get(falseBlockId);
          const trueJoinId =
            trueBlock && trueBlock.successors.length === 1
              ? trueBlock.successors[0].id
              : null;
          const falseJoinId =
            falseBlock && falseBlock.successors.length === 1
              ? falseBlock.successors[0].id
              : null;
          const mergeBlockId =
            trueJoinId !== null && trueJoinId === falseJoinId
              ? trueJoinId
              : this.findMergeBlock(
                  trueBlockId,
                  falseBlockId,
                  blockMap,
                  orderIndex,
                );

          if (trueJoinId === falseBlockId) {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(condLocal),
            );
            bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
            labelStack.push({ type: "if", targetId: null });
            if (blockMap.has(trueBlockId) && !emitted.has(trueBlockId)) {
              emitRegion(blockMap.get(trueBlockId), {
                stopBeforeTargets: new Set([falseBlockId]),
              });
            }
            bytes.push(wasmFormat.OP_ELSE);
            emitPhiUpdates(falseBlockId, block);
            bytes.push(wasmFormat.OP_END);
            labelStack.pop();
            if (blockMap.has(falseBlockId) && !emitted.has(falseBlockId)) {
              emitRegion(blockMap.get(falseBlockId));
            }
          } else if (falseJoinId === trueBlockId) {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(condLocal),
            );
            bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
            labelStack.push({ type: "if", targetId: null });
            emitPhiUpdates(trueBlockId, block);
            bytes.push(wasmFormat.OP_ELSE);
            if (blockMap.has(falseBlockId) && !emitted.has(falseBlockId)) {
              emitRegion(blockMap.get(falseBlockId), {
                stopBeforeTargets: new Set([trueBlockId]),
              });
            }
            bytes.push(wasmFormat.OP_END);
            labelStack.pop();
            if (blockMap.has(trueBlockId) && !emitted.has(trueBlockId)) {
              emitRegion(blockMap.get(trueBlockId));
            }
          } else if (mergeBlockId !== null) {
            labelStack.push({ type: "block", targetId: mergeBlockId });
            bytes.push(wasmFormat.OP_BLOCK, wasmFormat.TYPE_VOID);

            labelStack.push({ type: "block", targetId: falseBlockId });
            bytes.push(wasmFormat.OP_BLOCK, wasmFormat.TYPE_VOID);

            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(condLocal),
            );
            bytes.push(wasmFormat.OP_BR_IF, ...wasmFormat.encodeU32(0));

            if (blockMap.has(falseBlockId) && !emitted.has(falseBlockId)) {
              emitRegion(blockMap.get(falseBlockId));
            }
            bytes.push(wasmFormat.OP_BR, ...wasmFormat.encodeU32(1));

            bytes.push(wasmFormat.OP_END);
            labelStack.pop();

            if (blockMap.has(trueBlockId) && !emitted.has(trueBlockId)) {
              emitRegion(blockMap.get(trueBlockId));
            }

            bytes.push(wasmFormat.OP_END);
            labelStack.pop();

            if (blockMap.has(mergeBlockId) && !emitted.has(mergeBlockId)) {
              emitRegion(blockMap.get(mergeBlockId));
            }
          } else {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(condLocal),
            );
            bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
            labelStack.push({ type: "if", targetId: null });
            if (blockMap.has(trueBlockId) && !emitted.has(trueBlockId)) {
              emitRegion(blockMap.get(trueBlockId));
            }
            bytes.push(wasmFormat.OP_ELSE);
            if (blockMap.has(falseBlockId) && !emitted.has(falseBlockId)) {
              emitRegion(blockMap.get(falseBlockId));
            }
            bytes.push(wasmFormat.OP_END);
            labelStack.pop();
          }
          return;
        }
        this.emitNode(
          node,
          analysis,
          bytes,
          deoptImportIdx,
          runtimeStubImportIdx,
          allocObjImportIdx,
        );
      }
    };

    const emitRegion = (block, options = {}) => {
      if (emitted.has(block.id)) return;

      if (loopHeaders.has(block.id)) {
        const { loopBlocks, exitBlockId } = loopInfoMap.get(block.id);

        for (const node of block.nodes) {
          if (node.type !== ir.IR_PHI) break;
          const loc = analysis.nodeLocal.get(node.id);
          if (loc === undefined) continue;
          if (node.inputs.length > 0) {
            const firstInput = node.inputs[0];
            const inputLocal = this.resolveLocal(firstInput.id, analysis);
            if (inputLocal !== undefined) {
              const inputType = analysis.nodeWasmType.get(firstInput.id);
              const phiType = analysis.nodeWasmType.get(node.id);
              bytes.push(
                wasmFormat.OP_LOCAL_GET,
                ...wasmFormat.encodeU32(inputLocal),
              );
              if (
                phiType === wasmFormat.TYPE_F64 &&
                inputType === wasmFormat.TYPE_I32
              ) {
                bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
              } else if (
                phiType === wasmFormat.TYPE_I32 &&
                inputType === wasmFormat.TYPE_F64
              ) {
                bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
              }
              bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
            }
          }
        }

        if (exitBlockId !== null) {
          labelStack.push({ type: "block", targetId: exitBlockId });
          bytes.push(wasmFormat.OP_BLOCK, wasmFormat.TYPE_VOID);
        }

        labelStack.push({ type: "loop", targetId: block.id });
        bytes.push(wasmFormat.OP_LOOP, wasmFormat.TYPE_VOID);

        const loopOrder = order.filter(
          (b) => loopBlocks.has(b.id) && !emitted.has(b.id),
        );
        for (const lb of loopOrder) {
          if (emitted.has(lb.id)) continue;
          emitted.add(lb.id);
          emitBlockNodes(lb);
        }

        bytes.push(wasmFormat.OP_END);
        labelStack.pop();

        if (exitBlockId !== null) {
          bytes.push(wasmFormat.OP_END);
          labelStack.pop();

          if (blockMap.has(exitBlockId) && !emitted.has(exitBlockId)) {
            emitRegion(blockMap.get(exitBlockId));
          }
        }
      } else {
        emitted.add(block.id);
        emitBlockNodes(block, options);
      }
    };

    for (const block of order) {
      if (!emitted.has(block.id)) {
        emitRegion(block);
      }
    }

    if (order.length > 1) {
      bytes.push(wasmFormat.OP_UNREACHABLE);
    }

    return bytes;
  }

  findLabelDepth(labelStack, type, targetId) {
    for (let i = labelStack.length - 1; i >= 0; i--) {
      if (labelStack[i].type === type && labelStack[i].targetId === targetId) {
        return labelStack.length - 1 - i;
      }
    }
    return -1;
  }

  findMergeBlock(trueBlockId, falseBlockId, blockMap, orderIndex) {
    const trueReachable = new Set();
    const queue = [trueBlockId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (trueReachable.has(id)) continue;
      trueReachable.add(id);
      const block = blockMap.get(id);
      if (block) {
        for (const succ of block.successors) {
          queue.push(succ.id);
        }
      }
    }

    const falseQueue = [falseBlockId];
    const falseVisited = new Set();
    const candidates = [];
    while (falseQueue.length > 0) {
      const id = falseQueue.shift();
      if (falseVisited.has(id)) continue;
      falseVisited.add(id);
      if (trueReachable.has(id)) {
        candidates.push(id);
        continue;
      }
      const block = blockMap.get(id);
      if (block) {
        for (const succ of block.successors) {
          falseQueue.push(succ.id);
        }
      }
    }

    const minMergeIndex = Math.max(
      orderIndex.get(trueBlockId) ?? -1,
      orderIndex.get(falseBlockId) ?? -1,
    );
    const forwardCandidates = candidates.filter(
      (id) =>
        id !== trueBlockId &&
        id !== falseBlockId &&
        (orderIndex.get(id) ?? -1) > minMergeIndex,
    );
    if (forwardCandidates.length === 0) return null;

    forwardCandidates.sort(
      (a, b) => (orderIndex.get(a) || 0) - (orderIndex.get(b) || 0),
    );
    return forwardCandidates[0];
  }

  emitDeoptSnapshot(fs, analysis, bytes) {
    if (!fs || !analysis.needsMemory) return;

    let offset = 8;
    const writeValue = (val) => {
      if (val && typeof val === "object" && val.id !== undefined) {
        const loc = this.resolveLocal(val.id, analysis);
        if (loc !== undefined) {
          const type = analysis.nodeWasmType.get(val.id);
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(offset));
          bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(loc));
          if (type === wasmFormat.TYPE_I32)
            bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
          bytes.push(
            wasmFormat.OP_F64_STORE,
            ...wasmFormat.encodeU32(3),
            ...wasmFormat.encodeU32(0),
          );
        }
      }
      offset += 8;
    };

    const maxSlot = Math.max(...fs.localValues.keys(), -1);
    for (let i = 0; i <= maxSlot; i++) {
      writeValue(fs.localValues.get(i));
    }

    for (const val of fs.stackValues) {
      writeValue(val);
    }
  }

  emitRuntimeStubCall(node, analysis, bytes, runtimeStubImportIdx) {
    if (runtimeStubImportIdx < 0) {
      bytes.push(wasmFormat.OP_UNREACHABLE);
      return;
    }
    const stub = analysis.runtimeStubTable.getByNodeId(node.id);
    const loc = analysis.nodeLocal.get(node.id);
    const fsId = node.frameState?.id ?? stub?.frameStateId ?? 0;
    bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(stub.id));
    bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
    for (let i = 0; i < 8; i++) {
      const input = node.inputs[i];
      if (input) {
        const inputLocal = this.resolveLocal(input.id, analysis);
        const inputType = analysis.nodeWasmType.get(input.id);
        if (inputLocal !== undefined) {
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(inputLocal),
          );
          if (inputType === wasmFormat.TYPE_I32)
            bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        } else {
          bytes.push(wasmFormat.OP_F64_CONST, ...wasmFormat.encodeF64(0));
        }
      } else {
        bytes.push(wasmFormat.OP_F64_CONST, ...wasmFormat.encodeF64(0));
      }
    }
    bytes.push(
      wasmFormat.OP_CALL,
      ...wasmFormat.encodeU32(runtimeStubImportIdx),
    );
    if (loc !== undefined) {
      const outType = analysis.nodeWasmType.get(node.id);
      if (outType === wasmFormat.TYPE_I32)
        bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
      bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
    } else {
      bytes.push(wasmFormat.OP_DROP);
    }
  }

  emitNode(
    node,
    analysis,
    bytes,
    deoptImportIdx,
    runtimeStubImportIdx,
    allocObjImportIdx,
  ) {
    const local = (nodeId) => this.resolveLocal(nodeId, analysis);

    if (
      node.type === ir.IR_NEW_OBJECT &&
      node.props.targetHiddenClassId != null &&
      node.props.targetSlotCount != null
    ) {
      const loc = analysis.nodeLocal.get(node.id);
      const hcId = node.props.targetHiddenClassId;
      const slotCount = node.props.targetSlotCount;
      const objSize = 8 + slotCount * 8;

      bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(0));
      bytes.push(
        wasmFormat.OP_I32_LOAD,
        ...wasmFormat.encodeU32(2),
        ...wasmFormat.encodeU32(0),
      );

      if (loc !== undefined) {
        bytes.push(wasmFormat.OP_LOCAL_TEE, ...wasmFormat.encodeU32(loc));
      }

      bytes.push(
        wasmFormat.OP_LOCAL_TEE,
        ...wasmFormat.encodeU32(analysis._allocTempLocal),
      );

      bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(hcId));
      bytes.push(
        wasmFormat.OP_I32_STORE,
        ...wasmFormat.encodeU32(2),
        ...wasmFormat.encodeU32(0),
      );

      bytes.push(
        wasmFormat.OP_LOCAL_GET,
        ...wasmFormat.encodeU32(analysis._allocTempLocal),
      );
      bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(slotCount));
      bytes.push(
        wasmFormat.OP_I32_STORE,
        ...wasmFormat.encodeU32(2),
        ...wasmFormat.encodeU32(4),
      );

      bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(0));
      bytes.push(
        wasmFormat.OP_LOCAL_GET,
        ...wasmFormat.encodeU32(analysis._allocTempLocal),
      );
      bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(objSize));
      bytes.push(wasmFormat.OP_I32_ADD);
      bytes.push(
        wasmFormat.OP_I32_STORE,
        ...wasmFormat.encodeU32(2),
        ...wasmFormat.encodeU32(0),
      );
      return;
    }

    if (
      node.type === ir.IR_NEW_OBJECT &&
      node.props.targetHiddenClassId != null &&
      allocObjImportIdx >= 0
    ) {
      const loc = analysis.nodeLocal.get(node.id);
      bytes.push(
        wasmFormat.OP_I32_CONST,
        ...wasmFormat.encodeS32(node.props.targetHiddenClassId),
      );
      bytes.push(
        wasmFormat.OP_CALL,
        ...wasmFormat.encodeU32(allocObjImportIdx),
      );
      if (loc !== undefined) {
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
      } else {
        bytes.push(wasmFormat.OP_DROP);
      }
      return;
    }

    if (this.needsFieldRuntimeStub(node)) {
      this.emitRuntimeStubCall(node, analysis, bytes, runtimeStubImportIdx);
      return;
    }

    if (RUNTIME_STUB_NODES.has(node.type)) {
      this.emitRuntimeStubCall(node, analysis, bytes, runtimeStubImportIdx);
      return;
    }

    switch (node.type) {
      case ir.IR_CONSTANT: {
        const v = node.props.value;
        const wType = analysis.nodeWasmType.get(node.id);
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;

        if (typeof v === "boolean" || typeof v === "number") {
          if (wType === wasmFormat.TYPE_F64) {
            bytes.push(
              wasmFormat.OP_F64_CONST,
              ...wasmFormat.encodeF64(typeof v === "number" ? v : 0),
            );
          } else {
            const intVal = typeof v === "boolean" ? (v ? 1 : 0) : v | 0;
            bytes.push(
              wasmFormat.OP_I32_CONST,
              ...wasmFormat.encodeS32(intVal),
            );
          }
        } else {
          const ptrIdx = node._constPtrIndex || 0;
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(ptrIdx));
        }
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_LOAD_LOCAL: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const slotLocal = analysis._localSlotMap
          ? analysis._localSlotMap.get(node.props.slot)
          : undefined;
        if (slotLocal !== undefined) {
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(slotLocal),
          );
          bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        } else {
          bytes.push(wasmFormat.OP_F64_CONST, ...wasmFormat.encodeF64(0));
          bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        }
        break;
      }

      case ir.IR_STORE_LOCAL: {
        const slotLocal = analysis._localSlotMap
          ? analysis._localSlotMap.get(node.props.slot)
          : undefined;
        if (slotLocal !== undefined && node.inputs[0]) {
          const inputLocal = local(node.inputs[0].id);
          if (inputLocal !== undefined) {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(inputLocal),
            );
            const inputType = analysis.nodeWasmType.get(node.inputs[0].id);
            if (inputType === wasmFormat.TYPE_I32)
              bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
            bytes.push(
              wasmFormat.OP_LOCAL_SET,
              ...wasmFormat.encodeU32(slotLocal),
            );
          }
        }
        break;
      }

      case ir.IR_LOAD_CONST: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const ptrIdx = node._constPtrIndex || 0;
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(ptrIdx));
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_CHECK_SMI: {
        const fsId = node.frameState?.id ?? 0;
        if (deoptImportIdx >= 0) {
          const inputLocal = local(node.inputs[0].id);
          if (inputLocal !== undefined) {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(inputLocal),
            );
            bytes.push(wasmFormat.OP_DROP);
          }
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
        }
        break;
      }

      case ir.IR_CHECK_NUMBER: {
        const fsId = node.frameState?.id ?? 0;
        if (deoptImportIdx >= 0) {
          const inputLocal = local(node.inputs[0].id);
          if (inputLocal !== undefined) {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(inputLocal),
            );
            bytes.push(wasmFormat.OP_DROP);
          }
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
        }
        break;
      }

      case ir.IR_CHECK_MAP:
      case ir.IR_CHECK_ARRAY: {
        const objLocal = local(node.inputs[0].id);
        const mapId =
          node.type === ir.IR_CHECK_ARRAY ? -1 : node.props.expectedMapId;
        const fsId = node.frameState?.id ?? 0;

        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(objLocal));
        bytes.push(
          wasmFormat.OP_I32_LOAD,
          ...wasmFormat.encodeU32(2),
          ...wasmFormat.encodeU32(0),
        );
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(mapId));
        bytes.push(wasmFormat.OP_I32_NE);
        bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
        if (deoptImportIdx >= 0) {
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(deoptReasonForNode(node))),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
        }
        bytes.push(wasmFormat.OP_UNREACHABLE);
        bytes.push(wasmFormat.OP_END);
        break;
      }

      case ir.IR_CHECK_ELEMENTS_KIND: {
        const arrayLocal = local(node.inputs[0].id);
        const expectedKind = elementsKindId(node.props.elementsKind);
        const fsId = node.frameState?.id ?? 0;

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(arrayLocal),
        );
        bytes.push(
          wasmFormat.OP_I32_LOAD,
          ...wasmFormat.encodeU32(2),
          ...wasmFormat.encodeU32(8),
        );
        bytes.push(
          wasmFormat.OP_I32_CONST,
          ...wasmFormat.encodeS32(expectedKind),
        );
        bytes.push(wasmFormat.OP_I32_NE);
        bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
        if (deoptImportIdx >= 0) {
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(deoptReasonForNode(node))),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
        }
        bytes.push(wasmFormat.OP_UNREACHABLE);
        bytes.push(wasmFormat.OP_END);
        break;
      }

      case ir.IR_CHECK_BOUNDS: {
        const indexLocal = local(node.inputs[0].id);
        const arrayLocal = local(node.inputs[1].id);
        const indexType = analysis.nodeWasmType.get(node.inputs[0].id);
        const fsId = node.frameState?.id ?? 0;

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(indexLocal),
        );
        if (indexType === wasmFormat.TYPE_F64)
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(0));
        bytes.push(wasmFormat.OP_I32_LT_S);

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(indexLocal),
        );
        if (indexType === wasmFormat.TYPE_F64)
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(arrayLocal),
        );
        bytes.push(
          wasmFormat.OP_I32_LOAD,
          ...wasmFormat.encodeU32(2),
          ...wasmFormat.encodeU32(4),
        );
        bytes.push(wasmFormat.OP_I32_GE_S);

        bytes.push(wasmFormat.OP_I32_OR);
        bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
        if (deoptImportIdx >= 0) {
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(deoptReasonForNode(node))),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
        }
        bytes.push(wasmFormat.OP_UNREACHABLE);
        bytes.push(wasmFormat.OP_END);
        break;
      }

      case ir.IR_LOAD_ARRAY_LENGTH: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const arrayLocal = local(node.inputs[0].id);
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(arrayLocal),
        );
        bytes.push(
          wasmFormat.OP_I32_LOAD,
          ...wasmFormat.encodeU32(2),
          ...wasmFormat.encodeU32(4),
        );
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_INT32_ADD:
      case ir.IR_INT32_SUB:
      case ir.IR_INT32_MUL:
      case ir.IR_INT32_SHL:
      case ir.IR_INT32_SHR:
      case ir.IR_INT32_AND:
      case ir.IR_INT32_OR:
      case ir.IR_INT32_XOR:
      case ir.IR_INT32_USHR: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;

        const leftType = analysis.nodeWasmType.get(node.inputs[0].id);
        const rightType = analysis.nodeWasmType.get(node.inputs[1].id);

        if (
          INT32_OVERFLOW_CHECK.has(node.type) &&
          analysis.hasOverflowChecks &&
          deoptImportIdx >= 0 &&
          !node.props.noOverflow
        ) {
          const fsId = node.frameState?.id ?? 0;
          const tmpLocal = analysis.overflowTempLocal;

          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(local(node.inputs[0].id)),
          );
          if (leftType === wasmFormat.TYPE_F64)
            bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
          bytes.push(wasmFormat.OP_I64_EXTEND_I32_S);
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(local(node.inputs[1].id)),
          );
          if (rightType === wasmFormat.TYPE_F64)
            bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
          bytes.push(wasmFormat.OP_I64_EXTEND_I32_S);
          bytes.push(INT64_ARITH_OPCODES[node.type]);
          bytes.push(
            wasmFormat.OP_LOCAL_TEE,
            ...wasmFormat.encodeU32(tmpLocal),
          );

          bytes.push(
            wasmFormat.OP_I64_CONST,
            ...wasmFormat.encodeS64(2147483647),
          );
          bytes.push(wasmFormat.OP_I64_GT_S);

          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(tmpLocal),
          );
          bytes.push(
            wasmFormat.OP_I64_CONST,
            ...wasmFormat.encodeS64(-2147483648),
          );
          bytes.push(wasmFormat.OP_I64_LT_S);

          bytes.push(wasmFormat.OP_I32_OR);
          bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(DEOPT_OVERFLOW)),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
          bytes.push(wasmFormat.OP_UNREACHABLE);
          bytes.push(wasmFormat.OP_END);

          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(tmpLocal),
          );
          bytes.push(wasmFormat.OP_I32_WRAP_I64);
        } else {
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(local(node.inputs[0].id)),
          );
          if (leftType === wasmFormat.TYPE_F64)
            bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(local(node.inputs[1].id)),
          );
          if (rightType === wasmFormat.TYPE_F64)
            bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
          bytes.push(INT32_ARITH_OPCODES[node.type]);
        }
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_INT32_NOT: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const inputType = analysis.nodeWasmType.get(node.inputs[0].id);
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(local(node.inputs[0].id)),
        );
        if (inputType === wasmFormat.TYPE_F64)
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        // Bitwise NOT = XOR with -1
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(-1));
        bytes.push(wasmFormat.OP_I32_XOR);
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_INT32_DIV:
      case ir.IR_INT32_MOD: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const leftType = analysis.nodeWasmType.get(node.inputs[0].id);
        const rightType = analysis.nodeWasmType.get(node.inputs[1].id);
        const rightLocal = local(node.inputs[1].id);

        if (deoptImportIdx >= 0 && node.frameState) {
          const fsId = node.frameState.id ?? 0;
          bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(rightLocal));
          if (rightType === wasmFormat.TYPE_F64)
            bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
          bytes.push(wasmFormat.OP_I32_EQZ);
          bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(DEOPT_DIVISION_BY_ZERO)),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
          bytes.push(wasmFormat.OP_UNREACHABLE);
          bytes.push(wasmFormat.OP_END);
        }

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(local(node.inputs[0].id)),
        );
        if (leftType === wasmFormat.TYPE_F64)
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(rightLocal));
        if (rightType === wasmFormat.TYPE_F64)
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        bytes.push(INT32_ARITH_OPCODES[node.type]);
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_FLOAT64_ADD:
      case ir.IR_FLOAT64_SUB:
      case ir.IR_FLOAT64_MUL:
      case ir.IR_FLOAT64_DIV: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const leftLocal = local(node.inputs[0].id);
        const rightLocal = local(node.inputs[1].id);
        const leftType = analysis.nodeWasmType.get(node.inputs[0].id);
        const rightType = analysis.nodeWasmType.get(node.inputs[1].id);

        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(leftLocal));
        if (leftType === wasmFormat.TYPE_I32)
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(rightLocal),
        );
        if (rightType === wasmFormat.TYPE_I32)
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        bytes.push(FLOAT64_ARITH_OPCODES[node.type]);
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_INT32_COMPARE: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const op = COMPARE_OPS[node.props.op];
        if (!op) break;
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(local(node.inputs[0].id)),
        );
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(local(node.inputs[1].id)),
        );
        bytes.push(op.i32);
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_FLOAT64_COMPARE: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const op = COMPARE_OPS[node.props.op];
        if (!op) break;
        const leftLocal = local(node.inputs[0].id);
        const rightLocal = local(node.inputs[1].id);
        const leftType = analysis.nodeWasmType.get(node.inputs[0].id);
        const rightType = analysis.nodeWasmType.get(node.inputs[1].id);

        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(leftLocal));
        if (leftType === wasmFormat.TYPE_I32)
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(rightLocal),
        );
        if (rightType === wasmFormat.TYPE_I32)
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        bytes.push(op.f64);
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_LOAD_FIELD: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const objLocal = local(node.inputs[0].id);
        const memOffset = 8 + node.props.offset * 8;
        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(objLocal));
        if (analysis.nodeWasmType.get(node.id) === wasmFormat.TYPE_I32) {
          bytes.push(
            wasmFormat.OP_F64_LOAD,
            ...wasmFormat.encodeU32(3),
            ...wasmFormat.encodeU32(memOffset),
          );
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        } else {
          bytes.push(
            wasmFormat.OP_F64_LOAD,
            ...wasmFormat.encodeU32(3),
            ...wasmFormat.encodeU32(memOffset),
          );
        }
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_STORE_FIELD: {
        const objLocal = local(node.inputs[0].id);
        const valLocal = local(node.inputs[1].id);
        const memOffset = 8 + node.props.offset * 8;
        const valType = analysis.nodeWasmType.get(node.inputs[1].id);

        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(objLocal));
        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(valLocal));
        if (valType === wasmFormat.TYPE_I32)
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        bytes.push(
          wasmFormat.OP_F64_STORE,
          ...wasmFormat.encodeU32(3),
          ...wasmFormat.encodeU32(memOffset),
        );
        break;
      }

      case ir.IR_POLYMORPHIC_LOAD: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const objLocal = local(node.inputs[0].id);
        const maps = node.props.maps;
        const offsets = node.props.offsets;
        const fsId = node.frameState?.id ?? 0;
        const resultType = analysis.nodeWasmType.get(node.id);

        bytes.push(
          wasmFormat.OP_BLOCK,
          resultType === wasmFormat.TYPE_I32
            ? wasmFormat.TYPE_I32
            : wasmFormat.TYPE_F64,
        );
        for (let i = 0; i < maps.length; i++) {
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(objLocal),
          );
          bytes.push(
            wasmFormat.OP_I32_LOAD,
            ...wasmFormat.encodeU32(2),
            ...wasmFormat.encodeU32(0),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(maps[i]));
          bytes.push(wasmFormat.OP_I32_EQ);
          bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(objLocal),
          );
          bytes.push(
            wasmFormat.OP_F64_LOAD,
            ...wasmFormat.encodeU32(3),
            ...wasmFormat.encodeU32(8 + offsets[i] * 8),
          );
          if (resultType === wasmFormat.TYPE_I32)
            bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
          bytes.push(wasmFormat.OP_BR, ...wasmFormat.encodeU32(1));
          bytes.push(wasmFormat.OP_END);
        }
        if (deoptImportIdx >= 0) {
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(deoptReasonForNode(node))),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
        }
        bytes.push(wasmFormat.OP_UNREACHABLE);
        bytes.push(wasmFormat.OP_END);
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_POLYMORPHIC_STORE: {
        const objLocal = local(node.inputs[0].id);
        const valLocal = local(node.inputs[1].id);
        const valType = analysis.nodeWasmType.get(node.inputs[1].id);
        const maps = node.props.maps;
        const offsets = node.props.offsets;
        const fsId = node.frameState?.id ?? 0;

        bytes.push(wasmFormat.OP_BLOCK, wasmFormat.TYPE_VOID);
        for (let i = 0; i < maps.length; i++) {
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(objLocal),
          );
          bytes.push(
            wasmFormat.OP_I32_LOAD,
            ...wasmFormat.encodeU32(2),
            ...wasmFormat.encodeU32(0),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(maps[i]));
          bytes.push(wasmFormat.OP_I32_EQ);
          bytes.push(wasmFormat.OP_IF, wasmFormat.TYPE_VOID);
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(objLocal),
          );
          bytes.push(
            wasmFormat.OP_LOCAL_GET,
            ...wasmFormat.encodeU32(valLocal),
          );
          if (valType === wasmFormat.TYPE_I32)
            bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
          bytes.push(
            wasmFormat.OP_F64_STORE,
            ...wasmFormat.encodeU32(3),
            ...wasmFormat.encodeU32(8 + offsets[i] * 8),
          );
          bytes.push(wasmFormat.OP_BR, ...wasmFormat.encodeU32(1));
          bytes.push(wasmFormat.OP_END);
        }
        if (deoptImportIdx >= 0) {
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(deoptReasonForNode(node))),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
        }
        bytes.push(wasmFormat.OP_UNREACHABLE);
        bytes.push(wasmFormat.OP_END);
        break;
      }

      // ir.IR_GENERIC_GET_PROP and ir.IR_GENERIC_SET_PROP are handled by RUNTIME_STUB_NODES

      case ir.IR_LOAD_ELEMENT: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const arrayLocal = local(node.inputs[0].id);
        const indexLocal = local(node.inputs[1].id);
        const indexType = analysis.nodeWasmType.get(node.inputs[1].id);
        const elementType = analysis.nodeWasmType.get(node.id);

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(arrayLocal),
        );
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(16));
        bytes.push(wasmFormat.OP_I32_ADD);
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(indexLocal),
        );
        if (indexType === wasmFormat.TYPE_F64)
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(8));
        bytes.push(wasmFormat.OP_I32_MUL);
        bytes.push(wasmFormat.OP_I32_ADD);
        if (elementType === wasmFormat.TYPE_I32) {
          bytes.push(
            wasmFormat.OP_F64_LOAD,
            ...wasmFormat.encodeU32(3),
            ...wasmFormat.encodeU32(0),
          );
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        } else {
          bytes.push(
            wasmFormat.OP_F64_LOAD,
            ...wasmFormat.encodeU32(3),
            ...wasmFormat.encodeU32(0),
          );
        }
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_STORE_ELEMENT: {
        const arrayLocal = local(node.inputs[0].id);
        const indexLocal = local(node.inputs[1].id);
        const indexType = analysis.nodeWasmType.get(node.inputs[1].id);
        const valLocal = local(node.inputs[2].id);
        const valType = analysis.nodeWasmType.get(node.inputs[2].id);

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(arrayLocal),
        );
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(16));
        bytes.push(wasmFormat.OP_I32_ADD);
        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(indexLocal),
        );
        if (indexType === wasmFormat.TYPE_F64)
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(8));
        bytes.push(wasmFormat.OP_I32_MUL);
        bytes.push(wasmFormat.OP_I32_ADD);

        bytes.push(wasmFormat.OP_LOCAL_GET, ...wasmFormat.encodeU32(valLocal));
        if (valType === wasmFormat.TYPE_I32)
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);

        bytes.push(
          wasmFormat.OP_F64_STORE,
          ...wasmFormat.encodeU32(3),
          ...wasmFormat.encodeU32(0),
        );
        break;
      }

      case ir.IR_PHI: {
        break;
      }

      case ir.IR_RETURN: {
        if (node.inputs[0]) {
          const inputLocal = local(node.inputs[0].id);
          const inputType = analysis.nodeWasmType.get(node.inputs[0].id);

          if (inputType !== analysis.resultType) {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(inputLocal),
            );
            if (
              analysis.resultType === wasmFormat.TYPE_F64 &&
              inputType === wasmFormat.TYPE_I32
            ) {
              bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
            } else if (
              analysis.resultType === wasmFormat.TYPE_I32 &&
              inputType === wasmFormat.TYPE_F64
            ) {
              bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
            }
            bytes.push(wasmFormat.OP_RETURN);
          } else {
            bytes.push(
              wasmFormat.OP_LOCAL_GET,
              ...wasmFormat.encodeU32(inputLocal),
            );
            bytes.push(wasmFormat.OP_RETURN);
          }
        }
        break;
      }

      case ir.IR_DEOPTIMIZE: {
        if (deoptImportIdx >= 0) {
          const fsId = node.frameState?.id ?? 0;
          this.emitDeoptSnapshot(node.frameState, analysis, bytes);
          bytes.push(
            wasmFormat.OP_I32_CONST,
            ...wasmFormat.encodeS32(deoptReasonId(deoptReasonForNode(node))),
          );
          bytes.push(wasmFormat.OP_I32_CONST, ...wasmFormat.encodeS32(fsId));
          bytes.push(
            wasmFormat.OP_CALL,
            ...wasmFormat.encodeU32(deoptImportIdx),
          );
        }
        bytes.push(wasmFormat.OP_UNREACHABLE);
        break;
      }

      case ir.IR_BOX: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const inputLocal = local(node.inputs[0].id);
        const inputType = analysis.nodeWasmType.get(node.inputs[0].id);
        const outType = analysis.nodeWasmType.get(node.id);

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(inputLocal),
        );

        if (
          inputType === wasmFormat.TYPE_I32 &&
          outType === wasmFormat.TYPE_F64
        ) {
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        } else if (
          inputType === wasmFormat.TYPE_F64 &&
          outType === wasmFormat.TYPE_I32
        ) {
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        }
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_UNBOX: {
        const loc = analysis.nodeLocal.get(node.id);
        if (loc === undefined) break;
        const inputLocal = local(node.inputs[0].id);
        const inputType = analysis.nodeWasmType.get(node.inputs[0].id);
        const outType = analysis.nodeWasmType.get(node.id);

        bytes.push(
          wasmFormat.OP_LOCAL_GET,
          ...wasmFormat.encodeU32(inputLocal),
        );
        if (
          inputType === wasmFormat.TYPE_I32 &&
          outType === wasmFormat.TYPE_F64
        ) {
          bytes.push(wasmFormat.OP_F64_CONVERT_I32_S);
        } else if (
          inputType === wasmFormat.TYPE_F64 &&
          outType === wasmFormat.TYPE_I32
        ) {
          bytes.push(wasmFormat.OP_I32_TRUNC_F64_S);
        }
        bytes.push(wasmFormat.OP_LOCAL_SET, ...wasmFormat.encodeU32(loc));
        break;
      }

      case ir.IR_JUMP:
      case ir.IR_BRANCH:
      case ir.IR_PARAMETER:
        break;
    }
  }

  needsFieldRuntimeStub(node) {
    if (
      node.type === ir.IR_LOAD_FIELD ||
      node.type === ir.IR_POLYMORPHIC_LOAD
    ) {
      return repForNode(node) === REP_HANDLE;
    }
    if (
      node.type === ir.IR_STORE_FIELD ||
      node.type === ir.IR_POLYMORPHIC_STORE
    ) {
      return true;
    }
    return false;
  }

  compile(optimizerResult, compiledFn) {
    const { graph, frameStates } = optimizerResult;

    try {
      validateOptimizedGraph(graph, frameStates || []);
    } catch (e) {
      tracer.jitCompile(
        compiledFn.name,
        `Wasm: graph validation failed: ${e.message}`,
      );
      return null;
    }

    if (!this.canCompile(graph)) {
      tracer.jitCompile(
        compiledFn.name,
        `Wasm: graph not compilable: ${this.lastCompileRejection}`,
      );
      return null;
    }

    const analysis = this.analyzeGraph(graph);
    if (!analysis) {
      tracer.jitCompile(
        compiledFn.name,
        `Wasm: analysis failed: ${this.lastAnalysisFailure || "unknown"}`,
      );
      return null;
    }

    let constPtrBase = 49152;
    for (const constNode of analysis._nonPrimitiveConstants) {
      constNode._constPtrIndex = constPtrBase;
      constPtrBase += 64;
    }

    const builder = new wasmFormat.WasmModuleBuilder();

    let deoptImportIdx = -1;
    let runtimeStubImportIdx = -1;
    let importFuncCount = 0;

    if (analysis.needsDeoptImport) {
      const deoptTypeIdx = builder.addType(
        [wasmFormat.TYPE_I32, wasmFormat.TYPE_I32],
        [],
      );
      deoptImportIdx = builder.addFuncImport("env", "deopt", deoptTypeIdx);
      importFuncCount++;
    }

    if (analysis.needsRuntimeStubImport) {
      const runtimeStubTypeIdx = builder.addType(
        [
          wasmFormat.TYPE_I32,
          wasmFormat.TYPE_I32,
          wasmFormat.TYPE_F64,
          wasmFormat.TYPE_F64,
          wasmFormat.TYPE_F64,
          wasmFormat.TYPE_F64,
          wasmFormat.TYPE_F64,
          wasmFormat.TYPE_F64,
          wasmFormat.TYPE_F64,
          wasmFormat.TYPE_F64,
        ],
        [wasmFormat.TYPE_F64],
      );
      runtimeStubImportIdx = builder.addFuncImport(
        "env",
        "runtimeStub",
        runtimeStubTypeIdx,
      );
      importFuncCount++;
    }

    let allocObjImportIdx = -1;
    if (analysis.needsAllocObjImport) {
      const allocObjTypeIdx = builder.addType(
        [wasmFormat.TYPE_I32],
        [wasmFormat.TYPE_I32],
      );
      allocObjImportIdx = builder.addFuncImport(
        "env",
        "allocObj",
        allocObjTypeIdx,
      );
      importFuncCount++;
    }

    if (analysis.needsMemory) {
      builder.addMemoryImport("env", "memory");
    }

    const funcTypeIdx = builder.addType(analysis.paramTypes, [
      analysis.resultType,
    ]);
    builder.addFunction(funcTypeIdx);

    builder.addExport("opt", importFuncCount);

    const bodyBytes = this.generateBody(
      graph,
      analysis,
      deoptImportIdx,
      runtimeStubImportIdx,
      allocObjImportIdx,
    );
    builder.setCode(0, analysis.additionalLocals, bodyBytes);

    const wasmBytes = builder.toBytes();

    let wasmModule;
    try {
      wasmModule = new WebAssembly.Module(wasmBytes);
    } catch (e) {
      tracer.jitCompile(
        compiledFn.name,
        `Wasm validation failed: ${e.message}`,
      );
      return null;
    }

    const imports = { env: {} };
    let memory = null;

    if (analysis.needsMemory) {
      memory = new WebAssembly.Memory({ initial: 1, maximum: 256 }); // max 16MB
      imports.env.memory = memory;
    }

    if (analysis.needsDeoptImport) {
      imports.env.deopt = (reasonId, frameStateId) => {
        const reason = deoptReasonFromId(reasonId);
        const fs = frameStates ? frameStates[frameStateId] : null;
        const bcOffset = fs ? fs.bytecodeOffset : 0;
        const runtimeValues = new Map();

        if (fs && memory) {
          const buffer = new Float64Array(memory.buffer);
          let offsetIndex = 1;

          const readValue = (val) => {
            if (val && typeof val === "object" && val.id !== undefined) {
              const loc = analysis.nodeLocal.get(val.id);
              if (loc !== undefined) {
                const type = analysis.nodeWasmType.get(val.id);
                const rawF64 = buffer[offsetIndex];
                const rawInt = Math.trunc(rawF64);
                const objInfo = threadLocal.currentObjPtrs
                  ? threadLocal.currentObjPtrs.get(rawInt)
                  : null;
                if (objInfo && objInfo.value) {
                  runtimeValues.set(val.id, objInfo.value);
                  offsetIndex++;
                  return;
                }
                if (type === wasmFormat.TYPE_I32) {
                  runtimeValues.set(val.id, mkSmi(rawInt));
                } else if (type === wasmFormat.TYPE_F64) {
                  runtimeValues.set(val.id, mkDouble(rawF64));
                }
              }
            }
            offsetIndex++;
          };

          const maxSlot = Math.max(...fs.localValues.keys(), -1);
          for (let i = 0; i <= maxSlot; i++) {
            readValue(fs.localValues.get(i));
          }

          for (const val of fs.stackValues) {
            readValue(val);
          }
        }

        throw new DeoptSignal(
          reason,
          bcOffset,
          [],
          [],
          frameStateId,
          runtimeValues,
        );
      };
    }

    const nodeMap = new Map();
    for (const block of graph.blocks) {
      for (const node of block.nodes) {
        nodeMap.set(node.id, node);
      }
    }

    if (analysis.needsRuntimeStubImport) {
      imports.env.runtimeStub = (
        stubId,
        frameStateId,
        a0,
        a1,
        a2,
        a3,
        a4,
        a5,
        a6,
        a7,
      ) => {
        const runtime = threadLocal.currentRuntime;
        if (!runtime) throw new Error("runtimeStub: missing runtime");
        const stub = analysis.runtimeStubTable.getById(stubId);
        if (!stub) throw new Error("runtimeStub: invalid stub " + stubId);
        const node = nodeMap.get(stub.nodeId);
        const rawArgs = [a0, a1, a2, a3, a4, a5, a6, a7];
        try {
          return executeRuntimeStub(
            stub,
            node,
            rawArgs,
            analysis,
            runtime,
            compiledFn,
            frameStates,
            frameStateId,
          );
        } catch (e) {
          if (e instanceof DeoptSignal) throw e;
          const fs = frameStates ? frameStates[frameStateId] : null;
          const bcOffset = fs ? fs.bytecodeOffset : stub.bytecodeOffset;
          throw new DeoptSignal(
            DEOPT_RUNTIME_STUB_FAILURE,
            bcOffset,
            [],
            [],
            frameStateId,
            new Map(),
          );
        }
      };
    }

    if (analysis.needsAllocObjImport) {
      const hcCache = new Map();
      imports.env.allocObj = (hcId) => {
        const runtime = threadLocal.currentRuntime;
        if (!runtime) throw new Error("allocObj: missing runtime");
        let cached = hcCache.get(hcId);
        if (!cached) {
          const hc = getHiddenClassById(hcId);
          cached = { hc, propCount: hc ? hc.propertyCount || 0 : 0 };
          hcCache.set(hcId, cached);
        }
        const obj = createJSObject(cached.hc || undefined);
        const pc = cached.propCount;
        for (let _i = 0; _i < pc; _i++) obj.slots[_i] = mkUndefined();
        const tagged = mkObject(obj);
        return runtime.allocateTagged(tagged, true);
      };
    }

    let instance;
    try {
      instance = new WebAssembly.Instance(wasmModule, imports);
    } catch (e) {
      tracer.jitCompile(
        compiledFn.name,
        `Wasm instantiation failed: ${e.message}`,
      );
      return null;
    }

    const wasmFn = instance.exports.opt;
    const wasmSize = wasmBytes.length;

    tracer.jitCompile(
      compiledFn.name,
      `Wasm module compiled: ${wasmSize} bytes, ${graph.blocks.length} blocks`,
    );
    if (
      analysis.runtimeStubTable &&
      analysis.runtimeStubTable.stubs.length > 0
    ) {
      compiledFn.optimizedStubSummary = analysis.runtimeStubTable.stubs;
      tracer.jitCompile(
        compiledFn.name,
        `Runtime stubs lowered: ${analysis.runtimeStubTable.stubs.length}`,
      );
    } else {
      compiledFn.optimizedStubSummary = [];
    }

    return this.createWrapper(
      wasmFn,
      analysis,
      compiledFn,
      frameStates,
      memory,
    );
  }

  createWrapper(wasmFn, analysis, compiledFn, frameStates, memory) {
    const { paramTypes, resultType, entryGuards, needsMemory, resultValueRep } =
      analysis;

    return function optimizedCode(args, thisValue, interpreter) {
      const recordWasmDeopt = (reason, bytecodeOffset) => {
        compiledFn.deoptCount = (compiledFn.deoptCount || 0) + 1;
        compiledFn.lastDeoptReason = reason;
        dependencyRegistry.unregister(compiledFn);
        compiledFn.optimizedCode = null;
        tracer.jitDeopt(compiledFn.name, reason, bytecodeOffset);

        const policy = interpreter && interpreter.tieringPolicy;
        if (policy && typeof policy.recordDeopt === "function") {
          policy.recordDeopt(compiledFn, reason);
        }

        const maxDeoptCount = policy ? policy.maxDeoptCount : 3;
        if (compiledFn.deoptCount >= maxDeoptCount) {
          compiledFn.disableOptimization = true;
        }
      };

      for (const guard of entryGuards) {
        const input = guard.inputs[0];
        if (!input || input.type !== ir.IR_PARAMETER) continue;
        const paramIdx = input.props.index;
        const arg = paramIdx < args.length ? args[paramIdx] : mkUndefined();

        let guardFailed = false;
        if (guard.type === ir.IR_CHECK_SMI && !isSmi(arg)) guardFailed = true;
        if (guard.type === ir.IR_CHECK_NUMBER && !isNumber(arg))
          guardFailed = true;

        if (guardFailed) {
          const reason = deoptReasonForNode(guard);
          recordWasmDeopt(reason, 0);

          const frameState = guard.frameState;
          if (frameState?.isInlinedFrame) {
            return resumeFrameStateChain(
              args,
              thisValue,
              frameState,
              new Map(),
              interpreter,
            );
          }
          const frame = materializeFrameFromState(
            frameState?.compiledFunction || compiledFn,
            args,
            thisValue,
            frameState,
            new Map(),
            interpreter,
          );
          return interpreter.resumeAt(frame);
        }
      }

      const objPtrs = new Map();
      let nextObjPtr = 1024;
      if (analysis.hasInlineAlloc) {
        const dv = new DataView(memory.buffer);
        dv.setInt32(0, nextObjPtr, true);
      }
      const ensureMemory = (needed) => {
        if (!memory) return;
        const currentSize = memory.buffer.byteLength;
        if (needed > currentSize) {
          const pagesToGrow = Math.ceil((needed - currentSize) / 65536);
          try {
            memory.grow(pagesToGrow);
          } catch (e) {
            // Memory growth failed — cap exceeded
          }
        }
      };

      const allocateTagged = (tagged, skipSlotSerialization) => {
        const ptr = nextObjPtr;
        const raw = getPayload(tagged);
        let size = 8;
        if ((isObject(tagged) || isArray(tagged)) && raw) {
          const slots = raw.slots
            ? raw.slots.length
            : raw.elements
              ? raw.elements.length
              : 0;
          size = (isArray(tagged) ? 16 : 8) + slots * 8;
          const newEnd = ptr + Math.max(size, 8);
          ensureMemory(newEnd);
          nextObjPtr = newEnd;
          objPtrs.set(ptr, { ptr, obj: raw, value: tagged });
          if (skipSlotSerialization) {
            const view = new DataView(memory.buffer);
            view.setInt32(ptr, raw.hiddenClass ? raw.hiddenClass.id : 0, true);
            view.setInt32(ptr + 4, slots, true);
          } else {
            serializeObject(raw, memory, ptr, allocateTagged);
          }
          return ptr;
        }
        const newEnd = ptr + Math.max(size, 8);
        ensureMemory(newEnd);
        nextObjPtr = newEnd;
        objPtrs.set(ptr, { ptr, obj: raw, value: tagged });
        return ptr;
      };

      if (analysis._nonPrimitiveConstants) {
        for (const constNode of analysis._nonPrimitiveConstants) {
          const ptr = constNode._constPtrIndex;
          if (ptr !== undefined) {
            const v =
              constNode.props.value !== undefined
                ? constNode.props.value
                : constNode.props.index;
            let tagged;
            if (typeof v === "string") tagged = mkString(v);
            else if (typeof v === "function") tagged = mkFunction(v);
            else if (
              v &&
              typeof v === "object" &&
              Array.isArray(v.instructions) &&
              typeof v.paramCount === "number"
            ) {
              tagged = mkFunction(new JSFunction(v, v.name));
            }
            else if (v && typeof v === "object" && v._tag !== undefined)
              tagged = v;
            else tagged = mkUndefined();
            objPtrs.set(ptr, { ptr, obj: getPayload(tagged), value: tagged });
          }
        }
      }

      const rawArgs = [];
      for (let i = 0; i < paramTypes.length; i++) {
        const arg = i < args.length ? args[i] : mkUndefined();
        const paramValueRep = analysis.paramValueReps?.[i] || null;
        const passAsTaggedHandle =
          needsMemory &&
          paramValueRep === REP_HANDLE &&
          (isBool(arg) ||
            isDouble(arg) ||
            isObject(arg) ||
            isArray(arg) ||
            isFunction(arg) ||
            isString(arg) ||
            isNull(arg) ||
            isUndefined(arg));
        if (paramTypes[i] === wasmFormat.TYPE_I32) {
          if (passAsTaggedHandle) {
            rawArgs.push(allocateTagged(arg));
          } else if (isSmi(arg)) {
            rawArgs.push(getPayload(arg));
          } else if (isDouble(arg)) {
            rawArgs.push(getPayload(arg) | 0);
          } else if (isBool(arg)) {
            rawArgs.push(getPayload(arg) ? 1 : 0);
          } else {
            rawArgs.push(0);
          }
        } else {
          if (passAsTaggedHandle) {
            rawArgs.push(allocateTagged(arg));
          } else {
            rawArgs.push(isSmi(arg) || isDouble(arg) ? getPayload(arg) : 0);
          }
        }
      }

      let rawResult;
      const prevObjPtrs = threadLocal.currentObjPtrs;
      const prevRuntime = threadLocal.currentRuntime;
      threadLocal.currentObjPtrs = objPtrs;
      threadLocal.currentRuntime = {
        objPtrs,
        memory,
        interpreter,
        compiledFn,
        thisValue: thisValue || mkUndefined(),
        allocateTagged,
        getTagged(ptr) {
          const p = Math.trunc(ptr);
          const info = objPtrs.get(p);
          if (info) return info.value;
          if (analysis.hasInlineAlloc) {
            const curPtr = new DataView(memory.buffer).getInt32(0, true);
            if (curPtr > nextObjPtr) nextObjPtr = curPtr;
          }
          if (analysis.hasInlineAlloc && p >= 1024 && p < nextObjPtr) {
            const dv = new DataView(memory.buffer);
            const hcId = dv.getInt32(p, true);
            const slotCnt = dv.getInt32(p + 4, true);
            const hc = getHiddenClassById(hcId);
            const obj = createJSObject(hc || undefined);
            for (let si = 0; si < slotCnt; si++) {
              const sv = dv.getFloat64(p + 8 + si * 8, true);
              obj.slots[si] =
                Number.isInteger(sv) && sv >= -2147483648 && sv <= 2147483647
                  ? mkSmi(sv)
                  : mkNumber(sv);
            }
            const tagged = mkObject(obj);
            objPtrs.set(p, { ptr: p, obj, value: tagged });
            return tagged;
          }
          return mkNumber(ptr);
        },
        syncTagged(ptr) {
          const p = Math.trunc(ptr);
          let info = objPtrs.get(p);
          if (!info && analysis.hasInlineAlloc && p >= 1024) {
            this.getTagged(ptr);
            info = objPtrs.get(p);
          }
          if (info && (isObject(info.value) || isArray(info.value))) {
            serializeObject(getPayload(info.value), memory, info.ptr);
          }
        },
      };

      if (analysis.hasInlineAlloc) {
        const dv = new DataView(memory.buffer);
        dv.setInt32(0, nextObjPtr, true);
      }

      // Update execution counters for tiering policy
      compiledFn.invocationCount = (compiledFn.invocationCount || 0) + 1;
      compiledFn.lastExecutionTime = Date.now();

      // Stack overflow protection
      if (++wasmCallDepth > MAX_WASM_CALL_DEPTH) {
        wasmCallDepth--;
        threadLocal.currentObjPtrs = prevObjPtrs;
        threadLocal.currentRuntime = prevRuntime;
        throw new RangeError("Maximum call stack size exceeded");
      }

      try {
        rawResult = wasmFn(...rawArgs);
      } catch (e) {
        wasmCallDepth--;
        threadLocal.currentObjPtrs = prevObjPtrs;
        threadLocal.currentRuntime = prevRuntime;
        if (e instanceof DeoptSignal) {
          if (needsMemory) {
            for (const info of objPtrs.values()) {
              deserializeObject(info.obj, memory, info.ptr);
            }
          }

          recordWasmDeopt(e.reason, e.bytecodeOffset);

          // Restore non-numeric values from objPtrs for deopt
          if (e.runtimeValues && e.runtimeValues.size > 0) {
            for (const [nodeId, val] of e.runtimeValues) {
              if (typeof val === "number") {
                const ptrInfo = objPtrs.get(val);
                if (ptrInfo && ptrInfo.value) {
                  e.runtimeValues.set(nodeId, ptrInfo.value);
                }
              }
            }
          }

          const frameState = frameStates ? frameStates[e.frameStateId] : null;
          if (frameState?.isInlinedFrame) {
            return resumeFrameStateChain(
              args,
              thisValue,
              frameState,
              e.runtimeValues || new Map(),
              interpreter,
            );
          }
          const frame = materializeFrameFromState(
            frameState?.compiledFunction || compiledFn,
            args,
            thisValue,
            frameState,
            e.runtimeValues || new Map(),
            interpreter,
          );
          return interpreter.resumeAt(frame);
        }
        throw e;
      }

      wasmCallDepth--;
      threadLocal.currentObjPtrs = prevObjPtrs;
      threadLocal.currentRuntime = prevRuntime;

      if (analysis.hasInlineAlloc) {
        const dv = new DataView(memory.buffer);
        nextObjPtr = dv.getInt32(0, true);
      }

      if (needsMemory) {
        const retInfo = objPtrs.get(Math.trunc(rawResult));
        if (retInfo) {
          deserializeObject(retInfo.obj, memory, retInfo.ptr);
        }
      }

      const returnedHandle = objPtrs.get(Math.trunc(rawResult));
      if (returnedHandle) {
        return returnedHandle.value;
      }

      if (resultValueRep === REP_HANDLE) {
        const info = objPtrs.get(Math.trunc(rawResult));
        if (info) return info.value;
        const ptr = Math.trunc(rawResult);
        if (ptr >= 1024 && ptr < nextObjPtr) {
          const dv = new DataView(memory.buffer);
          const hcId = dv.getInt32(ptr, true);
          const slotCnt = dv.getInt32(ptr + 4, true);
          const hc = getHiddenClassById(hcId);
          const obj = createJSObject(hc || undefined);
          for (let si = 0; si < slotCnt; si++) {
            obj.slots[si] = mkNumber(dv.getFloat64(ptr + 8 + si * 8, true));
          }
          return mkObject(obj);
        }
        return mkNumber(rawResult);
      }

      if (resultValueRep === REP_BOOL) {
        return mkBool(rawResult !== 0);
      }

      if (resultType === wasmFormat.TYPE_I32) {
        return mkSmi(rawResult);
      } else {
        return mkNumber(rawResult);
      }
    };

    // Attach dispose method for code aging cleanup
    optimizedCode._dispose = () => {
      objPtrs.clear();
      memory = null;
    };

    return optimizedCode;
  }
}
